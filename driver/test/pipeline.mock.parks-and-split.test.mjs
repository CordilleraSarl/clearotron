// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline, intake to delivery packet: the park lanes, the report cards and the common-law split
// Offline driver dry-run against a mock engine (no billable calls). The shared harness is pipeline-mock-harness.mjs.
import { JOB, ledgerSets, runPipeline, singleTermGridRun, stageOrder } from "./pipeline-mock-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir, driverRel } from "../../shared/driver-dir.mjs";
import { MEANING_SEAT } from "../common-law-receipts.mjs";

// ── the two park lanes (2026-07-29) ──────────────────────────────────────────────────────────────────
// A clearance run, 2026-07-29: two upstream overload parks took the run-global recovery counter to 2/3
// and 3/3 while nothing the run produced had failed a check, and the run then spent its remaining four
// hours one failure from terminal. Weather and defect now draw on separate bounded budgets, and the run
// record has to say which lane paid — the run's own status.json is where an operator reads that.
test("park lanes: an UPSTREAM OVERLOAD park charges weather and leaves the defect budget whole", async () => {
  try {
    // MOCK_CLAUDE_OVERLOADED is the real Anthropic 529 shape (overloaded_error, exit 1); runStage
    // reclassifies it to status_overloaded, which is what a live overload park actually carries.
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CLAUDE_OVERLOADED: "1", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.postponed, true, JSON.stringify(res));
    assert.equal(res.recovery, true);
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.state, "recovering");
    assert.equal(status.recoveryLane, "weather", "an upstream overload is weather, not a defect in this run's output");
    assert.deepEqual(status.recoveryLanes, { weather: { attempts: 1, ceiling: 6 }, defect: { attempts: 0, ceiling: 3 } },
      "BOTH counters are in the run record, and the defect budget is untouched");
    assert.equal(status.recoveryAttempts, 1, "the total park count keeps its old meaning (repair epoch, session keys, the notice)");
    assert.equal(status.recoveryHistory.at(-1).lane, "weather", "the append-only history is the lane ledger a resume reads back");
    // A4 clock honesty: a weather park is still OUR backoff guess, not a provider-declared reset —
    // recoveryResumesAt, resetsAt untouched, and the lane (not the clock field) says who caused it.
    assert.ok(status.recoveryResumesAt, "the recovery backoff clock is set");
    assert.equal(status.resetsAt, null, "resetsAt stays the rate-limit cap's name — nobody told us when the overload ends");
    const sent = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    assert.equal(sent.lane, "weather", "the resume sentinel carries the lane too");
    assert.equal(sent.resetsAt, undefined);
    const parked = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n")
      .map((l) => JSON.parse(l)).findLast((e) => e.event === "auto-recovery-parked") ?? {};
    assert.equal(parked.lane, "weather");
    assert.equal(parked.laneOf, 6, "and names the bound it is spending against");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_CLAUDE_OVERLOADED; }
});

test("park lanes: a park from the run's OWN output still charges the defect budget", async () => {
  try {
    // nonzero_exit is transient but wedge-shaped, not weather: the remedy is a fresh sample of our own
    // work, which is exactly what the (small, deliberate) defect budget buys.
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.recovery, true, JSON.stringify(res));
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.recoveryLane, "defect");
    assert.deepEqual(status.recoveryLanes, { weather: { attempts: 0, ceiling: 6 }, defect: { attempts: 1, ceiling: 3 } },
      "the defect lane is spent — the split changes who pays, never that somebody pays");
    assert.equal(status.recoveryHistory.at(-1).lane, "defect");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_FAIL_STAGE; }
});

test("resumed-after-terminal-failure: a stale .sent (from the failure notice) never skip-guards the report send", async () => {
  // The VENZY 2026-07-04 shape: run went TERMINAL (notice sent → deliver skill wrote .sent), a human
  // re-triggers after addressing the cause, the resume converges. clearotron-deliver skips any run with a
  // .sent marker — so the delivery handoff MUST clear the previous send's markers or the report is
  // silently lost. Same invariant on the failure arm: a resumed run that fails again must re-notify.
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_DELIVERY: "handoff" });
  assert.equal(res.ok, false);
  assert.ok(existsSync(join(res.runDir, ".failed")), "terminal (recovery off in this harness)");
  assert.ok(existsSync(driverDir(res.runDir, "failure.json")), "notice packet handed off");
  // the deliver skill sends the notice and stamps the run dir:
  writeFileSync(join(res.runDir, ".sent"), JSON.stringify({ messageId: "<notice@test>", at: "2026-07-04T00:00:00Z" }));
  // human re-trigger, cause addressed:
  delete process.env.MOCK_FAIL_STAGE;
  process.env.CLEAROTRON_DELIVERY = "handoff";
  try {
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const codename = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).codename;
    const res2 = await resume({ ...JOB }, { codename });
    assert.equal(res2.ok, true, JSON.stringify(res2));
    const dir = existsSync(join(res2.runDir, ".delivered")) ? res2.runDir : res.runDir;
    assert.ok(!existsSync(join(dir, ".sent")), "stale .sent CLEARED at the delivery handoff — the report send cannot be skip-guarded");
    assert.ok(!existsSync(driverDir(dir, "failure.json")), "stale failure packet removed — one delivery story");
    assert.ok(existsSync(driverDir(dir, "delivery.json")), "fresh delivery packet handed off");
    assert.equal(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).sendPending, true, "send is pending again for the REPORT");
  } finally { delete process.env.CLEAROTRON_DELIVERY; }
});

test("repeat-signature: an identical failure on resume is terminal at attempt 2 — never bought 3×", async () => {
  // The 414-wedge production shape (2026-07-05): a deterministic defect re-failed BYTE-IDENTICALLY
  // across three parks (~77 min) before the terminal. With the signature backstop the second identical
  // failure goes terminal immediately, with the honest terminalKind — even though park budget remains.
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.recovery, true, "attempt 1 parks (first sighting of this signature)");
    const status1 = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status1.recoveryHistory?.length, 1, "the park recorded its signature");
    assert.ok(status1.recoveryHistory[0].sig, "history rows carry the signature");
    // the resume hits the SAME persistent cause (knob still set) → identical signature → terminal
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: res.codename });
    assert.equal(res2.ok, false);
    assert.equal(res2.postponed, undefined, "NOT parked again — budget remained (1/3 used) but the signature repeated");
    assert.ok(existsSync(join(res2.runDir, ".failed")), "terminal .failed at attempt 2");
    const failed = JSON.parse(readFileSync(join(res2.runDir, ".failed"), "utf8"));
    assert.equal(failed.terminalKind, "repeat-signature", "the sentinel names the honest terminal kind");
    assert.equal(failed.sig, status1.recoveryHistory[0].sig, "same defect, same fingerprint");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_FAIL_STAGE; }
});

