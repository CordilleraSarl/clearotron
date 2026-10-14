// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the basis derivation and the synthesis merge base, on invented records
//
// A DEMOTED STAMP SURVIVES THE NEXT PATCH.
//
// After synthesis the driver demotes every `verified-from-record` stamp the run cannot prove — a record never
// fetched, or fetched and never read — and writes the demotion into findings.json. The synthesis transport's
// merge base (`_driver/synthesis-calls/accepted.json`) kept the stamps as the model sent them, and every
// accepted patch merges onto that base and re-renders the findings it does not name from it. So the next
// patch put back every stamp the driver had demoted, and the evidence check on the corrective pass then told
// the reviewer those stamps had come back. The demotions now reach the base too, in the model's numbering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths as stagePaths } from "../stages.mjs";
import { settleDerivedBases } from "../pipeline.mjs";
import { evidenceClaimViolations } from "../evidence-claim-invariant.mjs";
import { recordSynthesis, FINDINGS_FILE } from "../synthesis-record.mjs";
import { foldFindingsFile, readFold } from "../record-fold.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const THREE = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
// The second finding is a second filing of the first, so the delivery seam folds the two together.
const FOLDING = [["Qorvalen Holdings", "PRUNDELIQ"], ["Qorvalen Holdings", "PRUNDELIQ"], ["Brannick Tooling", "ORVANTE"]];
const COVERAGE = [{ area: "the invented register", state: "not-searched", note: "The reworded note for the one slice." }];

/** A record whose findings are `[owner, mark]` pairs; each one's similarity stamp cites its own registration. */
function record(rows) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, findings: rows.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9400000${i + 1}`;
    f.meters.mark_similarity = { ...f.meters.mark_similarity, basis: "verified-from-record", source: f.owner.registrations[0].uri };
    return f;
  }) };
}

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function saved(rows) {
  const dir = mkdtempSync(join(tmpdir(), "demoted-stamp-"));
  dirs.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: record(rows) });
  assert.equal(r.refused, null, `the first save was refused: ${r.refused}`);
  return dir;
}
const read = (at) => (existsSync(at) ? readFileSync(at, "utf8") : null);
const onDisk = (dir) => JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8"));
const acceptedAt = (dir) => driverDir(dir, "synthesis-calls", "accepted.json");
const baseFindings = (dir) => JSON.parse(readFileSync(acceptedAt(dir), "utf8")).params.findings;
const settle = (dir, at = "post-synthesis") => settleDerivedBases({ paths: stagePaths(dir) }, at);
const accepts = (r, what) => assert.equal(r.refused, null, `${what} was refused: ${r.refused}`);
const stamp = (f) => f.meters.mark_similarity.basis;
const reasserted = (rec, before, after) => evidenceClaimViolations({ before: before.findings, after: after.findings, demotions: rec.rows })
  .violations.filter((v) => v.arm === "demoted-stamp-reasserted").map((v) => v.finding);

test("a stamp the driver demoted stays demoted when the next patch is accepted, and the evidence check reports nothing", () => {
  const dir = saved(THREE);
  const rec = settle(dir);
  assert.equal(rec?.demoted, 3, "premise: the settle demotes each unread stamp in findings.json");
  const settled = onDisk(dir);
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a register patch after the settle");
  const after = onDisk(dir);
  assert.deepEqual(after.findings.map(stamp), ["inferred-from-signal", "inferred-from-signal", "inferred-from-signal"],
    "the next accepted patch put back the stamps the driver had demoted");
  assert.deepEqual(reasserted(rec, settled, after), [], "the evidence check reports stamps the model never re-sent");
});

test("a patch that re-sends a demoted stamp is still reported, and only that one", () => {
  const dir = saved(THREE);
  const rec = settle(dir);
  const settled = onDisk(dir);
  const resent = record(THREE).findings[1];   // as the model first wrote it: verified-from-record
  accepts(recordSynthesis(dir, { findings_patch: [resent] }), "a patch re-sending the second finding");
  const found = reasserted(rec, settled, onDisk(dir));
  assert.ok(found.includes("ODRAVEL|Quillmere Ltd"), "a stamp the model re-sent over a demotion is no longer reported");
  assert.deepEqual(found, ["ODRAVEL|Quillmere Ltd"], "findings the patch did not name were reported as re-sent");
});

test("a rebase the acceptance boundary refuses leaves the base byte-identical, and the settle records it", () => {
  const dir = saved(THREE);
  // an intake ask the stored record never answered: the acceptance boundary refuses the base as it stands
  writeFileSync(driverDir(dir, "intake-asks.json"), JSON.stringify(["An invented ask the record never answered"]));
  const before = read(acceptedAt(dir));
  const rec = settle(dir);
  assert.equal(rec?.demoted, 3, "premise: the demotions still reach findings.json");
  assert.equal(read(acceptedAt(dir)), before, "a refused rebase changed the base");
  assert.equal(rec.base, "refused", "the settle's record does not say the base could not take the demotions");
  assert.match(String(rec.baseReason), /^synthesis_ask_unanswered:/);
  const logged = read(driverDir(dir, "run.jsonl")).split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.event === "basis-derivation");
  assert.equal(logged.at(-1)?.base, "refused", "the run log does not say the base could not take the demotions");
});

test("with a fold in force, each demotion reaches the base on the finding the fold kept", () => {
  const dir = saved(FOLDING);
  foldFindingsFile(dir, join(dir, FINDINGS_FILE), null, { seam: true });
  assert.equal(onDisk(dir).findings.length, 2, "premise: the seam folds the second filing in");
  const rec = settle(dir, "pre-delivery");
  assert.equal(rec?.demoted, 2, "premise: the settle demotes both folded findings' stamps");
  const kept = readFold(dir).merges[0].kept;
  const base = baseFindings(dir);
  assert.equal(stamp(base.findings.find((f) => f.ordinal === kept)), "inferred-from-signal", "the kept filing's stamp was not demoted in the base");
  assert.equal(stamp(base.findings.find((f) => f.ordinal === 3)), "inferred-from-signal", "the folded second finding's stamp was not demoted in the base");
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a register patch after the seam");
  assert.deepEqual(onDisk(dir).findings.map(stamp), ["inferred-from-signal", "inferred-from-signal"],
    "the next accepted patch put back a stamp the driver had demoted on the folded record");
});
