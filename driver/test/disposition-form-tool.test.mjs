// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// REVIEW → B — THE TOOLS MUST NEVER DESTROY A RULING THE DRIVER ALREADY HOLDS,
// AND NOBODY WRITES A SEAT-FACING FORM ANY MORE.
//
// The -era defect this file was built for: `tellObligations` wrote an all-null form over the
// seat-facing copy on every grid-tool call, and a cold retry's seat re-earned 61 rulings. The form path
// is now DELETED (owner ruling 2026-08-17): rulings ride `record_dispositions`, the `_driver/`
// accumulator is the one copy, and the seat-facing file has no writer at all. So the property this file
// pins moved with the machinery:
//
//     AFTER ANY GRID-TOOL CALL, NO SEAT-FACING FORM APPEARS AND THE ACCUMULATOR IS UNTOUCHED;
//     AFTER ANY record_dispositions CALL, EVERY RULING THE ACCUMULATOR HELD STILL BINDS.
//
// It still spawns the REAL server over real MCP stdio, because that is the whole reason it exists: the
// unit tests read the modules as text or drive the pure cores, and the pipeline tests drive a mock —
// nothing else exercises the shipped server's own handlers end to end.
//
// NO NETWORK. Every grid case goes through `recordedLedgerFor` — a complete recorded ledger for the
// dictated spec — which returns before `callAgentAPI` exists in the call path, and record_dispositions
// never touches the network at all. `PERPLEXITY_API_KEY` is overridden with an obvious placeholder so
// the ambient environment cannot supply a real one and a regression that fell through to the paid path
// fails loudly on the assertion instead of billing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { parsePrRiskResults, connotationObligations, obligationRows } from "../connotation-search.mjs";
import { unionDispositionForm, formSidecarPath } from "../disposition-union.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// — TWO SERVERS NOW, and the file needs both because it drives both tools. `record_dispositions`
// moved to its own module and its own grant key (it rode `perplexity`, which four stages hold, and only
// the common-law lane's doctrine ever ordered it); the GRID path stayed where the API key is. These arms
// spawn the REAL modules over real stdio, so a single constant would have silently sent one tool to a
// server that no longer serves it — which is exactly how this read as "unknown tool" rather than as a
// wiring change.
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");
const DISPOSITIONS_SERVER = join(HERE, "..", "engine", "mcp", "dispositions-server.mjs");
// WHICH MODULE SERVES WHICH TOOL, and it is routed by TOOL NAME rather than passed in per call site on
// purpose: that is the same fact the grant table states (`mcp__dispositions__record_dispositions` vs
// `mcp__perplexity__perplexity_research`), so a future move shows up here as one edit and not as a
// hunt through the call sites.
const serverFor = (tool) => (tool === "record_dispositions" ? DISPOSITIONS_SERVER : SERVER);

// One JSON-RPC round trip against the real server, over its real stdio protocol.
async function callTool(args, env = {}, tool = "perplexity_research") {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverFor(tool)], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "placeholder-not-a-key", ...env } });
    const responses = {}; let buf = "", stderr = "";
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ responses, stderr }); };
    const timer = setTimeout(done, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) responses[m.id] = m; } catch { /* non-json */ }
      }
      if (responses[2]) { clearTimeout(timer); done(); }
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const textOf = (r) => r.responses[2]?.result?.content?.[0]?.text ?? "";

// ── THE FIXTURE ──────────────────────────────────────────────────────────────────────────────────────
//
// A COMPLETE recorded ledger for the dictated spec — every (term × platform) cell accounted and every
// dictated meaning query carrying a receipt — because `recordedLedgerFor` guards on COMPLETENESS, not on
// existence. Anything less and the tool runs the paid grid, which is the wrong path and the wrong test.
//
// The mark is coined and so are the receipts: this repo is de-identified, and a real mark or a real
// article lifted from an archive would put a client's matter into the product repo.
const TERMS = ["VANTROLIX", "VANTROLYX"];
const PLATFORMS = ["web", "itch.io"];
const QUERIES = ["VANTROLIX meaning slang", "VANTROLIX gang", "VANTROLIX offensive"];
const RECEIPT = (q, n) => ({ title: `What ${q} turns up, part ${n}`, url: `https://receipts.example/${n}`,
  snippet: "" });

