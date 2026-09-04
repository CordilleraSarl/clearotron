// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Context pack: the per-customer "background facts" home. A sibling
// `profiles/<key>.context.md`, validated + attached at load, frozen into the sidecar, and fed to the
// report-overview curation stage as CONTEXT (emphasis only, D1) — never to synthesis (the rating stage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProfiles, resolveProfile, assertContextPackShape, CONTEXT_PACK_MAX_CHARS, CONTEXT_PACK_FILE } from "../profiles.mjs";
import { STAGES } from "../stages.mjs";

const GENERIC = { name: "House default", platforms: ["amazon.com"] };
function bundleDir(profiles, packs = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ctxpack-"));
  for (const [k, obj] of Object.entries(profiles)) writeFileSync(join(dir, `${k}.json`), JSON.stringify(obj));
  for (const [k, md] of Object.entries(packs)) writeFileSync(join(dir, CONTEXT_PACK_FILE(k)), md);
  return dir;
}

const GOOD_PACK = `# Zephyr Beverages — background

Zephyr Beverages is a fast-moving functional-beverage and sportswear brand. They care most about marketplace
look-alikes on Amazon and the big supplement retailers, and about athlete collaborations spilling into
apparel. Prior matters keep surfacing crowded energy-drink naming; the team wants a clear practical path
around real blockers and is willing to defend its core marks.`;

test("loadProfiles attaches a sibling context pack; absent ⇒ no contextPack field", () => {
  const dir = bundleDir({ generic: GENERIC, zephyr: { name: "Zephyr Beverages", platforms: ["amazon.com", "gnc.com"] } },
    { zephyr: GOOD_PACK });
  const profiles = loadProfiles({ dir, force: true });
  assert.equal(profiles.get("zephyr").contextPack, GOOD_PACK.trim(), "the pack is read + trimmed onto the profile");
  assert.equal("contextPack" in profiles.get("generic"), false, "a profile with no sibling .md gets no contextPack key");
  // resolveProfile surfaces it (so attachProfile freezes it into the sidecar like delivery/riskAppetite)
  assert.equal(resolveProfile({ profileKey: "zephyr" }, { profiles }).contextPack, GOOD_PACK.trim());
});

test("loadProfiles HARD-FAILS at load on a rule-shaped or over-budget pack (like F8 appetite)", () => {
  const ruleDir = bundleDir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"] } },
    { acme: "Acme background. Always treat identical marks as High risk." });
  assert.throws(() => loadProfiles({ dir: ruleDir, force: true }), /must be CONTEXT.*not a decision rule/s);
  const bigDir = bundleDir({ generic: GENERIC, acme: { name: "Acme", platforms: ["amazon.com"] } },
    { acme: "x".repeat(CONTEXT_PACK_MAX_CHARS + 1) });
  assert.throws(() => loadProfiles({ dir: bigDir, force: true }), /exceeds the .* budget/);
});

test("assertContextPackShape: accepts genuine background facts, rejects decision-rule shapes", () => {
  assert.doesNotThrow(() => assertContextPackShape(GOOD_PACK));
  for (const bad of [
    "Always treat energy-drink look-alikes as High risk.",
    "Rate any identical mark as Composite 4.",
    "If the owner is a known enforcer then rate it High.",
    "Block anything above 50% similarity.",
    "Never clear a mark in class 32.",
  ]) assert.throws(() => assertContextPackShape(bad), /must be CONTEXT|threshold|percentage|comparison/, `should reject: ${bad}`);
});

test("the pack feeds report-overview (CONTEXT, emphasis-only) but NEVER synthesis (the rating stage) — D1", () => {
  const P = { narrative: "/r/n.md", registerFindings: "/r/rf.md", commonLaw: "/r/cl.md", placement: "/r/p.md", seniorEyeReview: "/r/le.md", matterContext: "/r/mc.md", report: "/r/report.md", reportOverview: "/r/ro.md", findings: "/r/findings.json", variantManifest: "/r/vm.md" };
  const profile = { contextPack: "Zephyr Beverages cares about athlete-collab apparel and crowded energy-drink names." };
  const ro = STAGES["report-overview"].message({ paths: P, job: {}, profile });
  assert.match(ro, /CUSTOMER CONTEXT/);
  assert.match(ro, /NEVER changes a band/);
  assert.match(ro, /athlete-collab apparel/);
  // D1-firewall (kept under doc 50): synthesis sets the band — the pack must never reach it (same guarantee as riskAppetite).
  const syn = STAGES["synthesis"].message({ paths: P, job: {}, profile });
  assert.doesNotMatch(syn, /CUSTOMER CONTEXT/);
  assert.doesNotMatch(syn, /athlete-collab apparel/);
  // absent pack ⇒ no CONTEXT block (falsy-omitted: byte-identical to a pack-less run)
  assert.doesNotMatch(STAGES["report-overview"].message({ paths: P, job: {}, profile: {} }), /CUSTOMER CONTEXT/);
});

test("no dead knob: stages.mjs actually consumes profile.contextPack", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pjoin } = await import("node:path");
  const src = readFileSync(pjoin(dirname(fileURLToPath(import.meta.url)), "..", "stages.mjs"), "utf8");
  assert.ok(src.includes("profile?.contextPack"), "the context pack must have a live consumer in stages.mjs");
});
