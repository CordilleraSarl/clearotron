// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-economics.mjs — the three instruments commissioned, at TOKEN level: cost reconstruction,
// emitted-vs-landed, quoted-vs-actual. Reads ONE run dir and nothing else.
//
// NO CURRENCY, ANYWHERE, DELIBERATELY. The issue's first acceptance criterion asked for "a cost figure
// matching the provider bill within rounding". Two standing rules refuse that here: the driver tracks
// tokens only (owner directive 2026-07-11 — the price table and costUsd were deleted, see
// driver.config.mjs and engine/CONTRACT.md §6), and internal surfaces carry no money. So this module
// produces everything a money figure would need EXCEPT the rates: per dispatch, per stage, per matter,
// token counts split by BILLING CLASS and tagged with the billing path that would price them. The
// multiplication is one ruling away and is not made here. (`billingClass`, not "price class": the
// repo's currency guard forbids keys matching /usd|price|cost|[$]/i, and the concept is the same one —
// the provider's four separately-priced token kinds.)
//
// ── WHAT A "DISPATCH" IS ──────────────────────────────────────────────────────────────────────────
// One model invocation: one row in `_driver/<stage>.jsonl` carrying a `model` (gateway.mjs writes one
// per ATTEMPT, so retries are separate dispatches and retry waste is counted, not averaged away). The
// direct-API jx lanes bypass the gateway and write `_driver/jx-completions.jsonl` in the same
// {model, usage} shape; they are dispatches too, under stage `jx-completions`. `run.jsonl` is skipped
// (run events, not dispatches) — same file selection as tokens.mjs, deliberately.
//
// ── ZERO SEMANTICS: THE THING THIS MODULE EXISTS TO GET RIGHT ─────────────────────────────────────
// tokens.mjs sums `usage` with `u.output || 0`, so a dispatch whose usage is null contributes zero AND
// still increments `attempts` — a run reads as having spent nothing on it. That is not hypothetical:
// on a 2026-07-29 production clearance, the register-digest stage's second attempt ran 485 SECONDS on
// opus, was killed (code 143), journalled `usage: null`, and rolled up as 0 tokens. A matter total that
// reads "complete" while three of its dispatches never recorded is worse than no instrument at all.
//
// So every total here is three-valued about its own completeness, in the shape provider-usage.mjs
// already uses for `unclassified` — the absence is counted, named and carried beside the number:
//   measured   — the dispatch journalled a usage object (from the provider's own result envelope)
//   streamed   — usage present but RECONSTRUCTED from the stream (`signals.usageStreamed`), because the
//                turn died before its result event. A real measurement, a weaker one, counted apart.
//   unmeasured — the row is a dispatch (it has a model) and carries no usage at all. THE KILLED TURNS.
// `tokensComplete` is false whenever `unmeasured > 0`, at run level and per stage, and
// `unmeasuredDispatches[]` names which ones so a reader can see what the total is missing.
//
// ── EMITTED-VS-LANDED: ONE DEFINITION, AND IT IS THE ONE ALREADY MEASURED ─────────────────────────
//   landedShare = landedBytes / (emittedOutputTokens × BYTES_PER_OUTPUT_TOKEN)
//     emittedOutputTokens — Σ usage.output over every dispatch of the stage (all attempts)
//     landedBytes         — the size of the stage's artifact as last journalled present on a dispatch
//                           row (`output.size`, log.mjs outputMeta): the durable bytes a reader gets
//
// This reproduces the figure the codebase already records. repair-contract.mjs:15-18 pins the 07-30
// register-digest settlement flush: three attempts emitting 105,747 + 137,519 + 36,362 = 279,628 output
// tokens against a final register-findings.md of 160,913 B; 160,913/4 = 40,228 token-equivalents, i.e.
// 14% landed / 86% did not — the "~13%, meaning ~87% of paid emission produced nothing a reader sees"
// that issue quotes. Matching the recorded method was a requirement, not a preference.
//
// The ÷4 is an ASSUMPTION and is fenced as one. `emittedOutputTokens` and `landedBytes` are the
// measurement and are always present; `landedShare` is DERIVED and carries `landedShareBasis` plus
// `bytesPerOutputTokenAssumed` on the same object, so a reader can recompute at a different divisor and
// nobody can mistake the constant for something that was measured.
//
// WHAT IT CANNOT SPLIT. asks for "landed versus thinking/discarded". Thinking is billed inside
// output_tokens and is never broken out (engine/CONTRACT.md §2: no reasoning count exists anywhere in
// the payload, which is why the `reasoningTokens` slot was deleted rather than left reading 0). So the
// split is landed-vs-not-landed. Thinking is inside the "not landed" side and cannot be separated from
// discarded prose. `thoughtTurns` says only whether thinking engaged.
//
// A second, independent view rides along because `wrote` is already on the row and it costs nothing:
// `emittedOnDispatchesThatWroteNothing` — output tokens spent by dispatches that moved no artifact at
// all. That is not the 07-30 metric (the R2 attempts DID write; they retyped) and is not the headline.
//
// ── QUOTED-VS-ACTUAL: MOSTLY A RECORD OF WHAT CANNOT BE COMPARED ─────────────────────────────────
// The quote has six dimensions. Exactly ONE of them has a measured counterpart in the run artifacts
// (turnaroundHours ↔ wall). `units`, `raw` and `costBand` are an owner-relative estimate scale with no
// physical counterpart; `searches` and `gridCalls` are product-shaped counts whose correspondence to
// provider calls is not 1:1, and asserting one would manufacture exactly the kind of number this batch
// exists to stop trusting. Each unmeasurable dimension is emitted with `actual: null` AND a reason.
// Declaring the gap IS the deliverable: the quote and the measurement are nearly disjoint, and a
// calibration fitted across them today would be fitting one dimension. What the run actually consumed
// sits beside it in `tokens` and `dispatchCensus` — measured, and never predicted by the quote.
//
// ── MODEL PROVENANCE: THE INSTRUMENT DECLARES ITS OWN WEAKNESS ───────────────────────────────────
// `modelBasis: "requested"` on every record, and that is still true of THIS MODULE — but the reason has
// changed and half of it is now fixable.
//
// It used to be unfixable: `modelUsed` was a pure function of the requested alias, nothing anywhere read
// the provider's response, and claudeModel() fell through to "sonnet" for any alias it did not
// recognise — so an unhonoured override ran sonnet, logged the alias, and no record disagreed.
//
// closed that. The adapters read the wire (claude's `system:init.model` and each `assistant`
// message's `message.model`), a family mismatch now FAILS the turn, and every dispatch row carries
// `modelActual` + `modelBasis` ("actual" | "unknown") + `modelMismatch` beside the unchanged
// `modelUsed`. So the rows can now answer "what ran", per record, wherever the wire reported.
//
// What has NOT changed is this module: `byBilling` / `byStage` / `dispatches` still key on `modelUsed`,
// i.e. on what was asked for. Switching them to prefer `modelActual` is 's call, not a side effect
//, and it cannot be a blanket flip — codex reports no model, and a killed turn may have none,
// so a per-record basis is the only honest shape. `tokens.mjs` keys its rollup on the requested alias
// for the same reason and is likewise untouched.
//
// Pure by contract: `runEconomics()` reads the run dir and nothing else — no env, no config, no network,
// no driver imports. `stampRunEconomics()` is the only part that writes.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { runLog, note } from "./log.mjs";
import { writeRunStatus } from "./progress.mjs";

