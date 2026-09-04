// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE NOTE SAID "BYTE-FOR-BYTE UNCHANGED" AND TWO FILES CHANGED ──────
//
// A sha manifest of a canonical run directory across a real what-if: 441 of 443 files identical, two
// changed — `_driver/run.jsonl` gained the experiment's own provenance event, and `status.json`'s
// `updatedAt` moved. The result's note claimed the directory was byte-for-byte unchanged. A client who
// checks finds two modified files and a sentence saying none.
//
// THE BEHAVIOUR IS RIGHT AND THIS FILE MUST NOT BE READ AS ASKING TO STOP IT. A run should carry what
// was done to it, and that provenance row is what made the sibling framework defect findable at all.
// The sentence was what was wrong, and the honest one is stronger: the artifacts are untouched AND the
// run records that an experiment was taken against it.
//
// WHY IT WAS INVISIBLE, WHICH IS THE POINT OF THIS FILE: nothing compared the words to the filesystem.
// So these arms hash a real directory before and after the real provenance writer runs, and hold the
// SHIPPED note against what the manifest actually shows. An arm that read the sentence and agreed with
// it would reproduce the defect exactly.
//
// BREAK MATRIX:
//   · the artifacts really are untouched          → break: write one, arm 1 red
//   · the log really does change                  → break: stop recording, arm 1 red (the claim is now false the other way)
//   · the note claims artifacts, not the directory → break: restore "byte-for-byte", arm 2 red
//   · the note's own claim is checked, not copied  → break: assert a literal, arm 2 red on the next edit
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runLog } from "../log.mjs";
import { WHAT_IF_NOTE } from "../../mcp-server/lib/whatif.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";   // — the aggregate, not the recursion step

/** Every file under dir, as path → sha256. A manifest, which is the instrument this issue asked for. */
function manifest(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(relative(dir, p), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

test("2171 the manifest walk handles an empty tree rather than passing over it", () => {
  // — `walk` recurses over a DISCOVERED set, so an empty directory must be a
  // measured result rather than a loop that quietly does nothing. Driven, not argued: an empty run dir
  // manifests to an empty map, and an empty SUBDIRECTORY does not stop the files beside it being seen.
  const empty = mkdtempSync(join(tmpdir(), "whatif-empty-"));
  assert.equal(manifest(empty).size, 0, "an empty tree did not manifest as empty");
  mkdirSync(join(empty, "_experiments"), { recursive: true });
  writeFileSync(join(empty, "report.md"), "# Report\n");
  const m = manifest(empty);
  assert.deepEqual([...m.keys()], ["report.md"], "an empty leaf directory swallowed the files beside it");
});

/** A canonical run directory: the documents a client was delivered, plus the run's own records. */
function canonicalRun() {
  const dir = mkdtempSync(join(tmpdir(), "whatif-canon-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "report.md"), "# Report\nOverall: CONDITIONAL\n");
  writeFileSync(join(dir, "narrative.md"), "# Synthesis\nThe mark faces one live registration.\n");
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [{ ordinal: 1, mark: "ACME" }] }));
  writeFileSync(join(dir, "register-findings.md"), "## Findings\n| Mark | Owner |\n|---|---|\n| ACME | Beta |\n");
  writeFileSync(join(dir, "status.json"), JSON.stringify({ schema: 1, state: "delivered", updatedAt: "2026-09-01T09:00:00Z" }));
  writeFileSync(join(dir, "_driver", "run.jsonl"), JSON.stringify({ event: "stage", stage: "synthesis" }) + "\n");
  return dir;
}

const ARTIFACTS = ["report.md", "narrative.md", "findings.json", "register-findings.md"];

test("2171 the artifacts are untouched, and the run's log DOES change — measured, not asserted from prose", () => {
  const dir = canonicalRun();
  const before = manifest(dir);
  // The AGGREGATE is guarded here; the recursion step inside `walk` legitimately meets empty leaves, and
  // its empty direction is driven by its own arm below.
  nonEmpty([...before.keys()], "the canonical run's manifest");
  assert.ok(before.size >= 6, "the fixture is too thin to distinguish an untouched artifact from an absent one");

  // The real writer from the real experiment path: pipeline.mjs logs the experiment's provenance to the
  // CANONICAL run dir, which is the whole reason the directory is not byte-identical afterwards.
  runLog(dir, { event: "experiment", stage: "synthesis", engine: "test", label: "whatif", shadowDir: "_experiments/whatif-x" });

  const after = manifest(dir);
  const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k)).sort();
  const vanished = [...before.keys()].filter((k) => !after.has(k));

  assert.deepEqual(vanished, [], "a what-if removed a file from the canonical run");
  // THE CLAIM THE NOTE MAKES: the artifacts are untouched. Checked per file, against the hashes.
  for (const a of ARTIFACTS)
    assert.equal(after.get(a), before.get(a), `${a} changed — the note's "artifacts are untouched" is false`);
  // AND THE CLAIM IT NO LONGER MAKES: the directory is not byte-identical, and that is correct behaviour.
  assert.deepEqual(changed, ["_driver/run.jsonl"],
    "the set of files a what-if changes in the canonical run has moved — re-read the note before re-stamping this");
  assert.match(readFileSync(join(dir, "_driver", "run.jsonl"), "utf8"), /"event":"experiment"/,
    "the run no longer records that an experiment was taken against it — the provenance this note promises is gone");
});

test("2171 the SHIPPED note claims only what a manifest can support", () => {
  // Asserted against the exported constant, never a copy: a stub carrying its own transcript of the old
  // sentence is how the corrected claim survived in the tree, and that stub is now pointed here too.
  assert.doesNotMatch(WHAT_IF_NOTE, /byte-for-byte unchanged/i,
    "the note claims the canonical run is byte-for-byte unchanged, and two files change");
  assert.doesNotMatch(WHAT_IF_NOTE, /the canonical run is unchanged|nothing (?:was )?(?:is )?changed/i,
    "the note still claims the directory as a whole is unchanged");
  // What it must say instead — the two clauses that survive the check the old sentence fails.
  assert.match(WHAT_IF_NOTE, /artifacts are untouched/i, "the note does not say what IS unchanged");
  assert.match(WHAT_IF_NOTE, /log records that this experiment was taken against it/i,
    "the note hides the provenance write — a client who checks finds a modified file the note never mentioned");
  assert.match(WHAT_IF_NOTE, /_experiments\//, "the note no longer says where the output lives");
});

test("2171 an artifact that DID change fails the claim — the arm is not green by construction", () => {
  // The plant. Without it, arm 1 passes on a manifest that never had a chance to disagree.
  const dir = canonicalRun();
  const before = manifest(dir);
  writeFileSync(join(dir, "report.md"), "# Report\nOverall: LOW\n");   // a what-if editing the delivered report
  const after = manifest(dir);
  const changedArtifacts = ARTIFACTS.filter((a) => before.get(a) !== after.get(a));
  assert.deepEqual(changedArtifacts, ["report.md"],
    "the manifest cannot see an edited artifact — arm 1 proves nothing");
  assert.ok(statSync(join(dir, "report.md")).size > 0);
});
