// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Pure-code publish step for the prelim-driver: takes a finished run's two contract markdown files
// (report.md + audit.md, written by the report-synthesis / audit-emit stages) and renders + writes the
// delivery artifacts into the pool (`config.poolRoot`, which since has NO default — unset refuses),
// then regenerates the index.
//
// This is deterministic Node — NOT an LLM turn — so it cannot hang/timeout. The driver calls it directly
// (not via runStage). Run identity (runId/codename) comes from the driver's ctx.run; do NOT regenerate it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { driverDir } from '../../shared/driver-dir.mjs';   //
import { parseReport, parseAudit, parseSections, parseBlocks, stripInternal, parseCaseLawProfiles, parseCaseLawPreamble, joinCaseLawProfiles } from './parse.mjs';
import { renderHtml, parseActionBuckets, actYouConditions } from './render.mjs';
import { buildAudit } from './xlsx.mjs';
import { parseFindingsJson, parseFindingsJsonLenient, deriveDisplayVerdict, joinFindingToBlock, CLIENT_TIER_BY_COMPOSITE, projectCoverageJudgment } from '../findings-model.mjs';
import { readStore, requiredAbsent } from './publish-inputs.mjs';
import { clearanceReportData } from './report-data.mjs';
import { parseFrameworkManifest } from '../framework.mjs';
import { rollupTokens } from '../tokens.mjs';
import { reportIdentityFor, productCoverageNote, isRegisterOnly } from '../search-policy.mjs';
import { readRecordArtifacts, bindFindingsToRecords, joinEvidenceStatus } from '../registry-fidelity.mjs';
import { deliveryFlagLines } from '../predelivery-lint.mjs';
import { PROVIDERS, config } from '../driver.config.mjs';
import { recordOriginsFor } from '../record-origins.mjs';
import { NEUTRAL_DELIVERY, loadProfiles } from '../profiles.mjs';
import { resolveDemoData, demoBannerMd } from './demo-marking.mjs';   // — one demo question, every product; 2134 — every SURFACE
import { engineCommit } from '../engine-build.mjs';
import { WARM_ROOT, WARM_ROOT_DARK, WARM_ROOT_DARK_EXPLICIT, THEME_INIT, THEME_INIT_EXPLICIT, FONT_LINK, FAVICON_LINK, BRAND } from '../../shared/brand.mjs';
import { NAV_CSS, siteNav, siteFab } from '../../shared/site-nav.mjs';
import { anonAssets, anonClient, anonMark } from '../../shared/anon-overlay.mjs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');   // attribute sink — esc alone is quote-blind
const dateOf = run => (String(run).match(/\d{4}-\d{2}-\d{2}/) || ['undated'])[0];

// Newest-first run order for every pool listing (staff index, per-customer indexes, pool-admin list).
// Date-first, then the publish timestamp WITHIN the day, then matter. issuedAt must stay the tiebreaker
// inside a date — sorting on raw issuedAt||date would interleave displayed dates when a run dir was
// (re)created on a later day than its run date (live case: novapulse). Runs without issuedAt (pre-
// backfill metas) sort after stamped same-day runs, which only affects same-day legacy ties.
export const runOrder = (a, b) =>
  b.date.localeCompare(a.date) ||
  String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')) ||
  a.matter.localeCompare(b.matter);