/**
 * The provider's separately-priced token kinds, in the driver's own `usage` vocabulary (gateway.mjs /
 * engine/CONTRACT.md §2). Four, not three: uncached `input` is small in practice (2,325 of 17.6M on the
 * 08-02 R1 run) but it is a class of its own and dropping it would be a silent rounding decision.
 *
 * NO RATES HERE, AND NONE MAY BE ADDED. The classes price roughly an order of magnitude apart, which is
 * why they are split — what they price AT is a ruling nobody has made.
 */
export const BILLING_CLASSES = ["input", "output", "cacheWrite", "cacheRead"];

/**
 * The bytes-per-output-token divisor used to put landed bytes and emitted tokens in one unit. An
 * ASSUMPTION, exported so a caller can override it and stamped onto every record that uses it. 4 is what
 * reproduces the 07-30 measurement (see the header).
 */
export const BYTES_PER_OUTPUT_TOKEN = 4;

const emptyClasses = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

const emptyCensus = () => ({ total: 0, measured: 0, streamed: 0, unmeasured: 0, codeSide: 0 });

// A code-side dispatch: the driver executed the stage itself (the saturation probe's direct plan
// executor, pipeline.mjs) and no model ran. It journals `model: "code"` / `modelUsed: "code:execute-plan"`
// and no usage — an absence that is a MEASUREMENT, not a gap, and must not be counted with the killed
// turns. Verified on both a production run and the 08-02 R1 run: one such row each, and without this
// branch both runs read as "token total incomplete" when nothing was actually missed.
// EXPORTED so `tokens.mjs` shares this one definition rather than keeping a second copy. Two
// copies of the same predicate is how `byBilling` and `byEngine` came to disagree about the same dispatch
// in the first place: the branch landed here and never reached the sibling module. A duplicate would go
// stale the moment the code-side marker changes, and re-open the exact defect reports.
export const isCodeSide = (rec) => rec.model === "code" || String(rec.modelUsed ?? "").startsWith("code:");

