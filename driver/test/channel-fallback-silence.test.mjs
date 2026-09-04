// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE GENERIC-PROFILE CHANNEL FALLBACK SAID NOTHING, FOUR DIFFERENT WAYS.
//
// `channelsFromMatterContext` returned `[]` for four distinct facts, and pipeline.mjs's generic branch
// had no else — so all four fell through to the profile's platforms identically and in silence:
//
//   no-document   no matter-context file to read — we could not look
//   no-line       the file is there and carries no "Search channels:" line — the seat never answered
//   all-rejected  the seat DID answer and every value was discarded for not being domain-shaped
//                 ("Amazon marketplace", "the App Store") — the expensive one, because in the record it
//                 reads exactly like a considered "none"
//   named         channels were named and are used
//
// THE FALLBACK ITSELF IS DELIBERATE AND STAYS. Its comment — "frame named none ⇒ keep the profile
// default, never worse" — is a real decision and nothing here overrides it. What changes is that the
// run can now say WHICH of the four happened. "The frame named none" is a decision; "we could not read
// the line" is not; and only one of them is a clean. Collapsing them is the ENOENT-is-not-EACCES shape:
// an absence that cannot say why is indistinguishable from a choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { channelsDiagnosis, channelsFromMatterContext, CHANNEL_STATES } from "../scope-ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const CASES = {
  "no-document": "",
  "no-line": "## Client and sector\n\nProse, but no channels line anywhere.",
  "all-rejected": "Search channels: Amazon marketplace, the App Store",
  named: "Search channels: amazon.com, etsy.com",
};

test("each of the four facts gets its own state", () => {
  for (const [want, md] of Object.entries(CASES)) {
    assert.equal(channelsDiagnosis(md).state, want, `"${md.slice(0, 40)}" should read as ${want}`);
  }
  assert.deepEqual([...CHANNEL_STATES].sort(), Object.keys(CASES).sort(),
    "a state exists that no case covers, or a case exists for a state that is gone");
});

test("NOTHING MOVES: the channels returned are byte-identical to the old function, in every state", () => {
  // The whole safety argument in one assertion. This adds a reason, never a verdict — if any case
  // returned different channels, the change would be altering which platforms a real run searches.
  for (const [state, md] of Object.entries(CASES)) {
    assert.deepEqual(channelsFromMatterContext(md), channelsDiagnosis(md).channels, `${state}: channels must not move`);
  }
  // …and the domain filter still does its job, which is what makes all-rejected a real category.
  assert.deepEqual(channelsFromMatterContext("Search channels: amazon.com, the App Store, web"), ["amazon.com", "web"]);
});

test("all-rejected carries WHAT was rejected, because that is the operator's next question", () => {
  const d = channelsDiagnosis(CASES["all-rejected"]);
  assert.deepEqual(d.rejected, ["Amazon marketplace", "the App Store"]);
  assert.deepEqual(d.channels, []);
  assert.equal(d.offered.length, 2, "the seat's answer is preserved — it answered, and the answer was unusable");
});

test("a line with an EMPTY tail is all-rejected, not no-line — the seat did write it", () => {
  // Same effect, different cause. Reporting it as no-line would say the seat never answered, which is
  // false, and would send anyone diagnosing it to the wrong prompt.
  const d = channelsDiagnosis("Search channels:   ");
  assert.equal(d.state, "all-rejected");
  assert.deepEqual(d.offered, []);
});

test("a partly-usable line is NAMED, not all-rejected — one good channel is not a failure", () => {
  const d = channelsDiagnosis("Search channels: Amazon marketplace, etsy.com");
  assert.equal(d.state, "named");
  assert.deepEqual(d.channels, ["etsy.com"]);
  assert.deepEqual(d.rejected, ["Amazon marketplace"], "…and the discarded value is still reported");
});

test("the diagnosis is WIRED into the fallback — not merely exported", () => {
  // Presence is not firing. The function could be complete and tested while pipeline.mjs still called
  // the old one and every real run stayed silent.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /const diag = channelsDiagnosis\(matterMd\)/, "the generic branch no longer calls the diagnosis");
  // The runLog calls are bound to the RUN-DIR NAME THAT EXISTS IN THAT SCOPE. deriveGridSpec destructures
  // `const P = ctx.paths` and has no `run` binding at all — my first cut wrote `runLog(run.runDir, …)`,
  // which is a ReferenceError the moment a generic-profile run reaches an empty channels line. NOTHING
  // in this repo would have caught it: the driver has no typecheck (CI typechecks portal-ui only), the
  // function is not exported so the branch cannot be executed from a test, and the assertions in this
  // file read SOURCE. Caught by reading the enclosing scope, which is not a method that scales — the
  // gap is reported separately. This assertion is the narrow guard: the call must name P.runDir.
  assert.match(src, /runLog\(P\.runDir, \{ event: "commonlaw-channels-unusable"/, "the all-rejected runLog is missing or names a binding this scope does not have");
  assert.match(src, /runLog\(P\.runDir, \{ event: "commonlaw-channels-unstated"/, "the unstated runLog is missing or names a binding this scope does not have");
  assert.doesNotMatch(src, /runLog\(run\.runDir, \{ event: "commonlaw-channels/, "`run` is not in deriveGridSpec's scope — this throws on the first real run that reaches it");
  assert.doesNotMatch(src, /channelsFromMatterContext/, "the old silent call is still in pipeline.mjs");
  // The else that did not exist: every empty state must now reach a note.
  assert.match(src, /\} else if \(diag\.state === "all-rejected"\) \{[\s\S]{0,600}?\} else \{/,
    "the branch has lost its else — an empty result would fall through silently again");
});
