// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jx-lanes.mjs — the Stage-1.5 jurisdiction-deepening CAPABILITY TABLES + lane routing.
// PURE data + decisions: no env reads, no fs, no driver imports (the
// jurisdiction-systems.mjs pattern) — the pipeline applies kill switches and does IO around this.
//
// (The one driver import is products.mjs — THE OFFERING, itself pure data + pure functions with no node
// imports, no env and no I/O. It is here so this module never types a product name of its own; see
// zhScopeDepthNotes for what happened when it did.)
//
// Doctrine (spec B §12, structural): config/policy SELECTS among lanes defined HERE; a profile or
// recipe can never define a lane. The zh lane exists because Chinese-script squatting is the
// meta-analysis's dominant Stage-1→Stage-2 failure mode: the register forms a CN-market actor uses
// (phonetic transliterations, semantic translations, market nicknames) share no Latin substring with
// the mark, so no Latin-variant sweep can reach them.

// The imports are themselves pure data + pure functions (no env, no fs, no driver): the shared
// display-name → region-code vocabulary bridge, so lane routing keys can match portal-submitted names,
// and the shared romanisation vocabulary — see the re-export at the foot of this file for why the
// latter no longer lives here.
import { normalizeTerritory } from "../providers/_shared/territory-codes.mjs";
import { romanizationRefusal, romanizationSpellings } from "../providers/_shared/script-form.mjs";
// THE OFFERING'S OWN SENTENCE about where the native-language investigation can be bought. products.mjs
// is pure data + pure functions (no node imports, no env, no I/O — its own header says so), so this
// keeps the purity rule above; what it removes is this module naming a product on its own account,
// which is how the recommendation came to advertise a retired one. See zhScopeDepthNotes.
import { NATIVE_LANGUAGE_REMEDY } from "./products.mjs";

// ── Language lanes (closed) ──────────────────────────────────────────────────────────────────────────
export const LANGUAGE_LANES = {
  zh: {
    label: "Chinese-script deepening",
    script: "Han",
    // native-script candidate kinds the completions contract may return (closed enum, validated)
    candidateKinds: ["phonetic", "semantic", "nickname"],
    // a zh candidate must be WHOLLY Han script (plus interpunct/space separators): a Latin echo — or
    // a mostly-Latin term with one Han char — is not a native-script candidate, and free-form content
    // here would ride into prompts/reports (the contains-test was an injection surface; review
    // 2026-07-18). \p{Script=Han} covers compatibility ideographs + Extension B, which the old
    // BMP-range class missed.
    termRe: /^[\p{Script=Han}][\p{Script=Han}\s·]{0,39}$/u,
  },
  // ja/ko land as slice-1 CANDIDATE lanes (2026-07-22, after their per-lane probes — jx-probe
  // out/results-ja.json / results-ko.json): native-script register candidates folded onto the
  // frozen plan, exactly how zh shipped. Their SERP grids land with their own slice, never
  // speculatively (the grid unit is still zh-scoped; see SERP_LANES below).
  ja: {
    label: "Japanese-script deepening",
    script: "Japanese",
    candidateKinds: ["phonetic", "semantic", "nickname"],
    // Whole-term Japanese: Katakana/Hiragana/Kanji. ー (U+30FC prolonged sound mark) and ・
    // (U+30FB middle dot) are Script=Common so they are named explicitly — ー is PHONEMIC
    // (ウーバー without it is a different mark), ・ is a separator (ルイ・ヴィトン). Latin echoes
    // and romaji are refused for the same injection/authenticity reasons as the zh contains-test.
    termRe: /^[\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Han}][\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Han}ー・\s]{0,39}$/u,
  },
  ko: {
    label: "Korean-script deepening",
    script: "Hangul",
    candidateKinds: ["phonetic", "semantic", "nickname"],
    // Whole-term Hangul (syllable blocks). Mixed Latin/Hangul echoes are not native candidates.
    termRe: /^[\p{Script=Hangul}][\p{Script=Hangul}\s·]{0,39}$/u,
  },
};

// ── Jurisdiction → lane adapters (closed; conservative — only registers where Han-script filings are
// the norm; multilingual registers (e.g. SG) stay out of slice 1 rather than half-covered) ──────────
export const JURISDICTION_ADAPTERS = {
  CN: { lane: "zh", note: "first-to-file; subclass system (CNIPA similarity groups)" },
  HK: { lane: "zh" },
  TW: { lane: "zh" },
  MO: { lane: "zh" },
  JP: { lane: "ja", note: "JPO similar-group codes (類似群コード) — awareness table lands with its own slice" },
  KR: { lane: "ko", note: "KIPO similar-group codes (유사군코드) — awareness table lands with its own slice" },
};

