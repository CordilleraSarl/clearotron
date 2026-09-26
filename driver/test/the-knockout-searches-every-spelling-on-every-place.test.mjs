// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A knockout's web search is a grid: every spelling the frame names for a mark, searched once on every
// place it names for the batch, through the clearance grid's own program path, with every result kept and
// no summary. The rating step judges the ledger.
//
// This walks the path a run takes rather than each half: the plan's checks, the spec, the request the
// provider receives, the ledger the capture writes as the mark's research file, the raw results kept
// beside it, the receipt, the rating step's dispatch and the receipts gate. The knockout runs end to end
// on the repo's mock model, and the provider is a stand-in behind `fetch`, answering from the program it
// was sent, so nothing here reaches a network. The marks are invented.
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-web-grid-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
pinEnv(process.env, "CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES", undefined);
process.env.CLEAROTRON_AGENT = "mailagent";
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";
// The live executor, not an injected one: it is chosen when a research key is present, and the stand-in
// below is the only thing it can reach.
process.env.PERPLEXITY_API_KEY = "offline-stand-in";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { KO_STAGES, koPaths, knockoutGridSpec, KNOCKOUT_WEB, kebab } = await import("../stages-knockout.mjs");
const { buildKnockoutWorkbook } = await import("../publish/knockout.mjs");
const { plainDeferralReason } = await import("../deferral-row.mjs");
const { knockoutReceipts, validators, placesDefect, spellingsDefect, useKindDefect } = await import("../verify-knockout.mjs");
const { acceptKnockoutFrame, refuseUndeclared } = await import("../knockout-frame-record.mjs");
const { buildRequestBody, buildGridProgramTask, validateGridSpec, SANDBOX_INSTRUCTIONS } = await import("../../providers/perplexity/src/core.js");
const { RESEARCH_PROVIDERS } = await import("../driver.config.mjs");

// ── The plan's two lists, checked as the search program will read them ─────────────────────────────

const PLACES_SENTENCE = 'mark "LANTERNWICK": places is required: 2 or more places, one of them "web" and each other a bare host';
const BATCH_PLACES_SENTENCE = 'batch.places is required: 2 or more places, one of them "web" and each other a bare host';

test("a name's places are `web` and bare hosts in lower case, two or more, exactly one of them the web", () => {
  for (const ok of [
    ["web", "fandom.com"],
    ["store.steampowered.com", "web", "fandom.com", "itch.io"],
    // FIVE, AND MORE, ARE LEGAL (ruling 570). The five-place list was among the refusals before, under a
    // cap of four; it is kept here as an accepted case rather than deleted, because a list PASSING is the
    // evidence the cap is gone and a deleted case is evidence of nothing.
    ["web", "a.com", "b.com", "c.com", "d.com"],
    ["web", ...Array.from({ length: 30 }, (_, i) => `store${i}.example.com`)],
  ]) assert.equal(placesDefect("LANTERNWICK", ok), null, JSON.stringify(ok).slice(0, 80));

  // The floor, the one web and the shape of a host all stand: one place is not a screen, ruling 543 puts
  // the whole web in every list, and a place is passed to the provider as a site filter exactly as written.
  for (const bad of [
    undefined, [], ["web"],
    ["web", "web"], ["fandom.com", "itch.io"], ["Web", "fandom.com"], ["web", "Fandom.com"],
    ["web", "https://fandom.com"], ["web", "fandom.com/wiki"], ["web", " fandom.com"], ["web", "fandom"],
    ["web", "fandom.com", "fandom.com"], ["web", 7],
  ]) assert.equal(placesDefect("LANTERNWICK", bad), PLACES_SENTENCE, JSON.stringify(bad));

  // The same check names the batch when it is reading an archived plan's one list, and the refusal says so.
  assert.equal(placesDefect(null, ["web"]), BATCH_PLACES_SENTENCE);
  assert.equal(placesDefect(null, ["web", "fandom.com"]), null);
});

