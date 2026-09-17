'use strict';

/* 03_core.js -- the helpers everything else is built on. Most of these are
   small enough to look obviously right, which is exactly why they are worth
   pinning: a silent change here moves every figure in the tool at once. */

module.exports = ({ describe, test, eq, ok, deep, load }) => {
  const RPT = load();

  describe('core / the federal fiscal year', () => {

    test('the year turns on 1 October', () => {
      eq(RPT.fyOf(new Date(2026, 8, 30)), 2026, '30 Sep 2026 is still FY2026');
      eq(RPT.fyOf(new Date(2026, 9, 1)), 2027, '1 Oct 2026 is FY2027');
      eq(RPT.fyOf(new Date(2026, 11, 31)), 2027, 'December 2026 is FY2027');
      eq(RPT.fyOf(new Date(2027, 0, 1)), 2027, 'January 2027 is still FY2027');
    });

    test('fyLabel abbreviates to two digits', () => {
      eq(RPT.fyLabel(2026), 'FY26');
      eq(RPT.fyLabel(2003), 'FY03');
    });

    test('a fiscal year is twelve months, October through September', () => {
      const m = RPT.fyMonths(2026);
      eq(m.length, 12);
      eq(m[0], '2025-10', 'FY2026 opens in October 2025');
      eq(m[2], '2025-12', 'the calendar year turns inside the fiscal year');
      eq(m[3], '2026-01');
      eq(m[11], '2026-09', 'and closes in September 2026');
    });

    test('month numbering runs 1 = October to 12 = September', () => {
      eq(RPT.fyMonthNo('2025-10', 2026), 1);
      eq(RPT.fyMonthNo('2026-01', 2026), 4);
      eq(RPT.fyMonthNo('2026-09', 2026), 12);
    });

    test('a month outside the year is -1, not 0 or 13', () => {
      eq(RPT.fyMonthNo('2026-10', 2026), -1, 'October 2026 belongs to FY2027');
      eq(RPT.fyMonthNo('2025-09', 2026), -1, 'September 2025 belongs to FY2025');
      eq(RPT.fyMonthNo('nonsense', 2026), -1);
    });

    test('inFy agrees with the month list', () => {
      ok(RPT.inFy('2025-10', 2026));
      ok(RPT.inFy('2026-09', 2026));
      ok(!RPT.inFy('2026-10', 2026));
      ok(!RPT.inFy('', 2026));
    });

    test('the current fiscal month is capped inside the year', () => {
      /* the harness clock stands at 15 May 2026: fiscal month 8 of FY2026 */
      eq(RPT.fyMonthNow(2026), 8, 'May is the eighth month of a year that opened in October');
      eq(RPT.fyMonthNow(2025), 12, 'a year that has ended reads as fully elapsed');
      eq(RPT.fyMonthNow(2030), 0, 'a year that has not started reads as nothing elapsed');
    });

    test('month labels read as months', () => {
      eq(RPT.monthLabel('2025-10'), 'Oct 2025');
      eq(RPT.monthShort('2026-01'), 'Jan');
      eq(RPT.monthLabel('rubbish'), 'rubbish', 'an unreadable month is shown, not swallowed');
    });
  });

  describe('core / reading what an analyst types', () => {

    test('parseMoney takes dollars, commas and suffixes', () => {
      eq(RPT.parseMoney('1000'), 1000);
      eq(RPT.parseMoney('$1,234.56'), 1234.56);
      eq(RPT.parseMoney('250K'), 250000, 'the hint the amendment field prints');
      eq(RPT.parseMoney('28M'), 28000000, 'the hint the up-front field prints');
      eq(RPT.parseMoney('1.5b'), 1500000000);
      eq(RPT.parseMoney(' 42 '), 42);
      eq(RPT.parseMoney(-250), -250, 'a number passes through');
    });

    test('parentheses mean negative, the way a ledger writes it', () => {
      eq(RPT.parseMoney('(500)'), -500);
      eq(RPT.parseMoney('($1,200.50)'), -1200.5);
    });

    test('unreadable input is null -- never NaN and never a silent zero', () => {
      /* the comment on parseMoney is emphatic about this: a 0 that came from a
         typo is a wrong number that looks like data */
      eq(RPT.parseMoney(''), null);
      eq(RPT.parseMoney('   '), null);
      eq(RPT.parseMoney('twelve'), null);
      eq(RPT.parseMoney('1.2.3'), null);
      eq(RPT.parseMoney('12X'), null);
      eq(RPT.parseMoney(null), null);
      eq(RPT.parseMoney(undefined), null);
      eq(RPT.parseMoney(NaN), null);
      eq(RPT.parseMoney(Infinity), null);
    });

    test('an explicit zero IS zero', () => {
      eq(RPT.parseMoney('0'), 0, 'refusing a typed 0 would be its own kind of wrong');
      eq(RPT.parseMoney('$0.00'), 0);
    });

    test('parsePct and parseQty', () => {
      eq(RPT.parsePct('40%'), 40);
      eq(RPT.parsePct('33.333'), 33.333);
      eq(RPT.parsePct(''), null);
      eq(RPT.parseQty('1,200'), 1200);
      eq(RPT.parseQty('0'), 0);
      eq(RPT.parseQty('-5'), null, 'you cannot own minus five aircraft');
      eq(RPT.parseQty('lots'), null);
    });
  });

  describe('core / printing a figure', () => {

    test('round2 is to the cent', () => {
      eq(RPT.round2(0.1 + 0.2), 0.3, 'float noise does not reach the ledger');
      eq(RPT.round2(1.005), 1.01);
      eq(RPT.round2(-1.005), -1, 'JS rounds half away from zero only upward; pinned as-is');
      eq(RPT.round3(100.0004), 100);
    });

    test('cents appear only when there are cents', () => {
      eq(RPT.fmtMoney(1000000), '$1,000,000');
      eq(RPT.fmtMoney(333333.34), '$333,333.34', 'the case the comment is written about');
      eq(RPT.fmtMoney(0.05), '$0.05');
      eq(RPT.fmtMoney(-500), '-$500');
      eq(RPT.fmtMoney(0), '$0');
      eq(RPT.fmtMoney(null), '—', 'nothing known prints as a dash, not as zero');
      eq(RPT.fmtMoney(Infinity), '—');
    });

    test('fmtM abbreviates for the headline figures', () => {
      eq(RPT.fmtM(28000000), '$28.0M');
      eq(RPT.fmtM(2500000000), '$2.50B');
      eq(RPT.fmtM(250000), '$250K');
      eq(RPT.fmtM(-1500000), '-$1.5M');
      eq(RPT.fmtM(42), '$42');
    });

    test('percentages carry three decimals with trailing zeros trimmed', () => {
      eq(RPT.fmtPct(25), '25%', 'a clean quarter should not read as 25.000%');
      eq(RPT.fmtPct(33.333), '33.333%');
      eq(RPT.fmtPct(40.5), '40.5%');
      eq(RPT.fmtPct(0), '0%');
      eq(RPT.fmtPct(null), '—');
    });

    test('dates print as a person writes them', () => {
      eq(RPT.fmtDate('2026-01-09'), '09 Jan 2026');
      eq(RPT.fmtDate(''), '—');
      eq(RPT.fmtDate('not-a-date'), 'not-a-date');
    });
  });

  describe('core / identifiers and escaping', () => {

    test('uid never repeats within a session', () => {
      const seen = {};
      for (let i = 0; i < 500; i++) {
        const id = RPT.uid('c');
        ok(!seen[id], 'uid collided on iteration ' + i + ': ' + id);
        seen[id] = 1;
      }
    });

    test('uid carries its prefix', () => {
      ok(/^c_/.test(RPT.uid('c')));
      ok(/^x_/.test(RPT.uid()));
    });

    test('esc closes every hole a customer name could open', () => {
      eq(RPT.esc('<script>'), '&lt;script&gt;');
      eq(RPT.esc('Tom & Jerry'), 'Tom &amp; Jerry');
      eq(RPT.esc('say "hi"'), 'say &quot;hi&quot;');
      eq(RPT.esc('<b>&"'), '&lt;b&gt;&amp;&quot;', 'ampersand is escaped first, so nothing double-escapes');
      eq(RPT.esc(null), '');
      eq(RPT.esc(0), '0', 'zero is a value, not an absence');
    });

    test('byId finds by identity and tolerates a missing id', () => {
      const list = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
      eq(RPT.byId(list, 'b').n, 2);
      eq(RPT.byId(list, 'zzz'), null);
      eq(RPT.byId(list, ''), null);
      eq(RPT.byId(list, null), null);
    });

    test('a deleted customer still renders as something visible', () => {
      const fresh = load();
      eq(fresh.custName('c_gone9999'), '(missing customer 9999)',
        'a dangling reference must never render as an empty cell');
      eq(fresh.custCode('c_gone9999'), '(missing)');
    });

    test('customers sort active-first, then by code', () => {
      const fresh = load();
      const mk = (code, active) => ({ id: code, code, name: code, active });
      const list = [mk('ZZZ', true), mk('AAA', false), mk('MMM', true)];
      const sorted = list.slice().sort(fresh.sortCust);
      deep(sorted.map((c) => c.code), ['MMM', 'ZZZ', 'AAA']);
    });
  });
};