// ── SERP platform-grid capability tables. Per-lane: which SERP
// engine the executor dials, which platform cells the grid dictates (6 store platforms + the executor's
// implicit "web" cell = 7 cells/term, matching the common-law MIN_CELLS_PER_VARIANT floor), and the
// register-MIRROR domains: trademark-data/IP-database sites whose pages LOOK like marketplace hits in
// a SERP but are register records. A mirror hit is demoted code-side before any judge sees it — "a
// tmkoo record page never classifies as use" is an exclusion rule, not a prompt instruction.
// naver KR / google+market JP-IN-GCC entries land with their GRID slices, never speculatively —
// ja/ko shipped as candidate lanes 2026-07-22 WITHOUT grid entries: no SERP_LANES row means the
// platform grid simply has no lane to dictate (and the grid unit is zh-scoped until generalized).
export const SERP_LANES = {
  zh: {
    engine: "baidu",
    platforms: ["taobao.com", "tmall.com", "1688.com", "jd.com", "pinduoduo.com", "xiaohongshu.com"],
    mirrorDomains: ["tmkoo.com", "quandashi.com", "86sb.com", "tmsou.com", "biaoxq.com", "wtoip.com", "chofn.com"],
  },
};

/** Is this hit URL a register-mirror page for the lane? Suffix-anchored host match (subdomains
 *  count, "nottmkoo.com" and "tmkoo.com.evil.com" do not). Accepts full URLs AND the bare
 *  host/path strings SERPs surface as displayed_link ("www.tmkoo.com/detail/9") — on live Baidu
 *  the `link` field is a baidu.com redirect wrapper, so displayed_link is the only per-hit signal
 *  that carries the real host (review 2026-07-18). Unparseable values are NOT mirrors — they stay
 *  visible to the judge, whose closed taxonomy still has "register-record" for them. */
