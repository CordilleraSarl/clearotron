// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// verify.mjs — structural file-truth validators for each stage's expectFile.
//
// Step-1 posture: lenient enough never to false-fail a VALID leaf output, strict enough to catch
// truncation, emptiness, or wrong-stage output (the "claimed-but-not-written" / partial-write
// failure mode). The two gate-critical validators are precise: the refutation verdict line (drives the
// CLEAR/CONDITIONAL/BLOCKING branch) and the register coverage-ledger (drives coverage honesty).

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { findReceiptViolations, findGridLedgerViolations, findPlatformIdentityViolations, parsePrRiskQueries, MEANING_SEAT } from "./common-law-receipts.mjs";
// Conversion 2 — the discriminator the two rulings above key on. PURE-ish: one existsSync-shaped read.
import { matterFrameWasRecorded } from "./matter-frame-record.mjs";
import { findConnotationViolations, parsePrRiskResults, MEANING_ANGLES_RE,
  parseDispositionForm, CONNOTATION_UNRULED_REASONS } from "./connotation-search.mjs";
import { formSidecarName, formSidecarPath } from "./disposition-union.mjs";
// B — the transport's own four failure states. The audit reads the run's records; this file locates them.
import { auditDispositionCalls, CALL_FAILURE_REASONS } from "./disposition-call-audit.mjs";
import { callRecordPaths } from "./disposition-tool.mjs";
// — the record-URL host allow-list for the provider this run actually searched. A one-function
// module rather than driver.config, deliberately: skill-contract-enumerations.test.mjs derives the
// "modules that judge seat output" from THIS file's import list, and pulling driver.config in would drag
// KNOWN_REGISTER_PROVIDERS into the gate surface — a vocabulary the seat is never handed and could not
// be taught honestly. See record-origins.mjs's header.
import { activeRecordOrigins } from "./record-origins.mjs";
import { abbrev } from "./repair-contract.mjs";
import { parseCoverageLedgerJson, parseCoverageLedgerFull, decideAxes, COVERAGE_STATUSES } from "./coverage-ledger.mjs";
import { findUnaccountedDeferredSlices, findUnexecutedCleanClaims, findUnverifiedIncompleteCleanClaims,
  parseRegisterPlan } from "./register-plan.mjs";
import { findCoverageFormViolations, formLedgerRows, coverageFormSidecarName, coverageFormAbsence, COVERAGE_ABSENCE_CAUSES } from "./coverage-form.mjs";
import { coverageFormStamp, readCoverageForm } from "./coverage-form-io.mjs";
import { readUnacknowledgedTaintAxes } from "./register-taint.mjs";
import { registerPlanCallKilled } from "./tool-calls.mjs";   // — did the dictated call return?
import { parseFindingsJson, parseFindingsJsonLenient, CLIENT_TIER_BY_COMPOSITE, isUnconditionalProceed, joinFindingToBlock, parseBlockOrd } from "./findings-model.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";
import { parseCaseLawLedger, findCaseLawLedgerViolations, caseLawLedgerFail } from "./case-law-ledger.mjs";
import { parseFrameworkManifest, aboveLowestBand, normalizeBand } from "./framework.mjs";
import { parseNamedBand, findCollapsedBands } from "./named-band.mjs";
import { parseBlindFrameModel } from "./blind-frame-model.mjs";
import { parseFrameDiff } from "./frame-diff-model.mjs";
import { parseVariantManifestModel, variantRomanizationGaps, variantCompletenessGaps, variantTermShapeGaps } from "./variant-manifest-model.mjs";

// ── WS-B: the run-scoped profile sidecar ────────────────────────────────────────────────────────────
// _driver/profile.json carries the run's frozen customer values (floor, platform list) for these
// context-free (path, content) validators — the same dirname(p) convention as the manifest /
// common-law-grid.json / coverage-closure reads, with a one-level walk-up because some validated
// files live in a subdirectory (register-units/*). Absent ⇒ legacy defaults (archived runs; replay
// verdicts must not flip). Unreadable ⇒ fail-closed: the sidecar is DRIVER-written (temp+rename), so
// a corrupt one is a code/filesystem bug that must surface loudly, never silently downgrade floors.
function readRunProfile(p) {
  for (const dir of [dirname(p), dirname(dirname(p))]) {
    const f = driverDir(dir, "profile.json");
    if (!existsSync(f)) continue;
    try { return { profile: JSON.parse(readFileSync(f, "utf8")), invalid: false }; }
    catch { return { profile: null, invalid: true }; }
  }
  return { profile: null, invalid: false };
}

// ── doc 50: the run-scoped FROZEN framework manifest ────────────────────────────────────────────────
// _driver/framework.json is the framework-in-force's manifest, frozen beside profile.json at
// attachProfile time — the band vocabulary every v4 gate joins against (zephyr "Medium" vs house
// "Moderate" stays consistent within a run and across resume). Same walk-up + fail-closed convention as
// readRunProfile: absent ⇒ null (archived/legacy runs); unreadable ⇒ invalid (driver-written, so a
// corrupt one is a bug that must surface, never a silent downgrade to the wrong vocabulary).
function readRunFramework(p) {
  for (const dir of [dirname(p), dirname(dirname(p))]) {
    const f = driverDir(dir, "framework.json");
    if (!existsSync(f)) continue;
    try { return { manifest: parseFrameworkManifest(readFileSync(f, "utf8")), invalid: false }; }
    catch { return { manifest: null, invalid: true }; }
  }
  return { manifest: null, invalid: false };
}

// ── Grid spec sidecar (the dictated grid contract) ──────────────────────────────────────────────────
// _driver/grid-spec.json is the SINGLE source of the common-law grid: the EXACT terms × platforms the
// driver dictated, the plugin ran, and the plugin wrote the ledger from. Reading it here means the
// receipts gate joins against the same keys the grid actually ran — it can never demand a term the run
// did not search (the manifest-inference class, 4 of 6 matchday failures). Absent ⇒ legacy prose path
// (archived runs / offline tests). Same dirname walk-up + fail-closed convention as readRunProfile /
// readRunFramework: absent ⇒ null (legacy); PRESENT but unparseable/misshapen ⇒ invalid — the sidecar
// is DRIVER-written, so a corrupt one is a code/fs bug (e.g. a torn non-atomic write) that used to
// silently disarm the grid_ledger_missing gate AND every machine join (D1: the exact fail-open this
// batch closes; the plan-execution reads got the same split).
function readGridSpec(p) {
  for (const dir of [dirname(p), dirname(dirname(p))]) {
    const f = driverDir(dir, "grid-spec.json");
    if (!existsSync(f)) continue;
    try {
      const spec = JSON.parse(readFileSync(f, "utf8"));
      // — a spec is well-formed when it dictates SOME work, not when it dictates CELLS. The
      // meaning seat carries `terms: []` and the whole meaning sweep, and reading that as malformed
      // would fail the one seat whose entire dispatch is the meaning work.
      const dictates = (Array.isArray(spec?.terms) && spec.terms.length)
        || (Array.isArray(spec?.connotation?.queries) && spec.connotation.queries.length);
      if (spec && typeof spec === "object" && Array.isArray(spec.terms) && dictates) return { spec, invalid: false };
    } catch { /* present-but-unparseable — fall through to invalid */ }
    return { spec: null, invalid: true };
  }
  return { spec: null, invalid: false };
}

// ── A1 SPLIT: the per-half grid-spec sidecar (grid-spec.half-<h>.json) ──────────────────────────────
// Same walk-up + fail-closed convention as readGridSpec above, over the HALF spec the driver wrote for
// one concurrent half-grid member. Unlike the canonical spec, absence is NOT legacy: the half stage only
// exists because the driver wrote the sidecar first, so a missing/unreadable one is a driver/fs bug that
// must surface (the caller fails closed on both).
function readGridSpecHalf(p, half) {
  for (const dir of [dirname(p), dirname(dirname(p))]) {
    const f = driverDir(dir, `grid-spec.half-${half}.json`);
    if (!existsSync(f)) continue;
    try {
      const spec = JSON.parse(readFileSync(f, "utf8"));
      // — a spec is well-formed when it dictates SOME work, not when it dictates CELLS. The
      // meaning seat carries `terms: []` and the whole meaning sweep, and reading that as malformed
      // would fail the one seat whose entire dispatch is the meaning work.
      const dictates = (Array.isArray(spec?.terms) && spec.terms.length)
        || (Array.isArray(spec?.connotation?.queries) && spec.connotation.queries.length);
      if (spec && typeof spec === "object" && Array.isArray(spec.terms) && dictates) return { spec, invalid: false };
    } catch { /* present-but-unparseable — fall through to invalid */ }
    return { spec: null, invalid: true };
  }
  return { spec: null, invalid: false };
}

const MIN = 200; // chars — a real findings/manifest file is never shorter than this

function nonEmpty(content, min = MIN) {
  const c = (content ?? "").trim();
  return c.length >= min ? ok() : fail(`too_short(${c.length}<${min})`);
}
/**
 * — THE TOKEN NAMES THE MEMBER THAT FAILED, NOT ONLY THE GROUP.
 *
 * The label belongs to the whole group, so a multi-marker check reported both parts whichever one was
 * missing. On R5 that pointed 30 of 30 report-card seats at the half they had got right: the token said
 * `missing:card+detail` while all 30 carried `### Full detail` and 0 carried the H2 the prompt forbade
 * them to write. The seat inspects its file, finds the named section present, rewrites, gets the identical
 * token, and the ladder exhausts. 12.5 minutes of dispatch per run, every run, since 2026-08-16.
 *
 * ── WHY THE LABEL STAYS AND THE MEMBER IS APPENDED ──────────────────────────────────────────────────
 *
 * The obvious fix — emit the failing marker INSTEAD of the label — silently breaks the corrective hints.
 * `correctionHint` branches on the label text (`gateway.mjs:2181` on `findings+ledger`, `:2188` on
 * `negative-results|coverage-ledger|audit-trail|findings-heading`), so a renamed token would fall through
 * to a generic hint. 's comment records that arm being removed once already on a reading that was
 * true for only one lane, and put back. Appending keeps every existing matcher matching — they all test
 * substrings — and gives the seat the one word it was missing.
 *
 * It also sharpens `noChange` (`gateway.mjs:1220`, "this attempt's token equals the previous attempt's"):
 * a file that starts failing a DIFFERENT member now reads as changed instead of as a stalled retry.
 *
 * `names` is positional against `markers` and optional; a call site that omits it emits exactly the token
 * it emitted before.
 */
function needs(content, markers, label, names = []) {
  for (const [i, m] of markers.entries()) {
    const re = m instanceof RegExp ? m : new RegExp(m, "i");
    if (!re.test(content ?? "")) {
      const which = names[i];
      return fail(`missing:${label ?? String(m)}${which ? `(${which})` : ""}`);
    }
  }
  return ok();
}
function all(...checks) {
  for (const c of checks) if (!c.ok) return c;
  return ok();
}
const ok = (reason = "") => ({ ok: true, reason });
const fail = (reason) => ({ ok: false, reason });

// ── A1 SPLIT: the structural core shared by the commonLaw and commonLawHalf validators ─────────────
// A half findings file is a complete findings file in its own right (same sections, same receipt
// discipline) — only the grid-join source differs (half spec + half ledger vs canonical pair).
// "not executed" was removed from the declared-unavailable phrase set (2026-06-12): it is ALSO the
// sanctioned coverage-cell vocabulary ("not executed — coverage-limited"), and the matchday att3 file
// was false-failed for honestly noting a famous-mark check was "deferred to Step 3 (not executed in
// this run)" near the word "Perplexity". A genuine no-grid fallback file still hard-fails on the
// structural + receipt checks (defense in depth; the primary mechanism remains write-NO-file).
const COMMONLAW_UNAVAILABLE_RE = /(perplexity|marketplace research|common.?law (layer|research|search))[^\n]{0,120}(could not be completed|unavailable)/i;
// ── — THE VETO RUNS LAST, BECAUSE DEFENSE IN DEPTH IS A DEPTH ─────────────────────────────────
//
// The comment above has always described this arm as the BACKSTOP behind the structural + receipt
// checks. It was not one: both call sites tested the phrase FIRST and returned before any evidence was
// read, so the string out-ranked the machine receipts it was supposed to stand behind. R5
// (MERIDIAN THISTLE, worldwide Global preliminary — the product's first run ever) died terminal at
// `common-law-half:a` after 45 minutes on a file whose grid was COMPLETE, for this sentence:
//
//   "Perplexity searches returned mapped results to English-language sources; direct non-Latin script
//    marketplace presence unavailable at common-law layer. This is expected for non-Latin-script
//    register markets. Transliteration verification deferred to national register searches…"
//
// "Perplexity … unavailable" matches inside the 120-char window. That is not an excuse, it is the
// coverage-boundary statement a worldwide search is SUPPOSED to write — so this arm fired on Global
// preliminary by construction, and one product of four was undeliverable. The retry hint (gateway.mjs)
// tells the seat to write NO file when the tool is failing; the tool was not failing and the seat had
// results, so it honestly rewrote the same file and the ladder closed as `repeat-signature`. The fatal
// sub-case is the one where the seat is RIGHT — the third instance of the defect class.
//
// THE DISCRIMINATOR IS ALREADY ON DISK, AND IT IS NOT A PHRASE — BUT `machine-receipts` ALONE IS NOT
// IT. All three receipt-complete paths (commonLaw, commonLawHalf, commonLawMeaningSeat) return
// `ok("machine-receipts")`, and the first cut of this fix stopped there. That was wrong, and the review
// caught it: `parseGridLedger`'s own docstring says "Cells and gaps both count as accounted grid
// entries", and driver/test/common-law-receipts.test.mjs pins exactly that over a quarantined half. So
// the join proves every dictated cell is ACCOUNTED FOR — never that it RAN. A ledger of 6 real cells
// and 6 gap rows clears it, and demoting the veto on that would have shipped a half-searched
// marketplace layer under a "confirmed-clean" coverage row. That is the hollow-report class this arm
// exists for, re-opened by its own fix.
//
// SO THE GATE ASKS THE LEDGER WHETHER THE GRID RAN, AND THE RULE IS NOT A THRESHOLD. If any dictated
// cell gapped, the file's own sentence that something was unavailable is CORROBORATED by the machine
// record, and a corroborated declaration must fail. Only a ledger with no gaps CONTRADICTS the
// sentence — and a contradiction is the one thing that earns the demotion. Zero gaps is therefore the
// exact line, not a conservative choice of one.
//
// AND THE 2026-05-23 INCIDENT STAYS CLOSED — for the right reason. Not "a fallback file has no ledger"
// (the plugin writes the ledger in deterministic mode, and mergeGrids mints one on a half failure, so a
// fallback-shaped file certainly can carry one). It stays closed because a fallback file's grid did not
// run, and a grid that did not run leaves gaps. Every other outcome — structural fail,
// grid_join_missing, the legacy prose path, bare `ok()`, a gapped ledger — still consults the phrase and
// still fails `declared_unavailable`, with the SAME token, so the ladder's write-NO-file hint and the
// repeat-signature classifier are untouched.
//
// The one verdict that moves: fully-executed grid + boundary prose. On the R5 run that is 217 cells and
// 0 gaps on half:a.
//
// Deliberately NOT done: loosening the honesty vocabulary. The prose is correct and stays.
//
// Driver-bug tokens are never masked. `half_path_unrecognized` says the DRIVER called this validator
// with a path it does not own; "write NO findings file" is the wrong remedy for that, and pre- the
// path guard returned before the regex was ever reached. Keep it that way.
const VETO_NEVER_MASKS = new Set(["half_path_unrecognized"]);

/**
 * Did the grid behind this findings file actually RUN, in full? True only when the ledger exists,
 * parses, and records no gap rows at all.
 *
 * The two catch arms are fail-closed INSURANCE, and they are unreachable by construction: the gate only
 * calls this after the evidence chain returned `ok("machine-receipts")`, and that chain reached it by
 * reading and parsing this same file (an unreadable one is `grid_ledger_missing`, an unparseable one is
 * `grid_ledger_unparseable`, and neither is `machine-receipts`). They are kept because the alternative
 * to a `false` here is a throw out of a validator, and because a future caller may not have parsed
 * first. Break-matrix note: flipping either to `true` leaves the suite green for exactly this reason —
 * that is recorded rather than papered over with a test that would pass for the wrong reason.
 */
function gridRanWithoutGaps(p) {
  const dir = dirname(String(p ?? ""));
  const half = String(p ?? "").match(/common-law-findings\.half-([a-z0-9]+)\.md$/)?.[1];
  const ledger = join(dir, half ? `common-law-grid.half-${half}.json` : "common-law-grid.json");
  let raw = null;
  try { raw = readFileSync(ledger, "utf8"); } catch { return false; }
  try {
    const parsed = JSON.parse(raw);
    const batches = Array.isArray(parsed) ? parsed : [parsed];
    return batches.every((b) => !(Array.isArray(b?.gaps) ? b.gaps : []).length);
  } catch { return false; }
}

