'use strict';

/* Rule 2: YEARS ARE FENCED. Nothing in one year is summed with, defaulted from
 * or carried into another. Every function that touches money names its fiscal
 * year explicitly.
 *
 * And the effort split underneath the rule -- the one place an effort's panel
 * is computed, so that two views of the same effort cannot disagree.
 */

module.exports = ({ describe, test, eq, ok, deep, mentions, load, standard, builder }) => {

  /* Warehousing, funded and part-billed, with one document from somebody who
     is not on the cost share at all. */
  function split() {
    const RPT = load();
    const b = standard(RPT);
    b.customer('FRA', 'France', 'PARTNER');          /* deliberately NOT on the table */
    b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-11-10' });
    b.doc('Warehousing', { cust: 'ITA', amount: 300000, status: 'Accepted', rcvd: '2025-11-10' });
    b.doc('Warehousing', { cust: 'ITA', amount: 120000, status: 'Received', rcvd: '2026-01-10' });
    b.doc('Warehousing', { cust: 'USA', amount: 90000, status: 'Anticipated' });
    b.doc('Warehousing', { cust: 'FRA', amount: 50000, status: 'Accepted', rcvd: '2026-01-10' });
    b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
    return { RPT, b, g: b.obj.group('DLA'), eid: b.id.effort('Warehousing') };
  }

  const row = (S, RPT, code) => S.rows.filter((r) => RPT.custCode(r.cust) === code)[0];

  describe('effort split / one effort, computed once', () => {

    test('each customer\'s requirement, funding and billing sit on one row', () => {
      const { RPT, g, eid } = split();
      const S = RPT.effortSplit(g, 2026, eid);
      const deu = row(S, RPT, 'DEU');

      eq(deu.pct, 40);
      eq(deu.requirement, 400000, '40% of the million');
      eq(deu.mipr, 400000, 'accepted funding only');
      eq(deu.invoiced, 40000);
      eq(deu.unbilled, 360000, 'accepted but not yet billed -- this customer\'s BID D');
      eq(deu.reqGap, 0, 'they have sent exactly what they owe');
    });

    test('a customer short of their requirement shows a negative gap', () => {
      const { RPT, g, eid } = split();
      const S = RPT.effortSplit(g, 2026, eid);
      const ita = row(S, RPT, 'ITA');
      eq(ita.requirement, 350000);
      eq(ita.mipr, 300000, 'only the accepted document counts');
      eq(ita.received, 120000, 'the received-but-not-accepted one is shown separately');
      eq(ita.reqGap, -50000, 'fifty thousand short of their share');
    });

    test('a customer who has sent nothing still gets a row', () => {
      const { RPT, g, eid } = split();
      const S = RPT.effortSplit(g, 2026, eid);
      const usa = row(S, RPT, 'USA');
      eq(usa.requirement, 250000);
      eq(usa.mipr, 0);
      eq(usa.anticipated, 90000);
      eq(usa.invoiced, 25000);
      eq(usa.unbilled, -25000, 'billed for money they have not yet sent -- visible, not hidden');
    });

    test('money from someone not on the table is set aside, not dropped', () => {
      const { RPT, g, eid } = split();
      const S = RPT.effortSplit(g, 2026, eid);
      eq(S.offShare.length, 1);
      eq(S.offShareTotal, 50000);
      eq(RPT.custCode(S.offShare[0].cust), 'FRA');
    });

    test('the per-row totals and the whole-effort totals count different sets', () => {
      const { RPT, g, eid } = split();
      const S = RPT.effortSplit(g, 2026, eid);
      eq(S.miprTotal, 700000, 'what landed on customers who are on the table');
      eq(S.miprAll, 750000, 'and what the effort actually holds, France included');
      eq(RPT.round2(S.miprAll - S.miprTotal), S.offShareTotal,
        'the difference is exactly the off-table money');
      eq(S.invoicedTotal, 100000);
      eq(S.invoicedAll, 100000);
    });

    test('invoice money on a customer since removed from the table is still theirs', () => {
      const { RPT, b, g, eid } = split();
      delete b.obj.share('FY26 common').lines[b.id.cust('USA')];

      const S = RPT.effortSplit(g, 2026, eid);
      eq(S.rows.length, 2, 'USA is no longer on the table');
      eq(S.offShareInvoicedTotal, 25000, 'but what they were billed has not evaporated');
      eq(S.invoicedAll, 100000, 'and the effort still shows the whole invoice');
      eq(RPT.custCode(S.offShareInvoiced[0].cust), 'USA');
    });

    test('an effort with no cost share reports everything as unattributed', () => {
      const RPT = load();
      const b = standard(RPT);
      b.effort('DLA', 2026, 'Unshared', 50000, null);
      b.doc('Unshared', { cust: 'DEU', amount: 30000, status: 'Accepted' });

      const S = RPT.effortSplit(b.obj.group('DLA'), 2026, b.id.effort('Unshared'));
      eq(S.rows.length, 0);
      eq(S.balance.empty, true);
      eq(S.miprAll, 30000, 'the money is still counted for the effort');
      eq(S.miprTotal, 0, 'it simply cannot be attributed to a row');
      eq(S.requirement, 50000);
      eq(S.requirementSplit, 0);
    });

    test('an effort that does not exist returns a shape, not a crash', () => {
      const { RPT, g } = split();
      const S = RPT.effortSplit(g, 2026, 'e_nope');
      eq(S.exists, false);
      eq(S.rows.length, 0);
      eq(S.miprAll, 0);
    });
  });

  describe('roll-ups / a group year is the sum of its efforts', () => {

    test('the year totals every effort, including unattributed money', () => {
      const { RPT, b, g } = split();
      b.doc('Transportation', { cust: 'DEU', amount: 200000, status: 'Accepted', rcvd: '2025-12-01' });
      b.invoice('DLA', 2026, 'Transportation', { total: 40000, month: '2026-02' });

      const R = RPT.yearRollup(g, 2026);
      eq(R.efforts.length, 2);
      eq(R.requirement, 1400000, 'a million plus four hundred thousand');
      eq(R.mipr, 950000, '750,000 on Warehousing and 200,000 on Transportation');
      eq(R.invoiced, 140000);
      eq(R.unbilled, 810000);
      eq(R.unattributed, 50000, 'France\'s document, surfaced at the year level');
      eq(R.invoiceCount, 2);
      eq(R.status, 'Active');
    });

    test('a year with no activity rolls up to zeroes, not to nulls', () => {
      const RPT = load();
      const b = standard(RPT);
      b.year('DLA', 2027, { status: 'Planning' });
      const R = RPT.yearRollup(b.obj.group('DLA'), 2027);
      eq(R.efforts.length, 0);
      eq(R.requirement, 0);
      eq(R.mipr, 0);
      eq(R.status, 'Planning');
    });
  });

  describe('roll-ups / years are fenced', () => {

    /* the same group, active in two years, with different money in each */
    function twoYears() {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-11-10' });
      b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });

      b.share('FY27 common', 2027, { DEU: 40, ITA: 35, USA: 25 });
      b.year('DLA', 2027, { status: 'Planning' });
      b.effort('DLA', 2027, 'Warehousing 27', 2000000, 'FY27 common');
      b.doc('Warehousing 27', { cust: 'DEU', amount: 800000, status: 'Accepted', rcvd: '2026-11-10' });
      b.invoice('DLA', 2027, 'Warehousing 27', { total: 200000, month: '2027-01' });
      return { RPT, b, g: b.obj.group('DLA') };
    }

    test('a year roll-up sees only its own year', () => {
      const { RPT, g } = twoYears();
      const y26 = RPT.yearRollup(g, 2026);
      const y27 = RPT.yearRollup(g, 2027);

      eq(y26.mipr, 400000, 'FY27 money is not FY26 money');
      eq(y26.invoiced, 100000);
      eq(y27.mipr, 800000);
      eq(y27.invoiced, 200000);
      eq(y26.requirement, 1400000, 'the two FY26 efforts');
      eq(y27.requirement, 2000000, 'and the one FY27 effort');
    });

    test('a whole-year report sees only its own year', () => {
      const { RPT } = twoYears();
      eq(RPT.fyRollup(2026).mipr, 400000);
      eq(RPT.fyRollup(2027).mipr, 800000);
      eq(RPT.fyRollup(2026).invoiceCount, 1);
    });

    test('a group\'s timeline lists its years and deliberately does not total them', () => {
      const { RPT, g } = twoYears();
      const t = RPT.groupTimeline(g);
      deep(t.map((r) => r.fy), [2026, 2027]);
      eq(t[0].mipr, 400000);
      eq(t[1].mipr, 800000);
      ok(!('total' in t), 'there is no such number as "the group\'s requirement"');
    });

    test('a year a group is not active in yields nothing at all', () => {
      const { RPT, g } = twoYears();
      eq(RPT.hasYear(g, 2030), false);
      eq(RPT.yearRollup(g, 2030).mipr, 0);
      eq(RPT.groupsFor(2030).length, 0);
      eq(RPT.fyRollup(2030).mipr, 0);
    });

    test('efforts are found only in the year they belong to', () => {
      const { RPT, b, g } = twoYears();
      const eid27 = b.id.effort('Warehousing 27');
      ok(RPT.effortById(g, 2027, eid27), 'present in its own year');
      eq(RPT.effortById(g, 2026, eid27), null, 'and invisible from another');
    });

    test('a cost share from another year is refused on an effort', () => {
      const { RPT, b, g } = twoYears();
      const errs = RPT.validateEffort(
        { name: 'Wrong year', requirement: 1000, shareId: b.id.share('FY26 common') },
        g, 2027);
      mentions(errs, 'FY26 cost share and this is FY27');
      mentions(errs, 'Carry the table forward');
    });

    test('year keys survive the round trip through JSON', () => {
      const { RPT, g } = twoYears();
      const reloaded = load();
      reloaded.adopt(JSON.parse(JSON.stringify(RPT.payload())));
      const g2 = reloaded.groupById(g.id);
      deep(reloaded.groupYears(g2), [2026, 2027], 'numbers in, numbers out');
      ok(reloaded.groupYear(g2, 2026), 'and a numeric lookup still finds a string key');
      eq(reloaded.yearRollup(g2, 2026).mipr, 400000);
    });
  });

  describe('roll-ups / the whole year', () => {

    test('customers are aggregated across every group and effort', () => {
      const { RPT, b } = split();
      b.doc('Transportation', { cust: 'DEU', amount: 200000, status: 'Accepted', rcvd: '2025-12-01' });
      b.invoice('DLA', 2026, 'Transportation', { total: 40000, month: '2026-02' });

      const F = RPT.fyRollup(2026);
      const deu = F.byCustomer.filter((c) => RPT.custCode(c.cust) === 'DEU')[0];
      eq(deu.mipr, 600000, '400,000 on one effort and 200,000 on the other');
      eq(deu.invoiced, 56000, '40% of both invoices');
      eq(deu.unbilled, 544000);
    });

    test('a customer dropped from the table keeps their billed money in the aggregate', () => {
      const { RPT, b } = split();
      delete b.obj.share('FY26 common').lines[b.id.cust('USA')];
      const F = RPT.fyRollup(2026);
      const usa = F.byCustomer.filter((c) => RPT.custCode(c.cust) === 'USA')[0];
      ok(usa, 'they must not disappear from the year');
      eq(usa.invoiced, 25000);
    });

    test('invoices accumulate into the months they cover', () => {
      const { RPT, b } = split();
      b.invoice('DLA', 2026, 'Transportation', { total: 40000, month: '2026-02' });

      const F = RPT.fyRollup(2026);
      eq(F.byMonth.length, 12);
      const jan = F.byMonth.filter((m) => m.ym === '2026-01')[0];
      const feb = F.byMonth.filter((m) => m.ym === '2026-02')[0];
      eq(jan.invoiced, 100000);
      eq(jan.cumulative, 100000);
      eq(feb.invoiced, 40000);
      eq(feb.cumulative, 140000, 'cumulative, so the trend line is a trend');
      eq(F.byMonth[11].cumulative, 140000);
      eq(F.monthNow, 8, 'and the report knows how far through the year it is');
    });

    test('every invoice in the year is listed in month order', () => {
      const { RPT, b } = split();
      b.invoice('DLA', 2026, 'Transportation', { total: 40000, month: '2025-11' });
      const list = RPT.invoicesFor(2026);
      eq(list.length, 2);
      deep(list.map((r) => r.invoice.month), ['2025-11', '2026-01'],
        'sorted by fiscal month, not by when they were entered');
    });

    test('invoice money aggregates per customer over any list', () => {
      const { RPT, b } = split();
      b.invoice('DLA', 2026, 'Transportation', { total: 40000, month: '2026-02' });
      const by = RPT.invoiceByCustomer(RPT.invoicesFor(2026));
      const deu = by.filter((r) => RPT.custCode(r.cust) === 'DEU')[0];
      eq(deu.amount, 56000);
      ok(by[0].amount >= by[by.length - 1].amount, 'largest first');
    });
  });
};