// The Run column's HH:mm (Europe/Zurich) from the persisted issuedAt — shown only when the Zurich date
// matches the meta date, so a backfilled timestamp from a dir created days later never displays a
// misleading time next to the run's own date.
function issuedTime(r) {
  if (!r || !r.issuedAt) return '';
  try {
    const d = new Date(r.issuedAt);
    if (Number.isNaN(d.getTime())) return '';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (day !== r.date) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch { return ''; }
}

// W-3 — the client-export gate: the ONE allowed hard structural refusal. Pure + exported so
// it is unit-tested in isolation. Returns { released, reasons }. The judgment "could the thing that failed
// realistically change the answer we give the client?" is encoded as DETERMINISTIC structural signals —
// any one firing CLOSES the client export (a loud CLOSE-BEFORE-FILING banner is stamped on it; the
// internal report always ships untouched). Honestly-DISCLOSED gaps (coverage-limited / deferred / open /
// envelope_note / unverified-URL) are flag-only and NEVER close — closing on a disclosed partial would
// fire on every routine run. Caller FAILS CLOSED: any throw here ⇒ closed with "gate-evaluation-error".
export function evaluateClientGate({ coverage = [], lintFailingIds = [], escalationFailed = [], findingsError = null, quarantined = [], findingsStale = [], inputsAbsent = [] } = {}) {
  const reasons = [];
  // A4 (2026-07-28 postmortem): every push site pairs its prose reason with a STABLE MACHINE CODE. The codes are
  // what the recovery ladder signs (failureSignature hashes the sorted unique code set), so wording or
  // row-count drift between attempts can never re-arm a per-signature park budget. Lint-derived codes
  // are the id FAMILY (`lint:<family>`), never per-ordinal — `correction-consistency:3` and `:client:2`
  // are the same defect class to the budget. Codes are additive: `reasons` keeps its exact prose.
  const reasonCodes = [];
  const push = (code, text) => { reasonCodes.push(code); reasons.push(text); };
  // (0) A1 — the reviewer's corrections did not reach the structured findings the client
  // surfaces render from (the corrective pass left findings.json stale after a followup demand):
  // the client cards may carry facts the review already corrected or killed.
  if (Array.isArray(findingsStale) && findingsStale.length)
    push("findings-stale", `the reviewer's corrections did not reach the client-facing findings (${findingsStale.slice(0, 3).join(", ")}${findingsStale.length > 3 ? ", …" : ""}) — re-run the correction before this goes out`);
  // (1) doc-35 close-the-loop: a core search layer in state "not-searched" NO LONGER closes the client
  // export. An in-scope channel a search layer CAN reach is a CLOSE target (run it) or a clean forward
  // action — never a ⛔ CLOSE-BEFORE-FILING banner. The gate now closes ONLY when the data cannot be
  // trusted or no reasoned view can be formed (reasons 2–5), not because a reachable search was skipped.
  // (2) a load-bearing escalation the system ITSELF raised did not complete (D1).
  // Plain English — these reasons are read by a lawyer, not the people who built the pipeline. The internal
  // axis ids stay in the run log / audit; the surfaced reason says what happened in words a reader understands.
  if (Array.isArray(escalationFailed) && escalationFailed.length)
    push("escalation-failed", `the main search didn't finish — it needs to be re-run before this can be relied on`);
  // (3) internally-inconsistent registration facts survive in the delivered report (A2). record-coverage
  // (an unverified/unfetched URL, E1) is flag-only — it cannot change the answer, it just isn't confirmed.
  const ids = (lintFailingIds || []).map(String);
  if (ids.includes('registry-record-match')) push('lint:registry-record-match', 'a registration detail in the report does not match its official record');
  if (ids.includes('registry-arithmetic')) push('lint:registry-arithmetic', 'the registration counts in the report do not add up');
  // (3b) A1 — a finding the reviewer WITHDREW still appears on a delivered surface after the
  // redo attempts (ids are per-ordinal: correction-consistency:<ord> / :client:<ord>): the reader
  // would see a conflict the review already killed.
  if (ids.some((id) => id.startsWith('correction-consistency:'))) push('lint:correction-consistency', 'a conflict the reviewer withdrew still appears in the deliverable — the correction did not stick');
  // (3c) ION/copper-foundry (2026-07-22): the deliverable states a search tool was blocked/permission-denied.
  // That is not a disclosed gap — it is a false explanation for one, and it excused count-only sampling over
  // high-volume owner queries. It CANNOT be flag-only: a lawyer reading "the tool was blocked" reads
  // the missing coverage as unavoidable. The narrative is the reasoning BEHIND the report, not a filed
  // surface, so a narrative-only hit stays flag-only.
  // The predicate is the exact id family, not a bare prefix: the report surface's id IS the bare string, so
  // `startsWith` alone would hand the gate to any future id merely PREFIXED with it (an observability-only
  // `permission-prose-candidates` would silently start closing client exports).
  // The reason does NOT assert the claim is false: the lint fires on a co-occurrence of words, and the same
  // words appear when a tool genuinely did fail. Saying "that claim is false" to a lawyer over an honest
  // disclosure would put a falsehood in the CLOSE-BEFORE-FILING banner — the one surface that must not lie.
  // It says what the gate can prove from the id: on this configuration that explanation is normally a
  // by-design exclusion, and either way the coverage has to be re-established.
  const isPermissionProse = (id) => id === 'permission-prose' || id.startsWith('permission-prose:');
  if (ids.some((id) => isPermissionProse(id) && !id.startsWith('permission-prose:narrative')))
    push('lint:permission-prose', 'the deliverable explains missing coverage by saying a search tool was blocked or lacked permission — on this configuration that is normally a by-design exclusion rather than an outage, so both the explanation and the coverage it excuses must be re-established before this can be relied on');
  // (4) the machine findings could not be parsed — the data-driven surfaces are unverifiable.
  if (findingsError) push('findings-unreadable', `the results could not be read back to build the report`);
  // (5) A3 — a malformed finding was quarantined (dropped from the rendered set): the client export must never
  // ship silently missing a finding, so it closes for review (the internal report shows the exclusion + the audit records it).
  if (Array.isArray(quarantined) && quarantined.length)
    push('finding-quarantined', `a result could not be read and had to be set aside, so the report would be missing it`);
  // (6) — A PUBLISH INPUT WAS NOT THERE AT ALL. Distinct from (4): findingsError means the file was
  // present and could not be read back, this means it was never there, and until this arm existed the
  // second case set no signal whatsoever — an absent findings.json produced findings=[]/coverage=[] and
  // rode the success path, so a report built from nothing was byte-for-byte a report from a clean search.
  //
  // The list is RECORDED whatever the gating (it rides the return and lands on meta.json), and only a
  // store PUBLISH_INPUTS rules `required` closes. Every store is `optional` today — deliberately, so
  // that re-rendering an archived run cannot rewrite the released status of delivered client work — so
  // this push cannot fire on any live path. It is the tripwire for the first store ruled required, and
  // the recording above it is what actually does the work today.
  const closing = requiredAbsent(inputsAbsent);
  if (closing.length)
    push('publish-input-absent', `a required input to this report was not there (${closing.join(', ')}) — the report was built without it, which is not the same as a search that found nothing`);
  return { released: reasons.length === 0, reasons, reasonCodes, inputsAbsent: [...(Array.isArray(inputsAbsent) ? inputsAbsent : [])] };
}

// T3 (H3) — the machine-QC INPUT assembly. Mirrors publishReport's own reads exactly (the
// strict→lenient findings degrade + the _driver sinks) so an out-of-band evaluation (tests, tooling)
// judges with the same pair of eyes as publish. The pipeline preflight that used to call this is gone
// (one report, spec 2026-07-30 §5) — publishReport's in-publish evaluation is the single live caller.
export function assembleReleaseInputs(reportMdPath, findingsJsonPath) {
  let coverage = [], quarantined = [], findingsError = null;
  const base = dirname(reportMdPath);
  const inputsAbsent = [];
  // — the SAME three-state read publishReport now uses, through the same helper. This mirror
  // carried the identical no-else defect, and a mirror maintained by inspection is what was: the
  // twin dies by construction here, not by someone remembering to patch both.
  const fj = readStore(base, 'findings.json',
    { path: (findingsJsonPath && existsSync(findingsJsonPath)) ? findingsJsonPath : null });
  if (fj.state === 'absent') inputsAbsent.push('findings.json');
  else if (fj.raw == null) findingsError = fj.error;   // present but unreadable — damaged, never a clean empty
  else {
    const raw = fj.raw;
    try { const v = parseFindingsJson(raw); coverage = v.coverage; }
    catch (e) {
      try {
        const v = parseFindingsJsonLenient(raw);
        if (v.quarantined.length && v.findings.length) { coverage = v.coverage; quarantined = v.quarantined; }
        else findingsError = e.message;
      } catch { findingsError = e.message; }
    }
  }
  const readSink = (name) => {
    const s = readStore(base, `_driver/${name}`);
    if (s.state === 'absent') inputsAbsent.push(`_driver/${name}`);
    return s.value;
  };
  const lintSink = readSink('predelivery-lint.json');
  const escSink = readSink('escalation-state.json');
  const correctionsSink = readSink('corrections-state.json');
  return {
    coverage,
    lintFailingIds: Array.isArray(lintSink?.failures) ? lintSink.failures.map(String) : [],
    escalationFailed: Array.isArray(escSink?.failed) ? escSink.failed : [],
    findingsError,
    quarantined,
    findingsStale: Array.isArray(correctionsSink?.stale) ? correctionsSink.stale : [],
    inputsAbsent,
  };
}

// Cordillera brand pack (locked): limestone-cream + crimson, Satoshi. Crimson is the only strong accent;
// health states use warm-palette tones. Brand tokens come from the shared brand.mjs module.
const INDEX_CSS = `
 ${WARM_ROOT}
 ${NAV_CSS}
 *{box-sizing:border-box}
 body{margin:0;font:15px/1.6 'Satoshi','Helvetica Neue',Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
 .wrap{max-width:1000px;margin:0 auto;padding:24px 22px 60px}
 header.rep{background:transparent;color:var(--ink);border-bottom:1px solid var(--line);border-radius:0;padding:6px 0 20px;margin-bottom:22px}
 header.rep .tag{display:inline-flex;align-items:center;gap:10px;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--crimson-mid)}
 header.rep h1{margin:.28em 0 .14em;font-size:30px;letter-spacing:-.02em;line-height:1.08;font-weight:700}
 header.rep .meta{font-size:13px;color:var(--muted);margin-top:6px}
 a{color:var(--crimson);text-decoration:none} a:hover{text-decoration:underline}
 code{font-family:'Fira Code',ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--muted)}
 table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:8px}
 th,td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);font-size:13.5px;vertical-align:top}
 th{background:var(--crimson-deep);color:#f0e8d8;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
 tr:last-child td{border-bottom:none}
 .b{display:inline-block;color:#fff;font-weight:700;font-size:12px;padding:2px 9px;border-radius:999px}
 .b-mh,.b-l3{background:var(--h-amber)}.b-l4{background:var(--crimson)}.b-l2{background:var(--h-green)}.b-l1{background:var(--h-grey)}
 .stmt{display:block;margin-top:3px;font-size:11.5px;color:var(--muted,#6b5d50);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .hold{display:inline-block;background:var(--crimson);color:#fff;font-weight:700;font-size:11px;padding:1px 7px;border-radius:999px;margin-left:6px}
 .hpill{display:inline-block;color:#fff;font-weight:700;font-size:11.5px;padding:3px 11px;border-radius:999px;white-space:nowrap}
 .filterbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 12px}
 .filterbar .flbl{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--crimson-mid);font-weight:700}
 .filterbar select{font:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 9px}
 .filterbar input[type=search]{font:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 11px;min-width:min(280px,100%)}
 .filterbar .nomatch{font-size:13px;color:var(--muted)}
 .pager{display:flex;align-items:center;gap:10px;margin:10px 0 4px}
 .pager button{font:inherit;font-size:12px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 10px;cursor:pointer}
 .pager button:disabled{opacity:.4;cursor:default}
 .pager .pcount{font-size:12px;color:var(--muted)}
 .rollup{display:inline-flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
 details.archive-roll{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-top:18px;padding:2px 16px}
 details.archive-roll>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:13px 0;font-size:13.5px}
 details.archive-roll>summary::-webkit-details-marker{display:none}
 details.archive-roll>summary::before{content:"\\25B8";color:var(--crimson-mid);font-weight:700;margin-right:6px}
 details.archive-roll[open]>summary::before{content:"\\25BE"}
 details.archive-roll>summary .arch-h{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--crimson-mid);font-weight:700}
 details.archive-roll>summary .arch-n{font-size:12px;color:var(--muted)}
 details.archive-roll table{margin:4px 0 12px}
 nav.nav{display:flex;flex-wrap:wrap;gap:7px 14px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 16px;margin-bottom:14px;font-size:13px}
 nav.nav .nav-h{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--crimson-mid);font-weight:700}
 nav.nav .nav-sep{color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-left:4px}`;

function indexRows(runs, { reportFile, linkPrefix = '', showAudit = true, client = false }) {
  return runs.map(r => {
    // Machine-QC state (meta.clientGate is the historical stamp name): a STAFF-surface pill pointing the
    // reviewer at the audit workbook. It no longer decides anything — one report, always listed, always
    // linked (spec 2026-07-30 §5); the delivery-language "⛔ on hold" pill is retired with the split.
    const qcFailed = !client && r.clientGate && r.clientGate.released === false;
    // Demo anonymisation (inert on the client-facing per-customer index — no overlay there): the matter
    // (slug) + project (title) are marks → blur; the report/audit links carry the slug in the runId → the
    // anchors are neutralised; the client column → aliased. Keyed by customerKey + runId so a demo run is
    // exempt and shows real.
    const ck = r.customerKey || '';
    const runAttrs = `data-anon-href data-anon-key="${esc(ck)}" data-anon-run="${esc(r.runId)}"`;
    const mark = anonMark(r.matter, { key: ck, run: r.runId });
    const matterCell = `<a ${runAttrs} href="${linkPrefix}${esc(r.runId)}/${reportFile}">${mark}</a>`;
    // Run cell: staff surfaces show date · HH:mm (Zurich, same-day issuedAt only) · codename; the
    // customer-facing per-customer index shows the date ONLY — codenames and timestamps are internal.
    const t = client ? '' : issuedTime(r);
    const runCell = client ? esc(r.date) : `${esc(r.date)}${t ? ` · ${esc(t)}` : ''} · <code>${esc(r.codename || '')}</code>`;
    return `    <tr data-client="${esc(ck)}">
      <td>${matterCell}</td>
      <td>${anonMark(r.title, { key: ck, run: r.runId })}</td>
      <td>${anonClient(r.client, ck)}</td>
      <td><span class="b b-${esc(r.badge)}">${esc(r.overall)}</span>${qcFailed ? ' <span class="hold" title="machine QC checks failed — see the audit workbook">⚠ QC</span>' : ''}${
        // spec 64 — the stance clause of THE one risk statement beside the (labelled) band pill, so the
        // index can never show a bare severity word that reads as the whole answer. The tier word leads
        // the statement; the pill already shows it, so the cell carries the clause after the first " — ".
        // Legacy meta.json (no statement) renders this cell byte-identically.
        r.statement ? `<span class="stmt" title="${escAttr(r.statement)}">${esc(String(r.statement).split(' — ').slice(1).join(' — ') || r.statement)}</span>` : ''}</td>
      <td>${runCell}</td>${showAudit ? `
      <td>${r.auditFile ? `<a ${runAttrs} href="${linkPrefix}${esc(r.runId)}/${esc(r.auditFile)}">audit.xlsx</a>` : '—'}</td>` : ''}
    </tr>`;
  }).join('\n');
}

// ONE report (spec 2026-07-30 §5): the "Review & iteration version · internal" / "Clean final version ·
// client-facing" header pills are retired with the split they printed on the page. Both indexes link the
// same report.html; what still differs between them is audience presentation (staff nav/filter/audit
// column vs the customer page's date-only rows and explicit-light theme), not the document.

// Client filter for the STAFF index: a dropdown that shows/hides table rows by their data-client (customerKey).
// MARKUP ONLY — the behaviour lives in the combined filter+pager script emitted unconditionally by indexPage
// (the old inline IIFE here cached the rows at parse time, BEFORE the table existed, so it filtered nothing).
// Omitted when there are fewer than two clients — nothing to filter. Labels are aliased in demo mode.
function clientFilterBar(clients) {
  if (!clients || clients.length < 2) return '';
  // data-anon="client" goes on the <option> itself (a span inside <option> is invalid) so the demo overlay
  // aliases the visible label in privacy mode; the value stays the raw customerKey that data-client matches.
  const opts = clients.map(c => `<option value="${esc(c.key)}" data-anon="client" data-anon-key="${esc(c.key)}">${esc(c.label)}</option>`).join('');
  return `<div class="filterbar"><label class="flbl" for="clientFilter">Client</label>` +
    `<select id="clientFilter"><option value="">All clients</option>${opts}</select></div>`;
}

// Pager chrome + the ONE combined filter/pager script, emitted unconditionally by indexPage (staff AND
// per-customer indexes — customer/generic already holds >20 runs). Ships `hidden`: no-JS pages degrade to
// the flat, fully-visible table with no dead buttons.
const PAGER_BAR = `<div class="pager" id="pager" hidden>
    <button type="button" id="pgPrev">&#8249; Prev</button>
    <span class="pcount" id="pcount"></span>
    <button type="button" id="pgNext">Next &#8250;</button>
  </div>`;

// Report search — a text box that filters rows by their content (matter, project, verdict, date), composing
// with the client <select> and the pager. Ships `hidden`: no-JS pages degrade to the full flat table, and
// PAGER_SCRIPT reveals it only when the table is large enough to warrant searching (>8 rows). Emitted on every
// index (staff + per-customer), so it scales the client-facing matter history to many reports.
const SEARCH_BAR = `<div class="filterbar" id="repSearchBar" hidden>
    <label class="flbl" for="repSearch">Search</label>
    <input id="repSearch" type="search" placeholder="Filter by matter, project or verdict…" autocomplete="off" aria-label="Filter reports">
    <span class="nomatch" id="repNoMatch" hidden>No matching reports</span>
  </div>`;

// One apply() = filter-then-page. Rows are queried LAZILY on every pass (the parse-time cache was the
// dead-filter bug) and partitioned by closest('details.archive-roll'): fold rows only ever filter-toggle,
// main-table rows additionally page (20/page). DISPLAY-TOGGLE ONLY — never clone/move nodes: the demo anon
// overlay caches per-node state and observes childList mutations; style.display writes are invisible to it.
// The single #pcount counter replaces the old fcount so the page never shows two competing numbers.
const PAGER_SCRIPT = `<script>(function(){
var PER=20,page=1;
var s=document.getElementById("clientFilter");
var q=document.getElementById("repSearch");
var sbar=document.getElementById("repSearchBar");
var nomatch=document.getElementById("repNoMatch");
var bar=document.getElementById("pager"),prev=document.getElementById("pgPrev"),next=document.getElementById("pgNext"),cnt=document.getElementById("pcount");
function apply(){
var v=s?s.value:"";
var query=q&&q.value?q.value.trim().toLowerCase():"";
var rows=[].slice.call(document.querySelectorAll("tr[data-client]"));
var main=[],fold=0;
rows.forEach(function(r){
var m=(!v||r.getAttribute("data-client")===v)&&(!query||(r.textContent||"").toLowerCase().indexOf(query)>=0);
if(r.closest("details.archive-roll")){r.style.display=m?"":"none";if(m&&(v||query))fold++;}
else if(m)main.push(r);
else r.style.display="none";
});
var M=main.length,P=Math.max(1,Math.ceil(M/PER));
if(page>P)page=P;if(page<1)page=1;
var a=(page-1)*PER,b=Math.min(page*PER,M);
main.forEach(function(r,i){r.style.display=(i>=a&&i<b)?"":"none";});
var paged=M>PER,active=v||query;
if(nomatch)nomatch.hidden=!(active&&M===0);
if(!bar)return;
bar.hidden=!paged&&!active;
prev.hidden=next.hidden=!paged;
prev.disabled=page<=1;next.disabled=page>=P;
var t=paged?(a+1)+"\\u2013"+b+" of "+M:String(M);
if(active)t+=" shown";
if(active&&fold)t+=" \\u00b7 "+fold+" retired";
cnt.textContent=(active||paged)?t:"";
}
if(sbar&&document.querySelectorAll("tr[data-client]").length>8)sbar.hidden=false;
if(s)s.addEventListener("change",function(){page=1;apply();});
if(q)q.addEventListener("input",function(){page=1;apply();});
if(prev)prev.addEventListener("click",function(){page--;apply();});
if(next)next.addEventListener("click",function(){page++;apply();});
apply();
})();</script>`;

// theme: 'staff' (default) = full theming — dark block WITH the @media auto-dark branch + the OS-aware
// pre-paint init (the toggle button arrives via the staff nav). 'client' = explicit choice ONLY — dark
// block WITHOUT any @media (first view is always light; 'prefers-color-scheme' must not appear in client
// output), the explicit-init variant, and a standalone toggle in the header (the page has no nav).
function indexPage({ heading, sub, rows, auditCol, filter = '', archive = '', nav = '', anon = { head: '', js: '' }, theme = 'staff' }) {
  const client = theme === 'client';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(heading)}</title>
${FONT_LINK}${FAVICON_LINK}${client ? THEME_INIT_EXPLICIT : THEME_INIT}
<style>${INDEX_CSS}${client ? WARM_ROOT_DARK_EXPLICIT : WARM_ROOT_DARK}</style>${anon.head}</head><body class="has-glow">${nav}<div class="wrap">
  <header class="rep"><div class="tag">${esc(BRAND.name)} · ${esc(BRAND.product)}</div><h1>${esc(heading)}</h1><div class="meta">${sub}</div></header>${client ? siteFab({ anon: false }) : ''}
  ${SEARCH_BAR}
  ${filter}
  <table>
    <tr><th>Matter</th><th>Project</th><th>Client</th><th>Overall</th><th>Run</th>${auditCol ? '<th>Audit</th>' : ''}</tr>
${rows}
  </table>
  ${PAGER_BAR}
  ${archive}
  ${PAGER_SCRIPT}
</div>${anon.js}</body></html>`;
}

// The curated-visibility tag store (sidecar at the pool root, NOT meta.json — meta.json is rewritten on every
// republish so a flag there would be lost). Shape: { archived: ["<runId>", ...] }. A run is VISIBLE unless its
// runId is listed → new runs appear automatically; archiving is an explicit act. Absent/garbled ⇒ empty set
// (today's flat-index behaviour). Re-exported so pool-admin.mjs and the portal read/write the SAME file the
// index renders from; the implementation moved to ./archive-tags.mjs so the portal service can read the
// sidecar without importing this renderer. Imported as well as re-exported — `export ... from` re-exports
// without binding the name in this module's scope, and regenIndex below calls readArchivedSet directly.
export { ARCHIVE_TAGS_FILE, readArchivedSet, updateArchived } from './archive-tags.mjs';
import { readArchivedSet } from './archive-tags.mjs';

// Collapsible "Older / retired runs" fold for the STAFF index: a count in the summary (so viewers see how many
// runs we've done) with the names hidden until expanded. Named distinctly from the "Clearance reports" tab so
// the fold isn't confused with the page itself. Returns '' when nothing is retired (index stays a flat table).
function archiveBlock(archivedRuns) {
  if (!archivedRuns.length) return '';
  return `<details class="archive-roll">
    <summary><span class="arch-h">Older / retired runs</span><span class="arch-n">${archivedRuns.length} run(s)</span></summary>
    <table>
      <tr><th>Matter</th><th>Project</th><th>Client</th><th>Overall</th><th>Run</th><th>Audit</th></tr>
${indexRows(archivedRuns, { reportFile: 'report.html', showAudit: true })}
    </table>
  </details>`;
}

// The floating cross-page nav (Archive · Run status + client views) is the shared siteNav from
// ../../site-nav.mjs — rendered on the STAFF index only (the customer pages are otherwise unreachable),
// NEVER on a client-facing per-customer index. Active page = 'index'.

// Rebuild the pool index from every run's meta.json (newest first): the STAFF all-runs index (links
// report.html + audit) AND, additively (D3), one per-customer index per account linking the SAME
// report.html — one report (spec 2026-07-30 §5); the per-customer pages differ in chrome, not document.
export function regenIndex(poolDir) {
  const runs = readdirSync(poolDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'customer' && existsSync(join(poolDir, d.name, 'meta.json')))
    // Normalize customerKey ONCE at the read boundary so every consumer (rows' data-client, byCustomer,
    // clientList, siteNav) sees the same canonical key — historical metas predate the field and used to
    // land as data-client="" rows no filter option could ever match.
    .map(d => { const m = JSON.parse(readFileSync(join(poolDir, d.name, 'meta.json'), 'utf8')); m.customerKey = m.customerKey || 'generic'; return m; })
    .sort(runOrder);

  // Staff all-runs index — every run, links report.html + audit (employees keep full access).
  // Curated visibility (sidecar archive-tags.json): the visible runs lead the table; archived runs collapse
  // into a count-only "Archive" fold at the bottom. Absent tags ⇒ everything visible (unchanged behaviour).
  // The partition preserves the newest-first sort (both slices are taken from the already-sorted `runs`).
  const archivedSet = readArchivedSet(poolDir);
  const visible = runs.filter(r => !archivedSet.has(r.runId));
  const archivedRuns = runs.filter(r => archivedSet.has(r.runId));

  // Bucket by customer up front — the per-customer indexes consume it AND the staff nav links each one (the
  // customer pages are otherwise unreachable from the staff index). customerKey DEFAULTS to
  // 'generic' for historical metas that predate the field — one undefaulted old meta would otherwise break
  // the bucketing for EVERY index.
  const byCustomer = new Map();
  for (const r of runs) {
    const key = r.customerKey || 'generic';
    if (!byCustomer.has(key)) byCustomer.set(key, []);
    byCustomer.get(key).push(r);
  }

  // Distinct clients (customerKey → a representative display label) for the in-page client filter, sorted by
  // label. Built from byCustomer so it covers every account with a run (visible or retired).
  const clientList = [...byCustomer.entries()]
    .map(([key, crs]) => ({ key, label: (crs.find(r => r.client)?.client) || key }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Display names for the nav's Clients dropdown + the per-customer headings: profile .name first, then the
  // runs' client string (the filter label), then the raw key. Loaded BEFORE the staff index write so the
  // staff nav lists display names, not internal key slugs.
  let profileNames = new Map();
  try { profileNames = loadProfiles(); } catch { /* profiles unreadable ⇒ fallbacks below */ }
  const labelOf = new Map(clientList.map(c => [c.key, c.label]));
  const displayOf = new Map([...byCustomer.keys()].map(k => [k, profileNames.get(k)?.name || labelOf.get(k) || k]));

  const idx = join(poolDir, 'index.html');
  writeFileSync(idx, indexPage({
    heading: 'Clearance reports',
    sub: archivedRuns.length
      ? `${visible.length} shown · ${archivedRuns.length} retired · ${runs.length} report(s) total · access-controlled · noindex. Behind the deployment's auth proxy in production.`
      : `${runs.length} report(s) · access-controlled · noindex. Behind the deployment's auth proxy in production.`,
    rows: indexRows(visible, { reportFile: 'report.html', showAudit: true }),
    auditCol: true,
    filter: clientFilterBar(clientList),
    archive: archiveBlock(archivedRuns),
    // The nav's "Clients" dropdown links per-customer PAGES; exclude 'generic' — it has no client-facing page
    // (leak-#9 fix above), so a link to customer/generic/index.html would 404. The staff row filter keeps it.
    nav: siteNav(poolDir, 'index', [...byCustomer.keys()].filter(k => k !== 'generic'), '', { labels: displayOf }),
    anon: anonAssets(),                          // demo anonymisation — STAFF index only (never the client export)
  }));
  try { chmodSync(idx, 0o640); } catch { /* best-effort; group-read via set-gid pool */ }

  // D3 — per-customer indexes at customer/<key>/index.html: only that account's runs, linking THE report
  // (report.html — one report, spec 2026-07-30 §5) two levels up. The page is template-identical to the
  // staff index minus the staff chrome. NO staff nav here — internal surfaces never reach a
  // customer-facing page.
  // Do NOT chmod the customer dirs: they inherit the set-gid pool group (an explicit dir chmod here was the
  // 2026-06-02→-06-08 Caddy-403 bug — see the publishReport comment). Only the index FILES get 0o640.
  // The page heading speaks the customer's DISPLAY name (profile .name), never the internal key slug —
  // "Trademark clearance — aurora" read as an internal id on a client-facing page. Best-effort: profiles
  // unreadable ⇒ fall back to the filter label (the runs' client string) ⇒ the key (displayOf, built above).
  for (const [key, crs] of byCustomer) {
    // LEAK-#9 fail-closed: NEVER emit a client-facing customer/generic/index.html. 'generic' is the shared
    // bucket for runs with no resolved customer — a per-customer *client* page for it would co-list multiple
    // real customers' matters on one "client-facing" index. Uncustomered runs stay on the STAFF index only;
    // they get no client-facing page here and are invisible to the client-access host (service.mjs filters
    // them too). (Owner decision 2026-07-10: unkeyed/generic invisible to every client surface.)
    if (key === 'generic') continue;
    const dir = join(poolDir, 'customer', key);
    mkdirSync(dir, { recursive: true });   // inherits the set-gid group; never chmod the dir
    const cidx = join(dir, 'index.html');
    // ONE report (spec 2026-07-30 §5): a run you have rights to is always listed and always linked. The
    // old clientGate suppression (a held run vanished from this page) is gone — the machine checks live
    // on the audit workbook now and decide nothing about who may read. The precedent is the knockout
    // lane's own collapse note: two renderings of one run is how the wrong link gets sent.
    writeFileSync(cidx, indexPage({
      heading: `Trademark clearance — ${displayOf.get(key) || key}`,
      sub: `${crs.length} report(s) for this account · access-controlled · noindex.`,
      rows: indexRows(crs, { reportFile: 'report.html', linkPrefix: '../../', showAudit: false, client: true }),
      auditCol: false,
      theme: 'client',                           // explicit-light: toggle only, NO @media auto-dark on a customer page
    }));
    try { chmodSync(cidx, 0o640); } catch { /* best-effort */ }
  }
  writeChromeAsset(poolDir);   // D — refresh the linked chrome stylesheet the internal reports reference
  return runs.length;
}

