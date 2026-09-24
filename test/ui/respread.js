'use strict';

/* ============================================================================
 * test/ui/respread.js -- drive the re-spread flow in a real browser.
 *
 * NOT part of `npm test`. The model suite is dependency-free on purpose; this
 * one needs Playwright, so it is opt-in:
 *
 *     npm install --no-save playwright
 *     node test/ui/respread.js
 *
 * It seeds a year through the model itself, embeds that state in a copy of the
 * app, opens it in Chromium and works the reconciliation the way the owner
 * would: open the effort, re-spread it, approve the balancing invoice, then
 * check what the panels say afterwards. Screenshots land beside it.
 *
 * The model suite proves the arithmetic. This proves the buttons are wired to
 * it, which is the half a headless suite cannot see.
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { load, standard } = require('../harness.js');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.log('Playwright is not installed. This check is opt-in:\n' +
    '  npm install --no-save playwright && node test/ui/respread.js');
  process.exit(0);
}

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-ui-'));

/* A year billed three times at 40 / 35 / 25, then reconciled to 50 / 30 / 20 --
   the June flying-hour case, with the ratio already moved and nothing yet done
   about it. */
function seed() {
  const RPT = load({ now: '2026-06-15T12:00:00Z' });
  const b = standard(RPT);
  b.doc('Warehousing', { cust: 'DEU', amount: 600000, status: 'Accepted', rcvd: '2025-10-05' });
  b.doc('Warehousing', { cust: 'ITA', amount: 400000, status: 'Accepted', rcvd: '2025-10-05' });
  ['2025-10', '2025-12', '2026-02'].forEach((m) => {
    b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: m, ref: 'SF1080-' + m });
  });
  const sh = b.obj.share('FY26 common');
  sh.lines[b.id.cust('DEU')] = 50;
  sh.lines[b.id.cust('ITA')] = 30;
  sh.lines[b.id.cust('USA')] = 20;
  RPT.state.fy = 2026;

  const app = path.join(__dirname, '..', '..', 'Reimbursables_Program_Tracker.html');
  const html = fs.readFileSync(app, 'utf8').replace(
    '<script id="rpt-data" type="application/json">null</script>',
    '<script id="rpt-data" type="application/json">' + JSON.stringify(RPT.payload()) + '</script>');
  const file = path.join(OUT, 'seeded.html');
  fs.writeFileSync(file, html);
  return { file, g: b.obj.group('DLA').id, e: b.id.effort('Warehousing') };
}

const SEED = seed();
const IDS = { g: SEED.g, e: SEED.e };

