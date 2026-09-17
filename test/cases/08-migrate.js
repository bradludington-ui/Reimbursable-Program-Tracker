'use strict';

/* Every read goes through RPT.migrate, so a file written by an older build
 * loads without the rest of the code having to know what changed. These tests
 * feed it genuinely old shapes -- the ones the migration comments describe --
 * and check that nothing is discarded and nothing is invented.
 *
 * The schema ladder:
 *   1  a group WAS a fiscal year
 *   2  a group spans years; each year carries pool + share + documents
 *   3  each year carries EFFORTS, each with its own share and money
 *   4  documents carry AMENDMENTS; a group year can carry an up-front position
 *   5  the up-front position belongs to the EFFORT, not the group year
 *   6  invoices carry COLLECTIONS; a D&O MORD is a monthly position
 *   7  billing setup, posting rules, form definitions, voucher numbers
 */

module.exports = ({ describe, test, todo, eq, ok, deep, load }) => {

  const adopt = (RPT, file) => { RPT.adopt(JSON.parse(JSON.stringify(file))); return RPT.state; };
  const year = (s, gi, fy) => s.groups[gi].years[String(fy)];

  describe('migration / a group used to be a fiscal year', () => {

    test('a v1 group becomes a group with exactly the one year it was', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 1,
        groups: [{
          id: 'g1', code: 'DLA', name: 'Logistics',
          fy: 2024, pool: 500000, shareId: 's1', status: 'Closing',
          docs: [{ id: 'd1', cust: 'c1', amount: 200000, status: 'Accepted' }]
        }]
      });
      const g = s.groups[0];
      deep(RPT.groupYears(g), [2024]);
      eq(year(s, 0, 2024).status, 'Closing', 'the status it had is the year\'s status');
      ok(!('fy' in g) && !('pool' in g), 'the year-shaped fields are gone from the group');
    });

    test('everything it held becomes a single effort called General', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 1,
        groups: [{
          id: 'g1', code: 'DLA', name: 'Logistics', fy: 2024,
          pool: 500000, shareId: 's1',
          docs: [{ id: 'd1', cust: 'c1', amount: 200000, status: 'Accepted' }]
        }]
      });
      const efforts = year(s, 0, 2024).efforts;
      eq(efforts.length, 1);
      eq(efforts[0].name, 'General');
      eq(efforts[0].code, 'GEN');
      eq(efforts[0].requirement, 500000, 'the pool becomes the requirement');
      eq(efforts[0].shareId, 's1', 'pointing at the same table');
      eq(efforts[0].docs.length, 1, 'and holding the same documents');
    });

    test('a year that held nothing gets no effort at all', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 2,
        groups: [{
          id: 'g1', code: 'DLA', name: 'Logistics',
          years: { '2024': { status: 'Planning', pool: 0, docs: [] } }
        }]
      });
      deep(year(s, 0, 2024).efforts, [],
        'an empty "General" nobody created would be a statement about the program');
    });

    test('a v1 group with no year of its own falls back to the current one', () => {
      const RPT = load();   /* clock frozen mid-FY2026 */
      const s = adopt(RPT, {
        v: 1,
        groups: [{ id: 'g1', code: 'DLA', name: 'Logistics', pool: 1000 }]
      });
      deep(RPT.groupYears(s.groups[0]), [2026]);
    });

    test('a malformed year entry is dropped rather than carried', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 3,
        groups: [{
          id: 'g1', code: 'DLA', name: 'X',
          years: { '2024': { status: 'Active', efforts: [] }, '2025': null }
        }]
      });
      deep(RPT.groupYears(s.groups[0]), [2024]);
    });
  });

  describe('migration / defaults that keep older records readable', () => {

    test('customers get a type and an active flag', () => {
      const RPT = load();
      const s = adopt(RPT, { v: 2, customers: [{ id: 'c1', code: 'DEU', name: 'Germany' }] });
      eq(s.customers[0].active, true);
      eq(s.customers[0].kind, 'OTHER', 'named rather than guessed');
    });

    test('cost shares get a basis and a line map', () => {
      const RPT = load();
      const s = adopt(RPT, { v: 2, shares: [{ id: 's1', name: 'common', fy: 2024 }] });
      eq(s.shares[0].basis, 'pct');
      deep(s.shares[0].lines, {});
    });

    test('funding documents get an amendment ledger', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 3,
        groups: [{
          id: 'g1', code: 'D', name: 'D',
          years: { '2024': { status: 'Active', efforts: [{
            id: 'e1', name: 'W', docs: [{ id: 'd1', cust: 'c1', status: 'Accepted' }], invoices: []
          }] } }
        }]
      });
      const d = year(s, 0, 2024).efforts[0].docs[0];
      deep(d.amends, []);
      eq(d.amount, 0, 'a document with no amount reads as zero, not as undefined');
      eq(RPT.docNet(d), 0);
    });

    test('invoices get collections and a voucher map', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 5,
        groups: [{
          id: 'g1', code: 'D', name: 'D',
          years: { '2024': { status: 'Active', efforts: [{
            id: 'e1', name: 'W', docs: [], requirement: 0,
            invoices: [{ id: 'i1', month: '2024-01', total: 1000, lines: { c1: 1000 } }]
          }] } }
        }]
      });
      const inv = year(s, 0, 2024).efforts[0].invoices[0];
      deep(inv.coll, [], 'an old invoice is billed-uncollected, not assumed collected');
      deep(inv.vouchers, {});
      eq(RPT.invCollected(inv), 0);
      eq(RPT.invOutstanding(inv), 1000);
    });

    test('groups get an archived flag and efforts get the fields they now need', () => {
      const RPT = load();
      const s = adopt(RPT, {
        v: 3,
        groups: [{
          id: 'g1', code: 'D', name: 'D',
          years: { '2024': { status: 'Active', efforts: [{ name: 'W' }] } }
        }]
      });
      eq(s.groups[0].retired, false);
      const e = year(s, 0, 2024).efforts[0];
      ok(e.id, 'an effort with no id is given one');
      eq(e.requirement, 0);
      eq(e.shareId, '');
      deep(e.docs, []);
      deep(e.invoices, []);
    });

    test('the state is stamped with the current schema', () => {
      const RPT = load();
      eq(adopt(RPT, { v: 1, groups: [] }).v, RPT.SCHEMA);
    });

    test('adopting nonsense is refused rather than half-applied', () => {
      const RPT = load();
      eq(RPT.adopt(null), false);
      eq(RPT.adopt('a file'), false);
      eq(RPT.adopt(undefined), false);
    });

    test('a file with lists missing entirely still loads', () => {
      const RPT = load();
      const s = adopt(RPT, { v: 4 });
      deep([s.customers, s.shares, s.groups, s.profiles], [[], [], [], []]);
      eq(RPT.hasData(), false);
    });
  });

  describe('migration / the up-front position moves down to the effort', () => {

    /* a schema-4 file: the position sat on the group year, because the funder
       was assumed to send one MIPR for the whole group */
    function v4(sent, reqs) {
      return {
        v: 4,
        customers: [{ id: 'c1', code: 'USA', name: 'US', kind: 'SERVICE', active: true }],
        groups: [{
          id: 'g1', code: 'DLA', name: 'Logistics',
          years: { '2026': {
            status: 'Active',
            efforts: reqs.map((r, i) => ({
              id: 'e' + i, name: 'Effort ' + i, requirement: r, docs: [], invoices: []
            })),
            upfront: { funder: 'c1', sent: sent, agency: 'DFAS', mords: [] }
          } }
        }]
      };
    }

    test('sent is split across the efforts in proportion to their requirements', () => {
      const RPT = load();
      const s = adopt(RPT, v4(40000, [300000, 100000]));
      const es = year(s, 0, 2026).efforts;
      eq(es[0].upfront.sent, 30000, 'three quarters of the requirement, three quarters of the money');
      eq(es[1].upfront.sent, 10000);
      eq(RPT.round2(es[0].upfront.sent + es[1].upfront.sent), 40000, 'and nothing is lost in the split');
    });

    test('the last effort absorbs the rounding, so the split is exact', () => {
      const RPT = load();
      const s = adopt(RPT, v4(100, [1, 1, 1]));
      const es = year(s, 0, 2026).efforts;
      eq(RPT.round2(es.reduce((t, e) => t + e.upfront.sent, 0)), 100);
    });

    test('the MORD ledger goes whole to the largest effort, never divided', () => {
      const RPT = load();
      const file = v4(40000, [100000, 300000]);
      file.groups[0].years['2026'].upfront.mords = [
        { id: 'm1', month: '2025-11', amount: 25000, no: 'MORD-1' }
      ];
      const s = adopt(RPT, file);
      const es = year(s, 0, 2026).efforts;
      eq(es[0].upfront.mords.length, 0);
      eq(es[1].upfront.mords.length, 1, 'cutting a numbered document in half would invent one');
      eq(es[1].upfront.sent, 30000, 'the largest effort, which is not the first');
    });

    test('and the carry-down says so on the face of each position', () => {
      const RPT = load();
      const s = adopt(RPT, v4(40000, [300000, 100000]));
      const es = year(s, 0, 2026).efforts;
      ok(/whole D&O MORD ledger was attached here/.test(es[0].upfront.carriedDown));
      ok(/sent split by requirement/.test(es[1].upfront.carriedDown));
    });

    test('a position with no funder means nothing, and is dropped', () => {
      const RPT = load();
      const file = v4(40000, [100000]);
      delete file.groups[0].years['2026'].upfront.funder;
      const s = adopt(RPT, file);
      eq(year(s, 0, 2026).efforts[0].upfront, null);
    });

    test('the year-level position is removed once it has been carried down', () => {
      const RPT = load();
      const s = adopt(RPT, v4(40000, [100000]));
      eq(year(s, 0, 2026).upfront, undefined);
    });

    todo('a year-level position with no efforts to land on is not silently discarded',
      'schema 4 -> 5: the carry-down only runs when the year has efforts. A v4 year ' +
      'holding an up-front position but no efforts loses the funder and the amount ' +
      'entirely -- `delete y.upfront` runs either way, with nothing recorded. Reachable ' +
      'for anyone who recorded the position before breaking the year into efforts.',
      () => {
        const RPT = load();
        const file = v4(40000, []);
        const s = adopt(RPT, file);
        const y = year(s, 0, 2026);
        ok(y.upfront || (y.efforts || []).some((e) => e.upfront),
          'the funder and the 40,000 they sent should survive the upgrade somewhere');
      });
  });

  describe('migration / a cumulative MORD ledger becomes monthly positions', () => {

    /* schema 5 -> 6. Three MORDs of $1M used to mean $3M released; a MORD is now
       the standing amount trued to BID D, so the old ledger is converted by
       taking the RUNNING TOTAL at each month it touched. */
    const ledger = [
      { id: 'm1', no: 'MORD-1', date: '2025-11-05', amount: 100000 },
      { id: 'm2', no: 'MORD-2', date: '2025-12-03', amount: 50000 }
    ];

    function v5(mords) {
      return {
        v: 5,
        customers: [{ id: 'c1', code: 'USA', name: 'US', kind: 'SERVICE', active: true }],
        groups: [{
          id: 'g1', code: 'DLA', name: 'Logistics',
          years: { '2026': {
            status: 'Active',
            efforts: [{
              id: 'e1', name: 'Warehousing', requirement: 300000, docs: [], invoices: [],
              upfront: { funder: 'c1', sent: 300000, mords: mords }
            }]
          } }
        }]
      };
    }

    test('each month takes the running position, not that month\'s increment', () => {
      const RPT = load();
      const s = adopt(RPT, v5(ledger));
      const ms = year(s, 0, 2026).efforts[0].upfront.mords;
      eq(ms.length, 2);
      eq(ms[0].month, '2025-11');
      eq(ms[0].amount, 100000);
      eq(ms[1].month, '2025-12');
      eq(ms[1].amount, 150000, 'the position after the second release, not the 50,000 itself');
    });

    test('the conversion is recorded on each entry rather than done quietly', () => {
      const RPT = load();
      const s = adopt(RPT, v5(ledger));
      const ms = year(s, 0, 2026).efforts[0].upfront.mords;
      ok(/Converted from a cumulative ledger/.test(ms[0].note));
      eq(ms[0].carriedDown, true);
      eq(ms[0].no, 'MORD-1', 'and the document number is kept');
    });

    test('the converted position reads correctly through the model', () => {
      const RPT = load();
      const s = adopt(RPT, v5(ledger));
      const U = RPT.upfrontEffort(s.groups[0], 2026, 'e1');
      eq(U.current, 150000, 'the latest standing position');
      eq(U.currentMonth, '2025-12');
    });

    test('two releases in one month collapse to one position for that month', () => {
      const RPT = load();
      const s = adopt(RPT, v5([
        { id: 'm1', no: 'MORD-1', date: '2025-11-05', amount: 100000 },
        { id: 'm2', no: 'MORD-2', date: '2025-11-20', amount: 25000 }
      ]));
      const ms = year(s, 0, 2026).efforts[0].upfront.mords;
      eq(ms.length, 1, 'a month cannot stand at two amounts at once');
      eq(ms[0].amount, 125000);
      ok(/MORD-1, MORD-2/.test(ms[0].note), 'and both document numbers are named');
    });

    test('an already-monthly ledger is left alone', () => {
      const RPT = load();
      const s = adopt(RPT, v5([{ id: 'm1', month: '2025-11', amount: 100000, no: 'MORD-1' }]));
      const ms = year(s, 0, 2026).efforts[0].upfront.mords;
      eq(ms.length, 1);
      eq(ms[0].amount, 100000);
      ok(!ms[0].carriedDown, 'nothing was converted, so nothing claims to have been');
    });

    todo('a cumulative ledger carried down from a YEAR-level position is converted too',
      'schema 4 -> 6: migrate() converts cumulative MORD ledgers inside the efforts ' +
      'loop, but the year-level carry-down runs AFTER that loop. A v4 file therefore ' +
      'lands its ledger on the effort still cumulative and with no `month`. ' +
      'upfrontEffort then sorts on undefined, reads `current` as the last INCREMENT ' +
      'rather than the position, and recon never matches a month -- so every elapsed ' +
      'month counts as unreconciled. The same ledger in a v5 file converts correctly.',
      () => {
        const RPT = load();
        const s = adopt(RPT, {
          v: 4,
          customers: [{ id: 'c1', code: 'USA', name: 'US', kind: 'SERVICE', active: true }],
          groups: [{
            id: 'g1', code: 'DLA', name: 'Logistics',
            years: { '2026': {
              status: 'Active',
              efforts: [{ id: 'e1', name: 'W', requirement: 300000, docs: [], invoices: [] }],
              upfront: { funder: 'c1', sent: 300000, mords: ledger }
            } }
          }]
        });
        const ms = year(s, 0, 2026).efforts[0].upfront.mords;
        eq(ms[1].month, '2025-12', 'every entry should carry the month it is trued to');
        eq(ms[1].amount, 150000, 'and the running position, as the v5 path produces');
      });
  });

  describe('migration / a file survives the round trip', () => {

    test('saving and reloading changes nothing that matters', () => {
      const { standard } = require('../harness.js');
      const RPT = load();
      const b = standard(RPT);
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-11-10' });
      b.invoice('DLA', 2026, 'Warehousing', { total: 100000, month: '2026-01' });
      b.upfront('DLA', 2026, 'Warehousing', { funder: 'USA', sent: 400000 });
      b.mord('DLA', 2026, 'Warehousing', { month: '2025-11', amount: 50000 });

      const before = RPT.fyRollup(2026);
      const reloaded = load();
      reloaded.adopt(JSON.parse(JSON.stringify(RPT.payload())));
      const after = reloaded.fyRollup(2026);

      eq(after.requirement, before.requirement);
      eq(after.mipr, before.mipr);
      eq(after.invoiced, before.invoiced);
      eq(after.upfront.sent, before.upfront.sent);
      eq(after.upfront.current, before.upfront.current);
      eq(after.byCustomer.length, before.byCustomer.length);
    });

    test('the payload names the app and the build that wrote it', () => {
      const RPT = load();
      const p = RPT.payload();
      eq(p.app, 'RPT');
      eq(p.ver, RPT.VERSION);
      eq(p.v, RPT.SCHEMA);
      ok(p.saved, 'and when');
    });
  });
};