// Make a just-written path group-readable (Caddy serves via the caddy group; the pool dir is set-gid).
const grpRead = (p, mode) => { try { chmodSync(p, mode); } catch { /* best-effort */ } };

// D — the shared chrome stylesheet: the nav + toggle + floating-fab CSS written ONCE to <pool>/assets/chrome.css
// so the INTERNAL report.html can <link> it (chromeHref) instead of inlining. A cosmetic nav/theme tweak then
// reaches every already-published internal report on the next view (Caddy revalidates via ETag) with NO
// re-render. UNHASHED on purpose — a hashed filename would leave old reports pointing at the stale file and
// defeat the inheritance. Hubs keep NAV_CSS inline (they regen every publish, so they inherit already). Written on every regenIndex, so every
// publish + every `pool-admin regen/archive/rerender-all` refreshes it. The assets/ dir inherits the set-gid
// caddy group from the pool root (like the run dirs) — never chmod the dir, only the file (0640, Caddy-readable).
function writeChromeAsset(poolDir) {
  const dir = join(poolDir, 'assets');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'chrome.css');
  writeFileSync(p, NAV_CSS);
  grpRead(p, 0o640);
}

// Re-render the staff surfaces from the live stores. Shared by publishReport AND pool-admin, so every
// pool-mutation path leaves the same on-disk result as a full publish — pool-admin used to call only
// regenIndex and left the page stale until the next report.
//
// CURRENTLY A NO-OP, AND THAT IS THE HONEST STATE, not an oversight. retired the quality subsystem
// and took its hub page with it. The Run-status page had one writer, a status-page module that this
// product has never shipped (see driver/test/regen-surfaces.test.mjs) and that lived in a separate repo;
// removed the dynamic import of it, because an import that can never resolve, wrapped in a bare
// catch, is a silent no-op wearing the costume of a feature.
//
// The seam is kept — the call sites and the contract "a pool mutation regenerates the staff surfaces"
// are unchanged — so a real status-page writer has one place to land. Give it a name that says what it
// does, and let its absence be loud rather than caught.
//
// The pool root is still the parameter, unused only because there is nothing left to write into it.
// eslint-disable-next-line no-unused-vars
export async function regenSurfaces(poolRoot) {}

/**
 * — reduce every record link that names a host this run's register does not publish.
 *
 * WHICH FIELDS ARE RECORD LINKS IS NOT A JUDGEMENT MADE HERE. It is findings-model.mjs's, reused
 * verbatim so the two cannot drift: `owner.registrations[].uri` unconditionally, and
 * `source.resolved_link` ONLY when the source type starts with "register". A common-law finding's
 * resolved_link is a marketplace or a company site by definition, and `use_check.source`,
 * `own_rights.source` and every meter source point at arbitrary evidence — none of them is touched.
 * Nothing here pattern-matches a URL to decide what it is; the field decides.
 *
 * @param {object[]} findings  parsed findings — MUTATED in place, and WHERE THAT LANDS IS CHECKED, not
 *                             assumed: `copyRO(fjPath, 'findings.json')` runs on the parse above, BEFORE
 *                             this, so the pool's findings.json keeps the model's original bytes for
 *                             forensics. Everything built from the array afterwards — report.html,
 *                             audit.xlsx (buildAudit) and report-data.json — takes the reduced values, so
 *                             all three client surfaces state the same link. That agreement is the point:
 *                             a repair that reached the report and not the workbook would put two
 *                             different registers in one delivery.
 * @param {string[]|null} origins  recordOriginsFor(the run's own provider). `null` = the run has no fetch
 *                             receipts (legacy/archived): a NO-OP, byte-identical output, because a run
 *                             that never named its register cannot be judged against one. `[]` is a
 *                             different answer — this provider publishes no per-record page at all, so no
 *                             absolute record URL is legitimate on it.
 * @returns {{ordinal:number,field:string,was:string}[]} what was reduced, for the log line.
 *
 * WHAT REPLACES A FOREIGN VALUE, and why it is not an origin swap:
 *   registration.uri  → its own path. `/mark/<cc>/<number>` IS the canonical record identity this system
 *                       stores, and render.mjs already composes path + the run provider's origin for it.
 *                       So a provider WITH a public record page gets a correct link, and one without gets
 *                       the number in plain text beside the office label — word for word the remedy the
 * refusal message prescribes. Swapping the origin instead would invent a URL
 *                       nobody fetched, and for the free tier (two offices, one composite) there is no
 *                       single origin to swap TO.
 *   source.resolved_link → "". This one is the provenance line's href and it is printed VERBATIM by
 *                       render.mjs — a path there renders as a relative anchor, which inside the portal's
 *                       null-origin frame is a fresh dead link. Empty is the shape that already means
 *                       "no provenance link": the line renders as `audit ref F<n>` and nothing else.
 * Clearing it also empties render.mjs's provOrigin fallback, which is the mechanism that was absolutizing
 * every registration path onto the wrong vendor whenever the run's own provider declared no origin.
 *
 * IT ALSO CHANGES WHAT A CARD SAYS, NOT ONLY WHERE IT POINTS — the one consequence here that is not about
 * hrefs, and the reason this note exists rather than a one-line comment. The run's record set is a Map keyed
 * by the `/mark/<cc>/<n>` PATH (registry-fidelity.readRecordArtifacts) and `bindFindingsToRecords` runs AFTER
 * this call, so a registration the run genuinely FETCHED but which the model cited as an absolute vendor URL
 * used to MISS that map: the bind took its "cited, not fetched" branch, dropped the model's fields, and the
 * card rendered a bare "(register-index entry)". Reduced to its path, the same uri hits. Measured on a
 * clarivate republish of examples/sample-run with one registration rewritten onto a vendor host:
 *   before  <li><b><a href="https://…/mark/eu/000692913">…</a></b> <i>(register-index entry)</i></li>
 *   after   <li><b>/mark/eu/000692913</b> · REGISTERED (app. …, reg. …; filed 1997, registered 1999) · EU
 *           · <i class="receipt">verified — Clarivate Compumark record fetched …</i></li>
 * That is a delivered report saying MORE on republish than it said when delivered, and doRepublish()
 * re-renders archives — so it is stated, and pinned by report-record-link-host.test.mjs, rather than left to
 * be found. It is the right direction: the record was fetched, the receipt is on file, and the old card
 * understated the run's own evidence. Nothing is invented — the fields come from the artifact, and a uri
 * with no artifact behind it still renders as an index entry.
 *
 * WHAT THE FREE TIER PAYS FOR THAT, measured rather than reasoned about, because the composite is the case
 * a change here is most likely to hurt. `free-tier` is hasPublicRecordUrl:true with publicRecordOrigin:null
 * (two offices, no single host), so the `recordOrigin` derivation below hands render.mjs a null and its relative
 * registration uris have ALWAYS resolved through provOrigin — i.e. through whatever host the model happened
 * to write. Republishing examples/sample-run as a free-tier run: with the model's own EUIPO links, 27 record
 * anchors before and 27 after, byte-identical. With a foreign link, 18 anchors on the wrong vendor before,
 * and after, the registration numbers as text. So the tier loses a link only in the case where the link it
 * had was wrong, and no link beats a link to the wrong registry. It is still a loss and it is stated here
 * rather than discovered later.
 *
 * WHAT THIS DOES NOT REACH, so the next reader does not assume it does:
 *   · the run's PROSE. `- Source: [EUIPO · 018575624](https://euipo.europa.eu/…)` is markdown the synthesis
 *     wrote and renderProse links it like any other markdown. No field distinguishes a prose register
 *     citation from a prose evidence citation, so the only way to catch it is to pattern-match the URL —
 *     which is the move that produced this defect class in the first place.
 *   · WHICH office within a composite. On free-tier a relative `/mark/us/…` can absolutize onto the EU
 *     office's host and pass every check here, because render.mjs picks one origin and never consults the
 *     registration's own `jurisdiction`. The data DOES carry the distinction; the renderer ignores it, and
 *     the renderer is frozen.
 */
