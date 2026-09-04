// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Recording which rulebook a run actually followed.
//
// The methodology — the customer's risk framework and its worked examples, the synthesis rules, the
// delivery contract — is prose read fresh from the config store at every stage spawn. Nothing memoises, by
// design: the framework freeze deliberately carries "vocabulary and order ONLY … never a mapping table,
// threshold, or decision rule — those live in the deck prose, where the model reasons with them".
//
// So editing a framework at 2pm while a search runs makes the stages before 2pm follow one rulebook and
// the stages after another, with nothing recording it. A per-run FREEZE would prevent that and was
// declined (D7): it fights the live-prose rule and would stop a correction reaching a parked run. This
// records instead. It freezes nothing, gates nothing, and marks nothing stale — that last one matters,
// because a methodology file in the freshness map would make an ordinary edit KILL runs, which is the
// deadlock the registry auto-corrector had to be dug out of.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { skillRefsIn, witnessStageMethodology, describeMethodologyDrift, WITNESS_FILE } from "../methodology-witness.mjs";

const FRAMEWORK = "skills/prelim-search/risk-framework-sim-praxis.md";
const RULES = "skills/prelim-search/synthesis-rules.md";

function bench() {
  const root = mkdtempSync(join(tmpdir(), "methwit-"));
  const runDir = join(root, "run");
  const overlay = join(root, "overlay", "skills", "prelim-search");
  const base = join(root, "base", "skills", "prelim-search");
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(overlay, { recursive: true });
  mkdirSync(base, { recursive: true });
  const put = (dir, ref, body) => { const p = join(dir, ref.split("/").pop()); writeFileSync(p, body); return p; };
  put(overlay, FRAMEWORK, "band ceilings v1");
  put(overlay, RULES, "rules v1");
  put(base, FRAMEWORK, "THE HOUSE DEFAULT FRAMEWORK");
  // overlay-first, base fallback — the real resolveSkillPath contract
  const resolve = (ref) => {
    const o = join(overlay, ref.split("/").pop());
    return existsSync(o) ? o : join(base, ref.split("/").pop());
  };
  return { root, runDir, overlay, base, resolve, put };
}
const witnessDoc = (runDir) => JSON.parse(readFileSync(driverDir(runDir, WITNESS_FILE), "utf8"));
const msg = (...refs) => `First, read and follow exactly: ${refs.join(", ")}. Then do the work.`;

test("the refs a prompt actually carries are what get recorded — deduped, in order", () => {
  assert.deepEqual(skillRefsIn(msg(FRAMEWORK, RULES, FRAMEWORK)), [FRAMEWORK, RULES]);
  assert.deepEqual(skillRefsIn("no refs here"), []);
  assert.deepEqual(skillRefsIn(null), []);
});

test("A STAGE'S READING IS WRITTEN DOWN — path and content fingerprint", () => {
  const b = bench();
  const out = witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK, RULES), b.resolve);
  assert.equal(out.recorded, 2);
  const rows = witnessDoc(b.runDir).stages.synthesis;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.sha && r.sha.length === 12), "each carries a content sha");
  assert.ok(rows.find((r) => r.ref === FRAMEWORK).path.includes("overlay"), "and the path it resolved to");
  rmSync(b.root, { recursive: true, force: true });
});

test("EDITING A FRAMEWORK MID-RUN IS REPORTED — the whole point", () => {
  const b = bench();
  witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK), b.resolve);
  b.put(b.overlay, FRAMEWORK, "band ceilings v2 — HIGH now starts one step earlier");   // someone edits it at 2pm
  const out = witnessStageMethodology(b.runDir, "report-overview", msg(FRAMEWORK), b.resolve);

  assert.equal(out.drift.length, 1);
  assert.equal(out.drift[0].ref, FRAMEWORK);
  assert.equal(out.drift[0].firstReadBy, "synthesis");
  assert.equal(out.drift[0].nowReadBy, "report-overview");
  const [line] = describeMethodologyDrift(out);
  assert.match(line, /methodology changed mid-run/);
  assert.match(line, /followed two versions/, "and says plainly what that means for the report");
  rmSync(b.root, { recursive: true, force: true });
});

test("THE SILENT CASE: an overlay file deleted mid-run swaps the customer's rulebook for the house one", () => {
  // resolveSkillPath returns the BASE path when the overlay does not hold the file — correct, and what
  // makes the overlay opt-in per file. It also means deleting one mid-run changes what the run rates under
  // with NOTHING in any log. That is the case worth catching most, because it is the one nobody can see.
  const b = bench();
  witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK), b.resolve);
  rmSync(join(b.overlay, "risk-framework-sim-praxis.md"));
  const out = witnessStageMethodology(b.runDir, "report-overview", msg(FRAMEWORK), b.resolve);

  assert.equal(out.fellBackToBase.length, 1, "the source change is caught");
  const lines = describeMethodologyDrift(out);
  assert.ok(lines.some((l) => /SOURCE changed mid-run/.test(l)));
  assert.ok(lines.some((l) => /replaced by the house copy/.test(l)), "and named for what it is");
  rmSync(b.root, { recursive: true, force: true });
});