test("the spellings are 2 or 3 searches, the name among them and none a repeat of another", () => {
  assert.equal(spellingsDefect("LANTERNWICK", ["LANTERNWICK", "LANTERN WICK"]), null);
  assert.equal(spellingsDefect("LANTERNWICK", ["lanternwick", "LANTERN-WICK", "LANTERNWIK"]), null, "the name in any case is the name");
  const sentence = 'mark "LANTERNWICK": spellings is required: 2 or 3 ways the name is written, the name among them';
  for (const bad of [
    undefined, ["LANTERNWICK"], ["LANTERNWICK", "A", "B", "C"], ["LANTERNWICK", "lanternwick"],
    ["LANTERN WICK", "LANTERNWIK"], ["LANTERNWICK", ""], ["LANTERNWICK", "LANTERNWICK  "],
  ]) assert.equal(spellingsDefect("LANTERNWICK", bad), sentence, JSON.stringify(bad));
});

test("the kind of use is required, asked for in one to three words, and a longer one is accepted", () => {
  for (const ok of ["character", "app", "achievement", "in-game location", "game character name"])
    assert.equal(useKindDefect("LANTERNWICK", ok), null, JSON.stringify(ok));
  const sentence = 'mark "LANTERNWICK": useKind is required: one to three words, the kind of use this name is searched for (task 2c)';
  for (const missing of [undefined, null, "", "   ", 7, [], {}])
    assert.equal(useKindDefect("LANTERNWICK", missing), sentence, JSON.stringify(missing));

  // A LONGER ANSWER IS ACCEPTED, and these three cases used to be refused (ruling 583 softened it). They
  // stay here as the positive evidence that no length bound is left, rather than being deleted — a deleted
  // case proves nothing, and the first of them is the shape the batch's own `inUseAs` line invites, so it
  // would have fired on a frame doing exactly as it was asked. The cost of a refusal was a repair turn,
  // and a run that repaired anything has failed the round's bar; a long answer only lengthens each cell's
  // query, which makes the screen weaker and not wrong.
  for (const long of ["a place in a game", "a character in the client's own broadcast", "the name of a place inside a game"])
    assert.equal(useKindDefect("LANTERNWICK", long), null, `refused a longer kind of use: ${JSON.stringify(long)}`);
});

test("the plan and the frame's tool refuse with the same sentence, and the tool declares all four fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "knockout-web-plan-"));
  // NO BATCH LIST: from ruling 570 the places are the mark's. The archived shape, a batch list and marks
  // without one, is driven in its own arm below.
  const batch = { productContext: "video games", inUseAs: "a character or a place in a game" };
  const mark = { ref: null, name: "LANTERNWICK", classes: [9], beltAndBraces: [], classesPlain: "game software (9)",
    contextFraming: "the flagship game", useKind: "character", places: ["web", "fandom.com"],
    spellings: ["LANTERNWICK", "LANTERN WICK"], priorKnowledge: null, priority: 1 };
  const plan = (b, m) => JSON.stringify({ schema: 1, batch: b, marks: [m] });
  assert.equal(validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(batch, mark)).ok, true);
  const noPlaces = validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(batch, { ...mark, places: undefined }));
  assert.equal(noPlaces.reason, PLACES_SENTENCE);
  const noSpellings = validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(batch, { ...mark, spellings: undefined }));
  assert.match(noSpellings.reason, /^mark "LANTERNWICK": spellings is required/);
  const noUse = validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(batch, { ...mark, useKind: undefined }));
  assert.match(noUse.reason, /^mark "LANTERNWICK": useKind is required/);

  const call = (b, m) => acceptKnockoutFrame({ scope_note: "One name, screened.", batch: b, marks: [m] });
  assert.equal(call(batch, mark).ok, true);
  assert.equal(call(batch, { ...mark, places: ["web"] }).reason, `knockoutframe_places:LANTERNWICK — ${PLACES_SENTENCE}`);
  assert.match(call(batch, { ...mark, spellings: ["LANTERN WICK", "X"] }).reason, /^knockoutframe_spellings:LANTERNWICK — mark "LANTERNWICK": spellings is required/);
  assert.match(call(batch, { ...mark, useKind: undefined }).reason, /^knockoutframe_use_kind:LANTERNWICK — mark "LANTERNWICK": useKind is required/);
  assert.equal(refuseUndeclared({ batch, marks: [mark] }), null, "the tool declares all four fields");

  // THE ARCHIVED SHAPE STILL VALIDATES AND STILL RUNS: one list on the batch, no list on the marks. That
  // is the whole of 570's back-compatibility, and without this arm a plan frozen last week would be
  // refused by a rule written today.
  const oldBatch = { ...batch, places: ["web", "fandom.com"] };
  const { places: _dropped, ...oldMark } = mark;
  assert.equal(validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(oldBatch, oldMark)).ok, true,
    "a plan frozen before the field existed is refused by a rule written after it");
  assert.equal(call(oldBatch, oldMark).ok, true, "and the frame's tool accepts the same shape");
  // …and a bad batch list is still named as the batch's, so an archived plan reads back under its own rule.
  assert.equal(call({ ...batch, places: ["web"] }, oldMark).reason, `knockoutframe_places: ${BATCH_PLACES_SENTENCE}`);
});