function makeRun({ queries = QUERIES } = {}) {
  // The output_path must sit under a studio/prelim-search run dir — the server refuses anything else.
  const root = mkdtempSync(join(tmpdir(), "form-tool-"));
  const runDir = join(root, "studio", "prelim-search", "run-under-test");
  mkdirSync(driverDir(runDir), { recursive: true });
  const ledgerPath = join(runDir, "common-law-grid.half-b.json");
  const formPath = join(runDir, "common-law-dispositions.half-b.json");
  const specPath = driverDir(runDir, "grid-spec.half-b.json");
  const spec = {
    terms: TERMS, platforms: PLATFORMS, output_path: ledgerPath, half: "b",
    connotation: { queries, disposition_required: true, dispositions_path: formPath },
  };
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n");
  const ledger = {
    cells: TERMS.flatMap((term) => PLATFORMS.map((platform) => ({ term, platform, candidates: [] }))),
    gaps: [],
    extras: { pr_risk: queries.map((q, i) => ({ query: q, results: [RECEIPT(q, i + 1)] })) },
  };
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  const ob = connotationObligations(parsePrRiskResults(readFileSync(ledgerPath, "utf8")));
  return { root, runDir, specPath, formPath, ledgerPath, spec, ob,
    accumPath: formSidecarPath(formPath), rows: obligationRows(ob) };
}

const rule = (r, note = "ruled against the recorded receipt") =>
  ({ ...r, receipt_id: r.candidates[0].receipt_id, ruling: "benign", note });
const readRows = (p) => JSON.parse(readFileSync(p, "utf8")).rows;
const ruledIds = (rows) => rows.filter((r) => r.ruling).map((r) => r.row_id).sort();

// ── THE ALREADY-RECORDED SHORT-CIRCUIT — the path a cold retry takes ─────────────────────────────────

test("the already-recorded short-circuit writes NO seat-facing form and leaves the accumulator byte-identical", async () => {
  const r = makeRun();
  // The state a cold retry starts in: the accumulator holds every ruling from the prior attempt.
  const held = unionDispositionForm(null, r.rows.map((row) => rule(row)), r.ob,
    { half: "b", generatedFrom: "common-law-grid.half-b.json" });
  assert.equal(held.outstanding, 0, "the fixture must actually hold rulings, else this proves nothing");
  const json = JSON.stringify(held.form, null, 2) + "\n";
  writeFileSync(r.accumPath, json);

  const res = await callTool({ task: "grid", grid_spec_path: r.specPath });
  const text = textOf(res);
  assert.match(text, /Grid ALREADY RECORDED/,
    `the call must take the short-circuit — no paid grid, no network. Got: ${text.slice(0, 300)}`);
  assert.throws(() => readFileSync(r.formPath, "utf8"), /ENOENT/,
    "B: nothing writes the seat-facing file — a tool that recreated it would re-teach the dead path");
  assert.equal(readFileSync(r.accumPath, "utf8"), json,
    "the grid call is a READER of the dispositions state — the accumulator is the record_dispositions receiver's to write");
});

test("the obligations block orders the TOOL route — the seat is never told to open a file", async () => {
  const r = makeRun();
  const res = await callTool({ task: "grid", grid_spec_path: r.specPath });
  const text = textOf(res);
  assert.match(text, /record_dispositions/, "the recording route is named in-turn, where the obligations are");
  assert.match(text, /never write or edit any file/i);
  assert.doesNotMatch(text, /OPEN IT|Edit tool/i, "no residue of the form-fill order survives");
});

// ── THE TYPED CALL, OVER REAL STDIO — the receiver records, keeps, and answers ───────────────────────

const recordRows = (r, rows) => callTool({ grid_spec_path: r.specPath, rows }, {}, "record_dispositions");
// — the seat addresses a row by its POSITION in the driver's obligation list, so the index is
// what a caller passes; `rows` is still needed to know whether that row offers a receipt choice.
const seatRow = (rows, i, note = "ruled against the recorded receipt") =>
  ({ row_index: i + 1, ...(rows[i].candidates.length === 1 ? {} : { receipt_index: 1 }), ruling: "benign", note });

