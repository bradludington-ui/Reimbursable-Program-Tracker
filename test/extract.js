'use strict';

/* ============================================================================
 * test/extract.js -- pull named chunks out of the single-file app.
 *
 * RPT ships as one HTML file, but it is WRITTEN as labelled chunks, each
 * opening with a banner comment naming the file it would be:
 *
 *     /* ======================================================== *\/
 *      * RPT / 04_model.js -- the domain. No DOM.
 *
 * 03_core.js and 04_model.js are deliberately free of DOM references at load
 * time, which is what lets them run in a bare VM. This module finds those
 * banners and hands back the source between them, so the suite tests the code
 * that actually ships rather than a copy that drifts.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

/* RPT_APP points the suite at a different build -- a candidate, or a copy
   mutated on purpose to check that these tests would actually catch a change. */
const APP = process.env.RPT_APP || path.join(__dirname, '..', 'Reimbursables_Program_Tracker.html');

const BANNER_RULE = /^\/\* ={10,}\s*$/;
const BANNER_NAME = /^ \* RPT \/ (\d+)_([A-Za-z]+)\.js\b/;

/* The app's script lives in the last <script> of the body. Taking the file
   wholesale would feed HTML to the VM; taking a fixed line range would rot the
   moment a line is added above it. */
function appScript(html) {
  const lines = html.split('\n');

  /* Walk the script blocks in order and take the one whose OWN bounds contain
     chunk banners. Scanning a fixed window from each <script> instead would
     overrun into the next block -- the theme script in <head> is nine lines
     long, and a window wide enough to be useful reaches straight past it. */
  for (let i = 0; i < lines.length; i++) {
    if (!/^<script>\s*$/.test(lines[i])) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^<\/script>\s*$/.test(lines[j])) { end = j; break; }
    }
    if (end < 0) throw new Error('unterminated <script> block at line ' + (i + 1));
    for (let j = i + 1; j < end; j++) {
      if (BANNER_NAME.test(lines[j])) return { lines, start: i + 1, end };
    }
    i = end;
  }
  throw new Error('no <script> block containing RPT chunk banners');
}

/* Returns [{ name, file, code, line }] in file order. */
function chunks(html) {
  const { lines, start, end } = appScript(html);
  const marks = [];
  for (let i = start; i < end; i++) {
    if (BANNER_RULE.test(lines[i]) && BANNER_NAME.test(lines[i + 1] || '')) {
      const m = BANNER_NAME.exec(lines[i + 1]);
      marks.push({ at: i, file: `${m[1]}_${m[2]}.js`, name: m[2] });
    }
  }
  if (!marks.length) throw new Error('no RPT chunk banners found');

  return marks.map((mk, i) => {
    const to = i + 1 < marks.length ? marks[i + 1].at : end;
    return {
      name: mk.name,
      file: mk.file,
      line: mk.at + 1,                 /* 1-indexed, for stack traces */
      code: lines.slice(mk.at, to).join('\n')
    };
  });
}

function readApp() {
  return fs.readFileSync(APP, 'utf8');
}

/* The two chunks the suite runs. Named rather than indexed: inserting a chunk
   above them must not silently change what is under test. */
function modelChunks() {
  const all = chunks(readApp());
  const want = ['core', 'model'];
  return want.map((n) => {
    const c = all.find((x) => x.name === n);
    if (!c) {
      throw new Error(
        `chunk "${n}" not found in the app file. Banners present: ` +
        all.map((x) => x.file).join(', ')
      );
    }
    return c;
  });
}

module.exports = { APP, chunks, readApp, modelChunks };