test("a run where nothing moves says NOTHING — silence is the normal case", () => {
  const b = bench();
  for (const stage of ["synthesis", "report-overview", "report-card", "client-summary"]) {
    const out = witnessStageMethodology(b.runDir, stage, msg(FRAMEWORK, RULES), b.resolve);
    assert.deepEqual(describeMethodologyDrift(out), [], `${stage} logged nothing`);
  }
  assert.equal(Object.keys(witnessDoc(b.runDir).stages).length, 4, "…while still recording all four");
  rmSync(b.root, { recursive: true, force: true });
});

test("a stage re-running (a retry) is not drift against itself", () => {
  // Warm retries, corrective passes and the verdict recheck all re-dispatch the same stage. Comparing a
  // stage to its own earlier reading would cry drift on every retry and drown the real signal.
  const b = bench();
  witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK), b.resolve);
  b.put(b.overlay, FRAMEWORK, "v2");
  const out = witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK), b.resolve);
  assert.deepEqual(out.drift, [], "same stage, no cross-stage claim");
  assert.equal(witnessDoc(b.runDir).stages.synthesis[0].sha.length, 12, "and the newer reading is what is stored");
  rmSync(b.root, { recursive: true, force: true });
});

test("IT CAN NEVER FAIL A TURN — a witness that breaks a run is worse than no witness", () => {
  const b = bench();
  assert.doesNotThrow(() => witnessStageMethodology(null, "synthesis", msg(FRAMEWORK), b.resolve));
  assert.doesNotThrow(() => witnessStageMethodology(b.runDir, "s", msg(FRAMEWORK), () => { throw new Error("resolver exploded"); }));
  assert.doesNotThrow(() => witnessStageMethodology(b.runDir, "s", msg(FRAMEWORK), null));
  // — unwritable BY CONSTRUCTION, not by lack of privilege. This passed `/nonexistent/dir/run`,
  // which root can create: a root run of the suite left `/nonexistent` on the real filesystem and the next
  // ordinary-user run read it as real. A path whose parent is a FILE cannot be created by anyone, and it
  // lives inside this bench's own temp root.
  const blocker = join(b.root, "blocker-1164");
  writeFileSync(blocker, "not a directory\n");
  assert.doesNotThrow(() => witnessStageMethodology(join(blocker, "dir", "run"), "s", msg(FRAMEWORK), b.resolve));
  assert.doesNotThrow(() => witnessStageMethodology(b.runDir, "s", null, b.resolve));
  // an unreadable witness file must not poison the next stage either
  writeFileSync(driverDir(b.runDir, WITNESS_FILE), "{ this is not json");
  assert.doesNotThrow(() => witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK), b.resolve));
  rmSync(b.root, { recursive: true, force: true });
});

test("a stage with no methodology refs writes nothing at all", () => {
  const b = bench();
  const out = witnessStageMethodology(b.runDir, "notify", "send the email", b.resolve);
  assert.equal(out.recorded, 0);
  assert.ok(!existsSync(driverDir(b.runDir, WITNESS_FILE)), "no file for a stage that reads no methodology");
  rmSync(b.root, { recursive: true, force: true });
});

test("IT DOES NOT TOUCH THE FRESHNESS GATE — recording and gating are different jobs", () => {
  // The load-bearing negative. Adding methodology files to stageInputs would make an ordinary edit mark a
  // stage stale and block delivery with no way out — exactly the deadlock the registry corrector was in.
  // Two independent checks: nothing is written under the freshness stamp dir, and the map still names no
  // methodology file.
  const b = bench();
  witnessStageMethodology(b.runDir, "synthesis", msg(FRAMEWORK, RULES), b.resolve);
  assert.ok(!existsSync(driverDir(b.runDir, "stage-inputs")), "no freshness stamp was written or touched");

  const stages = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8");
  const map = stages.slice(stages.indexOf("stageInputs"));
  const declared = map.slice(0, map.indexOf("\n}"));
  assert.ok(declared.length > 200, "captured the real input map, not an empty slice");
  assert.ok(!/skills\//.test(declared), "no methodology file is a freshness-gated stage input");
  rmSync(b.root, { recursive: true, force: true });
});

test("the gateway witnesses the turn it is about to run, with the SAME resolver the engine gets", () => {
  // Recording a re-derivation instead of the actual resolver would let the two disagree, which is the one
  // way this could report a comforting fiction.
  const src = readFileSync(new URL("../gateway.mjs", import.meta.url), "utf8");
  const i = src.indexOf("witnessStageMethodology(runDir, name, effMessage, engineResolveSkill)");
  assert.ok(i > 0, "the witness runs on the dispatch path");
  const after = src.slice(i, i + 900);
  assert.ok(after.includes("engine.runTurn("), "…immediately before the turn");
  assert.match(after, /resolveSkill: engineResolveSkill/, "and the engine receives that same resolver");
});
