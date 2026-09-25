// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE MATTER FRAME DECIDES THE WEB GRID, AND THE GRID IS SMALL.
//
// The web sweep used to search every spelling on every store the customer profile lists: 1,380 cells on a
// crowded matter, one print near the search service's output cap. The frame now decides, before the sweep,
// which of the profile's stores sell the client's kind of goods and which forms a buyer could confuse. The
// driver dictates that grid in blocks: the mark itself and those forms on the stores the frame did not set
// aside, and every spelling on the general web. A store the frame sets aside, with its reason, is not
// searched and reaches the audit workbook; a store it neither sets aside nor searches stays searched.
//
// These arms follow the path a run takes: the frame's recorded call, the spec the driver derives from it,
// the program the search service is handed, the ledger it prints, the receipts gate, the halves, the
// closure pass and the workbook row, plus the words the frame and the search service read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { frameWebChoice, frameAskedForWebGrid, webGridOf, closureBlocksOf, frameSetAsideRows } from "../web-grid.mjs";
import { acceptMatterFrame } from "../matter-frame-record.mjs";
import { validateGridSpec, dictatedCells, buildGridProgramTask, captureGridFromResponse } from "../../providers/perplexity/src/core.js";
import { findUnranDictatedCells, splitGridSpec, mergeGrids } from "../common-law-receipts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "frame-web-grid-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
const PL = await import("../pipeline.mjs");
const ST = await import("../stages.mjs");

// Coined forms and example stores: this repo is de-identified.
const MARK = "TAMBRIVEL";
const VARIANTS = [MARK, "TAMBRIVELL", "TAMBRI VEL", "TAMBREVEL", "TANBRIVEL", "TAMBRIVAL"];
const STORES = ["shop.alderfen.test", "apps.alderfen.test", "games.alderfen.test", "toys.alderfen.test"];
const CHANNEL = "mods.quorvale.test";
const key = (t, p) => `${t.toLowerCase()}|${p.toLowerCase()}`;
const keysOf = (cells) => cells.map(([t, p]) => key(t, p)).sort();

// ── the frame's decision ─────────────────────────────────────────────────────────────────────────────

test("a frame that never sent the forms has not decided them; an empty list is a decision", () => {
  assert.equal(frameWebChoice({}).forms, null);
  assert.equal(frameWebChoice(null).forms, null);
  assert.deepEqual(frameWebChoice({ confusable_forms: [] }).forms, []);
  assert.deepEqual(frameWebChoice({ confusable_forms: [" TAMBRIVELL ", "tambrivell", "", "TAMBREVEL"] }).forms, ["TAMBRIVELL", "TAMBREVEL"],
    "trimmed, blank dropped, the same form in other capitals counted once");
});

test("a set-aside with no reason, or naming nothing, is not a decision", () => {
  const { setAside } = frameWebChoice({ set_aside: [
    { store: "toys.alderfen.test", reason: "sells no software" },
    { store: "games.alderfen.test" },
    { store: "apps.alderfen.test", reason: "   " },
    { reason: "names nothing" },
    { form: "TAMBRI VEL", reason: "no buyer types the space" },
  ] });
  assert.deepEqual(setAside, [
    { store: "toys.alderfen.test", form: "", reason: "sells no software" },
    { store: "", form: "TAMBRI VEL", reason: "no buyer types the space" },
  ]);
});

test("the frame's acceptor keeps both fields and refuses nothing about them", () => {
  const params = {
    prose_body: "x".repeat(300), scope_basis: "instructed", scope_jurisdictions: ["US"], excluded_jurisdictions: [],
    search_channels: [CHANNEL], meaning_angles: ["tambrivel meaning"], intake_asks: [],
    confusable_forms: ["TAMBRIVELL", "tambrivell", ""],
    set_aside: [{ store: "toys.alderfen.test", reason: "sells no software" }, { store: "games.alderfen.test" }],
  };
  const r = acceptMatterFrame(params);
  const model = r?.model ?? r;
  assert.ok(model && !r?.refused, `the frame is accepted, not refused: ${JSON.stringify(r?.errors ?? r?.refused ?? "")}`);
  assert.deepEqual(model.confusable_forms, ["TAMBRIVELL"]);
  assert.deepEqual(model.set_aside, [{ store: "toys.alderfen.test", reason: "sells no software" }],
    "the reasonless entry is dropped, never refused");
  const absent = acceptMatterFrame({ ...params, confusable_forms: undefined, set_aside: undefined });
  assert.equal((absent?.model ?? absent).confusable_forms, null, "absent stays absent: the frame did not decide the forms");
});

