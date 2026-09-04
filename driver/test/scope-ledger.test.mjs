// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-ledger.mjs — prose→JSON derive, strict JSON parser (token-first throws), dominant-element
// extraction, and the receipts-gate NON-COLLISION guard (a `### Scope ledger` heading must never be
// read as marketplace search terms by parseManifestVariants).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseScopeLedger, parseScopeLedgerFull, parseScopeLedgerJson, renderScopeLedgerJson,
  dominantElementFromManifest, formativeRootFromManifest, channelsFromMatterContext,
  scopeJurisdictions, excludedJurisdictions, SCOPE_LAYERS, SCOPE_STATUSES,
} from "../scope-ledger.mjs";
import { parseManifestVariants } from "../common-law-receipts.mjs";

// #1 — the formative root the manifest names (the distinctive stem a family shares; the floor searches it).
test("formativeRootFromManifest: reads 'Formative root: X'; '' when absent", () => {
  assert.equal(formativeRootFromManifest("Dominant element: VELTRIN\nFormative root: VELTRI\n"), "veltri");
  assert.equal(formativeRootFromManifest("Formative root: NOVAPULSE in the gaming field"), "novapulse", "trailing clause stripped");
  assert.equal(formativeRootFromManifest("Dominant element: LUMENGARDE"), "", "no root line → empty (floor falls back to dominant)");
});

// #5 — channels the matter frame named for the generic fallback; domain-shaped tokens (+ web) only.
test("channelsFromMatterContext: parses domains from the 'Search channels:' line; drops prose; [] when absent", () => {
  assert.deepEqual(channelsFromMatterContext("Sector: pharma.\nSearch channels: ema.europa.eu, fda.gov, animaldrugsatfda.fda.gov\n"),
    ["ema.europa.eu", "fda.gov", "animaldrugsatfda.fda.gov"]);
  assert.deepEqual(channelsFromMatterContext("Search channels: amazon.com, the app stores, web"),
    ["amazon.com", "web"], "prose tokens dropped, domains + web kept");
  assert.deepEqual(channelsFromMatterContext("Sector: gaming. No channels line."), [], "none named → [] (caller keeps profile default)");
});

// Round 2 Change 1 — jurisdiction is a 4th scope layer: instructed territories applied, considered-but-excluded
// dropped. scopeJurisdictions() = the authoritative IN-SCOPE set the register dispatch + frame-diff read.
test("R2 scope-ledger jurisdiction layer: instructed = applied, excluded = dropped; helpers extract each", () => {
  assert.ok(SCOPE_LAYERS.includes("jurisdiction"), "jurisdiction is a scope layer");
  const rows = parseScopeLedgerJson(JSON.stringify([
    { layer: "jurisdiction", item: "US", status: "applied", reason: "instructed" },
    { layer: "jurisdiction", item: "eu", status: "applied", reason: "instructed" },
    { layer: "jurisdiction", item: "CN", status: "dropped", reason: "not instructed; no rights reach the named territories" },
    { layer: "variant", item: "phonetic", status: "applied", reason: "distinctive anchor" },
  ]));
  assert.deepEqual(scopeJurisdictions(rows).sort(), ["EU", "US"]);     // upper-cased, applied only
  assert.deepEqual(excludedJurisdictions(rows), ["CN"]);
});

const PROSE = `## Variant manifest

Dominant element: VELTRI (the distinctive anchor).

### Variants

| Category | Value | Rationale | Verify? |
|---|---|---|---|
| exact | VELTRIN | the applied-for mark | yes |
| phonetic | DELFIS | sound-alike | yes |

### Scope ledger

| Layer | Item | Status | Reason | Reopen trigger |
|---|---|---|---|---|
| variant | phonetic | applied — 6 variants | distinctive coined anchor | — |
| variant | plural-root | dropped | English-only mark, singular root | a hit on the singular root in the dominant class |
| field | diagnostics software | applied | goods-overlap with the product | — |
| field | RGB lighting control | dropped | off-field: peripheral UX, not core goods | a same-element mark surfaces in the dominant class |
| source | consumer storefronts | applied | B2C reach | — |
| source | B2D developer ecosystem | dropped | judged consumer-first | the product ships developer-facing |
| jurisdiction | US | applied | instructed territory | — |
| jurisdiction | CN | dropped | not instructed; no rights reach the named territories | a CN right effective in a named territory |
`;