export function normalizeRecordLinks(findings, origins) {
  if (origins == null) return [];
  const dropped = [];
  /** The URL, if `v` is an absolute http(s) URL on a host `origins` does not allow. Relative values are not
   *  host claims (findings-model says so in the same words) and are left exactly as written. */
  const foreign = (v) => {
    const s = String(v ?? '').trim();
    if (!/^https?:\/\//i.test(s)) return null;
    let u; try { u = new URL(s); } catch { return null; }
    return origins.includes(u.origin) ? null : u;
  };
  for (const f of Array.isArray(findings) ? findings : []) {
    for (const r of f?.owner?.registrations ?? []) {
      const u = foreign(r.uri);
      if (!u) continue;
      dropped.push({ ordinal: f.ordinal, field: 'registration.uri', was: String(r.uri) });
      r.uri = `${u.pathname}${u.search}${u.hash}`;
    }
    const src = f?.source;
    if (src && String(src.source_type ?? '').startsWith('register') && foreign(src.resolved_link)) {
      dropped.push({ ordinal: f.ordinal, field: 'source.resolved_link', was: String(src.resolved_link) });
      src.resolved_link = '';
    }
  }
  return dropped;
}

/**
 * Publish a finished run to the pool.
 * @param {object} a
 * @param {string} a.runId     - driver run identity, e.g. "tmp2201-novapulse-2026-06-01-teal-spire"
 * @param {string} a.codename  - driver codename (display only), e.g. "teal-spire"
 * @param {string} a.reportMd  - absolute path to report.md (from report-synthesis stage)
 * @param {string} [a.auditMd] - absolute path to audit.md (from audit-emit stage); optional
 * @param {string} a.poolRoot  - config.poolRoot (no default since; the deployment's CLEAROTRON_REPORTS_DIR)
 * @param {string} [a.poolUrl] - config.poolUrl (https://trademark.example.com) for the returned link
 * @returns {Promise<{runId,auditFile,counts,total,url,poolRunDir}>}
 */
// skipRegen — do NOT re-render index.html + the staff pages at the end. The batch backfill passes this and does
//   ONE regen after the whole loop instead of N redundant ones (per-run publish leaves it false, as before).
// (skipClient is retired with report.client.html — one report, spec 2026-07-30 §5.)
export async function publishReport({ runId, codename, reportMd, auditMd, findingsJson, poolRoot, poolUrl, customerKey, delivery, runDir, skipRegen = false }) {
  const parsed = parseReport(reportMd);
  const { fm } = parsed;
  const deliv = delivery || NEUTRAL_DELIVERY;
  // §2.9 issue timestamp — bound to GENERATION time in the firm locale (Europe/Zurich; Intl picks CET/CEST by
  // DST, no hard-coded offset). Computed HERE (publishReport is already non-deterministic — cf. the staff-page/
  // status pages below) and passed to renderHtml as opts.issued, so the renderer stays a pure function (unit
  // tests + replay diff its output). e.g. "2026-06-16 · 14:32 CEST".
  const issued = (() => {
    try {
      const d = new Date();
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
      const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value || 'CET';
      return `${date} · ${time} ${tz}`;
    } catch { return null; }
  })();
  const asOf = new Date().toISOString();   // C2 — publish-time clock for the priority-window flag (render stays pure)
  const poolRunDir = join(poolRoot, runId);
  mkdirSync(poolRunDir, { recursive: true });
  // The run dir inherits the web-server group + the set-GID bit AUTOMATICALLY from the set-GID pool root
  // (mode 2750, web-server group) — so files written inside take that group and the web server (Caddy in
  // the reference deployment, mode 0640) can read them. Do NOT chmod this dir: the service account is not
  // a member of the web-server group, and POSIX silently strips S_ISGID when a non-member sets it, leaving
  // the dir 0750 → new files fall back to the service account's primary group → every report 403s. (An explicit
  // `grpRead(poolRunDir, 0o2750)` here, added 2026-06-02, WAS that 403 bug; removed 2026-06-08.)
  const writeRO = (name, data) => { const p = join(poolRunDir, name); writeFileSync(p, data); grpRead(p, 0o640); };
  const copyRO = (src, name) => { const p = join(poolRunDir, name); copyFileSync(src, p); grpRead(p, 0o640); };

  // T6 (H7): the POOL copy of report.md is written through the stripInternal choke point —
  // markers consumed, internal tails labelled "[internal]" — so no raw ::p:: token ever reaches a
  // reader surface. The RAW report.md stays in the
  // run dir as the render/audit source of truth.
  // ── — THE MARKING IS RESOLVED HERE, ABOVE THE FIRST CLIENT SURFACE ──────────────
  //
  // IS THIS RUN DEMO DATA? (; moved to publish/demo-marking.mjs for 2122.) The
  // resolution and the whole argument for it — why the roster is RE-READ rather than trusted from the
  // frozen sidecar, and why either source marks while neither un-marks — live in that one module,
  // because the knockout publisher never asked this question at all and shipped an unmarked demo report
  // as a result.
  //
  // IT USED TO SIT BESIDE report.html, THREE HUNDRED LINES BELOW THIS WRITE, and that is the whole
  // defect 2134 was raised on: report.md is written FIRST, so the only surface that had an answer was
  // the one the answer happened to be next to. Measured on the delivered leg-2 capture — report.html
  // carried "Demonstration report" in its hero, report.md carried it zero times, and both files sit in
  // the same served pool directory. Resolved once, above every client surface, so a surface added later
  // cannot be written before the question is asked.
  const demoData = resolveDemoData({ runDir, customerKey });
  const demoMd = demoBannerMd(demoData);
  writeRO('report.md', (demoMd ? `${demoMd}\n` : '') + stripInternal(readFileSync(reportMd, 'utf8'), { client: false }));

  // The per-finding machine contract drives the data-driven report + Excel. BEST-EFFORT — a bad or
  // absent findings.json never blocks the report (the render degrades to a structured-light report); the
  // defect is surfaced as findingsError, never as raw QC on a client surface.
  let findings = [], coverage = [], contextNotes = [], quarantined = [], findingsError = null, coverageJudgment = null, markAssessment = null, actionsRegister = null, askAnswers = null, correctionsDoc = null, fourAnswers = null;
  // — the DECLARED findings contract version, threaded to the renderer so the grouped
  // reasoned-negative section fires only on a v6 record. Stays null on the lenient/error paths: fail
  // closed, an unknown version renders the pre- section.
  let findingsSchemaVersion = null;
  // — THE STORES THIS PUBLISH DID NOT FIND. Declared in publish/publish-inputs.mjs, read through
  // its three-state helper, and recorded onto meta.clientGate below. Before this list existed an absent
  // input left NO trace anywhere: findings=[]/coverage=[]/findingsError=null is exactly what a search
  // that ran and found nothing produces, so "we read nothing" and "we read everything and it was clean"
  // were the same delivered artifact. Recording is the whole fix here — the gate withholds nothing
  // (spec 2026-07-30 §5) and the report's own face is the frozen renderer's, not this file's.
  const inputsAbsent = [];
  const fj = readStore(dirname(reportMd), 'findings.json',
    { path: (findingsJson && existsSync(findingsJson)) ? findingsJson : null });
  const fjPath = fj.path;
  if (fj.state === 'absent') {
    inputsAbsent.push('findings.json');
  } else if (fj.raw == null) {
    // present but unreadable (a permissions/IO fault, not a parse one). This used to throw straight out
    // of publishReport; the stated contract two comments up is that a bad findings.json never blocks the
    // report, so it degrades to findingsError like every other unreadable form of the same file.
    findingsError = fj.error;
  } else {
    const raw = fj.raw;
    try { const v = parseFindingsJson(raw); findings = v.findings; coverage = v.coverage; contextNotes = v.contextNotes || []; coverageJudgment = v.coverageJudgment || null; markAssessment = v.markAssessment || null; actionsRegister = v.actions || null; askAnswers = v.askAnswers || null; correctionsDoc = v.corrections || null; fourAnswers = v.fourAnswers || null; findingsSchemaVersion = v.schemaVersion ?? null; copyRO(fjPath, 'findings.json'); }
    catch (e) {
      // A3 — strict parse failed: fall back to the lenient parse so ONE malformed finding degrades to "the rest
      // delivers + a loud banner + client export blocked" instead of dropping ALL structured findings. A top-level
      // defect (unparseable / unknown key) still yields nothing parseable → findingsError (legacy behaviour).
      try {
        const v = parseFindingsJsonLenient(raw);
        if (v.quarantined.length && v.findings.length) {
          findings = v.findings; coverage = v.coverage; contextNotes = v.contextNotes || []; coverageJudgment = v.coverageJudgment || null; markAssessment = v.markAssessment || null; actionsRegister = v.actions || null; askAnswers = v.askAnswers || null; correctionsDoc = v.corrections || null; fourAnswers = v.fourAnswers || null; quarantined = v.quarantined;
          // — deliberately NOT set on the quarantine path. This document already failed the strict
          // contract; grouping its negatives by grounds the parser never verified would dress a
          // half-validated record as a fully-reasoned one.
          copyRO(fjPath, 'findings.json');   // keep the ORIGINAL findings.json (with the bad finding) for forensics
        } else { findingsError = e.message; }
      } catch { findingsError = e.message; }
    }
  }
  // PR-9 (E9) — the STRING PROJECTION for coverage_judgment stays. mark_assessment is NO LONGER
  // projected on the RENDER path (spec 2026-07-30 §3): render.mjs takes the structured object and shows
  // the one-sentence `read` with the typed rows collapsed. projectAssessmentField/projectMarkAssessment
  // remain the projection for the workbook, report-data's client text, the lint and legacy string runs.
  const coverageJudgmentDisplay = projectCoverageJudgment(coverageJudgment);

  // doc-31 Tier-2 — bind each finding's structured registry fields (classes/status/filed/expiry/jurisdiction)
  // + owner from the run's fetched record set BEFORE the audit + render read them, so NO delivery artifact
  // (report.html OR audit.xlsx) carries a model-typed/​invented value. Loaded from the SOURCE runDir/_records/
  // (materialized by the lint-pass assembleRunRecords); absent ⇒ empty map ⇒ a NO-OP (back-compat: archived /
  // replay runs with no record set keep the model's fields). The persisted findings.json copy above is the
  // model's original (kept for forensics); the records are archived alongside in _records/.
  const recordsByUri = runDir ? readRecordArtifacts(runDir) : new Map();
  // WP-receipts W2 — the run's fetch-receipt index (written by assembleRunRecords). Its `provider` names
  // the register THIS run actually used — the link origin + label come from THAT provider's config, never
  // the currently-configured one (a re-published archive keeps its own register). Legacy runs: null ⇒
  // render keeps the resolved_link inference and prints no receipt lines (byte-identical output).
  let fetchReceipts = null;
  try { const rj = JSON.parse(readFileSync(driverDir(runDir, 'receipts.json'), 'utf8')); if (Array.isArray(rj?.receipts) && rj.receipts.length) fetchReceipts = rj.receipts; } catch { /* legacy run */ }
  const runProviderConf = fetchReceipts ? PROVIDERS[String(fetchReceipts[0]?.provider ?? '').toLowerCase()] : null;
  const recordOrigin = runProviderConf?.hasPublicRecordUrl ? (runProviderConf.publicRecordOrigin ?? null) : null;
  const providerLabel = runProviderConf?.label ?? null;
  // — THE RECORD LINK A READER CLICKS MUST BELONG TO THE REGISTER THIS RUN SEARCHED.
  //
  // built the allow-list and the gate, and wired the gate into verify.mjs. It never reached HERE:
  // the publish path's own `parseFindingsJson(raw)` above passes NO recordOrigins, so the gate is inactive by
  // construction — and it must stay that way (a throw here lands in the lenient/quarantine branch, which
  // turns a wrong href into a degraded delivery, and verify.mjs's never-withhold rule forbids exactly
  // that). Measured on this tree before the line below existed: a run whose receipts say `clarivate`
  // republished 28 absolute record anchors, every one of them on a host clarivate does not publish.
  //
  // So this REPAIRS rather than refuses, keyed on the RUN's own provider (the receipts above), never on
  // today's CLEAROTRON_DATABASE — a republished archive keeps its own register.
  const runOrigins = fetchReceipts ? recordOriginsFor(String(fetchReceipts[0]?.provider ?? '').toLowerCase()) : null;
  const foreignRecordLinks = normalizeRecordLinks(findings, runOrigins);
  // — the SAME list reaches the renderer. normalizeRecordLinks repairs foreign ABSOLUTE links on
  // register-sourced findings; render.mjs separately CONSTRUCTS links from bare record paths, and until
  // now it did that from a scraped origin rather than from this list. One list, both consumers.
  if (foreignRecordLinks.length)
    console.warn(`[record-link-host] ${foreignRecordLinks.length} record link(s) named a host ${providerLabel ?? 'this provider'} does not publish and were reduced to the record's own path: ${foreignRecordLinks.slice(0, 5).map(d => `F${d.ordinal} ${d.field}=${d.was.slice(0, 60)}`).join(' | ')}`);
  // WP-receipts W3/W4 — the senior-right sidecar: the render code-adds the plain-English open item on
  // any verdict-driving card whose senior right went unverified. Absent on legacy runs → no lines.
  let seniorRights = null;
  try { const sr = JSON.parse(readFileSync(driverDir(runDir, 'senior-rights.json'), 'utf8')); if (Array.isArray(sr?.rows)) seniorRights = sr.rows; } catch { /* legacy run */ }
  // D1 — the code-carried verdict + clamp reasons/kinds (A2 sidecar): the report bound line
  // distinguishes a machinery/coverage-clamped CONDITIONAL from a genuine legal read (which lives in
  // the narrative, never in a status line). Best-effort; legacy runs have no sidecar.
  let verdictInfo = null;
  try { verdictInfo = JSON.parse(readFileSync(driverDir(runDir, 'verdict.json'), 'utf8')); } catch { /* legacy */ }
  // doc 50 — the run's FROZEN framework manifest (band vocabulary). Present on band-doctrine runs;
  // absent on every archived run (they render byte-identically on the legacy paths).
  let framework = null;
  try { framework = parseFrameworkManifest(readFileSync(driverDir(runDir, 'framework.json'), 'utf8')); } catch { /* legacy run */ }
  // T2 (H5): a pre-49 sidecar ({verdict,reasons,kinds} — copper-spire's shape) gains the derived
  // display fields HERE, so a re-published archived run joins the same single authority as a fresh one.
  // No sidecar at all (pre-A2 runs) ⇒ legacy fm rendering, byte-stable.
  if (verdictInfo && verdictInfo.tier == null) {
    const d = deriveDisplayVerdict({ verdict: verdictInfo.verdict, reasons: verdictInfo.reasons, kinds: verdictInfo.kinds, findings,
      manifest: findings.some((f) => f?.band != null) ? framework : null });
    // band carries the EXACT verdict band identity (label/rankFromTop/scale) through the pre-49 enrichment —
    // gaugeIndex is a lossy tone-stop (Manageable and Low both → 1) and cannot place a marker on a
    // framework ladder; legacy composite sidecars have no band ⇒ null, and render treats null as before.
    verdictInfo = { ...verdictInfo, tier: d.tier, badge: d.badge, gaugeIndex: d.gaugeIndex, maxComposite: d.maxComposite, band: d.band ?? null };
  }
  // T6 (D4) — the SEARCHED jurisdiction set, derived from the authoritative machine artifacts:
  // the frozen register plan's per-entry regions (what the executor actually ran), falling back to the
  // instructed scope. copper-spire's header showed "CN/EU" (a per-finding fallback) while its methodology
  // named 12 searched jurisdictions — the header now states what was searched. Archived runs without
  // these sidecars keep the legacy coverage-regex/finding fallback inside the render.
  // scopeBasis — 'worldwide' when the plan says the matter named no territory limit (register-plan's
  // scope_basis). It is the DETERMINISTIC answer to "did this sweep run worldwide?", which the render
  // previously had to infer by regexing the word out of the coverage ledger's model-written prose.
  // Needed as data now that a regions-required provider compiles worldwide to its FULL office list:
  // by shape alone that is indistinguishable from a matter that hand-picked 186 territories, and the
  // two must not render the same way. Null on archived runs ⇒ render keeps the prose fallback.
  let scopeBasis = null;
  let searchedJurisdictions = [];
  try {
    const plan = JSON.parse(readFileSync(driverDir(runDir ?? dirname(reportMd), 'register-plan.json'), 'utf8'));
    if (plan?.scope_basis === 'worldwide') scopeBasis = 'worldwide';
    searchedJurisdictions = [...new Set((plan?.entries ?? []).flatMap((e) => Array.isArray(e.regions) ? e.regions : []))];
    if (!searchedJurisdictions.length && Array.isArray(plan?.regions)) searchedJurisdictions = [...new Set(plan.regions)];
  } catch { /* no plan sidecar — try the instructed scope */ }
  if (!searchedJurisdictions.length) {
    try {
      const scope = JSON.parse(readFileSync(driverDir(runDir ?? dirname(reportMd), 'instructed-scope.json'), 'utf8'));
      if (Array.isArray(scope?.jurisdictions)) searchedJurisdictions = scope.jurisdictions;
      else if (typeof scope?.jurisdictions === 'string') searchedJurisdictions = scope.jurisdictions.split(/[,·;\s]+/).filter(Boolean);
    } catch { /* legacy run — render falls back */ }
  }
  // A worldwide sweep states itself as "worldwide", never as its office list — so the searched-set
  // never drives the header on one. Corsearch already arrived here empty (an absent region clause IS
  // its worldwide); clarivate arrives with all 186 codes, which would otherwise become 186 header
  // chips and a slash-joined wall of codes on the Summary's Jurisdiction line. Clearing it LAST (after
  // the instructed-scope fallback, which must not re-populate it either) gives both providers the
  // rendering worldwide runs have always had: chips from the coverage ledger and the findings' own
  // regions — the citation focus, which is exactly what the worldwide notes beneath them promise.
  if (scopeBasis === 'worldwide') searchedJurisdictions = [];
  // T7 (E5) — the case-law layer joins DETERMINISTICALLY (was: a prompt fished in the md and
  // hit 2 of 3 copper-spire cards): parse the grounded profiles, join by ordinal (fresh runs dictate
  // "- ord:") falling back to mark/owner (archived runs) — every matched card gets its strand.
  let caseLawByOrdinal = new Map();
  let caseLawNotice = '';
  try {
    const clPath = join(dirname(reportMd), 'case-law-findings.md');
    if (existsSync(clPath)) {
      const clMd = readFileSync(clPath, 'utf8');
      caseLawByOrdinal = joinCaseLawProfiles(parseCaseLawProfiles(clMd), findings);
      caseLawNotice = parseCaseLawPreamble(clMd);   // session-wide outage notice — rendered once in §04
    }
  } catch { /* no case-law layer this run */ }
  // T7 (E6) — the Corsearch enforcement telemetry (onomaticsAggression/oppositions, extracted
  // to _driver/enforcer-signals.json since D2) finally reaches the render: the declared WS6
  // extension point. Presentation-only — a provider-recorded fact beside the meter, never a restamp.
  let enforcerSignals = [];
  try {
    const esPath = driverDir(runDir ?? dirname(reportMd), 'enforcer-signals.json');
    if (existsSync(esPath)) { const es = JSON.parse(readFileSync(esPath, 'utf8')); if (Array.isArray(es)) enforcerSignals = es; }
  } catch { /* absent — no telemetry lines */ }
  bindFindingsToRecords(findings, recordsByUri);
  // 404-card caveat (2026-07-22): the V4-2 closure pass persisted every cited record its targeted
  // fetch definitively could not retrieve (predelivery-lint.json artifactSet.recordFetchFailures);
  // the evidence join stamps `_recordFetchFailure` from it so the card render carries the
  // deterministic unverified-caveat line (client render included). Best-effort — absent sink
  // (archived/legacy runs) means no stamp, byte-identical legacy render.
  let recordFetchFailures = null;
  try {
    const sink = JSON.parse(readFileSync(driverDir(dirname(reportMd), 'predelivery-lint.json'), 'utf8'));
    if (Array.isArray(sink?.artifactSet?.recordFetchFailures)) recordFetchFailures = sink.artifactSet.recordFetchFailures;
  } catch { /* legacy run — no failure list */ }
  // A4 — derive per-meter evidence status by machine join (verified needs a receipt; a
  // register mirror is never use evidence). Display-only mutation; the demotion IS the fix (
  // T4/F2: it no longer ALSO shouts on a banner — the receipt rides the audit workbook).
  const evidenceFlags = joinEvidenceStatus(findings, recordsByUri, recordFetchFailures);

  // T4 (H1/H2): the _driver sinks feed the AUDIT surfaces and the client gate — never a
  // rendered caveat. The old integrityFlags/lintFlags "verify before relying" review-bar assembly is
  // dead; the same receipts now land on the audit workbook's Review-receipts sheet below and stay in
  // the sinks for the audit surfaces. Best-effort reads: an absent sink means that signal can't fire.
  // — the four gate-feeding sinks read through the declared three-state helper, so an absent one
  // is recorded rather than folded into the same `null` a damaged one produces. Same reads, same base,
  // same degrade-to-null behaviour for the consumers below; what is new is that the absence is kept.
  // The presentation-only stores above (receipts, framework, register-plan, …) still read as they did:
  // routing every one of them through the helper would force a single base directory on reads that
  // deliberately use three different ones (runDir, dirname(reportMd), and runDir ?? dirname(reportMd)),
  // and unifying those is a behaviour change that does not belong inside a guard commit.
  const readSink = (name) => {
    const s = readStore(dirname(reportMd), `_driver/${name}`);
    if (s.state === 'absent') inputsAbsent.push(`_driver/${name}`);
    return s.value;
  };
  const lintSink = readSink('predelivery-lint.json');
  const escSink = readSink('escalation-state.json');
  const integritySink = readSink('reasoning-integrity.json');
  const correctionsSink = readSink('corrections-state.json');   // A1
  const lintFailingIds = Array.isArray(lintSink?.failures) ? lintSink.failures.map(String) : [];
  const findingsStale = Array.isArray(correctionsSink?.stale) ? correctionsSink.stale : [];
  const reviewReceipts = {
    // `family` rides along for deliveryFlagLines' fallback: a check whose id is not in the projection
    // table still projects to its family's sentence rather than to anything the engine wrote.
    lint: (lintSink?.checks ?? []).filter(c => !c.pass).map(c => ({ id: c.id ?? '', family: c.family ?? '', detail: c.detail ?? '' })),
    engagement: integritySink?.engagement ?? null,
    registryCorrections: Array.isArray(integritySink?.registryCorrections)
      ? integritySink.registryCorrections.filter((c) => c && c.from != null && c.to != null) : [],
    tripFlags: (integritySink?.tripFlags ?? []).map(String),
    evidenceDemotions: evidenceFlags.map(String),
    findingsStale,
    escalationFailed: Array.isArray(escSink?.failed) ? escSink.failed : [],
    machineLedgerNote: (() => { try { return JSON.parse(readFileSync(join(runDir ?? dirname(reportMd), 'status.json'), 'utf8'))?.machineLedgerNote ?? null; } catch { return null; } })(),
  };

  // Machine QC (the evaluateClientGate checks — arithmetic, record fidelity, stale corrections). The
  // checks SURVIVE; what they decide is gone: one report (spec 2026-07-30 §5), so they no longer choose
  // who may read anything. Evaluated HERE — before the audit workbook build — because the workbook is
  // where their result lands (a plain internal QC row) alongside the run telemetry; failures also stamp
  // meta.json for the staff index's ⚠ QC pill. The rendered report carries no banner either way, and a
  // defect that changes the LEGAL ANSWER is the verdict clamp's job — it rides the report as a fact
  // about the mark, never as a warning about the document.
  let clientGate;
  try {
    clientGate = evaluateClientGate({ coverage, lintFailingIds, escalationFailed: escSink?.failed ?? [], findingsError, quarantined, findingsStale, inputsAbsent });
  } catch (e) {
    // Mirror the pipeline preflight's catch exactly: the stable code rides along so the post-publish
    // path can tell "the gate JUDGED this factual" from "the gate could not evaluate" — the latter
    // must keep the one honest "unknown" park instead of being terminal-on-sight.
    // — inputsAbsent rides this arm TOO. It is assembled before the gate is called and is a fact
    // about what publish read, not about what the gate decided, so dropping it on the one path where
    // the gate could not evaluate would lose the absence record exactly where the run is least
    // understood — an absence reading as nothing, inside the guard against absences reading as nothing.
    clientGate = { released: false, reasons: [`gate-evaluation-error: ${String(e.message).slice(0, 80)}`], reasonCodes: ["gate-evaluation-error"], inputsAbsent };
  }

  // ── audit-workbook inputs (all from artifacts already loaded above) ──────────────────────────────────
  // Record-fetch state per cited URI, for the Findings "Record retrieved?" column: a record we actually
  // pulled is `retrieved`; a URI named in a fetch-failure cause (senior-rights) or the record-coverage lint
  // detail is `failed` (its registry values ship visibly unverified); any other cited URI is `not-attempted`.
  const fetchState = {};
  for (const uri of recordsByUri.keys()) fetchState[String(uri).toLowerCase()] = 'retrieved';
  const failedUris = new Set();
  for (const row of (Array.isArray(seniorRights) ? seniorRights : [])) {
    if (row?.fetchFailureCause) for (const u of (String(row.fetchFailureCause).match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/ig) || [])) failedUris.add(u.toLowerCase());
  }
  const covLint = (reviewReceipts.lint || []).find(c => c.id === 'registry-record-coverage');
  if (covLint) for (const u of (String(covLint.detail).match(/uri=\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/ig) || [])) failedUris.add(u.replace(/^uri=/, '').toLowerCase());
  for (const u of failedUris) if (fetchState[u] !== 'retrieved') fetchState[u] = 'failed';
  for (const f of findings) for (const r of (f.owner?.registrations || [])) { const u = String(r.uri || '').toLowerCase(); if (u && !fetchState[u]) fetchState[u] = 'not-attempted'; }

  // The frozen product shape. Read HERE rather than at the meta.json write below, because the Summary's
  // jurisdiction line is composed before that point and must not claim a surface this run never touched.
  let searchPolicy = null;
  try { searchPolicy = runDir ? JSON.parse(readFileSync(driverDir(runDir, 'search-policy.json'), 'utf8')) : null; } catch { /* legacy run */ }
  // A run whose frozen policy predates the component reads as grid-ran — archived reports never change.
  // THE ENGINE'S PREDICATE, not a copy of it. This line used to re-implement isRegisterOnly by
  // hand without importing it, so the predicate whose own doc comment calls it "the ONE predicate every
  // consumer joins on" had a consumer it did not know about — and the whole xlsx branch below hung off
  // the copy. The register-only LEVEL is retired, so no new run reaches this true; a run that already
  // did still must, or its workbook would claim a sweep that never ran.
  const registerOnly = isRegisterOnly(searchPolicy);

  // Jurisdiction line for the Summary — searched register scope + the common-law surface layer.
  const regScope = (searchedJurisdictions && searchedJurisdictions.length) ? searchedJurisdictions.join('/') : 'Worldwide';
  const jurisdiction = registerOnly
    ? `${regScope} (register only — no common-law / marketplace search)`
    : `${regScope} (register) + common-law (Western web / marketplace / social)`;

  // Common-law URL-join: a grid hit whose candidate URL resolves to a finding's own link PROVES that search
  // term became a finding (rescues an anchor term whose finding wears a different name). Best-effort; absent
  // grid ⇒ the workbook falls back to the pure token-join. Never a guessed finding number.
  let commonLawJoinedTerms = null;
  try {
    const grid = JSON.parse(readFileSync(join(runDir ?? dirname(reportMd), 'common-law-grid.json'), 'utf8'));
    const links = new Set(findings.map(f => f.source?.resolved_link).filter(Boolean));
    commonLawJoinedTerms = new Set();
    for (const c of (grid.cells || [])) for (const cand of (c.candidates || [])) if (cand?.url && links.has(cand.url)) commonLawJoinedTerms.add(String(c.term).toUpperCase());
  } catch { /* no grid this run — token-join only */ }

  // The audit workbook is BEST-EFFORT: the try/catch is a last-resort guard for a genuine EXCEPTION (a real
  // bug), never a quality gate. buildAudit ALWAYS writes the .xlsx and returns any advisory gate findings in
  // `gateViolations` — those are LOGGED for observability but never a reason to drop the download. (An earlier
  // version made the gate fatal, so a legitimately-sparse run — e.g. no bound Class — silently lost its Excel.)
  // The run's REPORT IDENTITY, off the same registry row that chose its machinery. The FROZEN policy
  // sidecar names WHICH level ran; the registry names what that level is called TODAY (, one
  // numbering system — reportIdentityFor is registry-first, sidecar label only for a level the registry
  // no longer knows). So a republished pre-renumber run renders under the current scale, deliberately.
  // A run with no sidecar (every run older than the level registry) yields undefined and renders
  // byte-identically to before — which is the proof obligation for touching the frozen renderer at all.
  let stageLabel, depthNote, productName;
  try {
    const pol = JSON.parse(readFileSync(driverDir(runDir, 'search-policy.json'), 'utf8'));
    stageLabel = reportIdentityFor(pol).stageLabel ?? undefined;
    // — THE PRODUCT NAME THE DOCUMENT PRINTS. `.identity`, never `.banner`: banner leads with
    // `stageLabel`, which on a retired row is "Depth 4" and on a level the registry has forgotten is
    // whatever rung the sidecar last recorded. No depth number reaches a client surface.
    //
    // NOT re-derived from pipeline + scope here, and that is the whole ruling. `productFor` needs the
    // RESOLVED territories, and publish does not have them: the frozen sidecar carries level/pipeline/
    // components and no territory list, `register-plan.json`'s `scope_basis` is a conditional spread
    // that is absent (not false) on every archived run, and `searchedJurisdictions` is deliberately
    // EMPTIED on a worldwide sweep — so a count taken here reads 0 for the one scope that most needs
    // naming. resolveSearchPolicy already asked productFor the question at plan time, against the
    // territories as they actually resolved, and froze the answer as `level`. Asking again from worse
    // data would not be a second opinion, it would be a worse one.
    //
    // The NAME is still never stored: the sidecar holds the product ID, and the string comes off
    // today's registry row on every render — which is what lets a renamed product re-render honestly.
    productName = reportIdentityFor(pol).identity ?? undefined;
    // charter ruling 1 (2026-07-30) — the masthead names what this depth covers and what it omits,
    // from the run's OWN frozen components. No sidecar ⇒ undefined ⇒ no strip (archived byte-identity).
    depthNote = productCoverageNote(pol) ?? undefined;
  } catch { stageLabel = undefined; depthNote = undefined; productName = undefined; }

  // DERIVED BEFORE THE WORKBOOK, not after: buildAudit below reads productName, and this block used
  // to sit under it. A `let` read above its declaration is a temporal-dead-zone throw, and the one
  // test that exercises publishReport has no findings — so buildAudit was skipped and the suite went
  // green on a publish path that would have thrown on every run that actually has a workbook.
  let auditFile = null, counts = null, auditError = null;
  const auditParsed = (auditMd && existsSync(auditMd)) ? parseAudit(auditMd) : null;
  if (auditMd && existsSync(auditMd)) copyRO(auditMd, 'audit.md');   // durable source (kept even if the xlsx fails)
  if (findings.length || auditParsed) {
    try {
      auditFile = `${runId}-audit.xlsx`;
      // A10 — the failing predelivery checks ride into the workbook and are ENUMERATED on its Summary
      // sheet (with the cover note, the delivery surfaces that reach the reviewing lawyer). The
      // reviewReceipts assembly above claimed for two releases that these "land on the audit workbook's
      // Review-receipts sheet"; nothing ever threaded them through — the sink was a flag nobody read.
      // The workbook is handed the PROJECTED lines, never the checks: the audit download link rides in
      // the same cover note that reaches a client principal, so it is a delivery surface under exactly
      // the same rule (the workbook's own BANNED gate had already started firing on the raw detail —
      // advisory, so CI stayed green). reviewReceipts.lint keeps its raw detail for the internal
      // readers above (fetchState reads registry-record-coverage's URIs out of it).
      counts = await buildAudit({ findings, coverage, contextNotes, coverageJudgment, markAssessment, corrections: correctionsDoc, fetchState, verdict: verdictInfo, jurisdiction, commonLawJoinedTerms, registerOnly, clientGate, lintFailures: deliveryFlagLines(reviewReceipts.lint), productName }, auditParsed, join(poolRunDir, auditFile), fm.title, fm);
      grpRead(join(poolRunDir, auditFile), 0o640);
      if (counts?.gateViolations?.length) console.warn(`[audit-workbook] advisory: ${counts.gateViolations.join(' | ')}`);
    } catch (e) {
      auditFile = null; auditError = e.message;                 // a REAL exception only — report ships without the workbook
    }
  }


  // THE report. T4: the render receives no QC flags — the report a lawyer signs carries no
  // caveat banner (H1/H2); the receipts live on audit.xlsx. The machine QC above decides nothing
  // about this write.
  // homeHref — the floating "← All reports" pill returns to the listing (the staff index one level up).
  // The floating cross-page nav on the INTERNAL report too (jump to Archive/Status from a report).
  // '../' prefix — a report lives one level down at <pool>/<runId>/report.html; existence-gating stays poolRoot-
  // absolute. portal-report.mjs strips the nav at serve time (it lists every customer key).
  // anon:false — the demo-privacy toggle is a STAFF-INDEX feature (its __ANON__ config + overlay JS are
  // injected there only); on a report page the button rendered "Privacy ON" while doing nothing. Omit it
  // rather than wire the overlay in: client names saturate privileged report prose — a partial blur is a
  // worse demo than no toggle.
  const reportNav = siteNav(poolRoot, 'report', null, '../', { anon: false });
  // `demoData` is resolved above the report.md write — one answer, every surface.
  writeRO('report.html', renderHtml(parsed, findings, coverage, { demoData, productName, depthNote, scopeBasis, auditFile: auditFile || undefined, runId, delivery: deliv, recordsByUri, contextNotes, coverageJudgment: coverageJudgmentDisplay, markAssessment, fourAnswers, homeHref: '../index.html', nav: reportNav, chromeHref: '../assets/chrome.css', issued, asOf, verdictInfo, framework, searchedJurisdictions, caseLawByOrdinal, caseLawNotice, enforcerSignals, recordOrigin, recordOrigins: runOrigins, recordCitation: runProviderConf?.recordCitation ?? null, providerLabel, seniorRights, findingsSchemaVersion }));
  // ONE report (spec 2026-07-30 §5): report.client.html is no longer written. The knockout lane's own
  // collapse note is the precedent: "two renderings of one run is how the wrong link gets sent". The
  // client host serves the same report.html through the portal's readReport() (cleaning built in) — its
  // repoint deploys BEFORE this change merges (charter ruling 2a).
  //
  // P5 rebase note: this package was written against the pre-collapse tree, where the four-answers panel
  // had to be passed to BOTH renders. There is one render now, so `fourAnswers` rides the one call — the
  // panel reaches the client through the same cleaning path as every other reader-facing block.
  // Write-once publish timestamp: the index sorts same-day runs by it. A republish (same runId) keeps the
  // FIRST issue time so re-rendering an old run never bumps it to the top — the §2.9 'issued' display above
  // still restamps (that is the latest render time; this is the stable ordering key).
  let issuedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(readFileSync(join(poolRunDir, 'meta.json'), 'utf8'));
    if (prev?.issuedAt) issuedAt = String(prev.issuedAt);
  } catch { /* first publish */ }
  // Search-depth spine — the run's PRODUCT IDENTITY + attribution stamps, read from
  // the frozen _driver sidecars (never re-derived). Legacy runs simply lack them (regenIndex re-reads every
  // historical meta.json, so consumers null-guard: absent kind reads as 'clearance', the customerKey||
  // 'generic' discipline). tokens is the TOKENS-ONLY rollup (owner rule: no currency anywhere) — stamped at
  // publish so per-recipe usage is joinable later without touching run dirs.
  // (searchPolicy is read once, above the Summary's jurisdiction line, which needs it earlier.)
  // THE MARK AS TYPED, carried into the pool.
  //
  // `fm.title` is model-authored front matter, and it is not the mark. A real delivered run has
  // title = "AquaPlus — US Preliminary Trademark Clearance" while the name the user actually typed is
  // "AquaPlus". Anything downstream that treats title as the mark therefore (a) shows a headline where a
  // name belongs, and (b) cannot group two reads of one mark, because the headline varies per run while
  // the mark does not.
  //
  // The typed name has always existed in the run's own status.json — it simply never crossed into the
  // pool, and status.json does not travel with a pool dir. Copying it at publish is what makes "reads on
  // one name" possible for delivered runs at all. Legacy runs published before this get it on republish
  // (pool-admin doRepublish sources the same workspace), and until then consumers fall back to title.
  let markName = null;
  try { markName = runDir ? (JSON.parse(readFileSync(join(runDir, 'status.json'), 'utf8')).markName ?? null) : null; } catch { /* no status sidecar */ }
  // WHICH PROJECT THIS RAN UNDER, carried into the pool — the same move as markName above, and for the
  // same reason: the fact exists on the way IN and was lost on the way out.
  //
  // The composer has a project picker, portal-service stamps `projectKey` onto the job, and freezeProfile
  // records the key AND the resolved name in _driver/profile.json (spec 62). The sidecar does not travel
  // with a pool dir, so once a run was delivered nothing could say which matter it belonged to — not the
  // run list, not Clearances, not a report. "What was I working on" had no answer anywhere in the portal.
  //
  // Read from the frozen sidecar, never re-resolved: the sidecar is what actually rated the run, and a
  // project renamed or archived afterwards must not retitle history. Runs published before this stamp
  // carry neither field and consumers null-guard, exactly as they do for markName — a delivered run does
  // not gain a project retroactively, it gains one on republish or not at all.
  let project = null;
  try {
    const frozen = runDir ? JSON.parse(readFileSync(driverDir(runDir, 'profile.json'), 'utf8')) : null;
    if (frozen?.projectKey) project = { key: String(frozen.projectKey), name: String(frozen.projectName ?? frozen.projectKey) };
  } catch { /* no frozen profile — pre-WS-B run, or a republish with no workspace */ }
  let tokenRollup;
  try { tokenRollup = runDir ? rollupTokens(runDir) : undefined; } catch { tokenRollup = undefined; }
  // PR-9 — the clearance run as data (publish/report-data.mjs): the client-cut projection the assistant
  // drafts mail from and the portal's native-render path reads. BEST-EFFORT with a hard receipt rule:
  // meta.reportSchema is stamped ONLY when the file actually wrote — a run whose meta advertises a data
  // file that is not there would break the portal's presence branch. A producer throw never blocks the
  // report (the baked HTML above is already on disk).
  let reportSchema = null;
  try {
    const data = clearanceReportData({
      runId, codename, matter: fm.matter, markName, title: fm.title, customerKey: customerKey || 'generic',
      issued, url: poolUrl ? `${String(poolUrl).replace(/\/$/, '')}/${runId}/report.html` : null,
      // stageLabel REGISTRY-FIRST ( residual, audit item 4): `stageLabel` is reportIdentityFor's
      // read-time derivation — the same label report.html renders — so a republished pre-renumber run
      // cannot mint report.html "Depth 2" beside report-data.json "Stage 0.5". The frozen sidecar label
      // is the LAST resort (a level today's registry no longer knows). meta.json below keeps the frozen
      // stamp BY DESIGN — its readers re-derive.
      auditFile, searchLevel: searchPolicy?.level ?? null, stageLabel: stageLabel ?? searchPolicy?.stageLabel ?? null,
      engineCommit: engineCommit(),
      framework, verdictInfo, findings, coverage, contextNotes, markAssessment, fourAnswers, askAnswers,
      actions: actionsRegister, jurisdiction, searchedJurisdictions, scopeBasis, caption: fm.overall_caption ?? null,
    });
    writeRO('report-data.json', JSON.stringify(data, null, 2));
    reportSchema = 'report-data/1';
  } catch (e) {
    console.warn(`[report-data] producer failed (report ships without the data file): ${String(e?.message ?? e).slice(0, 140)}`);
  }
  writeRO('meta.json', JSON.stringify({
    runId, codename: codename || '', matter: fm.matter, title: fm.title, client: fm.client,
    // The mark as typed — see above. Distinct from `title`, which is the report's own headline.
    markName: markName ?? undefined,
    // The project (engagement) this run was rated under, and what it is called. `undefined` on a run
    // with no project, so a no-project meta stays byte-identical to a pre-stamp one.
    projectKey: project?.key ?? undefined,
    projectName: project?.name ?? undefined,
    customerKey: customerKey || 'generic',
    issuedAt,
    // WHICH BUILD produced this. null off a git checkout — a provenance stamp never fails a publish.
    engineCommit: engineCommit(),
    kind: 'clearance',
    searchLevel: searchPolicy?.level ?? undefined,
    // Display-only face of the level ("Depth 4"), frozen alongside it so the list can show which reads
    // have run on a name without the browser having to know the level registry.
    stageLabel: searchPolicy?.stageLabel ?? undefined,
    recipe: searchPolicy?.recipe ?? undefined,
    enqueuedVia: searchPolicy?.enqueuedVia ?? undefined,
    enqueuedBy: searchPolicy?.enqueuedBy ?? undefined,
    parentRunId: searchPolicy?.parentRunId ?? undefined,
    tokens: (() => { const t = tokenRollup?.total; return t && (t.input || t.output || t.cacheRead || t.cacheWrite) ? t : undefined; })(),
    // delivery.template: the named deliverable-template variant this run used. Default "standard"
    // (today's render). Recorded here so the choice is observable + a live consumer of the profile field
    // (not a dead knob); the registry currently holds one variant, ready to grow when a 2nd format ships.
    template: deliv?.template ?? 'standard',
    // T2 (H5): the derived display verdict is THE authority when the sidecar exists; the
    // model-authored fm fields are the pre-A2 legacy fallback only.
    overall: verdictInfo?.tier ?? fm.overall_label, badge: verdictInfo?.badge ?? fm.overall_badge, run: fm.run, date: dateOf(fm.run), auditFile,
    // spec 64 — THE one risk statement (band + stance in one sentence, composed once by the sidecar
    // writer). Absent on legacy runs — regenIndex re-reads every historical meta.json, so consumers
    // null-guard and old rows render byte-identically.
    statement: verdictInfo?.statement ?? undefined,
    verdict: verdictInfo?.verdict ?? undefined,
    // doc 50 — which framework rated this run (custom vs Generic default) + its ladder, for the archive
    // card, the email table sort/colour and the per-customer index; absent on archived runs forever.
    framework: framework ? { key: framework.framework_key, title: framework.title,
      custom: framework.framework_key !== 'house-default',
      bands: framework.bands.map((b) => ({ label: b.label, tone: b.tone })) } : undefined,
    // Machine-QC record (historical stamp name kept so old and new metas read uniformly). Observability
    // only — the staff index's ⚠ QC pill reads it; NOTHING gates who may read on it any more.
    // — `inputsAbsent` names WHICH declared stores were not there. `undefined` (so JSON drops the
    // key) when every store was found, which keeps a complete run's meta byte-identical to a pre-
    // one — the same absent-key discipline markName/projectKey use, and what lets an archived run be
    // re-rendered without its meta changing shape. When it IS present it is the durable record that
    // this report was assembled without those stores, which the run previously kept nowhere at all.
    clientGate: { released: clientGate.released, reasons: clientGate.reasons,
      inputsAbsent: clientGate.inputsAbsent?.length ? clientGate.inputsAbsent : undefined },
    // PR-9 — present ⇒ report-data.json is beside the report and the portal can render natively (the
    // same stamp the knockout lane writes; the consumer branch had readers before it had a writer).
    // undefined on a producer miss, so the meta never advertises a file that is not there.
    reportSchema: reportSchema ?? undefined,
  }, null, 2));

  const total = skipRegen ? null : regenIndex(poolRoot);
  if (!skipRegen) await regenSurfaces(poolRoot);
  const url = poolUrl ? `${String(poolUrl).replace(/\/$/, '')}/${runId}/report.html` : null;
  return { runId, auditFile, counts, total, url, poolRunDir, auditError, findingsError, customerKey: customerKey || 'generic', clientGate };
}