// ── the grid ─────────────────────────────────────────────────────────────────────────────────────────

test("a frame never asked for the fields keeps the grid it was minted with: every spelling on every channel", () => {
  const g = webGridOf({ variants: VARIANTS, channels: [...STORES, CHANNEL], marks: [MARK], decided: false });
  assert.deepEqual(g, { terms: VARIANTS, platforms: [...STORES, CHANNEL, "web"], setAside: [], unmatched: [] });
  assert.equal(dictatedCells(g).length, VARIANTS.length * 6, "one product, exactly as before");
});

test("the frame's grid: the mark and its forms on the stores it kept, every spelling on the general web", () => {
  const g = webGridOf({ variants: VARIANTS, channels: [...STORES, CHANNEL], marks: [MARK],
    forms: ["TAMBRIVELL", "TAMBREVEL"], setAside: [
      { store: "TOYS.alderfen.test", form: "", reason: "sells no software" },
      { store: "", form: "TAMBRI VEL", reason: "no buyer types the space" },
      { store: "nowhere.test", form: "", reason: "not a store the grid carries" },
      { store: "games.alderfen.test", form: "TAMBREVEL", reason: "one form on one store is not a decision this grid makes" },
      { store: "", form: "TAMBRIVELL", reason: "set aside and searched at once" },
    ] });
  const kept = ["shop.alderfen.test", "apps.alderfen.test", "games.alderfen.test", CHANNEL];
  assert.deepEqual(g.platforms, [...kept, "web"], "the set-aside store is gone, matched case-blind");
  assert.deepEqual(g.grids, [
    { terms: [MARK, "TAMBRIVELL", "TAMBREVEL"], platforms: kept },
    { terms: VARIANTS, platforms: ["web"] },
  ]);
  assert.deepEqual(g.menu, [...STORES, CHANNEL, "web"], "the menu the frame chose from, for the record");
  assert.deepEqual(g.setAside, [
    { store: "toys.alderfen.test", reason: "sells no software" },
    { form: "TAMBRI VEL", reason: "no buyer types the space" },
  ]);
  assert.equal(g.unmatched.length, 3, "an unknown store, a form-on-a-store and a form both kept and set aside change nothing");
  validateGridSpec({ ...g, output_path: "/x/common-law-grid.json" });
  assert.equal(dictatedCells(g).length, 3 * 4 + VARIANTS.length, "tens of cells, not every spelling on every store");
});

test("a frame asked for the forms that sent none still gets a small grid: the mark itself stands in", () => {
  const g = webGridOf({ variants: VARIANTS, channels: STORES, marks: [MARK], forms: null, decided: true });
  assert.deepEqual(g.grids, [{ terms: [MARK], platforms: STORES }, { terms: VARIANTS, platforms: ["web"] }]);
  assert.equal(dictatedCells(g).length, STORES.length + VARIANTS.length);
});

test("the mark itself runs on the stores even when the frame's forms leave it out", () => {
  const g = webGridOf({ variants: VARIANTS, channels: STORES, marks: [MARK], forms: ["TAMBREVEL"] });
  assert.deepEqual(g.grids[0].terms, [MARK, "TAMBREVEL"]);
});

test("a mark or form the manifest carries runs under the manifest's spelling, so no term runs under two", () => {
  const g = webGridOf({ variants: VARIANTS, channels: STORES, marks: ["Tambrivel"], forms: ["tambrevel", "TAMBRIVELLE"] });
  assert.deepEqual(g.grids[0].terms, [MARK, "TAMBREVEL", "TAMBRIVELLE"], "the job's and the frame's capitals give way to the manifest's; a new form keeps its own");
  assert.deepEqual(g.terms, [MARK, "TAMBREVEL", "TAMBRIVELLE", ...VARIANTS.filter((v) => v !== MARK && v !== "TAMBREVEL")]);
  assert.equal(new Set(g.terms.map((t) => t.toLowerCase())).size, g.terms.length);
});

