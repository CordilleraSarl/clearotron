// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// acceptance-gate metrics (review §8) — read-only over archived run dirs. PURE.
//
// Ran-vs-done mechanism metrics, computed on the frozen holdout before and after each tranche.
// A fix is accepted only if these move on the HOLDOUT (never on the runs a finding cited):
//   deferralsRendered   — % of frame-reopen deferrals whose substance reaches report.md or a
//                         findings.json coverage[] row (F5; baseline ≈ 0 by construction)
//   skepticConsumed     — % of skeptic non-ESCALATE flags whose key entity reaches findings.json
//                         (F8; entity-token heuristic, labelled approximate)
// amendment 3: THIS READ narrative.md UNTIL THE DEPTH LADDER SHIPPED.
//                         Lever 1 grades per-finding narrative prose, so the old surface was the exact
//                         thing the ladder shrinks — the metric would have fallen on graded products
//                         without any attention being lost, and every later round would have compared
//                         two instruments. The typed register is AS TODAY in every product, so it is
//                         what "did the flag reach judgment" now means. Readings taken before this
//                         change are NOT comparable with readings after it; the returned `surface`
//                         says which instrument produced a number, so a mixed report is visible.
//   scoredFetched       — % of composite>=3 findings with >=1 cited registration URI actually
//                         fetched into _records/ (F6 / fetch-before-assert)
//   clientTierMatch     — % of client-summary Marks blocks whose "- risk:" equals the canonical
//                         tier for the joined finding's composite (F4)
//   plan-stability      — per-slug Jaccards (see plan-stability.mjs)
//
// CLI: node gate-metrics.mjs <archiveRoot>… [--runs <file-with-runDir-per-line>]
// Holdout dirs are read for METRICS ONLY — never copied into dev fixtures.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FATES } from "./hit-list.mjs";   // — THE fate set, imported, never re-declared
import { driverDir } from "../shared/driver-dir.mjs";   //
import { slugStability, groupByMark } from "./plan-stability.mjs";

// doc 50: the composite table is imported (one source, legacy runs only); a v4 finding's canonical
// word is its own `band` — telemetry compares against whichever the finding carries.
import { CLIENT_TIER_BY_COMPOSITE as TIER_BY_COMPOSITE } from "./findings-model.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently
const canonicalWord = (f) => f?.band != null ? String(f.band) : TIER_BY_COMPOSITE[f?.composite];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

export function findRunDirs(roots) {
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const month of readdirSync(root)) {
      const mDir = join(root, month);
      if (!statSync(mDir).isDirectory()) continue;
      for (const slug of readdirSync(mDir)) {
        const sDir = join(mDir, slug);
        if (!statSync(sDir).isDirectory()) continue;
        for (const run of readdirSync(sDir)) {
          const rDir = join(sDir, run);
          if (statSync(rDir).isDirectory() && existsSync(join(rDir, "status.json"))) out.push(rDir);
        }
      }
    }
  }
  return out;
}

// F5 — a deferral counts as rendered when a distinctive slice of its directive appears in
// report.md or in a coverage[] row. Directive slice: the longest word-run inside the directive
// after the "kind:" prefix, normalized.
function deferralSlice(directive) {
  const body = String(directive ?? "").replace(/^[a-z-]+:/, "");
  return norm(body).split(" ").filter((w) => w.length >= 4).slice(0, 4).join(" ");
}

export function deferralsRendered(runDir) {
  const rec = readJson(driverDir(runDir, "frame-reopen.json"));
  const defs = rec?.deferrals ?? [];
  if (!defs.length) return null;
  const report = norm(readText(join(runDir, "report.md")));
  const f = readJson(join(runDir, "findings.json"));
  const covText = norm((f?.coverage ?? []).map((c) => `${c.area} ${c.note ?? ""}`).join(" "));
  let rendered = 0;
  for (const d of defs) {
    const slice = deferralSlice(d.directive);
    if (slice && (report.includes(slice) || covText.includes(slice))) rendered++;
  }
  return { total: defs.length, rendered };
}

/** Every string VALUE in a parsed findings.json, joined. Keys are excluded on purpose: a token like
 * "disposition" or "practical" is a schema word, and matching one would count a flag as consumed
 * because the file has the shape it always has. */
function findingsText(obj) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(obj);
  return out.join(" ");
}

