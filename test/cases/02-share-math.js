'use strict';

/* Rule 1: RPT.sharePct() is the ONLY place a percentage is produced.
 *
 * And the allocator underneath it, which carries the most exacting promise in
 * the file: the parts sum EXACTLY to round2(pool * sum(pct) / 100), at every
 * pool size and every set of percentages. Everything billed, split or reported
 * passes through here, so it is tested by worked example AND by sweep.
 */

/* Compare in whole cents. Asserting on floats would test the comparison rather
   than the allocator -- 333333.34 + 333333.33 + 333333.33 is not reliably
   1000000 in binary floating point, but 33333334 + 33333333 + 33333333 is
   exactly 100000000. */
const cents = (v) => Math.round(v * 100);
const sumCents = (a) => a.reduce((t, v) => t + cents(v), 0);

/* A seeded generator, so a sweep failure reproduces exactly. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = ({ describe, test, eq, ok, near, deep, load, builder }) => {
  const RPT = load();

  describe('share math / sharePct is the single source of percentages', () => {

    test('a percentage table reports what was entered', () => {
      const P = RPT.sharePct({ basis: 'pct', lines: { a: 40, b: 35, c: 25 } });
      eq(P.total, 100);
      eq(P.pct.a, 40);
      eq(P.derived, false, 'nothing was computed, so nothing is derived');
    });

    test('a driver-quantity table derives percentages at full precision', () => {
      const P = RPT.sharePct({ basis: 'qty', lines: { a: 1, b: 1, c: 2 } });
      eq(P.derived, true);
      eq(P.qtyTotal, 4);
      eq(P.pct.a, 25);
      eq(P.pct.c, 50);
      eq(P.total, 100, 'a quantity table is balanced by construction');
    });

    test('thirds stay at full precision rather than being rounded early', () => {
      const P = RPT.sharePct({ basis: 'qty', lines: { a: 1, b: 1, c: 1 } });
      eq(P.pct.a, (1 / 3) * 100, 'computed as quantity over total, then scaled');
      ok(P.pct.a !== 33.333, 'not rounded for display here -- that belongs at the point of printing');
      ok(Math.abs(P.pct.a * 3 - 100) < 1e-12, 'three of them still make a whole');
    });

    test('a quantity table with nothing in it produces zeroes, not NaN', () => {
      const P = RPT.sharePct({ basis: 'qty', lines: { a: 0, b: 0 } });
      eq(P.pct.a, 0);
      eq(P.total, 0, 'and it reports itself as unbalanced rather than as 100%');
      eq(P.qtyTotal, 0);
    });

    test('unreadable lines count as zero, never NaN', () => {
      const P = RPT.sharePct({ basis: 'pct', lines: { a: 40, b: 'oops', c: null } });
      eq(P.pct.b, 0);
      eq(P.pct.c, 0);
      eq(P.total, 40);
    });

    test('no share at all is an empty result, not a crash', () => {
      const P = RPT.sharePct(null);
      deep(P.order, []);
      eq(P.total, 0);
    });
  });

  describe('share math / the balance check', () => {

    test('a table totalling 100 is balanced', () => {
      const b = RPT.shareBalance({ basis: 'pct', lines: { a: 40, b: 35, c: 25 } });
      ok(b.ok);
      eq(b.off, 0);
      eq(b.empty, false);
    });

    test('a table that does not total 100 reports how far off, signed', () => {
      const under = RPT.shareBalance({ basis: 'pct', lines: { a: 97 } });
      ok(!under.ok);
      eq(under.off, -3, 'three points short');
      const over = RPT.shareBalance({ basis: 'pct', lines: { a: 60, b: 60 } });
      eq(over.off, 20, 'twenty points over');
    });

    test('the tolerance is half a thousandth of a point', () => {
      ok(RPT.shareBalance({ basis: 'pct', lines: { a: 100.0004 } }).ok,
        'rounding dust at the fourth decimal is not an error');
      ok(!RPT.shareBalance({ basis: 'pct', lines: { a: 100.001 } }).ok,
        'a thousandth of a point is');
    });

    test('an empty table is empty, which is not the same as unbalanced', () => {
      const b = RPT.shareBalance({ basis: 'pct', lines: {} });
      eq(b.empty, true);
    });
  });

  describe('share math / the largest-remainder allocator', () => {

    test('a million split three ways loses no cent and invents none', () => {
      /* the worked example in the comment above RPT.allocate */
      const out = RPT.allocate(1000000, [100 / 3, 100 / 3, 100 / 3]);
      deep(out, [333333.34, 333333.33, 333333.33]);
      eq(sumCents(out), 100000000, 'exactly one million dollars, to the cent');
    });

    test('the leftover cent goes to the largest discarded fraction', () => {
      const out = RPT.allocate(100, [16.667, 33.333, 50]);
      eq(sumCents(out), 10000);
      ok(out[0] >= 16.66 && out[0] <= 16.67);
    });

    test('a tie hands the cent to the earlier line, so renders are stable', () => {
      const a = RPT.allocate(0.01, [50, 50]);
      deep(a, [0.01, 0], 'the first line takes it');
      deep(RPT.allocate(0.01, [50, 50]), a, 'and takes it again on the next render');
    });

    test('an unbalanced table allocates its own total, not the pool', () => {
      /* forcing 97% up to the pool would hide the very error the balance
         check exists to show */
      eq(sumCents(RPT.allocate(1000, [97])), 97000);
      eq(sumCents(RPT.allocate(1000, [50, 47])), 97000);
      eq(sumCents(RPT.allocate(1000, [60, 60])), 120000, 'and an over-balanced one over-allocates');
    });

    test('degenerate inputs do not throw', () => {
      deep(RPT.allocate(1000, []), []);
      deep(RPT.allocate(0, [40, 35, 25]), [0, 0, 0]);
      deep(RPT.allocate(1000, [0, 0]), [0, 0]);
      eq(sumCents(RPT.allocate(1000, [40, NaN, 60])), 100000, 'an unreadable line counts as zero');
    });

    test('a negative line (money handed back) still balances', () => {
      const out = RPT.allocate(1000, [-50, 150]);
      eq(sumCents(out), 100000);
      eq(out[0], -500);
    });

    test('the sum holds across a sweep of pools and ratios', () => {
      const r = rng(20260917);
      let checked = 0;
      for (let i = 0; i < 4000; i++) {
        const n = 1 + Math.floor(r() * 8);
        const pcts = [];
        for (let j = 0; j < n; j++) pcts.push(r() * 100);
        /* a mix of balanced and deliberately unbalanced tables */
        if (i % 2 === 0) {
          const t = pcts.reduce((a, b) => a + b, 0);
          for (let j = 0; j < n; j++) pcts[j] = pcts[j] / t * 100;
        }
        const pool = Math.round(r() * 5e8) / 100;
        const out = RPT.allocate(pool, pcts);

        const sum = pcts.reduce((a, b) => a + b, 0);
        const target = Math.round(Math.round(pool * 100) * sum / 100);
        eq(sumCents(out), target,
          `sweep ${i}: pool=${pool} pcts=[${pcts.join(', ')}]`);
        checked++;
      }
      eq(checked, 4000);
    });

    test('every line stays within a cent of its exact share', () => {
      const r = rng(777);
      for (let i = 0; i < 1500; i++) {
        const n = 2 + Math.floor(r() * 6);
        const pcts = [];
        for (let j = 0; j < n; j++) pcts.push(r() * 100);
        const pool = Math.round(r() * 1e8) / 100;
        const out = RPT.allocate(pool, pcts);
        out.forEach((v, j) => {
          const exact = pool * pcts[j] / 100;
          near(v, exact, 0.01, `sweep ${i} line ${j}: drifted more than a cent from its share`);
        });
      }
    });
  });

  describe('share math / allocation through a real cost share', () => {

    test('a requirement splits down the table it is attached to', () => {
      const fresh = load();
      const b = builder(fresh);
      b.customer('DEU', 'Germany');
      b.customer('ITA', 'Italy');
      b.customer('USA', 'United States', 'SERVICE');
      b.share('common', 2026, { DEU: 40, ITA: 35, USA: 25 });
      b.group('DLA', 'Logistics');
      b.year('DLA', 2026, { status: 'Active' });
      b.effort('DLA', 2026, 'Warehousing', 1000000, 'common');

      const S = fresh.effortSplit(b.obj.group('DLA'), 2026, b.id.effort('Warehousing'));
      deep(S.rows.map((r) => r.requirement), [400000, 350000, 250000]);
      eq(S.requirementSplit, 1000000, 'the parts add back to the whole');
    });

    test('rows come out in the order customers are shown, everywhere', () => {
      const fresh = load();
      const b = builder(fresh);
      b.customer('ZZZ', 'Last');
      b.customer('AAA', 'First');
      b.customer('MMM', 'Middle');
      b.share('common', 2026, { ZZZ: 30, AAA: 40, MMM: 30 });
      b.group('G', 'Group');
      b.year('G', 2026);
      b.effort('G', 2026, 'Work', 1000, 'common');

      const S = fresh.effortSplit(b.obj.group('G'), 2026, b.id.effort('Work'));
      deep(S.rows.map((r) => fresh.custCode(r.cust)), ['AAA', 'MMM', 'ZZZ'],
        'sorted by code, not by insertion order, so two panels never disagree');
    });

    test('an unbalanced table splits honestly rather than being forced', () => {
      const fresh = load();
      const b = builder(fresh);
      b.customer('DEU', 'Germany');
      b.customer('ITA', 'Italy');
      b.share('short', 2026, { DEU: 60, ITA: 37 });   /* 97% */
      b.group('G', 'Group');
      b.year('G', 2026);
      b.effort('G', 2026, 'Work', 1000000, 'short');

      const S = fresh.effortSplit(b.obj.group('G'), 2026, b.id.effort('Work'));
      eq(S.requirement, 1000000, 'the requirement is still the requirement');
      eq(S.requirementSplit, 970000, 'but only 97% of it lands on a customer');
      ok(!S.balance.ok, 'and the table says so');
    });
  });
};