test("the spec is the plan's own lists, copied, with the knockout's results per cell", () => {
  const row = { name: "LANTERNWICK", useKind: "character", spellings: ["LANTERNWICK", "LANTERN WICK"] };
  const batch = { places: ["web", "fandom.com"] };
  const spec = knockoutGridSpec(row, batch, { outputPath: "/r/research/lanternwick.md" });
  assert.deepEqual(spec, { terms: ["LANTERNWICK", "LANTERN WICK"], platforms: ["web", "fandom.com"],
    use: "character", output_path: "/r/research/lanternwick.md", results_per_cell: 10 });
  spec.terms.push("X");
  assert.deepEqual(row.spellings, ["LANTERNWICK", "LANTERN WICK"], "a copy: the frozen plan is never written through the spec");
  assert.deepEqual(KNOCKOUT_WEB, { preset: "pro-search", reasoning: { effort: "low" }, resultsPerCell: 10, questionPreset: "pro-search" });
});

test("each mark's spec carries THAT mark's kind of use, and a plan frozen without one searches the bare spelling", () => {
  const batch = { places: ["web", "fandom.com"] };
  const spec = (row) => knockoutGridSpec(row, batch, { outputPath: "/r/research/x.md" });
  // Two marks in one batch, two different uses: the spec reads the row it was handed and never a sibling.
  assert.equal(spec({ name: "LANTERNWICK", useKind: "character", spellings: ["LANTERNWICK", "LANTERN WICK"] }).use, "character");
  assert.equal(spec({ name: "MOSSGLEN", useKind: "in-game location", spellings: ["MOSSGLEN", "MOSS GLEN"] }).use, "in-game location");
  assert.equal(spec({ name: "LANTERNWICK", useKind: "  character  ", spellings: ["LANTERNWICK"] }).use, "character", "trimmed, so no cell searches a trailing space");
  // BACK-COMPAT, and the reason the field is optional on the spec: the validator refuses a NEW plan
  // without a use, so a row that has none is one frozen before the field existed. Its cells search the
  // bare spelling, exactly as every knockout did then, rather than the run failing on an old plan.
  for (const without of [{ name: "OLDPLAN", spellings: ["OLDPLAN"] }, { name: "OLDPLAN", useKind: "", spellings: ["OLDPLAN"] }, { name: "OLDPLAN", useKind: 7, spellings: ["OLDPLAN"] }])
    assert.equal("use" in spec(without), false, JSON.stringify(without));
});

