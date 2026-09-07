// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Shared stage-fixture logic for the offline mocks — extracted VERBATIM from the retired gateway mock so
// EVERY engine mock writes byte-identical stage artifacts. This
// makes the $0 mock pipeline ENGINE-PARAMETRIC: the same fixtures drove the retired gateway-bin mock and
// drive =anthropic-agent today. The only difference between the mocks is the stdout envelope (a gateway --json envelope vs
// claude stream-json); the FILE WRITES are this module. Env knobs are read from process.env (same in both).
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { parseCoverageLedgerFull } from "../coverage-ledger.mjs";
// The PRODUCTION parser for the tool-written meaning receipts — the mock's disposition rows are built from
// the ledger on disk through the same code the validator's join reads it with (see the prSection block).
import { parsePrRiskResults, connotationObligations, obligationRows, CONNOTATION_FORM_TOKEN_SRC } from "../connotation-search.mjs";
// B — the mock seat records rulings through the PRODUCTION tool core (recordDispositions), exactly as a
// real seat's `record_dispositions` call reaches it through perplexity-server.mjs. Using the production
// receiver is the point: it writes the accumulator, the captured payload and the call index the audit
// reads, so the fixture cannot certify a shape the shipped receiver would refuse. The started/settled
// pair stdio-server would write for the call is written here too (recordMockToolCall) — FIXTURE
// TRUTHFULNESS, not a workaround: a real run's _driver/tool-calls.jsonl carries a pair per tool call,
// and the audit's readable/blind distinction stands on that file existing.
import { recordDispositions } from "../disposition-tool.mjs";
// — the mock seat FILLS IN the driver-written coverage form, and the driver renders the
// `## Coverage ledger` table from it. The form is read from DISK (the file runDigest wrote before this
// dispatch), exactly as a compliant seat opens it — deriving it from the message would let the mock
// agree with the validator without ever having read the artifact.
// Typed transport — the mock seat records coverage through the SHIPPED tool core, like the disposition
// mock above it records rulings through recordDispositions. Called, not copied: a mock with its own
// serialization would go green on a transport the product does not have.
import { recordCoverage, MAX_ROWS_PER_CALL } from "../coverage-tool.mjs";
// — blind-frame's model reaches disk ONLY through the production receiver now, so the mock seat calls
// it rather than writing the file. Same rule as recordDispositions above: called, not copied, so the call
// capture, the rendered artifact and the tool-call pair all exist exactly as a real compliant turn leaves
// them — and the suite exercises the transport e2e measured as never having executed.
import { recordBlindFrame } from "../blind-frame-record.mjs";
import { recordKnockoutAssess } from "../knockout-assess-record.mjs";
import { recordKnockoutFrame } from "../knockout-frame-record.mjs";
import { recordSkeptic } from "../skeptic-record.mjs";   //, same rule: called, not copied
import { recordSynthesis } from "../synthesis-record.mjs";
import { recordFrameDiff } from "../frame-diff-record.mjs";   //, third conversion — same rule again
import { recordMatterFrame } from "../matter-frame-record.mjs";   // conversion 2 — same rule again
import { recordPrelimVariants } from "../prelim-variants-record.mjs";   // conversion 3 — same rule again
import { recordReportOverview } from "../report-overview-record.mjs";  // conversion 4 — the client-read shell
import { recordReportCard } from "../report-card-record.mjs";          // conversion 5 — the fan-out transport
import { recordUnitNote } from "../register-unit-record.mjs";           // the unit note — own-key transport, called not copied
import { recordRegisterDigest, readDigestFacts, joinKey } from "../register-digest-record.mjs";   // conversion 11 — the findings document, called not copied
import { recordDeclinations } from "../declination-tool.mjs";   // — the mock declines through the REAL transport
import { findingUris } from "../record-carry.mjs";
import { normalizeRecordUri } from "../registry-fidelity.mjs";
import { recordClosures } from "../doubt-closure-tool.mjs";           // conversion 6 — the closure transport
import { recordRefutation } from "../narrative-refutation-record.mjs"; // conversion 9 — the reviewer transport
import { parseManifestVariants } from "../common-law-receipts.mjs";   // the terms the receipts gate joins on
// ALIASED, NOT RE-USED. `coverage-tool.mjs` exports a MAX_ROWS_PER_CALL too and this file already imports
// it; the two are separate constants owned by separate tools, equal at 25 today. Chunking the disposition
// call against the COVERAGE cap would read as correct for exactly as long as they happen to agree.
import { MAX_ROWS_PER_CALL as MAX_DISPOSITION_ROWS_PER_CALL } from "../disposition-call.mjs";
import { toolWrittenArtifact } from "../gateway.mjs";   // the one lookup for artifacts a seat must not write
import { coverageFormStamp, coverageFormPaths, readCoverageForm } from "../coverage-form-io.mjs";
import { FINDINGS_SCHEMA_VERSION } from "../findings-model.mjs";
import { kebab } from "../search-policy.mjs";   // — the mock cites what the mark's payload holds

const PAD = (s, n = 260) => (s.length >= n ? s : s + "\n" + "lorem ipsum ".repeat(Math.ceil((n - s.length) / 12)));

// ── B — FIXTURE TRUTHFULNESS FOR THE CALL RECORDS ───────────────────────────────────────────────────
// In a real run every MCP tool call passes through stdio-server, which appends a started line before the
// work and a settled line after it to <runDir>/_driver/tool-calls.jsonl, keyed on (server, seq). The
// mock plays both the seat and that transport, so a mock tool call writes the same pair — a mock run
// whose calls left no wire record would drive the call audit into its blind branch on runs that are
// modelling perfectly healthy transports.
let MOCK_CALL_SEQ = 0;
export function recordMockToolCall(runDir, tool, server = "perplexity") {
  try {
    const p = driverDir(runDir, "tool-calls.jsonl");
    mkdirSync(dirname(p), { recursive: true });
    const seq = ++MOCK_CALL_SEQ;
    for (const event of ["started", "settled"])
      appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), event, server, tool, seq }) + "\n");
  } catch { /* a fixture log failure must never fail a turn the test is not about */ }
}

// The mock seat RECORDS ITS RULINGS — one `record_dispositions` call through the production receiver,
// rows derived from the seat's own ledger through the same obligations calculation the validator judges
// with. The FIRST row rules `loaded` so a run under MOCK_PR_RESULTS still exercises the loaded→Finding
// path; every other row is `benign`. Returns true when a call was made.
export function mockRecordDispositions(dir, half) {
  const specPath = driverDir(dir, half ? `grid-spec.half-${half}.json` : "grid-spec.json");
  let spec = null;
  try { spec = JSON.parse(readFileSync(specPath, "utf8")); } catch { return false; }
  if (!spec?.connotation?.dispositions_path || !spec?.output_path) return false;
  let recorded = [];
  try { recorded = parsePrRiskResults(readFileSync(spec.output_path, "utf8")); } catch { return false; }
  const canonical = obligationRows(connotationObligations(recorded));
  if (!canonical.length) return false;
  const rows = canonical.map((c, i) => ({
    // — the seat addresses a row by its POSITION in the driver's obligation list. ABSOLUTE, not
    // relative to the chunk below: the number counts off the whole page the driver rendered, and a
    // per-chunk index would address the first 25 rows twice and never the rest.
    row_index: i + 1,
    // A single-candidate row is pre-resolved and takes no index; otherwise the mock rules candidate 1.
    ...((c.candidates?.length ?? 0) === 1 ? {} : { receipt_index: 1 }),
    ruling: i === 0 ? "loaded" : "benign",
    note: "reviewed against the recorded receipt; off-topic for the mark",
  }));
  // ── THE CALL IS CAPPED, SO A COMPLIANT SEAT MAKES MORE THAN ONE ────────────────────────────────────
  //
  // `recordDispositions` accepts at most MAX_ROWS_PER_CALL rows and returns the rest as `overflow`,
  // KEEPING what it took — the tool's answer then names what is still owed and the remedy text says
  // "Send only what is left". This mock used to send every row in a single call and stop, which modelled
  // a seat that reads the cap's answer and ignores it.
  //
  // It went unnoticed because obligation counts had never crossed the cap: the retired prose fixture
  // yielded 2 terms → 10 connotation queries → 11 rows. Conversion 3 renders the manifest from the
  // structured fixture's 6 terms → 30 queries → 31 rows, so the very first run over the cap reported
  // `connotation_call_partial:call_partial=6` — 25 accepted, 6 never re-sent. The fixture was not wrong
  // about dispositions; it had simply never been asked a question big enough to need two calls.
  //
  // Chunked against the DISPOSITION tool's own constant, never a copied 25 and never the coverage tool's.
  for (let i = 0; i < rows.length; i += MAX_DISPOSITION_ROWS_PER_CALL) {
    recordMockToolCall(dir, "record_dispositions");
    recordDispositions(spec, { rows: rows.slice(i, i + MAX_DISPOSITION_ROWS_PER_CALL) });
  }
  return true;
}

