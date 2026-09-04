// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the knockout lane end to end through the real runner
// runner.knockout-e2e.test.mjs — the KNOCKOUT lane end to end through the REAL runner at $0:
// queue file → claim → admission gate → dispatch → mock frame → FIXTURE sweep (receipted) → mock assess
// → publish (report/workbook/meta) → delivery handoff (packet + outbox + .delivered + archive).
// This is the walkthrough the dev cockpit drives — proven hermetically here.
//
// SAFETY GUARD (2026-07-14 convention): driver.config freezes workspaceRoot AND poolRoot at import —
// every env var below is set BEFORE the dynamic runner import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { variantForms } from "../register-variants.mjs";
import { kebab } from "../search-policy.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const root = mkdtempSync(join(tmpdir(), "prelim-ko-e2e-"));
const FIXTURES = join(root, "sweep-fixtures");
mkdirSync(FIXTURES, { recursive: true });
// canned research payloads (the $0 sweep): IRONWHISK carries a citable URL; CLUVENDRA is clean;
// SUNDAY ROAST CLUB has NO fixture file → the sweep degrades that mark (null-results doctrine).
writeFileSync(join(FIXTURES, "ironwhisk.md"), "Research: an active seller at https://www.amazon.com/ironwhisk-store sells mixers. No famous marks.\n");
writeFileSync(join(FIXTURES, "cluvendra.md"), "No major common law blockers identified for CLUVENDRA.\n");
// canned REGISTER COUNTS (the $0 Depth 2): IRONWHISK is a busy name, CLUVENDRA is empty, and
// CLUVENDRA's breadth figure is deliberately absent — a count that could not be taken must render as
// "not available" everywhere, never as a 0.
const COUNT_FIXTURES = join(root, "count-fixtures");
mkdirSync(COUNT_FIXTURES, { recursive: true });
writeFileSync(join(COUNT_FIXTURES, "ironwhisk.json"), JSON.stringify({ identical: 3, containing: 41 }));
writeFileSync(join(COUNT_FIXTURES, "cluvendra.json"), JSON.stringify({ identical: 0, containing: null }));
// — the close-variation column is N exact probes over generated forms, so the $0 fixture path
// needs a file per FORM. Written from the generator rather than typed out: a rule-table edit must move
// this fixture set, and a hand-typed list would silently start testing a subset of what runs.
// IRONWHISK's forms all answer (2 each ⇒ a real aggregate); CLUVENDRA's are deliberately left absent,
// so the run also exercises the honest degradation — a form with no answer nulls the whole column.
for (const f of variantForms("IRONWHISK").forms)
  writeFileSync(join(COUNT_FIXTURES, `${kebab(f.form)}.json`), JSON.stringify({ identical: 2, containing: 0 }));

for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
  CLEAROTRON_KNOCKOUT_MODE: "1", CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES: FIXTURES,
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  CORSEARCH_SESSION_KEY: "test-offline",
})) pinEnv(process.env, k, v);

const { main } = await import("../runner.mjs");
const Q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
mkdirSync(Q, { recursive: true });
const OUTBOX = join(root, "prelim-outbox");

// every run dir under a tree (delivered runs move to the archive subtree)
const findRuns = (base) => {
  const hits = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (existsSync(driverDir(d, "search-policy.json"))) { hits.push(d); return; }
    for (const e of es) if (e.isDirectory()) walk(join(d, e.name), depth + 1);
  };
  walk(base, 0); return hits;
};

