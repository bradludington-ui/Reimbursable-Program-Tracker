'use strict';

/* Rule 3: AN INVOICE IS A RECORD, NOT A VIEW.
 *
 * Its per-customer lines are snapshotted when it is raised, and later edits to
 * the cost share never rewrite them. Changing the ratio in March cannot be
 * allowed to change what January's invoice said, because January's invoice was
 * sent to somebody.
 */

module.exports = ({ describe, test, eq, ok, near, deep, mentions, silent, load, standard }) => {

  /* the standard fixture, plus one invoice already raised */
  function billed(opts) {
    const RPT = load(opts);
    const b = standard(RPT);
    const g = b.obj.group('DLA');
    const eid = b.id.effort('Warehousing');
    const r = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
    return { RPT, b, g, eid, inv: r.invoice, raised: r };
  }

  describe('invoices / raising one', () => {

    test('the total lands on the customers in the table\'s proportions', () => {
      const { RPT, inv } = billed();
      const rows = RPT.invoiceRows(inv);
      deep(rows.map((r) => RPT.custCode(r.cust)), ['DEU', 'ITA', 'USA']);
      deep(rows.map((r) => r.amount), [40000, 35000, 25000]);
      eq(rows.reduce((t, r) => t + r.amount, 0), 100000, 'every cent lands somewhere');
    });

    test('the percentages and the table\'s name are snapshotted with it', () => {
      const { b, inv } = billed();
      eq(inv.shareName, 'FY26 common');
      eq(inv.shareId, b.id.share('FY26 common'));
      eq(inv.pct[b.id.cust('DEU')], 40, 'the ratio used, recorded on the invoice itself');
      deep(inv.coll, [], 'raised means billed-uncollected; it is not collected yet');
      ok(inv.raised, 'and it records the day it was raised');
    });

    test('it is added to the effort it was raised against', () => {
      const { RPT, b, g, eid } = billed();
      eq(RPT.effortById(g, 2026, eid).invoices.length, 1);
      eq(RPT.effortById(g, 2026, b.id.effort('Transportation')).invoices.length, 0,
        'and to no other effort');
    });
  });

  describe('invoices / what raising one refuses', () => {

    test('an effort with no cost share attached', () => {
      const RPT = load();
      const b = standard(RPT);
      b.effort('DLA', 2026, 'Unshared', 50000, null);
      const r = b.invoice('DLA', 2026, 'Unshared', { total: 1000, month: '2026-01' });
      eq(r.ok, false);
      mentions(r.why, 'no cost share attached');
    });

    test('a table that does not total 100%', () => {
      const RPT = load();
      const b = standard(RPT);
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('USA')] = 22;          /* 40 + 35 + 22 = 97 */
      const r = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
      eq(r.ok, false);
      mentions(r.why, 'not 100%');
      mentions(r.why, 'every cent of it has to land on a customer');
    });

    test('a table with nobody on it', () => {
      const RPT = load();
      const b = standard(RPT);
      b.obj.share('FY26 common').lines = {};
      const r = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
      eq(r.ok, false);
      mentions(r.why, 'no customers on it');
    });

    test('a missing, unreadable or negative total', () => {
      const RPT = load();
      const b = standard(RPT);
      mentions(b.invoice('DLA', 2026, 'Warehousing', { month: '2026-01' }).why,
        'Enter the invoice total');
      mentions(b.invoice('DLA', 2026, 'Warehousing', { total: 'lots', month: '2026-01' }).why,
        'Enter the invoice total');
      mentions(b.invoice('DLA', 2026, 'Warehousing', { total: -5, month: '2026-01' }).why,
        'cannot be for a negative amount');
    });

    test('a month that is not in the year being billed', () => {
      const RPT = load();
      const b = standard(RPT);
      mentions(b.invoice('DLA', 2026, 'Warehousing', { total: 1000 }).why,
        'Assign the invoice to a month');
      const r = b.invoice('DLA', 2026, 'Warehousing', { total: 1000, month: '2026-10' });
      eq(r.ok, false);
      mentions(r.why, 'is not in FY26');
      mentions(r.why, 'Oct 2025', 'and says what the year actually runs');
      mentions(r.why, 'Sep 2026');
    });

    test('nothing is written when it refuses', () => {
      const RPT = load();
      const b = standard(RPT);
      b.invoice('DLA', 2026, 'Warehousing', { total: -5, month: '2026-01' });
      eq(RPT.effortById(b.obj.group('DLA'), 2026, b.id.effort('Warehousing')).invoices.length, 0,
        'a refused invoice must leave no trace');
    });

    test('an effort that has since been deleted', () => {
      const RPT = load();
      const b = standard(RPT);
      const g = b.obj.group('DLA');
      const eid = b.id.effort('Warehousing');
      RPT.removeEffort(g, 2026, eid);
      const r = RPT.raiseInvoice(g, 2026, eid, { total: 1000, month: '2026-01' });
      eq(r.ok, false);
      mentions(r.why, 'no longer exists');
    });
  });

  describe('invoices / the record does not move when the table does', () => {

    test('editing the cost share leaves the raised invoice untouched', () => {
      const { RPT, b, inv } = billed();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 50;
      sh.lines[b.id.cust('ITA')] = 30;
      sh.lines[b.id.cust('USA')] = 20;

      eq(inv.lines[b.id.cust('DEU')], 40000, 'January still says what January said');
      eq(inv.pct[b.id.cust('DEU')], 40, 'including the ratio it was raised on');
      eq(RPT.invoiceTotal([inv]), 100000);
    });

    test('the rows the invoice panel renders come from the snapshot too', () => {
      /* reading inv.lines in a test proves less than it looks: the panel renders
         through invoiceRows, and that is the function a "simplification" would
         quietly point back at the live table */
      const { RPT, b, inv } = billed();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 50;
      sh.lines[b.id.cust('ITA')] = 30;
      sh.lines[b.id.cust('USA')] = 20;

      const rows = RPT.invoiceRows(inv);
      deep(rows.map((r) => r.amount), [40000, 35000, 25000], 'what was billed, not what would be');
      deep(rows.map((r) => r.pct), [40, 35, 25], 'at the ratio it was billed on');
      deep(RPT.invoiceByCustomer([inv]).map((r) => r.amount), [40000, 35000, 25000],
        'and the same from the aggregate');
    });

    test('a customer dropped from the table still appears on the invoice that billed them', () => {
      const { RPT, b, inv } = billed();
      delete b.obj.share('FY26 common').lines[b.id.cust('USA')];
      const rows = RPT.invoiceRows(inv);
      eq(rows.length, 3, 'an invoice lists who it billed, not who is on the table today');
      eq(rows.filter((r) => RPT.custCode(r.cust) === 'USA')[0].amount, 25000);
    });

    test('but the tool notices the table has moved', () => {
      const { RPT, b, inv } = billed();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 50;
      sh.lines[b.id.cust('ITA')] = 30;
      sh.lines[b.id.cust('USA')] = 20;

      const st = RPT.invoiceStale(inv);
      eq(st.stale, true);
      eq(st.diff.length, 3, 'all three ratios changed');
      mentions([st.why], 'has changed for 3 customers');
    });

    test('a table edited and edited back is not stale', () => {
      const { RPT, b, inv } = billed();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 50;
      eq(RPT.invoiceStale(inv).stale, true);
      sh.lines[b.id.cust('DEU')] = 40;
      eq(RPT.invoiceStale(inv).stale, false,
        'staleness compares the snapshot, not the history of edits');
    });

    test('a deleted cost share makes every invoice raised on it stale', () => {
      const { RPT, b, inv } = billed();
      RPT.removeShare(b.id.share('FY26 common'));
      const st = RPT.invoiceStale(inv);
      eq(st.stale, true);
      mentions([st.why], 'no longer exists');
    });

    test('recomputing is the owner\'s deliberate act, and then it moves', () => {
      const { RPT, b, inv } = billed();
      const sh = b.obj.share('FY26 common');
      sh.lines[b.id.cust('DEU')] = 50;
      sh.lines[b.id.cust('ITA')] = 30;
      sh.lines[b.id.cust('USA')] = 20;

      eq(RPT.recomputeInvoice(inv), true);
      eq(inv.lines[b.id.cust('DEU')], 50000);
      eq(inv.pct[b.id.cust('DEU')], 50);
      eq(inv.total, 100000, 'the total billed never changes -- only how it is attributed');
      ok(inv.recomputed, 'and the invoice records that it was re-snapshotted');
      eq(RPT.invoiceStale(inv).stale, false);
    });

    test('recomputing refuses onto an unbalanced table', () => {
      const { RPT, b, inv } = billed();
      b.obj.share('FY26 common').lines[b.id.cust('USA')] = 22;   /* 97% */
      eq(RPT.recomputeInvoice(inv), false, 'the same rule that refuses to raise one');
      eq(inv.lines[b.id.cust('DEU')], 40000, 'and it is left exactly as it was');
    });

    test('recomputing refuses when the table is gone', () => {
      const { RPT, b, inv } = billed();
      RPT.removeShare(b.id.share('FY26 common'));
      eq(RPT.recomputeInvoice(inv), false);
    });
  });

  describe('invoices / funding documents are worth base plus amendments', () => {

    test('docNet is the base until something amends it', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 400000, no: 'MIPR-1' });
      eq(RPT.docNet(d), 400000);
      eq(RPT.docAmended(d), 0);
    });

    test('an increase and a return of excess both land in the same ledger', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 400000, no: 'MIPR-1' });
      b.amend(d, { amount: 100000, kind: 'Increase', date: '2026-02-01' });
      b.amend(d, { amount: -50000, kind: 'Return of excess', date: '2026-09-01' });

      eq(RPT.docAmended(d), 50000);
      eq(RPT.docNet(d), 450000, 'base plus every amendment, never the base alone');
      eq(d.amount, 400000, 'and the base itself is left intact to reconcile against');
      eq(d.amends.length, 2, 'kept as a ledger, not folded away');
    });

    test('an amendment may not take a document below zero', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 400000, no: 'MIPR-1' });
      b.amend(d, { amount: -100000, kind: 'Decrease', date: '2026-02-01' });

      const errs = RPT.validateAmend(d, { amount: -400000, kind: 'Decrease' });
      mentions(errs, 'cannot go below zero');
      mentions(errs, '$300,000', 'and says the most that can come back');
      silent(RPT.validateAmend(d, { amount: -300000, kind: 'Decrease' }),
        'taking it to exactly zero is allowed');
    });

    test('an amendment of nothing records nothing', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 400000 });
      mentions(RPT.validateAmend(d, { amount: 0, kind: 'Increase' }), 'records nothing');
      mentions(RPT.validateAmend(d, { amount: 'oops', kind: 'Increase' }), 'Enter the amendment amount');
      mentions(RPT.validateAmend(d, { amount: 100, kind: 'Sideways' }), 'Pick what kind');
    });

    test('an amendment being edited does not count itself twice', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 100000 });
      const a = b.amend(d, { amount: -90000, kind: 'Decrease' });
      silent(RPT.validateAmend(d, { amount: -100000, kind: 'Decrease' }, a.id),
        'editing that same amendment to -100,000 is fine; it replaces, not adds');
    });

    test('removing an amendment restores the document\'s value', () => {
      const RPT = load();
      const b = standard(RPT);
      const d = b.doc('Warehousing', { cust: 'DEU', amount: 400000 });
      const a = b.amend(d, { amount: -50000, kind: 'Decrease' });
      eq(RPT.docNet(d), 350000);
      RPT.removeAmend(d, a.id);
      eq(RPT.docNet(d), 400000);
    });

    test('only accepted money counts as funded', () => {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted' });
      b.doc('Warehousing', { cust: 'ITA', amount: 300000, status: 'Received' });
      b.doc('Warehousing', { cust: 'USA', amount: 200000, status: 'Anticipated' });
      b.doc('Warehousing', { cust: 'USA', amount: 999999, status: 'Rejected' });

      const docs = b.obj.effort('Warehousing').docs;
      eq(RPT.docMoney(docs, 'Accepted'), 400000);
      eq(RPT.docMoney(docs, 'Received'), 300000);
      eq(RPT.docMoney(docs, 'Anticipated'), 200000);
    });
  });
};
