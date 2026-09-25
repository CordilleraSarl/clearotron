// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PROGRAM THAT PRINTS EACH GROUP IN ONE RUN IS READ WHOLE.
//
// A grid split into groups tells the program to print one group's ledger at a time. The search service's
// sandbox returns everything one execution printed as ONE stdout: its documentation gives one `results[]`
// entry per execution, and its own example prints ten lines into a single `stdout`. A program written as one
// loop over its groups therefore returns every group's object in one string, `{…}\n{…}\n…`, which is not one
// JSON value. On 2026-09-25 a test run's two 74-cell grids came back "sandbox stdout is not valid JSON
// (exit 0)" on every call. The program's output was not kept, so this is the shape that message fits, not
// one read off the wire.
//
// The earlier tests stood in one `results[]` entry per group: the shape the task asks for, never the shape a
// loop prints. Here a real Python program of that loop runs, with the search stood in by a local module whose
// hits allow iteration and attribute access only, as the service's do. Its stdout is wrapped in a
// sandbox_results item the way the documentation shows one, and the capture must read every group. The grid
// has that run's geometry with coined terms: 3 forms on 14 stores, then 32 spellings on the general web, 7 of
// them in non-Latin script, in groups of 6.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGridProgramTask, captureGridFromResponse, dictatedCells, ledgersPrinted } from "../../providers/perplexity/src/core.js";

// Coined forms and example stores: this repo is de-identified.
const FORMS = ["DRAVOLINE", "DRAVO LINE", "DRAVO-LINE"];
const LATIN = ["DRAVOLYNE", "DRAVOLEEN", "DRAVOLIN", "DRAVOLINA", "DRAVOLINES", "DRAV O LINE", "D.R.A.V.O.L.I.N.E.", "DRAVOL1NE",
  "DRAV0LINE", "DRAVVOLINE", "DRAVOLLINE", "DRAVOLINNE", "DRAVALINE", "DREVOLINE", "DRAVOLENE", "TRAVOLINE", "DRABOLINE", "DRAVOLAIN",
  "DRAVOLINEE", "DRAVO_LINE", "DRAVO.LINE", "DRA VOLINE"];
const NON_LATIN = ["ДРАВОЛИН", "ДРАВОЛАЙН", "ड्रावोलाइन", "ड्रावो लाइन", "டிராவோலைன்", "డ్రావోలైన్", "ドラヴォライン"];
const SPELLINGS = [...FORMS, ...LATIN, ...NON_LATIN];
const STORES = Array.from({ length: 14 }, (_, i) => `store-${String(i + 1).padStart(2, "0")}.example`);
const SPEC = {
  terms: SPELLINGS,
  platforms: [...STORES, "web"],
  grids: [{ terms: FORMS, platforms: STORES }, { terms: SPELLINGS, platforms: ["web"] }],
  output_path: "/x/studio/clearance-search/r/common-law-grid.half-a.json",
  batch: 6,
  ledger_required: true,
};

// The service's SDK, stood in. Some searches return hits and some none, decided by the query alone.
const SDK = `class _Hit:
    __slots__ = ("title", "url")
    def __init__(self, title, url):
        self.title, self.url = title, url

class _Hits:
    def __init__(self, hits):
        self._hits = hits
    def __iter__(self):
        return iter(self._hits)

class _Search:
    def web(self, query, limit=10, domains=None):
        site = domains[0] if domains else "web.example"
        return _Hits([_Hit(f"{query} listing {k}", f"https://{site}/item/{k}") for k in range(len(query) % 3)])

search = _Search()
`;

/** The program a model writes for the split task: ONE program, one loop over the groups, one print per group. */
function loopProgram(spec, { indent = 0, chatter = false } = {}) {
  return `import json
import pplx_sdk

GRIDS = ${JSON.stringify(spec.grids)}
BATCH = ${spec.batch}

def run_cell(term, platform):
    if platform == "web":
        hits = pplx_sdk.search.web(term, limit=10)
    else:
        hits = pplx_sdk.search.web(term, limit=10, domains=[platform])
    results = []
    for h in hits:
        if len(results) >= 8: break
        results.append({"title": h.title or "", "url": h.url or ""})
    return {"term": term, "platform": platform, "status": "hit" if results else "no_hit", "candidates": results}

total = 0
for n, grid in enumerate(GRIDS):
    for g in range(0, len(grid["terms"]), BATCH):
        cells, gaps = [], []
        for term in grid["terms"][g:g + BATCH]:
            for platform in grid["platforms"]:
                try:
                    cells.append(run_cell(term, platform))
                except Exception as e:
                    gaps.append(f"{term} | {platform} | {e!r}")
        total += len(cells)
${chatter ? "        print(f\"grid {n + 1}, group from term {g + 1}: {len(cells)} cells\")\n" : ""}\
        print(json.dumps({"cells": cells, "extras": {}, "gaps": gaps}${indent ? `, indent=${indent}` : ""}))
${chatter ? "print(json.dumps({\"groups_done\": True, \"cells\": total}))\n" : ""}`;
}

