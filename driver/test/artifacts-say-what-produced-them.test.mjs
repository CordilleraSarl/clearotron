// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — AN ARTIFACT THAT DOES NOT SAY WHAT PRODUCED IT.
//
// Three gaps, one story, and each one individually reads as a nice-to-have. Together they are why a
// three-run baseline needed a day of archaeology and produced two retractions:
//
//   1. no run dir recorded the engine commit, so every delta was attributed BY CLOCK, not by ancestry;
//   2. the common-law grid named no provider, so a flat SerpAPI counter was read across a lane SerpAPI
//      does not serve;
//   3. a score quoted in an issue carried no scorer version, so its own headline number silently
//      stopped being comparable to any number produced after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { seedRunStatus, writeRunStatus } from "../progress.mjs";
import { engineCommit } from "../engine-build.mjs";
import { gridProvenancePath, gridProvenanceRecord, writeGridProvenance } from "../engine/mcp/grid-provenance.mjs";

const scratch = (fn) => {
  const root = mkdtempSync(join(tmpdir(), "prov-1846-"));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};
const ctxFor = (runDir) => ({
  job: { id: "TMP9001", ref: "E2E-ARM", markName: "ARM MARK", classes: [9], forwarder: "demo" },
  run: { runDir, slug: "arm", date: "2026-08-25", codename: "synthetic-arm-label" },
  agent: "clawdi",
});

// ── 1. the run dir names the engine that served it ────────────────────────────────────────────────
test("#1846 the SEED stamps the engine commit — readable before a run has delivered anything", () => {
  scratch((root) => {
    const runDir = join(root, "run"); mkdirSync(runDir, { recursive: true });
    seedRunStatus(ctxFor(runDir));
    const st = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));   // from DISK: what a later reader actually finds
    // The seed runs at run START, which is the whole point: meta.json carries this today and meta.json
    // is written at PUBLISH. A failed, parked or in-flight run — exactly the set a reader compares —
    // has no meta.json at all.
    assert.equal(st.state, "running", "this is the in-flight state, not a delivered one");
    assert.equal(st.engineCommit, engineCommit(),
      "the run dir must name the same engine the pool copy names — one fact, one spelling");
  });
});

test("#1846 a RESUME does not rewrite it — this names the engine the run STARTED on", () => {
  scratch((root) => {
    const runDir = join(root, "run"); mkdirSync(runDir, { recursive: true });
    seedRunStatus(ctxFor(runDir));
    const onDisk = () => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
    const first = onDisk().engineCommit;
    // A resume after a redeploy legitimately executes different code. `attempts` is what tells a reader
    // a resume happened; rewriting this field would silently restate what the EARLIER attempts ran.
    writeRunStatus(ctxFor(runDir), { engineCommit: "0000000000000000000000000000000000000000", state: "running" });
    assert.equal(onDisk().engineCommit, first,
      "first write wins, exactly like startedAt beside it and for the same reason");
  });
});

test("#1846 a checkout that cannot name itself records null, not a wrong sha and not a throw", () => {
  // `engineCommit()` catches and returns null. That matters HERE because this is the identity seed: a
  // throw would cost the run its record, which is the failure `status-write-failed` exists to surface.
  // A null says "this run's code cannot be named" — a different and honest answer from a wrong sha.
  const v = engineCommit();
  assert.ok(v === null || /^[0-9a-f]{40}$/.test(v), `engineCommit() must be a sha or null, got ${JSON.stringify(v)}`);
});

// ── 2. the grid names the provider that served it ─────────────────────────────────────────────────
test("#1846 the grid provenance names PERPLEXITY — the lane SerpAPI does not serve", () => {
  const rec = gridProvenanceRecord({ ran: true, present: 210, requested: 210, model: null });
  assert.equal(rec.provider, "perplexity",
    "the R2 round read a flat SerpAPI counter across this lane and called it quota-starved; the grid "
    + "runs in perplexity's agent sandbox and no artifact said so");
  assert.equal(rec.tool, "perplexity_research");
  assert.deepEqual(rec.cells, { present: 210, requested: 210 });
  // NO COST FIELD. The agent API returns no per-call credit figure, so a number here would be invented.
  // The issue asks for "per-query cost"; this states the count and says it is not a price rather than
  // inventing one — the half that can be answered honestly, with the other half named.
  assert.ok(!("cost" in rec) && !("credits" in rec) && !("price" in rec),
    "a cost this code cannot read must be absent, never estimated");
  assert.match(rec._cells, /NOT A COST/, "and the count must say what it is not");
});

test("#1846 an ALREADY-RECORDED grid says nothing was bought — a stamp is not a receipt for a purchase", () => {
  const rec = gridProvenanceRecord({ ran: false, present: 210, requested: 210 });
  assert.equal(rec.ran, false);
  assert.match(rec._ran, /nothing was bought/,
    "the tool answers from the ledger when a spec is already complete — stamping that as a run would "
    + "make a re-read look like a second sweep");
});

test("#1846 the sidecar sits beside the ledger, derived from the ledger's own path", () => {
  assert.equal(gridProvenancePath("/x/studio/prelim-search/r/common-law-grid.json"),
    "/x/studio/prelim-search/r/common-law-grid.provenance.json");
  scratch((root) => {
    const out = join(root, "common-law-grid.json");
    writeGridProvenance({ output_path: out }, { ran: true, present: 3, requested: 4 });
    const p = gridProvenancePath(out);
    assert.ok(existsSync(p), "written beside the ledger");
    assert.equal(JSON.parse(readFileSync(p, "utf8")).provider, "perplexity");
  });
});

test("#1846 a sidecar that cannot be written never costs a completed grid", () => {
  // The ledger is already on disk and cost real money by the time this runs. Best-effort, like every
  // other sidecar on this path.
  assert.doesNotThrow(() => writeGridProvenance({ output_path: "/nonexistent/dir/common-law-grid.json" },
    { ran: true, present: 1, requested: 1 }));
});

// ── 3. the score names the scorer that produced it ────────────────────────────────────────────────
test("#1846 the HUMAN score output names the scorer version and the run's engine", () => {
  const src = readFileSync(join(dirname(dirname(dirname(new URL(import.meta.url).pathname))), "scripts", "score.mjs"), "utf8");
  // `--json` has carried `scorer_version` since this file shipped. The gap was the HUMAN path, which is
  // the one whose numbers get pasted into an issue: 's body states 6/9 for a run that re-scores
  // 5/2/2 today, across two scorer changes, so every delta quoted from it crosses an unmarked boundary.
  assert.match(src, /console\.log\(`scorer:\s+v\$\{SCORER_VERSION\}/,
    "print() must state the instrument beside the number a reader carries away");
  assert.match(src, /console\.log\(`engine:\s+\$\{run\.engineCommit/,
    "and the engine that produced the run being scored");
  assert.match(src, /engine_commit: run\.engineCommit/,
    "the --json payload carries both instruments too — a consumer automating on it must not have less");
});
