// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: A PATH BUILT WITH "\" READS AS THE SAME PATH BUILT WITH "/".
//
// `join` builds with "\" on Windows, and every reader below held a regex or a test written against "/".
// The sharpest of them refused every full clearance at the common-law grid: the grid and dispositions
// tools accept an output path only under a run directory, and on Windows no path looked like one.
//
// Every arm drives the Windows branch HERE, on Linux, by passing the platform, and builds its Windows
// fixture with `path.win32` or a literal: a fixture built with this machine's `join` has "/" in it and
// proves nothing about Windows. Each arm also holds the Linux answer, because on Linux "\" is an ordinary
// character in a file name, and a reader that started treating it as a separator there would have moved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { underStudioSegment, lastSegment, hasSep } from "../../shared/path-seps.mjs";
import { config } from "../driver.config.mjs";
import { agentFromStudioRoot } from "../progress.mjs";
import { findStrayArtifacts } from "../stray-artifacts.mjs";
import { normalizeReason } from "../repairs.mjs";
import { isInside, denyReason } from "../authority-trees.mjs";
import { witnessStageMethodology, WITNESS_FILE } from "../methodology-witness.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const W = "win32";
const RUN = win32.join("C:\\Users\\lawyer", ".clearotron", `${config.workspacePrefix}main`, "studio", "clearance-search", "acme-1");

test("the grid's output path is inside a run directory on Windows, in either spelling of the segment", () => {
  const ledger = win32.join(RUN, "common-law-grid.a.json");
  assert.equal(underStudioSegment(ledger, W), true, `the grid tool would refuse its own ledger path: ${ledger}`);
  assert.equal(underStudioSegment(ledger.replace("clearance-search", "prelim-search"), W), true,
    "an install that kept the old segment spelling was refused on Windows");
  assert.equal(underStudioSegment(ledger.replaceAll("\\", "/"), W), true, "Windows also writes \"/\", and that spelling was refused");
  assert.equal(underStudioSegment(win32.join("C:\\Users\\lawyer", "Documents", "grid.json"), W), false,
    "a path outside every run directory was accepted");
});

test("on Linux the grid check reads exactly as it did: \"/\" only", () => {
  assert.equal(underStudioSegment("/srv/clearotron/studio/clearance-search/acme/grid.json", "linux"), true);
  assert.equal(underStudioSegment("/srv/clearotron\\studio\\clearance-search\\acme/grid.json", "linux"), false,
    "a Linux name holding \"\\\" was read as a run directory: \"\\\" is a file name character there");
  assert.equal(lastSegment("a\\b", "linux"), "a\\b");
  assert.equal(hasSep("a\\b", "linux"), false);
  assert.equal(lastSegment("C:\\x\\ledger.json", W), "ledger.json");
});

test("the agent a Windows queue and studio root belong to is read from the path", () => {
  const ws = win32.join("C:\\Users\\lawyer", ".clearotron", `${config.workspacePrefix}clawdi`);
  assert.equal(config.agentIdFromQueueDir(win32.join(ws, "studio", "clearance-search", "queue"), { platform: W }), "clawdi");
  assert.equal(config.agentIdFromQueueDir(win32.join(ws, "studio", "prelim-search", "queue") + "\\", { platform: W }), "clawdi");
  assert.equal(agentFromStudioRoot(win32.join(ws, "studio", "clearance-search"), { platform: W }), "clawdi",
    "the status rollup would show \"?\" for every Windows run");
  // Linux: unchanged, and a "\" is part of a name there.
  const lws = posix.join("/srv/clearotron", `${config.workspacePrefix}clawdi`);
  assert.equal(config.agentIdFromQueueDir(posix.join(lws, "studio", "clearance-search", "queue"), { platform: "linux" }), "clawdi");
  assert.equal(config.agentIdFromQueueDir(win32.join(ws, "studio", "clearance-search", "queue"), { platform: "linux" }), null);
});