test("a cell's query is its spelling followed by the kind of use, and the cell's key stays the spelling", () => {
  const base = { terms: ["LANTERNWICK", "LANTERN WICK"], platforms: ["web", "fandom.com"], output_path: "/r/g.json" };
  const task = (spec) => buildGridProgramTask(spec);
  const withUse = task({ ...base, use: "character" });
  assert.match(withUse, /pplx_sdk\.search\.web\(term \+ " " \+ "character", limit=10, domains=\[platform\]\)/);
  assert.match(withUse, /Every cell's query is its term followed by a space and "character"; the cell's "term" key is still the TERM exactly as listed, never the query\./);
  // The lists themselves are untouched: the use rides the query, so the grid is the same size and the
  // keys the capture reconciles against are the spellings the frame wrote.
  assert.match(withUse, /TERMS \(2\): \["LANTERNWICK","LANTERN WICK"\]/);
  assert.match(withUse, /PLATFORMS \(2\): \["web","fandom\.com"\]/);
  const withoutUse = task(base);
  assert.match(withoutUse, /pplx_sdk\.search\.web\(term, limit=10, domains=\[platform\]\)/);
  assert.doesNotMatch(withoutUse, /Every cell's query is its term followed by/);
  // The provider refuses a use that carries nothing, and NOT one that is merely long: refusing there
  // would fail the whole grid over the frame's choice of words, after the driver had already accepted it.
  for (const empty of ["", "   ", 7])
    assert.throws(() => validateGridSpec({ ...base, use: empty }), /grid spec\.use, when present, must be a non-empty string/, JSON.stringify(empty));
  for (const long of ["in-game location", "the name of a place inside one of the client's games"])
    assert.doesNotThrow(() => validateGridSpec({ ...base, use: long }), `the provider refused a longer use: ${long}`);
  assert.doesNotThrow(() => validateGridSpec(base), "absent is still a valid spec");
});

test("the audit trail says what each cell searched: the spelling with its kind of use", async () => {
  const out = join(mkdtempSync(join(ROOT, "book-")), "audit.xlsx");
  const receipts = [
    { mark: "LANTERNWICK", spellings: ["LANTERNWICK", "LANTERN WICK"], places: ["web", "fandom.com"], use: "character", ok: true, bytes: 12, callNo: 1, preset: "pro-search", took_ms: 1000 },
    // AN ARCHIVED RECEIPT, from a run delivered before the field existed: it prints as it was delivered.
    { mark: "MOSSGLEN", spellings: ["MOSSGLEN", "MOSS GLEN"], places: ["web"], ok: true, bytes: 8, callNo: 2, preset: "pro-search", took_ms: 900 },
  ];
  await buildKnockoutWorkbook({ marks: [{ name: "LANTERNWICK", findings: [] }, { name: "MOSSGLEN", findings: [] }] }, receipts, out);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet("Audit Trail");
  const head = ws.getRow(1).values.slice(1);
  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, String(row.values[i + 1] ?? "")]))); });
  const term = (mark) => rows.find((r) => r["Mark"] === mark)?.["Search Term"];
  assert.equal(term("LANTERNWICK"), "LANTERNWICK character, LANTERN WICK character");
  assert.equal(term("MOSSGLEN"), "MOSSGLEN, MOSS GLEN", "a receipt with no kind of use prints its spellings as it always did");
});