test("auto-recovery exhaustion: attempts beyond CLEAROTRON_RECOVERY_MAX go terminal, and the notice says so", async () => {
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "1" });
    assert.equal(res.recovery, true, "attempt 1 parks");
    // the resume hits the SAME persistent cause → attempts (1) >= max (1) → terminal circuit breaker
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: res.codename });
    assert.equal(res2.ok, false);
    assert.equal(res2.postponed, undefined, "no further parking — terminal");
    assert.ok(existsSync(join(res2.runDir, ".failed")), "terminal .failed after exhaustion");
    // Repair-first phase 3: the identical resume failure terminates as REPEAT-SIGNATURE, and the notice
    // says exactly that — no more blanket "the cause is systemic (credentials/provider/config)" claim
    // (teal-causeway's notice asserted a systemic cause for a deterministic 414).
    const packet = JSON.parse(readFileSync(driverDir(res2.runDir, "failure.json"), "utf8"));
    assert.match(packet.whatsappText, /after 1 automatic recovery attempt\b/, "the notice names the burned recovery attempt");
    assert.equal(packet.terminalKind, "repeat-signature");
    assert.match(packet.emailBodyHtml, /failed IDENTICALLY to the first attempt/);
    assert.match(packet.emailBodyHtml, /The driver reported, verbatim:/);
    assert.doesNotMatch(packet.emailBodyHtml, /cause is systemic \(credentials\/provider\/config\)/, "no invented systemic claim");
    assert.ok(packet.failureSignature && packet.reasonVerbatim, "the packet carries the signature + verbatim reason");
    // the payload fields, through the REAL writers rather than a unit call. This failure carries
    // no detail and no count, so both must be present AND null in both sinks: a status.json or a notice
    // with no such key cannot be told apart from one whose failure had nothing to say, and that
    // ambiguity is exactly what sent E2E to replay the merge gate against preserved artifacts.
    assert.ok("reasonDetail" in packet && "reasonQuantity" in packet, "the notice declares both payload fields");
    assert.equal(packet.reasonDetail, null);
    assert.equal(packet.reasonQuantity, null);
    const st = JSON.parse(readFileSync(join(res2.runDir, "status.json"), "utf8"));
    assert.ok("reasonDetail" in st && "reasonQuantity" in st, "status.json declares both payload fields");
    assert.equal(st.reasonQuantity, null, "absent is not zero");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; }
});

// doc-50 regression (2026-07-07 wobble outage): the nightly wobble replays PRE-doc-50 runs. verify
// reads _driver/framework.json from DISK, so a replay over a run with no sidecar failed
// framework_manifest_missing_for_v4 on EVERY replay (the whole nightly sweep went red, ~$65 burned on
// doomed Opus retries). pipelineInner's setup must BACKFILL the sidecar on a RESUME too (attachFramework
// runs write:true even when isResume) so the replayed v4 gate has its band vocabulary. Both directions below.
test("doc-50: a resume backfills a missing framework.json sidecar, and is a no-op when present (wobble replay)", async () => {
  const { res: r1 } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(r1.ok, false);
  const fwPath = driverDir(r1.runDir, "framework.json");
  assert.ok(existsSync(fwPath), "cold setup writes the sidecar (attachFramework write:true) before any stage");

  // simulate a pre-doc-50 frozen run: the framework sidecar never existed
  const { rmSync } = await import("node:fs");
  rmSync(fwPath);
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { parseFrameworkManifest } = await import(`../framework.mjs?bust=${Math.random()}`);

  // MOCK_FAIL_STAGE stays armed, so the resume halts at matter-frame again and the run stays LIVE for the
  // second pass below. The stage outcome is not what is under test: the BACKFILL runs FIRST, in the
  // pipelineInner setup, and is what the wobble needs. Without it the sidecar stays absent and the v4
  // verify fails framework_manifest_missing_for_v4.
  try { await pipeline(JOB, { codename }); } catch { /* stage outcome not under test */ }
  assert.ok(existsSync(fwPath), "the resume BACKFILLED the missing sidecar before any stage ran");
  const minted = parseFrameworkManifest(readFileSync(fwPath, "utf8"));   // throws if corrupt/invalid
  assert.ok(Array.isArray(minted.bands) && minted.bands.length > 0, "the backfilled manifest is valid (carries bands)");

  // NO-OP on the hot path: a second resume with the sidecar present reads it verbatim, never re-derives/rewrites.
  const before = readFileSync(fwPath, "utf8");
  try { await pipeline(JOB, { codename }); } catch { /* idem */ }
  assert.equal(readFileSync(fwPath, "utf8"), before, "present sidecar read verbatim — never re-derived or rewritten");
});

