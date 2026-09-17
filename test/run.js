'use strict';

/* ============================================================================
 * test/run.js -- the runner.
 *
 * Hand-rolled and dependency-free on purpose. RPT is one HTML file with no
 * build step and no node_modules; a test suite that needed an install to run
 * would be the first thing in this repo to stop working. Node's own test
 * runner would do, but this keeps `node test/run.js` as the whole contract.
 *
 *   node test/run.js                 everything
 *   node test/run.js allocate        only tests whose name matches
 *   node test/run.js --list          names only, run nothing
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const harness = require('./harness.js');

const CASES = path.join(__dirname, 'cases');

/* ============================================================== assertions = */

function fail(msg, extra) {
  const e = new Error(msg);
  e.assertion = true;
  if (extra) e.detail = extra;
  throw e;
}

function show(v) {
  /* full precision for numbers: a float mismatch one ULP wide is exactly the
     kind this suite exists to catch, and truncating would print the expected
     and the actual as the same string */
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null || v === undefined) return String(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

const A = {
  ok(cond, msg) {
    if (!cond) fail(msg || 'expected a truthy value', 'got: ' + show(cond));
  },
  notOk(cond, msg) {
    if (cond) fail(msg || 'expected a falsy value', 'got: ' + show(cond));
  },
  eq(actual, expected, msg) {
    if (!Object.is(actual, expected)) {
      fail(msg || 'values differ', `expected: ${show(expected)}\n    actual:   ${show(actual)}`);
    }
  },
  /* money: round2 makes most comparisons exact, but anything that survives a
     division wants a tolerance, and a cent is the unit that matters here */
  near(actual, expected, tol, msg) {
    tol = tol == null ? 0.005 : tol;
    if (!(Math.abs(actual - expected) <= tol)) {
      fail(msg || 'values differ beyond tolerance',
        `expected: ${show(expected)} (+/- ${tol})\n    actual:   ${show(actual)}`);
    }
  },
  deep(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) fail(msg || 'structures differ', `expected: ${b}\n    actual:   ${a}`);
  },
  /* an error list, or any array of strings, mentioning something */
  mentions(list, needle, msg) {
    const all = [].concat(list || []).join(' | ');
    if (all.toLowerCase().indexOf(String(needle).toLowerCase()) < 0) {
      fail(msg || `expected something mentioning ${show(needle)}`, 'got: ' + (all || '(nothing)'));
    }
  },
  silent(list, msg) {
    const all = [].concat(list || []);
    if (all.length) fail(msg || 'expected no complaints', 'got: ' + all.join(' | '));
  }
};

/* ================================================================= registry = */

const tests = [];
let current = null;

function test(name, fn) {
  tests.push({ name, fn, group: current });
}

/* A test for behaviour the model does not have YET. It asserts what SHOULD be
   true and is expected to fail; the suite stays green so a real regression is
   still visible, and the defect is recorded precisely rather than in a comment
   nobody reads. If it starts passing, that is reported as a failure -- the fix
   landed and the wrapper has to come off, or the protection is quietly lost. */
function todo(name, why, fn) {
  tests.push({ name, fn, group: current, todo: why });
}
function describe(name, fn) {
  const prev = current;
  current = name;
  fn();
  current = prev;
}

/* ==================================================================== main = */

function main(argv) {
  const args = argv.slice(2);
  const listOnly = args.includes('--list');
  const filter = args.filter((a) => !a.startsWith('--'))[0] || null;

  const toolkit = Object.assign({
    test, describe, todo,
    load: harness.load, builder: harness.builder, standard: harness.standard,
    DEFAULT_NOW: harness.DEFAULT_NOW
  }, A);

  fs.readdirSync(CASES).filter((f) => f.endsWith('.js')).sort().forEach((f) => {
    require(path.join(CASES, f))(toolkit);
  });

  const chosen = filter
    ? tests.filter((t) => (t.group + ' ' + t.name).toLowerCase().includes(filter.toLowerCase()))
    : tests;

  if (listOnly) {
    let g = null;
    chosen.forEach((t) => {
      if (t.group !== g) { g = t.group; process.stdout.write('\n' + g + '\n'); }
      process.stdout.write('  ' + t.name + '\n');
    });
    process.stdout.write(`\n${chosen.length} test${chosen.length === 1 ? '' : 's'}\n`);
    return 0;
  }

  if (!chosen.length) {
    process.stdout.write(`no test matches ${JSON.stringify(filter)}\n`);
    return 1;
  }

  const failures = [];
  const known = [];
  let group = null;
  let passed = 0;

  chosen.forEach((t) => {
    if (t.group !== group) {
      group = t.group;
      process.stdout.write('\n' + group + '\n');
    }
    let threw = null;
    try { t.fn(); } catch (err) { threw = err; }

    if (t.todo) {
      if (threw) {
        known.push(t);
        process.stdout.write('  known ' + t.name + '\n');
      } else {
        const e = new Error(
          'this test now PASSES, but it is marked as a known defect.\n' +
          '    If the fix landed, drop the todo() wrapper so the behaviour stays protected.\n' +
          '    Recorded defect: ' + t.todo);
        e.assertion = true;
        failures.push({ t, err: e });
        process.stdout.write('  FIXED ' + t.name + '\n');
      }
      return;
    }
    if (threw) {
      failures.push({ t, err: threw });
      process.stdout.write('  FAIL  ' + t.name + '\n');
    } else {
      passed++;
      process.stdout.write('  ok    ' + t.name + '\n');
    }
  });

  process.stdout.write('\n' + '-'.repeat(68) + '\n');
  if (known.length) {
    process.stdout.write('\nKnown defects, asserted as they SHOULD behave and failing until fixed:\n');
    known.forEach((t) => process.stdout.write(`  - ${t.name}\n      ${t.todo}\n`));
  }
  if (failures.length) {
    failures.forEach(({ t, err }) => {
      process.stdout.write(`\nFAIL  ${t.group} :: ${t.name}\n`);
      process.stdout.write('    ' + err.message + '\n');
      if (err.detail) process.stdout.write('    ' + err.detail + '\n');
      if (!err.assertion) {
        const at = String(err.stack || '').split('\n').slice(1, 4).join('\n');
        process.stdout.write(at + '\n');
      }
    });
    process.stdout.write(`\n${passed} passed, ${failures.length} FAILED` +
      (known.length ? `, ${known.length} known` : '') + '\n');
    return 1;
  }
  process.stdout.write(`\n${passed} passed` +
    (known.length ? `, ${known.length} known defect${known.length === 1 ? '' : 's'}` : '') + '\n');
  return 0;
}

process.exitCode = main(process.argv);
