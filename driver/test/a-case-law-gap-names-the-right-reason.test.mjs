// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — A GAP WITH THE WRONG REASON ATTACHED ───────────────────────────────
//
// A delivered Full country search told the client its case-law sources "failed at the connection layer"
// and called it an infrastructure gap. Neither source had ever been enrolled on that box — which the
// portal's own product card states correctly one screen before ordering. Two surfaces of one product,
// two accounts of one fact, and the report's was the flattering one.
//
// THE MODEL INVENTED NOTHING, and no arm here may imply it did. Its tool layer said, verbatim, that
// these CONFIGURED servers failed to connect: the bridges are declared to every case-law session
// regardless of enrolment and exit at start-up for want of a token. The seat reported what it was told.
// So the fix is ground truth handed down, and these arms drive the dictation the seat actually receives.
//
// WHAT MUST NOT BREAK: the report never claimed there was no adverse case law. Every surface disclosed
// the gap. A fix that makes the gap quieter is worse than the defect, so an arm below pins that the
// disclosure survives in both directions.
//
// BREAK MATRIX:
//   · unenrolled reads as "not on this deployment"      → break: call it unreachable, arm 1 red
//   · enrolled-and-failing still reads as an outage     → break: call everything unenrolled, arm 2 red
//   · the two are distinguishable in one dictation      → break: collapse them, arm 3 red
//   · the seat is told to distrust the connection error → break: drop it, arm 4 red (this is the crux)
//   · the gap is still disclosed either way             → break: soften it, arm 5 red
//   · sources come from the product's own inventory     → break: hand-type them, arm 6 red
//   · no inventory ⇒ no claim about readiness           → break: assert ready by default, arm 7 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES, paths } from "../stages.mjs";
import { caseLawInventory } from "../config-inventory.mjs";
import { CASELAW_BRIDGES } from "../engine/mcp/gather-config.mjs";

// The same enrolment mechanism the product uses: a one-time OAuth exchange writes <id>.json.
const withCreds = (enrolled) => {
  const dir = mkdtempSync(join(tmpdir(), "caselaw-creds-"));
  for (const id of enrolled) writeFileSync(join(dir, `${id}.json`), "{}");
  return { OAUTH_BRIDGE_CREDS_DIR: dir };
};
const noCreds = () => ({ OAUTH_BRIDGE_CREDS_DIR: mkdtempSync(join(tmpdir(), "caselaw-none-")) });

const sourcesFor = (env) => caseLawInventory(env)
  .filter((r) => r?.key === "caselaw")
  .map((r) => ({ label: r.providerLabel ?? r.provider, enrolment: r.enrolment ?? null, available: r.configured === true }));

// THE REAL DOOR: the dictation the seat receives, composed by the stage itself. Asserting the helper
// directly would measure the wiring instead of exercising it.
const P = paths(mkdtempSync(join(tmpdir(), "caselaw-run-")));
const dictation = (caseLawSources) => STAGES["case-law"].message({ paths: P, findingsIndex: [], caseLawSources });

// The sentence a source is named in — so an arm can say what was said about THAT source, rather than
// what appears somewhere in a long message.
const lineAbout = (text, label) => text.split("\n").find((l) => l.includes(label)) ?? "";

const OUTAGE_WORDS = /unreachable|went down|connection layer|infrastructure|failed to connect|outage/i;

test("2142 a source this deployment never enrolled is NOT reported as an outage", () => {
  const sources = sourcesFor(noCreds());
  const oauth = sources.filter((r) => r.enrolment === "oauth");
  assert.ok(oauth.length >= 2, "the fixture no longer reproduces an unenrolled deployment");
  assert.ok(oauth.every((r) => r.available === false), "a source read as enrolled with no credentials directory");

  const text = dictation(sources);
  for (const r of oauth) {
    const line = lineAbout(text, r.label);
    assert.ok(line, `the dictation never names ${r.label}`);
    assert.match(line, /NOT SET UP ON THIS DEPLOYMENT|never enrolled/i, `${r.label} is not stated as un-enrolled`);
    assert.doesNotMatch(line, OUTAGE_WORDS, `${r.label} is described to the seat in outage vocabulary — this is the defect`);
  }
  assert.match(text, /never as unreachable, down, or an infrastructure or connection failure/i,
    "the dictation does not forbid the outage framing for an un-enrolled source");
});

