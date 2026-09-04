// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the sandbox token list, as a unit. The BROWSER half is scripts/report-frame-check.mjs, and it
// is a separate thing on purpose: `sandbox` is a DOMTokenList and a browser silently DROPS a token it
// does not recognise, so `allow-popups-to-escape-sandbox` misspelled by one character greps clean,
// renders without error, and quietly restores the bug. Only a browser knows which tokens survived.
//
// What IS unit-testable is that the shipped attribute still carries what the report frame needs and
// still refuses what it must — read out of the file that ships it, so a future edit to Result.tsx has
// to come past this.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { shippedSandbox, REQUIRED, FORBIDDEN } from "../../scripts/report-frame-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(ROOT, "portal-ui", "src", "screens", "Result.tsx"), "utf8");

test("the shipped sandbox is read from the file that ships it, not transcribed here", () => {
  const tokens = shippedSandbox(SRC);
  assert.ok(tokens.length >= 3, `expected a real token list, got ${JSON.stringify(tokens)}`);
});

test("#705 the frame allows what an evidence link needs", () => {
  const tokens = shippedSandbox(SRC);
  for (const t of REQUIRED) assert.ok(tokens.includes(t), `${t} is what makes an evidence link clickable`);
});

test("THE BOUNDARY THAT MUST NOT WIDEN — allow-same-origin retires stored XSS for every delivered report", () => {
  // reportFrame.ts's argument stands: no allow-same-origin, ever. A future widening to make some link
  // work would pass every other test in this repo. allow-top-navigation is refused for the same family
  // of reason — the home link opens a tab instead (render.mjs homeButton).
  const tokens = shippedSandbox(SRC);
  for (const t of FORBIDDEN) assert.ok(!tokens.includes(t), `${t} must never be in the report frame's sandbox`);
});

test("the parser is honest about an absent attribute", () => {
  assert.deepEqual(shippedSandbox(""), []);
  assert.deepEqual(shippedSandbox(null), []);
});