test("parseScopeLedgerFull: classifies layer + status; keeps reason + reopen trigger", () => {
  const { rows, dropped } = parseScopeLedgerFull(PROSE);
  assert.equal(dropped.length, 0);
  assert.equal(rows.length, 8);
  const plural = rows.find((r) => r.item === "plural-root");
  assert.equal(plural.layer, "variant");
  assert.equal(plural.status, "dropped");
  assert.match(plural.reopen_trigger, /singular root/);
  // "applied — 6 variants" classifies to the bare token
  assert.equal(rows.find((r) => r.item === "phonetic").status, "applied");
  // every layer represented
  assert.deepEqual([...new Set(rows.map((r) => r.layer))].sort(), [...SCOPE_LAYERS].sort());
});

test("renderScopeLedgerJson → round-trips through parseScopeLedgerJson", () => {
  const json = renderScopeLedgerJson(PROSE);
  const rows = parseScopeLedgerJson(json);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows, parseScopeLedger(PROSE));
});

test("renderScopeLedgerJson throws when a Scope ledger heading yields no row (caller never-kills)", () => {
  assert.throws(() => renderScopeLedgerJson("## Variant manifest\n\nno ledger here\n"),
    (e) => e.message.startsWith("scope_ledger_unparseable"));
});

test("parseScopeLedgerJson: empty array is allowed (a matter may drop nothing)", () => {
  assert.deepEqual(parseScopeLedgerJson("[]"), []);
});

test("parseScopeLedgerJson throws token-FIRST on every defect class", () => {
  const t = (raw, token) =>
    assert.throws(() => parseScopeLedgerJson(raw), (e) => e.message.startsWith(token), `${token} for ${raw}`);
  t("not json {", "scope_ledger_unparseable");
  t(JSON.stringify({ rows: [] }), "scope_ledger_unparseable");                 // not an array
  t(JSON.stringify([null]), "scope_ledger_unparseable");                       // null row
  t(JSON.stringify([{ layer: "variant", item: "x", status: "dropped", oops: 1 }]), "scope_key_unknown");
  t(JSON.stringify([{ layer: "territory", item: "x", status: "dropped" }]), "scope_layer_invalid");
  t(JSON.stringify([{ layer: "field", item: "x", status: "ignored" }]), "scope_status_invalid");
});

test("dominantElementFromManifest pulls the spine, normalized; '' when absent", () => {
  assert.equal(dominantElementFromManifest(PROSE), "veltri");
  assert.equal(dominantElementFromManifest("dominant element is NOVAPULSE in the gaming field"), "novapulse");
  assert.equal(dominantElementFromManifest("no spine named"), "");
});

test("NON-COLLISION: parseManifestVariants ignores the `### Scope ledger` table", () => {
  // The grid-term parser must read ONLY the Variants table — never the Scope ledger's Item column
  // (else it would demand storefront cells for 'phonetic', 'plural-root', 'RGB lighting control'…).
  const variants = parseManifestVariants(PROSE);
  assert.ok(variants.includes("VELTRIN"), "real variant term picked up");
  assert.ok(variants.includes("DELFIS"));
  assert.equal(variants.length, 2, "exactly the two Variants-table rows, no Scope-ledger rows");
  for (const leak of ["phonetic", "plural-root", "RGB lighting control", "consumer storefronts", "B2D developer ecosystem"]) {
    assert.ok(!variants.includes(leak), `Scope-ledger item '${leak}' must not leak into grid terms`);
  }
});

test("constants are the closed enums the skill dictates", () => {
  assert.deepEqual(SCOPE_LAYERS, ["variant", "field", "source", "jurisdiction"]);
  assert.deepEqual(SCOPE_STATUSES, ["applied", "dropped"]);
});