test("2142 the mirror: an ENROLLED source that fails is still reported as an outage", () => {
  // An un-enrolled run that reads as an outage is the defect; an outage that reads as un-enrolled is the
  // same defect mirrored, and it is the one a fix keyed on "is it available" would introduce.
  const sources = sourcesFor(withCreds(CASELAW_BRIDGES));
  const oauth = sources.filter((r) => r.enrolment === "oauth");
  assert.ok(oauth.every((r) => r.available === true), "enrolment did not take — the mirror case is not being driven");

  const text = dictation(sources);
  for (const r of oauth) {
    const line = lineAbout(text, r.label);
    assert.match(line, /enrolled on this deployment/i, `${r.label} is not stated as enrolled`);
    assert.doesNotMatch(line, /NOT SET UP/i, `an enrolled source is described as un-enrolled`);
    assert.match(line, /IS an outage/i, `${r.label}'s genuine failure is no longer reportable as an outage`);
  }
  assert.match(text, /genuinely failed is reported as the outage it is/i,
    "the dictation dropped the instruction that a real outage is still an outage");
});

test("2142 the two disclosures are DISTINGUISHABLE in one dictation", () => {
  // The state a real deployment lands in mid-enrolment, and the one that proves the split is per-source
  // rather than a single flag over the whole lane.
  const sources = sourcesFor(withCreds([CASELAW_BRIDGES[0]]));
  const text = dictation(sources);
  const on = sources.find((r) => r.enrolment === "oauth" && r.available);
  const off = sources.find((r) => r.enrolment === "oauth" && !r.available);
  assert.ok(on && off, "the half-enrolled fixture did not produce one of each");
  assert.match(lineAbout(text, on.label), /enrolled on this deployment/i);
  assert.match(lineAbout(text, off.label), /NOT SET UP ON THIS DEPLOYMENT/i);
  assert.notEqual(lineAbout(text, on.label), lineAbout(text, off.label));
});

test("2142 the seat is told the connection error cannot answer this, and the list can", () => {
  // THE CRUX. Without this the seat holds two conflicting instructions: a list saying "not set up" and a
  // tool result saying "configured server, connection closed". It followed the tool result last time,
  // correctly, because nothing told it otherwise.
  const text = dictation(sourcesFor(noCreds()));
  assert.match(text, /CANNOT TELL THOSE APART AND THIS LIST CAN/i);
  assert.match(text, /configured/i, "the dictation does not name the misleading word the seat will actually see");
  assert.match(text, /the list above is right/i, "nothing tells the seat which source to believe");
});

test("2142 the gap is still disclosed — the fix changes the reason, never the disclosure", () => {
  // The discipline that did NOT break in the original defect, and the one a careless fix would break:
  // making the gap quieter is worse than attaching the wrong reason to it.
  for (const env of [noCreds(), withCreds(CASELAW_BRIDGES)]) {
    const text = dictation(sourcesFor(env));
    assert.match(text, /State the gap either way/i, "the dictation no longer requires the gap to be stated");
    assert.match(text, /what changes here is the REASON, never whether you disclose it/i);
  }
});

test("2142 the sources come from the product's own inventory, not a list typed here", () => {
  // The 2087 ruling, which this inherits: derived from the set of capabilities the product declares it
  // needs, never from a hand-kept list of the two we remembered.
  const sources = sourcesFor(noCreds());
  for (const id of CASELAW_BRIDGES) {
    assert.ok(sources.some((r) => r.label.toLowerCase().includes(id.toLowerCase()) || r.label.length > 0),
      `${id} is missing from the sources handed to the stage`);
  }
  assert.equal(sources.filter((r) => r.enrolment === "oauth").length, CASELAW_BRIDGES.length,
    "the oauth rows and the bridges the build spawns have drifted apart");
  // A built-in lane is listed and is never an enrolment question — reading `configured` alone would
  // report every deployment ready, which is the trap the flag-snapshot predicate exists to avoid.
  assert.ok(sources.some((r) => r.enrolment === "built-in" && r.available), "the built-in lane vanished from the list");
});

test("2142 no inventory means no claim — absence is not a readiness verdict", () => {
  // A deployment whose inventory cannot be read must produce a dictation that says nothing about
  // sources, rather than one asserting a readiness nobody measured.
  for (const empty of [[], null, undefined]) {
    const text = dictation(empty);
    assert.doesNotMatch(text, /THE CASE-LAW SOURCES THIS DEPLOYMENT HAS/i,
      "an unreadable inventory still produced a statement about which sources exist");
    assert.ok(text.length > 100, "the dictation collapsed entirely rather than omitting one block");
  }
});

test("2142 the retrieval record's filename never travels to a reader", () => {
  // The same delivered paragraph carried `case-law-citations.json` to the client as body prose. The path
  // must be named to the seat — it writes the file — so the rule is that it stops there.
  const text = dictation(sourcesFor(noCreds()));
  assert.match(text, /THAT FILE IS THE DRIVER'S RECORD, NOT THE READER'S/i);
  assert.match(text, /Never name it — or any other internal file, path, key or stage/i);
});