// Mirror WHATEVER platform grid the driver DICTATED — the same source the plugin runs and the receipts gate
// validates. Source order: the common-law task message's dictated PLATFORMS block → the deterministic
// grid-spec.json the driver wrote (which can DIFFER from the profile when channels are class-derived, D) →
// the frozen profile sidecar → the historical gaming default.
const GAMING_FALLBACK = ["store.steampowered.com", "store.epicgames.com", "play.google.com", "apps.apple.com", "apps.aurora.com", "itch.io"];
// A1 split: the dictated spec a message points at — the canonical grid-spec.json (single-member sweep),
// a HALF spec (grid_spec_path: …grid-spec.half-<h>.json on the half member's fresh sweep), or the half
// spec a routed followup names ("your half-grid spec: …"). Null when the message carries none (legacy
// prose path / single-member followups) — callers fall back to the historical hardcoded fixture terms.
export function gridSpecFromMsg(msg) {
  const gp = msg.match(/grid_spec_path:\s*(\/\S+grid-spec[^\s]*\.json)/)?.[1];
  const hp = msg.match(/half-grid spec:\s*(\/\S+grid-spec\.half-[a-z0-9]+\.json)/)?.[1];
  // Fix-1: a closure followup names BOTH a SUPPLEMENTARY grid_spec_path AND (on the split) the half spec.
  // The FINDINGS/main-ledger fixtures must key on the full half/canonical spec, never the supplementary
  // subset — so a supp path (…supp-<tag>.json) is skipped here; suppSpecFromMsg reads it for the supp write.
  const p = (gp && !/supp-/.test(gp)) ? gp : hp;
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
// Fix-1: the driver-written SUPPLEMENTARY grid spec a closure followup points grid_spec_path at (its
// output_path is a common-law-grid…supp-<tag>.json sibling). The mock mirrors the PLUGIN: it writes the
// supplementary LEDGER at that output_path — never the canonical/half ledger, which stays exactly the
// fresh-gather plugin output. Returns the parsed spec (with output_path) or null.
export function suppSpecFromMsg(msg) {
  const p = msg.match(/grid_spec_path:\s*(\/\S+supp-\w+\.json)/)?.[1];
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function dictatedStoreDomains(msg) {
  const inMsg = msg.match(/these store domains for EVERY variant\):\s*([^\n]+?)\s*—/);
  if (inMsg) return inMsg[1].split(",").map((s) => s.trim()).filter(Boolean);
  // Deterministic grid path: the driver wrote grid-spec(.half-<h>).json and the plugin runs EXACTLY it —
  // mirror that file (it is the single source the validator's identity-join checks against).
  {
    const gs = gridSpecFromMsg(msg);
    if (Array.isArray(gs?.platforms) && gs.platforms.length) return gs.platforms.filter((p) => p !== "web"); // "web" re-added by dictatedPlatforms
  }
  try {
    // Same no-extension-filter rule as the write mandate below: this only needs the path so it can
    // read the profile.json beside it, and an unrecognised extension silently fell back to GAMING_FALLBACK.
    const path = (msg.match(/ABSOLUTE path[^:]*:\s*(\/\S+)/)
      || msg.match(/TARGETED EDITS to\s+(\/\S+)/)
      || msg.match(/re-emit the COMPLETE updated\s+(\/\S+)/)
      || msg.match(/(\/\S+common-law-grid\.json)/))?.[1];
    if (path) {
      const p = JSON.parse(readFileSync(driverDir(dirname(path), "profile.json"), "utf8"));
      if (Array.isArray(p.platforms) && p.platforms.length) return p.platforms;
    }
  } catch { /* fall through to the gaming default */ }
  return GAMING_FALLBACK;
}
export function dictatedPlatforms(msg) { return [...dictatedStoreDomains(msg), "web"]; }

// P2-C (§8b leg 2, review round 2026-07-31) — the canned recorded RESULT the armed meaning receipts carry
// (MOCK_PR_RESULTS) and the member's disposition-row shape. One shared URL on purpose: it recurs across
// every armed query, so the merged validator's recurrence floor is exercised (and satisfied by the rows).
const MOCK_PR_RESULT = { title: "Mock meaning receipt — community discussion thread on the mark", url: "https://news.example/mock-meaning-receipt" };
const prResultsArmedFor = (q) => {
  const armed = process.env.MOCK_PR_RESULTS;
  return armed && (armed === "1" || q.includes(armed)) ? [{ ...MOCK_PR_RESULT }] : [];
};

// P2-A (recall spine): a COMPLIANT digest ends every screened-live dominant-element record somewhere
// a reader can see — the driver's recall-reconciliation gate blocks delivery otherwise. The mock
// mirrors that compliant behaviour: read the merged band from the run dir and mint one individually-
// reasoned Negative-results drop row per surfaced NOVAPULSE record (one record per row, URI cited —
// the digest.md ending form 2). The result/notes wording deliberately avoids the goods/field tokens
// screen-gate polices (this is a crowd-membership weighing, not a goods drop). Reading the band at
// EMIT time keeps re-emits deterministic and lets supplemental-grown bands stay ended on later passes.
function dominantElementDropRows(dir) {
  if (!dir) return "";
  let rows = "";
  try {
    const band = JSON.parse(readFileSync(join(dir, "register-named-band.json"), "utf8"));
    const seen = new Set();
    for (const r of (band?.enumerated ?? [])) {
      const sv = String(r?.screen?.screen_verdict ?? r?.screen_verdict ?? "");
      if (!sv.startsWith("surface:") || !/novapulse/i.test(String(r?.mark_text ?? ""))) continue;
      if (!r?.record_id || seen.has(r.record_id)) continue;
      seen.add(r.record_id);
      rows += `\n| ${r.mark_text} | novapulse (sweep) | weighed — same-element register crowd member | URI ${r.record_id}; screen_verdict=${sv}; class=${(Array.isArray(r.classes) ? r.classes : [r.classes]).filter((c) => c != null).join("/") || "9"}; status=live; identical-element registration weighed individually in the mock payload |`;
    }
  } catch { /* no merged band on disk (unit tests without a funnel) — nothing to end */ }
  return rows;
}

// ── — THE MOCK SEAT'S PER-SLICE JUDGMENTS, AS SEAT ROWS ON THE DRIVER'S FORM ──────────────────
//
// What stood here (deferredDisclosureRows) composed a prose row NAMING each refused qid verbatim, because
// the deleted disclosure join read exactly that text. Nothing joins on typing now: the driver writes one
// `deferred` row per refused qid and marks it `open`, and the seat's job on those rows is a status.
//
// What the seat still authors is its OWN coverage units — the per-jurisdiction reconciliation, the
// ring-fenced script group. Those are judgment, they carry no identifier anything
// joins on, and the ledger a lawyer reads has always had them. They ride as `kind: "seat"` rows.
function mockCoverageSlices(msg) {
  const rows = [
    { axis: "primary-sweep", unit: "primary-sweep / worldwide", status: "confirmed-clean", reason: "full" },
    /CLOSED their deferred/.test(msg)
      ? { axis: "primary-sweep", unit: "primary-sweep / NZ (material)", status: "confirmed-clean", reason: "deferred sub-query closed (envelope)" }
      : { axis: "primary-sweep", unit: "primary-sweep / NZ (material)", status: "deferred", reason: "not run" },
  ];
  if (process.env.MOCK_LEDGER_LIMITED)
    rows.push({ axis: process.env.MOCK_LEDGER_LIMITED, unit: `${process.env.MOCK_LEDGER_LIMITED} / extra script group`,
      status: "coverage-limited", reason: "yielded to ring-fenced jurisdiction budget" });
  // — the floor-breach fixture. The axis named by MOCK_SEARCH_FLOOR is DESIGNATED in the typed
  // manifest call below, and here it comes back `coverage-limited` with a NON-EXECUTION reason: work the
  // mark's floor obliged, excused rather than done. That is a breach.
  //
  // The reason is deliberately interrupted-mid-run and NOT a tool-access one: a tool-absence reason is
  // relabelled `deferred` by the keystone backstop (coerceToolAbsenceDeferred) and would route via the
  // deferred path, which is a different mechanism with its own tests. Carried over from the retired
  // MOCK_STAR_FLOOR fixture, which learned it the hard way.
  if (process.env.MOCK_SEARCH_FLOOR)
    rows.push({ axis: process.env.MOCK_SEARCH_FLOOR, unit: `${process.env.MOCK_SEARCH_FLOOR} / exact-phrase storefront sweep`,
      status: "coverage-limited", reason: "not executed — sweep interrupted mid-run" });
  const present = new Set(rows.map((r) => r.axis));
  for (const ax of ["saturation-probe", "transliteration-numeric", "incumbent-class"])
    if (!present.has(ax)) rows.push({ axis: ax, unit: `${ax} / worldwide`, status: "confirmed-clean", reason: "paged to has_more:false" });
  return rows;
}

/**
 * Record the mock seat's coverage judgments THE WAY A COMPLIANT SEAT DOES — through the SHIPPED
 * `recordCoverage` tool core (called, not copied), which validates every row and writes the `_driver/`
 * accumulator itself. The typed-transport conversion killed the seat-facing file, so a mock that edited
 * a run-dir JSON would be exercising a path no live seat can take — and the harness would go green on a
 * transport the product does not have. Returns false when there is no form (a run whose plan apparatus
 * is out of reach — the gate is inactive there and the mock must not invent one).
 *
 * MOCK_NO_COVERAGE_FORM     the seat makes no record_coverage call  ⇒ coverage_no_status
 * MOCK_UNPARSEABLE_LEDGER   ditto — the pre- spelling of "this digest produced no readable coverage"
 * MOCK_BAD_COVERAGE_FORM    the DRIVER's accumulator is damaged     ⇒ coverage_form_damaged
 *                           (written to the sidecar: the seat holds no writer onto it any more, so this
 *                           knob now simulates the driver-side fault the token names on live runs)
 */
export function fillCoverageForm(runDir, msg) {
  const stamp = coverageFormStamp(runDir);
  const { sidecar } = coverageFormPaths(runDir, stamp.formName);
  if (!existsSync(sidecar)) return false;
  if (process.env.MOCK_NO_COVERAGE_FORM || process.env.MOCK_UNPARSEABLE_LEDGER) return false;
  if (process.env.MOCK_BAD_COVERAGE_FORM) { writeFileSync(sidecar, "{ this is not json"); return true; }
  const rows = readCoverageForm(runDir, stamp.formName).rows ?? [];
  // MOCK_LEDGER_LIMITED names an axis the digest judged a DOCUMENTED, accepted limit. A compliant seat
  // says so on that axis's own rows too — an axis cannot be simultaneously clean and coverage-limited —
  // and the escalation gate's skip path reads exactly that (skip-if-every-owned-row-is-coverage-limited).
  const limited = process.env.MOCK_LEDGER_LIMITED;
  const rulings = rows.filter((r) => r.kind !== "seat").map((r) => ({
    row_id: r.row_id,
    status: r.open ? "deferred" : r.axis === limited ? "coverage-limited" : r.kind === "block" ? "coverage-limited" : "confirmed-clean",
    reason: r.open ? "never dispatched — the active register provider cannot express this slice; disclosed as an open question"
      : r.axis === limited ? "yielded to ring-fenced jurisdiction budget"
      : r.kind === "block" ? "the band left part of this slice unaccounted — a material gap; ships CONDITIONAL"
      : "paged to has_more:false",
  }));
  const seat = mockCoverageSlices(msg).map((r) => ({ ...r, kind: "seat" }));
  // Chunked like a compliant seat: MAX_ROWS_PER_CALL bounds one call; every accepted row is kept.
  const all = [...rulings, ...seat];
  for (let i = 0; i < all.length; i += MAX_ROWS_PER_CALL) {
    const r = recordCoverage(runDir, { rows: all.slice(i, i + MAX_ROWS_PER_CALL) });
    if (!r.ok) return false;
  }
  return true;
}

export function fixture(name, msg, dir = null) {
  // CONVERSION 2 — NO FIXTURE BODY FOR matter-context.md. The seat hands values to `record_matter_frame`
  // and the driver renders the file, so a body here would be the mock taking the path this conversion
  // deleted — and it would hide the one thing the conversion is proven by, whether the call was made.
  // The knobs (MOCK_MEANING_ANGLES, MOCK_INTAKE_ASKS) keep their formats and are translated into fields in
  // applyStageWrites' recording branch, which drives the production receiver.
  // Frame-omission design (PR): the blind re-derivation + the frame-diff prose (frame-diff's structured
  // sibling is side-written in applyStageWrites). Dominant element NOVAPULSE mirrors the JOB mark.
  // — NO FIXTURE BODY FOR THE MODEL. blind-frame hands values to `record_blind_frame` and the driver
  // writes blind-frame-model.json, so a mock that returned a body here would be standing in for a seat
  // taking the path this PR deleted. The write moved to applyStageWrites' recording branch, which drives
  // the production receiver. MOCK_NO_BLIND_MODEL keeps its meaning and gains precision: the turn completes
  // having made no CALL, so the stage still fails `missing_file:blind-frame-model.json` rather than passing
  // on the silence — and now the absence of the call capture says which of the two happened.
  //, third conversion — NO FIXTURE BODY FOR EITHER FRAME-DIFF ARTIFACT. The seat hands values to
  // `record_frame_diff`; the driver serializes frame-diff.json and RENDERS frame-diff.md from the same
  // parsed model. A fixture body here would be the mock taking the path this conversion deleted, and it
  // would hide the one thing the conversion is proven by — whether the call was made at all.
  // CONVERSION 3 — NO FIXTURE BODY FOR variant-manifest.md OR .json. The seat hands values to
  // `record_prelim_variants` and the driver writes both, so a body here would be the mock taking the path
  // the conversion deleted. MOCK_STAR_FLOOR went with the ⭐ search floor itself at — the knob, its
  // two fixture blocks and the two mock arms that drove it are all retired, because no code reads a ⭐
  // any more.
  if (/(saturation-probe|primary-sweep|transliteration-numeric|incumbent-class)\.md$/.test(name))
    return PAD(`# Register unit ${name}\n\n## Coverage ledger\n| Coverage unit | Status | Reason |\n|---|---|---|\n| ${name.replace(".md", "")} / worldwide | confirmed-clean | paged to has_more:false |\n\nFindings: candidates above the relevance threshold.`);
  // A1 split: the two half members write common-law-findings.half-<h>.md scoped to THEIR spec's terms
  // (gridSpecFromMsg); the single-member file keeps the historical hardcoded pair. MOCK_CL_GAPS gains a
  // "translit" mode — the 转码 cells gap NON-mechanically (closable), which under the split lands the
  // gaps in half b's ledger and drives the half-B followup-routing assertions.
  if (/^common-law-findings(\.half-[a-z0-9]+)?\.md$/.test(name)) {
    const PLATFORMS = dictatedPlatforms(msg);
    const specTerms = gridSpecFromMsg(msg)?.terms;
    // — the MEANING SEAT sweeps no cells, so it writes a meaning-shaped document: a Findings
    // heading and an Audit trail, and no negative-results matrix or coverage ledger for a grid it never
    // ran. Keyed on the seat's spec carrying an EMPTY terms[] (which only the meaning seat's does), not
    // on the file name, so the fixture agrees with the dictated spec rather than with a naming habit.
    // The generic fallback below must not catch it: falling back to the hardcoded pair would have the
    // meaning seat fabricate a grid, and the merged ledger would then be identical whether the seat
    // swept or not — a fixture that cannot fail.
    const meaningSeat = Array.isArray(specTerms) && specTerms.length === 0;
    // THE SPEC-LESS FALLBACK IS DERIVED, NOT RECITED. It used to be the literal pair `["novapulse", "转码"]`,
    // which agreed with the manifest only because the RETIRED prose fixture happened to yield the same two
    // terms — its other two rows were skipped by the walk's wildcard and em-dash guards. Conversion 3
    // renders the manifest from `variantManifestModelFixture()`, which carries six, so the coincidence
    // broke and the receipts gate demanded seven receipts each for four terms the mock never swept
    // (`grid_join_missing`). Reciting one half of a join is the defect this conversion exists to remove;
    // the mock reads the SAME terms the gate does, through the same parser, and MOCK_CL_SHORT is what
    // makes a run fall short — deliberately, which is the only way a fixture can prove the gate works.
    const baseTerms = Array.isArray(specTerms) && specTerms.length ? specTerms
      : (manifestTerms(dir) ?? ["novapulse", "转码"]);
    const variants = baseTerms.filter((v) => !(process.env.MOCK_CL_SHORT && v.includes(process.env.MOCK_CL_SHORT)));
    const storeCount = PLATFORMS.length - 1;
    const closing = /supplementary search-as-code grid/.test(msg);
    const gapsMode = process.env.MOCK_CL_GAPS;
    const gapVariant = gapsMode === "exempt" || gapsMode === "translit" ? "转码" : "novapulse";
    const gapsActive = gapsMode && (!closing || gapsMode === "persist" || gapsMode === "exempt");
    const gapStore = PLATFORMS[0];
    const gapCell = (v, pl) => gapsActive && v === gapVariant && (pl === gapStore || pl === "web");
    let matrix = variants.flatMap((v) => PLATFORMS.map((pl) =>
      gapCell(v, pl) ? `| ${v} | ${pl} | not executed — coverage-limited (see ledger) |` : `| ${v} | ${pl} | No results |`)).join("\n");
    // A source-channel sweep followup (frame-reopen / closure channel arm) ADDS matrix rows for the
    // DICTATED variant scope — mirror the real contract so the merged canonical file actually changes
    // when (and only when) a sweep turn completed. The dictated scope is the explicit "For EACH of
    // these variants — a; b —" list when present (split arms), else every variant (single member).
    if (/SOURCE CHANNELS|IN-SCOPE CHANNELS/.test(msg)) {
      const dictated = msg.match(/For EACH of these variants — ([^—]+) —/)?.[1]?.split(";").map((s) => s.trim()).filter(Boolean);
      matrix += "\n" + (dictated ?? variants).map((v) => `| ${v} | github.com | No results — supplemental source-channel sweep |`).join("\n");
    }
    const exemptRow = gapsMode === "exempt"
      ? `\n| non-Latin reach (转码) | coverage-limited | TimeoutError('store cell') on ${gapStore} and web calls |`
      : "";
    // P2-C (§8b leg 2): under MOCK_PR_RESULTS the findings carry a PR / reputational section. The
    // DESIGNATED OWNER (single member, or half "a" — the asksBlock owner convention) writes the clean
    // bottom line; the other half rules on its own receipts without a bottom line. Disposition rows
    // dispose THIS member's armed (with-results) queries by citing the canned result's URL — read from
    // the member's own dictated spec, exactly what its plugin-written ledger records. MOCK_CL_UNDISPOSED
    // withholds the rows until a turn carrying the connotation correction/remedy dictate — driving the
    // half-stage corrective ladder and the merge-remedy channel end to end. Default (knob unset) writes
    // no PR section at all — every pre-existing scenario's findings stay byte-identical.
    let prSection = "";
    if (process.env.MOCK_PR_RESULTS) {
      const half = name.match(/\.half-([a-z0-9]+)\.md$/)?.[1];
      // B — THE SEAT RECORDS ITS RULINGS THROUGH THE TOOL. It writes no dispositions file and no rows
      // into its prose: mockRecordDispositions drives the PRODUCTION receiver (recordDispositions), so
      // the accumulator, the captured payload, the call index and the tool-calls pair all exist exactly
      // as a real compliant seat's turn leaves them. Rows derive from the seat's own ledger through the
      // same obligations calculation the validator judges with. A seat that owes nothing records nothing.
      // / — BOUND TO THE VOCABULARY, NOT RETYPED. This read `connotation_no_ruling|
      // connotation_form_damaged` as literals. split `no_ruling` into four named states, the
      // corrective message started saying a token this predicate did not know, and the mock stopped
      // recognising the correction it exists to answer — the exact retyped-literal staleness
      // exported the vocabulary to end, left standing in a fixture.
      const healing = new RegExp(`${CONNOTATION_FORM_TOKEN_SRC}|meaning-receipts gate`).test(msg);
      if (!(process.env.MOCK_CL_UNDISPOSED && !healing)) mockRecordDispositions(dir ?? "", half);
      prSection = "\n\n### PR / reputational risk\n"
        + (!half || half === "a"
          ? "(None identified — affirmative sweep) — reviewed against the recorded meaning receipts.\n**Connotation-search source:** perplexity_research (dictated sweep)\n"
          : "Recorded receipts for this half's queries are ruled on in the disposition form; the designated owner half writes the bottom line.\n");
    }
    if (meaningSeat) {
      const q = gridSpecFromMsg(msg)?.connotation?.queries ?? [];
      return PAD([
        "# Common-law findings — meaning sweep", "",
        "## Findings — Mark: PROJECT NOVAPULSE", "",
        q.length ? "Every recorded meaning query is ruled in the driver's disposition form." : "No meaning queries were dictated for this matter.", "",
        "### Audit trail", "| Call # | Type | Query | Outcome |", "|---|---|---|---|",
        ...q.map((x, i) => `| ${i + 1} | Meaning (sandbox) | ${x} | recorded |`), "",
      ].join("\n") + prSection);
    }
    return PAD("# Common-law findings\n\n## Findings — Mark: PROJECT NOVAPULSE\n\n| Finding | Platform | URL | developer_of_record | publisher_of_record |\n|---|---|---|---|---|\n| (none risk-relevant) | - | - | - | - |\n\n### Negative results (per-platform per-variant)\n| Variant | Platform | Result |\n|---|---|---|\n" + matrix + `\n\n### Coverage ledger\n| Coverage unit | Status | Reason |\n|---|---|---|\n| ${storeCount} mandatory platforms | confirmed-clean | ${storeCount}/${storeCount} searched |` + exemptRow + `\n\n### Audit trail\n| Call # | Type | Prompt summary | Results returned |\n|---|---|---|---|\n| 1 | Grid (sandbox) | all variants × ${PLATFORMS.length} platforms | ${variants.length * PLATFORMS.length} cells, 0 gaps |` + prSection);
  }
  if (name === "placement-recommendations.md")
    // The RULINGS TAIL closes the real file (placement-inquiry SKILL contract) and travels as prose —
    // the driver hands it to a corrective digest dispatch as data (AD-2 A9), so the fixture carries it.
    return PAD("# Placement recommendations\n\n| candidate | tier | reasoning |\n|---|---|---|\n| LUMENGARDE | headline-candidate | exact-match target class |\nEvery candidate placed at a tier (headline-candidate/sheet-2/watchlist-annex/out-of-scope-filtered).")
      + "\n\n### Coverage rulings & open questions\n- The class-9 band enumerated to has_more:false; nothing left open.\n\n### Open questions for the client / reviewer\n- Confirm the applicant's own prior filing.\n";
  if (name === "register-findings.md") {
    // The driver's screen-gate re-decide followup tells the worker to re-decide on the now-fetched goods.
    // Detect either the pre-2026-06-18 phrasing ("record_fetch it") or the current "RE-DECIDE EACH …".
    const refetching = /record_fetch it|RE-DECIDE EACH/.test(msg);
    const screenDropRow = process.env.MOCK_SCREEN_DROP
      ? (refetching && process.env.MOCK_SCREEN_DROP !== "persist"
          ? "\n| KINETIC | kinetic (translit) | dropped — off-field (relevance gate) | URI /mark/cn/88001-42; screen_verdict=drop:off-field-confirmed; class=42; status=live; fetched goods confirm hardware tooling, genuinely off-field |"
          : "\n| KINETIC | kinetic (translit) | dropped — off-field (relevance gate) | URI /mark/cn/88001-42; screen_verdict=surface:in-scope-live; class=42; status=live; inferred fashion |")
      : "";
    // MOCK_SCREEN_DROP=unnamed — the ION/copper-foundry shape (2026-07-22): a NAMED drop that the repair
    // loop fixes, PLUS a bulk slice-level drop naming no record URI at all. Copied in shape from that run's
    // real row ("ION (cl 25 slice) … ~58 records (Stæhr Holding, Trinity Chain Holding, …) — apparel/merch,
    // pulled only as a cross-class squat check"). The driver can never repair the unnamed one (it has no URI
    // to fetch), so it survives to the post-repair re-check — where observe mode MUST still exclude it.
    const unnamedDropRow = process.env.MOCK_SCREEN_DROP === "unnamed"
      ? "\n| LUMENGARDE (cl 25 slice) | exact LUMENGARDE [cl 25] | dropped — off-field (cross-class merch check) | ~58 records (Staehr Holding, Trinity Chain Holding, VANIKIOTI) — apparel/merch, pulled only as a cross-class squat check; no software nexus |"
      : "";
    if (process.env.MOCK_UNPARSEABLE_LEDGER)
      return PAD("# Register findings\n\n## Summary\n- total queries: 12\n\n## Findings — Mark: PROJECT NOVAPULSE\n\n### Risk-relevant (Sheet 1)\n| URI | Mark | Owner | Country | Classes | Status | Filed | Flag reason | Source |\n|---|---|---|---|---|---|---|---|---|\n| /m/1 | LUMENGARDE | Acme | DK | 9 | Registered | 2020-01-01 | exact-match in class | Corsearch |\n\n### Negative results\n| Mark | Search Term / Variant | Result | Notes |\n|---|---|---|---|\n| LUMENGARDE | exact | 0 hits | clean |" + dominantElementDropRows(dir) + "\n\n### Coverage ledger\n\nAll axes were confirmed-clean this run; the table failed to render.\n");
    // — NO `## Coverage ledger` TABLE. The seat does not write one: it fills in the driver's form
    // (mockCoverageSlices → fillCoverageForm, side-written in applyStageWrites) and the driver renders
    // the table from that form after the pass. A fixture that still wrote the table would be testing a
    // contract the shipped skill no longer states.
    return PAD("# Register findings\n\n## Summary\n- total queries: 12\n\n## Findings — Mark: PROJECT NOVAPULSE\n\n### Risk-relevant (Sheet 1)\n| URI | Mark | Owner | Country | Classes | Status | Filed | Flag reason | Source |\n|---|---|---|---|---|---|---|---|---|\n| /m/1 | LUMENGARDE | Acme | DK | 9 | Registered | 2020-01-01 | exact-match in class | Corsearch |\n\n### Negative results\n| Mark | Search Term / Variant | Result | Notes |\n|---|---|---|---|\n| LUMENGARDE | exact | 0 hits | clean |" + screenDropRow + unnamedDropRow + dominantElementDropRows(dir) + "\n\n### Audit trail\n| Step | Query / Variant | Result Summary |\n|---|---|---|\n| primary-sweep | LUMENGARDE | completed |\n");
  }
  if (name === "narrative.md") {
    if (process.env.MOCK_CANDSELF) {
      // Applicant-unknown run: the synthesis prompt (stages.mjs) instructs an identical hit to be reported
      // as an ORDINARY finding in the rating with a neutral "if this is the applicant's own prior filing,
      // disregard" note — never the retired "is this you?" treatment. The note rides on the FIRST synthesis
      // call (no corrective followup / gate exists anymore).
      const note = /APPLICANT UNKNOWN|own prior filing, disregard/i.test(msg)
        ? "\n- **Note:** if this is the applicant's own prior filing, disregard."
        : "";
      return PAD("# Synthesis narrative\n\nWatchlist owner BigCo noted.\n\n### Finding 1 — PROJECT NOVAPULSE — Mystery Owner LLC (US, Cl. 9)\n**Composite — 4 (High).**\nIdentical registration in the searched class." + note, 400);
    }
    const reco = process.env.MOCK_NARRATIVE_RECO
      ? "\n\nNon-Latin marketplace coverage remains open; a targeted re-run before client sign-off is the next step."
      : "";
    // — THE WRITE-UP BLOCK IS PART OF A HEALTHY NARRATIVE, and until it was here the happy path
    // exercised the depth check by SKIPPING it: the fixture carried no `Finding N` heading, so
    // `narrativeWriteUps()` recognised nothing, the check short-circuited, and a graded mock run linted
    // clean without a single depth rule ever being applied. The block is on the run's only finding
    // (ordinal 1, band High = rank 1), so it is legitimately kept and legitimately under the cap — the
    // padding below is 360 CHARS, some three dozen words, nowhere near the 270/330 word ceiling.
    // — MOCK_NARRATIVE_OVER_CAP: finding 1's write-up breaches the word cap on the FIRST emission
    // and heals on the lint-repair redo. That is 's chain: the over-cap lint failure
    // rewrites narrative.md, which is a DECLARED INPUT of narrative-refutation, so the delivery freshness
    // gate stales the reviewer and re-runs it — which is the pass whose verdict nothing reads.
    // Keyed on narrative.md not yet existing, so the redo is recognised by run state rather than by
    // matching the repair prompt's wording (which the repair composer is free to change).
    const overCap = (process.env.MOCK_NARRATIVE_OVER_CAP && dir && !existsSync(join(dir, "narrative.md")))
      ? " " + "the cited registration covers the identical mark in the searched class and remains material here. ".repeat(40)
      : "";
    return PAD("# Synthesis narrative\n\nDominant-element analysis. Watchlist owner BigCo noted. Overall Level-3 band; flat spread across candidates."
      + "\n\n### Finding 1 — PROJECT NOVAPULSE — Mystery Owner LLC (US, Cl. 9)\n**Composite — 4 (High).**\nIdentical registration in the searched class."
      + overCap
      + reco, 360);
  }
  if (name === "case-law-findings.md") return PAD("# Case-law grounding\n\nFetched ECLI:EU:... (fetch-before-cite ok).", 120);
  // — NO FIXTURE BODY. skeptic hands values to `record_skeptic` and the driver renders
  // skeptic-flags.md, so a body here would stand in for a seat taking the deleted path. The write moved to
  // applyStageWrites' recording branch, which drives the production receiver and translates MOCK_SKEPTIC's
  // old file format into the values the tool takes.
  // senior-eye-review.md HAS NO FIXTURE BRANCH ANY MORE (conversion 9). The driver renders it off the
  // `record_narrative_refutation` call, so a body here would be the mock taking exactly the path this
  // conversion deleted — and `TOOL_WRITTEN_ARTIFACTS` below refuses it by name if anything asks. The four
  // knobs this branch used to read (MOCK_VERDICT, MOCK_VERDICT_DEFECTS, MOCK_DEGENERATE_HEALS,
  // MOCK_REVIEW_BLOCKS_AFTER_VERDICT) are translated into typed values in applyStageWrites' recording
  // branch, which drives the production receiver.
  // PR-5 — a gate-closing lint scenario for the closed-gate e2e: a false "tool was blocked" line in the
  // report shell (permission-prose is one of the checks evaluateClientGate closes on). The mock re-emits
  // it verbatim on the repair redo, so the failure persists to delivery — exactly the incident shape.
  const permProse = process.env.MOCK_PERMISSION_PROSE
    ? "\nRegister note: register_enumerate was blocked by a tool-permission gate this run.\n" : "";
  if (name === "report.md") {
    const cite = process.env.MOCK_REPORT_URI
      ? `\n## CITED MARK — Owner LLC, US\n- tier: 3\n- label: Level 3\n- group: on-field\n- one: cited-record card\n### Audit\n- **Source:** [Corsearch · ${process.env.MOCK_REPORT_URI}](https://tm.corsearch.com${process.env.MOCK_REPORT_URI})\n`
      : "";
    return `---\ntype: prelim-clearance\nmatter: TMP8439\ntitle: PROJECT NOVAPULSE\nclient: ACME Interactive\nuse: codename\nclasses: 9, 41\nrun: 2026-01-01 · corsearch + common-law\noverall_label: MEDIUM\noverall_badge: l3\noverall_caption: mock composite 3\n---\n\n# Summary\nMock curated summary for the wiring test.\n\n# Recommendation\nProceed with caution.\n\n# Drivers\n- mock driver bullet\n\n# Marks\n## LUMENGARDE — NOVAPULSE, EU\n- tier: 3\n- label: Level 3 · C + Classic\n- group: on-field\n- one: mock one-line takeaway\n- open: true\n### Filings\nMock filing detail.\n### Audit\n[Provider · /m/1](#)\n::p:: internal note\n${cite}\n# Coverage\nMock coverage panel.\n${permProse}\n# Methodology\nMock methodology paragraph for the wiring test.\n`;
  }
  // report-overview.md HAS NO FIXTURE BRANCH ANY MORE (conversion 4). The driver writes it off the
  // `record_report_overview` call, so a body here would be the mock taking exactly the path this
  // conversion deleted — and `TOOL_WRITTEN_ARTIFACTS` below now refuses it by name if anything asks.
  // The write moved to applyStageWrites' recording branch, which drives the production receiver.
  if (name === "audit.md")
    return PAD("# Findings\n## LUMENGARDE (EUTM /m/1)\n- source_layer: Register\n- owner: X\n- classes: 9\n- composite: 3\n- description: mock finding\n\n# Negative Results\n## NR1\n- source_layer: Register\n- search_term: PROJECT NOVAPULSE (exact)\n- result: 0 identical hits\n\n# Audit Trail\n## AT1\n- step: mock step\n- result_summary: ok\n", 240);
  if (name === "notify-receipt.md") return "messageId=<mock-reply-id>\n";
  // doubt-closure.md HAS NO FIXTURE BRANCH ANY MORE (conversion 6). The driver renders it off the
  // `record_doubt_closure` call, so a body here would be the mock taking exactly the path this conversion
  // deleted — and `TOOL_WRITTEN_ARTIFACTS` refuses it by name if anything asks. `doubtClosureFixture`
  // below is kept as the ARCHIVE path's witness: mock-closure-fixture.test.mjs drives it deliberately to
  // prove the retired line-forms still parse, which is what an archived run's artifact still needs.
  // — findings.json HAS A CASE NOW, and this is the whole flake.
  //
  // It used to fall through to the markdown below. findings.json was written correctly ONLY as a
  // side-effect of writing narrative.md, and that side-write is guarded by `!MOCK_CANDSELF &&
  // !MOCK_NARRATIVE_RECO`. So any test that left one of those set — they are process-global and the
  // hermetic clear list did not carry every knob — made the next run's findings.json arrive as
  // `"# mock output"`, which the core-artifact gate then rejected with `findings_unparseable`.
  //
  // Deterministic, not a race. It looked like load because contention changes which tests interleave,
  // and it was blamed on concurrency twice. The fixture module has no module state, no counter, no
  // shared tmpdir and no clock: it selects purely on basename.
  if (name === "findings.json") return synthesisFindings(dir, msg);
  // AND AN UNRECOGNISED .json NEVER GETS MARKDOWN AGAIN. `placements.json`, `variant-manifest.json`,
  // `frame-diff.json`, `knockout-plan.json` and `common-law-grid.json` all fell through here too, and
  // are saved only by dedicated side-writes — so the same latent hole exists behind each of them. A
  // mock that hands back the wrong SHAPE is a harness bug wearing an engine bug's clothes, and the last
  // one cost two rounds of looking at the driver. Fail loudly at the point of the mistake instead.
  if (name.endsWith(".json")) {
    throw new Error(`mock-stage-fixtures: no fixture for ${name} — a machine-readable artifact must never `
      + "receive the generic markdown body. Add a branch to fixture(), or write it from its stage's "
      + "side-write. (#391: this fall-through produced findings_unparseable and read as a flake.)");
  }
  // ── AN ARTIFACT THE DRIVER WRITES IS NEVER HAND-WRITTEN HERE, WHATEVER ITS EXTENSION ─────────────
  //
  // The guard above only caught `.json`, so conversion 2 walked straight through it: `matter-context.md`
  // lost its fixture branch and quietly received the generic markdown body instead. That is the mock
  // taking the exact path the conversion deleted — a seat hand-writing an artifact whose only writer is
  // the driver — and it would have kept the superseded path executable inside the harness while the
  // production grant no longer allows it.
  //
  // DERIVED FROM `TOOL_WRITTEN_ARTIFACTS`, not from a second list: every conversion adds its row there
  // already, so conversions 3-6 inherit this refusal on the commit that lands their row rather than
  // needing to remember it here. `frame-diff.md` and `skeptic-flags.md` were only ever safe because their
  // stages side-write; now they are safe by name.
  // THE PATH, not the basename ( conversion 5): a per-ordinal member like `report-cards/26.md` is
  // identifiable only by its DIRECTORY, and a bare `name` makes every card unmatchable by construction.
  // `fixture` is handed the containing dir, so the path is reconstructed rather than re-derived.
  const driverWritten = toolWrittenArtifact(join(dir, name));
  if (driverWritten) {
    throw new Error(`mock-stage-fixtures: no fixture for ${name} — the driver writes it, off the `
      + `\`${driverWritten.tool}\` call. A mock body here would be a seat taking the path that tool's `
      + "conversion deleted. Drive the receiver from applyStageWrites' recording branch instead.");
  }
  return PAD("# mock output\n");
}

/**
 * doubt-closure (PR-6/T2c) — the ONE closure judgment for both ledgers. The mock used to fall through
 * to "# mock output", so the stage failed its validator on every mock e2e and applyClosure /
 * applyAskClosure never ran end-to-end: the anti-confabulation quote check — the whole point of the
 * stage — had unit coverage only. This emits the dictated line shapes with REAL verbatim quotes read
 * from the cited files, so the driver's mechanical re-verification actually has something to verify.
 *
 * Deliberately mixed so one mock run exercises every path: doubts SETTLE, asks go IMMATERIAL, and the
 * LAST ask of each ledger is left OPEN (an open row must still ship — it is never a gate).
 * MOCK_CLOSURE_MODE=open leaves everything open; =fabricate cites a quote that is NOT in the file
 * (the guard must reject it and keep the row open, loudly).
 */
export function doubtClosureFixture(msg) {
  const mode = process.env.MOCK_CLOSURE_MODE || "";
  // The stage may cite only these three; register-findings.md is markdown, so its lines quote cleanly.
  const citePath = msg.match(/^- register-findings\.md:\s*(\/\S+)$/m)?.[1];
  let quote = null;
  try {
    quote = readFileSync(citePath, "utf8").split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 20 && l.length <= 180 && !l.includes('"') && !l.includes("—"))
      ?.slice(0, 180) ?? null;
  } catch { /* no cite file in this scenario — every row goes OPEN below */ }
  if (mode === "fabricate") quote = "a sentence that appears in no file this stage may cite";

  const doubtIds = [...msg.matchAll(/^- (doubt:\S+) — subject:/gm)].map((m) => m[1]);
  const askIds = [...msg.matchAll(/^- (ask:\S+) — \[/gm)].map((m) => m[1]);
  const lines = [];
  doubtIds.forEach((id, i) => {
    const last = i === doubtIds.length - 1;
    lines.push(quote && mode !== "open" && !(last && doubtIds.length > 1)
      ? `SETTLED ${id}: register-findings.md: "${quote}" — the register spine answers this doubt on its face`
      : `OPEN ${id}: no on-disk evidence answers it; the reviewing lawyer decides`);
  });
  askIds.forEach((id, i) => {
    const last = i === askIds.length - 1;
    lines.push(quote && mode !== "open" && !(last && askIds.length > 1)
      ? `IMMATERIAL ${id}: register-findings.md: "${quote}" — the slice it asks about is off the dangerous band for this matter`
      : `OPEN ${id}: carry it to the reviewing lawyer with the run`);
  });
  return (lines.length ? lines.join("\n") : "OPEN none: nothing was open at closure time") + "\n";
}

/**
 * THE TERMS THE RECEIPTS GATE WILL JOIN ON, read from the run's own manifest through the SAME parser the
 * gate uses. Null when there is no manifest to read (a partial fixture, or a call site with no run dir).
 *
 * This exists because the spec-less fallback used to be the literal pair `["novapulse", "转码"]`, which
 * agreed with the manifest only because the RETIRED prose fixture happened to yield those two — its other
 * rows were skipped by the walk's wildcard and em-dash guards. Conversion 3 renders the manifest from the
 * structured fixture, which carries six, and the coincidence broke: the gate demanded seven receipts each
 * for four terms the mock never swept. Reciting one half of a join is the defect the conversion removes.
 */
function manifestTerms(dir) {
  if (!dir) return null;
  try {
    const terms = parseManifestVariants(readFileSync(join(dir, "variant-manifest.md"), "utf8"));
    return terms?.length ? terms : null;
  } catch { return null; }          // no manifest on disk yet — the caller keeps its historical default
}

export function gridLedger(msg, dir = null) {
  const PLATFORMS = dictatedPlatforms(msg);
  // A1 split: a half member's ledger carries exactly its spec's terms (the half validator exact-joins
  // them); no spec in the message keeps the historical hardcoded pair.
  const specTerms = gridSpecFromMsg(msg)?.terms;
  // — an EMPTY dictated terms is the meaning seat, and its ledger carries ZERO cells. Falling
  // back to the hardcoded pair here would have it record cells it never swept, and the merged ledger
  // would then be right whether or not the seat ran — the fixture would agree with the driver about a
  // grid neither of them did.
  const meaningOnly = Array.isArray(specTerms) && specTerms.length === 0;
  const baseTerms = meaningOnly ? [] : (Array.isArray(specTerms) && specTerms.length ? specTerms
    : (manifestTerms(dir) ?? ["novapulse", "转码"]));
  const variants = baseTerms.filter((v) => !(process.env.MOCK_CL_SHORT && v.includes(process.env.MOCK_CL_SHORT)));
  const closing = /supplementary search-as-code grid/.test(msg);
  const gapsMode = process.env.MOCK_CL_GAPS;
  const gapVariant = gapsMode === "exempt" || gapsMode === "translit" ? "转码" : "novapulse";
  const gapsActive = gapsMode && (!closing || gapsMode === "persist" || gapsMode === "exempt");
  const gapErr = gapsMode === "exempt" ? "TimeoutError('store cell')" : "skipped — batch budget reached";
  const gapStore = PLATFORMS[0];
  const isGap = (t, pl) => gapsActive && t === gapVariant && (pl === gapStore || pl === "web");
  const cells = variants.flatMap((t) => PLATFORMS.filter((pl) => !isGap(t, pl))
    .map((pl) => ({ term: t, platform: pl, status: "no_hit", results: [] })));
  const gaps = variants.flatMap((t) => PLATFORMS.filter((pl) => isGap(t, pl)).map((pl) => `${t} | ${pl} | ${gapErr}`));
  // The real plugin records every DICTATED connotation query verbatim into extras.pr_risk[] (the
  // ZURENA receipt) — mirror that: echo the message's spec queries (full spec on the single member, the
  // half's partition on a half member; merged pair restores the union). No spec in the message (legacy
  // prose path) keeps the historical empty list.
  // P2-C (§8b leg 2): MOCK_PR_RESULTS arms recorded RESULTS on the receipts — "1" arms every dictated
  // query, any other value arms only the queries containing it (a single-query needle lands the armed
  // receipt in exactly one half under the parity partition — the cross-half merge-remedy shape). Default
  // stays results:[] byte-identical, so the disposition arm is vacuous across every pre-existing scenario
  // (the review-flagged blind spot: no test ever drove an ARMED with-results disposition through the split).
  const specQueries = gridSpecFromMsg(msg)?.connotation?.queries ?? [];
  return JSON.stringify({ cells, extras: { pr_risk: specQueries.map((q) => ({ query: q, results: prResultsArmedFor(q) })) }, gaps });
}

// Fix-1: the plugin-written SUPPLEMENTARY ledger for a driver-dictated supp spec — exactly its
// terms × platforms, no connotation (the driver omits it; the identity join lives at canonical level).
// Mirrors gridLedger's gap semantics under MOCK_CL_GAPS: a "persist"/"exempt" run leaves the targeted
// cells UNCLOSED (they stay plugin-recorded gaps → the driver's fold keeps them as canonical gaps →
// disclosed), while a closable run records them as cells the fold unions into the canonical.
export function suppLedger(spec) {
  const variants = spec.terms ?? [];
  const platforms = spec.platforms ?? [];
  const gapsMode = process.env.MOCK_CL_GAPS;
  const gapVariant = gapsMode === "exempt" || gapsMode === "translit" ? "转码" : "novapulse";
  // A supp is always a close pass (closing=true) — only persist/exempt keep gaps (mirrors gridLedger's gapsActive).
  const gapsActive = gapsMode && (gapsMode === "persist" || gapsMode === "exempt");
  const gapErr = gapsMode === "exempt" ? "TimeoutError('store cell')" : "skipped — batch budget reached";
  const gapStore = platforms[0];
  const isGap = (t, pl) => gapsActive && t === gapVariant && (pl === gapStore || pl === "web");
  const cells = variants.flatMap((t) => platforms.filter((pl) => !isGap(t, pl)).map((pl) => ({ term: t, platform: pl, status: "no_hit", results: [] })));
  const gaps = variants.flatMap((t) => platforms.filter((pl) => isGap(t, pl)).map((pl) => `${t} | ${pl} | ${gapErr}`));
  return JSON.stringify({ cells, extras: {}, gaps });
}

// Fix-1 regression guard: the EXACT `}\n,\n]` corruption the OLD "APPEND the supplementary call's stdout
// JSON … make the file a JSON array" instruction produced when a Haiku search agent hand-edited a
// canonical/half ledger (run.jsonl:62, 2026-07-12). Armed by MOCK_CL_APPEND_MALFORMED and written ONLY
// when a message still carries that append instruction — so once the four instructions are deleted the
// knob is inert, and if any change re-introduces one the append lands malformed and grid_ledger_unparseable
// trips the suite (the class the mock never simulated before, which is why the live bug shipped).
export function malformedAppend(msg, dir = null) {
  return `[${gridLedger(msg, dir)},\n{ "cells": [], "extras": {}, "ps": [] }\n,\n]`;
}

export function coverageLedger(dir) {
  if (process.env.MOCK_BAD_COVERAGE_LEDGER)
    return JSON.stringify([{ axis: "primary-sweep", scope: "worldwide", status: "coverage-limited (count-only, saturated)", reason: "suffixed status — must move into reason" }]);
  let prose = [];
  try { prose = parseCoverageLedgerFull(readFileSync(join(dir, "register-findings.md"), "utf8")).rows; } catch { /* no findings yet */ }
  const rows = prose.map((r) => ({
    axis: r.axis,
    scope: r.unit.includes("/") ? r.unit.slice(r.unit.indexOf("/") + 1).trim() : "",
    status: r.status,
    reason: r.reason,
  }));
  for (const ax of ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"]) {
    if (!rows.some((r) => r.axis === ax))
      rows.push({ axis: ax, scope: "worldwide", status: "confirmed-clean", reason: "paged to has_more:false" });
  }
  return JSON.stringify(rows);
}
export function writeCoverageLedger(dir, saveOnly) {
  const mode = process.env.MOCK_NO_COVERAGE_LEDGER;
  if (mode === "2" || (mode === "1" && !saveOnly)) return false;
  if (process.env.MOCK_UNPARSEABLE_LEDGER) return false;
  writeFileSync(join(dir, "register-coverage-ledger.json"), coverageLedger(dir));
  return true;
}

export function synthesisFindings(runDir = null, msg = "") {
  // Repair-first A4 knob: MOCK_BAD_FINDING — the finding object carries an invented key (a per-finding
  // strict-parse failure, finding_key_unknown), HEALED only when the message is the A4 single-artifact
  // re-emit (recognized by its "failed the strict parse" instruction). The whole-file ladder (warm
  // patch) re-fails; only the targeted repair that NAMES the object lands the fix — the live shape.
  const badFinding = process.env.MOCK_BAD_FINDING && !/failed the strict parse/.test(msg);
  // spec 64 — the ACTIONS REGISTER knob. Default mirrors production dictation: the field is MANDATORY,
  // [] on a clean run. MOCK_ACTIONS=condition → one consent action on ordinal 1 (the derived disposition
  // must ship CONDITIONAL even off a CLEAR review); =advisory → client-fact only (stays CLEAR, renders
  // as a labelled open question); =absent → the key is OMITTED until the actions-missing re-demand
  // message arrives, which HEALS it to [] (the A4 repair-knob style).
  const actionsAbsent = process.env.MOCK_ACTIONS === "absent" && !/no top-level "actions" array/.test(msg);
  // — the action-shape knob heals on the repair turn that NAMES the actions register, and on
  // nothing else. Keyed on the message like `badFinding` above, so a plain resume does not launder it:
  // the test has to show the named repair is what recovers the run.
  const actionBroken = process.env.MOCK_ACTIONS === "condition-broken" && !/"actions" register/.test(msg);
  // — the THIRD family that slips the salvage lane's `finding_[a-z]` prefix test:
  // `finding_ask_answer_key_unknown`. Heals on the repair turn that NAMES the ask_answers array, and on
  // nothing else, so the test shows the named repair is what recovers the run.
  const askAnswerBad = process.env.MOCK_ASK_ANSWER_BAD === "1" && !/"ask_answers" array/.test(msg);
  return synthesisFindingsInner(runDir, badFinding, actionsAbsent, { actionBroken, askAnswerBad });
}
function synthesisFindingsInner(runDir = null, badFinding = false, actionsAbsent = false, { actionBroken = false, askAnswerBad = false } = {}) {
  // doc 50: the mock mirrors PRODUCTION emission — the CURRENT dictated schema_version, band-rated UNDER
  // THE FRAMEWORK THE RUN FROZE (read from _driver/framework.json, exactly as a live synthesis is dictated
  // it); the gates run STRICT across the whole mock suite (band ∈ frozen manifest, legacy scale forbidden,
  // rated_under tripwire). "High" is a band in every shipped ladder, so the fixture rates High.
  //
  // The version is IMPORTED, never typed. It was pinned at a literal 4 while stages.mjs dictated
  // FINDINGS_SCHEMA_VERSION to the real model — so every mock run emitted a down-level record, the v6
  // gates (positions on every disposition, the one-clause net, the off-field ground) never engaged on any
  // of them, and the lint that reports a down-level file was itself disabled by the file being down-level.
  // A pinned literal here means the mock silently stops mirroring production the next time the contract
  // moves; the import cannot.
  let fwKey = "house-default";
  try { fwKey = JSON.parse(readFileSync(driverDir(runDir, "framework.json"), "utf8")).framework_key || fwKey; } catch { /* no sidecar — house default */ }
  const baseFinding = {
    ordinal: 1, mark: "PROJECT NOVAPULSE", ...(badFinding ? { invented_key_from_mock: true } : {}), owner: { name: "Mystery Owner LLC", country: "US", registrations: [
      // ONE record per finding: the registration URI and `source.resolved_link` below name the SAME
      // record, the invariant the MOCK_FINDINGS_N clone path keeps explicitly (it re-derives the link
      // from this uri). MOCK_REPORT_URI must therefore move BOTH, or the run cites two records for one
      // finding and the V4-2 closure fires a second targeted fetch for a record nothing is missing.
      { uri: process.env.MOCK_REPORT_URI || "/mark/us/90000001", classes: ["9"], status: "Registered", filed: "2020-01-01", expiry: "2030-01-01", jurisdiction: "US" },
      ...(process.env.MOCK_MULTI_LEG ? [{ uri: "/mark/tr/2009-53984", classes: ["9"], status: "Registered", filed: "2009-10-14", jurisdiction: "TR" }] : []),
    ] },
    band: "High", disposition: "adversarial",
    // The v6 contract, which stages.mjs dictates to the real model on every synthesis: BOTH positions on
    // EVERY finding, and the one-clause net on every finding a reader sees. The fixture carried none of
    // them while it declared v4, so the gates that exist for exactly these fields never ran in the mock
    // suite. FACTS AND ASSESSMENT only — validateNet refuses a net that prescribes an action.
    legal_position: "The marks share their whole distinctive element and the goods sit in the same class.",
    practical_position: "The proprietor holds a live registration in the launch territory.",
    net: "The legal risk is a live prior right on the same distinctive element in class 9 — no coexistence terms are on the record searched.",
    meters: {
      mark_similarity: { token: "high", basis: "verified-from-record", source: "/mark/us/90000001" },
      goods_proximity: { token: "medium", basis: "inferred-from-signal" },
      use: { token: "not-confirmed", basis: "verified-from-record", source: "https://perplexity.example/result" },
      enforcer: { token: "medium", basis: "inferred-from-signal" },
    },
    quadrant: { x: 0.7, y: 0.6 },
    // — the ACTIVE provider's record host. scripts/test-run.mjs declares
    // CLEAROTRON_DATABASE=corsearch for every suite, and a register-sourced link whose host is not
    // one that provider publishes is now refused at the findings validator. These mocks stand in for a
    // corsearch run, so they compose a corsearch link; a placeholder host was the exact shape the gate
    // exists to catch, and the end-to-end mock pipelines are where it showed.
    // conversion 5 — `resolved_link` IS "THE LINK ACTUALLY FETCHED, or \"\"" (findings-model.mjs's
    // own words), and this fixture used to claim one on a run that fetched nothing. That went unnoticed
    // because the CARD fixture quietly cited `(#)` instead of the record — the harness modelling a seat
    // that ignored its own dictation ("use the REAL record URL from THIS record's source link"), which
    // kept `registry-record-coverage` clean by accident rather than by the scenario being coherent.
    //
    // The driver renders the Source line now and cannot exercise that discretion, so the fixture states
    // the truth: a record-less run carries no link, and a run that writes its record carries the real
    // one. Both halves then lint for the right reason.
    source: {
      source_type: "register-vendor",
      // MOCK_REPORT_URI names a record the run has NOT fetched — the V4 closure scenario. It must land
      // HERE, on the finding, because the driver composes the Source line from this field: aimed at the
      // retired seat-written card it is now inert, and the run cites /90000001 while the test asks about
      // /86272665. MOCK_REPORT_URI wins over MOCK_WRITE_RECORD, matching the retired card fixture's
      // `MOCK_REPORT_URI || (MOCK_WRITE_RECORD ? uri : null)` precedence.
      resolved_link: process.env.MOCK_REPORT_URI ? `https://tm.corsearch.com${process.env.MOCK_REPORT_URI}`
        : process.env.MOCK_WRITE_RECORD ? "https://tm.corsearch.com/mark/us/90000001" : "",
    },
    use_check: { source: "https://perplexity.example/result", quality: "independent" },
    own_rights: { source: "/mark/eu/000123456" },
  };
  // A2 (parallel report-cards): MOCK_FINDINGS_N=<n> clones the base finding into n DISTINCT conflicts
  // (own ordinal/mark/owner/URI, so consolidation never folds them; band-rated, so each earns a full-
  // prose card). n=1 (the default) is byte-identical to the historical single-finding fixture.
  const n = Math.max(1, Number(process.env.MOCK_FINDINGS_N || 1));
  const findings = [baseFinding, ...Array.from({ length: n - 1 }, (_, i) => {
    const ord = i + 2;
    const f = structuredClone(baseFinding);
    f.ordinal = ord;
    f.mark = `PROJECT NOVAPULSE ${ord}`;
    f.owner.name = `Mystery Owner ${ord} LLC`;
    f.owner.registrations[0].uri = `/mark/us/9000000${ord}`;
    f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    f.source.resolved_link = baseFinding.source.resolved_link ? `https://tm.corsearch.com${f.owner.registrations[0].uri}` : "";
    return f;
  })];
  return JSON.stringify({
    schema_version: FINDINGS_SCHEMA_VERSION,
    rated_under_framework: fwKey,
    findings,
    coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }],
    // Charter P5 — the four answers ride as data. Omitted while the fixture declared v4, which nothing
    // could see: contentModelChecks is gated on `expected` (schema_version >= 5), so the whole family
    // including four-answers-present was switched off for every mock run. Grounded in what this fixture
    // actually found, so fourAnswersCoherenceChecks — which runs ungated and compares the answers against
    // the verdict and the findings — has something true to agree with.
    four_answers: {
      third_party_rights: { read: "A live registration on the same distinctive element sits in the filed class.", token: "strong", basis: "the register record returned by the primary sweep" },
    },
    // WP-56 B2 — the mock mirrors production emission: a fresh synthesis carries the standing
    // mark-itself read (the mark-assessment-present lint expects it on fresh runs).
    mark_assessment: {
      distinctiveness: "Coined and strong in the filed classes; the dominant element is NOVAPULSE.",
      connotation: "Reads clean in English; no adverse readings across the searched languages/scripts.",
    },
    // judgment-relocation: MOCK_COVERAGE_INSUFFICIENT → the lawyer judged a material slice not fully cleared.
    // Its only effect is the verdict: the driver clamps CLEAR→CONDITIONAL and the run STILL delivers (no halt).
    ...(process.env.MOCK_COVERAGE_INSUFFICIENT
      ? { coverage_judgment: { sufficient: false, reason: "the exact-NOVAPULSE × cl.9 live slice returned ~2,416 hits and could not be fully enumerated" } }
      : {}),
    // spec 64 — the typed forward-action register (see the knob comment in synthesisFindings).
    // — a malformed ask_answer: the lenient parser drops it with no quarantine record, so the
    // salvage lane admits the failure and has nothing to name. The knob exists to prove the guard.
    // The heal keeps the ENTRY and drops the bad key — never removes the block. Deleting it is the
    // repair the prompt forbids (the ask was committed at intake and would ship unanswered), and the
    // test asserts the entry survives, so a fixture that healed by deletion would pass ok:true and
    // hide exactly the failure the instruction exists to prevent.
    ...(process.env.MOCK_ASK_ANSWER_BAD === "1"
      ? { ask_answers: [{ ask: "Check the EU position", answer: "Nothing found.", ...(askAnswerBad ? { bogus: 1 } : {}) }] }
      : {}),
    ...(actionsAbsent ? {} : {
      actions: process.env.MOCK_ACTIONS === "condition"
        ? [{ id: 1, kind: "consent", text: "Obtain consent from Mystery Owner LLC before filing in the US.", ordinals: [1] }]
        // — the SAME condition action with one unknown key, HEALED only by the repair turn that
        // names the actions register. Before that leg existed this shape exhausted the stage: the lane
        // admitted the failure and had no material to describe it with. The knob heals on the repair
        // message rather than on any resume, so the test proves the NAMED repair is what recovers it.
        : process.env.MOCK_ACTIONS === "condition-broken"
          ? [{ id: 1, kind: "consent", text: "Obtain consent from Mystery Owner LLC before filing in the US.", ordinals: [1],
              ...(actionBroken ? { bogus_key: 1 } : {}) }]
        : process.env.MOCK_ACTIONS === "advisory"
          ? [{ id: 1, kind: "client-fact", text: "Confirm whether the older US filing is your own.", ordinals: [] }]
          : [],
    }),
  });
}

