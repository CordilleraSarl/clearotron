// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CONVERSION 3 — the variant manifest becomes a typed call, and `scope-ledger.json` stops being recovered
// by parsing a markdown table.
//
// ── THE ARM THAT MATTERS IS THE PARITY ONE ──────────────────────────────────────────────────────────
//
// `scope-ledger.json` is read by the frame-diff scope check (`scopeJurisdictions`) and by the
// dropped-family selector. Before this conversion the ONLY way it existed was `renderScopeLedgerJson(md)`
// — parse the `### Scope ledger` table back out of prose a model typed, on fixed column positions. Now a
// recorded run serialises the typed rows instead.
//
// Two producers for one machine artifact is exactly the divergence this repo keeps finding, so they are
// not two producers: both end in `scopeLedgerJsonFromRows`. The test below proves it by driving one
// payload through BOTH paths — typed rows straight, and the same rows via the rendered table and the
// prose parser — and asserting the bytes match. If either path ever grows its own serialiser, this goes
// red on the commit that does it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import {
  acceptPrelimVariants, renderPrelimVariants, renderScopeLedgerTable, recordPrelimVariants,
  recordedScopeLedgerRows, prelimVariantsWasRecorded, prelimVariantsCallPaths,
  MODEL_FILE, PROSE_FILE, SCOPE_LAYERS, SCOPE_STATUS,
} from "../prelim-variants-record.mjs";
import {
  renderScopeLedgerJson, scopeLedgerJsonFromRows, parseScopeLedgerJson, scopeJurisdictions,
  droppedVariantFamilies,
  SCOPE_LAYERS as SHIPPED_LAYERS, SCOPE_STATUSES as SHIPPED_STATUSES,
} from "../scope-ledger.mjs";
// The PROSE consumers. The driver renders the manifest now, so these read the driver's own output —
// which is why they belong in this file rather than only in theirs.
import { variantsManifestAudit, variantsParseFailure } from "../common-law-receipts.mjs";
import { decideAxes, REGISTER_AXES } from "../coverage-ledger.mjs";

const ROWS = Object.freeze([
  { layer: "variant", item: "phonetic-family", status: "applied", reason: "sound-alike neighbours are in scope", reopen_trigger: "" },
  { layer: "variant", item: "visual-confusable", status: "dropped", reason: "no homoglyph risk on this script", reopen_trigger: "a look-alike filing surfaces" },
  { layer: "jurisdiction", item: "EU", status: "applied", reason: "instructed territory", reopen_trigger: "" },
  { layer: "jurisdiction", item: "CN", status: "dropped", reason: "not instructed, no signalled market", reopen_trigger: "a CN filing surfaces" },
  { layer: "field", item: "game software", status: "applied", reason: "goods-overlap", reopen_trigger: "" },
  { layer: "source", item: "developer ecosystems", status: "dropped", reason: "off-channel for this product", reopen_trigger: "a developer-channel listing surfaces" },
]);

const PARAMS = Object.freeze({
  mark: "PROJECT NOVAPULSE",
  dominant_element: "NOVAPULSE",
  elements: [
    { value: "NOVAPULSE", kind: "distinctive" },
    { value: "PROJECT", kind: "common" },
  ],
  variants: [
    { value: "NOVAPULSE", category: "core", rationale: "the mark itself" },
    { value: "NOVAPULZE", category: "phonetic", rationale: "sound-alike" },
    { value: "N0VAPULSE", category: "visual", rationale: "zero-for-O look-alike" },
  ],
  incumbent_classes: ["9"],
  watchlist_owners: ["BigCo Interactive"],
  scope_ledger: [...ROWS],
});

const accepted = (over = {}) => {
  const v = acceptPrelimVariants({ ...PARAMS, ...over });
  assert.equal(v.ok, true, `expected an accepted call: ${v.reason}`);
  return v;
};

const runDir = () => {
  const d = mkdtempSync(join(tmpdir(), "ct-prelimvariants-"));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
};

// ── THE PARITY ARM ──────────────────────────────────────────────────────────────────────────────────

test("conversion 3 — the typed rows and the prose table serialise to BYTE-IDENTICAL ledger JSON", () => {
  const v = accepted();

  // Path A — the recorded run: typed rows, serialised straight. No table involved.
  const fromRows = scopeLedgerJsonFromRows(v.scopeRows);

  // Path B — an archived manifest: the SAME rows rendered as the table, then parsed back out of prose
  // exactly as `deriveScopeLedgerJson` does for a manifest this build did not write.
  const proseManifest = renderPrelimVariants(v.model, v.scopeRows);
  const fromProse = renderScopeLedgerJson(proseManifest);

  assert.equal(fromRows, fromProse,
    "the recorded ledger and the archived ledger disagree for the SAME rows. Both paths must end in "
    + "scopeLedgerJsonFromRows — if one has grown its own serialiser, a replayed run now produces a "
    + "different scope ledger from the run it replays.");

  // And the consumers agree on both, which is the property that actually matters downstream.
  for (const json of [fromRows, fromProse]) {
    const rows = parseScopeLedgerJson(json);
    assert.deepEqual(scopeJurisdictions(rows), ["EU"], "the frame-diff's in-scope territories");
    assert.deepEqual(droppedVariantFamilies(rows), ["visual-confusable"], "the dropped form families");
  }
});

