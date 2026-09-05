// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The citation guard's exemption table reaches all three of its walks.
//
// THE DEFECT. EXEMPT_TARGETS' own header says "PLANTED DATA IS EXEMPT WHATEVER IT RESOLVED TO", and
// that sentence was written when the resolver's `unresolved &&` guard made the table unreachable for a
// planted path whose basename collided with a real file. The three later walks — symbolCitationMisses,
// symbolMisses, structuralMisses — never consulted the table at all, so a planted path that resolves
// EXACTLY was still judged as a claim about this repository.
//
// HOW IT SURFACED. portal-service.test.mjs feeds its parser a synthetic stack trace,
// "TypeError: x is not a function at /srv/app/driver/pipeline.mjs:2411:9". The house rule for fixtures
// is a /srv/… path rather than a real /home/<name>/ one, and the resolver strips the prefix and lands
// on the real driver/pipeline.mjs. So the fixture passed for as long as whatever line it happened to
// name was real code, and reported BLANK the first time an unrelated edit made line 2411 a brace. A
// guard whose findings are luck is what this script's own note says it must never be.
//
// The line number in planted data is the DATUM a test feeds its parser, never an assertion about this
// tree, so no span of it is checkable and reporting one is a false positive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralMisses, symbolMisses, symbolCitationMisses } from "../../scripts/citation-line-check.mjs";

// A file whose cited line IS blank — the condition every walk below would otherwise report.
const readLines = () => ["const a = 1;", "", "}", "  ", "const b = 2;"];
const ships = () => true;

const cite = (over = {}) => ({
  from: "driver/test/portal-service.test.mjs",
  atLine: 1300,
  cited: "srv/app/driver/pipeline.mjs",   // planted: the synthetic deployment trace
  path: "driver/pipeline.mjs",            // what the resolver stripped it down to
  start: 2, end: 3,                       // a span that is blank + a lone brace
  state: "exact",
  ...over,
});

test("a planted path is not reported for a blank span — it resolves EXACTLY, which is the whole trap", () => {
  const { misses } = structuralMisses([cite()], readLines, ships);
  assert.deepEqual(misses, [],
    "the exemption table must be consulted here, not only under `unresolved`");
});

// The positive control. Without it, a walk that silently returned nothing would pass the arm above.
test("a REAL citation with the same blank span IS still reported", () => {
  const real = cite({ cited: "driver/pipeline.mjs", from: "driver/stages.mjs" });
  const { misses } = structuralMisses([real], readLines, ships);
  assert.equal(misses.length, 1, "the guard must still catch a genuine stale citation — this is not a blanket off-switch");
  assert.equal(misses[0].cited, "driver/pipeline.mjs");
});

// The class, not the instance: all three walks share the guard and all three had the defect.
test("every walk consults the table, not just the one that surfaced the bug", () => {
  for (const [name, fn] of [["symbolMisses", symbolMisses], ["symbolCitationMisses", symbolCitationMisses]]) {
    const planted = cite({ symbols: ["somethingGone"], symbol: "somethingGone" });
    const out = fn([planted], readLines);
    const rows = Array.isArray(out) ? out : (out?.misses ?? []);
    assert.deepEqual(rows, [], `${name} must skip planted data too — the table says WHATEVER it resolved to`);
  }
});

test("other planted namespaces keep working through the same path", () => {
  for (const cited of ["planted/nope.mjs", "driver/x.mjs", "diffcase-keep.mjs", "driver/driftcase-target.mjs"]) {
    const { misses } = structuralMisses([cite({ cited })], readLines, ships);
    assert.deepEqual(misses, [], `${cited} is a declared planted namespace`);
  }
});

test("the srv/app entry is namespaced — it cannot swallow a genuine citation", () => {
  // Nothing in this repository ships under srv/, so the prefix is safe; a wider one would not be.
  for (const cited of ["srv/other/thing.mjs", "driver/srv/app/thing.mjs", "usr/app/driver/pipeline.mjs"]) {
    const { misses } = structuralMisses([cite({ cited, path: "driver/pipeline.mjs" })], readLines, ships);
    assert.equal(misses.length, 1, `${cited} is NOT the planted namespace and must still be judged`);
  }
});
