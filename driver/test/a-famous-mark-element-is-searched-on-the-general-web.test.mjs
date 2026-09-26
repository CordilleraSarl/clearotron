// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ELEMENT FLAGGED FOR THE FAMOUS-MARK CHECK IS SEARCHED ON THE GENERAL WEB, AND NO QUESTION IS ASKED.
//
// The variants step decides whether an element of the mark is also a well-known name, and the web step
// used to put a question to the web about each one it flagged. The hand-off was a prose section of the
// manifest, and when the manifest became the driver's render of a typed call nobody wrote that section,
// so the check had nothing to run on. The flag now rides the element itself; the driver searches each
// flagged element on the general web as a grid cell, beside the spellings, and the web step judges the
// results. The summarising question and its template are gone.
//
// These arms follow the path a run takes: the variants step's recorded call, the manifest it renders, the
// grid spec the driver derives, the program the search service is handed, the receipts gate, the halves,
// and the words the two steps read. Invented marks and example stores throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { recordClearanceVariants, acceptClearanceVariants } from "../clearance-variants-record.mjs";
import { parseVariantManifestModel, famousMarkElements } from "../variant-manifest-model.mjs";
import { validateGridSpec, dictatedCells, buildGridProgramTask } from "../../providers/perplexity/src/core.js";
import { findUnranDictatedCells } from "../common-law-receipts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "famous-mark-cells-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
const PL = await import("../pipeline.mjs");
const ST = await import("../stages.mjs");

const MARK = "QUILLOVAR HALCYRA";
const FAMOUS = "HALCYRA";
const VARIANTS = [MARK, "QUILOVAR HALCYRA", "QU1LLOVAR HALCYRA", "QUILLOVAR"];
const STORES = ["shop.alderfen.test", "apps.alderfen.test"];
const LEDGER = [{ layer: "variant", item: "phonetic-family", status: "applied", reason: "sound-alike neighbours are in scope", reopen_trigger: "" }];
const call = (flagged = [FAMOUS]) => ({
  mark: MARK,
  dominant_element: "QUILLOVAR",
  elements: [
    { value: "QUILLOVAR", kind: "distinctive", ...(flagged.includes("QUILLOVAR") ? { famous_mark_flag: true } : {}) },
    { value: FAMOUS, kind: "common", ...(flagged.includes(FAMOUS) ? { famous_mark_flag: true } : {}) },
  ],
  variants: [
    { value: MARK, category: "core", rationale: "the mark itself" },
    { value: "QUILOVAR HALCYRA", category: "phonetic", rationale: "sound-alike" },
    { value: "QU1LLOVAR HALCYRA", category: "visual", rationale: "one-for-I look-alike" },
    { value: "QUILLOVAR", category: "exact-element", rationale: "the distinctive element alone" },
  ],
  scope_ledger: LEDGER,
});

function runWith({ variantsCall = call(), forms = [] } = {}) {
  const runDir = mkdtempSync(join(ROOT, "run-"));
  const P = ST.paths(runDir);
  mkdirSync(dirname(P.matterContext), { recursive: true });
  writeFileSync(P.matterContext, "## The matter\n\nA games-kit maker.\n\nMeaning angles: none\n");
  const at = driverDir(runDir, "matter-frame-calls", "accepted.json");
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, JSON.stringify({ params: { confusable_forms: forms } }));
  writeFileSync(driverDir(runDir, "stage-contracts.json"), JSON.stringify({ "matter-frame": { meaningAngles: 1, webGrid: 1 } }));
  if (variantsCall) {
    const r = recordClearanceVariants(runDir, variantsCall);
    assert.equal(r.refused ?? null, null, `the variants call was refused: ${r.refused}`);
  }
  const ctx = { paths: P, job: { markName: MARK }, run: {}, gridVariants: VARIANTS, profile: { platforms: STORES, profileKey: "alderfen" }, registerOnly: false };
  PL.DERIVATION_RUNNERS["grid-spec"](ctx);
  const spec = JSON.parse(readFileSync(P.gridSpec, "utf8"));
  const log = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { runDir, P, spec, log };
}

