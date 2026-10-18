// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A DELIVERY-CHECK REPAIR CHANGED, BY VALUE — the units under the review after a repair.
//
// The review after a repair is handed what the repair changed and what rests on it, worked out from the
// writer's saved record before and after the repair. These pin the comparison (a rewrite with the same
// values is no change; a reworded area is a line removed and a line added), the typed rule for what rests
// on a change, the one label per item, and how a flag is joined back to its item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalValue, changedContent, isEmptyChange, restingOn, scopeItems, anyRenumbered, resolveTarget,
  classifyPoints, changedInputsOf, snapshotRepairBase, readRepairBase, repairBasePath, sectionText,
} from "../repair-scope.mjs";
import { synthesisCallPaths } from "../synthesis-record.mjs";

const finding = (ordinal, over = {}) => ({
  ordinal, mark: "NOVAPULSE", owner: { name: "BigCo Interactive", country: "US", registrations: [] },
  band: "Moderate", disposition: "adversarial", net: "BigCo Interactive's earlier mark would probably win in the United States.",
  legal_position: "The marks share their distinctive element.", practical_position: "The owner enforces.",
  source: { source_type: "register-vendor", resolved_link: "https://example.invalid/mark/us/1" }, ...over,
});
const record = (over = {}) => ({
  schema_version: 7, rated_under_framework: "house-default",
  findings: [finding(1), finding(2, { mark: "NOVA PULSE" })],
  coverage: [{ area: "register / US", state: "confirmed-clean", note: "searched in full" },
    { area: "register / EU", state: "coverage-limited", note: "one class was not read" }],
  actions: [{ id: "a1", kind: "counsel-opinion-required", text: "Ask counsel about finding 2.", ordinals: [2] }],
  ask_answers: [{ ask: "check the EU register", answer: "The EU register was read in part.", ordinals: [2] }],
  four_answers: { who_could_object: { read: "One owner could object.", ordinals: [1] } },
  mark_assessment: { distinctiveness: "Coined.", connotation: "None found." },
  coverage_judgment: { sufficient: true, reason: "the plan ran" },
  ...over,
});
const call = (findings = record(), narrative = {}) => ({
  narrative: { verdict: "One conflict needs a decision.", spine: "The spine is the coined element.",
    coverage: { read: "The register was searched." }, calibration: [{ challenge: "Is it coined?", answer: "Yes." }], ...narrative },
  findings,
});

test("a value saved again unchanged is no change: key order and whitespace do not count", () => {
  assert.equal(canonicalValue({ b: 1, a: "x  y" }), canonicalValue({ a: " x y ", b: 1 }));
  const before = call();
  const after = JSON.parse(JSON.stringify(call()));
  after.findings.coverage[0].note = "searched   in\nfull";
  after.findings = Object.fromEntries(Object.entries(after.findings).reverse());
  const c = changedContent(before, after);
  assert.equal(isEmptyChange(c), true, "a re-wrapped note and reordered keys are the same values");
  assert.deepEqual(restingOn(c, after), [], "and nothing rests on no change");
});

test("findings are compared by ordinal and name the fields that moved; additions and removals are said", () => {
  const after = call(record({ findings: [finding(1, { band: "Serious" }), finding(3)] }));
  const c = changedContent(call(), after);
  assert.deepEqual(c.findings.map((f) => [f.ordinal, f.change, f.fields]),
    [[1, "changed", ["band"]], [2, "removed", []], [3, "added", []]]);
  assert.equal(c.whole, false);
});

test("a reworded coverage area is one line removed and one added; the writer's corrections note is not content", () => {
  const after = call(record({
    coverage: [{ area: "register / United States", state: "confirmed-clean", note: "searched in full" },
      { area: "register / EU", state: "coverage-limited", note: "one class was not read" }],
    corrections: { applied: true, note: "reworded" },
  }));
  const c = changedContent(call(), after);
  assert.deepEqual(c.lines.map((l) => [l.area, l.change]),
    [["register / United States", "added"], ["register / US", "removed"]]);
  assert.equal(c.registers.length, 0, "the corrections marker is not compared");
});

test("every other register a reader meets is compared, each under its own label", () => {
  const after = call(record({
    actions: [{ id: "a1", kind: "counsel-opinion-required", text: "Ask counsel about finding 2 first.", ordinals: [2] }],
    ask_answers: [{ ask: "check the EU register", answer: "The EU register was read in full.", ordinals: [2] }],
    four_answers: { who_could_object: { read: "Two owners could object.", ordinals: [1] } },
    mark_assessment: { distinctiveness: "Coined.", connotation: "A pulse of light." },
    coverage_judgment: { sufficient: false, reason: "one class was not read" },
    context_notes: [{ type: "famous-neighbour-ungrounded", mark: "NOVA", context: "a well-known name" }],
  }));
  const c = changedContent(call(), after);
  assert.deepEqual(c.registers.map((r) => r.label).sort(), [
    "the action \"a1\"", "the answer to \"check the EU register\"", "the context notes", "the coverage judgment",
    "the four answers' who_could_object", "the mark assessment's connotation",
  ]);
});