// F2 owner lane (2026-07-29): reconstructCtx mirrors the cold path's axis-from-plan UNION. The owner
// lane routinely puts plan entries on incumbent-class for a watchlist-owners-only manifest — a manifest
// whose prose carries no incumbent marker, so decideAxes alone would leave the axis OFF and a
// stale-repair or --experiment of register-digest/placement would exclude the executed lane from the
// per-axis unit list and the declared inputs/freshness stamps.
test("reconstructCtx: axes union the frozen plan's axes — a plan-only axis survives stage surgery", async () => {
  const { res: r1 } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(r1.ok, false);
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  // a prose manifest with NONE of the decideAxes markers: prose alone activates only the two defaults
  writeFileSync(join(r1.runDir, "variant-manifest.md"),
    "# Variant manifest\n\n- NOVAPULSE (exact)\n- NOVA PULSE (visual spacing)\n");
  // the frozen plan carries the owner lane on incumbent-class (watchlist-owners-only shape)
  writeFileSync(driverDir(r1.runDir, "register-plan.json"), JSON.stringify({
    schema_version: 1, plan_version: 1, nice_classes: ["9"], regions: [],
    entries: [
      { qid: "primary-sweep:exact:novapulse", axis: "primary-sweep", predicate: "exact", term: "NOVAPULSE", nice_classes: ["9"], regions: [], expected_kind: "enumerate", term_literal: true },
      { qid: "incumbent-class:default:novapulse+owner-vantage-orchard-inc", axis: "incumbent-class", predicate: "default", term: "NOVAPULSE", owner: "Vantage Orchard Inc.", nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
      { qid: "incumbent-class:owner:vantage-orchard-inc+watch", axis: "incumbent-class", predicate: "owner", term: "Vantage Orchard Inc.", nice_classes: ["9"], regions: [], expected_kind: "count", covered_by: ["incumbent-class:default:novapulse+owner-vantage-orchard-inc"] },
    ] }, null, 2) + "\n");
  const { reconstructCtx } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const ctx = reconstructCtx(JOB, { codename });
  assert.ok(ctx.axes.includes("primary-sweep"));
  assert.ok(ctx.axes.includes("incumbent-class"), "the plan-only axis joins ctx.axes (the cold path's B3 union)");
  assert.ok(!ctx.axes.includes("transliteration-numeric"), "prose decideAxes still governs axes the plan does not carry");
});

test("spec 64 review fix: a condition action AND a machinery gap BOTH reach the delivered verdict — neither arm swallows the other", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition", MOCK_COVERAGE_INSUFFICIENT: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.kinds.legalActions, true, "the condition arm recorded");
  assert.equal(sidecar.kinds.coverage, true, "the machinery arm recorded TOO (review fix: it used to be skipped once legalActions clamped)");
  assert.ok(sidecar.reasons.some((r) => r.includes("Obtain consent from Mystery Owner LLC")), "the condition reason survives");
  assert.ok(sidecar.reasons.some((r) => r.includes("not fully cleared")), "the coverage reason survives beside it");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.legalActions === 1));
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.coverageInsufficient === true));
});

// ── A2: the report-card loop fans out (runBatched) ─────────────────────────────────────────────────
// Cards are isolated by design (each sees only ITS finding and writes only ITS file), so the fan-out
// must be a pure wall-time win: byte-identical assembly, real overlap, sibling-safe failures.
test("A2 report-cards: batched render assembles a report.md byte-identical to the serial baseline", async () => {
  // driver.config freezes at FIRST import in this shared process (same reason the harness header gives
  // for the recall knobs), so the serial baseline rides CLEAROTRON_TURN_CAP instead — gateway re-reads it
  // from env on EVERY slot acquire, and cap 1 executes every turn strictly one-at-a-time (the pre-A2
  // shape). Both runs pin the cap explicitly so declaration order can never leak a frozen value.
  const knobs = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3" };
  const serial = await runPipeline({ ...knobs, CLEAROTRON_TURN_CAP: "1" });
  assert.equal(serial.res.ok, true, JSON.stringify(serial.res));
  const parallel = await runPipeline({ ...knobs, CLEAROTRON_TURN_CAP: "3" });
  assert.equal(parallel.res.ok, true, JSON.stringify(parallel.res));
  for (const r of [serial, parallel])
    for (const ord of [1, 2, 3]) assert.ok(existsSync(join(r.res.runDir, "report-cards", `${ord}.md`)), `card ${ord} rendered`);
  assert.equal(readFileSync(join(parallel.res.runDir, "report.md"), "utf8"),
    readFileSync(join(serial.res.runDir, "report.md"), "utf8"),
    "assembled report.md is byte-identical to the serial baseline");
});

