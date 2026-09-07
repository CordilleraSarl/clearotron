// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A DOCUMENT NOBODY DICTATED IS A DOCUMENT NOBODY VALIDATED.
//
// The observed defect, R2 @d90d9bd 2026-08-06: the run dir was published carrying TWO half-a findings
// files. `COMMON-LAW-FINDINGS.half-a.md` (18 KB, 08:57) was never dictated, never validated and never
// read — `grep -c COMMON-LAW-FINDINGS _driver/run.jsonl` returns 0 — while `common-law-findings.half-a.md`
// (36 KB, 09:21) was the real one. Different documents, not a copy, and the stray is the stale one.
//
// The entry list below is the REAL root listing of that delivered run directory. It is what makes this
// test worth anything: a hand-written list would prove only that the code agrees with my idea of a run
// dir, and the two false-positive classes it caught (status.json, and the obligations receipts)
// existed precisely because I had not looked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paths } from "../stages.mjs";
import { dictatedPaths, findStrayArtifacts, treeSnapshot, findStrayInTree } from "../stray-artifacts.mjs";
import { MEANING_SEAT } from "../common-law-receipts.mjs";

const RUN = "/RUN";
const P = paths(RUN);
const DICT = dictatedPaths(P, { axes: ["primary-sweep", "transliteration-numeric"] });

// The delivered run dir's root files, verbatim (directories excluded).
const DELIVERED = [
  "COMMON-LAW-FINDINGS.half-a.md", "all_candidates.txt", "audit.md", "band-shape.md",
  "blind-frame-model.json", "case-law-findings.md", "common-law-findings.half-a.md",
  "common-law-findings.half-b.md", "common-law-findings.md", "common-law-grid.half-a.json",
  "common-law-grid.half-b.json", "common-law-grid.json",
  "connotation-obligations.common-law-grid.half-a.json",
  "connotation-obligations.common-law-grid.half-b.json", "crowd-context.md", "email-body.md",
  "findings.json", "form-neighbourhood.json", "frame-diff.json", "frame-diff.md",
  "matter-context.md", "narrative.md", "placement-recommendations.md", "placements.json",
  "register-coverage-ledger.json", "register-findings.md", "register-named-band.json",
  "report-overview.md", "report.md", "scope-ledger.json", "senior-eye-review.md",
  "skeptic-flags.md", "status.json", "variant-manifest.json", "variant-manifest.md",
];

test("#444 the real delivered run dir yields EXACTLY the one stray it actually carried", () => {
  const stray = findStrayArtifacts(DELIVERED, DICT, { runDir: RUN });
  assert.deepEqual(stray.map((s) => s.name), ["COMMON-LAW-FINDINGS.half-a.md"]);
  assert.match(stray[0].why, /never validated/);
});

test("#444 the check is CASE-SENSITIVE — a tolerant compare waves through the only real example", () => {
  // COMMON-LAW-FINDINGS.half-a.md differs from the dictated name in case alone. That is the whole
  // observed defect, so case tolerance here would make this module useless on the one file it is for.
  assert.equal(findStrayArtifacts(["common-law-findings.half-a.md"], DICT, { runDir: RUN }).length, 0);
  assert.equal(findStrayArtifacts(["Common-Law-Findings.half-a.md"], DICT, { runDir: RUN }).length, 1);
});

test("#444 driver-written root files are named, and their names are DERIVED, never wildcarded", () => {
  // status.json and the obligations receipts are written by the driver at computed paths and are
  // not strays. Each is admitted by its exact name — so a model that invents a similar-looking one is
  // still caught, which a `connotation-obligations.*.json` wildcard would not do.
  assert.equal(findStrayArtifacts(["status.json", "connotation-obligations.common-law-grid.half-b.json"], DICT, { runDir: RUN }).length, 0);
  assert.deepEqual(
    findStrayArtifacts(["connotation-obligations.MY-OWN-NOTES.json", "status-report.json"], DICT, { runDir: RUN }).map((s) => s.name),
    ["connotation-obligations.MY-OWN-NOTES.json", "status-report.json"]);
});

test("#524 the judged set covers every DELIVERABLE shape — the biggest stray ever seen was a .csv", () => {
  // The four documents a clearance left outside its run dir. The largest was
  // `<MARK>_Search_Results.csv`: a 39-platform x 12-variant grid, the biggest single body of evidence the
  // sweep produced and the material behind a negative finding. Under the old `/\.(md|json)$/` it was
  // invisible to this detector even when pointed straight at it. No `.csv` path is dictated anywhere in
  // the driver, so widening cannot turn a real artifact into a false positive.
  assert.deepEqual(
    findStrayArtifacts(["MARK_Search_Results.csv", "MARK_Supplementary_Search_Matrix.md",
      "MARK_Search_Methodology.md", "MARK_Executive_Summary.md"], DICT, { runDir: RUN }).map((s) => s.name),
    ["MARK_Search_Results.csv", "MARK_Supplementary_Search_Matrix.md",
      "MARK_Search_Methodology.md", "MARK_Executive_Summary.md"]);
  for (const n of ["sheet.xlsx", "render.html", "summary.pdf", "brief.docx"])
    assert.equal(findStrayArtifacts([n], DICT, { runDir: RUN }).length, 1, `${n} is a document somebody could mistake for product`);
});