// What a dispatch row says about the artifact after it ran. FOUR outcomes, because three different
// writers use three different vocabularies and collapsing them is how an absence becomes a pass:
//   "none"     — `output: null`: the stage declares no output file (log.mjs outputMeta)
//   "landed"   — bytes are on disk; `size` is them
//   "absent"   — an output was expected and is not there
//   "no-record" — the row carries no `output` key at all: it predates the AD-4 gauge (2026-07-30) and
//                 claims nothing either way
// The code-side lane still writes fileMeta, which has NO `present` key — {sha,size} where a non-null
// sha means those bytes were read off disk and sha:null means they were not. Read as recorded rather
// than defaulted, or every code-side stage reports "never landed" while holding a real artifact.
function outputStateOf(rec) {
  if (!("output" in rec)) return { kind: "no-record" };
  const o = rec.output;
  if (o === null || o === undefined) return { kind: o === null ? "none" : "no-record" };
  if (o.present === true) return { kind: "landed", size: Number(o.size) };
  if (o.present === false) return { kind: "absent" };
  if (typeof o.sha === "string" && o.sha) return { kind: "landed", size: Number(o.size) };   // fileMeta shape
  return { kind: "absent" };
}

// A dispatch's usage, three-valued: an object when the row measured something, null when it did not.
// `u.output || 0` is fine INSIDE this (a present usage object with a missing field really is 0 of that
// class); what must never happen is a null usage silently becoming four zeros, which is why the caller
// branches on the null rather than calling this unconditionally.
function classesOf(usage) {
  const u = usage || {};
  const anyNumber = ["input", "output", "cacheRead", "cacheWrite", "total"].some((k) => Number.isFinite(Number(u[k])));
  if (!anyNumber) return null;
  return { input: Number(u.input) || 0, output: Number(u.output) || 0,
    cacheWrite: Number(u.cacheWrite) || 0, cacheRead: Number(u.cacheRead) || 0 };
}

function addClasses(into, c) {
  for (const k of BILLING_CLASSES) into[k] += c[k];
}

// The billing identity of a dispatch: which engine ran it, under which billing mode, on which model.
// All three come off the row as recorded; a row that predates a stamp buckets as "unknown" rather than
// being guessed at or dropped, so every bucket sums back to the total and the unattributed share stays
// visible (the same rule tokens.mjs byEngine follows).
function billingKeyOf(rec) {
  // A code-side row states in its own `model` that no model ran, so it is bucketed as what it says it
  // is rather than dragged into "unknown" beside genuinely unstamped legacy rows.
  const engine = isCodeSide(rec) ? "code" : String(rec.engine ?? "unknown");
  const authMode = isCodeSide(rec) ? "not-provider-billed" : String(rec.authMode ?? "unknown");
  const model = String(rec.modelUsed ?? rec.model ?? "unknown");
  return { engine, authMode, model, key: `${engine}|${authMode}|${model}` };
}

function emptyStage() {
  return {
    dispatches: emptyCensus(),
    tokens: emptyClasses(),
    tokensComplete: true,
    byBilling: {},                 // billingKey → { engine, authMode, model, dispatches, tokens }
    thoughtTurns: 0,
    emittedOutputTokens: 0,
    emittedOnDispatchesThatWroteNothing: 0,
    landedBytes: null,
    landedBytesReason: "no dispatch row on this stage journalled an output record",
    landedShare: null,
    landedShareReason: null,
  };
}

function foldBilling(bucketMap, rec, cls) {
  const { engine, authMode, model, key } = billingKeyOf(rec);
  const b = (bucketMap[key] ??= { engine, authMode, model, dispatches: 0, tokens: emptyClasses() });
  b.dispatches += 1;
  if (cls) addClasses(b.tokens, cls);
  return b;
}

// ── — A VENDOR IS NOT AN ENGINE ──────────────────────────────────────────────────────────────
//
// The set below was built from `engine` and the field was named `vendors`. On an Anthropic round the jx
// lanes stamp `anthropic-direct` while agentic stages stamp `anthropic-agent`: two ENGINES, one VENDOR.
// So the first jx-bearing run after the API-key split was fixed reported TWO vendors and declared it
// could not name one — a run that had spent entirely with Anthropic. The count was right about the
// engines and wrong about the question the receipt asks.
//
// BOTH ARE KEPT. Collapsing engines into vendors and reporting only the vendor would answer by
// destroying the evidence that raised it — the engine split is real and worth reading. `engines` carries
// what was stamped; `vendors` carries who was billed; `mixedVendors` flags the second, which is the one
// the owner rules on.
//
// A CLOSED TABLE, NOT A PREFIX RULE. `anthropic-*` → anthropic is shorter and would silently adopt any
// future engine whose name began that way, which is how a vendor claim becomes a guess. An engine this
// table does not know is reported BY NAME and blocks the single-vendor claim, because "I do not know who
// billed this" and "one vendor" are different answers and only one of them is safe to print.
export const ENGINE_VENDORS = Object.freeze({
  "anthropic-agent": "anthropic",
  "anthropic-direct": "anthropic",
  "anthropic-completions": "anthropic",
  "openai-agent": "openai",
});
/** The vendor an engine bills to, or null when the table does not name one. */
export const vendorOf = (engine) => ENGINE_VENDORS[String(engine ?? "")] ?? null;

