'use strict';

/* THE THREE STAGES OF A REIMBURSABLE ORDER
 *
 *   BID D  Unfilled Customer Orders          accepted, not yet billed
 *   BID F  Filled Customer Orders, uncollected   billed, not yet collected
 *   BID R  Filled Customer Orders Collected      reimbursed
 *
 * An SF 1080 moves money D -> F. DFAS moves F -> R on collection. The tie-out
 * that governs the whole thing is
 *
 *       D + F + R  =  accepted funding
 *
 * and the model says it is asserted, not assumed. These tests assert it at
 * EVERY month of the year, not just at the end, because that is what a monthly
 * D&O MORD true-up reconciles against.
 */

module.exports = ({ describe, test, eq, ok, near, deep, mentions, silent, load, standard }) => {

  /* A year with money moving through all three stages at different times. */
  function moving(opts) {
    const RPT = load(opts);
    const b = standard(RPT);
    const deu = b.doc('Warehousing', { cust: 'DEU', amount: 400000, no: 'MIPR-1', rcvd: '2025-11-10' });
    b.doc('Warehousing', { cust: 'ITA', amount: 200000, no: 'MIPR-2', rcvd: '2026-02-20' });
    b.amend(deu, { amount: 100000, kind: 'Increase', date: '2026-03-05' });
    const i1 = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
    const i2 = b.invoice('DLA', 2026, 'Warehousing', { total: 200000, month: '2026-03' }).invoice;
    RPT.addColl(i1, { amount: 40000, date: '2026-02-15', ref: 'SF1080-1' });
    return { RPT, b, g: b.obj.group('DLA'), eid: b.id.effort('Warehousing'), i1, i2 };
  }

  const at = (rows, ym) => rows.filter((r) => r.ym === ym)[0];

  describe('collections / one invoice', () => {

    test('collected and outstanding are separate facts', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;

      eq(RPT.invCollected(inv), 0, 'raised is not collected');
      eq(RPT.invOutstanding(inv), 100000);

      RPT.addColl(inv, { amount: 40000, date: '2026-02-15' });
      eq(RPT.invCollected(inv), 40000);
      eq(RPT.invOutstanding(inv), 60000);

      RPT.addColl(inv, { amount: 60000, date: '2026-03-15' });
      eq(RPT.invCollected(inv), 100000);
      eq(RPT.invOutstanding(inv), 0, 'settled in two parts');
    });

    test('a collection is attributed on the invoice\'s own proportions', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      RPT.addColl(inv, { amount: 40000, date: '2026-02-15' });

      const by = RPT.collByCust(inv);
      eq(by[b.id.cust('DEU')], 16000, '40% of what was collected');
      eq(by[b.id.cust('ITA')], 14000);
      eq(by[b.id.cust('USA')], 10000);
      eq(RPT.round2(Object.keys(by).reduce((t, k) => t + by[k], 0)), 40000);
    });

    test('and never on today\'s cost share -- the settlement is a record too', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      RPT.addColl(inv, { amount: 40000, date: '2026-02-15' });

      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 90;
      sh.lines[b.id.cust('ITA')] = 5;
      sh.lines[b.id.cust('USA')] = 5;

      eq(RPT.collByCust(inv)[b.id.cust('DEU')], 16000,
        'still 40%, because that is what the invoice billed');
    });

    test('an invoice for nothing attributes nothing, rather than dividing by zero', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 0, month: '2026-01' }).invoice;
      const by = RPT.collByCust(inv);
      eq(by[b.id.cust('DEU')], 0);
    });

    test('removing a collection puts the money back to outstanding', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      const c = RPT.addColl(inv, { amount: 40000, date: '2026-02-15' });
      RPT.removeColl(inv, c.id);
      eq(RPT.invCollected(inv), 0);
      eq(RPT.invOutstanding(inv), 100000);
    });
  });

  describe('collections / what recording one refuses', () => {

    test('more than is outstanding', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      RPT.addColl(inv, { amount: 40000, date: '2026-02-15' });

      const errs = RPT.validateColl(inv, { amount: 70000, date: '2026-03-01' });
      mentions(errs, '$110,000', 'says what the total would become');
      mentions(errs, '$60,000', 'and what is actually outstanding');
      silent(RPT.validateColl(inv, { amount: 60000, date: '2026-03-01' }),
        'collecting the exact balance is fine');
    });

    test('a zero, negative or unreadable amount', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      mentions(RPT.validateColl(inv, { amount: 0, date: '2026-01-05' }), 'positive amount');
      mentions(RPT.validateColl(inv, { amount: -10, date: '2026-01-05' }), 'positive amount');
      mentions(RPT.validateColl(inv, { amount: 'some', date: '2026-01-05' }), 'Enter the amount collected');
    });

    test('a missing or unreadable date', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      mentions(RPT.validateColl(inv, { amount: 100 }), 'Give the collection a date');
      mentions(RPT.validateColl(inv, { amount: 100, date: 'March' }), 'could not be read');
    });

    test('the collection being edited does not count itself twice', () => {
      const RPT = load();
      const b = standard(RPT);
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      const c = RPT.addColl(inv, { amount: 40000, date: '2026-02-15' });
      silent(RPT.validateColl(inv, { amount: 100000, date: '2026-02-15' }, c.id),
        'raising that same collection to the full invoice is fine');
    });
  });

  describe('collections / the stages, month by month', () => {

    test('D + F + R equals accepted funding in every month of the year', () => {
      const { RPT, g, eid } = moving();
      const rows = RPT.bidByMonth(g, 2026, eid);
      eq(rows.length, 12);
      rows.forEach((m) => {
        eq(RPT.round2(m.bidD + m.bidF + m.bidR), m.accepted,
          `the stages must tie to gross reimbursable obligations in ${m.ym}`);
      });
    });

    test('each event lands in the month it happened, not the month it is read', () => {
      const { RPT, g, eid } = moving();
      const rows = RPT.bidByMonth(g, 2026, eid);

      deep([at(rows, '2025-10').accepted, at(rows, '2025-10').bidD], [0, 0],
        'nothing has been received yet in October');
      eq(at(rows, '2025-11').bidD, 400000, 'the MIPR counts from the month it was received');
      eq(at(rows, '2025-12').bidD, 400000, 'and stays there');

      const jan = at(rows, '2026-01');
      deep([jan.bidD, jan.bidF, jan.bidR], [300000, 100000, 0],
        'the invoice moves 100,000 from D to F in the month it covers');

      const feb = at(rows, '2026-02');
      deep([feb.accepted, feb.bidD, feb.bidF, feb.bidR], [600000, 500000, 60000, 40000],
        'the second MIPR arrives and the collection moves F to R');

      const mar = at(rows, '2026-03');
      deep([mar.accepted, mar.bidD, mar.bidF, mar.bidR], [700000, 400000, 260000, 40000],
        'the amendment counts from its own date, and the second invoice from its month');
    });

    test('the balances are cumulative, and carry to the end of the year', () => {
      const { RPT, g, eid } = moving();
      const rows = RPT.bidByMonth(g, 2026, eid);
      const sep = at(rows, '2026-09');
      deep([sep.accepted, sep.bidD, sep.bidF, sep.bidR], [700000, 400000, 260000, 40000],
        'nothing happened after March, so March\'s position stands');
    });

    test('months after the one we are in are marked future', () => {
      const { RPT, g, eid } = moving();
      const rows = RPT.bidByMonth(g, 2026, eid);
      /* the harness clock stands at 15 May 2026 -- fiscal month 8 */
      eq(at(rows, '2026-05').future, false, 'the month we are in is not future');
      eq(at(rows, '2026-06').future, true);
      eq(at(rows, '2026-09').future, true);
      eq(rows.filter((m) => m.future).length, 4, 'Jun, Jul, Aug and Sep of FY26');
    });

    test('a closed year has no future months left', () => {
      const { RPT, g, eid } = moving({ now: '2027-06-01T12:00:00Z' });
      const rows = RPT.bidByMonth(g, 2026, eid);
      eq(rows.filter((m) => m.future).length, 0);
    });

    test('an undated document or collection falls back rather than vanishing', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 400000 });   /* no rcvd */
      b.amend(d, { amount: 50000, kind: 'Increase' });                   /* no date */
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-03' }).invoice;
      RPT.addColl(inv, { amount: 10000 });                               /* no date */

      const rows = RPT.bidByMonth(b.obj.group('DLA'), 2026, b.id.effort('Warehousing'));
      eq(at(rows, '2025-10').accepted, 450000,
        'an undated document counts from the first month of the year, with its amendment');
      eq(at(rows, '2026-03').bidR, 10000, 'an undated collection settles in the invoice\'s month');
      rows.forEach((m) => eq(RPT.round2(m.bidD + m.bidF + m.bidR), m.accepted, m.ym));
    });

    test('the direct side is the same movement seen from the other direction', () => {
      const { RPT, g, eid } = moving();
      const mar = at(RPT.bidByMonth(g, 2026, eid), '2026-03');
      eq(mar.oCharged, 300000, 'every invoice line is cost put through the direct cite');
      eq(mar.oOffset, 300000, 'with nobody excluded, all of it is billed out');
      eq(mar.oRetained, 0);
      eq(mar.oOffset, RPT.round2(mar.bidF + mar.bidR),
        'the offset must equal what has left BID D');
    });

    test('excluding the funder keeps the tie-out intact', () => {
      const { RPT, g, eid, b } = moving();
      const rows = RPT.bidByMonth(g, 2026, eid, { exclude: b.id.cust('USA') });
      rows.forEach((m) => {
        eq(RPT.round2(m.bidD + m.bidF + m.bidR), m.accepted, `stages must still tie in ${m.ym}`);
      });

      const mar = at(rows, '2026-03');
      eq(mar.invoiced, 225000, 'the funder\'s own line is not a bill');
      eq(mar.oRetained, 75000, 'it is their own direct cost');
      eq(mar.oCharged, 300000, 'the whole cost still went through the direct cite');
      eq(mar.bidR, 30000, 'and the collection settles pro rata, less the funder\'s slice');
      eq(mar.oOffset, RPT.round2(mar.bidF + mar.bidR));
    });

    test('an effort that no longer exists returns a clean empty year', () => {
      const { RPT, g } = moving();
      const rows = RPT.bidByMonth(g, 2026, 'e_gone');
      eq(rows.length, 12);
      rows.forEach((m) => deep([m.accepted, m.bidD, m.bidF, m.bidR], [0, 0, 0, 0]));
    });
  });
};
