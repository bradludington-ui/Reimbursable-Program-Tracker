'use strict';

/* ============================================================================
 * test/harness.js -- run the model in a bare VM, and build programs to run it on.
 *
 * THE POINT OF THE BARE VM. 03_core.js and 04_model.js promise to touch no DOM
 * at load time. A test that ran them under jsdom would let that promise rot
 * silently; here there is no `document` and no `window` at all, so a stray
 * top-level reference is a hard failure on the very first test rather than a
 * surprise for whoever next tries to test the model.
 *
 * THE FROZEN CLOCK. RPT.fyMonthNow() reads the wall clock, and it decides which
 * months bidByMonth marks `future` -- which in turn decides which month
 * upfrontEffort reports its position "as of". Left alone, a suite asserting on
 * a BID D figure would pass all year and fail in October. Every load therefore
 * gets a Date pinned to a stated instant, and any test that cares says which.
 *
 * FRESH STATE PER LOAD. RPT.state is module-level mutable state. Sharing one
 * instance across tests would let a fixture from one leak into the next, so
 * each load() gets its own context. The compiled scripts are cached, so this
 * costs microseconds.
 * ========================================================================== */

const vm = require('vm');
const { modelChunks } = require('./extract.js');

/* Compile once, instantiate many. lineOffset maps a throw back to the line it
   really came from in the shipping file, so a stack trace is clickable. */
let COMPILED = null;
function compiled() {
  if (!COMPILED) {
    COMPILED = modelChunks().map((c) => ({
      file: c.file,
      script: new vm.Script(c.code, {
        filename: 'Reimbursables_Program_Tracker.html',
        lineOffset: c.line - 1
      })
    }));
  }
  return COMPILED;
}

/* A Date pinned to one instant. `new Date()` and Date.now() report it; every
   other Date behaviour -- parsing, arithmetic, formatting -- is untouched,
   because the model does real date work and a stub would test the stub. */
function FrozenDate(iso) {
  const fixed = new Date(iso).getTime();
  if (!isFinite(fixed)) throw new Error('unreadable clock: ' + iso);
  class Frozen extends Date {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  return Frozen;
}

/* Mid-FY2026 by default: fiscal month 8 of 12, so Jun-Sep 2026 are `future`
   and the "as of" paths are actually exercised. A test wanting a closed year
   passes a later instant. */
const DEFAULT_NOW = '2026-05-15T12:00:00Z';

function load(opts) {
  opts = opts || {};
  const ctx = vm.createContext({
    Date: FrozenDate(opts.now || DEFAULT_NOW),
    JSON, Math, Number, String, Object, Array, Boolean, RegExp, Error, isFinite, parseFloat, parseInt
    /* deliberately absent: document, window, localStorage, console */
  });
  compiled().forEach((c) => c.script.runInContext(ctx));
  if (!ctx.RPT) throw new Error('RPT was not defined after loading the chunks');
  return ctx.RPT;
}

/* ========================================================== program builder = */

/* Builds a program through the app's OWN mutators, so the fixtures exercise
   addCustomer / addShare / addEffort / raiseInvoice rather than hand-rolling
   state the real code would never produce. Names are used as handles; ids stay
   opaque, exactly as the model insists. */
function builder(RPT) {
  const cust = {};
  const shares = {};
  const groups = {};
  const efforts = {};

  const api = {
    RPT,
    id: {
      cust: (code) => need(cust, code, 'customer'),
      share: (name) => need(shares, name, 'cost share'),
      group: (code) => need(groups, code, 'group').id,
      effort: (name) => need(efforts, name, 'effort').id
    },
    obj: {
      group: (code) => need(groups, code, 'group'),
      effort: (name) => need(efforts, name, 'effort'),
      share: (name) => RPT.shareById(need(shares, name, 'cost share'))
    },

    customer(code, name, kind) {
      const c = RPT.addCustomer({ code, name: name || code, kind: kind || 'PARTNER', active: true });
      cust[code] = c.id;
      return c;
    },

    /* lines are keyed by customer CODE for legibility; translated to ids here */
    share(name, fy, lines, extra) {
      const byId = {};
      Object.keys(lines || {}).forEach((code) => { byId[api.id.cust(code)] = lines[code]; });
      const s = RPT.addShare(Object.assign({ name, fy, basis: 'pct', lines: byId }, extra || {}));
      shares[name] = s.id;
      return s;
    },

    group(code, name, extra) {
      const g = RPT.addGroup(Object.assign({ code, name: name || code }, extra || {}));
      groups[code] = g;
      return g;
    },

    year(groupCode, fy, init) {
      return RPT.startYear(need(groups, groupCode, 'group'), fy, init);
    },

    effort(groupCode, fy, name, requirement, shareName, extra) {
      const g = need(groups, groupCode, 'group');
      const e = RPT.addEffort(g, fy, Object.assign({
        name,
        code: name.slice(0, 3).toUpperCase(),
        requirement: requirement || 0,
        shareId: shareName ? api.id.share(shareName) : ''
      }, extra || {}));
      efforts[name] = e;
      return e;
    },

    /* a funding document, straight onto the effort -- the app's own doc editor
       lives in 08_groups.js, which is UI and out of scope here */
    doc(effortName, d) {
      const e = need(efforts, effortName, 'effort');
      const doc = Object.assign({
        id: RPT.uid('d'), type: 'MIPR', status: 'Accepted', amends: []
      }, d);
      if (doc.cust) doc.cust = api.id.cust(doc.cust);
      e.docs.push(doc);
      return doc;
    },

    amend(doc, a) {
      return RPT.addAmend(doc, Object.assign({ kind: 'Increase' }, a));
    },

    invoice(groupCode, fy, effortName, o) {
      return RPT.raiseInvoice(need(groups, groupCode, 'group'), fy,
        need(efforts, effortName, 'effort').id, o);
    },

    upfront(groupCode, fy, effortName, u) {
      const g = need(groups, groupCode, 'group');
      return RPT.setUpfrontEffort(g, fy, need(efforts, effortName, 'effort').id,
        Object.assign({}, u, { funder: api.id.cust(u.funder) }));
    },

    mord(groupCode, fy, effortName, m) {
      return RPT.addMord(need(groups, groupCode, 'group'), fy,
        need(efforts, effortName, 'effort').id, m);
    }
  };
  return api;
}

function need(map, key, what) {
  if (!(key in map)) {
    throw new Error(`fixture error: no ${what} called "${key}" has been built ` +
      `(have: ${Object.keys(map).join(', ') || 'none'})`);
  }
  return map[key];
}

/* A small, complete, realistic program used by most of the suite.
 *
 *   DLA FY2026
 *     Warehousing     $1,000,000  on "FY26 common"  DEU 40 / ITA 35 / USA 25
 *     Transportation  $  400,000  on "FY26 common"
 *
 * Kept deliberately small: a fixture you cannot hold in your head produces
 * assertions nobody can check by hand.
 */
function standard(RPT, fy) {
  fy = fy || 2026;
  const b = builder(RPT);
  b.customer('DEU', 'Germany', 'PARTNER');
  b.customer('ITA', 'Italy', 'PARTNER');
  b.customer('USA', 'United States', 'SERVICE');
  b.share('FY26 common', fy, { DEU: 40, ITA: 35, USA: 25 });
  b.group('DLA', 'Defense Logistics Agency support');
  b.year('DLA', fy, { status: 'Active' });
  b.effort('DLA', fy, 'Warehousing', 1000000, 'FY26 common');
  b.effort('DLA', fy, 'Transportation', 400000, 'FY26 common');
  return b;
}

module.exports = { load, builder, standard, DEFAULT_NOW };
