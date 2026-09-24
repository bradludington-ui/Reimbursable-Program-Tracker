'use strict';

/* A cost share can change INSIDE a fiscal year -- the flying-hour
 * reconciliation run in June or July -- and it applies back to 1 October.
 *
 * Prior invoices are not reissued: they were sent, and the participant
 * reconciles them against their own records. The difference goes out as a new
 * invoice of a different KIND, whose lines are signed differences rather than a
 * total split by a ratio, and which therefore nets to zero when the year's
 * requirement has not moved.
 */

module.exports = ({ describe, test, eq, ok, deep, near, mentions, silent, load, standard }) => {

  /* Three invoices raised Oct, Dec and Feb at 40 / 35 / 25.
     Cumulative: DEU 120,000  ITA 105,000  USA 75,000  =  300,000 billed. */
  function billedYear(opts) {
    const RPT = load(opts);
    const b = standard(RPT);
    ['2025-10', '2025-12', '2026-02'].forEach((m) => {
      b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: m });
    });
    return { RPT, b, g: b.obj.group('DLA'), eid: b.id.effort('Warehousing') };
  }

  /* the June reconciliation: 40/35/25 becomes 50/30/20 */
  function reconcile(b) {
    const sh = b.obj.share('FY26 common');
    sh.lines[b.id.cust('DEU')] = 50;
    sh.lines[b.id.cust('ITA')] = 30;
    sh.lines[b.id.cust('USA')] = 20;
    return sh;
  }

  const row = (R, RPT, code) => R.rows.filter((r) => RPT.custCode(r.cust) === code)[0];

  describe('re-spread / what the reconciliation says is owed', () => {

    test('before the ratio moves there is nothing to adjust', () => {
      const { RPT, g, eid } = billedYear();
      const R = RPT.respread(g, 2026, eid);
      eq(R.pool, 300000, 'everything billed so far');
      eq(R.changed, false);
      deep(R.rows.map((r) => r.delta), [0, 0, 0]);
    });

    test('the difference is measured against what was actually billed', () => {
      const { RPT, b, g, eid } = billedYear();
      reconcile(b);
      const R = RPT.respread(g, 2026, eid);

      eq(R.pool, 300000, 'the pool is what has been billed, not the requirement');
      eq(row(R, RPT, 'DEU').billed, 120000, 'read from the invoice snapshots');
      eq(row(R, RPT, 'DEU').shouldBe, 150000, '50% of the 300,000 billed to date');
      eq(row(R, RPT, 'DEU').delta, 30000, 'under-billed by this much');
      eq(row(R, RPT, 'ITA').delta, -15000, 'over-billed');
      eq(row(R, RPT, 'USA').delta, -15000);
    });

    test('the deltas sum to zero -- it redistributes, it does not bill more', () => {
      const { RPT, b, g, eid } = billedYear();
      reconcile(b);
      const R = RPT.respread(g, 2026, eid);
      eq(R.net, 0);
      eq(R.balanced, true);
      eq(R.moved, 30000, 'the gross movement, which is what the office feels');
    });

    test('no historical ratio is read -- the snapshots are the history', () => {
      /* the old table is gone entirely, and the answer is unchanged */
      const { RPT, b, g, eid } = billedYear();
      reconcile(b);
      const R = RPT.respread(g, 2026, eid);
      eq(row(R, RPT, 'DEU').delta, 30000,
        'computed from what was billed, never from what the table used to say');
    });

    test('a participant taken off the table has their whole position credited', () => {
      const { RPT, b, g, eid } = billedYear();
      const sh = b.obj.share('FY26 common');
      delete sh.lines[b.id.cust('USA')];
      sh.lines[b.id.cust('DEU')] = 55;
      sh.lines[b.id.cust('ITA')] = 45;

      const R = RPT.respread(g, 2026, eid);
      const usa = row(R, RPT, 'USA');
      eq(usa.onShare, false, 'they still get a row, because their money is still real');
      eq(usa.billed, 75000);
      eq(usa.shouldBe, 0);
      eq(usa.delta, -75000, 'all of it comes back as a credit');
      eq(R.net, 0, 'and lands on the two who remain');
      eq(row(R, RPT, 'DEU').delta, 45000);
    });

    test('an unbalanced table is refused, as it is for an invoice', () => {
      const { RPT, b, g, eid } = billedYear();
      b.obj.share('FY26 common').lines[b.id.cust('USA')] = 22;   /* 97% */
      mentions(RPT.respread(g, 2026, eid).why, 'not 100%');
      mentions(RPT.respread(g, 2026, eid).why, 'balance it first');
    });

    test('an effort with no table, or nothing billed, says which', () => {
      const RPT = load();
      const b = standard(RPT);
      mentions(RPT.respread(b.obj.group('DLA'), 2026, b.id.effort('Warehousing')).why,
        'Nothing has been invoiced');
      b.effort('DLA', 2026, 'Unshared', 50000, null);
      mentions(RPT.respread(b.obj.group('DLA'), 2026, b.id.effort('Unshared')).why,
        'no cost share attached');
    });
  });

  describe('re-spread / issuing the balancing invoice', () => {

    function adjusted(opts) {
      const ctx = billedYear(opts);
      reconcile(ctx.b);
      ctx.res = ctx.RPT.raiseRespread(ctx.g, 2026, ctx.eid, {
        month: '2026-06', ref: 'ADJ-1', reason: 'FY26 flying hour reconciliation'
      });
      ctx.adj = ctx.res.invoice;
      return ctx;
    }

    test('it is raised as an invoice of its own kind', () => {
      const { RPT, adj, res } = adjusted();
      eq(res.ok, true);
      eq(adj.kind, 'adjustment');
      eq(RPT.isAdjustment(adj), true);
      eq(adj.month, '2026-06');
      eq(adj.reason, 'FY26 flying hour reconciliation');
      eq(adj.ref, 'ADJ-1');
    });

    test('its lines are the signed differences and its total is their sum', () => {
      const { RPT, b, adj } = adjusted();
      eq(adj.lines[b.id.cust('DEU')], 30000);
      eq(adj.lines[b.id.cust('ITA')], -15000);
      eq(adj.lines[b.id.cust('USA')], -15000);
      eq(adj.total, 0, 'a pure redistribution bills nothing new');
      deep(RPT.invoiceRows(adj).map((r) => r.amount), [30000, -15000, -15000]);
    });

    test('a participant whose share did not move gets no line at all', () => {
      /* a zero line claims a movement that did not happen, and shows as a $0
         row on a document that goes to the participant */
      const { RPT, b, g, eid } = billedYear();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 50;
      sh.lines[b.id.cust('ITA')] = 25;
      sh.lines[b.id.cust('USA')] = 25;          /* unchanged */

      const R = RPT.respread(g, 2026, eid);
      eq(row(R, RPT, 'USA').delta, 0, 'their quarter of the pool is what they were billed');

      const adj = RPT.raiseRespread(g, 2026, eid, { month: '2026-06' }).invoice;
      eq(Object.keys(adj.lines).length, 2, 'only the two who moved');
      eq(adj.lines[b.id.cust('USA')], undefined);
      deep(RPT.invoiceRows(adj).map((r) => RPT.custCode(r.cust)), ['DEU', 'ITA']);
      eq(adj.respread.billed[b.id.cust('USA')], 75000,
        'though what they were billed is still recorded, so the pool reconciles');
    });

    test('it records what it was computed from', () => {
      const { b, adj } = adjusted();
      eq(adj.respread.pool, 300000);
      eq(adj.respread.billed[b.id.cust('DEU')], 120000,
        'so the true-up can be re-derived without replaying every invoice');
      eq(adj.respread.moved, 30000);
      eq(adj.shareName, 'FY26 common');
      eq(adj.pct[b.id.cust('DEU')], 50, 'at the ratio it was spread onto');
    });

    test('afterwards every participant stands at their corrected share', () => {
      const { RPT, g, eid } = adjusted();
      const S = RPT.effortSplit(g, 2026, eid);
      const by = (code) => S.rows.filter((r) => RPT.custCode(r.cust) === code)[0];
      eq(by('DEU').invoiced, 150000, '50% of the 300,000 billed');
      eq(by('ITA').invoiced, 90000);
      eq(by('USA').invoiced, 60000);
      eq(S.invoicedAll, 300000, 'and the effort has still billed 300,000 in total');
    });

    test('a credit raises that participant\\u2019s unbilled position, to work off later', () => {
      const { RPT, b, g, eid } = billedYear();
      b.doc('Warehousing', { cust: 'ITA', amount: 200000, status: 'Accepted', rcvd: '2025-10-05' });
      const before = RPT.effortSplit(g, 2026, eid).rows
        .filter((r) => RPT.custCode(r.cust) === 'ITA')[0];
      eq(before.unbilled, 95000, '200,000 accepted less 105,000 billed');

      reconcile(b);
      RPT.raiseRespread(g, 2026, eid, { month: '2026-06' });
      const after = RPT.effortSplit(g, 2026, eid).rows
        .filter((r) => RPT.custCode(r.cust) === 'ITA')[0];
      eq(after.invoiced, 90000, 'credited 15,000');
      eq(after.unbilled, 110000, 'which is theirs to be billed against later');
    });

    test('re-spreading again immediately finds nothing to do', () => {
      const { RPT, g, eid } = adjusted();
      const R = RPT.respread(g, 2026, eid);
      eq(R.changed, false, 'the adjustment put everybody where the ratio says they belong');
      deep(R.rows.map((r) => r.delta), [0, 0, 0]);
      mentions(RPT.raiseRespread(g, 2026, eid, { month: '2026-07' }).why, 'Nothing to adjust');
    });

    test('a second reconciliation later in the year works from the corrected base', () => {
      const { RPT, b, g, eid } = adjusted();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 60;
      sh.lines[b.id.cust('ITA')] = 25;
      sh.lines[b.id.cust('USA')] = 15;

      const R = RPT.respread(g, 2026, eid);
      eq(R.pool, 300000, 'the adjustment added no money to the pool');
      eq(row(R, RPT, 'DEU').billed, 150000, 'it billed from where the first re-spread left them');
      eq(row(R, RPT, 'DEU').delta, 30000, 'another ten points of 300,000');
      eq(R.net, 0);
    });

    test('a month outside the year is refused', () => {
      const { RPT, b, g, eid } = billedYear();
      reconcile(b);
      mentions(RPT.raiseRespread(g, 2026, eid, { month: '2026-10' }).why, 'is not in FY26');
      mentions(RPT.raiseRespread(g, 2026, eid, {}).why, 'Assign the adjustment to a month');
    });

    test('nothing is written when it refuses', () => {
      const { RPT, b, g, eid } = billedYear();
      reconcile(b);
      RPT.raiseRespread(g, 2026, eid, { month: '2026-10' });
      eq(RPT.effortById(g, 2026, eid).invoices.length, 3, 'still just the three real invoices');
    });
  });

  describe('re-spread / an adjustment is not an ordinary invoice', () => {

    function adjusted() {
      const ctx = billedYear();
      reconcile(ctx.b);
      ctx.adj = ctx.RPT.raiseRespread(ctx.g, 2026, ctx.eid, { month: '2026-06' }).invoice;
      return ctx;
    }

    test('it cannot be recomputed -- its lines are differences, not a split', () => {
      const { RPT, adj } = adjusted();
      eq(RPT.recomputeInvoice(adj), false,
        're-splitting a net of zero by a ratio would destroy the true-up');
      eq(adj.lines[Object.keys(adj.lines)[0]] !== 0, true, 'and it is left exactly as it was');
    });

    test('nothing is collected against it', () => {
      const { RPT, adj } = adjusted();
      const errs = RPT.validateColl(adj, { amount: 1000, date: '2026-07-01' });
      mentions(errs, 'redistribution, not a bill');
      mentions(errs, 'the invoice that billed the money');
    });

    test('the invoices it settled are no longer asking to be recomputed', () => {
      const { RPT, g, eid, adj } = adjusted();
      const first = RPT.effortById(g, 2026, eid).invoices[0];
      eq(RPT.invoiceStale(first).stale, true, 'it plainly was raised on the old ratio');
      eq(RPT.staleSettledBy(g, 2026, eid, first), adj,
        'but the difference has already gone out; recomputing a sent invoice is the wrong move');
    });

    test('an invoice raised after the adjustment is not settled by it', () => {
      /* raised the same DAY, which is why this cannot be answered from dates */
      const { RPT, b, g, eid, adj } = adjusted();
      const later = b.invoice('DLA', 2026, 'Warehousing', { total: 50000, month: '2026-07' }).invoice;
      eq(later.raised, adj.raised, 'same day, as it would be in a real July');
      eq(RPT.staleSettledBy(g, 2026, eid, later), null, 'it was not in the pool that was trued up');
      eq(RPT.invoiceStale(later).stale, false, 'and it was raised on the current ratio anyway');
    });

    test('the adjustment names the invoices it trued up', () => {
      const { RPT, g, eid, adj } = adjusted();
      const ids = RPT.effortById(g, 2026, eid).invoices
        .filter((i) => !RPT.isAdjustment(i)).map((i) => i.id);
      deep(adj.respread.invoices, ids, 'all three, by id');
    });

    test('the adjustment itself is never reported as stale against its own ratio', () => {
      const { RPT, adj } = adjusted();
      eq(RPT.invoiceStale(adj).stale, false);
      eq(RPT.staleSettledBy(null, 2026, null, adj), null, 'and it settles nothing but itself');
    });
  });

  describe('re-spread / it composes with everything already counted', () => {

    function adjusted() {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-10-05' });
      b.doc('Warehousing', { cust: 'ITA', amount: 300000, status: 'Accepted', rcvd: '2025-10-05' });
      ['2025-10', '2025-12', '2026-02'].forEach((m) => {
        b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: m });
      });
      const i1 = b.obj.effort('Warehousing').invoices[0];
      RPT.addColl(i1, { amount: 100000, date: '2025-11-20' });
      reconcile(b);
      const g = b.obj.group('DLA'), eid = b.id.effort('Warehousing');
      RPT.raiseRespread(g, 2026, eid, { month: '2026-06' });
      return { RPT, b, g, eid };
    }

    test('the D + F + R tie-out still holds in every month', () => {
      const { RPT, g, eid } = adjusted();
      RPT.bidByMonth(g, 2026, eid).forEach((m) => {
        eq(RPT.round2(m.bidD + m.bidF + m.bidR), m.accepted, `stages must tie in ${m.ym}`);
      });
    });

    test('a redistribution moves no money out of BID D', () => {
      const { RPT, g, eid } = adjusted();
      const rows = RPT.bidByMonth(g, 2026, eid);
      const may = rows.filter((m) => m.ym === '2026-05')[0];
      const jun = rows.filter((m) => m.ym === '2026-06')[0];
      deep([jun.bidD, jun.bidF, jun.bidR], [may.bidD, may.bidF, may.bidR],
        'nothing new was billed, so the stages do not move');
    });

    test('the fact table still accounts for every dollar', () => {
      const { RPT, g, eid } = adjusted();
      const facts = RPT.facts(2026).filter((f) => f.effort === 'Warehousing');
      const S = RPT.effortSplit(g, 2026, eid);
      const sum = (k) => Math.round(facts.reduce((t, r) => t + (Number(r[k]) || 0), 0) * 100) / 100;
      eq(sum('invoiced'), S.invoicedAll);
      eq(sum('mipr'), S.miprAll);
    });

    test('the year report and the ad-hoc builder still agree', () => {
      const { RPT } = adjusted();
      const F = RPT.fyRollup(2026);
      const r = RPT.adhoc({ fy: 2026, dims: ['cust'], measures: ['invoiced'] });
      eq(r.totals.invoiced, F.invoiced);
      eq(F.invoiced, 300000, 'still the three invoices, redistributed');
    });

    test('a credit shows in the month it was issued', () => {
      const { RPT } = adjusted();
      const jun = RPT.fyRollup(2026).byMonth.filter((m) => m.ym === '2026-06')[0];
      eq(jun.invoiced, 0, 'the adjustment nets to nothing in aggregate');
      const m = RPT.monthFacts(2026).filter((r) => r.month === '2026-06');
      eq(m.length, 3, 'but every participant moved, and each movement is a row');
      eq(Math.round(m.reduce((t, r) => t + r.invoiced, 0) * 100) / 100, 0);
    });

    test('collections stay attached to the invoice that billed the money', () => {
      const { RPT, g, eid } = adjusted();
      const S = RPT.effortSplit(g, 2026, eid);
      eq(S.collectedAll, 100000, 'the October invoice was settled and stays settled');
      const deu = S.rows.filter((r) => RPT.custCode(r.cust) === 'DEU')[0];
      eq(deu.collected, 40000, 'attributed as that invoice billed it, not as today\\u2019s ratio');
    });

    test('it survives being saved and reloaded', () => {
      const { RPT, g, eid } = adjusted();
      const before = RPT.effortSplit(g, 2026, eid);
      const re = load();
      re.adopt(JSON.parse(JSON.stringify(RPT.payload())));
      const g2 = re.groupById(g.id);
      const after = re.effortSplit(g2, 2026, eid);
      eq(after.invoicedAll, before.invoicedAll);
      deep(after.rows.map((r) => r.invoiced), before.rows.map((r) => r.invoiced));
      const adj = re.effortById(g2, 2026, eid).invoices.filter((i) => re.isAdjustment(i));
      eq(adj.length, 1, 'and it is still an adjustment on the other side');
    });
  });

  describe('re-spread / older files', () => {

    test('every invoice written before adjustments existed is an ordinary one', () => {
      const RPT = load();
      RPT.adopt({
        v: 7,
        groups: [{
          id: 'g1', code: 'D', name: 'D',
          years: { '2026': { status: 'Active', efforts: [{
            id: 'e1', name: 'W', requirement: 0, docs: [],
            invoices: [{ id: 'i1', month: '2026-01', total: 1000, lines: { c1: 1000 } }]
          }] } }
        }]
      });
      const inv = RPT.state.groups[0].years['2026'].efforts[0].invoices[0];
      eq(inv.kind, 'invoice');
      eq(RPT.isAdjustment(inv), false);
    });
  });
};