test("A2 report-cards: more than one card in flight; the first card warms the cache alone", async () => {
  const trace = join(mkdtempSync(join(tmpdir(), "clearotron-cardtrace-")), "cards.jsonl");
  const { res } = await runPipeline({
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "4",
    MOCK_STAGE_TRACE: trace, MOCK_STAGE_DELAY_MS: "500", CLEAROTRON_TURN_CAP: "3",   // pin: the cap is env-read per acquire
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  const marks = readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(new Set(marks.map((e) => e.card)).size, 4, "all four cards rendered through the mock");
  // max in-flight from interval overlap; at equal timestamps settle ends before starts (conservative —
  // an interval that already closed never counts toward the window that follows it).
  const deltas = marks.map((e) => ({ t: e.t, d: e.phase === "start" ? 1 : -1 })).sort((a, b) => a.t - b.t || a.d - b.d);
  let inFlight = 0, maxInFlight = 0;
  for (const { d } of deltas) { inFlight += d; maxInFlight = Math.max(maxInFlight, inFlight); }
  assert.ok(maxInFlight > 1, `expected concurrent card renders, saw max in-flight ${maxInFlight}`);
  // cache-warm: the FIRST card settles before any sibling starts (then the rest batch)
  const first = marks.find((e) => e.phase === "start");
  const firstEnd = marks.find((e) => e.card === first.card && e.phase === "end");
  assert.ok(marks.filter((e) => e.phase === "start" && e.card !== first.card).every((e) => e.t >= firstEnd.t),
    "the first card ran alone (prompt-prefix cache warm) before the batch");
  const md = readFileSync(join(res.runDir, "report.md"), "utf8");
  for (const ord of [1, 2, 3, 4]) assert.match(md, new RegExp(`^- ord: ${ord}$`, "m"), `card ${ord} assembled`);

  // THE WAVE'S WALLS, CHECKED AGAINST A CLOCK THE JOURNAL DOES NOT OWN.
  // This is the arm that catches a start instant captured too late. Move `tDispatch` below the stage's
  // await and every field is still present, every schema assertion still passes, and every interval
  // collapses to ~0ms — the journal would then assert that a 14-minute half took no time. Presence cannot
  // see that; only a second, independent measurement can. The mock's own trace above is exactly that: it
  // stamps a start and an end around each card's 500ms turn, from inside the dispatch, with no knowledge
  // of run.jsonl. Each card's journalled interval must CONTAIN its traced interval.
  const cardRows = res.events
    ? res.events.filter((e) => e.event === "stage" && String(e.stage).startsWith("report-card"))
    : readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
      .filter((e) => e.event === "stage" && String(e.stage).startsWith("report-card"));
  assert.equal(cardRows.length, 4, "one completion row per wave member — that half was never the defect");
  for (const row of cardRows) {
    const ord = String(row.stage).split(":")[1];
    const start = marks.find((e) => e.card === ord && e.phase === "start");
    const end = marks.find((e) => e.card === ord && e.phase === "end");
    assert.ok(start && end, `card ${ord}: the mock traced this turn — if not, the arm proves nothing`);
    const lo = Date.parse(row.dispatchedAt), hi = Date.parse(row.settledAt);
    assert.ok(lo <= start.t,
      `report-card:${ord} says it dispatched at ${row.dispatchedAt}, but the mock was already running ${start.t - lo}ms earlier — the start instant is captured after the work, so wallSec measures nothing`);
    assert.ok(hi >= end.t, `report-card:${ord} says it settled before the mock finished`);
    assert.ok(row.wallSec >= 0.5,
      `report-card:${ord} reports ${row.wallSec}s over a turn the mock held open for 500ms`);
  }
  // And the property the round could not read at all: the members of a wave OVERLAP, provably, from the
  // journal alone. Two rows whose intervals intersect ran concurrently, so neither one's cost is the
  // other's, and neither can be inferred from the row that happens to precede it.
  const overlapping = cardRows.some((a) => cardRows.some((b) => a !== b
    && Date.parse(a.dispatchedAt) < Date.parse(b.settledAt) && Date.parse(b.dispatchedAt) < Date.parse(a.settledAt)));
  assert.ok(overlapping, "no two card intervals intersect — a wave that reads as serial is the defect #527 reported");
});

test("A2 report-cards: one card's failure is non-fatal — siblings complete and the note is recorded", async () => {
  const noted = [];
  const orig = process.stderr.write;
  process.stderr.write = function (chunk, ...rest) { noted.push(String(chunk)); return orig.call(this, chunk, ...rest); };
  let out;
  try {
    out = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_FAIL_STAGE: "BOUND TO CARD 2" });
    // Recording conversion 5 — keyed on the dispatch's own statement of its bound card. It used to read
    // "report-cards/2.md", and a converted dispatch names no path: the knob would have stopped matching
    // and this test would have measured a run where NO card failed while still asserting one did.
  } finally { process.stderr.write = orig; }
  const { res, events } = out;
  assert.equal(res.ok, true, JSON.stringify(res));   // the run still delivers
  const cards = events.filter((e) => e.event === "stage" && e.stage.startsWith("report-card"));
  assert.equal(cards.find((e) => e.stage === "report-card:2").ok, false, "card 2 failed");
  for (const ord of [1, 3]) assert.equal(cards.find((e) => e.stage === `report-card:${ord}`).ok, true, `sibling card ${ord} completed`);
  const md = readFileSync(join(res.runDir, "report.md"), "utf8");
  assert.match(md, /^- ord: 1$/m);
  assert.match(md, /^- ord: 3$/m);
  assert.doesNotMatch(md, /^- ord: 2$/m, "the failed card is omitted from report.md (render shows it structured-only)");
  assert.ok(noted.some((l) => /report-card\[2\] failed \(non-fatal/.test(l)), "the non-fatal note was recorded");
});

test("A1 split: the merged canonical ledger accounts for exactly the DICTATED grid (cells/gaps/pr_risk)", async () => {
  const split = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(split.res.ok, true, JSON.stringify(split.res));
  // member shape: the two grid halves AND the meaning seat — never the single member
  const clStages = stageOrder(split.events).filter((s) => s.startsWith("common-law"));
  assert.deepEqual(clStages.sort(), ["common-law-half:a", "common-law-half:b", `common-law-half:${MEANING_SEAT}`].sort(),
    "split gather = two grid halves + the meaning seat");
  assert.ok(split.events.some((e) => e.event === "grid-split"), "the half-spec producer stamped its receipt");
  assert.ok(split.events.some((e) => e.event === "common-law-merged" && e.gaps === 0), "the code merge ran clean");
  // half artifacts exist AND the canonical pair is the merged derivation
  for (const h of ["a", "b"]) {
    assert.ok(existsSync(join(split.res.runDir, `common-law-findings.half-${h}.md`)), `half ${h} findings written`);
    assert.ok(existsSync(join(split.res.runDir, `common-law-grid.half-${h}.json`)), `half ${h} ledger written`);
    assert.ok(existsSync(driverDir(split.res.runDir, `grid-spec.half-${h}.json`)), `half ${h} spec sidecar written`);
  }
  const canonical = readFileSync(join(split.res.runDir, "common-law-findings.md"), "utf8");
  assert.match(canonical, /driver-assembled/, "canonical findings = the driver merge");
  // THE MEANING SEAT'S DOCUMENT REACHES THE DELIVERABLE. Its whole output is the meaning read,
  // and a loaded reading is a FINDING; concatenating only the two grid halves would drop the one seat
  // whose findings are about what the mark MEANS, leaving a merged document that still looks complete
  // because the grid halves are complete. The grid ledger would even still carry the receipts.
  assert.match(canonical, new RegExp(`half-${MEANING_SEAT}`), "the assembly banner names every seat it concatenated");
  assert.match(canonical, /meaning sweep/i, "and the meaning seat's own document is in the merged file");

  // THE DIFFERENTIAL RUN IS GONE, and keeping the line would have been the silent green this whole
  // change is about. This asserted split-vs-unsplit over the same six terms, and the second run was
  // obtained with CLEAROTRON_COMMONLAW_SPLIT="off". Item 8 deleted that switch, so the same call now returns
  // ANOTHER SPLIT RUN and deepEqual compares a run against itself — passing, forever, asserting nothing.
  // The surviving lever cannot stand in: single-term-grid gathers a grid of one term, not these six.
  // There is no second independent ledger over these terms to compare against any more, and pretending
  // otherwise is worse than saying so.
  //
  // What the comparison stood IN FOR is checkable directly, against a stronger reference than a second
  // run that could carry the same bug: the merge must account for every cell the DICTATED spec demands —
  // each one a result or a recorded gap — and invent none.
  const full = JSON.parse(readFileSync(driverDir(split.res.runDir, "grid-spec.json"), "utf8"));
  const mergedSets = ledgerSets(JSON.parse(readFileSync(join(split.res.runDir, "common-law-grid.json"), "utf8")));
  const dictated = full.terms.flatMap((t) => full.platforms.map((pl) => `${t}|${pl}`)).sort();
  assert.deepEqual([...mergedSets.cells, ...mergedSets.gaps].sort(), dictated,
    "the merge accounts for exactly the dictated term x platform grid — every cell a result or a recorded gap, and nothing the spec never asked for");
  const halfTerms = ["a", "b"].flatMap((h) => JSON.parse(readFileSync(driverDir(split.res.runDir, `grid-spec.half-${h}.json`), "utf8")).terms);
  assert.deepEqual(halfTerms.sort(), [...full.terms].sort(), "the two GRID halves partition the FULL canonical spec");
  assert.equal(full.ledger_required, true, "the canonical spec keeps its fail-closed stamp");
  // the seat that owns the meaning work owns NO cells, and the grid halves own NO meaning work.
  // This pair of facts is the regression signal the issue asked for: the gate that refused 13 of 14
  // first attempts cannot fire on a seat that owes nothing.
  const seatSpec = (h) => JSON.parse(readFileSync(driverDir(split.res.runDir, `grid-spec.half-${h}.json`), "utf8"));
  assert.deepEqual(seatSpec(MEANING_SEAT).terms, [], "the meaning seat sweeps no term x platform cells");
  assert.deepEqual(seatSpec(MEANING_SEAT).connotation.queries, full.connotation.queries,
    "and it holds the WHOLE sweep — undivided, exactly as #345 requires");
  for (const h of ["a", "b"])
    assert.deepEqual(seatSpec(h).connotation.queries, [], `grid half ${h} owes no meaning ruling`);
  const splitEv = split.events.find((e) => e.event === "grid-split");
  assert.equal(splitEv.connotation_a, 0);
  assert.equal(splitEv.connotation_b, 0, "the 49/0 imbalance this issue reported is now 0/0");
  assert.equal(splitEv.connotation_m, full.connotation.queries.length);
  assert.equal(splitEv.connotationOwner, MEANING_SEAT);
});

test("A1 split, single-term grid: the gather runs the single member (member list shape, no half artifacts)", async () => {
  // Was the pre-split resume, and before that "flag-off". Both levers are gone; the ASSEMBLY they selected
  // is not, and a single-term grid is the lever that still reaches it. The properties are the ones those
  // arms asserted, because they are properties of the assembly, not of the lever.
  const { res, events } = await singleTermGridRun();
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = JSON.parse(readFileSync(driverDir(res.runDir, "common-law-path.json"), "utf8"));
  assert.equal(rec.path, "unsplit");
  assert.deepEqual(rec.members, ["common-law"], "the original single common-law member, by name");
  const gathered = stageOrder(events).filter((s) => s.startsWith("common-law"));
  assert.ok(gathered.includes("common-law"), `the resume really gathered on the single member: ${gathered.join(", ")}`);
  assert.ok(!gathered.some((s) => s.startsWith("common-law-half:")), "and dispatched no half-member");
  assert.ok(!events.some((e) => e.event === "grid-split" || e.event === "common-law-merged"),
    "no split machinery fired ON THE RESUME — the seed's own rows are excluded by construction, see singleTermGridRun");
  // The fixture removed the seed's half artifacts; a single-member gather writes none of its own.
  for (const h of ["a", "b", MEANING_SEAT])
    for (const f of [`common-law-findings.half-${h}.md`, `common-law-grid.half-${h}.json`, driverRel(`grid-spec.half-${h}.json`)])
      assert.ok(!existsSync(join(res.runDir, f)), `no half artifact ${f}`);
});

test("a company with no marketplaces: every grid spec the run writes, closure included, fits the cell budget", async () => {
  // Its profile's own batch figure divides the budget by the web cell alone, so it is the whole budget in
  // terms. Both grids size by the cells they run (profiles.mjs gridBatchFor, whose arithmetic
  // profiles.test.mjs pins for the web-plus-store case this mock's web-only closure cannot reach).
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CL_GAPS: "translit" },
    { profileKey: "harbour-goods" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const { SAFE_GRID_CELLS } = await import("../profiles.mjs");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  const specs = readdirSync(driverDir(res.runDir)).filter((f) => /^grid-spec(\.half-[a-z]+)?(\.supp-closure)?\.json$/.test(f));
  assert.ok(specs.length > 1, `the main grid and the closure each wrote a spec: ${specs.join(", ")}`);
  assert.ok(specs.some((f) => f.includes("supp-closure")), `the closure ran and wrote its spec: ${specs.join(", ")}`);
  assert.ok(events.some((e) => e.event === "coverage-closure" && e.requested > 0), "a closure was asked for");
  for (const f of specs) {
    const spec = JSON.parse(readFileSync(driverDir(res.runDir, f), "utf8"));
    assert.ok(spec.batch <= sidecar.batchSize, `${f}: never larger than the profile's own figure`);
    assert.ok(spec.batch * spec.platforms.length <= SAFE_GRID_CELLS,
      `${f}: ${spec.batch} terms × ${spec.platforms.length} cells is over the ${SAFE_GRID_CELLS}-cell budget`);
  }
});

test("A1 split repair BALANCE (item 25): the closable set is partitioned EVENLY across the usable halves, and the partition is recorded", async () => {
  // This test used to assert the opposite — that closable cells on a half-B term went to half B's
  // session and half A stayed untouched — because the reopen routed every cell through halfOfTerm.
  //
  // halfOfTerm is right for the FRESH gather (a pure function of the term, and the two halves come out
  // 1.4× apart). It is wrong for the reopen, which re-runs a SUBSET chosen by what failed, and that
  // subset does not respect the term partition: on the evidence run one half drew 857s of closure work
  // while the other drew 100s. Term-ownership was never the property that mattered here — the followup
  // DICTATES its cells by name, so any usable half can run any cell.
  //
  // What replaces it is a deterministic even deal (sorted by cell key, round-robin), which is the
  // balance the rejected N-worker queue was proposed for, without spending the pure partition every
  // followup depends on.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CL_GAPS: "translit" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const closure = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ requested: closure.requested, closed: closure.closed, remaining: closure.remaining },
    { requested: 2, closed: 2, remaining: 0 }, "every closable cell is still run — balancing must never drop one");
  const part = events.find((e) => e.event === "closure-partition");
  assert.ok(part, "the partition is RECORDED: a balance nobody can see is a balance nobody can check");
  assert.equal(part.cells, 2);
  assert.equal(part.unassigned, 0);
  const counts = Object.values(part.per_half);
  assert.equal(counts.reduce((a, b) => a + b, 0), 2, "every cell is assigned exactly once");
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "…and the halves differ by at most one cell, which is what even means");
  const passes = events.filter((e) => e.event === "stage" && e.trigger === "coverage-closure").map((e) => e.stage).sort();
  assert.deepEqual(passes, ["common-law-half:a", "common-law-half:b"],
    "two cells over two usable halves ⇒ both sessions work, where before one did all of it and the other idled");
  // the re-merge refreshed the canonical ledger: the closed cells are real cells again, zero gaps left
  const merged = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.equal(merged.gaps.length, 0, "post-closure re-merge recomputed the gaps away");
});