test("what the rating did not carry reaches the audit workbook with the rater's own ground", async () => {
  const out = join(mkdtempSync(join(ROOT, "book-aside-")), "audit.xlsx");
  const GROUND = "A fan page for an unrelated board game; no trade use of the name.";
  const findings = { marks: [
    { name: "LANTERNWICK", findings: [], setAside: [
      { url: "https://example.test/fan-page", ground: GROUND },
      // REFUSED BY THE VALIDATOR, so it cannot arrive on a fresh run — but this builder is also called
      // directly on a re-render of an existing record, with no validator between, so a half-formed row
      // from another build reaches here. It must not vanish: a mark that set something aside would print
      // as having set nothing aside.
      { url: "https://example.test/no-ground", ground: "  " },
      // The one shape that cannot be printed: nothing to name and nothing to look up.
      { url: "", ground: "a ground with nothing to attach it to" },
    ] },
    { name: "MOSSGLEN", findings: [] },
  ] };
  await buildKnockoutWorkbook(findings, [], out);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet("Audit Trail");
  const head = ws.getRow(1).values.slice(1);
  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, String(row.values[i + 1] ?? "")]))); });
  const aside = rows.filter((r) => r["Search Term"].startsWith("Set aside: "));
  assert.equal(aside.length, 2, `the row with no address cannot print; the one missing its ground must: ${JSON.stringify(rows.map((r) => r["Search Term"]))}`);

  const complete = aside.find((r) => r["Search Term"].endsWith("/fan-page"));
  assert.equal(complete["Search Term"], "Set aside: https://example.test/fan-page");
  assert.equal(complete["Result Summary"], GROUND, "the ground is the rater's words, carried through");
  assert.equal(complete["Mark"], "LANTERNWICK");
  // READING A RESULT AND PUTTING IT DOWN IS THE SCREEN WORKING, so the row is not a degraded one: a
  // Degraded here would tell the reader a part of the screen failed when the opposite happened.
  assert.equal(complete["OK/Degraded"], "OK");

  // AND THE HALF-FORMED ROW IS VISIBLE RATHER THAN DROPPED, marked Degraded because part of this record
  // is genuinely missing. Dropped silently, this mark would read as having set nothing aside.
  const half = aside.find((r) => r["Search Term"].endsWith("/no-ground"));
  assert.equal(half["OK/Degraded"], "Degraded");
  // ITS REASON CELL SAYS NOTHING, and the arm pins the emptiness on purpose. The row's shipped line for a
  // part left open asserts a step could not be completed, and here the set-aside was completed — only its
  // reason is absent from the record. That line would tell a client a step failed when none did, which is
  // what this sheet was cleaned of; no shipped string says "the reason is not in this record", and a new
  // one is a sentence a client reads. Empty asserts nothing untrue, and Degraded carries the fact.
  assert.equal(half["Result Summary"], "", "an empty reason is the only honest one until a sentence exists for it");
  assert.notEqual(half["Result Summary"], plainDeferralReason("unfinished"),
    "this row must never claim a step could not be completed: the set-aside happened, its reason did not survive");
});

test("the clearance grid's request is unchanged: no reasoning setting, and its own 10 asked and 8 kept", () => {
  const spec = { terms: ["LANTERNWICK"], platforms: ["web", "shop.example.com"], output_path: "/r/grid.json" };
  const body = buildRequestBody({ task: buildGridProgramTask(spec), preset: "pro-search", enableSandbox: true });
  assert.equal("reasoning" in body, false);
  assert.match(body.input, /limit=10, domains=\[platform\]/);
  assert.match(body.input, /if len\(results\) >= 8: break/);
});

// ── The run ──────────────────────────────────────────────────────────────────────────────────────────