function declaredUnavailableGate(p, content, evidence) {
  if (evidence.ok && evidence.reason === "machine-receipts" && gridRanWithoutGaps(p)) return evidence;
  if (!evidence.ok && VETO_NEVER_MASKS.has(evidence.reason)) return evidence;
  return COMMONLAW_UNAVAILABLE_RE.test(content ?? "") ? fail("declared_unavailable") : evidence;
}
// — THE MEANING SEAT'S VALIDATOR, AND IT ASKS FOR WHAT THE SEAT WAS ACTUALLY DICTATED.
//
// The grid halves are judged on a term x platform join. This seat sweeps no cells, so every one of
// those arms is vacuous on it — and `commonLawStructural`'s negative-results matrix, coverage ledger
// and platform table would be ceremony demanded of a seat that ran no grid. A floor that asks for
// sections a seat has no material for teaches the model to fabricate them to pass a gate, which is
// the failure the completeness floor's own doc block names.
//
// So the floor here is the meaning work: the seat's document exists and says what it found, the
// tool-written ledger is on disk, EVERY dictated query is recorded in it, and the disposition arm —
// the one real gate — runs exactly as it does on a half, with the same tokens, so the corrective
// ladder's connotation hints and the repairs classifier apply unchanged.
//
// The per-query identity join is here rather than only at the merge for the reason gives: a
// dropped meaning query is not a gap row (gaps are term x platform), so nothing else in the pipeline
// would notice its absence. An absence is a finding.
function commonLawMeaningSeat(p, c) {
  const structural = all(
    nonEmpty(c),
    needs(c, [/^#{1,4}\s+[^\n]*\b(findings|meaning|connotation)\b/im], "findings-heading"),
    needs(c, [/audit[\s-]trail/i], "audit-trail"),
  );
  if (!structural.ok) return structural;
  const gs = readGridSpecHalf(p, MEANING_SEAT);
  if (gs.invalid) return fail(`grid_spec_unreadable:_driver/grid-spec.half-${MEANING_SEAT}.json is corrupt or misshapen (driver-written — this is a bug, not a model defect)`);
  if (!gs.spec) return fail(`grid_spec_unreadable:_driver/grid-spec.half-${MEANING_SEAT}.json absent — the driver writes it before the meaning seat spawns`);
  const spec = gs.spec;
  let ledgerRaw = null;
  try { ledgerRaw = readFileSync(join(dirname(p), `common-law-grid.half-${MEANING_SEAT}.json`), "utf8"); } catch { /* missing → fail-closed below */ }
  if (ledgerRaw == null) return fail(`grid_ledger_missing:common-law-grid.half-${MEANING_SEAT}.json absent while _driver/grid-spec.half-${MEANING_SEAT}.json dictates the meaning sweep`);
  const dictated = Array.isArray(spec?.connotation?.queries) ? spec.connotation.queries : [];
  let recordedQ;
  try { recordedQ = new Set(parsePrRiskResults(ledgerRaw).map((e) => String(e?.query ?? "").trim())); }
  catch (e) { return fail(`grid_ledger_unparseable:${String(e.message).slice(0, 80)}`); }
  const dropped = dictated.filter((q) => !recordedQ.has(String(q).trim()));
  if (dropped.length)
    return fail(`connotation_query_unrecorded:${dropped.slice(0, 3).map((q) => abbrev(q, 40)).join(",")}${dropped.length > 3 ? ` (+${dropped.length - 3} more)` : ""}`);
  if (spec?.connotation?.disposition_required === true) {
    const recorded = parsePrRiskResults(ledgerRaw);
    const form = dispositionForm(dirname(p), spec?.connotation?.dispositions_path);
    const conn = connotationViolations(c, parsePrRiskQueries(ledgerRaw),
      { recorded, form: form.rows, formError: form.error },
      spec?.connotation?.dispositions_path ?? null);
    const connFail = connotationDispositionFail(conn);
    if (connFail) return connFail;
  }
  return ok("machine-receipts");
}

// — the EVIDENCE chain for `validators.commonLaw`, lifted out verbatim so the unavailability
// veto can wrap it instead of pre-empting it. Every return token is unchanged.
function commonLawEvidence(p, c) {
    const structural = commonLawStructural(c);
    if (!structural.ok) return structural;
    // The dictated grid spec is the SINGLE source of the grid contract when present (the driver wrote it,
    // the plugin ran it, the plugin wrote the ledger from it): the receipts gate joins the ledger against
    // spec.terms × spec.platforms — never re-inferring keys from prose, so it can never demand a term the
    // grid did not run (the manifest-inference class, 4 of 6 matchday failures). Legacy/offline runs with
    // no spec fall back to the variant-manifest.md prose; replay verdicts on archived runs must not flip.
    const gs = readGridSpec(p);
    if (gs.invalid) return fail("grid_spec_unreadable:_driver/grid-spec.json is corrupt or misshapen (driver-written — this is a bug, not a model defect)");
    const spec = gs.spec;
    let manifest = null;
    try { manifest = readFileSync(join(dirname(p), "variant-manifest.md"), "utf8"); } catch { /* no manifest in reach — skip */ }
    if (spec == null && manifest == null) return ok();
    // WS-B: the run's profile sidecar threads per-customer values into this otherwise context-free
    // validator. Unreadable ⇒ fail-closed (a corrupt DRIVER-written sidecar is a code/fs bug, never a
    // floor to silently downgrade).
    const rp = readRunProfile(p);
    if (rp.invalid) return fail("profile_unparseable:_driver/profile.json (driver-written sidecar is not valid JSON — investigate)");
    // The count floor AND the dictated platform identity come from the grid spec when present (the EXACT
    // grid that ran — so the floor equals the real dictated cell count, not a hardcoded 7), else the
    // profile sidecar / historical default. Keeping the gate and the run in lockstep is the whole fix.
    const joinKeys = spec ? spec.terms : manifest;
    const dictatedPlatforms = spec?.platforms?.length ? spec.platforms : (rp.profile?.platforms ?? []);
    const minCellsPerVariant = spec?.platforms?.length ? spec.platforms.length : rp.profile?.minCellsPerVariant;
    // MACHINE RECEIPTS: when the grid ledger exists (the plugin writes it directly from the API response —
    // never through the model's bounded turn-output, so it can neither truncate nor drop cells), grid
    // completeness is an EXACT JOIN of the dictated keys against the ledger's (term × platform) entries.
    // An unparseable ledger FAILS (a parse miss must never pass). No ledger ⇒ legacy prose path below.
    let ledgerRaw = null;
    try { ledgerRaw = readFileSync(join(dirname(p), "common-law-grid.json"), "utf8"); } catch { /* legacy run */ }
    if (ledgerRaw != null) {
      let short;
      try { short = findGridLedgerViolations(joinKeys, ledgerRaw, { minCellsPerVariant }); }
      catch (e) { return fail(`grid_ledger_unparseable:${String(e.message).slice(0, 80)}`); }
      if (short.length) return fail(`grid_join_missing:${short.map((v) => `${v.variant}:${v.cells}/${v.expected}`).join(",")}`);
      // platform-identity join: the count above proves how MANY platforms — this proves WHICH.
      if (dictatedPlatforms.length) {
        let wrong;
        try { wrong = findPlatformIdentityViolations(joinKeys, ledgerRaw, dictatedPlatforms); }
        catch (e) { return fail(`platform_identity_error:${String(e.message).slice(0, 80)}`); }   // never silently disable the join
        if (wrong.length) {
          // truncate at whole violations, never mid-domain (the correction hint dictates these cells)
          const details = [];
          let len = 0;
          for (const v of wrong) {
            const d = `${v.variant}:${v.missing.join("+")}`;
            if (len + d.length > 160 && details.length) break;
            details.push(d);
            len += d.length + 1;
          }
          return fail(`platforms_missing:${details.join(",")}`);
        }
      }
      // FIX (connotation): a clean meaning read must be backed by recorded MEANING searches in the ledger's
      // extras.pr_risk[] — else it is the fabricated-clearance incident (clean claimed, search never ran).
      // Searched-not-asserted, mirroring use-check; the receipt is machine-truth the model cannot fabricate.
      // Runs at the common-law stage AND in replay (an unsearched-clean archived run SHOULD flip pass→fail
      // — that is the fix); legacy runs with no ledger never reach here (ok() path below).
      // P2-C (§8b leg 2): the receipts-disposition arm is keyed on the grid-spec's own stamp (receipt-
      // presence, the D1 pattern) — the driver stamps every fresh spec, pre-P2-C archived specs lack it,
      // so replay verdicts on old runs never flip. Armed, EVERY recorded meaning query that returned
      // results owes a RULING on the driver-written form; the evidence run listed all its queries
      // and still reported clean past a recorded cultural-criticism receipt — a list is not a disposition.
      // (owner's ruling 2026-08-04): armed is now the whole condition. The gate used to additionally
      // require that some section matched a stock clean-claim phrase, which made a validation gate depend
      // on wording surviving the model's own redrafting — the 2026-08-04 R2 run was DELIVERED with 52
      // recorded receipts and zero checked. connotation_search_missing below rides the same structural
      // arm, so deleting the PR section no longer silences it either.
      const dispositionArmed = spec?.connotation?.disposition_required === true;
      // — the MERGED form the driver assembled from the halves at the merge. Without it the canonical
      // gate would judge the merged document against an artifact only the halves hold and fail a merge both
      // halves passed — the shape, an obligation visible at the merge that neither half could see.
      const mergedRecorded = dispositionArmed ? parsePrRiskResults(ledgerRaw) : null;
      const mergedForm = dispositionArmed
        ? dispositionForm(dirname(String(p ?? "")), spec?.connotation?.dispositions_path ?? "common-law-dispositions.json")
        : { rows: null, error: null };
      const conn = connotationViolations(c, parsePrRiskQueries(ledgerRaw),
        dispositionArmed ? { recorded: mergedRecorded, form: mergedForm.rows, formError: mergedForm.error } : {},
        dispositionArmed ? (spec?.connotation?.dispositions_path ?? null) : null);
      if (conn.some((v) => v.reason === "no_recorded_queries")) return fail("connotation_search_missing");
      const connFail = connotationDispositionFail(conn);
      if (connFail) return connFail;
      // P2-A candidate-cardinality is NOT a validator arm (review problem 1). `candidates[]` is raw,
      // unjudged web-search output, so "a hit cell received as No results" is a judgment about
      // RELEVANCE, not a contradiction code can decide — the first cut's hard arm flagged 221 cells
      // and failed an evidence run on this exact path. It ships as an asserted
      // advisory census on run.jsonl (pipeline.mjs `common-law-candidates`). What stays hard-gated is
      // matrix COMPLETENESS — findGridLedgerViolations above already fails `grid_join_missing` for a
      // dictated cell with no row at all, which is the part that IS deterministic.
      return ok("machine-receipts");
    }
    // D1 fail-closed: with a dictated grid spec on disk (fresh runs — the driver wrote it BEFORE the
    // grid ran) a missing plugin ledger means the grid never ran or its dataplane write failed; the
    // legacy-prose downgrade below would skip the exact join, the platform-identity join AND the
    // connotation gate the spec exists to arm. Keyed on the spec's OWN ledger_required stamp — the
    // receipt-PRESENCE key the D1 invariant demands: the driver stamps every fresh spec (pipeline.mjs
    // grid-spec producer), while pre-D1 archived specs lack it and stay on the prose path below
    // (replay verdicts never flip — the corpus holds one such run, 2026-06-24-ashen-spire, whose
    // spec exists with no ledger: a historical defect, not a regression to mint).
    if (spec?.ledger_required === true) return fail("grid_ledger_missing:common-law-grid.json absent while _driver/grid-spec.json dictates the grid");
    // Legacy prose path (no machine ledger): archived runs that carry the prose Negative-results matrix.
    if (manifest == null) return ok();
    const short = findReceiptViolations(manifest, c, { minCellsPerVariant });
    return short.length === 0
      ? ok()
      : fail(`receipts_short:${short.map((v) => `${v.variant}:${v.cells}/${v.expected}`).join(",")}`);
}

// — the EVIDENCE chain for `validators.commonLawHalf`, lifted out verbatim so the unavailability
// veto can wrap it instead of pre-empting it. Every return token is unchanged.
function commonLawHalfEvidence(p, c) {
    const half = String(p ?? "").match(/common-law-findings\.half-([a-z0-9]+)\.md$/)?.[1];
    if (!half) return fail("half_path_unrecognized");
    // — the meaning seat is judged on the meaning work, because that is all it was dictated.
    if (half === MEANING_SEAT) return commonLawMeaningSeat(p, c);
    const structural = commonLawStructural(c);
    if (!structural.ok) return structural;
    const gs = readGridSpecHalf(p, half);
    if (gs.invalid) return fail(`grid_spec_unreadable:_driver/grid-spec.half-${half}.json is corrupt or misshapen (driver-written — this is a bug, not a model defect)`);
    if (!gs.spec) return fail(`grid_spec_unreadable:_driver/grid-spec.half-${half}.json absent — the driver writes it before the half member spawns`);
    const spec = gs.spec;
    let ledgerRaw = null;
    try { ledgerRaw = readFileSync(join(dirname(p), `common-law-grid.half-${half}.json`), "utf8"); } catch { /* missing → fail-closed below */ }
    if (ledgerRaw == null) return fail(`grid_ledger_missing:common-law-grid.half-${half}.json absent while _driver/grid-spec.half-${half}.json dictates the grid`);
    let short;
    try { short = findGridLedgerViolations(spec.terms, ledgerRaw, { minCellsPerVariant: spec.platforms?.length || undefined }); }
    catch (e) { return fail(`grid_ledger_unparseable:${String(e.message).slice(0, 80)}`); }
    if (short.length) return fail(`grid_join_missing:${short.map((v) => `${v.variant}:${v.cells}/${v.expected}`).join(",")}`);
    if (spec.platforms?.length) {
      let wrong;
      try { wrong = findPlatformIdentityViolations(spec.terms, ledgerRaw, spec.platforms); }
      catch (e) { return fail(`platform_identity_error:${String(e.message).slice(0, 80)}`); }
      if (wrong.length) {
        const details = [];
        let len = 0;
        for (const v of wrong) {
          const d = `${v.variant}:${v.missing.join("+")}`;
          if (len + d.length > 160 && details.length) break;
          details.push(d);
          len += d.length + 1;
        }
        return fail(`platforms_missing:${details.join(",")}`);
      }
    }
    // P2-C (§8b leg 2) at the half seat — see the doc block above. Same tokens as the canonical
    // validator, so the corrective ladder's connotation hints and the repairs classifier apply unchanged.
    if (spec?.connotation?.disposition_required === true) {
      const recorded = parsePrRiskResults(ledgerRaw);
      // B — this seat records its rulings through the typed call; the driver's accumulator carries
      // them. Half a owns no meaning queries, so no accumulator is written for it and {rows:null}
      // leaves this validator with nothing to judge.
      const form = dispositionForm(dirname(p), spec?.connotation?.dispositions_path);
      const conn = connotationViolations(c, parsePrRiskQueries(ledgerRaw),
        { recorded, form: form.rows, formError: form.error },
        spec?.connotation?.dispositions_path ?? null);
      const connFail = connotationDispositionFail(conn);
      if (connFail) return connFail;
    }
    // (No candidate-cardinality arm here either — see the canonical commonLaw validator above. Both
    // lanes failed the archived evidence run on it; it is an advisory census now, not a gate.)
    return ok("machine-receipts");
}

// ── — A SECTION NAME THE SKILL SPELLS TWO WAYS ───────────────────────────
//
// These three tokens matched the SPACED form only, and the skill uses both forms for all three of them:
// negative results 14/8, coverage ledger 39/9, audit trail 41/6 (space/hyphen, counted across
// driver/skills). A model that follows the skill's section template passes; one that follows the
// checklist it reads LAST writes "Negative-results matrix" and dies.
//
// MEASURED, NOT SUPPOSED. An R6 clearance on the openai engine failed `common-law-half:a` twice on
// `missing:negative-results` with the section PRESENT and complete — "## Negative-results matrix", zero
// occurrences of the spaced form. The anthropic R6 that delivered on the same scenario wrote the spaced
// form three times. So this gate has been passing on one engine's phrasing habit rather than on any
// requirement anybody stated, and any model update or reworded skill trips it at random.
//
// ALL THREE ARE WIDENED, not only the one that bit. The other two happen to have been written spaced by
// both engines so far; that is luck, not design, and the class is the defect rather than the instance.
//
// THE WIDENING CANNOT ADMIT A DOCUMENT THAT LACKS THE SECTION. `[\s-]` still requires the two words
// adjacent with exactly one separator between them; it stops rejecting a document that HAS the section
// under the hyphenated compound the skill itself uses. The failure this removes is a false negative, and
// its cost was a clearance that had already spent an hour.
function commonLawStructural(c) {
  return all(
    nonEmpty(c),
    needs(c, [/^#{1,4}\s+[^\n]*\bfindings\b/im], "findings-heading"),
    needs(c, [/negative[\s-]results/i], "negative-results"),
    needs(c, [/coverage[\s-]ledger/i], "coverage-ledger"),
    needs(c, [/audit[\s-]trail/i], "audit-trail"),
    needs(c, [/\|/], "platform matrix"),
    hasCoverageLedgerRow(c) ? ok() : fail("no_coverage_status_row"),
  );
}

// ---- verdict parsing (the Phase-3 gate) ----
// Two-step read, calibrated on the 55-run replay corpus ( Tranche A gate):
//   1. LEADING token — reviewers state the verdict first ("**BLOCKING** — …", "VERDICT: CLEAR — …");
//      a leading token IS the verdict, so retrospective prose ("fixes the prior BLOCKING defects",
//      "no blocking condition triggered") never over-grades a CLEAR re-review into a corrective
//      loop (bare severity-max re-looped 7/55 archived runs — all leading-CLEAR re-reviews).
//   2. No leading token → on an EXPLICIT verdict line only (/verdict/i — D1: a retrospective top
//      line with neither a leader nor the label parses as NO verdict → the re-ask path, never a
//      graded one), the MOST SEVERE un-negated token wins: the old first-alternation scan returned
//      CLEAR on lines that LEAD with BLOCKING but also carry a clear-ish compound ("the
//      exact-name-clear conclusion") — the single most load-bearing judgment→machine joint
//      under-graded 3/55 archived runs. Over-grading here only costs a warm recheck — fail-safe,
//      like parse-fail ⇒ BLOCKING.
const VERDICTS = ["CLEAR", "CONDITIONAL", "BLOCKING"];   // ascending severity
// D1 negation guard — a verdict token with a negation immediately ahead of it ("NOT CLEAR",
// "ISN'T CLEAR", "Verdict: NOT CLEAR TO PROCEED") is a REFUSAL of that verdict, not a statement of
// it; the old scan read "NOT CLEAR" as CLEAR — the one direction this fail-safe design must never
// err in. At most one intervening word ("NOT fully CLEAR") plus markdown dressing: a window this
// tight never suppresses a genuinely stated verdict further along the line.
const NEGATED_AHEAD_RE = /\b(?:NOT|ISN'?T|AREN'?T|NO|NEVER|CANNOT|CAN'?T)(?:\s+\w+)?[\s*_:"'-]*$/;
// THE SAME REFUSAL, WRITTEN THE OTHER WAY ROUND.
//
// NEGATED_AHEAD_RE looks only BEHIND the token, so it catches "NOT CLEAR" and misses every idiom that puts
// the negation after it — and a reviewer refusing a verdict in ordinary professional English writes it
// after far more often than before:
//
//     "CLEAR cannot be granted on this record"        → read as CLEAR
//     "a clear verdict is not warranted"              → read as CLEAR
//     "Verdict: CLEAR cannot be issued; BLOCKING"     → read as CLEAR (and the stated BLOCKING never reached)
//
// CLEAR is the one answer with no downstream check: it skips the corrective synthesis, the warm recheck and
// the terminal, so the report ships with the reviewer's own objections unaddressed. This is the exact
// direction the D1 guard exists to prevent — it was simply only half-built.
//
// Kept TIGHT for the same reason its sibling is: a short window, an optional intervening word, so a
// negation belonging to a later clause cannot reach back and suppress a genuinely stated verdict. The cost
// of a false positive here is a re-ask, which is the safe outcome; the cost of a false negative is a
// delivered report contradicting its own reviewer.
const NEGATED_BEHIND_RE = /^[\s*_:"'-]*(?:\w+\s+)?\b(?:CANNOT|CAN'?T|IS\s+NOT|ISN'?T|ARE\s+NOT|AREN'?T|WAS\s+NOT|WASN'?T|WOULD\s+NOT|WOULDN'?T|SHOULD\s+NOT|SHOULDN'?T|MAY\s+NOT|MUST\s+NOT|NOT)\b/;
const negatedAround = (up, start, end) =>
  NEGATED_AHEAD_RE.test(up.slice(Math.max(0, start - 24), start)) || NEGATED_BEHIND_RE.test(up.slice(end, end + 28));
const mostSevereVerdict = (text) => {
  const up = String(text ?? "").toUpperCase();
  let found = null;
  for (const v of VERDICTS) {                            // ascending order — the last un-negated hit is most severe
    const re = new RegExp(`\\b${v}\\b`, "g");
    for (let m; (m = re.exec(up)) != null; ) {
      if (!negatedAround(up, m.index, m.index + v.length)) { found = v; break; }
    }
  }
  return found;
};
// The leading scan short-circuits the whole parser — it returns on the first line that STARTS with a
// verdict word — so it had to carry the guard too. It had none at all: every hedged refusal above is a
// leading CLEAR, and none of them ever reached the severity scan where the guard lived.
const leadingVerdict = (line) => {
  const up = String(line ?? "").toUpperCase();
  const m = up.match(/^[\s#>*_-]*(?:VERDICT[:*\s]+)?[\s*_]*(CLEAR|CONDITIONAL|BLOCKING)\b/);
  if (!m) return null;
  const end = m.index + m[0].length;
  return NEGATED_BEHIND_RE.test(up.slice(end, end + 28)) ? null : m[1];
};
export function parseVerdict(content) {
  const lines = (content ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 3)) {            // verdict is at/near the top
    const lead = leadingVerdict(line);
    if (lead) return lead;
    if (!/verdict/i.test(line)) continue;            // D1: the severity-max fallback keys on explicit verdict lines only
    const hit = mostSevereVerdict(line);
    if (hit) return hit;
  }
  const m = (content ?? "").match(/verdict[:*\s]+.{0,80}/i);   // "Verdict: …" anywhere — scan the window
  return m ? mostSevereVerdict(m[0]) : null;
}

/**
 * — A VERDICT SETTLED AGAINST A REVIEW THAT HAS SINCE BEEN REWRITTEN.
 *
 * `UPSTREAM_STALE_REPAIR["narrative-refutation"]` re-runs the reviewer at DELIVERY time, long after the
 * verdict gate. Its caller re-reads what the repaired stage wrote — findings.json, the case-law layer —
 * but not `senior-eye-review.md`, which is the one artifact that stage authors. So the reviewer could
 * refuse to sign at 00:52 and the run would deliver on the verdict it settled at 00:22 (,
 * `bf21580e`, 2026-08-23: a registration date contradicting the fetched record reached the client).
 *
 * ONE DIRECTION ONLY, and that is deliberate. This returns the file's verdict when it is STRICTER than
 * the one carried, and null otherwise. A review that has SOFTENED must not lift a clamp: the whole
 * verdict path never lowers (the coverage floor says so in its own comment), and a repair pass is not
 * the place to start. Returning null for "same" and for "milder" keeps this a one-way ratchet.
 *
 * Null on an unparseable review as well — the caller's own fail-safe already reads a parse failure as
 * BLOCKING at the gate, and inventing a second, differently-shaped fail-safe here would give the same
 * question two answers. PURE.
 */
export const VERDICT_RANK = { CLEAR: 0, CONDITIONAL: 1, BLOCKING: 2 };   // ascending severity
export function verdictHardenedTo(carried, reviewMd) {
  const now = parseVerdict(reviewMd);
  if (!now) return null;
  const a = VERDICT_RANK[String(carried ?? "").toUpperCase()];
  const b = VERDICT_RANK[now];
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return b > a ? now : null;
}

// Repair-first A5 (2026-07-05) — count the CITED defects in a review body: bullet/numbered lines after
// the verdict line, excluding the PLAN-EXECUTION CHECK audit section (present on every plan run whether
// or not defects exist). A BLOCKING with zero cited defects is a DEGENERATE artifact (nothing exists for
// the corrective ladder to fix) — the verdict gate refuses it with one evidence-demanding re-ask instead
// of killing the run over reviewer noise. Pure; seeded from the copper-spire fixture shape.
// ── — ONE DEFINITION OF WHAT A LIST LINE LOOKS LIKE, READ BY BOTH WALKS ─────────────────────────
//
// The two guards must not share a POLICY and they still do not: what separates them is which sections
// they read, and whether a bullet under a flag is that flag's body. Whether a line is a list item at
// all is NOT policy — and while each walk carried its own copy of that answer, the copies drifted.
// taught one of them to see `**1.` and left the other on the pre- pattern, so the walk whose
// job is to decide whether to DISCARD a review quietly became the stricter of the two.
//
// Restating the marker in a second place is what made that possible, so it is stated once here. Both
// readers below derive from it and cannot disagree about a line shape again; they differ only where the
// design says they should.
// The trailing `\*{0,2}` is the bold CLOSER: reviewers write both `**1. [kind: …]** text` (bold around
// the marker and its tokens) and `**1.** text` (bold around the marker alone). The second counted ZERO
// on both walks — consistently, so it is not the asymmetry above, but it is the same defect wearing a
// different style, and 's criterion says a bold-numbered flag must count. It cannot swallow prose:
// a single letter or digit must still be followed by its own `.` or `)`, so `**Note.** …` matches nothing.
const LIST_MARKER = String.raw`(?:\*{0,2})(?:[-*•]|\d+[.)]|[A-Za-z][.)])(?:\*{0,2})\s+`;
const LIST_LINE_RE = new RegExp(`^${LIST_MARKER}\\S`);

export function countCitedDefects(reviewMd) {
  const rest = String(reviewMd ?? "").split("\n").slice(1);
  let inPlanAudit = false;
  let n = 0;
  for (const raw of rest) {
    const ln = raw.trim();
    if (/^#{1,6}\s+\S/.test(ln) || /^[A-Z][A-Z /&-]{5,}$/.test(ln)) inPlanAudit = /PLAN-EXECUTION CHECK/i.test(ln);
    if (inPlanAudit) continue;
    // — SAME LINE SHAPE AS THE PRECISE WALK, ON PURPOSE. These two guards must not share a
    // SELECTOR, and for a while that was read as "must not share anything": this one kept the pre-
    // pattern, which itself recorded as blind to `**1.` — the form every typed flag is written
    // in. So the walk whose job is to decide whether to DISCARD a review was the STRICTER of the two,
    // and a BLOCKING review carrying only its bold flags counted zero and was refused.
    //
    // What separates the two is POLICY — which sections are read, and whether a bullet under a flag is
    // that flag's body. Whether a line is a list item at all is not policy, and the two disagreeing
    // about it was never the design. This one stays the permissive one by walking the whole document
    // bar the plan audit and applying no body rule, which is a superset by construction.
    if (LIST_LINE_RE.test(ln)) n++;
  }
  return n;
}

// qw/typed-correction-kinds — the reviewer TYPES its corrections. TELEMETRY FIRST: today these kinds
// feed exactly one run.jsonl histogram (pipeline `correction-kinds`); the "skip the corrective pass on
// narrative-only reviews" decision is a separate OWNER-GATED build, so nothing anywhere may branch on
// a kind yet. Doctrine mirrors typed actions (stages.mjs ACTIONS REGISTER): the AUTHOR
// declares the kind from its own legal read; code only PARTITIONS the closed enum — never a keyword
// grep over the correction's prose (the spec's named failure mode). The closed enum:
//   coverage-disposition — a coverage row / disposition placement is wrong or dishonest;
//   fact                 — a factual defect (record values, owners, statuses, dates). THE FAIL-SAFE:
//                          an untyped line or an unknown token partitions here, because fact is the
//                          kind that always keeps the corrective pass running when the skip logic
//                          lands later — a mis-typed or legacy line can only ever OVER-correct;
//   rating               — a band/rating the reviewer challenges;
//   narrative            — prose/structure/voice of the narrative.
// THE LINE WALK IS NO LONGER countCitedDefects's, AND THAT IS DELIBERATE. It was, and the
// sentence here used to say so — but one selector serving both is exactly the defect: that guard decides
// whether to REFUSE a BLOCKING verdict as degenerate (destructive, so permissive evidence is correct),
// this one builds the corrective worklist and publishes the verdict's grounds (additive, so precise
// evidence is correct). See the block above `parseCorrections` for what a flag is now. PURE.
export const CORRECTION_KINDS = ["coverage-disposition", "fact", "rating", "narrative"];
const CORRECTION_KIND_RE = /\[kind:\s*([a-z][a-z-]*)\s*\]/i;
// — THE SECOND CHANNEL: WHICH FINDING A FLAG IS ABOUT.
//
// The reviewer already writes it, in prose — a delivered review's flags open "Finding 9 — DELPHIC…",
// "Findings 4, 7, 8." — and the driver could not read it: `targetsOf` matched mark/owner NAMES and
// returned nothing for six of nine flags on that run. So the corrective pass re-emitted the whole
// narrative and the whole findings.json, for 683 seconds, and exactly ONE finding moved.
//
// A DECLARED CHANNEL, not a prose grep. Same shape as `[kind: …]` above and for the same reason
// (//): the model cites an identifier the driver validates, rather than the driver fishing
// an identity out of a sentence. `[on: 9]`, `[on: 6, 12]`, or `[on: -]` for a flag about no particular
// finding (a structural or whole-document objection).
//
// `null` MEANS "THE REVIEWER SAID NOTHING", and it is not the same fact as `[]`. Null is the fail-safe
// and it scopes to EVERYTHING — today's behaviour exactly — so a review written before this token was
// taught, or one that drops it, costs nothing and hides nothing. `[]` is an explicit "no finding", from
// `[on: -]`. The scope narrows only when the channel is complete, which is the evidence gate.
const CORRECTION_ON_RE = /\[on:\s*([0-9,\s-]*?)\s*\]/i;
function parseOn(line) {
  const raw = line.match(CORRECTION_ON_RE)?.[1];
  if (raw == null) return null;                       // no token at all — the fail-safe
  const ords = [...String(raw).matchAll(/\d+/g)].map((m) => Number(m[0])).filter(Number.isInteger);
  return [...new Set(ords)].sort((a, b) => a - b);    // `[on: -]` ⇒ [] — declared, and different from null
}
// ── — WHAT COUNTS AS A FLAG, AND WHY IT IS NOT "ANY BULLET" ──────────────────────────────────
//
// The old selector was `^(?:[-*•]|\d+[.)])\s+\S`, and it skipped EVERY typed correction the reviewer
// wrote. The reviewer writes them bold-numbered — `**1. [kind: coverage-disposition] [on: 4] …` — and
// against that line `^[-*•]` matches the first asterisk, then `\s+` meets the second and the match
// fails. Measured on a preserved review (an R2 comparison round, 2026-08-22): 10 lines selected, 0
// carrying a `[kind:]` token, over a document holding 14 bold-numbered corrections, all 14 typed.
//
// What it selected instead was noise of two shapes, and the second is why fixing the numerator alone
// would not have been enough: five self-check answers from the reviewer's own sanity section
// (`- **Risk shape?** …`), and five quoted excerpts nested in the body of correction 11 (`- "…"`). Both
// are list items. Neither is a flag. Those ten lines became the published `blockingGrounds` of a
// BLOCKING verdict, and every one of them reads as PASSING.
//
// THREE RULES, AND EACH ONE IS LOAD-BEARING AGAINST A DIFFERENT ESTABLISHED CONTRACT:
//
//   1. A list item may be BOLD-WRAPPED. This is the actual bug fix and nothing else depends on it.
//   2. Sections that audit the REVIEWER are not sections that flag the REPORT (`NOT_A_CORRECTIONS_SECTION`).
//   3. A bullet beneath a NUMBERED flag is that flag's body.
//
// What was tried and abandoned: "if any flag declares its kind, only declared lines are flags", read
// off the skill's own "Either every flag has one or none of them do any work." It is a cleaner rule and
// it is wrong here — fixes an untyped line sitting AMONG typed ones and requires it to still read
// as a `fact` correction, which that rule silently drops. Recorded so nobody re-derives it.
//
// Section scoping to a single corrections heading was also rejected: the skill scatters flags across
// fifteen named check sections, each ending "FLAG as [kind: …]", so there is no one section a flag
// lives in. Only the reviewer's SELF-audit sections can be excluded, which is what rule 2 does.
//
// `countCitedDefects` DELIBERATELY KEEPS THE OLD PERMISSIVE WALK, and the comment beside it that once
// said the two walks were the same is now wrong on purpose. The two guards instruct opposite actions:
// that one decides whether to REFUSE a BLOCKING verdict as degenerate, so its evidence must be
// permissive — being wrong there discards a real review. This one builds a worklist and publishes the
// verdict's grounds, so its evidence must be precise. One selector for both directions IS the bug.
//
// ── — THE SECTION RULE IS AN ALLOWLIST, BECAUSE A DENYLIST FAILS OPEN ─────────────────────────
//
// Rule 2 shipped as a denylist of the reviewer's self-audit sections, and it lasted hours. A live review
// carried `## Skeptic flags and reopen deferrals` — on nobody's list — holding six bullets that are the
// reviewer's record of what it had ALREADY resolved ("→ corrected", "→ closed", "→ addressed"). All six
// parsed as corrections, typed `fact` by the fail-safe, and would have been published as grounds of a
// BLOCKING verdict beside the eleven real ones. Measured: 17 rows where 11 are real, a 55% inflation.
//
// A DENYLIST IS ONLY AS COMPLETE AS WHOEVER LAST TYPED IT, and the direction of its failure is what
// settles this: an unrecognised heading silently BECOMES corrections. The allowlist fails the other way
// — an unrecognised heading contributes nothing, and the parse says which section it read.
//
// KEYED ON THE WORD, NOT ON A PHRASE, and that is measured rather than guessed. Across the preserved
// reviews on the test instance the corrections heading is written five different ways:
//   `Flagged corrections` (dominant) · `Residual corrections` · `Flagged correction still standing` ·
//   `Corrections that still stand` · and one review with no heading at all.
// A literal `Flagged corrections` would drop three of those. `correction` as a word catches all four
// headings and excludes every other section in those documents — including `Skeptic flags and reopen
// deferrals`, `Headline, re-derived independently`, `Grounded profiles` and the plan audit.
//
// THE HEADLESS FALLBACK IS DELIBERATE AND IT IS NOT A DENYLIST IN DISGUISE. A review with NO corrections
// heading anywhere still has corrections — 's fixture is exactly that, and 's writes them under
// `## Corrections`. So: if the document names a corrections section, ONLY that section is read; if it
// names none, the whole document is read as before. The fallback cannot reopen this defect, because it
// only applies to documents that have no section structure to get wrong.
export const CORRECTIONS_SECTION_RE = /\bcorrections?\b/i;

// Kept, and now only reachable on the headless path below. It is no longer the mechanism — it is the
// last line of defence for a document that names no corrections section at all, where the plan audit is
// still the one heading that is never corrections. Exported because the pin test reads it.
export const NOT_A_CORRECTIONS_SECTION_RE =
  /plan-execution(?:\s+(?:check|audit))?|headline sanity|self-coherence|your own output must be coherent/i;
// ── — A LETTERED FLAG IS A FLAG. THE SELECTOR IS A CLAIM ABOUT THE REVIEWER'S HANDWRITING ──────
//
// The reviewer is not constrained to one enumeration style, and it uses more than one. A live review
// wrote its three open defects as `**A. [kind: fact] [on: 6, 18]**` — correctly typed, correctly
// scoped, and INVISIBLE to a selector that admitted only bullets and digits. The parse returned the
// nine CLOSED resolution bullets from elsewhere in the document and none of the three open items: a
// worklist of already-fixed things, and an empty set for what still stands.
//
// THE FAILURE IS SILENT IN THE WORST DIRECTION. An unreadable flag does not error — it is simply not
// there, and every downstream count agrees with itself about a document it never read. Both directions
// of 's lesson apply at the LINE level too: too permissive publishes noise as grounds, too strict
// drops the grounds entirely.
//
// SCOPE OF THE WIDENING, MEASURED RATHER THAN ASSUMED. Across the 28 distinct reviews on both scratch
// roots of this box, 3 change and 25 do not. Nine rows are added, each a correctly-typed lettered flag
// (`**A. [kind: fact] [on: 6, 18]**` and its siblings) — none reaches the untyped fail-safe. Two rows are
// REMOVED: quoted `_records/*.json` excerpts that Rule 2 now reads as the body of the flag above them,
// which is the inflation control doing its job on the new form. Net +7 on 28 documents.
//
// TWO OF THOSE THREE DOCUMENTS PARSED TO ZERO BEFORE. Their entire corrections section was lettered, so
// the worklist was empty and nothing anywhere said so — which is the shape of the defect, not a detail
// of it. An unreadable flag is indistinguishable from a clean review.
const FLAG_LINE_RE = new RegExp(`^${LIST_MARKER}(\\S.*)$`);

/**
 * A list item's own content, with its marker and any bold wrapper stripped — or null if the line is not
 * a list item at all. Broader than the selector it replaces, and deliberately: the old one could not see
 * a bold-numbered item, which is the form every typed flag was written in. added the lettered
 * form for the same reason — the enumeration style is the reviewer's choice, not part of the contract.
 */
export function correctionFlagContent(line) {
  return String(line ?? "").trim().match(FLAG_LINE_RE)?.[1] ?? null;
}

/** Does this list item's content OPEN with its kind token, as the skill dictates a flag must? PURE. */
export const opensWithKind = (content) => /^\[kind:/i.test(String(content ?? "").trim());

/**
 * WHICH SECTION THE PARSE READ, AS A FACT RATHER THAN AN INFERENCE.
 *
 * A reader of `total: 0` cannot otherwise tell "the corrections section was empty" from "no heading
 * matched and the whole document was skipped". The allowlist fails closed on purpose, and a guard that
 * fails closed silently is how a real defect reads as a clean run.
 *
 * `named: false` is not a fault — it is the headless document 's fixture is built from, and the walk
 * falls back to the whole document. It is reported so a caller can tell the two apart.
 *
 * PURE.
 */
export function correctionsSection(reviewMd) {
  const rest = String(reviewMd ?? "").split("\n").slice(1);
  for (const raw of rest) {
    const ln = raw.trim();
    if (!(/^#{1,6}\s+\S/.test(ln) || /^[A-Z][A-Z /&-]{5,}$/.test(ln))) continue;
    if (CORRECTIONS_SECTION_RE.test(ln)) return { named: true, heading: ln.replace(/^#+\s*/, "").trim() };
  }
  return { named: false, heading: null };
}

export function parseCorrections(reviewMd) {
  const rows = [];
  const rest = String(reviewMd ?? "").split("\n").slice(1);

  const { named, heading } = correctionsSection(reviewMd);
  const isHeading = (ln) => /^#{1,6}\s+\S/.test(ln) || /^[A-Z][A-Z /&-]{5,}$/.test(ln);
  void heading;

  const candidates = [];
  let excluded = !named ? false : true;    // allowlist mode starts CLOSED — nothing counts until the section opens
  let sawEnumeratedFlag = false;
  for (const raw of rest) {
    const ln = raw.trim();
    if (isHeading(ln)) {
      excluded = named
        ? !CORRECTIONS_SECTION_RE.test(ln)              // allowlist: only the corrections section is read
        : NOT_A_CORRECTIONS_SECTION_RE.test(ln);        // headless: the old walk, minus the plan audit
      sawEnumeratedFlag = false;           // the body rule below is per section
    }
    if (excluded) continue;
    const content = correctionFlagContent(ln);
    if (content == null) continue;
    // RULE 2 — A BULLET UNDER A NUMBERED FLAG IS THAT FLAG'S BODY.
    //
    // The reviewer writes `**11. [kind: narrative] …` (or `**C. [kind: narrative] …`) and then lists
    // the sentences it objects to
    // underneath as `- "…"` bullets. Those are evidence FOR a correction, not five more corrections,
    // and counting them is how five quoted excerpts became five of the published grounds of a BLOCKING
    // verdict. A review that writes its flags as BULLETS never trips this — no numbered flag is ever
    // seen, so every bullet stays a flag, which is 's contract and 's fail-safe both intact.
    // ORDER MATTERS: ask "is this enumerated" FIRST. `**2. [kind: …]` begins with an asterisk, so a
    // bullet test run before the enumerated test swallows every flag after the first as the first
    // one's body.
    //
    // — THE BODY RULE HAS TO WIDEN WITH THE SELECTOR, OR WIDENING MAKES THINGS WORSE. If `A.`
    // becomes a flag but does not arm this rule, the quoted excerpts under it stay flags of their own
    // and a lettered review inflates exactly the way the numbered form did before Rule 2 existed. The two must move
    // together — that is why this is one change and not two.
    const isEnumerated = /^(?:\*{0,2})(?:\d+|[A-Za-z])[.)]/.test(ln);
    if (!isEnumerated && sawEnumeratedFlag && /^(?:\*{0,2})[-*•]/.test(ln)) continue;
    if (isEnumerated) sawEnumeratedFlag = true;
    candidates.push({ ln, content });
  }

  for (const { ln, content } of candidates) {
    const declared = ln.match(CORRECTION_KIND_RE)?.[1]?.toLowerCase() ?? null;
    const typed = declared && CORRECTION_KINDS.includes(declared);
    rows.push({
      n: rows.length + 1,
      kind: typed ? declared : "fact",       // fail-safe: unknown/missing kind ⇒ fact
      typed: Boolean(typed),
      // The flag as the reviewer wrote it, minus the bullet and its own kind token — the token is the
      // channel, not the instruction, and repeating it back adds nothing a reader acts on.
      // — the findings this flag declares itself to be about. null ⇒ undeclared ⇒ scopes to all.
      ordinals: parseOn(ln),
      text: content.replace(CORRECTION_KIND_RE, "").replace(CORRECTION_ON_RE, "").replace(/\s{2,}/g, " ").trim(),
    });
  }
  return rows;
}

/**
 * The histogram, DERIVED from the rows. One walk, one definition of "a correction line". PURE.
 *
 * — `ok` IS THE TELL, AND IT IS THE ONE THING NOBODY WAS READING. The all-zero histogram was
 * built to catch is legible as an anomaly; `fact: 10` on a BLOCKING run is not. `untyped === total` on a
 * non-empty parse means the type channel produced NOTHING and every row landed on the fail-safe — which
 * is indistinguishable, in the counts alone, from a review whose flags were all genuinely factual. A
 * fail-safe that fires on every line is a fail-safe that never fired.
 *
 * Reported, not thrown, and additive to the existing shape: a caller that reads only `counts` behaves
 * exactly as before.
 */
export function parseCorrectionKinds(reviewMd) {
  const rows = parseCorrections(reviewMd);
  const counts = Object.fromEntries(CORRECTION_KINDS.map((k) => [k, 0]));
  for (const r of rows) counts[r.kind]++;
  const untyped = rows.filter((r) => !r.typed).length;
  const allUntyped = rows.length > 0 && untyped === rows.length;
  return {
    counts, untyped, total: rows.length,
    // — which section these counts came from. `section: null` on a non-zero total means the
    // document named no corrections heading and the whole of it was read; on a zero total it is the
    // difference between "nothing was flagged" and "nothing was found where we looked".
    section: correctionsSection(reviewMd).heading,
    ok: !allUntyped,
    ...(allUntyped
      ? { why: `every one of the ${rows.length} correction line(s) parsed landed on the untyped fail-safe, so the `
          + `reviewer's kind channel yielded nothing — read the review, not these counts` }
      : {}),
  };
}

// B2 — reviewer self-coherence (necessary-not-sufficient; surfaced as an INTERNAL banner, NEVER a gate):
// catch the two documented degradation shapes from the teal-anvil review — a same-line self-contradiction
// ("DISPUTED → DEFENSIBLE", "BLOCKING → CLEAR") and a CONDITIONAL/BLOCKING verdict whose body lists no
// flags (a verdict with nothing behind it). Full word-salad detection is not deterministic — the semantic
// backstop is a staff lawyer. PURE; empty/missing input → [].
export function findReviewerCoherenceFlags(md) {
  const out = [];
  const t = String(md || "");
  // (1) same-CLAUSE self-contradiction: an adverse VERDICT/disposition token arrowed straight into its
  // opposite within a tight window (the documented "DISPUTED → DEFENSIBLE" / "BLOCKING → CLEAR" shape).
  // Tight window + verdict-grade tokens only (NOT bare "high"/"low", which appear in legitimate prose like
  // "high-risk → lower the tier") so cross-finding sentences don't false-fire.
  for (const ln of t.split("\n")) {
    if (/\b(?:blocking|disputed|adverse)\b[^\n]{0,14}(?:→|->|=>)[^\n]{0,14}\b(?:clear|defensible|manageable)\b/i.test(ln)) {
      out.push(`reviewer self-contradiction on one line: "${ln.trim().slice(0, 120)}"`); break;
    }
  }
  // (2) degenerate verdict: a CONDITIONAL/BLOCKING with NOTHING behind it. Count anything that could be a
  // flag in the body (after the verdict line): a bullet, a numbered item, OR a substantive (≥30-char) line.
  const v = parseVerdict(t);
  if (v === "CONDITIONAL" || v === "BLOCKING") {
    const body = t.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);   // drop the verdict line
    // — THE THIRD READER OF THE SAME QUESTION, and it carried its own answer: no bold wrapper, no
    // lettered enumeration, no `•`. The `length >= 30` fallback hid it, because a real flag carrying its
    // kind and scope tokens clears 30 characters easily — so the misfire needs flags that are BOTH an
    // unrecognised shape AND short, and then it annotates a correctly-formed review "lists no flags behind
    // it". Telemetry only, and that is the reason to fix it rather than not: a coherence signal that fires
    // on correct input stops being believed, which costs more than the signal is worth.
    const flagish = body.filter((l) => LIST_LINE_RE.test(l) || l.length >= 30).length;
    if (flagish === 0) out.push(`reviewer verdict is ${v} but lists no flags behind it`);
  }
  return out;
}

// ---- coverage-ledger presence (coverage honesty) ----
//
// TWO CALLERS, TWO ERAS — recorded here because this helper was once read as register-digest's LIVE
// status-vocabulary contract, alongside registerUnit's retirement note, and the two looked like
// divergent arms of one requirement. They are three different contracts:
//   · commonLawStructural (LIVE) — the common-law findings' prose Coverage ledger still carries these
//     tokens, and this floor still polices it.
//   · registerFindings' UNSTAMPED arm (ARCHIVE-ONLY since  M6) — judges pre- archived replays
//     whose seats hand-wrote the prose table. No live run reaches it; replay verdicts get quoted, so
//     it stays.
//   · register-digest's LIVE path carries the same three tokens as VALUES through the
//     `record_coverage` typed call into the `_driver/` accumulator (coverage-call.mjs /
//     coverage-tool.mjs) — never prose, and never through this helper. registerUnit's own note
//     ("the old coverage vocabulary requirement is RETIRED — the funnel must not author it") is about
//     the FUNNEL, a fourth thing, and contradicts none of the above.
export function hasCoverageLedgerRow(content) {
  return /(confirmed-clean|coverage-limited|deferred)/i.test(content ?? "");
}

// ---- V4-4: commission-more-work phrasing on marketplace coverage gaps ----
// A sentence violates when it BOTH references marketplace/platform coverage AND recommends a
// re-run / further search as next-step work for a human. Returns the offending sentences.
const COVERAGE_CONTEXT_RE = /\bmarketplace|platform|storefront|app ?store|non-latin|transliterat|coverage|grid cell/i;
const COMMISSION_RE = /\b(?:targeted|manual|separate|further|supplementary)?\s*re-?run\b[^.\n]{0,80}\b(?:next step|recommended?|before (?:client )?sign-?off|should be (?:run|commissioned|performed))|\b(?:recommend|commission)\b[^.\n]{0,60}\b(?:re-?run|further (?:search|sweep)|targeted (?:search|sweep|re-?run))|\bis the next step\b/i;
export function findCoverageRecommendations(content) {
  return String(content ?? "")
    .split(/(?<=[.!?])\s+|\n/)
    .filter((s) => COVERAGE_CONTEXT_RE.test(s) && COMMISSION_RE.test(s))
    .map((s) => s.trim().replace(/\s+/g, " "));
}

// ---- findings.json sibling check — folded into validators.narrative so runtime == replay ----
// The synthesis stage saves its RATED findings to a sibling findings.json (the MACHINE FINDINGS dictation,
// stages.mjs). The JSON is the SINGLE source of truth: the report + Excel render FROM it (render.mjs /
// xlsx.mjs), the narrative prose is the lawyer's REASONING, not a second authority — so the prose↔JSON
// mirror is RETIRED (Instance #4: the mirror enforced a prose-mention shape with no structural consequence;
// an omitted mark never corrupts the render, and a staff lawyer reviews the prose anyway). Machine-vs-legacy dispatch:
// NO sibling ⇒ legacy ok() (archived runs never carry it, so replay verdicts never flip); present-but-bad ⇒
// fail() with the parser's token-first reason (the parser throws; a validator must NEVER throw — runStage
// calls it bare) → drives the corrective/warm ladder; valid ⇒ ok("machine-findings").
// Instance #5 — the per-finding use-check / own-rights cite is now STRUCTURED (findings.json use_check /
// own_rights), replacing the prose-regex gates. The parser shape-validates the fields; the substantive gate
// lives HERE so it carries the ordinal context: a Composite-3+ finding whose use_check is present must carry a
// NON-BLANK source (the searched result or the honest negative), and any present own_rights likewise. Both
// fields are OPTIONAL — a finding that simply omits them passes (so a candidate-self finding that omits
// own_rights can never false-fire). Never blocks delivery (never-withhold): a hard failure rides the existing
// synthesis corrective ladder, and a stubborn miss still ships via the legacy/flag path.
function checkFindingsSibling(p, c) {
  let raw = null;
  try { raw = readFileSync(join(dirname(p), "findings.json"), "utf8"); } catch { /* legacy / not-yet-populated run */ }
  if (raw == null) return ok();
  // doc 50 — a v4 record is judged against the run's FROZEN framework manifest (band words + the
  // material-band line). A v4 record with no frozen manifest is a driver bug: fail LOUD, never judge a
  // rated matter without its vocabulary. Legacy (v≤3) records never look for one — replay never flips.
  const fw = readRunFramework(p);
  if (fw.invalid) return fail("framework_manifest_unreadable: _driver/framework.json is corrupt (driver-written — this is a bug, not a model defect)");
  let parsed;
  // — the gate on the model-written URL column. `recordOriginsFor` resolves a COMPOSITE through
  // its members, so a free-tier run allows both EUIPO and USPTO hosts rather than neither. With no
  // provider named the option is omitted entirely and the gate stays inactive, which is the same
  // polarity every other era-scoped gate in this file uses.
  const recordOrigins = activeRecordOrigins();
  try {
    parsed = parseFindingsJson(raw, {
      ...(fw.manifest ? { manifest: fw.manifest } : {}),
      ...(recordOrigins ? { recordOrigins } : {}),
    });
  }
  catch (e) { return fail(String(e.message).replace(/\s+/g, " ").slice(0, 160)); }
  const v4 = (parsed.schemaVersion ?? 1) >= 4;
  if (v4 && !fw.manifest) return fail("framework_manifest_missing_for_v4: schema_version 4 findings need the frozen _driver/framework.json to judge band words");
  const v3 = (parsed.schemaVersion ?? 1) >= 3;   // gates key on schema_version — v2/archived runs and replay never flip
  // "material finding" — the line the receipt gates key on: composite>=3 on the legacy scale; on v4,
  // banded ABOVE the framework's lowest band (judgment-free re-expression of the same line).
  const material = (f) => v4 ? (f.band != null && aboveLowestBand(fw.manifest, f.band)) : f.composite >= 3;
  for (const f of parsed.findings) {
    if (material(f) && f.use_check != null && !String(f.use_check.source ?? "").trim())
      return fail(`finding_use_check_source_missing:${f.ordinal}`);
    if (f.own_rights != null && !String(f.own_rights.source ?? "").trim())
      return fail(`finding_own_rights_source_missing:${f.ordinal}`);
    if (v3) {
      // A4 — a "verified-from-record" meter must NAME its record/URL; a bare verified stamp
      // is exactly the self-attestation the review caught presenting inferred facts as verified.
      for (const [name, entry] of Object.entries(f.meters ?? {})) {
        if (entry?.basis === "verified-from-record" && !String(entry.source ?? "").trim())
          return fail(`finding_basis_source_missing:${name}:${f.ordinal}`);
      }
      // A4 — SYMMETRIC use-check: any ASSERTED use status on a scored finding needs its
      // receipt — confirmed use was previously receipt-free (only negatives were gated), which let
      // "use confirmed / EMA Nov 2025" ship with no act behind it. `unknown` stays receipt-free.
      const useTok = f.meters?.use?.token;
      if (material(f) && (useTok === "confirmed" || useTok === "not-confirmed")
          && !String(f.use_check?.source ?? "").trim())
        return fail(`finding_use_check_missing:${f.ordinal}`);
    }
  }
  return ok("machine-findings");
}

// ---- strict-parse a machine artifact through its own parser (frame-omission design) ----
// The parsers THROW token-first; a validator must NEVER throw (runStage calls it bare), so the throw is
// converted to fail() and the token rides the failure string into the corrective/warm ladder's hint.
// Handed content directly — an empty or truncated file is a JSON.parse throw, i.e. a named failure, never
// an "ok" with nothing behind it.
function checkJson(raw, parseFn, okReason) {
  try { parseFn(raw ?? ""); }
  catch (e) { return fail(String(e.message).replace(/\s+/g, " ").slice(0, 160)); }
  return ok(okReason);
}

// ---- sibling-JSON check for the frame-diff machine artifact (frame-omission design) ----
// frame-diff writes prose to its expectFile (validated for non-emptiness) AND a STRUCTURED sibling JSON the
// pipeline consumes (the reopen directives). The JSON is the load-bearing artifact, so it is REQUIRED here
// (token-first absence + parse defects → the corrective/warm ladder repairs it). This is REPLAY-SAFE
// because frame-diff.md is not a FILE_CHECKS target (replay never calls this validator); the stage is
// NON-FATAL in the pipeline, so a stubborn miss degrades to "no reopen this run" and never kills delivery.
// blind-frame no longer has a sibling at all: since its structured model IS its output (checkJson).
function checkSiblingJson(p, siblingName, parseFn, okReason, missingToken) {
  let raw = null;
  try { raw = readFileSync(join(dirname(p), siblingName), "utf8"); } catch { /* sibling not written */ }
  if (raw == null) return fail(missingToken);
  return checkJson(raw, parseFn, okReason);
}

// ── — THE DRIVER-WRITTEN DISPOSITION FORM ──────────────────────────────────────────────────────
//
// The file is DRIVER-WRITTEN and seat-filled: the driver computes every row, id and candidate from the
// ledger; the seat sets `ruling`, `note`, the `receipt_id` it ruled on and — on the rows the driver marked
// — a `quote`. This reads it. It never writes: a validator that repaired its own input could not be
// replayed, and the writers are named in findConnotationViolations' doc block.
//
// WHAT IT READS IS THE DRIVER'S OWN COPY in `_driver/` (formSidecarName), not the seat-facing file, and
// the difference is the whole of the replay-safety argument:
//
//   · IT IS THE ERA STAMP. The sidecar exists only where a driver carrying this code ran. Every archived
//     run predates the form, so the arm is OFF for all of them and no historical verdict flips — including
//     for the one archived run that carries a -era `{dispositions:[…]}` sibling, which is the RETIRED
//     artifact written under a contract that no longer exists. Judging that file as a form would refuse a
//     delivered clearance for failing to fill in something nobody ever handed it.
//   · IT CANNOT BE DELETED INTO A PASS. The seat is never told about `_driver/`, and the union rewrites
//     this copy before EVERY judgement (gateway.mjs) and at the merge (pipeline.mjs). A seat that deletes
//     or empties its own file loses nothing and disarms nothing: the driver's copy still carries every
//     ruling the union preserved.
//
// THREE STATES, AND THEY ARE NOT THE SAME FACT:
//   rows null, no error  — no sidecar. There is no ruling artifact to judge, and no fresh run can reach
//     delivery in this state.
//   rows null, error     — present and unusable. A NAMED defect (connotation_form_damaged), never read as
//     absent: reading it as absent would silently drop every ruling in it (the placements.json rule).
//   rows []/[…]          — parsed. Judged against the obligations regenerated from the ledger.
function dispositionForm(dir, dispositionsPath) {
  const name = formSidecarName(dispositionsPath);
  if (!name) return { rows: null, error: null };
  const sidecar = driverDir(dir, name);
  if (!existsSync(sidecar)) return { rows: null, error: null };
  let raw = null;
  try { raw = readFileSync(sidecar, "utf8"); } catch { return { rows: null, error: `${name} exists and could not be read` }; }
  const { rows, error } = parseDispositionForm(raw);
  return { rows, error: error ? `${name} ${error}` : null };
}

// ── B — WHAT BECAME OF THE SEAT'S CALLS. Resolved HERE because this is the layer that touches files. ──
//
// `disposition-call-audit.mjs` decides; this locates the two records it reads and hands it the counts.
// The audit derives no obligations of its own and neither does this — the numbers come from the gate's
// own census, so there is no second opinion about what is owed.
//
// ONLY ASKED WHEN SOMETHING IS OWED. With nothing outstanding there is no call failure to describe, and
// asking anyway would invite a token onto a turn that finished.
function dispositionCallAudit(dispositionsPath, { owed, recorded }) {
  if (!dispositionsPath || !(Number(owed) > 0)) return null;
  // — named dDir, not driverDir: this file imports driverDir 24 times, and a local of that name
  // shadows the import across its whole block including its own initializer. That shadow is a temporal
  // dead zone, not a wrong path — it cost 42 tests in this change before the guard below existed.
  const dDir = dirname(formSidecarPath(dispositionsPath));
  return auditDispositionCalls({
    toolCallsPath: join(dDir, "tool-calls.jsonl"),
    callIndexPath: callRecordPaths(dispositionsPath, 0).index,
    owed: Number(owed) || 0, recorded: Number(recorded) || 0,
  });
}

const UNRULED = new Set(CONNOTATION_UNRULED_REASONS);
// The four transport reasons, as a set, read off the audit's own constant — never retyped here. A second
// literal list would be a second home for one fact, and the one that drifts is always the copy.
const CALL_REASON_SET = new Set(Object.values(CALL_FAILURE_REASONS));

/**
 * The meaning violations, with the transport's verdict folded in when the calls are what went wrong.
 *
 * TWO PASSES, AND THE SECOND ONE IS THE POINT. The first pass IS the census — how many obligations are
 * still unruled, and how many were recorded — and the audit needs those numbers to say anything. Deriving
 * them separately here would be a second opinion about what is owed, from the file the gate is judging,
 * which is the drift that has cost this codebase weeks. So the gate counts, the audit reads the run's
 * records, and the gate is asked again with the answer.
 *
 * `findConnotationViolations` is pure, so the second call costs nothing but a walk of rows already in
 * memory, and it returns EARLY on a call verdict — a per-row census of a form the seat never filled
 * describes the driver's own accumulator rather than anything the seat did.
 *
 * Called for the meaning halves only, and `dispositionsPath` is null everywhere else, so a run with no
 * form is untouched by all of this rather than silently audited against records that do not exist.
 */
function connotationViolations(content, queryCount, opts = {}, dispositionsPath = null) {
  const first = findConnotationViolations(content, queryCount, opts);
  // ── THE AUDIT IS UNCONDITIONAL — the typed call is the ONLY transport ──────────────────────────────
  //
  // The per-run arming flag (`disposition_call_required`,) is gone with the form path it selected
  // against: legacy behaviour is deleted, not gated, and rollback is git. What made the flag look
  // necessary was replay safety — a form-era run audited for calls it was never asked to make would
  // report `call_never_made` about a seat that did the work by the route it was told to use. That safety
  // does not need a flag: a DELIVERED archived run owes nothing (owed = 0), so the audit below never
  // runs on it and no archived verdict flips — and a replay of an archived run belongs on the engine
  // that recorded it (pool meta.json carries engineCommit), which is the rollback story the flag was
  // redundantly re-implementing per run.
  if (!dispositionsPath) return first;
  const owed = first.reduce((n, v) => n + (UNRULED.has(v.reason) ? (Number(v.count) || 1) : 0), 0);
  const recorded = Array.isArray(opts.form)
    ? opts.form.filter((r) => String(r?.ruling ?? "").trim() && String(r?.receipt_id ?? "").trim()).length
    : 0;
  const audit = dispositionCallAudit(dispositionsPath, { owed, recorded });
  return audit ? findConnotationViolations(content, queryCount, { ...opts, callAudit: audit }) : first;
}

// ---- — the meaning-sweep failure tokens, shared by commonLaw and commonLawHalf ----
// Projects findConnotationViolations' output to the bounded fail token the corrective ladder consumes.
// Truncation is at whole names, never mid-string (the correction hint dictates these rows).
// `no_recorded_queries` is deliberately NOT handled here — a sweep that did not RUN is a canonical-only
// decision with its own token (connotation_search_missing) and its own remedy.
//
// THE TOKENS, AND THEY STAY NAMESPACED. They are reported one at a time, and the order is the order
// the seat can act in:
//   connotation_call_* — B, the four transport states, ahead of every row-level reason: when the CALLS
//     are what went wrong, a per-row census describes the driver's accumulator rather than anything the
//     seat did. One token per turn, the audit's own precedence (cause before symptom): call_never_made,
//     call_truncated, call_schema_violation, call_partial. Under the typed transport ANY unruled
//     residual surfaces as one of these — the audit runs whenever rows are owed — so the row-level
//     unruled reasons (token_absent / cite_absent / no_ruling) reach the census and the audit numbers
//     but never mint a fail token of their own; their arms died with the hand-edited form path.
//   connotation_form_damaged — the accumulator cannot be read (a DRIVER fault), or a row names an id
//     that is not one of ITS OWN candidates. Reachable only with nothing owed: the census's own
//     early-return keeps its remedy from being buried under a call verdict.
//   connotation_quote_unbound —. n rows ARE ruled and only their quote does not join. Emitted LAST,
//     and only when nothing is unruled: while any row lacks a ruling that is the work in front of the
//     seat. A row cannot be in both classes — the quote clause is checked only on an otherwise-ruled row.
//     This token exists because its absence killed R6: a ruled row reported as `no_ruling` sends a seat
//     to look for work it has already done, it correctly changes nothing, and the ladder then breaks on
//     byte-identical output having never named the defect.
// The `connotation_` prefix is not cosmetic. The register-digest form emits `coverage_form_damaged` for
// the same class of defect, and repairSiblingName routes on the token pattern to decide WHICH FILE to
// patch — two families emitting a bare `form_damaged` would be indistinguishable there and the repair
// would rewrite the wrong form.
//
// THE SHAPE IS BUILT AROUND THREE CONSUMERS, each of which fails SILENTLY on a mismatch (/):
//   - The CAUSE CENSUS IS FRONT-LOADED, `no_ruling=<n>`, before any named list: repairs.mjs CENSUS_RE
//     sums exactly that, pipeline.mjs shows the failing model `tok.slice(0, 160)`, and a census that fell
//     off the end of a slice would read as a missing quantity — i.e. as converged.
//   - NO PARENTHESES before the overflow: pipeline.mjs's merge-gate remedy matches `connotation_[^)]*`
//     and would truncate the payload at the first "(" — hence TOKEN_SAFE and the bracketed row label.
//   - `quantity` is the residual the convergence ledger tracks. It is the count of rows still owed, so
//     73 → 7 → 1 keeps meaning what it meant.
//
//: `quantity` rides as the validator's OWN exact number rather than being re-derived from the
// token's comma-joined list further down (a query containing a comma would over-count there).
const TOKEN_SAFE = (s) => String(s ?? "").replace(/[(),;\[\]"\n\r]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The character budget for a sample list.
 *
 * — RAISED FROM 150, and the number is measured rather than chosen. A connotation row id is 36–45
 * characters before `rowLabel` adds its bracketed query, and the reported census was THREE rows: at 150
 * a three-row list cannot be named, so the token that reaches a repair seat carries two identifiers and
 * a count. The third row is the only one that seat still owes work on, and nothing downstream can
 * recover it from the token. 300 names three rows with their labels; past that the marker takes over,
 * which is the correct behaviour for a census that has stopped being a list.
 */
export const SAMPLE_BUDGET = 300;

/**
 * Name as many entries as the budget allows, and COUNT the marker that says the rest were dropped.
 *
 *, and the smaller half of it is worth stating precisely because the obvious reading is wrong:
 * the loop this replaces computed its break test correctly. `len + e.length > 150` is, exactly,
 * "the joined list would exceed 150" — it never dropped an entry the budget had room for.
 *
 * What it did do is spend the budget and then append ` (+N more)` OUTSIDE it, so the value it returned
 * could exceed the bound it was enforcing. A budget that does not include what it spends on announcing
 * an omission is not a bound; it is an estimate. Here the marker is inside the budget and each
 * candidate length is re-measured with it.
 *
 * At least one entry is always named. A token that named nothing would push the whole diagnosis into a
 * count, which is the failure this issue is about in its purest form.
 *
 * Exported for its test and for the siblings — this file has nine other `(+N more)` assemblers built on
 * the same loop, and they are deliberately NOT converted here: each has its own consumers and its own
 * pinned strings, and moving ten fail tokens in a commit about one is how a fix stops being reviewable.
 * They are named on so the sweep is a decision rather than an omission.
 *
 * @param {string[]} entries  already-labelled, already token-safe
 * @param {number}   budget   characters, marker included
 */
export function boundedSample(entries, budget = SAMPLE_BUDGET) {
  const all = entries.map((e) => String(e ?? ""));
  if (!all.length) return "";
  const whole = all.join(",");
  if (whole.length <= budget) return whole;
  for (let listed = all.length - 1; listed >= 1; listed -= 1) {
    const out = `${all.slice(0, listed).join(",")} (+${all.length - listed} more)`;
    if (out.length <= budget || listed === 1) return out;
  }
  return whole;
}

export function connotationDispositionFail(conn) {
  // ── B — THE FOUR TRANSPORT STATES, ahead of every row-level reason. When the CALLS are what went
  // wrong, a per-row census describes the driver's accumulator rather than anything the seat did, and
  // it would send a seat to fix rows in a file it never wrote.
  //
  // ONE TOKEN PER TURN, first match wins, and the audit's own precedence already ordered them so the
  // cause is reported rather than the symptom: a killed call is `call_truncated`, not the `call_partial`
  // it is also truthfully in.
  //
  // The census carries the audit's count, which is the population for three of them and the RESIDUAL for
  // `call_partial` — see the PROGRESS_TOKENS block in repairs.mjs, where that distinction is what lets a
  // converging ladder read as converging.
  const callFail = conn.find((v) => CALL_REASON_SET.has(v.reason));
  if (callFail) {
    const n = Number(callFail.count) || 1;
    return { ...fail(`connotation_${callFail.reason}:${callFail.reason}=${n};${TOKEN_SAFE(callFail.detail ?? "")}`), quantity: n };
  }
  const damaged = conn.filter((v) => v.reason === "form_damaged");
  if (damaged.length) {
    const d = damaged[0];
    return {
      ...fail(`connotation_form_damaged:form_damaged=${damaged.length};${TOKEN_SAFE(d.detail ?? d.row ?? "unparseable")}`
        + (damaged.length > 1 ? ` (+${damaged.length - 1} more)` : "")),
      quantity: damaged.length,
    };
  }
  // ONE SAMPLE LIST, bounded. Each entry names the driver's own row id — the string the seat can find in
  // the form without searching for it — and the query or receipt that row is about, so the hint can be
  // acted on without opening anything else.: both halves are identifiers the model must reproduce
  // exactly, so `abbrev` MARKS a cut rather than silently slicing one.
  // — THE CENSUS DECLARED THREE ROWS AND NAMED TWO.
  //
  //   quote_unbound:quote_unbound=3;<row-1> missing,<row-2> missing (+1 more)
  //
  // The elided row is the only one the seat still owes work on, and nothing downstream can recover it
  // from the token. Three connotation row ids with their labels do not fit in 150 characters, so on the
  // ordinary three-row census the identifier a fixer needs was always the one dropped.
  //
  // Two changes, and only the first is the issue's substance: SAMPLE_BUDGET is raised to 300 so a
  // three-row census is named in full, and the ` (+N more)` marker is now counted against the budget
  // rather than appended outside it. The old break test was arithmetically CORRECT — it is exactly "the
  // joined list would exceed 150" — so this is not a fix to that computation and does not claim to be.
  const sample = (rows, label) => boundedSample(rows.map(label));
  const rowLabel = (v) => {
    const l = TOKEN_SAFE(v.query || v.result || "");
    return `${TOKEN_SAFE(v.row)}${l ? ` [${abbrev(l, 60)}]` : ""}`;
  };
  // — the ruled-but-unbound rows, and they are reported ONLY once nothing is unruled. A run owing
  // both owes the rulings first: "add a ruling" is the correct instruction while any row lacks one, and
  // the quote rows resurface on the next pass with their own token. The two classes are disjoint per row
  // by construction (findConnotationViolations reaches the quote check only on an otherwise-ruled row),
  // so nothing is double-counted and the residual the convergence ledger tracks still falls.
  //
  // The STATE rides in the token, not just in the hint: R6 spent four dispatches on a message that named
  // the wrong defect, and the state is the difference between "quote one continuous passage" and "quote
  // something that is actually there". repairs.mjs counts the census, so the shape stays `<reason>=<n>;`.
  const unbound = conn.filter((v) => v.reason === "quote_unbound");
  if (!unbound.length) return null;
  return {
    ...fail(`connotation_quote_unbound:quote_unbound=${unbound.length};${sample(unbound, (v) =>
      `${rowLabel(v)} ${TOKEN_SAFE(v.quote_state)}${v.near_receipt ? ` ${TOKEN_SAFE(v.near_receipt)}` : ""}`)}`),
    quantity: unbound.length,
  };
}

// ---- — the register coverage-form failure tokens ----
// Projects findCoverageFormViolations' output to the bounded fail token the corrective ladder consumes.
// Built to the SAME three consumer constraints as connotationDispositionFail above, because they are the
// same three consumers and each fails SILENTLY on a mismatch:
//   - THE CAUSE CENSUS IS FRONT-LOADED, `no_status=<n>`, before any named list. repairs.mjs CENSUS_RE is
//     anchored at `^` of the tail and sums exactly that; a token whose census is absent or not first
//     makes progressQuantity return null, `progress.kind` becomes "unknown", and a CONVERGING run reads
//     as stuck. That is what  exists to prevent, and it is why `coverage_no_status:<axis>` — the
//     bare shape the design sketched — is not the shape shipped.
//   - NO PARENTHESES before the overflow (pipeline's merge-gate remedy truncates at the first "("), hence
//     TOKEN_SAFE and the bracketed row label.
//   - `quantity` rides as the validator's OWN exact integer and always wins over the text parse.
// THREE TOKENS, AND THEY STAY NAMESPACED. `coverage_form_damaged`, never a bare `form_damaged`: the
// meaning-sweep form emits `connotation_form_damaged` for the same class of defect, and repairSiblingName
// routes on the token pattern to decide WHICH FILE to patch — two families emitting a bare `form_damaged`
// would be indistinguishable there and the repair would rewrite the wrong form. The third,
// `coverage_form_axis_invalid`, is namespaced against a family in the SAME lane — see its own block below.
// THE ENTRY LIST IS THE REASON THERE ARE THREE TOKENS AND NOT TWO. Each entry is `<row id> [<label>]`
// and carries NO cause label — deliberately, because the token is bounded and a per-entry cause would
// cost more characters than the row ids it names. That is affordable only while every entry in one
// token needs the SAME edit. `axis_invalid` does not: its rows need the `axis` cell set, while
// `no_status` / `open_clean` rows need the `status` cell set. Folded together, the hint gets a flat list
// it cannot attribute — "these rows are wrong, and for two different reasons, work out which" — which is
// the 2026-08-05 defect (a token that named the axis and nothing else) restated one level in.
//
// `labelOf` is per-token because WHAT identifies the offending thing differs: for a status defect it is
// the coverage unit the row is about; for an axis defect it is the REJECTED VALUE, which the seat has to
// see to know which cell it typed wrong. `abbrev` MARKS a cut with `…` (never a paren — a "(" before the
// overflow is truncated away by pipeline's merge-gate remedy, which matches `coverage_[^)]*`).
const coverageEntryList = (violations, labelOf, cap = 150) => {
  const entries = [];
  let listed = 0, len = 0;
  for (const v of violations) {
    const label = labelOf(v);
    const e = `${TOKEN_SAFE(v.row) || TOKEN_SAFE(v.axis)}${label ? ` [${label}]` : ""}`;
    if (len + e.length > cap && listed) break;
    entries.push(e);
    listed += 1;
    len += e.length + 1;
  }
  const overflow = violations.length - listed;
  return `${entries.join(",")}${overflow > 0 ? ` (+${overflow} more)` : ""}`;
};
const coverageUnitLabel = (v) => abbrev(TOKEN_SAFE(v.unit || v.axis || ""), 60);
// The rejected value FIRST and named as the cell it came from. `<empty>` is not decoration: an axis the
// seat never wrote is the COMMON shape here (a seat row added with no `axis` key at all), and a token
// that rendered it as nothing would say "this row's axis is wrong" while showing no axis — the
// contentless lead this change exists to delete. `<`/`>` survive TOKEN_SAFE and are inert everywhere the
// token is rendered (the journal, the hint, the merge-gate remedy).
const coverageAxisLabel = (v) =>
  `axis=${abbrev(TOKEN_SAFE(v.axis), 40) || "<empty>"} ${abbrev(TOKEN_SAFE(v.unit || ""), 50)}`.trim();

function coverageFormFail(cov) {
  const damaged = cov.filter((v) => v.reason === "form_damaged");
  if (damaged.length) {
    return {
      ...fail(`coverage_form_damaged:form_damaged=${damaged.length};${TOKEN_SAFE(damaged[0].detail ?? "unparseable")}`
        + (damaged.length > 1 ? ` (+${damaged.length - 1} more)` : "")),
      quantity: damaged.length,
    };
  }
  // ── `coverage_form_axis_invalid` — ITS OWN TOKEN FAMILY, AND THE NAME IS LOAD-BEARING TWICE ────────
  //
  // WHY IT IS NOT FOLDED INTO `coverage_no_status`. See coverageEntryList above: one token can carry one
  // instruction, and this one's instruction is a different CELL. Emitted BEFORE the status token for the
  // same reason `form_damaged` is: a row whose axis is outside the vocabulary is a row every coverage
  // consumer below drops, so its status is not yet a question worth asking.
  //
  // WHY IT IS NOT CALLED `coverage_axis_invalid`, which is the name the defect deserves. That name is
  // TAKEN, by the DERIVED-JSON structure family, and taking it back would misroute the repair twice:
  //   · repairSiblingName's FIRST branch is /coverage_(ledger|axis|key|mirror|status_invalid)/ and aims
  //     at register-coverage-ledger.json — a driver-derived artifact the seat is told never to write. A
  //     form defect routed there orders a rewrite of the wrong file.
  //   · pipeline.mjs isCoverageLedgerFail is /coverage_(ledger|axis|key|mirror|status|classes)_/ and
  //     MIRROR-QUARANTINES what it matches: the run would proceed with the machine ledger dropped and a
  //     note saying the coverage gates read the prose — over a judgment the seat has not made. That is a
  //     silent fail-open, and it is why `coverage_form_axis_invalid` is spelled with `form` first: it
  //     matches neither regex, and it matches the form's own sibling route.
  // A near-miss worth leaving written down, because the obvious name is the dangerous one.
  //
  // NOT DISCRIMINATED BY ROW KIND. A DRIVER row cannot carry a bad axis by any path this build can
  // reach, but `activeAxes` is basename-derived (readCoverageFormInput: readdirSync(register-units)
  // filtered to `.md`), so a stray `.md` there would mint a driver axis row the seat cannot repair —
  // the union regenerates it every pass — and the ladder would run out. That is not a regression this
  // change introduces (the folded token had the same exposure) and it has never been observed; if it
  // ever is, it is a DRIVER defect and it needs its own token naming the driver, on the
  // `coverage_form_missing` model. Recorded here rather than half-built.
  // ── — `coverage_form_engine_vocabulary` ────────────────────────────────────────────────────
  //
  // Emitted BEFORE the status tokens, on the `form_damaged`/`axis_invalid` argument: it is a defect in
  // the sentence a CLIENT reads, and a run that ships it has shipped it whether or not a status cell is
  // also wrong. `form` is first in the name for the reason spelled out at length below — it must match
  // neither repairSiblingName's ledger branch nor isCoverageLedgerFail's mirror-quarantine, and the two
  // regexes that would misroute it both key on `coverage_<word>_`.
  //
  // THE TOKENS ARE THE CLOSED HYPHENATED SET (coverage-form.SEAT_BANNED_TOKENS). A bare noun like
  // `slice` is NOT refused here: a refusal that cannot tell engine vocabulary from a mark would block a
  // clearance on the mark SLICE, which is restated one level in.
  const engineVocab = cov.filter((v) => v.reason === "engine_vocabulary");
  if (engineVocab.length) {
    return {
      ...fail(`coverage_form_engine_vocabulary:engine_vocabulary=${engineVocab.length};`
        + coverageEntryList(engineVocab, (v) => abbrev(TOKEN_SAFE((v.tokens ?? []).join(" ")), 60))),
      quantity: engineVocab.length,
    };
  }
  const badAxis = cov.filter((v) => v.reason === "no_status" && v.cause === "axis_invalid");
  if (badAxis.length) {
    return {
      ...fail(`coverage_form_axis_invalid:axis_invalid=${badAxis.length};${coverageEntryList(badAxis, coverageAxisLabel)}`),
      quantity: badAxis.length,
    };
  }
  // EVERY REMAINING VIOLATION IS A STATUS-CELL DEFECT, because `axis_invalid` left above. The census
  // therefore partitions over TWO causes, not three, and every row this token names needs the same edit.
  const unset = cov.filter((v) => v.reason === "no_status");
  if (!unset.length) return null;
  // THE CENSUS IS DISCRIMINATED, and this is the 2026-08-05 lesson applied one level in. `no_status` is
  // one token over two different defects — a row with no status or a status outside the enum, and an
  // enum-VALID confirmed-clean on a row the driver marked `open` — and the second is the common one,
  // since it is what a digest does when it believes a slice is fine and the machine knows it is not. A
  // single undifferentiated count made the hint open with "row(s) with no status this gate accepts" and
  // close with "do not stop until every row carries a status", both unactionable on a form where every
  // row already carries one. The seat then spends a warm attempt complying with what it has already done.
  //
  // repairs.mjs CENSUS_RE accepts comma-joined `<name>=<n>` terms and SUMS them, so the terms must
  // PARTITION the violations — they do, `cause` is assigned once per row. The sum stays the exact
  // outstanding count, `progressQuantity` still reads a converging run as converging, and `quantity`
  // below rides as the validator's own integer and wins over any text parse.
  const CAUSE_ORDER = ["open_clean", "no_status"];
  const byCause = new Map();
  for (const v of unset) {
    const c = CAUSE_ORDER.includes(v.cause) ? v.cause : "no_status";
    byCause.set(c, (byCause.get(c) ?? 0) + 1);
  }
  const census = CAUSE_ORDER.filter((c) => byCause.has(c)).map((c) => `${c}=${byCause.get(c)}`).join(",");
  // ONE SAMPLE LIST, bounded, DOMINANT CAUSE FIRST — a repair aimed at the defect that accounts for most
  // of the rows converges fastest, and the seat sees the shape it has to fix in the first entry. Each
  // entry names the driver's own row id (the string the seat can find in the form without searching for
  // it) and the coverage unit that row is about.: `abbrev` MARKS a cut rather than silently slicing.
  const ordered = CAUSE_ORDER.flatMap((c) => unset.filter((v) => (CAUSE_ORDER.includes(v.cause) ? v.cause : "no_status") === c));
  return {
    ...fail(`coverage_no_status:${census};${coverageEntryList(ordered, coverageUnitLabel)}`),
    quantity: unset.length,
  };
}

// ---- per-stage validators: (path, content) => {ok, reason} ----
export const validators = {
  // WS2 (B4) — the verbatim-scope bind: with the driver-written _driver/instructed-scope.json
  // present (fresh runs; archived/replay runs lack it ⇒ legacy pass), every non-null job field must
  // appear in the frame VERBATIM (whitespace-collapsed — the one normalization prose can't avoid).
  // Paraphrased scope is the drift that let a frame widen territories/goods between request and run.
  matterContext: (p, c) => {
    const base = all(nonEmpty(c), needs(c, [/jurisdic|material|sector|client/i], "matter fields"));
    if (!base.ok) return base;
    // P2-C (Round-2 §8b) — the derived connotation scope: a frame minted under the meaning-angles prompt
    // must carry the dictated "Meaning angles:" line. A prose-only mandate here is exactly the contract
    // the model skips under output pressure (the §7 remedy-field lesson), and a skipped line silently
    // reverts the meaning sweep to its fixed floor — the defect the line exists to fix. "Meaning angles:
    // none" is the valid explicit form for a coined mark with no semantic field: an asserted zero, never
    // an omission.
    //
    // The gate is the matter-frame STAGE-CONTRACT marker (_driver/stage-contracts.json,
    // "matter-frame".meaningAngles — written by pipeline.mjs recordStageContract at DISPATCH, declared
    // on the stage def), i.e. evidence the frame was MINTED under the prompt that dictates the line —
    // the romanisation-floor pattern (variantManifest below). It must NEVER be the instructed-scope
    // sentinel (the first cut of this gate keyed on it — 2026-07-31 review round): that sentinel is
    // written at INTAKE and present on EVERY current-era run — archived and parked included — so keying
    // the line on it flipped real archived replay verdicts (matter-context.md is a replay-archive
    // FILE_CHECKS target) and forced completed matter-frames to re-dispatch on every parked/crash
    // resume, marking every downstream consumer stale (the content-keyed staleness cascade — a near-full
    // paid recompute). recordStageContract's doc block states the prohibition verbatim.
    // ── CONVERSION 2 — WHAT THIS VALIDATOR STILL POLICES, PER TOKEN ─────────────────────────
    //
    // The frame is rendered by the driver now, from a typed `record_matter_frame` call. Two of the checks
    // below would become the driver comparing its own render against its own input — a guard that CANNOT
    // FAIL, which reads as coverage and is worse than no guard (owner ruling, 2026-08-17). So each one is
    // stated here, by token, with what happened to it:
    //
    //   `meaning_angles_missing`  — DELETED on the recorded path. `acceptMatterFrame` refuses a call that
    //     sends neither angles nor `meaning_angles_none`, so a rendered frame cannot exist without the
    //     line: the check is unreachable rather than lenient. It stays live for DICTATED frames, which is
    //     what the archive is full of and what a replay must still be able to fail on.
    //
    //   `frame_scope_missing`     — RE-POINTED, not deleted, because the failure it names still exists and
    //     has simply moved. The seat no longer retypes the instructed scope (so it cannot paraphrase it,
    //     which is what the token used to catch); the DRIVER stamps it from _driver/instructed-scope.json.
    //     The reachable defect on that path is the stamp not happening — an intake record that is missing
    //     or unreadable renders every field as "none given" and nothing downstream would notice. So on a
    //     recorded frame the token now means "the frame was recorded and the driver could not stamp the
    //     scope it holds", which is a DRIVER fault, and it fails closed.
    //
    // THE DISCRIMINATOR IS CALL-CAPTURE PRESENCE (`matterFrameWasRecorded`), and nothing else: the capture
    // is written before validation, so it exists even for a refused call and proves the transport was
    // taken. It is deliberately NOT the instructed-scope sentinel and NOT a stage-contract marker — both
    // are written at intake/dispatch and are therefore true of archived and parked runs too. Keying on the
    // sentinel flipped real archived replay verdicts on 2026-07-31; that lesson is why this line exists.
    const recorded = matterFrameWasRecorded(dirname(String(p ?? "")));
    if (recorded) {
      const scopeFile = driverDir(dirname(String(p ?? "")), "instructed-scope.json");
      if (existsSync(scopeFile)) {
        // The stamp is a fixed heading the renderer always emits when it has a record to stamp from. Its
        // ABSENCE against a present intake record means the render ran without the values — the one way
        // this section can now be wrong.
        if (!/^##\s+Instructed scope\s*$/m.test(c)) return fail("frame_scope_missing:stamp:section-absent");
        if (/- \*\*Mark\(s\):\*\* none given/.test(c))
          return fail("frame_scope_missing:stamp:marks — the intake record is present and the render says none given");
      }
      return ok("recorded");
    }

    let meaningMinted = false;
    // ABSENT marker = not minted under the meaning-angles prompt — pre-P2-C rules apply. PRESENT but
    // unparseable fails closed with a name (stagecontracts_invalid) — the marker is DRIVER-written, so
    // a corrupt one is a code/fs bug, never a waiver (post-merge audit 2 (c), same handling as the
    // romanisation-floor read in variantManifest below).
    const contractsMarker = driverDir(dirname(String(p ?? "")), "stage-contracts.json");
    if (existsSync(contractsMarker)) {
      try { meaningMinted = Boolean(JSON.parse(readFileSync(contractsMarker, "utf8"))?.["matter-frame"]?.meaningAngles); }
      catch { return fail("stagecontracts_invalid"); }
    }
    if (meaningMinted && !MEANING_ANGLES_RE.test(c)) return fail("meaning_angles_missing");
    let scope = null;
    try { scope = JSON.parse(readFileSync(driverDir(dirname(String(p ?? "")), "instructed-scope.json"), "utf8")); }
    catch { return base; }   // no receipt = legacy run — replay never flips
    const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const hay = squash(c);
    const wants = [];
    const add = (field, v) => {
      if (v == null) return;
      for (const x of Array.isArray(v) ? v : [v]) { const s = squash(x); if (s) wants.push([field, s]); }
    };
    add("marks", scope.marks); add("classes", scope.classes); add("jurisdictions", scope.jurisdictions); add("goods", scope.goods);
    // a value containing quotes/backslashes reaches the frame via the task message's JSON.stringify
    // form — the JSON-escaped rendering IS the verbatim the model saw, so both forms are accepted
    const missing = wants.filter(([, v]) => !hay.includes(v) && !hay.includes(squash(JSON.stringify(v).slice(1, -1))));
    if (missing.length)
      return fail(`frame_scope_missing:${missing[0][0]}:${abbrev(missing[0][1], 40)}${missing.length > 1 ? ` (+${missing.length - 1} more)` : ""}`);
    return ok("scope-verbatim");
  },
  // WS2 (B2): the structured sibling variant-manifest.json — the register-plan compiler's
  // input — is strict-checked when present (the registerUnit band precedent): replay-safe over
  // legacy archived runs with no sibling, while a malformed one fails → corrective ladder. Its
  // emission is mandated by the stage message; the plan attach step consumes it (always-on since
  // the flag removal, 2026-07-03), never here. D1 fail-closed: under the driver-written
  // _driver/instructed-scope.json sentinel the sibling is REQUIRED: its absence silently disables
  // the whole register-plan apparatus (plan compile, F3 gates, band contracts). Replay never flips
  // on D1 because every sentinel-era run also CARRIES the sibling — NOT because archives lack the
  // sentinel: the sentinel is written at intake and rides every current-era run, archived or parked,
  // so it proves vintage, never freshness (2026-07-30 review — do not gate anything new on it).
  // The ROMANISATION FLOOR (2026-07-30) rides a DIFFERENT gate than D1, deliberately: every non-Latin
  // term must arrive with its Latin-script romanisation, because a register that indexes non-Latin
  // filings by their transliteration cannot answer the characters at all — it refuses them, and the
  // axis produces no coverage (a clearance run, 2026-07-29, lost thirteen terms that way). The field
  // is optional in the PARSER so a manifest minted before it existed still parses; it is mandatory
  // HERE, where a miss re-prompts the stage that authors it.
  //
  // The floor's gate is the driver-written stage-contract marker (_driver/stage-contracts.json,
  // "prelim-variants".romanization — written by pipeline.mjs recordStageContract at DISPATCH), i.e.
  // evidence the artifact was MINTED under the romanisation-carriage prompt. It must never be the
  // instructed-scope sentinel: that sentinel is written at INTAKE and present on EVERY current-era
  // run — archived and parked ones included — so gating the new requirement on it (the first cut of
  // this floor) was proven to flip replay verdicts on real sentinel-era archives AND to force-re-run
  // the completed variant stage on every parked resume, dragging the P2 staleness cascade (and a paid
  // register recompute) behind it. A pre-carriage artifact validates under pre-carriage rules; only
  // an output the new prompt produced is held to the new floor.
  variantManifest: (p, c) => {
    const base = all(nonEmpty(c), needs(c, [/variant/i, /\|/], "variants table", ["variant-mentions", "table-pipe"]));
    if (!base.ok) return base;
    const dir = dirname(String(p ?? ""));
    if (existsSync(join(dir, "variant-manifest.json"))) {
      const sib = checkSiblingJson(p, "variant-manifest.json", parseVariantManifestModel, "variant-manifest-model", "variantmodel_missing");
      if (!sib.ok) return sib;
      // BOTH floors arm off the stage-contract marker, each on its OWN key — never each other's, never
      // run freshness. A run minted under the romanisation-carriage prompt but before the completeness
      // floor existed keeps validating under exactly the rules it was minted under (A7 rebased over
      //: replay verdicts over archived runs must never flip).
      //
      // The marker is read through the SAME fail-closed door put on it (post-merge audit 2 (c)):
      // ABSENT = not minted under a floor-stating prompt, so pre-floor rules apply; PRESENT but
      // unparseable is a different fact entirely — the marker is DRIVER-written (pipeline.mjs
      // recordStageContract), so a corrupt one is a code/fs bug, and the module's own convention for
      // driver-written sidecars (readRunProfile / readRunFramework / readGridSpec) says it must surface
      // with a name. One catch over both reads would waive BOTH floors on exactly the runs they govern.
      let contract = null;
      const marker = driverDir(dir, "stage-contracts.json");
      if (existsSync(marker)) {
        try { contract = JSON.parse(readFileSync(marker, "utf8"))?.["prelim-variants"] ?? null; }
        catch { return fail("stagecontracts_invalid"); }
      }
      if (!contract?.romanization && !contract?.completeness && !contract?.term_shape) return sib;
      let model = null;
      try { model = parseVariantManifestModel(readFileSync(join(dir, "variant-manifest.json"), "utf8")); }
      catch { return sib; }   // already parsed clean above; a read race is not this gate's business
      if (contract?.romanization) {
        const gaps = variantRomanizationGaps(model);
        if (gaps.length)
          return fail(`variantmodel_romanization_missing:${abbrev(gaps[0], 40)}${gaps.length > 1 ? ` (+${gaps.length - 1} more)` : ""}`);
      }
      // A7 — the completeness floor: a one-variant manifest fails LOUDLY here (corrective ladder
      // re-prompts the stage that authors it), instead of compiling a funnel that searches almost
      // nothing. Dumb AND complete; no ranking, no judgment — see variantCompletenessGaps.
      if (contract?.completeness) {
        // item 21 — the per-script arm needs the matter's TERRITORIES, and the run already froze them:
        // _driver/instructed-scope.json is the verbatim scope bind (the same file the frame's
        // scope-verbatim check reads, two arms up). Read here rather than threaded through, because
        // these validators are (path, content) by contract and the run dir is what they have. Absent
        // (a legacy or replayed run) ⇒ no jurisdictions ⇒ the per-script arm cannot fire and the
        // category floor stands exactly as before, so archived verdicts do not flip.
        let jurisdictions = [];
        try { jurisdictions = JSON.parse(readFileSync(driverDir(dir, "instructed-scope.json"), "utf8"))?.jurisdictions ?? []; }
        catch { /* no frozen scope on this run — category floor only */ }
        const gaps = variantCompletenessGaps(model, { jurisdictions: Array.isArray(jurisdictions) ? jurisdictions : [jurisdictions] });
        if (gaps.length)
          return fail(`variantmodel_family_incomplete:${abbrev(gaps[0], 40)}${gaps.length > 1 ? ` (+${gaps.length - 1} more)` : ""}`);
      }
      // — the markup floor. Its OWN contract key, never the instructed-scope sentinel: that
      // sentinel is run FRESHNESS, and gating on it would flip archived replay verdicts and force
      // completed stages to re-run on resume. `term_shape:1` is stamped at dispatch by the stage def,
      // so a manifest minted before this prompt vintage is never judged by a rule it was not told.
      if (contract?.term_shape) {
        const gaps = variantTermShapeGaps(model);
        if (gaps.length)
          return fail(`variantmodel_term_markup:${abbrev(gaps[0], 40)}${gaps.length > 1 ? ` (+${gaps.length - 1} more)` : ""}`);
      }
      return sib;
    }
    // D1 fail-closed (pre-existing, UNCHANGED): on a fresh run — the instructed-scope sentinel — the
    // structured sibling itself is REQUIRED; sentinel-era archives all carry the sibling, so this arm
    // never fires on replay.
    if (existsSync(driverDir(dir, "instructed-scope.json"))) return fail("variantmodel_missing");
    return base;
  },
  // Property 1 (frame-omission design): the stage's ONE output is the structured model the frame-diff
  // consumes — `c` IS blind-frame-model.json ( retired the prose twin nothing read). The prose
  // non-emptiness floor is gone WITH the prose, and the parser is the stronger floor it leaves behind:
  // it demands a named dominant_element, at least one variant, a closed-enum direction on each, and a
  // closed-enum ranking_basis. An absent file never reaches here — runStage fails it as
  // `missing_file:blind-frame-model.json` first. NON-FATAL in the pipeline (no frame-diff that run).
  // — WHAT A FAILURE HERE NOW MEANS. `acceptBlindFrame` validates through THIS SAME parser before
  // `recordBlindFrame` writes, so on the live path a parse failure can no longer be the seat's typing: it is
  // the driver's own serialisation or an fs fault. Kept rather than retired, because archived runs whose
  // model was hand-written are still judged by it, and because a driver that writes an unparseable artifact
  // must not deliver. The coverage transport reached the same place and said so in the same words
  // (coverage_form_damaged, post-conversion, is a driver/fs fault).
  blindFrame: (p, c) => checkJson(c, parseBlindFrameModel, "blind-frame-model"),
  // a clean diff is legitimately terse ("no omissions") so the prose floor is low; the sibling JSON (the
  // reopen directives the pipeline acts on) is REQUIRED and carries the real structure.
  frameDiff: (p, c) => all(nonEmpty(c, 40), checkSiblingJson(p, "frame-diff.json", parseFrameDiff, "frame-diff", "framediff_model_missing")),
  // judgment-relocation (2026-06-24): the LOAD-BEARING funnel artifact is now the COMPLETE NAMED BAND sibling
  // (register-units/<axis>-band.json) — the enumerated records + crowd descriptors that cross the firewall. The
  // funnel emits NO clearance verdict, so the prose .md is an AUDIT summary (only non-emptiness required); the
  // old coverage/confirmed-clean/coverage-limited vocabulary requirement is RETIRED (the funnel must not author
  // it). The band sibling is REQUIRED to PARSE *when present* (a malformed band is a fail → corrective ladder).
  // It is checked only-if-present here — replay-safe: replay-archive.mjs reuses this validator over LEGACY
  // archived runs that have no band; their existence is enforced separately at the fresh-run fan-in gate
  // (pipeline.mjs), which never runs over archived artifacts. A unit DECLARING the layer not-executed /
  // tools-not-bound is still a hard fail (a hollow run must fail, not ship).
  registerUnit: (p, c) => {
    if (/(register layer|provider tools?|register tools?)[^\n]{0,80}(not executed|not bound)/i.test(c ?? ""))
      return fail("declared_not_executed");
    const bandName = basename(String(p ?? "")).replace(/\.md$/i, "-band.json");
    // fail-closed at the PRODUCER (2026-07-14, copper-keystone): a fresh-run unit whose plan dictates
    // entries for this axis but whose band file is ABSENT is the fabrication signature — the .md
    // narrates success while the load-bearing artifact was never written (the model skipped its one
    // register_execute_plan call). Fail HERE, where the corrective ladder can still demand the tool
    // call, instead of at fan-in where the run can only die (the HALCYON repeat-signature terminal).
    // Gated exactly like variantManifest's D1: the driver-written _driver/instructed-scope.json
    // sentinel proves a FRESH run — legacy/archived replays lack it, so replay verdicts never flip;
    // a plan-less resume (no run-dir register-plan.json) keeps the lenient path too.
    if (bandName.endsWith("-band.json") && !existsSync(join(dirname(String(p ?? "")), bandName))
      && existsSync(driverDir(join(dirname(String(p ?? "")), ".."), "instructed-scope.json"))) {
      try {
        const plan = JSON.parse(readFileSync(driverDir(join(dirname(String(p ?? "")), ".."), "register-plan.json"), "utf8"));
        const axis = basename(String(p ?? "")).replace(/\.md$/i, "");
        if ((plan?.entries ?? []).some((e) => e?.axis === axis)) {
          // — SAME EVIDENCE, TWO CAUSES, and this is where the wrong one used to be picked.
          //
          // md-present + band-absent is the fabrication signature AND the killed-tool-call signature.
          // R5 on 2026-08-12 was the second and was recorded as the first four times over, because
          // a deterministic timeout repeats: the model made its one dictated call, codex killed it at
          // its 300s default, and the model wrote an honest audit note saying so — which is the
          // doctrine-compliant act, since hand-authoring the band is the forbidden one.
          //
          // The tool-call log settles it, and only in ONE direction. A recorded start with no settle
          // is proof the call never returned. No log is NOT proof it did — `registerPlanCallKilled`
          // returns null for "no evidence" and for "returned fine" alike, so the fabrication verdict
          // below stays the default and nothing about a run without the log changes.
          const runDir = join(dirname(String(p ?? "")), "..");
          const killed = registerPlanCallKilled(runDir, axis);
          if (killed) return fail(`tool_timeout:${killed.tool}:${axis}`);
          return fail("named_band_missing");
        }
      } catch { /* no/unreadable run plan — the plan apparatus is not active for this run */ }
    }
    if (bandName.endsWith("-band.json") && existsSync(join(dirname(String(p ?? "")), bandName))) {
      const band = checkSiblingJson(p, bandName, parseNamedBand, "named-band", "named_band_invalid");
      if (!band.ok) return band;
      // FIX: a COLLAPSED core search must FAIL, not degrade to a soft sufficiency flag. An enumerated
      // slice that CLAIMED hits (total_hits > 0) but carried ZERO records into the band is a recall loss
      // inside an otherwise-healthy unit — token-first so it rides the corrective ladder and, on exhaustion,
      // becomes a terminal StageFailure → .failed (never a CONDITIONAL deliverable). Runs in replay too
      // (floor-safe: legacy bands with no total_hits never flip). The parse already succeeded above.
      let collapsed = [];
      try { collapsed = findCollapsedBands(readFileSync(join(dirname(String(p ?? "")), bandName), "utf8")); }
      catch { /* a top-level parse defect was already surfaced by checkSiblingJson above */ }
      if (collapsed.length)
        return fail(`named_band_collapsed:${abbrev(collapsed.map((x) => `${abbrev(x.query || "slice", 40)}~${x.total_hits}`).join(","), 160)}`);
      // copper-lattice re-route backstop: under the supplemental_lane contract EVERY band block is
      // code-written and qid-stamped (dictated → execute_plan; judgment additions → the propose tool).
      // A qid-less block means the model hand-authored one — the exact transcription lane the contract
      // abolished. Feature-gated on the RUN-DIR plan's contract flag: archived/frozen plans lack it, so
      // replay verdicts and legacy resumes never flip; only runs whose plan was attached by new code
      // (exactly those receiving the new stage message + enumerate exclusion) are enforced.
      try {
        const plan = JSON.parse(readFileSync(driverDir(join(dirname(String(p ?? "")), ".."), "register-plan.json"), "utf8"));
        const axis = basename(String(p ?? "")).replace(/\.md$/i, "");
        if (plan?.contract?.supplemental_lane && (plan.entries ?? []).some((e) => e?.axis === axis)) {
          const blocks = JSON.parse(readFileSync(join(dirname(String(p ?? "")), bandName), "utf8"));
          const unplanned = (Array.isArray(blocks) ? blocks : []).filter((b) => b && typeof b === "object" && !b.qid);
          if (unplanned.length)
            return fail(`band_block_unplanned:${abbrev(unplanned.map((b) => abbrev(String(b.query ?? "un-labelled"), 40)).join(","), 140)}`);
        }
      } catch { /* no plan in reach — contract inactive (legacy/replay/offline) */ }
    }
    return /not applicable|n\/a|no .*(hits|results)/i.test(c ?? "")
      ? nonEmpty(c, 40)
      : nonEmpty(c, 80);
  },
  // A findings file that DECLARES the marketplace layer unavailable is a failure, not a deliverable —
  // the run must hard-fail rather than ship without its common-law layer (the 2026-05-23 incident: the
  // old skill fallback wrote a "partial results" file that passed here, and the report went out hollow).
  // The phrase set is tight to the declared-fallback wording so a legitimate note like "URL unavailable
  // for one finding" never false-fails; the skill-side protocol (write NO file on layer failure) is the
  // primary mechanism — this is the backstop against old-style fallback wording.
  //
  // Receipt completeness: every manifest variant must carry its full grid accounting in the
  // Negative-results matrix (one receipt row per variant × platform cell). The live 2026-06-10 probes
  // showed an LLM transcription silently dropping a whole term — a recall hole nothing downstream could
  // see. Failing validation here rides the existing corrective-retry ladder (retry names the short
  // variants; still short after retries → the run fails). The manifest is read from the findings file's
  // run-dir; when it is unreadable (offline unit tests, non-run contexts) the receipt check is skipped.
  commonLaw: (p, c) => declaredUnavailableGate(p, c, commonLawEvidence(p, c)),
  // A1 SPLIT — one concurrent HALF of the common-law grid. Same structural core and the same machine-
  // receipts exact join as commonLaw, but sourced from THIS half's sidecars: _driver/grid-spec.half-<h>
  // .json (the disjoint terms this member was dictated) joined against common-law-grid.half-<h>.json
  // (the ledger the plugin wrote for exactly those terms). The half is derived from the findings path
  // itself so the validator keeps the context-free (path, content) contract. Always fail-closed: a half
  // member only exists because the driver wrote its spec first, so there is NO legacy/prose downgrade
  // here — spec missing/unreadable and ledger missing/unparseable all fail (same tokens as the canonical
  // validator, so the corrective-ladder hints and the repairs classifier apply unchanged). The
  // CONNOTATION COUNT gate (connotation_search_missing) is deliberately ABSENT at half level: the
  // meaning queries are partitioned across the halves (a half may legitimately own zero), so a
  // clean-asserting half over an empty half ledger is not the fabricated-clearance signature — only the
  // merged canonical artifacts carry the full receipt set, and validators.commonLaw judges them at the
  // merge gate (pipeline.mjs) and in replay. The RECEIPTS-DISPOSITION arm (§8b leg 2) DOES run here
  // (2026-07-31 review round): under the split the half member is the seat that actually WRITES the
  // PR / reputational section, so an arm that lives only at the code-side merge reaches no model turn —
  // the obligation would be skill-prose-only at the one seat that matters, and the first miss would
  // surface as a deterministic merge StageFailure (parkBudget 0, terminal after a full paid gather).
  // Judged from THIS half's own sidecars and gated on the HALF spec's connotation.disposition_required
  // stamp (splitGridSpec spreads the canonical spec's connotation object verbatim — receipt-presence,
  // the D1 pattern), so unstamped/pre-P2-C artifacts never flip on replay or resume.
  commonLawHalf: (p, c) => declaredUnavailableGate(p, c, commonLawHalfEvidence(p, c)),
  // B2 (charter 2026-07-31) — placement's tier sections gain a STRUCTURED sibling, placements.json
  // ({mark, owner, jurisdiction, records[], tier, reason} — reason a short paragraph; the rulings tail
  // stays prose in the md). The sibling requirement is gated on PROMPT VINTAGE via the stage-contract
  // marker (the recordStageContract pattern above at variantManifest — written at DISPATCH only), so:
  // replay over archives never flips (no marker ⇒ legacy rules), a crash-resume keeps a pre-B2
  // artifact passing, and a fresh dispatch under this code is held to the new floor. A sibling that
  // EXISTS is parsed strictly regardless of vintage (present-and-malformed is always a defect).
  placement: (p, c) => {
    const base = all(nonEmpty(c), needs(c, [/tier|placement|sheet|level/i], "placement tiers"));
    if (!base.ok) return base;
    const dir = dirname(String(p ?? ""));
    if (existsSync(join(dir, "placements.json")))
      return checkSiblingJson(p, "placements.json", parsePlacementsJson, "placement-model", "placementmodel_missing");
    let structured = false;
    let formEra = false;
    const marker = driverDir(dir, "stage-contracts.json");
    // ABSENT marker = not minted under the B2 prompt — pre-B2 rules apply (every archive). PRESENT but
    // unparseable is a different fact (post-merge audit 2 (c), the convention set for the
    // variantManifest twin above): the marker is DRIVER-written (pipeline.mjs recordStageContract), so a
    // corrupt one is a code/fs bug, and reading it as "no marker" would silently disarm the WHOLE B2
    // floor on exactly the runs the floor governs. Fail closed, with a name.
    if (existsSync(marker)) {
      try {
        const m = JSON.parse(readFileSync(marker, "utf8"))?.["placement-inquiry"];
        structured = Boolean(m?.structuredPlacements);
        formEra = m?.placementForm === 1;
      } catch { return fail("stagecontracts_invalid"); }
    }
    // — UNDER THE FORM ERA THE SEAT DOES NOT WRITE placements.json AT ALL. The driver renders it from
    // the accumulator, so its absence at the moment this validator reads the seat's prose is the ordinary
    // state and demanding it here is what caused the R1 discard: attempt 1 had written a complete, valid
    // placement-recommendations.md, lay quiescent 371 s against a 60 s bar, and the wall rescue
    // looked, asked this validator, was told `placementmodel_missing`, and refused — throwing 31 minutes
    // of finished work away over a file the seat was never going to write next.
    //
    // What replaces the floor is stronger, not weaker: the tiers live in a driver-held accumulator that a
    // kill cannot reach, and the rendered file is parse-then-land through this same strict parser before
    // it is allowed on disk. Archived runs carry no `placementForm` key and keep the old floor exactly.
    if (formEra) return base;
    return structured ? fail("placementmodel_missing") : base;
  },
  // The opus digest legitimately splits the section ("## On-field findings" / "## Off-field findings"), so the
  // marker is a heading that CONTAINS "findings", not the literal "## Findings". The real structural anchors are
  // the Coverage ledger heading + a status row (these still reject truncated / wrong-stage output).
  //
  // MACHINE COVERAGE LEDGER (WS-A, Map #3): register-coverage-ledger.json is CODE-DERIVED by the
  // driver (runDigest) from THIS prose,
  // so when present it is validated STRICTLY for STRUCTURE only — dictated keys, full-axes enum, bare-token
  // statuses, every active axis owns ≥1 row (active axes from the run's register-units/*.md, else decideAxes
  // over the sibling manifest; neither readable ⇒ completeness skipped, mirroring the commonLaw receipt-check
  // skip). The prose↔JSON mirror cross-check is RETIRED — the JSON matches the prose by construction. No file
  // ⇒ legacy prose path (every archived run; replay verdicts must not flip). The parser's throw is CONVERTED
  // to a fail here — a validator must never throw (runStage calls it bare) — and its token-first reason drives
  // the corrective/warm retry ladder.
  registerFindings: (p, c) => {
    // ── — ONE BRANCH, ON THE ERA STAMP, AND EVERY COVERAGE FLOOR HANGS OFF IT ──────────────────
    //
    // NEVER DELETE A FLOOR UNCONDITIONALLY WHILE ITS REPLACEMENT IS CONDITIONAL. The first cut of this
    // build dropped the structural `## Coverage ledger` requirement (and the prose disclosure joins)
    // outright, while arming the form CONDITIONALLY — `readCoverageFormInput` returns null whenever the
    // plan apparatus is out of reach. On every such run the seat had been told not to write a table, no
    // form existed to judge, `parseCoverageLedgerFull` found no rows, and `deriveCoverageStatus([])`
    // answered `{complete:true}`: ZERO ROWS READING AS COMPLETE COVERAGE, on the validator whose whole
    // job is coverage honesty. The replay corpus measured the same hole from the other side — three
    // preserved runs flipped from `coverage_deferred_unaccounted` to ok.
    //
    // So the old floor and the new gate are armed by the SAME condition, and it is this one:
    //   stamped   ⇒ the driver wrote a form, the seat was told not to write a table, and the form is the
    //               whole coverage judgement (below).
    //   unstamped ⇒ every pre- check applies unchanged, and stages.mjs — reading THIS SAME STAMP —
    //               tells the seat to write the prose table. The two cannot disagree about which
    //               document the run owes.
    //
    // ── M6 (2026-08-14): THE UNSTAMPED ARM IS NOW ARCHIVE-ONLY, AND IT STAYS ───────────────────
    //
    // The driver arms unconditionally from M6, inside the same `willRun` gate that dispatches the
    // digest and before it — so NO LIVE RUN reaches here unstamped, and stages.mjs no longer has a
    // second arm to tell a seat to write the prose table. The prose floor below, and the prose-era
    // joins it feeds (findUnaccountedDeferredSlices, findUnverifiedIncompleteCleanClaims), are
    // therefore DEAD FOR LIVE RUNS and LOAD-BEARING FOR REPLAY: an archived pre- run carries no
    // stamp at all, and its coverage verdict is judged by exactly this arm.
    //
    // DO NOT DELETE THEM AS DEAD CODE. Removing them does not change any live run's answer; it changes
    // what an ARCHIVED run replays to — and replay verdicts are quoted. That is a records mutation
    // nobody ordered, and no code revert un-quotes a verdict once it has been read.
    const stamp = coverageFormStamp(dirname(p));
    const structural = stamp.required
      ? all(nonEmpty(c), needs(c, [/^#{1,4}\s+[^\n]*\bfindings\b/im], "findings-heading"))
      : all(nonEmpty(c), needs(c, [/^#{1,4}\s+[^\n]*\bfindings\b/im, /Coverage ledger/i], "findings+ledger", ["findings-heading", "coverage-ledger"]),
        hasCoverageLedgerRow(c) ? ok() : fail("no_coverage_status_row"));
    if (!structural.ok) return structural;
    // ── THE COVERAGE FORM, AND THE FOUR STATES THAT ARE NOT THE SAME FACT ──────────────────────────
    //   not required        — no era stamp: EVERY ARCHIVED RUN, and nothing else since  M6. A run
    //                         whose plan apparatus is out of reach used to land here too; it now gets a
    //                         form declaring that, with its cause. The form arm is OFF and the PROSE
    //                         arm above and below is on, for replay.
    //   required + absent   — THE DRIVER DID NOT WRITE WHAT IT STAMPED AS REQUIRED. A named FAIL, and
    //                         named as a driver bug: the precedent is grid_spec_unreadable /
    //                         grid_ledger_missing below. This is the one case  gets wrong — its
    //                         dispositionForm returns {rows:null,error:null} for a missing sidecar and
    //                         findConnotationViolations returns no violations over it, so an absent form
    //                         is byte-for-byte indistinguishable from a fully ruled one and the run
    //                         PASSES. That is reachable (a full disk fails as "artifact absent", not as
    //                         a disk error), and this validator must not reproduce it.
    //   required + damaged  — present and unusable. A NAMED defect (coverage_form_damaged), never read
    //                         as absent: reading it as absent would silently drop every status in it.
    //   required + EMPTY    — present, parsed, and carrying NO ROWS. ASK WHAT THE ZERO MEANS. It is
    //                         reachable: `readCoverageFormInput` accepts a `skeleton: []` receipt and an
    //                         `entries: []` plan, so a run that executed nothing stamps a form with no
    //                         obligations in it. findCoverageFormViolations([]) is [], formLedgerRows([])
    //                         is [], and `[]` is not nullish — so the prose fallback below never engages,
    //                         the F3 and taint gates see nothing, and the run passes having judged no
    //                         coverage at all. That is `{rows:null,error:null}` one step over: the exact
    //                         shape this build set out to refuse, reproduced in the artifact it replaced
    //                         it with. Fail closed, and name the driver.
    //   required + parsed   — judged against the rows the driver regenerated at the last judgement.
    let coverageRows = null;
    if (stamp.required) {
      const cf = readCoverageForm(dirname(p), stamp.formName);
      if (!cf.present)
        return fail(`coverage_form_missing:_driver/${coverageFormSidecarName(stamp.formName)} absent while _driver/coverage-enum.json requires it — the driver writes it before the digest dispatches and unions it before every judgement (driver-written — this is a bug, not a model defect)`);
      const covFail = coverageFormFail(findCoverageFormViolations(cf.rows, cf.error));
      if (covFail) return covFail;
      // ── M6 — THE ONE EXCEPTION TO THE EMPTY-FORM REFUSAL, AND WHY IT IS SAFE (2026-08-14) ──────
      //
      // A zero-row form stays what it has always been: an absence of coverage judgement that every gate
      // below would read as a complete one. M6 does not soften that. It adds exactly one case — a form
      // that SAYS why it is empty, in a cause the closed vocabulary contains — because after M6 the
      // driver always arms and always writes, so a run whose plan apparatus was out of reach now
      // reaches here with a real artifact instead of no stamp at all.
      //
      // The declaration is checked, not trusted. `coverageFormAbsence` returns null for a missing
      // `absence`, a cause outside COVERAGE_ABSENCE_CAUSES, or anything that is not an object — so an
      // empty form wearing a made-up excuse falls through to the refusal below, and a driver that wrote
      // an empty form by accident cannot acquire an alibi by writing a word into it.
      const declared = coverageFormAbsence(cf.parsed);
      if (!cf.rows.length && declared) {
        coverageRows = [];
      } else if (!cf.rows.length) {
        return fail(`coverage_form_empty:_driver/${coverageFormSidecarName(stamp.formName)} parsed and carries NO rows while _driver/coverage-enum.json requires a form, and declares no cause the vocabulary carries (${COVERAGE_ABSENCE_CAUSES.join(" / ")}) — an empty form is an ABSENCE of coverage judgement, never a complete one, and every gate below would read it as complete (driver-written — this is a bug, not a model defect)`);
      } else {
        coverageRows = formLedgerRows(cf.rows);
      }
    }
    // D1 fail-closed — an off-enum Status on a REAL axis row must fail, not vanish: the prose parser
    // drops unclassifiable rows, so a `primary-sweep | complete` row would exit every downstream gate
    // (deriveCoverageStatus, the plan/taint joins) as if it never existed. Junk/prose lines whose axis
    // is not a known register axis never fire. Keyed on the driver-written _driver/coverage-enum.json
    // sentinel (receipt PRESENCE — the D1 invariant): the driver arms it right before every digest
    // pass it dispatches (runDigest), so the corrective ladder repairs live rows, while ARCHIVED runs
    // never carry it and replay verdicts never flip — off-enum shapes ("N/A", "confirmed", "✅",
    // "not-searched (immaterial by design)") sit in 27 of 64 corpus register-findings.md files,
    // including July-2026 runs, so an unkeyed gate would mass-flip the replay harness to NO-GO.
    if (existsSync(driverDir(dirname(p), "coverage-enum.json"))) {
      const offEnum = parseCoverageLedgerFull(c).offEnum;
      if (offEnum.length)
        return fail(`coverage_status_offenum:${short(offEnum[0].status)} (axis ${offEnum[0].axis}${offEnum.length > 1 ? ` +${offEnum.length - 1} more` : ""} — the Status cell is EXACTLY one bare token of: ${COVERAGE_STATUSES.join(" / ")}; qualifiers move into reason)`);
    }
    // ── THE COVERAGE ROWS EVERY GATE BELOW READS ──────────────────────────────────────────────────
    // On a FORM run they are the form's settled rows: the driver wrote the axis and the seat wrote the
    // status, so this is the same fact the prose table used to carry and it is available BEFORE the
    // driver renders that table. Reading the prose here instead would disarm the three gates below on
    // attempt 1 of every fresh run, because the seat no longer writes a Coverage ledger.
    // On an ARCHIVED run there is no form and parseCoverageLedgerFull is the reader — which is the ONLY
    // job it still has. No gate parses that table on a live run any more.
    const ledgerRows = coverageRows ?? parseCoverageLedgerFull(c).rows;
    // WS2 (B4 — the F3 gate): with a plan-execution receipt on disk (plan-mode fresh runs;
    // archived/replay runs lack it ⇒ inactive), a `confirmed-clean` claim over an axis whose code-derived
    // skeleton says "unexecuted" is a hard fail — the claim is checked against what RAN, not against what
    // the digest asserts. D1 fail-closed: the read and the parse are SPLIT — absence keeps the gate
    // inactive (replay never flips), but a receipt PRESENT and unparseable (or of the wrong shape) fails
    // loud: the sidecar is DRIVER-written, so a corrupt one is a bug, and the old whole-block catch
    // silently disabled every F3 gate over exactly that bug.
    //
    // — THE `deferred` ARM AND THE `incomplete` ARM ARE ERA-SCOPED, NOT DELETED. Both carried a
    // disclosure join over text the model typed (findUnaccountedDeferredSlices /
    // findUnverifiedIncompleteCleanClaims' C8), and on a FORM run the form replaces both: the driver
    // writes one row per deferred qid and one per open crowd block, each `open`, and
    // findCoverageFormViolations above refuses a clean claim on any of them. On a run with NO form there
    // is nothing to replace them WITH, so they run exactly as they did before this build — same order,
    // same tokens, byte-identical construction, because the replay corpus compares verdict STRINGS.
    // `unexecuted` and `skipped` never had a join, so findUnexecutedCleanClaims runs on BOTH paths.
    let planExecRaw = null;
    try { planExecRaw = readFileSync(driverDir(dirname(p), "plan-execution.json"), "utf8"); } catch { /* no receipt — plan gate inactive (legacy/replay) */ }
    if (planExecRaw != null) {
      let exec = null;
      try { exec = JSON.parse(planExecRaw); } catch { /* falls through to the shape fail below */ }
      if (exec == null || typeof exec !== "object" || (exec.skeleton != null && !Array.isArray(exec.skeleton)))
        return fail("plan_execution_unreadable: _driver/plan-execution.json is corrupt (driver-written — this is a bug, not a model defect)");
      if (!stamp.required) {
        // — the DEFERRED-SLICE ACCOUNTING requirement, ahead of the clean-claim gate because it is the
        // superset: a slice the plan recorded as unsearchable owes a row whether or not anything on its axis
        // claims clean. Until this ran, a ledger that never mentioned the slice at all passed, and the only
        // thing that caught a deferred axis was the digest volunteering a clean claim over it first.
        const unaccounted = findUnaccountedDeferredSlices(parseCoverageLedgerFull(c).rows, exec.skeleton);
        if (unaccounted.length)
          return fail(`${unaccounted[0].token}:${unaccounted[0].missing.join(",")}`.replace(/\s+/g, " ").slice(0, 160)
            + (unaccounted.length > 1 ? ` (+${unaccounted.length - 1} more axes)` : ""));
      }
      const violations = findUnexecutedCleanClaims(ledgerRows, exec.skeleton);
      if (violations.length)
        return fail(`${violations[0].token}${violations.length > 1 ? ` (+${violations.length - 1} more)` : ""}`);
      if (!stamp.required) {
        // The discriminated `incomplete` sibling (copper-lattice): a clean claim over a plan-joined
        // multi-term enumerate crowd lacking full per-term accounting (term_counts, the count-first
        // truth). Sanctioned crowds (count-kind, single-term saturated) never fire — crowd = dilution
        // stays judgment's call. Needs the run-dir plan + bands; either unreadable ⇒ inactive.
        try {
          const plan = parseRegisterPlan(readFileSync(driverDir(dirname(p), "register-plan.json"), "utf8"));
          const bands = {};
          for (const s of (exec.skeleton ?? [])) {
            try {
              const parsed = JSON.parse(readFileSync(join(dirname(p), "register-units", `${s.axis}-band.json`), "utf8"));
              bands[s.axis] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : []);
            } catch { /* band unreadable — parse defects are the unit validator's */ }
          }
          const v2 = findUnverifiedIncompleteCleanClaims(parseCoverageLedgerFull(c).rows, exec.skeleton, bands, plan);
          if (v2.length) {
            // Deduped by AXIS: the gate emits one violation per confirmed-clean row, so ION's single
            // undisclosed OR-stack read as "primary-sweep (+5 more)" — which looks like six problems on
            // six axes and hid that every one was the same axis. Count the axes, not the rows.
            const axes = [...new Set(v2.map((v) => v.axis))];
            // ── 2026-08-05: THE TOKEN NAMED THE AXIS AND NOTHING ELSE, AND THE AXIS IS NOT THE DEFECT ──
            // R2 @7ce4f27 died here on `repeat-signature` after four identical attempts. The gate had
            // found ONE unaccounted class — class 5, `unenumerated`, in block
            // supp:incumbent-class:owner:abbvie-inc:f5137d37 (703 hits) — among 91 blocks on that axis. The
            // token said only `:incumbent-class`, so correctionHint could only speak in generalities, and its
            // generality was drawn from the TERM shape: it told the model to find "a multi-term OR-stack whose
            // per-term accounting is incomplete" and to name "which terms are unaccounted". Every block on
            // that axis had term_counts ABSENT and zero unaccounted terms. The model was sent to find
            // something that did not exist, so no honest digest could clear the gate — the ION unclearable
            // shape again, one gate over.
            //
            // The gate has always computed the qid, the unaccounted classes/terms and total_hits. Both of the
            // things that can DISCLOSE the block (blockIsDisclosed: the qid, or total_hits standalone) were in
            // hand and thrown away. So the token carries them now. The FIRING CONDITION IS UNTOUCHED — this
            // gate refuses exactly what it refused before; it just says what it refused.
            //
            // Shape order matters: the axis stays first and space-separated, because correctionHint's
            // `coverage_clean_unverified_incomplete:([^\s)]+)` capture would otherwise swallow the detail.
            const b0 = (v2[0].blocks ?? [])[0];
            const detail = b0
              ? [
                ` qid=${b0.qid}`,
                Number.isInteger(b0.total_hits) ? ` hits=${b0.total_hits}` : "",
                b0.unaccounted_classes?.length ? ` classes=${b0.unaccounted_classes.join(",")}` : "",
                b0.unaccounted?.length ? ` terms=${b0.unaccounted.map((t) => abbrev(TOKEN_SAFE(t), 40)).join(",")}` : "",
                (v2[0].blocks ?? []).length > 1 ? ` (+${v2[0].blocks.length - 1} more blocks on this axis)` : "",
              ].join("")
              : "";
            return fail(`${v2[0].token}${detail}${axes.length > 1 ? ` (+${axes.length - 1} more axes: ${axes.slice(1).join(", ")})` : ""}`);
          }
        } catch { /* no plan in reach — gate inactive */ }
      }
    }
    // Timeout-taint gate (copper-lattice 2026-07-08): a `confirmed-clean` prose claim on an axis whose
    // winning register-unit pass was kill-touched (per-attempt jsonl: SIGKILL/timeout inside the winning
    // ladder — register-taint.mjs) is a self-report the machine must not trust. Token-first fail; the
    // corrective hint tells the digest to relabel the row `deferred` with the honest reason. Receipt-aware:
    // a resolved/disclosed axis (fan-in recovered it, or the late-resume disclose path holds the client
    // gate) never re-fails — only UNACKNOWLEDGED taint fires. No jsonl at all ⇒ inactive (offline tests).
    // Deliberately replay-ACTIVE: the archived copper-lattice run carries the timeout row + the clean
    // claim on disk today — that flip IS the regression pin; a clean-passes run (teal-lattice) is
    // untouched. The live chain had a kill switch and this shared it; both are gone, because nothing
    // set it anywhere and an off-path nothing exercises is not a rollback, it is untested code.
    {
      try {
        const cleanAxes = [...new Set(ledgerRows.filter((r) => r.status === "confirmed-clean").map((r) => String(r.axis)))];
        if (cleanAxes.length) {
          const unack = new Set(readUnacknowledgedTaintAxes(dirname(p)));
          const bad = cleanAxes.filter((a) => unack.has(a));
          if (bad.length) return fail(`coverage_clean_tainted:${bad.join(",")}`.slice(0, 160));
        }
      } catch { /* unreadable ledger rows are owned by the structural checks above */ }
    }
    let ledgerRaw = null;
    try { ledgerRaw = readFileSync(join(dirname(p), "register-coverage-ledger.json"), "utf8"); } catch { /* legacy run */ }
    if (ledgerRaw == null) return ok();
    // Active axes = the units the run actually spawned (register-units/*.md is the per-run activation
    // record — immune to future decideAxes vocabulary drift retro-flipping archived-run replays);
    // fallback: decideAxes over the sibling manifest; neither readable ⇒ completeness skipped.
    let activeAxes = null;
    try {
      const units = readdirSync(join(dirname(p), "register-units")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
      if (units.length) activeAxes = units;
    } catch { /* no units dir in reach */ }
    if (activeAxes == null) {
      try { activeAxes = decideAxes(readFileSync(join(dirname(p), "variant-manifest.md"), "utf8")); } catch { /* offline/unit contexts */ }
    }
    // — the JSON is CODE-DERIVED FROM THE COVERAGE FORM (renderCoverageLedgerJsonFromForm, called in
    // the driver's runDigest), exactly as the `## Coverage ledger` table above it is. Map #3 derived it
    // from the model's prose, which left a model-authored table as the source of truth for every coverage
    // gate; the form is the source now and both are renders of it, so they agree BY CONSTRUCTION and the
    // old prose↔JSON mirror cross-check stays retired. Structural validity is still enforced (parse +
    // activeAxes completeness) so a malformed derived JSON still surfaces as a token-first defect.
    try { parseCoverageLedgerJson(ledgerRaw, { activeAxes }); }
    catch (e) { return fail(String(e.message).replace(/\s+/g, " ").slice(0, 160)); }
    return ok("machine-ledger");
  },
  // "no flags surfaced" (17 chars) is the canonical clean result — accept it regardless of length;
  // otherwise require a non-trivial flag list.
  // item 2 — THE LOOSE SENTINEL IS RETIRED WITH THE DICTATION, as that issue said it would be.
  // This read `/no flags/i` against the WHOLE file, so a flag bullet containing the words — "the coverage
  // table shows no flags for primary-sweep" is an ordinary sentence for this stage — made a file full of
  // flags validate as clean. Nothing needs a substring sentinel now that `renderSkepticFlags` is the only
  // writer: the shape is exact, so the check is exact. A failure here is the driver's render or an fs
  // fault, not the seat's typing — the same place the coverage and blind-frame transports arrived.
  skepticFlags: (_p, c) => {
    const text = String(c ?? "");
    // THE RENDERED SHAPE, CHECKED EXACTLY. Every file the driver writes carries the escalation section, so
    // its presence is what says "this file came from renderSkepticFlags" and the check can be exact.
    if (/^## Escalation decisions$/m.test(text)) {
      const r = needs(text, [/^ESCALATE: (?:none|\S+ — .+)$/m], "skeptic-flags", ["escalation-line"]);
      if (!r.ok) return r;
      return /^no flags surfaced$/m.test(text) ? ok("clean") : nonEmpty(text, 20);
    }
    // ARCHIVED LENIENCY, and the same rule spotCheckBinds states for the anchor: a new way in, never a
    // replacement. A pre-conversion file was hand-written and may be the bare sentinel with no section at
    // all (17 bytes — replay-archive.test.mjs holds exactly that), and a replay that rejected it would fail
    // runs whose answers were fine. Found by the suite, not reasoned about: my first cut demanded the
    // section unconditionally and reddened the archive.
    //
    // THE ITEM-2 DEFECT IS STILL FIXED HERE. The old test was `/no flags/i` against the WHOLE file, so
    // "the coverage table shows no flags for primary-sweep" — an ordinary sentence for this stage — made a
    // file full of flags read as clean. The sentinel must now be its OWN LINE, which no archived file that
    // legitimately carried it can fail.
    return /^no flags surfaced\s*$/m.test(text) ? ok("clean") : nonEmpty(text, 20);
  },
  // doubt-closure (T2c) — forgiving ON PURPOSE: the anti-confabulation guard is CODE-side
  // (doubt-ledger.applyClosure re-verifies every quote verbatim; a malformed line parses to absent and
  // its doubt stays open), so the validator only insists the output speaks the dictated shape at all —
  // a wholly free-prose file is the one thing worth a retry.
  doubtClosure: (_p, c) => needs(c, [/^(?:[-*]\s+)?(?:SETTLED|IMMATERIAL|OPEN)\s+\S+:/m], "settled/immaterial/open lines"),
  // WS2 (spec 11) + Spec-v3 A4: the use-check / own-rights enforcement RETIRED its prose-regex gates
  // (Instance #5) — the cite of record is now the STRUCTURED findings.json use_check / own_rights field,
  // validated in checkFindingsSibling (below) with the ordinal context and rendered FROM the JSON by
  // render.mjs (so the cite can never diverge from the field). The prose-marker lines remain useful for
  // narrative readability but are no longer machine-checked here.
  narrative: (p, c) => {
    const base = nonEmpty(c, 300);
    if (!base.ok) return base;
    // T9 (A2) — the committed-check COMPLETION GATE: when the run froze intake asks
    // (_driver/intake-asks.json, A6), the narrative MUST answer each with a labelled line —
    // the VENZY descriptiveness ask was committed at intake and silently never answered anywhere.
    // Sidecar-gated (archived runs have no sidecar → never fires; replay-safe); the refutation stays
    // the semantic backstop — this is the deterministic floor.
    try {
      const asksRaw = readFileSync(driverDir(dirname(p), "intake-asks.json"), "utf8");
      const asks = JSON.parse(asksRaw);
      if (Array.isArray(asks) && asks.length) {
        const sec = String(c ?? "").match(/^##\s*Answers to your instructions\s*\n([\s\S]*?)(?=^#{1,2}\s|$(?![\s\S]))/im)?.[1] ?? "";
        // Accepts the current label ("You asked: …") AND the retired "You asked us to check …" form —
        // archived narratives re-verify under the same gate, so the match must stay a superset.
        const answered = (sec.match(/^-\s*You asked\b/gim) || []).length;
        if (answered < asks.length)
          return fail(`intake_ask_unanswered:${asks.length - answered}:of:${asks.length}`);
      }
    } catch { /* no sidecar / unreadable — legacy run, gate off */ }
    // V4-4 item 6 — narrative coverage contract (code-checked, conditional on the closure receipt):
    // a marketplace coverage gap may be stated ONLY as an attempted-and-unreachable fact, never as
    // "commission a re-run" work for a human — the driver already closed or proved-unclosable every
    // closable gap BEFORE synthesis ran (the S&I line-154 disease). Detection = a sentence that BOTH
    // names marketplace/platform coverage AND recommends a re-run/further search as a next step.
    const cv = findCoverageRecommendations(c);
    if (cv.length) {
      const receipt = existsSync(driverDir(dirname(p), "coverage-closure.json"));
      return fail(receipt
        ? `coverage_recommendation:${abbrev(cv[0], 100)}`
        : `coverage_gap_unexplained:${abbrev(cv[0], 100)}`);
    }
    // The rated findings are mirrored into a sibling findings.json. Validate it HERE so the
    // synthesis stage (validate: validators.narrative) AND the replay (FILE_CHECKS narrative.md → this
    // validator) both enforce it — runtime == replay. Soft on absence (legacy/archived runs return bare
    // ok() ⇒ no replay flip), hard on validity.
    return checkFindingsSibling(p, c);
  },
  // The per-finding machine contract (findings-model.mjs). The sibling check is FOLDED INTO
  // validators.narrative (above) so it runs in replay too; this slot
  // delegates to the same helper for focused unit testing (test/findings-model.test.mjs). findings.json is
  // not its own FILE_CHECKS target — narrative.md is the replay anchor.
  findings: (p, c) => checkFindingsSibling(p, c),
  // — the prose check, plus the RETRIEVAL RECORD beside it. Until the sibling existed, this whole
  // contract was `nonEmpty(c, 80)`: a report claiming no adverse case law and a run whose sweep never
  // dispatched produced byte-identical artifacts, and two of the owner's three sign-off conditions were
  // unanswerable. Vintage-gated on the driver-written stage-contract marker exactly as the variant floor
  // is — ABSENT means the output was minted under a prompt that never asked for a ledger, so archived
  // and replayed case-law verdicts never flip. Present-but-unparseable is a driver/fs fault and surfaces
  // with a name rather than silently waiving the floor it governs.
  caseLaw: (p, c) => {
    const base = nonEmpty(c, 80);
    if (!base.ok) return base;
    const dir = dirname(String(p ?? ""));
    let contract = null;
    const marker = driverDir(dir, "stage-contracts.json");
    if (existsSync(marker)) {
      try { contract = JSON.parse(readFileSync(marker, "utf8"))?.["case-law"] ?? null; }
      catch { return fail("stagecontracts_invalid"); }
    }
    if (!contract?.citations) return base;
    const sibling = join(dir, "case-law-citations.json");
    if (!existsSync(sibling))
      return fail("caselaw_ledger_missing:case-law-citations.json — the sweep's queries and what was read are unrecorded");
    let raw = null;
    try { raw = readFileSync(sibling, "utf8"); }
    catch { return fail("caselaw_ledger_missing:case-law-citations.json exists and could not be read"); }
    const { ledger, error } = parseCaseLawLedger(raw);
    if (error) return fail(`caselaw_ledger_unparseable:${error}`);
    // No dive list is read: case-law work is single-territory by design, and
    // scope-rules.mjs REFUSES a clearance with caseLaw over anything but exactly one territory, so the
    // run IS the dive. The ledger answers "did it run thin" on its own.
    const f = caseLawLedgerFail(findCaseLawLedgerViolations(ledger));
    return f ? fail(f) : base;
  },
  seniorEyeReview: (p, c) => {
    const v = parseVerdict(c);
    if (!v) return fail("no_verdict_line");
    // qw/typed-correction-kinds — correction lines may carry an OPTIONAL `[kind: …]` token (the closed
    // CORRECTION_KINDS enum). The validator ACCEPTS lines with or without it, by contract: legacy and
    // archived reviews must stay valid forever, and an unknown token is a telemetry fact
    // (parseCorrectionKinds partitions it to `fact`, the fail-safe), never a validation defect —
    // failing the review over a typo'd kind would burn a corrective retry to fix metadata.
    // WS2 (B4) — with a plan-execution receipt on disk the review MUST carry the
    // "PLAN-EXECUTION CHECK" section (the driver feeds the table as a deterministic extra; a
    // review that skipped it has not audited whether clean claims rest on unexecuted slices).
    // Only-if-present ⇒ archived/replay runs (no receipt) never flip. D1 fail-closed: same split
    // as the registerFindings read — a receipt PRESENT but corrupt fails loud instead of silently
    // waiving the audit requirement (the sidecar is driver-written; a corrupt one is a bug).
    let planExecRaw = null;
    try { planExecRaw = readFileSync(driverDir(dirname(String(p ?? "")), "plan-execution.json"), "utf8"); } catch { /* no receipt — audit not required */ }
    if (planExecRaw != null) {
      try { JSON.parse(planExecRaw); }
      catch { return fail("plan_execution_unreadable: _driver/plan-execution.json is corrupt (driver-written — this is a bug, not a model defect)"); }
      if (!/PLAN-EXECUTION CHECK/i.test(c ?? "")) return fail("plan_audit_missing");
    }
    return ok(v);
  },
  // delivery contract files. report.md is now ASSEMBLED by the driver (assembleReportMd) from the two LLM
  // halves below; its validator stays (front-matter + Marks) as the post-assembly structural gate.
  report: (_p, c) => all(nonEmpty(c, 300), needs(c, [/^---/m, /^#\s*Marks/im], "front-matter+marks", ["front-matter", "marks-section"])),
  // B1 — report-overview: the cross-finding shell (front-matter + Actions/Coverage/Methodology, NO cards).
  reportOverview: (_p, c) => all(nonEmpty(c, 120), needs(c, [/^---/m, /^#\s*(Actions|Coverage|Methodology)/im], "front-matter+shell", ["front-matter", "shell-section"])),
  // B1 — report-card: ONE isolated finding card (heading + its depth section). Lenient-but-structural
  // like the rest.: the required section is "### Full detail", NOT "### The read" — the read was a
  // third condensation of a finding already summarised by the typed `net`, and it is retired. This gate
  // had to move in the SAME commit as the prompt: a validator demanding a section the prompt no longer
  // asks for fails every card on the next run and burns the corrective ladder on a contract nobody holds.
  // — THE H2 REQUIREMENT IS GONE, BECAUSE THE DRIVER WRITES IT NOW.
  //
  // (75b8f60b) moved the `## <owner> — <MARK>` head from the seat to card-frame.mjs and the
  // dispatch prompt now forbids the seat to write one, in capitals: "WRITE THE CARD'S DETAIL ONLY — NO
  // HEAD, NO META LINES … a line you write there is discarded, not read." This validator was not moved
  // with it and still demanded the head, so **a seat that obeyed its instructions could not pass** —
  // 30 of 30 cards on R5, both attempts, delivered anyway with `status: "ok"` on every record.
  //
  // The comment two lines above says this exact thing about — "this gate had to move in the SAME
  // commit as the prompt: a validator demanding a section the prompt no longer asks for fails every card
  // on the next run and burns the corrective ladder on a contract nobody holds." It was right, it was
  // written here, and the next change to this pair did not read it.
  //
  // ASSERTING THE POST-FRAME ARTIFACT IS NOT AVAILABLE HERE, and that is why this drops rather than
  // inverts. `composeCard` declared in card-frame.mjs runs at ASSEMBLY, long after this validator sees the
  // stage's output, so the shipped card does not exist yet at this point. The validator's subject is the
  // seat's FRAGMENT and it now asserts only the fragment's own shape.
  //
  // NOR IS THE HEAD REFUSED, which was the tempting symmetric move. `carriesOwnFrame` is a live branch:
  // archived cards, replays and a drifted seat all take the legacy path and legitimately carry a head, so
  // a validator that rejected `##` would fail every replayed card. HEAD COVERAGE DID NOT MOVE INTO A
  // HOLE — report-card-frame.test.mjs composes a head for every card in demo and asserts
  // byte-equality against report.md's own `## ` lines, seven specimens including the common-law one that
  // breaks the naive uppercase rule. That is stronger coverage than the regex this deletes.
  // §8 — TWO SHAPES, AND EXACTLY ONE OF THEM. A card is a full card (`### Full detail`, written by
  // the seat) or a short entry (`### In short`, composed code-side from the typed `net`). The alternation
  // is the acceptance: a file carrying NEITHER is still refused, which is what this validator has always
  // been for. Widening to "any `###` heading" would accept a card whose seat wrote a heading of its own
  // invention, and that is the failure this token names.
  reportCard: (_p, c) => all(nonEmpty(c, 60), needs(c, [/^###\s+(?:full detail|in short)\b/im], "detail", ["full-detail-section"])),
  audit: (_p, c) => all(nonEmpty(c, 200), needs(c, [/^#\s*Findings/im], "findings-section")),
  // client-summary: forgiving labelled blocks (Header / Executive Summary / Marks).
  //
  // RETIRED STAGE, REPLAY-ONLY (2026-08-01). No live run writes client-summary.md any more — the
  // stage is deleted. This validator and checkClientSummaryJoin below are KEPT and must stay
  // working: driver/replay-archive.mjs maps "client-summary.md" → clientSummary and replays it over
  // the real matter archive, and mcp-server/lib/coverage.mjs runs it on archived runs too. Do not
  // delete either, and do not relax them — an archived run must judge exactly as it always did.
  clientSummary: (p, c) => all(nonEmpty(c, 80), needs(c, [/^#\s*Executive Summary/im, /^#\s*Marks/im], "exec-summary+marks", ["exec-summary", "marks-section"]), checkClientSummaryJoin(p, c)),
  // — `notify` LIVED HERE AND IS GONE WITH ITS STAGES. It guarded against a receipt that ADMITTED
  // the send had not happened ( T5 / F9: teal-keystone's agent wrote a receipt saying the
  // messaging tool was absent, it passed nonEmpty(5), the stage was marked ok, and the failure died
  // silently). Nothing in this product asks a model to send anything any more — every requester-facing
  // event is an outbox packet written by code — so there is no receipt to disbelieve. The guarantee that
  // replaced it is stronger and is not a validator: a packet either lands on disk or the write is
  // recorded as failed, and neither outcome is a model's account of itself.
};

// A2 (F4) — the client boundary is CODE-checked, not prompt-guarded: the summary's per-mark
// "- risk:" words must equal CLIENT_TIER_BY_COMPOSITE[composite] of the finding they describe, and a
// CONDITIONAL run's recommendation may not read as an unconditional "proceed". Gated on
// schema_version >= 3 so archived v2 runs and replay never flip; sibling reads (findings.json,
// _driver/verdict.json) mirror checkFindingsSibling. Failures ride the stage's corrective ladder;
// the stage stays NON-FATAL downstream (a stubborn miss ships via the lint auto-correct + flags).
function checkClientSummaryJoin(p, c) {
  let findingsDoc = null, verdictDoc = null;
  try { findingsDoc = parseFindingsJsonLenient(readFileSync(join(dirname(p), "findings.json"), "utf8")); } catch { return ok(); }
  if (!findingsDoc || (findingsDoc.schemaVersion ?? 1) < 3) return ok();          // v3-gated
  const v4 = (findingsDoc.schemaVersion ?? 1) >= 4;
  // doc 50 — on v4 the per-mark "- risk:" word is the finding's BAND (the framework in force's own
  // vocabulary, from the frozen manifest); a missing manifest on a v4 run fails loud, mirroring
  // checkFindingsSibling. Legacy stays on the composite table — replay never flips.
  const fw = v4 ? readRunFramework(p) : { manifest: null, invalid: false };
  if (v4 && fw.invalid) return fail("framework_manifest_unreadable: _driver/framework.json is corrupt");
  if (v4 && !fw.manifest) return fail("framework_manifest_missing_for_v4: cannot judge client band words without the frozen framework");
  try { verdictDoc = JSON.parse(readFileSync(driverDir(dirname(p), "verdict.json"), "utf8")); } catch { /* optional */ }
  const blocks = [...String(c ?? "").matchAll(/^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s|\s*$)/gm)];
  for (const [, head, body] of blocks) {
    const risk = body.match(/^-\s*risk:\s*([A-Za-z –-]+)$/m)?.[1]?.trim();
    if (!risk) continue;
    // wp50: deterministic join (ord line → exact mark → unique containment). The old first-match
    // containment join bound "DEMVENZY — Novartis" to the VENZY finding and VALIDATED the wrong tier.
    const f = joinFindingToBlock({ ord: parseBlockOrd(body), head }, findingsDoc.findings);
    if (!f) continue;                                                              // unjoinable block — shape checks own it
    if (v4) {
      if (f.band == null) continue;                                                // unrated (off-field) — no tier word to enforce
      const want = normalizeBand(fw.manifest, f.band);
      if (want && normalizeBand(fw.manifest, risk) !== want)
        return fail(`client_tier_mismatch:${short(f.mark)}:${risk.toUpperCase()}:${want.toUpperCase()}`);
      continue;
    }
    if (!Number.isInteger(f.composite)) continue;
    const want = CLIENT_TIER_BY_COMPOSITE[f.composite];
    if (want && risk.toUpperCase() !== want)
      return fail(`client_tier_mismatch:${short(f.mark)}:${risk.toUpperCase()}:${want}`);
  }
  // WP-56 A4 (decision 4) — COMPLETENESS: every rated conflict the driver dictated (the
  // client-summary-scope sidecar, written at assembly from findings.json dispositions) must appear as a
  // block — a rated conflict silently absent from the client surface is what made teal-lattice's
  // report un-signable (VIBRANTE dropped on a group mislabel). Gated on the sidecar existing, which only
  // fresh runs write — archived runs and replay never flip. Failures ride the stage's corrective ladder.
  try {
    const scope = JSON.parse(readFileSync(driverDir(dirname(p), "client-summary-scope.json"), "utf8"));
    const blockOrds = new Set(blocks.map(([, , body]) => parseBlockOrd(body)).filter((o) => o != null));
    for (const s of scope?.rated ?? []) {
      if (!blockOrds.has(s.ord))
        return fail(`client_summary_missing_rated:${s.ord}:${short(s.mark)}`);
    }
  } catch { /* no sidecar (archived/legacy run) — completeness not dictated */ }
  // T2 (H5) — the EXEC-summary headline "- risk:" was the unchecked surface that let
  // copper-spire's client read "MANAGEABLE / proceed" against a BLOCKING verdict. With an enriched
  // sidecar (carries the derived tier) the headline word must equal it; pre-49 sidecars skip.
  if (verdictDoc?.tier) {
    const exec = String(c ?? "").match(/^#\s*Executive Summary\s*\n([\s\S]*?)(?=^#\s|\s*$)/im)?.[1] ?? "";
    const headRisk = exec.match(/^-\s*risk:\s*([A-Za-z –-]+)$/m)?.[1]?.trim();
    if (headRisk && headRisk.toUpperCase() !== String(verdictDoc.tier).toUpperCase())
      return fail(`client_overall_tier_mismatch:${headRisk.toUpperCase()}:${verdictDoc.tier}`);
  }
  if (verdictDoc?.verdict === "CONDITIONAL" || verdictDoc?.verdict === "BLOCKING") {
    const rec = String(c ?? "").match(/^-\s*recommendation:\s*([^\n]+)$/im)?.[1] ?? "";
    if (isUnconditionalProceed(rec)) return fail("client_verdict_bound_missing");
  }
  return ok("client-summary-join");
}
const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
