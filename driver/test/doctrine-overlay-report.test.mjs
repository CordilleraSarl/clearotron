// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — AN OVERRIDDEN DOCTRINE FILE THAT IS MERELY OUT OF DATE FAILS NOTHING.
//
// Doctrine is prompt payload served to the model at runtime, so an override that has silently gone
// stale answers a clearance from old doctrine with nothing to say so. We ran this experiment on
// ourselves: `driver/driver.config.mjs:170` records 30 of 37 shared files silently drifting apart in
// BOTH directions after the repo split. The overlay fixed the mechanism for us and fixes nothing for a
// self-hoster.
//
// THE JUDGEMENT THIS FILE ENFORCES: a report that cannot tell "I never overrode this" from "I could
// not read it" is the failure this repo keeps writing down. UNKNOWN is a first-class answer and must
// never collapse into "unchanged" — inferring a baseline nobody recorded is the defect, not the fix.
//
// Fixtures are synthetic. A real overlay's FILENAMES are customer-derived, which is why the report's
// output must never be pasted anywhere public and why nothing real appears here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { overlayReport, renderOverlayReport, readProvenance, treeFiles, PROVENANCE_FILE }
  from "../../shared/doctrine-overlay.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

function trees({ base = {}, overlay = null, provenance = undefined } = {}) {
  const root = mkdtempSync(join(tmpdir(), "doctrine-"));
  const baseRoot = join(root, "base");
  const write = (dir, files) => {
    for (const [rel, body] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, body);
    }
  };
  mkdirSync(baseRoot, { recursive: true });
  write(baseRoot, base);
  let overlayRoot = null;
  if (overlay) {
    overlayRoot = join(root, "overlay");
    mkdirSync(overlayRoot, { recursive: true });
    write(overlayRoot, overlay);
    if (provenance !== undefined) writeFileSync(join(overlayRoot, PROVENANCE_FILE), provenance);
  }
  return { root, baseRoot, overlayRoot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("an install that overrides nothing says so in one line, as a normal state", () => {
  const t = trees({ base: { "a/SKILL.md": "x", "b/SKILL.md": "y" } });
  try {
    const r = overlayReport({ baseRoot: t.baseRoot, overlayRoot: null });
    assert.equal(r.ok, true);
    assert.equal(r.overlayConfigured, false);
    assert.deepEqual(r.overridden, []);
    const text = renderOverlayReport(r).join("\n");
    assert.match(text, /overrides nothing/);
    assert.match(text, /normal, supported state/,
      "it must read as normal, not as a warning — most installs override nothing");
  } finally { t.cleanup(); }
});

test("overrides, additions and untouched files are counted separately", () => {
  const t = trees({
    base: { "a/SKILL.md": "upstream a", "b/SKILL.md": "upstream b", "c/SKILL.md": "upstream c" },
    overlay: { "a/SKILL.md": "mine a", "z/OWN.md": "only mine" },
  });
  try {
    const r = overlayReport({ baseRoot: t.baseRoot, overlayRoot: t.overlayRoot });
    assert.deepEqual(r.overridden.map((o) => o.rel), ["a/SKILL.md"]);
    assert.deepEqual(r.added, ["z/OWN.md"], "an overlay-only file is this install's own, not an override");
    assert.deepEqual(r.baseOnly, ["b/SKILL.md", "c/SKILL.md"], "and the rest come from the product");
  } finally { t.cleanup(); }
});

test("with no recorded point, every override reads UNKNOWN and the report SAYS it cannot tell", () => {
  // The whole judgement. "Unchanged" here would be a claim nobody is entitled to make.
  const t = trees({ base: { "a/SKILL.md": "upstream" }, overlay: { "a/SKILL.md": "mine" } });
  try {
    const r = overlayReport({ baseRoot: t.baseRoot, overlayRoot: t.overlayRoot });
    assert.equal(r.provenance.present, false);
    assert.equal(r.overridden[0].drift.state, "unknown");
    const text = renderOverlayReport(r).join("\n");
    assert.match(text, /CANNOT SAY WHETHER UPSTREAM HAS MOVED/);
    // Assert the STATE, not the word: the guarantee sentence itself says "reported as UNKNOWN rather
    // than unchanged", so a bare word match trips on the promise being kept.
    assert.equal(r.overridden.filter((o) => o.drift.state === "unchanged").length, 0,
      "no file may be reported unchanged when no baseline was ever taken");
    assert.doesNotMatch(text, /^\s*UNCHANGED/m, "and no group is headed UNCHANGED");
    assert.match(text, /UNKNOWN — no recorded point \(1\)/, "the one override is listed under UNKNOWN");
  } finally { t.cleanup(); }
});

test("a recorded point that still matches reads unchanged; one that does not reads CHANGED", () => {
  const upstream = "upstream v1";
  const prov = JSON.stringify({ files: { "a/SKILL.md": { sha256: sha(upstream), taken_at: "2026-01-01" } } });

  const same = trees({ base: { "a/SKILL.md": upstream }, overlay: { "a/SKILL.md": "mine" }, provenance: prov });
  try {
    const r = overlayReport({ baseRoot: same.baseRoot, overlayRoot: same.overlayRoot });
    assert.equal(r.overridden[0].drift.state, "unchanged");
  } finally { same.cleanup(); }

  const moved = trees({ base: { "a/SKILL.md": "upstream v2 — changed" }, overlay: { "a/SKILL.md": "mine" }, provenance: prov });
  try {
    const r = overlayReport({ baseRoot: moved.baseRoot, overlayRoot: moved.overlayRoot });
    assert.equal(r.overridden[0].drift.state, "changed");
    const text = renderOverlayReport(r).join("\n");
    assert.match(text, /CHANGED UPSTREAM/);
    assert.match(text, /a\/SKILL\.md/, "and it must name the file — a count alone cannot be acted on");
    assert.match(text, /2026-01-01/, "…and when the copy was taken");
  } finally { moved.cleanup(); }
});

test("an UNREADABLE provenance file is not an absent one", () => {
  // The distinction the issue names: "if the recorded provenance is missing for an overridden file,
  // say that, do not report it as unchanged" — and a corrupt file is a third state again.
  const t = trees({ base: { "a/SKILL.md": "u" }, overlay: { "a/SKILL.md": "m" }, provenance: "{ not json" });
  try {
    const prov = readProvenance(t.overlayRoot);
    assert.equal(prov.present, false);
    assert.equal(prov.unreadable, true, "unreadable must be distinguishable from never-recorded");
    assert.match(prov.why, /present but unreadable/);
  } finally { t.cleanup(); }
});

test("a file upstream no longer ships is its own state, not silent agreement", () => {
  const prov = JSON.stringify({ files: { "gone/SKILL.md": { sha256: sha("whatever") } } });
  const t = trees({ base: { "a/SKILL.md": "u" }, overlay: { "gone/SKILL.md": "m", "a/SKILL.md": "m" }, provenance: prov });
  try {
    const r = overlayReport({ baseRoot: t.baseRoot, overlayRoot: t.overlayRoot });
    // `gone/SKILL.md` has no upstream counterpart at all, so it is an ADDITION, not an override —
    // the report must not invent an upstream file to compare against.
    assert.deepEqual(r.added, ["gone/SKILL.md"]);
    assert.deepEqual(r.overridden.map((o) => o.rel), ["a/SKILL.md"]);
  } finally { t.cleanup(); }
});

test("a configured overlay that does not exist is a deploy defect, reported as one", () => {
  // resolveSkillPath THROWS on this for the same reason: every doctrine file would silently fall back
  // to the repo copy, swapping a customer's own material for the house default with nothing in the log.
  const t = trees({ base: { "a/SKILL.md": "u" } });
  try {
    const r = overlayReport({ baseRoot: t.baseRoot, overlayRoot: join(t.root, "nope") });
    assert.equal(r.ok, false);
    assert.match(r.reason, /silently falling back/);
  } finally { t.cleanup(); }
});

test("a missing base tree cannot be reported as a clean install", () => {
  const r = overlayReport({ baseRoot: join(tmpdir(), "definitely-not-here-1724"), overlayRoot: null });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot serve doctrine at all/);
  assert.match(renderOverlayReport(r).join("\n"), /CANNOT REPORT/);
});

test("treeFiles answers null for a missing root, never an empty list", () => {
  // An empty list would read as "this tree has no files", which is a different fact from "there is no
  // tree" — and the caller decides very different things on each.
  assert.equal(treeFiles(join(tmpdir(), "definitely-not-here-1724b")), null);
  assert.equal(treeFiles(null), null);
  const t = trees({ base: {} });
  try { assert.deepEqual(treeFiles(t.baseRoot), []); } finally { t.cleanup(); }
});