test("#444 only documents are judged, and the driver's own suffix conventions are not strays", () => {
  assert.equal(findStrayArtifacts(["all_candidates.txt", "scratch.log", "notes"], DICT, { runDir: RUN }).length, 0,
    "a stray .txt is noise; a stray REPORT is the defect — widening to every extension makes a detector nobody reads");
  assert.equal(findStrayArtifacts(["report.md.prev-9be3b63f9751", "findings.json.tmp"], DICT, { runDir: RUN }).length, 0,
    "the supersede chain and the atomic-write staging suffix are driver conventions");
  assert.deepEqual(findStrayArtifacts(["invented.md.prev-9be3b63f9751"], DICT, { runDir: RUN }).map((s) => s.name),
    ["invented.md.prev-9be3b63f9751"], "but the suffix must not launder an undictated base name");
});

test("#444 a dictated sidecar under _driver/ cannot lend its name to a root file", () => {
  // record-carry.json is dictated at _driver/record-carry.json. A root-level file of that name is not
  // that artifact, and matching on basename alone would admit it.
  assert.deepEqual(findStrayArtifacts(["record-carry.json"], DICT, { runDir: RUN }).map((s) => s.name),
    ["record-carry.json"]);
});

test("#444 dictatedPaths reads the paths() factory itself, so it cannot drift from what stages write", () => {
  // The count scales with how many register axes are fed in (each axis factory contributes several
  // paths), so this is a floor on the AXIS-INDEPENDENT vocabulary rather than a pinned total — a pinned
  // one would fail on every legitimate new artifact and teach the next reader to bump it without looking.
  assert.ok(DICT.size > 80, `the dictated vocabulary must be the real one, got ${DICT.size}`);
  assert.ok(DICT.has(`${RUN}/report.md`) && DICT.has(`${RUN}/findings.json`));
  // the per-half factories are exercised, not just the plain strings
  assert.ok(DICT.has(`${RUN}/common-law-findings.half-b.json`.replace(".json", ".md")));
  assert.ok(!DICT.has(RUN), "the run dir is the thing being judged, never an artifact in it");
});

test("#517 the MEANING SEAT's four artifacts are dictated — a detector wrong four times a run is one nobody reads", () => {
  // Every one of these is written on a split clearance run: the seat's findings, the ledger the grid
  // tool writes for it, the disposition form it fills in, and the obligations sidecar the tool writes
  // beside that ledger. All four are .md/.json at the run root, so all four are JUDGED — and with
  // `halves` defaulted to the two GRID halves they were outside the dictated vocabulary entirely.
  //
  // Nothing would have failed. This module LOGS: it never deletes, never gates, never fails a run. That
  // is exactly why this needed a test rather than a run to find — four false positives per clearance,
  // silently, until a reader stopped believing the detector.
  const names = [
    `common-law-findings.half-${MEANING_SEAT}.md`,
    `common-law-grid.half-${MEANING_SEAT}.json`,
    `common-law-dispositions.half-${MEANING_SEAT}.json`,
    `connotation-obligations.common-law-grid.half-${MEANING_SEAT}.json`,
  ];
  const dictated = dictatedPaths(P, { axes: ["primary-sweep", "transliteration-numeric"] });
  assert.deepEqual(findStrayArtifacts(names, dictated, { runDir: RUN }), [],
    "the default seat vocabulary covers every seat a split run dispatches");
  for (const n of names) assert.ok(dictated.has(`${RUN}/${n}`), `${n} is in the dictated set by name, not by wildcard`);
  // …and the guarantee that makes that safe: a model-invented look-alike is still caught, because each
  // name is DERIVED from the same factory the writer uses rather than admitted by a `half-*` pattern.
  assert.deepEqual(
    findStrayArtifacts([`common-law-findings.half-${MEANING_SEAT}-DRAFT.md`, "common-law-grid.half-zz.json"], dictated, { runDir: RUN })
      .map((s) => s.name),
    [`common-law-findings.half-${MEANING_SEAT}-DRAFT.md`, "common-law-grid.half-zz.json"]);
});