test("a run's own root files are not strays on Windows, whichever separator named them", () => {
  // The named root files are written with "/" and the rest arrive from `join` with "\"; both are the root.
  const dictated = [`${RUN}/status.json`, win32.join(RUN, "findings.json"), win32.join(RUN, "_driver", "plan.json")];
  const strays = findStrayArtifacts(["status.json", "findings.json", "plan.json", "invented.json"], dictated, { runDir: RUN, platform: W });
  assert.deepEqual(strays.map((s) => s.name), ["plan.json", "invented.json"],
    "a dictated root file was reported as undictated, or a file inside _driver/ lent its name to the root");
  const linux = findStrayArtifacts(["findings.json"], ["/r/findings.json"], { runDir: "/r", platform: "linux" });
  assert.deepEqual(linux, [], "the Linux sweep moved");
});

test("a failure signature folds a Windows path to its file name, as a Linux one is folded", () => {
  const a = normalizeReason(`grid ledger missing at ${win32.join(RUN, "common-law-grid.a.json")}`, { platform: W });
  const b = normalizeReason(`grid ledger missing at ${win32.join("D:\\other", "acme-2", "common-law-grid.a.json")}`, { platform: W });
  assert.equal(a, b, "the same defect in two runs signed differently on Windows, so a repeat would never be recognised");
  assert.equal(normalizeReason("missing at /r/acme/x.json", { platform: "linux" }), "missing at x.json");
  assert.equal(normalizeReason("missing at C:\\r\\x.json", { platform: "linux" }), "missing at c:\\r\\x.json",
    "a Linux signature moved");
});

test("the write boundary compares Windows paths the way Windows does: either separator, any case", () => {
  const skills = "C:\\Users\\lawyer\\clearotron\\skills";
  const trees = [{ path: skills, why: "the doctrine tree" }];
  for (const target of ["c:/users/lawyer/clearotron/SKILLS/merge.sh", "C:\\Users\\lawyer\\clearotron\\skills\\sub\\x.md"]) {
    assert.ok(denyReason(target, trees, { platform: W }), `a write into the protected tree passed on Windows: ${target}`);
  }
  assert.equal(isInside(skills, "C:\\Users\\lawyer\\clearotron\\skills-backup\\x.md", { platform: W }), false,
    "a sibling folder whose name begins with the tree's name was read as inside it");
  assert.equal(isInside("/a/skills", "/a/SKILLS/x", { platform: "linux" }), false, "Linux started folding case");
  assert.equal(isInside("/a/skills", "/a/skills/x", { platform: "linux" }), true);
});

test("the methodology witness sees a Windows skills path as the skills tree", () => {
  const runDir = mkdtempSync(join(tmpdir(), "witness-win-"));
  const abs = win32.join("C:\\Users\\lawyer\\clearotron", "skills", "clearance-search", "SKILL.md");
  witnessStageMethodology(runDir, "screen", "read skills/clearance-search/SKILL.md first", () => abs, { platform: W });
  const doc = JSON.parse(readFileSync(driverDir(runDir, WITNESS_FILE), "utf8"));
  const row = doc.stages.screen?.[0];
  assert.ok(row, "the witness recorded nothing for the stage");
  assert.equal(row.resolvedOddly, undefined, "a Windows path to the skills tree was flagged as resolved oddly");
});

test("a failure naming a Windows file is still read for what failed, not stopped at the drive's colon", async () => {
  const { isFormClassFail, draftCarryEligible } = await import("../gateway.mjs");
  const { failingTarget } = await import("../repair-contract.mjs");
  const win = "invalid_file:C:\\Users\\lawyer\\run\\frame-diff.json:framediff_key_unknown";
  assert.equal(isFormClassFail(win), true, "a form defect in a Windows file was not recognised, so it is never repaired in the dispatch");
  assert.equal(draftCarryEligible("invalid_file:C:\\Users\\lawyer\\run\\out.md:use_check_missing:F1"), true,
    "a patchable defect in a Windows file was not recognised, so the warm patch never runs");
  const files = ["C:\\Users\\lawyer\\run\\frame-diff.json", "C:\\Users\\lawyer\\run\\coverage.json"];
  assert.equal(failingTarget(win, files), files[0], "the repair did not aim at the Windows file that failed");
  assert.equal(isFormClassFail("invalid_file:clearance-search/x/frame-diff.json:framediff_key_unknown"), true, "the Linux shape moved");
});