const HITS = {
  LANTERNWICK: [
    { title: "Lanternwick on a store", url: "https://store.example.test/lanternwick" },
    { title: "Lanternwick, a character", url: "https://wiki.example.test/lanternwick" },
  ],
};
const sent = [];
const answer = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
let mossglenAttempts = 0;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  sent.push(body);
  if (!body.tools.some((t) => t.type === "sandbox")) {
    return answer({ output: [{ type: "message", content: [{ type: "output_text", text: "An answer. https://example.test/owner" }] }] });
  }
  // The stand-in runs the program it was sent: the cells come from the task's own TERMS and PLATFORMS lines.
  const terms = JSON.parse(body.input.match(/TERMS \(\d+\): (\[.*\])/)[1]);
  const platforms = JSON.parse(body.input.match(/PLATFORMS \(\d+\): (\[.*\])/)[1]);
  const searched = { type: "search_results", queries: terms, results: [{ id: 1, title: "a page", url: "https://example.test/page" }] };
  // MOSSGLEN's first program prints something unreadable, as a program the provider writes sometimes does.
  if (terms[0] === "MOSSGLEN" && ++mossglenAttempts === 1) {
    return answer({ output: [searched, { type: "sandbox_results", code: "", results: [{ stdout: "Traceback (most recent call last):", stderr: "", exit_code: 1 }] }] });
  }
  const cells = terms.flatMap((term, i) => platforms.map((platform, j) => {
    const candidates = i === 0 && j === 0 ? (HITS[terms[0]] ?? []) : [];
    return { term, platform, status: candidates.length ? "hit" : "no_hit", candidates };
  }));
  return answer({ output: [searched, { type: "sandbox_results", code: "", results: [{ stdout: JSON.stringify({ cells, gaps: [], extras: {} }), stderr: "", exit_code: 0 }] }] });
};

const MARKS = ["LANTERNWICK", "MOSSGLEN"];
async function knockout(codename) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-09-25-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-09-25", codename, archiveDir: join(studioRoot, "archive", `2026-09-25-${codename}`) };
  const job = { id, markName: MARKS[0], marks: MARKS.map((name) => ({ name })), classes: [9], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout", stageLabel: "Knockout", components: {} } };
  const res = await knockoutInner(ctx, job, {});
  return { res, dir: res?.runDir ?? dir };
}