/** Run the program for real, beside the stand-in SDK. */
function run(code) {
  const dir = mkdtempSync(join(tmpdir(), "grid-program-"));
  try {
    writeFileSync(join(dir, "pplx_sdk.py"), SDK);
    writeFileSync(join(dir, "program.py"), code);
    const r = spawnSync("python3", [join(dir, "program.py")], { cwd: dir, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    assert.equal(r.error, undefined, "python3 is not on this machine, and this test runs the program for real");
    assert.equal(r.status, 0, r.stderr);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One execution, returned as the service documents a sandbox_results item. */
const answer = (code, { stdout, stderr, status }) => ({
  output: [
    { type: "sandbox_results", call_id: "call_1", code, container_id: "c1", language: "python", status: "completed",
      results: [{ duration_ms: 1, exit_code: status, status: "completed", stderr, stdout }] },
    { type: "message", content: [{ type: "output_text", text: "Done." }] },
  ],
});
const keys = (cells) => cells.map((c) => `${c.term}|${c.platform}`).sort();
const DICTATED = keys(dictatedCells(SPEC).map(([term, platform]) => ({ term, platform })));

test("the grid is split into groups, so the task asks for one group's object per print", () => {
  assert.equal(DICTATED.length, 74);
  assert.match(buildGridProgramTask(SPEC), /^Batch into groups of <= 6 terms and run each group as its own sandbox execution that prints only that group's JSON object/m);
});

test("one run that prints every group hands back one stdout holding them all, and every group is read", () => {
  const code = loopProgram(SPEC);
  const r = run(code);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout.trim().split("\n").length, 7, "one object per group: 1 group of forms on the stores, 6 of spellings on the web");
  assert.throws(() => JSON.parse(r.stdout), SyntaxError, "not one JSON value: the stdout the capture used to refuse whole");
  assert.equal(ledgersPrinted(r.stdout).length, 7);

  const cap = captureGridFromResponse(answer(code, r), SPEC);
  assert.equal(cap.ok, true, cap.error);
  assert.equal(`${cap.present}/${cap.requested}`, "74/74");
  assert.deepEqual(cap.missing, []);
  const ledger = JSON.parse(cap.ledgerJson);
  assert.deepEqual(keys(ledger.cells), DICTATED);
  assert.deepEqual(ledger.gaps, []);
  for (const t of NON_LATIN) assert.ok(ledger.cells.some((c) => c.term === t), `${t}: printed escaped, read back as dictated`);
  assert.equal(cap.candidates.length, ledger.cells.filter((c) => c.status === "hit").length);
  assert.ok(cap.candidates.length > 0 && cap.candidates.length < 74, "some cells hit and some did not");
});

test("indented objects, a line of text between groups and a closing tally are read the same way", () => {
  const code = loopProgram(SPEC, { indent: 2, chatter: true });
  const r = run(code);
  assert.match(r.stdout, /^grid 2, group from term 31: 2 cells$/m);
  const cap = captureGridFromResponse(answer(code, r), SPEC);
  assert.equal(cap.ok, true, cap.error);
  assert.equal(`${cap.present}/${cap.requested}`, "74/74");
  assert.deepEqual(keys(JSON.parse(cap.ledgerJson).cells), DICTATED, "the tally is not a group's ledger and adds nothing");
});

test("an output cut off inside its last group loses that group only: its cells are recorded gaps", () => {
  const code = loopProgram(SPEC);
  const r = run(code);
  const lines = r.stdout.trimEnd().split("\n");
  const cut = [...lines.slice(0, -1), lines.at(-1).slice(0, Math.floor(lines.at(-1).length / 2))].join("\n");
  const cap = captureGridFromResponse(answer(code, { ...r, stdout: cut }), SPEC);
  assert.equal(cap.ok, true, cap.error);
  assert.equal(`${cap.present}/${cap.requested}`, "72/74");
  assert.deepEqual(keys(cap.missing), keys(SPELLINGS.slice(30).map((term) => ({ term, platform: "web" }))));
  const ledger = JSON.parse(cap.ledgerJson);
  assert.deepEqual(keys(ledger.gaps), keys(cap.missing), "each lost cell is a recorded gap");
});

test("a run that printed no ledger still fails as not JSON", () => {
  const cap = captureGridFromResponse(answer("print('done')", { stdout: "done: 74 cells\n", stderr: "", status: 0 }), SPEC);
  assert.equal(cap.ok, false);
  assert.equal(cap.error, "sandbox stdout is not valid JSON (exit 0)");
});