test("A1 split quarantine: the MEANING SEAT's dictated queries are NEVER silently dropped — merge gate fails transient; a resume re-runs ONLY that seat and converges", async () => {
  // The seat that owns the sweep dies on transient infrastructure BEFORE writing anything (the mock exits
  // pre-write), so NOT ONE dictated meaning query was executed. The canonical connotation gate is
  // COUNT-based, and the merged document still concatenates two complete grid halves — so nothing else in
  // the pipeline can see the hole. Pre-fix this shipped a clean meaning-read over searches that never ran
  // (a production false-clean class). The merge gate's per-query identity join must fail the run instead.
  //
  // THE SEAT THIS TEST KILLS MOVED, and that is the point. It used to kill half b, which owned the
  // whole sweep as well as half a grid; killing a grid half now drops CELLS ONLY (they merge as honest
  // gaps and ride the closure pass), because a grid half is dictated no meaning query at all. The
  // false-clean this test guards lives entirely at the meaning seat now, so that is where it is aimed.
  const { res: r1, events: e1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: `grid-spec.half-${MEANING_SEAT}` });
  assert.equal(r1.ok, false, "the run must NOT complete over un-executed dictated meaning queries");
  assert.equal(r1.failedStage, "common-law");
  // the SENTENCE names the defect, the PAYLOAD names the queries, and they are separate fields
  // now: the portal renders one to a user and puts the other behind a disclosure. Both are still
  // recorded, which is what this arm is actually about — a dropped dictated query must never vanish.
  assert.match(r1.reason, /merged half-grids (failed the canonical validator|dropped \d+ dictated connotation quer)/i,
    "the failure sentence must still say WHAT went wrong — this shape reaches the merge gate by either "
    + "route depending on which check fires first, and both are reader-safe sentences now");
  assert.ok(!/wikipedia|meaning slang/i.test(r1.reason),
    "…and must not carry the query list, which is what shipped to a user's dashboard");
  const st1 = JSON.parse(readFileSync(join(r1.runDir, "status.json"), "utf8"));
  assert.match(String(st1.reasonDetail ?? ""), /connotation|:/,
    "the queries themselves must reach status.json as their own field — dropped from the sentence AND "
    + "from the record is how a dictated query vanishes silently");
  assert.ok(e1.some((ev) => ev.event === "common-law-half-quarantined" && ev.half === MEANING_SEAT), "the meaning seat was quarantined on transient infra");
  assert.ok(e1.some((ev) => ev.event === "recovery-classified" && ev.class === "transient" && ev.classSource === "throw-site"),
    "classified transient at the throw site — the park loop owns convergence");
  // resume: half a's artifacts stand (skip), ONLY half b re-runs; the re-merge restores the full receipt set
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const all = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // the resume APPENDS to run 1's run.jsonl — judge run 2's slice only (from ITS grid-split event on)
  const e2 = all.slice(all.map((ev) => ev.event).lastIndexOf("grid-split"));
  assert.deepEqual(e2.filter((ev) => ev.event === "stage" && ev.stage.startsWith("common-law")).map((ev) => ev.stage),
    [`common-law-half:${MEANING_SEAT}`], "the resume re-ran ONLY the failed seat (both grid halves skipped, not re-spent)");
  for (const h of ["a", "b"])
    assert.ok(e2.some((ev) => ev.event === "skip" && ev.stage === `common-law-half:${h}`), `grid half ${h}'s completed work was reused`);
  const spec = JSON.parse(readFileSync(driverDir(r2.runDir, "grid-spec.json"), "utf8"));
  const merged = JSON.parse(readFileSync(join(r2.runDir, "common-law-grid.json"), "utf8"));
  assert.ok(spec.connotation.queries.length >= 2, "the spec dictates a real sweep (test precondition)");
  assert.deepEqual(merged.extras.pr_risk.map((e) => e.query).sort(), [...spec.connotation.queries].sort(),
    "every dictated meaning query is recorded in the merged canonical ledger");
});

