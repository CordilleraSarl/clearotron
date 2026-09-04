// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The one sentence a human reads about a degraded shadow lane must carry the loss and its cause.
//
// An R1 scenario run on 2026-08-13 delivered this to an operator watching it live:
//
//   jx serp grid degraded (42/42 cells gapped) — attempt 1/3; shadow-only, the run is unaffected
//
// while `_driver/jx/units.json` beside it held:
//
//   degradedCause: 42/42 cells gapped — below the coverage floor; a resume retries.
//                  Dominant cause (42/42): SerpAPI 429: {"error": "Your account has run out of searches."}
//
// The discriminator reached a field and not the sentence. An operator learned a headline capability
// had produced nothing and could not learn that the fix was a subscription top-up — five minutes'
// work for somebody with the account. That is 's principle one layer down, and it cost real
// verification time before anybody read the field.
//
// These assertions are against the STRING the module emits, not against a mock of it, because the
// defect was never in the logic — every branch worked. It was in the words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "jx-units.mjs"), "utf8");

// The composer is module-private on purpose — nothing outside this file should compose one of these
// notices — so it is exercised by reading it out of the source rather than by exporting it purely to
// be tested, which would make the export the API and the privacy a lie.
const composer = (() => {
  const m = SRC.match(/const shadowLaneNote = ([\s\S]*?);\n\n/);
  assert.ok(m, "shadowLaneNote must exist and be a single expression — the whole point is ONE composer");
  // eslint-disable-next-line no-new-func
  return new Function("redactProviderCause", `return ${m[1]}`)(
    (s) => String(s).replace(/api_key=[^&\s]*/gi, "api_key=[redacted]"));
})();

test("#525/#848 the note carries the provider's verbatim cause, not just the ratio", () => {
  const line = composer("jx serp grid", "degraded",
    '42/42 cells gapped: SerpAPI 429: {"error": "Your account has run out of searches."}', "attempt 1/3");
  assert.match(line, /42\/42 cells gapped/, "the loss");
  assert.match(line, /run out of searches/,
    "and WHY — the field had this the whole time and the sentence dropped it");
});

test("#848 'unaffected' cannot describe a degraded capability, in any of the four notices", () => {
  // Ruled 2026-08-13: the word may describe the pipeline's continuation and nothing else. Asserted
  // against the SOURCE rather than one composed string, because the defect was one literal out of
  // four drifting — checking the composer alone would pass while a fifth literal reintroduced it.
  const emitted = SRC.split("\n")
    .filter((l) => /\bnote\(/.test(l) && !l.trim().startsWith("//"));
  for (const l of emitted) {
    assert.ok(!/unaffected/.test(l),
      `a notice line still calls a degraded lane unaffected, which is true of the pipeline and false `
      + `of the answer: ${l.trim()}`);
  }
  assert.ok(emitted.length >= 4, `expected every notice site to be checked, saw ${emitted.length}`);
});

test("#525 the cause is redacted on the way into the sentence, as it is into the record", () => {
  const line = composer("jx serp grid", "degraded",
    "SerpAPI 401: https://serpapi.com/search?q=x&api_key=SECRETVALUE123", "attempt 2/3");
  assert.ok(!line.includes("SECRETVALUE123"),
    "this string reaches stderr, journals and pasted issue comments — the same exposure the record has");
  assert.match(line, /api_key=\[redacted\]/);
});

test("DEGRADED and NOT RUN stay distinguishable — one word must not stand for both", () => {
  const ran = composer("jx serp grid", "degraded", "42/42 cells gapped: provider down", "attempt 1/3");
  // The reason a lane can carry today, not the deleted per-slice arm: item 8 left CLEAROTRON_NATIVE_LANGUAGE_ZH
  // as the only switch that can make a slice NOT RUN, so that is the cause the composer is handed.
  const never = composer("jx serp grid", "NOT RUN", "CLEAROTRON_NATIVE_LANGUAGE_ZH off", "never-kill");
  assert.match(ran, /degraded/);
  assert.match(never, /NOT RUN/);
  assert.notEqual(ran.replace(/degraded/, ""), never.replace(/NOT RUN/, ""),
    "a grid that ran and gapped has a provider cause and a retry ahead of it; a lane that never "
    + "started has neither, and the old strings blurred them");
});

test("the continuation is subordinate, and says what the REPORT will have to say", () => {
  const line = composer("jx nativeread", "degraded", "provider timeout", "attempt 3/3");
  assert.ok(line.indexOf("provider timeout") < line.indexOf("run continues"),
    "the loss leads; the continuation follows it");
  assert.match(line, /coverage will be reported as limited/,
    "a shadow lane that produced nothing still changes what the answer can claim, and the operator "
    + "is told that rather than told the run is fine");
});