// Frame-omission design (PR): the machine artifacts the blind-frame / frame-diff stages emit —
// blind-frame's is its WHOLE output since, frame-diff's is still a sibling of its prose.
// blind-frame-model.json mirrors a valid cold re-derivation (dominant element NOVAPULSE = JOB mark).
export function blindFrameModel() {
  return JSON.stringify({
    schema_version: 1, dominant_element: "NOVAPULSE",
    variants: [
      { value: "NOVAPULSE", direction: "drop", rationale: "the bare element" },
      { value: "KROMA", direction: "phonetic", rationale: "sound-alike" },
    ],
    fields: [{ goods: "game software", on_field: true, rationale: "goods-overlap with the product" }],
    sources: [{ channel: "developer ecosystem", rationale: "B2D product" }],
    ranking_basis: "goods-overlap",
  });
}
// NO `dominant_element` IN ANY OF THESE PAYLOADS, and that is the mock obeying the same schema a
// real seat gets: the tool has no such property, and the driver binds the value from blindFrameModel()
// above. A mock that kept sending it would be testing a call production can no longer make — which is the
// one thing a mock seat must never do.
// frame-diff.json: default = a clean diff (no directives). MOCK_FRAME_DIFF=reopen → one material field
// directive (fires a register supplemental sweep) + a dominant-element gap (clamps a CLEAR verdict).
// MOCK_FRAME_DIFF=source → one material SOURCE-CHANNEL omission (fires the common-law supplemental
// sweep arm — the A1-split routing/deferral tests), no dominant gap.
export function frameDiffModel() {
  if (process.env.MOCK_FRAME_DIFF === "source")
    return JSON.stringify({
      schema_version: 1,
      directives: [{ layer: "source", item: "github.com", observation: "applied-but-unsearched developer distribution channel", severity: "material" }],
      dominant_element_gap: false,
    });
  if (process.env.MOCK_FRAME_DIFF === "reopen")
    return JSON.stringify({
      schema_version: 1,
      directives: [{ layer: "field", item: "game software", observation: "off-fielded gaming cluster the blind model held on-field", severity: "material" }],
      dominant_element_gap: true,
    });
  // Fix 2 — a DOMINANT-ELEMENT field class-gap whose item label names the classes (RUN1 project-halcyon
  // shape: "Cl. 35/38 never class-pinned"). Drives the register CODE-DISPATCH arm (#1): deriveDirectiveRemedy
  // parses {35,38} from the label and mints NOVAPULSE × [35,38] — never the item STRING × the matter's classes.
  if (process.env.MOCK_FRAME_DIFF === "field-classgap")
    return JSON.stringify({
      schema_version: 1,
      directives: [{ layer: "field", item: "Cl. 35 (retail/online-retail) and Cl. 38 (online comms)",
        observation: "scope-ledger marks 35/38 applied but no query was ever class-pinned to 35 or 38 — surfaced only via 9/28/41/42 co-classification", severity: "dominant-element" }],
      dominant_element_gap: true,
    });
  return JSON.stringify({ schema_version: 1, directives: [], dominant_element_gap: false });
}

