#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Offline HTML renderer: report.md + findings.json -> report.html. Deterministic.
// DATA-DRIVEN (REPORT-DESIGN-SPEC §10): every structured value on the page — risk gauge, quadrant marker
// coordinates, the four meter levels, basis flags, coverage states — comes from the findings.json contract
// (findings-model.mjs). The narrative PROSE (one-liner "so what", "The read", "Full detail") is joined from
// the matching report.md card by owner name; absent ⇒ graceful structured-only fallback. A run with no
// findings.json still renders the page shell (header, summary, methodology) but OMITS the findings-driven
// sections (conflict landscape + on-field/secondary cards), which are built from the findings.json contract.
// Instance #6 (registry fidelity): when the run's _records/ set is passed (opts.recordsByUri), a finding's
// registry IDENTIFIERS (application/registration number, filing/registration year, status) are RENDERED
// FROM the fetched record body via the SHARED registry-fidelity REC extractors — the model is out of the
// identifier path, so a transposition (the NOVAPULSE EU↔US swap) cannot reach the page. No record body for a
// cited uri ⇒ the existing findings.json fields render (back-compat: every run without _records/, every
// archived replay), and a cited uri with NEITHER renders an honest "(unverified — record not fetched)".
// (No longer zero-dependency: it reuses REC from registry-fidelity.mjs, which imports node:fs — render
// already imports node:fs, so no new runtime surface.)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// stripEngineInternals/TELEMETRY_RE moved to parse.mjs beside stripInternal: the client-safety rules now
// have a second caller (the MCP client surface) and must have ONE definition — see the note there.
// — and TELEMETRY_RE is no longer imported at all: plainScopeNote applied the pattern itself, with
// its own split, which is how the two rules diverged. It calls stripTelemetry now, so the renderer holds
// no copy of the RULE either, only a call to it.
import { parseReport, stripInternal, stripTelemetry } from './parse.mjs';
import { clientConditions } from '../terminal-clamp.mjs'; import { hrefAttr } from './attr.mjs';   // an href is attribute-safe and http(s), or not a link
import { EXPORT_TOGGLE, exportPopover, EXPORT_MENU_JS } from './report-topbar.mjs';   // the export menu's shell and behaviour, shared with the knockout template   // the reader's clause per condition, shared with the cover note
import { COMMON_LAW, normRegion, regionName, REGION_NAMES } from './regions.mjs';
import { parseFindingsJson, bindRecommendation, sentenceCaseLead, CLIENT_TIER_BY_COMPOSITE, bandOf, compareBlockingPower, inDispositionMode, reasonedNegativeGroups } from '../findings-model.mjs';
import { REC, inPriorityWindow, ownerDisplayName } from '../registry-fidelity.mjs';
import { registrationSystem } from '../jurisdiction-systems.mjs';
import { READ_LEAD_RE } from '../report-card-record.mjs';   // D3 — the dedupe gate and the card's acceptance are ONE predicate
import { REPORT_ROOT, REPORT_ROOT_DARK_EXPLICIT, THEME_INIT_EXPLICIT, FAVICON_LINK, logoLockup, BRAND, confPosture, sectionStrip } from '../../shared/brand.mjs';
import { NAV_CSS } from '../../shared/site-nav.mjs';
import { REPORT_FONT_STYLE } from '../../shared/brand-fonts.mjs';   // the typefaces travel inside the report; it fetches nothing to draw its text
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

const HERE = dirname(fileURLToPath(import.meta.url));

