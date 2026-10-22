// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SPELLING THE READING TURN LEFT ON A LIST IT READ IS NOT ASKED AGAIN BY SECOND FRAMING'S RE-SWEEP.
//
// The plan asks the mark's spellings as exact lists, and a crowded list comes back with a count for each name on it.
// A spelling the reading turn neither narrowed nor asked on its own stays on the list's row with its count: a crowd it
// set aside. On a test run of a crowded matter the re-sweep asked seven such spellings again, exact and as contains,
// fourteen questions. The re-sweep's question on such a spelling is now refused as `counted-on-list`, with the list as
// its twin, and its directive is checked on the list's row. Held on the re-sweep's own functions, on a run folder
// written the way the run writes it. Every mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { countedOnLists, refuseCountedOnList } from "../engine/mcp/held-answers.mjs";
import { verifyRegisterDirectiveClose } from "../close-verify.mjs";
import { classifyRemedyTerm } from "../remedy-accounting.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AXIS = "primary-sweep";
const LIST = { qid: `${AXIS}:exact:veltris+form`, axis: AXIS, predicate: "exact", provenance: "floor",
  terms: ["VELTRIS", "VELTRISS", "WELTRIS", "VELTRYS"], nice_classes: ["9", "41"], regions: [] };
const crowd = (n) => ({ total_hits: n, disposition: "crowd" });
const LIST_ANSWER = { qid: LIST.qid, state: "incomplete", total_hits: 1850, records: [],
  term_counts: { veltris: crowd(900), veltriss: crowd(300), weltris: crowd(150), veltrys: crowd(500) } };

/** A run folder holding the frozen plan and the primary sweep's band, as the run writes them. */
function runFolder(t, { answer = LIST_ANSWER } = {}) {
  const run = mkdtempSync(join(tmpdir(), "counted-on-list-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "_driver"), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(join(run, "_driver", "register-plan.json"), JSON.stringify({ regions: ["EM", "US"], entries: [
    LIST,
    { qid: `${AXIS}:exact:veltris`, axis: AXIS, predicate: "exact", term: "VELTRIS", provenance: "mark", nice_classes: ["9", "41"], regions: [] },
    { qid: `supp:${AXIS}:exact:veltrys:0a1b2c3d`, axis: AXIS, origin: "supplemental", predicate: "exact", term: "VELTRYS", nice_classes: ["9"], regions: [] },
  ] }));
  writeFileSync(join(run, "register-units", `${AXIS}-band.json`), JSON.stringify([answer]));
  return run;
}
const reask = (term, predicate, over = {}) => ({ qid: `supp:${AXIS}:${predicate}:${term.toLowerCase()}:feedf00d`, axis: AXIS, origin: "supplemental",
  predicate, term, nice_classes: ["9", "41"], regions: [], rationale: "frame-reopen variant: a near form the first framing missed", ...over });

test("a spelling counted on a list and asked nowhere on its own is left there: both re-asks are refused, the list their twin", (t) => {
  const counted = countedOnLists(runFolder(t), { planRegions: ["EM", "US"] });
  assert.deepEqual([...counted.keys()].sort(), ["veltriss", "weltris"], "the spellings asked on their own somewhere must not count as left on the list");
  const { kept, refused } = refuseCountedOnList([reask("VELTRISS", "exact"), reask("VELTRISS", "default")], counted, ["EM", "US"]);
  assert.deepEqual(kept, []);
  assert.deepEqual(refused.map((r) => [r.kind, r.twin]), [["counted-on-list", LIST.qid], ["counted-on-list", LIST.qid]]);
});

test("a re-ask beyond the list's classes or markets, narrowed by goods, or on a spelling asked on its own is asked as before", (t) => {
  const planRegions = ["EM", "US"];
  const counted = countedOnLists(runFolder(t), { planRegions });
  const asked = [
    reask("WELTRIS", "default", { nice_classes: ["9", "38"] }),
    reask("WELTRIS", "exact", { regions: ["EM", "US", "CN"] }),
    reask("WELTRIS", "exact", { goods_text: ["software"] }),
    reask("VELTRYS", "exact"),
  ];
  const { kept, refused } = refuseCountedOnList(asked, counted, planRegions);
  assert.deepEqual(refused, []);
  assert.equal(kept.length, asked.length);
  assert.equal(refuseCountedOnList([reask("WELTRIS", "exact", { regions: ["US"] })], counted, planRegions).refused.length, 1,
    "a re-ask inside the list's markets is the list's spelling");
});

test("a list whose answer failed, or that counted no names, leaves nothing", (t) => {
  assert.equal(countedOnLists(runFolder(t, { answer: { ...LIST_ANSWER, error: true } }), { planRegions: ["EM", "US"] }).size, 0);
  const { term_counts: _, ...uncounted } = LIST_ANSWER;
  assert.equal(countedOnLists(runFolder(t, { answer: uncounted }), { planRegions: ["EM", "US"] }).size, 0);
});

test("the refused re-ask is checked on the list's row, by the directive and by the term ledger", () => {
  const exact = reask("VELTRISS", "exact"), contains = reask("VELTRISS", "default");
  const foldRefusals = new Map([exact, contains].map((e) => [e.qid, { kind: "counted-on-list", twin: LIST.qid }]));
  const blocksByQid = new Map([[LIST.qid, LIST_ANSWER]]);
  const executedQids = new Set([LIST.qid]);
  const v = verifyRegisterDirectiveClose({ qids: [exact.qid, contains.qid], intendedClasses: ["9", "41"], executedQids, blocksByQid, foldRefusals });
  assert.equal(v.closed, true, v.reason);
  assert.deepEqual(v.answered_by.map((a) => a.twin), [LIST.qid, LIST.qid]);
  const row = classifyRemedyTerm({ term: "VELTRISS", qids: [exact.qid, contains.qid] }, { blocksByQid, executedQids, foldRefusals });
  assert.equal(row.class, "found", JSON.stringify(row));
  assert.deepEqual(row.slices.map((s) => s.refused_at_fold), ["counted-on-list", "counted-on-list"]);
});

test("the pipeline's re-sweep refuses those re-asks before its fold", () => {
  // The re-sweep is a block inside the pipeline with no seam of its own, so its wiring is read off the source.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /refuseCountedOnList\(toFoldHeld, countedOnLists\(run\.runDir, \{ planRegions \}\), planRegions\)/);
  assert.match(src, /const refused = \[\.\.\.withheldRefused, \.\.\.heldRefused, \.\.\.listRefused, \.\.\.folded\.refused\];/);
});