// B1 — one isolated report-card per finding, citing THAT finding's own record URI (so the provenance lint
// passes). Reads findings.json from the run dir (out is <runDir>/report-cards/<ord>.md) to mirror the real
// per-finding render; falls back to the synthesisFindings shape.
export function reportCardFixture(out) {
  const ord = basename(out, ".md");
  let uri = "/mark/us/90000001", owner = "Mystery Owner LLC", mark = "PROJECT NOVAPULSE";
  try {
    const fj = JSON.parse(readFileSync(join(dirname(dirname(out)), "findings.json"), "utf8"));
    const f = (fj.findings || []).find((x) => String(x.ordinal) === ord);
    if (f) { owner = f.owner?.name || owner; mark = f.mark || mark; uri = f.owner?.registrations?.[0]?.uri || uri; }
  } catch { /* defaults */ }
  // MOCK_REPORT_URI injects a specific cited URI (the V4 closure-fetch tests); else cite the finding's real
  // /mark/ URI ONLY when the mock wrote its record (MOCK_WRITE_RECORD); else a benign (#) link (mirrors the old
  // report.md fixture) so the record-less happy path stays registry-coverage-clean.
  const citeUri = process.env.MOCK_REPORT_URI || (process.env.MOCK_WRITE_RECORD ? uri : null);
  const src = citeUri ? `[Provider · ${citeUri}](https://tm.corsearch.com${citeUri})` : `[Provider · card${ord}](#)`;
  return `## ${owner} — ${mark}, US\n- ord: ${ord}\n- tier: 3\n- label: Level B · Composite 4 · Paper Conflict\n- group: on-field\n- source: Register\n### Full detail\n- Mock filing detail.\n- Source: ${src}\n`;
}

// judgment-relocation (2026-06-24): the funnel's load-bearing artifact is the COMPLETE NAMED BAND
// (register-units/<axis>-band.json). The driver hard-fails fan-in if a freshly-run axis wrote no band, so the
// mock funnel must write one alongside its <axis>.md — a minimal valid named-band array (one enumerated slice +
// one count-only crowd descriptor) that parseNamedBand accepts.
/**
 * The unit's named band, written the way the funnel's tools write it. Extracted at the note conversion:
 * it used to hang off the note's output path, and the converted dispatch has none.
 *
 * MOCK_NO_BAND_ONCE=<axis> (2026-07-14, copper-keystone) reproduces the fabrication signature — the unit
 * runs and its named band is never written. One-shot via a marker file so the corrective/warm repair CAN
 * heal. MOCK_NO_BAND=<axis> is the persistent variant: the band NEVER appears, so the stage must
 * fail-close. WHAT THAT SIGNATURE MEANS CHANGED with the conversion, and the knobs are kept precisely so
 * the change is asserted rather than assumed: a seat can no longer produce a note without a band, because
 * `record_unit_note` refuses one (`unit_band_unreadable`). The old signature — note present, band absent —
 * is now unreachable from the seat's side. The knobs still drive a fail-closed run; what moved is which
 * artifact is missing when it fails, and named-band-missing.test.mjs states that at its arms.
 */
export function mockUnitBandWrite(runDir, axis, msg = "") {
  const bandPath = join(runDir, "register-units", `${axis}-band.json`);
  mkdirSync(dirname(bandPath), { recursive: true });
  // MOCK_ESCALATION_NOOP NOW HAS TO FREEZE THE BAND TOO, and that is a consequence of the conversion
  // rather than a widening of the knob. Its job is "the unit is defended in place, UNCHANGED", and it
  // used to reach that by suppressing a marker appended to the note's bytes. The note is rendered from
  // the band now, so a band that moves moves the note with it — and on a resume the fresh stamp is
  // computed from a followup message that carries no plan listing, so it legitimately differs. Freezing
  // an EXISTING band is what "unchanged" means once the note describes the band; a first write still
  // falls through, so the knob cannot fabricate a unit that never ran.
  if (process.env.MOCK_ESCALATION_NOOP && existsSync(bandPath)) return true;
  if (process.env.MOCK_NO_BAND === axis
    || (process.env.MOCK_NO_BAND_ONCE === axis && !existsSync(`${bandPath}.mock-skipped`))) {
    writeFileSync(`${bandPath}.mock-skipped`, "1");
    return false;
  }
  // Real-funnel fidelity: a RESUME re-emits the COMPLETE band "preserving each existing block's qid
  // VERBATIM" (the followup mandate) — the executor merge never drops a dictated slice. A resume followup
  // carries no "- qid …" plan listing, so namedBand alone would regenerate only the base/judgment blocks
  // and silently drop the dictated-qid blocks; the identity-join (and the Fix-2 frame-reopen receipt
  // refresh over it) would then read the axis unexecuted. Merge: fresh blocks + any prior QID block this
  // re-emit did not restamp.
  const fresh = JSON.parse(namedBand(axis, msg));
  const freshQids = new Set(fresh.filter((b) => b && b.qid).map((b) => b.qid));
  let kept = [];
  try {
    const prior = JSON.parse(readFileSync(bandPath, "utf8"));
    kept = (Array.isArray(prior) ? prior : []).filter((b) => b && b.qid && !freshQids.has(b.qid));
  } catch { /* no/torn prior band — the fresh stamp stands */ }
  writeFileSync(bandPath, JSON.stringify([...fresh, ...kept], null, 2) + "\n");
  return true;
}

export function namedBand(axis, msg = "") {
  const blocks = [
    // copper-lattice re-route: under the supplemental_lane contract every band block is tool-written and
    // qid-stamped — the mock funnel's judgment blocks wear synthetic supp: qids (they join as unplanned[],
    // which is logged, never gated). MOCK_BAND_UNPLANNED strips them — drives the band_block_unplanned path.
    { state: "enumerated", ...(process.env.MOCK_BAND_UNPLANNED ? {} : { qid: `supp:${axis}:mock:exact-live:00000001` }), query: `${axis} / exact-in-class-live`, total_hits: 1, records: [
      { record_id: "/mark/us/90000001", mark_text: "NOVAPULSE", classes: [9], status: "Registered",
        owner_name: "Mystery Owner LLC", owner_country: "US", screen_verdict: "surface:in-scope-live",
        ...(process.env.MOCK_MULTI_LEG ? { screen: { applicationDate: "2020-01-01", registrationDate: "2023-04-18", status: "Valid", live_status: "live" } } : {}) },
      // WP-receipts senior-right knob: a SENIOR Turkish leg of the same owner family (the VENZY shape) —
      // older application, live, screen-dated, and NOT fetched by any stage: the driver's senior-right
      // closure must redirect ONE fetch to it (or state the open item when the fetch fails).
      ...(process.env.MOCK_MULTI_LEG ? [{ record_id: "/mark/tr/2009-53984", mark_text: "NOVAPULSE", classes: [9], status: "Registered",
        owner_name: "Mystery Owner LLC", owner_country: "TR", screen_verdict: "surface:in-scope-live",
        screen: { applicationDate: "2009-10-14", registrationDate: "2011-11-30", status: "Valid", live_status: "live" } }] : []),
      // MOCK_SCREEN_DROP's subject, AND IT HAS TO BE IN THE BAND NOW (conversion 11). The screen-gate
      // fixtures used to type this record straight into a hand-written Negative-results row — mark
      // KINETIC, uri /mark/cn/88001-42, verdict typed beside it — with nothing in the band to match. The
      // driver renders that row from the band record the uri names, so a drop the band does not carry is
      // refused at the call: an invented uri no longer has a row to render. Putting the record in the
      // band is the fixture catching up with the contract, and it is the honest shape anyway — a
      // candidate cannot be "screened out" of a band it was never in.
      ...(process.env.MOCK_SCREEN_DROP ? [{ record_id: "/mark/cn/88001-42", mark_text: "KINETIC", classes: [42], status: "live",
        owner_name: "Kinetic Tooling Co", owner_country: "CN", screen_verdict: "surface:in-scope-live" }] : []),
    ] },
    { state: "incomplete", ...(process.env.MOCK_BAND_UNPLANNED ? {} : { qid: `supp:${axis}:mock:crowd:00000002` }), query: `${axis} / bare-element crowd`, total_hits: 2416, fetched: 1, sample: [],
      reason: "crowd descriptor — saturated element, count-only" },
  ];
  // FIX test hook: a COLLAPSED dangerous slice — enumerated (claimed hits) but ZERO records reached the band.
  // The healthy enumerated block above stays, so the band is non-empty overall (mirrors the ~220-record real
  // failure where only the dangerous slice was lost); the per-block fail-gate must still FAIL the run.
  // MOCK_BAND_COLLAPSED="all" → every axis; ="<axis>" → just that one (the single-slice-loss shape).
  const want = process.env.MOCK_BAND_COLLAPSED;
  if (want && (want === "all" || want === axis))
    blocks.push({ state: "enumerated", query: `${axis} / exact near-name dangerous slice`, total_hits: 212, records: [] });
  // WS2: when the driver DICTATES the frozen plan's entries, stamp one block per qid so the
  // fan-in identity-join finds every dictated slice executed (mirrors the real funnel's contract).
  // MOCK_PLAN_DROP_QID="<substring>" skips matching qids — drives the missing-qid followup/fail path.
  for (const dm of (msg || "").matchAll(/- qid "([^"]+)":([^\n]*expected: (?:enumerate|count))/g)) {
    const [, qid, rest] = dm;
    const kind = /expected: count/.test(rest) ? "count" : "enumerate";
    if (process.env.MOCK_PLAN_DROP_QID && qid.includes(process.env.MOCK_PLAN_DROP_QID)) continue;
    // the dictation carries `names [...]` for term-stacked entries and a quoted "<term>" for single ones
    // (a wildcard entry's term IS its pattern, e.g. "n?v?p?ls?") — both must reach the block's query, or the
    // form oracle cannot tell the phonetic family was dispatched.
    let terms = null;
    try { terms = JSON.parse(rest.match(/names (\[[^\]]*\])/)?.[1] ?? "null"); } catch { /* not a stacked entry */ }
    if (!terms) { const t = rest.match(/^\s*\S+\s+"([^"]+)"/)?.[1]; if (t) terms = [t]; }
    blocks.push(...qidBlocks(qid, kind, terms));
  }
  return JSON.stringify(blocks, null, 2) + "\n";
}

// one deterministic stamped block per dictated plan entry (enumerate → a one-record slice; count → a crowd descriptor)
//
// `terms` mirrors the REAL funnel's OR-stack: a term-stacked entry is dispatched as
// `exact a OR b OR c [cl …]` and the band records that whole query string. The form-axis oracle
// (mechanicalFormGapDirectives) recovers what was searched from exactly that text, so a mock that wrote only
// the qid left every form-band term looking UNDISPATCHED. That went unnoticed while the mock's prose manifest
// named no dominant element — the form floor threw `form_neighbourhood_no_element` and never derived, so the
// oracle had nothing to check and the "driver DERIVES the JSON" tests passed vacuously. Seeding from the
// validated manifest (2026-07-18) makes the floor derive here for the first time; the band must be faithful
// or it manufactures 500 false gaps that production never had.
// deterministic per-qid id (FNV-1a, 6 digits) — stable across runs so the mock stays byte-reproducible
function qidHash(qid) {
  let h = 2166136261;
  for (const ch of String(qid)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return String((h >>> 0) % 1000000).padStart(6, "0");
}

// MOCK_PLAN_DEFERRED="<match>" — the ACTIVE PROVIDER REFUSED these dictated slices. Substring match on the
// qid; an axis name is the qid's own prefix (`<axis>:<predicate>:<slug>`), so naming an axis defers every
// entry on it and naming a fuller fragment defers just that one. The block mirrors what
// providers/_shared/execute-plan.mjs stamps for an `unsupported` entry: nothing built, nothing called,
// error:true BESIDE deferred:true. joinPlanToBands routes that pair to the receipt's `deferred[]` (never
// `missing[]`), so no repair ladder fires — the run has to DECIDE about it instead, which is the whole point.
// The reason wears the executor's own CAPABILITY_GAP_MARKER, the token coverage-ledger.mjs's
// isCapabilityGapReason recognises; without it the deferral would read as a mis-stamped transient.
const DEFERRED_REASON = "capability-gap: the active register provider cannot express this slice, "
  + "so it was never dispatched — asking again returns the identical refusal";
const planDeferred = (qid) => Boolean(process.env.MOCK_PLAN_DEFERRED) && String(qid).includes(process.env.MOCK_PLAN_DEFERRED);

// MOCK_PLAN_HARD_ERROR="<match>" — the provider ACCEPTED the slice and then FAILED on it. The
// block carries `error:true` and NO `deferred:true`, which is the whole distinction: nothing was known
// before the wire, so joinPlanToBands routes it to `missing[]` and it rides the full repair ladder.
// This is R5's shape verbatim — an HTTP 500 out of one jurisdiction's Near/Adj index, identical on every
// retry. Before that killed the run; now the SECOND fan-in discloses it as a deferral.
const HARD_ERROR_REASON = "provider error on the count probe (after one in-tool retry): "
  + "HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj queries";
const planHardError = (qid) => Boolean(process.env.MOCK_PLAN_HARD_ERROR) && String(qid).includes(process.env.MOCK_PLAN_HARD_ERROR);

export function qidBlocks(qid, kind, terms = null) {
  const query = Array.isArray(terms) && terms.length ? `exact ${terms.join(" OR ")}` : qid;
  if (planHardError(qid))
    return [{ state: "incomplete", qid, query, total_hits: 0, fetched: 0, sample: [], error: true,
      reason: HARD_ERROR_REASON }];
  if (planDeferred(qid))
    return [{ state: "incomplete", qid, query, total_hits: 0, fetched: 0, sample: [], error: true, deferred: true,
      reason: DEFERRED_REASON }];
  return [kind === "count"
    ? { state: "incomplete", qid, query, total_hits: 999, fetched: 1, sample: [], reason: "count-only crowd descriptor (dictated)" }
    // `_query` on the RECORD mirrors the real funnel: the merged register-named-band.json keeps records, not
    // blocks, so a block-level `query` does not survive the merge. Production carries the dispatched OR-stack
    // per record (38 distinct `_query` strings across Racers' 1,549 records) and that is what the form-axis
    // oracle harvests. Without it every stacked term reads as never-searched.
    : { state: "enumerated", qid, query, total_hits: 1, records: [
        // record_id must be unique PER QID — it was keyed on qid.LENGTH, so the seven chunked form stacks
        // (`…+form`, all the same length) collided onto one id and the merge deduped six of them away,
        // taking their `_query` with them.
        { record_id: `/mark/us/9${qidHash(qid)}`, mark_text: "NOVAPULSE", classes: [9], status: "Registered",
          owner_name: "Mystery Owner LLC", owner_country: "US", screen_verdict: "surface:in-scope-live", _query: query } ] }];
}

// WS2 (B2) — the structured variant-manifest sibling (mark/elements/variants mirror the JOB +
// the prose fixture) the register-plan compiler consumes in plan-mode mock runs.
export function variantManifestModelFixture() {
  return JSON.stringify({
    schema_version: 1, mark: "PROJECT NOVAPULSE", dominant_element: "NOVAPULSE",
    elements: [{ value: "NOVAPULSE", kind: "distinctive" }, { value: "PROJECT", kind: "common" }],
    variants: [
      { value: "novapulse", category: "core", rationale: "case form" },
      // A7 completeness floor (2026-07-31): a faithful turn under the floor-stating prompt emits the
      // WHOLE family \u2014 verify.mjs fails a fresh manifest missing a core/phonetic/visual member, so the
      // mock mirrors what the corrective ladder would demand.
      { value: "novapulze", category: "phonetic", rationale: "sound-alike" },
      { value: "novapu1se", category: "visual", rationale: "digit look-alike" },
      // A non-Latin value carries its romanisation \u2014 the register that indexes non-Latin filings by
      // their transliteration cannot answer the characters, so the plan compiles BOTH forms onto the
      // entry (register-plan.mjs romanStamp). verify.mjs fails a fresh manifest that omits one.
      { value: "\u8f6c\u7801", category: "transliteration", rationale: "script form", romanization: "ZHUAN MA" },
      // item 21 per-script floor (2026-08-01): the jx scenarios scope JP and/or KR, and those territories
      // register foreign word marks in katakana and hangul respectively. A faithful turn under the
      // script-floor-stating prompt emits one rendering per in-scope script, so the mock does too \u2014 the
      // gate refuses a manifest without them and the corrective ladder would demand exactly these.
      { value: "\u30ce\u30d0\u30d1\u30eb\u30b9", category: "transliteration", rationale: "katakana rendering (JP)", romanization: "NOBAPARUSU" },
      { value: "\ub178\ubc14\ud384\uc2c0", category: "transliteration", rationale: "hangul rendering (KR)", romanization: "NOBAPEOLSIN" },
    ],
  }, null, 2) + "\n";
}

// The success-path file-writing dispatch (the stage turn wrote its artifact). Returns the summary string.
// Identical logic to the retired gateway mock's inline block; msg/argv are threaded in.
/**
 * The two LINT-REPAIR staling knobs (AD-2 A1 /), in ONE place.
 *
 * They used to sit inline in the path-matching branch, which stopped reaching them the moment
 * report-overview converted: the recording branch matches the redo's message first and returns, so the
 * redo turn no longer passed through the code that moves findings.json. Extracted rather than copied —
 * a second authoring of a scenario is how a pair stops being a pair, and the pair IS the point (one knob
 * moves a coverage note, the other an actual finding; without both, narrowing the freshness question
 * looks like a pass because it went quiet).
 *
 * Both key on the report-overview resume the redo ladder composes, which the conversion left intact: the
 * followup still opens "RESUMING your own report-overview session", it just orders a CALL now.
 */
function stalefindingsOnLintRepair(dir, msg) {
  if (!/RESUMING your own report-overview session/.test(msg)) return;
  const fp = join(dir, "findings.json");
  // AD-2 A1 (E2E-R2): the redo ALSO rewrites findings.json — the exact incident shape (the redo turn moved
  // the input every report card was built from, staling the whole delivery tail). The rewrite stays
  // schema-valid: the defect under test is FRESHNESS (stamps key on bytes), never a malformed artifact.
  if (process.env.MOCK_LINT_REPAIR_TOUCH_FINDINGS) {
    try {
      const doc = JSON.parse(readFileSync(fp, "utf8"));
      if (Array.isArray(doc.coverage) && doc.coverage[0]?.note != null && !String(doc.coverage[0].note).includes("(post-redo)"))
        doc.coverage[0].note = `${doc.coverage[0].note} (post-redo)`;
      writeFileSync(fp, JSON.stringify(doc, null, 2) + "\n\n");   // note tweak + trailing whitespace: bytes move, JSON stays valid
    } catch { try { appendFileSync(fp, "\n"); } catch { /* no findings yet — nothing to stale */ } }
  }
  // — the SIBLING knob. The one above moves a COVERAGE note plus trailing whitespace: the whole-file
  // sha moves and not one finding object does, so nothing a card was built from changed. This one moves an
  // actual FINDING, so the card built from it IS stale and the tail repair MUST still fire.
  if (process.env.MOCK_LINT_REPAIR_TOUCH_FINDING) {
    try {
      const doc = JSON.parse(readFileSync(fp, "utf8"));
      // Edits a field the CARD ITSELF RENDERS, so a test can assert the delivered artifact rather than
      // merely that a re-render event fired. WHERE it renders moved under this knob's feet twice: the
      // retired reportCardFixture echoed owner.name into the card's own `## ` heading; conversion 5 took
      // the heading out of the card file (card-frame.mjs composes it at assembly), so the card's echo is
      // now the recording branch's prose, read from findings.json at CALL time. If a later conversion
      // stops the card body naming the owner, this knob goes quiet again — move it to a field that
      // conversion renders, and re-prove the assertion can fail by freezing the payload across
      // dispatches (a run-dir file, not a module cache: the mock is a fresh process per turn).
      const f = (doc.findings ?? [])[0];
      if (f?.owner && !String(f.owner.name ?? "").includes("(post-redo)")) f.owner.name = `${f.owner.name ?? ""} (post-redo)`.trim();
      writeFileSync(fp, JSON.stringify(doc, null, 2) + "\n");
    } catch { /* no findings yet — nothing to stale */ }
  }
}


// — WHERE A RECORDING SERVER LEARNS ITS RUN. `CLEAROTRON_BAND_RUN_DIR`, set by serverEnv in
// driver/engine/mcp/gather-config.mjs, is the value the real recording server reads; each engine just
// carries it a different way. Read in that engine's own channel, in the order the engines exist:
//
//   claude            `--mcp-config <json>` on argv — the server table inline.
//   codex               `$CODEX_HOME/config.toml`, where renderCodexConfigToml writes the same table as
//                       `env = { CLEAROTRON_BAND_RUN_DIR = "…" }`. CODEX_HOME rides the child env, not argv.
//   fallback            the child env itself, for a harness that sets it directly.
//
// NO `--add-dir` FALLBACK, deliberately. That is what this replaced, and a fallback would restore exactly
// the coupling — the mock would go on working while the channel it claims to read had gone silent.
function runDirFromWiring(argv) {
  const ci = argv.indexOf("--mcp-config");
  if (ci >= 0 && argv[ci + 1]) {
    try {
      for (const srv of Object.values(JSON.parse(argv[ci + 1])?.mcpServers ?? {})) {
        if (srv?.env?.CLEAROTRON_BAND_RUN_DIR) return String(srv.env.CLEAROTRON_BAND_RUN_DIR);
      }
    } catch { /* malformed → try the next channel */ }
  }
  const home = process.env.CODEX_HOME;
  if (home) {
    try {
      const toml = readFileSync(join(home, "config.toml"), "utf8");
      const m = toml.match(/CLEAROTRON_BAND_RUN_DIR\s*=\s*"((?:[^"\\]|\\.)*)"/);
      if (m) return JSON.parse(`"${m[1]}"`);
    } catch { /* no config.toml yet → try the next channel */ }
  }
  return process.env.CLEAROTRON_BAND_RUN_DIR || null;
}

