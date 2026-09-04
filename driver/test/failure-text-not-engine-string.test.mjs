// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE DASHBOARD SHOWED A USER THE ENGINE'S OWN STRING.
//
// Verbatim from a failed card:
//
//     merged half-grids failed the canonical validator (connotation_undisposed:KIN-ZY wikipedia,
//     VENZ VET meaning slang, Вензи offensive meaning, Κίνζι meaning in english, Венза offensive
//     meaning (+1 more))
//
// A stage-internal concept, a validator enum, and six raw search queries in four scripts. The reader
// needs one fact: it failed, and it cannot be resumed from here.
//
// BUILT THE MAPPER AND ONE COMPONENT USED IT. `contract/failure.ts` exists for precisely this and
// was imported by RiskDot.tsx alone; `home.ts`'s `failed` branch returned `r.reason` and fell back to a
// good sentence only when the engine had said nothing — so the better the engine's diagnostics got, the
// worse the card read.
//
// THREE THINGS WERE WRONG, not one:
//   1. home.ts did not use the mapper.
//   2. THE MAPPER LEAKED THIS STRING ANYWAY. No FAIL_KINDS prefix matched, LOOKS_INTERNAL was false, and
//      at 124 characters it was inside the length floor — so `detail` returned the whole engine string.
//      Routing home.ts through it without this would have changed nothing.
//   3. The engine interpolated the open-set payload into the human sentence at the throw site, so no
//      renderer could separate them.
//
// BREAK MATRIX:
//   · the delivered string is recognised as internal   → break: narrow LOOKS_INTERNAL, arm 1 goes red
//   · a plain sentence still renders                   → break: over-widen it, arm 1 goes red
//   · the card says it cannot be resumed               → break: drop the clause, arm 2 goes red
//   · home.ts routes through the mapper                → break: return r.reason, arm 3 goes red
//   · the payload is its OWN field, throw to status    → break: re-interpolate, arm 4 goes red
//   · the convergence census survives the split        → break: drop the quantity stamp, arm 5 goes red
//   · a client session sees neither field              → break: redact reason only, arm 6 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StageFailure } from "../pipeline.mjs";
import { progressQuantity } from "../repairs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "..", rel), "utf8");
const live = (rel) => src(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join("\n");

// The string from the delivered card, shortened to the same shape. Synthetic marks.
const DELIVERED = "merged half-grids failed the canonical validator (connotation_undisposed:KIN-ZY wikipedia, VENZ VET meaning slang (+1 more))";
const PLAIN = "the register provider returned no results for three retries";

// LOOKS_INTERNAL is module-private, so it is read from source — the alternative is exporting a regex
// nothing else needs, and this test is about the regex itself.
function looksInternal(s) {
  const m = live("portal-ui/src/contract/failure.ts").match(/const LOOKS_INTERNAL = (\/.*\/)\s*$/m);
  assert.ok(m, "LOOKS_INTERNAL moved — this test reads it from source");
  // eslint-disable-next-line no-new-func
  return new Function("s", `return (${m[1]}).test(s)`)(s);
}

test("#614 arm 1 — the delivered string is recognised as internal; a plain sentence is not", () => {
  assert.ok(DELIVERED.length <= 140,
    "premise: it was INSIDE the length floor, which is why length alone never caught it");
  assert.equal(looksInternal(DELIVERED), true,
    "THE LEAK: no fail-token prefix, no path, no file extension, short enough — it rendered whole");
  assert.equal(looksInternal(PLAIN), false,
    "over-widening costs the reader the one case where the engine's own words help");
});

test("#614 arm 2 — the card says it cannot be resumed from here", () => {
  // The owner's actual requirement: "today a user cannot tell whether to wait or act". A paused run
  // resumes on its own; a recovering one is already retrying; a failed one is neither.
  const t = live("portal-ui/src/contract/failure.ts");
  assert.match(t, /It cannot be resumed from here\./,
    "the one thing on this card a reader can act on");
  // Both arms of the headline — with a known stage and without — must carry it.
  assert.equal((t.match(/It cannot be resumed from here\./g) ?? []).length, 2,
    "the unknown-stage fallback must say it too, or the worst-informed card is the quietest");
});

test("#614 arm 3 — home.ts routes `failed` through the mapper, like RiskDot does", () => {
  const t = live("portal-ui/src/contract/home.ts");
  assert.match(t, /readableFailure\(r\.failedStage, r\.reason\)\.headline/,
    "the failed branch returned the engine's string; every other branch is a written sentence");
  assert.ok(!/r\.reason \?\? 'It stopped before it finished\.'/.test(t),
    "the raw pass-through is gone, not merely wrapped");
  // 's own acceptance: more than one importer.
  //
  // EXTENSION-AGNOSTIC, and that is the point. This regex used to require the specifier to end at
  // `failure'` — so it counted the two importers that had OMITTED the `.ts` and silently skipped
  // RiskDot.tsx, which had it. Two matched, `> 1` passed, and the assertion certified the spelling that
  // makes home.test.ts fail to load under `node --test` (portal-ui/test/import-specifiers.test.ts).
  // A count of consumers must not depend on how each one spells the path to the same module.
  const importers = ["portal-ui/src/contract/home.ts", "portal-ui/src/components/RiskDot.tsx", "portal-ui/src/screens/Home.tsx"]
    .filter((f) => /from '\.[^']*\/?failure(?:\.ts)?'/.test(src(f)));
  assert.ok(importers.length > 1, `failure.ts must have more than one consumer, got ${importers.length}`);
});

test("#614 arm 4 — the payload is its own field, from the throw site to the status file", () => {
  const e = new StageFailure("common-law", "merged half-grids failed the canonical validator", undefined,
    { detail: "connotation_undisposed:KIN-ZY wikipedia", quantity: 6 });
  assert.equal(e.reason, "merged half-grids failed the canonical validator", "the sentence carries no payload");
  assert.equal(e.detail, "connotation_undisposed:KIN-ZY wikipedia", "…and the payload is beside it");
  assert.ok(!e.reason.includes("connotation_undisposed"), "THE ENGINE HALF: no interpolation at the throw site");

  const pl = live("driver/pipeline.mjs");
  assert.match(pl, /StageFailure\("common-law", "merged half-grids failed the canonical validator", undefined,\s*\{ failClass: clFailClass, detail: v\.reason, quantity: v\.quantity \}\)/,
    "the canonical-validator throw must pass the reason as `detail`, never inside the message");
  // moved the abbrev off the writeRunStatus literal into `reasonDetailField`, because the same
  // payload now goes to _driver/failure.json as well and the two sinks must not spell it two ways.
  // This arm still asserts the same two facts, one variable along: the catch DERIVES the field from
  // StageFailure.detail, and the terminal status write carries it beside `reason`.
  assert.match(pl, /const reasonDetailField = reasonDetail \?/, "…the run-level catch must derive the payload field from the throw's detail");
  assert.match(pl, /state: "failed"[\s\S]{0,600}?reasonDetail: reasonDetailField/, "…and write it beside `reason` in status.json");
});

test("#614 arm 5 — taking the census out of the message does NOT blind the convergence ledger", () => {
  // repairs.mjs reads the count out of the message prose. Move the payload without stamping `quantity`
  // and progressQuantity returns null, progress.kind becomes "unknown", and a run converging 29 → 11
  // reads as plateaued — its recovery ladder ends early, silently. added `quantity` for exactly
  // this: the site that KNOWS the count states it.
  const withPayload = "invalid_file:common-law.md:connotation_no_ruling:no_ruling=11;Q-ABCDEFGH [x]";
  assert.deepEqual(progressQuantity(withPayload), { token: "connotation_no_ruling", value: 11 },
    "premise: the ledger reads the census out of the text when it is there");
  // The sentence alone carries no census — which is the whole point, and why the stamp is required.
  assert.equal(progressQuantity("merged half-grids failed the canonical validator"), null);
  const e = new StageFailure("common-law", "merged half-grids failed the canonical validator", undefined,
    { detail: withPayload, quantity: 11 });
  assert.equal(e.quantity, 11,
    "the count must ride as its own field, or the ladder loses the only number it converges on");
});

test("#614 arm 6 — a client session sees neither the reason nor the payload", () => {
  const t = live("driver/portal-service.mjs");
  assert.match(t, /reason: CLIENT_FAILURE_NOTE, reasonDetail: null, reasonRedacted: true/,
    "the redaction must take the new field with it — a second field carrying the engine's raw words "
    + "would walk straight past the note that replaced the first");
  assert.match(t, /reasonDetail: s\.reasonDetail \?\? null/, "…and staff still get it");
});