test("conversion 3 — the rendered table carries FIVE columns, reopen trigger included", () => {
  // The first cut of the renderer emitted four and dropped `Reopen trigger`. The skill doc calls a dropped
  // row with no reopen trigger "itself a coverage gap", so a renderer that silently drops the column
  // manufactures that gap in the artifact a lawyer reads — while the JSON still carries the value, which
  // is exactly what makes it invisible.
  const table = renderScopeLedgerTable([...ROWS]).join("\n");
  assert.match(table, /^\| Layer \| Item \| Status \| Reason \| Reopen trigger \|$/m);
  assert.match(table, /a CN filing surfaces/, "a dropped row's reopen trigger must reach the table");
  assert.equal(table.split("\n").filter((l) => l.startsWith("| ")).length, ROWS.length + 1, "header + one row each");
});

// ── THE CLASS 3 CHECKS: what the seat used to run `python3 -c` for ──────────────────────────────────

test("conversion 3 — the transport refuses what the seat used to pre-check by hand", () => {
  const bad = (over, token) => {
    const v = acceptPrelimVariants({ ...PARAMS, ...over });
    assert.equal(v.ok, false, `expected a refusal for ${token}`);
    assert.match(v.reason, new RegExp(`^${token}`));
  };
  bad({ scope_ledger: [{ layer: "vibes", item: "x", status: "applied" }] }, "variantmodel_scope_layer_invalid");
  bad({ scope_ledger: [{ layer: "variant", item: "x", status: "maybe" }] }, "variantmodel_scope_status_invalid");
  bad({ scope_ledger: [{ layer: "variant", item: "", status: "applied" }] }, "variantmodel_scope_item_missing");
  // The shipped parser's families come along for free, because acceptance goes THROUGH it.
  bad({ mark: "" }, "variantmodel_mark_missing");
  bad({ dominant_element: "" }, "variantmodel_dominant_element_missing");
});

test("conversion 3 — a pipe in a ledger cell is REFUSED, not escaped", () => {
  // The failure a fixed-position table parser cannot report: the row still parses, into the WRONG columns,
  // and every cell after the pipe shifts one left. Refusing it at the boundary is the only place it is
  // cheap — and the reason a seat wrote is evidence, so a transport that rewrites it is not carrying it.
  for (const field of ["item", "reason", "reopen_trigger"]) {
    const row = { layer: "variant", item: "x", status: "dropped", reason: "r", reopen_trigger: "t", [field]: "a | b" };
    const v = acceptPrelimVariants({ ...PARAMS, scope_ledger: [row] });
    assert.equal(v.ok, false, `a pipe in ${field} must be refused`);
    assert.match(v.reason, new RegExp(`^variantmodel_scope_pipe:${field}`));
  }

  // NEGATIVE CONTROL — the same row without the pipe is accepted, so the refusal is about the pipe and
  // not about the fixture being malformed some other way.
  const clean = acceptPrelimVariants({ ...PARAMS, scope_ledger: [{ layer: "variant", item: "x", status: "dropped", reason: "r", reopen_trigger: "t" }] });
  assert.equal(clean.ok, true, clean.reason);
});

// ── THE TRANSPORT, END TO END ───────────────────────────────────────────────────────────────────────