/**
 * The axis the driver BOUND for this fan-out turn, read from the wiring — argv's `--mcp-config` first,
 * then the codex TOML, exactly the channels runDirFromWiring reads and for the same reason.
 *
 * ENGINE-NEUTRAL BY CONSTRUCTION, which the first cut was not: it read only argv, and the codex path
 * carries its MCP config in `config.toml` instead. Every register-unit turn on the openai engine then
 * resolved to no bound axis, filed no note, and the run died as an absent artifact — a harness gap that
 * looked exactly like a product defect.
 *
 * ANY server's env, not a named key. `serverEnv` stamps this value on every local server in the config,
 * so there is one value and picking a key would only make this reader fragile to a rename. Whether the
 * binding reaches the RIGHT server is a production question, and it is asserted where it belongs — over
 * buildGatherMcpConfig — rather than inferred from a harness that could always paper over it.
 */
function recordAxisFromWiring(argv) {
  const ci = argv.indexOf("--mcp-config");
  if (ci >= 0 && argv[ci + 1]) {
    try {
      for (const srv of Object.values(JSON.parse(argv[ci + 1])?.mcpServers ?? {})) {
        if (srv?.env?.CLEAROTRON_RECORD_AXIS) return String(srv.env.CLEAROTRON_RECORD_AXIS);
      }
    } catch { /* malformed → try the next channel */ }
  }
  const home = process.env.CODEX_HOME;
  if (home) {
    try {
      const toml = readFileSync(join(home, "config.toml"), "utf8");
      const m = toml.match(/CLEAROTRON_RECORD_AXIS\s*=\s*"((?:[^"\\]|\\.)*)"/);
      if (m) return JSON.parse(`"${m[1]}"`);
    } catch { /* no config.toml yet → nothing bound */ }
  }
  return null;
}

/**
 * MOCK_WRITE_RECORD — append the run's fetched register record body, so `assembleRunRecords`
 * materializes `_records/us-90000001.json` from it.
 *
 * EXTRACTED because the synthesis conversion gave this two callers. It used to sit
 * inside the `basename(out) === "narrative.md"` branch, which was the only place a synthesis turn passed
 * through. The recording branch at the top of `applyStageWrites` now handles that turn and RETURNS, so
 * this never ran — and the failure surfaced three hundred lines away, as a missing `_records` file on a
 * test about report rendering. An early return that skips a side-write is invisible at the return.
 *
 * The record row must prefix-match assembleRunRecords' `prelim-<slug>-<codename>-` filter
 * (registry-fidelity rowMatchesRun). The retired gateway carried the stage key in --session-key; the
 * anthropic-agent (claude) argv has none, so the run prefix is derived from the run dir — in production
 * the register MCP server stamps this key from its gather config.
 *
 * — INTO THE RUN. gather-config hands the real register server CLEAROTRON_REGISTER_RECORD_LOG pointing
 * at this run's `_driver/`; the env var stays honoured so a test can pin a path, but the DEFAULT is the
 * run dir, as it is in production.
 */
function mockRegisterRecordWrite(runDir, argv = []) {
  if (!process.env.MOCK_WRITE_RECORD) return;
  const skArg = argv.indexOf("--session-key");
  const sk = skArg >= 0
    ? (argv[skArg + 1] ?? "prelim-record")
    : `prelim-${basename(dirname(runDir))}-${basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "")}-mockrecord`;
  const recordLog = process.env.CLEAROTRON_REGISTER_RECORD_LOG
    || driverDir(runDir, "register-record-bodies.jsonl");
  mkdirSync(dirname(recordLog), { recursive: true });
  appendFileSync(recordLog, JSON.stringify({
    sessionKey: sk, target: "/mark/us/90000001",
    body: { applicationNumber: "90000001", registrationNumber: "7100200",
      applicationDate: "2020-01-01", registrationDate: "2023-04-18", statusText: "Registered", jurisdiction: "US" },
  }) + "\n");
}

