#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// mint-offered-territories.mjs — write the places the New Clearance form offers, derived by rule.
//
// The list is `searchableTerritories()` (driver/register-coverage.mjs): every place at least one supported
// register can search, named by its shipped label or the runtime's standard English name, never by hand.
// It is written ONCE, to shared/offered-territories.json, and read from there by both halves that must
// agree — the form (portal-ui composerProduct.ts, at build time) and the engine's mirror of it
// (driver/compose-read.mjs PROMPT_TERRITORIES). Two lists kept equal by a test drift in the gap between
// runs; one file read twice cannot.
//
// A COMMITTED file rather than a runtime call, for two reasons. The portal is a browser bundle and cannot
// run the engine's resolver; and what the form offers should change when somebody re-mints it and reads
// the diff, not silently when a provider's coverage table is edited. `generated-files-are-current.mjs`
// runs this with --check, so a coverage change that moves the list reds until it is minted.
//
// Usage:  node scripts/mint-offered-territories.mjs [--check]
//   --check  exit 1 if the committed file disagrees with a fresh derivation, printing the difference

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(REPO, "shared", "offered-territories.json");

/** The file's content, derived fresh. Regions first, then countries, each as `{code, name}`. */
export async function deriveOfferedTerritories() {
  const { searchableTerritories } = await import("../driver/register-coverage.mjs");
  const { territoryTier } = await import("../driver/territory-tiers.mjs");
  const { offered, unnamed } = await searchableTerritories();
  const regions = [], countries = [], untiered = [];
  for (const t of offered) {
    const tier = territoryTier(t.name);
    if (tier === "region") regions.push(t);
    else if (tier === "country") countries.push(t);
    else untiered.push(t.code);
  }
  return {
    _generated: "by scripts/mint-offered-territories.mjs from searchableTerritories() — do not edit; re-mint",
    regions, countries,
    // Recorded, not dropped: a searchable place the list could not name, or could not place in a tier.
    left_out: { unnamed, untiered },
  };
}

const render = (doc) => JSON.stringify(doc, null, 2) + "\n";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const next = render(await deriveOfferedTerritories());
  if (process.argv.includes("--check")) {
    let current;
    try { current = readFileSync(OUT, "utf8"); }
    catch { console.error(`mint-offered-territories: ${OUT} is missing — run without --check to mint it.`); process.exit(1); }
    if (current === next) {
      const doc = JSON.parse(current);
      console.log(`offered-territories: current, ${doc.regions.length} region(s) and ${doc.countries.length} countr(ies).`);
      process.exit(0);
    }
    const names = (s) => { const d = JSON.parse(s); return new Set([...d.regions, ...d.countries].map((t) => `${t.code} ${t.name}`)); };
    const [a, b] = [names(current), names(next)];
    for (const x of b) if (!a.has(x)) console.error(`  + ${x}`);
    for (const x of a) if (!b.has(x)) console.error(`  - ${x}`);
    console.error("offered-territories: the committed list disagrees with the rule — re-mint: node scripts/mint-offered-territories.mjs");
    process.exit(1);
  }
  writeFileSync(OUT, next);
  const doc = JSON.parse(next);
  console.log(`offered-territories: wrote ${doc.regions.length} region(s) and ${doc.countries.length} countr(ies) to ${OUT}`);
}
