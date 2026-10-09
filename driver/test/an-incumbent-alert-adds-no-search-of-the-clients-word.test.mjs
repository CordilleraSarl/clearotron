// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The plan used to search the client's main word in the incumbent's own classes on every matter with an
// incumbent alert. It asked nothing about any company and was not held to the client's classes, so it
// went (ruled 2026-09-25): one fewer counted search per run. The incumbent step itself stays: its unit
// still spawns on the alert, and it asks an owner's marks from the records the sweeps return.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, variantsFingerprint } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { decideAxes } from "../coverage-ledger.mjs";

const MODEL = {
  schema_version: 1, mark: "GLIMBEX", dominant_element: "GLIMBEX",
  elements: [{ value: "GLIMBEX", kind: "distinctive" }],
  variants: [{ value: "GLIMBECKS", category: "phonetic", rationale: "sound-alike" }],
  incumbent_classes: ["9", "41"],
};
const manifest = (incumbent_classes) => parseVariantManifestModel(JSON.stringify({ ...MODEL, incumbent_classes }));
const compile = (incumbent_classes) => compileRegisterPlan({
  manifest: manifest(incumbent_classes),
  job: { jobKey: "t-incumbent-alert", classes: ["9"], jurisdictions: ["EU"] },
  capabilities: capabilitiesFor("free-tier"),
});

test("an incumbent alert compiles no search of the client's word in the incumbent's classes", () => {
  const plan = compile(["9", "41"]);
  assert.ok(plan.entries.length > 0, "the premise: the plan compiled");
  assert.deepEqual(plan.entries.filter((e) => e.axis === "incumbent-class").map((e) => e.qid), [],
    "the plan dictates nothing on the incumbent step");
  assert.deepEqual(plan.entries.filter((e) => (e.nice_classes ?? []).map(String).includes("41")).map((e) => e.qid), [],
    "no entry reaches the incumbent's class the client did not instruct");
  assert.deepEqual(compile([]).entries.map((e) => e.qid), plan.entries.map((e) => e.qid),
    "the incumbent classes change no entry");
});

test("the incumbent classes leave the fingerprint, because they change no entry", () => {
  assert.equal(variantsFingerprint(manifest(["9", "41"])), variantsFingerprint(manifest([])));
});

test("the incumbent step still spawns on the alert, so its axis is not gone", () => {
  assert.ok(decideAxes(JSON.stringify(MODEL)).includes("incumbent-class"));
});

test("the register manual's incumbent paragraph asks in the matter's classes and markets", () => {
  const unit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "unit.md"), "utf8");
  const para = unit.split("\n").find((l) => l.startsWith("- **`incumbent-class`**"));
  assert.ok(para?.includes("`register_enumerate` the named band in the matter's in-scope Nice set and markets"),
    "the paragraph carries the approved sentence");
  assert.doesNotMatch(unit, /incumbent's primary classes/, "no line sends the unit to the incumbent's own classes");
});

test("no register recipe asks for the client's word in the incumbent's classes", () => {
  const recipes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "register-recipes.md"), "utf8");
  assert.ok(recipes.includes("## Recipe 1 — Compound tagline"), "guard: the recipes were read");
  assert.doesNotMatch(recipes, /ENUMERATE the incumbent(?:'s)? classes|classes <incumbent classes>/,
    "a recipe the unit reads would ask again for the search the plan no longer compiles");
  assert.doesNotMatch(recipes, /Industry-incumbent shadow|incumbent's portfolio|owner:<incumbent name pattern>/,
    "no recipe asks for an incumbent's marks or its whole portfolio because it is an incumbent");
});

test("no manual or tool the engine reads asks for a competitor's or an enforcer's register because it is one", () => {
  const read = (...rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ...rel), "utf8");
  const recipes = read("skills", "clearance-register", "register-recipes.md");
  const digest = read("skills", "clearance-register", "digest.md");
  const orchestrator = read("skills", "clearance-search", "SKILL.md");
  const tools = read("engine", "mcp", "recording-server.mjs");
  assert.ok(recipes.includes("## Recipe 6 — Multi-word descriptive tagline") && digest.includes("### Step 4 —")
    && orchestrator.includes("**Competitor intelligence:**") && tools.includes("watchlist_owners"), "guard: each file was read");
  assert.doesNotMatch(recipes, /owner-bound competitor queries|owner:<each competitor>|\+ competitor portfolio/,
    "a recipe asks for every competitor's register");
  assert.doesNotMatch(digest, /carries the owner lane|run one owner-bound search|Competitor \+ enforcer owner-bound sweep/,
    "the digest is told to run an owner lane the plan no longer compiles, with no register tool to run it");
  assert.doesNotMatch(orchestrator, /competitor portfolios in target classes/, "the old orchestrator manual asks for competitor portfolios");
  assert.doesNotMatch(tools, /compiles owner lanes/, "the variants tool says the plan compiles owner lanes from the watchlist");
});

test("the spelling manual points at no register step that no longer exists", () => {
  const variants = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-variants", "SKILL.md"), "utf8");
  assert.ok(variants.includes("| competitor-intel / watchlist | focused web search | not used |"),
    "a watchlist starts no register sweep, as Step 5 says");
  assert.doesNotMatch(variants, /Step 8\.5/);
});
