// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// B — DO THE FOUR TRANSPORT TOKENS ACTUALLY FIRE? Presence is not firing.
//
// The other B suites test the audit as a function and the tool as a writer. Neither proves the live gate
// emits anything: a token can be declared, vocabulary-rowed, ledger-visible, warm-eligible and reachable
// in a unit test while no real path ever produces it. That is the guard-that-cannot-fire shape, and this
// codebase has an audit full of them — a correct classifier behind a severed seam, with its positive
// control injected downstream of the seam so it passes forever.
//
// So this drives `validators.commonLaw` — the gate itself — and reads the token off its verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { validators } from "../verify.mjs";
import { obligationRows, connotationObligations, parsePrRiskResults } from "../connotation-search.mjs";

const FINDINGS = [
  "# Common-law findings — Mark: DAVENA",
  "## Findings — Mark: DAVENA",
  "| Finding | Source | URL | Notes |", "|---|---|---|---|", "| (none risk-relevant) | - | - | - |",
  "### Negative results (per-platform per-variant)",
  "| Variant | Platform | Result |", "| DAVENA | web | No results |",
  "### Coverage ledger", "| dictated grid | confirmed-clean | searched |",
  "### Audit trail", "| 1 | Grid | DAVENA × web | 1 cell |",
  "### PR / reputational risk",
  "Search queries executed: DAVENA gang",
  "| (None identified) | — | Clean — no gang / offensive associations |",
  "**Connotation-search source:** perplexity_research (queries above)",
].join("\n");

/** The fixture the driver itself would leave: grid ledger, spec, and an untouched accumulator. */
function run() {
  const dir = mkdtempSync(join(tmpdir(), "cl-call-firing-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const dispositionsPath = join(dir, "common-law-dispositions.json");
  writeFileSync(driverDir(dir, "grid-spec.json"), JSON.stringify({
    terms: ["DAVENA"], platforms: ["web"], output_path: "/studio/prelim-search/x/y/common-law-grid.json",
    // B — no arming flag: the typed call is the ONLY transport (delete-not-gate, owner ruling
    // 2026-08-17), so the audit runs wherever rows are owed. What keeps archived form-era runs safe is
    // not a flag but arithmetic: a DELIVERED run owes nothing, so the audit never runs on it.
    connotation: { queries: ["DAVENA gang"], disposition_required: true, dispositions_path: dispositionsPath },
  }));
  writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify({
    cells: [{ term: "DAVENA", platform: "web", status: "no_hit", candidates: [] }],
    extras: { pr_risk: [{ query: "DAVENA gang", results: [{ title: "DAVENA collective — profile of the street crew", url: "https://news.example/davena-crew" }] }] },
    gaps: [],
  }));
  const rows = obligationRows(connotationObligations(parsePrRiskResults(
    JSON.stringify({ extras: { pr_risk: [{ query: "DAVENA gang", results: [{ title: "DAVENA collective — profile of the street crew", url: "https://news.example/davena-crew" }] }] } }))));
  const j = JSON.stringify({ rows });
  writeFileSync(driverDir(dir, "common-law-dispositions.form.json"), j);
  return { dir, findingsPath: join(dir, "common-law-findings.md"), rows };
}

const verdict = (r) => validators.commonLaw(r.findingsPath, FINDINGS);

// ── IT FIRES ────────────────────────────────────────────────────────────────────────────────────────

test("FIRES: an armed turn with no call at all emits connotation_call_never_made from the real gate", () => {
  const r = run();
  // THE LOG EXISTS AND HOLDS SOMEBODY ELSE'S CALL, which is what a real armed turn looks like: the grid
  // tool ran, so stdio-server created the log, and `record_dispositions` is simply absent from it. That
  // distinction is the whole of `never_made` — a readable log with no call of ours is evidence; an ABSENT
  // log is not, and the audit answers `call_partial` there rather than accusing a seat on a file it could
  // not open. The first version of this fixture omitted the log and proved the second thing by accident.
  writeFileSync(driverDir(r.dir, "tool-calls.jsonl"),
    JSON.stringify({ event: "started", seq: 1, server: "perplexity", tool: "perplexity_research" }) + "\n" +
    JSON.stringify({ event: "settled", seq: 1, server: "perplexity", tool: "perplexity_research", ok: true }) + "\n");
  const v = verdict(r);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^connotation_call_never_made:call_never_made=1;/,
    "the token must come off the gate, with its census front-loaded — repairs.mjs sums exactly that");
  assert.equal(v.quantity, 1, "the validator's own integer rides alongside and wins over the text parse");
  assert.match(v.reason, /never called/);
});

test("FIRES: a started-and-never-settled call emits connotation_call_truncated", () => {
  // The evidence is the ABSENCE of the second line, read off the log stdio-server has written since.
  const r = run();
  writeFileSync(driverDir(r.dir, "tool-calls.jsonl"),
    JSON.stringify({ event: "started", seq: 1, server: "perplexity", tool: "record_dispositions" }) + "\n");
  mkdirSync(driverDir(r.dir, "disposition-calls"), { recursive: true });
  writeFileSync(driverDir(r.dir, "disposition-calls", "index.jsonl"),
    JSON.stringify({ seq: 1, payload: "call-001.json", rowCount: 1 }) + "\n");
  const v = verdict(r);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^connotation_call_truncated:call_truncated=1;/);
  assert.match(v.reason, /call_truncated=1;NOT a fault in your rulings/,
    "a killed call must not send the seat to re-derive work that was already correct");
});

// ── THE VOID CONTROL, AND IT IS WHAT MAKES THE TWO ABOVE EVIDENCE ──────────────────────────────────

test("VOID CONTROL: a spec with NO dictated dispositions path emits no call token", () => {
  // The audit's gate is the dictated path, not a per-run flag. A pre- archived spec dictates no
  // dispositions_path, so the audit has no records to read and must stay silent — a `call_never_made`
  // there would be a confident accusation about calls a run was never asked to make.
  const r = run();
  const spec = JSON.parse(readFileSync(driverDir(r.dir, "grid-spec.json"), "utf8"));
  delete spec.connotation.dispositions_path;
  writeFileSync(driverDir(r.dir, "grid-spec.json"), JSON.stringify(spec));
  const v = verdict(r);
  assert.doesNotMatch(String(v.reason ?? ""), /call_/,
    "no transport token may reach a run that dictated no dispositions path");
});

test("VOID CONTROL: a RULED accumulator passes — the audit adds a failure, it does not invent one", () => {
  // The additive constraint, asserted rather than described. A turn that did the work must pass, or the
  // audit is a new way to fail correct work.
  const r = run();
  const ruled = r.rows.map((x) => ({ ...x, receipt_id: x.candidates[0].receipt_id, ruling: "loaded", note: "street-crew profile; carried to Findings" }));
  writeFileSync(driverDir(r.dir, "common-law-dispositions.form.json"), JSON.stringify({ rows: ruled }));
  assert.equal(verdict(r).ok, true);
});

test("VOID CONTROL: the fixture really does owe an obligation", () => {
  // Every assertion above rests on there being something outstanding. With an empty obligation set the
  // audit is never asked and all four tests would pass by finding nothing to report.
  assert.equal(run().rows.length, 1, "the fixture must produce exactly one owed row");
});