// ── WHAT THE RUN CANNOT SAY ABOUT ITSELF ──────────────────────────────────────────────────
//
// `byBilling` PROVES the composition; it never STATES it. A reader has to notice that two of three keys
// differ in their second field and work out the consequence — and that inference, made by hand off a live
// receipt, is what raised. The statement is therefore derived here, from the same buckets, and
// travels beside them: it cannot drift from the numbers it describes because it has no other source.
//
// CODE-SIDE IS NOT A VENDOR. `code:execute-plan` rides nearly every run (the driver executes the frozen
// plan itself), stamps `authMode: "not-provider-billed"`, and costs no provider tokens. Counting it would
// make every run in the product read as multi-vendor — the same defect as 's `web` channel, where a
// member the driver always adds made every run look unplanned. Provider-billed rows only, and the count
// of what was set aside is reported so the exclusion is visible rather than assumed.
//
// UNSTAMPED IS NOT A VENDOR EITHER, and it is not nothing. `billingKeyOf` buckets a row with no engine as
// `unknown|unknown`, which keeps the arithmetic honest, but "unknown" must never be listed as if it were
// a vendor's name. Those dispatches are counted apart, and while any exist the run says its composition
// is INCOMPLETE — a two-vendor answer drawn from rows that were only two-thirds attributed is a guess
// wearing a number's clothes.
//
// THREE-VALUED, like every other total in this module. No telemetry is "unknown", never "one vendor".
//
// AND IT IS WRITTEN ON A SINGLE-VENDOR RUN TOO. If the field appeared only when mixed, its absence would
// read as a statement of purity — indistinguishable from a run that never computed it. An absence must
// not be the answer to the question this issue asks.
export function billingComposition(byBilling, opts) {
  // `= {}` defaults on undefined and NOT on null — the shape-fuzz finding, applied at write time.
  const { telemetryPresent = true } = opts ?? {};
  const buckets = Object.values(byBilling ?? {});
  if (!telemetryPresent || buckets.length === 0) {
    return {
      basis: "unknown",
      vendors: [], engines: [], unmappedEngines: [], billingModes: [],
      mixedVendors: null, mixedBillingModes: null,
      unattributedDispatches: 0, notProviderBilledDispatches: 0, complete: false,
      statement: telemetryPresent
        ? "this run journalled no dispatches, so it states nothing about vendor or billing mode"
        : "this run has no dispatch telemetry, so it states nothing about vendor or billing mode",
    };
  }

  const notProviderBilled = buckets.filter((b) => b.authMode === "not-provider-billed");
  const billed = buckets.filter((b) => b.authMode !== "not-provider-billed");
  const unattributed = billed.filter((b) => b.engine === "unknown" || b.authMode === "unknown");
  const named = billed.filter((b) => !unattributed.includes(b));

  const dispatchesOf = (list) => list.reduce((n, b) => n + (b.dispatches ?? 0), 0);
  const engines = [...new Set(named.map((b) => b.engine))].sort();
  const vendors = [...new Set(engines.map(vendorOf).filter(Boolean))].sort();
  // An engine the table cannot place. Never folded into `vendors` and never silently dropped: it is the
  // one input that can make a true single-vendor claim false, so it is named and it blocks the claim.
  const unmappedEngines = engines.filter((e) => !vendorOf(e)).sort();
  const billingModes = [...new Set(named.map((b) => b.authMode))].sort();
  const unattributedDispatches = dispatchesOf(unattributed);
  const complete = unattributedDispatches === 0;

  const list = (xs) => xs.join(", ");
  let statement;
  if (vendors.length === 0) {
    statement = "no dispatch on this run carried a billing stamp, so it cannot name a vendor or a billing mode";
  } else {
    const v = vendors.length === 1 ? `one vendor (${vendors[0]})` : `${vendors.length} vendors (${list(vendors)})`;
    const m = billingModes.length === 1 ? `one billing mode (${billingModes[0]})` : `${billingModes.length} billing modes (${list(billingModes)})`;
    // The engine detail rides along on a single-vendor run too, because "one vendor, two engines" is the
    // exact shape was misread as multi-vendor and a reader should be able to see it without
    // reopening byBilling.
    // ON BOTH BRANCHES. A mixed run needs the engine names as much as a pure one — more, because the
    // reader is being told a composition and the engines are how they check it against byBilling.
    const e = engines.length > 1 ? `, over ${engines.length} engines (${list(engines)})` : "";
    statement = vendors.length > 1 || billingModes.length > 1
      ? `this run spent across ${v} under ${m}${e}, so it CANNOT state a single vendor or billing mode`
      : `this run spent on ${v} under ${m}${e}`;
  }
  if (unmappedEngines.length) {
    statement += `; ${unmappedEngines.length} engine(s) bill to no vendor this build can name (${list(unmappedEngines)})`
      + `, so the vendor above is NOT the whole run`;
  }
  if (unattributedDispatches > 0) {
    statement += `; ${unattributedDispatches} dispatch(es) carried no billing stamp and are counted apart, so this composition is INCOMPLETE`;
  }

  return {
    basis: "byBilling",
    vendors, engines, unmappedEngines, billingModes,
    // FLAGGED ON THE VENDOR, not the engine — criterion 1. An unplaceable engine counts against a
    // single-vendor claim: the run cannot state ONE vendor while part of its spend belongs to nobody.
    mixedVendors: vendors.length > 1 || unmappedEngines.length > 0,
    mixedBillingModes: billingModes.length > 1,
    unattributedDispatches,
    notProviderBilledDispatches: dispatchesOf(notProviderBilled),
    complete,
    statement,
  };
}

