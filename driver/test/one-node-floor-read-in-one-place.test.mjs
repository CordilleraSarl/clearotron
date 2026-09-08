// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// One Node floor, in one place — tracker issue 364.
//
// The check this replaces compared the MAJOR alone, so it passed every 22.x. The engine imports
// `node:sqlite`, which is not a built-in module before 22.13.0, so on 22.0 through 22.12 the install
// succeeded, the configuration check said `ok node 22.x`, and the first search failed with
// ERR_UNKNOWN_BUILTIN_MODULE — a Node problem wearing a product problem's clothes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { declaredRange, floorOf, meetsFloor, partsOf, nodeFloorVerdict } from "../../shared/node-floor.mjs";

test("364 the floor is READ from the manifest, never restated", () => {
  const declared = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).engines.node;
  assert.equal(declaredRange(), declared, "the module must answer with the manifest's own range");
});

test("364 a MAJOR-ONLY comparison is what let 22.12 through, and this does not repeat it", () => {
  const floor = floorOf(">=22.13.0");
  assert.equal(meetsFloor("22.12.0", floor), false, "22.12 carries no node:sqlite and must be refused");
  assert.equal(meetsFloor("22.13.0", floor), true, "the floor itself is supported");
  // BOTH SPELLINGS, AND THE REFUSAL IS THE HALF THAT MATTERS. `process.versions.node` has no prefix
  // and `process.version` does. Asserting only that a prefixed CURRENT version passes is satisfied by a
  // reader that cannot parse the prefix at all — unreadable passes, so the arm goes green while the
  // guard waves through every prefixed old runtime. Measured: with the prefix unhandled,
  // meetsFloor("v20.19.0") returned true.
  assert.equal(meetsFloor("v22.23.2", floor), true, "a leading v is the shape process.version uses");
  assert.equal(meetsFloor("v20.19.0", floor), false, "and a PREFIXED old version must still be refused");
  assert.deepEqual(partsOf("v22.23.2"), [22, 23, 2], "the prefix is parsed, not merely tolerated");
  assert.equal(meetsFloor("23.0.0", floor), true);
  assert.equal(meetsFloor("20.19.0", floor), false);
});

test("364 22.9 is not above 22.13 — the comparison is numeric, not lexical", () => {
  // A string compare puts "22.9" after "22.13", which is the classic way a floor check passes the
  // versions it exists to stop.
  assert.equal(meetsFloor("22.9.0", floorOf(">=22.13.0")), false);
});

test("364 the shipped floor is at or above the release that carries node:sqlite", () => {
  // Measured 2026-09-08: absent in 22.4.1, 22.5.0 (flagged only), 22.10.0, 22.11.0 and 22.12.0;
  // unflagged from 22.13.0. A floor below that ships the failure this issue is about.
  const [maj, min] = floorOf(declaredRange());
  assert.ok(maj > 22 || (maj === 22 && min >= 13), `the declared floor ${declaredRange()} is below 22.13.0`);
});

test("364 a RUNNING version this cannot read is a PASS, and the DECLARED range is not", () => {
  // The two unreadables point opposite ways on purpose. A version string this parser does not
  // understand must not be the reason an install fails — that turns a parser gap into an outage on a
  // Node that is probably fine. Our own manifest is the other case: unreadable there is a real defect.
  const floor = floorOf(">=22.13.0");
  assert.equal(meetsFloor("not-a-version", floor), true, "an unreadable running version passes");
  assert.equal(meetsFloor("", floor), true);
  assert.throws(() => floorOf("^22.13.0"), /does not understand/, "a caret range is guessed at by nobody");
});

test("364 the reader takes every spelling of the floor we might write, and guesses at none", () => {
  // Written down because the number is now in one place and whoever edits it should not have to know
  // which spelling the readers accept. All three short forms mean the same floor.
  assert.deepEqual(floorOf(">=22"), [22, 0, 0]);
  assert.deepEqual(floorOf(">=22.13"), [22, 13, 0]);
  assert.deepEqual(floorOf(">=22.13.0"), [22, 13, 0]);
  // A caret or tilde would have to be guessed at, and a floor read wrongly passes every version
  // rather than failing loudly — so it throws instead.
  assert.throws(() => floorOf("^22.13.0"), /does not understand/);
  assert.throws(() => floorOf(undefined), /does not understand/);
});

test("364 the install gate names the version, the requirement and the one command", () => {
  // The gate is the thing a person meets, so its text is what is asserted — not a helper's string.
  const src = readFileSync(new URL("../../scripts/preinstall-node-check.mjs", import.meta.url), "utf8");
  assert.match(src, /nvm install 22/, "the command that fixes it");
  assert.match(src, /Nothing has been installed/, "that the tree was not touched");
  assert.match(src, /nodejs\.org/, "the route for someone without nvm");
  const v = nodeFloorVerdict({ current: "20.19.0" });
  assert.equal(v.ok, false);
  assert.match(String(v.current), /20\.19\.0/, "what they are running");
  assert.ok(v.required, "what is needed");
});
