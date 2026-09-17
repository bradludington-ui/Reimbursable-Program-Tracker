'use strict';

/* All three reports read the SAME facts, so a figure can never differ between
 * two reports that claim to show the same thing.
 *
 * The load-bearing part of that promise is the REMAINDER row in RPT.facts:
 * money can sit outside every customer row (no cost share, an unbalanced table,
 * a document naming someone who is not on it), the roll-ups count it, and if
 * the fact table did not, an ad-hoc report and the executive summary would
 * disagree about the same year.
 */

module.exports = ({ describe, test, eq, ok, deep, mentions, load, standard, builder }) => {

  function program() {
    const RPT = load();
    const b = standard(RPT);
    b.customer('FRA', 'France', 'PARTNER');          /* not on the table */
    b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-11-10' });
    b.doc('Warehousing', { cust: 'ITA', amount: 300000, status: 'Accepted', rcvd: '2025-11-10' });
    b.doc('Warehousing', { cust: 'FRA', amount: 50000, status: 'Accepted', rcvd: '2026-01-10' });
    b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
    b.invoice('DLA', 2026, 'Transportation', { total: 40000, month: '2025-11' });
    return { RPT, b, g: b.obj.group('DLA') };
  }

  const forEffort = (facts, name) => facts.filter((f) => f.effort === name);
  const sum = (rows, k) => Math.round(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0) * 100) / 100;

  describe('reports / the fact table accounts for every dollar', () => {

    test('one row per customer on the effort\'s table', () => {
      const { RPT } = program();
      const w = forEffort(RPT.facts(2026), 'Warehousing');
      const named = w.filter((f) => f.custId);
      deep(named.map((f) => f.cust), ['DEU', 'ITA', 'USA']);
      eq(named.filter((f) => f.cust === 'DEU')[0].mipr, 400000);
      eq(named.filter((f) => f.cust === 'DEU')[0].pct, 40);
    });

    test('money outside every row appears as its own remainder row', () => {
      const { RPT } = program();
      const w = forEffort(RPT.facts(2026), 'Warehousing');
      const rem = w.filter((f) => !f.custId)[0];
      ok(rem, 'France\'s document has to land somewhere');
      eq(rem.cust, '(unattributed)');
      eq(rem.mipr, 50000);
      eq(rem.unbilled, 50000);
    });

    test('the facts for an effort add back to that effort\'s own totals', () => {
      /* this is the whole promise, asserted directly */
      const { RPT, g } = program();
      ['Warehousing', 'Transportation'].forEach((name) => {
        const facts = forEffort(RPT.facts(2026), name);
        const eid = facts[0].effortId;
        const S = RPT.effortSplit(g, 2026, eid);
        eq(sum(facts, 'requirement'), S.requirement, `${name}: requirement`);
        eq(sum(facts, 'mipr'), S.miprAll, `${name}: MIPRs accepted`);
        eq(sum(facts, 'invoiced'), S.invoicedAll, `${name}: invoiced`);
        eq(sum(facts, 'received'), S.receivedAll, `${name}: received`);
        eq(sum(facts, 'anticipated'), S.anticipatedAll, `${name}: anticipated`);
      });
    });

    test('and the whole fact table adds back to the executive summary', () => {
      const { RPT } = program();
      const facts = RPT.facts(2026);
      const F = RPT.fyRollup(2026);
      eq(sum(facts, 'requirement'), F.requirement, 'requirement');
      eq(sum(facts, 'mipr'), F.mipr, 'MIPRs accepted');
      eq(sum(facts, 'invoiced'), F.invoiced, 'invoiced');
      eq(sum(facts, 'unbilled'), F.unbilled, 'unbilled');
    });

    test('an unbalanced table leaves its shortfall in the remainder row', () => {
      const RPT = load();
      const b = standard(RPT);
      b.obj.share('FY26 common').lines[b.id.cust('USA')] = 22;   /* 97% */
      const w = forEffort(RPT.facts(2026), 'Warehousing');
      const rem = w.filter((f) => !f.custId)[0];
      eq(rem.requirement, 30000, 'the 3% of a million that lands on nobody');

      const S = RPT.effortSplit(b.obj.group('DLA'), 2026, b.id.effort('Warehousing'));
      eq(sum(w, 'requirement'), S.requirement, 'and the effort still adds up');
    });

    test('an effort with no table at all says so on the row', () => {
      const RPT = load();
      const b = standard(RPT);
      b.effort('DLA', 2026, 'Unshared', 50000, null);
      b.doc('Unshared', { cust: 'DEU', amount: 30000, status: 'Accepted' });

      const rows = forEffort(RPT.facts(2026), 'Unshared');
      eq(rows.length, 1);
      eq(rows[0].cust, '(no cost share)', 'a different cause, named differently');
      eq(rows[0].mipr, 30000);
      eq(rows[0].requirement, 50000);
    });

    test('an effort with nothing out of place produces no remainder row', () => {
      const { RPT } = program();
      const t = forEffort(RPT.facts(2026), 'Transportation');
      eq(t.filter((f) => !f.custId).length, 0, 'no empty row for a tidy effort');
    });

    test('every fact row carries the context a report groups by', () => {
      const { RPT, b } = program();
      const f = forEffort(RPT.facts(2026), 'Warehousing')[0];
      eq(f.group, 'DLA');
      eq(f.fy, 2026);
      eq(f.status, 'Active');
      eq(f.share, 'FY26 common');
      eq(f.effortId, b.id.effort('Warehousing'));
    });

    test('monthly facts exist only for invoices, which are the only dated money', () => {
      const { RPT } = program();
      const m = RPT.monthFacts(2026);
      eq(m.length, 6, 'three customers on each of two invoices');
      deep([...new Set(m.map((r) => r.month))].sort(), ['2025-11', '2026-01']);
      eq(sum(m, 'invoiced'), 140000, 'and they add to what was billed in the year');
    });
  });

  describe('reports / the ad-hoc builder', () => {

    test('it groups by whatever dimension is asked for', () => {
      const { RPT } = program();
      const r = RPT.adhoc({ fy: 2026, dims: ['cust'], measures: ['mipr'] });
      const deu = r.rows.filter((b) => b.keys[0] === 'DEU')[0];
      eq(deu.v.mipr, 400000);
      eq(r.totals.mipr, 750000, 'and the total is the year\'s, France included');
    });

    test('its totals match the executive summary for the same year', () => {
      const { RPT } = program();
      const F = RPT.fyRollup(2026);
      const r = RPT.adhoc({ fy: 2026, dims: ['group'], measures: ['requirement', 'mipr', 'invoiced'] });
      eq(r.totals.requirement, F.requirement);
      eq(r.totals.mipr, F.mipr);
      eq(r.totals.invoiced, F.invoiced);
    });

    test('grouping by month narrows the measures to the ones that have a month', () => {
      const { RPT } = program();
      const r = RPT.adhoc({ fy: 2026, dims: ['month'], measures: ['requirement', 'mipr', 'invoiced'] });
      eq(r.monthly, true);
      deep(r.measures.map((m) => m.k), ['invoiced'],
        'a requirement has no month; repeating it twelve times would be worse than omitting it');
      mentions([r.note], 'only invoiced money is available');
    });

    test('months sort by the fiscal calendar, not the alphabet', () => {
      const { RPT } = program();
      const r = RPT.adhoc({ fy: 2026, dims: ['month'], measures: ['invoiced'] });
      deep(r.rows.map((b) => b.keys[0]), ['Nov 2025', 'Jan 2026'],
        'alphabetically Jan would come first, and that is not a year');
    });

    test('a dimension value containing a separator does not merge two rows', () => {
      const RPT = load();
      const b = builder(RPT);
      b.customer('DEU', 'Germany');
      b.share('common', 2026, { DEU: 100 });
      b.group('A|B', 'Pipe in the code');
      b.year('A|B', 2026);
      b.effort('A|B', 2026, 'X', 1000, 'common');
      b.group('A', 'Plain');
      b.year('A', 2026);
      b.effort('A', 2026, 'B|X', 2000, 'common');

      const r = RPT.adhoc({ fy: 2026, dims: ['group', 'effort'], measures: ['requirement'] });
      eq(r.rows.length, 2, 'keyed as JSON, so "A|B"+"X" and "A"+"B|X" stay apart');
      eq(r.totals.requirement, 3000);
    });

    test('filters narrow the source rows', () => {
      const { RPT, b } = program();
      const r = RPT.adhoc({
        fy: 2026, dims: ['cust'], measures: ['mipr'],
        filters: { effort: b.id.effort('Warehousing') }
      });
      eq(r.totals.mipr, 750000, 'Warehousing only');

      const byCust = RPT.adhoc({
        fy: 2026, dims: ['group'], measures: ['mipr'],
        filters: { cust: b.id.cust('DEU') }
      });
      eq(byCust.totals.mipr, 400000);
    });

    test('it falls back to something sensible rather than returning nothing', () => {
      const { RPT } = program();
      const r = RPT.adhoc({ fy: 2026 });
      deep(r.dims.map((d) => d.k), ['group'], 'a default dimension');
      deep(r.measures.map((m) => m.k), ['requirement', 'mipr', 'invoiced'], 'and default measures');

      const bogus = RPT.adhoc({ fy: 2026, dims: ['nonsense'], measures: ['nonsense'] });
      deep(bogus.dims.map((d) => d.k), ['group'], 'an unknown dimension is dropped, not obeyed');
    });

    test('sorting by a measure puts the biggest first', () => {
      const { RPT } = program();
      const r = RPT.adhoc({ fy: 2026, dims: ['cust'], measures: ['mipr'], sort: 'mipr' });
      const vals = r.rows.map((b) => b.v.mipr);
      deep(vals, vals.slice().sort((a, c) => c - a));
    });

    test('a year with nothing in it produces an empty report, not an error', () => {
      const { RPT } = program();
      const r = RPT.adhoc({ fy: 2035, dims: ['group'], measures: ['mipr'] });
      eq(r.rows.length, 0);
      eq(r.totals.mipr, 0);
    });
  });
};