test("a request that names the mark with words the manifest does not carry adds no search: the manifest's mark runs", () => {
  const g = webGridOf({ variants: VARIANTS, channels: STORES, marks: [`PROJECT ${MARK}`], forms: null, decided: true });
  assert.deepEqual(g.grids[0].terms, [MARK], "the manifest's first row, which is the mark");
  assert.ok(!g.terms.some((t) => /PROJECT/.test(t)), "the request's raw name is never a new term");
  assert.deepEqual(webGridOf({ variants: [], channels: STORES, marks: [MARK], forms: [], decided: true }).grids,
    [{ terms: [], platforms: ["web"] }], "no manifest, no mark to add: the request's name is never searched on its own");
});

test("every store set aside leaves the general web alone; nothing is refused", () => {
  const g = webGridOf({ variants: VARIANTS, channels: STORES.slice(0, 2), marks: [MARK], forms: [],
    setAside: STORES.slice(0, 2).map((store) => ({ store, form: "", reason: "sells no software" })) });
  assert.deepEqual(g.platforms, ["web"]);
  assert.deepEqual(g.grids, [{ terms: VARIANTS, platforms: ["web"] }]);
  assert.equal(g.setAside.length, 2);
});

// ── the path a run takes: frame record → spec → program → ledger → gate ─────────────────────────────

function runWithFrame({ call, asked = true, profile = { platforms: STORES, profileKey: "alderfen" }, meaning = "Meaning angles: none\n" } = {}) {
  const runDir = mkdtempSync(join(ROOT, "run-"));
  const P = ST.paths(runDir);
  mkdirSync(dirname(P.matterContext), { recursive: true });
  // the lines renderMatterFrame writes; a frame always carries its meaning line, `none` included
  writeFileSync(P.matterContext, `## The matter\n\nA games-kit maker.\n\nSearch channels: ${CHANNEL}\n${meaning}`);
  if (call) {
    const at = driverDir(runDir, "matter-frame-calls", "accepted.json");
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, JSON.stringify({ params: call }));
  }
  if (asked) {
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(driverDir(runDir, "stage-contracts.json"), JSON.stringify({ "matter-frame": { meaningAngles: 1, webGrid: 1 } }));
  }
  const ctx = { paths: P, job: { markName: MARK }, run: {}, gridVariants: VARIANTS, profile, registerOnly: false };
  PL.DERIVATION_RUNNERS["grid-spec"](ctx);
  const spec = JSON.parse(readFileSync(P.gridSpec, "utf8"));
  const log = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { runDir, P, spec, ctx, log };
}

const answer = (...stdouts) => ({ output: [{ type: "sandbox_results", code: "", results: stdouts.map((stdout) => ({ stdout, stderr: "", exit_code: 0 })) }] });
const printed = (cells) => JSON.stringify({ cells: cells.map(([term, platform]) => ({ term, platform, status: "no_hit", candidates: [] })), extras: {}, gaps: [] });