const key = (t, p) => `${t.toLowerCase()}|${p.toLowerCase()}`;

test("the variants step's call keeps the flag on the element, and the manifest it renders marks it", () => {
  const v = acceptClearanceVariants(call());
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.model.elements, [{ value: "QUILLOVAR", kind: "distinctive" }, { value: FAMOUS, kind: "common", famous_mark_flag: true }]);
  assert.deepEqual(famousMarkElements(v.model), [FAMOUS]);
  assert.match(v.content, /^\| Value \| Kind \| Famous-mark check \|$/m);
  assert.match(v.content, new RegExp(`^\\| ${FAMOUS} \\| common \\| yes \\|$`, "m"));
  assert.match(v.content, /^\| QUILLOVAR \| distinctive \| {2}\|$/m, "an unflagged element carries no mark");

  // THE CONTROL: no element flagged, and the manifest reads exactly as it did before the flag.
  const none = acceptClearanceVariants(call([]));
  assert.equal(none.ok, true, none.reason);
  assert.deepEqual(none.model.elements, [{ value: "QUILLOVAR", kind: "distinctive" }, { value: FAMOUS, kind: "common" }]);
  assert.match(none.content, /^### Elements\n\n\| Value \| Kind \|\n\|---\|---\|\n\| QUILLOVAR \| distinctive \|\n\| HALCYRA \| common \|$/m);
  assert.deepEqual(famousMarkElements(none.model), []);
  // Only `true` flags: the field is optional, and nothing else is refused or read as a flag.
  const { scope_ledger: _rows, ...model } = call([]);
  const odd = parseVariantManifestModel({ ...model, elements: [{ value: FAMOUS, kind: "common", famous_mark_flag: "yes" }] });
  assert.deepEqual(odd.elements, [{ value: FAMOUS, kind: "common" }]);
});

test("a flagged element is one general-web cell in the grid the search service runs, and the gate owes it", () => {
  const { runDir, spec, log } = runWith();
  validateGridSpec(spec);
  assert.deepEqual(spec.famous, [FAMOUS]);
  const web = spec.grids.find((g) => g.platforms.length === 1 && g.platforms[0] === "web");
  assert.deepEqual(web.terms, [...VARIANTS, FAMOUS], "the element runs on the general web beside every spelling");
  const cells = dictatedCells(spec).map(([t, p]) => key(t, p));
  assert.ok(cells.includes(key(FAMOUS, "web")));
  for (const store of STORES) assert.ok(!cells.includes(key(FAMOUS, store)), `the element was searched on ${store}`);
  assert.equal(log.find((e) => e.event === "frame-web-grid")?.famous, 1);

  const task = buildGridProgramTask(spec);
  assert.ok(task.includes(`TERMS (${VARIANTS.length + 1}): ${JSON.stringify([...VARIANTS, FAMOUS])}\nPLATFORMS (1): ["web"]`),
    "the program the search service is handed does not carry the element's cell");
  const ranAllBut = (skip) => JSON.stringify({ cells: dictatedCells(spec).filter(([t, p]) => key(t, p) !== skip)
    .map(([term, platform]) => ({ term, platform, status: "no_hit", candidates: [] })), extras: {}, gaps: [] });
  assert.deepEqual(findUnranDictatedCells(spec, ranAllBut(null)), []);
  assert.deepEqual(findUnranDictatedCells(spec, ranAllBut(key(FAMOUS, "web"))), [{ variant: FAMOUS, cells: 0, expected: 1, missing: ["web"] }],
    "a famous-mark cell the program skipped is a miss the gate names");
  rmSync(runDir, { recursive: true, force: true });
});