test("each mark is one grid call, its ledger is its research file, and everything that came back is kept", async () => {
  const { res, dir } = await knockout("web-grid");
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  const plan = JSON.parse(readFileSync(join(dir, "knockout-plan.json"), "utf8"));

  // THE REQUEST: the knockout's settings, the sandbox program, and the plan's lists written into it verbatim
  const grids = sent.filter((b) => b.tools.some((t) => t.type === "sandbox"));
  assert.equal(grids.length, 3, "one call a mark, and one more for the mark whose program printed nothing readable");
  for (const b of grids) {
    assert.equal(b.preset, "pro-search");
    assert.deepEqual(b.reasoning, { effort: "low" });
    assert.deepEqual(b.tools.map((t) => t.type), ["sandbox", "web_search"]);
    assert.equal(b.instructions, SANDBOX_INSTRUCTIONS);
    assert.match(b.input, /limit=10, domains=\[platform\]/);
    assert.match(b.input, /if len\(results\) >= 10: break/);
  }
  for (const m of plan.marks) {
    const b = grids.find((x) => x.input.includes(`TERMS (${m.spellings.length}): ${JSON.stringify(m.spellings)}`));
    assert.ok(b, `no call carried ${m.name}'s spellings verbatim`);
    // THIS MARK'S OWN PLACES, verbatim (ruling 570) — read off the frozen plan's mark row, not the batch,
    // so a driver that sent one batch-wide list would fail here rather than pass on a shared default.
    assert.ok(Array.isArray(m.places) && m.places.length >= 2, `${m.name}'s plan row carries no places`);
    assert.ok(b.input.includes(`PLATFORMS (${m.places.length}): ${JSON.stringify(m.places)}`), `${m.name}'s own places are not in its call, verbatim`);
    // AND THE KIND OF USE the frame named for THIS mark, read off the frozen plan rather than written
    // here, so the arm fails if the driver sends a use the plan does not hold.
    assert.ok(m.useKind, `${m.name}'s plan row carries no kind of use`);
    assert.ok(b.input.includes(`pplx_sdk.search.web(term + " " + ${JSON.stringify(m.useKind)}, limit=10`),
      `${m.name}'s cells do not search its spelling followed by its kind of use`);
  }

  // THE PAYLOAD: the ledger, every cell, the listings where a search found some
  const payload = JSON.parse(readFileSync(join(dir, "research", "lanternwick.md"), "utf8"));
  assert.equal(payload.cells.length, 4, "two spellings on two places");
  assert.deepEqual(payload.cells.flatMap((c) => c.candidates.map((r) => r.url)), HITS.LANTERNWICK.map((h) => h.url));
  assert.equal(existsSync(join(dir, "research", "mossglen.md")), true, "the retried mark has its payload");

  // THE RAW RESULTS: every attempt's, beside the payload's name, including the attempt that failed
  const raw = (mark) => JSON.parse(readFileSync(koPaths(dir).webResults(kebab(mark)), "utf8"));
  assert.deepEqual(raw("LANTERNWICK").attempts.map((a) => a.items.map((i) => i.type)), [["search_results", "sandbox_results"]]);
  assert.deepEqual(raw("MOSSGLEN").attempts.map((a) => a.attempt), [1, 2], "the failed attempt's results are kept too");

  // THE RECEIPT: what the call searched, on what settings, and how long the mark took
  const rows = readFileSync(driverDir(dir, "knockout-sweep.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(rows.length, 2, "one receipt a mark");
  const lw = rows.find((r) => r.mark === "LANTERNWICK");
  assert.deepEqual(
    { ok: lw.ok, preset: lw.preset, reasoning: lw.reasoning, resultsPerCell: lw.resultsPerCell, cells: lw.cells, present: lw.present, attempts: lw.attempts },
    { ok: true, preset: "pro-search", reasoning: "low", resultsPerCell: 10, cells: 4, present: 4, attempts: 1 });
  const lwRow = plan.marks.find((m) => m.name === "LANTERNWICK");
  assert.deepEqual([lw.spellings, lw.places], [lwRow.spellings, lwRow.places], "the receipt does not carry THIS mark's own places");
  // AND THE TWO MARKS' LISTS DIFFER in this batch, which is what makes the assertion above able to fail:
  // against one shared list it would pass however the driver resolved them.
  const mgRow = plan.marks.find((m) => m.name === "MOSSGLEN");
  assert.notDeepEqual(lwRow.places, mgRow.places, "both marks were framed with the same places, so nothing here could tell them apart");
  // AND THE USE ON THE RECEIPT, so what each cell searched is readable after the run from the receipt
  // alone, beside the spellings and the places it was crossed with.
  assert.equal(lw.use, plan.marks.find((m) => m.name === "LANTERNWICK").useKind, "the receipt does not say what use the cells carried");
  assert.equal(rows.find((r) => r.mark === "MOSSGLEN").attempts, 2);
  assert.ok(Number.isFinite(lw.took_ms) && lw.took_ms >= 0);

  // THE RATING STEP is handed each mark's ledger by path, and told what it is
  const K = koPaths(dir);
  const assess = (job) => KO_STAGES["knockout-assess"].message({ K, job, chunkNo: 0, chunkTotal: 1, probeNote: "",
    chunkMarks: MARKS.map((name) => ({ name })), framework: { title: "House triage", bands: [{ label: "High" }, { label: "Low" }] } });
  const dispatch = assess({ jurisdictions: ["EU", " US "] });
  assert.match(dispatch, /Each mark's RAW research payload: the record of its web searches, every spelling on every place/);
  for (const m of MARKS) assert.ok(dispatch.includes(`- ${m}: ${K.research(kebab(m))}`), `${m}'s payload is not named`);
  // The search is not limited to the ordered territories, so the step that judges is told them
  assert.ok(dispatch.includes("THE TERRITORIES THIS SCREEN WAS ORDERED FOR: EU, US. The web search was not limited to them. "
    + "A use found only outside them is out of scope for this screen: leave it out of the findings, and say in that mark's assessment that you left it out."));
  assert.doesNotMatch(assess({ jurisdictions: [] }), /ORDERED FOR/, "a worldwide screen names no territories");
  assert.doesNotMatch(assess({}), /ORDERED FOR/);

  // THE RECEIPTS GATE traces a citation to the ledger, and refuses one the ledger does not hold
  const cited = (url) => knockoutReceipts(dir, [{ name: "LANTERNWICK", findings: [{ name: "A character", url }] }]);
  assert.deepEqual(cited("https://wiki.example.test/lanternwick").failures, []);
  assert.equal(cited("https://elsewhere.example.test/lanternwick").ok, false);
});

// ── A provider outage is not retried here ────────────────────────────────────────────────────────────
//
// The provider call already retried a 429 or 5xx before it returned, so asking again at once buys the same
// answer. A program that did not run is the provider's model's own miss and gets its one more call (the
// retried mark in the run above); an outage gets none, and a batch where every mark met one is parked on
// the provider's clock rather than failed.
test("a grid call that met a provider outage is not asked again, and a batch of them parks rather than fails", async () => {
  const grids = [];
  const id = "ko-outage";
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", "2026-09-25-outage");
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-09-25", codename: "outage", archiveDir: join(studioRoot, "archive", "2026-09-25-outage") };
  const job = { id, markName: MARKS[0], marks: MARKS.map((name) => ({ name })), classes: [9], forwarder: "jordan", msgId: `<${id}@x>`, ref: "E2E-outage" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, searchPolicy: { level: "knockout", stageLabel: "Knockout", components: {} } };
  let res = null, thrown = null;
  try {
    res = await knockoutInner(ctx, job, {
      gridExecutor: async (spec, { mark }) => { grids.push(mark); return { ok: false, outage: true, status: 503, cause: "grid call threw: Perplexity API 503: unavailable" }; },
      sweepExecutor: async () => ({ ok: true, text: "unused" }),
    });
  } catch (e) { thrown = e; }
  assert.deepEqual(grids.sort(), [...MARKS].sort(), "one call a mark, and not one more");
  const rows = readFileSync(driverDir(dir, "knockout-sweep.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  assert.deepEqual(rows.map((r) => [r.attempts, r.ok]), MARKS.map(() => [1, false]));
  const log = readFileSync(driverDir(dir, "run.jsonl"), "utf8");
  assert.match(log, /"event":"knockout-sweep-outage"/, "the batch was not recognised as an outage");
  assert.equal(res, null, "an all-outage batch returned instead of parking");
  assert.equal(thrown?.reason, "rate_limited", `an all-outage batch should park on the provider's clock: ${thrown?.message}`);
});

test("the live grid call reads a 5xx as an outage and a 4xx as not one, after the provider call's own retries", async () => {
  const spec = knockoutGridSpec({ name: "LANTERNWICK", spellings: ["LANTERNWICK", "LANTERN WICK"] }, { places: ["web", "fandom.com"] },
    { outputPath: join(ROOT, "studio", "clearance-search", "runs", "x", "research", "lanternwick.md") });
  const real = globalThis.fetch;
  const answered = (status) => async () => ({ ok: false, status, text: async () => `status ${status}`, json: async () => ({}) });
  try {
    globalThis.fetch = answered(503);
    const down = await RESEARCH_PROVIDERS.perplexity.grid(spec, KNOCKOUT_WEB);
    assert.deepEqual([down.ok, down.outage, down.status], [false, true, 503]);
    assert.match(down.cause, /^grid call threw: Perplexity API 503/);
    globalThis.fetch = answered(400);
    const refused = await RESEARCH_PROVIDERS.perplexity.grid(spec, KNOCKOUT_WEB);
    assert.deepEqual([refused.ok, refused.outage, refused.status], [false, false, 400], "a request the provider refuses is not weather");
  } finally { globalThis.fetch = real; }
});