// ── — A CLEARANCE STAGE WROTE EXECUTABLE SCRATCH INTO THE DOCTRINE TREE ─────────────────────────
//
// Found on production: `skills/merge.sh` (613 B) and `skills/update_dispositions.py` (961 B), untracked,
// inside the generated tree `CLEAROTRON_INSTRUCTIONS_DIR` points at, both written during a live clearance. Both
// bulk-merged a separately-authored JSON into the meaning seat's disposition form — the seat could not
// fill the form in the flow, so it wrote a tool to do it, and it had somewhere to put the tool because
// `buildClaudeArgs` passes `--add-dir <skillsDir>` and an --add-dir root is a WRITE root.
//
// The run-dir sweep could never see this: it reads the run dir, and this is one directory over.
test("#595 a file that appears in the doctrine tree during a run is a stray", () => {
  const before = new Set(["prelim-search/SKILL.md", "prelim-register/digest.md"]);
  const after = new Set([...before, "merge.sh", "update_dispositions.py"]);
  assert.deepEqual(findStrayInTree(before, after), ["merge.sh", "update_dispositions.py"],
    "both files the production incident left behind, named");
  assert.deepEqual(findStrayInTree(before, before), [], "an untouched tree is silent");
});

test("#595 a MISSING snapshot reports nothing — 'we never looked' is not 'everything is a stray'", () => {
  // The failure mode that would make this useless: report the whole tree once and the first real write
  // is invisible in the noise. An absence is a finding elsewhere; here it is an absence of evidence.
  assert.deepEqual(findStrayInTree(new Set(), new Set(["a.md"])), []);
  assert.deepEqual(findStrayInTree(null, new Set(["a.md"])), []);
  assert.deepEqual(findStrayInTree(new Set(["a.md"]), null), []);
});

test("#595 the snapshot walks nested directories, and an unreadable one is not a throw", () => {
  const tree = {
    "/t": [{ name: "SKILL.md", isDirectory: () => false }, { name: "sub", isDirectory: () => true }],
    "/t/sub": [{ name: "digest.md", isDirectory: () => false }, { name: "locked", isDirectory: () => true }],
  };
  const readdir = (d) => { if (d === "/t/sub/locked") throw new Error("EACCES"); return tree[d] ?? []; };
  assert.deepEqual([...treeSnapshot("/t", readdir)].sort(), ["SKILL.md", "sub/digest.md"],
    "nested files carry their path, so two files of the same basename are two facts");
  // an unreadable subtree costs that subtree, never the sweep
  assert.equal(treeSnapshot("/nope", () => { throw new Error("ENOENT"); }).size, 0);
});

test("#595 the sweep is wired, reports LOUDLY, and can never cost a run", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /function sweepStrayArtifacts\(ctx, stageName\) \{\n  sweepDoctrineTree\(ctx, stageName\)/,
    "it runs on the same seam as the run-dir sweep — after every stage");
  const fn = src.slice(src.indexOf("function sweepDoctrineTree"), src.indexOf("function sweepStrayArtifacts"));
  assert.match(fn, /event: "doctrine-write"/, "it lands in run.jsonl, not only on stderr");
  assert.match(fn, /the doctrine `\n\s*\+ `tree is an INPUT/,
    "the note says what the tree IS, because a reader who has not met this defect needs that");
  assert.match(fn, /catch \{ \/\* a hygiene sweep must never be able to affect a run \*\/ \}/,
    "never-kill: a hygiene sweep that can fail a run is worse than the defect it reports");
  assert.match(fn, /if \(!doctrineBefore\.has\(P\.runDir\)\) \{[^}]*return; \}/,
    "the first sweep only SNAPSHOTS — otherwise the whole tree reads as new");
});

test("2084 the #1846 provenance sidecar is DECLARED — and only beside the ledgers the tool serves", () => {
  // The owner's 2026-08-31 run warned `[stray-artifact] common-law-grid.half-m.provenance.json — no
  // stage dictates this path`. The writer is grid-provenance.mjs (which provider served the grid,
  // written beside the verbatim ledger because the ledger cannot carry it), and its reader is the
  // run-dir AUDITOR — real, per 's own header: the 2026-08-24 round mis-reported this lane as
  // quota-starved off a SerpAPI counter, with no artifact naming the true provider. Declared, from
  // the writer's own path function, never a second spelling.
  const P = paths("/tmp/stray-check-run");
  const d = dictatedPaths(P);
  assert.ok(d.has("/tmp/stray-check-run/common-law-grid.provenance.json"), "the full-grid sidecar is undeclared");
  for (const h of ["a", "b", "m"])
    assert.ok(d.has(`/tmp/stray-check-run/common-law-grid.half-${h}.provenance.json`), `the half-${h} sidecar is undeclared`);
  // NOT a wildcard: a provenance file beside any OTHER ledger is still a stray — a new writer nothing
  // has decided about. The supplemental lane's is the nearest such member.
  assert.ok(!d.has("/tmp/stray-check-run/common-law-grid.supp-x1.provenance.json"),
    "a supplemental provenance sidecar slipped into the dictated set — the declaration became a wildcard");
});