// Compose the notification email body — MARKDOWN (the mail tool renders markdown→HTML; raw HTML gets escaped).
// Pulls the curated report's # Summary verbatim + the access-controlled link. Deterministic; notify only sends it.
// `auditFile` (optional) is the xlsx filename in the same run dir → rendered as a second download link.
const BADGE_EMOJI = { l4: '🔴', l3: '🟠', mh: '🟠', l2: '🟢', l1: '⚪' };

// The access note names the identity domain the pool's Cloudflare Access app admits. It is deployment
// config, NOT a literal: this string was hardcoded, so the 2026-07-17 repo split rewrote it to a
// example.com domain and both 2026-07-19 deliveries told the reader to sign in with an account that
// does not exist. Unset ⇒ NO note: silence beats confidently wrong sign-in instructions.
export function accessNoteMd(domain = config.accessDomain) {
  return domain ? `*Access-controlled — sign in with a **${domain}** account. Reply to this email with any questions.*` : '';
}
export function accessNoteHtml(font, domain = config.accessDomain) {
  return domain
    ? `<p style="${font};font-size:9.5pt;color:#7a8290;margin:14px 0 0"><i>Access-controlled — sign in with a <b>${domain}</b> account. Reply to this email with any questions.</i></p>`
    : '';
}

/**
 * The "Download audit (Excel)" link, as a URL that actually resolves.
 *
 * It used to be built by swapping the filename on the report URL — `<pool>/<runId>/<runId>-audit.xlsx`,
 * "next to report.html in the same pool run dir", which was true of the ARCHIVE DIRECTORY and has never
 * been true of the SERVED SITE. At the 2026-07-20 portal cutover the edge stopped serving that archive
 * as files and kept exactly one legacy path alive:
 *
 *     path_regexp ^/([A-Za-z0-9][A-Za-z0-9._-]{0,180})/report\.html$   →  /portal/report/<runId>
 *
 * `report.html` and nothing else. The workbook URL matched no handler, fell into the host's catch-all
 * `respond "Not found" 404`, and every audit link we have ever emailed died at the front door — silently,
 * because a 404 on a link nobody reports is indistinguishable from a link nobody clicked.
 *
 * So address the workbook where the portal actually serves it. That route resolves the filename from the
 * run's own meta.json (the URL contributes only the run id, which is validated as a single path segment),
 * checks ownership, and answers 404 for a run the caller does not own — the same door the report goes
 * through. The literal `audit.xlsx` here is the ROUTE, not the file: the response still carries the run's
 * real `<runId>-audit.xlsx` as its download filename.
 *
 * Derived from the report URL rather than from config so the two links can never point at different
 * deployments. Anything that is not a recognisable report URL yields null — an absent link beats a
 * confidently wrong one, the same posture as accessNoteMd's unset domain.
 *
 * The path is matched against the PARSED pathname, not against the whole URL string. A pattern applied to
 * the raw string can satisfy its own `/<segment>/` by eating a slash out of `https://` — "https://x/report.html"
 * parsed that way yields the run id "x" and a link to a host that does not exist. The pathname pattern is
 * the edge's own legacy-report regexp character for character, so this function admits exactly the URLs the
 * deployment admits and no others.
 */