test("a changed version or framework, or no base at all, keeps the review whole", () => {
  assert.equal(changedContent(null, call()).whole, true);
  assert.equal(changedContent(call(), call(record({ schema_version: 6 }))).whole, true);
  assert.equal(changedContent(call(), call(record({ rated_under_framework: "another" }))).whole, true);
});

test("what rests on a change: the unchanged sections and the coverage judgment, and every row that names a changed finding", () => {
  const after = call(record({ findings: [finding(1), finding(2, { mark: "NOVA PULSE", band: "Serious" })] }),
    { spine: "The spine has changed." });
  const c = changedContent(call(), after);
  assert.deepEqual(c.sections.map((s) => s.title), ["The spine"]);
  const r = restingOn(c, after);
  assert.deepEqual(r.map((x) => x.label), [
    "the narrative's \"Verdict\" section", "the narrative's \"Coverage\" section",
    "the narrative's \"Calibration challenges\" section", "the coverage judgment",
    "the action \"a1\"", "the answer to \"check the EU register\"",
  ], "finding 2 changed, so the action and the answer that name it rest on it; the four answers name only finding 1");
  assert.equal(sectionText([{ challenge: "Is it coined?", answer: "Yes." }]), "Is it coined? Yes.");
});

test("one label per item, and a finding the fold renumbered carries its delivered number", () => {
  const after = call(record({ findings: [finding(1), finding(2, { band: "Serious", mark: "NOVA PULSE" })] }));
  const c = changedContent(call(), after);
  const items = scopeItems(c, restingOn(c, after), { modelToFolded: { 1: 1, 2: 1 } });
  const f = items.find((i) => i.kind === "finding");
  assert.deepEqual([f.ordinal, f.delivered, f.label], [2, 1, "finding 2"]);
  assert.equal(anyRenumbered(items), true);
  assert.equal(anyRenumbered(scopeItems(c, [], null)), false);
});

test("a flag names its target by `on`, or by beginning with an exact label; a label elsewhere or a quote is no target", () => {
  const after = call(record({ coverage: [{ area: "register / US", state: "coverage-limited", note: "a class was skipped" },
    { area: "register / EU", state: "coverage-limited", note: "one class was not read" }] }));
  const c = changedContent(call(), after);
  const items = scopeItems(c, restingOn(c, after));
  assert.equal(resolveTarget({ on: [2], text: "anything" }, items).kind, "finding");
  const line = resolveTarget({ text: "the coverage line for \"register / US\": the state overstates the gap" }, items);
  assert.deepEqual([line.kind, line.label], ["coverage", "the coverage line for \"register / US\""]);
  assert.equal(resolveTarget({ text: "The verdict quotes \"the coverage line for \\\"register / US\\\"\" wrongly" }, items).kind, "none",
    "a label that does not open the flag is not a target");
  const cls = classifyPoints([
    { kind: "fact", text: "the coverage line for \"register / US\": too strong" },
    { kind: "fact", on: [9], text: "finding 9 is wrong" },
    { kind: "narrative", text: "The summary repeats itself." },
    { kind: "narrative", text: "the narrative's \"Verdict\" section: it no longer matches the coverage line" },
  ], items);
  assert.deepEqual(cls.map((p) => p.class), ["mapped", "unrelated", "unresolved", "mapped"]);
});

test("the inputs the repair changed: the narrative renders coverage lines and answers, the record holds everything", () => {
  const paths = { narrative: "narrative.md", findings: "findings.json" };
  const line = changedContent(call(), call(record({ coverage: [{ area: "register / US", state: "coverage-limited", note: "x" }, record().coverage[1]] })));
  assert.deepEqual(changedInputsOf(line, paths), ["narrative.md", "findings.json"]);
  const onlyFinding = changedContent(call(), call(record({ findings: [finding(1, { band: "Low" }), finding(2, { mark: "NOVA PULSE" })] })));
  assert.deepEqual(changedInputsOf(onlyFinding, paths), ["findings.json"]);
  const onlyProse = changedContent(call(), call(record(), { verdict: "A new verdict." }));
  assert.deepEqual(changedInputsOf(onlyProse, paths), ["narrative.md"]);
});

test("the repair base is the accepted record just before the repair; with none, an earlier copy cannot stand", () => {
  const runDir = mkdtempSync(join(tmpdir(), "repair-scope-"));
  const { dir, accepted } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(accepted, JSON.stringify({ params: call() }));
  assert.equal(snapshotRepairBase(runDir), true);
  assert.deepEqual(readRepairBase(runDir), call());
  const other = mkdtempSync(join(tmpdir(), "repair-scope-"));
  mkdirSync(synthesisCallPaths(other).dir, { recursive: true });
  writeFileSync(repairBasePath(other), JSON.stringify({ params: call() }));
  assert.equal(snapshotRepairBase(other), false, "no accepted record, so no base");
  assert.equal(existsSync(repairBasePath(other)), false, "and the earlier copy is gone");
  assert.equal(readRepairBase(other), null);
});
