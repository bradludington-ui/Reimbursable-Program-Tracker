'use strict';

/* The rules that refuse a record before it exists, and the mutators that create
   one once it passes. Most of these guard a UNIQUENESS or a CROSS-YEAR mistake:
   the two things that quietly corrupt a program rather than breaking it. */

module.exports = ({ describe, test, eq, ok, deep, mentions, silent, load, standard, builder }) => {

  describe('validation / customers', () => {

    test('a customer needs a name and a short code', () => {
      const RPT = load();
      mentions(RPT.validateCustomer({ code: 'DEU', kind: 'PARTNER' }), 'needs a name');
      mentions(RPT.validateCustomer({ name: 'Germany', kind: 'PARTNER' }), 'needs a short code');
      mentions(RPT.validateCustomer({ name: 'Germany', code: 'DEU' }), 'Pick a customer type');
      silent(RPT.validateCustomer({ name: 'Germany', code: 'DEU', kind: 'PARTNER' }));
    });

    test('two customers may not share a code, whatever the casing', () => {
      const RPT = load();
      const b = builder(RPT);
      b.customer('DEU', 'Germany');
      mentions(RPT.validateCustomer({ name: 'Denmark', code: 'deu', kind: 'PARTNER' }),
        'already uses the code DEU');
    });

    test('a customer being edited does not collide with itself', () => {
      const RPT = load();
      const b = builder(RPT);
      const c = b.customer('DEU', 'Germany');
      silent(RPT.validateCustomer({ name: 'Germany', code: 'DEU', kind: 'PARTNER' }, c.id));
    });

    test('codes are stored upper-cased however they were typed', () => {
      const RPT = load();
      eq(RPT.addCustomer({ code: ' deu ', name: 'Germany', kind: 'PARTNER' }).code, 'DEU');
    });
  });

  describe('validation / cost shares', () => {

    test('a cost share needs a name, a year and a basis', () => {
      const RPT = load();
      mentions(RPT.validateShare({ fy: 2026, basis: 'pct' }), 'needs a name');
      mentions(RPT.validateShare({ name: 'common', basis: 'pct' }), 'belongs to one fiscal year');
      mentions(RPT.validateShare({ name: 'common', fy: 2026, basis: 'other' }),
        'percentages or as driver quantities');
    });

    test('a quantity table must say what it is counting', () => {
      const RPT = load();
      mentions(RPT.validateShare({ name: 'fleet', fy: 2026, basis: 'qty' }), 'Name the driver');
      silent(RPT.validateShare({ name: 'fleet', fy: 2026, basis: 'qty', driver: 'aircraft' }));
    });

    test('two tables in the same year may not share a name', () => {
      const RPT = load();
      const b = builder(RPT);
      b.customer('DEU', 'Germany');
      b.share('common', 2026, { DEU: 100 });
      mentions(RPT.validateShare({ name: 'Common', fy: 2026, basis: 'pct' }),
        'already has that name');
    });

    test('but the same name in a different year is exactly how a table carries forward', () => {
      const RPT = load();
      const b = builder(RPT);
      b.customer('DEU', 'Germany');
      b.share('common', 2026, { DEU: 100 });
      silent(RPT.validateShare({ name: 'common', fy: 2027, basis: 'pct' }));
    });

    test('carrying a table forward copies its lines, not a reference to them', () => {
      const RPT = load();
      const b = builder(RPT);
      b.customer('DEU', 'Germany');
      b.customer('ITA', 'Italy');
      const src = b.share('common', 2026, { DEU: 60, ITA: 40 });

      const copy = RPT.carryShare(src.id, 2027);
      eq(copy.fy, 2027);
      eq(copy.name, 'common');
      mentions([copy.source], 'Carried forward from FY26');

      copy.lines[b.id.cust('DEU')] = 90;
      eq(src.lines[b.id.cust('DEU')], 60, 'editing next year must not move this year');
    });

    test('carrying a table that no longer exists returns nothing', () => {
      const RPT = load();
      eq(RPT.carryShare('s_gone', 2027), null);
    });
  });

  describe('validation / groups, years and efforts', () => {

    test('a group code is unique across the whole program, because a group spans years', () => {
      const RPT = load();
      const b = builder(RPT);
      b.group('DLA', 'Logistics');
      const errs = RPT.validateGroup({ name: 'Other', code: 'dla' });
      mentions(errs, 'already uses the code DLA');
      mentions(errs, 'unique across the whole program');
    });

    test('a year is started deliberately and only once', () => {
      const RPT = load();
      const b = builder(RPT);
      const g = b.group('DLA', 'Logistics');
      b.year('DLA', 2026, { status: 'Active' });
      mentions(RPT.validateYear({ status: 'Active' }, 2026, g.id), 'already has FY26 activity');
      mentions(RPT.validateYear({ status: 'Nope' }, 2027, g.id), 'Pick a status');
      silent(RPT.validateYear({ status: 'Planning' }, 2027, g.id));
    });

    test('starting a year that exists returns it rather than replacing it', () => {
      const RPT = load();
      const b = builder(RPT);
      const g = b.group('DLA', 'Logistics');
      b.year('DLA', 2026, { status: 'Active' });
      const again = RPT.startYear(g, 2026, { status: 'Planning' });
      eq(again.status, 'Active', 'the year that was there is the year you get back');
    });

    test('a group is never given a year as a side effect of being looked at', () => {
      const RPT = load();
      const b = builder(RPT);
      const g = b.group('DLA', 'Logistics');
      RPT.yearRollup(g, 2030);
      RPT.efforts(g, 2030);
      RPT.groupYear(g, 2030);
      deep(RPT.groupYears(g), [], 'an empty year record would claim the group is active');
    });

    test('an effort needs a name, and two in one year may not share one', () => {
      const RPT = load();
      const b = standard(RPT);
      const g = b.obj.group('DLA');
      mentions(RPT.validateEffort({ requirement: 0 }, g, 2026), 'An effort needs a name');
      mentions(RPT.validateEffort({ name: 'warehousing', requirement: 0 }, g, 2026),
        'already has an effort called');
      silent(RPT.validateEffort({ name: 'DEMIL', requirement: 0 }, g, 2026));
    });

    test('a requirement may be zero but never negative or unreadable', () => {
      const RPT = load();
      const b = standard(RPT);
      const g = b.obj.group('DLA');
      silent(RPT.validateEffort({ name: 'DEMIL', requirement: 0 }, g, 2026),
        '0 is fine if it is not costed yet');
      mentions(RPT.validateEffort({ name: 'DEMIL', requirement: -1 }, g, 2026),
        'cannot be negative');
      mentions(RPT.validateEffort({ name: 'DEMIL', requirement: 'some' }, g, 2026),
        'Enter the total requirement');
    });

    test('an effort may not point at a cost share that is gone', () => {
      const RPT = load();
      const b = standard(RPT);
      mentions(RPT.validateEffort({ name: 'DEMIL', requirement: 0, shareId: 's_gone' },
        b.obj.group('DLA'), 2026), 'no longer exists');
    });

    test('removing an effort leaves the rest of the year alone', () => {
      const RPT = load();
      const b = standard(RPT);
      const g = b.obj.group('DLA');
      RPT.removeEffort(g, 2026, b.id.effort('Warehousing'));
      eq(RPT.efforts(g, 2026).length, 1);
      eq(RPT.efforts(g, 2026)[0].name, 'Transportation');
    });

    test('efforts of a year that does not exist is an empty list, not a throw', () => {
      const RPT = load();
      const b = standard(RPT);
      deep(RPT.efforts(b.obj.group('DLA'), 2099), []);
      eq(RPT.effortById(b.obj.group('DLA'), 2099, 'e1'), null);
    });
  });

  describe('validation / what deleting something would break', () => {

    test('a customer reports every table, document and invoice that names them', () => {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted' });
      b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });

      const refs = RPT.customerRefs(b.id.cust('DEU'));
      mentions(refs, 'cost share');
      mentions(refs, 'funding document');
      mentions(refs, 'invoice');
      mentions(refs, 'FY26');
    });

    test('a customer nobody references reports nothing', () => {
      const RPT = load();
      const b = standard(RPT);
      b.customer('FRA', 'France');
      deep(RPT.customerRefs(b.id.cust('FRA')), []);
    });

    test('a cost share reports the efforts using it and what was raised on them', () => {
      const RPT = load();
      const b = standard(RPT);
      b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });

      const refs = RPT.shareRefs(b.id.share('FY26 common'));
      eq(refs.length, 2, 'both efforts are on the table');
      mentions(refs, '1 invoice raised on it');
    });

    test('deleting a customer leaves the history readable', () => {
      const RPT = load();
      const b = standard(RPT);
      const deu = b.id.cust('DEU');
      const inv = b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' }).invoice;
      RPT.removeCustomer(deu);

      eq(inv.lines[deu], 40000, 'the invoice still records what it billed');
      mentions([RPT.custName(deu)], 'missing customer', 'and the name renders as a placeholder');
    });
  });

  describe('validation / rolling a year forward', () => {

    function rolled(opts) {
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-11-10' });
      b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
      const y = RPT.rollYear(b.obj.group('DLA').id, 2026, 2027, opts);
      return { RPT, b, g: b.obj.group('DLA'), y };
    }

    test('it copies the shape of the year: the efforts and their requirements', () => {
      const { RPT, g } = rolled();
      const es = RPT.efforts(g, 2027);
      deep(es.map((e) => e.name), ['Warehousing', 'Transportation']);
      deep(es.map((e) => e.requirement), [1000000, 400000]);
      eq(RPT.groupYear(g, 2027).status, 'Planning', 'a new year starts as planning');
    });

    test('it copies no money at all', () => {
      const { RPT, g } = rolled();
      const es = RPT.efforts(g, 2027);
      deep(es.map((e) => e.docs.length), [0, 0], 'funding belongs to the year it was raised in');
      deep(es.map((e) => e.invoices.length), [0, 0]);
      eq(RPT.yearRollup(g, 2027).mipr, 0);
      eq(RPT.yearRollup(g, 2026).mipr, 400000, 'and the year it came from is untouched');
    });

    test('requirements can be left out when next year is not costed yet', () => {
      const { RPT, g } = rolled({ copyRequirements: false });
      deep(RPT.efforts(g, 2027).map((e) => e.requirement), [0, 0]);
    });

    test('an effort points at next year\'s table only if one by that name exists', () => {
      const { RPT, g } = rolled();
      deep(RPT.efforts(g, 2027).map((e) => e.shareId), ['', ''],
        'pointing back at FY26\'s ratio is the mistake validateEffort refuses');
    });

    test('carrying the tables forward wires the new efforts up to them', () => {
      const { RPT, b, g } = rolled({ carryShares: true });
      const es = RPT.efforts(g, 2027);
      ok(es[0].shareId, 'the effort has a table');
      const sh = RPT.shareById(es[0].shareId);
      eq(sh.fy, 2027, 'and it is a FY27 table');
      eq(sh.name, 'FY26 common', 'carried forward under the same name');
      silent(RPT.validateEffort({ name: 'X', requirement: 0, shareId: es[0].shareId }, g, 2027));
      eq(es[0].shareId, es[1].shareId, 'both efforts share the one carried table');
    });

    test('an existing table of the same name is reused rather than duplicated', () => {
      const RPT = load();
      const b = standard(RPT);
      /* a FY27 table already carrying the same name, with different ratios */
      const next = b.share('FY26 common', 2027, { DEU: 50, ITA: 30, USA: 20 });
      RPT.rollYear(b.obj.group('DLA').id, 2026, 2027, { carryShares: true });

      eq(RPT.sharesFor(2027).length, 1, 'no second copy of a table that already exists');
      deep(RPT.efforts(b.obj.group('DLA'), 2027).map((e) => e.shareId), [next.id, next.id],
        'both new efforts point at the table that was already there');
    });

    test('a year that already exists is refused rather than merged', () => {
      const { RPT, b, g } = rolled();
      eq(RPT.rollYear(g.id, 2026, 2027), null);
      eq(RPT.efforts(g, 2027).length, 2, 'and nothing is added twice');
    });

    test('rolling every group skips the archived and the already-rolled', () => {
      const RPT = load();
      const b = standard(RPT);
      b.group('OLD', 'Archived thing', { retired: true });
      b.year('OLD', 2026, { status: 'Closed' });
      b.group('DONE', 'Already rolled');
      b.year('DONE', 2026, { status: 'Active' });
      b.year('DONE', 2027, { status: 'Planning' });

      const r = RPT.rollYearAll(2026, 2027);
      deep(r.done.map((g) => g.code), ['DLA']);
      deep(r.skipped.map((s) => s.g.code).sort(), ['DONE', 'OLD']);
      mentions(r.skipped.map((s) => s.why), 'archived');
      mentions(r.skipped.map((s) => s.why), 'already has FY27');
    });
  });

  describe('validation / listing what a year holds', () => {

    test('groups are listed for the years they are active in, by code', () => {
      const RPT = load();
      const b = standard(RPT);
      b.group('AAA', 'Another');
      b.year('AAA', 2026, { status: 'Active' });
      deep(RPT.groupsFor(2026).map((g) => g.code), ['AAA', 'DLA']);
      deep(RPT.groupsFor(2027).map((g) => g.code), []);
    });

    test('groups idle in a year are listed with the archived ones last', () => {
      const RPT = load();
      const b = standard(RPT);
      b.group('ZZZ', 'Idle');
      b.group('OLD', 'Archived', { retired: true });
      deep(RPT.groupsIdle(2026).map((g) => g.code), ['ZZZ', 'OLD']);
    });

    test('the year list covers the years anything actually refers to', () => {
      const RPT = load();
      const b = standard(RPT);
      b.share('FY30 table', 2030, { DEU: 100 });
      const list = RPT.fyList();
      ok(list.indexOf(2025) >= 0 && list.indexOf(2026) >= 0 && list.indexOf(2027) >= 0,
        'last year, this year and next, from the frozen clock');
      ok(list.indexOf(2030) >= 0, 'plus any year a share or a group year names');
      deep(list, list.slice().sort((a, c) => a - c), 'in order');
    });
  });
};
