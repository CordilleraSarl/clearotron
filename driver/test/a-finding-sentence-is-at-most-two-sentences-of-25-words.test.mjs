// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the finding-sentence length rule at the synthesis call, on invented names only
//
// THE FINDING SENTENCE IS AT MOST TWO SENTENCES, EACH AT MOST 25 WORDS (owner, 2026-10-02).
//
// The synthesis call refuses a longer `net`, beside the semicolon and arrow the parser already refuses.
// What these arms hold:
//   · the refusal fires on a third sentence and on a sentence of 26 words, and says only the owner's
//     clause and the two counts;
//   · a name is never cut in half by the count — "Inc.", "Ltd.", initials, a mid-sentence "U.S.", "No."
//     before a number and an em-dash aside all pass when the sentence is within the rule, because a
//     false refusal costs a correction round;
//   · the chain rule's two exemptions hold here too: a withdrawn or ruled-out finding renders no net;
//   · a patch is judged on the findings it carries, so a sentence accepted before the rule is never
//     refused on a pass that did not touch it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { netLengthRefusal, recordSynthesis, synthesisCallPaths } from "../synthesis-record.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const finding = (net, over = {}) => ({ ordinal: 1, disposition: "adversarial", net, ...over });
const refusalOf = (net, over = {}) => netLengthRefusal([finding(net, over)]);
// A sentence of n words that opens with a capital, as a sentence does: the split reads a lowercase
// follower as the same sentence going on.
const words = (n) => Array.from({ length: n }, (_, i) => (i ? `word${i + 1}` : "Word1")).join(" ");

test("a third sentence, or a sentence of 26 words, is refused with the owner's clause and the two counts", () => {
  const three = "Veltrin Holdings would probably win against ZORENDIK for games in the EU. Their registration covers games. It is live.";
  assert.equal(refusalOf(three),
    "synthesis_net_too_long:1 (At most two sentences, each at most 25 words: 3 sentences, 12 words in the longest)");
  const long = `${words(26)}.`;
  assert.equal(refusalOf(long),
    "synthesis_net_too_long:1 (At most two sentences, each at most 25 words: 1 sentence, 26 words in the longest)");
  // The boundary itself passes: two sentences, the longer of 25 words.
  assert.equal(refusalOf(`${words(25)}. ${words(5)}.`), null);
  // and a count of one reads as one
  assert.equal(refusalOf("Won. Lost. Settled."),
    "synthesis_net_too_long:1 (At most two sentences, each at most 25 words: 3 sentences, 1 word in the longest)");
});

test("the owner's own shape passes: the outcome, then what the earlier right covers", () => {
  assert.equal(refusalOf("Veltrin Holdings' earlier VELTRIN would probably win against ZORENDIK for software in the EU. "
    + "Their registration covers games and software."), null);
});

test("a name is never cut in half by the count", () => {
  for (const net of [
    "Veltrin Inc. would probably win against ZORENDIK for software in the U.S. Their registration covers games.",
    "Zorendik Ltd.'s earlier mark would probably win against VELTRIN for class No. 5 goods in the EU.",
    "J. R. Veltrin Company would probably win against ZORENDIK for software in the U.K.",
    "Norvell Instruments — a laboratory-equipment maker — could oppose in the EU but has never asserted against a software filer.",
    "Dr. Zorendik's earlier mark would probably win against VELTRIN in Germany. Their registration covers food.",
  ]) assert.equal(refusalOf(net), null, `refused a net within the rule: ${net}`);
});

test("the chain rule's exemptions hold: a withdrawn or ruled-out finding renders no net and is not judged", () => {
  const long = `${words(40)}.`;
  assert.equal(refusalOf(long, { disposition: "withdrawn" }), null);
  assert.equal(refusalOf(long, { ruled_out: true }), null);
  assert.equal(refusalOf(long, { disposition: "off-field" }) !== null, true, "an off-field finding renders its net and is judged");
});

test("a patch is judged on the findings it carries, never on one it did not touch", () => {
  const long = `${words(30)}.`;
  const two = [finding(long, { ordinal: 1 }), finding("A short conclusion.", { ordinal: 2 })];
  assert.equal(netLengthRefusal(two, new Set([2])), null, "a patch carrying only finding 2 left finding 1 alone");
  assert.match(netLengthRefusal(two, new Set([1])), /^synthesis_net_too_long:1 /);
  assert.match(netLengthRefusal(two, null), /^synthesis_net_too_long:1 /, "a whole call is judged on every finding");
});

// Through the real recorder: a whole call is refused in the turn, and nothing reaches disk.
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "net-length-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return dir;
}

test("the synthesis call refuses a long net in the turn, and accepts the same record once it is short", () => {
  const dir = runDir();
  try {
    const doc = JSON.parse(synthesisFindings(dir));
    doc.findings[0].net = `${words(26)}.`;
    const refused = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc });
    assert.match(String(refused.refused), /^synthesis_net_too_long:1 \(At most two sentences, each at most 25 words: /);
    assert.equal(refused.written, null, "a refused call wrote nothing");
    doc.findings[0].net = "Veltrin Holdings' earlier VELTRIN would probably win against ZORENDIK for software in the EU.";
    const accepted = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc });
    assert.equal(accepted.refused, null, String(accepted.refused));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a patch over a record accepted before the rule is not refused for the sentence it did not send", () => {
  const dir = runDir();
  try {
    // The base a patch merges onto, as a record accepted before the rule would have left it.
    const doc = JSON.parse(synthesisFindings(dir));
    doc.findings[0].net = `${words(30)}.`;
    const { dir: callDir, accepted } = synthesisCallPaths(dir);
    mkdirSync(callDir, { recursive: true });
    writeFileSync(accepted, JSON.stringify({ acceptedAt: "before", params: { narrative: NARRATIVE, findings: doc } }));
    // A patch that sends only the actions register leaves the old sentence where it is.
    const patch = recordSynthesis(dir, { actions: doc.actions });
    assert.equal(patch.refused, null, String(patch.refused));
    // A patch that sends the finding itself is held to the rule.
    const sent = recordSynthesis(dir, { findings_patch: [doc.findings[0]] });
    assert.match(String(sent.refused), /^synthesis_net_too_long:1 /);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