test("a typed call records into the accumulator through the real server, and the answer names the remainder", async () => {
  const r = makeRun();
  const res = await recordRows(r, [seatRow(r.rows, 0)]);
  const text = textOf(res);
  assert.match(text, /Recorded 1 row/i, `the receiver accepted the row. Got: ${text.slice(0, 300)}`);
  const after = readRows(r.accumPath);
  assert.deepEqual(ruledIds(after), [r.rows[0].row_id], "the ruling landed in the driver's own copy");
  assert.throws(() => readFileSync(r.formPath, "utf8"), /ENOENT/, "and in NO seat-facing file");
  assert.match(text, new RegExp(`${r.rows.length - 1} obligations? still outstanding`, "i"),
    "the answer counts what is left — the seat never has to guess whether it is finished");
});

test("a second call KEEPS the first call's rulings — the union preserves at the receiver", async () => {
  const r = makeRun();
  await recordRows(r, [seatRow(r.rows, 0)]);
  await recordRows(r, [seatRow(r.rows, 1, "the second call's own ruling")]);
  const after = readRows(r.accumPath);
  assert.deepEqual(ruledIds(after), [r.rows[0].row_id, r.rows[1].row_id].sort(),
    "both calls' rulings bind — a receiver that rebuilt from scratch would drop the first");
  assert.equal(after.find((x) => x.row_id === r.rows[1].row_id).note, "the second call's own ruling");
});

test("one bad row does not void its neighbours, and a foreign address is refused by name", async () => {
  const r = makeRun();
  const res = await recordRows(r, [seatRow(r.rows, 0), { row_index: 999, ruling: "benign", note: "n" }]);
  const text = textOf(res);
  assert.match(text, /Recorded 1 row/i, "the valid neighbour is kept");
  assert.match(text, /row 999/, "the refusal names the row the seat can act on — in the numbering it was given (#1173)");
  assert.deepEqual(ruledIds(readRows(r.accumPath)), [r.rows[0].row_id]);
});

// ── THE FUNNEL DOES NOT NARROW: a ledger that grew owes more rows, and loses none ────────────────────

test("a re-recorded ledger that owes MORE rows grows the remainder and keeps every prior ruling", async () => {
  const r = makeRun();
  await recordRows(r, r.rows.map((_, i) => seatRow(r.rows, i)));
  assert.equal(readRows(r.accumPath).filter((x) => !x.ruling).length, 0, "everything owed is ruled");
  // A top-up records a fourth meaning query, and the spec dictates it.
  const grown = [...QUERIES, "VANTROLIX urban dictionary"];
  const spec = JSON.parse(readFileSync(r.specPath, "utf8"));
  spec.connotation.queries = grown;
  writeFileSync(r.specPath, JSON.stringify(spec, null, 2) + "\n");
  const ledger = JSON.parse(readFileSync(r.ledgerPath, "utf8"));
  ledger.extras.pr_risk = grown.map((q, i) => ({ query: q, results: [RECEIPT(q, i + 1)] }));
  writeFileSync(r.ledgerPath, JSON.stringify(ledger, null, 2) + "\n");

  const res = await recordRows(r, []);   // an empty call: the answer re-derives what is owed NOW
  assert.match(textOf(res), /outstanding/i, "the grown obligation is reported to the seat in-turn");
  const after = readRows(r.accumPath);
  assert.equal(after.length, r.rows.length + 1, "the new obligation grew the row set");
  assert.equal(after.filter((x) => !x.ruling).length, 1, "exactly the new row is outstanding");
});

// ── A HALF THAT OWES NOTHING STILL GETS NO FILE ──────────────────────────────────────────────────────

test("a half owning no meaning queries gets no form and no accumulator — an empty file would be an alarming absence", async () => {
  const r = makeRun({ queries: [] });
  const res = await callTool({ task: "grid", grid_spec_path: r.specPath });
  assert.match(textOf(res), /Grid ALREADY RECORDED/);
  assert.throws(() => readFileSync(r.formPath, "utf8"), /ENOENT/, "no obligations ⇒ no file, exactly as before");
  assert.throws(() => readFileSync(r.accumPath, "utf8"), /ENOENT/);
});