test("the driver dictates the frame's grid, and the program, the capture and the gate all read the same cells", () => {
  const { runDir, spec, log } = runWithFrame({ call: {
    confusable_forms: ["TAMBRIVELL"],
    set_aside: [{ store: "toys.alderfen.test", reason: "sells no software" }, { store: "games.alderfen.test" }],
  } });
  const stores = ["shop.alderfen.test", "apps.alderfen.test", "games.alderfen.test", CHANNEL];
  assert.deepEqual(spec.platforms, [...stores, "web"], "the grid runs the stores the frame kept, its own channel and the web; the reasonless set-aside stays searched");
  assert.deepEqual(spec.grids, [{ terms: [MARK, "TAMBRIVELL"], platforms: stores }, { terms: VARIANTS, platforms: ["web"] }]);
  assert.deepEqual(spec.menu, [...STORES, CHANNEL, "web"]);
  assert.deepEqual(spec.set_aside, [{ store: "toys.alderfen.test", reason: "sells no software" }]);
  const cells = dictatedCells(spec);
  assert.equal(cells.length, 2 * 4 + VARIANTS.length);
  const event = log.find((e) => e.event === "frame-web-grid");
  assert.equal(event?.reading, "frame-forms");
  assert.equal(event?.cells, cells.length, "the run log carries the cell count a reviewer reads");

  // What the search service is handed: both blocks, and no cell outside them.
  const task = buildGridProgramTask(spec);
  assert.match(task, /^Search EXACTLY these 2 term × platform grids — each TERMS list runs on the PLATFORMS list that follows it; every \(term × platform\) cell runs once, no additions, no omissions, keys VERBATIM \(14 cells total\):$/m);
  assert.ok(task.includes(`TERMS (2): ${JSON.stringify([MARK, "TAMBRIVELL"])}\nPLATFORMS (4): ${JSON.stringify(stores)}`));
  assert.ok(task.includes(`TERMS (${VARIANTS.length}): ${JSON.stringify(VARIANTS)}\nPLATFORMS (1): ["web"]`));

  // The program prints exactly the dictated cells: the capture is whole and the gate passes. (The meaning
  // queries ride their own seat's spec; this arm is about the cells, so it asks for none.)
  const { connotation: _meaning, ...cellsOnly } = spec;
  const cap = captureGridFromResponse(answer(printed(cells)), cellsOnly);
  assert.equal(cap.ok, true, cap.error);
  assert.equal(`${cap.present}/${cap.requested}`, `${cells.length}/${cells.length}`);
  assert.deepEqual(findUnranDictatedCells(spec, cap.ledgerJson), []);

  // A dictated cell the program skipped is a reconciled gap and still counts as run; a cell the gate
  // never sees at all is a miss, named by its store.
  const short = JSON.stringify({ cells: JSON.parse(printed(cells)).cells.filter((c) => !(c.term === "TAMBRIVELL" && c.platform === CHANNEL)), extras: {}, gaps: [] });
  assert.deepEqual(findUnranDictatedCells(spec, short), [{ variant: "TAMBRIVELL", cells: 4, expected: 5, missing: [CHANNEL] }]);
  rmSync(runDir, { recursive: true, force: true });
});

test("the halves split the blocks by term, and between them run exactly the dictated cells", () => {
  const { runDir, P, spec } = runWithFrame({ call: { confusable_forms: ["TAMBRIVELL", "TAMBREVEL"] } });
  const halves = ["a", "b", "m"].map((h) => JSON.parse(readFileSync(P.gridSpecHalf(h), "utf8")));
  for (const h of halves) validateGridSpec(h);
  const union = halves.flatMap((h) => dictatedCells(h));
  assert.deepEqual(keysOf(union), keysOf(dictatedCells(spec)), "no cell lost and none added across the halves");
  assert.equal(new Set(union.map(([t, p]) => key(t, p))).size, union.length, "no cell runs in two halves");
  assert.equal(dictatedCells(halves[2]).length, 0, "the meaning seat runs no cells");
  assert.deepEqual(splitGridSpec(spec).m.grids, [], "…its blocks are empty, not the full grid");
  rmSync(runDir, { recursive: true, force: true });
});

test("the merge counts a gap only for a dictated cell, and the closure pass re-runs only those", () => {
  const { runDir, spec } = runWithFrame({ call: { confusable_forms: ["TAMBRIVELL"] } });
  const cells = dictatedCells(spec);
  const ran = (pred) => ({ cells: cells.filter(pred).map(([term, platform]) => ({ term, platform, status: "no_hit", candidates: [] })), extras: {}, gaps: [] });
  const merged = mergeGrids(ran(([t]) => t === MARK), ran(([t, p]) => t !== MARK && p === "web"), { spec });
  const gapKeys = merged.gaps.map((g) => key(g.term, g.platform)).sort();
  assert.deepEqual(gapKeys, keysOf(cells.filter(([t, p]) => t === "TAMBRIVELL" && p !== "web")),
    "only the form's store cells are owed: no gap for a spelling on a store the grid never asked");

  const closure = { terms: [...new Set(merged.gaps.map((g) => g.term))], platforms: [...new Set(merged.gaps.map((g) => g.platform))],
    ...closureBlocksOf(merged.gaps), output_path: "/x/supp.json" };
  validateGridSpec(closure);
  assert.deepEqual(keysOf(dictatedCells(closure)), gapKeys);
  const mixed = [{ variant: MARK, platform: "shop.alderfen.test" }, { variant: "TAMBRI VEL", platform: "web" }];
  const blocks = closureBlocksOf(mixed);
  assert.deepEqual(keysOf(dictatedCells({ terms: [MARK, "TAMBRI VEL"], platforms: ["shop.alderfen.test", "web"], ...blocks })),
    keysOf([[MARK, "shop.alderfen.test"], ["TAMBRI VEL", "web"]]), "gaps from two blocks stay two blocks, never their product");
  assert.deepEqual(closureBlocksOf([{ variant: MARK, platform: "web" }, { variant: "TAMBRI VEL", platform: "web" }]), {},
    "gaps that share their platforms are one product, as before");
  rmSync(runDir, { recursive: true, force: true });
});