const REPORT_PATH_RE = /^\/([A-Za-z0-9][A-Za-z0-9._-]{0,180})\/report\.html$/;

// The run id as the edge and the portal both spell it: one path segment, no separators, no traversal.
// Same character class as REPORT_PATH_RE's capture and as portal-service's own slug gate, because a
// composer that admits more than the route does builds links the route refuses.
const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;

/**
 * THE WORKBOOK'S ROUTE, from an origin and a run id.
 *
 * Split out of auditUrlFor because the knockout batch has no report URL to derive from — a batch
 * publishes no run-level document, so `url` is null by design and a derivation keyed on the
 * report link yields null for exactly the runs that still have a workbook. The rule is the same one
 * the long comment above argues for; only the input differs.
 */
export function auditRouteFor(origin, runId) {
  if (!origin || !runId || !RUN_SEGMENT_RE.test(String(runId))) return null;
  return `${String(origin).replace(/\/$/, '')}/portal/report/${runId}/audit.xlsx`;
}

/**
 * ONE MARK'S DOCUMENT in a batch, at the address the portal serves it from.
 *
 * `/portal/report/<runId>/<slug>/` — portal-service.mjs resolves the slug against the run's own
 * `meta.reports` and never builds a path from it, so a slug that names nothing simply 404s.
 *
 * THIS EXISTS BECAUSE A FILENAME IS NOT AN ADDRESS. The batch's documents are `report-<slug>.html` in
 * the pool directory, and the pool directory stopped being the served site at the 2026-07-20 cutover.
 * The legacy rewrite claims one filename, `report.html`, and nothing else — so a link naming the file
 * is well-formed, obviously right, and reaches no handler at all.
 *
 * THE SLUG IS NOT PERCENT-ENCODED, AND THAT IS THE CAREFUL CHOICE. The portal matches the raw segment
 * off `path.split("/")` and never decodes it, so an encoded slug would not match the run's own list —
 * the same shape of defect as the one above, one level down, and just as silent. `kebab()` emits
 * `[a-z0-9-]` and nothing else, so today there is nothing to encode; this refuses rather than encodes
 * if that ever stops being true. An absent link beats a confidently wrong one, exactly as auditUrlFor
 * argues for an unrecognisable report URL.
 */