// ONE report (spec 2026-07-30, ruled): the CLIENT audience flag and its render fork are retired. This
// module renders exactly one document — the full report — and serve-time preparation for a client reader
// (nav/staff-chrome strip, Ask-your-AI removal, token drop) lives in portal-report.mjs, one place.
let AS_OF = null;     // C2 — publish-time clock for the priority-window flag; null (tests/legacy) renders no flag
// T2 (H5) — the DERIVED display verdict (publish enriches _driver/verdict.json via
// deriveDisplayVerdict). When present it is THE label authority for the hero dial, gauge label,
// recommendation bound and topbar — the model-authored fm.overall_label becomes the pre-A2 legacy
// fallback only (archived runs with no sidecar render byte-identically).
let VERDICT_INFO = null;
// T6 (D4) — the machine-derived SEARCHED jurisdiction set (register-plan/instructed-scope,
// passed by publish). When present it IS the "Jurisdictions searched" header; the coverage-regex /
// per-finding fallbacks below serve archived runs without the sidecars.
let SEARCHED_JUR = null;
// Did the register sweep run WORLDWIDE? Read off the frozen plan's `scope_basis` (publish passes it),
// which is the matter's own answer rather than an inference. Before this the flag was regexed out of
// the coverage ledger's model-written prose, so the worldwide chip and its two disclosures appeared
// only if a model happened to write the word — and on a regions-required provider, whose worldwide
// plan carries the vendor's FULL office list, prose was the only thing distinguishing "everywhere"
// from "these 186 territories". Null on archived runs ⇒ the prose sniff below still decides.
let SCOPE_WORLDWIDE = null;
// T7 — the two deterministic evidence joins (set per render from opts):
let CASE_LAW_BY_ORD = new Map();   // E5: ordinal → grounded case-law profile
// Whether the case-law pass found anything: 'found' | 'none-found' | 'not-checked' | null.
// The CARD strand is suppressed on the two states that mean there is no precedent to cite, because the
// profile body is then the engine's account of WHY — adapter names, session error codes, which sources
// were out of scope — a true sentence about the machinery and not the client's answer, and the Court
// decisions section states that outcome in the reader's own words already.
//
// NULL IS NOT ONE OF THEM. A report with no court state carries no Court decisions section either (it
// is full-country only), so suppressing there would take case-law off the page with nothing left
// saying so. Absence of a state is not a statement that nothing was found.
let COURT_DECISIONS = null;
let ENFORCER_SIGNALS = new Map();  // E6: registration uri (lowercase) → {aggression, oppositions, owner}
// WP-receipts W2 — per-render provider record-link origin + label, resolved by publish from the run's
// OWN _driver/receipts.json provider (never the currently-configured provider — a re-published archive
// keeps its own register). null on runs without receipts ⇒ regHref keeps the resolved_link-origin
// inference and no receipt line renders ⇒ archived output stays byte-identical.
let RECORD_ORIGIN = null;
let RECORD_ORIGINS = null;   // — the run's ALLOW-LIST, not one origin
let RECORD_CITATION = null, RECORD_LINKS = null;  // — what a card shows where a link cannot go (provider table); the office's own page per fetched record (office-record-links.mjs)
let PROVIDER_LABEL = null;
// WP-receipts W3/W4 — senior-right rows by finding ordinal (from _driver/senior-rights.json via
// publish). The open item is CODE-OWNED: a verdict-driving card whose senior right went unverified
// gets the plain-English line below deterministically — a junior leg can never stand in silently.
let SENIOR_RIGHTS = new Map();
// CHANGE 2 (banding) — per-render flag: true when AT LEAST ONE finding carries an explicit `disposition`, so
// placement is disposition-driven (3 bands). false ⇒ NO finding has disposition ⇒ legacy composite banding
// (2 sections), so an archived/legacy run renders byte-identically. Set once in renderHtml, read by the
// prominence helpers (isOnField / bandOf).
let DISPOSITION_MODE = false;
// — per-render flag: true when the record declares the v6 findings contract, which is the one that
// guarantees a position on every negative and a TYPED off-field ground. Gates the grouped
// reasoned-negative rendering; false ⇒ the pre-change section, byte-identical, for every archived run.
let NEGATIVES_GROUPED = false;
// doc 50 — the run's FROZEN framework manifest (opts.framework, from _driver/framework.json). When
// present the report speaks ITS band words: chips/one-liners read f.band, the gauge ticks show its
// ladder, the footer names it. Absent ⇒ every legacy (composite) surface renders byte-identically.
let FRAMEWORK = null;
// The 2026-09-16 report redesign — the depth rule, as one flag. The same sections render at every depth; what grows
// is what a finding's Full detail fold carries, and the goods as registered and the record's dates are
// the two blocks the design gives the full country alone. Module-level for the same reason FRAMEWORK is:
// fullDetail is reached through four call sites and threading a flag through all of them to reach one
// `if` is how the other three drift out of step.
let FULL_COUNTRY = false;
const GAUGE_STOP_BY_TONE = { minimal: 1, low: 1, medium: 2, high: 3, severe: 4 };
// Severity rank for sorting/worst-of: band index in the manifest (0 = most severe); legacy composite
// negated so higher composite = lower rank. Unrated items sink to the bottom.
function severityRank(f) {
  if (FRAMEWORK && f?.band != null) {
    const i = FRAMEWORK.bands.findIndex((b) => b.label.toLowerCase() === String(f.band).toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }
  const c = Number(f?.composite) || 0;
  return c >= 1 ? 100 - c : Number.MAX_SAFE_INTEGER;
}
// doc-54 (dynamic ladder) — in framework mode the gauge shows the manifest's OWN ladder: ONE tick per
// band, least→most severe left→right. 'Clear' is a distinct zero-state (a verdict state, not a band — no
// manifest defines a zero band), never a tick. Geometry is computed from the band count; colors join the
// band tone onto the existing STOP_VAR palette (two same-tone bands share a color — the words
// disambiguate). Everything framework-specific is INLINE-styled so report.css needs no edits and
// archived/legacy renders stay byte-identical.
const toneVar = (tone) => STOP_VAR[GAUGE_STOP_BY_TONE[tone] ?? 2];
// Marker tick resolution, in authority order: (1) the sidecar's exact band word ( T2 single
// derivation — gaugeIndex is a lossy tone-stop: Manageable and Low both map to stop 1, so it can NOT
// place a marker on the ladder); (2) the worst live banded finding (direct renderHtml callers with no
// sidecar); (3) a composite-tier sidecar on a framework run — tone-nearest band, ties toward MORE
// severe, never Clear while gaugeIndex > 0 (doc-50 fail-loud: a rated matter must not render as Clear);
// (4) null → the Clear zero-state.
function frameworkTickIndex(findings) {
  const n = FRAMEWORK.bands.length;
  const byLabel = (lbl) => {
    if (lbl == null) return null;
    const i = FRAMEWORK.bands.findIndex((b) => b.label.toLowerCase() === String(lbl).toLowerCase());
    return i === -1 ? null : (n - 1 - i);              // manifest index (0 = worst) → tick index (rightmost = worst)
  };
  const t = byLabel(VERDICT_INFO?.band?.label) ?? byLabel(VERDICT_INFO?.tier);
  if (t != null) return t;
  const ranks = findings.filter((f) => f?.band != null).map(severityRank).filter((r) => r < n);
  if (ranks.length) return n - 1 - Math.min(...ranks);
  const gi = VERDICT_INFO?.gaugeIndex ?? 0;
  if (gi > 0) {
    let best = 0;                                       // start at the most severe band; replace only on
    for (let i = 1; i < n; i++) {                       // strictly-closer tone ⇒ ties resolve MORE severe
      const d = Math.abs((GAUGE_STOP_BY_TONE[FRAMEWORK.bands[i].tone] ?? 2) - gi);
      const db = Math.abs((GAUGE_STOP_BY_TONE[FRAMEWORK.bands[best].tone] ?? 2) - gi);
      if (d < db) best = i;
    }
    return n - 1 - best;
  }
  return null;
}
// ── THE RATING CARD'S BODY ─────────────────────────────────────────────────────────────────────────
// One card across every report type (the 2026-09-16 report redesign): the band on the company's own ladder, the
// verdict with EVERY condition, "Why <band>" as the four answers with the basis each rests on, the
// highest exposure, and what was searched to get there. Nothing here is composed — the conditions are
// the sidecar's own client-voice clauses, the answers are the engine's, and the coverage line is counts.
function ratingExtras(fm, findings, coverage, fourAnswers, opts, bandWord, conditionsInVerdict = false) {
  const out = [];
  // THE CONDITIONS HAVE ONE HOME PER PATH, AND IT IS NEVER NONE. Where the verdict row could take
  // them — a sidecar whose composed statement carries the "conditional on:" lede — they render there,
  // inside the verdict, which is where the mock puts them and where they read as the terms the verdict
  // is conditional on rather than a list beside it. Where it could not, this row renders exactly as it
  // did: the legacy gauge has no lede to hang them from, and dropping the row there would hide every
  // condition on precisely the archived runs that cannot be re-rendered with better text.
  if (!conditionsInVerdict) {
    const conds = clientConditions(VERDICT_INFO || {});
    if (conds.length) out.push(`<div class="gconds-wrap"><span class="gk">Conditions</span><ul class="gconds">${
      conds.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`);
  }
  const fa = fourAnswers && typeof fourAnswers === 'object' ? fourAnswers : null;
  if (fa) {
    const rows = FOUR_ANSWER_LABELS.map(([key, label], i) => {
      const a = fa[key];
      if (!a || typeof a.read !== 'string' || !a.read.trim()) return '';
      const read = inline(a.read.trim()).trim();
      // AN INTERNAL ANSWER DRAWS NO ROW. This block used to mark a wholly-internal read with `int-note`
      // and render it; the class went with the redesign's removal of internal material from the page,
      // and the row went on rendering — so staff-only prose reached a client's report with nothing
      // marking it at all, which is worse than either state before it. Every other internal line in this
      // file is DROPPED rather than marked (the legal and practical reads, the obstacle notes just
      // below), and this now matches them. A row with no answer left is furniture: the defect the
      // marking was introduced for was a label with its text cut away, and no row leaves no label.
      if (isInternalLabelled(read)) return '';
      if (!read) return '';
      const tok = String(a.token ?? '').toLowerCase();
      let tone = 'mid';
      if (i < 2) tone = /weak|unlikely|none|low/.test(tok) ? 'good' : /strong|likely|high/.test(tok) ? 'bad' : 'mid';
      else tone = /^(registrable|strong|clear)$/.test(tok) ? 'good' : /condition|moderate|medium|qualified|narrow/.test(tok) ? 'mid' : /not|weak|unlikely|blocked|obstructed/.test(tok) ? 'bad' : 'mid';
      const ords = (Array.isArray(a.ordinals) && a.ordinals.length)
        ? ` <span class="fa-ords">${a.ordinals.map((n) => `<a href="#c${n}">#${n}</a>`).join(' ')}</span>` : '';
      const basis = a.basis ? inline(String(a.basis).trim()).trim() : '';
      // THE PER-CLASS OBSTACLES RIDE WITH THE ANSWER THEY QUALIFY. An answer that reads "registrable with
      // conditions" and does not say in which classes leaves the reader with the conclusion and none of
      // the thing they act on. Internal-labelled rows drop, like every other internal line.
      const obsRows = (key === 'registrability' && Array.isArray(a.obstacles) ? a.obstacles : [])
        .map((o) => ({ cls: esc(String(o?.class ?? '')), note: inline(String(o?.note ?? '').trim()).trim() }))
        .filter((o) => o.note && !isInternalLabelled(o.note));
      const obstacles = obsRows.length
        ? `<ul class="fa-obstacles">${obsRows.map((o) => `<li><b>Class ${o.cls}.</b> ${o.note}</li>`).join('')}</ul>` : '';
      return `<div class="fa-row"><span class="fa-k">${label}</span><span class="fa-v">${
        a.token ? `<span class="fa-token tone-${tone}">${esc(humanize(a.token))}</span> — ` : ''}${read}${ords}${
        basis ? `<div class="fa-based"><span class="fa-bk">Based on</span> ${basis}</div>` : ''}${obstacles}</span></div>`;
    }).filter(Boolean);
    if (rows.length) out.push(`<div class="gwhy"><div class="label">Why ${esc(bandWord || '')}</div>${rows.join('')}</div>`);
  }
  const bestRank = findings.reduce((m, f) => Math.min(m, severityRank(f)), Number.MAX_SAFE_INTEGER);
  const worstSet = bestRank === Number.MAX_SAFE_INTEGER ? [] : findings.filter((f) => severityRank(f) === bestRank);
  const worst = worstSet.length
    ? [...new Set(worstSet.map((f) => regionCode(f)))].map((c) => c === COMMON_LAW ? 'Common-law use' : esc(regionName(c) || c))
    : [];
  if (worst.length) out.push(`<div class="grow gexp"><span class="gk">Highest exposure</span><span class="gv">${worst.join(' \u00b7 ')}</span></div>`);
  const sd = opts && opts.searchDepth;
  if (sd && sd.counts) {
    const parts = [];
    const byC = sd.counts.recordsByCountry || {};
    const real = Object.entries(byC).filter(([c]) => c !== 'WO');
    const intl = byC.WO || 0;
    const records = real.reduce((s, [, n]) => s + n, 0);
    if (records) parts.push(real.length === 1 ? `${records.toLocaleString('en-GB')} records read in ${regionName(real[0][0]) || real[0][0]}` : `${records.toLocaleString('en-GB')} records read across ${real.length} countries`);
    if (intl) parts.push(`${intl.toLocaleString('en-GB')} international registrations read`);
    const cleared = ((sd.cleared && sd.cleared.register) || []).length;
    if (cleared) parts.push(`${cleared.toLocaleString('en-GB')} near-names cleared`);
    const rated = findings.filter((f) => f && f.band).length;
    parts.push(`${rated} ${rated === 1 ? 'conflict' : 'conflicts'}`);
    if (sd.counts.localScriptSearched) parts.push('the name searched in local script');
    const cd = sd.counts.courtDecisions;
    if (cd === 'found') parts.push('court decisions checked');
    else if (cd === 'none-found') parts.push('court decisions checked, none touch the name');
    else if (cd === 'not-checked') parts.push('court decisions could not be checked');
    if (parts.length) out.push(`<div class="grow gconf"><span class="gk">Search coverage</span><span class="gv">${parts.map(esc).join(' \u00b7 ')}</span></div>`);
  }
  // ONE NAME FOR ONE FRAMEWORK. A manifest run already prints it in the card's own heading, beside the
  // ladder whose words it governs; adding a second line here named it twice on the same card. The line
  // is for the run that records a framework by name without carrying its manifest.
  if (!FRAMEWORK && fm.rated_under) out.push(`<div class="gframe">Rated on the ${esc(fm.rated_under)}</div>`);
  return out.join('');
}

function frameworkGauge(fm, findings, coverage = [], fourAnswers = null, opts = {}) {
  const ladder = [...FRAMEWORK.bands].reverse();        // manifest is most-severe-first → reverse for left→right
  const n = ladder.length;
  const pct = (k) => `${(((k + 0.5) / n) * 100).toFixed(1)}%`;   // center of flex tick cell k — marker and ticks agree by construction
  const tick = frameworkTickIndex(findings);
  const ticks = ladder.map((b, k) => `<span${k === tick ? ` class="on" style="color:var(${toneVar(b.tone)})"` : ''}>${esc(b.label)}</span>`).join('');
  const grad = `linear-gradient(90deg,var(--clear) 0%,${ladder.map((b, k) => `var(${toneVar(b.tone)}) ${pct(k)}`).join(',')})`;
  const mv = tick == null ? 'var(--clear)' : `var(${toneVar(ladder[tick].tone)})`;
  const label = VERDICT_INFO?.tier || (tick == null ? 'Clear' : ladder[tick].label);
  // Zero-state marker parks LEFT-ANCHORED at the scale origin (transform:none) so a long pill
  // ("No rated conflicts") grows rightward over the scale instead of clipping off the page edge.
  const marker = tick == null
    ? `<div class="marker" style="left:0;transform:none;text-align:left"><div class="pill" style="background:${mv}">${esc(label)}</div><div class="needle" style="background:${mv};margin-left:14px"></div></div>`
    : `<div class="marker" style="left:${pct(tick)}"><div class="pill" style="background:${mv}">${esc(label)}</div><div class="needle" style="background:${mv}"></div></div>`;
  // spec 64 — THE one risk statement (verdict.json.statement, composed once by the sidecar writer)
  // replaces the bare recommendation line when present: band + stance read as ONE labelled sentence.
  // Legacy sidecars (no statement) render today's line byte-identically.
  const rec = VERDICT_INFO?.statement
    ? VERDICT_INFO.statement
    : VERDICT_INFO
      ? (bindRecommendation(fm.recommendation, VERDICT_INFO.verdict, []) || VERDICT_INFO.tier || '')
      : (fm.recommendation || fm.overall_label || '');
  const recLabel = VERDICT_INFO?.statement ? 'Verdict' : 'Recommendation';
  // THE VERDICT CARRIES EVERY CONDITION, NOT THE FIRST AND A COUNT. The composed statement ends
  // "(and N more)" because it is also a ONE-LINE surface — the email lede, the registry row — where a
  // list cannot go. On the page there is room for all of them, and a condition a client is told exists
  // but is not told is one they cannot act on. The lede is taken from the statement's OWN prefix rather
  // than re-composed, so the tier wording stays the engine's and only the truncated tail is replaced;
  // the clauses are the sidecar's client-voice ones, the same list the separate row used to carry.
  // The legacy `gauge()` below keeps the composed line as it stands: an archived run with no framework
  // sidecar renders byte-identically, which is the contract stated there.
  // THE LIST RENDERS ON BOTH PATHS. A sidecar with a composed statement gets the lede and its
  // conditions; a LEGACY one — reasons, no statement, no client-voice clause — has no lede to match, and
  // dropping the list there would hide every condition on exactly the archived runs that cannot be
  // re-rendered with better text. Those still render under the bound recommendation, which is where
  // they were before this row moved.
  const verdictConds = clientConditions(VERDICT_INFO || {});
  const ledeMatch = typeof rec === 'string' ? rec.match(/^(.*?conditional on:)/i) : null;
  const conditionsInVerdict = Boolean(ledeMatch && verdictConds.length);
  const recHtml = conditionsInVerdict
    ? `${esc(ledeMatch[1])}<ul class="gconds">${verdictConds.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : esc(rec);
  const conc = [
    rec && `<div class="grow"><span class="gk">${recLabel}</span><span class="gv gv-rec">${recHtml}</span></div>`,
  ].filter(Boolean).join('');
  // — THE FRAMEWORK IS NAMED WHERE ITS WORDS ARE READ, not only in the footer. `.ticks` below spells
  // a vocabulary ("Manageable", "Moderate") that is meaningless without the framework in force, and the
  // one place that named it sat several screens down at the end of a long document. The footer line stays:
  // it is the printed page's provenance, and the complaint was that the framework was named ONLY there.
  // Styling is in report.css (.gauge .label .gauge-fw), which is not frozen — only this text had to move.
  // frameworkGauge ONLY: the legacy `gauge()` branch below has no manifest to name, so it stays
  // byte-identical for every archived run that has no framework sidecar.
  return `<div class="panel gauge">
    <div class="label">Overall risk<span class="gauge-fw">${esc(FRAMEWORK.title)}</span></div>
    <div class="scale" style="background:${grad}">${marker}</div>
    <div class="ticks">${ticks}</div>
    <div class="gconc">${conc}</div>
    ${ratingExtras(fm, findings, coverage, fourAnswers, opts, label, conditionsInVerdict)}
  </div>`;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');

// A floating "home" pill that returns to the listing from a report. FULLY INLINE-STYLED on purpose: it is
// emitted natively here AND injected into already-rendered reports (pool-admin link-home) whose frozen CSS
// never knew the class — inline styles render identically on both. href is relative to the run dir:
// '../index.html' for the internal report, '../customer/<key>/index.html' for the client export. Absent ⇒ ''.
export function homeButton(href, label = '← All reports') {
  if (!href) return '';
  const style = "position:fixed;left:14px;bottom:14px;z-index:9999;display:inline-flex;align-items:center;"
    + "background:#4E030F;color:#f0e8d8;font:600 12px/1 'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;"
    + "letter-spacing:.04em;padding:9px 14px;border-radius:999px;text-decoration:none;box-shadow:0 3px 10px rgba(37,9,2,.25)";
  // — THE CHROME LINK MEANS "LEAVE THE REPORT", SO IT MUST LEAVE THE FRAME.
  //
  // Targetless, it navigated the IFRAME, where a portal-relative href cannot resolve — counsel's
  // symptom 1, a link that opens in the report's own window and fails. The issue names two ways out and
  // asks for an explicit decision: `target="_top"` needs `allow-top-navigation` in the sandbox, and a
  // new tab does not. The sandbox already carries `allow-popups allow-popups-to-escape-sandbox` and
  // deliberately carries neither `allow-same-origin` nor `allow-top-navigation` (Result.tsx), so a new
  // tab is the option that works without widening the boundary a delivered report is held behind.
  // `rel="noopener"` because a popup that can reach back into `window.opener` is the reason the escape
  // hatch is fenced at all.
  return `<a href="${escAttr(href)}" class="homebtn no-print" target="_blank" rel="noopener" style="${style}">${esc(label)}</a>`;
}

// — THE PRESENTATION SANITIZER IS GONE. doc-52's ENGINE_PLAIN ran find-and-replace over the
// rendered client surface, and is what that cost: `axis` → `group` turned "AXIS Bank filed in
// class 36" into "group Bank filed in class 36", a report naming a mark that does not exist inside the
// report that clears it. Every banned word is a potential trademark and this engine searches the
// trademark register, so no ban list is safe here. What replaced it: the driver emits `areaLabel`
// beside the axis identifier (coverage-ledger.coverageUnitLabel), and the seat is REFUSED the engine
// tokens where it writes them (verify.coverageFormFail). A refusal names the problem to the thing that
// can fix it; a substitution hides it in the one place a client reads.

function inline(s) {
  // T6 (H7): internal-note handling routes through the ONE choke point (publish/parse.mjs
  // stripInternal) BEFORE escaping — global, wrapped-marker-aware; nothing raw survives on any surface.
  s = stripInternal(s, { client: false });
  s = esc(s);
  // External links open in a new tab (spec 47 UX) — internal anchors keep same-tab navigation.
  // Provenance honesty: an authored 'Corsearch · <name>' label whose href is NOT a Corsearch page
  // (live case: Steam storefront links labelled as the register vendor) gets its vendor token replaced
  // by the link's actual host — a lawyer must never cite a storefront as a register record.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (mm, txt, href) => {
    let label = txt;
    const vend = /^(Corsearch)\s*·\s*(.+)$/i.exec(txt);
    if (vend && /^https?:\/\//i.test(href) && !/corsearch\./i.test(href)) {
      try { label = `${new URL(href.replace(/&amp;/g, '&')).host.replace(/^www\./, '')} · ${vend[2]}`; } catch { /* keep authored label */ }
    }
    // XSS: href was already esc()'d above (& < >), but esc() does NOT escape quotes — a `"` in href would
    // break out of the attribute. Quote-escape it here. NOT escAttr(), which re-runs esc() and would
    // double-encode `&` in query strings (?a=1&amp;b=2 -> &amp;amp;). Also allow only safe schemes
    // (http/https/mailto/#fragment); anything else (javascript:, data:, vbscript:, …) renders as PLAIN TEXT.
    if (!(/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || href.startsWith('#'))) return label;
    const safeHref = href.replace(/"/g, '&quot;');
    return /^https?:\/\//i.test(href) ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<a href="${safeHref}">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  return s;
}

// Internal-labelled items get a class so the print stylesheet can honour the export promise
// ("Internal (review-only) notes are removed on export") — they used to print into the PDF. ONE
// definition (it used to be a local of renderProse): the P5 typed-field helpers below render their
// own <p>/<li> elements from findings.json free strings and must wear the same class, or a wholly
// internal legal_position/practical_position/manageable.reason/obstacle note prints into the PDF
// while the same bytes in prose do not.
const isInternalLabelled = (s) => /^\s*\[internal\]/i.test(String(s ?? ''));

// Markdown prose (paragraphs + `- ` lists) → HTML. Internal notes are handled by the stripInternal
// choke point (whole-internal bullets disappear on the client export; labelled internally).
function renderProse(text) {
  const lines = stripInternal(text || '', { client: false }).split('\n');
  let html = '', list = [], para = [];
  // Item 18 (owner, 2026-09-16): a line the engine labels internal does not reach the delivered page.
  // It was classed and hidden in print only, so every client reading in the portal saw it. It stays in
  // the findings record, the audit workbook and the assistant, which is where the audit belongs.
  const flushList = () => {
    if (!list.length) return;
    const kept = list.filter((li) => !isInternalLabelled(li));
    if (kept.length) html += '<ul>' + kept.map((li) => `<li>${inline(li)}</li>`).join('') + '</ul>';
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    const txt = para.join(' ');
    if (!isInternalLabelled(txt)) html += `<p>${inline(txt)}</p>`;
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    // Markdown residue that used to render literally on reader surfaces: '---' rules disappear;
    // a stray '## heading' renders as a bold lead-in, never as literal hash marks.
    if (/^-{3,}$/.test(line)) { flushPara(); flushList(); continue; }
    if (/^#{1,6}\s/.test(line)) { flushPara(); flushList(); html += `<p><b>${inline(line.replace(/^#{1,6}\s+/, ''))}</b></p>`; continue; }
    if (line.startsWith('- ')) { flushPara(); list.push(line.slice(2)); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return html;
}

// ── data helpers (the findings.json → presentation maps) ─────────────────────────────────────────────
const RISK_STOPS = ['clear', 'low', 'medium', 'high', 'severe'];   // gauge 5-stop ramp (left→right)
const STOP_LEFT = ['10%', '30%', '52%', '78%', '94%'];             // marker left position per stop
const STOP_VAR = ['--clear', '--low', '--med', '--high', '--severe'];
// wp50 — ONE display vocabulary: the five client tier words (CLIENT_TIER_BY_COMPOSITE) everywhere a
// level is worded. The gauge/topbar spoke a THIRD scale ("SEVERE") while cards said "VERY HIGH" and
// prose said "High" — three words for one level on one page (VENZY ashen-vault). Display-label
// layer only, gated on VERDICT_INFO: RISK_STOPS stays untouched (STOP_VAR CSS keys off it) and
// sidecar-less archived runs render byte-identically. Stop 1 covers composites 1–2 (GAUGE_BY_COMPOSITE),
// so its tick is labelled with both words.
const TIER_STOP_LABELS = ['Clear', 'Low / Manageable', 'Medium', 'High', 'Very high'];
const TIER_STOP_PILL = ['CLEAR', 'LOW', 'MEDIUM', 'HIGH', 'VERY HIGH'];

// Overall risk index (0-4) — the derived display verdict when present ( T2, one authority),
// else the report's stated overall, else the worst composite (legacy).
function overallIndex(fm, findings) {
  if (VERDICT_INFO?.gaugeIndex != null) return VERDICT_INFO.gaugeIndex;
  const lbl = String(fm.overall_label || '').toLowerCase();
  for (let i = RISK_STOPS.length - 1; i >= 0; i--) if (lbl.includes(RISK_STOPS[i])) return i;
  const maxC = findings.reduce((m, f) => Math.max(m, f.composite || 0), 0);
  return maxC >= 5 ? 4 : maxC === 4 ? 3 : maxC === 3 ? 2 : maxC >= 1 ? 1 : 0;
}
const humanize = t => String(t || '').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
// Display-site sentence-casing for data tokens that are lowercase by contract (registrationSystem words,
// coverage areas) — the stored token is shared driver data and must not change; only the rendering does.
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// source_type → the card's source chip (Register / Common-law / Case-law).
function sourceChip(st) {
  if (/^register/.test(st)) return { label: 'Register', cls: 'reg' };
  if (/^case-law/.test(st)) return { label: 'Case-law', cls: 'cl' };
  return { label: 'Common-law', cls: 'cl' };
}
// T7 (E1) — the chip SET derived from the evidence actually on the finding: a card reads as
// one integrated analysis (register + marketplace/web + case-law + use), never a single either/or
// source tag. f.source stays the primary provenance link; the chips state which layers contributed.
function evidenceChips(f) {
  const chips = [];
  if ((f.owner?.registrations ?? []).length || /^register/.test(f.source?.source_type || '')) chips.push({ label: 'Register', cls: 'reg' });
  if (f.use_check?.source || /^common-law/.test(f.source?.source_type || '')) chips.push({ label: 'Marketplace / web', cls: 'cl' });
  if (CASE_LAW_BY_ORD.has(f.ordinal)) chips.push({ label: 'Case-law', cls: 'cl' });
  const use = f.meters?.use?.token;
  if (use === 'confirmed') chips.push({ label: 'Use ✓', cls: 'reg' });
  else if (use === 'none' || use === 'no-use') chips.push({ label: 'Use ✗', cls: 'cl' });
  if (!chips.length) chips.push(sourceChip(f.source?.source_type || ''));
  return chips.map((c) => `<span class="src ${c.cls}">${c.label}</span>`).join('');
}
// CHANGE 2 (banding) — placement is by DISPOSITION when the run carries it, else by composite (legacy).
// disposition NEVER touches composite/level; it only chooses the band a card renders in:
//   adversarial → band 1 (On-field conflicts, drives the verdict)
//   coexistence-partner / distinguished → band 2 (Notable but manageable)
//   off-field → band 3 (Commercial awareness)
// A finding with NO disposition while the run IS in disposition mode falls back to the composite split per the
// SHARED CONTRACT back-compat rule (composite≥3 ⇒ band 1, composite≤2 ⇒ band 3). In legacy mode (no finding
// carries disposition) bandOf is never consulted for sectioning — isOnField (composite≥3) drives the 2-section
// split exactly as before, so a legacy run is byte-identical.
// T6 (H8): DISPOSITION_BAND / bandOf moved to findings-model.mjs — ONE banding source shared
// by sectioning AND the blocking-power sort (imported above).
// on-field = "drives the read" prominence (full card, gold marker, region open-by-default). In disposition
// mode that is band 1; in legacy mode it is composite≥3 (unchanged).
const isOnField = f => DISPOSITION_MODE ? bandOf(f) === 1 : (f.composite || 0) >= 3;

// ── region grouping (the redesign's only new derivation; everything else is reflow of existing data) ────
// A finding's region/jurisdiction is DERIVED from existing fields, never invented: the first registration's
// jurisdiction, else the office encoded in its uri (/mark/<cc>/…), else the owner country, else common-law.
// Codes are normalized (GB→UK, EM/EUTM→EU) and mapped to a display name via publish/regions.mjs — the ONE
// naming source; an unknown office keeps its raw uppercased code as both code and name, so a new register
// surfaces correctly without a code change. The common-law sentinel is 'C/L' (CL is Chile).

// regionCode(finding): registrations[0].jurisdiction → office from registrations[0].uri → owner.country → C/L.
// The uri office is the path segment after `/mark/` (real shape) or the first 2-letter path segment before an
// id (the test shape `/us/3396572`); a leading `/` anchor keeps it from matching a 2-letter token in the host.
function regionCode(f) {
  const reg = f.owner?.registrations?.[0];
  if (reg?.jurisdiction) return normRegion(reg.jurisdiction);
  const uri = reg?.uri || '';
  const m = uri.match(/\/mark\/([a-z]{2,3})\//i) || uri.match(/\/([a-z]{2})\/[A-Za-z0-9]/);
  if (m) return normRegion(m[1]);
  if (/^common-law/.test(f.source?.source_type || '')) return COMMON_LAW;
  if (f.owner?.country) return normRegion(f.owner.country);
  return COMMON_LAW;
}

// groupByRegion: ordered regions, each { code, name, count, hasOnField, chip, findings[] }. Region order =
// ascending lowest ordinal in the region (preserves the run's exposure ranking). chip = fixed two-state
// (C3 if the region holds an on-field finding, else C2) per the spec — NOT the literal max composite.
function groupByRegion(findings) {
  const map = new Map();
  for (const f of findings) {
    const code = regionCode(f);
    if (!map.has(code)) map.set(code, []);
    map.get(code).push(f);
  }
  const minOrd = g => g.reduce((m, f) => Math.min(m, f.ordinal ?? Infinity), Infinity);
  // doc-54 — in framework mode the region header chip speaks the group's WORST band word (the same
  // vocabulary as the keyrow/card chips beneath it); the C3/C2 composite codes are internal engine
  // shorthand and stay legacy-render-only. A group with no banded finding falls back to the codes.
  const bandChip = (g) => {
    if (!FRAMEWORK) return null;
    const ranks = g.filter((f) => f?.band != null).map(severityRank).filter((r) => r < FRAMEWORK.bands.length);
    return ranks.length ? esc(FRAMEWORK.bands[Math.min(...ranks)].label) : null;
  };
  return [...map.entries()]
    .map(([code, g]) => {
      const hasOnField = g.some(isOnField);
      return { code, name: regionName(code), count: g.length, hasOnField, chip: bandChip(g) || (hasOnField ? 'C3' : 'C2'), findings: g, _min: minOrd(g) };
    })
    .sort((a, b) => a._min - b._min || a.code.localeCompare(b.code));
}

// meter token → { pip class, caption }. Risk meters use the high/med/low ramp; use uses green; enforcer
// states its basis (B1 — verified vs inferred, never present inferred as fact).
// A4 — when the publish-time receipt join ran (joinEvidenceStatus stamped `_status`), every
// meter's caption carries the four-tuple: verified (source joins a fetch receipt) / assumed (claims
// verified, receipt missing) / inferred / not checked. Absent `_status` (direct renderHtml callers,
// archived replays) the caption is byte-identical to the legacy form.
const EVIDENCE_LABEL = { confirmed: 'verified', assumed: 'not yet verified', inferred: 'inferred', 'not-checked': 'not checked' };
// D4 — the meter's own `basis` enum, mapped to the SAME four client evidence words EVIDENCE_LABEL
// uses. It is the fallback for a run with no receipt join, so a legacy enforcer's basis lands in the
// evidence position rather than in the fact position, and one page has ONE evidence vocabulary.
const EVIDENCE_BASIS_LABEL = { 'verified-from-record': 'verified', 'inferred-from-signal': 'inferred' };
// D4 — the use-check SOURCE CLASS, one definition. It was declared twice with two different
// strings for the same member: fullDetail said 'register mirror — not evidence of use' and the
// common-law contribution list said 'register mirror — not use evidence'. Two copies of one
// vocabulary is the drift this file has been split apart to stop, so they are one const now, and the
// words say what they are — a SOURCE phrase, readable after "Evidence: verified,".
const USE_SOURCE_LABEL = {
  'owner-site': "from the owner's own site",
  independent: 'from an independent source',
  'register-mirror': 'from a register mirror, which is not evidence of use',
};
// — THE USE LINE PRINTS NO VERIFICATION WORD (owner ruling, 2026-08-31, verbatim: "a
// website does not equal a citation on a register record — so how would that ever line up. So yes,
// drop it"). A use meter reaches `confirmed` only via the `/mark/…` fetch-receipt join, and an http
// source has no receipt to join — measured across every report in both pools: ZERO occurrences of
// "Evidence: verified, from" ever. A label with one reachable value carries no information, and a
// lawyer reads "not yet verified" as doubt about the FACT. `inferred` and `not checked` are different
// facts (a mirror's not-checked is the honesty) and stay. The receipt vocabulary is UNCHANGED on the
// register meters, where the join is real — only this line loses it.
const USE_EVIDENCE_LABEL = { inferred: 'inferred', 'not-checked': 'not checked' };
// The evidence sentence for a use meter: where the page it rests on came from (and the non-receipt
// statuses that still say something).
const useEvidence = (m) => [USE_EVIDENCE_LABEL[m?._status], USE_SOURCE_LABEL[m?._useSourceClass]].filter(Boolean).join(', ');
// D7 — `use_check.source` carries exactly ONE legal "we searched and found nothing" value, and it
// is a CODE-OWNED SENTINEL: stages.mjs dictates it, findings-model.mjs names it in two refusals, and
// use-check.mjs wires it into validators.narrative as FATAL. It is not client prose and it is not a
// pattern — it is an enum member with one spelling, so it is mapped here, at the render boundary, by
// EXACT EQUALITY, exactly as EVIDENCE_LABEL maps `_status`. The sentinel itself does not move: archived
// runs carry the old value forever and a fourth spelling of it would have to be accepted everywhere.
const USE_CHECK_NO_RESULT = 'perplexity_research — no result';
const USE_CHECK_NO_RESULT_CITE = 'Nothing found in the marketplaces searched.';
// — MATCHED ON NORMALISED PUNCTUATION, NOT ONE SPELLING. The constant itself does not
// move (archived runs carry it forever, the validators name it), but the SEAT emitted a hyphen where
// the doctrine writes an em dash, and exact equality let the raw tool name through to a delivered
// report twice. Dash class and whitespace fold to one form on both sides; anything else is a source
// string and rides through untouched — this widens the match to the sentinel's own dash/space
// variants and to nothing else.
const isUseCheckNoResult = (s) => {
  const norm = (x) => String(x ?? '').replace(/[‐-―−-]+/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(s) === norm(USE_CHECK_NO_RESULT);
};
// D4 — a meter states TWO facts and they are not the same kind of thing: `cap` is what was found,
// `ev` is how well it is evidenced. They used to be fused with ' · ', which a client reads as one
// caption — "Confirmed · inferred" is an oxymoron until you know the separator means "and we know that
// because". meters() gives them two labelled positions instead; nothing is re-rated and no fact word
// changes.
function meter(name, entry) {
  const e = entry || {};
  const tok = e.token || 'unknown';
  const st = EVIDENCE_LABEL[e._status] || '';
  const basis = EVIDENCE_BASIS_LABEL[e.basis] || '';
  if (name === 'use') {
    const cls = tok === 'confirmed' ? 'g3' : '';
    const cap = tok === 'confirmed' ? 'Confirmed' : tok === 'not-confirmed' ? 'Not confirmed' : 'Unknown';
    // — same rule as useEvidence: no verification word on the use surface (its receipt
    // join is unreachable by construction); inferred / not checked still say something and stay.
    return { label: 'Use', cls, cap, ev: USE_EVIDENCE_LABEL[e._status] || '' };
  }
  const cls = tok === 'high' ? 'l3' : tok === 'medium' ? 'l2' : tok === 'low' ? 'l1' : '';
  // The 2026-09-16 report redesign — "Enforcer" was a noun for the owner; the meter measures what the owner is
  // likely to DO, which is what a reader is deciding about. The token under it is unchanged.
  const label = name === 'mark_similarity' ? 'Similarity' : name === 'goods_proximity' ? 'Goods proximity' : 'Likely to enforce';
  // With a joined status the status REPLACES the raw basis word on the enforcer — "verified" with no
  // receipt behind it is exactly the self-attestation A4 exists to demote.
  return { label, cls, cap: humanize(tok), ev: st || (name === 'enforcer' ? basis : '') };
}

// Join a finding to its report.md prose card. Every card's first body line is `- ord: <ordinal>`
// (emitted by the report-card stage, parsed into card.meta.ord) and the driver already orders +
// provenance-checks cards by it — so match on THAT exact, injective key. The old fuzzy owner/mark
// containment collapsed distinct findings onto one card (`.find()` first-match): two findings sharing
// a mark, or whose mark is a substring of another's ("nova" ⊂ "novadex"), all matched the first card,
// rendering one card's prose under every finding (the "02 On-field conflicts" duplication). The
// fuzzy match is kept ONLY as a fallback for legacy artifacts whose cards predate the `- ord:` line.
function matchCard(finding, cards) {
  const list = cards || [];
  const ordKeyed = list.some(c => c?.meta?.ord != null);   // new-format cards carry `- ord:`
  if (ordKeyed) {                                           // exact key ⇒ one card per finding, null on miss
    const ord = String(finding?.ordinal ?? '');
    return (ord && list.find(c => String(c.meta?.ord ?? '') === ord)) || null;
  }
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const owner = norm(finding.owner?.name), mark = norm(finding.mark);
  return list.find(c => {
    const who = norm(c.who);
    return owner && (who.includes(owner) || owner.includes(who)) || (mark && who.includes(mark));
  }) || null;
}
const cardBlock = (card, re) => (card?.blocks || []).filter(b => re.test(b.label)).map(b => b.body).join('\n');

// ── components ────────────────────────────────────────────────────────────────────────────────────────
// Conclusion card (left of the hero): the overall-risk dial + ticks, then the verdict beneath it —
// Recommendation + Open conditions (moved here from the old facts card; the summary paragraph now lives once
// under the headline, so the gauge's old caption <p> is dropped — §2.6 de-duplication).
function gauge(fm, findings, coverage = [], fourAnswers = null, opts = {}) {
  // doc-54 — framework runs get the manifest's own dynamic ladder; the legacy body below is untouched
  // so archived / sidecar-less runs render byte-identically.
  if (FRAMEWORK) return frameworkGauge(fm, findings, coverage, fourAnswers, opts);
  const i = overallIndex(fm, findings);
  // wp50: with a verdict sidecar the pill speaks the client tier word (VERY HIGH, never SEVERE) —
  // the derived tier when present, else the positional word; legacy (no sidecar) is byte-identical.
  const label = VERDICT_INFO ? (VERDICT_INFO.tier || TIER_STOP_PILL[i]) : RISK_STOPS[i].toUpperCase();
  const stopWords = VERDICT_INFO ? TIER_STOP_LABELS : RISK_STOPS.map(humanize);
  const ticks = stopWords.map((s, k) => `<span${k === i ? ' class="on"' : ''}>${s}</span>`).join('');
  // doc-35 close-the-loop: the "Open conditions: N to close" KPI was a self-audit metric — the engine
  // narrating how many searches it left open, promoted to a hero number beside the risk dial. A closeable
  // gap is CLOSED or stated as a forward action, never counted as a headline "condition". Chip removed.
  // T2 (H5): with the derived verdict present, the recommendation is BOUND to it (an
  // unconditional "proceed" on a CONDITIONAL run gains its conditions) and the fallback label is the
  // derived tier — the hero can no longer contradict the client summary or the email.
  // doc-52 — the conditions are stated ONCE, in the plain "subject to:" bound line in the verdict block
  // (sourced from "Only you can close these"). The gauge shows the bare recommendation so the page has a
  // single conditions home, not three near-duplicate "subject to" lines. bindRecommendation with no
  // reasons still binds BLOCKING and leaves a CONDITIONAL "proceed" un-suffixed (the bound line qualifies it).
  // spec 64 — same statement-first rule as frameworkGauge; legacy (no statement) is byte-identical.
  const rec = VERDICT_INFO?.statement
    ? VERDICT_INFO.statement
    : VERDICT_INFO
      ? (bindRecommendation(fm.recommendation, VERDICT_INFO.verdict, []) || VERDICT_INFO.tier || '')
      : (fm.recommendation || fm.overall_label || '');
  const recLabel = VERDICT_INFO?.statement ? 'Verdict' : 'Recommendation';
  const conc = [
    rec && `<div class="grow"><span class="gk">${recLabel}</span><span class="gv gv-rec">${esc(rec)}</span></div>`,
  ].filter(Boolean).join('');
  return `<div class="panel gauge">
    <div class="label">Overall risk</div>
    <div class="scale"><div class="marker" style="left:${STOP_LEFT[i]}"><div class="pill" style="background:var(${STOP_VAR[i]})">${label}</div><div class="needle" style="background:var(${STOP_VAR[i]})"></div></div></div>
    <div class="ticks">${ticks}</div>
    <div class="gconc">${conc}</div>
    ${ratingExtras(fm, findings, coverage, fourAnswers, opts, label)}
  </div>`;
}

// Scope card (right of the hero): the FACTS of what was searched — Classes · Jurisdictions searched (as
// wrapping mono chips, §2.8) · Searched (date + source). The verdict (recommendation + open conditions) now
// lives with the dial, so this card is scope-only.
function facts(fm, findings, coverage) {
  const chips = jurisdictionChips(fm, coverage, findings);
  // T6 (H10) — the worst-exposure jurisdiction(s), derived honestly from the highest-rated
  // LIVE finding(s): the one geographic answer a reader asks first ("where does this bite hardest?").
  // Suppressed when there are no rated findings. C/L reads as "common-law use".
  const bestRank = findings.reduce((m, f) => Math.min(m, severityRank(f)), Number.MAX_SAFE_INTEGER);
  const worstSet = bestRank === Number.MAX_SAFE_INTEGER ? [] : findings.filter((f) => severityRank(f) === bestRank);
  const worst = worstSet.length
    ? [...new Set(worstSet.map((f) => regionCode(f)))]
        .map((c) => c === COMMON_LAW ? 'Common-law use' : `<span title="${escAttr(regionName(c))}">${esc(c)}</span>`)
    : [];
  const rows = [
    fm.classes && `<div class="row"><span class="k">Classes</span><span class="v">${esc(fm.classes)}</span></div>`,
    chips ? `<div class="row jrow"><span class="k">Jurisdictions searched</span>${chips}</div>`
      : (fm.jurisdiction && `<div class="row"><span class="k">Jurisdictions searched</span><span class="v">${esc(fm.jurisdiction)}</span></div>`),
    worst.length && `<div class="row"><span class="k">Highest exposure</span><span class="v">${worst.join(' ')} <span style="font-size:10.5px;color:var(--faint,#8a8a8a)">— from the highest-rated finding${worst.length > 1 || worstSet.length > 1 ? 's' : ''}</span></span></div>`,
    (fm.run || fm.searched) && `<div class="row"><span class="k">Searched</span><span class="v"><span class="mono" style="font-size:12px">${esc(fm.searched || fm.run)}</span></span></div>`,
  ].filter(Boolean);
  return `<div class="panel facts">${rows.join('')}</div>`;
}

// Jurisdiction chips for the scope card. Primary source = the coverage ledger's PER-JURISDICTION register
// rows ("register / US", "register / CN (make-or-break)", "register / TR") — the searched scope, carrying the
// coverage-limited/not-searched state the dashed `*` chip needs. The leading code must be an UPPERCASE office
// code at a word boundary, so an AXIS-style ledger (rows like "register / bare-MARK exact-in-class floor" or
// "register / priority markets NZ, IN, TR") matches nothing and we fall back to the findings' own regions —
// a sensible searched-set for those runs (and for coverage-less / single-finding runs). Insertion order is
// preserved (coverage order, else exposure order); common-law (C/L) is not a jurisdiction chip.
function jurisdictionCodes(fm, coverage = [], findings = []) {
  const order = [], meta = new Map();
  // The plan's own answer when publish supplied one; otherwise the ledger-prose sniff below decides,
  // exactly as before. A plan that says worldwide is never overridden by prose that forgot to say so.
  let worldwide = SCOPE_WORLDWIDE === true;
  const add = (code, limited) => {
    if (!code || code === COMMON_LAW) return;
    if (!meta.has(code)) { meta.set(code, { limited: !!limited }); order.push(code); }
    else if (limited) meta.get(code).limited = true;
  };
  // T6 (D4): the machine-derived searched set wins — the plan's regions ARE what ran.
  // Coverage-limited/not-searched states still ride in from the ledger rows below.
  if (SEARCHED_JUR) for (const j of SEARCHED_JUR) add(normRegion(j), false);
  for (const c of coverage) {
    const area = String(c.area || '');
    // wp50: a worldwide register sweep must READ as worldwide (VENZY's header showed the citation core
    // only, omitting the very countries holding the top conflict). Detected from the ledger's own words.
    if (/^\s*register\s*\//.test(area) && /\bworld-?wide\b|\bglobal register\b/i.test(`${area} ${String(c.note || '')}`)) worldwide = true;
    // wp50: transliteration/script rows carry SCRIPT tokens (ZH/AR/CY/…), not jurisdictions — VENZY's
    // header grew fake "ZH KR AR CY" chips from "register / transliteration axis (JP/ZH/KR/AR/CY/…)".
    // The row is skipped whole: a code blacklist can't work (KR is Korea, CL is Chile elsewhere).
    if (/translit|script|devanagari|cyrillic|hangul|katakana|hiragana/i.test(area)) continue;
    const limited = c.state === 'coverage-limited' || c.state === 'not-searched';
    const m = area.match(/^\s*register\s*\/\s*([A-Z]{2,3})(?=[\s,(/]|$)/);
    if (m) { add(normRegion(m[1]), limited); continue; }
    // T6 (D4): tolerate a code LIST in one register row ("register / material jurisdictions
    // US·EU·UK·CN…") — copper-spire's shape, which the single-code regex missed entirely.
    // wp50: every harvested code must be a KNOWN region (the old `|| codes.length > 2` admitted
    // arbitrary uppercase tokens from long rows).
    if (SEARCHED_JUR == null && /^\s*register\s*\//.test(area)) {
      const codes = area.split('/').slice(1).join('/').match(/\b[A-Z]{2,3}\b/g) || [];
      for (const code of codes) if (REGION_NAMES[normRegion(code)]) add(normRegion(code), limited);
    }
  }
  if (!order.length) for (const f of findings) add(regionCode(f), false);   // axis-style ledger ⇒ use the findings' regions
  // wp50: UNION the risk-bearing jurisdictions — every registration leg of a live composite≥3 finding.
  // The scope line can never again drop the countries where the risk actually lives (VENZY: TR/AE/SA,
  // home of the identical registered mark, were absent while "Highest exposure: AE" showed below).
  // Union only ADDS codes after the searched set — the searched scope stays legible up front.
  for (const f of findings) {
    if (f?.disposition === 'withdrawn') continue;
    // material = composite>=3 (legacy) or banded above the framework's lowest band (doc 50)
    const material = FRAMEWORK && f?.band != null
      ? severityRank(f) < FRAMEWORK.bands.length - 1
      : (Number(f?.composite) || 0) >= 3;
    if (!material) continue;
    for (const code of findingRegions(f)) add(code, false);
  }
  return { order, meta, worldwide };
}

// wp50: ALL of a finding's registration legs (jurisdiction field, else the uri office), not just leg 0 —
// regionCode() answers "where does this finding group?", this answers "where does its risk live?".
function findingRegions(f) {
  const out = new Set();
  for (const reg of f?.owner?.registrations ?? []) {
    let code = null;
    if (reg?.jurisdiction) code = normRegion(reg.jurisdiction);
    else {
      const uri = String(reg?.uri || '');
      const m = uri.match(/\/mark\/([a-z]{2,3})\//i) || uri.match(/\/([a-z]{2})\/[A-Za-z0-9]/);
      if (m) code = normRegion(m[1]);
    }
    if (code && code !== COMMON_LAW) out.add(code);
  }
  if (!out.size) { const c = regionCode(f); if (c && c !== COMMON_LAW) out.add(c); }
  return [...out];
}

function jurisdictionChips(fm, coverage = [], findings = []) {
  const { order, meta, worldwide } = jurisdictionCodes(fm, coverage, findings);
  if (!order.length && !worldwide) return '';
  // doc-55 B — the WIPO/Madrid international register is ALWAYS in scope for a worldwide sweep (corsearch
  // returns /mark/int/ records in-sweep), so WO is ALWAYS shown for a worldwide run — consistently, whether
  // or not a Madrid conflict happened to surface (one recent run showed WO, another omitted it). A Madrid
  // FINDING already contributes WO via the INT→WO normalization; this guarantees the register SOURCE reads
  // as covered even when the sweep found nothing there. Never forced on a non-worldwide (targeted) run.
  const codes = (worldwide && !order.includes('WO')) ? [...order, 'WO'] : order;
  const chips = codes.map(code => { const v = meta.get(code) || { limited: false };
    return `<span class="jchip${v.limited ? ' lim' : ''}" title="${escAttr(regionName(code))}${v.limited ? ' — coverage-limited' : ''}">${esc(code)}${v.limited ? '*' : ''}</span>`; }).join('');
  // wp50: a worldwide sweep leads the chips and gets its own plain-language note.
  const wwChip = worldwide ? `<span class="jchip ww" title="the register sweep ran worldwide — chips show the citation focus and the jurisdictions where conflicts live">worldwide</span>` : '';
  const limited = order.filter(code => meta.get(code).limited);
  const notes = [
    worldwide ? `<div class="jnote">register sweep ran worldwide — chips show the citation focus and where the conflicts live</div>` : '',
    // doc-55 B — honest source completeness: a worldwide register search covers, for every jurisdiction in
    // scope, its national register, the EU regional register where one applies, AND WIPO/Madrid international
    // registrations designating it — not one source per territory.
    worldwide ? `<div class="jnote">every jurisdiction cleared across its national register, the EU regional register where applicable, and WIPO/Madrid (WO) international registrations designating it</div>` : '',
    // — THE POINTER NAMES THE HEADING VERBATIM. It said “What we covered”, and the heading it points
    // at reads "What we covered — and what's open" (scopeSection). A reader who ctrl-Fs the quoted words
    // lands on a prefix of a title rather than the title, and there is no anchor to follow instead: the
    // report is served in a null-origin iframe where fragment jumps go nowhere (the same fact the B1 note
    // below gives for deleting the Subject-to line). A cross-reference is only worth its bytes if the
    // words it quotes are the words on the page.
    //
    // IT CANNOT DANGLE. `limited` is populated only from coverage rows carrying a coverage-limited /
    // not-searched state, so a limited chip implies at least one coverage row, which is the exact
    // condition the heading renders under. Checked rather than assumed — the alternative was a
    // `coverage.length` guard here that no input can reach, and a guard that cannot fire is a claim
    // nobody can check.
    limited.length ? `<div class="jnote">* ${esc(limited.join(', '))} — coverage-limited (see “What we covered — and what's open”)</div>` : '',
  ].join('');
  return `<div class="jchips">${wwChip}${chips}</div>${notes}`;
}

// spec 47 UX: the title heading carries the matter's scope at a glance — classes + searched countries —
// with the full country name on hover. Inline-styled (like homeButton) so frozen template CSS needs no change.
function headScope(fm, coverage = [], findings = []) {
  const { order: codes, worldwide } = jurisdictionCodes(fm, coverage, findings);
  if (!fm.classes && !codes.length && !worldwide) return '';
  const cls = fm.classes ? `<span>Cl.&nbsp;${esc(fm.classes)}</span>` : '';
  const jur = codes.map(c => `<span title="${escAttr(regionName(c))}">${esc(c)}</span>`).join(' ');
  const style = "margin:4px 0 0;font:600 13px/1.5 'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;"
    + "letter-spacing:.05em;opacity:.75";
  // wp50: a worldwide sweep leads the scope line; the codes read as the focus set, never as the
  // whole scope ("Cl. 5 · US EU UK CH JP" under a worldwide search reads as a narrow search).
  const parts = worldwide
    ? [cls, `<span title="the register sweep ran worldwide (all reachable registers)">worldwide register sweep</span>`, jur ? `<span style="opacity:.85">focus:</span> ${jur}` : '']
    : [cls, jur];
  return `<div class="mark-scope" style="${style}">${parts.filter(Boolean).join(' · ')}</div>`;
}

// ── ABOUT THIS REQUEST ─────────────────────────────────────────────────────────────────────────────
// The scope line, the facts card and the covers sentence were three places saying what was asked for.
// They are one labelled panel now, directly under the name, on every report type (the 2026-09-16 report redesign).
// Every row is a fact the run already carries: nothing here is composed.
function aboutPanel(fm, coverage = [], findings = [], opts = {}) {
  const { order: codes, meta, worldwide } = jurisdictionCodes(fm, coverage, findings);
  // A JURISDICTION SEARCHED WITH LIMITED COVERAGE SAYS SO HERE. The chips this row replaces carried that
  // on the office's own chip; a plain list of country names would read as "all of these were searched"
  // and quietly drop the one thing in the row a reader could act on. The worldwide sweep also always
  // covers the international register, which is why WO joins the list on a worldwide run.
  const shown = (worldwide && !codes.includes('WO')) ? [...codes, 'WO'] : codes;
  const where = shown.map((c) => {
    const name = regionName(c) || c;
    return meta.get(c)?.limited ? `${name} (coverage-limited)` : name;
  }).filter(Boolean).join(', ');
  // The type of search is the bolded head of the depth note the driver already composes; the rest of
  // that sentence is the product's covers line, which the owner ruled off the page.
  const note = String(opts.depthNote ?? '').trim();
  const cut = note.lastIndexOf(' — ');
  const stage = cut > 0 ? note.slice(0, cut).trim() : note;
  const rows = [
    ['Type of search', stage],
    ['Instructed use', fm.use || ''],
    ['Classes', fm.classes || ''],
    ['Where searched', worldwide ? (where ? `Worldwide, focus on ${where}` : 'Worldwide') : where],
    ['Project', fm.run_under_project || ''],
    ['Searched on', fm.searched || fm.run || ''],
  ].filter(([, v]) => String(v || '').trim());
  if (!rows.length) return '';
  return `<div class="panel about"><div class="label">About this request</div>${
    rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')
  }</div>`;
}

function doFirst(secs) {
  const t = secs['Do this first'] || secs['Do This First'] || '';
  if (!t.trim()) return '';
  const nl = t.indexOf('\n');
  const head = nl < 0 ? t.trim() : t.slice(0, nl).trim();
  const body = nl < 0 ? '' : t.slice(nl + 1).trim();
  return `<div class="firstUp"><div class="ic">!</div><div>
    <div class="tcrit">Do this first · time-critical</div>
    <h3>${inline(head)}</h3>${body ? `<p>${inline(body)}</p>` : ''}
  </div></div>`;
}

// wp50/wi5 — the # Actions section renders ON the report. It previously reached only the email cover,
// so the "Answers to your instructions" Q&A (bad-meaning / descriptiveness asks) was EMAIL-ONLY and the
// report never showed the two-bucket next-steps — nothing important may exist only in the email. An
// UNNUMBERED panel above the numbered sections keeps the legacy 01/02/03 section numbering byte-stable.
// Buckets render in AUTHORED order (the contract opens with "Answers to your instructions"); prose goes
// through renderProse/inline so the stripInternal choke point owns ::p:: on the client export.
function actionsPanel(actionsText) {
  const t = String(actionsText ?? '');
  if (!t.trim()) return '';
  if (!/^###\s/m.test(t)) return `<div class="panel actions">${renderProse(t)}</div>`;
  const idx = t.search(/^###\s/m);
  const preface = t.slice(0, idx).trim();
  const parts = preface ? [renderProse(preface)] : [];
  for (const b of t.slice(idx).split(/^### /m).map(s => s.trim()).filter(Boolean)) {
    const nl = b.indexOf('\n');
    const label = (nl < 0 ? b : b.slice(0, nl)).trim();
    const body = nl < 0 ? '' : b.slice(nl + 1).trim();
    if (!body) continue;
    const kind = /answers to your instructions/i.test(label) ? 'ans' : /checks we ran|what we found/i.test(label) ? 'ran' : 'you';
    const ic = kind === 'ans' ? '✎' : kind === 'ran' ? '✓' : '→';
    parts.push(`<div class="actgrp act-${kind}"><h3><span class="actic">${ic}</span> ${inline(label)}</h3>${kind === 'ans' ? answersHtml(body) : renderProse(body)}</div>`);
  }
  return parts.length ? `<div class="panel actions" id="actions">${parts.join('')}</div>` : '';
}

// doc-52 — the # Actions section is SPLIT to three reading slots instead of one mid-page panel:
// "Answers to your instructions" → the verdict block (§1); "Only you can close these" → after the
// conflicts (§3); "Checks we ran — what we found" → the collapsed Scope section (§4). Parse the buckets
// once here; each slot renders its own. Back-compat: a flat (un-bucketed) Actions section returns preface.
export function parseActionBuckets(actionsText) {
  const t = String(actionsText ?? '');
  const out = { preface: '', ans: null, ran: null, you: null };
  if (!t.trim()) return out;
  if (!/^###\s/m.test(t)) { out.preface = t.trim(); return out; }
  const idx = t.search(/^###\s/m);
  out.preface = t.slice(0, idx).trim();
  for (const b of t.slice(idx).split(/^### /m).map(s => s.trim()).filter(Boolean)) {
    const nl = b.indexOf('\n');
    const label = (nl < 0 ? b : b.slice(0, nl)).trim();
    const body = nl < 0 ? '' : b.slice(nl + 1).trim();
    if (!body) continue;
    const kind = /answers to your instructions/i.test(label) ? 'ans' : /checks we ran|what we found/i.test(label) ? 'ran' : 'you';
    out[kind] = { label, body };
  }
  return out;
}
// ── ONE LINE PER ANSWER, THE REST FOLDED (owner, on the delivered report, 2026-09-20) ────────────────
//
// Every answer to a client's instruction printed at full length, one after another, and the section read
// as a wall of text. The acceptance brief had already ruled the shape — the question and the answer's
// opening visible, the explanation behind a fold — and it was never built, because no demo run carries
// intake asks and so no demo and no mock ever rendered this section.
//
// NOTHING IS CUT AND NO WORDS ARE WRITTEN. The line is the answer's FIRST SENTENCE, by the same
// splitFirstSentence the hero caption folds on (one rule, one set of abbreviations), and the remainder is
// the rest of the same string. `report.md`, `report-data.json` and the workbook are untouched.
//
// WHERE THE FOLD MAY NOT GO, and this is the whole care in the function. An internal note runs from its
// label to the END OF ITS LINE, and a client surface removes it by cutting to the close of the element
// that contains it (portal-report.mjs). So:
//   · a wholly internal answer is dropped, exactly as renderProse drops one;
//   · an answer whose remainder is ONLY an internal tail folds inside a wrapper the client strip takes
//     whole, so that reader gets the line and no empty disclosure;
//   · an answer that is internal from its first word takes the whole row with it: the strip would
//     otherwise leave the question standing over a dangling arrow, which portal-report.mjs names as the
//     empty-labelled-row defect;
//   · otherwise the remainder folds, tail included, and the client cut trims it inside the fold's own
//     paragraph while the public remainder stays.
// Splitting on the public head alone is what makes that true: the visible line can never carry a label.
function answersHtml(body) {
  const lines = stripInternal(String(body ?? ''), { client: false }).split('\n').map((l) => l.trim());
  const items = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^[-*]\s/.test(line)) items.push(line.replace(/^[-*]\s+/, ''));
    else if (items.length) items[items.length - 1] += ` ${line}`;
    else return renderProse(body);   // not the bulleted register — render it as it always was
  }
  if (!items.length) return renderProse(body);
  const rows = [];
  for (const item of items) {
    if (isInternalLabelled(item)) continue;
    const at = item.indexOf('→');
    const label = at < 0 ? '' : item.slice(0, at + 1).trim();
    const answer = at < 0 ? item : item.slice(at + 1).trim();
    const mark = answer.search(/\[internal\]/i);
    const { first, rest } = splitFirstSentence(mark < 0 ? answer : answer.slice(0, mark));
    const tail = mark < 0 ? '' : answer.slice(mark).trim();
    const head = `${label ? `${inline(label)} ` : ''}${inline(first)}`;
    if (!rest && !tail) { rows.push(`<li>${head}</li>`); continue; }
    if (!first && !rest) { rows.push(`<li class="int-note">${head}${inline(tail)}</li>`); continue; }
    const fold = `<details class="ans-more"><summary>More</summary><p>${inline(rest && tail ? `${rest} ${tail}` : rest || tail)}</p></details>`;
    rows.push(`<li>${head}${rest ? fold : `<div class="int-note">${fold}</div>`}</li>`);
  }
  return rows.length ? `<ul class="answers">${rows.join('')}</ul>` : '';
}

function actionGroup(bucket, kind) {
  if (!bucket || !bucket.body) return '';
  const ic = kind === 'ans' ? '✎' : kind === 'ran' ? '✓' : '→';
  const body = kind === 'ans' ? answersHtml(bucket.body) : renderProse(bucket.body);
  return `<div class="actgrp act-${kind}"><h3><span class="actic">${ic}</span> ${inline(bucket.label)}</h3>${body}</div>`;
}

// doc-52 — the "Conditional — subject to:" banner speaks the SAME plain wording as "Only you can close
// these", never engine clamp-reason jargon ("slice", "crossed into the band", "dominant-element
// omission", …). Returns one client-plain string per only-you item: the [Time-critical] tag and the
// markdown dropped, the ask itself whole.
// ── — THE BOX STOPPED CUTTING, BECAUSE IT HAD NOTHING LEFT TO CUT FOR ──────────────────────────
// This took the first sentence and then capped it at 170 characters, both unmarked. Owner ruling
// 2026-08-10: stop cutting. Two facts, found together:
//
//   * THE SENTENCE CUT FIRED ON PUNCTUATION, NOT ON LENGTH. `/^[\s\S]*?[.:](?=\s|$)/` ended the sentence
//     at the first '.' or ':' before whitespace, so "Obtain consent from Matchday, Inc. before filing in
//     Japan." was delivered as "Obtain consent from Matchday, Inc" — 77 characters, nowhere near any
//     bound. Every "Inc.", "U.S.", "No. 2" and internal colon did this, and no check could see it: the
//     checks measured length. This was the live defect; the 170 cap was the one anybody had noticed.
//   * THE WIDTH IT CUT FOR IS GONE. 170 governed two surfaces. The report hero's "subject to" line was
//     DELETED (see the note below). What remains is the email banner's own <p> — it wraps, has no width
//     and no clamp, so a cut there buys nothing and costs the end of the ask.
//
// The bound did NOT leave the product: findings-model's STATEMENT_CLAUSE_MAX still clips the verdict
// statement's "conditional on:" lede at 170 — WITH an ellipsis, so that reader can tell. That is where
// predelivery-lint measures the ask now, and where the synthesis dictation gets its number.
//
// What is still dropped here is not the author's: the [Time-critical] tag (it leaked onto the client
// verdict line once) and markdown. The driver's own "(re: …)" subject join and "(due by …)" suffix now
// reach this banner, which the sentence cut used to remove by accident — both name the finding and the
// date, and both belong on a line headed "subject to:".
export function actYouConditions(youBucket) {
  if (!youBucket || !youBucket.body) return [];
  // ── — A SUB-HEADING IS NOT A CONDITION, AND IT WAS BEING DELIVERED AS ONE ──────────────────────
  //
  // Found while making every only-you item carry a tag, and it is older than that change: (c) put
  // "**Before you can rely on this result**" / "**We need an answer from you**" / "**Keep an eye on**"
  // into this bucket's body, and this function splits on `\n(?=\s*[-*]\s)` — so the text BEFORE the first
  // bullet became item 0, and every heading after a bullet was swallowed by the bullet above it. The
  // email's "subject to:" box on a three-group run therefore read:
  //
  //     • Before you can rely on this result
  //     • Narrow the class-9 wording. We need an answer from you
  //
  // — a heading emitted as a condition, and a real condition with the next heading welded
  // to its end. Measured on the pre-change module, not reasoned: the two lines above are its literal
  // output for the frozen sample's own only-you body.
  //
  // The fix is a DROP, on structure rather than on wording: a sub-heading is a line that is entirely
  // bold, which is what buildOnlyYouSection emits and what no item line can be (every item opens "- ").
  // It is not a guess about what the words mean.
  const body = String(youBucket.body).split('\n').filter(l => !/^\s*\*\*.+\*\*\s*$/.test(l)).join('\n');
  return body.split(/\n(?=\s*[-*]\s)/).map(s => s.trim()).filter(Boolean).map(item => {
    let t = item.replace(/^[-*]\s+/, '').trim();
    // spec 64 — advisory items (code-assembled from the typed actions register with an explicit tag)
    // are NOT conditions: an open question / commercial call / watch item never reads as "subject to".
    if (/^(\*\*)?\s*\[(open question|your decision|monitor)\]/i.test(t)) return '';
    // Markdown FIRST, tag SECOND: the old order stripped '^[…]' while the string still began '**[', so
    // the [Time-critical] tag leaked onto the client verdict line.
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^\[[^\]]*\]\s*/, '').trim();
    // A dangling colon only: it introduced a clause this bullet no longer has. Terminal '.' stays — the
    // bullet is now the whole sentence the author wrote, and it should end like one.
    return t.replace(/[:\s]+$/, '');
  }).filter(Boolean);
}

// B1 (spec 2026-07-30 §4) — the "Subject to:" bound line is DELETED, not reformatted. It was a third
// copy of the decisive conditions (the verdict statement and the caption already carry them), chopped
// mid-sentence at 170 chars, linking to a section that carries all of them in full. The verdict
// statement (spec 64) already prevents a bare "CONDITIONAL". actYouConditions above STAYS — the email
// composer (publish/index.mjs) still builds its conditions list from it.

// doc-52 routing — concept/genre neighbours that share no word or sound with the mark are NOT conflicts
// (e.g. a same-theme game under a different name). They render in a quiet, collapsed "also considered —
// ruled out" list (owner · mark · why), never as conflict cards and never plotted in the landscape.
// ── ALSO CONSIDERED ────────────────────────────────────────────────────────────────────────────────
// The depth section (the 2026-09-16 report redesign). A deeper search reads more and finds no more, and until now the
// page could not say so: the names read and cleared existed only in the workbook. Three parts, in order —
// the names this run rated and ruled out, the register near-names it cleared, and the web and marketplace
// names it wrote up. Everything is folded and capped: nothing on this page is an uncapped list, and the
// workbook is where the full one lives (owner, 2026-09-16).
//
// TWO GROUPS, AND THAT IS THE MEASUREMENT RATHER THAN A SIMPLIFICATION. The group key comes from the
// register providers' closed screening vocabulary, and across 480 cleared names in three runs the value
// meaning "different goods" appeared zero times, because such records are dropped by the batch screen
// before they ever become a cleared near-name. Grouping on the engine's reasoning paragraph instead would
// produce four groups and assert a reason the record does not support. Owner ruling, 2026-09-16.
const CLEARED_GROUP_LABEL = { 'dead-filing': 'Dead filings', 'different-goods': 'Different goods', 'other': 'Read and cleared' };
const CLEARED_GROUP_ORDER = ['different-goods', 'dead-filing', 'other'];
const NAMES_CAP = 8;

function clearedGroupsHtml(searchDepth, auditFile) {
  const reg = (searchDepth && searchDepth.cleared && searchDepth.cleared.register) || [];
  if (!reg.length) return '';
  const link = (n) => hrefAttr(auditFile, { relative: true }) ? `<div class="cmore"><a class="wb" href="${hrefAttr(auditFile, { relative: true })}">All ${n.toLocaleString('en-GB')} in the audit workbook</a></div>` : '';
  return CLEARED_GROUP_ORDER.map((g) => {
    const items = reg.filter((c) => c.group === g);
    if (!items.length) return '';
    const shown = items.slice(0, NAMES_CAP);
    // "Cl." and a lower-case status, which is how the mock reads and how a lawyer writes it. The
    // register hands the status back in capitals — REGISTERED, CANCELLED — and shouting a neutral
    // fact at a reader is the register's habit, not ours. Only the case changes; the word is the
    // register's own and is not translated.
    const rows = shown.map((c) => `<div class="crow"><span class="cm-mark">${esc(c.mark || c.term || '')}</span><span class="cwho">${
      esc([c.owner, regionName(c.country) || c.country, c.classes ? `Cl. ${c.classes}` : '',
           c.status ? String(c.status).toLowerCase() : ''].filter(Boolean).join(' \u00b7 '))}</span></div>`).join('');
    return `<details class="cgroup"><summary><span class="gname">${esc(CLEARED_GROUP_LABEL[g] || g)}</span><span class="gcount">${
      items.length.toLocaleString('en-GB')} ${items.length === 1 ? 'name' : 'names'}</span></summary><div class="gbody">${rows}${
      items.length > shown.length ? link(items.length) : ''}</div></details>`;
  }).join('');
}

function webNamesHtml(searchDepth) {
  const web = (searchDepth && searchDepth.cleared && searchDepth.cleared.web) || [];
  if (!web.length) return '';
  const shown = web.slice(0, NAMES_CAP);
  const rows = shown.map((w) => `<div class="crow"><span class="cm-mark">${esc(w.title || '')}</span>${
    w.url ? `<a class="curl" href="${escAttr(w.url)}">${esc(String(w.url).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '<span class="cwho"></span>'}</div>`).join('');
  return `<details class="cgroup"><summary><span class="gname">Web and marketplace names</span><span class="gcount">${
    web.length.toLocaleString('en-GB')} ${web.length === 1 ? 'name' : 'names'}</span></summary><div class="gbody">${rows}</div></details>`;
}

// ── WHERE IT STANDS, COURT DECISIONS, WHAT WAS SEARCHED ────────────────────────────────────────────
// The three sections that let a deeper search show its depth (the 2026-09-16 report redesign). All three read the
// search-depth record (the 2026-09-16 report redesign) and the findings; none composes a sentence. Where the record
// is absent — an archived run published before it existed — each returns '' rather than drawing a zero.
const searchStage = (opts) => {
  const note = String(opts && opts.depthNote || '').trim();
  const cut = note.lastIndexOf(' \u2014 ');
  return (cut > 0 ? note.slice(0, cut) : note).trim();
};
const isFullCountry = (opts) => /full country/i.test(searchStage(opts));

// Every country the run READ, with its outcome: the band where a finding sits there, and the clean ones
// named. A list built from the findings alone would name only countries with a conflict, which is the
// gap this closes — the reader cannot otherwise see that the rest came back clean.
function whereItStandsSection(findings, opts) {
  const sd = opts && opts.searchDepth;
  if (!sd || !sd.counts || isFullCountry(opts)) return '';
  const byC = sd.counts.recordsByCountry || {};
  const bandBy = new Map();
  for (const f of findings) {
    const c = regionCode(f);
    if (!c || c === COMMON_LAW || !f.band) continue;
    if (!bandBy.has(c)) bandBy.set(c, f.band);
  }
  // WHICH COUNTRIES THIS SECTION IS ABOUT COMES FROM THE SEARCH PLAN, NOT FROM THE RECORD ARCHIVE.
  //
  // The archive is the authority on what came back and was kept; the plan is the authority on what was
  // asked of the register. Read off the archive, a provider that keeps no records produced no countries,
  // no rows, no chips and no section at all — so a register nobody could archive read exactly like a
  // register nobody searched, on the page a client acts on. Every provider that keeps partial records
  // under-reported here for the same reason.
  //
  // `planTerritories` is three-valued and the third value is why this is not a one-line swap. `null`
  // means there is no plan to read, which is every archived and legacy run: those keep the archive as
  // their only authority and re-render exactly as they always have. A plan that named nothing is a
  // different answer from no plan at all and is allowed to leave this section empty.
  //
  // THE FINDINGS' OWN COUNTRIES ARE UNIONED IN, never filtered out. A finding sitting in a territory the
  // plan does not list — an international registration designating one, most often — had its row from
  // the archive before this and must keep it: the section's first duty is that a country carrying a
  // conflict is on the page.
  //
  // The plan's unreached territories are NOT drawn. This section has two slots in the approved board, a
  // row carrying a band and a "Nothing found" chip, and a territory the provider does not cover is
  // neither: filing it under "Nothing found" would state a clean result for a register nobody read,
  // which is the one fusion this file's court-decisions section exists to keep apart.
  const plan = opts && opts.planTerritories;
  const planned = plan && Array.isArray(plan.searched) ? plan.searched.map(String) : null;
  const codes = (planned
    ? [...new Set([...planned, ...bandBy.keys()])]
    : Object.keys(byC)).filter((c) => c !== 'WO');
  if (!codes.length) return '';
  const alias = { EM: 'EU', GB: 'UK' };
  // ONE ROW PER COUNTRY, DEDUPED AFTER THE ALIAS AND NOT BEFORE. The archive wrote each country once, so
  // this loop never had to ask; a plan carries both spellings — the register's EM and GB alongside the EU
  // and UK a reader knows — and aliasing them afterwards produced two EU rows and two UK rows on the
  // first worldwide run measured through it. The band is looked up across every raw code that folded
  // into the key, so a conflict recorded under EM still reaches the EU row.
  const rawByKey = new Map();
  for (const c of codes) {
    const key = alias[c] || c;
    if (!rawByKey.has(key)) rawByKey.set(key, []);
    rawByKey.get(key).push(c);
  }
  const withF = [], clean = [];
  for (const [key, raws] of rawByKey) {
    const c = raws.find((r) => bandBy.has(r)) ?? raws[0];
    // THE NAME IS LOOKED UP ON THE ALIASED KEY, NOT THE RAW CODE. The register writes the EUIPO and
    // ISO spellings — EM and GB — and `alias` maps those to the codes a reader knows, EU and UK. The
    // name was resolved from the RAW code, which has no entry under either spelling, so it fell back
    // to the code itself and the row read "EU EM" and "UK GB": a country column printing a second
    // code, beside the four rows where the register happened to write the code we already knew.
    // The raw code is still tried, so anything the alias does not cover resolves exactly as before.
    const name = regionName(key) || regionName(c) || key;
    (bandBy.has(c) || bandBy.has(key) ? withF : clean).push({ code: key, name, band: bandBy.get(c) || bandBy.get(key) });
  }
  if (!withF.length && !clean.length) return '';
  const rows = withF.map((c) => `<div class="wrow"><span class="rcode">${esc(c.code)}</span><span class="wname">${esc(c.name)}</span><span class="kc">${esc(c.band)}</span></div>`).join('');
  const cleanHtml = clean.length
    ? `<div class="wclean"><span class="wk">Nothing found</span>${clean.map((c) => `<span class="wchip" title="${escAttr(c.name)}">${esc(clean.length > 12 ? c.code : c.name)}</span>`).join('')}</div>`
    : '';
  return `<div class="sec" id="countries"><span class="num"></span><h2>Where it stands</h2></div>
  <div class="panel where">${rows}${cleanHtml}</div>`;
}

// One short section on a full country search, and four states kept apart: none found is a RESULT and
// could not be checked is a GAP. Collapsing them would let an unreachable source read as a clean negative.
function courtDecisionsSection(opts) {
  const sd = opts && opts.searchDepth;
  if (!sd || !sd.counts || !isFullCountry(opts)) return '';
  const line = courtLineFor(opts, sd.counts.courtDecisions);
  if (!line) return '';
  return `<div class="sec" id="court"><span class="num"></span><h2>Court decisions</h2></div>
  <div class="panel courtp"><p>${esc(line)}</p></div>`;
}

// The court section's sentence for a state, and the one the Court decisions row carries under its state
// word when the research could not be completed — one sentence, said in both places in the same words.
function courtLineFor(opts, state) {
  const sd = opts && opts.searchDepth;
  const byC = (sd && sd.counts && sd.counts.recordsByCountry) || {};
  const first = Object.keys(byC).filter((c) => c !== 'WO')[0];
  const where = first ? (regionName(first) || first) : '';
  // The country comes from the record listing, so a run whose provider archives nothing has no name to
  // put here — and every branch below embedded it mid-sentence. The page then read "Case-law research
  // could not be completed for ." Each clause is now attached to the name rather than assuming one:
  // same words when there is a country, one clause shorter when there is not.
  const forWhere = where ? ` for ${where}` : '';
  let line = '';
  if (state === 'not-checked') line = `Case-law research could not be completed${forWhere}.`;
  else if (state === 'none-found') line = `Court decisions: none found${forWhere}.`;
  else if (state === 'found') line = `Court decisions were searched${forWhere} and are cited against the findings above.`;
  return line;
}

// Counts only, folded closed. A count of records read is engine activity rather than something a reader
// acts on (owner, 2026-09-16), so it lives here and not beside the outcome per country.
// THE OPEN ROWS STAY ON THE PAGE, and that is deliberate rather than a leftover of the old fold. The
// scope fold and the checks-we-ran narrative go, because narrating faults and refusals at a client is
// what the owner ruled out. A slice the run deliberately LEFT OPEN is not narration: it is the
// disclosure the whole can't-close-then-disclose doctrine rests on, and it was measured reaching a
// client short by two rows only hours before this redesign (the 2026-09-16 report redesign). It renders here, in the
// reader's own words, with the counts — never the query text, the refusals or the provider faults.
function whatWasSearchedSection(opts, coverage = [], findings = [], recordsByUri = new Map()) {
  const sd = opts && opts.searchDepth;
  const open = (Array.isArray(coverage) ? coverage : []).filter((c) => COV_STATE[c?.state]?.cls !== 'ok');
  const c = (sd && sd.counts) || {}, rows = [];
  // THE REGISTER ROW, AS THE BOARDS DRAW IT: one line of totals — records read across the countries, plus
  // the international registrations apart from them — and the per-country counts as chips under it, code
  // first and the name on hover. One country is named in the line instead ("141 records read in Japan"),
  // and draws no chips: a single chip would repeat the line.
  const byC = c.recordsByCountry || {};
  const intl = Number(byC.WO) || 0;
  const countries = Object.entries(byC).filter(([k, n]) => k !== 'WO' && Number(n) > 0).sort((a, b) => b[1] - a[1]);
  const read = countries.reduce((t, [, n]) => t + Number(n), 0);
  if (countries.length || intl) {
    const where = countries.length === 1 ? ` in ${regionName(countries[0][0]) || countries[0][0]}`
      : countries.length ? ` across ${countries.length.toLocaleString('en-GB')} countries` : '';
    const plus = intl ? `${countries.length ? ', plus ' : ''}${intl.toLocaleString('en-GB')} international registration${intl === 1 ? '' : 's'}` : '';
    const line = `${countries.length ? `${read.toLocaleString('en-GB')} record${read === 1 ? '' : 's'} read${where}` : ''}${plus}`;
    const chips = countries.length > 1
      ? `<div class="wchips">${countries.map(([k, n]) => `<span class="wchip" title="${escAttr(regionName(k) || k)}">${esc(k)} <b>${Number(n).toLocaleString('en-GB')}</b></span>`).join('')}</div>`
      : '';
    rows.push(['Register', { html: `${esc(line)}${chips}` }]);
  }
  const sw = c.sweep || {};
  if (sw.spellings) rows.push(['Spellings searched', String(sw.spellings)]);
  if (sw.checks) rows.push(['Marketplace and web', `${sw.checks.toLocaleString('en-GB')} checks on ${sw.platforms} platforms`]);
  if (sw.reputation) rows.push(['Reputation and meaning', `${sw.reputation.toLocaleString('en-GB')} checks`]);
  rows.push(['Local-script spellings', c.localScriptSearched ? 'Searched' : 'Not searched']);
  // HOW DEEP THE LOCAL-LANGUAGE INVESTIGATION WENT, which is a different question from the row above it.
  // That one answers whether the spellings were searched; this one answers whether the investigation ran
  // at the depth the matter configured. The engine can run it shallower than the account asked for, and
  // it used to say so in exactly one place — a sentence a model wrote into the Methodology paragraph the
  // redesign replaced with named rows — so a run that went shallow said so on no page at all.
  //
  // EVERY ONE OF THE FOUR WORDS IS ALREADY ON THE PAGE. "Included" and "Not part of this search" are the
  // approved board's own values for this row; "Partially covered" and "Not run this run" are the coverage
  // vocabulary this file already renders, taken from COV_STATE rather than retyped so they cannot drift
  // apart from it. Nothing here composes a sentence.
  //
  // A state this table has no word for draws NO ROW, rather than the nearest word. The four are the whole
  // set the record can produce, so the fallthrough is unreachable today and is there for the fifth state
  // somebody adds: a row is a claim about a client's search, and the nearest word to an unknown state is
  // a claim nobody checked.
  const LL_WORD = {
    ran: 'Included',
    'ran-shallow': COV_STATE['coverage-limited'].word,
    'not-run': COV_STATE['not-searched'].word,
    'not-in-scope': 'Not part of this search',
  };
  //
  // AND THE ROW NEEDS A LANE RECORD BEHIND IT, not just a state. The state folds to `not-in-scope` when
  // there is no lane record at all, which is right for a clearance that never asked for the
  // investigation and WRONG for a run that asked and whose record was never written. Measured on the
  // full country demo: its own coverage carries "Native-language investigation depth / ja — the
  // configured depth for this lane was full and this run delivered a depth this run cannot establish",
  // and the state beside it reads not-in-scope, so this row would have told that reader the
  // investigation was not part of their search. An empty `lanes` map is that absence, and an absence is
  // not a finding — so the row is drawn from a record and not from a default. A run whose record exists
  // draws it on every one of the four states.
  const llLanes = c.localLanguage?.lanes;
  const llRecorded = !!llLanes && typeof llLanes === 'object' && Object.keys(llLanes).length > 0;
  const ll = llRecorded ? LL_WORD[c.localLanguage?.state] : null;
  if (ll) rows.push(['Local-language investigation', ll]);
  // COURT DECISIONS, AS THE FULL COUNTRY BOARD DRAWS THE ROW: its state, and for a search that could not
  // be completed, the same sentence the court section under it prints. A search that does not include
  // court decisions draws no row, as the other boards draw none.
  const cdWord = { 'found': 'Found', 'none-found': 'None found', 'not-checked': 'Not searched' }[c.courtDecisions];
  if (cdWord && isFullCountry(opts)) {
    const why = c.courtDecisions === 'not-checked' ? courtLineFor(opts, 'not-checked') : '';
    rows.push(['Court decisions', { html: `<span class="wstate">${esc(cdWord)}</span>${why ? `<span class="wnote">${esc(why)}</span>` : ''}` }]);
  }
  const openHtml = open.length ? `<div class="openrows"><div class="rk">Left open</div>${coverageGrid(open)}</div>` : '';
  // THE LEGEND FOR WHAT IS ON THE CARDS, kept when the scope fold went. It is not the engine narrating
  // its own searching — it is what a linked registration number opens, why the rest are cited by number,
  // and what a register-index entry means. A reader cannot read a card without it.
  const hasRecordSet = recordsByUri && recordsByUri.size > 0;
  const hasCards = Array.isArray(findings) && findings.length > 0;
  const hasIndexEntry = (Array.isArray(findings) ? findings : []).some((f) => (f?.owner?.registrations ?? []).some((r) => r?.uri
    && (hasRecordSet || !(r.status || r.filed || r.expiry || (r.classes && r.classes.length)))));
  const prov = (hasRecordSet || hasCards)
    ? `<div class="provwrap"><div class="rk">Record provenance</div><p class="provnote">${hasRecordSet ? 'Registration numbers on the cards were read from the register records. ' : ''}${officeLinkNote()}${hasIndexEntry ? 'A registration shown as a register-index entry was seen in the register index; its full record was not pulled. ' : ''}\u201cInferred\u201d beside an owner\u2019s likelihood to object means we judged it from what the owner sells and holds; we had no enforcement history to read.</p></div>`
    : '';
  // THE BOARDS END THE SECTION WITH THE WORKBOOK: every search and its result are in the audit workbook,
  // which is where a reader who wants the record goes.
  const more = hrefAttr(opts?.auditFile, { relative: true })
    ? `<div class="cmore"><a class="wb" href="${hrefAttr(opts.auditFile, { relative: true })}">Every search and result, in the audit workbook</a></div>` : '';
  if (!rows.length && !openHtml && !prov) return '';
  return `<div class="sec" id="searched"><span class="num"></span><h2>What was searched</h2></div>
  <details class="searched"><summary><span class="gname">Counts for this search</span></summary><div class="gbody">${
    rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${typeof v === 'object' ? v.html : esc(v)}</span></div>`).join('')}${openHtml}${prov}${more}</div></details>`;
}

function alsoConsideredSection(ruledOut, recordsByUri = new Map(), opts = {}) {
  const sd = opts.searchDepth || null;
  const ruledCards = ruledOut.map((f) => {
    const who = recordOwner(f, recordsByUri) || f.owner?.name || '';
    // THE ENGINE'S OWN SENTENCE LEADS THE CARD. The face printed a fixed line — "a different name in
    // a related field" — on every ruled-out card, whatever the run had actually concluded. `net` is the
    // finding's own one-line reason, written for a reader, and it was rendered NOWHERE: not on the
    // face, not in the fold, not anywhere on the page. So a client read the same generic sentence
    // about every name we set aside, while the specific reason we set THAT one aside was discarded at
    // render time. The fold keeps the legal and practical positions, which are the longer argument.
    // The fixed line stays as the last resort, for a finding that carries neither.
    const why = f.ruled_out_reason ? esc(f.ruled_out_reason)
      : f.net ? esc(String(f.net))
      : 'a different name in a related field — not a conflict with your mark';
    const legal = f.legal_position ? esc(String(f.legal_position)) : '';
    const practical = f.practical_position ? esc(String(f.practical_position)) : '';
    const fold = (legal || practical)
      ? `<details class="roff"><summary>Why it was ruled out</summary>${legal ? `<p><b>Legal position.</b> ${legal}</p>` : ''}${practical ? `<p><b>Practical position.</b> ${practical}</p>` : ''}</details>` : '';
    return `<div class="card ruled"><div class="top"><div class="rail"></div><div class="body"><div class="cardhead">${
      f.ordinal != null ? `<span class="fnum">${esc(String(f.ordinal))}</span>` : ''}<span class="who mark-first">${esc(f.mark || '')}</span>${
      who ? `<span class="cwho">${esc(who)}</span>` : ''}<span class="tier ruled">Ruled out</span><button class="ask-fi no-print">\u2726 Ask AI about this finding</button></div><div class="oneline">${why}</div>${fold}</div></div></div>`;
  }).join('');
  const groups = clearedGroupsHtml(sd, opts.auditFile);
  const web = webNamesHtml(sd);
  if (!ruledCards && !groups && !web) return '';
  return `<div class="sec" id="also-considered"><span class="num"></span><h2>Also considered</h2></div>
  <div class="panel alsocons">${ruledCards ? `<div class="ruled-cards">${ruledCards}</div>` : ''}${groups || web ? `<div class="cgroups">${groups}${web}</div>` : ''}</div>`;
}

function ruledOutSection(ruledOut, recordsByUri = new Map()) {
  if (!ruledOut.length) return '';
  const rows = ruledOut.map(f => {
    const who = recordOwner(f, recordsByUri) || f.owner?.name || '';
    const why = f.ruled_out_reason ? esc(f.ruled_out_reason) : 'a different name in a related field — not a conflict with your mark';
    // The ordinal renders here too — ruled-out findings keep their persisted number, so a reader who
    // sees #1–#8, #10, #11 in the landscape finds #9 accounted for instead of unexplainably missing.
    return `<li style="margin:4px 0"><b>${f.ordinal != null ? `#${f.ordinal} ` : ''}${esc(f.mark)}</b>${who ? ` — ${esc(who)}` : ''} · <span style="color:var(--muted,#6b5d50)">${why}</span></li>`;
  }).join('');
  return `<details class="rgroup ruledout"><summary><span class="gname">Also considered — ruled out</span><span class="gcount">${ruledOut.length} name${ruledOut.length === 1 ? '' : 's'}</span></summary><div class="gbody"><p class="note" style="margin:2px 0 8px">Names that surfaced in the search but share no word or sound with your mark — listed for completeness; not conflicts.</p><ul style="margin:0;padding-left:20px;font-size:13px">${rows}</ul></div></details>`;
}

// doc-52 §4 — ONE collapsed "Scope & what we didn't search" section, LAST, replacing BOTH the top
// "Checks we ran" panel and the (previously dead) Methodology block: the search results we can state,
// the coverage grid, the plain scope note, and famous-neighbour diligence. Nothing here leads the report.
//
// — WHAT RAN IS NOT A CAVEAT, SO IT DOES NOT WAIT BEHIND A CLICK. The "Checks we ran — what we
// found" bucket is the run's reasoned negatives: the grounds that were checked and came back empty, and
// WHY that is a result rather than a silence. It was the first thing inside a closed <details> whose
// summary announces the opposite ("what we didn't search"), so the page's best evidence was filed under
// its own disclaimer. It now renders OPEN, in place, and the fold keeps what the fold is for — the long
// not-run / partially-covered / open ledger, the methodology note and the internal provenance rows.
//
// PLACEMENT ONLY (: subtraction, placement and labels). The section is not renamed, not renumbered
// and not moved: the bucket keeps its authored heading, its own ✓ marker and its position at the head of
// §4, and every part that was folded is still folded, in the same order, under the same summary.
// The raw coverage_judgment.reason (engine wording) stays INTERNAL-only — the client sees the plain
// only-you conditions instead. Returns '' when there is nothing to show.
// doc-52 keeps the CHANGE-1 promise: process telemetry (search/fetch/batch counts, saturation
// baseline, cell-matrix, has_more) is exhaust, not legal product — it never renders. A genuine
// plain-English scope note (jurisdictions/layers searched) DOES render. plainScopeNote drops the
// telemetry clauses and keeps the descriptive prose; an all-telemetry note reduces to ''.
// — IT IS stripTelemetry, not a second copy of it. This function used to split the WHOLE block on
// /(?<=[.;])\s+/ and rejoin the survivors with a space. `\s` matches a newline, so the split crossed
// LINES and the note came back as one run of sentences: a methodology block that authored bullets lost
// every one of them, the first bullet's dash disappeared into the paragraph and the rest printed
// literally as text. Dropping a telemetry lead-in then made the damage visible ( D6's shape — a
// client fragment beginning with a bare dash), but the welding never needed telemetry to happen.
// parse.mjs's stripTelemetry is the sibling rule and splits per LINE first, so it never had the defect.
// Calling it makes the two rules agree BY CONSTRUCTION rather than by inspection, which is what the
// issue asks for: a divergence that is merely absent grows back. renderProse then sees the lines the
// author wrote, so `- ` bullets are <li> again and a telemetry-only note still reduces to ''.
// The 2026-09-16 report redesign — scopeSection and plainScopeNote are DELETED, not merely unreferenced.
//
// They rendered the scope fold: the checks-we-ran narrative, the Methodology note, the full coverage
// grid and the provenance paragraph. The owner ruled the narrative off the client's page on
// 2026-09-16, and what a reader still needs from that fold moved with it by hand — the rows a run
// LEFT OPEN and the record provenance legend both render with the counts now, and each has its own arm.
//
// Left here as dead code they would have read as a surface the client still meets. The rule they
// carried about telemetry prose — a lead-in is a paragraph and each bullet an item, welded into one
// before it was fixed — lives on in stripTelemetry in parse.mjs, which is where the rule belongs and
// where its own arms still drive it.

// Quadrant: x = goods proximity (0 distant → 1 identical), y = mark similarity (0 distinct → 1 identical).
// SVG plot box is x∈[70,530], y∈[372,30] (y inverted: identical at top). Marker colour by classification.
// dedupeScatter is the redesign's ONLY new geometry: it keeps each finding's true x/y mapping, then nudges
// overlapping dots apart by deterministic golden-angle collision avoidance so no two dots stack (positions
// still read as the run's similarity/goods judgement — it only separates coincident points).
// DETERMINISM: placement order is on-field-by-ordinal then secondary-by-ordinal, and the spiral resets
// angle=0 per point — no Date/random/array-identity input. Do NOT seed this from anything time/order-varying.
function dedupeScatter(findings) {
  const X = x => 70 + Math.max(0, Math.min(1, x ?? 0)) * 460;
  const Y = y => 372 - Math.max(0, Math.min(1, y ?? 0)) * 342;
  const order = [...findings].sort((a, b) => (isOnField(b) - isOnField(a)) || ((a.ordinal || 0) - (b.ordinal || 0)));
  const placed = [];
  const GOLDEN = 2.39996;
  for (const f of order) {
    const on = isOnField(f);
    const r = on ? 13 : 9;
    // _wasPending survives the never-invent status nulling (registry-fidelity snapshots it before
    // dropping cited-but-unfetched fields) — a Pending application must not plot as a solid registered dot.
    const reg0 = f.owner?.registrations?.[0];
    const pending = reg0?._wasPending === true || /pending|application|app\.?|non-final/i.test(reg0?.status || '');
    const bx = X(f.quadrant?.x), by = Y(f.quadrant?.y);
    const inBox = (x, y) => x >= 70 + r && x <= 530 - r && y >= 30 + r && y <= 372 - r;
    const ok = (x, y) => inBox(x, y) && placed.every(p => Math.hypot(x - p.cx, y - p.cy) >= p.r + r + 3);
    let x = bx, y = by, step = 0, ang = 0, last = { x: Math.max(70 + r, Math.min(530 - r, bx)), y: Math.max(30 + r, Math.min(372 - r, by)) };
    while (!ok(x, y) && step < 3000) {
      step++; ang += GOLDEN; const rad = 4 + step * 1.1;
      x = bx + rad * Math.cos(ang); y = by + rad * Math.sin(ang);
      if (inBox(x, y)) last = { x, y };
    }
    if (!ok(x, y)) { x = last.x; y = last.y; }   // never loop forever; settle on the last in-box candidate
    placed.push({ f, cx: x, cy: y, on, r, pending });
  }
  return placed;
}

function quadrant(findings) {
  const markers = dedupeScatter(findings).map(({ f, cx, cy, on, r, pending }) => {
    // Band hexes, hardcoded on purpose: the quadrant panel stays a FIXED LIGHT surface in dark mode
    // (brand.mjs REPORT_DARK_RULES), so it cannot read var(--med)/var(--clear) — those flip. They are
    // the LIGHT ramp's --med / --clear and must be recolored in lockstep with brand.mjs:90.
    const fill = on ? '#C8871B' : '#5F8A64';
    const X = cx.toFixed(1), Y = cy.toFixed(1), fs = on ? 12.5 : 8;
    const inner = pending
      ? `<circle cx="${X}" cy="${Y}" r="${r}" fill="#FFFDF9" stroke="${fill}" stroke-width="2.5"/><text x="${X}" y="${Y}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="900" fill="${fill}">${f.ordinal}</text>`
      : `<circle cx="${X}" cy="${Y}" r="${r}" fill="${fill}" stroke="#250902" stroke-opacity=".22" stroke-width="1"/><text x="${X}" y="${Y}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="900" fill="#fff">${f.ordinal}</text>`;
    return `<a href="#c${f.ordinal}"><title>#${f.ordinal}</title>${inner}</a>`;
  }).join('');
  return `<div class="panel land">
      <svg viewBox="0 0 560 430" xmlns="http://www.w3.org/2000/svg" font-family="Plus Jakarta Sans, sans-serif">
        <defs><linearGradient id="rz" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#860F09" stop-opacity="0"/><stop offset="1" stop-color="#860F09" stop-opacity=".09"/></linearGradient></defs>
        <rect x="70" y="30" width="460" height="342" fill="url(#rz)"/>
        <g stroke="#E4DACA" stroke-width="1"><line x1="70" y1="30" x2="70" y2="372"/><line x1="300" y1="30" x2="300" y2="372" stroke-dasharray="3 4"/><line x1="530" y1="30" x2="530" y2="372"/><line x1="70" y1="372" x2="530" y2="372"/><line x1="70" y1="201" x2="530" y2="201" stroke-dasharray="3 4"/><line x1="70" y1="30" x2="530" y2="30"/></g>
        <text x="300" y="406" text-anchor="middle" font-size="12" font-weight="700" fill="#6B5D52">Goods / services proximity →</text>
        <text x="40" y="201" font-size="12" font-weight="700" fill="#6B5D52" transform="rotate(-90 40 201)" text-anchor="middle">Mark similarity →</text>
        <text x="520" y="46" text-anchor="end" font-size="9.5" font-weight="700" letter-spacing=".08em" fill="#B89A6E">CONFUSION ZONE</text>
        ${markers}
      </svg>
      <div class="legend">
        <span><i style="background:#C8871B"></i>On-field · drives the read</span>
        <span><i style="background:#5F8A64"></i>${FRAMEWORK ? 'Secondary · watch' : 'Secondary · manageable'}</span>
        <span><i style="background:#FFFDF9;border:2px solid #5F8A64;width:7px;height:7px"></i>Pending</span>
      </div>
    </div>`;
}

// A single rights-holder row. doc-54 — the MARK leads the row (it is the thing that conflicts), in the
// same styled box the conflict cards use (.cm-mark); the holder + class + source demote to the sub-line
// (owner-unknown, who === mark, collapses to the mark alone). Classes union ACROSS registrations —
// registrations[0] alone under-reported multi-registration findings vs the card chip. The source token
// keeps the house sentence case ('Register' / 'Common-law') and never wraps mid-word.
function keyRow(f, recordsByUri) {
  const on = isOnField(f);
  const kn = on ? '#C8871B' : '#5F8A64';   // matches this row's quadrant marker — light ramp, see quadrant()
  const kc = on ? 'med' : 'low';
  const cls = [...new Set((f.owner?.registrations || []).flatMap((r) => Array.isArray(r.classes) ? r.classes : []))]
    .map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b).join('/');
  const src = sourceChip(f.source?.source_type || '').label;
  const who = recordOwner(f, recordsByUri) || f.owner?.name || f.mark;   // doc-31 step 4: bound from the record
  const chip = (FRAMEWORK && f.composite == null) ? (f.band != null ? esc(f.band) : '—') : `C${f.composite}`;
  const nrm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const subParts = [];
  if (who && nrm(who) !== nrm(f.mark)) subParts.push(esc(who));
  if (cls) subParts.push(`Cl.${esc(cls)}`);
  if (src) subParts.push(`<span style="white-space:nowrap">${esc(src)}</span>`);
  return `<a class="keyrow" href="#c${f.ordinal}"><span class="kn" style="background:${kn}">${f.ordinal}</span><span class="kw"><span class="cm-mark">${esc(f.mark)}</span><em>${subParts.join(' · ')}</em></span><span class="kc ${kc}">${chip}</span><span class="arr">→</span></a>`;
}

// Rights-holder panel → cross-region groups (§2.3). Findings grouped by jurisdiction (region order = lowest
// finding ordinal); region header chip is the fixed two-state C3/C2; a region holding an on-field finding is
// open by default, others collapsed. Inside, the existing keyrow markup verbatim.
function keyPanel(findings, recordsByUri = new Map()) {
  // wp50/wi8 — common-law is NOT a jurisdiction: nesting the C/L group inside "Grouped by jurisdiction"
  // made marketplace/web findings read as a regional register grouping (VENZY). The C/L group renders
  // AFTER the region list, clearly labelled and cross-linked to the Common-law & marketplace section;
  // runs without common-law findings render byte-identically.
  const all = groupByRegion(findings);
  const regions = all.filter(g => g.code !== COMMON_LAW);
  const clGroup = all.find(g => g.code === COMMON_LAW);
  const detail = (g, label, sub, collapsed = false) => {
    const kc = g.hasOnField ? 'med' : 'low';
    const rows = g.findings.map(f => keyRow(f, recordsByUri)).join('');
    return `<details class="rrow"${!collapsed && g.hasOnField ? ' open' : ''}><summary><span class="rcode">${esc(g.code)}</span><span class="rname">${esc(label ?? g.name)}</span><span class="kc ${kc}">${g.chip}</span><span class="rsub">${sub ?? esc(cap(registrationSystem(g.code) ?? ''))}</span><span class="rcount">${g.count}</span></summary><div class="rbody">${rows}</div></details>`;
  };
  // doc-55 A2 (whitespace): open ONLY the single highest-risk region — the first on-field group in
  // exposure order (groups are sorted by lowest ordinal) — and collapse every other region to its
  // one-line header. The panel is the INDEX of holders; the on-field cards themselves live in the
  // On-field section, so collapsing loses no finding, only the stacked height that made the panel
  // tower over the conflict-landscape column (Asterion: 8 regions, 6 open). Others expand on click.
  const topRegion = regions.find(g => g.hasOnField);
  const groups = regions.map(g => detail(g, undefined, undefined, g !== topRegion)).join('');
  // The C/L group renders COLLAPSED by default even when it holds on-field findings: the pointer above it
  // + the dedicated Common-law & marketplace section carry the reading surface; a fully-open C/L list was
  // the main driver of the key-panel height (doc-54 whitespace). Geographic regions: only the top
  // (highest-risk) region opens; the rest collapse (doc-55).
  const clBlock = clGroup
    ? `<p class="keyhint" style="margin-top:10px">Common-law / marketplace — unregistered use, not register rights (<a href="#common-law">see the Common-law &amp; marketplace section</a>).</p>${detail(clGroup, 'Common-law / marketplace', '<span style="white-space:nowrap">Unregistered use</span>', true)}`
    : '';
  return `<div class="panel keypanel">
      <div class="label">Rights-holders</div>
      <p class="keyhint">Grouped by jurisdiction — open a region for its holders.</p>
      ${groups}${clBlock}
    </div>`;
}

// A5 — common-law/marketplace findings get their OWN report section, OUT of the register
// region grouping (a marketplace presence is not a jurisdiction; filing it under a pseudo-region
// buried the unregistered-use picture). Secondary CL findings render here as the existing compact
// cards (ungrouped — there is no region to group by); ON-FIELD CL findings stay in the on-field
// section (they drive the read) and are cross-linked from here so the common-law picture is
// complete in one place. The rights-holder landscape panel keeps its "Common-law" group — that
// panel is the index of everything, this section is the reading surface.
function commonLawSection(clSecondary, clOnField, cardFor, recordsByUri = new Map(), allFindings = []) {
  // THE LAYER'S CONTRIBUTION IS ON THE CARD THAT CARRIES IT, NOT ALSO IN A LIST ABOVE THEM. A
  // block headed "what the marketplace layer added to register findings" restated, per finding, the
  // use token, the host and the evidence pair that the finding's OWN card already states in its use
  // line — measured on the delivered reports: one such line per finding with use evidence, on the
  // card, in every case the block listed. It attributed a layer to itself in the engine's own terms
  // and made a reader read the same fact twice, the second time out of the context that explains it.
  // Nothing is lost with it: the cards it linked to sit directly below.
  if (!clSecondary.length && !clOnField.length) return '';
  const links = clOnField.length
    ? `<p class="clx" style="margin:4px 0 10px;font-size:13.5px">On-field common-law conflicts (full cards above): ${clOnField.map(f => `<a href="#c${f.ordinal}">#${f.ordinal} ${esc(f.mark)}</a>`).join(' · ')}</p>`
    : '';
  const cards = clSecondary.map(f => compactCard(f, cardFor(f), recordsByUri)).join('\n  ');
  return links + cards;
}

// Secondary findings → collapsible region groups (§2.4). Same region order as the key panel; each region a
// collapsed <details class="rgroup"> whose header is region code + name + count, holding the EXISTING compact
// cards verbatim (card content byte-for-byte; only the container changes).
function secondaryRegions(findings, cardFor, recordsByUri = new Map()) {
  return groupByRegion(findings).map(g => {
    const kc = g.hasOnField ? 'med' : 'low';
    const cards = g.findings.map(f => compactCard(f, cardFor(f), recordsByUri)).join('\n      ');
    return `<details class="rgroup"><summary><span class="rcode">${esc(g.code)}</span><span class="gname">${esc(g.name)}</span><span class="kc ${kc}">${g.chip}</span><span class="gsub">${esc(cap(registrationSystem(g.code) ?? ''))}</span><span class="gcount">${g.count} mark${g.count === 1 ? '' : 's'}</span></summary><div class="gbody">${cards}</div></details>`;
  }).join('\n  ');
}

// ── requirement 3 — the reasoned negatives, grouped by the ground they share ─────────────────────
//
// secondaryRegions groups by JURISDICTION, which is the one thing about a negative a reader does not need
// repeated: eight cards under four region headings re-derive the same clearing argument eight times. Here
// the shared ground is stated ONCE, in the group heading, and each member carries only what is its own —
// its jurisdictions, its classes, and its own sentence. The grouping key is TYPED (findings-model
// reasonedNegativeGroups reads disposition / off_field_ground / manageable.category); nothing here infers
// a ground from prose, and the member's sentence is the model's `net`, never composed by the renderer.
//
// The full card is not lost — each member is a <details> whose body is the same fullDetail block the
// compact card carries, so the drill-through is one click from the line.
const GROUP_HEADING = {
  distinguished: 'Argued apart on the mark',
  'coexistence-partner': 'Coexistence on the record',
  'off-field:different-field': 'A different commercial field',
  'off-field:no-material-risk': 'Clearly won',
  'off-field:unstated': 'Cleared — ground not stated on the record',
};
function negativeLine(f, recordsByUri) {
  const who = recordOwner(f, recordsByUri) || f.owner?.name || '';
  const regs = f.owner?.registrations || [];
  const juris = [...new Set(regs.map(r => r.jurisdiction ? normRegion(r.jurisdiction) : null).filter(Boolean))].join(', ')
    || (regionCode(f) === COMMON_LAW ? 'common-law' : normRegion(regionCode(f)));
  const classes = [...new Set(regs.flatMap(r => Array.isArray(r.classes) ? r.classes : []))]
    .map(Number).filter(x => !Number.isNaN(x)).sort((a, b) => a - b).join('/');
  // Escaped per PART and joined with the entity, exactly as markClassChip does: a literal U+00A0 in
  // source is invisible to a reader and to a grep, and esc() would turn a raw `&nbsp;` into `&amp;nbsp;`.
  const facts = [esc(juris), classes ? `Cl.&nbsp;${esc(classes)}` : ''].filter(Boolean).join(' · ');
  // The reason is the finding's OWN typed sentence, rendered whole like every other surface ( —
  // there is no character budget any more). `net` stays OPTIONAL in the parser (an archived run has
  // none), so the fallback is the finding's legal_position — which v6 DOES require on every negative.
  // Without it a row could render as a mark with no stated reason, inside the section built to stop
  // exactly that. The fallback still needs clause()'s trim-to-empty: a whitespace-only `net` must fall
  // through, not render a blank summary line.
  const reason = clause(f.net) || clause(f.legal_position);
  return `<span class="rn-mark">${esc(f.mark)}</span>${who ? `<span class="rn-who">${esc(who)}</span>` : ''}`
    + `${facts ? `<span class="rn-facts">${facts}</span>` : ''}`
    + `${reason ? `<span class="rn-why">${inline(sentenceCaseLead(reason))}</span>` : ''}`;
}
function reasonedNegatives(groups, cardFor, recordsByUri) {
  return groups.map(g => {
    const members = g.findings.map(f =>
      `<details class="rgroup rn"><summary>${negativeLine(f, recordsByUri)}</summary><div class="gbody">${fullDetail(f, cardFor(f), recordsByUri)}</div></details>`
    ).join('\n      ');
    return `<p class="fold-lead"><b>${esc(GROUP_HEADING[g.key] ?? g.key)}</b> (${esc(g.ground)}) — ${g.findings.length} mark${g.findings.length === 1 ? '' : 's'}.</p>
      ${members}`;
  }).join('\n  ');
}

function meters(f) {
  const order = ['mark_similarity', 'goods_proximity', 'use', 'enforcer'];
  return `<div class="meters">${order.map(name => {
    const m = meter(name, f.meters?.[name]);
    return `<div class="meter"><div class="ml">${m.label}</div><div class="pips ${m.cls}"><i></i><i></i><i></i></div><div class="mv">${esc(m.cap)}</div>${m.ev ? `<div class="mev">Evidence: ${esc(m.ev)}</div>` : ''}</div>`;
  }).join('')}</div>`;
}

// doc-31 step 4 — the AUTHORITATIVE owner display, bound from the fetched record. The model's prose may name
// the owner, but the card's owner field never carries a model-typed/​invented name. Returns the record owner
// when the finding's registrations resolve to a fetched record that carries one; else null → the caller falls
// back to the model's finding.owner.name (back-compat for runs with no record set / no owner on the record).
function recordOwner(f, recordsByUri) {
  if (!recordsByUri || recordsByUri.size === 0) return null;
  for (const r of (f.owner?.registrations || [])) {
    const rec = recordsByUri.get(String(r.uri || '').toLowerCase());
    if (!rec) continue;
    // — the SHARED decision, not REC.owner directly. This function must not prefer the record
    // outright: the record's Latin field is a ROMANISATION when the record also carries a native-script
    // form, and this is the surface a lawyer actually reads.
    const o = ownerDisplayName({ raw: REC.owner(rec), native: REC.ownerNative(rec), resolved: f.owner?.name });
    if (o) return o;
  }
  return null;
}

// Structured "Full detail" from the contract (registrations + enforcer basis + provenance), then any matched
// report.md full-detail prose, then the internal note (stripped on client), then the audit-ref/provenance line.
// doc-55 A3 backstop — stripEngineInternals now lives in parse.mjs beside stripInternal (ONE definition,
// shared with the MCP client surface); the rationale and the token-set safety argument live there.

function fullDetail(f, card, recordsByUri = new Map()) {
  // Instance #6 + doc-31 no-invent — precedence per registration, keyed on uri.toLowerCase():
  //   (1) a fetched record body in recordsByUri  → identifiers from the SHARED REC extractors
  //       (transposition-proof: the page shows the FETCHED facts, never the model's retyped prose);
  //   (2) cited uri, NO record body, but the run HAS a record set → "(unverified — record not fetched)":
  //       doc-31 NEVER-INVENT — if this delivery fetched records and THIS one isn't among them, the model's
  //       findings.json fields are unconfirmed and must NOT render as if confirmed (the exact "shown as if
  //       confirmed" defect). registry-record-coverage already flags it; the card must not contradict the flag;
  //   (3) cited uri, NO record body, run has NO record set → back-compat field render (archived/replay runs
  //       with no _records/ — "unverified" there would regress every pre-fidelity run and the A3 test);
  //   (4) no uri at all → the registration label.
  // Every branch leads with esc(uri) so the registration is always identifiable.
  const hasRecordSet = !!(recordsByUri && recordsByUri.size > 0);
  // Make each registration URI in Full detail a clickable link to its full provider record. The registration
  // uris are PATHS (/mark/<jur>/<id>); the finding's own resolved_link (the provenance link below) carries the
  // provider ORIGIN — the same provider as its registrations — so we reuse it (no hardcoded domain; provider-
  // agnostic). A uri that is already a full URL links directly; a bare path with no origin falls back to plain
  // text (today's behaviour).
  // — THE ALLOW-LIST IS THE ONLY SOURCE OF AN ORIGIN. This used to read
  // `RECORD_ORIGIN || provOrigin`, where provOrigin was scraped from `f.source.resolved_link`. The
  // refusal one file over was computed and then bypassed: `record-origins.mjs` returns [] for a provider
  // that publishes no per-record page, `publish/index.mjs` turns that into `recordOrigin = null`, and the
  // `||` handed the job to whatever host happened to sit in that finding's source link.
  //
  // THE PATH THAT PRODUCED IT, read rather than inferred. `normalizeRecordLinks` repairs foreign links,
  // but only on findings whose `source_type` starts with `register` — correctly, since a common-law
  // link is not a record claim. `SOURCE_TYPES` also carries `common-law-marketplace`, `common-law-web`
  // and `case-law`. So a finding sourced from a web page kept its link, the scrape took THAT origin, and
  // every `/mark/<cc>/<id>` on the card was prefixed with it. The repair was scoped to register sources;
  // the scrape was scoped to nothing.
  //
  // WHAT LINKS NOW. A record URI is a PATH (`/mark/<cc>/<id>`) — this system's internal identity, not a
  // URL. It becomes a link only when the run's allow-list names exactly ONE origin, because with two
  // (a composite: EUIPO + USPTO) choosing one is a guess, and a guessed citation on a legal deliverable
  // is the thing this issue exists to stop. An already-absolute URI links only if its own origin is on
  // the list. Everything else renders as text — identifiable, and not pretending to be checkable.
  const singleOrigin = Array.isArray(RECORD_ORIGINS) && RECORD_ORIGINS.length === 1 ? RECORD_ORIGINS[0] : null;
  const allowed = (href) => {
    if (!Array.isArray(RECORD_ORIGINS)) return true;   // no receipts ⇒ no allow-list to judge by (see below)
    try { return RECORD_ORIGINS.includes(new URL(href).origin); } catch { return false; }
  };
  const regHref = (u) => {
    if (!u) return null;
    if (/^https?:\/\//.test(u)) return allowed(u) ? u : null;
    if (!u.startsWith('/')) return null;
    // A bare path needs an origin, and only an allow-listed single origin will do. RECORD_ORIGIN is kept
    // as the input because publish/index.mjs already derives it from the same provider row; the list is
    // what decides whether using it is legitimate.
    const origin = singleOrigin || (Array.isArray(RECORD_ORIGINS) ? null : RECORD_ORIGIN);
    return origin ? origin + u : null;
  };
  // owner ruling — WHAT THE READER GETS WHERE A LINK CANNOT GO. A bare internal identifier with
  // nowhere to go is honest but useless; a constructed URL is a fabricated citation. So the card says
  // which it is, in the words the reader can act on:
  //
  //   workbook    — the record IS delivered, in the Excel. Named as the portal's own control labels it
  //                 ("Download full audit (Excel)"), because that is the string the reader hunts for on
  //                 the page. NOT an inline .xlsx link: portal-report.mjs strips those, correctly — the
  //                 portal REPLACES them with its own download control (portal-ui Result.tsx).
  //   placeholder — a register UI exists and we do not know its per-record address. It CARRIES NO NOTE:
  //                 the number stands on its own, because "(placeholder)" beside twenty-four
  //                 registrations reads to a client as a broken report rather than as a missing link.
  // THE PLACEHOLDER NOTE IS GONE. It printed " — no record link available yet (placeholder)" beside
  // every registration a register UI has no per-record address for — twenty-four times on the measured
  // page — and a client reads "placeholder" as a broken report. The number is the fact; when there is a
  // link the number IS the link, and when there is not, the number still stands on its own. The
  // workbook note stays: it tells a reader where the full record actually is.
  const NO_LINK_NOTE = {
    workbook: ' — full record in the audit workbook (“Download full audit (Excel)”)',
  };
  const regUri = (u, fb) => {
    const h = regHref(u);
    const label = esc(u || fb || 'registration');
    if (hrefAttr(h)) return `<a href="${hrefAttr(h)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    const note = RECORD_CITATION ? NO_LINK_NOTE[RECORD_CITATION] : null;
    return note ? `${label}<span class="reg-nolink">${note}</span>` : label;
  };
  // B3 (spec 2026-07-30 §4) — the wp50/wi7 per-card coherence line ("Verified from the fetched …;
  // the registrations below marked as index entries were not pulled this run") is GONE: record
  // provenance is stated ONCE, in Scope (scopeSection), not stamped per card. The never-invent
  // discipline is untouched — an unfetched leg still renders no field as if confirmed.
  // 404-card caveat (2026-07-22) — a cited record the V4-2 closure fetch DEFINITIVELY could not
  // retrieve (joinEvidenceStatus stamped `_recordFetchFailure` from the persisted failure list). ONE
  // deterministic code-owned line on the card, client render included: the reader must never take this
  // card's registry values as record-verified. Absent stamp (no join ran / archived runs) ⇒ nothing.
  const fetchFailLine = f._recordFetchFailure
    ? `<li class="openitem"><b>Official register record could not be retrieved (${esc(f._recordFetchFailure.cause || 'fetch failed')})</b> — registry details in this card are unverified.</li>`
    : '';
  const regs = (f.owner?.registrations || []).map(r => {
    const uri = String(r.uri || '').toLowerCase();
    const rec = uri ? recordsByUri.get(uri) : null;
    if (rec) {
      const cls = (r.classes && r.classes.length ? r.classes.join('/') : (Array.isArray(rec.classList) ? rec.classList.join('/') : ''));
      const status = REC.statusStr(rec);
      const filingYear = REC.filingYear(rec), regYear = REC.regYear(rec);
      const appNum = REC.serial(rec), regNum = REC.regNumber(rec);
      const jur = r.jurisdiction || rec.jurisdiction || '';
      const ids = [appNum && `app. ${appNum}`, regNum && `reg. ${regNum}`].filter(Boolean).join(', ');
      const dates = [filingYear && `filed ${filingYear}`, regYear && `registered ${regYear}`].filter(Boolean).join(', ');
      const tail = [ids, dates].filter(Boolean).join('; ');
      // A5 (senior lawyer) — an international (WIPO/Madrid) registration's rights reach ONLY its
      // designated countries. A WO line NAMES them from the fetched record, or states honestly that
      // the record did not carry them — never lets "international" imply worldwide.
      const isWO = normRegion(jur) === 'WO' || /\/mark\/wo\//i.test(uri);
      const desig = isWO ? REC.designations(rec) : null;
      const desigHtml = !isWO ? ''
        : (desig ? ` · designating: ${esc(desig.join(', '))}`
                 : ` · <i>designated countries not on the fetched record — rights reach only its designations</i>`);
      // C1 — the jurisdiction's registration system, labeled from DATA (unknown = unlabeled)
      const sys = registrationSystem(jur);
      // C2 — an application inside the 6-month Paris-priority window can be re-filed
      // elsewhere claiming THIS date; flag it so a fresh local filing is never read as local-only.
      const prio = AS_OF && inPriorityWindow(rec, AS_OF)
        ? ` · <b>recent filing — Paris-priority window (potential global backdating)</b>` : '';
      // WP-receipts W2 — the PROVABLE verified label: when the record artifact carries its fetch
      // receipt (_receipt, embedded at assembly), say what was pulled and when — replacing the
      // "file exists on disk" inference. Absent receipt (archived runs) renders nothing.
      const receiptTail = rec._receipt?.fetched_at
        ? ` · <i class="receipt">verified — ${esc(PROVIDER_LABEL || 'register')} record fetched ${esc(String(rec._receipt.fetched_at).slice(0, 10))}</i>` : '';
      // AS REGISTERED, AND THE DATES — the full country's two extra blocks (the 2026-09-16 report redesign). Both come
      // off the fetched record and neither is composed: the goods are the register's own wording in the
      // language it granted them in, and the dates are its own, to the day. The one-line summary above
      // carries YEARS, which cannot say whether a registration lapses this month.
      const goods = FULL_COUNTRY ? REC.goods(rec) : null;
      const recDates = FULL_COUNTRY ? REC.dates(rec) : null;
      const goodsHtml = !goods ? '' : `<div class="row"><span class="k">As registered</span><span class="v">${
        goods.map((g) => `${g.classes.length ? `${esc(g.classes.length === 1 ? 'Class' : 'Classes')} ${esc(g.classes.join(', '))}: ` : ''}${esc(g.description)}`).join('<br>')}</span></div>`;
      const datesHtml = !recDates ? '' : `<div class="row"><span class="k">Dates</span><span class="v">${
        esc(recDates.map(([k, v]) => `${k} ${v}`).join(' \u00b7 '))}</span></div>`;
      return `<li><b>${officeRecordCell(r.uri, regUri, RECORD_CITATION ? NO_LINK_NOTE[RECORD_CITATION] : null)}</b>${cls ? ` · Cl.${esc(cls)}` : ''}${status ? ` · ${esc(status)}` : ''}${tail ? ` (${esc(tail)})` : ''}${jur ? ` · ${esc(jur)}${sys ? ` <i class="jsys">(${sys})</i>` : ''}` : ''}${desigHtml}${prio}${receiptTail}${goodsHtml || datesHtml ? `<div class="record">${goodsHtml}${datesHtml}</div>` : ''}</li>`;
    }
    // (2)+(3): a cited record with NO fetched body. NEVER-INVENT when the run has a record set (this URI was
    // not fetched ⇒ the model's fields are unconfirmed); also when there are no findings.json facts to show.
    if (uri && (hasRecordSet || !(r.status || r.filed || r.expiry || (r.classes && r.classes.length)))) {
      // wp50/wi7 + B3: this is a register-INDEX entry (the search saw it and enumerated it); no field
      // renders as confirmed. What "register-index entry" means is stated once, in Scope — not per row.
      return `<li><b>${regUri(r.uri)}</b> <i>(register-index entry)</i></li>`;
    }
    // (3) back-compat field render — byte-identical to the prior behaviour for the no-record-set case
    const dates = [r.filed && `filed ${r.filed}`, r.expiry && `expiry ${r.expiry}`].filter(Boolean).join(', ');
    const cls = (r.classes || []).length ? ` · Cl.${r.classes.join('/')}` : '';
    return `<li><b>${regUri(r.uri, 'registration')}</b>${cls}${r.status ? ` · ${esc(r.status)}` : ''}${dates ? ` (${esc(dates)})` : ''}${r.jurisdiction ? ` · ${esc(r.jurisdiction)}` : ''}</li>`;
  }).join('');
  // CHANGE 5b — the enforcer basis line. verified-from-record stays stated as FACT (an enforcement record is
  // on file). inferred-from-signal is rendered as an EXPLICIT inference — reputation/profile only, NO
  // enforcement record on file — so a guessed appetite is never presented as an asserted fact.
  const enf = f.meters?.enforcer;
  // doc-35 T1 backstop (code-enforced): a "verified-from-record" enforcer whose justification cites a named
  // PROCEEDING/AUTHORITY (a TTAB opposition/cancellation number, "sustained", a docket/case cite) is demoted to
  // an inference HERE — an enforcement authority needs its OWN fetched record (TTABVUE / the docket is not
  // wired), so a vendor-record MENTION of an opposition is a LEAD, never "verified". The client never sees
  // "verified (enforcement record on file)" for an authority the system could not fetch, even if synthesis
  // mislabels the basis (the prompt rule in stages.mjs is the first line; this is the deterministic backstop).
  const AUTHORITY_CITE = /\bTTAB(?:VUE)?\b|\bopp(?:osition)?\.?\s*(?:no\.?\s*)?\d{3,}|\bcancellation\s*(?:no\.?\s*)?\d|\bsustained\b|\b9\d{7}\b|\bT-\d{1,4}\/\d{2}\b/i;
  // A4 — a "verified" that the receipt join demoted (`_status === 'assumed'`) is never stated
  // as fact either; absent `_status` (no join ran) the legacy basis-only behaviour holds.
  const enfVerified = enf && enf.basis === 'verified-from-record'
    && !(typeof f.bears_on === 'string' && AUTHORITY_CITE.test(f.bears_on))
    && enf._status !== 'assumed';
  // A5 — a verified appetite NAMES its source (never a bare "record on file" stamp). B3
  // (spec 2026-07-30 §4): the inference line states its basis as a fact ("inferred — reputation/profile
  // signal") and STOPS — the "not verified against a fetched record" hedge was stamped once per card
  // (10 times on one delivered report) and now lives ONCE, in Scope's record-provenance statement.
  // WS6 extension point: the D2 litigation join (enforcer-signals.json — onomaticsAggression
  // / onomaticsOppositions from fetched records) lands here as an additional named source line.
  const enfSrc = enf && String(enf.source ?? '').trim();
  const enfBasis = enf
    ? (enfVerified
        ? `<li><b>Likely to enforce.</b> ${esc(humanize(enf.token))} appetite — <b>verified</b> (${enfSrc ? `source: ${esc(enfSrc.slice(0, 60))}` : 'enforcement record on file'}).</li>`
        : `<li><b>Likely to enforce.</b> ${esc(humanize(enf.token))} appetite <i>inferred</i> — reputation/profile signal.</li>`)
    : '';
  // Instance #5 — the use-check / own-rights cite is rendered FROM the JSON (no prose-regex), so it can never
  // diverge from the structured field. The source string may hold ONE URL, SEVERAL (comma/space-separated —
  // an own-portfolio sweep legitimately cites two record URLs), or plain text ("…— no result"). Each URL gets
  // its OWN anchor: gluing "url1, url2" into one href produced the dead link. Non-URL remainder stays
  // as text; external links open in a new tab.
  // A4 (senior lawyer) — each cite carries the joined four-tuple (verified / assumed / inferred / not
  // checked) plus, on the use-check, what KIND of page backed it (owner site / independent / register
  // mirror). No `_status` (join never ran) ⇒ the legacy cite, byte-identical.
  const cite = (src, label, status) => {
    if (!src) return '';
    // D4 — the status is LABELLED as what it is. A bare "· not yet verified" hung off the end of a
    // cite with nothing saying which of the two facts on the line it qualified.
    const stat = status ? ` <i class="evstat">Evidence: ${esc(status)}</i>` : '';
    const urls = (String(src).match(/https?:\/\/[^\s,|]+/g) || []).map(u => u.replace(/[).,;:]+$/, ''));
    if (!urls.length) return `<li><b>${label}</b> ${esc(src)}${stat}</li>`;
    const links = urls.map(u => (hrefAttr(u) ? `<a href="${hrefAttr(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, '').slice(0, 48))}</a>` : esc(u))).join(' · ');
    const rest = String(src).replace(/https?:\/\/[^\s,|]+/g, ' ').replace(/[\s,|]+/g, ' ').trim().replace(/^[—–-]\s*/, '');
    return `<li><b>${label}</b> ${links}${rest ? ` — ${esc(rest)}` : ''}${stat}</li>`;
  };
  const useStatus = useEvidence(f.meters?.use);
  // D7 — the code-owned "searched, nothing found" sentinel becomes client words HERE, by exact
  // equality against the one constant. Any other value is a source string and rides through untouched.
  const useSrc = isUseCheckNoResult(f.use_check?.source) ? USE_CHECK_NO_RESULT_CITE : f.use_check?.source;
  // NO EVIDENCE TAG ON AN EMPTY RESULT. The line read "Use checked. Marketplace search run — no result
  // found. Evidence: inferred", and "inferred" beside "no result" reads as a contradiction: it qualifies
  // how a FINDING was established, and there is no finding here. Nothing was found, and that is the
  // whole of what the line has to say.
  const useChk = cite(useSrc, 'Use checked.', isUseCheckNoResult(f.use_check?.source) ? null : useStatus);
  const ownR = cite(f.own_rights?.source, 'Own-portfolio sweep.', EVIDENCE_LABEL[f.own_rights?._status]);
  const proseFull = cardBlock(card, /^full detail/i);
  const proseFullShown = proseFull;   // one report: the full prose; portal-report strips serve-time chrome, never analysis
  const internalNote = cardBlock(card, /^full detail/i) ? '' : '';   // internal notes ride ::p:: inside prose
  // spec 47 dedupe: when the card's prose already carries a reasoned Enforcer/Enforcement bullet, the
  // templated meter line is suppressed — the reasoned read wins; two "Enforcer" bullets (one asserting
  // an unverified inference, one reasoning presence) contradicted each other on the same card (VENZY).
  const proseHasEnforcer = /(^|\n)\s*-\s*(\*\*)?\s*Enforce(r|ment)\b/i.test(proseFull || '');
  const enfLine = proseHasEnforcer ? '' : enfBasis;
  // T7 (E6) — the Corsearch enforcement telemetry, joined by registration uri: a NAMED
  // provider-recorded fact beside the meter (the declared WS6 extension point). Presentation-only —
  // it never rewrites the enforcer meter token/basis (the A4 receipt-join discipline).
  const enfTelemetry = (f.owner?.registrations ?? [])
    .map((r) => ({ r, sig: ENFORCER_SIGNALS.get(String(r.uri ?? '').toLowerCase()) }))
    .filter((x) => x.sig && (x.sig.aggression != null || x.sig.oppositions))
    .slice(0, 1)
    .map(({ r, sig }) => `<li><b>Enforcement telemetry.</b> Corsearch records ${sig.aggression != null ? `an aggression indicator of ${esc(String(sig.aggression))}` : ''}${sig.aggression != null && sig.oppositions ? ' and ' : ''}${sig.oppositions ? `${sig.oppositions} opposition proceeding${sig.oppositions === 1 ? '' : 's'}` : ''} on the owner's record (<span class="mono">${esc(String(r.uri ?? ''))}</span>) — provider telemetry, read beside the enforcer meter.</li>`)
    .join('');
  // T7 (E5) — the grounded case-law strand, deterministically joined (ordinal / mark+owner).
  // The honest no-precedent state renders too: an explicit negative is a result the lawyer relies on.
  const clProfile = CASE_LAW_BY_ORD.get(f.ordinal);
  // doc-55 A3 (one-report form) — the strand renders its full body for the reviewing reader; ::p::-marked
  // internal lines are handled by renderProse's stripInternal choke point, and serve-time client
  // preparation is portal-report.mjs's job, never a second render fork here.
  const clHead = clProfile ? `<b>Case-law${clProfile.jurisdiction ? ` (${esc(clProfile.jurisdiction)})` : ''}.</b>` : '';
  const clBody = !clProfile ? '' : renderProse(clProfile.body);   // one report: the full body (renderProse handles ::p:: internal lines)
  // Only a pass that FOUND precedent puts a strand on the card. Where none was found, or the research
  // could not be completed, the body is the engine's account of the attempt and the Court decisions
  // section says the outcome plainly on its own; repeating it here said it twice, the second time in
  // the machinery's voice on the card a client reads most closely.
  const caseLawStrand = clProfile && COURT_DECISIONS !== 'not-checked' && COURT_DECISIONS !== 'none-found'
    ? `<div class="clstrand" style="margin:10px 0 0;padding-top:8px;border-top:1px dashed var(--line,#ddd)">${clHead}${clBody}</div>`
    : '';
  const link = f.source?.resolved_link;
  // NO AUDIT REFERENCE ON A CLIENT'S CARD. "audit ref F1" is the engine's handle for the finding —
  // it indexes the workbook, it means nothing to the reader holding the report, and the mock carries no
  // such line. The SOURCE LINK stays: it is the only address a reader has for the record on this card
  // until the workbook row lands beside it, and dropping both would take a fact away rather than a
  // label. With no link there is nothing left to say, so the row does not render at all.
  const prov = hrefAttr(link) ? `<div class="prov"><a href="${hrefAttr(link)}" target="_blank" rel="noopener noreferrer">${esc(link.replace(/^https?:\/\//, '').slice(0, 48))}</a></div>` : '';
  // WP-receipts W4 — the code-owned senior-right line (Owner decision 2026-07-05: VERY SIMPLE CLEAR ENGLISH,
  // stated qualification, verdict untouched). Verified senior → nothing extra (the W2 receipt line on
  // the fetched leg is the proof). Unverified → the open item, plainly, where the finding lives.
  const sr = SENIOR_RIGHTS.get(f.ordinal);
  const seniorLine = !sr || !sr.applicable || sr.verified ? ''
    : sr.seniorUri
      ? `<li class="openitem"><b>Open item:</b> we could not pull the official record for the oldest registration in this family (${regUri(sr.seniorUri)}). We verified this conflict from a later registration of the same mark by the same owner. Checking that oldest record is still open.</li>`
      : `<li class="openitem"><b>Open item:</b> we could not tell which registration in this family is the oldest — the register index gave us no dates. The conflict itself is verified from the record we pulled; identifying the oldest right is still open.</li>`;
  // spec 64 — f.impact is code-rendered (it was prompted + validated but reached no reader surface on
  // structured-only cards; the prompt-lane IMPACT bullet is retired so it renders exactly once). Stated
  // as consequences FOR THE CLIENT TO CONSIDER, never a conclusion; suppressed when the card's own prose
  // already carries an "If enforced" bullet (the reasoned read wins — the enfLine dedupe pattern).
  const proseHasImpact = /(^|\n)\s*-\s*(\*\*)?\s*If enforced\b/i.test(proseFull || '');
  const impactLine = (f.impact && !proseHasImpact)
    ? `<li><b>If enforced:</b> ${esc(f.impact)} — for the client to consider.</li>` : '';
  // — THE REASONING LEADS THE DRAWER, and this is where it now lives. legal_position /
  // practical_position and the manageable category used to render uncut ABOVE the fold on every card:
  // roughly 600 characters of prose per finding before a reader opened anything, while the one sentence
  // carrying the answer was the only text on the page that got cut. Above the fold is now the one-line
  // card and the meters; the positions render here, complete, ahead of the structured facts — so opening
  // a card recovers every word the old layout showed, in the order the argument is made. Nothing below
  // the fold is ever trimmed to make the page shorter: length down here is not a problem.
  //
  // ONE emission for all three card shapes, deliberately. fullDetail is the body of the full card, the
  // compact card AND each reasoned-negative row, so a negative's drawer now carries its positions
  // too. It never did — the grouping's own note promises "each member is a <details> whose body is the
  // same fullDetail block the compact card carries", and until now that was untrue of the one thing v6
  // guarantees on every negative. Suppressing them there would take a conditional whose only job is
  // reproducing the pre-change shape, which is the legacy code path this program forbids.
  //
  // Absent fields ⇒ both helpers return '' ⇒ zero bytes, and the interpolation is attached to the
  // template's opening so it leaves no whitespace-only line (review 2026-07-31, problem 8).
  //
  // — ONE ACCOUNT PER FACT. A card that carries its own "### Full detail" prose already states the
  // legal read and the practical read, because the card contract mandates them there: delivery-contract
  // §L requires a "Risk assessment" bullet, and the commercial/enforcement bullets carry the practical
  // read. So on those cards lpSplit printed a SECOND copy of both, a few lines above the first — measured
  // on the frozen sample, the typed pair restated the prose's "Risk assessment" bullet on 10 cards out of
  // 10 and its Use / Enforcement / Portfolio bullets on 5 more, 19 near-identical sentence pairs in all.
  //
  // The reasoned read wins, which is the enfLine / impactLine dedupe already twice in this function, one
  // level up: it is the card's own argument, in its own order, and it is the copy the reader is reading
  // when the duplicate interrupts it. This is a SUBTRACTION, never an edit — no client string is
  // rewritten, filtered or re-labelled; one code-emitted block stops printing where the prose has already
  // printed it.
  //
  // THE GATE IS THE CONTRACT'S OWN BULLET, NOT "IS THERE PROSE" — and the difference is the whole safety
  // of this change. Gating on prose ALONE is one line shorter and, on the frozen sample, identical: all
  // 10 cards carry the bullet. It is wrong on the card where the two differ. A Full-detail block that
  // states the filing and cites the source and says nothing about the risk would have lost BOTH typed
  // reads with nothing printing in their place — rendered and checked, not argued: on that shape the
  // drawer came back with a filing line, an enforcer line and a source, and no read at all. A dedupe
  // that can delete the last copy of something is not a dedupe. So the legal read is suppressed only
  // where §L's "Risk assessment" bullet is actually there to replace it, and the practical read rides
  // the same test because it is the same authored block making the same promise.
  //
  // A DRIFTED LABEL FAILS THE SAFE WAY. If a card labels its read something else, this test misses and
  // the reader sees the duplicate again — visible, and fixable at the contract. The other failure
  // direction is a card that quietly says less than the record holds, and nobody would ever see it.
  //
  // WHERE THERE IS NO PROSE THE TYPED PAIR IS STILL THE ACCOUNT, and that is most of the surfaces
  // fullDetail feeds: a structured-only finding (no card file), a reasoned-negative row, a compact
  // card whose report-card stage produced nothing. The promise that a negative's drawer carries its
  // positions is untouched — a negative has no Full-detail prose to duplicate.
  //
  // manageableLine is NOT gated: the manageable category is a closed code-owned vocabulary the prose has
  // no bullet for, so it duplicates nothing.
  const proseHasRead = READ_LEAD_RE.test(proseFull || '');
  const positions = `${proseHasRead ? '' : lpSplit(f)}${manageableLine(f)}`;
  const body = `${positions}${regs || seniorLine || fetchFailLine || enfLine || enfTelemetry || useChk || ownR || impactLine ? `<ul>${fetchFailLine}${seniorLine}${regs}${enfLine}${enfTelemetry}${useChk}${ownR}${impactLine}</ul>` : ''}${proseFullShown ? renderProse(proseFullShown) : ''}${caseLawStrand}${prov}`;
  return `<details class="drill"><summary>Full detail</summary><div class="drillbody">${body}</div></details>`;
}

// The contentious MARK + the classes it matched in, as a header chip next to the holder — so a card shows
// WHICH mark/class the conflict is, not only who owns it (mirrors the rights-holder panel). Empty only when
// the holder IS the mark (owner unknown) AND no classes are known.
// The card head leads with the MARK and its country and class, and the owner sits on the line below
// (owner + outside reviewer, 2026-09-16). Emphasis only: nothing is removed, the same facts are read in
// the order a reader asks for them — which name, where, whose.
function cardTitleParts(f, who) {
  const classes = [...new Set((f.owner?.registrations || []).flatMap((r) => Array.isArray(r.classes) ? r.classes : []))]
    .map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b).join('/');
  const code = regionCode(f);
  const where = code && code !== COMMON_LAW ? (regionName(code) || code) : '';
  const tail = [where, classes ? `Class ${classes}` : ''].filter(Boolean).join(' \u00b7 ');
  const title = `<span class="who mark-first">${esc(f.mark || who || '')}${tail ? ` <span class="where">\u2014 ${esc(tail)}</span>` : ''}</span>`;
  const ownerLine = who ? `<div class="owner-line"><span class="ok">Owner</span> ${esc(who)}</div>` : '';
  return { title, ownerLine };
}

function markClassChip(f, who) {
  const nrm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const classes = [...new Set((f.owner?.registrations || []).flatMap((r) => Array.isArray(r.classes) ? r.classes : []))]
    .map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b).join('/');
  const showMark = Boolean(f.mark) && nrm(f.mark) !== nrm(who);
  if (!showMark && !classes) return '';
  const m = showMark ? `<span class="cm-mark">${esc(f.mark)}</span>` : '';
  const c = classes ? `<span class="ccl">Cl.&nbsp;${esc(classes)}</span>` : '';
  return `<span class="cmark">${m}${c}</span>`;
}

// T6 (H6/I8): the risk chip is CODE-BUILT from the finding record — the model no longer
// authors "- label:" (a re-invented label could disagree with the typed level/composite; I8 closes
// by construction, and the raw "Level D · Composite 4" codes never reach the client). Internal keeps
// the reviewer shorthand; the client export reads the canonical plain tier word.
function riskChip(f) {
  // doc 50 (band mode): the chip IS the framework's band word — the same word on the internal report,
  // the client export, the summary and the email. An unbanded v4 finding (off-field) reads as the
  // unrated awareness item it is. No Level/Composite shorthand exists on a v4 record.
  // D5 — the chip is the BAND WORD and nothing else. It used to append the finding's `disposition`
  // ("Manageable · Adversarial"), and disposition is not a rating: stages.mjs dictates it as the posture
  // that "SETS ONLY WHERE THE CARD IS PLACED IN THE REPORT (it NEVER changes the band you set above)".
  // findings-model.mjs already maps it to the section heading (adversarial → on-field) and this file
  // already prints those headings, so the suffix was the section name repeated in engine vocabulary on
  // every card in it — and "Adversarial" reads to a client as a claim about the owner's temper.
  if (FRAMEWORK && f.composite == null) {
    if (f.band == null) return 'Not rated — awareness';
    return esc(f.band);
  }
  const dt = f.dispute_type ? ' · ' + humanize(f.dispute_type) : '';
  // wp50: the internal chip leads with the SAME tier word every other surface uses — the reader can
  // match a card against the email/summary at a glance; Level/Composite stays as the legal shorthand.
  const tier = CLIENT_TIER_BY_COMPOSITE[f.composite];
  return `${tier ? `${esc(tier)} · ` : ''}<span class="lv">Level ${esc(f.level)}</span>Composite ${esc(String(f.composite ?? ''))}${esc(dt)}`;
}
// The one-liner fallback (model "- one:" absent): plain client words, reviewer shorthand internally.
function oneFallback(f, who) {
  if (FRAMEWORK && f.composite == null) {
    const head = f.band != null ? `${f.band} risk` : 'Not rated — commercial awareness';
    return `${head}.${who && who !== f.mark ? ` ${who}.` : ''}`;
  }
  return `${CLIENT_TIER_BY_COMPOSITE[f.composite] ?? ''} risk (Level ${f.level} · Composite ${f.composite}) — ${humanize(f.dispute_type)}.${who && who !== f.mark ? ` ${who}.` : ''}`;
}

// P5 (charter 2026-07-30, Reviewer §L) — the legal/practical SPLIT: the legal read (the one the band's
// legal letter follows) and the practical/enforcement reality, stated apart, never averaged. Absent on
// archived runs ⇒ '' ⇒ byte-identical cards.
//
// (2026-08-06) — this pair is no longer "always visible". Prose does not appear until a reader
// opens something, so both blocks are emitted by fullDetail, inside the closed drawer, and the two card
// renderers below emit neither. They are UNCUT there and always will be: the fold is what earns the
// right to be complete.
//
// CLIENT SAFETY (review 2026-07-31, blocking): these are MODEL-AUTHORED FREE STRINGS from
// findings.json and they carry ::p:: staff asides exactly like the prose does — the first cut escaped
// them with bare esc(), so a staff tail (marker and all) rendered verbatim on the client export while
// report-data.json scrubbed the same bytes, and the two client surfaces disagreed. Every reader-facing
// free string on this page goes through inline() — the ONE choke point (stripInternal →
// esc → link/markdown safety). A field that was ENTIRELY internal therefore renders as '' on the
// client and disappears with its label, exactly as a wholly-internal bullet does in renderProse.
// Item 18 (owner, 2026-09-16): a line the engine labels internal does not reach the delivered page at
// all. It stays in the findings record, the audit workbook and the assistant, which is where the
// audit was always meant to live. Marking it and hiding it in print left it on screen for a client.
const lpPara = (label, html) => isInternalLabelled(html) ? '' : `<p class="lp"><b>${label}</b> ${html}</p>`;
function lpSplit(f) {
  const legal = inline(String(f.legal_position ?? '').trim()).trim();
  const practical = inline(String(f.practical_position ?? '').trim()).trim();
  if (!legal && !practical) return '';
  return `<div class="lp-split">${legal ? lpPara('Legal risk.', legal) : ''}${practical ? lpPara('Practical position.', practical) : ''}</div>`;
}
// P5 (Reviewer §L) — WHY a notable finding is manageable: the closed category + the stated reason
// (promote-or-omit; a category-less manageable finding is a lint flag upstream). Absent ⇒ ''.
// The category is a CLOSED code-owned vocabulary (esc is right for it); the reason is model-authored
// free prose and routes through inline() with the two positions above.
const MANAGEABLE_LABEL = { 'large-competitor': 'Large competitor', 'commercial-partner': 'Commercial partner', troll: 'Troll', 'well-known-enforcer': 'Well-known enforcer' };
function manageableLine(f) {
  const m = f.manageable;
  if (!m || !m.category) return '';
  const label = MANAGEABLE_LABEL[m.category] || humanize(m.category);
  const reason = inline(String(m.reason ?? '').trim()).trim();
  return `<div class="lp-split">${lpPara(`${esc(label)}.`, reason)}</div>`;
}

// — THE CHARACTER CAP IS GONE. The typed net renders verbatim, on every surface that reads it.
//
// What stood here (item 9a/9b, the eleventh break) was `NET_BUDGET = 240` and a `foldClause` that cut
// the sentence at a sentence end inside the budget, else at a word boundary, marking the cut with an
// ellipsis. A cap defends a layout against unbounded input, and two changes removed what it defended
// against: made the net a CONCLUSION rather than the semicolon-chained rights → facts → consequence
// construction that was mandatory until 2026-08-06, and gave that a mechanical gate (findings-model's
// validateNetShape at v7, mirrored version-independently by predelivery-lint's `net-conclusion-form`
// row); and put every other piece of prose on the card behind the drawer. The sentence is bounded
// by contract, and nothing is left above the fold for it to overrun.
//
// The cap was also the exact inversion of what a scanning reader needs: the one line carrying the answer
// was the only text on the page that got truncated, while the full argument beneath it rendered whole.
// No cap comes back "just in case" — the gate that replaced it counts chain markers, never characters,
// because a model told to be brief drops a fact, which is the defect the cap was invented to prevent.
//
// TRIM-TO-EMPTY IS LOAD-BEARING AND IS PRESERVED VERBATIM. `foldClause` returned '' for null, undefined,
// '' and whitespace-only input, and that empty string is what makes `clause(f.net) || card?.meta?.one ||
// oneFallback(...)` fall through to exactly the pre-change value on an archived run, which carries no
// `net`. Deleting the function without keeping that behaviour would move every archived card whose
// `net` key exists but is blank. `clause` is `foldClause` with the budget arm removed and nothing else.
const clause = (value) => String(value ?? '').trim();

function findingCard(f, card, recordsByUri = new Map()) {
  const tierCls = isOnField(f) ? 'med' : 'low';
  const who = recordOwner(f, recordsByUri) || f.owner?.name || f.mark;   // doc-31 step 4: owner bound from the record
  const markChip = markClassChip(f, who);
  // item 9b — the always-visible sentence is RENDERED from the typed field (findings.json `net`),
  // written once in synthesis. The card's own `- one:` line stays as the fallback for archived runs and
  // for any pass that predates the field, so nothing already delivered changes; oneFallback stays under
  // both. Precedence is deliberate: the typed record wins over the parsed markdown, because the whole
  // point of typing it was to stop two surfaces authoring their own version of one sentence.
  //
  // — IT RENDERS VERBATIM. The 240-character fold that used to sit on this line is deleted; see the
  // `clause` block above for what replaced the defence it was providing.
  const one = clause(f.net) || (card?.meta?.one) || oneFallback(f, who);
  const readProse = cardBlock(card, /^the read$/i);
  const read = readProse ? `<details class="drill read" open><summary>The read</summary><div class="drillbody lead">${renderProse(readProse)}</div></details>` : '';
  return `<div class="card" id="c${f.ordinal}">
    <div class="top">
      <div class="rail ${tierCls}"></div>
      <div class="body">
        <div class="cardhead">
          <label class="pick no-print"><input type="checkbox" class="pickbox" checked></label>
          <span class="fnum">${f.ordinal}</span>${cardTitleParts(f, who).title}${evidenceChips(f)}
          <span class="tier ${tierCls}">${riskChip(f)}</span>
          <button class="ask-fi no-print">\u2726 Ask AI about this finding</button>
        </div>
        ${cardTitleParts(f, who).ownerLine}
        <div class="oneline">${inline(sentenceCaseLead(one))}</div>
        ${meters(f)}
      </div>
    </div>
    ${read}
    ${fullDetail(f, card, recordsByUri)}
  </div>`;
}

function compactCard(f, card, recordsByUri = new Map()) {
  const who = recordOwner(f, recordsByUri) || f.owner?.name || f.mark;   // doc-31 step 4: bound from the record
  // — the SAME fallback chain findingCard has carried since item 9b, and this line is why the issue
  // exists. The eleventh break pointed findingCard at the typed record and left compactCard behind, so a
  // v6 run rendered the TYPED net on its on-field cards and the AUTHORED `- one:` line on its secondary
  // ones — two summaries of two findings, from two sources, in one HTML document. With the authored line
  // now deleted at the prompt, leaving this alone would have degraded every secondary card to the
  // code-built oneFallback stub ("Not rated — commercial awareness.") instead of the finding's own read.
  // `card.meta.one` stays under it for archived runs, which carry no `net` and must render unchanged.
  // — verbatim here too; the two card renderers must never disagree about one sentence.
  const one = clause(f.net) || (card?.meta?.one) || oneFallback(f, '');
  const markChip = markClassChip(f, who);
  return `<div class="card compact" id="c${f.ordinal}">
    <div class="top"><div class="rail low"></div><div class="body">
      <div class="cardhead"><label class="pick no-print"><input type="checkbox" class="pickbox" checked></label><span class="fnum">${f.ordinal}</span>${cardTitleParts(f, who).title}${evidenceChips(f)}<span class="tier low">${riskChip(f)}</span><button class="ask-fi no-print">\u2726 Ask AI about this finding</button></div>${cardTitleParts(f, who).ownerLine}
      <div class="oneline">${inline(sentenceCaseLead(one))}</div>
    </div></div>
    ${fullDetail(f, card, recordsByUri)}
  </div>`;
}

// wp50/wi9 — plain-English coverage, next-steps framing. Every non-clean state rendered as an orange
// warn "!" (VENZY: 7 alarm cells for routine follow-ups/monitor items — the section read as a list of
// failures). States now carry a display word and routine states style neutral (.todo/.info); the grid
// splits "covered" from "next steps & monitoring". Every row still renders (doc-35: a not-searched row
// is the reader's only deterministic signal a layer didn't run — nothing is hidden).
const COV_STATE = {
  'confirmed-clean': { cls: 'ok', ic: '✓', word: 'Searched — clean' },
  'coverage-limited': { cls: 'todo', ic: '→', word: 'Partially covered' },
  open: { cls: 'todo', ic: '→', word: 'Open item' },
  'not-searched': { cls: 'todo', ic: '→', word: 'Not run this run' },
  note: { cls: 'info', ic: 'i', word: 'Note' },
};
/**
 * ONE ROW PER GAP, where the driver's follow-up row and the model's own row are the same search.
 *
 * A run deferred the English word DOLPHIN and the page said so twice: once as the model wrote it — "the
 * English word DOLPHIN as a dedicated exact search · Open item" — and once as the driver composes it
 * from the envelope, "Follow-up / dolphin · Open item: dolphin — not completed this run — the search for
 * it was planned and never reached the register…". The run's own reviewer flagged the duplicate and it
 * shipped anyway, because the second row is composed HERE and the reviewer reads what the model wrote.
 *
 * RENDER-SIDE ONLY. Both rows stay in the record and in the workbook; this decides what the page draws.
 * Dropping the driver's row from `coverage[]` would change what the run recorded, and this issue is
 * presentation.
 *
 * IT ERRS TOWARD KEEPING BOTH. A surplus row is today's behaviour; a wrongly-suppressed one hides a gap
 * from the reader, which is the failure worth avoiding. So the driver's row goes only when another row
 * carries EVERY significant word of the directive it names — a near-match keeps both.
 */
const FOLLOW_UP_PREFIX = 'Follow-up / ';
// `<axis> / <what was swept>` — the shape unitLabel composes for a plan-derived coverage unit.
const AXIS_LABELLED = /\s\/\s/;
const COV_STOPWORDS = new Set(['the', 'a', 'an', 'as', 'for', 'of', 'in', 'on', 'and', 'or', 'to', 'is',
  'was', 'it', 'its', 'this', 'that', 'with', 'by', 'at', 'be', 'been', 'run', 'search', 'searched']);
const covWords = (t) => new Set(String(t || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !COV_STOPWORDS.has(w)) ?? []);

function dedupeFollowUps(coverage) {
  const composed = (c) => String(c?.area || '').startsWith(FOLLOW_UP_PREFIX);
  const written = coverage.filter((c) => !composed(c));
  if (!written.length) return coverage;
  return coverage.filter((c) => {
    if (!composed(c)) return true;
    // The directive is the note's opening clause — the same string the area was clipped from, unclipped.
    const directive = covWords(String(c.note || '').split('—')[0]);
    if (!directive.size) return true;
    // A COMPLETED SEARCH NEVER STANDS IN FOR AN UNCOMPLETED ONE. This is the discriminator the first
    // version lacked, and it hid a real gap from a client on a delivered page.
    //
    // The composed row exists to say a planned search never ran. Suppressing it requires another row
    // saying THE SAME THING about the same search — so the row that suppresses must itself be open. A
    // row reporting a search that RAN is reporting the opposite, and the two are not interchangeable
    // however many words they share.
    //
    // Found on a real run, driven on the shipped renderer: a completed saturation probe into
    // third-party dolphin-word rights suppressed the uncompleted exact-word register search for DOLPHIN,
    // because both areas contain "dolphin". The client then read a coverage section that mentioned the
    // word and disclosed nothing left undone, and the suppressed row was the page's only disclosure of
    // it. That is exactly the failure this function's header calls the one worth avoiding, and the
    // header was right while the code was not.
    //
    // THE LIMITATION ABOVE STOPPED BEING HYPOTHETICAL, so it is a rule now rather than a paragraph.
    //
    // It read: "it is word containment, so two genuinely different OPEN searches sharing every word of a
    // short directive would still collapse to one." Measured on a delivered report — 33 coverage entries,
    // 31 rendered cells. Two open park rows with one- and two-word directives were erased by unrelated
    // rows that merely mentioned those words. The client read a coverage section that never named two
    // slices the run had deliberately disclosed, which is the failure this header calls the one worth
    // avoiding, reached by the route the header predicted.
    //
    // THE DISCRIMINATOR IS THE AXIS LABEL, and it is the identity the paragraph above said was missing.
    // A row whose area carries one — `<axis> / <what was swept>`, the shape `unitLabel` composes — is a
    // PLAN-DERIVED COVERAGE UNIT. It is not the model restating a deferred slice; it is a different unit
    // that happens to contain the same word. Only the model's own free-text row can BE a restatement,
    // and that is exactly the dolphin row this function was built for: "the English word DOLPHIN as a
    // dedicated exact search", no axis, no separator. So an axis-labelled row may no longer stand in for
    // a composed follow-up, however many words it shares.
    //
    // EVIDENCE, STATED ONE-SIDED BECAUSE IT IS. Every row containing either erased directive was
    // axis-labelled `register`, so the measured run supports the half that stops suppression. It cannot
    // support the other half: that run has no open row WITHOUT an axis label, so nothing in it exercises
    // "a free-text row still suppresses". The witness for that half is the dolphin incident alone, which
    // is a real delivered page but a single one — and the arm below is what keeps it honest.
    return !written.some((w) => {
      if (COV_STATE[w?.state]?.cls === 'ok') return false;   // a searched-and-clean row reports the opposite
      if (AXIS_LABELLED.test(String(w?.area || ''))) return false;   // a plan unit is not a restatement
      const theirs = covWords(w.area);
      return [...directive].every((word) => theirs.has(word));
    });
  });
}

function coverageGrid(coverage) {
  coverage = dedupeFollowUps(coverage);
  if (!coverage.length) return '';
  const cell = (c) => {
    const s = COV_STATE[c.state] || COV_STATE.note;
    const tag = s.cls === 'ok' ? '' : ` <span class="cst">· ${s.word}</span>`;
    // — NOTHING IS SUBSTITUTED HERE ANY MORE. `area` and `note` ride verbatim: the deleted
    // sanitizer ran nineteen find-and-replace rules over both, and is what that cost — a report naming a
    // mark that does not exist, inside the report that clears it. Measured across the nine delivered
    // runs in the pool, `coverage[]` carries no axis identifier at all; the ones that leaked were the
    // coverage_judgment rows, which now carry a driver-emitted `areaLabel` and fold through it.
    return `<div class="covcell ${s.cls}"><div class="ck">${s.ic}</div><div><div class="ct">${esc(cap(c.area))}${tag}</div><div class="cd">${esc(c.note || '')}</div></div></div>`;
  };
  const covered = coverage.filter(c => c.state === 'confirmed-clean');
  const rest = coverage.filter(c => c.state !== 'confirmed-clean');
  const parts = [];
  if (covered.length) parts.push(`<div class="cov">${covered.map(cell).join('')}</div>`);
  if (rest.length) parts.push(
    `<p class="covnext"><b>Next steps &amp; monitoring</b> — routine follow-ups and bounded monitor items; anything material is carried in the verdict above.</p>`
    + `<div class="cov">${rest.map(cell).join('')}</div>`);
  return parts.join('');
}

// CHANGE 1 (telemetry, render side — defense in depth) — the "How this search was run" Methodology block is
// where the operational telemetry surfaced (search / fetch / batch counts, saturation baselines, the cell
// matrix, has_more, the confirmed-clean enumeration). That is process exhaust, NOT legal product: it does not
// help a lawyer act on the read and it invites a number to be relied on as substance. The contract/prompts
// lane stops EMITTING it; this stops RENDERING it on BOTH the internal lawyer report and the client export
// (the client report already omitted it). Genuine coverage OPEN ITEMS are NOT here — they live in the
// findings.json coverage[] ledger and still render in the "What we covered — and what's open" grid (covNum
// section + coverageGrid). The function is kept as a NO-OP so the section-assembly call site is unchanged and
// any caller passing methodology prose silently drops it rather than erroring.
function method(_text) {
  return '';
}

// T4 (H1/H2, doctrine): the reviewBar / "verify before relying" / reasoning-integrity caveat
// surface is DEAD. Detectors now drive a silent fix or a hard fail upstream (T1-T3); the receipts live
// on the AUDIT surfaces (audit.xlsx "Review receipts" sheet + the _driver sinks) — never on the report a
// lawyer signs. The slim internal toolbar that survived it existed ONLY to host the Flag/Etch
// controls and rendered nothing without them, so took it with them.


// Brand :root tokens are sourced from shared/brand.mjs (REPORT_ROOT) and prepended to the
// report stylesheet, so report.css carries only rules — the palette lives in ONE place across surfaces.
// + the shared floating-nav CSS, with a report-only override: the report already has a sticky .topbar at
// top:0, so the cross-page nav renders STATIC (a band above it that scrolls away) — two stacked sticky bars
// would overlap. Internal report only (stripped on the client export, like every internal control).
// The report wraps the cross-page nav + its own action bar in ONE sticky container (.rep-stickyhead), so
// the nav no longer scrolls away while the topbar stays (the "nav disappears on scroll" bug). Inside the
// wrapper the nav is static and drops its own shadow — the wrapper/topbar border provides the separation.
// The report's CSS in three parts so the INTERNAL report can LINK the shared chrome instead of inlining it
// (D — <pool>/assets/chrome.css, written by regenIndex): REPORT_BASE (tokens + report.css) + REP_OVERRIDE stay
// inline on every variant; NAV_SHEET (the shared nav/toggle/fab chrome) is inlined on the client export (a
// portable, self-contained deliverable) but LINKED on the internal report so a chrome tweak reaches every
// already-published internal report on the next view with no re-render. The <link> is emitted AFTER the inline
// <style> so the cascade order (chrome after report.css, as today) is identical to the all-inline export.
const REPORT_BASE = REPORT_ROOT + '\n' + readFileSync(join(HERE, 'templates', 'report.css'), 'utf8');
const NAV_SHEET = NAV_CSS;
const REP_OVERRIDE = '.rep-stickyhead .sitenav{position:static;box-shadow:none;border-bottom:none;background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none}';
// Print always renders light: re-assert the REPORT_ROOT light tokens under [data-theme=dark] inside @media
// print (a dark-toggled report must never print on near-black — ink/banding + legal-document convention).
const PRINT_LIGHT = '\n@media print{' + REPORT_ROOT.replace(':root{', ':root[data-theme="dark"]{color-scheme:light;') + '}';
const PAGE_JS = `var _hidden=[];
function exportPDF(){_hidden=[];document.querySelectorAll('.card').forEach(function(card){var cb=card.querySelector('input.pickbox');if(cb&&!cb.checked){card.classList.add('print-hidden');_hidden.push(card);}});window.print();}
function pickAll(v){document.querySelectorAll('input.pickbox').forEach(function(cb){cb.checked=v;});}
function openAll(v){document.querySelectorAll('details.drill,details.method,details.scope,details.rgroup,details.rrow').forEach(function(d){d.open=v;});}
// doc-55 A1: a rights-holder / marker / cross-link click targets a card by #c<ordinal>. When that card sits
// inside a collapsed <details> (a secondary region's .rgroup, a .rrow), a plain anchor jump lands wrong or
// nowhere. Open every <details> ancestor of the target FIRST, then land on the card top — scroll-margin-top
// offsets the sticky topbar so the mark headline + risk band read first. Covers click, hashchange and a
// deep-link load; non-card #-links (#common-law) fall through to native nav.
function _cardReveal(el){var p=el.parentElement;while(p){if(p.tagName==='DETAILS'&&!p.open)p.open=true;p=p.parentElement;}}
function _cardHashGo(){var id=location.hash.slice(1);if(id.charAt(0)!=='c'||!/^[0-9]+$/.test(id.slice(1)))return;var el=document.getElementById(id);if(!el)return;_cardReveal(el);el.scrollIntoView({block:'start'});}
document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a[href^="#c"]'):null;if(!a)return;var id=(a.getAttribute('href')||'').slice(1);if(id.charAt(0)!=='c'||!/^[0-9]+$/.test(id.slice(1)))return;var el=document.getElementById(id);if(!el)return;_cardReveal(el);e.preventDefault();try{if(history.replaceState)history.replaceState(null,'','#'+id);}catch(err){}el.scrollIntoView({behavior:'smooth',block:'start'});});
window.addEventListener('hashchange',_cardHashGo);
window.addEventListener('load',_cardHashGo);
window.addEventListener('beforeprint',function(){document.querySelectorAll('details').forEach(function(d){d.dataset.o=d.open?'1':'';d.open=true;});});
window.addEventListener('afterprint',function(){document.querySelectorAll('details').forEach(function(d){d.open=d.dataset.o==='1';});_hidden.forEach(function(c){c.classList.remove('print-hidden');});_hidden=[];});
${EXPORT_MENU_JS}`;

// Render a parsed report + findings.json to a full self-contained HTML string.
// A1 — famous-neighbour context notes: knowledge-cited references kept for diligence (digest.md's "never
// dropped" rule) that carry NO fetched register record, so they are NOT findings and do NOT score. Rendered
// on BOTH the internal and client report (legitimate completeness — "we checked CHROME, it isn't a
// conflict"), clearly marked as not-a-conflict so a famous neighbour is surfaced, never silently lost.
// WP-56 B2 — the standing "mark itself" section: typed mark_assessment (findings-model, both parsers) →
// code render at the TOP of the page (after the hero, before the conflict landscape), on THE report.
// Advisory voice; carries no band and never moves one. Empty/absent field → ''.
// spec 2026-07-30 §3 — the STRUCTURED form renders natively: the one-sentence `read` (else the short
// spectrum/acquired/note sentences) is the visible prose; the typed per-class / per-market /
// counter-registration rows collapse behind two toggles ("By class and market" / "Registrations
// considered" — counter_registrations KEPT, collapsed: two of three on the measured run are the client's
// own marks, deliberately placed). Legacy STRING runs (8 of 11 archived) render byte-identically
// through the top branch; publish/index.mjs no longer projects the object to a wall paragraph on the
// render path (projectAssessmentField stays for the workbook, report-data and the lint).
function markAssessmentBlock(ma) {
  if (ma == null) return '';
  const structured = typeof ma.distinctiveness === 'object' || typeof ma.connotation === 'object';
  const SEC = `<div class="sec"><span class="num"></span><h2>The mark itself</h2></div>`;
  if (!structured) {
    const dist = String(ma?.distinctiveness ?? '').trim(), conn = String(ma?.connotation ?? '').trim();
    if (!dist && !conn) return '';
    return `${SEC}
  <div class="markassess">
    ${dist ? `<p><strong>Distinctiveness.</strong> ${esc(dist)}</p>` : ''}
    ${conn ? `<p><strong>Connotation &amp; meaning.</strong> ${esc(conn)}</p>` : ''}
  </div>`;
  }
  const lead = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    const dot = (s) => { const t = String(s ?? '').trim(); return t ? (/[.!?…]$/.test(t) ? t : `${t}.`) : ''; };
    const out = (typeof v.read === 'string' && v.read.trim())
      ? dot(v.read)
      : [dot(v.spectrum), dot(v.acquired && `Acquired distinctiveness: ${String(v.acquired).trim().replace(/[.\s]+$/, '')}`), dot(v.note)].filter(Boolean).join(' ');
    return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
  };
  const cmRows = [], crRows = [];
  for (const v of [ma.distinctiveness, ma.connotation]) {
    if (!v || typeof v !== 'object') continue;
    for (const r of Array.isArray(v.per_class) ? v.per_class : []) cmRows.push(`<li><b>Class ${esc(String(r.class))}.</b> ${esc(r.note)}</li>`);
    for (const r of Array.isArray(v.per_market) ? v.per_market : []) cmRows.push(`<li><b>${esc(r.market)}.</b> ${esc(r.note)}</li>`);
    for (const r of Array.isArray(v.counter_registrations) ? v.counter_registrations : []) {
      crRows.push(`<li><b>${esc(r.mark || r.uri || '')}</b>${r.owner ? ` — ${esc(r.owner)}` : ''}${r.note ? ` — ${esc(r.note)}` : ''}</li>`);
    }
  }
  const dist = lead(ma.distinctiveness), conn = lead(ma.connotation);
  if (!dist && !conn && !cmRows.length && !crRows.length) return '';
  const toggle = (label, rows) => rows.length ? `<details class="ma-more"><summary>${label} (${rows.length})</summary><ul class="ma-rows">${rows.join('')}</ul></details>` : '';
  return `${SEC}
  <div class="markassess">
    ${dist ? `<p><strong>Distinctiveness.</strong> ${esc(dist)}</p>` : ''}
    ${conn ? `<p><strong>Connotation &amp; meaning.</strong> ${esc(conn)}</p>` : ''}
    ${toggle('By class and market', cmRows)}
    ${toggle('Registrations considered', crRows)}
  </div>`;
}

// P5 (charter 2026-07-30 + Round-2 §4) — the four answers, rendered as DATA inside the hero (no new
// section heading — the spine's headings are ruled; these ARE the hero's own question decomposed).
// Each present answer renders one labelled row: judgment token (when authored) + the read sentence,
// with the basis as a quiet tail. It NEVER carries a verdict sentence of its own — riskStatement()
// stays the single assembler; this panel decomposes it, never competes with it. Absent (every
// archived run) ⇒ '' ⇒ byte-identical hero.
const FOUR_ANSWER_LABELS = [
  ['third_party_rights', 'Third-party rights'],
  ['objection_likelihood', 'Likelihood of objection'],
  ['registrability', 'Registrability'],
  ['client_enforceability', 'Your own enforceability'],
];
// CLIENT SAFETY (review 2026-07-31, blocking): read / basis / obstacles[].note are model-authored free
// strings and route through inline() with every other reader-facing string on this page (see lpSplit).
// The tokens and the class numbers are closed/typed values — esc() is right for those. A read that was
// ENTIRELY a ::p:: staff aside leaves nothing to say, so its row (and a wholly-internal obstacle row)
// disappears on the client rather than rendering an empty answer.

function contextNotesList(notes = []) {
  const items = notes.map(n => {
    const who = esc(n.mark) + (n.owner ? ` <span class="cn-own">(${esc(n.owner)})</span>` : '');
    return `<li class="cn-item"><strong>${who}</strong> — ${esc(n.context)}</li>`;
  }).join('\n    ');
  return `<ul class="cn">${items}</ul>`;
}
// Legacy (composite) runs keep the standalone famous-mark heading inside Scope, byte-identically.
// Disposition-mode runs absorb the notes into 03 Notable but manageable (spec 2026-07-30 §3) — see
// the findings-section assembly below.
function contextNotesBlock(notes = []) {
  if (!notes.length) return '';
  return `<div class="sec"><span class="num"></span><h2>Famous-mark neighbours noted</h2></div>
  ${contextNotesList(notes)}`;
}

// charter ruling 1 (2026-07-30, name-led): the masthead depth strip LEADS with the product's registry
// name in bold — the same name the read pills speak, never a rung on our ladder — then the coverage
// clauses (what this search covers / omits, from the run's frozen components via productCoverageNote).
// The seam is the LAST " — ": a registry name may itself carry one ("Preliminary clearance — register
// only") while the coverage clauses never do (they join on ";" and ","). A note with no seam at all
// (a retired level's nameless degradation) renders whole, unbolded. Absent note (every archived run
// without a sidecar) ⇒ '' ⇒ byte-identical masthead.
/**
 * THE HERO VERDICT CAPTION, folded to its first sentence.
 *
 * The design ruling: above any fold, only a statement, a labelled row, a count or a one-line card —
 * "prose never appears until someone opens something, and once opened nothing is ever cut". The finding
 * cards were moved onto that rule by `cf8dd43`; the hero caption was named in the same ruling and left
 * behind, and this is the bullet that PR recorded as still owed.
 *
 * THE SPLIT IS ON THE RAW TEXT, and `inline()` runs on each half afterwards. Splitting the RENDERED html
 * would cut inside a tag or a link the first time a caption carried one — the fold point is chosen by a
 * heuristic, and a heuristic must never be allowed to land in the middle of markup.
 *
 * NOTHING IS EVER CUT. The remainder is the rest of the string, complete, one disclosure away. That is
 * what makes the sentence heuristic acceptable here: its worst failure is a fold in an odd place (an
 * abbreviation like "U.S." read as a sentence end), which moves the boundary and loses no word. A cap
 * would have been the other thing — deleted the last one and forbids "just in case" replacements.
 *
 * The abbreviation guard covers the two shapes that actually occur in this caption: an INITIALISM
 * ("U.S.", "e.g.") and a corporate suffix in an owner's name ("Matchday, Inc. is active"). The caption's
 * own voice rules (stages.mjs "overall_caption VOICE") forbid codes and engineering register, so plain
 * legal English naming owners and territories is what arrives.
 */
const NOT_A_SENTENCE_END = new Set([
  'inc', 'ltd', 'llc', 'plc', 'co', 'corp', 'gmbh', 'sarl', 'sa', 'nv', 'bv', 'ag', 'pty',
  'no', 'nos', 'cf', 'al', 'v', 'vs', 'approx', 'est', 'fig', 'cl',
]);

function splitFirstSentence(text) {
  const t = String(text ?? '').trim();
  if (!t) return { first: '', rest: '' };
  const re = /[.!?]+(?=\s)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const end = m.index + m[0].length;
    const head = t.slice(0, m.index);
    const token = (head.match(/\S+$/) ?? [''])[0];
    // "U.S", "e.g", "N" — an initialism or a bare initial is mid-flow, not a sentence end. The letter is
    // preceded by a DOT in an initialism, which is why a "preceded by whitespace" test misses it.
    const initialism = /^(?:[A-Za-z]\.)*[A-Za-z]$/.test(token);
    const abbrev = NOT_A_SENTENCE_END.has(token.replace(/[^A-Za-z]/g, '').toLowerCase()) && token.length <= 6;
    if (initialism || abbrev) continue;
    const rest = t.slice(end).trim();
    if (!rest) break;                     // the terminator IS the end of the caption
    return { first: t.slice(0, end).trim(), rest };
  }
  return { first: t, rest: '' };
}

function heroCaptionHtml(text) {
  const { first, rest } = splitFirstSentence(text);
  if (!first) return '';
  if (!rest) return `<p class="sub">${inline(first)}</p>`;
  // `sub-lead` marks the FOLDED first sentence so the stylesheet can tighten its bottom margin without a
  // positional selector: `.sub:first-of-type` would have caught an UNFOLDED one-sentence caption too and
  // changed the spacing of every archived report that has no fold.
  return `<p class="sub sub-lead">${inline(first)}</p><details class="sub-more"><summary>Show the chart and rights-holders</summary><p class="sub">${inline(rest)}</p></details>`;
}

// The hero's confidentiality line: the delivery posture and the PRODUCT, joined, and nothing else.
//
// Both halves are optional and the whole line goes when both are. It used to end in a hardcoded
// "Preliminary Clearance" that no run could ever suppress, so a run whose product cannot be resolved
// (no policy sidecar, or a level the registry has forgotten) asserted a product name anyway. Emitting
// the row with an empty label instead would leave the leading `.dot` bulleting nothing, which is a
// worse artifact than an absent row: a reader sees a mark and hunts for the text it points at.
// — THE POSTURE IS `confPosture`, IN shared/brand.mjs, AND THE KNOCKOUT CALLS THE SAME FUNCTION.
// This template used to emit the extended marking only when a profile asked; render-knockout.mjs emitted
// a shorter one unconditionally. Two hand-rolled copies of one firm-wide marking, drifted on both the
// wording and the condition. The rule is three-state now (true ⇒ extended, false ⇒ off, absent ⇒ the
// plain default) and it is defined once — see that function's comment for why absent is not false.
/**
 * THE DEMONSTRATION BANNER.
 *
 * A demo report was indistinguishable from a client deliverable except by prose one run happened to
 * contain: a console line that no PDF carries, a caption sentence a model wrote once, and a matter code
 * that read SAMPLE because that capture was named `sample-capture`. Replace the run and all three go.
 * This is the only artefact in the demo thread that leaves the machine — it gets forwarded, printed and
 * shown in meetings, carrying real register records and a real risk band.
 *
 * INLINE-STYLED, DELIBERATELY, and this is the load-bearing detail. Already-published reports carry
 * FROZEN CSS — this file says so at three separate sites — so a banner needing a stylesheet class would
 * render on fresh reports and be invisible on every re-rendered older one: a marking that looks landed
 * and does nothing, in the one document that travels. `homeButton` above is inline for the same reason.
 *
 * NOT `no-print`. The console is not a surface and neither is the topbar, which is `no-print` and so
 * absent from every exported PDF. This sits in the hero, which is the first thing on screen and the
 * first thing on paper.
 *
 * BOTH HALVES, because each alone misleads in a different direction. "Invented mark" alone reads as a
 * toy and throws away the report's meaning as a specimen of real work; "real data" alone reads as
 * advice about a real dispute. The mark is fiction AND the register records behind it are real, and the
 * second half is what keeps the document worth showing.
 */
export function demoBannerHtml(isDemo) {
  if (!isDemo) return '';
  const box = 'margin:0 0 14px;padding:10px 14px;border:1px solid #b45309;border-left-width:5px;'
    + 'border-radius:6px;background:#fffbeb;color:#3f2d0b;font-size:13px;line-height:1.45;'
    + '-webkit-print-color-adjust:exact;print-color-adjust:exact;';
  return `<div style="${box}" role="note">`
    + '<b>Demonstration report.</b> The mark is invented and this matter is not a real engagement. '
    + 'The register records, the searches behind them and the risk assessment are real.'
    + '</div>';
}

function confLineHtml(delivery, productName) {
  const parts = [
    confPosture(delivery),
    productName ? esc(productName) : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  return `<div class="conf"><span class="dot"></span><span class="label">${parts.join(' · ')}</span></div>`;
}

function depthStripHtml(note) {
  const t = String(note ?? '').trim();
  if (!t) return '';
  const i = t.lastIndexOf(' — ');
  const inner = i > 0 ? `<b>${esc(t.slice(0, i))}</b> — ${esc(t.slice(i + 3))}` : esc(t);
  return `<div class="depth-strip">${inner}</div>`;
}

// Signature: renderHtml(parsed, findings, coverage, opts). ONE render path — there is no client variant.
// THE BOARD'S FIVE ENTRIES, in its order. The rule that filters them lives in shared/brand.mjs, because
// the knockout renderer draws a strip from its own board and the filtering is the half worth having once.
const STRIP = Object.freeze([
  ['summary', 'Summary'], ['findings', 'Findings'], ['also-considered', 'Also considered'],
  ['next', 'Next steps'], ['searched', 'What was searched'],
]);

export function renderHtml(parsed, findings = [], coverage = [], opts = {}) {
  if (findings && !Array.isArray(findings)) { opts = findings; findings = []; coverage = []; }  // tolerate legacy (parsed, opts)
  AS_OF = opts.asOf ?? null;   // C2
  VERDICT_INFO = (opts.verdictInfo && opts.verdictInfo.tier != null) ? opts.verdictInfo : null;   // T2 — only an enriched sidecar is an authority
  FRAMEWORK = opts.framework ?? null;   // doc 50 — the frozen manifest; null on archived/legacy runs
  FULL_COUNTRY = isFullCountry(opts);   // The 2026-09-16 report redesign — the depth rule for the Full detail fold
  SEARCHED_JUR = Array.isArray(opts.searchedJurisdictions) && opts.searchedJurisdictions.length ? opts.searchedJurisdictions : null;   // T6 (D4)
  SCOPE_WORLDWIDE = opts.scopeBasis === 'worldwide' ? true : null;   // the plan's scope_basis; null ⇒ fall back to the ledger-prose sniff
  CASE_LAW_BY_ORD = opts.caseLawByOrdinal instanceof Map ? opts.caseLawByOrdinal : new Map();   // T7 (E5)
  COURT_DECISIONS = opts.searchDepth?.counts?.courtDecisions ?? null;   // gates the card's case-law strand
  ENFORCER_SIGNALS = new Map((Array.isArray(opts.enforcerSignals) ? opts.enforcerSignals : []).map((e) => [String(e.uri ?? '').toLowerCase(), e]));   // T7 (E6)
  RECORD_ORIGIN = opts.recordOrigin ?? null;       // WP-receipts W2
  // — `null` and `` mean DIFFERENT things and the render must not collapse them. `` is an
  // answer: this provider publishes no per-record page, so no absolute record URL is legitimate and
  // nothing links. `null` is "this run named no provider" — a legacy or receipt-less run — where there
  // is no list to judge against, so absolute URIs are left exactly as written (the posture
  // normalizeRecordLinks already takes) and no link is CONSTRUCTED from a path.
  RECORD_ORIGINS = Array.isArray(opts.recordOrigins) ? opts.recordOrigins : null;
  // The provider table's own answer, not a branch on a vendor name here: `workbook` (no register UI
  // exists — point at the artifact that carries the record) or `placeholder` (a UI exists, its
  // per-record URL is unknown — say so, and say it is unfinished). Unset ⇒ plain text, as before.
  RECORD_CITATION = typeof opts.recordCitation === "string" ? opts.recordCitation : null; RECORD_LINKS = opts.recordLinks instanceof Map ? opts.recordLinks : null;
  PROVIDER_LABEL = opts.providerLabel ?? null;     // WP-receipts W2
  SENIOR_RIGHTS = new Map((Array.isArray(opts.seniorRights) ? opts.seniorRights : []).map((r) => [r.ordinal, r]));   // WP-receipts W3/W4
  // A1 — a review-KILLED finding (disposition "withdrawn") renders NOWHERE: not in the
  // scatter, the panels, the cards, or any count. It stays in findings.json for the forensic/audit
  // surface only ( T4: the withdrawal receipt lives on the audit workbook's Disposition
  // column + Review-receipts sheet, no longer on a report banner). This is the code gate that makes
  // a killed card unable to resurrect.
  findings = (Array.isArray(findings) ? findings : []).filter((f) => !(f && f.disposition === "withdrawn"));
  // Per-customer delivery, read as a WHOLE by confLineHtml — the flag is not collapsed to a boolean here.
  // It used to be (`opts.delivery ? !!opts.delivery.privileged : false`), and that coercion is exactly
  // what made the rule two-state: it erased the difference between a customer who said "no" and a
  // customer who said nothing, and answered both with silence.
  // THE PRODUCT THIS DOCUMENT IS. The one name the reader sees, resolved by publish from the run's
  // frozen policy row (search-policy.mjs reportIdentityFor → `.identity`) and threaded in — never composed
  // here, so the masthead, the depth strip and the covering email cannot disagree about what was bought.
  //
  // `.identity`, NOT `.banner`: banner joins stageLabel with identity, and on a RETIRED row that reads
  // "Depth 4 — Preliminary clearance". A depth number is exactly what this must stop printing.
  //
  // NULL IS A REAL ANSWER AND IT MEANS SILENCE. A run whose level the registry no longer knows, and a run
  // with no policy sidecar at all, resolve to no name — so the document makes NO product claim rather than
  // guessing one. That is reportIdentityFor's own stated doctrine ("a report that says less is
  // recoverable, a report that says the wrong stage is not") applied at the surface that prints it. It is
  // also why `opts.stageLabel` no longer reaches any client string in this file: on an unknown level it is
  // the last thing anyone recorded, and it is a rung.
  const productName = opts.productName ? String(opts.productName) : null;
  const { fm, secs, cards = [] } = parsed;
  // CHANGE 2 — disposition mode iff AT LEAST ONE finding carries an explicit disposition. NO disposition on
  // any finding ⇒ legacy composite banding (byte-identical). Set the module flag BEFORE any prominence helper
  // (isOnField / bandOf / quadrant / keyPanel) runs.
  // ONE PREDICATE, IMPORTED — not a second copy of its body. findings-model exports
  // `inDispositionMode` and calls it "the mode switch both sort sites use"; this file imported it and
  // then answered the same question inline, so the sentence in findings-model was already untrue of the
  // surface that prints the report. Two definitions of one mode agree until somebody edits one.
  DISPOSITION_MODE = inDispositionMode(findings);
  // — the grouped reasoned-negative rendering fires only on a record that declares the v6 contract,
  // because only v6 guarantees the typed grounds it groups by AND a position on every negative. Every
  // archived run — and any caller that does not thread the version through — renders exactly as before.
  //
  // THE FLOOR IS A LITERAL, and it must stay one. Until 2026-08-06 this line compared against the
  // imported FINDINGS_SCHEMA_VERSION, which was 6 on the day it was written and stopped being 6 the
  // moment the driver dictated v7. The condition means "v6 OR LATER" — v6 is when the typed grounds and
  // the mandatory positions arrived, and no later version takes them away — so binding it to whatever
  // this driver currently dictates would silently strip the grouped section off every archived v6 run on
  // republish: a substance change to a document already sent to a client.
  NEGATIVES_GROUPED = DISPOSITION_MODE && Number(opts.findingsSchemaVersion) >= 6;
  // T6 (H8) — ADVERSARIAL ordering: who can actually block first (band → composite → level →
  // enforcer appetite → deadline), via the shared comparator. Legacy runs (no dispositions) keep the
  // byte-identical composite-desc/ordinal sort.
  // doc-52 routing — a concept/genre neighbour (shares no word/sound with the mark) is not a conflict:
  // the synthesis `ruled_out` flag routes it out; older runs fall back to an off-field finding whose mark
  // shares no word with ours. Ruled-out findings leave the bands + the landscape for a quiet list below.
  // §L (2026-07-30) — token EQUALITY was too narrow: FREEZEIV shares the FREEZE element of CORAL FREEZE
  // but equalled no token, so the fallback routed a same-element class-5 register mark to "ruled out"
  // and OFF the conflict-landscape chart (the chart must plot every numbered finding). A token that
  // CONTAINS the other mark's token (≥4 chars) shares its word; only genuinely word-free neighbours
  // stay eligible for the quiet list.
  const marksShareNoWord = (mk) => {
    const toks = s => (String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 2);
    const a = toks(mk), b = toks(fm.title);
    if (!a.length || !b.length) return false;
    const shares = (x, y) => x === y || (y.length >= 4 && x.includes(y)) || (x.length >= 4 && y.includes(x));
    return !a.some(w => b.some(v => shares(w, v)));
  };
  // Explicit synthesis flag always wins. The fallback heuristic is deliberately narrow: a REGISTER
  // (not common-law — that layer keeps its own section) off-field finding whose mark shares no word
  // with ours. Anything sharing a word/sound, or not off-field, stays in the conflict bands (safe default).
  const isRuledOut = f => f && (f.ruled_out === true || (f.disposition === 'off-field' && !/^common-law/i.test(f.source?.source_type || '') && marksShareNoWord(f.mark)));
  const sortedAll = [...findings].sort((a, b) => compareBlockingPower(a, b, DISPOSITION_MODE, FRAMEWORK));
  const ruledOut = sortedAll.filter(isRuledOut);
  const sorted = sortedAll.filter(f => !isRuledOut(f));
  const onField = sorted.filter(isOnField), secondary = sorted.filter(f => !isOnField(f));
  // disposition-mode three-band split (band1 = the on-field set; band2/band3 carved from the secondary set).
  const band2 = DISPOSITION_MODE ? sorted.filter(f => bandOf(f) === 2) : [];
  const band3 = DISPOSITION_MODE ? sorted.filter(f => bandOf(f) === 3) : [];
  const i = overallIndex(fm, findings);
  // wp50: the sticky-toolbar badge speaks the same client tier word as the gauge pill and the cards.
  const riskLabel = VERDICT_INFO ? (VERDICT_INFO.tier || TIER_STOP_PILL[i]) : RISK_STOPS[i].toUpperCase();

  // Excel/audit download — lives inside the topbar Export popover (portal-report strips the link at serve time for non-staff).
  const excelBtn2 = !hrefAttr(opts.auditFile, { relative: true }) ? '' : `<a class="util" href="${hrefAttr(opts.auditFile, { relative: true })}" download>⬇ Download full audit (Excel)</a>`;

  const cardFor = f => matchCard(f, cards);
  const recordsByUri = opts.recordsByUri || new Map();   // Instance #6 — the run's _records/ set (publishReport loads it)
  const contextNotes = opts.contextNotes || [];          // A1 — famous-neighbour notes (rendered both internal + client)
  const markAssessment = opts.markAssessment || null;    // WP-56 B2 — the standing mark-itself read (both variants; absent on legacy runs)
  const fourAnswers = opts.fourAnswers || null;          // P5 — the four answers as data (both variants; absent on archived runs)
  const buckets = parseActionBuckets(secs['Actions']);   // doc-52 — split # Actions to §1 (Q&A) / §3 (only-you) / §4 (Scope)

  // CHANGE 2 — findings sections + the coverage section number.
  // LEGACY (no finding carries a disposition): the EXACT prior layout with the SAME HARD-CODED section numbers
  //   01 The conflict landscape · 02 On-field conflicts · 03 Secondary & watch · 04 coverage — assembled with
  // the identical template literals + whitespace, so an archived run renders BYTE-IDENTICAL.
  // DISPOSITION mode: a running counter numbers the bands sequentially —
  //   01 landscape · 02 On-field conflicts (adversarial — drives the verdict) ·
  //   "Notable but manageable" (band 2: coexistence-partner + distinguished) ·
  //   "Commercial awareness" (band 3: off-field) · then coverage.
  // Within a band the cards are already composite-desc / ordinal-asc (the `sorted` order). The single open
  // `.read` top card is the first on-field (band-1) full card — unchanged (findingCard renders the read open;
  // only band-1 cards are full cards).
  // A5 — common-law findings leave the region grouping for their own section (in BOTH modes).
  // No common-law finding in the run ⇒ every branch below is byte-identical to the prior layout.
  const isCL = f => regionCode(f) === COMMON_LAW;
  const clOnField = onField.filter(isCL);
  const secReg = secondary.filter(f => !isCL(f)), secCL = secondary.filter(isCL);
  // T7 (E4): the section also renders when the ONLY common-law content is the layer's
  // contributions to register findings — the layer's work is visible even with zero CL findings.
  const clBody = commonLawSection(secCL, clOnField, cardFor, recordsByUri, sorted);
  // The case-law stage's session-wide preamble (source outages etc.) renders ONCE here — the per-finding
  // strands cite 'as § Session-wide notice above', which used to point at nothing (the preamble was
  // discarded at parse). Rendered only when case-law strands exist to reference it.
  // doc-55 A3 — INTERNAL ONLY: this preamble is operational session narration (which case-law sources were
  // reachable this run — MCP wiring, tool status, HTTP/quota) = process exhaust, not legal product (doc-52).
  // It leaked those internals to the client. The client's per-finding case-law lines carry the plain result;
  // the reviewer keeps the full session note here.
  const clNoticeText = String(opts.caseLawNotice || '').trim();
  const clNotice = (clNoticeText && CASE_LAW_BY_ORD.size)
    ? `<div class="panel" style="padding:12px 16px;margin:0 0 12px"><p style="margin:0 0 4px;font-weight:700;font-size:13px">Session-wide notice</p><div style="font-size:13px">${renderProse(clNoticeText)}</div></div>`
    : '';
  // The 2026-09-16 report redesign — the section heading and the session-wide notice are off the page: the heading
  // named a layer rather than a thing a reader looks for, and the notice was operational narration. The
  // CARDS are not: a rated common-law finding is a finding, and it renders in place with the others.
  const hasCL = Boolean(clBody);
  let findingsSections, covNum;
  if (!DISPOSITION_MODE) {
    findingsSections = `${onField.length ? `<div class="sec" id="findings"><span class="num"></span><h2>The conflict landscape</h2></div>
  <div class="landwrap">${quadrant(sorted)}${keyPanel(sorted, recordsByUri)}</div>

  <div class="sec"><span class="num"></span><h2>Conflicts</h2></div>
  ${onField.map(f => findingCard(f, cardFor(f), recordsByUri)).join('\n  ')}` : ''}

  ${secReg.length ? `<div class="sec"><span class="num"></span><h2>Secondary &amp; watch</h2></div>
  ${secondaryRegions(secReg, cardFor, recordsByUri)}` : ''}${hasCL ? `

  ${clBody}` : ''}`;
    covNum = hasCL ? '05' : '04';
  } else {
    let secNum = 0;
    const num = () => String(++secNum).padStart(2, '0');
    const landscape = onField.length
      ? `<div class="sec" id="findings"><span class="num"></span><h2>The conflict landscape</h2></div>
  <div class="landwrap">${quadrant(sorted)}${keyPanel(sorted, recordsByUri)}</div>

  <div class="sec"><span class="num"></span><h2>Conflicts</h2></div>
  ${onField.map(f => findingCard(f, cardFor(f), recordsByUri)).join('\n  ')}`
      : '';
    // THE COMMON-LAW CARDS GO WITH THE CONFLICTS, NOT UNDER THE NEXT HEADING. Appended at the end they
    // landed beneath "Notable but manageable", which says something about a finding that is not true of
    // them: an off-field common-law card is not an absorbed register negative. With the section heading
    // gone they carry no heading of their own, so placement is the only thing that attributes them.
    let tail = hasCL ? `\n\n  ${clBody}` : '';
    const band2r = band2.filter(f => !isCL(f)), band3r = band3.filter(f => !isCL(f));
    // spec 2026-07-30 §3 — ONE "we looked and cleared it" section: 03 Notable but manageable ABSORBS
    // 04 Commercial awareness (band 3) and the famous-mark diligence notes. Both keep their words as
    // fold-lead paragraphs; only the headings go (9 headings → 7 on the measured run). All three
    // answered the same question; three headings made three sections retell the same clearances.
    // — on a v6 record the reasoned negatives group by GROUND (see reasonedNegatives). Below v6 the
    // section is assembled exactly as before, byte for byte: an archived run re-rendered by a republish
    // must not come back a different document, and only a v6 record carries the typed grounds the
    // grouping keys on. The gate is fail-CLOSED — an absent or unreadable version is legacy.
    const negatives = NEGATIVES_GROUPED ? reasonedNegativeGroups([...band2r, ...band3r]) : null;
    if (negatives) {
      // THE SECTION APPEARS ONLY WHEN IT HOLDS SOMETHING (owner, 2026-09-16). The reasoning it replaces
      // was "zero is not absence": a run that grouped and found none should SAY so rather than leave the
      // reader guessing. That is right for a working record and wrong for a client's page, where a
      // heading followed by a sentence explaining that there is nothing under it is the "nothing here"
      // line the owner ruled out. Whether the grouping ran is answered by the counts, not by a paragraph.
      const notes = contextNotes.length ? `\n  <p class="fold-lead"><b>Famous-mark neighbours.</b> Diligence — no register record; not scored, does not affect the risk read.</p>
  ${contextNotesList(contextNotes)}` : '';
      if (negatives.total || notes) {
        tail += `\n\n  <div class="sec"><span class="num"></span><h2>Notable but manageable</h2></div>
  ${negatives.total ? reasonedNegatives(negatives.groups, cardFor, recordsByUri) : ''}${notes}`;
      }
    } else if (band2r.length || band3r.length || contextNotes.length) {
      const parts = [];
      if (band2r.length) parts.push(secondaryRegions(band2r, cardFor, recordsByUri));
      if (band3r.length) parts.push(`<p class="fold-lead"><b>Same name, a different commercial field.</b> Listed for completeness — not conflicts with your mark.</p>
  ${secondaryRegions(band3r, cardFor, recordsByUri)}`);
      if (contextNotes.length) parts.push(`<p class="fold-lead"><b>Famous-mark neighbours.</b> Diligence — no register record; not scored, does not affect the risk read.</p>
  ${contextNotesList(contextNotes)}`);
      tail += `\n\n  <div class="sec"><span class="num"></span><h2>Notable but manageable</h2></div>
  ${parts.join('\n  ')}`;
    }
    // The 2026-09-16 report redesign — the section heading and its routing notice go; the CARDS stay, or a
    // finding the run rated would appear on no page at all.

    findingsSections = landscape + tail;
    covNum = num();
  }

  // Dark theme rides at EMIT time — the module-level CSS const stays untouched (its light half must render
  // byte-identically). The toggle arrives via the nav.
  //
  // EXPLICIT ONLY. This said "full gating: dark block WITH the @media auto-dark +
  // the OS-aware init", and that predates the client-surface ruling. A clearance report is the product's
  // most client-facing artefact — it is opened in front of a client, and the portal frames it for one —
  // and a client surface must never follow the OS colour preference. It went dark on a dark-mode laptop,
  // as a delivered legal document, on the standalone file AND framed in the portal, because the shell
  // does not strip the rule.
  //
  // The knockout renderer already took the explicit pair; the two report lanes disagreed and the wrong
  // one was the bigger deliverable. Dark is still fully reachable, by the toggle and by a choice carried
  // from any other surface — this removes the automatic part only.
  const darkCss = REPORT_ROOT_DARK_EXPLICIT;
  const themeInitScript = THEME_INIT_EXPLICIT;
  // D: the report LINKS the shared chrome (opts.chromeHref → <pool>/assets/chrome.css); direct callers with
  // no chromeHref keep it inline. Link emitted after the <style> so chrome stays last in the cascade.
  const linkChrome = !!opts.chromeHref;
  const cssInline = REPORT_BASE + '\n' + (linkChrome ? '' : NAV_SHEET) + '\n' + REP_OVERRIDE;
  const chromeLinkTag = linkChrome ? `<link rel="stylesheet" href="${escAttr(opts.chromeHref)}">` : '';
  const doc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${productName ? `${esc(productName)} — ` : ''}${esc(fm.title || '')} · ${esc(BRAND.name)}</title>
${REPORT_FONT_STYLE}${FAVICON_LINK}${themeInitScript}
<style>${cssInline}${darkCss}${PRINT_LIGHT}</style>${chromeLinkTag}</head><body class="has-glow">
<div class="rep-stickyhead no-print">
<div class="topbar no-print">
  ${/* ONE BAR (the 2026-09-16 report redesign). The site bar is not rendered on a report, so the brand belongs here:
       a reader met two stacked headers, and the lower one carried the only brand. */''}
  ${logoLockup({ mark: 16, cls: 'tb-lockup' })}
  ${opts.homeHref ? `<a class="homebtn tb-back no-print" href="${escAttr(opts.homeHref)}" title="All reports"><span aria-hidden="true">←</span> <span class="tb-back-lbl">All reports</span></a>` : ''}
  <span class="sp"></span>
  <span class="tb-risk" style="background:var(${STOP_VAR[i]})">${riskLabel}</span>
  <span class="mono tb-matter" style="font-size:11px;color:var(--faint)">${esc(fm.matter || opts.runId || '')}${fm.title ? ' / ' + esc(fm.title) : ''}</span>
  ${/* A DATE, NOT A TIMESTAMP. This read "Issued on 2026-09-17 · 08:36 GMT+2" — the minute the file
       was written, and the zone the machine that wrote it happened to be in. Neither tells a reader
       anything, and on work that spans days it implies a precision the work does not have. Every mock
       issues the date alone. Taken by PATTERN rather than by cutting at the separator, so a value in
       some other shape falls through whole instead of being truncated at whatever character sits
       there — an archived run's stamp is not this publisher's to assume. */''}
  ${(() => {
    const d = (String(opts.issued ?? '').match(/^\d{4}-\d{2}-\d{2}/) || [])[0] ?? opts.issued;
    return d ? `<span class="mono tb-issued"><span aria-hidden="true">🗓 </span>Issued on ${esc(d)}</span>` : '';
  })()}
  <button type="button" class="tbbtn tb-ask no-print">✦ <span class="tb-lbl">Ask AI</span></button>
  <div class="tb-menu">
    ${EXPORT_TOGGLE}
    ${exportPopover(`
      <div class="tb-pop-title">Export &amp; audit</div>
      <button class="util primary" onclick="exportPDF()">⬇ Export PDF (ticked findings)</button>
      ${excelBtn2}
      <div class="tb-sep"></div>
      <div class="tb-row"><button class="util" onclick="pickAll(true)">Select all</button><button class="util" onclick="pickAll(false)">Select none</button></div>
      <div class="tb-row"><button class="util" onclick="openAll(true)">Expand all</button><button class="util" onclick="openAll(false)">Collapse all</button></div>
      <p class="tb-hint">Tick a finding to keep it in the exported PDF; untick to drop it. Internal (review-only) notes are removed on export.</p>
    `)}
  </div>
</div>
<!--SECTION-STRIP-->
</div>

<div class="wrap">
  <!-- doc-52 §1 THE VERDICT — the answer leads: mark · band · one plain "subject to" line · the lawyer's
       questions answered · the time-critical alert. Process + coverage detail are below and collapsible. -->
  <header class="hero" id="summary">
    ${demoBannerHtml(opts.demoData === true)}
    ${confLineHtml(opts.delivery, productName)}
    <h1 class="mark">${esc(fm.title || '')}</h1>
    ${aboutPanel(fm, coverage, findings, opts)}
    ${heroCaptionHtml(secs['Summary'] ? secs['Summary'].trim() : (fm.overall_caption || ''))}
    <div class="heroGrid">${gauge(fm, findings, coverage, fourAnswers, opts)}</div>
    ${doFirst(secs)}
    ${actionGroup(buckets.ans, 'ans')}
  </header>

  <!-- WP-56 B2 — THE MARK ITSELF: the standing distinctiveness + connotation read (EN and non-EN). It
       frames everything below, so it sits with the verdict, above the conflict landscape. Advisory only —
       carries no rating; legacy runs (no mark_assessment) render without it. Both variants. -->
  ${markAssessmentBlock(markAssessment)}

  <!-- doc-52 §2 THE CONFLICTS — findings ordered by who can block first; each expands to full detail. -->
  ${findingsSections}

  ${whereItStandsSection(findings, opts)}

  ${courtDecisionsSection(opts)}

  ${alsoConsideredSection(ruledOut, recordsByUri, opts)}

  <!-- doc-52 §3 WHAT ONLY YOU CAN CLOSE — forward decisions, plain English, after the findings. -->
  ${buckets.you ? `<div class="sec" id="next"><span class="num"></span><h2>What happens next</h2></div>
  <div class="panel actions"><div class="actgrp act-you">${renderProse(buckets.you.body)
    .replace(/\[Time-critical\]\s*/gi, '<span class="src cl" style="margin-right:6px">Time-critical</span> ')
    .replace(/\[Open question\]\s*/gi, '<span class="src" style="margin-right:6px">Open question</span> ')
    .replace(/\[Your decision\]\s*/gi, '<span class="src" style="margin-right:6px">Your decision</span> ')
    .replace(/\[Monitor\]\s*/gi, '<span class="src" style="margin-right:6px">Monitor</span> ')
    // — the fifth token. `filing-routine` was schema-valid and unreachable until the pipeline's
    // ADVISORY_TAG gained its fourth entry; without this replace the client reads the literal "[Filing
    // step]". A run assembled before that lands carries none and this replace is inert on it.
    .replace(/\[Filing step\]\s*/gi, '<span class="src" style="margin-right:6px">Filing step</span> ')
    // — the fourth token, and the one whose ABSENCE was the defect: an undated condition carried no
    // tag at all, so the items that block reliance were the only items in this section with no chip.
    // buildOnlyYouSection now mints it beside the other three; a run assembled before that lands has none
    // and this replace is inert on it.
    .replace(/\[Before you can rely\]\s*/gi, '<span class="src cl" style="margin-right:6px">Before you can rely</span> ')}</div></div>` : ''}

  <!-- The 2026-09-16 report redesign — WHAT WAS SEARCHED. The scope fold and the checks-we-ran narrative are gone
       (owner, 2026-09-16: no coverage narrative on the page). What is left is counts, folded closed:
       completed work appears as numbers and cleared names, never as the engine's account of itself. -->
  ${whatWasSearchedSection(opts, coverage, findings, recordsByUri)}

  <footer>
    ${/* ONE CLIENT LINE, AND IT NAMES WHAT EACH DATE IS. It ran to four.
         "Rated under" STAYS, and it is not an oversight: the document carries the reviewer's
         provenance and portal-report strips that one line for every embedded reader at serve time,
         which is stated there and held by an arm. Deleting it here would take provenance off the
         reviewer's copy to save the portal a job it already does.
         "Run under project" also STAYS on the document, for the same reason and with the same
         remedy. It is internal provenance — an end-to-end arm reads it out of the published internal
         report, through the front-matter seam — and it was reaching clients only because nothing
         removed it at serve time. It does now, beside the provenance line, so the document keeps what
         review needs and the client reads neither. Deleting it here would have taken provenance off
         the internal copy to fix a leak that belongs in the same place the other one is fixed.
         The product name lead goes: the identity line already says which search this is.
         The run string is composed as "<date> · <provider>", and it was printed with neither part
         labelled, so a bare date sat next to a matter identifier meaning nothing in particular. It is
         split on the DATE by pattern — the same way `dateOf` does it one file over — and the remainder
         is the provider. A run string with no date in it is not this renderer's to take apart, so it
         is printed whole and unlabelled rather than guessed at. */''}
    <!-- WHICH MODELS SERVED THIS RUN. It used to close the scope fold, and the 2026-09-16 redesign
         deleted that fold — so the line was re-homed rather than dropped with its container, which
         would have removed a statement of provenance from the client's page as a side effect of a
         merge. Owner ruling, 2026-09-17: it belongs in the footer, beside the matter and the framework.
         It renders as '' on a run that recorded no models, so an archived run republishes exactly as
         delivered, and the call sits ADJACENT so the whitespace around it belongs to the line and goes
         with it — the freeze tool sets this paragraph aside by a pattern that takes the space before
         it. -->${servedModelsLine(opts.servedModels)}
    <span>${(() => {
      const runStr = String(fm.run ?? '').trim();
      const searchedOn = (runStr.match(/\d{4}-\d{2}-\d{2}/) || [])[0] ?? null;
      const provider = searchedOn
        ? runStr.replace(searchedOn, '').replace(/^[\s\u00b7]+|[\s\u00b7]+$/g, '').trim()
        : runStr;
      const issuedOn = (String(opts.issued ?? '').match(/^\d{4}-\d{2}-\d{2}/) || [])[0] ?? opts.issued ?? null;
      const parts = [
        fm.matter ? `Matter ${esc(fm.matter)}` : '',
        searchedOn ? `searched on ${esc(searchedOn)}` : '',
        issuedOn ? `issued on ${esc(issuedOn)}` : '',
        provider ? esc(provider) : '',
      ].filter(Boolean);
      const line = parts.length ? `${parts.join(' \u00b7 ')}.` : '';
      // The reviewer's provenance rides BELOW the client line, where portal-report removes it.
      // Both provenance lines ride BELOW the client line, where portal-report removes them.
      return line
        + (fm.rated_under ? `<br>Rated under: <span class="mono">${esc(fm.rated_under)}</span>.` : '')
        + (fm.run_under_project ? `<br>Run under project: <span class="mono">${esc(fm.run_under_project)}</span>.` : '');
    })()}</span>
    ${logoLockup({ mark: 16 })}
  </footer>
</div>
<script>${PAGE_JS}</script>
</body></html>`;
  return doc.replace('<!--SECTION-STRIP-->', sectionStrip(doc, STRIP));
}

// CLI:  node render.mjs <report.md> [findings.json] [outDir]
if (isEntrypoint(import.meta.url)) {
  const reportPath = process.argv[2];
  if (!reportPath) { console.error('usage: node render.mjs <report.md> [findings.json] [outDir]'); process.exit(1); }
  const findingsPath = process.argv[3] && process.argv[3].endsWith('.json') ? process.argv[3] : join(dirname(reportPath), 'findings.json');
  const outDir = (process.argv[4] || (process.argv[3] && !process.argv[3].endsWith('.json') ? process.argv[3] : null)) || join(HERE, 'out');
  const parsed = parseReport(reportPath);
  let findings = [], coverage = [], contextNotes = [], markAssessment = null, fourAnswers = null;
  if (existsSync(findingsPath)) { const v = parseFindingsJson(readFileSync(findingsPath, 'utf8')); findings = v.findings; coverage = v.coverage; contextNotes = v.contextNotes || []; markAssessment = v.markAssessment || null; fourAnswers = v.fourAnswers || null; }
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, basename(reportPath).replace(/\.report\.md$/, '').replace(/\.md$/, '') + '.html');
  writeFileSync(out, renderHtml(parsed, findings, coverage, { runId: basename(reportPath), contextNotes, markAssessment, fourAnswers }));
  console.log(`rendered ${findings.length} findings + ${coverage.length} coverage areas + ${contextNotes.length} context notes -> ${out}`);
}

// ── The office's own page for a fetched record, where the run's register publishes none of its own ─────
// publish addresses each fetched record from its own numbers (office-record-links.mjs) and hands the map
// in as `recordLinks`. Kept down here, below every line the rest of the tree cites by number.
import { officeReasonSentences } from './office-record-links.mjs';

// The label is the office and the number, linked where the office has a page. The handle names the
// vendor's record, not the office's, and a reader can look it up nowhere. With no link the number stands
// on its own beside the workbook note, and Scope says once, per office, why it is not a link.
function officeRecordCell(uri, regUri, note) {
  const l = RECORD_LINKS?.get(String(uri || '').toLowerCase());
  if (!l?.label) return regUri(uri);
  if (hrefAttr(l.href)) return `<a href="${hrefAttr(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`;
  return note ? `${esc(l.label)}<span class="reg-nolink">${note}</span>` : esc(l.label);
}

// What a linked registration number opens and, once per office, why the rest are cited by number. Said
// in Scope rather than beside every registration, for the reason the placeholder note was removed: a
// note repeated on every line reads as a broken report. Empty on every other run.
function officeLinkNote() {
  if (!RECORD_LINKS) return '';
  const linked = [...RECORD_LINKS.values()].some((l) => l?.href);
  return (linked ? 'A registration number shown as a link opens the office’s own page for that record. ' : '')
    + officeReasonSentences(RECORD_LINKS).map((s) => `${esc(s)} `).join('');
}

// THE MODELS THAT SERVED THIS SEARCH, as one closing line of the scope section (2026-09-14). The ids are
// the ones the engine reported for its turns (tokens.mjs servedModels), never the tier a stage asked
// for in place of a model the engine named: every tier goes to the program as the vendor's alias, and an
// alias names no model. Both report
// kinds call this, so they say it in the same words. '' when the run recorded none, so a run published
// before the record existed renders exactly as it was delivered.
//
// A TIER WORD IS CLAUDE'S. servedModels lists a turn served under a company's own deployment name as the
// tier it asked for ("Opus"), never the name, so the list may read "claude-opus-5, Haiku". Both are
// Claude's and the line says so once; in a list that also names another vendor, the word says it itself
// ("Claude Opus"). The four words, Fable among them, are the ones servedModels writes. They are kept here
// rather than imported, because tokens.mjs loads the driver's settings and this module renders without them.
const CLAUDE_TIER_WORD_RE = /^(?:Opus|Sonnet|Haiku|Fable)$/;
export function servedModelsLine(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!list.length) return '';
  const claude = list.every((id) => /^claude-/i.test(id) || CLAUDE_TIER_WORD_RE.test(id));
  const shown = claude ? list : list.map((id) => (CLAUDE_TIER_WORD_RE.test(id) ? `Claude ${id}` : id));
  return `<p class="servedby" style="margin:10px 0 0;font-size:13px">Prepared with${claude ? ' Claude' : ''}: ${shown.map(esc).join(', ')}.</p>`;
}