const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); process.exitCode = 1; } else console.log('  ok   ' + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto('file://' + SEED.file);
  await page.waitForTimeout(400);

  console.log('\n1. the app loads the seeded year');
  ok(await page.locator('.brand h1').isVisible(), 'header renders');
  const nav = await page.locator('#nav').innerText();
  ok(/Reimbursable groups/.test(nav), 'navigation renders: ' + nav.replace(/\n+/g, ' | '));
  ok(errs.length === 0, 'no page errors on load' + (errs.length ? ': ' + errs[0] : ''));

  console.log('\n2. the Re-spread action is on the effort');
  await page.evaluate((ids) => { RPT.grpOpen[ids.g] = true; RPT.effOpen[ids.e] = true; RPT.render(); }, IDS);
  await page.waitForTimeout(200);
  const btn = page.locator('[data-act="respread"]').first();
  ok(await btn.count() > 0, 'button is present');
  ok((await btn.innerText()).includes('Re-spread'), 'labelled: ' + (await btn.innerText()).trim());

  console.log('\n3. it opens the reconciliation panel');
  await btn.click();
  await page.waitForTimeout(300);
  ok(await page.locator('#modal').isVisible(), 'modal opens');
  const title = await page.locator('#modalTitle').innerText();
  ok(/Re-spread/.test(title) && /FY26/.test(title), 'titled: ' + title);
  const body = await page.locator('#modalBody').innerText();
  ok(/1 October/.test(body), 'states the reconciliation applies back to 1 October');
  ok(/left exactly as sent/.test(body), 'states prior invoices are left as sent');
  await page.screenshot({ path: path.join(OUT, 'respread-panel.png') });

  console.log('\n4. the figures are the ones the model computed');
  const rows = await page.locator('#modalBody tbody tr').allInnerTexts();
  rows.forEach(r => console.log('       ' + r.replace(/\t/g, '  ')));
  const flat = rows.join(' | ');
  ok(/\$120,000/.test(flat) && /\$150,000/.test(flat) && /\+\$30,000/.test(flat), 'DEU 120,000 -> 150,000, +30,000');
  ok(/-\$15,000/.test(flat), 'the two credits are shown negative');
  const foot = await page.locator('#modalBody tfoot').innerText();
  ok(/\$300,000/.test(foot), 'pool of 300,000 on both sides: ' + foot.replace(/\t/g, '  '));
  ok(/\$0/.test(foot), 'and nets to zero');

  console.log('\n5. it raises the balancing invoice');
  await page.fill('#rs_reason', 'FY26 flying hour reconciliation');
  await page.fill('#rs_ref', 'ADJ-2026-01');
  await page.selectOption('#rs_month', '2026-06');
  await page.locator('#modalBtns button', { hasText: 'Raise the balancing invoice' }).click();
  await page.waitForTimeout(400);
  ok(!(await page.locator('#modal').isVisible()), 'modal closes on success');

  const state = await page.evaluate((ids) => {
    const g = RPT.groupById(ids.g);
    const e = RPT.effortById(g, 2026, ids.e);
    const adj = e.invoices.filter(i => RPT.isAdjustment(i))[0];
    const S = RPT.effortSplit(g, 2026, ids.e);
    return {
      count: e.invoices.length,
      adjTotal: adj && adj.total,
      adjMonth: adj && adj.month,
      adjReason: adj && adj.reason,
      invoicedAll: S.invoicedAll,
      byCust: S.rows.map(r => RPT.custCode(r.cust) + '=' + r.invoiced).join(' '),
      bidTies: RPT.bidByMonth(g, 2026, ids.e).every(m => Math.abs(m.bidD + m.bidF + m.bidR - m.accepted) < 0.005)
    };
  }, IDS);
  console.log('       ' + JSON.stringify(state));
  ok(state.count === 4, 'four invoices now: the three sent plus the adjustment');
  ok(state.adjTotal === 0, 'the adjustment nets to zero');
  ok(state.adjMonth === '2026-06', 'raised in June');
  ok(state.adjReason === 'FY26 flying hour reconciliation', 'reason recorded');
  ok(state.invoicedAll === 300000, 'total billed unchanged at 300,000');
  ok(state.byCust === 'DEU=150000 ITA=90000 USA=60000', 'participants at the new ratio: ' + state.byCust);
  ok(state.bidTies, 'D + F + R still ties in every month');

  console.log('\n6. the listing shows what happened');
  await page.evaluate((ids) => { RPT.grpOpen[ids.g] = true; RPT.effOpen[ids.e] = true; RPT.go('groups'); }, IDS);
  await page.waitForTimeout(300);
  const listing = await page.locator('#groupsList').innerText();
  ok(/re-spread/i.test(listing), 'the adjustment is marked in the invoice list');
  await page.screenshot({ path: path.join(OUT, 'after-respread.png'), fullPage: false });

  console.log('\n7. a sent invoice no longer offers to be recomputed');
  const firstId = await page.evaluate((ids) => {
    const g = RPT.groupById(ids.g);
    return RPT.effortById(g, 2026, ids.e).invoices.filter(i => !RPT.isAdjustment(i))[0].id;
  }, IDS);
  await page.evaluate(([ids, iid]) => RPT.invoiceView(ids.g, 2026, ids.e, iid), [IDS, firstId]);
  await page.waitForTimeout(300);
  const revBody = await page.locator('#modalBody').innerText();
  const revBtns = await page.locator('#modalBtns').innerText();
  ok(/already settled/.test(revBody), 'the review panel says it is already settled');
  ok(/balancing invoice of/.test(revBody), 'and names the balancing invoice');
  ok(!/Recompute/.test(revBtns), 'the Recompute button is gone: [' + revBtns.replace(/\n/g, ' ') + ']');
  await page.screenshot({ path: path.join(OUT, 'settled-invoice.png') });

  console.log('\n8. the adjustment itself explains what it is');
  await page.evaluate((ids) => {
    const g = RPT.groupById(ids.g);
    const adj = RPT.effortById(g, 2026, ids.e).invoices.filter(i => RPT.isAdjustment(i))[0];
    RPT.invoiceView(ids.g, 2026, ids.e, adj.id);
  }, IDS);
  await page.waitForTimeout(300);
  const adjBody = await page.locator('#modalBody').innerText();
  ok(/balancing invoice, not a bill/.test(adjBody), 'says it is not a bill');
  ok(/negative line is a credit/.test(adjBody), 'explains the credit');
  ok(/flying hour reconciliation/.test(adjBody), 'shows the reason recorded');
  await page.screenshot({ path: path.join(OUT, 'adjustment-review.png') });

  console.log('\n   page errors across the whole run: ' + errs.length);
  errs.slice(0, 3).forEach(e => console.log('     ' + e));
  ok(errs.length === 0, 'no JavaScript errors at any point');

  await browser.close();
  console.log('\n   screenshots: ' + OUT);
  console.log(process.exitCode ? '\nFAILED' : '\nall checks passed');
})();