// THIS FILE ONLY RUNS UNDER THE SUITE RUNNER, AND NOW SAYS SO INSTEAD OF FAILING LIKE A PRODUCT DEFECT.
//
// The driver refuses to guess a register provider: `CLEAROTRON_DATABASE` has no default, deliberately,
// and it throws by name rather than falling back. `scripts/test-run.mjs` supplies `corsearch` for the
// suite — with its reasoning written out at its own provider block — so CI, which runs through it, has
// one, and a bare `node --test driver/test/runner.knockout-e2e.test.mjs` does not.
//
// Without this check the arms below fail as `run FAILED at stage knockout`, which is the SHAPE of a
// product defect: the runner claims the job, the stage refuses, `_driver/` carries no stage artifacts at
// all, and the reason sits four levels down in `run.jsonl`. Measured on a clean checkout of main with
// its own dependencies on an idle box — it reproduced, and it was not main. The cost was a reproduction
// and an hour of suspicion that the tree was red.
//
// CHECKED, NOT PINNED. Pinning the variable here would make the file quietly agree with whatever the
// runner already decided and would remove the signal that it is being invoked the wrong way.
//
// NOT APPLIED TO THE THIRD ARM. An UNBUILT knockout is refused before the register is reached, so that
// one genuinely needs no provider and passes bare. The precondition belongs where the requirement is,
// not wherever the file is.
const requireRegisterProvider = () => {
  assert.ok(process.env.CLEAROTRON_DATABASE,
    "PRECONDITION NOT MET — CLEAROTRON_DATABASE is not set, so the knockout stage refuses before it "
    + "dispatches and this arm looks like a product failure. The driver has no default, by design. Run "
    + "this file the supported way — `npm run test:full -w driver`, or `node scripts/test-run.mjs node "
    + "--test <this file>`, which supplies corsearch for the suite — or set CLEAROTRON_DATABASE "
    + "yourself. Nothing is wrong with the tree.");
};

