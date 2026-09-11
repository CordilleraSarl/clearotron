// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A READ THE ENGINE COULD NOT ANSWER NAMES THE CHECK, AND SAYS "JUST NOW" ONLY WHEN IT IS TRUE.
//
// On a published beta (2026-09-11), a fresh install whose engine was not signed in answered "Describe it"
// with "The reader could not reach the engine just now". The cause, a sign-in, is one no retry changes, so
// the sentence sent a stranger back to the button. With the engine signed in, the same brief filled the
// form: only the failure's wording was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { engineFailureMessage, makeComposeReader } from "../compose-read.mjs";
import { browserCommand } from "../../shared/invocation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RETRY = /just now|try again|shortly|in a moment/i;

test("an engine turn that failed for a lasting reason names the check, and promises nothing", async () => {
  const read = makeComposeReader({ checkCommand: "npx clearotron@0.3.0 doctor --probe-engine",
    turn: async () => ({ ok: false, cause: "the engine turn did not complete cleanly (code 1, status error)" }) });
  const out = await read("a quick check on ZENTORVIK for a bicycle repair app");
  assert.equal(out.error, "engine", "the route still keys its 502 on this word");
  assert.match(out.message, /could not be read/);
  assert.ok(out.message.includes("`npx clearotron@0.3.0 doctor --probe-engine`"), out.message);
  assert.match(out.message, /set the search up below/);
  assert.doesNotMatch(out.message, RETRY);
});

test("a rate limit is the one failure said to pass, with its reset time when there is one", () => {
  const limited = engineFailureMessage({ rateLimited: true, resetsAt: "2026-09-11T22:00:00.000Z" });
  assert.match(limited, /just now/);
  assert.match(limited, /22:00 UTC/);
  assert.doesNotMatch(engineFailureMessage({ rateLimited: true }), /resets at/, "no reset time is invented");
  // THE CONTROL: the same message builder, no rate limit, says no such thing.
  assert.doesNotMatch(engineFailureMessage({ cause: "anything" }), RETRY);
  assert.match(engineFailureMessage({}), /`clearotron doctor --probe-engine`/, "a reader built with no command still names the check");
});

test("the engine's rate limit reaches the reader as a flag, not only as a sentence", () => {
  const src = readFileSync(join(ROOT, "driver", "engine", "jx-turn.mjs"), "utf8");
  assert.match(src, /cause: "the engine turn was rate-limited", rateLimited: true, resetsAt: tuple\?\.signals\?\.resetsAt \?\? null,/);
});

test("the portal hands the reader the check as the reader types it, with no path of this machine", () => {
  const src = readFileSync(join(ROOT, "driver", "portal-service.mjs"), "utf8");
  assert.match(src, /makeComposeReader\(\{ turn: runner\.turn, checkCommand: browserCommand\("doctor --probe-engine"\) \}\)/);
  const cmd = browserCommand("doctor --probe-engine");
  assert.match(cmd, /doctor --probe-engine$/);
  assert.doesNotMatch(cmd, /\/home\/|\/Users\/|\/tmp\/|[A-Za-z]:\\/, `a machine path reached the page: ${cmd}`);
});