const SLUG_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

export function markReportRouteFor(origin, runId, slug) {
  if (!origin || !runId || !slug || !RUN_SEGMENT_RE.test(String(runId))) return null;
  if (!SLUG_SEGMENT_RE.test(String(slug))) return null;
  return `${String(origin).replace(/\/$/, '')}/portal/report/${runId}/${slug}/`;
}

export function auditUrlFor(reportUrl, auditFile) {
  if (!auditFile || !reportUrl) return null;
  let u;
  try { u = new URL(String(reportUrl)); } catch { return null; }
  const m = REPORT_PATH_RE.exec(u.pathname);
  return m ? auditRouteFor(u.origin, m[1]) : null;
}

/**
 * THE DELIVERY EMAIL'S SUBJECT LINE. One definition, because it is written twice.
 *
 * pipeline.mjs composes the outbox packet's `subject`, and stages.mjs INSTRUCTS the notify agent with a
 * subject in the same breath ("Subject: ..."). Both spelled `Preliminary clearance — <mark>` by hand, so
 * the product name on the most-forwarded surface we have was a literal in two files that nothing joined.
 * A client who bought a Full country search was mailed a subject naming a product that no longer exists.
 *
 * Null name ⇒ the mark alone. A run whose product cannot be resolved gets a subject that says less, never
 * one that names the wrong search — the same rule the report's masthead follows.
 */
export function deliverySubject(productName, job = {}) {
  const mark = job.markName ?? job.name ?? job.ref ?? 'matter';
  return [productName || null, mark].filter(Boolean).join(' — ');
}