export function isMirrorHost(lane, url) {
  const domains = SERP_LANES[lane]?.mirrorDomains ?? [];
  const s = String(url ?? "").trim();
  if (!s) return false;
  let host;
  try { host = new URL(s).hostname.toLowerCase(); }
  catch {
    try { host = new URL(`https://${s}`).hostname.toLowerCase(); } catch { return false; }
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The jurisdictions IN SCOPE for a job: instructed wins, else the profile's defaults (the
 *  scopeTerritories precedence, replicated pure so this module stays leaf). Canonicalized to region
 *  CODES: the lane adapters key on codes (CN/JP/KR), but the portal composer submits display names
 *  ("China") — without this bridge a portal job would silently skip a PAID deepening lane (and its
 *  disclosure row) on a vocabulary mismatch (sibling of the copper-bastion register incident,
 *  2026-07-22). Unknown names and Worldwide keep their uppercased original form — matching today's
 *  no-lane behavior; widening Worldwide to imply CN/JP/KR is a product decision, not a code default. */
export function scopeJurisdictions(job, profile) {
  const j = Array.isArray(job?.jurisdictions) && job.jurisdictions.length ? job.jurisdictions
    : Array.isArray(profile?.defaultJurisdictions) ? profile.defaultJurisdictions : [];
  return [...new Set(j.map((x) => {
    const code = normalizeTerritory(x);
    return code || String(x).trim().toUpperCase();
  }).filter(Boolean))];
}

/**
 * The POLICY decision: which lanes fire for this run, at what depth. Pure — env kill switches are the
 * pipeline's business. Returns {} lanes when the searchPolicy doesn't carry the jxLanes component (a
 * plain prelim is byte-identical: no decision, no sidecar, nothing).
 *
 *   decideJxLanes({ job, profile, searchPolicy }) →
 *     { lanes: { zh: { depth: "candidates"|"full", jurisdictions: ["CN",…], origin } }, scope: [...] }
 *
 * Depth: the customer's jxPolicy.laneDepth[lane] when set ("off" excludes the lane); else
 * "candidates" — the component being selected means the customer bought deepening. `depth` records
 * the depth the CONFIG ASKED FOR and nothing else: no code reads it to gate a slice. The retrieval
 * slices arm on CLEAROTRON_NATIVE_LANGUAGE_<code> alone since item 8 deleted the per-slice arms (driver/jx.mjs
 * JX_SLICES, driver/jx-units.mjs), which are env and therefore not this pure module's business.
 *
 * THIS RECORD DOES NOT SAY WHAT EXECUTED. It is frozen at mint, before any slice runs, so the
 * per-lane `executes: "candidates"` it used to carry was a constant asserting that slices 2–3 do not
 * exist — and they shipped. The field is DELETED rather than recomputed here: a run states what ran
 * once, at delivery, in `fold.executes` / `fold.slices` (stateJxSlices,), derived from the
 * durable unit records; reference-score.mjs derives the per-lane view from `fold.slices`, per lane
 * rather than as the run-level join (the SERP grid is zh-only — see SERP_LANES above).
 */
export function decideJxLanes({ job, profile, searchPolicy } = {}) {
  const scope = scopeJurisdictions(job, profile);
  if (!searchPolicy?.components?.jxLanes) return { lanes: {}, scope };
  const lanes = {};
  for (const [region, adapter] of Object.entries(JURISDICTION_ADAPTERS)) {
    if (!scope.includes(region)) continue;
    const lane = adapter.lane;
    if (!LANGUAGE_LANES[lane]) continue;
    const configured = profile?.jxPolicy?.laneDepth?.[lane] ?? null;
    if (configured === "off") continue;
    if (!lanes[lane]) {
      const depth = configured ?? "candidates";
      lanes[lane] = {
        depth,
        jurisdictions: [],
        // PROVENANCE, never a coverage claim. The old suffix here stamped "slice 1 EXECUTES candidates
        // only" onto every `full` lane; the deeper slices shipped and the stamp became a downgrade that
        // was not happening. What a `full` lane actually gets is decided by the env arms, which this
        // pure module cannot read — so it points at the record that CAN say, instead of guessing.
        origin: (configured ? `profile jxPolicy.laneDepth.${lane}` : "component default (candidates)")
          + (depth === "full" ? "; the deeper slices are env-armed — what executed is stated at delivery in fold.executes" : ""),
      };
    }
    lanes[lane].jurisdictions.push(region);
  }
  return { lanes, scope };
}

/**
 * qw/cn-scope-honesty (b) — the intake/resolution-time NOTE: a run whose
 * requested scope names a zh-lane jurisdiction but whose machinery does not carry the lane is TOLD where
 * the Chinese-script same-meaning/phonetic register equivalents can be bought. Returns [] or one note
 * string — a NOTE only, by contract: callers may log/surface it but never clarify, park, or substitute
 * the product on it (the run proceeds exactly as requested).
 *
 * ── THE GATE THAT WAS DECIDING, AND DECIDING OFF ────────────────────────────────────────────────────
 *
 * This function opened with `resolvedPolicy.level !== "prelim"`. `resolveSearchPolicy` now returns
 * `level` = THE PRODUCT ID for all four searches, so that leg was false on every live run and the whole
 * recommendation was dead — silently, with both callers (pipeline.mjs and runner.mjs) live and 3,754
 * driver tests green, because the one test that covered it hand-fed `{ level: "prelim" }`, a value
 * nothing produces any more. A retired slug does not stop deciding when it is retired; it starts
 * deciding one way.
 *
 * The leg is GONE rather than renumbered, because it was never the real question. The honest question is
 * "does this run's machinery read the lane", and `components.jxLanes` below is that question — it is
 * derived from the product's own native-language mode in resolveSearchPolicy (automatic on a Full
 * country search, the one toggle on a Multi-country focus search, absent on the other two), so the two
 * legs were always one leg with a product key stapled to it.
 *
 * Fires when ALL of:
 *   - the resolved machinery carries NO jxLanes component — if it does, the investigation runs and there
 *     is nothing left to recommend;
 *   - the requested scope names a zh-lane jurisdiction EXPLICITLY (job-instructed or the profile's
 *     defaults — the same precedence the lane itself uses). An unscoped/worldwide run deliberately
 *     does NOT note here: the recommendation keys on what the requester actually asked for, and the
 *     delivery-time coverage row (pipeline injectScriptScopeCoverage) covers the worldwide shape;
 *   - the customer has not configured the lane off (jxPolicy.laneDepth.zh "off") — customer config
 *     always wins: recommending a feature the customer declined would nag against their own config.
 *
 * The remedy names PRODUCTS, from the module that owns their names. `productName` is pure data — no env,
 * no fs, no I/O — so importing it keeps this file's stated purity; what it ends is this module typing a
 * product name of its own, which is how the old sentence came to advertise a ladder rung that no longer
 * exists to a reader who could not have ordered it.
 */
export function zhScopeDepthNotes(job, resolvedPolicy, profile = null) {
  if (resolvedPolicy?.components?.jxLanes) return [];
  if (profile?.jxPolicy?.laneDepth?.zh === "off") return [];
  const zh = scopeJurisdictions(job, profile).filter((j) => JURISDICTION_ADAPTERS[j]?.lane === "zh");
  if (!zh.length) return [];
  return [`scope names ${zh.join(", ")} — this search does not read Chinese-script same-meaning/phonetic register equivalents. ${NATIVE_LANGUAGE_REMEDY} Recommendation only — this run proceeds exactly as requested.`];
}

/** Canonical form of a candidate term: NFC-normalized, trimmed — the SINGLE identity every gate,
 *  qid and dedup key derives from (NFC/NFD variants of one term must never mint two register
 *  queries; review 2026-07-18). */
export const canonicalTerm = (t) => String(t ?? "").normalize("NFC").trim();

/** Validate one native-script candidate for a lane (closed kinds, WHOLE-term script check, length).
 *  Returns a reason string when refused, null when acceptable — the fold logs refusals, never dies
 *  on them. Callers gate on the CANONICAL term (canonicalTerm). */
export function candidateRefusal(lane, cand) {
  const spec = LANGUAGE_LANES[lane];
  if (!spec) return `unknown lane "${lane}"`;
  const term = canonicalTerm(cand?.term);
  if (!term) return "empty term";
  if (term.length > 40) return `term too long (${term.length} chars)`;
  if (!spec.termRe.test(term)) return `not wholly ${spec.script}-script — a Latin/mixed echo is not a native-script candidate`;
  if (!spec.candidateKinds.includes(String(cand?.kind ?? ""))) return `kind "${cand?.kind}" not in the closed set (${spec.candidateKinds.join("|")})`;
  // The romanisation is what actually gets SEARCHED — the register indexes non-Latin filings by it,
  // never by their characters (华威豹 → 0, HUA WEI BAO → 32 of the same records; probed 2026-07-29).
  // A candidate without one is unsearchable, and searching the characters instead would return 0 and
  // read as CLEAN, so it is refused HERE — visibly, into the fold receipt — rather than folded into
  // the plan to die quietly at the wire.
  const roman = romanizationRefusal(cand?.romanization);
  if (roman) return roman;
  return null;
}

// The romanisation vocabulary moved to providers/_shared/script-form.mjs (2026-07-30) so the OTHER
// minting lane — the variant manifest, which compiles the same transliteration-numeric axis in
// register-plan.mjs — states the romanisation in the identical shape, next to the shared script
// detector that decides which terms need one. Re-exported here because this lane's callers and tests
// have always taken it from jx-lanes.
export { romanizationRefusal, romanizationSpellings };

// ── Billing path for a direct-API jx ledger row ────────────────────────────────────────────
// The jx model calls (fold completions, serp-judge, nativeread) are the ONLY dispatches in the driver
// that produce a per-token provider invoice. This comment used to name their executor as a
// `@anthropic-ai/sdk` Messages call; that has not been true since the lane lost its own destination
// and credential, and the SDK is no longer a dependency of this product at all (tracker issue 99).
// The lane goes wherever the run's resolved program goes — the CLI opens every connection, and no
// driver code calls a provider — so one run never mixes a subscription login with an API key. What
// survives unchanged is the BILLING distinction this block is about: these calls land on a per-token
// invoice, while every gateway stage runs on the OAuth subscription and appears on no invoice line. Until this stamp, jx ledger rows carried no engine/authMode
// and so bucketed as "unknown" in every per-run rollup — the invoice-billed share of a matter was the
// one part of its consumption nothing could attribute.
//
// Keyed on the RESOLVED executor, which is where the knowledge is. A fixture or injected executor made
// no provider call and must not read as billed; it says so in its own words rather than as "unknown",
// which would be indistinguishable from an unstamped legacy row.
//
// Lives here, not in jx-units.mjs, because jx.mjs and jx-units.mjs both write these rows and
// jx-units already imports jx.mjs — putting it in either would close an import cycle.
export const jxBillingStamp = (executorSource, result = null) => {
  // — THE STAMP READS THE TURN, NOT A CONSTANT. It used to hardcode `anthropic-direct` /
  // `api-key`, which was true of the old transport and true of nothing else: on a codex run those rows
  // asserted an Anthropic API dispatch that had not happened, and `run-economics.billingComposition`
  // read them and reported the run as spanning two vendors and two billing modes. It was right about
  // the mix and wrong about who — and the mix is what the owner's one-provider rule forbids.
  //
  // NO VENDOR ON THE RESULT MEANS NO DISPATCH HAPPENED. A fixture, an injected executor, or a
  // configuration the engine door refused all return without one, and none of them is provider-billed.
  // Saying so in its own words beats "unknown", which is indistinguishable from an unstamped legacy row.
  if (executorSource !== "engine" || !result?.vendor) return { engine: "not-provider-billed", authMode: "not-provider-billed" };
  return { engine: result.vendor, authMode: result.authMode ?? "not-provider-billed" };
};
