'use strict';

/* THE D&O MORD IS A MONTHLY POSITION, NOT A RUNNING TOTAL.
 *
 * It is trued at each month end to that month's BID D, so the current position
 * is the LATEST entry -- never the sum of them. Summing would double-count
 * every month the position was merely restated, which is the bug the schema
 * 5 -> 6 migration exists to undo.
 */

module.exports = ({ describe, test, eq, ok, deep, mentions, silent, load, standard }) => {

  /* USA funds Warehousing up front; DEU and ITA send their orders in later. */
  function fronted(opts) {
    const RPT = load(opts);
    const b = standard(RPT);
    b.doc('Warehousing', { cust: 'DEU', amount: 100000, status: 'Accepted', rcvd: '2025-11-10' });
    b.doc('Warehousing', { cust: 'ITA', amount: 50000, status: 'Accepted', rcvd: '2025-12-10' });
    b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
    b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 400000, agency: 'DFAS' });
    return { RPT, b, g: b.obj.group('DLA'), eid: b.id.effort('Warehousing') };
  }

  describe('up front / the funder\'s position', () => {

    test('what was fronted is the MIPR less the funder\'s own share', () => {
      const { RPT, g, eid } = fronted();
      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.sent, 400000);
      eq(U.funderShare, 250000, '25% of the million is USA\'s own cost');
      eq(U.fronted, 150000, 'the rest is everybody else\'s money, paid in advance');
      eq(U.onShare, true);
    });

    test('orders received are set against what was fronted', () => {
      const { RPT, g, eid } = fronted();
      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.ordersReceived, 150000, 'DEU 100,000 plus ITA 50,000');
      eq(U.ordersOutstanding, 0, 'so nothing is still owed');
    });

    test('an effort with no position returns null rather than a zeroed one', () => {
      const { RPT, g, b } = fronted();
      eq(RPT.upfrontEffort(g, 2026, b.id.effort('Transportation')), null,
        'a zeroed position would read as "somebody sent $0", which nobody said');
    });

    test('clearing the funder clears the position', () => {
      const { RPT, g, eid } = fronted();
      RPT.setUpfrontEffort(g, 2026, eid, { funder: '' });
      eq(RPT.upfrontEffort(g, 2026, eid), null);
    });

    test('the stages exclude the funder, and still tie out', () => {
      const { RPT, g, eid } = fronted();
      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.accepted, 150000, 'the funder\'s own MIPR is not a customer order');
      eq(U.bidD, 75000);
      eq(U.bidF, 75000, 'billed to DEU and ITA, not yet collected');
      eq(U.bidR, 0);
      eq(U.stageTotal, 150000);
      eq(U.stagesTie, true, 'D + F + R = gross reimbursable obligations');
    });

    test('the direct side ties to the reimbursable side', () => {
      const { RPT, g, eid } = fronted();
      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.oCharged, 100000, 'the whole invoice went through the direct cite');
      eq(U.oRetained, 25000, 'the funder\'s own line is their cost, not a bill');
      eq(U.oOffset, 75000, 'the rest is billed off it');
      eq(U.oTies, true, 'and equals what has left BID D');
      eq(U.dnoOpen, 75000, 'billed but uncollected is the open difference');
      eq(U.dnoSettled, 0);
      eq(U.dnoBalanced, false, 'it only balances once the money is collected');
    });

    test('the position is reported as of the last month that has happened', () => {
      const { RPT, g, eid } = fronted();
      eq(RPT.upfrontEffort(g, 2026, eid).asOf, '2026-05', 'the harness clock stands in May');
      const later = fronted({ now: '2027-06-01T12:00:00Z' });
      eq(later.RPT.upfrontEffort(later.g, 2026, later.eid).asOf, '2026-09',
        'once the year has closed, the whole year has happened');
    });
  });

  describe('up front / the D&O MORD is a position, not a ledger', () => {

    test('the current position is the latest month, never the sum', () => {
      const { RPT, b, g, eid } = fronted();
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 100000, no: 'MORD-1' });
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-12', amount: 75000, no: 'MORD-2' });

      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.current, 75000, 'the standing amount, not 175,000');
      eq(U.currentMonth, '2025-12');
      eq(U.mords.length, 2, 'both entries are kept -- the history is real');
    });

    test('re-recording a month replaces it, because a month has one position', () => {
      const { RPT, b, g, eid } = fronted();
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 100000, no: 'MORD-1' });
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 90000, no: 'MORD-1A' });

      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.mords.length, 1, 'a month cannot stand at two amounts at once');
      eq(U.current, 90000);
      eq(U.mords[0].no, 'MORD-1A');
    });

    test('entries are read in month order however they were entered', () => {
      const { RPT, b, g, eid } = fronted();
      b.mord('DLA', 2026, 'Warehousing', { month: '2026-02', amount: 60000 });
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 100000 });

      const U = RPT.upfrontEffort(g, 2026, eid);
      deep(U.mords.map((m) => m.month), ['2025-11', '2026-02']);
      eq(U.current, 60000, 'February stands, not the one entered last');
    });

    test('the variance against BID D is stated rather than enforced', () => {
      const { RPT, b, g, eid } = fronted();
      b.mord('DLA', 2026, 'Warehousing', { month: '2026-05', amount: 50000 });
      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.bidD, 75000);
      eq(U.current, 50000);
      eq(U.variance, 25000, 'the MORD needs increasing by this much');
      eq(U.inStep, false);
      mentions(U.flags, 'needs increasing by');
    });

    test('a position in step raises no flag about itself', () => {
      const { RPT, b, g, eid } = fronted();
      b.mord('DLA', 2026, 'Warehousing', { month: '2026-05', amount: 75000 });
      const U = RPT.upfrontEffort(g, 2026, eid);
      eq(U.inStep, true);
      eq(U.variance, 0);
      eq(U.flags.filter((f) => /D&O MORD stands at/.test(f)).length, 0);
    });

    test('the reconciliation carries the standing position forward month by month', () => {
      const { RPT, b, g, eid } = fronted();
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 100000 });

      const U = RPT.upfrontEffort(g, 2026, eid);
      const nov = U.recon.filter((r) => r.ym === '2025-11')[0];
      const dec = U.recon.filter((r) => r.ym === '2025-12')[0];
      eq(nov.mord, 100000, 'November had an entry');
      eq(dec.mord, null, 'December did not');
      eq(dec.standing, 100000, 'but the position from November still stands');
      eq(dec.variance, 50000, 'against a BID D that moved to 150,000');
    });

    test('months that have passed with an unreconciled variance are counted', () => {
      const { RPT, g, eid } = fronted();
      const U = RPT.upfrontEffort(g, 2026, eid);
      ok(U.monthsOpen > 0, 'no MORD has been processed at all');
      const later = RPT.upfrontEffort(g, 2026, eid).recon.filter((r) => r.future);
      eq(later.length, 4, 'and future months are not counted against anybody');
    });

    test('what the MORD should be set to for a given month end', () => {
      const { RPT, g, eid } = fronted();
      eq(RPT.mordTarget(g, 2026, eid, '2025-11'), 100000);
      eq(RPT.mordTarget(g, 2026, eid, '2026-01'), 75000, 'after the invoice moved D to F');
      eq(RPT.mordTarget(g, 2026, eid, 'nonsense'), 0);
    });

    test('a true-up is refused for a month outside the year, or a negative position', () => {
      const { RPT, g, eid } = fronted();
      mentions(RPT.validateMord(g, 2026, eid, { month: '2026-10', amount: 1000 }), 'is not in FY26');
      mentions(RPT.validateMord(g, 2026, eid, { month: '2026-01', amount: -5 }),
        'cannot be negative');
      mentions(RPT.validateMord(g, 2026, eid, { amount: 1000 }), 'Which month end');
      mentions(RPT.validateMord(g, 2026, eid, { month: '2026-01', amount: 'x' }),
        'Enter the position');
    });

    test('but never refused merely for disagreeing with BID D', () => {
      const { RPT, g, eid } = fronted();
      silent(RPT.validateMord(g, 2026, eid, { month: '2026-01', amount: 999999 }),
        'showing the variance is the whole point of the panel');
    });

    test('a true-up on an effort with no position is refused outright', () => {
      const { RPT, g, b } = fronted();
      mentions(RPT.validateMord(g, 2026, b.id.effort('Transportation'), { month: '2026-01', amount: 1 }),
        'no up-front funding position');
    });

    test('removing a true-up drops it out of the position', () => {
      const { RPT, b, g, eid } = fronted();
      const m = b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 100000 });
      RPT.removeMord(g, 2026, eid, m.id);
      eq(RPT.upfrontEffort(g, 2026, eid).mords.length, 0);
      eq(RPT.upfrontEffort(g, 2026, eid).current, 0);
    });
  });

  describe('up front / things that should not be true, said plainly', () => {

    test('a funder who is not on the cost share they fund', () => {
      const RPT = load();
      const b = standard(RPT);
      b.customer('FRA', 'France', 'AGENCY');
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'FRA', sent: 400000 });

      const U = RPT.upfrontEffort(b.obj.group('DLA'), 2026, b.id.effort('Warehousing'));
      eq(U.onShare, false);
      eq(U.funderShare, 0);
      mentions(U.flags, 'is not on its cost share');
      mentions(U.flags, 'the whole MIPR looks fronted');
    });

    test('less sent up front than the funder\'s own share', () => {
      const RPT = load();
      const b = standard(RPT);
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 100000 });
      const U = RPT.upfrontEffort(b.obj.group('DLA'), 2026, b.id.effort('Warehousing'));
      mentions(U.flags, 'so nothing was fronted');
    });

    test('money sitting in BID D with no MORD processed against it', () => {
      const { RPT, g, eid } = fronted();
      mentions(RPT.upfrontEffort(g, 2026, eid).flags, 'with no D&O MORD');
    });

    test('customer orders still owed against what was fronted', () => {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 20000, status: 'Accepted', rcvd: '2025-11-10' });
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 400000 });

      const U = RPT.upfrontEffort(b.obj.group('DLA'), 2026, b.id.effort('Warehousing'));
      eq(U.fronted, 150000);
      eq(U.ordersReceived, 20000);
      eq(U.ordersOutstanding, 130000);
      mentions(U.flags, 'is still owed by the other customers');
    });
  });

  describe('up front / the group year is a roll-up, never a position of its own', () => {

    test('positions on separate efforts are summed, not merged', () => {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 100000, status: 'Accepted', rcvd: '2025-11-10' });
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 400000 });
      b.upfront('DLA', 2026, 'Transportation', { funder: 'USA', sent: 150000 });

      const U = RPT.upfront(b.obj.group('DLA'), 2026);
      eq(U.efforts.length, 2);
      eq(U.sent, 550000);
      eq(U.funderShare, 350000, '25% of a million plus 25% of four hundred thousand');
      eq(U.fronted, 200000);
      eq(U.multiFunder, false);
      eq(RPT.custCode(U.funder), 'USA');
    });

    test('efforts funded by different customers are flagged, not silently added', () => {
      const RPT = load();
      const b = standard(RPT);
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 400000 });
      b.upfront('DLA', 2026, 'Transportation', { funder: 'DEU', sent: 150000 });

      const U = RPT.upfront(b.obj.group('DLA'), 2026);
      eq(U.multiFunder, true);
      eq(U.funder, null, 'there is no single funder to name');
      mentions(U.flags, 'funded up front by 2 different customers');
    });

    test('a group year with no position at all is null', () => {
      const RPT = load();
      const b = standard(RPT);
      eq(RPT.upfront(b.obj.group('DLA'), 2026), null);
    });

    test('each effort\'s MORDs are carried up labelled with the effort they belong to', () => {
      const RPT = load();
      const b = standard(RPT);
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 400000 });
      b.upfront('DLA', 2026, 'Transportation', { funder: 'USA', sent: 150000 });
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 10000 });
      b.mord('DLA', 2026, 'Transportation', { month: '2025-11', amount: 5000 });

      const U = RPT.upfront(b.obj.group('DLA'), 2026);
      eq(U.mords.length, 2);
      deep(U.mords.map((m) => m.effort).sort(), ['Transportation', 'Warehousing']);
      eq(U.current, 15000, 'each effort\'s own standing position, added');
    });
  });
};