// ── P2-C §8b leg 2 through the SPLIT (2026-07-31 review round). The mock's default receipts carry
// results:[] on every query, so no test had ever driven an ARMED with-results disposition through the
// split pipeline — the exact blind spot the review named. MOCK_PR_RESULTS closes it.

test("P2-C split armed: with-results receipts flow the disposition contract end to end — half seats write the rows, the merged gate passes, no remedy fires", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_PR_RESULTS: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const merged = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.ok(merged.extras.pr_risk.length >= 2 && merged.extras.pr_risk.every((e) => e.results.length === 1),
    "every recorded receipt carries a result (the evidence-run shape)");
  assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8")).connotation.disposition_required, true);
  const md = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  assert.match(md, /None identified — affirmative sweep/, "the designated owner half wrote the clean bottom line");
  assert.match(md, /news\.example\/mock-meaning-receipt/, "the disposition rows cite the recorded result");
  assert.deepEqual(events.filter((e) => e.event === "connotation-remedy"), [], "no merge remedy needed — the half seats carried the contract");
  assert.ok(events.filter((e) => e.event === "stage" && e.stage.startsWith("common-law-half"))
    .every((e) => e.ok && e.attempts === 1), "both halves passed first-try under the armed gate");
});

test("P2-C split: an undisposed receipt fails AT THE OWNING HALF SEAT and the corrective retry heals it — the connotation hint reaches the authoring session", async () => {
  // needle = the FULL first dictated query (the frame's first meaning question, connotation index 0).
  //
  // THIS SEAT MOVED, and that is what this test now pins. Index 0 used to land on half a under the
  // parity partition, which was also the half writing the clean bottom line. The meaning sweep is now
  // SINGLE-SEAT (MEANING_SEAT), so EVERY dictated query — index 0 included — is owned by one half,
  // and the seat that asserts the clean bottom line is no longer the seat that holds the receipts.
  // That separation is safe precisely because the gate reads the RECEIPTS rather than the prose:
  // the owning half is policed on what its ledger records, whatever its own document claims.
  // MOCK_CL_UNDISPOSED withholds the rows until a turn carrying the connotation correction dictate.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PR_RESULTS: "novapulse gaming backlash", MOCK_CL_UNDISPOSED: "1", CLEAROTRON_MAX_RETRIES: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const owner = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT}` && e.trigger === "fresh");
  assert.equal(owner.ok, true);
  assert.equal(owner.attempts, 2, "attempt 1 failed the disposition arm; the corrective retry healed it in-stage");
  // …and it healed on a FRESH dispatch, which is the whole subject of this arm. This fixture leaves the seat's
  // form with zero of its one row ruled and no seat-owned field set anywhere — a TOTAL defect — and a
  // resumed session re-reads its own output, so the warm patch is vetoed and attempt 2 runs fresh. That
  // is R6's measured 1007 seconds, not spent.
  //
  // THE PROPERTY THIS LINE USED TO GUARD IS NOT LOST. It asserted `warm === true` so the test could not
  // pass if the connotation tokens were quietly dropped from WARM_ELIGIBLE_RE. They are still on that
  // allowlist — it routes the repair at the disposition form and decides draft carry — and
  // retry-by-failure-shape.test.mjs arm 5 asserts exactly that, while arm 3 pins that a PARTIAL defect
  // still warm-patches.
  assert.equal(owner.warm, false,
    "attempt 2 resumed a session that had ruled none of its rows — the veto is not firing (#589)");
  // the NON-owning half is asked to dispose nothing, and passes first try over an empty sweep
  const other = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT === "a" ? "b" : "a"}` && e.trigger === "fresh");
  assert.equal(other.attempts, 1, "the sibling holds no dictated meaning queries — nothing for it to dispose");
  assert.deepEqual(events.filter((e) => e.event === "connotation-remedy"), [],
    "healed at the seat — the merge gate never had to route a remedy");
  const md = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  // THE LEDGER-WIPE TRAP (mock-stage-fixtures.mjs, the `resuming` guard): a warm patch makes no tool call,
  // so the plugin does not re-run and the half's grid ledger must not move. If a future change lets a warm
  // turn re-derive that ledger, extras.pr_risk[] empties, the receipts under repair vanish and the half
  // passes over silence. This row assertion is the tripwire: a wiped ledger yields no obligations, so the
  // driver-rendered table is empty and nothing matches here.
  // the row is DRIVER-RENDERED from the form now, so the receipt's URL comes from the tool-written
  // ledger rather than from anything the seat typed.
  assert.match(md, /meaning-sweep dispositions \(driver-rendered\)/, "the driver rendered the table, not the seat");
  assert.match(md, /\| novapulse gaming backlash \|[^|]*\|[^|]*news\.example\/mock-meaning-receipt/,
    "the healed half's ruled row reached the merged findings");
});

test("P2-C split cross-half: the half that OWNS the receipt now catches it at ITS OWN seat — the merged doc never has to (#350)", async () => {
  // needle = the frame's second meaning question (connotation index 1; it used to route to half b): the with-results receipt lives in
  // half b's ledger, which writes NO bottom line of its own, while half a writes the clean claim over zero
  // with-results receipts of its own.
  //
  // THE SHAPE THIS TEST WAS WRITTEN FOR IS THE HOLE THAT GATE CLOSES, so it can no longer arise. Half b used to
  // PASS its own seat — its doc asserted nothing CLEAN_CLAIM_RE matched, so the disposition arm never armed
  // over its own undisposed receipt — and only the MERGED doc was in violation. That is precisely the defect:
  // the arm was a phrase match on model prose, so the half seat that actually owned the receipt was silent
  // about it. Armed on the receipts, half b fails where the receipt lives and its own corrective ladder
  // heals it — earlier, cheaper, and at the seat holding the ledger it must read.
  //
  // What this DOES still guard is that the outcome is a healed run, not a terminal one: pre-fix this shape
  // threw StageFailure failClass "deterministic" (parkBudget 0, "never parked at all") and the first fresh
  // split run with it died .failed after the full paid gather with no model turn ever seeing the hint.
  //
  // The merge-only channel this comment used to describe is CLOSED. It read: "the recurrence floor
  // counts distinct queries over the UNION, so a receipt under the floor in each half and over it in the
  // merged pair still fails only at the merge." That was true, and it was the VENZY terminal — both
  // halves passed and the merge of them failed, on an obligation neither reader could observe from the
  // receipts it held. With the sweep single-seat the owning half sees exactly what the merge sees, so
  // merged violations are a subset of that half's by construction. common-law-receipts.test.mjs proves
  // the containment at unit level, and reproduces the old split shape to show what it cost.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PR_RESULTS: "novapulse political meaning", MOCK_CL_UNDISPOSED: "1", CLEAROTRON_MAX_RETRIES: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  // THIS IS THE ACCEPTANCE CRITERION, AS A TEST. The receipt is still caught at the seat that
  // holds it and still healed by that seat's own corrective ladder; what changed is WHICH seat that is.
  // The grid halves are handed no meaning query, so the gate that refused 13 of 14 first attempts cannot
  // arm on them — and both of them now pass first try, over the very receipt that used to fail one.
  const owner = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT}` && e.trigger === "fresh");
  assert.equal(owner.ok, true);
  assert.equal(owner.attempts, 2, "attempt 1 failed the disposition arm at the seat that OWNS the sweep; its corrective retry healed it");
  for (const h of ["a", "b"]) {
    const grid = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${h}` && e.trigger === "fresh");
    assert.equal(grid.ok, true, `grid half ${h} passed`);
    assert.equal(grid.attempts, 1,
      `grid half ${h} owes no meaning ruling, so connotation_no_ruling cannot refuse its first attempt — the structural failure this issue reported`);
  }
  // Asserted as an ABSENCE on purpose: if a future change re-opens the merged-only per-query hole, half b
  // starts passing its seat again and the remedy fires. Dropping this line would let that pass silently,
  // which is the failure class this whole change is about.
  assert.deepEqual(events.filter((e) => e.event === "connotation-remedy"), [],
    "the merge gate never had to route a remedy — the owning seat caught its own receipt");
  const md = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  assert.match(md, /None identified — affirmative sweep/, "half a's bottom line stands");
  assert.match(md, /\| novapulse political meaning \|[^|]*\|[^|]*news\.example\/mock-meaning-receipt/,
    "the meaning seat's healed ruled row reached the merged findings, rendered by the driver from the form");
  // the merged canonical pair passes the same gate a single-member run faces
  assert.ok(events.filter((e) => e.event === "common-law-merged").length >= 1, "the canonical pair was derived and passed the merge gate");
});

// ── a provider hard-error on a dictated slice becomes a DISCLOSED DEFERRAL ──────────────────────
//
// R5 (engine `8098215`), a worldwide Global preliminary: two `incumbent-class` slices took an
// "HTTP 500 … Count Failed - IL - Near/Adj" through the in-tool retry, the direct dispatch, the followup
// and FOUR recovery parks, and the fan-in then refused — 140 minutes, nothing delivered, worldwide sales
// held. The provider ACCEPTED both slices and then failed on one jurisdiction's index; `deferred` covered
// only slices a provider cannot EXPRESS, so there was no exit for a slice it accepted and then dropped.
//
// This is the whole arc in one test, because neither half is the claim on its own: the first pass MUST
// still refuse (the recovery ladder keeps its chance at a bad minute), and the resume MUST deliver with
// the slices named. A test that only asserted the second half would pass on an engine that had simply
// stopped checking.
test("a provider hard-error refuses ONCE, then ships as a disclosed deferral — never as clean", async () => {
  try {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
      MOCK_PLAN_HARD_ERROR: "+merch", CLEAROTRON_RECOVERY_MAX: "3" });

    // ── PASS 1: the ladder runs, and the run refuses rather than shipping over the hole ──────────────
    assert.equal(res.ok, false, "a slice the plan dictated did not run — the first fan-in does not ship");
    assert.ok(events.some((e) => e.event === "plan-qids-missing"), "the identity join saw it as a hole and tried to close it");
    assert.ok(!events.some((e) => e.event === "plan-qids-provider-hard-error-deferred"),
      "and did NOT defer on the first pass — deferring costs a disclosed gap, so recovery gets its chance first");
    const exec1 = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
    assert.ok(exec1.missing.length >= 1, "the receipt records the hole, which is what makes pass 2 possible");
    assert.deepEqual(exec1.deferred ?? [], [], "nothing is disclosed as deferred yet");

    // ── PASS 2: the resume the runner's watcher performs. Same run dir, same 500 ─────────────────────
    const sent = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: sent.codename });
    assert.equal(res2.ok, true, `the run DELIVERS with the gap on its face: ${JSON.stringify(res2)}`);
    assert.ok(existsSync(join(res2.runDir, ".delivered")), "delivered, not parked and not terminal");

    const exec2 = JSON.parse(readFileSync(driverDir(res2.runDir, "plan-execution.json"), "utf8"));
    const hard = (exec2.deferred ?? []).filter((d) => d.qid.includes("+merch"));
    assert.equal(hard.length, exec1.missing.filter((q) => q.includes("+merch")).length,
      "every hard-errored slice is now a deferral — none was dropped on the way");
    assert.deepEqual(exec2.missing, [], "and none is left claiming to be merely missing");
    for (const d of hard) {
      assert.match(d.reason, /HTTP 500/, "the provider's own error is the stated reason, verbatim");
      assert.match(d.reason, /never searched and cannot be read as clean/, "and the row says what that means");
    }

    // The axis states what happened to it. `deferred` is not `executed`, and the confirmed-clean gates
    // read this skeleton — which is what stops the gap being swallowed downstream.
    const sk = exec2.skeleton.find((s) => s.axis === "primary-sweep");
    assert.equal(sk.state, "deferred", "the axis carrying the failed slice is not claimed as executed");

    // A run that CANNOT retry it forever, and did not: one bounded envelope attempt, recorded either way.
    const decision = JSON.parse(readFileSync(driverDir(res2.runDir, "envelope-decision.json"), "utf8"));
    const decided = [...decision.accepted, ...decision.closed, ...decision.close_failed].map((r) => r.qid);
    for (const d of hard) assert.ok(decided.includes(d.qid), `${d.qid} was decided about, not left open`);

    const events2 = readFileSync(driverDir(res2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const deferredRow = events2.find((e) => e.event === "plan-qids-provider-hard-error-deferred");
    assert.ok(deferredRow, "the conversion is a loud event — a reader can find WHY a territory went unsearched");

    // AND THE ROW CARRIES THE THING IT IS A DECISION ABOUT.
    //
    // Its keys were `ts, event, count, permanent, qids`. A reader who saw `permanent: 0` had nothing to
    // audit that classification against: the verdict was recorded and the provider string it was made
    // from was not, so the one row that says "this refusal is weather" could never be checked from the
    // record. `qids_omitted` closes the same gap one level down — `slice(0, 8)` dropped the ninth qid
    // onward with no marker, which is this issue's own pathology occurring inside the line that records
    // this issue's defect.
    assert.ok(Array.isArray(deferredRow.reasons) && deferredRow.reasons.length,
      "the deferred row names the provider text its classification rests on");
    assert.equal(typeof deferredRow.qids_omitted, "number",
      "and says how many qids it did not list, so a list of eight cannot be mistaken for the whole set");
    assert.equal(deferredRow.qids.length + deferredRow.qids_omitted, deferredRow.count,
      "listed + omitted must equal the population");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_PLAN_HARD_ERROR; }
});

// ── the basis is DERIVED, at every seam, and the third synthesis pass is gone ──────────────────
//
// The pass this replaced ran ONCE, before refutation, and cost ~10 serial minutes on 3 of 4 runs to have
// a model re-assert what the reading log already knew. Two live claims are worth pinning from the
// outside, because neither is visible in a pure function:
//
//   · the derivation runs at BOTH seams — after synthesis AND before delivery. Re-derived on the four
//     delivered findings.json files the old pass measured, its own stamp counts did not hold (35→37,
//     28→31, 37→38, 41→40): stamps entered the deliverable after the only check that policed them.
//     It also settles at the delivery seam, before the cards are built, so a corrective pass that
//     re-sent the record cannot leave the cards built on stamps the next settle demotes.
//   · no synthesis dispatch carries `trigger: "read-verification"` any more. That is the ~10 minutes.
test("the basis derivation runs at both seams, and no third synthesis pass runs at all", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));

  const seams = events.filter((e) => e.event === "basis-derivation").map((e) => e.at);
  assert.deepEqual(seams, ["post-synthesis", "seam", "pre-delivery"],
    "every seam, in order — one settle before refutation reads the findings, one before the cards are built on them, one after the corrective pass has written to them");

  assert.ok(!events.some((e) => e.event === "stage" && e.trigger === "read-verification"),
    "the third synthesis pass is GONE — this is the ~10 serial minutes the issue costed");
  assert.ok(!events.some((e) => e.event === "read-verification" || e.event === "read-verification-failed"),
    "and its events with it");

  // The record is written whether or not anything moved (AD-4): "nothing was demoted" must not read the
  // same as "nobody looked".
  const rec = JSON.parse(readFileSync(driverDir(res.runDir, "basis-derivation.json"), "utf8"));
  assert.equal(rec.at, "pre-delivery", "the last settle is the one on disk");
  assert.ok(Array.isArray(rec.rows), "rows is always present");
  assert.equal(typeof rec.stamped_after, "number");
  assert.equal(typeof rec.demoted, "number");
  assert.ok(!existsSync(driverDir(res.runDir, "read-verification.json")), "the old artifact is not written");
});
