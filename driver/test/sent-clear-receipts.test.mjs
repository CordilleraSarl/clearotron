// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// B4 structural guard — every `.sent`-clear site also clears the per-channel send receipts.
// The invariant: `.sent` and `_driver/send-receipts.json` are BOTH per-SEND state. Whenever the driver
// resets `.sent` to initiate a fresh send (delivery handoff, failure-notice path, runner pre-run
// backstop, capped self-resume), stale receipts from the superseded send would make prelim-deliver's
// step 2b skip channels of the NEW packet — a lost email, the mirror image of the duplicate-email bug.
// Grep-driven so a FUTURE `.sent`-clear site added without the paired receipts clear fails here, not in
// production: we scan the sources for every rmSync of ".sent" and require the receipts rm adjacent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = ["pipeline.mjs", "runner.mjs"];
// How many of these sites main has today (2 in pipeline.mjs, 2 in runner.mjs) — a floor, so the grep
// can never silently rot into matching nothing.
const KNOWN_SITES = 4;

test("every rmSync-of-.sent site clears _driver/send-receipts.json within the next 2 lines", () => {
  let sites = 0;
  for (const src of SOURCES) {
    const lines = readFileSync(join(HERE, "..", src), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/rmSync\([^)]*"\.sent"/.test(line)) return;   // .sentPath / ".postponed" etc. don't match
      sites++;
      const window = lines.slice(i, i + 3).join("\n");
      assert.ok(/rmSync\([^)]*"send-receipts\.json"/.test(window),
        `${src}:${i + 1} clears .sent but not send-receipts.json alongside:\n${window}`);
    });
  }
  assert.ok(sites >= KNOWN_SITES, `grep drifted: found ${sites} .sent-clear sites, expected >= ${KNOWN_SITES}`);
});