// F8 — approximate: a non-ESCALATE skeptic bullet counts as consumed when its most distinctive
// token (longest ALL-CAPS/Capitalized word >=5 chars, else longest word) reaches the typed register.
// See the header on why this is findings.json and no longer narrative.md ( amendment 3).
export function skepticConsumed(runDir) {
  const flags = readText(join(runDir, "skeptic-flags.md"));
  if (!flags.trim()) return null;
  const pre = flags.split(/ESCALATION DECISIONS/i)[0];
  const bullets = pre.split("\n").filter((l) => /^\s*-\s+\S/.test(l));
  if (!bullets.length) return null;
  // An absent register is not a run where nothing was consumed — it is a run this metric cannot read.
  // Returning 0-of-N here would print as a total collapse in skeptic uptake.
  const parsed = readJson(join(runDir, "findings.json"));
  if (!parsed) return null;
  const register = norm(findingsText(parsed));
  let consumed = 0;
  for (const b of bullets) {
    const words = b.match(/[A-Z][A-Za-z0-9-]{4,}/g) ?? b.match(/[a-z0-9-]{6,}/gi) ?? [];
    const key = words.sort((a, z) => z.length - a.length)[0];
    if (key && register.includes(norm(key))) consumed++;
  }
  return { total: bullets.length, consumed, surface: "findings.json" };
}

// F6 — scored findings whose cited registration URIs were actually fetched this run.
// "Scored" = composite>=3 (legacy) or band-rated at all (doc 50 v4 — off-field carries no band, so
// band-presence IS the rated line; telemetry only, so no manifest rank needed here).
export function scoredFetched(runDir) {
  const f = readJson(join(runDir, "findings.json"));
  const scored = (f?.findings ?? []).filter((x) => (x?.composite ?? 0) >= 3 || x?.band != null);
  if (!scored.length) return null;
  // ── THE FATE CODES, WHERE THE RUN HAS THEM ──────────────────────────────────
  //
  // The hit list carries one line per enumerated record and the fate it was given. That is a better
  // answer to this metric's question than a directory listing ever was: a listing says what is on disk,
  // the codes say what judgment DID — and F6 asks whether a scored finding rests on a record the run
  // actually opened.
  //
  // THE PICKED FATES ARE ENUMERATED, NOT THRESHOLDED. `fate >= 1` would read a future fate as opened by
  // arithmetic; naming OPENED_DISMISSED and REPORTED means a new fate is NOT counted as opened until
  // somebody decides it is. That is the loud direction: excluding it shrinks the numerator and raises
  // this metric's own alarm, where including it by accident would inflate the numerator and say nothing.
  //
  // AND THE SET IS IMPORTED, never re-declared here. Two copies of one question is how the two come to
  // disagree, and a private threshold in the consumer would keep returning a plausible number after the
  // producer's set changed under it.
  //
  // CASE. Measured on the R14 archive: 1,937 of 1,937 band `record_id`s and 37 of 37 finding uris carry
  // uppercase. Both sides are lowercased before joining, as the `_records/` path below already does. An
  // un-normalised join here would miss ALL of them, not some — and a total miss reads as a clean
  // `fetched: 0`, which is this metric's alert, not its absence.
  const lines = readJson(join(runDir, "register-hit-list.json"))?.lines;
  if (Array.isArray(lines)) {
    // THREE STATES, NOT TWO, and the third is the one an earlier cut of this got wrong. A line the run
    // deliberately did not open (`NOT_PICKED`) leaves the denominator. A line whose fate this file does
    // not recognise is NOT that — it is a could-not-look, and lumping it in with a deliberate dismissal
    // would remove it from the denominator silently, which is the quiet direction this whole rule exists
    // to refuse. It stays in, and counts as unfetched.
    const picked = new Set(), notPicked = new Set();
    for (const l of lines) {
      const id = String(l?.id ?? "").toLowerCase();
      if (!id) continue;
      if (l?.fate === FATES.OPENED_DISMISSED || l?.fate === FATES.REPORTED) picked.add(id);
      else if (l?.fate === FATES.NOT_PICKED) notPicked.add(id);
      // anything else: neither set — it stays countable and unfetched, by falling through both.
    }
    let total = 0, ok = 0;
    for (const x of scored) {
      const uris = (x.owner?.registrations ?? []).map((r) => String(r?.uri ?? "").toLowerCase()).filter(Boolean);
      if (!uris.length) continue;
      // ONLY A DELIBERATE DISMISSAL LEAVES THE DENOMINATOR — the seam contract, in one filter. A record
      // the run chose never to open is not a fetch that failed, and counting it as one would make this
      // metric fall as the conversion works BETTER. Everything else stays: a citation the list never
      // enumerated, and a line whose fate this file cannot read, are both claims it cannot vouch for.
      const countable = uris.filter((u) => !notPicked.has(u));
      if (!countable.length) continue;
      total++;
      if (countable.some((u) => picked.has(u))) ok++;
    }
    // Every scored finding cited only unpicked lines: nothing to measure, and `null` says so rather
    // than reporting a perfect or an empty score.
    return total ? { total, fetched: ok } : null;
  }

  const recDir = join(runDir, "_records");
  // AN ABSENT PILE IS NO SURFACE, NOT A RUN THAT FETCHED NOTHING.
  //
  // This guard used to fall through: with no `_records/` the set stayed empty, every scored finding
  // counted as unfetched, and F6 returned `{total: N, fetched: 0}` — a could-not-look wearing a
  // measurement's clothes. It reads identically to "N findings cite records that failed to fetch",
  // which is the alert this metric exists to raise.
  //
  // The cost is not one run's number. `:222` folds every run into a shared numerator and denominator,
  // so a run with no pile at all contributed its whole `total` to the denominator and nothing to the
  // numerator — dragging the fleet-wide percentage down with runs that had nothing to measure.
  //
  // `null` is this file's own word for "no such surface", stated in `clientTierMatch` just below and
  // already handled: the aggregate skips a null outright and `pct()` reports null rather than a false
  // 0%. A present-but-incomplete pile still measures, and must — a cited record that is missing while
  // the pile exists is exactly the fetch failure worth alerting on.
  //
  // WHEN FATE CODES LAND this guard is where the derivation moves: the fetched set comes from the codes
  // rather than from a directory listing, and the denominator narrows to PICKED lines. Under the seam
  // contract an unpicked line stays out of the denominator entirely, so it can never read as a miss.
  // Until then, refusing to measure an absent pile is the same answer arrived at from the other side.
  if (!existsSync(recDir)) return null;
  const fetched = new Set();
  for (const file of readdirSync(recDir)) {
    if (!file.endsWith(".json")) continue;
    const uri = readJson(join(recDir, file))?._uri;
    if (uri) fetched.add(String(uri).toLowerCase());
  }
  let ok = 0;
  for (const x of scored) {
    const uris = (x.owner?.registrations ?? []).map((r) => String(r?.uri ?? "").toLowerCase()).filter(Boolean);
    if (uris.length && uris.some((u) => fetched.has(u))) ok++;
  }
  return { total: scored.length, fetched: ok };
}

