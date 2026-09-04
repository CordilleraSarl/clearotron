// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jx-units.mjs — the Phase-4 Stage-1.5 SHADOW units (spec 10.5/10.6): the zh SERP platform grid
// (slice 2) and jx-nativeread:zh (slice 3). Called from two never-kill blocks in pipelineInner;
// everything here degrades and receipts — nothing throws past its own boundary.
//
// ARTIFACT BOUNDARY (was the "ship dark" invariant, and it outlived the switches): every artifact these
// units write lives under `_driver/jx/` (plus rows in the slice-1 `_driver/jx-completions.jsonl`),
// nothing outside this module reads them, and the register plan is never touched. The aim-attention
// artifact reaches synthesis exactly like enforcer-signals — aim only, never a band.
//
// THE SWITCHES ARE GONE ( item 8, d1e2acfc). This header described `CLEAROTRON_JX_CONSUME` as a flip
// still ahead of us and a run as byte-identical "with every unit flag off"; both sentences outlived the
// thing they described by naming a Phase-5 that has happened. There is no flag to turn off and no
// byte-identical slice-1 run to fall back to — the consume seam is unconditional, gated only on
// conditions a run already discloses. `laneEnvOn("zh")` is the one leg that stayed, and it stayed
// because an incident kill is a switch someone would actually use; jxAimForSynthesis below carries that
// reasoning where the seam is.
//
// Grid contract (slice 2): the driver DICTATES `_driver/jx/<lane>-grid-spec.json` (terms × platforms,
// frozen on first dictation — a resume never re-dictates); a pure code-side executor fills every cell
// via the SERP provider (no model in the data path) and writes `_driver/jx/<lane>-grid.json` in the
// EXACT common-law grid-ledger shape, so the existing receipts-gate functions (common-law-receipts
// `findGridLedgerViolations` / `findPlatformIdentityViolations`) run verbatim over (spec, ledger).
// Empty cell = a `no_hit` cell row; failed cell = a receipted gap — every dictated cell is accounted
// or honest-gapped, never silently dropped. Register-MIRROR hits (jx-lanes SERP_LANES mirror table)
// are demoted code-side and NEVER reach the judge.
//
// Read contract (slice 3): the lane model reads the CODE-INLINED zh evidence slice (register-unit
// output + candidates + CNIPA notes + judged grid findings) and returns structured flags; code
// enforces record_uri ∈ the inlined slice (else the item demotes to a lead); severity_hint is a
// triage hint and NEVER sets a band — Claude stays the sole rating authority.