export function composeEmailBody(reportMdPath, url, auditFile, productName = null) {
  const { fm, secs } = parseReport(reportMdPath);
  const summary = (secs['Summary'] || '').trim();
  const dot = BADGE_EMOJI[fm.overall_badge] || '•';
  const auditUrl = auditUrlFor(url, auditFile);

  // A scannable meta line — only the fields that are present.
  const meta = [
    fm.client && `**Client:** ${fm.client}`,
    fm.classes && `**Classes:** ${fm.classes}`,
    fm.run && `**Basis:** ${fm.run}`,
  ].filter(Boolean).join('  ·  ');

  const links = [
    url && `[**▶ Open the full report**](${url})`,
    auditUrl && `[Download audit (Excel)](${auditUrl})`,
  ].filter(Boolean).join('  ·  ');

  return [
    `### ${[productName, fm.title || ''].filter(Boolean).join(' — ')} (${fm.matter || ''})`,
    // Lint flags are NOT rendered on the chat/email surfaces (2026-06-12): document-QA notes read as
    // machinery to the lawyer and the report carries them regardless. The email keeps the at-a-glance
    // "searches did not finish" signal but as a FIXED plain sentence — the detailed open-floor list is
    // internal-axis codenames (`<axis> / <scope>`, e.g. "primary-sweep / NOVA root"), so it stays on the
    // internal lane only (report front-matter / status.json / run log).
    //
    // — THE SECOND HALF OF THIS SENTENCE POINTED AT NOTHING, AND THE COMMENT ABOVE IT VOUCHED FOR
    // THE THING THAT DOES NOT EXIST. It read "— each is listed under Coverage in the report", and there
    // is no Coverage section: `renderHtml` carries no reference to `envelope_note` at all, the
    // front-matter renderer emits known keys only, and "Coverage" reaches the client document twice, both
    // times as model prose about something else. A reader was told some searches remained open, told
    // where to see which ones, and found neither the section nor the list. The old comment asserted that
    // section "already renders every open floor in plain language" — it was never built, and the pointer
    // had been promising it since.
    //
    // OWNER RULING 2026-08-19 (relayed): drop the claim; no Coverage section is being designed. So the
    // sentence states the fact and stops. It is deliberately not replaced with a different pointer — the
    // failure mode here was a pointer written before its target, and one true sentence beats two where
    // the second is a promise. When a surface exists that renders open floors in client language, this is
    // where the pointer to it belongs.
    fm.envelope_note ? `**Search scope:** Some scoped searches remained open at delivery.` : '',
    fm.overall_label
      ? `${dot} **Overall risk: ${fm.overall_label}**${fm.overall_caption ? `\n\n${fm.overall_caption}` : ''}`
      : '',
    meta || '',
    links || '',
    '---',
    summary,
    '---',
    accessNoteMd(),
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------------------------------
// composeEmailHtml — the reply the reviewer gets back: (1) a short INTERNAL review headline, (2) the
// pre-populated CLIENT-FACING review table (re-voiced by the cheap `client-summary` stage), (3) the report
// link. Returns ONE HTML fragment that BEGINS WITH A TAG, so the mail tool (clawdi-graph markdownToHtml)
// passes it through unchanged — a markdown/HTML mix would be escaped. Falls back to the markdown body
// (composeEmailBody) when the client summary is missing/short, so a failed cheap step never blocks delivery.
// ---------------------------------------------------------------------------------------------------
const FONT = "font-family:Calibri,'Segoe UI',Arial,sans-serif";

// 5-tier reporting-template risk scheme — the whole left "NAME / RISK RATING" cell takes the bg colour.
// Matches skills/prelim-search/templates/search-request-form.html + knockout-searches/template-formatting.md.
// `txt` = a readable text-colour version of the tier (for the EXECUTIVE SUMMARY risk phrase, where a bright
// fill like yellow/red is unreadable as text). Order matters: VERY HIGH before HIGH.
export const RISK_TIERS = [
  [/VERY[\s-]?HIGH/, { bg: '#ff0000', fg: '#fff', label: 'VERY HIGH',  txt: '#d10000' }],
  [/HIGH/,           { bg: '#ED7D31', fg: '#fff', label: 'HIGH',       txt: '#c75b13' }],
  [/MEDIUM/,         { bg: '#ffff00', fg: '#000', label: 'MEDIUM',     txt: '#9a8400' }],
  [/MANAGEABLE/,     { bg: '#70AD47', fg: '#fff', label: 'MANAGEABLE', txt: '#4e7a31' }],
  [/LOW/,            { bg: '#4472C4', fg: '#fff', label: 'LOW',        txt: '#2f55a4' }],
];
// doc 50 — the run's band LADDER (from opts.bands / meta.framework.bands): per-run vocabulary with the
// same template palette keyed by TONE, so "Moderate" (house) and "Medium" (zephyr) both colour correctly
// and a 5-band matrix framework (incl. "Low") lands on the same ramp. Set per compose; null = legacy.
let EMAIL_BANDS = null;
export const TONE_TIER = {
  severe:  { bg: '#ff0000', fg: '#fff', txt: '#d10000' },
  high:    { bg: '#ED7D31', fg: '#fff', txt: '#c75b13' },
  medium:  { bg: '#ffff00', fg: '#000', txt: '#9a8400' },
  low:     { bg: '#70AD47', fg: '#fff', txt: '#4e7a31' },
  minimal: { bg: '#4472C4', fg: '#fff', txt: '#2f55a4' },
};
export function riskTier(word) {
  const u = String(word || '').toUpperCase();
  if (EMAIL_BANDS) {
    const b = EMAIL_BANDS.find((x) => String(x.label).toUpperCase() === u);
    if (b) return { ...(TONE_TIER[b.tone] ?? TONE_TIER.medium), label: u };
  }
  if (/NO RATED CONFLICTS/.test(u)) return { bg: '#4472C4', fg: '#fff', label: u, txt: '#2f55a4' };
  for (const [re, t] of RISK_TIERS) if (re.test(u)) return t;
  return { bg: '#bfbfbf', fg: '#000', label: u || '—', txt: '#555' };
}
// minimal inline markdown -> HTML for a table cell (escape FIRST; drop any stray internal ::p:: defensively)
function cell(s) {
  let t = esc(String(s ?? '').replace(/::p::[\s\S]*$/i, '').trim());
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');         // links -> plain text in the client table
  return t;
}

// a short markdown block (the "Reviewer's open questions" list) -> simple paragraphs
// T6 (H7): routed through the stripInternal choke point — no raw::p:: on the email.
function mdBlock(block) {
  return stripInternal(String(block), { client: false }).trim().split('\n').filter(Boolean)
    .map((ln, i) => `<p style="margin:${i ? '0 0 2px' : '0 0 4px'};${i ? 'padding-left:10px' : ''}">${cell(ln)}</p>`)
    .join('');
}

// wp50: coverActions (the # Actions two-bucket list on the email cover) is DELETED — the Actions
// list renders on the report itself (publish/render.mjs actionsPanel); the cover is a cover note.

// wp50 — the neutral prose client body (clientSummaryProse) is DELETED: the Generic default for every
// customer is a short COVER NOTE (headline tier + link + surviving flags) with the HTML report as the
// single master document. A second full findings surface in the email was the re-authoring seam that
// let per-conflict tiers diverge from the report.
//
// 2026-07-28 — and the last exception went with it. `delivery.email:'table'` inlined a whole second
// review table under the cover note for one customer; it is deleted, along with the per-customer knob
// that asked for it. Bespoke client-facing mail is drafted by the assistant from the run's
// report-data.json (formatting is judgement and it belongs where judgement lives) — not by a profile
// enum that quietly re-authors the findings in a dialect no lint reads.
// 2026-08-01 — `clientSummaryPath` is GONE from the signature. It had already stopped being READ here
// (wp50 deleted the client body; the headline tier comes from the verdict sidecar via opts.statement /
// opts.tier, else the report front-matter, and the conditions from the report's own `# Actions`), and
// the note that used to stand here claiming the parameter was "retained because client-summary.md is
// still a first-class artifact" outlived its own truth: the stage is retired and nothing writes the file.
export function composeEmailHtml(reportMdPath, url, auditFile, names = [], delivery = NEUTRAL_DELIVERY, opts = {}) {
  EMAIL_BANDS = Array.isArray(opts?.bands) && opts.bands.length ? opts.bands : null;   // doc 50 — per-run vocabulary
  const { fm, secs } = parseReport(reportMdPath);
  const auditUrl = auditUrlFor(url, auditFile);

  // 1) internal review headline — short: the bottom line + any "Reviewer's open questions" already in # Summary.
  // Heading-neutral match: accept the new "Reviewer's open questions" and the legacy "Open questions for the reviewer".
  const oq = (secs['Summary'] || '').match(/\*\*(?:Reviewer's open questions|Open questions for the reviewer)[\s\S]*?(?=\n\n[^*\d])/i);
  // The report link rides HIGH — right under the bottom line in the headline, not buried below the table.
  const reportLink = url
    ? `<p style="margin:0 0 10px"><a href="${esc(url)}" style="color:#1a4fd6;font-weight:bold;font-size:12pt;text-decoration:none">▶ Open the full report</a>`
      + (auditUrl ? ` &nbsp;·&nbsp; <a href="${esc(auditUrl)}" style="color:#3b4fd6;text-decoration:none">Download audit (Excel)</a>` : '')
      + `</p>`
    : '';
  // The search-scope signal leads the email. The 2026-06-12 "lint flags do not render on the email" rule
  // was NARROWED by A10 (2026-07-30) to let the sink's surviving failures reach this cover note as an
  // enumerated machine-check block, on the argument that a defect only a sink recorded was a flag nobody
  // read (VENZY). RESTORES THE ORIGINAL RULE AND STATES ITS REASON: VENZY's problem was that no
  // REVIEWER saw the flag, and the workbook and the run record answer that. The client is not the
  // reviewer, and a failing internal check is not something the client can act on. See the block below.
  // The scope line is a FIXED plain sentence, not the raw envelope_note: that note is the
  // open-floor list in internal-axis codenames, which stays on the internal lane (report front-matter /
  // status.json / run log). The reader gets the at-a-glance "searches did not finish" cue and nothing
  // more —, and see the markdown path above for why the "listed under Coverage in the report"
  // half of this sentence was removed rather than re-aimed. THE TWO PATHS MUST SAY THE SAME THING: they
  // are one message in two renderings, and a client reading the HTML must not be told something the
  // markdown does not say.
  const flagBanner =
    (fm.envelope_note ? `<p style="margin:0 0 6px"><b>Search scope:</b> Some scoped searches remained open at delivery.</p>` : '');

  // ONE report (spec 2026-07-30 §6): the "Not client-ready — for your review only" block is deleted with
  // the two-bit delivery it narrated. The cover note is a cover note — verdict, one-line summary, link —
  // plus, since A10 (below), the surviving machine-check failures in the projection's own words. The
  // "machine-QC lives on the workbook, never the email" rule that used to stand here was written when a
  // second block carried them; it is superseded, not merely bent, and both delivery surfaces now
  // enumerate the SAME projected lines.

  // A10 (addendum 2026-07-30, two-bit gate doctrine) — predelivery machine-check failures reach the
  // reviewing lawyer WITH the report: enumerated HERE, on the cover note, never only a sink flag
  // nobody reads. The 2026-06-12 "lint flags do not render on the email" rule had one carve-out, the
  // closed-gate "not client-ready" block — and ONE report (§6, above) deleted that block with the
  // two-bit delivery it narrated. So every recorded failure, gate-closing or not, lived only in
  // _driver/predelivery-lint.json — on VENZY the lawyer reviewed a report whose recorded defects no
  // delivery surface ever showed. This block is now the SINGLE enumeration surface (the merge-train
  // state the P4 PR was written for): unconditional, one enumeration, never two. The gate stays a
  // gate: it WARNS beside the report link and never suppresses or delays the artifact.
  //
  // 2026-07-31 — the lines are deliveryFlagLines(), NOT flagLines(). This mail goes to
  // job.forwarderEmail, and on a client-principal run that address IS the client (portal-service
  // stamps clientPrincipal; pipeline's FAILURE mail sanitizes for that exact recipient, and
  // docs/DELIVERY.md tells the courier to send this body verbatim). The checks' own `detail` is
  // engine-side diagnosis — fetch causes, register URIs, field names, "(FIX)" instructions to
  // whoever regenerates the run — and shipping it here was the same mistake the scope line above
  // avoids by refusing to quote envelope_note. A10 wants the DEFECTS in front of the lawyer, not the
  // engine's notes about them. Best-effort read: an absent sink (legacy callers/tests) means no
  // block, byte-identical mail.
  // ── — A FAILING MACHINE CHECK IS NOT A CLIENT NOTE, AND THE CHECK ITSELF SAID SO ──────────────
  // This block shipped, in an amber box above the verdict, on a delivered production clearance:
  //
  //     Machine checks flagged 1 item for your review…
  //     • The action list names parties that no finding in the report identifies. (2 occurrences)
  //
  // The failing check's own detail, in `_driver/predelivery-lint.json`, reads: "Card the on-point
  // one(s) (FIX) or remove them; DO NOT SHIP A 'VERIFY WHO THIS IS' NOTE TO THE READER." The engine
  // wrote that instruction and then did the opposite at the seam below it.
  //
  // It is at a seam nobody swept. "Add caveat" was banned in the corrective pass; delivery was
  // never brought under the same rule. A failing internal check is NOT a coverage gap: it does not
  // change what was searched, and the reader cannot act on it. Under the owner's standing rule —
  // operational failures do not bleed into a client report — the block does not belong on any surface
  // a client sees.
  //
  // NOTHING IS LOST. `deliveryFlagLines` still runs, and its projection still reaches the audit
  // workbook's Machine Checks sheet and `_driver/predelivery-lint.json`. The reviewing lawyer and the
  // run record keep every line; the client's mail carries none of them.

  // A2 — the delivered verdict bound is a CODE-built row (from _driver/verdict.json passed by
  // the driver), so the client-facing surface can never read as an unconditional "proceed" over a
  // CONDITIONAL bound. Absent opts (legacy callers/tests) ⇒ no row, byte-identical behaviour.
  // doc-52 — the cover banner speaks the SAME plain "Only you can close these" wording as the report, never
  // the engine clamp reasons (opts.conditions = verdict.json reasons). Machinery-only clamps (no client
  // item authored) degrade to one generic plain line — never raw engine jargon, never truncated mid-sentence.
  const emailConditions = opts?.verdict === 'CONDITIONAL' ? actYouConditions(parseActionBuckets(secs['Actions']).you) : [];
  const verdictBound = (opts?.verdict && opts.verdict !== 'CLEAR')
    ? `<p style="margin:0 0 8px;padding:8px 10px;background:#fdeeee;border:1px solid #c98a86;color:#6e1512"><b>Delivered as ${esc(opts.verdict)}${opts.verdict === 'CONDITIONAL' ? ' — subject to:' : '.'}</b>${opts.verdict === 'CONDITIONAL' ? `<br>${(emailConditions.length ? emailConditions : ['the open items set out in the report, before relying on a clean result']).map((r) => `• ${cell(String(r))}`).join('<br>')}` : ''}</p>`
    : '';

  const reviewHeadline = `<div style="${FONT};font-size:11pt;color:#1a1a2e;margin:0 0 14px">`
    + flagBanner
    + verdictBound
    + `<p style="margin:0 0 8px"><b>${[opts?.productName ? esc(String(opts.productName)) : '', esc(fm.title || '')].filter(Boolean).join(' — ')} (${esc(fm.matter || '')})</b></p>`
    // T2 (H5): the derived tier (verdict sidecar, passed by the driver) outranks the
    // model-authored fm label — one authority on every surface.
    // spec 64: with a composed statement the headline reads band + stance as ONE sentence ("High —
    // conditional on: …"); legacy (no statement) keeps the labelled tier line byte-identically.
    + (opts?.statement
      ? `<p style="margin:0 0 6px"><b>${esc(opts.statement)}</b> ${cell(fm.overall_caption || '')}</p>`
      : ((opts?.tier ?? fm.overall_label) ? `<p style="margin:0 0 6px"><b>Overall risk: ${esc(opts?.tier ?? fm.overall_label)}.</b> ${cell(fm.overall_caption || '')}</p>` : ''))
    + reportLink
    + (fm.handling_note ? `<p style="margin:0 0 8px;color:#7a2b12"><b>Handling note:</b> ${cell(fm.handling_note)}</p>` : '')
    // T9 (K3): methodology identity — which profile/framework rated this run (+ verifiable sha).
    + (fm.rated_under ? `<p style="margin:0 0 6px;font-size:9.5pt;color:#7a8290">Rated under: ${cell(fm.rated_under)}</p>` : '')
    // compute-don't-author (PR-4, review issue 2): the per-class register-coverage truth is computed
    // by the driver (scope-facts.mjs) and stamped as `coverage_line:` front-matter — but the frozen
    // report renderer only renders known keys, so without THIS line the join never reached a surface
    // the lawyer reads. The cover note is that surface (driver-written fm, same lane as rated_under):
    // "Class 30: 76 of 99 slices fully searched — the remaining 23 are non-Latin script forms" (the
    // spec-B4 proportion form) rides beside the report link. Facts about what ran, never a caveat;
    // absent on legacy runs ⇒ byte-identical mail.
    + (fm.coverage_line ? `<p style="margin:0 0 6px;font-size:9.5pt;color:#7a8290">Register coverage — ${cell(fm.coverage_line)}</p>` : '')
    // The WS1c "Model failover:" line stood here and is DELETED: no code path writes `failover_note`
    // into front-matter any more, because the model-failover chain that would have produced one never had a
    // second rung on any shipped build. Nothing renders a failover note into a report.
    // B5b checkpoint 4 — a customer named after the analysis was written ships as a delivery note, never silently.
    + (fm.late_bind_note ? `<p style="margin:0 0 8px;color:#7a2b12"><b>Applicant named mid-run:</b> ${cell(fm.late_bind_note)}</p>` : '')
    + (oq ? `<div style="margin:0 0 8px">${mdBlock(oq[0])}</div>` : '')
    // wp50: the two-bucket # Actions list no longer rides the email — it renders on the report itself
    // (the single master document); the cover keeps only the headline, link, and surviving flags.
    + `</div>`;

  // 2) access note (the report link lives up in the headline, not buried here)
  //
  // There is no client body. The per-customer review-TABLE overlay (delivery.email === 'table') is
  // GONE: a second full findings surface in the email was the seam that let
  // per-conflict tiers diverge from the report, and it re-authored in a dialect nobody was checking. The
  // report is the single client surface and this mail is a cover note pointing at it. A lawyer who wants
  // a bespoke, forwardable client mail asks the assistant to draft one from the run's report-data.json —
  // formatting is judgement, and it belongs where judgement lives, not in a profile enum.
  const footerNote = accessNoteHtml(FONT);

  return `<div style="${FONT}">${reviewHeadline}${footerNote}</div>`;
}
