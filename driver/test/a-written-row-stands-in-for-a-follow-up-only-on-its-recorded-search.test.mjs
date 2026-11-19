// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WRITTEN ROW STANDS IN FOR A FOLLOW-UP ROW ONLY ON THE SEARCH THE RUN RECORDED (design, 2026-11-19).
//
// "Left open" listed one unfinished search twice: the writer's "Register / …" row, and the row the driver composes
// for the deferred directive. An axis-labelled row may now stand in for the composed row, but only when the frame
// receipt records the directive's questions, their ids name one kind of search, the written row is open and of that
// kind, carries every significant word of the directive, and no other open row fits as well. The driver composing the
// rows, the lint reading the page and the page itself all ask one function. These are design's four cases, a record
// naming two kinds, and a row of another kind. Every directive, row and id here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { followUpKinds, kindsForFollowUp, axisTwin } from "../follow-up-twins.mjs";
import { deferralCoverageRow } from "../deferral-row.mjs";
import { coverageGrid } from "../publish/render.mjs";
import { pageNameLines } from "../predelivery-lint.mjs";
import { injectDeferralCoverage } from "../pipeline.mjs";

const DIRECTIVE = "variant:skarvelle audio exact";
const receipt = (qids) => ({ requested: [DIRECTIVE], swept: [], deferrals: [{ directive: DIRECTIVE, layer: "variant", reason: "source-not-swept" }],
  directive_qids: qids === undefined ? {} : { [DIRECTIVE]: qids } });
const PRIMARY = ["supp:primary-sweep:exact:skarvelle:aa11", "supp:primary-sweep:default:skarvelle:bb22"];
const followUp = deferralCoverageRow(DIRECTIVE, "source-not-swept");
const twin = { area: "Register / SKARVELLE AUDIO exact in class 9", state: "open", note: "the exact search did not complete" };
const unrelated = { area: "Common-law / web search", state: "open", note: "not completed" };
const drawn = (rows, qids) => {
  const html = coverageGrid(rows, { followUpKinds: followUpKinds(receipt(qids)) });
  return { followUp: html.includes("Follow-up"), twin: html.includes("SKARVELLE AUDIO exact in class 9") };
};

test("a matched pair: the one open row of the recorded kind, with every word of the directive, stands in", () => {
  const kinds = followUpKinds(receipt(PRIMARY));
  assert.deepEqual([...kindsForFollowUp(followUp, kinds)], ["primary-sweep"], "the recorded kind is not read off the question ids");
  assert.equal(axisTwin("skarvelle audio exact", kindsForFollowUp(followUp, kinds), [twin, unrelated]), twin);
  assert.deepEqual(drawn([twin, followUp, unrelated], PRIMARY), { followUp: false, twin: true }, "the page still lists the search twice");
  const lines = pageNameLines({ coverage: [twin, followUp, unrelated], followUpKinds: kinds }).join("\n");
  assert.doesNotMatch(lines, /Follow-up/, "the lint reads a row the page does not draw");
});

test("an ambiguous short directive keeps its Follow-up: two open rows of the kind carry its one word", () => {
  const SHORT = "variant:skarvelle";
  const r = { requested: [SHORT], deferrals: [{ directive: SHORT, layer: "variant", reason: "source-not-swept" }], directive_qids: { [SHORT]: PRIMARY } };
  const row = deferralCoverageRow(SHORT, "source-not-swept");
  const two = [{ area: "Register / SKARVELLE exact", state: "open", note: "" }, { area: "Register / SKARVELLE default", state: "coverage-limited", note: "" }];
  assert.equal(axisTwin("skarvelle", kindsForFollowUp(row, followUpKinds(r)), two), null, "one of two equal fits stood in");
  assert.ok(coverageGrid([...two, row], { followUpKinds: followUpKinds(r) }).includes("Follow-up"), "the page dropped the Follow-up");
});

test("a completed row never stands in", () => {
  const done = { ...twin, state: "confirmed-clean" };
  assert.equal(axisTwin("skarvelle audio exact", kindsForFollowUp(followUp, followUpKinds(receipt(PRIMARY))), [done]), null);
  assert.equal(drawn([done, followUp], PRIMARY).followUp, true);
});

test("an older record with no recorded questions keeps the Follow-up, and so does a record naming two kinds or a row of another kind", () => {
  assert.equal(kindsForFollowUp(followUp, followUpKinds(receipt(undefined))), null, "a directive with no questions has a kind");
  assert.equal(drawn([twin, followUp], undefined).followUp, true, "an older record folded");
  assert.equal(drawn([twin, followUp], [...PRIMARY, "supp:saturation-probe:exact:skarvelle:cc33"]).followUp, true, "two kinds folded");
  assert.equal(drawn([twin, followUp], ["unnamed"]).followUp, true, "a question that names no kind folded");
  const other = { ...twin, area: "Common-law / SKARVELLE AUDIO exact" };
  assert.equal(drawn([other, followUp], PRIMARY).followUp, true, "a row of another kind stood in");
  assert.equal(coverageGrid([twin, followUp]).includes("Follow-up"), true, "a page given no record folded");
});

test("the driver composes no Follow-up where its written twin already stands, and composes one where none does", () => {
  const run = mkdtempSync(join(tmpdir(), "fu-twin-"));
  try {
    mkdirSync(join(run, "_driver"), { recursive: true });
    writeFileSync(join(run, "_driver", "frame-reopen.json"), JSON.stringify(receipt(PRIMARY)));
    const findings = join(run, "findings.json");
    const write = (coverage) => writeFileSync(findings, JSON.stringify({ schema_version: 2, findings: [], coverage }));
    const areas = () => JSON.parse(readFileSync(findings, "utf8")).coverage.map((c) => c.area);
    write([twin]);
    injectDeferralCoverage({ findings }, run, () => {});
    assert.deepEqual(areas(), [twin.area], "the driver composed a Follow-up beside its twin");
    write([unrelated]);
    injectDeferralCoverage({ findings }, run, () => {});
    assert.ok(areas().some((a) => a.startsWith("Follow-up / ")), "the driver composed no Follow-up where nothing stands in");
  } finally { rmSync(run, { recursive: true, force: true }); }
});