test("a 3-mark knockout batch runs end to end: receipts, degrade, publish stamps, delivery packet, archive", async () => {
  requireRegisterProvider();
  writeFileSync(join(Q, "ko-batch.json"), JSON.stringify({
    id: "ko-batch", msgId: "<ko-batch@x>", forwarder: "jordan", forwarderDomain: "example.com",
    product: "knockout-search", ref: "TMP9100",
    markName: "IRONWHISK",
    marks: [{ name: "IRONWHISK", classes: [8, 21] }, { name: "CLUVENDRA", classes: [8] }, { name: "SUNDAY ROAST CLUB", classes: [21, 35] }],
    classes: [8, 21, 35], goods: "kitchen tools; household utensils",
    // — THE JOB SAYS IT READS FIXTURES, and this is the arm that proves the whole
    // route: a field on a queued manifest reaching the counts lane through the runner, the pipeline and
    // the executor chain. It was `CLEAROTRON_KNOCKOUT_COUNT_FIXTURES` pinned into this process's environment,
    // which meant the one end-to-end test of the fixture path exercised a door no job could open.
    registerFixtures: { counts: COUNT_FIXTURES },
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.knockout-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "ko-batch.done")), "queue entry consumed as .done");

  const runDirs = findRuns(join(root, "workspace-clawdi", "studio", "prelim-search"));
  assert.equal(runDirs.length, 1);
  const rd = runDirs[0];
  assert.ok(rd.includes("/archive/"), "the delivered run was archived");
  assert.ok(existsSync(join(rd, ".delivered")), ".delivered sentinel");

  // frozen identity + framework: knockout level, house-triage fallback ladder
  const sp = JSON.parse(readFileSync(driverDir(rd, "search-policy.json"), "utf8"));
  assert.equal(sp.level, "knockout-search");
  assert.equal(sp.pipeline, "knockout");
  const fw = JSON.parse(readFileSync(driverDir(rd, "framework.json"), "utf8"));
  assert.equal(fw.framework_key, "house-triage", "unconfigured customers get the triage ladder, not the clearance house default");

  // sweep receipts: one row per mark; the fixture-less mark is degraded, batch still delivered
  const receipts = readFileSync(driverDir(rd, "knockout-sweep.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(receipts.length, 3, "every research call is receipted");
  const degraded = receipts.filter((r) => !r.ok);
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].mark, "SUNDAY ROAST CLUB");
  assert.ok(existsSync(join(rd, "research", "ironwhisk.md")), "payloads held in the run dir");

  // merged findings: one row per planned mark; the degraded row carries the doctrine note
  const findings = JSON.parse(readFileSync(join(rd, "knockout-findings.json"), "utf8"));
  assert.equal(findings.marks.length, 3);
  const degRow = findings.marks.find((m) => m.name === "SUNDAY ROAST CLUB");
  assert.ok(degRow.degraded, "the fixture-less mark is rated degraded, never silently clean");

  // pool publish: meta batch stamps + report + workbook + client export
  const pool = join(root, "pool");
  const poolRun = readdirSync(pool, { withFileTypes: true }).find((d) => d.isDirectory() && existsSync(join(pool, d.name, "meta.json")));
  assert.ok(poolRun, "published to the pool");
  const meta = JSON.parse(readFileSync(join(pool, poolRun.name, "meta.json"), "utf8"));
  assert.equal(meta.kind, "knockout-batch");
  assert.equal(meta.searchLevel, "knockout-search",
    "meta.json keeps its own key name on disk — an archived run's record is not this build's to rewrite");
  assert.equal(meta.marks.length, 3);
  assert.match(meta.statement, /^Knockout screen — 3 marks:/);
  assert.ok(meta.overall && meta.badge, "index-compatible overall/badge stamps");
  assert.equal(meta.template, "knockout");
  assert.equal(meta.stageLabel, "Knockout search", "the product's own name is stamped, not re-derived downstream");
  assert.equal(meta.reportSchema, "report-data/1", "the run publishes machine-readable data beside the document");
  // — the TYPED finding, end to end: emitted by the stage, validated by the chunk gate and again
  // on the merged artifact, receipted against the payload on disk, and RENDERED. The old shape reached
  // the page through a `f.url` filter that a typed record fails, so a mark with conflicts published as a
  // clean mark; this walks the whole path rather than asserting the renderer in isolation.
  const ironwhisk = findings.marks.find((m) => m.name === "IRONWHISK");
  assert.equal(ironwhisk.findings.length, 1, "the mark whose payload carries a URL rates one typed conflict");
  const typed = ironwhisk.findings[0];
  assert.deepEqual(Object.keys(typed).sort(), ["band", "basis", "evidence", "name", "net", "ordinal", "owner", "type"]);
  assert.equal(typed.evidence[0], "https://www.amazon.com/ironwhisk-store", "cited from the payload the driver held");
  assert.deepEqual(findings.marks.find((m) => m.name === "SUNDAY ROAST CLUB").findings, [],
    "a degraded mark cites nothing — it has no payload to cite from");

  // ── — THREE NAMES IN, THREE REPORTS OUT ───────────────────────────────────────────────────────
  //
  // The whole point of the issue, walked end to end on a real 3-mark run rather than asserted on the
  // publisher in isolation. `meta.reports` is the list; the filenames are NOT recomposed here, because a
  // test that spells the naming rule a second time passes when both copies are wrong together.
  assert.equal(meta.reports.length, 3, "three names ordered, three documents published");
  assert.deepEqual(meta.reports.map((r) => r.mark).sort(), meta.marks.map((m) => m.name ?? m).sort(),
    "one report per NAME — the set of documents is the set of marks, not a count that happens to match");
  assert.equal(new Set(meta.reports.map((r) => r.file)).size, 3, "three distinct files — no mark overwrites another");
  assert.equal(existsSync(join(pool, poolRun.name, "report.html")), false,
    "a batch publishes NO single document: one report.html for three names is the defect #472 exists to end");
  for (const r of meta.reports) assert.ok(existsSync(join(pool, poolRun.name, r.file)), `${r.mark}'s report is on disk`);

  // EACH ONE STANDS ALONE: its own name in the hero, and no other mark anywhere in the document.
  for (const r of meta.reports) {
    const doc = readFileSync(join(pool, poolRun.name, r.file), "utf8");
    assert.match(doc, /^<!DOCTYPE html>/, "a real document, charset and all — not a bare Word table");
    assert.match(doc, /Knockout search/, "the report states which search ran, by its own name");
    assert.match(doc, new RegExp(`<h1 class="mark">${r.mark}</h1>`), `${r.mark}'s document is titled ${r.mark}`);
    for (const other of meta.reports.filter((x) => x.mark !== r.mark))
      assert.ok(!doc.includes(other.mark), `${r.mark}'s report carries no trace of ${other.mark} — no batch residue`);
    const data = JSON.parse(readFileSync(join(pool, poolRun.name, r.dataFile), "utf8"));
    assert.deepEqual(data.marks.map((m) => m.name), [r.mark], "and its data file is that one mark's");
  }

  const report = readFileSync(join(pool, poolRun.name, meta.reports.find((r) => r.mark === "IRONWHISK").file), "utf8");
  // part 5 said the masthead states both halves — the filings behind the NARROW counts are listed,
  // and they are still not weighed — and called the second clause the one that matters.
  //
  // MAKES THAT SECOND CLAUSE FALSE. The rater is handed the run's fetched records and
  // weighs them, so a masthead saying they are not tells this report's reader the opposite of what the
  // pages below it do. Asserted here on a REAL DELIVERED REPORT rather than on a rendered fixture, which
  // is why this arm is worth keeping: it is the copy a client opens.
  assert.match(report, /takes register hit-counts/i,
    "one Knockout search: the masthead still says the product takes the filing counts");
  // "READS", NOT "WEIGHS" (owner,) — same clause, same requirement, the word he uses.
  assert.match(report, /reads the filings it retrieves/i,
    "…and says, in the same line, what it does with them — which it now does");
  assert.doesNotMatch(report, /not weighed or analysed in this search/i,
    "the retired denial reached a delivered report");
  assert.ok(report.includes("IRONWHISK #1"), "the drill-through key is on the page beside the conflict");
  assert.ok(report.includes(typed.net), "the conclusion sentence is the lead prose");
  assert.ok(report.includes(typed.basis), "the ground under the band is there too");
  assert.ok(report.includes(`href="${typed.evidence[0]}"`), "and the card opens to its evidence");
  const reportData = JSON.parse(readFileSync(join(pool, poolRun.name, meta.reports.find((r) => r.mark === "IRONWHISK").dataFile), "utf8"));
  assert.equal(reportData.marks.find((m) => m.name === "IRONWHISK").findings[0].ref, "IRONWHISK #1",
    "one drill-through key: the report, the data file and the workbook all print the same string");
  assert.ok(existsSync(join(pool, poolRun.name, meta.auditFile)), "the workbook shipped");
  assert.equal(existsSync(join(pool, poolRun.name, "report-data.json")), false,
    "…and no batch data file either — the data files fan out with the documents they describe");
  // ONE report. The client twin is gone: two renderings of one run is how the wrong link gets sent.
  assert.ok(!existsSync(join(pool, poolRun.name, "report.client.html")), "no client twin is published");
  assert.ok(existsSync(join(pool, "index.html")), "regenIndex rebuilt the pool index with the batch row");

  // delivery handoff: the packet + outbox marker, email-free courier contract
  const packet = JSON.parse(readFileSync(driverDir(rd, "delivery.json"), "utf8"));
  assert.match(packet.subject, /^Knockout trademark review — TMP9100 \(3 marks\)$/);
  assert.ok(packet.emailBodyHtml.length > 100);
  assert.equal(packet.forwarder, "jordan");
  assert.ok(existsSync(join(OUTBOX, `${packet.runId}.pending`)), "outbox wake marker");
  const status = JSON.parse(readFileSync(join(rd, "status.json"), "utf8"));
  assert.equal(status.state, "delivered");
  assert.equal(status.lane, "knockout");
  // ONE SPELLING ACROSS THE CROSSING (mark-name.mjs). This line pinned "IRONWHISK (+2 marks)" while the
  // publisher wrote "IRONWHISK +2 more" into the meta.json six lines below, and the browser threads reads
  // on that string — so the batch's live face and its own delivered face listed as two different marks.
  assert.equal(status.markName, "IRONWHISK +2 more");
  assert.equal(status.markName, meta.markName,
    "the live face and the delivered face are ONE name — the reads thread is grouped on this string");
  // AND THE NAMES ARE COUNTABLE while the run is live. status.json carried a mark string and nothing
  // countable, so the portal's live row sent an empty array and the Result screen — which reads that
  // array's length as a name count — told the customer a three-name batch had "0 names".
  assert.deepEqual(status.marks.map((m) => m.name), ["IRONWHISK", "CLUVENDRA", "SUNDAY ROAST CLUB"]);

  // ── — the knockout lane's stages are readable, on a REAL delivered run ──────────────────────
  //
  // The issue's own evidence was an event census of a delivered R0 probe with no `stage` row and no
  // `skip` row at all — four per-stage attempt logs on disk beside a journal that never said a stage
  // finished. gave every clearance-spine completion row its wall boundaries and could not reach
  // this lane, because there was no row to put them on. Asserted here rather than in a unit test for
  // the reason the issue states: this was confirmed on a delivered run, not from a code read.
  const journal = readFileSync(driverDir(rd, "run.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const stageRows = journal.filter((e) => e.event === "stage" || e.event === "skip");
  // The lane has exactly TWO stages that go through koStage — knockout-frame and knockout-assess#N.
  // The sweep and the register count are code-side and receipt themselves (`knockout-sweep-start`,
  // `knockout-register-counts`); they are not LLM stages and must not grow a stage row, or the lane
  // would report walls for work no dispatch did. Naming them here so a future reader does not read
  // "2" as partial coverage.
  assert.deepEqual(stageRows.map((e) => e.stage).sort(), ["knockout-assess#0", "knockout-frame"],
    `the knockout lane must emit one completion row per DISPATCHED stage (event census: ${
      [...new Set(journal.map((e) => e.event))].sort().join(", ")})`);

  for (const row of stageRows) {
    assert.equal(row.lane, "knockout", `${row.stage} names its lane`);
    // The schema, field for field. A row without these is the row this lane already had.
    assert.ok(typeof row.dispatchedAt === "string" && row.dispatchedAt.startsWith("20"), `${row.stage} dispatchedAt`);
    assert.ok(typeof row.settledAt === "string" && row.settledAt.startsWith("20"), `${row.stage} settledAt`);
    assert.equal(typeof row.wallSec, "number", `${row.stage} wallSec`);
    assert.ok(row.wallSec >= 0, `${row.stage} wallSec is not negative`);
    assert.ok(typeof row.stage === "string" && row.stage.length, "every row names its stage");
    assert.ok("model" in row, `${row.stage} names the model it dispatched`);
    // THE BOUNDARY MUST ENCLOSE THE WORK, and this is the assertion that makes it mean something.
    // 's own comment: capture tDispatch after the await instead and "every field is still present,
    // every presence assertion still passes, and every interval is ~0ms — the journal would then assert
    // that a 14-minute half took nothing". A `wallSec >= 0` check passes cheerfully on that. So assert
    // ORDER against the stage's own attempt rows, which is independent of how fast the mock is: every
    // attempt this stage made has to fall inside [dispatchedAt, settledAt].
    if (row.event === "stage") {
      const attempts = journal.filter((e) => e.event === "attempt" && e.stage === row.stage);
      assert.ok(attempts.length >= 1, `${row.stage} has attempt rows to enclose`);
      for (const a of attempts) {
        assert.ok(Date.parse(a.ts) >= Date.parse(row.dispatchedAt),
          `${row.stage}: an attempt at ${a.ts} predates the stage's dispatchedAt ${row.dispatchedAt} — the `
          + `boundary was captured AFTER the work, so this stage's wall reads as ~0 whatever it cost`);
        assert.ok(Date.parse(a.ts) <= Date.parse(row.settledAt), `${row.stage}: an attempt postdates settledAt`);
      }
    }
  }

  // The assess wave is chunked (`knockout-assess#N`), and a wave whose members' walls cannot be
  // compared is exactly what fixed on the gather side. One member is enough to prove the
  // boundaries are per stage; the intersection assertion below needs two and says so when it cannot run.
  const assess = stageRows.filter((e) => /^knockout-assess/.test(e.stage));
  assert.ok(assess.length >= 1, "the assess wave emits at least one member row");
  if (assess.length >= 2) {
    const [x, y] = assess.slice(0, 2).map((e) => [Date.parse(e.dispatchedAt), Date.parse(e.settledAt)]);
    assert.ok(x[0] < y[1] && y[0] < x[1],
      "two members of one knockout wave must have INTERSECTING [dispatchedAt, settledAt] — that is what "
      + "makes a wave readable as a wave rather than as a sum");
  }
  // A single-chunk run cannot prove intersection, and saying so beats asserting nothing: the property
  // is proven by construction (each member captures its own tDispatch before its own work) and by the
  // per-row boundaries above.
});

// This asserted that a knockout job parked as clarify with CLEAROTRON_KNOCKOUT_MODE unset. The switch was
// retired 2026-07-27 (it gated shipped machinery, and any process without an engine environment read it as
// OFF — which is how the ops-MCP came to tell clients three built depths were "not switched on"). What is
// left of the property is asserted at the GATE rather than through the runner: a job that ADMITS runs the
// whole mock pipeline and publishes, which would break this file's own end-to-end run counts.
//
// "No silent run" itself is unchanged and still enforced — by BUILT, the axis that survives.
test("no silent substitution: an UNBUILT knockout is refused, a built one is admitted", async () => {
  const { gateResolvedPolicy, resolveSearchPolicy, BUILT } = await import("../search-policy.mjs");
  const ko = resolveSearchPolicy({ product: "knockout-search" }, {});
  assert.match(gateResolvedPolicy(ko, { built: { ...BUILT, knockout: false } }), /not available in this build/,
    "a build without the knockout pipeline refuses it rather than running something cheaper");
  delete process.env.CLEAROTRON_KNOCKOUT_MODE;
  assert.equal(gateResolvedPolicy(ko), null, "…and on this build it is admitted, with no switch to set");
});

test("STAGE 0.5 end to end: counts measured in code, on the report, in the workbook, never a fabricated zero", async () => {
  requireRegisterProvider();
  writeFileSync(join(Q, "ko-reg.json"), JSON.stringify({
    id: "ko-reg", msgId: "<ko-reg@x>", forwarder: "jordan", forwarderDomain: "example.com",
    product: "knockout-search", ref: "TMP9101", markName: "IRONWHISK",
    marks: [{ name: "IRONWHISK", classes: [8, 21] }, { name: "CLUVENDRA" }],
    classes: [8], jurisdictions: ["US"], goods: "kitchen tools",
    // EACH JOB DECLARES ITS OWN. Both manifests in this file used to inherit one
    // exported variable, so a reader could not tell from either of them that it ran on fixtures — and
    // deleting the export silently sent this one at a live register. That invisibility is the whole
    // reason the declaration moved onto the job.
    registerFixtures: { counts: COUNT_FIXTURES },
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.knockout-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "ko-reg.done")), "Depth 2 is admitted and runs — no clarify");

  // SCOPED TO THIS RUN'S OWN MARK. Every Knockout search carries the count probe now — there is one
  // knockout product and the counts are in it — so "the run that wrote a counts sidecar" no longer
  // identifies one run in this file.
  const rd = findRuns(join(root, "workspace-clawdi", "studio", "prelim-search"))
    .find((d) => {
      const f = driverDir(d, "register-counts.json");
      if (!existsSync(f)) return false;
      // BOTH knockout runs in this file carry a counts sidecar now (one product, counts included) and
      // both name IRONWHISK, so the discriminator is this batch's own second mark.
      return JSON.parse(readFileSync(f, "utf8")).marks.length === 2;
    });
  assert.ok(rd, "the run wrote the count sidecar");
  const sp = JSON.parse(readFileSync(driverDir(rd, "search-policy.json"), "utf8"));
  assert.equal(sp.level, "knockout-search");
  assert.equal(sp.components.registerProbe, true);

  // ── the sidecar: code-measured, code-written, one row per mark ───────────────────────────────────
  const counts = JSON.parse(readFileSync(driverDir(rd, "register-counts.json"), "utf8"));
  assert.equal(counts.schema, 1);
  assert.equal(counts.marks.length, 2, "one row per name in THIS batch");
  const iron = counts.marks.find((m) => m.name === "IRONWHISK");
  assert.deepEqual(iron.counts.identical, { total: 3 });
  assert.deepEqual(iron.counts.containing, { total: 41 });
  assert.deepEqual(iron.classes, [8, 21], "the mark's own classes beat the batch's");
  assert.equal(iron.classScope, "mark");
  const cluv = counts.marks.find((m) => m.name === "CLUVENDRA");
  assert.equal(cluv.counts.identical.total, 0, "a counted zero IS a zero");
  assert.equal(cluv.counts.containing.total, null, "…but an untaken count is null, never 0");
  assert.ok(cluv.counts.containing.unavailable, "and carries its reason");
  assert.deepEqual(cluv.classes, [8], "falling back to the batch classes");
  // A US order carries the international register that binds it — the counts lane asks the same
  // scope the search does, so a figure taken over two registers is recorded as taken over two.
  assert.deepEqual(counts.scope.regions, ["US", "WO"]);

  // receipts: one row per mark per predicate — the cost of this product, on the record
  const ledger = readFileSync(driverDir(rd, "register-count.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const ironForms = variantForms("IRONWHISK").forms.map((f) => f.form);
  const cluvForms = variantForms("CLUVENDRA").forms.map((f) => f.form);
  const countRows = ledger.filter((r) => r.stage !== "records");
  assert.equal(countRows.length, 2 * 2 + ironForms.length + cluvForms.length,
    "2 marks × (2 simple predicates + one call per generated variant form), each receipted");
  // The billable unit is the FORM, and the receipts say so: without the per-form line the ledger would
  // report two calls where nine were made, and the corsearch multiplier would be invisible.
  assert.deepEqual(countRows.filter((r) => r.predicate === "close" && r.mark === "IRONWHISK").map((r) => r.variant_form), ironForms);
  assert.equal(countRows.filter((r) => r.ok).length, 3 + ironForms.length);

  // ── the close-variation column, end to end ───────────────────────────────────────────────────────
  // IRONWHISK: every form answered ⇒ a real aggregate, and the forms that produced it ride with it.
  assert.equal(iron.counts.close.total, 2 * ironForms.length);
  assert.deepEqual(iron.counts.close.forms.map((f) => f.form), ironForms);
  assert.deepEqual(iron.variants.forms, ironForms, "the generated set is recorded whether or not it landed");
  // CLUVENDRA: no fixture for any form ⇒ NULL with a reason. A partial or fabricated sum here is the
  // defect the whole lane exists to prevent — a small confident number over a name nobody counted.
  assert.equal(cluv.counts.close.total, null);
  assert.match(cluv.counts.close.unavailable, /variant form\(s\) could not be counted/);
  assert.equal(cluv.counts.close.counted, 0);

  // ── the deliverable ──────────────────────────────────────────────────────────────────────────────
  const pool = join(root, "pool");
  const poolRun = readdirSync(pool, { withFileTypes: true })
    .map((d) => d.name)
    .filter((n) => existsSync(join(pool, n, "meta.json")))
    .map((n) => JSON.parse(readFileSync(join(pool, n, "meta.json"), "utf8")))
    // BOTH knockout runs in this file publish now, so the discriminator is this batch's own count.
    .find((m) => m.registerCounts?.counted === 2);
  assert.ok(poolRun, "published as a Knockout search with its filing counts");
  assert.equal(poolRun.registerCounts.provider, "corsearch");
  assert.equal(poolRun.registerCounts.counted, 2);

  const dir = readdirSync(pool).find((n) => existsSync(join(pool, n, "meta.json"))
    && JSON.parse(readFileSync(join(pool, n, "meta.json"), "utf8")).registerCounts?.counted === 2);
  // — the counts are published across this batch's per-mark documents, one mark's numbers on one
  // mark's page. What this test is about is that the MEASUREMENT reaches paper, so it reads every
  // document the run published; that each is free of the others' marks is pinned by the fan-out test
  // above, and re-asserting it here would only make this test fail twice for one cause.
  const docsFor = (d) => JSON.parse(readFileSync(join(pool, d, "meta.json"), "utf8")).reports
    .map((r) => readFileSync(join(pool, d, r.file), "utf8"));
  const report = docsFor(dir).join("\n");
  assert.match(report, /Knockout search/, "the report names the search that ran, by its own name");
  assert.match(report, /<h2>On-field conflicts<\/h2>/, "the counts render in the merged spine section — the complaint was that they were buried in a cell");
  assert.match(report, /class="ko-counts/, "the counts table renders");
  assert.match(report, /<td class="num">3<\/td>/, "the measured figures are on the page");
  assert.match(report, /<td class="num">41<\/td>/);
  assert.match(report, /not available/, "an untaken count says so, in words — never a blank and never a 0");
  assert.doesNotMatch(report, /Register estimate/, "the model's guess gives way to the measurement");
  assert.match(report, /Counting is not searching/, "the basis is stated where the numbers are");
  // The same numbers, machine-readable, for whatever drafts a client-facing note from this run.
  const metaC = JSON.parse(readFileSync(join(pool, dir, "meta.json"), "utf8"));
  const datas = metaC.reports.map((r) => JSON.parse(readFileSync(join(pool, dir, r.dataFile), "utf8")));
  for (const d of datas) assert.equal(d.level.stageLabel, "Knockout search");
  assert.equal(datas.flatMap((d) => d.marks).find((m) => m.registerCounts)?.registerCounts?.identical, 3);

  // the stepper grew a step, and the run walked it
  const status = JSON.parse(readFileSync(join(rd, "status.json"), "utf8"));
  assert.equal(status.stepTotal, 6, "Depth 2 walks one more step than a plain knockout");
  assert.equal(status.state, "delivered");
});