export function applyStageWrites(msg, argv) {
  let summary = "mock stage ok";
  // — BLIND-FRAME IS FIRST BECAUSE IT NAMES NO PATH. Every branch below matches an absolute output
  // path out of the dispatch; the converted dispatch carries none, which is the whole point of it. Keyed on
  // the tool name it orders, and the run dir comes from the WIRING rather than from a path in the prose —
  // a seat resolves its run from the wiring, not from the message.
  // ── THE UNIT'S AUDIT NOTE — ITS OWN BRANCH, BEFORE THE RECORDING BLOCK ────────
  //
  // Not folded into the alternation below, and that is a statement rather than tidiness: register-unit is
  // NOT a RECORDING stage. Its transport sits on its own LOCAL key (`unit-note`) because the stage keeps a
  // legitimate seat write — the lane-off band, live for a matter with no Nice classes — and every RECORDING
  // row declares `seatWrites: false`. A branch in that alternation would model this seat as one that holds
  // no writer, which is the one thing about it that is not true.
  //
  // THE ORDER IS THE POINT AND IT IS THE PRODUCTION ORDER. The band is written first, then the note is
  // filed from it. That is not the harness being tidy: `record_unit_note` REFUSES a note over a band that
  // does not exist, because its counts are aggregates over that band. A mock that filed the note first
  // would be modelling a seat the transport rejects.
  // ── THE FINDINGS DOCUMENT (conversion 11) — ITS OWN BRANCH, BEFORE THE RECORDING BLOCK ───────────
  //
  // Not folded into the alternation below, for the opposite reason to unit-note's: this stage IS a
  // RECORDING stage, but it is the only one whose call must JOIN against the run's own band. Every branch
  // in that alternation composes a payload out of thin air; this one cannot, because the acceptance
  // boundary refuses a uri no band record carries.
  //
  // THE ROWS ARE DERIVED FROM THE RUN'S OWN FACTS SIDECAR, never hand-written here, and that is the
  // property this branch exists to preserve. A fixture that typed a uri would go green while the driver's
  // band read was broken — the harness modelling the thing it is supposed to be proving, which is the
  // trap the report-card and unit-note branches both name. Reading the sidecar means the mock cites
  // whatever the driver actually indexed, so a broken facts write reds the pipeline here rather than
  // three layers downstream.
  if (/record_register_digest/.test(msg)) {
    const runDir = runDirFromWiring(argv);
    if (!runDir) return "mock register-digest: no run dir in the engine wiring — the driver wires CLEAROTRON_BAND_RUN_DIR per run and this branch refuses rather than guessing one";
    recordMockToolCall(runDir, "record_register_digest", "recording-register-digest");
    const facts = readDigestFacts(runDir);
    const recs = [...facts.recordsByUri.values()];
    const uris = recs.map((r) => r.record_id ?? r.uri).filter(Boolean);
    // THE DROP MUST BE A RECORD THE SCREEN ACTUALLY SURFACED, and the conversion is what forces that.
    // The old fixture invented `/mark/cn/88001-42` and typed `screen_verdict=surface:in-scope-live`
    // beside it; the driver renders that cell from the band now, so a made-up uri has no row to render
    // and a real record brings its own verdict. `findScreenGateParseGaps` skips any row whose verdict is
    // not a surfacing one, so a drop chosen without regard to verdict would silently exercise nothing —
    // the scenario would look driven and check nothing.
    const SURFACING = /^(surface:in-scope-live|surface:all-class|deepfetch:ambiguous)$/;
    // The knob's own subject first, then any surfacing record — so the scenario drops the record the
    // fixtures are written about rather than whichever surfacing one happens to sort first.
    const isSurfacing = (r) => SURFACING.test(String(r?.screen?.screen_verdict ?? r?.screen_verdict ?? ""));
    const surfaced = recs.find((r) => String(r?.record_id ?? "") === "/mark/cn/88001-42" && isSurfacing(r))
      ?? recs.find(isSurfacing);
    const dropUri = process.env.MOCK_SCREEN_DROP
      ? (surfaced?.record_id ?? surfaced?.uri ?? uris[1])
      : uris[1];
    // ONE SURFACED, ONE DROPPED where the band has two or more; a one-record band surfaces its only
    // record. An EMPTY band sends no rows at all — the declared-absence path, which is a real run state
    // (a `skeleton: []` plan) and must be exercised rather than papered over with an invented row.
    // ── HOW A RE-DECIDE HEALS, AND WHAT CONVERSION 11 TOOK AWAY ──────────────────────────────────
    //
    // The old fixture healed this by RETYPING the record's own `screen_verdict` as
    // `drop:off-field-confirmed`, which takes the row out of the screen gate's scope (the gate reads
    // surface:* verdicts as in-scope candidates). That was a seat rewriting the screen's provenance to
    // change how a gate judged its own drop — the exact class of restatement this conversion removes,
    // and it is not expressible any more: the driver renders that cell from the band record.
    //
    // So the re-decide heals the way the driver's own followup words it — "RE-DECIDE EACH on its fetched
    // goods: KEEP IT AS A CONFLICT/FINDING if in-field". The seat changes its DECISION, not the screen's
    // record of what it saw: the record leaves negative_rows and takes a Sheet-1 row instead. Same
    // property under test (a fixable row heals at the flush and stops clamping), reached by a route a
    // compliant seat can actually take. `persist` still persists, so the unfixable arm is unchanged.
    const correctedAway = Boolean(process.env.MOCK_SCREEN_DROP)
      && process.env.MOCK_SCREEN_DROP !== "persist"
      && /record_fetch it|RE-DECIDE EACH/.test(msg);
    // Lifted OUT of the object literal so the accounting sweep below can see what is already accounted
    // for. Same rows as before; only their construction moved.
    const findingsRows = [
      ...uris.filter((u) => u !== dropUri).slice(0, 1).map((uri) => ({
        uri, flag_reason: "exact-match in an instructed class", verify: "no",
      })),
      ...(correctedAway && dropUri ? [{
        uri: dropUri,
        flag_reason: "re-decided on the fetched goods — in-field after all, carried as a conflict",
        verify: "no",
      }] : []),
    ];
    const rowsAccountedFor = new Set(findingsRows.map((r) => joinKey(r.uri)));
    // ── THE ACCOUNTING SWEEP, SPLIT THE WAY THE DOCTRINE SPLITS IT ────────────────────────────────
    //
    // Every owed record this call has not yet accounted for needs an exit, or the accounting refusal
    // fires. WHICH exit is not a free choice, and the first cut got it wrong: it swept everything into
    // drop rows, which made each one a goods-drop of a record the screen had surfaced and nobody had
    // fetched — precisely what the screen gate exists to catch. Six arms went red and they were right.
    //
    // So the split follows the driver's own followup wording: "RE-DECIDE EACH on its fetched goods —
    // KEEP IT AS A CONFLICT/FINDING if in-field". A seat that has not fetched a surfaced record cannot
    // rule its goods out, so it CARRIES it. Only records the screen itself put outside scope leave as
    // drops, and their grounds come from the band, so the ground can never contradict the verdict.
    //
    // The gate's own set, not the wider one used to choose the knob's drop: `deepfetch:ambiguous` is
    // not an in-scope-live candidate to the gate, so dropping it is honest and gate-safe.
    const GATE_SURFACING = /^(surface:in-scope-live|surface:all-class)$/;
    const verdictOf = (uri) => {
      const r = recs.find((x) => (x.record_id ?? x.uri) === uri);
      return String(r?.screen?.screen_verdict ?? r?.screen_verdict ?? "");
    };
    const sweptUris = (facts.owed ?? []).filter((k) => {
      if (!facts.recordsByUri.has(k)) return false;                     // unrenderable — no row a seat could send
      if (dropUri && k === joinKey(dropUri) && !correctedAway) return false;   // the knob already drops it
      return !rowsAccountedFor.has(k);
    }).map((k) => facts.recordsByUri.get(k)?.record_id ?? k);
    const sweptCarried = sweptUris.filter((u) => GATE_SURFACING.test(verdictOf(u)));
    const sweptDropped = sweptUris.filter((u) => !GATE_SURFACING.test(verdictOf(u)));
    for (const uri of sweptCarried) {
      findingsRows.push({ uri, flag_reason: "carried — the screen surfaced it and its goods were not ruled out on a fetched record", verify: "no" });
    }
    const rows = {
      findings_rows: findingsRows,
      // THE DROP'S SHAPE IS THE KNOB'S, and the DEFAULT must not trip the screen gate. The first cut
      // always emitted an off-field/relevance-gate reason, which matches GOODS_FIELD_RE and carries no
      // fetch receipt — so every run, knob or no knob, produced a violating drop row and the
      // no-violations control could never be clean. A fixture whose default is a violation cannot
      // witness the absence of one.
      negative_rows: [
        ...(dropUri && !correctedAway ? [dropUri] : []),
        // The accounting sweep's DROP half — records the screen itself put outside scope. The carried
        // half went into findings_rows above; see the note there for why the split is not a free choice.
        ...sweptDropped,
      ].map((uri) => ({
        uri,
        drop_reason: process.env.MOCK_SCREEN_DROP
          ? "dropped — off-field (relevance gate); inferred fashion"
          : "screened out — dead-status",
        // The closed ground token, DERIVED FROM THE BAND rather than chosen — which is what a compliant
        // seat does, and the first cut of this line was not. It labelled the default drop `dead-status`
        // whatever the record's verdict, and the acceptance boundary refused it by name on a record the
        // screen had surfaced as a live in-scope candidate. That refusal was correct and the fixture was
        // wrong: a mock that picks a ground the band contradicts is modelling a seat the transport
        // rejects, and it would have gone green only by the gate being absent.
        ground: (() => {
          const v = String(recs.find((r) => (r.record_id ?? r.uri) === uri)?.screen?.screen_verdict
            ?? recs.find((r) => (r.record_id ?? r.uri) === uri)?.screen_verdict ?? "");
          if (v === "drop:dead") return "dead-status";
          if (v === "drop:out-of-class") return "out-of-class";
          return "off-field";          // the screen surfaced it ⇒ the drop is the seat's own goods call
        })(),
        variant: "default",
      })),
      instructed_checks: [],
      // UNCONDITIONAL, and it used to key on the rulings tail being in the dispatch. That made the mock
      // emit a DIFFERENT document on a corrective pass from a fresh one — which the old prose fixture
      // never did, because its body was static. Once the driver renders this artifact, a fixture that
      // varies its own output across passes changes a file four stages hash for freshness, and the
      // non-split closure resume then died at delivery on "material that has since changed".
      //
      // Nothing asserted this row: the witness that the rulings tail actually reached the seat is the
      // `mock-rulings-tail.flag` written below and read by operability's arms, which is the better one
      // anyway — it records what the DISPATCH carried, independently of how the seat answered it.
      disagreement_resolutions: [{ subject: "LUMENGARDE", decision: "ADOPTED", reason: "the placement's tier stands on its stated reason" }],
      opposition: "No opposition history surfaced on the frozen band.",
    };
    // The dispatch-probe side files keep their meaning: they record what the DISPATCH carried, which is
    // independent of how the seat answers it.
    if (/PLACEMENT RULINGS TAIL \(verbatim from/.test(msg)) {
      mkdirSync(driverDir(runDir), { recursive: true });
      writeFileSync(driverDir(runDir, "mock-rulings-tail.flag"), "1");
    }
    if (/SETTLED COVERAGE FACTS/.test(msg)) {
      mkdirSync(driverDir(runDir), { recursive: true });
      appendFileSync(driverDir(runDir, "mock-settled-facts.log"), "carried\n");
    }
    // The coverage form is a SEPARATE transport and is filled exactly as before — two calls, two
    // statements. Folding it in here would model a merged key the grant does not have.
    fillCoverageForm(runDir, msg);
    const r = recordRegisterDigest(runDir, rows, { facts });
    if (r.refused) return `mock register-digest REFUSED by record_register_digest: ${r.refused}`;
    if (r.write_failed) return `mock register-digest: record_register_digest could not write (${r.write_failed})`;
    return `mock register-digest recorded through record_register_digest (${r.surfaced} surfaced, ${r.dropped} dropped)`;
  }
  if (/record_unit_note/.test(msg)) {
    const runDir = runDirFromWiring(argv);
    if (!runDir) return "mock unit-note: no run dir in the engine wiring — the driver wires CLEAROTRON_BAND_RUN_DIR per run and this branch refuses rather than guessing one";
    // THE BOUND AXIS IS READ FROM THE REAL ARGV, for the reason the report-card branch states: a mock that
    // parsed the axis out of the prose would file the right note while the production binding was broken,
    // and every test would stay green — the harness modelling the thing it is supposed to be proving.
    const bound = recordAxisFromWiring(argv);
    if (!bound) return "mock unit-note: no CLEAROTRON_RECORD_AXIS in the engine wiring — the driver did not bind an axis for this turn";
    const wroteBand = mockUnitBandWrite(runDir, bound, msg);
    recordMockToolCall(runDir, "record_unit_note", "unit-note");
    // The seat's half, and ONLY the seat's half: the three counts are the driver's, derived from the band
    // above. A fixture that typed them would be re-introducing the second authoring this conversion removed.
    // THE RE-EMIT MARKER, MOVED ONTO THE TYPED CALL. It used to be appended to the note's BYTES by the
    // fixture that wrote the file; the driver renders the note now, so it rides the one field the seat
    // still authors. The property is unchanged and load-bearing: a resume must produce a note that
    // DIFFERS from the prior one, or the driver's byte-diff sees no change and skips the re-digest the
    // escalation asked for. MOCK_ESCALATION_NOOP suppresses it — that knob's whole job is to force the
    // byte-identical re-emit whose skip is the thing under test.
    const resume = /RESUMING your own register-unit session/.test(msg);
    const marker = resume && !process.env.MOCK_ESCALATION_NOOP
      ? (/frame-INDEPENDENT re-derivation/.test(msg)
        ? " Re-derived independently of the blind frame on a supplemental sweep."
        : " Revised in place on the escalation re-run.")
      : "";
    const r = recordUnitNote(runDir, {
      axis: bound,
      null_result: process.env.MOCK_UNIT_NULL_RESULT === bound,
      note: `Swept ${bound} against the frozen plan; nothing in the returned material needed a second pass beyond what the band records.${marker}`,
    });
    if (r.refused) return `mock unit-note REFUSED by record_unit_note: ${r.refused}`;
    if (r.write_failed) return `mock unit-note: record_unit_note could not store the note (${r.write_failed})`;
    return `mock unit-note recorded through record_unit_note (band ${wroteBand ? "written" : "SKIPPED by a MOCK_NO_BAND knob"})`;
  }
  if (/record_blind_frame|record_skeptic|record_frame_diff|record_matter_frame|record_prelim_variants|record_report_overview|record_report_card|record_doubt_closure|record_narrative_refutation|record_synthesis/.test(msg)) {
    // — FROM THE ENGINE WIRING, NOT FROM `--add-dir` (runDirFromWiring above). This branch stands in for a RECORDING SERVER's
    // write, and a recording server learns its run from `CLEAROTRON_BAND_RUN_DIR` in the env gather-config
    // hands it (serverEnv() in driver/engine/mcp/gather-config.mjs) — never from the seat's directory
    // grant. Reading `--add-dir` instead made this harness consume a PERMISSION as a DATA CHANNEL, and
    // that coupling is not academic: it silently pinned the grant. Dropping the run-dir grant from the
    // eight `seatWrites:false` stages — which is exactly what asks for, and which touches nothing
    // these stages actually use — turned the suite 198 red, because the mock resolved the skills root and
    // refused. A suite that cannot express the change cannot falsify it, so it certified the old grant by
    // construction rather than by test. Same value either way (asserted in run-dir-grant-is-earned.test.mjs);
    // this one is the channel production actually uses.
    const runDir = runDirFromWiring(argv);
    // …and refuse rather than guess. A wrong dir here writes a run artifact into a source tree, which is
    // the kind of mess a green suite would hide: the stage would fail `missing_file` and the reason would
    // be somewhere else entirely.
    if (!runDir) return "mock blind-frame: no CLEAROTRON_BAND_RUN_DIR in the engine wiring";
    if (/(^|\/)(skills|profiles)$/.test(runDir)) return `mock blind-frame: CLEAROTRON_BAND_RUN_DIR is ${runDir}, not a run dir`;
    if (/record_skeptic/.test(msg)) {
      // MOCK_SKEPTIC carries the seat's answer in every existing scenario — "no flags surfaced" for a clean
      // audit, otherwise flag text. It is now split into VALUES rather than pasted into a file, which is what
      // the conversion did to the real seat: the sentinel is the driver's to render, so an empty array is how
      // "clean" is expressed and the words themselves are no longer a protocol.
      // THE KNOB KEEPS ITS OLD FORMAT AND IS TRANSLATED, rather than every scenario being rewritten.
      // MOCK_SKEPTIC holds what the seat used to WRITE — flag bullets, optionally a `## Escalation
      // decisions` section with `ESCALATE: <axis> — <reason>` lines (digest-funnel.pipeline.test.mjs drives
      // exactly that). Splitting it here is what the conversion did to the seat: the same decisions, sent as
      // values. Rewriting the scenarios instead would have changed what a dozen tests are ABOUT, and one of
      // them is the only test that drives an escalation through this stage at all.
      const raw = String(process.env.MOCK_SKEPTIC ?? "no flags surfaced");
      const [flagPart, escPart = ""] = raw.split(/^##\s*Escalation decisions\s*$/m);
      const flags = /^\s*no flags/i.test(flagPart)
        ? []
        : flagPart.split("\n").map((s) => s.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      const escalations = [...escPart.matchAll(/^ESCALATE:\s*(\S+)\s+—\s*(.+?)\s*$/gm)]
        .filter((m) => m[1] !== "none")
        .map((m) => ({ axis: m[1], reason: m[2] }));
      recordMockToolCall(runDir, "record_skeptic", "recording-skeptic");
      const r = recordSkeptic(runDir, { flags, escalations });
      // A REFUSED CALL MUST NOT READ AS A CLEAN TURN. The receiver returns its own verdict; if the mock's
      // translation produces something the production validator rejects, that is a harness bug and it says
      // so here rather than leaving the stage to fail later on a missing file.
      if (r && r.error) return `mock skeptic REFUSED by record_skeptic: ${r.error}`;
      return "mock skeptic recorded through record_skeptic";
    }
    // TWO RECORDING ARMS, FROM TWO BRANCHES, KEPT BOTH. The writer's and the reviewer's conversions
    // landed in the same hour and this file merged as a conflict because both added an arm here. They
    // are independent `if (/record_X/)` blocks and neither subsumes the other: resolving by taking one
    // side drops a whole stage's mock receiver, which reads downstream as that stage never writing its
    // artifact — a `missing_file` three hundred lines from its cause.
    //
    // The conflict cut MID-BLOCK: the shared tail below closes the LAST arm only, so this side needs its
    // own `}`. Concatenating the two sides without it balanced nothing and the file would not parse —
    // which is the honest failure, and the reason to resolve a structured file by rebuilding rather than
    // by splicing two halves that were never whole.
    //
    // Worth recording: the two arms reached the same conclusion independently. Both model a seat that
    // READS ITS REFUSAL AND RESTATES IN THE SAME TURN, because both conversions moved the catch from a
    // post-hoc validator to the call, and a mock that stops at the refusal models a seat that ignores an
    // error response — reporting the stage as exhausted where the PRODUCT withheld nothing.
    if (/record_synthesis/.test(msg)) {
      // THE WRITER. The mock drives the PRODUCTION receiver rather than writing the two files, for the
      // same reason every arm here does: a fixture that wrote narrative.md and findings.json would be
      // the mock taking the path this conversion deleted, and it would hide the one thing the
      // conversion is proven by — whether the call was made at all.
      //
      // The findings doc comes from `synthesisFindings`, unchanged, so every knob that shapes it
      // (MOCK_BAD_FINDING, MOCK_ACTIONS, the ask-answer and action defect knobs) keeps working and keeps
      // meaning the same thing. What changed is where the bytes come from: the seat's values now go
      // through the receiver, which renders them.
      //
      // COVERAGE ROWS AND ASK ANSWERS RIDE THE RECORD, not the narrative — there is one authored set of
      // each and the driver renders the readable copy. A mock that put them on the narrative would be
      // asserting a shape the receiver refuses.
      // ── A SEAT THAT IS REFUSED READS THE REFUSAL AND RESTATES, IN THE SAME TURN ──────────────────
      //
      // The four record knobs (MOCK_BAD_FINDING, MOCK_ACTIONS=absent|condition-broken,
      // MOCK_ASK_ANSWER_BAD) each heal on a PHRASE IN THE DISPATCH MESSAGE — "failed the strict parse",
      // `"actions" register`, and so on — because before the conversion the defect was written to disk,
      // caught by a validator, and repaired by the driver re-dispatching the stage with a composer that
      // NAMED the family. Those phrases still exist in those composers.
      //
      // They no longer arrive, and that is the conversion working rather than breaking. The record is
      // validated AT THE CALL, so the seat is refused with a token-first reason in the turn where
      // restating is free — which is exactly what the dispatch promises it. Nothing is written, no
      // validator runs, and the driver never re-dispatches, so no composer's phrase is ever composed.
      //
      // A mock that stopped there would model a seat that reads a refusal and ignores it, and the run
      // would exhaust — which is what it did: `missing_file: narrative.md`, terminalKind exhausted, on
      // three tests whose whole subject is that the run RECOVERS. So the mock restates once, the way a
      // competent seat does, by re-deriving with the family's own heal phrase. It restates ONCE: a
      // second refusal is returned, so a genuinely unfixable call still fails rather than looping.
      const build = (m) => JSON.parse(synthesisFindings(runDir, m));
      let doc;
      try { doc = build(msg); }
      catch (e) { return `mock synthesis: could not build the findings record (${String(e?.message ?? e).slice(0, 120)})`; }
      // THE MOCK CARRIES THE RUN'S OWN LIMITS, because a compliant seat does. The receiver refuses a
      // coverage account that is clean throughout when the register ledger records a slice as less than
      // clean — doctrine, not a new rule: "a unit recorded coverage-limited can never be written as a
      // clean negative". Driven under MOCK_LEDGER_LIMITED the old fixture claimed clean throughout and
      // was refused, correctly. Deriving the carried row from the ledger rather than hardcoding one
      // keeps the knob meaning what it says: turn the knob, the run carries the limit.
      try {
        const led = JSON.parse(readFileSync(join(runDir, "register-coverage-ledger.json"), "utf8"));
        const lim = (Array.isArray(led) ? led : []).filter((r) => r?.status && r.status !== "confirmed-clean" && r.status !== "note");
        if (lim.length && !(doc.coverage ?? []).some((c) => c?.state && c.state !== "confirmed-clean" && c.state !== "note")) {
          doc.coverage = [...(doc.coverage ?? []), { area: `register / ${lim[0].axis}`, state: "coverage-limited", note: String(lim[0].reason ?? "recorded limited by the register ledger") }];
        }
      } catch { /* no ledger on this run — the receiver's own could-not-look branch covers it */ }
      // ── THE NARRATIVE KNOBS, TRANSLATED RATHER THAN LOST ─────────────────────────────────────────
      //
      // They lived in the `narrative.md` fixture body, which no longer runs — the driver renders that
      // file from this call. A knob whose effect stopped reaching the artifact is a knob that silently
      // stopped meaning anything, and `corrective-cycle` caught exactly that: MOCK_NARRATIVE_OVER_CAP
      // stopped breaching the cap, so the lint repair never rewrote narrative.md, the reviewer never
      // went stale, and the delivery stale-repair pass never fired. The test failed on its own
      // PRECONDITION, which is the honest shape — it says "the pass fired at all" and it had not.
      //
      // Same rule the skeptic arm states: THE KNOB KEEPS ITS OLD FORMAT AND IS TRANSLATED, rather than
      // every scenario being rewritten.
      //
      // — the over-cap write-up, on the FIRST emission only, healing on the lint-repair redo.
      // Keyed on narrative.md not yet existing, so the redo is recognised by run state rather than by
      // matching the repair prompt's wording, which the composer is free to change. It goes in the
      // SPINE because that is the section the write-up prose renders into.
      const overCap = (process.env.MOCK_NARRATIVE_OVER_CAP && !existsSync(join(runDir, "narrative.md")))
        ? " " + "the cited registration covers the identical mark in the searched class and remains material here. ".repeat(40)
        : "";
      // MOCK_CANDSELF — the applicant-unknown note, on the same condition the fixture used.
      const candSelf = (process.env.MOCK_CANDSELF && /APPLICANT UNKNOWN|own prior filing, disregard/i.test(msg))
        ? " If this is the applicant's own prior filing, disregard."
        : "";
      // MOCK_NARRATIVE_RECO — the forbidden "commission a re-run" coverage form. ITS FAILURE MOVED, and
      // that is the knob's new truth rather than a break: the transport refuses this at the CALL now,
      // where the seat can restate it, instead of letting it reach the validator. The mock returns the
      // refusal, which is what a seat would see.
      const reco = process.env.MOCK_NARRATIVE_RECO
        ? "Non-Latin marketplace coverage remains open; a targeted re-run before client sign-off is the next step."
        : "The instructed registers were enumerated to completeness on the named band.";
      recordMockToolCall(runDir, "record_synthesis", "recording-synthesis");
      const sections = {
          // THE SUBSTANCE IS THE OLD FIXTURE'S, and it has to be: downstream reads the narrative TEXT —
          // the deterministic registry check runs findRegistryArithmeticIssues / findRegistryViolations
          // over it, and the pre-delivery lint joins its claims to the finding set. A thinner mock
          // narrative failed delivery, which is the harness correctly refusing a document that says less
          // than the record it ships beside. What moved is who assembles it, not what it contains.
          spine: "Dominant-element analysis. Watchlist owner BigCo noted. Overall Level-3 band; flat spread across candidates."
            + "\n\n### Finding 1 — PROJECT NOVAPULSE — Mystery Owner LLC (US, Cl. 9)\n**Composite — 4 (High).**\nIdentical registration in the searched class."
            + candSelf + overCap,
          verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
          coverage: { read: reco },
      };
      let r = recordSynthesis(runDir, { findings: doc, narrative: sections });
      if (r && r.refused) {
        // The refusal names the family. Re-derive with that family's heal phrase and restate once —
        // the phrase per knob is the one `synthesisFindings` keys on, so this drives the SAME heal the
        // driver's named composer used to drive, from the seat's side of the same defect.
        // SPECIFIC FAMILIES FIRST, AND THAT ORDER IS THE WHOLE CORRECTNESS OF IT. The parser names an
        // ask_answers defect `finding_ask_answer_key_unknown` and an action defect `finding_action_*` —
        // BOTH match a generic `finding_..._key_unknown` test, so a generic-first ladder swallows its
        // two neighbours and hands them the wrong heal phrase. Measured: the finding arm healed and
        // these two exhausted, which is the same failure the arms started with and reads identically.
        const heal = /ask_answer/.test(r.refused) ? 'the "ask_answers" array'
          : /action/.test(r.refused) ? 'the "actions" register'
          : /finding_|findings_/.test(r.refused) ? "failed the strict parse"
          : null;
        if (heal) {
          try { doc = build(`${msg}\n${heal}`); } catch { /* keep the first doc; the refusal below stands */ }
          r = recordSynthesis(runDir, { findings: doc, narrative: sections });
        }
      }
      // ── THE DECLINATION RUNG: what a compliant seat does when the duty refuses ──────────────────
      //
      // — a record that reached the findings surface leaves as a finding or as a
      // declination, and the transport refuses a call that accounts for neither. This fixture delivered
      // ONE finding whatever the surface held, so it modelled a seat the transport now rejects.
      //
      // IT DECLINES THROUGH THE REAL TRANSPORT, not by writing the ledger. `recordDeclinations` is what
      // the `record_declination` server calls, so this exercises the acceptance path the seat actually
      // meets — the closed reason vocabulary, the grounds floor, the discretionary-reason refusal over a
      // live identical mark, and the per-record bound. Writing the ledger directly would model a seat
      // that cannot exist and would skip the machinery this arm is here to keep honest.
      //
      // ONE PASS, NO LOOP. The seat declines what it did not deliver and restates once; if the duty
      // still refuses, the refusal is returned as a seat would see it. A retry loop here would hide a
      // real live-lock behind the fixture's persistence.
      if (r && r.refused && /synthesis_unaccounted_records/.test(r.refused)) {
        try {
          const spec = JSON.parse(readFileSync(driverDir(runDir, "declination-spec.json"), "utf8"));
          const delivered = new Set([...findingUris(Array.isArray(doc?.findings) ? doc.findings : []).keys()]);
          const rows = Array.isArray(spec?.rows) ? spec.rows : [];
          const declinations = rows.map((row, i) => ({ row, i }))
            .filter(({ row }) => !delivered.has(normalizeRecordUri(row?.uri)))
            .map(({ i }) => ({
              row_index: i,
              reason: "unrelated-goods",
              grounds: "The goods sit in a different field from the instructed classes and the overlap is "
                + "retail-shelf only, so this record does not earn a line in the opinion.",
            }));
          if (declinations.length) recordDeclinations({ runDir, rows, scope: spec?.scope ?? {} }, { declinations });
        } catch { /* the restate below stands; its refusal is what a seat would see */ }
        r = recordSynthesis(runDir, { findings: doc, narrative: sections });
      }
      if (r && r.refused) return `mock synthesis REFUSED by record_synthesis: ${r.refused}`;
      if (r && r.write_failed) return `mock synthesis: record_synthesis could not store the call (${r.write_failed})`;
      // The side-write the old narrative.md branch carried. Same guard it had — CANDSELF and the
      // reco knob both suppressed it there, and both still do.
      if (!process.env.MOCK_CANDSELF && !process.env.MOCK_NARRATIVE_RECO) mockRegisterRecordWrite(runDir, argv);
      return "mock synthesis recorded through record_synthesis";
    }
    if (/record_narrative_refutation/.test(msg)) {
      // CONVERSION 9 — the reviewer. The four knobs keep their old spellings and are TRANSLATED into
      // values, the same choice conversion 8 made for MOCK_SKEPTIC: rewriting a dozen scenarios would
      // change what those tests are about, and one of them is the only test that drives a late-hardening
      // review at all.
      //
      // MOCK_VERDICT              the verdict (default CLEAR)
      // MOCK_VERDICT_DEFECTS      bullet lines that make a BLOCKING reasoned rather than degenerate
      // MOCK_DEGENERATE_HEALS     this seat CORRECTS when the tool tells it what is wrong
      // MOCK_REVIEW_BLOCKS_AFTER_VERDICT   the  late hardening, keyed on verdict.json existing
      //
      // ✕ `plan_audit`, NOT `planAudit`. `acceptRefutation` reads the TOOL SCHEMA's spelling. Handing it
      // the camelCase name leaves the field undefined and the call is refused as
      // `refutation_plan_audit_missing` — a reason that names the field it wanted and still reads like a
      // missing audit rather than a misspelled key. Cost an hour; measured, not guessed.
      const planAudit = /PLAN-EXECUTION CHECK/.test(msg)
        ? ["Audited the execution receipt — no clean claim rests on a missing/incomplete slice."] : [];
      // ✕ `refused`, NOT `error`. recordRefutation returns {written, refused, write_failed} — there is no
      // `error` key, so a check for one can never fire and every refusal would read as a clean turn.
      const bad = (r) => r?.refused ?? r?.write_failed ?? null;
      const send = (payload) => {
        const r = recordRefutation(runDir, payload);
        recordMockToolCall(runDir, "record_narrative_refutation", "recording-narrative-refutation");
        return r;
      };

      if (process.env.MOCK_REVIEW_BLOCKS_AFTER_VERDICT && runDir && existsSync(driverDir(runDir, "verdict.json"))) {
        // The audit rides UNCONDITIONALLY here. The stale-repair dispatch does not re-demand it, so a
        // msg-conditional mock would fail that pass on `plan_audit_missing` and the arm would go
        // green on the wrong ending. That missing demand is a real second defect, filed separately.
        const r = send({ verdict: "BLOCKING",
          plan_audit: planAudit.length ? planAudit
            : ["Audited the execution receipt — no clean claim rests on a missing/incomplete slice."],
          flags: [{ kind: "fact",
            text: "the registration date printed in the narrative contradicts the fetched record (mock)" }] });
        return bad(r) ? `mock reviewer REFUSED by record_narrative_refutation: ${bad(r)}`
          : "mock reviewer recorded a late BLOCKING through record_narrative_refutation";
      }

      const verdict = process.env.MOCK_VERDICT ?? "CLEAR";
      // MOCK_VERDICT_DEFECTS held the bullet lines the seat used to WRITE. Each becomes one flag. `fact`
      // is the right default and not a shrug: every scenario that sets this knob names something the
      // narrative got wrong against the file, which is that kind's definition.
      const flags = String(process.env.MOCK_VERDICT_DEFECTS ?? "")
        .split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
        .map((text) => ({ kind: "fact", text }));
      let r = send({ verdict, flags, plan_audit: planAudit });

      // ── THE SEAT CORRECTS IN THE TURN, WHICH IS THE WHOLE POINT OF REFUSING AT THE CALL ────────────
      //
      // A BLOCKING citing nothing is refused by `acceptRefutation` where it is typed. Before the
      // conversion that shape reached the gate, which spent one forced re-ask of the entire stage on it.
      // Now the seat is told immediately and answers in the same turn — the repair moved earlier and got
      // cheaper, and the client outcome is unchanged.
      //
      // MOCK_DEGENERATE_HEALS is what makes this seat one that corrects. A mock that took the refusal and
      // gave up would model a seat that ignores an error response, and would report the stage exhausting
      // as though the PRODUCT withheld a report — which it does not.
      if (bad(r) && process.env.MOCK_DEGENERATE_HEALS) {
        r = send({ verdict: "CONDITIONAL", plan_audit: planAudit,
          flags: [{ kind: "narrative", text: "residual noted after the call refused an uncited refusal (mock)" }] });
        return bad(r) ? `mock reviewer REFUSED twice by record_narrative_refutation: ${bad(r)}`
          : "mock reviewer corrected to CONDITIONAL in-turn after record_narrative_refutation refused";
      }
      return bad(r) ? `record_narrative_refutation refused this review: ${bad(r)}`
        : `mock reviewer recorded ${verdict} through record_narrative_refutation`;
    }
    if (/record_doubt_closure/.test(msg)) {
      // CONVERSION 6 — and the spec sidecar is READ FROM DISK, not re-derived from the prompt. The driver
      // writes `_driver/doubt-closure-spec.json` before dispatching; the real server reads it there. A
      // mock that parsed the ids and the file order back out of the message would keep every test green
      // while the sidecar was missing or mis-ordered — the harness modelling the thing it is meant to be
      // proving, which is the same trap conversion 5's binding hit.
      let spec = null;
      try { spec = JSON.parse(readFileSync(driverDir(runDir, "doubt-closure-spec.json"), "utf8")); }
      catch { return "mock doubt-closure: no readable _driver/doubt-closure-spec.json — the driver did not write the spec before dispatch"; }
      const allowedFiles = Array.isArray(spec?.allowedFiles) ? spec.allowedFiles : [];
      const openIds = Array.isArray(spec?.openIds) ? spec.openIds : [];
      if (!allowedFiles.length) return "mock doubt-closure: the spec names no citable files";
      recordMockToolCall(runDir, "record_doubt_closure", "recording-doubt-closure");

      // A REAL verbatim quote, read from the file the mock is about to cite BY POSITION — so the driver's
      // mechanical re-verification has something real to verify rather than a string the fixture invented.
      // register-findings.md is markdown and quotes cleanly, so cite that position wherever it sits.
      const mode = process.env.MOCK_CLOSURE_MODE || "";
      const idx = Math.max(0, allowedFiles.indexOf("register-findings.md"));
      let quote = null;
      try {
        quote = readFileSync(join(runDir, allowedFiles[idx]), "utf8").split("\n")
          .map((l) => l.trim())
          .find((l) => l.length >= 20 && l.length <= 180 && !l.includes('"') && !l.includes("—"))
          ?.slice(0, 180) ?? null;
      } catch { /* nothing citable in this scenario — every row goes open below */ }
      if (mode === "fabricate") quote = "a sentence that appears in no file this stage may cite";

      // The ids are the SPEC's, and their kind is read off the id shape the ledgers already use. Mixed on
      // purpose, exactly as the retired line fixture was: the last of each kind stays OPEN so one mock run
      // exercises settle, immaterial and open together.
      const doubtIds = openIds.filter((id) => !String(id).startsWith("ask:"));
      const askIds = openIds.filter((id) => String(id).startsWith("ask:"));
      const closures = [];
      doubtIds.forEach((id, i) => {
        const last = i === doubtIds.length - 1;
        closures.push(quote && mode !== "open" && !(last && doubtIds.length > 1)
          ? { kind: "doubt", doubt_id: id, verdict: "settled", file_index: idx, quote, reason: "the register spine answers this doubt on its face" }
          : { kind: "doubt", doubt_id: id, verdict: "open", reason: "no on-disk evidence answers it; the reviewing lawyer decides" });
      });
      askIds.forEach((id, i) => {
        const last = i === askIds.length - 1;
        closures.push(quote && mode !== "open" && !(last && askIds.length > 1)
          ? { kind: "ask", doubt_id: id, verdict: "immaterial", file_index: idx, quote, reason: "the slice it asks about is off the dangerous band for this matter" }
          : { kind: "ask", doubt_id: id, verdict: "open", handoff: "carry it to the reviewing lawyer with the run" });
      });
      if (!closures.length) return "mock doubt-closure: the spec listed no open ids, so there was nothing to rule on";
      const r = recordClosures({ runDir, openIds, allowedFiles,
        fileTexts: Object.fromEntries(allowedFiles.map((f) => {
          try { return [f, readFileSync(join(runDir, f), "utf8")]; } catch { return [f, ""]; }
        })) }, { closures });
      return `mock doubt-closure: ${r.accepted} accepted, ${r.refused.length} refused, ${r.still_open.length} still open`;
    }
    if (/record_report_card/.test(msg)) {
      // CONVERSION 5 — and THE BOUND ORDINAL IS READ FROM THE REAL ARGV, not re-derived from the prompt.
      //
      // The driver binds the card index by putting `CLEAROTRON_RECORD_AXIS` into the recording server's env
      // inside `--mcp-config`. Reading it back out of that same JSON is what makes this harness able to
      // FAIL when the binding breaks: a mock that parsed the ordinal out of the message would write the
      // right card while the production binding was broken, and every test would stay green — the
      // harness modelling a stage it is supposed to be proving.
      let bound = null;
      try {
        const i = argv.indexOf("--mcp-config");
        const cfg = i >= 0 && argv[i + 1] ? JSON.parse(argv[i + 1]) : null;
        bound = cfg?.mcpServers?.["recording-report-card"]?.env?.CLEAROTRON_RECORD_AXIS ?? null;
      } catch { /* malformed config — `bound` stays null and the receiver refuses by name */ }
      if (!bound) return "mock report-card: no CLEAROTRON_RECORD_AXIS in the resolved mcp config — the driver did not bind a card index";
      recordMockToolCall(runDir, "record_report_card", "recording-report-card");
      // The fixture's own prose, sent as VALUES. `reportCardFixture` still exists and still writes the
      // OLD self-framed shape — it is the ARCHIVE path's witness now (carriesOwnFrame), and a test drives
      // it deliberately rather than it being what every card run happens to produce.
      // THE PROSE IS DERIVED FROM THE FINDING, and that is load-bearing rather than decorative. A real
      // seat writes about the finding it was handed, so its sentences move when the finding moves —
      // which is the only reason a stale card is OBSERVABLE at all. Conversion 5 took the `## <owner>`
      // head out of this file (card-frame.mjs composes it at assembly from findings.json), so the
      // knob's chosen field, owner.name, stopped appearing in the card and the freshness assertion
      // lost its subject. Echoing it here restores the coupling the knob was built on.
      //
      // This does NOT weaken the guard, and the distinction matters: the name is read at CALL TIME. A
      // driver that re-rendered a stale RECORDED CALL instead of dispatching a fresh turn would emit the
      // pre-edit name and the assertion would still fail. What is asserted is the payload's provenance,
      // not the presence of a string the harness could always supply.
      let owner = "Mystery Owner LLC";
      try {
        const fj = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8"));
        owner = (fj.findings ?? []).find((x) => String(x.ordinal) === String(bound))?.owner?.name || owner;
      } catch { /* no findings yet — the default names the fixture's own owner */ }
      const r = recordReportCard(runDir, {
        ordinal: String(bound),
        full_detail: [
          { lead: "Filing", text: `Mock filing detail for ${owner}.` },
          // D3 — the read bullet is REQUIRED of a real seat (reportcard_read_lead_missing), so the
          // mock that stands in for one carries it. A fixture that would be refused in production is not
          // a mock of production: without this the acceptance change reds every mocked card run, and
          // "fix the fixture" would have been the wrong reading of a correct red.
          { lead: "Risk assessment", text: `Mock risk read for ${owner}.` },
          { text: "mock internal reviewer note", internal: true },
        ],
      }, { boundOrdinal: String(bound) });
      if (r && (r.error || r.refused)) return `mock report-card REFUSED by record_report_card: ${r.error ?? r.refused}`;
      return `mock report-card ${bound} recorded through record_report_card`;
    }
    if (/record_report_overview/.test(msg)) {
      // CONVERSION 4 — the SHELL, and the knob-translation rule again. The retired fixture wrote
      // front-matter the seat typed key by key, a dictated `### ` sub-heading and a bullet whose source
      // link was laid out by hand. Every one of those is the driver's now, so what the mock sends is what
      // the seat sends: the caption, the checks, and the notes.
      recordMockToolCall(runDir, "record_report_overview", "recording-report-overview");
      // MOCK_PERMISSION_PROSE RIDES `methodology`, and it has to ride SOMETHING. It is PR-5's gate-closing
      // scenario — a false "tool was blocked" line in the shell that evaluateClientGate must catch — so a
      // conversion that quietly dropped it would retire a live lint scenario while every test still
      // passed. The seat can no longer author a stray section, but it can still say this in a scope note,
      // which is the honest post-conversion shape of the same defect.
      const permNote = process.env.MOCK_PERMISSION_PROSE
        ? "Register note: register_enumerate was blocked by a tool-permission gate this run." : "";
      const r = recordReportOverview(runDir, {
        overall_caption: "mock composite 3",
        actions: [{ text: "Mock use-check: none found", source_link: "https://x.example" }],
        methodology: [permNote, "Common-law: marketplace storefronts + web/social/press; variant families swept; one listing surfaced, remainder clean."]
          .filter(Boolean).join(" "),
      });
      // A REFUSED CALL MUST NOT READ AS A CLEAN TURN — the sibling rule, stated at every branch.
      // The redo turn stales findings.json exactly as it did before the conversion — the incident shape
      // is about what the REDO moves, not about how the shell reaches disk.
      stalefindingsOnLintRepair(runDir, msg);
      if (r && (r.error || r.refused)) return `mock report-overview REFUSED by record_report_overview: ${r.error ?? r.refused}`;
      return "mock report-overview recorded through record_report_overview";
    }
    if (/record_prelim_variants/.test(msg)) {
      // CONVERSION 3. `variantManifestModelFixture()` already holds exactly the object the seat used to
      // save, so it is parsed and SENT rather than written — the knob-translation rule again. The scope
      // ledger rows are new: the seat used to lay them out as a markdown table the driver parsed back,
      // and they are typed now, so the fixture states them as rows.
      recordMockToolCall(runDir, "record_prelim_variants", "recording-prelim-variants");
      // `incumbent_classes` IS SENT, and the conversion is what made it necessary — this is the fixture's
      // two halves being reconciled, not a workaround. The retired PROSE fixture asserted
      // "industry_incumbent_alert present" in words while the STRUCTURED fixture beside it carried no
      // `incumbent_classes` at all: `decideAxes` matched the word and pushed the incumbent-class axis,
      // and `register-plan.mjs` — which keys on `manifest.incumbent_classes.length` — saw nothing. Two
      // halves of one fixture disagreeing about whether this matter has an incumbent alert, which is the
      // exact defect class the conversion removes. Now there is one answer and both readers get it.
      const r = recordPrelimVariants(runDir, {
        ...JSON.parse(variantManifestModelFixture()),
        incumbent_classes: ["9"],
        // — the floor designation, TYPED. MOCK_STAR_FLOOR had to smuggle a ⭐ into a scope-ledger
        // row's free text because no field could carry one; this is the field the retirement said the
        // capability would need before it could come back. Absent by default: the standing fixture
        // designates no floor, which is the ordinary case and keeps every other mock arm on the
        // no-designation path.
        ...(process.env.MOCK_SEARCH_FLOOR ? { search_floor: [process.env.MOCK_SEARCH_FLOOR] } : {}),
        scope_ledger: [
          { layer: "variant", item: "phonetic-family", status: "applied", reason: "sound-alike neighbours are in scope for this mark", reopen_trigger: "" },
          { layer: "field", item: "game software", status: "applied", reason: "goods-overlap with the product", reopen_trigger: "" },
          { layer: "jurisdiction", item: "EU", status: "applied", reason: "instructed territory", reopen_trigger: "" },
          { layer: "jurisdiction", item: "CN", status: "dropped", reason: "not instructed and no signalled market", reopen_trigger: "a CN filing or a CN storefront listing surfaces" },
          { layer: "source", item: "developer ecosystems", status: "dropped", reason: "off-channel for this product", reopen_trigger: "a developer-channel listing surfaces" },
        ],
      });
      if (r && (r.error || r.refused)) return `mock prelim-variants REFUSED by record_prelim_variants: ${r.error ?? r.refused}`;
      return "mock prelim-variants recorded through record_prelim_variants";
    }
    if (/record_matter_frame/.test(msg)) {
      // CONVERSION 2. The knob translation rule again: `MOCK_MEANING_ANGLES` and `MOCK_INTAKE_ASKS` keep
      // their exact old formats — what the seat used to TYPE — and are parsed into the fields the seat now
      // SENDS. Rewriting a dozen scenarios would change what those tests are about; this changes only how
      // the same answer is handed over, which is what the conversion did to the real seat.
      //
      // NO instructed-scope echo. The mock used to reproduce the seat's retyping of the job fields so the
      // string-compare would pass; the driver stamps that section now, so a mock that still echoed it
      // would be standing in for a duty no seat has.
      const anglesRaw = String(process.env.MOCK_MEANING_ANGLES || "none");
      const none = /^\s*none\s*$/i.test(anglesRaw);
      const asksRaw = String(process.env.MOCK_INTAKE_ASKS || "");
      const intake_asks = [...asksRaw.matchAll(/^-\s*ask:\s*"([^"]+)"\s*(?:\|\s*owner:\s*([a-z-]+))?/gim)]
        .map((m) => ({ ask: m[1], owner: (m[2] || "synthesis").toLowerCase() }));
      recordMockToolCall(runDir, "record_matter_frame", "recording-matter-frame");
      const r = recordMatterFrame(runDir, {
        prose_body: PAD("Client: ACME Interactive. Sector: gaming software.\n"
          + "Materially-matters jurisdictions: EU, US, NZ, PH, RU, FR.\n"
          + "Off-field sectors: fintech. Watchlist-owner seeds: BigCo.\n"
          + "Class scope: cl. 9 in scope (the software itself); cl. 41 in scope (play services).\n"
          + "Applicant's own & affiliated marks: ACME Interactive and its house marks.", 260),
        scope_basis: "instructed",
        scope_jurisdictions: ["EU", "US", "NZ", "PH", "RU", "FR"],
        excluded_jurisdictions: [],
        search_channels: [],
        meaning_angles: none ? [] : anglesRaw.split(";").map((x) => x.trim()).filter(Boolean),
        meaning_angles_none: none,
        intake_asks,
      });
      // A REFUSED CALL MUST NOT READ AS A CLEAN TURN — the same rule as the two branches below.
      if (r && (r.error || r.refused)) return `mock matter-frame REFUSED by record_matter_frame: ${r.error ?? r.refused}`;
      return "mock matter-frame recorded through record_matter_frame";
    }
    if (/record_frame_diff/.test(msg)) {
      // THE KNOB IS TRANSLATED, NOT REWRITTEN. `MOCK_FRAME_DIFF` already holds exactly the object the seat
      // used to save — clean / reopen / source / field-classgap, driving four different downstream arms —
      // so it is parsed and SENT rather than written. Rewriting the scenarios would change what a dozen
      // tests are about, and `frameDiffModel()` stays the single place their shapes live.
      recordMockToolCall(runDir, "record_frame_diff", "recording-frame-diff");
      const r = recordFrameDiff(runDir, JSON.parse(frameDiffModel()));
      // A REFUSED CALL MUST NOT READ AS A CLEAN TURN — same rule as the skeptic branch. If the mock's
      // fixture produces something the production parser rejects (an undispatchable firing directive, say),
      // that is a harness bug and it says so here rather than leaving the stage to fail on a missing file
      // two steps later with the cause somewhere else.
      if (r && (r.error || r.refused)) return `mock frame-diff REFUSED by record_frame_diff: ${r.error ?? r.refused}`;
      return "mock frame-diff recorded through record_frame_diff";
    }
    if (process.env.MOCK_NO_BLIND_MODEL) return "mock blind-frame: no call made (MOCK_NO_BLIND_MODEL)";
    recordMockToolCall(runDir, "record_blind_frame", "recording-blind-frame");
    recordBlindFrame(runDir, JSON.parse(blindFrameModel()));
    return "mock blind-frame recorded through record_blind_frame";
  }
  // ── KNOCKOUT lane: the frame plan + the assess chunks. Both are derived from the DRIVER's
  // own dictated inputs (instructed scope / the chunk's mark list + frozen framework), mirroring what a
  // faithful model turn would emit — so the $0 mock e2e exercises the real validators end to end.
  // ── CONVERTED ( item C) — KEYED ON THE CALL, NOT ON DICTATED PATHS ─────────────
  //
  // This branch used to trigger on the two paths the dispatch named and write both files itself. The
  // conversion removes both paths, so that trigger matches nothing and the branch would never fire.
  //
  // The instructed-scope pointer is still read from the message, and that is not an oversight: it is a
  // READ the dispatch still names, not a write order. The frame seat is told where the authoritative mark
  // list is, and the mock resolves it the same way a seat would.
  if (/record_knockout_frame/.test(msg)) {
    const runDir = runDirFromWiring(argv);
    if (!runDir) return "mock knockout-frame: no run dir in the engine wiring — the driver wires CLEAROTRON_BAND_RUN_DIR per run and this branch refuses rather than guessing one";
    recordMockToolCall(runDir, "record_knockout_frame", "recording-knockout-frame");
    const scopePath = msg.match(/quote mark names verbatim from it\):\s*(\/\S+instructed-scope\.json)/)?.[1];
    let names = ["MOCKMARK"];
    try { const sc = JSON.parse(readFileSync(scopePath, "utf8")); if (Array.isArray(sc.marks) && sc.marks.length) names = sc.marks; } catch { /* fallback */ }
    const plan = {
      schema: 1,
      batch: { productContext: "mock consumer product line", umbrellaBrandNote: null, executionOrder: [...names] },
      marks: names.map((n, i) => ({ ref: null, name: n, classes: [9], beltAndBraces: [35],
        classesPlain: "software (9); retail services (35, belt-and-braces)",
        contextFraming: /[aeiou]{2}|q[^u]/i.test(n) ? "coined/fanciful term" : "brand-like compound",
        priorKnowledge: null, priority: i + 1 })),
    };
    // THE NOTE'S BYTES ARE UNCHANGED, deliberately. This conversion moves who writes the file and not
    // what it says, so the mock sends the exact string it used to write — trailing newline included,
    // since the driver writes scope_note verbatim and adds nothing.
    const scope_note = "Mock knockout frame: " + names.join(", ") + " — software batch, belt-and-braces retail.\n";
    // THE DRIVER WRITES BOTH FILES, THROUGH THE REAL TRANSPORT. A fixture that kept writing them would
    // keep every e2e green through a conversion that had broken the transport entirely.
    const verdict = recordKnockoutFrame(runDir, { ...plan, scope_note });
    if (!verdict.written) return `mock knockout-frame: the transport refused the composed plan — ${verdict.refused ?? verdict.write_failed}`;
    return "mock knockout frame ok";
  }
  // — one typed knockout finding per mark whose HELD payload carries a citable URL. The URL comes
  // off the payload rather than out of the mock, so the receipts gate is exercised for real: an invented
  // link here would fail the same check a model's would.
  const koMockFindings = (runDir, mark, band) => {
    let payload = "";
    try { payload = readFileSync(join(runDir, "research", `${kebab(mark)}.md`), "utf8"); } catch { return []; }
    const url = payload.match(/https?:\/\/[^\s)"'<>]+/)?.[0];
    if (!url) return [];
    return [{
      ordinal: 1, name: `${mark} storefront listing`, owner: "not established on the searched material",
      band, net: `The listing is unlikely to knock ${mark} out at this depth.`, type: "Active Business",
      evidence: [url], basis: "One marketplace listing on the payload held for this mark, with no wider reach recorded.",
    }];
  };
  // ── CONVERTED ( item B) — KEYED ON THE CALL, NOT ON A DICTATED PATH ────────────
  //
  // This branch used to trigger on the path the dispatch named, and derive both the run dir and the
  // chunk number by parsing it. The conversion removes the path from the dictation entirely, so that
  // trigger now matches nothing and the branch would simply never fire — the mock would fall through,
  // write no chunk, and three e2e arms would fail three layers downstream on "queue entry consumed as
  // .done" rather than here.
  //
  // Both values now come from the WIRING, through the same two readers every other converted branch
  // uses: the run dir from CLEAROTRON_BAND_RUN_DIR and the chunk ordinal from CLEAROTRON_RECORD_AXIS, each read
  // from argv's --mcp-config or the codex TOML so the branch is engine-neutral by construction. That is
  // the same channel the real recording server reads, which is the point: the mock resolves its chunk
  // the way production does, so a binding that broke would red here instead of being papered over.
  if (/record_knockout_assess/.test(msg)) {
    const runDir = runDirFromWiring(argv);
    if (!runDir) return "mock knockout-assess: no run dir in the engine wiring — the driver wires CLEAROTRON_BAND_RUN_DIR per run and this branch refuses rather than guessing one";
    const boundChunk = recordAxisFromWiring(argv);
    if (boundChunk === null) return "mock knockout-assess: no chunk ordinal bound in the engine wiring — the driver binds CLEAROTRON_RECORD_AXIS per fanned turn, and a mock that picked its own chunk would author the identity the membership join checks";
    recordMockToolCall(runDir, "record_knockout_assess", "recording-knockout-assess");
    let ladder = ["Very High", "High", "Medium", "Manageable", "Low"];
    let fwKey = "house-triage";
    try { const fw = JSON.parse(readFileSync(driverDir(runDir, "framework.json"), "utf8")); ladder = fw.bands.map((b) => b.label); fwKey = fw.framework_key; } catch { /* default */ }
    const listM = msg.match(/names verbatim\):\s*([^\n]+)\./);
    const rows = (listM ? listM[1].split("·").map((x) => x.trim()) : ["MOCKMARK"]).filter(Boolean);
    const degradedSet = new Set([...msg.matchAll(/^- (.+?):\s+\/\S+\s+\(DEGRADED/gm)].map((m) => m[1]));
    const band = process.env.MOCK_KO_BAND || ladder[ladder.length - 2] || ladder[0];   // second-lowest by default
    const chunk = {
      ...(Number(boundChunk) === 0 ? {
        framework: { source: fwKey, ladder },
        batch: { productContext: "mock consumer product line",
          standardCaveats: ["Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction."] },
      } : {}),
      // EVERY chunk narrates its own marks — code composes the batch executive summary from these
      chunkSummary: `Based on the knockout search results, ${rows.join(", ")} present${rows.length === 1 ? "s" : ""} no obvious blockers in this chunk; see per-mark rows.`,
      marks: rows.map((n) => {
        const deg = degradedSet.has(n);
        return { ref: null, name: n, classesSearched: [9], beltAndBraces: [35],
          // — THE PER-MARK ASSESSMENT, and the mock emits it because the chunk
          // validator requires it on every multi-mark batch. Without it the knockout e2e would prove only
          // that the validator refuses and would stop walking the lane it exists to walk end to end —
          // which is exactly what it did: three arms went red on `queue entry consumed as .done`, three
          // layers away from the missing field.
          //
          // DERIVED FROM THE MARK, never a constant, and that is load-bearing rather than decorative. The
          // arm that matters here asserts each per-mark document carries its OWN assessment naming that
          // mark and never a sibling — a fixture that emitted the same paragraph for every mark would
          // satisfy the length floor and make that arm unable to fail. The band rides it too, so a stale
          // assessment beside a re-rated mark is observable.
          assessment: `${n} screens at ${band} on this sweep. The name was searched against marketplace and `
            + `common-law use in the classes this chunk covers, and the read below sets out what the sweep `
            + `found and what it could not reach. A knockout screen triages; it does not clear.`,
          contextFraming: "mock framing", rating: band, ratingQualifier: null,
          classesDriving: [9], bullets: deg ? ["Rated on linguistic properties — research unavailable."] : ["No significant common-law conflicts identified in the mock payload."],
          // — the TYPED read. Emitted by the mock because the chunk validator requires it on every
          // fresh turn: without it the knockout e2e would prove only that the validator refuses, and
          // would stop exercising the lane it exists to walk end to end.
          basis: deg
            ? "Rated on the name's own linguistic properties — the research payload for this name was not held."
            : "A coined term with no dominant trader on the material searched in this chunk's classes.",
          factors: deg
            ? ["No research payload was held for this name.", "The rating rests on the name's construction alone."]
            : ["No marketplace seller trades under the name in the screened classes.", "No common-law use was surfaced by the sweep."],
          counterFactors: ["The screen is a triage sweep, not a clearance search of the field."],
          mitigation: deg ? "A completed research sweep would settle this rating either way." : "",
          purpleNotes: deg ? ["Common law research could not be completed — Manual verification recommended. Rating reflects analytical assessment pending fuller data."] : ["Register search pending — filings expected at normal volume."],
          registerEstimate: "moderate filings expected (mock estimate)", parodyNote: null, crowdedField: false,
          // — the TYPED finding, cited from the mark's OWN payload. The mock used to write
          // `findings: []` always, so the knockout e2e proved the lane could deliver a report with no
          // conflict in it and nothing else. It now emits one record for any mark whose canned payload
          // carries an http URL — which is what makes the e2e walk the whole path: the chunk validator's
          // typed arm, the merged gate, the receipts join against the payload on disk, and a conflict
          // rendered on the report page. A payload with no URL still yields [], as a clean mark should.
          findings: koMockFindings(runDir, n, band),
          negatives: deg ? [] : [{ term: n, source: "web, marketplaces, app stores", note: "no results of significance" }],
          degraded: deg ? { reason: "research unavailable" } : null };
      }),
    };
    // THE DRIVER WRITES THE CHUNK, THROUGH THE REAL TRANSPORT. The mock composes values and hands them
    // over exactly as a seat would; it does not write the artifact. A fixture that kept writing the file
    // would keep every e2e green through a conversion that had broken the transport entirely.
    const verdict = recordKnockoutAssess(runDir, chunk, { boundOrdinal: boundChunk });
    if (!verdict.written) return `mock knockout-assess: the transport refused the composed chunk — ${verdict.refused ?? verdict.write_failed}`;
    return "mock knockout assess ok";
  }
  // Repair-first A4: the single-artifact findings repair names ONLY findings.json ("Fix ONLY these
  // objects …", then the shared repair tail aimed at <findings.json>) — mirror the tool-shape: rewrite
  // exactly that file (synthesisFindings sees the A4 message and emits the strict-clean form). The mock
  // writes whole files because that is all a fixture can do; the PROMPT is what changed, and the file the
  // prompt names is still extracted from it — now from the repair tail rather than a re-emit sentence.
  const a4 = /failed the strict parse/.test(msg)
    && (msg.match(/TARGETED EDITS to\s+(\/\S+findings\.json)/) || msg.match(/re-emit the complete\s+(\/\S+findings\.json)/));
  if (a4) {
    mkdirSync(dirname(a4[1]), { recursive: true });
    writeFileSync(a4[1], synthesisFindings(dirname(a4[1]), msg));
    return `re-emitted ${a4[1]}`;
  }
  // spec 64: the actions-missing re-demand touches ONLY findings.json (add ONE top-level "actions" key,
  // then the shared repair tail aimed at <findings.json>) — synthesisFindings sees the demand marker and heals.
  const act = /no top-level "actions" array/.test(msg)
    && (msg.match(/TARGETED EDITS to\s+(\/\S+findings\.json)/) || msg.match(/Re-emit the COMPLETE\s+(\/\S+findings\.json)/));
  if (act) {
    mkdirSync(dirname(act[1]), { recursive: true });
    writeFileSync(act[1], synthesisFindings(dirname(act[1]), msg));
    return `re-emitted ${act[1]} with the actions register`;
  }
  // The prompt names the file it wants written; extract it. `TARGETED EDITS to <path>` is the repair tail
  // every converted corrective followup now ends with (repair-contract.mjs); the re-emit forms below cover
  // the prompts that still order a full write. The alternation order is deliberate — a message carrying
  // both an ABSOLUTE-path write mandate and a repair tail is a fresh stage message, not a repair.
  // NO EXTENSION FILTER. The prompt names the file it wants written, and the mock's job is to write
  // the file the prompt names — the extension was never the mock's business, and filtering on it means the
  // mock silently writes NOTHING for a stage whose output it does not recognise.
  //
  // hit this on the ABSOLUTE-path arm when blind-frame's out became blind-frame-model.json — the
  // first non-markdown stage output — and widened that one arm to `.md|.json`. The TARGETED-EDITS and
  // re-emit arms kept the `.md`-only pattern, so a REPAIR of a JSON-output stage still matched nothing.
  // The chain that produces is the worst kind of test failure: the warm-patch turn is told to edit a path
  // the regex does not match, so it writes nothing; the validator re-judges byte-identical content and
  // fails identically; the identical-signature break ends the ladder; and the test reports "the model
  // could not fix it" when the mock never asked it to. The harness reading its own silence as a model
  // capability finding — inside the rig, where it is hardest to see.
  //
  // The sibling mocks already do it right and carry no such defect: mock-claude.mjs and mock-codex.mjs both
  // extract `(\/\S+)` with no extension test at all. Matching them is the fix; widening to `.md|.json` a
  // third time would only move the wall to the next non-markdown output (knockout-plan.json is already one).
  // — A CONNOTATION REPAIR EDITS THE FORM AND WRITES NOTHING ELSE. Its warm patch names the driver's
  // disposition form and explicitly forbids rewriting the findings .md (which passed its own checks), so
  // the mock must do exactly that: fill in the two seat fields and return. Handled BEFORE the generic
  // target extraction, because that extraction would find the .md named in the "do NOT rewrite" clause and
  // re-emit a whole document the real seat is told not to touch.
  // B — A CONNOTATION REPAIR IS A TOOL CALL. The warm patch / remedy followup orders exactly one
  // compliance: call `record_dispositions` with the named grid_spec_path. The mock does exactly that,
  // through the production receiver, and touches no file itself. Handled BEFORE the generic target
  // extraction, which would otherwise find the findings .md named in the "do NOT rewrite" clause and
  // re-emit a whole document the real seat is told not to touch.
  const connRepair = /record_dispositions/.test(msg) && new RegExp(CONNOTATION_FORM_TOKEN_SRC).test(msg)
    && msg.match(/grid_spec_path[ =:]+\s*(\/\S+grid-spec[^\s]*\.json)/);
  if (connRepair) {
    const specPath = connRepair[1];
    const half = basename(specPath).match(/^grid-spec\.half-([a-z0-9]+)\.json$/)?.[1] ?? null;
    const made = mockRecordDispositions(join(dirname(specPath), ".."), half);
    return made ? `recorded the outstanding rulings via record_dispositions (spec ${specPath})`
      : `mock owed nothing to record for ${specPath}`;
  }
  const m = msg.match(/ABSOLUTE path[^:]*:\s*(\/\S+)/)
    // `TARGETED EDITS to <path> using the Edit tool` is the repair tail every converted corrective followup
    // ends with (repair-contract.mjs), and it is also the ONLY target a WARM PATCH names — that dispatch
    // shape has no base prompt behind it, so it carries no "ABSOLUTE path" sentence at all. The tail states
    // the path once more ("If <path> does not exist…"), which is harmless: .match returns the first hit.
    || msg.match(/TARGETED EDITS to\s+(\/\S+)/)
    || msg.match(/re-emit the COMPLETE updated\s+(\/\S+)/)
    || msg.match(/re-emit\s+(\/\S+)\s+with ONLY those rows corrected/);
  if (m) {
    const out = m[1];
    mkdirSync(dirname(out), { recursive: true });
    // A1 split: a half member writes ITS half ledger (common-law-grid.half-<h>.json); the single member
    // keeps the canonical name. Same MOCK_NO_GRID_LEDGER knob drives both fail-closed paths.
    // Fix-1: the PLUGIN owns the ledger. A FRESH gather writes the member's main ledger; a closure top-up
    // (a RESUMING followup) writes ONLY the driver-dictated SUPPLEMENTARY ledger at its own output_path and
    // NEVER touches the main/half ledger (which the driver folds in code); a pure source-channel followup
    // (RESUMING, no supp spec) writes NO ledger at all (channels ride the findings prose + byte-diff). The
    // regression knob writes the malformed append shape ONLY if a message still carries the deleted append
    // instruction — inert after the fix, a tripwire if it ever returns.
    // ORDER (fidelity, 2026-08-01): this block runs BEFORE the findings content is built, because that is
    // production order — the TOOL writes the ledger, the model READS it, then the model writes its prose
    // (the stage prompt requires reading extras.pr_risk[] before any clean bottom line). It used to run
    // after the .md write, so the fixture could never read what the tool had recorded.
    const clOut = basename(out).match(/^common-law-findings(?:\.half-([a-z0-9]+))?\.md$/);
    if (clOut && !process.env.MOCK_NO_GRID_LEDGER) {
      const mainLedger = join(dirname(out), clOut[1] ? `common-law-grid.half-${clOut[1]}.json` : "common-law-grid.json");
      const supp = suppSpecFromMsg(msg);
      // THE TRAP (2026-08-01). This guard used to key ONLY on the routed followup's wording, which the
      // GENERIC warm patch does not carry — so once warmPatchMessage's target became resolvable above, a
      // warm patch fell through to the `!resuming` arm and RE-DERIVED the ledger from a message that
      // carries no grid spec, wiping extras.pr_risk[]. The receipts under repair would VANISH and the half
      // would pass SPURIOUSLY: a false green in the very gate that exists to stop silence. A warm patch is
      // a session resume with NO tool call — the plugin does not re-run, so the ledger MUST NOT move. Same
      // rule, same reason as the routed common-law followups; keep this guard broad (over-matching only
      // suppresses a write, under-matching fabricates a pass).
      const resuming = /RESUMING your own common-law session/.test(msg) || /^You are RESUMING your own session for this stage/.test(msg);
      if (process.env.MOCK_CL_APPEND_MALFORMED && /APPEND the supplementary call/.test(msg)) {
        const target = msg.match(/APPEND the supplementary call's stdout JSON to (\/\S+common-law-grid[^\s]*\.json)/)?.[1] ?? mainLedger;
        writeFileSync(target, malformedAppend(msg, dirname(out)));
      } else if (supp) {
        mkdirSync(dirname(supp.output_path), { recursive: true });
        writeFileSync(supp.output_path, suppLedger(supp));
      } else if (!resuming) {
        writeFileSync(mainLedger, gridLedger(msg, dirname(out)));
        // B — the grid call itself is a tool call, and a real run's stdio-server writes its pair. The
        // pair is what makes _driver/tool-calls.jsonl EXIST on a run whose seat then makes no
        // record_dispositions call — the state the audit reads as `call_never_made` (readable, zero
        // started) rather than as its blind partial floor. The seat-facing form write that lived here
        // died with the form path: no tool writes that file any more.
        recordMockToolCall(dirname(out), "perplexity_research");
      }
    }
    let content = /\/report-cards\//.test(out) ? reportCardFixture(out) : fixture(basename(out), msg, dirname(out));
    // A null fixture is a SUPPRESSION knob (MOCK_NO_BLIND_MODEL) — the turn "completes" and writes no
    // file, which is the shape the stage's file-truth gate exists to refuse. Returned BEFORE any append
    // below, so a suppressed artifact can never land as the string "null" plus a marker: present-and-
    // invalid is a different failure from absent, and the test is about absent.
    if (content == null) return `mock turn completed without writing ${basename(out)}`;
    // A frame-reopen resume carries a DISTINCT marker so its re-emit differs from any prior escalation/
    // envelope re-emit of the same unit (else the byte-diff guard would see no change and skip it).
    if (/RESUMING your own register-unit session/.test(msg) && !process.env.MOCK_ESCALATION_NOOP)
      content += /frame-INDEPENDENT re-derivation/.test(msg)
        ? "\n<!-- frame-reopen: supplemental sweep -->\n"
        : "\n<!-- escalation: revised in place -->\n";
    writeFileSync(out, content);
    stalefindingsOnLintRepair(dirname(out), msg);
    // register-unit (the funnel) ALSO writes its complete named band — the load-bearing artifact the driver
    // gates fan-in on (a missing band can never ship clean). Mirror that so the e2e mock satisfies the gate.
    // Real-funnel fidelity: a RESUME re-emits the COMPLETE band "preserving each existing block's qid
    // VERBATIM" (the followup mandate) — the executor merge never drops a dictated slice. A resume followup
    // carries no "- qid …" plan listing, so namedBand alone would regenerate only the base/judgment blocks
    // and silently drop the dictated-qid blocks; the identity-join (and the Fix-2 frame-reopen receipt
    // refresh over it) would then read the axis unexecuted. Merge: fresh blocks + any prior QID block this
    // re-emit did not restamp.
    // THE BAND SIDE-WRITE MOVED and this branch is DELETED rather than left behind.
    // It keyed on `out` matching register-units/<axis>.md — the note — and the converted dispatch names no
    // path at all, so this branch could never fire again while reading as though it still covered the band.
    // A dead branch here is worse than an absent one: every unit run would silently write no band and the
    // failure would surface three layers downstream as a fan-in hard-fail. It now lives in
    // `mockUnitBandWrite`, driven from the record_unit_note branch — which is also the true ORDER, because
    // the tool refuses a note filed over a band that does not exist yet.
    // CONVERSION 3 — the side-write is GONE. It existed because the seat wrote the prose and the
    // structured sibling had to appear beside it; the driver serialises both from one call now.
    // AD-2 A9 probe: did the digest's dispatch actually CARRY placement's rulings tail? Recorded in a
    // side file so no parsed artifact changes shape.
    if (basename(out) === "register-findings.md" && /PLACEMENT RULINGS TAIL \(verbatim from/.test(msg)) {
      mkdirSync(driverDir(dirname(out)), { recursive: true });
      writeFileSync(driverDir(dirname(out), "mock-rulings-tail.flag"), "1");
    }
    // Same idiom, for the settled coverage facts (envelope-settle.mjs → settledDeferralsSection): one
    // line per digest dispatch that actually CARRIED them. The FLUSH passes are what this proves —
    // stageOnce drops `extra` on a followup, so a flush is exactly the pass a dispatch hint cannot reach.
    // — the seat fills in the driver's coverage form on every digest write. The driver renders the
    // `## Coverage ledger` table and the machine ledger from it after the pass, so the mock never writes
    // either — which is exactly the contract the shipped skill now states.
    if (basename(out) === "register-findings.md") fillCoverageForm(dirname(out), msg);
    if (basename(out) === "register-findings.md" && /SETTLED COVERAGE FACTS/.test(msg)) {
      mkdirSync(driverDir(dirname(out)), { recursive: true });
      appendFileSync(driverDir(dirname(out), "mock-settled-facts.log"), "carried\n");
    }
    //, third conversion — THE SIDE-WRITE IS GONE. This wrote `frame-diff.json` beside the prose
    // whenever the prose was written, which was the mock playing the dictated contract. Both artifacts are
    // the driver's now, off the `record_frame_diff` call in applyStageWrites' recording branch. Leaving
    // this line would have kept every pipeline test green while the real seat's grant no longer allowed
    // the write it emulates — a mock still playing the old contract is how a prompt drifts away from the
    // code with the suite watching.
    // — THE SEAT FILLS THE FORM AND NEVER WRITES placements.json. It selects a record id the
    // driver's own fold holds, adds its tier and reason, and the driver renders the deliverable. The
    // mock plays that contract, because a mock still playing the old one would let the real seat's
    // prompt drift away from the code with every pipeline test still green.
    //
    // The selected id is read from the form the driver wrote before dispatch — which is exactly what the
    // real seat does, and it means this fixture cannot select something the fold does not hold.
    // MOCK_PLACEMENT_NO_SIBLING now means "the seat handed back NOTHING", which under the accumulator is
    // no longer a way to lose work: the prior pass's rows stand and the driver re-renders from them.
    if (basename(out) === "placement-recommendations.md" && !process.env.MOCK_PLACEMENT_NO_SIBLING) {
      const dir = dirname(out);
      let selectable = null;
      try {
        const pos = JSON.parse(readFileSync(driverDir(dir, "register-positions.json"), "utf8"));
        selectable = (pos?.positions ?? []).flatMap((x) => (Array.isArray(x?.records) ? x.records : []))[0] ?? null;
      } catch { /* no fold in reach — fall through to a seat-authored row, which is the honest shape then */ }
      const rows = selectable
        ? [{ select: selectable, tier: "headline-candidate",
             reason: "Exact match in the target class held by an active same-field filer — the customer base overlaps directly and the registration is live." }]
        : [{ kind: "seat", mark: "LUMENGARDE", owner: "Acme", jurisdiction: "DK", records: [], tier: "headline-candidate",
             reason: "Exact match in the target class held by an active same-field filer — the customer base overlaps directly and the registration is live." }];
      writeFileSync(join(dir, "placement-form.json"), JSON.stringify({ rows }, null, 2) + "\n");
    }
    if (basename(out) === "narrative.md" && !process.env.MOCK_CANDSELF && !process.env.MOCK_NARRATIVE_RECO) {
      writeFileSync(join(dirname(out), "findings.json"), synthesisFindings(dirname(out), msg));
      mockRegisterRecordWrite(dirname(out), argv);
    }
    summary = `wrote ${out}`;
  } else if (/was NEVER WRITTEN/.test(msg) && /output_path = (\/\S+-band\.json)/.test(msg)) {
    // named_band_missing warm patch (gateway.warmPatchMessage): the band is ABSENT and the repair is ONE
    // register_execute_plan call that writes the whole band. The claude-shaped mock has no --session-key
    // argv to derive the stage from, so mirror the TOOL here off the patch message's own band path.
    // MOCK_NO_BAND (persistent) keeps failing — a model that never makes the tool call.
    const bandPath = msg.match(/output_path = (\/\S+-band\.json)/)[1];
    const axis = basename(bandPath, "-band.json");
    if (process.env.MOCK_NO_BAND === axis) {
      summary = `execute_plan withheld (MOCK_NO_BAND=${axis})`;
    } else {
      mkdirSync(dirname(bandPath), { recursive: true });
      writeFileSync(bandPath, namedBand(axis, msg));
      summary = `execute_plan wrote ${bandPath}`;
    }
  } else if (/register_execute_plan ONCE/.test(msg) && /"output_path": "(\/\S+-band\.json)"/.test(msg)) {
    // — the plan-join warm followup instructs ONE register_execute_plan call; the mock
    // mirrors the TOOL's merge (judgment/no-qid blocks survive; missing dictated qids land).
    // J6 — the FRESH execute_plan call (resumed-past axis, no live session) carries the same
    // tool instruction but NO per-qid listing: the real tool reads the frozen plan itself. Mirror
    // that too — P2-A's failed-at-verdict store write makes resume runs mint recall probes, which
    // land on exactly this path in the offline harness.
    const bandPath = msg.match(/"output_path": "(\/\S+-band\.json)"/)[1];
    let blocks = [];
    try { blocks = JSON.parse(readFileSync(bandPath, "utf8")); } catch { blocks = []; }
    // MOCK_PLAN_DROP_STICKY: the followup ALSO fails to close the dropped qid — drives the
    // repair-exhausted terminal path (the deterministic fail-fast shape).
    const sticky = (qid) => process.env.MOCK_PLAN_DROP_STICKY && process.env.MOCK_PLAN_DROP_QID && qid.includes(process.env.MOCK_PLAN_DROP_QID);
    const wanted = [];
    for (const dm of msg.matchAll(/- qid "([^"]+)":[^\n]*?(?:expected: (enumerate|count))?$/gm)) {
      let terms = null;
      try { terms = JSON.parse(dm[0].match(/names (\[[^\]]*\])/)?.[1] ?? "null"); } catch { /* not stacked */ }
      if (!terms) { const t = dm[0].match(/:\s*\S+\s+"([^"]+)"/)?.[1]; if (t) terms = [t]; }
      wanted.push({ qid: dm[1], kind: dm[2] ?? "enumerate", terms });
    }
    if (!wanted.length) {
      const planPath = msg.match(/"plan_path": "(\/\S+?)"/)?.[1];
      const axis = msg.match(/"axis": "([^"]+)"/)?.[1];
      try {
        const plan = JSON.parse(readFileSync(planPath, "utf8"));
        for (const e of (plan.entries ?? []).filter((x) => x.axis === axis))
          wanted.push({ qid: e.qid, kind: e.expected_kind ?? "enumerate", terms: e.terms ?? (e.term ? [e.term] : null) });
      } catch { /* no plan on disk — nothing to mint */ }
    }
    for (const w of wanted) {
      if (sticky(w.qid)) continue;
      // a re-run REPLACES a prior error block for the same qid (the real tool re-runs the entry)
      blocks = blocks.filter((b) => !(b && b.qid === w.qid && b.error));
      if (!blocks.some((b) => b && b.qid === w.qid)) blocks.push(...qidBlocks(w.qid, w.kind, w.terms));
    }
    writeFileSync(bandPath, JSON.stringify(blocks, null, 2) + "\n");
    summary = `execute_plan merged ${bandPath}`;
  } else if (/register-coverage-ledger\.json/.test(msg)) {
    // — the machine ledger is DERIVED by the driver from the coverage form; no dispatch asks a model
    // to save it any more (ensureCoverageLedgerSaved is deleted). A message that still names the path is
    // naming it as an INPUT (the skeptic's machine-truth line), so the mock writes nothing here.
    summary = "acknowledged (driver derives the machine ledger)";
  } else if (/common-law-grid\.json/.test(msg) && (/VERBATIM/.test(msg) || /grid_spec_path/.test(msg))) {
    const gm = msg.match(/(\/\S+common-law-grid\.json)/);
    if (gm && process.env.MOCK_NO_GRID_LEDGER !== "2") {
      mkdirSync(dirname(gm[1]), { recursive: true });
      writeFileSync(gm[1], gridLedger(msg, dirname(gm[1])));
      summary = `saved ${gm[1]}`;
    } else {
      summary = "acknowledged (no save)";
    }
  } else if (/clawdi_send/.test(msg)) {
    summary = "sent messageId=<mock-reply-id>; xlsx=/tmp/mock-findings.xlsx";
  }
  return summary;
}
