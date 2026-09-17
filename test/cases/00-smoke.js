'use strict';

/* The promise 03_core.js opens with: nothing touches the DOM at load time. If
   that ever stops being true this is the test that says so, before any of the
   arithmetic tests produce a confusing cascade. */

module.exports = ({ describe, test, ok, eq, load }) => {
  describe('loading the model without a browser', () => {

    test('both chunks load in a context with no document and no window', () => {
      const RPT = load();
      ok(RPT, 'RPT should exist after loading core and model');
      eq(typeof RPT.sharePct, 'function', 'the model chunk should have loaded too');
    });

    test('the loaded build is the schema the model expects', () => {
      const RPT = load();
      eq(RPT.SCHEMA, 7, 'SCHEMA drives every migration branch; a bump needs new tests');
      eq(RPT.EMPTY().v, RPT.SCHEMA, 'a fresh state should claim the current schema');
    });

    test('state starts empty and each load is isolated from the last', () => {
      const a = load();
      a.addCustomer({ code: 'X', name: 'X', kind: 'OTHER', active: true });
      eq(a.state.customers.length, 1);
      const b = load();
      eq(b.state.customers.length, 0, 'a second load must not see the first load\'s fixtures');
    });

    test('touch() survives having no localStorage to write to', () => {
      const RPT = load();
      RPT.touch();
      ok(RPT.state.saved, 'touch should still stamp the state');
      eq(RPT.lsWrite(), false, 'and report honestly that nothing was persisted');
    });
  });
};
