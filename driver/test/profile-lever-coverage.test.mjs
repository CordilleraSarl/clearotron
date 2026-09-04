// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every profile lever the code READS must be exercised by at least one bundled demo profile.
//
// WHY. The demo roster is not decoration — it is the only customer config the E2E suite, the dev
// cockpit and every offline test ever see, because real client bundles live in the external config
// store and never enter this repo. So a field that no demo profile sets is a field that nothing
// outside production ever exercises: the first time its code path runs is on a real matter.
//
// Found by auditing the roster against profiles.mjs: `defaultProduct`, `jxPolicy`, `runCaps`,
// `allowedRecipes` and `archived` were read by the code and set by NO demo profile. Five levers, live
// in production, with no non-production coverage at all.
//
// This is a COVERAGE floor, not a correctness check (the same posture FIELD_CONSUMERS
// takes): it proves each lever is exercised somewhere, never that it is exercised correctly — that is
// what the behavioural tests and the live eval are for. Its whole job is to make adding a lever without
// demo coverage a loud CI failure rather than a silent gap nobody measures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { KNOWN_PROFILE_KEYS } from "../profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "profiles");

// Levers that are deliberately NOT a JSON field, with where they actually live. Listing them here
// (rather than dropping them from the audit) is the point: an exemption should have to be written down
// and justified, so the next person can disagree with it.
const NON_JSON_LEVERS = {
  // a sibling <key>.context.md file, not a key — aurora.context.md and petcary.context.md carry it
  contextPack: (keys) => keys.some((k) => existsSync(join(DIR, `${k}.context.md`))),
  // overlay-only META (profiles.mjs: `if (sparse && (k === "projectName" || k === "archived")) continue`)
  // so it is set on a PROJECT overlay, never on a customer
  archived: () => projectOverlays().some((o) => o.archived === true),
  projectName: () => projectOverlays().length > 0,
};

const customerKeys = () => readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const customers = () => customerKeys().map((k) => JSON.parse(readFileSync(join(DIR, `${k}.json`), "utf8")));

function projectOverlays() {
  const root = join(DIR, "projects");
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((cust) => {
    const d = join(root, cust);
    try {
      return readdirSync(d).filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(d, f), "utf8")));
    } catch { return []; }
  });
}

test("every profile lever the code reads is set by at least one demo profile", () => {
  const keys = customerKeys();
  const all = [...customers(), ...projectOverlays()];
  const uncovered = [];

  for (const lever of KNOWN_PROFILE_KEYS) {
    const exempt = NON_JSON_LEVERS[lever];
    if (exempt) { if (!exempt(keys)) uncovered.push(`${lever} (expected outside the JSON — see NON_JSON_LEVERS)`); continue; }
    if (!all.some((p) => lever in p)) uncovered.push(lever);
  }

  assert.deepEqual(uncovered, [],
    `these levers are read by the code but set by NO demo profile, so nothing outside production ever `
    + `exercises them:\n  ${uncovered.join("\n  ")}\n\n`
    + `Set each on whichever demo customer it fits, or — if it genuinely cannot be a JSON field — add it `
    + `to NON_JSON_LEVERS with the reason.`);
});

// R1 of the E2E suite clears VIBRANTE FROSTPLUM into China at Depth 5. Two pieces of zephyr's config
// are load-bearing for that and would refuse the run at ADMISSION if changed — a failure that looks like
// a broken scenario, not like a config edit. Pinned so the edit fails here instead.
test("zephyr stays able to run the native-language China scenario", () => {
  const z = JSON.parse(readFileSync(join(DIR, "zephyr.json"), "utf8"));

  if (z.allowedRecipes) {
    assert.ok(z.allowedRecipes.includes("full-country-search"),
      "zephyr.allowedRecipes is a CLOSED menu and omits full-country-search — E2E R1 would be refused at admission");
  }
  const zh = z.jxPolicy?.laneDepth?.zh;
  assert.notEqual(zh, "off",
    'zephyr.jxPolicy.laneDepth.zh is "off" — the jx routing rule asks decideJxLanes directly, so a '
    + "switched-off lane resolves none and E2E R1 is refused at admission");
});