// Read every JSONL line of a _driver file, tolerating a torn concurrent append. Never throws.
function readRows(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  const out = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try { out.push(JSON.parse(ln)); } catch { /* torn line — skip, never throw */ }
  }
  return out;
}

// The frozen quote, from the run's own journal. pipeline.mjs writes {event:"quote", ...quote} onto
// run.jsonl at run start, which makes the quote a property of the RUN DIR — no ctx needed, so a rollup
// recomputed weeks later reads the same number the requester was shown. The knockout lane computes no
// quote at all and legitimately has no row.
function readQuote(runDir) {
  const rows = readRows(driverDir(runDir, "run.jsonl"));
  if (!rows) return null;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]?.event === "quote") {
    const { event, ts, ...q } = rows[i];
    return q;
  }
  return null;
}

function readStatus(runDir) {
  try { return JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")) ?? null; }
  catch { return null; }
}

/**
 * When the run ENDED, for the wall figure — and never `Date.now()` on a run that is already over.
 *
 * A live terminal passes its own clock and that is the truth. A RECOMPUTE weeks later has no clock of
 * its own: measuring to `Date.now()` there reports a delivered run's turnaround as the time since it
 * started. Measured on eleven real delivered runs — 1.2-7.7 actual hours were reported as 122-837.
 * Without this the record is a function of WHEN YOU RAN IT, not of the run dir, and the claim that it
 * recomputes identically weeks later is false. The basis says which stamp was used.
 */
function resolveEndedAt(status, now) {
  if (now != null) return { at: now, basis: "terminal" };
  for (const [field, label] of [["deliveredAt", "status.deliveredAt"], ["updatedAt", "status.updatedAt"]]) {
    const t = status?.[field] != null ? new Date(status[field]).getTime() : NaN;
    if (Number.isFinite(t)) return { at: t, basis: label };
  }
  return { at: Date.now(), basis: "recompute clock — status.json carries no terminal timestamp, so this figure is time-since-start, not turnaround" };
}

// Every quoted dimension, paired with a measured actual where one exists and with a NAMED REASON where
// none does. A dimension with no counterpart is the honest output here — see the header.
const UNMEASURABLE = {
  units: "an owner-relative 1-10 estimate scale — nothing the run produces is denominated in it",
  raw: "the absolute effort estimate — an input to the scale, not a physical quantity the run emits",
  costBand: "a 1-5 display band derived from the estimate — no measured counterpart exists",
  searches: "quoted searches are PRODUCT units (what the customer bought); no run artifact records a comparable count, and mapping them onto provider calls or model dispatches would be an invented correspondence",
  gridCalls: "quoted grid calls are a sizing term; the provider-call ledger counts calls of a different shape and the two are not 1:1",
  checksPerName: "a per-name marketplace fan-out constant, not an outcome",
};

/**
 * Quoted-vs-actual, in UNITS — never money, and never a fabricated counterpart.
 *
 * `actualHours` is WALL from status.json `startedAt` (written once at seed, never rewritten by a resume)
 * to `now`, so it spans rate-limit postpones and recovery parks where nothing was running. Same basis
 * run-quote.mjs::reconcileTurnaround uses and labels; stated here too so this record stands alone.
 */
export function quotedVsActual({ quote = null, startedAt = null, endedAt = Date.now(), endedAtBasis = "terminal" } = {}) {
  const dimensions = {};
  let measurable = 0, unmeasurable = 0;

  let actualHours = null;
  if (startedAt != null) {
    const t = new Date(startedAt).getTime();
    if (Number.isFinite(t) && endedAt >= t) actualHours = Number(((endedAt - t) / 3600000).toFixed(2));
  }
  const quotedHours = Number.isFinite(quote?.turnaroundHours) ? quote.turnaroundHours : null;
  dimensions.turnaroundHours = {
    quoted: quotedHours,
    actual: actualHours,
    ratio: quotedHours != null && quotedHours > 0 && actualHours != null
      ? Number((actualHours / quotedHours).toFixed(2)) : null,
    actualBasis: actualHours != null ? `wall:status.startedAt→${endedAtBasis}` : null,
    actualIncludesParked: actualHours != null ? true : null,
    reason: actualHours != null ? null : (startedAt == null
      ? "status.json carries no startedAt — the wall could not be measured"
      : "status.json startedAt is unreadable or in the future"),
  };
  measurable += 1;

  for (const [dim, reason] of Object.entries(UNMEASURABLE)) {
    dimensions[dim] = { quoted: quote?.[dim] ?? null, actual: null, reason };
    unmeasurable += 1;
  }

  return {
    quoted: quote ?? null,
    quoteSource: quote ? "_driver/run.jsonl:{event:\"quote\"}" : null,
    quoteReason: quote ? null
      : "no {event:\"quote\"} row on _driver/run.jsonl — this run was never sized (the knockout lane computes no quote)",
    unitsVersion: quote?.unitsVersion ?? null,
    dimensions,
    measurable,
    unmeasurable,
  };
}

/**
 * The whole record for one run, computed from its run dir alone. Never throws: an unreadable dir yields
 * an empty record whose census says nothing was measured, which is a different fact from "cost 0" and
 * is recorded as one.
 *
 * @param {string} runDir
 * @param {{now?:number, bytesPerOutputToken?:number}} [opts]
 */
export function runEconomics(runDir, { now = null, bytesPerOutputToken = BYTES_PER_OUTPUT_TOKEN } = {}) {
  const dDir = driverDir(runDir);
  const status = readStatus(runDir);
  const ended = resolveEndedAt(status, now);
  const byStage = {};
  const dispatches = [];
  const unmeasuredDispatches = [];
  const census = emptyCensus();
  const tokens = emptyClasses();
  const byBilling = {};
  let thoughtTurns = 0;

  let files = null;
  try { files = readdirSync(dDir).filter((f) => f.endsWith(".jsonl") && f !== "run.jsonl"); }
  catch { files = null; }

  for (const file of files ?? []) {
    const stage = file.replace(/\.jsonl$/, "");
    const rows = readRows(join(dDir, file));
    if (!rows) continue;
    const st = (byStage[stage] ??= emptyStage());
    // Last-present-wins: the attempt rows are append-ordered, `output` is the artifact state AFTER that
    // attempt, so the last row that saw the file present describes the durable bytes a reader gets.
    let lastPresentSize = null;
    let sawOutputRecord = false;
    let sawDeclaredNoOutput = false;

    for (const rec of rows) {
      if (!rec || typeof rec.model !== "string") continue;   // only dispatch rows carry a model
      const cls = classesOf(rec.usage);
      const streamed = cls != null && rec.signals?.usageStreamed === true;

      const codeSide = isCodeSide(rec);
      for (const c of [census, st.dispatches]) {
        c.total += 1;
        if (codeSide) c.codeSide += 1;
        else if (cls == null) c.unmeasured += 1;
        else if (streamed) c.streamed += 1;
        else c.measured += 1;
      }
      if (cls) { addClasses(tokens, cls); addClasses(st.tokens, cls); }
      foldBilling(byBilling, rec, cls);
      foldBilling(st.byBilling, rec, cls);
      if (rec.signals?.thought === true) { thoughtTurns += 1; st.thoughtTurns += 1; }
      if (cls) {
        st.emittedOutputTokens += cls.output;
        if (rec.wrote === false) st.emittedOnDispatchesThatWroteNothing += cls.output;
      }

      // emitted-vs-landed inputs — see outputStateOf for the four outcomes and why they stay distinct.
      const outState = outputStateOf(rec);
      if (outState.kind !== "no-record") sawOutputRecord = true;
      if (outState.kind === "none") sawDeclaredNoOutput = true;
      if (outState.kind === "landed" && Number.isFinite(outState.size)) lastPresentSize = outState.size;

      const { engine, authMode, model } = billingKeyOf(rec);
      if (dispatches.length < 500) {
        dispatches.push({
          stage, attempt: rec.attempt ?? null, ts: rec.ts ?? null,
          engine, authMode, model,
          tokens: cls,                                  // null = this dispatch measured nothing
          usageBasis: cls == null ? null : (streamed ? "stream-reconstructed" : "provider-result"),
          outputTokens: cls?.output ?? null,
          landedBytes: outState.kind === "landed" ? outState.size : null,
          wrote: rec.wrote ?? null,
          wall: Number.isFinite(Number(rec.wall)) ? Number(rec.wall) : null,
          fail: rec.fail ?? null,
        });
      }
      if (!codeSide && cls == null && unmeasuredDispatches.length < 200) {
        // WHAT the total is missing, not just how many: a 485-second opus turn that journalled no usage
        // is the single most expensive thing a rollup can round to zero.
        unmeasuredDispatches.push({
          stage, attempt: rec.attempt ?? null, model,
          wall: Number.isFinite(Number(rec.wall)) ? Number(rec.wall) : null,
          code: rec.code ?? null, fail: rec.fail ?? null, killed: rec.killed === true || undefined,
        });
      }
    }

    st.tokensComplete = st.dispatches.unmeasured === 0;
    if (lastPresentSize != null) {
      st.landedBytes = lastPresentSize;
      st.landedBytesReason = null;
    } else if (sawDeclaredNoOutput) {
      st.landedBytesReason = "the stage declares no output file — it emitted into the conversation, not onto disk";
    } else if (sawOutputRecord) {
      st.landedBytesReason = "an output was expected and never landed on any attempt";
    } // else: the default reason (no output record at all — a row predating the gauge) stands

    if (st.landedBytes != null && st.emittedOutputTokens > 0) {
      st.landedShare = Number((st.landedBytes / (st.emittedOutputTokens * bytesPerOutputToken)).toFixed(4));
    } else {
      st.landedShareReason = st.landedBytes == null ? st.landedBytesReason
        : "the stage journalled no emitted output tokens to compare against";
    }
  }

  const emittedOutputTokens = Object.values(byStage).reduce((n, s) => n + s.emittedOutputTokens, 0);
  const stagesWithLanded = Object.entries(byStage).filter(([, s]) => s.landedBytes != null);
  const stagesWithoutLanded = Object.entries(byStage).filter(([, s]) => s.landedBytes == null).map(([k]) => k);
  const landedBytes = stagesWithLanded.reduce((n, [, s]) => n + s.landedBytes, 0);

  const emittedVsLanded = {
    emittedOutputTokens,
    landedBytes: stagesWithLanded.length ? landedBytes : null,
    landedBytesFromStages: stagesWithLanded.length,
    stagesWithoutLandedRecord: stagesWithoutLanded,
    // The numerator is a FLOOR whenever a stage could not report its landed bytes, so the share is a
    // lower bound and says so rather than reading as a measurement.
    landedShareIsFloor: stagesWithoutLanded.length > 0,
    landedShare: stagesWithLanded.length && emittedOutputTokens > 0
      ? Number((landedBytes / (emittedOutputTokens * bytesPerOutputToken)).toFixed(4)) : null,
    landedShareBasis: "landedBytes / (emittedOutputTokens * bytesPerOutputTokenAssumed)",
    bytesPerOutputTokenAssumed: bytesPerOutputToken,
    emittedOnDispatchesThatWroteNothing: Object.values(byStage)
      .reduce((n, s) => n + s.emittedOnDispatchesThatWroteNothing, 0),
    // Named, because "landed vs thinking/discarded" was asked for and only half of it is knowable.
    thinkingNotSeparable: "thinking is billed inside output_tokens and is never broken out (engine/CONTRACT.md §2) — it sits inside the not-landed share and cannot be split from discarded prose",
    thoughtTurns,
  };

  return {
    schemaVersion: 1,
    runDir,
    // The instrument's own weakness, on every record it writes. See the header.
    modelBasis: "requested",
    modelBasisNote: "this record's billing classes key on the dispatch row's `modelUsed`, which is resolved from the REQUESTED alias. Since #238 the rows ALSO carry `modelActual`/`modelBasis`/`modelMismatch` — the provider's own answer, or an explicit unknown — and an unhonoured override now fails the turn instead of being billed here silently. Switching this module to a per-record actual basis is #240's work",
    billingClasses: BILLING_CLASSES,
    telemetryPresent: files != null,
    dispatchCensus: census,
    tokens,
    // The whole point of the census above: a total is only a total when nothing went unrecorded.
    tokensComplete: files != null && census.unmeasured === 0,
    byBilling,
    // — the sentence the table could not say. Derived from `byBilling` above, never measured apart.
    billingComposition: billingComposition(byBilling, { telemetryPresent: files != null }),
    byStage,
    dispatches,
    dispatchesTruncated: census.total > dispatches.length,
    unmeasuredDispatches,
    emittedVsLanded,
    quotedVsActual: quotedVsActual({ quote: readQuote(runDir), startedAt: status?.startedAt ?? null,
      endedAt: ended.at, endedAtBasis: ended.basis }),
  };
}

/**
 * Stamp the record onto the run: `_driver/economics.json` (the full record, per-dispatch detail and
 * all) plus a lean summary on `status.json.economics` and one `economics` event on `_driver/run.jsonl`.
 *
 * The summary is what the polled surfaces read, so it stays small; the full record stays in the run dir
 * where it is recomputable from the journals at any time. Best-effort by contract, like every other
 * measurement write in this driver — a telemetry stamp must never affect a run, delivered or failed.
 */
export function stampRunEconomics(runDir, phase, { now = Date.now() } = {}) {   // the terminal's own clock
  if (!runDir) return null;
  try {
    const econ = runEconomics(runDir, { now });
    try { writeFileSync(driverDir(runDir, "economics.json"), JSON.stringify({ phase, ...econ }, null, 2) + "\n"); }
    catch { /* best-effort */ }
    const summary = {
      phase,
      schemaVersion: econ.schemaVersion,
      modelBasis: econ.modelBasis,
      dispatchCensus: econ.dispatchCensus,
      // — the census's own arithmetic, stated rather than left for a reader to attempt. `false` means
      // a dispatch is counted in `total` and in no bucket, which is a defect in this file and not a fact
      // about the run. Derived from the object so a bucket added later is included without being named.
      dispatchCensusReconciles: econ.dispatchCensus.total
        === Object.entries(econ.dispatchCensus).reduce((n, [k, v]) => k === "total" ? n : n + v, 0),
      tokens: econ.tokens,
      tokensComplete: econ.tokensComplete,
      byBilling: econ.byBilling,
      // acceptance 1, second branch: a run that cannot name ONE vendor and ONE billing mode says
      // so plainly here, beside the buckets that prove it, rather than leaving a reader to infer it from
      // three keys differing in their second field.
      billingComposition: econ.billingComposition,
      emittedVsLanded: econ.emittedVsLanded,
      // THE PER-STAGE TABLE, on the surface a reader actually polls ( acceptance criterion 2). A lean
      // projection, not the whole stage object: `status.json.tokens` already carries a per-stage split, so
      // a reader who could get per-stage TOKENS but only a run-level landed share had to open the run dir
      // for the other half of the same question. Four numbers a stage — smaller than the token split
      // already beside it, and the per-dispatch detail stays in _driver/economics.json where it belongs.
      emittedVsLandedByStage: Object.fromEntries(Object.entries(econ.byStage).map(([stage, s]) => [stage, {
        emittedOutputTokens: s.emittedOutputTokens,
        landedBytes: s.landedBytes,
        landedShare: s.landedShare,
        landedShareReason: s.landedShareReason,
        tokensComplete: s.tokensComplete,
      }])),
      quotedVsActual: econ.quotedVsActual,
    };
    runLog(runDir, { event: "economics", ...summary });
    writeRunStatus(null, { economics: summary }, runDir);
    const c = econ.dispatchCensus;
    // — THE LINE MUST SUM TO ITS OWN TOTAL.
    //
    // The round read `14 dispatches — 12 measured, 0 stream-reconstructed, 1 UNMEASURED` (13) and
    // `20 — 18, 0, 1` (19), and filed one dispatch as falling outside every bucket. It does not: the
    // census has always had a FOURTH bucket, `codeSide`, and only this line omitted it. A code-executor
    // dispatch (`model: "code"`, or `modelUsed` starting `code:` — e.g. `code:execute-plan`) is a real
    // dispatch that costs no provider tokens, so it belongs in the count and not in the token classes.
    // The arithmetic was right and the sentence was short, which is the harder version of the bug: every
    // reader who checked the sum concluded a dispatch had been lost.
    //
    // The reconciliation below is derived from the census OBJECT, not from the four names spelled here.
    // Add a fifth bucket without printing it and this goes loud on the next run instead of silently
    // reproducing exactly the defect being fixed.
    const bucketSum = Object.entries(c).reduce((n, [k, v]) => k === "total" ? n : n + v, 0);
    const unaccounted = c.total - bucketSum;
    note(`run economics (${phase}): ${c.total} dispatches — ${c.measured} measured, ${c.streamed} stream-reconstructed, ` +
      `${c.codeSide} code-side (no provider tokens), ` +
      `${c.unmeasured} UNMEASURED${c.unmeasured ? " (the token total below is INCOMPLETE)" : ""}` +
      `${unaccounted !== 0 ? ` — DEFECT: ${unaccounted} dispatch(es) in NO bucket, the census does not reconcile` : ""}; ` +
      `emitted ${econ.emittedVsLanded.emittedOutputTokens} output tokens, landed ` +
      `${econ.emittedVsLanded.landedBytes ?? "(not recorded)"} bytes` +
      `${econ.emittedVsLanded.landedShare != null ? ` (${(econ.emittedVsLanded.landedShare * 100).toFixed(1)}% at ${econ.emittedVsLanded.bytesPerOutputTokenAssumed} B/token${econ.emittedVsLanded.landedShareIsFloor ? ", a FLOOR" : ""})` : ""}`);
    return econ;
  } catch (e) {
    try { note(`run economics failed (non-fatal): ${e.message}`); } catch { /* never mask a terminal */ }
    return null;
  }
}
