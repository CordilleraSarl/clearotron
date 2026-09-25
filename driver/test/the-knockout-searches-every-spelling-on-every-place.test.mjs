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
process.env.CLEAROTRON_AGENT = "clawdi";
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
const { knockoutReceipts, validators, placesDefect, spellingsDefect } = await import("../verify-knockout.mjs");
const { acceptKnockoutFrame, refuseUndeclared } = await import("../knockout-frame-record.mjs");
const { buildRequestBody, buildGridProgramTask, SANDBOX_INSTRUCTIONS } = await import("../../providers/perplexity/src/core.js");

// ── The plan's two lists, checked as the search program will read them ─────────────────────────────

const PLACES_SENTENCE = 'batch.places is required: 2 to 4 places, one of them "web" and each other a bare host';

test("the places are `web` and bare hosts in lower case, 2 to 4 of them, exactly one of them the web", () => {
  for (const ok of [["web", "fandom.com"], ["store.steampowered.com", "web", "fandom.com", "itch.io"]])
    assert.equal(placesDefect(ok), null, JSON.stringify(ok));
  for (const bad of [
    undefined, [], ["web"], ["web", "a.com", "b.com", "c.com", "d.com"],
    ["web", "web"], ["fandom.com", "itch.io"], ["Web", "fandom.com"], ["web", "Fandom.com"],
    ["web", "https://fandom.com"], ["web", "fandom.com/wiki"], ["web", " fandom.com"], ["web", "fandom"],
    ["web", "fandom.com", "fandom.com"], ["web", 7],
  ]) assert.equal(placesDefect(bad), PLACES_SENTENCE, JSON.stringify(bad));
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

test("the plan and the frame's tool refuse with the same sentence, and the tool declares both fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "knockout-web-plan-"));
  const batch = { productContext: "video games", inUseAs: "a character or a place in a game", places: ["web", "fandom.com"] };
  const mark = { ref: null, name: "LANTERNWICK", classes: [9], beltAndBraces: [], classesPlain: "game software (9)",
    contextFraming: "the flagship game", spellings: ["LANTERNWICK", "LANTERN WICK"], priorKnowledge: null, priority: 1 };
  const plan = (b, m) => JSON.stringify({ schema: 1, batch: b, marks: [m] });
  assert.equal(validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(batch, mark)).ok, true);
  const noPlaces = validators.knockoutPlan(join(dir, "knockout-plan.json"), plan({ ...batch, places: undefined }, mark));
  assert.equal(noPlaces.reason, PLACES_SENTENCE);
  const noSpellings = validators.knockoutPlan(join(dir, "knockout-plan.json"), plan(batch, { ...mark, spellings: undefined }));
  assert.match(noSpellings.reason, /^mark "LANTERNWICK": spellings is required/);

  const call = (b, m) => acceptKnockoutFrame({ scope_note: "One name, screened.", batch: b, marks: [m] });
  assert.equal(call(batch, mark).ok, true);
  assert.equal(call({ ...batch, places: ["web"] }, mark).reason, `knockoutframe_places: ${PLACES_SENTENCE}`);
  assert.match(call(batch, { ...mark, spellings: ["LANTERN WICK", "X"] }).reason, /^knockoutframe_spellings:LANTERNWICK — mark "LANTERNWICK": spellings is required/);
  assert.equal(refuseUndeclared({ batch, marks: [mark] }), null, "the tool declares both fields");
});

test("the spec is the plan's own lists, copied, with the knockout's results per cell", () => {
  const row = { name: "LANTERNWICK", spellings: ["LANTERNWICK", "LANTERN WICK"] };
  const batch = { places: ["web", "fandom.com"] };
  const spec = knockoutGridSpec(row, batch, { outputPath: "/r/research/lanternwick.md" });
  assert.deepEqual(spec, { terms: ["LANTERNWICK", "LANTERN WICK"], platforms: ["web", "fandom.com"],
    output_path: "/r/research/lanternwick.md", results_per_cell: 10 });
  spec.terms.push("X");
  assert.deepEqual(row.spellings, ["LANTERNWICK", "LANTERN WICK"], "a copy: the frozen plan is never written through the spec");
  assert.deepEqual(KNOCKOUT_WEB, { preset: "pro-search", reasoning: { effort: "low" }, resultsPerCell: 10 });
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
  const ctx = { run, job, agent: "clawdi", paths: { runDir: dir }, profile: {},
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
    assert.ok(b.input.includes(`PLATFORMS (${plan.batch.places.length}): ${JSON.stringify(plan.batch.places)}`), "the batch's places, verbatim");
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
  assert.deepEqual([lw.spellings, lw.places], [plan.marks.find((m) => m.name === "LANTERNWICK").spellings, plan.batch.places]);
  assert.equal(rows.find((r) => r.mark === "MOSSGLEN").attempts, 2);
  assert.ok(Number.isFinite(lw.took_ms) && lw.took_ms >= 0);

  // THE RATING STEP is handed each mark's ledger by path, and told what it is
  const K = koPaths(dir);
  const dispatch = KO_STAGES["knockout-assess"].message({ K, chunkNo: 0, chunkTotal: 1, probeNote: "",
    chunkMarks: MARKS.map((name) => ({ name })), framework: { title: "House triage", bands: [{ label: "High" }, { label: "Low" }] } });
  assert.match(dispatch, /Each mark's RAW research payload: the record of its web searches, every spelling on every place/);
  for (const m of MARKS) assert.ok(dispatch.includes(`- ${m}: ${K.research(kebab(m))}`), `${m}'s payload is not named`);

  // THE RECEIPTS GATE traces a citation to the ledger, and refuses one the ledger does not hold
  const cited = (url) => knockoutReceipts(dir, [{ name: "LANTERNWICK", findings: [{ name: "A character", url }] }]);
  assert.deepEqual(cited("https://wiki.example.test/lanternwick").failures, []);
  assert.equal(cited("https://elsewhere.example.test/lanternwick").ok, false);
});
