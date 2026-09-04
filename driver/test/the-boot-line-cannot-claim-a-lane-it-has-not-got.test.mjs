// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// (Leia's filing), criteria 1 and 2.
//
// The owner's 502: this boot line had been printing a confident sentence about the trigger lane for as
// long as the lane had been dead. It fired on PORTAL_OPS_TOKEN alone and described the token's posture
// in detail, so a reader grepping the journal for "trigger lane" found reassurance. PORTAL_MCP_URL had
// never been set on that box.
//
// READ STATICALLY, and that is a deliberate limit worth stating. Booting the portal to capture its log
// needs a listener, a store and a door; these arms assert the SHAPE of what the bootstrap can print,
// which is what criteria 1 and 2 are about. Whether the line appears in a real journal is criterion 3's
// question and belongs to live-surface-check, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "portal-service.mjs"), "utf8");

test("2123 the bootstrap can say NOT WIRED, and names which half is missing", () => {
  assert.match(SRC, /trigger lane: NOT WIRED/,
    "the bootstrap has no way to say the lane is unwired — which is the state the owner's 502 came from");
  assert.match(SRC, /PORTAL_MCP_URL.*&&.*PORTAL_OPS_TOKEN|missing\.join/s,
    "the unwired line must name WHICH variable is missing; 'not wired' alone sends a reader looking at both");
});

test("2123 the wired test requires BOTH halves — a token alone is not a lane", () => {
  const m = /const laneWired = ([^;]+);/.exec(SRC);
  assert.ok(m, "no single expression decides whether the lane is wired, so two callers can disagree");
  const expr = m[1];
  assert.match(expr, /MCP_URL/, "the address is not consulted — this is the defect exactly");
  assert.match(expr, /OPS_TOKEN/, "the token is not consulted");
  assert.match(expr, /&&/, "the two halves must BOTH hold; either alone is a half-wired lane");
});

test("2123 the token line cannot be read on its own as evidence of a working lane", () => {
  // A journal is skimmed by grepping one phrase, and "trigger lane" is the phrase. The token line is
  // still printed and still useful — what it must not do is carry that heading unqualified while the
  // other half is missing.
  assert.match(SRC, /trigger lane\$\{laneWired \? "" : " \(NOT WIRED — see above\)"\}: ops token/,
    "the token posture line is not qualified when the lane is dead, so grepping the journal for "
    + "'trigger lane' still returns a confident sentence about a lane that cannot carry a request");
});

test("2123 the remedy is in the line, not only the condition", () => {
  // The existing roster warning's shape, which criterion 2 asks this to match: name the condition, give
  // the fix. A reader on a box that launches the service directly has no way to guess the origin rule.
  const idx = SRC.indexOf("trigger lane: NOT WIRED");
  assert.ok(idx > 0);
  const block = SRC.slice(idx, idx + 900);
  assert.match(block, /clearotron start/, "it must say what normally sets the value");
  assert.match(block, /ORIGIN/, "and that the value is an origin — the /mcp mistake is the next one along");
});