import { readFileSync, writeFileSync, renameSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { LANGUAGE_LANES, SERP_LANES, isMirrorHost, canonicalTerm, jxBillingStamp } from "./jx-lanes.mjs";
import { jxKey, MAX_LANE_ATTEMPTS } from "./jx.mjs";
import { abbrev } from "./repair-contract.mjs";
import { kebab } from "./search-policy.mjs";
import { SERP_PROVIDERS, JX_PROVIDERS, laneArmed } from "./driver.config.mjs";
import { findGridLedgerViolations, findPlatformIdentityViolations } from "./common-law-receipts.mjs";

export const MAX_UNIT_ATTEMPTS = 3;      // degraded-unit retries across resumes (repairable, never terminal)
export const SERP_TERM_CAP = 12;         // terms per grid — 12 × 7 cells = 84 paid calls, the hard ceiling
export const SERP_LATIN_VARIANT_CAP = 2; // Latin variants beyond the mark itself (breadth lives in the common-law grid)
export const SERP_HIT_CAP = 10;          // hits per cell
export const SERP_CONCURRENCY = 3;       // parallel SERP calls (the knockout sweep default)
export const SERP_GRID_DEADLINE_MS = 5 * 60_000;   // whole-grid wall clock (CLEAROTRON_JX_SERP_DEADLINE_MS overrides);
                                                   // past it, unattempted cells gap honestly — never a stalled run
export const NATIVEREAD_GRID_ROWS_CAP = 60;        // grid-findings rows inlined into the read payload (receipted cap)
export const NATIVEREAD_SLICE_CAP = 12000; // chars of register-unit output inlined into the read payload
const GAP_DEGRADE_FLOOR = 0.5;           // >50% gapped cells ⇒ the grid attempt DEGRADES (the GRID_COVERAGE_FLOOR idiom)

// — ONE reader for the fail-open lane switch, shared with the slice statement that describes
// what this executor did. They disagreed; the statement lost, and it shipped.
const laneEnvOn = (lane) => laneArmed(lane);

const jxDir = (runDir) => driverDir(runDir, "jx");
const unitsPath = (runDir) => join(jxDir(runDir), "units.json");
const atomic = (path, obj) => { writeFileSync(`${path}.tmp`, JSON.stringify(obj, null, 2) + "\n"); renameSync(`${path}.tmp`, path); };

// ── Per-unit resume state (the jx.mjs fold state machine, per unit key like "serp-grid:zh") ─────────
function readUnits(runDir) {
  try { return JSON.parse(readFileSync(unitsPath(runDir), "utf8")); } catch { return { schema: 1, units: {} }; }
}
function writeUnit(runDir, key, record) {
  mkdirSync(jxDir(runDir), { recursive: true });
  const state = readUnits(runDir);
  state.units[key] = record;
  state.updatedAt = new Date().toISOString();
  atomic(unitsPath(runDir), state);
  return state;
}
function unitState(runDir, key) {
  const u = readUnits(runDir).units?.[key] ?? null;
  if (u?.done) return { skip: true, cause: "already ran (frozen)" };
  const attempts = u?.attempts ?? 0;
  if (attempts >= MAX_UNIT_ATTEMPTS) return { skip: true, cause: `degraded ${MAX_UNIT_ATTEMPTS}× — receipted terminal` };
  return { skip: false, attempts };
}
// A provider cause is UNTRUSTED text on its way into a persisted receipt. callSearchAPI builds
// `SerpAPI <status>: <errorText>` straight from a response body that can echo the request line — and the
// request line carries `api_key=`. Redact where the cause ENTERS the record, never at print time: the
// record is the thing that gets copied, archived and pasted into an issue.
const redactProviderCause = (s) => String(s).replace(/api_key=[^&\s]*/gi, "api_key=[redacted]");

// ── THE ONE SENTENCE A HUMAN READS ABOUT A DEGRADED SHADOW LANE ──────────────────────────────────
//
// One composer for all four shadow-lane notices, because they drifted apart exactly as separate
// string literals do: one ended "shadow-only, the run is unaffected" and carried no cause, two
// truncated the cause to 120 characters, and none of them led with what was lost.
//
// THE WORDING IS RULED, not stylistic (design, 2026-08-13). "Unaffected" is banned from any line
// describing a degraded capability — the word may only describe the PIPELINE'S CONTINUATION, never
// the capability. A line that says a headline capability produced nothing and calls the run
// unaffected is true about the pipeline and false about the answer, and it is the sentence a reader
// takes away. So: the LOSS leads, its VERBATIM cause rides with it, and the continuation is
// subordinate and phrased as what the report will have to say.
//
// The cause is redacted on the way in, same as the record's — this string reaches stderr, journals
// and pasted issue comments, which is the same exposure the record has.
// `state` is passed rather than fixed because DEGRADED and NOT RUN are different facts and one word
// must not stand for both: a grid that ran and gapped has a provider cause and a retry ahead of it,
// a lane that never started has neither. The old strings blurred them ("skipped … shadow-only" beside
// "degraded … shadow-only") and a reader could not tell which had happened.
const shadowLaneNote = (lane, state, loss, attempt) =>
  `${lane} ${state} (${redactProviderCause(loss)})${attempt ? ` — ${attempt}` : ""}`
  + ` — run continues; this lane's coverage will be reported as limited`;

function degradeUnit(runDir, key, attempts, cause) {
  // NEVER clobber a completed unit: a throw AFTER writeUnit(done) — a full log disk, a broken
  // stderr pipe — must not un-freeze settled paid work into a re-billable retry (review 2026-07-18).
  if (readUnits(runDir).units?.[key]?.done) return;
  // `degraded` is the BOOLEAN (whether); `degradedCause` is the string (why) —. The old shape put
  // the cause in `degraded`, which meant no reader could type-check the field it was asking about.
  // REDACT BEFORE TRUNCATING. Either order is leak-safe (the `[^&\s]*` tail matches to end-of-string,
  // so a key cut by the slice is still wholly replaced), but truncating first lets a long key eat the
  // whole 300-char budget and push the diagnostic half of the cause off the end.
  writeUnit(runDir, key, { degraded: true, degradedCause: redactProviderCause(cause).slice(0, 300),
    attempts: attempts + 1, degradedAt: new Date().toISOString() });
}

// A degraded-but-still-retryable slice-1 fold lane: its accepted list is EMPTY for a transient
// reason, and the next resume will retry it. Dictating a grid (or reading a slice) from that state
// would freeze the native-script terms out of the unit forever — the units DEFER instead (no
// attempt burned). A terminal fold (attempts exhausted) or a fold that simply never ran proceeds
// candidate-less, honestly receipted.
function foldRetryable(ctx, lane) {
  const pl = ctx.jxLanes?.fold?.lanes?.[lane];
  return Boolean(pl?.degraded) && (pl.attempts ?? 0) < MAX_LANE_ATTEMPTS;
}

// jx-completions ledger rows for the model-call units (judge, nativeread) — the slice-1 shape plus a
// `unit` discriminator; tokens/counts only, never currency. The token counts ride `usage` under a
// `model`, which is the shape tokens.mjs folds into the run rollup: named anything else, these calls
// spend real tokens that no per-run total ever sees (they did, until 2026-07-28).
//
// …and the BILLING PATH rides with them — see jxBillingStamp in jx-lanes.mjs.
function ledgerRow(runDir, row) {
  try { appendFileSync(driverDir(runDir, "jx-completions.jsonl"), JSON.stringify(row) + "\n"); } catch { /* receipts best-effort */ }
}

const runPrefix = (run) => `prelim-${run?.slug ?? "run"}-${run?.codename ?? "local"}-`;

// ── Executor chains (the resolveJxExecutor idiom: injected → CLEAROTRON_JX_FIXTURES → live) ─────────────
export function resolveSerpExecutor(opts, { mark, lane }) {
  if (typeof opts?.serpExecutor === "function") return { exec: opts.serpExecutor, source: "injected" };
  const fixDir = process.env.CLEAROTRON_JX_FIXTURES;
  if (fixDir) {
    let table = null;   // { "<term>|<platform>": hits[] } lazily built from <mark-kebab>.<lane>.serp.json
    let dflt;           // parsed.default.hits — an EXPLICIT opt-in fallback for cells the fixture can't
                        // enumerate (e2e runs where variant terms are engine-generated); absent ⇒ a
                        // missing cell still gaps loudly (unit-test discipline)
    return {
      source: `fixtures:${fixDir}`,
      exec: async ({ term, platform }) => {
        try {
          if (!table) {
            const parsed = JSON.parse(readFileSync(join(fixDir, `${kebab(mark)}.${lane}.serp.json`), "utf8"));
            table = {};
            for (const c of parsed?.cells ?? []) table[`${canonicalTerm(c.term)}|${c.platform}`] = Array.isArray(c.hits) ? c.hits : [];
            dflt = Array.isArray(parsed?.default?.hits) ? parsed.default.hits : undefined;
          }
          const hits = table[`${canonicalTerm(term)}|${platform}`] ?? dflt;
          if (hits === undefined) return { ok: false, cause: `fixture has no cell for "${term}" × ${platform}` };
          return { ok: true, hits, tookMs: 0 };
        } catch (e) { return { ok: false, cause: `serp fixture missing/corrupt for ${kebab(mark)}.${lane}: ${abbrev(String(e.message), 120)}` }; }
      },
    };
  }
  return { source: "serpapi", exec: (args) => SERP_PROVIDERS.serpapi.search(args) };
}

export function resolveJudge(opts, { mark, lane }) {
  if (typeof opts?.jxJudge === "function") return { exec: opts.jxJudge, source: "injected" };
  const fixDir = process.env.CLEAROTRON_JX_FIXTURES;
  if (fixDir) {
    return {
      source: `fixtures:${fixDir}`,
      exec: async ({ hits }) => {
        try {
          const parsed = JSON.parse(readFileSync(join(fixDir, `${kebab(mark)}.${lane}.judge.json`), "utf8"));
          const byId = new Map((parsed?.judgments ?? []).map((j) => [j.id, j]));
          return { ok: true, judgments: hits.map((h) => byId.get(h.id)).filter(Boolean), tookMs: 0 };
        } catch (e) { return { ok: false, cause: `judge fixture missing/corrupt: ${abbrev(String(e.message), 120)}` }; }
      },
    };
  }
  return { source: "engine", exec: (args) => JX_PROVIDERS.judge.judge(args) };
}

export function resolveNativeread(opts, { mark, lane }) {
  if (typeof opts?.nativereadExecutor === "function") return { exec: opts.nativereadExecutor, source: "injected" };
  const fixDir = process.env.CLEAROTRON_JX_FIXTURES;
  if (fixDir) {
    return {
      source: `fixtures:${fixDir}`,
      exec: async () => {
        try {
          const parsed = JSON.parse(readFileSync(join(fixDir, `${kebab(mark)}.${lane}.read.json`), "utf8"));
          return { ok: true, items: Array.isArray(parsed?.items) ? parsed.items : [], tookMs: 0 };
        } catch (e) { return { ok: false, cause: `nativeread fixture missing/corrupt: ${abbrev(String(e.message), 120)}` }; }
      },
    };
  }
  return { source: "engine", exec: (args) => JX_PROVIDERS.nativeread.read(args) };
}

// Bounded local pool (runBatched is pipeline-local; 10 lines beat an export churn).
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { for (let k; (k = i++) < items.length;) out[k] = await fn(items[k], k); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// ── Slice 2 — the zh SERP platform grid ─────────────────────────────────────────────────────────────
export async function runJxSerpGrid(ctx, job, opts = {}, { runLog = () => {}, note = () => {} } = {}) {
  const { run } = ctx;
  const lane = "zh";
  const key = `serp-grid:${lane}`;
  try {
    // item 8 — CLEAROTRON_JX_SERP_GRID is gone. It was a default-OFF arm on a unit that has run in
    // production since 2026-08-04, so it hid a live path behind a switch nobody outside this box could
    // find. What remains are the conditions a run DISCLOSES: the lane not killed, a frozen lane
    // decision, a SERP capability entry. Each already returns a cause that reaches the slice statement.
    if (!laneEnvOn(lane)) return { ran: false, cause: `CLEAROTRON_NATIVE_LANGUAGE_${lane.toUpperCase()} off` };
    const laneDecision = ctx.jxLanes?.lanes?.[lane];
    if (!laneDecision) return { ran: false, cause: "no frozen zh lane decision (jurisdictions/policy)" };
    const serpSpec = SERP_LANES[lane];
    if (!serpSpec || !LANGUAGE_LANES[lane]) return { ran: false, cause: `no SERP capability entry for lane "${lane}"` };
    const st = unitState(run.runDir, key);
    if (st.skip) return { ran: false, cause: st.cause };

    mkdirSync(jxDir(run.runDir), { recursive: true });
    const specPath = join(jxDir(run.runDir), `${lane}-grid-spec.json`);
    const markName = String(job.markName ?? job.name ?? "").trim();

    // Dictation — frozen on first write (a resume re-USES the spec; re-dictating after a variant regen
    // would re-key the join and re-bill settled cells).
    let spec = null;
    try { spec = JSON.parse(readFileSync(specPath, "utf8")); } catch { /* cold — dictate below */ }
    if (!spec && foldRetryable(ctx, lane))
      return { ran: false, cause: "slice-1 fold degraded but retryable — deferring grid dictation to a resume (the candidates are the lane's point; no attempt burned)" };
    if (!spec) {
      const seen = new Set();
      const terms = [];
      const overflow = [];
      const push = (t, sourceLabel) => {
        const term = canonicalTerm(t);
        if (!term || seen.has(jxKey(term))) return;
        seen.add(jxKey(term));
        if (terms.length >= SERP_TERM_CAP) { overflow.push({ term, source: sourceLabel }); return; }
        terms.push(term);
      };
      push(markName, "mark");
      const markKey = jxKey(markName);
      (ctx.gridVariants ?? []).filter((v) => jxKey(canonicalTerm(v)) !== markKey)
        .slice(0, SERP_LATIN_VARIANT_CAP).forEach((v) => push(v, "latin-variant"));
      const pl = ctx.jxLanes?.fold?.lanes?.[lane];
      const candidates = pl?.accepted ?? [];
      candidates.forEach((c) => push(c.term, "jx-candidate"));
      if (!terms.length) return { ran: false, cause: "no terms to dictate (empty mark)" };
      spec = {
        schema: 1, lane, engine: serpSpec.engine,
        terms,
        platforms: [...serpSpec.platforms, "web"],   // 6 store platforms + the general-web cell = the 7-cell floor
        hit_cap: SERP_HIT_CAP,
        output: `${lane}-grid.json`,   // RELATIVE — a delivered run is renameSync'd into archive/, so an
                                       // absolute path frozen here would dangle or write outside the run
        ledger_required: true,
        // a transient outage never masquerades as a substantive empty result: the defer above
        // guarantees the fold is SETTLED (success, settled-empty, terminal or never-ran) by now
        // the cause reads off `degradedCause` — `degraded` is now the boolean, and interpolating it
        // here would freeze the literal string "(true)" into the spec sidecar forever
        ...(candidates.length ? {} : { candidatesMissing: pl?.degraded
          ? `slice-1 fold terminally degraded (${String(pl.degradedCause ?? "cause not recorded").slice(0, 120)}) — grid runs on mark + Latin variants only`
          : "slice-1 fold settled with no accepted candidates — grid runs on mark + Latin variants only" }),
        dictatedAt: new Date().toISOString(),
      };
      atomic(specPath, spec);
      // no silent caps: dropped terms are receipted in the spec sidecar's log line
      runLog(run.runDir, { event: "jx-serp-grid-spec", terms: terms.length, platforms: spec.platforms.length, overflow: overflow.length });
      if (overflow.length) runLog(run.runDir, { event: "jx-serp-grid-overflow", dropped: overflow.map((o) => o.term) });
    }

    // Execute every dictated cell (pure code — no model in the data path). The unit carries a
    // wall-clock deadline on top of the per-call transport timeout: past it, remaining cells become
    // honest "deadline exceeded" gaps (the floor logic then decides degraded-vs-done) — a stalled
    // provider can never stall the paid run it shadows.
    const { exec, source } = resolveSerpExecutor(opts, { mark: markName, lane });
    const callsLedger = join(jxDir(run.runDir), "serp-calls.jsonl");
    const sessionKey = `${runPrefix(run)}jx-serp-${lane}`;
    const outPath = join(jxDir(run.runDir), spec.output ?? `${lane}-grid.json`);   // legacy absolute output_path is ignored — always run-local
    const deadlineEnv = Number(process.env.CLEAROTRON_JX_SERP_DEADLINE_MS);   // "0" is a valid (instant) deadline — no || fallback
    const deadlineMs = process.env.CLEAROTRON_JX_SERP_DEADLINE_MS != null && process.env.CLEAROTRON_JX_SERP_DEADLINE_MS !== "" && Number.isFinite(deadlineEnv)
      ? deadlineEnv : SERP_GRID_DEADLINE_MS;
    const gridStarted = Date.now();
    const cellsIn = spec.terms.flatMap((term) => spec.platforms.map((platform) => ({ term, platform })));
    const results = await pool(cellsIn, SERP_CONCURRENCY, async ({ term, platform }) => {
      const started = Date.now();
      let r;
      if (Date.now() - gridStarted >= deadlineMs) r = { ok: false, cause: `grid deadline exceeded (${deadlineMs}ms) — cell not attempted` };
      else {
        try { r = await exec({ engine: spec.engine, term, platform, site: platform === "web" ? null : platform, count: spec.hit_cap }); }
        catch (e) { r = { ok: false, cause: `executor threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
      }
      const hits = r?.ok ? (r.hits ?? []) : [];
      // the corsearch ledger shape, run-prefixed, so provider-usage rollups generalize; counts only,
      // never currency
      try {
        appendFileSync(callsLedger, JSON.stringify({ ts: new Date().toISOString(), agentId: "driver",
          sessionKey, sessionId: sessionKey, tool: "search", target: `${spec.engine}:${platform}:${term}`,
          ok: Boolean(r?.ok), attempts: 1, took_ms: r?.tookMs ?? (Date.now() - started),
          bytes: Buffer.byteLength(JSON.stringify(hits)), cache_hit: false }) + "\n");
      } catch { /* receipts best-effort */ }
      return { term, platform, r, hits };
    });

    const cells = [];
    const gaps = [];
    const hitRows = [];
    // WHY the cells gapped, tallied by cause. The gap strings below are written to the grid
    // ledger — which the floor branch RETURNS BEFORE writing — so on the one path where the causes
    // matter most (a dead credential gaps every cell) they reached no artifact at all. The unit record
    // is the artifact that survives a degraded attempt, so the dominant cause goes there.
    const gapCauses = new Map();
    for (const { term, platform, r, hits } of results) {
      if (!r?.ok) {
        const cause = redactProviderCause(r?.cause ?? "unknown").slice(0, 200);
        gaps.push(`${term} | ${platform} | ${cause}`);
        gapCauses.set(cause, (gapCauses.get(cause) ?? 0) + 1);
        continue;
      }
      cells.push({ term, platform, status: hits.length ? "hit" : "no_hit",
        candidates: hits.map((h) => ({ title: String(h.title ?? "").slice(0, 300), url: String(h.url ?? "").slice(0, 600) })) });
      hits.forEach((h) => hitRows.push({ term, platform, title: String(h.title ?? "").slice(0, 300),
        url: String(h.url ?? "").slice(0, 600), displayedUrl: String(h.displayedUrl ?? "").slice(0, 300),
        snippet: String(h.snippet ?? "").slice(0, 400) }));
    }
    // a mostly-gaps grid is a failed attempt (credential outage, provider down) — retryable, never
    // frozen as done with a hollow ledger
    if (gaps.length > cellsIn.length * GAP_DEGRADE_FLOOR) {
      // the ratio alone says a grid failed; it never says a CREDENTIAL did. Name the dominant cause —
      // this branch is the one a dead SERPAPI_API_KEY takes, gapping 84/84 cells with one cause.
      const [topCause, topN] = [...gapCauses.entries()].sort((a, b) => b[1] - a[1])[0];
      degradeUnit(run.runDir, key, st.attempts,
        `${gaps.length}/${cellsIn.length} cells gapped — below the coverage floor; a resume retries. Dominant cause (${topN}/${gaps.length}): ${topCause}`);
      // THE CAUSE GOES TO BOTH SINKS OR THE FIELD IS THE ONLY PLACE IT EXISTS. This line used to end
      // "shadow-only, the run is unaffected" and carry no cause at all, while degradedCause beside it
      // held `SerpAPI 429: Your account has run out of searches.` Measured, not hypothesised: an
      // operator watching a real run learned a headline capability had failed and could not learn that
      // the fix was a subscription top-up somebody could do in five minutes. That is 's principle
      // one layer down — a discriminator that reaches a field and not the sentence anybody reads.
      note(shadowLaneNote("jx serp grid", "degraded", `${gaps.length}/${cellsIn.length} cells gapped: ${topCause}`,
        `attempt ${st.attempts + 1}/${MAX_UNIT_ATTEMPTS}`));
      return { ran: false, cause: "coverage floor" };
    }
    atomic(outPath, { cells, gaps });

    // The existing receipts-gate functions, verbatim, code-side (shadow — recorded, not enforced on
    // the run): every dictated term must account platforms.length cells, on the dictated platforms.
    const ledgerRaw = readFileSync(outPath, "utf8");
    const violations = [
      ...findGridLedgerViolations(spec.terms, ledgerRaw, { minCellsPerVariant: spec.platforms.length }),
      ...findPlatformIdentityViolations(spec.terms, ledgerRaw, spec.platforms),
    ];

    // Mirror demotion FIRST (code-side, deterministic): a register-mirror page never reaches the
    // judge, so no judgment can ever upgrade it to use. Checked on BOTH the link and displayed_link:
    // live Baidu wraps every organic link in a baidu.com redirect, so the real host only surfaces in
    // displayed_link (review 2026-07-18 — link-only demotion was a no-op on live data).
    const mirrors = [];
    const judgeable = [];
    hitRows.forEach((h, i) => {
      if (isMirrorHost(lane, h.url) || isMirrorHost(lane, h.displayedUrl)) mirrors.push({ ...h, classification: "register-mirror", note: "register-data mirror domain", demotedBy: "code (SERP_LANES mirror table)" });
      else judgeable.push({ ...h, id: i });
    });

    // The judge — classification only, chunked, degrade-to-unjudged (the grid + receipts stand).
    const { exec: judgeExec, source: judgeSource } = resolveJudge(opts, { mark: markName, lane });
    const judged = [];
    let judgeDegraded = null;
    for (let at = 0; at < judgeable.length && !judgeDegraded; at += 40) {
      const batch = judgeable.slice(at, at + 40);
      const started = Date.now();
      let jr;
      try { jr = await judgeExec({ mark: markName, hits: batch }); }
      catch (e) { jr = { ok: false, cause: `judge threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
      ledgerRow(run.runDir, { ts: new Date().toISOString(), lane, mark: markName, unit: "serp-judge", executor: judgeSource,
        ...jxBillingStamp(judgeSource, jr),
        took_ms: jr?.tookMs ?? (Date.now() - started), ok: Boolean(jr?.ok), judged: jr?.ok ? (jr.judgments?.length ?? 0) : 0,
        ...(jr?.model ? { model: jr.model } : {}),
        ...(jr?.usage ? { usage: jr.usage } : {}), ...(jr?.ok ? {} : { cause: String(jr?.cause ?? "unknown").slice(0, 300) }) });
      if (!jr?.ok) { judgeDegraded = String(jr?.cause ?? "unknown").slice(0, 200); break; }
      const byId = new Map(jr.judgments.map((j) => [j.id, j]));
      for (const h of batch) {
        const j = byId.get(h.id);
        judged.push({ ...h, classification: j?.classification ?? "unjudged", note: j?.note ?? (j ? "" : "judge returned no row for this hit") });
      }
    }
    if (judgeDegraded) for (const h of judgeable.slice(judged.length)) judged.push({ ...h, classification: "unjudged", note: `judge degraded: ${judgeDegraded}` });
    const findings = [...mirrors, ...judged].map(({ id, ...row }) => row);
    const tally = {};
    for (const f of findings) tally[f.classification] = (tally[f.classification] ?? 0) + 1;
    atomic(join(jxDir(run.runDir), `${lane}-grid-findings.json`), { schema: 1, lane, mark: markName, findings, tally,
      ...(judgeDegraded ? { judgeDegraded } : {}), judgedAt: new Date().toISOString() });

    writeUnit(run.runDir, key, { done: true, degraded: false, degradedCause: null,
      at: new Date().toISOString(), executor: source,
      terms: spec.terms.length, cells: cells.length, gaps: gaps.length, hits: hitRows.length,
      gates: { green: violations.length === 0, violations: violations.slice(0, 20) },
      judge: { judged: judged.filter((j) => j.classification !== "unjudged").length,
        unjudged: judged.filter((j) => j.classification === "unjudged").length,
        mirrors: mirrors.length, ...(judgeDegraded ? { degraded: judgeDegraded } : {}) } });
    // best-effort tail: the unit is DONE — a logging/stderr failure here must never reach the catch
    // and clobber the frozen record (review 2026-07-18)
    try {
      runLog(run.runDir, { event: "jx-serp-grid", lane, terms: spec.terms.length, cells: cells.length,
        gaps: gaps.length, hits: hitRows.length, mirrors: mirrors.length, gates_green: violations.length === 0 });
      note(`jx serp grid (shadow): ${cells.length} cells, ${hitRows.length} hits (${mirrors.length} mirror-demoted), ${gaps.length} gaps — receipts in _driver/jx/`);
    } catch { /* receipts best-effort */ }
    return { ran: true };
  } catch (e) {
    const cause = String(e?.message ?? e).slice(0, 300);
    try { degradeUnit(run.runDir, key, unitState(run.runDir, key).attempts ?? 0, cause); } catch { /* receipts best-effort */ }
    try { note(shadowLaneNote("jx serp grid", "NOT RUN", cause, "never-kill")); } catch { /* stderr best-effort */ }
    return { ran: false, cause };
  }
}

// ── Slice 3 — jx-nativeread:zh ──────────────────────────────────────────────────────────────────────
const URI_RE = /https?:\/\/[^\s|)\]"'<>]+/g;
const normUri = (u) => String(u).replace(/[.,;:!?]+$/, "");

/** Assemble the code-inlined zh evidence slice + the fetched-URI set it carries (pure over inputs). */
export function buildNativereadPayload({ registerSliceText = "", candidates = [], cnipaSubgroups = [], gridFindings = [] }) {
  const sections = [];
  if (candidates.length) sections.push("## Native-script candidates (generated for this run)\n"
    + candidates.map((c) => `- ${c.term} (${c.kind}) — ${String(c.rationale ?? "").slice(0, 200)}`).join("\n"));
  if (cnipaSubgroups.length) sections.push("## CNIPA sub-class notes (seed table — informational)\n"
    + cnipaSubgroups.map((g) => `- class ${g.class}: ${g.groups ? g.groups.join(", ") : (g.note ?? "no entry")}`).join("\n"));
  if (registerSliceText.trim()) {
    const truncated = registerSliceText.length > NATIVEREAD_SLICE_CAP;
    sections.push("## CN register slice (transliteration-numeric unit output" + (truncated ? ", truncated" : "") + ")\n"
      + registerSliceText.slice(0, NATIVEREAD_SLICE_CAP));
  }
  let gridRowsDropped = 0;
  if (gridFindings.length) {
    const rows = gridFindings.slice(0, NATIVEREAD_GRID_ROWS_CAP);
    gridRowsDropped = gridFindings.length - rows.length;
    sections.push("## Platform grid findings (judged)\n"
      + rows.map((f) => `- [${f.classification}] "${f.title}" — ${f.url} (term ${f.term} on ${f.platform})${f.note ? ` — ${f.note}` : ""}`).join("\n")
      + (gridRowsDropped ? `\n- … ${gridRowsDropped} more rows omitted (payload cap — full set in zh-grid-findings.json)` : ""));
  }
  const payload = sections.join("\n\n");
  // The grounding set is STRUCTURAL, never a regex over the rendered payload: a URL an attacker
  // plants inside a hit TITLE/snippet (or the model echoes in its own output) must not mint a
  // grounding URI (review 2026-07-18). Sources: the grid findings' url FIELDS (every one was
  // actually fetched and receipted, capped or not) + URIs in the register unit's own output (our
  // register machinery's text, the design's fetched set).
  const uris = new Set(gridFindings.map((f) => f?.url).filter(Boolean).map((u) => normUri(String(u))));
  for (const m of String(registerSliceText).slice(0, NATIVEREAD_SLICE_CAP).match(URI_RE) ?? []) uris.add(normUri(m));
  return { payload, uris, sections: sections.length, gridRowsDropped };
}

/** Grounding enforcement (pure): record_uri must come from the inlined slice; conflict-read and
 *  squatter-flag REQUIRE one. An ungrounded item is kept but demoted to a lead — visible, never
 *  authoritative. */
export function groundReadItems(items, uris) {
  const needsUri = new Set(["conflict-read", "squatter-flag"]);
  return items.map((it) => {
    if (it.record_uri != null && uris.has(normUri(it.record_uri))) return { ...it, grounded: true };
    if (it.record_uri != null) return { ...it, grounded: false, demoted: "lead", demotionCause: "record_uri not in the fetched slice" };
    if (needsUri.has(it.kind)) return { ...it, grounded: false, demoted: "lead", demotionCause: `${it.kind} requires a record_uri from the slice` };
    return { ...it, grounded: true };   // slice-wide notes (subclass/cultural) need no uri
  });
}

export async function runJxNativeread(ctx, job, opts = {}, { runLog = () => {}, note = () => {} } = {}) {
  const { run } = ctx;
  const lane = "zh";
  const key = `nativeread:${lane}`;
  try {
    // item 8 — CLEAROTRON_JX_NATIVEREAD is gone, same reasoning as the grid above.
    if (!laneEnvOn(lane)) return { ran: false, cause: `CLEAROTRON_NATIVE_LANGUAGE_${lane.toUpperCase()} off` };
    if (!ctx.jxLanes?.lanes?.[lane]) return { ran: false, cause: "no frozen zh lane decision (jurisdictions/policy)" };
    const st = unitState(run.runDir, key);
    if (st.skip) return { ran: false, cause: st.cause };

    // The read must see the SETTLED slice: while the slice-1 fold or an ARMED grid unit is still
    // degraded-but-retryable, freezing a read now would permanently exclude the evidence a resume
    // is about to produce — defer without burning an attempt (review 2026-07-18).
    if (foldRetryable(ctx, lane))
      return { ran: false, cause: "slice-1 fold degraded but retryable — deferring the read to a resume (no attempt burned)" };
    {
      // defer only on an EXISTING retryable-degraded grid record: an absent record means the grid
      // skipped structurally this pass (no terms/no capability) and will never produce findings —
      // deferring on that would wedge the read forever. The old `if (flag("CLEAROTRON_JX_SERP_GRID"))`
      // wrapper went with the arm ( item 8); the record test below was always the real condition,
      // and it is unchanged — an absent record still means "do not defer".
      const grid = readUnits(run.runDir).units?.[`serp-grid:${lane}`];
      if (grid && !grid.done && (grid.attempts ?? 0) < MAX_UNIT_ATTEMPTS)
        return { ran: false, cause: "serp grid armed but not settled — deferring the read to a resume (no attempt burned)" };
    }

    const markName = String(job.markName ?? job.name ?? "").trim();
    let registerSliceText = "";
    try { registerSliceText = readFileSync(join(run.runDir, "register-units", "transliteration-numeric.md"), "utf8"); } catch { /* unit may not exist */ }
    const fold = ctx.jxLanes?.fold?.lanes?.[lane] ?? {};
    let gridFindings = [];
    try { gridFindings = JSON.parse(readFileSync(join(jxDir(run.runDir), `${lane}-grid-findings.json`), "utf8"))?.findings ?? []; } catch { /* grid unit may be off */ }
    const { payload, uris, sections, gridRowsDropped } = buildNativereadPayload({
      registerSliceText, candidates: fold.accepted ?? [], cnipaSubgroups: fold.cnipaSubgroups ?? [], gridFindings });
    if (!sections) return { ran: false, cause: "no zh evidence to read (no register slice, candidates or grid findings)" };

    const { exec, source } = resolveNativeread(opts, { mark: markName, lane });
    const started = Date.now();
    let r;
    try { r = await exec({ mark: markName, lane, payload }); }
    catch (e) { r = { ok: false, cause: `executor threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
    ledgerRow(run.runDir, { ts: new Date().toISOString(), lane, mark: markName, unit: "nativeread", executor: source,
      ...jxBillingStamp(source, r),
      took_ms: r?.tookMs ?? (Date.now() - started), ok: Boolean(r?.ok), items: r?.ok ? (r.items?.length ?? 0) : 0,
      ...(r?.model ? { model: r.model } : {}),
      ...(r?.usage ? { usage: r.usage } : {}), ...(r?.ok ? {} : { cause: String(r?.cause ?? "unknown").slice(0, 300) }) });
    if (!r?.ok) {
      degradeUnit(run.runDir, key, st.attempts, r?.cause ?? "unknown");
      note(shadowLaneNote("jx nativeread", "degraded", String(r?.cause ?? "unknown"), `attempt ${st.attempts + 1}/${MAX_UNIT_ATTEMPTS}`));
      return { ran: false, cause: r?.cause };
    }

    const items = groundReadItems(r.items ?? [], uris);
    const grounded = items.filter((i) => i.grounded).length;
    mkdirSync(jxDir(run.runDir), { recursive: true });
    atomic(join(jxDir(run.runDir), "nativeread.json"), { schema: 1, lane, mark: markName, items, sections,
      ...(gridRowsDropped ? { gridRowsDropped } : {}), readAt: new Date().toISOString() });
    // the aim-attention artifact — the ONLY thing the Phase-5 consume flag will ever surface to
    // synthesis; the header restates the authority rule so the artifact is self-describing
    atomic(join(jxDir(run.runDir), "aim-attention.json"), {
      schema: 1, lane,
      note: "aim-attention only: these flags AIM the synthesis lawyer's attention; severity_hint is triage, NEVER a rating — the customer framework and Claude synthesis remain the sole rating authority",
      items,
    });
    writeUnit(run.runDir, key, { done: true, degraded: false, degradedCause: null,
      at: new Date().toISOString(), executor: source,
      items: items.length, grounded, leads: items.length - grounded, sections });
    // best-effort tail: the unit is DONE — a logging/stderr failure must never reach the catch and
    // clobber the frozen record (review 2026-07-18)
    try {
      runLog(run.runDir, { event: "jx-nativeread", lane, items: items.length, grounded, leads: items.length - grounded });
      note(`jx nativeread (shadow): ${items.length} items (${grounded} grounded, ${items.length - grounded} demoted to leads) — _driver/jx/aim-attention.json`);
    } catch { /* receipts best-effort */ }
    return { ran: true };
  } catch (e) {
    const cause = String(e?.message ?? e).slice(0, 300);
    try { degradeUnit(run.runDir, key, unitState(run.runDir, key).attempts ?? 0, cause); } catch { /* receipts best-effort */ }
    try { note(shadowLaneNote("jx nativeread", "NOT RUN", cause, "never-kill")); } catch { /* stderr best-effort */ }
    return { ran: false, cause };
  }
}

// ── The synthesis consume seam ──────────────────────────────────────────────────────────────────────
/** The synthesis aim-attention pointer: {count} when the zh lane is not killed AND the artifact carries
 *  items; null otherwise.
 *
 * item 8 — CLEAROTRON_JX_CONSUME is gone. It was the Phase-5 flip, default OFF in source and ON in
 *  production since 2026-08-04, which is the definition of a dark switch: the shipped default described
 *  a configuration nobody ran.
 *
 *  `laneEnvOn("zh")` STAYS, and deleting it would have been the mistake. The CLEAROTRON_JX_LANES master leg
 *  was retired 2026-07-27 and the reason this leg was kept still holds: an incident kill must also
 *  silence a STALE artifact from an earlier run, not merely stop the next one. That is a switch someone
 *  WOULD use, once, in an incident — the opposite of a dark one — so item 12's remedy applies instead of
 *  item 8's: it is DECLARED rather than deleted. */
export function jxAimForSynthesis(runDir) {
  if (!laneEnvOn("zh")) return null;
  try {
    const a = JSON.parse(readFileSync(join(jxDir(runDir), "aim-attention.json"), "utf8"));
    const n = (a?.items ?? []).length;
    return n ? { count: n } : null;
  } catch { return null; }
}