test("an element the grid already searches as a spelling keeps that one cell", () => {
  const { runDir, spec } = runWith({ variantsCall: call(["QUILLOVAR"]) });
  assert.deepEqual(spec.famous, ["QUILLOVAR"]);
  const web = spec.grids.find((g) => g.platforms.length === 1 && g.platforms[0] === "web");
  assert.deepEqual(web.terms, VARIANTS, "no second cell for a spelling already on the general web");
  rmSync(runDir, { recursive: true, force: true });
});

test("THE CONTROL: no element flagged, or no readable model, and the grid is exactly the grid it was", () => {
  const plain = runWith({ variantsCall: call([]) });
  const missing = runWith({ variantsCall: null });
  for (const r of [plain, missing]) {
    assert.equal(r.spec.famous, undefined);
    assert.deepEqual(r.spec.grids, [{ terms: [VARIANTS[0]], platforms: STORES }, { terms: VARIANTS, platforms: ["web"] }]);
    assert.equal(r.log.find((e) => e.event === "frame-web-grid")?.famous, 0);
    rmSync(r.runDir, { recursive: true, force: true });
  }
});

test("the halves run each famous-mark cell once, and each half's record names only its own", () => {
  const { runDir, P, spec } = runWith();
  const halves = ["a", "b", "m"].map((h) => JSON.parse(readFileSync(P.gridSpecHalf(h), "utf8")));
  for (const h of halves) validateGridSpec(h);
  const union = halves.flatMap((h) => dictatedCells(h)).map(([t, p]) => key(t, p));
  assert.deepEqual([...union].sort(), dictatedCells(spec).map(([t, p]) => key(t, p)).sort());
  assert.equal(union.filter((k) => k === key(FAMOUS, "web")).length, 1);
  for (const h of halves) {
    const own = dictatedCells(h).some(([t, p]) => key(t, p) === key(FAMOUS, "web"));
    assert.deepEqual(h.famous ?? [], own ? [FAMOUS] : [], `half ${h.half} records a famous-mark cell it does not run`);
  }
  rmSync(runDir, { recursive: true, force: true });
});

// ── the words the two steps read ────────────────────────────────────────────────────────────────────

const skill = (rel) => readFileSync(join(HERE, "..", "skills", rel), "utf8");

test("the variants step is asked for the flag in its own sentence, and its tool describes it", async () => {
  const msg = ST.STAGES["clearance-variants"].message({ paths: ST.paths("/r"), job: { marks: [MARK], jurisdictions: ["US"] }, profile: null });
  assert.ok(msg.includes("Set `famous_mark_flag: true` on each element that is also a well-known brand, band, celebrity, sports team, "
    + "entertainment property or cultural icon (Step 2's famous-mark check), and leave it off every other element: the web search searches "
    + "each flagged element on the general web, and the web step judges the results."));
  const { readFileSync: read } = await import("node:fs");
  const server = read(join(HERE, "..", "engine", "mcp", "recording-server.mjs"), "utf8");
  assert.ok(server.includes("famous_mark_flag: { type: \"boolean\","), "the tool offers no slot for the flag");
  const variants = skill("clearance-variants/SKILL.md");
  assert.ok(variants.includes("- The web search then searches that element on the general web, and `clearance-common-law` judges the results"));
  assert.doesNotMatch(variants, /famous_mark_calls_needed/, "the variants manual still hands off through a list nobody reads");
});

test("the web step asks no famous-mark question: Step 3 judges the cells, and the template and its depth row are gone", () => {
  const cl = skill("clearance-common-law/SKILL.md");
  assert.ok(cl.includes("The grid searched each of them on the general web, so ask no separate question."));
  assert.ok(cl.includes("- The Elements table's `Famous-mark check` column — the elements Step 3 judges"));
  assert.doesNotMatch(cl, /Famous-mark Perplexity calls needed/, "the web step still waits on a section no manifest carries");
  assert.doesNotMatch(cl, /fire a lightweight fast query per element/);
  const prompts = skill("clearance-common-law/perplexity-prompts.md");
  assert.doesNotMatch(prompts, /Famous-mark query/);
  assert.doesNotMatch(prompts, /Is \[ELEMENT\] a brand name/);
});