test("conversion 3 — the driver writes both artifacts and the capture proves the transport was taken", () => {
  const dir = runDir();
  assert.equal(prelimVariantsWasRecorded(dir), false);

  const r = recordPrelimVariants(dir, PARAMS);
  assert.equal(r.refused, null, `unexpected refusal: ${r.refused}`);
  assert.equal(r.written, join(dir, MODEL_FILE));
  assert.equal(r.prose, join(dir, PROSE_FILE));
  assert.equal(r.scope_rows, ROWS.length);
  assert.equal(prelimVariantsWasRecorded(dir), true);

  const model = JSON.parse(readFileSync(join(dir, MODEL_FILE), "utf8"));
  assert.equal(model.mark, "PROJECT NOVAPULSE");
  assert.equal(model.variants.length, 3);
  // The prose is a projection of the same object — not a second authoring of it.
  assert.match(readFileSync(join(dir, PROSE_FILE), "utf8"), /### Scope ledger/);
});

test("conversion 3 — recordedScopeLedgerRows separates `no call` from `call with no rows`", () => {
  // THE DISTINCTION THE DERIVATION TURNS ON. `null` sends the driver to the prose parser; `[]` does not.
  // Collapsing them would re-parse the table on a run that had already answered — and on a recorded run
  // with a deliberately empty ledger, it would resurrect rows from a table the driver itself rendered.
  const none = runDir();
  assert.equal(recordedScopeLedgerRows(none), null, "no capture at all ⇒ null, the prose path");

  const empty = runDir();
  recordPrelimVariants(empty, { ...PARAMS, scope_ledger: [] });
  assert.deepEqual(recordedScopeLedgerRows(empty), [], "a call carrying no rows ⇒ [], NOT null");

  const full = runDir();
  recordPrelimVariants(full, PARAMS);
  assert.equal(recordedScopeLedgerRows(full).length, ROWS.length);

  // A REFUSED call wrote no manifest, so its rows must not be offered as if one existed.
  const refused = runDir();
  const rr = recordPrelimVariants(refused, { ...PARAMS, mark: "" });
  assert.ok(rr.refused, "the fixture must actually be refused or this arm proves nothing");
  assert.equal(recordedScopeLedgerRows(refused), null,
    "a refused call left a capture but no manifest — its rows must not stand in for one");
});

test("conversion 3 — a REFUSED call still leaves the capture, and writes nothing", () => {
  const dir = runDir();
  const r = recordPrelimVariants(dir, { ...PARAMS, variants: [] });
  assert.ok(r.refused, `expected a refusal, got: ${JSON.stringify(r).slice(0, 120)}`);
  assert.equal(r.written, null);
  assert.equal(prelimVariantsWasRecorded(dir), true,
    "the capture exists even for a refusal — that is why its presence answers 'was the transport taken', "
    + "not 'did the manifest come out well'");
  const capture = JSON.parse(readFileSync(prelimVariantsCallPaths(dir).payload, "utf8"));
  assert.deepEqual(capture.params.variants, [], "the capture records what ARRIVED, untidied");
});

test("conversion 3 — the vocabularies are the shipped parser's, not a second copy", () => {
  // ASSERTED AS AN IDENTITY, not as a literal. This test's first cut wrote the literal
  // ["field", "jurisdiction", "variant", "source"] — which pinned the transport's own COPY of the set
  // rather than the parser's, and so held a second source of truth in place instead of catching it.
  // 's source scan is what found the disagreement. A literal here can only ever agree with whatever
  // the module happens to say; the identity cannot be satisfied by a copy at all.
  assert.equal(SCOPE_LAYERS, SHIPPED_LAYERS, "the transport must not hold its own copy of the ledger's layers");
  assert.equal(SCOPE_STATUS, SHIPPED_STATUSES, "…nor of its statuses");
  assert.deepEqual([...SCOPE_LAYERS], ["variant", "field", "source", "jurisdiction"], "the shipped order");
  assert.deepEqual([...SCOPE_STATUS], ["applied", "dropped"]);
  // Every layer the ledger's own consumers key on must be sendable, or a scope decision becomes
  // unstateable through the transport that replaced the table.
  for (const layer of SCOPE_LAYERS)
    assert.equal(acceptPrelimVariants({ ...PARAMS, scope_ledger: [{ layer, item: "x", status: "applied", reason: "r" }] }).ok, true,
      `${layer} must be sendable`);
});

// ── THE RENDER IS READ BY PARSERS THIS STAGE NEVER MENTIONS ─────────────────────────────────────────
//
// Every arm above drives the render through the LEDGER's readers. It was still possible for the render
// to be wrong for a reader nothing in this file imported, and it was: the first cut emitted
// `## Variants` above a `### Scope ledger`, and `variantsManifestAudit` — which closes its term
// collector only on a heading at the same depth or shallower — collected the ledger's `Layer`, `field`,
// `jurisdiction` and `source` cells as marketplace search terms. The common-law grid then demanded seven
// receipts for each, and the run died `grid_join_missing` naming four terms no seat ever proposed.
//
// Nothing in the conversion's own suite could see it, because the defect was in what a DIFFERENT
// subsystem's parser makes of this file. So the rule conversion 2 set — drive the driver's render
// through the SHIPPED parsers, never against a golden string — extends to the parsers downstream of the
// artifact, not just the ones that own it.

test("conversion 3 — the rendered manifest yields EXACTLY the model's terms to the common-law walk", () => {
  const v = accepted();
  const md = renderPrelimVariants(v.model, v.scopeRows);

  const audit = variantsManifestAudit(md);
  assert.deepEqual(audit.variants, v.model.variants.map((x) => x.value),
    "the term collector took something other than the model's variants — if the extras look like ledger "
    + "columns, a section heading's DEPTH changed and the Scope ledger stopped closing the Variants section");

  // The ledger's own vocabulary must be absent by name: this is the specific regression, stated so a
  // future reader sees what was wrong rather than only that something was.
  for (const leak of ["Layer", "Item", "Status", "Reason", "Reopen trigger", ...SCOPE_LAYERS])
    assert.ok(!audit.variants.includes(leak), `ledger vocabulary "${leak}" reached the search terms`);

  // Every ledger item is likewise not a term. `phonetic-family` is a FAMILY name, never something to sweep.
  for (const r of v.scopeRows)
    assert.ok(!audit.variants.includes(r.item), `ledger item "${r.item}" reached the search terms`);

  assert.equal(audit.headings, 1, "exactly one heading armed the collector");
  assert.equal(variantsParseFailure(md), null, "the walk reports no parse failure over the driver's own render");
});

test("conversion 3 — the prose reader and the model reader agree about an incumbent alert", () => {
  // decideAxes greps the PROSE for /incumbent/; register-plan keys on `manifest.incumbent_classes.length`.
  // Two readers, one fact — and the retired fixture had them disagreeing (prose said the alert was
  // present, the structured half carried no classes), which is the defect class this conversion removes.
  // The render is what keeps them in step now, so it is asserted here rather than left to a mock.
  const withAlert = accepted();
  assert.ok(withAlert.model.incumbent_classes?.length, "fixture carries the alert");
  assert.ok(decideAxes(renderPrelimVariants(withAlert.model, withAlert.scopeRows)).includes("incumbent-class"),
    "the prose reader must see the alert the model declares");

  const without = accepted({ incumbent_classes: [] });
  const mdNone = renderPrelimVariants(without.model, without.scopeRows);
  assert.ok(!/incumbent/i.test(mdNone),
    "an absent alert must leave NO incumbent wording in the prose — a rendered word the model denies is "
    + "the contradiction this conversion exists to remove, and it would fire a whole register axis");
});

// ── — THE SEARCH FLOOR, DESIGNATED HERE AND JUDGED DOWNSTREAM ──────────────────────────────────
//
// prelim-variants designates; prelim-register writes the coverage row that honours it or does not.
// Different stage, earlier turn, before any outcome is known — which is the entire mechanism. These arms
// cover the designation half: what the transport accepts, and that the artifact keeps "no floor" and
// "a floor" apart. The breach arithmetic is in envelope.test.mjs.

test("#1273: the floor is designated as AXES, closed against the shipped enum", () => {
  assert.deepEqual(accepted({ search_floor: ["primary-sweep", "incumbent-class"] }).model.search_floor,
    ["primary-sweep", "incumbent-class"]);
  // Normalised and deduped by the parser, so a downstream join never has to.
  assert.deepEqual(accepted({ search_floor: ["Primary-Sweep", " primary-sweep "] }).model.search_floor, ["primary-sweep"]);
  // The enum is the SHIPPED one, not a copy — an axis name that no coverage row can carry is refused,
  // because a designation naming something unjoinable is a floor that can never be breached or honoured.
  const bad = acceptPrelimVariants({ ...PARAMS, search_floor: ["everything"] });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /^variantmodel_search_floor_invalid:everything/);
  for (const axis of REGISTER_AXES) assert.equal(acceptPrelimVariants({ ...PARAMS, search_floor: [axis] }).ok, true,
    `${axis} is a real register axis and the designation refused it`);
});

