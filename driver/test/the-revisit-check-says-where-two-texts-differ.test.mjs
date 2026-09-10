// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The revisit check's text pair says WHERE two visits differ, not only that they do.
//
// It went red once on CI with "the screen renders the same text on both visits", printed neither text,
// and did not reproduce, so how the two differed was lost. A pair of lengths would not have saved it:
// two texts of one length that differ in one word print alike. So the failure line carries the first
// differing offset and a window of each side. These arms hold the helper directly, and the one line in
// the check that uses it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { textDifference } from "../../scripts/text-difference.mjs";

const SCREEN = "Clearances\nAcme · 2 clearances\nAllowance: 3 of 10 used this month";

test("equal texts have no difference to report", () => {
  assert.equal(textDifference(SCREEN, SCREEN), null);
});

test("one word changed at the same length is named on both sides, with its offset", () => {
  const other = SCREEN.replace("Acme", "Zeta");
  assert.equal(other.length, SCREEN.length, "the case a pair of lengths cannot tell apart");
  const d = textDifference(SCREEN, other);
  assert.ok(d.startsWith(`first differs at character 11 (lengths ${SCREEN.length} and ${SCREEN.length})`), d);
  assert.match(d, /visit 1 "[^"]*Acme[^"]*"/, d);
  assert.match(d, /visit 2 "[^"]*Zeta[^"]*"/, d);
});

test("a text that stops short shows where, and what the other went on to say", () => {
  const d = textDifference("Clearances", "Clearances\nAcme");
  assert.ok(d.startsWith("first differs at character 10 (lengths 10 and 15)"), d);
  assert.match(d, /visit 2 "[^"]*\\nAcme"/, "the continuation is printed, and its newline shows");
});

test("a long text is windowed to one short line that still holds the word", () => {
  const pad = "x".repeat(300);
  const d = textDifference(`${pad} Acme ${pad}`, `${pad} Zeta ${pad}`);
  assert.ok(d.length < 220, `one short line, not the whole text: ${d.length} characters`);
  assert.match(d, /visit 1 "…x+ Acme x+…"/, d);
  assert.match(d, /visit 2 "…x+ Zeta x+…"/, d);
});

test("the check's text pair prints the difference when it fails, from one call site", () => {
  // Wiring, held at its one call site. The drive in a real browser is what proves the line reads as it
  // should; this keeps the call from being dropped quietly on the next edit near it.
  const src = readFileSync(new URL("../../scripts/revisit-render-check.mjs", import.meta.url), "utf8");
  assert.match(src, /^import \{ textDifference \} from '\.\/text-difference\.mjs'/m);
  const calls = src.match(/textDifference\(/g) ?? [];
  assert.equal(calls.length, 1, `one call site, found ${calls.length}`);
  assert.match(src, /the screen renders the same text on both visits\$\{sameText \? '' : ` — \$\{textDifference\(t1, t2\)/);
});
