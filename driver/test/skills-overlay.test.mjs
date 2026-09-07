// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Layered skill resolution: OVERLAY (deployment config store — customer-specific) over BASE
// (driver/skills — git-tracked generic methodology). Pure/offline over temp dirs.
//
// The property that matters most is the FIRST test: while the overlay holds every file, resolution is
// byte-for-byte what it was before this change. That is what makes the migration file-by-file and
// reversible instead of a flag day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { absolutizeSkillRefs, buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// A minimal stand-in for the config object's resolution contract, so the test does not depend on env.
function makeResolver({ overlayDir, baseDir }) {
  return (rel) => {
    const r = String(rel).replace(/^\/+/, "");
    if (overlayDir) {
      const p = join(dirname(overlayDir), r);
      if (existsSync(p)) return p;
    }
    return join(dirname(baseDir), r);
  };
}
function trees() {
  const root = mkdtempSync(join(tmpdir(), "skills-overlay-"));
  const baseDir = join(root, "repo", "skills");
  const overlayDir = join(root, "config", "skills");
  for (const d of [join(baseDir, "prelim-register"), join(overlayDir, "prelim-register"), join(overlayDir, "prelim-search")])
    mkdirSync(d, { recursive: true });
  return { root, baseDir, overlayDir };
}
const put = (dir, rel, body) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };

test("SAFETY: while the overlay holds the file, resolution is unchanged — the migration is opt-in per file", () => {
  const { root, baseDir, overlayDir } = trees();
  put(baseDir, "prelim-register/digest.md", "REPO COPY");
  const live = put(overlayDir, "prelim-register/digest.md", "LIVE COPY");
  const resolve = makeResolver({ overlayDir, baseDir });
  assert.equal(resolve("skills/prelim-register/digest.md"), live, "the overlay still wins — nothing changes on deploy");
  rmSync(root, { recursive: true, force: true });
});

test("a file deleted from the overlay falls through to the repo — one editable home, no drift", () => {
  const { root, baseDir, overlayDir } = trees();
  const repo = put(baseDir, "prelim-register/digest.md", "REPO COPY");
  const resolve = makeResolver({ overlayDir, baseDir });
  assert.equal(resolve("skills/prelim-register/digest.md"), repo);
  rmSync(root, { recursive: true, force: true });
});

test("customer-specific material stays overlay-only and is still found (it never enters the repo)", () => {
  const { root, baseDir, overlayDir } = trees();
  const fw = put(overlayDir, "prelim-search/risk-framework-acme.md", "ACME framework");
  const resolve = makeResolver({ overlayDir, baseDir });
  assert.equal(resolve("skills/prelim-search/risk-framework-acme.md"), fw);
  rmSync(root, { recursive: true, force: true });
});

test("a skill missing from BOTH resolves to the base path — it fails loudly against the canonical home", () => {
  const { root, baseDir, overlayDir } = trees();
  const resolve = makeResolver({ overlayDir, baseDir });
  assert.equal(resolve("skills/nope/SKILL.md"), join(dirname(baseDir), "skills/nope/SKILL.md"));
  rmSync(root, { recursive: true, force: true });
});

test("no overlay configured at all (a clean standalone install) → everything resolves to the repo", () => {
  const { root, baseDir } = trees();
  const repo = put(baseDir, "prelim-register/digest.md", "REPO COPY");
  const resolve = makeResolver({ overlayDir: null, baseDir });
  assert.equal(resolve("skills/prelim-register/digest.md"), repo);
  rmSync(root, { recursive: true, force: true });
});

// ── the engine seam ────────────────────────────────────────────────────────
test("absolutizeSkillRefs routes EACH reference independently through the resolver", () => {
  const { root, baseDir, overlayDir } = trees();
  put(baseDir, "prelim-register/digest.md", "REPO");
  put(baseDir, "prelim-search/synthesis-rules.md", "REPO");
  put(overlayDir, "prelim-search/risk-framework-acme.md", "OVERLAY");
  const resolve = makeResolver({ overlayDir, baseDir });
  const msg = "Read skills/prelim-register/digest.md and skills/prelim-search/risk-framework-acme.md and skills/prelim-search/synthesis-rules.md.";
  const out = absolutizeSkillRefs(msg, overlayDir, resolve);
  assert.ok(out.includes(join(dirname(baseDir), "skills/prelim-register/digest.md")), "generic → repo");
  assert.ok(out.includes(join(dirname(overlayDir), "skills/prelim-search/risk-framework-acme.md")), "customer → overlay");
  assert.ok(out.includes(join(dirname(baseDir), "skills/prelim-search/synthesis-rules.md")), "generic → repo");
  rmSync(root, { recursive: true, force: true });
});

test("absolutizeSkillRefs without a resolver keeps the legacy single-dir behaviour exactly", () => {
  const msg = "Read skills/a/SKILL.md.";
  assert.equal(absolutizeSkillRefs(msg, "/x/y/skills"), "Read /x/y/skills/a/SKILL.md.");
});

test("the engine is granted read access to BOTH roots (a prompt may cite files from each)", () => {
  const { args } = buildClaudeArgs({
    message: "hi", model: "opus", thinking: "low",
    skillsDir: "/cfg/skills", skillsGrantRoots: ["/cfg/skills", "/repo/driver/skills"], runDir: "/run/x",
  });
  const addDirs = args.reduce((acc, a, i) => (a === "--add-dir" ? [...acc, args[i + 1]] : acc), []);
  assert.ok(addDirs.includes("/cfg/skills"), "overlay readable");
  assert.ok(addDirs.includes("/repo/driver/skills"), "base readable");
});

test("legacy call with only skillsDir still grants that one root", () => {
  const { args } = buildClaudeArgs({ message: "hi", model: "opus", thinking: "low", skillsDir: "/cfg/skills", runDir: "/run/x" });
  const addDirs = args.reduce((acc, a, i) => (a === "--add-dir" ? [...acc, args[i + 1]] : acc), []);
  assert.ok(addDirs.includes("/cfg/skills"));
});

// ── the silent-degradation guard ───────────────────────────────────────────
test("a configured-but-unreadable overlay FAILS LOUD instead of silently using repo defaults", async () => {
  // existsSync answers false for EACCES exactly as it does for ENOENT, so an overlay the process cannot
  // read would resolve every file to the repo — silently swapping a customer's own risk framework for the
  // house default. (Observed for real: as a user without access to the config store, even
  // risk-framework-aurora.md — which exists ONLY in the overlay — resolved to the repo path.)
  const { config } = await import("../driver.config.mjs");
  const prev = process.env.CLEAROTRON_INSTRUCTIONS_DIR;
  pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", join(tmpdir(), "definitely-not-a-real-skills-dir-9f3a2"));
  try {
    assert.throws(() => config.resolveSkillPath("skills/prelim-register/digest.md"), /skills_overlay_unreadable/);
  } finally {
    pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", prev);
  }
});