test("#1273: OMITTING the field is a real answer, and it is the default", () => {
  // The ordinary case. A floor that arrived by default would hold every run open for nothing, so absence
  // has to mean absence here rather than "unset, treat as all".
  assert.deepEqual(accepted().model.search_floor, [], "an omitted floor did not read as none");
  assert.deepEqual(accepted({ search_floor: [] }).model.search_floor, []);
  const bad = acceptPrelimVariants({ ...PARAMS, search_floor: "primary-sweep" });
  assert.equal(bad.ok, false, "a bare string was accepted where an array is the contract");
  assert.match(bad.reason, /^variantmodel_search_floor_invalid/);
});

test("#1273: the two states are DISTINGUISHABLE in the delivered artifact", () => {
  // 's lesson applied before it can bite: two different states must not render identically. A reader
  // auditing the run has to be able to see that no floor was designated, rather than infer it from the
  // absence of something they would have to know to look for.
  const withFloor = accepted({ search_floor: ["primary-sweep"] }).content;
  const without = accepted().content;
  assert.match(withFloor, /### Search floor/);
  assert.match(withFloor, /- primary-sweep/);
  assert.doesNotMatch(without, /### Search floor/,
    "a run designating no floor rendered a floor section — an empty one reads as a floor of nothing, not as no floor");
  assert.notEqual(withFloor, without, "the two states produced an identical artifact");
});