// F4 — client-summary "- risk:" vs the canonical tier of the joined finding.
//
// RETIRED-STAGE METRIC (2026-08-01): the client-summary stage is deleted, so on any run from here on
// the file is absent and this returns null — the aggregate simply takes no denominator from it, which
// `pct()` already reports as null rather than a false 0%. It is kept because it still measures the
// archived runs it was built for. Read a null here as "no such surface", never as a failing join.
export function clientTierMatch(runDir) {
  const cs = readText(join(runDir, "client-summary.md"));
  const f = readJson(join(runDir, "findings.json"));
  if (!cs.trim() || !f?.findings?.length) return null;
  const blocks = [...cs.matchAll(/^## +([^\n—-]+).*\n([\s\S]*?)(?=^## |\s*$)/gm)];
  let total = 0, match = 0;
  for (const [, head, body] of blocks) {
    const risk = body.match(/^- +risk:\s*([A-Z– -]+)$/m)?.[1]?.trim();
    if (!risk) continue;
    const mark = norm(head);
    const finding = f.findings.find((x) => x?.disposition !== "withdrawn" && mark && (mark.includes(norm(x.mark)) || norm(x.mark).includes(mark)));
    const want = canonicalWord(finding);
    if (!want) continue;
    total++;
    if (risk.toUpperCase() === String(want).toUpperCase()) match++;
  }
  return total ? { total, match } : null;
}

function pct(agg) { return agg.den ? Math.round((100 * agg.num) / agg.den) : null; }

// T6 (J9) — the lint-repair tax, measurable in one read: how many drafting surfaces failed
// the delivery lint on FIRST generation (each initial failure ≈ one paid redo generation). The J9 fix
// states the linted constraints in the drafting prompts; this is the before/after meter.
export function lintFirstPassTax(runDir) {
  try {
    const sink = JSON.parse(readFileSync(driverDir(runDir, "predelivery-lint.json"), "utf8"));
    if (!Array.isArray(sink?.initialFailures)) return null;
    return { initialFailures: sink.initialFailures.length };
  } catch { return null; }
}

// PR-4 — the document-growth aggregate: every document-growth-trip event the run's stage choke point
// logged (an output that grew >35% or >20KB under a mutating trigger — lint-repair AND corrective loops
// both covered, keyed on trigger). Read off the append-only run.jsonl spine, so it survives everything
// including in-place overwrites. Returns null when the run never tripped (legacy runs by construction).
export function documentGrowth(runDir) {
  const raw = readText(driverDir(runDir, "run.jsonl"));
  if (!raw) return null;
  const trips = [];
  for (const ln of raw.split("\n")) {
    if (!ln || !ln.includes('"document-growth-trip"')) continue;
    try { const e = JSON.parse(ln); if (e?.event === "document-growth-trip") trips.push(e); } catch { /* torn line */ }
  }
  if (!trips.length) return null;
  const byTrigger = {};
  for (const t of trips) byTrigger[t.trigger ?? "unknown"] = (byTrigger[t.trigger ?? "unknown"] ?? 0) + 1;
  return {
    trips: trips.map((t) => ({ stage: t.stage ?? null, trigger: t.trigger ?? null,
      before: t.before ?? null, after: t.after ?? null, growthBytes: t.growthBytes ?? null, growthPct: t.growthPct ?? null })),
    count: trips.length,
    byTrigger,
    maxGrowthPct: Math.max(...trips.map((t) => t.growthPct ?? 0)),
    stages: [...new Set(trips.map((t) => t.stage).filter(Boolean))],
  };
}

export function computeGateMetrics(runDirs) {
  const agg = {
    deferralsRendered: { num: 0, den: 0 },
    // amendment 3 — the surface rides the aggregate so a printed number says which
    // instrument produced it. Readings from before the re-point are not comparable with these.
    skepticConsumed: { num: 0, den: 0, surface: "findings.json" },
    scoredFetched: { num: 0, den: 0 }, clientTierMatch: { num: 0, den: 0 },
  };
  let lintTaxRuns = 0, lintTaxFailures = 0, lintCleanFirstPass = 0;
  let growthRuns = 0, growthTrips = 0;
  for (const d of runDirs) {
    const dr = deferralsRendered(d); if (dr) { agg.deferralsRendered.num += dr.rendered; agg.deferralsRendered.den += dr.total; }
    const sk = skepticConsumed(d);  if (sk) { agg.skepticConsumed.num += sk.consumed; agg.skepticConsumed.den += sk.total; }
    const sf = scoredFetched(d);    if (sf) { agg.scoredFetched.num += sf.fetched;   agg.scoredFetched.den += sf.total; }
    const ct = clientTierMatch(d);  if (ct) { agg.clientTierMatch.num += ct.match;   agg.clientTierMatch.den += ct.total; }
    const lt = lintFirstPassTax(d); if (lt) { lintTaxRuns++; lintTaxFailures += lt.initialFailures; if (!lt.initialFailures) lintCleanFirstPass++; }
    const dg = documentGrowth(d);   if (dg) { growthRuns++; growthTrips += dg.count; }
  }
  const stability = {};
  for (const [mark, ds] of groupByMark(runDirs)) if (ds.length >= 2) stability[mark] = slugStability(ds);
  return {
    runs: runDirs.length,
    pct: Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, pct(v)])),
    counts: agg,
    lintTax: lintTaxRuns ? { runs: lintTaxRuns, cleanFirstPassPct: Math.round((100 * lintCleanFirstPass) / lintTaxRuns), meanInitialFailures: Math.round((10 * lintTaxFailures) / lintTaxRuns) / 10 } : null,
    // PR-4 probe 9: no document may grow across corrective/lint-repair passes without a trip — this is
    // the before/after meter (runs that tripped at all + total trips across the set).
    documentGrowth: growthRuns ? { runs: growthRuns, trips: growthTrips } : null,
    stability,
  };
}

if (isEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2);
  const runsFileIx = args.indexOf("--runs");
  let dirs;
  if (runsFileIx >= 0) dirs = readFileSync(args[runsFileIx + 1], "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  else dirs = findRunDirs(args);
  console.log(JSON.stringify(computeGateMetrics(dirs), null, 2));
}