test("a frame never asked for the fields, resumed today, keeps its old grid, and a frame asked that sent none gets the mark", () => {
  const legacy = runWithFrame({ call: { search_channels: [CHANNEL] }, asked: false });
  assert.equal(legacy.spec.grids, undefined);
  assert.deepEqual(legacy.spec.terms, VARIANTS);
  assert.deepEqual(legacy.spec.platforms, [...STORES, CHANNEL, "web"]);
  assert.equal(legacy.log.find((e) => e.event === "frame-web-grid")?.reading, "every-channel");
  rmSync(legacy.runDir, { recursive: true, force: true });

  const silent = runWithFrame({ call: { search_channels: [CHANNEL] } });
  assert.deepEqual(silent.spec.grids[0], { terms: [MARK], platforms: [...STORES, CHANNEL] });
  assert.equal(silent.log.find((e) => e.event === "frame-web-grid")?.reading, "mark-only");
  assert.equal(frameAskedForWebGrid(silent.runDir), true);
  assert.equal(frameAskedForWebGrid(join(ROOT, "no-such-run")), false);
  rmSync(silent.runDir, { recursive: true, force: true });
});

test("a store the frame set aside reaches the audit workbook with the frame's reason; a form does not", () => {
  const { runDir } = runWithFrame({ call: { confusable_forms: [], set_aside: [
    { store: "toys.alderfen.test", reason: "sells no software; toys only" }, { form: "TAMBRI VEL", reason: "no buyer types the space" }] } });
  assert.deepEqual(frameSetAsideRows(runDir), [{ area: "toys.alderfen.test", state: "not-searched", note: "sells no software; toys only",
    done: "", left: "sells no software; toys only" }], "the reason stays whole in one cell, as a withheld family's does");
  assert.deepEqual(frameSetAsideRows(join(ROOT, "no-such-run")), [], "no spec, no row, and no throw");
  rmSync(runDir, { recursive: true, force: true });
});

// ── the words the frame and the search service read ─────────────────────────────────────────────────

const SENTENCE_5 = "The stores that sell the client's kind of goods, for the forms a buyer could confuse. The customer profile's list is what you choose from, not what you owe. A store or form set aside is written down with its reason.";
const skill = (rel) => readFileSync(join(HERE, "..", "skills", rel), "utf8");
const count = (hay, needle) => hay.split(needle).length - 1;

test("sentence 5 is in the frame's manual once, word for word, and nowhere in the web sweep's", () => {
  const frame = skill("matter-frame/SKILL.md");
  assert.equal(count(frame, SENTENCE_5), 1);
  assert.equal(count(frame, "`search_channels`, `confusable_forms` and `set_aside` decide the web grid before the web sweep runs it:"), 1);
  assert.equal(count(skill("clearance-common-law/SKILL.md"), SENTENCE_5), 0);
});

test("the web sweep's manual no longer says every variant runs on every store", () => {
  const web = skill("clearance-common-law/SKILL.md");
  for (const gone of ["the gaming default is 6 stores", "every one is mandatory for every variant", "The dictated platform list is the floor",
    "(the program searches them on every platform)", "full variant × platform matrix", "every variant × platform combination",
    // and the leftovers of the same full grid: every spelling on every store, and a mandatory store list
    "the full grid accounting", "(variant × platform) grid cell", "variant × platform grid cell", "full term × platform matrix",
    "term-by-term", "each mandatory platform"])
    assert.equal(count(web, gone), 0, gone);
  assert.equal(count(skill("clearance-search/phase2-execution.md"), "the 6 gaming platforms"), 0, "the skeptic still checks a fixed store list");
  for (const kept of ["- **The dictated platforms** — your task message's PLATFORMS block names the exact store domains for this customer's profile. A gaming profile",
    "Extend with field-scoped cells when the matter goes outside", "6. **Negative results** — one row per grid cell", "- [ ] Negative results documented for every grid cell"])
    assert.equal(count(web, kept), 1, kept);
});

test("the frame is shown a named customer's stores and asked for both fields, in the owner's words", () => {
  const msg = (profile) => ST.STAGES["matter-frame"].message({ paths: ST.paths(join(ROOT, "msg")), job: { markName: MARK, classes: ["9"] }, profile, exclusionSeed: [] });
  const named = msg({ platforms: STORES, profileKey: "alderfen" });
  assert.equal(count(named, `Customer profile's stores: ${STORES.join(", ")}.`), 1);
  assert.equal(count(named, "Send `confusable_forms` — the forms a buyer could confuse, as a buyer would type them. Each is searched on every store you do not set aside and on every channel in `search_channels`; every spelling is searched on the general web."), 1);
  assert.equal(count(named, "Send `set_aside` — one `{store, reason}` for each store on the customer profile's list you do not search, and one `{form, reason}` for each form you set aside. A store with no entry here is searched."), 1);
  assert.doesNotMatch(msg({ platforms: STORES, profileKey: "generic" }), /Customer profile's stores:/, "generic's house list is replaced by the frame's channels, not chosen from");
  assert.doesNotMatch(msg({ platforms: [], profileKey: "alderfen" }), /Customer profile's stores:/);
  assert.deepEqual(ST.STAGES["matter-frame"].contract, { meaningAngles: 1, webGrid: 1 });
});

test("the frame's tool describes the two fields in the owner's words and requires neither", () => {
  const src = readFileSync(join(HERE, "..", "engine", "mcp", "recording-server.mjs"), "utf8");
  const at = src.indexOf("confusable_forms: {");
  const block = src.slice(at, src.indexOf("meaning_angles: {", at));
  assert.ok(at > 0 && block.includes('description: "The forms a buyer could confuse, as a buyer would type them."'));
  for (const d of ['"A store or form set aside is written down with its reason."', '"A store from the customer profile\'s list."', '"A form of the mark."', '"Why it is set aside."'])
    assert.ok(block.includes(`description: ${d}`), d);
  assert.doesNotMatch(block, /required/, "a reasonless entry is dropped by the acceptor, never refused by the schema");
});

test("a grid of one product reads exactly as it always has", () => {
  const spec = { terms: VARIANTS.slice(0, 2), platforms: ["shop.alderfen.test", "web"], output_path: "/x/g.json", batch: 14 };
  const task = buildGridProgramTask(spec);
  assert.match(task, /^Search EXACTLY this term × platform grid — every \(term × platform\) cell runs once, no additions, no omissions, keys VERBATIM \(4 cells total\):$/m);
  assert.doesNotMatch(task, /grids — each TERMS list/);
});

test.after(() => rmSync(ROOT, { recursive: true, force: true }));

test("only the frame's `none` stamps an empty meaning search; a frame with no usable line fails the grid spec", () => {
  assert.equal(runWithFrame().spec.connotation.none_named, true);
  const named = runWithFrame({ meaning: "Meaning angles: novapulse slang meaning; novapulse gaming backlash\n" }).spec.connotation;
  assert.deepEqual([named.queries, named.none_named], [["novapulse slang meaning", "novapulse gaming backlash"], undefined]);
  for (const meaning of ["", "Meaning angles: \"; `\n"])
    assert.throws(() => runWithFrame({ meaning }), /Meaning angles:.*did not assert none/,
      "a frame that never decided had its empty meaning search stamped as its decision");
});
