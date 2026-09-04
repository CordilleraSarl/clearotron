#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// score.mjs — score a completed run against the lawyer's reference answer for its scenario.
//
//   node scripts/score.mjs <ID> --run <runDir> [--previous <runDir>|auto] [--json]
//
// `--previous auto` resolves the OTHER HALF OF A PAIR: the run of the round immediately before
// this one, same scenario, same door. It reads the scenario's declared refs from the config store and
// walks CLEAROTRON_WORK_DIR — so a noise-floor comparison does not need the operator to be
// holding the earlier round's path at the moment they most likely are not.
//
// Reads the reference from $CLEAROTRON_E2E_DIR/baselines/<ID>.gold.json. Offline: no clearance cost, no
// daily admission, no provider call. Exits 0 whether or not the comparison is unfavourable.
//
// ── it prints no PASS ────────────────────────────────────────────────────────────────────────────────
//
// The verdict is not the harness's to give, and the exit code carries no judgement. `scripts/e2e.mjs`
// already argued this at length for the run ledger and the reasoning is the same one: a word like PASS
// next to a question the tool never asked is worse than no output. What this prints is five axes, four
// buckets, and what moved since the last round. Whether the run was any good is a read, not a number.
//
// Axis E's CONCLUSION line is the one sentence the acceptance asked for, and it is not a PASS in
// disguise: it states which instructed territories got their own jurisdiction sub-query and which did
// not. That is a reading of the frozen plan, the same kind of fact as a bucket count.
//
// ── which directory to point it at ───────────────────────────────────────────────────────────────────
//
// The agent WORKSPACE archive dir, never the published pool dir. The pool keeps report.md and
// findings.json but not `_driver/` or `_records/` — see driver/publish/pool-admin.mjs:145. Without
// `_driver/` there is no band and no reconciliation, so `withheld` cannot be computed at all, and a
// scorer that silently reported every withheld mark as `lost` would send every fix to the wrong place.
// So a run dir with no `_driver/` says so and declines to guess.

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                    // module-top capture below it evaluates. pulled this entry into
                                    // statically reaching driver/driver.config.mjs (via verify.mjs), and a
                                    // call in this file's BODY runs after every static import has already
                                    // evaluated — the repair that left open.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

import {
  scoreRecall, scoreField, scoreSources, scoreGapDiscipline, bucketDelta, validateReference, ownerName,
  readVerdict, evidenceClassOf, scoreTerritories, scoreScriptTargets, referenceCoverage, scoreByMark,
  scoreCounts, referenceLaneMismatch, withheldScope, SCORER_VERSION, scoreStatements,
  deliveryLine, engineCommitOf } from "../driver/reference-score.mjs";
import { renderCarryThrough, carryThrough, coverageConflicts } from "../driver/carry-through.mjs";
import { parseVerdict } from "../driver/verify.mjs";
// The one shipped answer to "which slice surfaced this record" — first-seen `_qid` plus the merged
// `_qids` union. named-band.mjs is import-pure (no node builtins), so reading it here keeps score.mjs
// offline over a preserved run dir.
import { recordQids } from "../driver/named-band.mjs";
// — the round history and round discovery. A PURE leaf (node:fs + node:path), which is the whole
// reason it is not in scripts/e2e.mjs: this scorer is deliberately offline, and importing the harness
// would drag portal-mcp-client, enqueue-schema and door-gates in behind it.
import { previousRunDir, scenarioRefs } from "../driver/e2e-rounds.mjs";
import { readSettleStamp } from "../driver/settle-stamp.mjs";   
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

const die = (msg, code = 2) => { console.error(`\n${msg}\n`); process.exit(code); };

// The bucket printer's last line of defence. owner is flattened at the boundary now, but every
// bucket row is a loose object assembled from two different sources, and Array.join stringifies whatever
// it is handed — so any field that grows a shape prints `[object Object]` in a column a human is reading
// to make the round's quality judgement. Prefer .name (the shape every typed record here uses), then a
// compact JSON, and never the useless form. Unreadable is a finding; silently unreadable is a defect.
const cell = (v) => {
  if (v == null || typeof v !== "object") return String(v);
  if (typeof v.name === "string" && v.name.trim()) return v.name.trim();
  try { return JSON.stringify(v); } catch { return "[unprintable]"; }
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// ── the reference ────────────────────────────────────────────────────────────────────────────────────

function loadReference(id) {
  const root = (process.env.CLEAROTRON_E2E_DIR ?? "").trim();
  if (!root) die(`CLEAROTRON_E2E_DIR is unset, so there is no reference to score against.\n`
    + `  The gold sets are lawyer answers to live client matters and live in the config store, never in\n`
    + `  this repo. Point CLEAROTRON_E2E_DIR at the config repo's e2e/ directory.\n`
    + `  There is deliberately no bundled fallback: a synthetic reference would score a run against an\n`
    + `  answer nobody gave.`);
  const p = join(root, "baselines", `${String(id).toUpperCase()}.gold.json`);
  const ref = readJson(p);
  if (!ref) die(`no reference at ${p}\n  have: ${(existsSync(join(root, "baselines")) ? readdirSync(join(root, "baselines")).join(", ") : "(no baselines/ directory)")}`);
  const errs = validateReference(ref);
  if (errs.length) die(`${p} is not a usable reference:\n${errs.map((e) => `  - ${e}`).join("\n")}\n`
    + `  Refusing to score against it — a malformed reference reads as a clean sweep.`);
  return { ref, path: p };
}

// ── reading a preserved run ──────────────────────────────────────────────────────────────────────────

/**
 * Every label the run PUBLISHED as a finding, from whichever lane wrote it.
 *
 * — plus the run's SUBJECT ROLL, and a `subject` on every row. A finding's `mark` is the
 * CONFLICTING name; its `subject` is the mark the batch was searching when it surfaced it. Only the
 * subject can be compared with what a reference declares it answers, and this function used to throw it
 * away — flattening a two-mark batch into one undifferentiated row list before anything downstream could
 * tell the marks apart.
 *
 * `subjects` is THREE-VALUED: `null` means this lane publishes no per-mark roll at all, `[]` means it
 * published one and it was empty.
 */
function findingsOf(runDir) {
  const clearance = readJson(join(runDir, "findings.json"));
  if (clearance?.findings) {
    return {
      lane: "clearance",
      // One matter, one subject: the clearance lane publishes no per-mark roll, so there is nothing to
      // exclude here and `referenceCoverage` says so rather than excluding on an empty one.
      subjects: null,
      // owner is FLATTENED here, like band beside it. A run finding's owner is the typed object
      // { name, country, registrations } (findings-model.mjs OWNER_KEYS); a gold-set entry's owner is a
      // lawyer-typed string. The bucket printer interpolates whichever it is handed, so the two buckets
      // built from run findings — ADDITIONAL and NOISE — printed `[object Object]` in the column those
      // rows are read for, while LOST and WITHHELD (built from gold entries) printed fine. Flattening at
      // the boundary is why one printer can serve both, and it is what band already does one field over.
      rows: clearance.findings.map((f) => ({
        subject: null,
        // — THE ORDINAL IS CARRIED, because this map is a PROJECTION and anything it does not list
        // is dropped in transit. `matched_ordinal` reached the scorer as undefined on every find of
        // every preserved run measured, and reference-score.mjs recorded the null it was written to
        // record. The field was never missing upstream: `ordinal` is the first key of both FINDING_KEYS
        // and FINDING_KEYS_V4, so the model validates it on every finding here.
        //
        // NORMALIZED ON THE SAME PREDICATE THE SCORER GUARDS WITH, like band and owner beside it. Two
        // layers, one rule: a non-integer cannot reach the score from either direction, and neither
        // layer is load-bearing alone.
        ordinal: Number.isInteger(f.ordinal) ? f.ordinal : null,
        mark: f.mark ?? "", owner: ownerName(f.owner), band: f.band?.label ?? null,
        disposition: f.disposition ?? null, ruled_out: f.ruled_out === true,
        ruled_out_reason: f.ruled_out_reason ?? null,
        // — the EVIDENCE CLASS, derived at the artifact boundary so the scorer stays pure and
        // offline. `source.source_type` is already a closed, per-finding-validated vocabulary
        // (findings-model.mjs SOURCE_TYPES), so this is a fold of something the run already asserts
        // about itself. A finding with no typed source folds to "unknown", which never blocks — a
        // preserved run older than the typed shape must not have its genuine finds turned into misses.
        evidence: evidenceClassOf(f.source?.source_type),
      })),
    };
  }
  // The knockout lane publishes its own shape: marks[] each with their own conflict list.
  const ko = readJson(join(runDir, "knockout-findings.json"));
  if (ko?.marks) {
    return {
      lane: "knockout",
      // — THE ROLL COMES OFF `marks`, NEVER OFF THE ROWS. `marks.name` is machine-gated:
      // validateMergedFindings (verify-knockout.mjs) checks it against the frozen plan and rejects both a
      // missing rating row and an invented mark. Derived from the findings instead, a mark that came back
      // with nothing would vanish from the per-mark fold — and a covered mark that came back clean would
      // then read identically to a mark that was never searched.
      subjects: ko.marks.map((m) => String(m.name ?? "").trim()).filter(Boolean),
      // — THE KNOCKOUT LANE PUBLISHES COMMON-LAW MATERIAL, BY CONSTRUCTION OF THE LANE.
      // Its finding rows carry no typed source at all: a `type` ("Active Business", "Famous Brand") that
      // is free model prose, and a `url`. The class is not missing by accident — the lane's register
      // component is a two-predicate count of the mark string and structurally cannot reach a register
      // family (, ruled and closed). Everything it PUBLISHES comes off the common-law screen.
      //
      // So the class is asserted here rather than guessed from `type`, and it is asserted in the
      // direction that cannot overstate recall: a register gold entry is never satisfied by a knockout
      // finding. Both this round's knockout false positives — a retail-and-app identity against a DE
      // registration, and a discussion thread against three US ones — are refused by exactly this line.
      //
      // If the knockout lane is ever given a real register retrieval seam, THIS is the line that must
      // change with it, and the register recall it reports until then is honestly zero rather than
      // accidentally nonzero.
      rows: ko.marks.flatMap((m) => (m.findings ?? []).map((f) => ({
        subject: String(m.name ?? "").trim() || null,
        // KNOCKOUT PROSE ARM 2026-08-06 — the typed record's rating word is `band`; the archived prose
        // row `{name, type, url, description, impact}` still carries `impact`, and score.mjs reads
        // PRESERVED runs of both shapes. Reading only `impact` ( removed it from
        // KNOCKOUT_FINDING_KEYS in favour of `band`) made every knockout row on today's shape carry a
        // null rating, and this bucket set is read to attribute a finding to a mark.
        //
        // — NO `ordinal` HERE, DELIBERATELY, THOUGH KNOCKOUT_FINDING_KEYS CARRIES ONE.
        // `matched_ordinal` is written only into `buckets.found`, and a knockout finding cannot reach
        // that bucket by three independent routes, any one of which is sufficient:
        //   · a counts-shaped reference makes scoreOne pass `reference: []`, so the entry loop that
        //     pushes `found` never runs at all;
        //   · a reference with no `counts` block is refused outright by referenceLaneMismatch, which
        //     dies before scoring — so there is no third kind of knockout run;
        //   · and the line below asserts `evidence: "common-law"`, which satisfiesReference refuses for
        //     a register entry by construction.
        // Carrying `matched_ordinal` would add a field computed and read by nothing, which is the exact
        // defect closes. (folded into) is the OTHER half and is now closed below: the
        // buckets a knockout finding DOES reach — `noise` and `additional` — recorded no ordinal either,
        // so on a knockout run no scored finding was identifiable at all. `ordinal` rides from here.
        //
        // NORMALIZED ON THE SAME PREDICATE THE SCORER GUARDS WITH, like band and mark beside it, and on
        // the same predicate the clearance map one branch up uses. KNOCKOUT_FINDING_KEYS declares
        // `ordinal` and findings-model validates it as an integer >= 1, so a null here means the archived
        // row genuinely carried none — never that this map could not see it.
        ordinal: Number.isInteger(f.ordinal) ? f.ordinal : null,
        mark: f.name ?? "", owner: null, band: f.band ?? f.impact ?? null, disposition: null,
        ruled_out: false, ruled_out_reason: null, evidence: "common-law",
      }))),
    };
  }
  return { lane: null, rows: [], subjects: null };
}

/**
 * Every label the run RETRIEVED — the corpus `withheld` is measured against.
 *
 * Two sources, unioned: the merged register band (what came back) and the recall reconciliation (the
 * positions and their endings). Either alone under-reports.
 */
function retrievedOf(runDir) {
  const out = new Map();
  // — OWNER AND QIDS ARE CARRIED, and each answers a different half of the acceptance.
  //
  // OWNER, for the script-lane target line: "the term was generated" is satisfied by ANY proprietor's
  // record of the same characters, while the finding R1 is named for belongs to one named company.
  // Without the owner the scorer cannot tell those apart, and a line that cannot is no proof about the
  // lane. `owner_name` is what the band already records.
  //
  // QIDS, for "what did the sub-query return": every band record carries the qid(s) of the slice(s)
  // that surfaced it, so a per-territory record count is a JOIN and not an estimate. `recordQids` is
  // the shipped union (first-seen `_qid` plus the merged `_qids`) — the same one record-carry.mjs
  // reads, so this count and the run's own provenance can never disagree.
  const add = (mark, record_id, owner, qids) => {
    const k = `${mark} ${record_id ?? ""}`;
    if (!mark) return;
    const prior = out.get(k);
    if (!prior) { out.set(k, { mark, record_id: record_id ?? null, owner: owner ?? null, qids: [...new Set(qids ?? [])] }); return; }
    for (const q of qids ?? []) if (!prior.qids.includes(q)) prior.qids.push(q);   // union across both sources
  };

  const band = readJson(join(runDir, "register-named-band.json"));
  for (const r of band?.enumerated ?? []) add(r.mark_text ?? "", r.record_id ?? null, r.owner_name ?? r.screen?.owner ?? null, recordQids(r));

  const recon = readJson(driverDir(runDir, "recall-reconciliation.json"));
  for (const r of [...(recon?.top_slice ?? []), ...(recon?.unended ?? [])]) add(r.mark_text ?? "", r.record_id ?? null, r.owner_name ?? null, recordQids(r));

  return [...out.values()];
}

/** What the run was INSTRUCTED to search — the run's own record, not the reference's wish. */
function scopeOf(runDir, ref) {
  const instructed = readJson(driverDir(runDir, "instructed-scope.json"));
  const cls = instructed?.classes ?? instructed?.nice_classes ?? null;
  const terr = instructed?.jurisdictions ?? instructed?.territories ?? null;
  return {
    classes: Array.isArray(cls) && cls.length ? cls.map(String) : (ref.scope?.classes ?? []).map(String),
    territories: Array.isArray(terr) && terr.length ? terr.map(String) : (ref.scope?.territories ?? []).map(String),
  };
}

/** Everything the run recorded about WHERE it searched, for the channel check. */
function searchedTextOf(runDir) {
  const parts = [];
  for (const f of ["_driver/plan-execution.json", "_driver/crowd-context.json", "_driver/register-plan.json"]) {
    parts.push(readText(join(runDir, f)));
  }
  // The grid ledgers carry the platform list actually swept, and there may be halves and supplements.
  try {
    for (const f of readdirSync(runDir)) if (/^common-law-grid.*\.json$/.test(f)) parts.push(readText(join(runDir, f)));
  } catch { /* no run dir listing — the caller already reported that */ }
  try {
    const d = driverDir(runDir);
    for (const f of readdirSync(d)) if (/^grid-spec.*\.json$/.test(f)) parts.push(readText(join(d, f)));
  } catch { /* no _driver — reported by the caller */ }
  return parts.join("\n");
}

/** Declared coverage gaps and their status, from the run's own decision ledger. */
function gapsOf(runDir) {
  const ledger = readJson(join(runDir, "scope-ledger.json"));
  const rows = Array.isArray(ledger) ? ledger : (ledger?.entries ?? ledger?.rows ?? []);
  return rows.filter((r) => r && (r.item || r.slice)).map((r) => ({
    item: r.item ?? r.slice, status: r.status ?? null, reason: r.reason ?? null,
  }));
}

/**
 * Is the run's verdict a clean one? Three-valued: null means the verdict could not be read, which is
 * NOT the same as "not clean" and must not be reported as though a gap were being held open on purpose.
 *
 * The read itself is pure and lives in reference-score.mjs, because WHICH artifact holds the verdict is
 * a property of the lane and the knockout lane writes no `_driver/verdict.json` at all. This
 * function's whole job is to hand over the documents.
 */
/**
 * — THE REVIEWER'S OWN VERDICT, which nothing outside the engine has ever read.
 *
 * `verdictIsCleanOf` above reads `_driver/verdict.json` — the CARRIED verdict, the label the run
 * shipped under. `senior-eye-review.md` is the reviewer's own answer, one file away in the same run
 * dir. On the run was filed on those two said CONDITIONAL and BLOCKING, and the scorer printed
 * only the first while the round report published that run as the round's improvement.
 *
 * Reads through `parseVerdict`, the function the engine already uses on this exact file, so the
 * scorer cannot come to disagree with the engine about what the review says.
 *
 * An absence is an ABSENCE. The knockout lane writes no review and a pool dir has no `_driver/`
 * — both print what is missing and why. Printing nothing, or printing agreement, is what let a
 * BLOCKING review sit unread beside a CONDITIONAL label.
 */
function reviewerVerdictOf(runDir) {
  const p = join(runDir, "senior-eye-review.md");
  if (!existsSync(p)) return { text: null, why: `no senior-eye-review.md in ${runDir}`, source: null };
  const md = readText(p);
  if (!md.trim()) return { text: null, why: "senior-eye-review.md is present but empty", source: "senior-eye-review.md" };
  const v = parseVerdict(md);
  return v
    ? { text: v, why: null, source: "senior-eye-review.md" }
    : { text: null, why: "senior-eye-review.md holds no parseable verdict in its opening lines", source: "senior-eye-review.md" };
}

/**
 * The CARRIED tier as a bare word, for comparison against the reviewer's.
 *
 * NOT `run.verdict.text`: that is a composite built for display — band, tier, statement and badge
 * joined with `·` — and `parseVerdict` returns null on it, because it neither leads with a verdict
 * word nor contains the word "verdict". Comparing the display string instead fires on every run ever
 * scored; parsing it fires on none. `verdict.json` records the tier as its own field, so read that.
 * The knockout lane writes no such file and answers null, which prints as an absence.
 */
function carriedTierOf(runDir) {
  const doc = readJson(driverDir(runDir, "verdict.json"));
  const v = String(doc?.verdict ?? "").trim().toUpperCase();
  return /^(CLEAR|CONDITIONAL|BLOCKING)$/.test(v) ? v : null;
}

function verdictIsCleanOf(runDir) {
  return readVerdict({
    verdictDoc: readJson(driverDir(runDir, "verdict.json")),
    knockoutFindings: readJson(join(runDir, "knockout-findings.json")),
    status: readJson(join(runDir, "status.json")),
  });
}

function readRun(runDir, ref) {
  if (!existsSync(runDir)) die(`no run directory at ${runDir}`);
  const hasDriver = existsSync(driverDir(runDir));
  const { lane, rows: findings, subjects } = findingsOf(runDir);
  if (!lane) die(`${runDir} holds neither findings.json nor knockout-findings.json — not a completed run.`);
  const verdict = verdictIsCleanOf(runDir);
  const scope = scopeOf(runDir, ref);
  // — the POOL's own record. `meta.json` is written by publish through writeRO,
  // whose target is the POOL run dir and nowhere else, so its presence means "this directory is a
  // published pool copy". It does NOT mean the run was delivered: pipeline.mjs writes
  // `state: "delivered"` AFTER publish returns, so a run can have a pool dir and never have settled.
  // That ordering is why the delivery verdict below declines rather than infers.
  const poolMeta = readJson(join(runDir, "meta.json"));
  // Carried separately from `deliveryState`, because "no status.json" and "a status.json with no
  // state field" are different absences and must not collapse into one branch.
  const hasStatus = existsSync(join(runDir, "status.json"));
  // — the pool copy's own terminal state, written at settle by the delivery
  // path. Null means UNKNOWN and never "not delivered": a run archived before the stamp existed has
  // none, and so does one whose best-effort write failed. deliveryLine() prints that distinction.
  const settle = readSettleStamp(runDir);
  return {
    dir: runDir, lane, hasDriver, hasStatus, poolMeta, settle, findings, subjects,
    // — from the RUN DIR's own status.json, which a failed or in-flight run has and a pool
    // meta.json only exists after publish. Null on any run scored before that stamp, and the printer
    // says so rather than leaving the line off: a missing instrument and a matching one must not read
    // the same.
    // — status.json first, then the pool's meta.json. Reading only status.json made
    // this line print "this run predates the status.json engine stamp" for every pool dir, which is a
    // WRONG claim rather than a missing one: the commit is right there in meta.json. Same absence, same
    // output block, as the delivery line below.
    engineCommit: engineCommitOf({ status: readJson(join(runDir, "status.json")), meta: poolMeta }).commit,
    engineCommitFrom: engineCommitOf({ status: readJson(join(runDir, "status.json")), meta: poolMeta }).from,
    // — WAS THE ORDER DELIVERED? Read from the same status.json, because a score is a statement
    // about a report and a report that was never signed is not one. A refusal after model work has
    // every artifact a delivered run has — narrative, findings, report cards — so nothing further down
    // this printout distinguishes them, and a reader who skims to the buckets reads a refused run's
    // recall as a delivered run's. `state` is the run's own word; `deliveredAt` is null unless it
    // actually settled, which is the difference between "reached delivery" and "was delivered".
    deliveryState: readJson(join(runDir, "status.json"))?.state ?? null,
    deliveredAt: readJson(join(runDir, "status.json"))?.deliveredAt ?? null,
    retrieved: hasDriver ? retrievedOf(runDir) : [],
    scopeClasses: scope.classes, scopeTerritories: scope.territories,
    searchedText: searchedTextOf(runDir),
    gaps: gapsOf(runDir),
    verdict,
    reviewerVerdict: reviewerVerdictOf(runDir),   // — printed beside `verdict:`, never merged into it
    carriedTier: carriedTierOf(runDir),
    // — the three machine records axis E and the script-lane line are folds over. Each may be null
    // (a pool dir has no `_driver/` at all), and every consumer below reports that absence by name
    // rather than as a zero. Read here so the scorer itself stays pure and offline.
    plan: readJson(driverDir(runDir, "register-plan.json")),
    execution: readJson(driverDir(runDir, "plan-execution.json")),
    jxLanes: readJson(driverDir(runDir, "jx-lanes.json")),
    // — the shadow units record their own health. A dead SERP credential degrades a UNIT, not the
    // candidate fold, so without this read that outage reaches no printed line anywhere.
    jxUnits: readJson(driverDir(runDir, "jx", "units.json")),
    // — the knockout lane's own answer. Read here, beside the others, and NEVER folded out of
    // findings: findings are what the lane rated, these are what it counted, and confusing the two is
    // the mismatch this issue exists to end. Either may be null and scoreCounts reports the absence by
    // name rather than as an in-range zero.
    registerCounts: readJson(driverDir(runDir, "register-counts.json")),
    registerRecords: readJson(driverDir(runDir, "register-records.json")),
  };
}

// ── scoring one run ──────────────────────────────────────────────────────────────────────────────────

function scoreOne(run, ref) {
  // ── — REFUSE THE PAIRING BEFORE SCORING IT ──────────────────────────────────────────────────
  //
  // A knockout graded against a similar-marks sheet scores a structural zero. It used to score it and
  // footnote every miss; a footnote under a headline nobody reads past is not a disclosure, and
  // "0/8 found · band Medium" has already been read as a broken product once.
  //
  // It dies rather than skipping, because a scenario silently absent from a scoreboard is the same
  // failure one layer up: the round completes, the number is missing, and nothing says why.
  const mismatch = referenceLaneMismatch({ lane: run.lane, ref });
  if (mismatch) die(`REFUSING TO SCORE ${run.dir}\n  ${mismatch}`);

  // A register-only lane has no gather/judgment seam to measure, and a run dir with no `_driver/` has
  // no retrieved corpus to look in. Both collapse `withheld` — and both must SAY they collapsed it,
  // rather than print `withheld: 0`, which reads as "nothing was dropped".
  const registerOnly = ref.register_only === true || run.lane === "knockout" || !run.hasDriver;
  // Two causes, two sentences. Which one it was decides where a reader looks next.
  const collapseReason = !run.hasDriver
    ? "withheld NOT COMPUTED — this run dir has no _driver/, so there was no retrieved corpus to look in"
    : "register-only run: no gather/judgment seam to measure";
  // — which of the marks this run searched does the reference answer. Read from the gold set's
  // `covers_marks` and NEVER inferred from its `mark` header, which is a display field: a lawyer writing
  // "CORAL FREEZE (and variants)" there would silently place the whole batch out of scope and print noise 0.
  const coverage = referenceCoverage({ coversMarks: ref.covers_marks ?? null, subjects: run.subjects });
  // — ON A COUNT-SHAPED KNOCKOUT, THE SIMILAR-MARKS SHEET IS NOT SCORED AT ALL.
  //
  // Refusing the unshaped pairing was only half of it. A gold set that gains a `counts` block usually
  // KEEPS its lawyer sheet — it is a real answer to a real matter and deleting it loses history — and
  // scoring both prints `LOST · TIKI PUNCH` beside the count that measures the product. That is the same
  // structural zero the issue is about, one row smaller, and it lands in the bucket table a reader
  // scans first.
  //
  // The recall pass still runs, because NOISE, ADDITIONAL and UNCOVERED are folds over the run's own
  // findings and stay meaningful — what a knockout surfaced is worth reading. Only the entries that
  // require retrieval are withheld from it.
  const countShaped = run.lane === "knockout" && (ref.counts ?? []).length > 0;
  const buckets = scoreRecall({
    reference: countShaped ? [] : ref.register, findings: run.findings, retrieved: run.retrieved,
    scopeClasses: run.scopeClasses, scopeTerritories: run.scopeTerritories, registerOnly, collapseReason, preAccepted: ref.pre_accepted ?? [],
    coverage,
  });
  return {
    registerOnly, collapseReason, coverage, buckets, countShaped,
    // — the knockout's own axis, read from the register sidecars the lane actually wrote. Null on
    // a reference with no `counts` block, which is every clearance scenario.
    counts: (ref.counts ?? []).length
      ? scoreCounts({ counts: ref.counts, registerCounts: run.registerCounts, registerRecords: run.registerRecords })
      : null,
    // A fold over the buckets above, never a second scoring pass — it cannot disagree with them.
    byMark: scoreByMark({ buckets, coverage, lane: run.lane }),
    field: scoreField({ reference: ref.register, findings: run.findings }),
    sources: scoreSources({ channels: ref.channels ?? [], searchedText: run.searchedText }),
    gaps: scoreGapDiscipline({ gaps: run.gaps, verdictIsClean: run.verdict.clean }),
    // — axis E folds the buckets ABOVE per territory, so it can never disagree with them about
    // which entry landed where. The script-lane line is the same fold narrowed to one entry.
    territories: scoreTerritories({
      buckets, scopeTerritories: run.scopeTerritories, retrieved: run.retrieved,
      plan: run.plan, execution: run.execution,
    }),
    scriptTargets: scoreScriptTargets({
      reference: ref.register, buckets, findings: run.findings, retrieved: run.retrieved,
      plan: run.plan, execution: run.execution, jxLanes: run.jxLanes, jxUnits: run.jxUnits,
    }),
  };
}

// ── output ───────────────────────────────────────────────────────────────────────────────────────────

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const row = (a, b, c = "") => `  ${String(a).padEnd(11)} ${String(b).padEnd(9)} ${c}`;

function print(id, ref, run, s, delta, refPath) {
  const B = s.buckets;
  const scored = B.found.length + B.withheld.length + B.lost.length;

  console.log(`\n${"═".repeat(78)}`);
  console.log(`${id} — ${ref.mark ?? "(mark unnamed in the reference)"}`);
  console.log(`reference: ${refPath}`);
  console.log(`           ${ref.source}`);
  console.log(`run:       ${run.dir}`);
  // — THE FIRST THING A READER SEES, and it is not a bucket. Owner's rule, 2026-08-25: a refusal
  // after model work is never reported as a pass. Five R2 rounds in seven days refused at the verdict
  // stage having written a full narrative and every report card; scored, they print recall figures that
  // describe prose nobody signed. So the delivery answer leads, and a run that did not deliver is named
  // a FAILED ORDER in the words a reader already uses for one.
  //
  // — FOUR states, because there are four. This line used to have two, and read a
  // MISSING status.json as a refusal: every archived run scored as THE ORDER WAS REFUSED, printed above
  // correct numbers, because the pool preserves neither status.json (0 of 25 dirs) nor _driver/ (0 of
  // 28). The tool already had the honest pattern four lines down — `withheld` names what it could not
  // read and declines to answer — and the delivery line invented a verdict from the same kind of
  // absence. This is that asymmetry closed, in the direction of the honest half.
  console.log(deliveryLine(run));
  // — THE INSTRUMENT, BESIDE THE NUMBER. `--json` has carried `scorer_version` since this file
  // shipped; the human path did not, and the human path is the one whose numbers get pasted into an
  // issue. 's body states 6/9 for a run that re-scores 5/2/2 today across two scorer changes
  // (`fd9938ce`, `212cdf73`), so every delta quoted from it crosses an unmarked boundary. A number a
  // reader can carry away must carry the instrument with it.
  //
  // The RUN's engine commit is stamped in its own status.json ( part 1) — printed here when the
  // run dir has one, and named as absent when it does not, because a run scored before that stamp is
  // exactly the case a reader must not mistake for a run that agrees with this one.
  console.log(`engine:    ${run.engineCommit
    ? `${run.engineCommit.slice(0, 12)}${run.engineCommitFrom === "meta.json" ? "   (from the pool's meta.json — this dir has no status.json)" : ""}`
    : "(not recorded — no status.json engine stamp and no pool meta.json carrying one)"}`);
  console.log(`scorer:    v${SCORER_VERSION}   (a score with no version predates this stamp and is not comparable to one)`);
  console.log(`lane:      ${run.lane}${run.hasDriver ? "" : "   (no _driver/ — pool dir, not a workspace archive)"}`);
  console.log(`scope:     classes ${run.scopeClasses.join(", ") || "(none recorded)"}   territories ${run.scopeTerritories.join(", ") || "(none recorded)"}`);
  // — WHICH SUBJECT MARKS THIS REFERENCE ANSWERS, on the line beside the classes and territories it
  // already scopes by, because it is the same kind of fact. Never silent: a gold set that declares
  // nothing says NOT DECLARED and names the marks the run searched.
  console.log(`coverage:  ${s.coverage.state} — ${s.coverage.why}`);
  // Never a bare "(unreadable)". An unread verdict is an absence, and an absence that prints as an empty
  // parenthesis is the one a reader skims past — so it states the reason, and where a reading DID come
  // from it names the artifact, because the two lanes answer this from different files.
  console.log(`verdict:   ${run.verdict.text ?? `NOT READABLE — ${run.verdict.why}`}`);
  if (run.verdict.source) console.log(`           read from ${run.verdict.source}`);
  // — TWO LABELLED VALUES, NEVER ONE RECONCILED ONE. `verdict:` is the label the run shipped
  // under; `reviewer:` is what the reviewer actually wrote. They are different questions and a scorer
  // that merged them would answer neither.
  const rv = run.reviewerVerdict ?? { text: null, why: "not read" };
  console.log(`reviewer:  ${rv.text ?? `NOT READABLE — ${rv.why}`}`);
  // At the volume the bucket-collision warning uses. A reader skimming for recall numbers must not have
  // to notice this: on the run that motivated it, `verdict: CONDITIONAL` sat beside a BLOCKING review
  // and the round published the run as an improvement.
  // COMPARE THE TIERS, not the strings. The carried `verdict.text` is a composite — band, tier and the
  // conditions in one line — so a string comparison against a bare `BLOCKING` differs on every run ever
  // scored, and a warning that always fires is one nobody reads. Both sides go through `parseVerdict`,
  // the engine's own reader, so the scorer cannot disagree with the engine about either value.
  const carriedTier = run.carriedTier;
  if (rv.text && carriedTier && rv.text !== carriedTier) {
    console.log(`\n  *** VERDICT DISAGREEMENT — the run shipped as ${carriedTier} and its reviewer wrote ${rv.text}.`);
    console.log("      These are the same run's own two answers. Do not read the buckets below as a");
    console.log("      measurement of a report anyone should have shipped until this is resolved.");
  }

  // ── — THE KNOCKOUT'S OWN AXIS ────────────────────────────────────────────────────────────────
  //
  // Printed BEFORE the bucket rows, because on a count-shaped scenario this is the score and the buckets
  // are the supporting detail. A reader who stops after the first screen should stop having read the
  // number that measures the product that ran.
  if (s.counts) {
    console.log(`\n── counts ${"─".repeat(67)}`);
    if (s.counts.missingArtifact) console.log(`  *** ${s.counts.missingArtifact}`);
    console.log(row("mark", "counted", "expected — the narrow question a knockout answers"));
    for (const c of s.counts.rows) {
      const want = c.range
        ? `expected ${Number.isFinite(c.range.min) ? c.range.min : "—"}..${Number.isFinite(c.range.max) ? c.range.max : "—"}`
        : "no range declared";
      const verdict = { "in-range": "", "below-range": "  *** BELOW", "above-range": "  *** ABOVE",
        "not-counted": `  *** NOT COUNTED — ${c.why ?? "no figure"}` }[c.state] ?? "";
      console.log(row(c.mark, c.counted ?? "—", `${want}${verdict}`));
      // The recall signal. A count in range proves the lane answered; it does not prove the lane still
      // generates the variant forms, and "CORALFREEZE no longer caught" is the regression this axis was
      // built for. A form absent from the run's own terms list was never ASKED, which is a different
      // fact from asked-and-answered-zero and the one worth going red over.
      const uncounted = c.variations.filter((v) => !v.counted);
      if (c.variations.length) {
        console.log(row("", "", `close variations counted: ${c.variations.length - uncounted.length}/${c.variations.length}`));
        if (uncounted.length)
          console.log(row("", "", `*** NEVER PUT TO THE REGISTER: ${uncounted.map((v) => v.form).join(", ")}`));
      }
    }
  }

  console.log(`\n── buckets ${"─".repeat(66)}`);
  // — never a silent omission. The sheet exists, it was deliberately not scored, and a reader who
  // remembers R3 having eight reference marks must be told where they went rather than left to wonder.
  if (s.countShaped) {
    console.log(`  the reference's ${(ref.register ?? []).length}-mark similar-marks sheet is NOT scored here — a knockout`);
    console.log(`  counts the exact mark and its close variations and never retrieves similar marks, so those`);
    console.log(`  entries are unreachable by construction. The counts axis above is this scenario's score.`);
    console.log(`  What follows folds over the run's OWN findings only.\n`);
  }
  console.log(row("bucket", "n", "of the marks the lawyer named"));
  console.log(row("found", B.found.length, `${pct(B.found.length, scored)} of ${scored} in-scope reference marks`));
  if (s.registerOnly) {
    // ONE source for the reason, so the summary and the rows can never name different causes. Missing
    // `_driver/` wins over register-only when both are true: it is the fixable one — point the tool at the
    // workspace archive instead of the pool — and the lane fact is visible on the `lane:` line anyway.
    console.log(row("withheld", "n/a", s.collapseReason));
  } else {
    // — THE SCOPE ON THE LINE, not in a footnote. `role-e2e` calls this "the bucket that changes
    // what you fix", so a bare `0` beside that sentence reads as "no seam defect this round" — and on
    // the round that measured it, two live in-class rights the run retrieved and dropped were outside
    // the reference and could not have raised it. The footnote saying `withheld` is a reference-entry
    // bucket was accurate and one screenful away from the number it qualifies.
    // The SAME reference the buckets were scored against — `s.countShaped` is the flag the scorer
    // already carries for it. Re-deriving it here is how the row and the buckets would come to disagree
    // about what was measured, which is the defect this line exists to prevent, one level in.
    const ws = withheldScope({ reference: s.countShaped ? [] : ref.register, retrieved: run.retrieved });
    console.log(row("withheld", B.withheld.length,
      `retrieved by this run, then dropped before the findings — ${ws.note}`));
  }
  // ── `lost` DECLINES FOR THE SAME REASON `withheld` DOES ────────────────────
  //
  // `withheld` says "NOT COMPUTED" on a dir with no `_driver/`. `lost` inherited the same blindness and
  // answered anyway, and the marks it could not classify fell into it SILENTLY.
  //
  // The mechanism is four hundred lines up and is not a guess: `readRun` sets `retrieved: hasDriver ?
  // retrievedOf(runDir) : []`. With an empty retrieved corpus NOTHING can be classified as withheld, so
  // every withheld mark lands in `lost` — and `lost` printed the sum as though it were a measurement.
  //
  // Measured on the delivered R14 run, one scorer, two directories: `lost` is 3 from the workspace
  // archive and 5 from the pool copy. The two that move are withheld from the archive and invisible
  // inside `lost` from the pool. A reader scoring the pool sees five never-retrieved marks and goes
  // looking for a retrieval problem; the truth is three retrieval failures and two seam failures, which
  // are different defects with different owners.
  //
  // GATED ON `hasDriver`, NEVER ON `registerOnly`. That flag has three causes and only this one makes
  // `lost` unsound: a register-only or knockout run WITH a `_driver/` has a retrieved corpus and its
  // `lost` is a real measurement. Declining there would hide a number that is correct.
  //
  // And the count is not repaired by inferring the withheld pair some other way — there is no `_driver/`
  // to infer from, which is the premise. A number that happens to be right for a reason the code cannot
  // justify is the same defect wearing the correct answer.
  if (!run.hasDriver) {
    console.log(row("lost", "n/a",
      "lost NOT COMPUTED — this run dir has no _driver/, so a mark this run retrieved and then dropped "
      + "cannot be told apart from one it never retrieved. Score the workspace archive for this bucket"));
  } else {
    console.log(row("lost", B.lost.length, "never retrieved"));
  }
  console.log(row("excluded", B.excluded.length, "reference classes/territories this scenario does not run"));
  console.log(row("additional", B.additional.length, "pre-accepted by the client — a correct find, never noise"));
  console.log(row("noise", B.noise.length, "surfaced, not in the reference — assess, do not assume wrong"));
  console.log(row("uncovered", B.uncovered.length, "surfaced for a mark this reference does not answer — not a miss, not noise"));

  // — the measure the buckets above cannot make. Every bucket here is built from REFERENCE
  // entries, so a mark this run retrieved and then dropped raises `withheld` only if the lawyer's list
  // happens to name it. On R2 `ed1d7248` the reviewer returned BLOCKING on two dropped rights and this
  // scorer printed `withheld 0`; both were correct, and nothing measured the rest of the seam. What
  // follows is built from the run's own corpus and shares no scope with anything above it.
  console.log();
  console.log(renderCarryThrough(run.dir, { indent: "  " }).lines.join("\n"));

  // — a record in two buckets is a defect in THIS TOOL, and it is printed as loudly as any score.
  // Silence here is what let `DELPHI GENETICS` sit in LOST and `DG DELPHI GENETICS` in NOISE on the same
  // page, and the recall number that reached the round handover was wrong for a week because nobody
  // reads two lists against each other.
  if (B.collisions?.length) {
    console.log(`\n  *** BUCKET COLLISION (${B.collisions.length}) — this scorer is contradicting itself; do not read the recall numbers above until these are resolved`);
    for (const c of B.collisions)
      console.log(`    · ${c.owner}: reference "${c.entry}" is ${c.bucket}, surfaced "${c.noise}" is noise`);
  }

  for (const [name, label] of [["withheld", "WITHHELD — in this run's own records, absent from its findings"],
                               ["lost", "LOST — never retrieved"],
                               ["excluded", "EXCLUDED — out of this scenario's classes or territories, not a miss"],
                               ["additional", "ADDITIONAL — pre-accepted by the client. Surfacing it is correct"],
                               ["noise", "NOISE — not in the reference. May be a genuine find"],
                               // — the ROWS, not only the count. A count with no names cannot be
                               // checked, and the whole acceptance is that a reader can see which mark
                               // a finding belongs to without opening knockout-findings.json.
                               ["uncovered", "UNCOVERED — the mark it belongs to is not one this reference answers. Out of its scope, not a miss"]]) {
    const rows = B[name];
    if (!rows.length) continue;
    console.log(`\n  ${label}`);
    for (const r of rows) {
      // `r.subject` is the mark the batch was searching — the attribution this whole section is read for.
      const bits = [r.mark ?? r.name, r.subject, r.owner, r.record ?? r.record_id, r.lawyer_risk, r.why]
        .filter(Boolean).map(cell);
      console.log(`    · ${bits.join("  ·  ")}`);
    }
  }
  if (B.found.length) {
    console.log(`\n  FOUND`);
    for (const r of B.found) console.log(`    · ${r.mark}${r.matched !== r.mark ? `  →  matched "${r.matched}" on ${r.rule}` : ""}`);
  }

  // ── · by mark ─────────────────────────────────────────────────────────────────────────────
  // A batch searches several subject marks; the buckets above are one flat set. This is that set folded
  // per subject, so "which mark surfaced this" is answered on the page rather than by opening
  // knockout-findings.json. `—` is NOT 0: an uncovered mark's findings were never measured against the
  // reference, and a 0 there would say they were and came back clean.
  const M = s.byMark;
  console.log(`\n── by mark ${"─".repeat(66)}`);
  if (!M.rows) console.log(`  ${M.absent}`);
  else {
    console.log(`  ${"mark".padEnd(24)} ${"coverage".padEnd(30)} ${"found".padEnd(7)} ${"add'l".padEnd(7)} ${"noise".padEnd(7)} uncovered`);
    for (const r of M.rows) {
      const n = (v) => (v === null ? "—" : String(v.length));
      console.log(`  ${String(r.subject).padEnd(24)} ${String(r.coverage).padEnd(30)} ${n(r.found).padEnd(7)} ${n(r.additional).padEnd(7)} ${n(r.noise).padEnd(7)} ${n(r.uncovered)}`);
    }
    if (!M.rows.length) console.log(`  the run published an empty subject roll — no mark to fold over`);
  }
  for (const note of M.notes) console.log(`  ${note}`);

  console.log(`\n── axis B · field ${"─".repeat(59)}`);
  if (!s.field.length) console.log("  the reference flags no entry as on-field — not scored, not passed");
  for (const f of s.field) console.log(`  ${String(f.state).padEnd(12)} ${f.mark}  —  ${f.detail}`);

  console.log(`\n── axis C · sources ${"─".repeat(57)}`);
  if (!s.sources.length) console.log("  the reference names no channels — not scored, not passed");
  for (const c of s.sources) console.log(`  ${(c.searched ? "searched" : "ABSENT").padEnd(12)} ${c.channel}`);

  console.log(`\n── axis D · gap discipline ${"─".repeat(50)}`);
  console.log(`  ${s.gaps.state}${s.gaps.state === "none-declared" ? "  (a fact about the run, not a pass)" : ""}`);
  for (const g of s.gaps.rows) console.log(`  ${String(g.state).padEnd(20)} ${g.item}  —  ${g.status ?? "no status"}`);

  // ── axis E · per-territory depth ────────────────────────────────────────────────────────
  // The question this section exists to answer: does jurisdiction deep-dive depth hold across every
  // instructed territory, or does the lane thin out as the count rises. Read `sub-query` first, then
  // `returned` — a sub-query that ran and came back over the provider's ceiling is not depth holding.
  const T = s.territories;
  console.log(`\n── axis E · per-territory depth ${"─".repeat(45)}`);
  if (!T.subQueriesResolved) console.log(`  sub-queries NOT MEASURABLE — ${T.why}`);
  console.log(`  ${"territory".padEnd(10)} ${"sub-query".padEnd(22)} ${"own".padEnd(4)} ${"grouped".padEnd(8)} ${"returned".padEnd(9)} ${"recall".padEnd(7)} reference entries`);
  for (const r of T.rows) {
    // `—` for recall is deliberate and is the whole design point of this row: a territory whose
    // reference carries nothing to score prints NEITHER 0% (which reads as total failure) NOR 100%
    // (which reads as a clean sweep). Both are conclusions the data does not support.
    const recall = r.recall ?? "—";
    // Same rule one column left: `—` where no sub-query ran (nothing to attribute), and `not attributable`
    // where one ran but the corpus carries no provenance. Neither is 0, which would say it came back empty.
    const returned = !r.returned ? "—" : (r.returned.records === null ? "?" : `${r.returned.records} rec`);
    const detail = r.state === "no-reference-entries"
      ? "no in-scope reference entry — nothing to score here, which is not a pass and not a failure"
      : [`found ${r.entries.found.length}`, `withheld ${r.entries.withheld.length}`, `lost ${r.entries.lost.length}`,
         r.entries.excluded.length ? `excluded ${r.entries.excluded.length}` : null].filter(Boolean).join(", ");
    const also = [
      r.instructedAs.length > 1 ? `  [instructed as ${r.instructedAs.join(", ")} — one office, one row]` : "",
      // The plan's own words for why no entry names this territory. Without it, `not-in-plan` sends the
      // reader looking for a plan bug over a coverage gap the plan already disclosed.
      r.notCoveredReason ? `  [the plan defers this jurisdiction: ${r.notCoveredReason}]` : "",
    ].join("");
    console.log(`  ${r.territory.padEnd(10)} ${r.subQuery.padEnd(22)} ${String(r.own.executed).padEnd(4)} ${String(r.grouped.executed).padEnd(8)} ${returned.padEnd(9)} ${recall.padEnd(7)} ${detail}${also}`);
  }
  console.log(`  ${"—".padEnd(10)} ${"unrestricted".padEnd(22)} ${String(T.unrestricted.executed).padEnd(4)} ${"".padEnd(8)} ${"".padEnd(9)} ${"—".padEnd(7)} executed queries with no region clause: reach every territory, name none`);
  console.log(`  ${"intl".padEnd(10)} ${"n/a".padEnd(22)} ${"—".padEnd(4)} ${"—".padEnd(8)} ${"—".padEnd(9)} ${String(T.portfolioWide.recall ?? "—").padEnd(7)} ${T.portfolioWide.note}`);
  if (T.outsideScope.length) console.log(`  ${T.outsideScope.length} reference entr${T.outsideScope.length === 1 ? "y names a territory" : "ies name territories"} outside the run's scope — see EXCLUDED above`);
  console.log(`  own = sub-queries naming ONE territory and nothing else. grouped = the worldwide sweep and every`);
  console.log(`  region chunk of it: it reaches the territory, it does not deep-dive into it.`);

  for (const r of T.rows) {
    // WHAT EACH SUB-QUERY RETURNED — acceptance item 1's second part, and the reason the receipt's
    // per-query `state` is carried at all. `incomplete` means the slice hit the provider's result
    // ceiling: the band is a descriptor of a crowd, not the whole answer, and a deep-dive that
    // ceilinged out must never print the same as one that enumerated.
    if (!r.own.queries.length) continue;
    console.log(`\n  ${r.territory} — its own sub-queries`);
    for (const q of r.own.queries) {
      const what = q.outcome === "executed" ? `returned ${q.state || "(the receipt states no state)"}` : q.outcome;
      console.log(`    · ${String(what).padEnd(24)} ${[q.qid, q.term, q.detail].filter(Boolean).map(cell).join("  ·  ")}`);
    }
    if (r.returned?.records !== null && r.returned) console.log(`    ${r.returned.records} retrieved record(s) carry one of these qids`);
    if (r.returned?.why) console.log(`    ${r.returned.why}`);
  }

  for (const r of T.rows) {
    // EVERY bucket, NAMED — acceptance item 1's third part. A found count with no names cannot be
    // checked against the gold set by the person reading it, and "3 found" is the shape that hides
    // which three. `matched` is printed whenever it differs from the reference label, because the row
    // would otherwise pair the reference's OWNER with a run RECORD ID as though the run had retrieved
    // that proprietor's registration — on a script mark the match rule is containment, so the record
    // can be a longer mark owned by somebody else entirely.
    const rows = [...r.entries.found.map((x) => ["found", x]), ...r.entries.withheld.map((x) => ["withheld", x]),
      ...r.entries.lost.map((x) => ["lost", x])];
    if (!rows.length) continue;
    console.log(`\n  ${r.territory} — the reference's entries, by bucket`);
    for (const [b, x] of rows) {
      const label = x.mark ?? x.name;
      const matched = x.matched && String(x.matched) !== String(label) ? `→ matched "${x.matched}"` : null;
      console.log(`    · ${String(b).padEnd(9)} ${[label, x.owner, matched, x.record, x.rule, x.lawyer_risk].filter(Boolean).map(cell).join("  ·  ")}`);
    }
  }
  console.log(`\n  CONCLUSION: ${T.conclusion.sentence}`);

  // ── the script-lane target ──────────────────────────────────────────────────────────────
  // The entry no Latin-variant sweep can reach — R1's whole reason for existing. Derived from the
  // reference (the mark carries a run of non-Latin letters), never from a literal character, because an
  // acceptance keyed on a literal character is what put a bad transcription into a spec once already.
  console.log(`\n── script-lane target ${"─".repeat(55)}`);
  const ST = s.scriptTargets;
  // THREE cases, three lines. A file that exists and declares no lane is not the file being absent, and
  // printing nothing for it collapses the two into one silence.
  if (!ST.lane.present || !ST.lane.lanes.length) console.log(`  lane: ${ST.lane.why}`);
  for (const l of ST.lane.lanes) {
    // a degraded lane NAMES its cause on the same line — "degraded=true" alone sends the reader to the
    // artifact to find out what broke, and the cause is already in hand
    const why = l.degraded === true ? ` — ${l.degradedCause ?? "cause not recorded"}` : "";
    // — `depth=` IS GONE FROM THIS ROW, and the replacement is the whole point of the issue. The
    // old cell printed the frozen `jxPolicy.laneDepth` ask inside an execution row, one column from
    // `executes`, so `depth=full` read as "the deep lane ran" on a deployment where the deep slices
    // were never armed. Nothing gates on that field; a profile set to `full` on an unarmed box and one
    // set to `candidates` on an armed box execute identically and the row said the opposite.
    //
    // Now: `asked=` and `ran=` side by side, and — per the owner's ruling, flag rather than gate — a
    // LOUD marker when the ask was not met, carrying the cause on the same line so the reader is not
    // sent to the artifact to find out which switch was off (the rule for degradedCause, applied
    // to the field beside it). An unrecorded verdict prints as unrecorded: a pre- artifact cannot
    // answer this and must not look like a lane that met its ask.
    // `(not stated)` and `(not established)` are DIFFERENT cells and the row keeps them apart, in the
    // vocabulary it already uses one column over: `not stated` = this artifact never answered the
    // question (a pre- run), `not established` = it answered and the answer is that its own record
    // cannot settle what ran. Neither is `candidates`, and neither may read as a met ask.
    //
    // THE REASON DOES NOT GO IN THE CELL. A row is a row: the first cut interpolated the verdict's whole
    // `why` sentence here and produced a 300-character line that no longer read as a table. The reason
    // rides the shortfall marker, where a reader is already being asked to stop.
    const v = l.depthVerdict ?? null;
    const ranCell = !v || !v.recorded ? "(not stated)" : (v.ran ?? "(not established)");
    const depthCell = `asked=${(v ? v.asked : l.depth) ?? "—"}  ran=${ranCell}`;
    const shortfall = v?.recorded && v.shortfall ? `  ⚠ ${String(v.cause ?? "shortfall").toUpperCase()} — ${v.why ?? "no reason recorded"}` : "";
    console.log(`  lane ${l.lane}: executes=${l.executes ?? "(not stated)"}  ${depthCell}  degraded=${l.degraded === null ? "(not stated)" : l.degraded}${why}  accepted=${l.accepted ?? "—"}  jurisdictions ${l.jurisdictions.join(", ") || "—"}${shortfall}`);
  }
  // — the RUN-level statement of which slices executed, on its own line because it is a fact about
  // the RUN and not about any one lane (the SERP grid is zh-only, so folding it into a lane row would
  // claim it for lanes it never touched). Absence is loud: a run that did not state it says so.
  if (ST.lane.present) {
    const slices = ST.lane.slices
      ? Object.entries(ST.lane.slices).map(([n, s]) => `${n}=${s.state}${s.state === "ran" ? "" : ` (${s.why ?? "no reason recorded"})`}`).join(" · ")
      : "";
    console.log(`  slices: ${ST.lane.statement ?? `(${ST.lane.statementWhy})`}${slices ? `   ${slices}` : ""}`);
  }
  // The SHADOW units, under their OWN names. SerpAPI is the grid unit's provider, not the
  // candidate fold's — so a dead credential belongs on this row, and folding it into the lane's
  // `degraded` would change what that field means. Same three cases, same three lines as the lane.
  if (!ST.units.present || !ST.units.units.length) console.log(`  unit: ${ST.units.why}`);
  for (const u of ST.units.units) {
    const uWhy = u.degraded === true ? ` — ${u.degradedCause ?? "cause not recorded"}` : "";
    console.log(`  unit ${u.key}: degraded=${u.degraded === null ? "(not stated)" : u.degraded}${uWhy}  attempts=${u.attempts ?? "—"}  done=${u.done}`);
  }
  if (!ST.targets.length) console.log(`  ${ST.note}`);
  for (const t of ST.targets) {
    console.log(`\n  ${t.mark}  —  reference owner: ${t.owner ?? "(the reference names none)"}${t.jurisdictions.length ? `  [${t.jurisdictions.join(", ")}]` : ""}`);
    if (t.segments.some((x) => x !== t.mark)) console.log(`    script segment:  ${t.segments.join(" · ")}  (the part of the label no Latin sweep reaches; anything else beside it is the lawyer's annotation)`);
    console.log(`    term generated:  ${t.generated}${t.why ? ` — ${t.why}` : ""}${t.queries.length ? `   (${t.queries.map((q) => `${q.qid}${q.executed ? "" : " NOT EXECUTED"}`).join(", ")})` : ""}`);
    console.log(`    recall bucket:   ${t.bucket ?? "not bucketed — the entry is not in the reference's register array"}`);
    console.log(`    records back:    ${t.records.length}`);
    for (const r of t.records.slice(0, 12)) console.log(`      · ${r.mark}  ·  ${r.owner ?? "(no owner recorded)"}  ·  ${r.record_id ?? r.side}${r.exact ? "" : "  (contains the target, is not it)"}`);
    if (t.records.length > 12) console.log(`      …and ${t.records.length - 12} more`);
    // The owner line is the one that decides whether the lane proved anything. `differs` NEVER reads
    // as a pass: it prints both sides so a human adjudicates, which a fuzzy match would prevent.
    console.log(`    owner:           ${t.ownerState}${t.ownerState === "differs" ? ` — the reference names ${t.owner}; what came back is ${t.ownersReturned.slice(0, 6).join(" / ")}` : ""}`);
  }

  console.log(`\n── delta ${"─".repeat(68)}`);
  if (!delta) console.log("  no previous run given (--previous <runDir>, or --previous auto for the other half of a pair) — nothing to compare");
  else if (!delta.length) console.log("  no bucket changed since the previous run");
  else for (const d of delta) console.log(`  ${d.mark}: ${d.from} → ${d.to}`);

  console.log(`\n${"═".repeat(78)}`);
  console.log(`This is a measurement, not a verdict. There is no PASS here and the exit code is always 0.`);
  console.log(`Reproducing the reference proves nothing — it is a regression tripwire, never a target.`);
  console.log(`What to read: every WITHHELD row is a gather-to-judgment seam defect, not a recall one.`);
  console.log(`Axis E: "own" counts sub-queries naming ONE territory and nothing else — the deep-dive itself.`);
  console.log(`A territory with no reference entry prints "—", never 0% and never 100%. Both are conclusions.`);
  // The instrument changed. A round comparing its noise against a round scored before `uncovered`
  // existed is comparing two different measurements, and the drop will otherwise read as an improvement.
  console.log(`"uncovered" is a finding of a mark this reference does not answer — a noise count from before`);
  console.log(`that bucket existed is not comparable with one after it. The gold set must declare covers_marks.\n`);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `usage: score.mjs <ID> --run <runDir> [--previous <runDir>|auto] [--json]`;

/**
 * `--previous auto` — the other half of the pair, resolved rather than typed.
 *
 * IT NEVER DEGRADES INTO "no previous run given". An `auto` that cannot resolve is an ABSENCE, and an
 * absence is a finding: it dies naming the rounds it did see, because a delta section silently missing
 * from a noise-floor comparison is the same defect this issue is about, one tool over.
 */
function resolvePreviousAuto(id, runDir) {
  const root = (process.env.CLEAROTRON_E2E_DIR ?? "").trim();
  if (!root) die(`--previous auto needs CLEAROTRON_E2E_DIR: the scenario's declared refs live in the config store,\n`
    + `  and without them there is no way to say which runs belong to this scenario's rounds.\n`
    + `  Pass --previous <runDir> to name the earlier run directly.`);
  const p = join(root, "scenarios", `${String(id).toUpperCase()}.json`);
  const sc = readJson(p);
  if (!sc) die(`--previous auto: no scenario at ${p}, so this run's refs cannot be resolved.`);
  const refs = scenarioRefs(sc);
  if (!refs.length) die(`--previous auto: ${p} declares no job ref, so no round of it can be identified.`);
  const workspaceRoot = envFrom(process.env, "CLEAROTRON_WORK_DIR") ?? "";
  if (!workspaceRoot) die(`--previous auto needs CLEAROTRON_WORK_DIR — the earlier round's run dir is found by\n`
    + `  walking the workspace archive. Unset means nothing was searched, which is NOT "there is no earlier round".\n`
    + `  Pass --previous <runDir> for a preserved run dir outside any workspace.`);
  const found = previousRunDir({ refs, workspaceRoot, runDir });
  if (found.error) die(`--previous auto could not resolve the earlier round of ${String(id).toUpperCase()}:\n  ${found.error}`);
  console.log(`--previous auto → ${found.dir}\n                  ${found.why}`);
  return found.dir;
}

// One pass, so a directory named like a flag's value can never be mistaken for the scenario id.
const opts = { json: false, run: null, previous: null, id: null };
for (let i = 0, a = process.argv.slice(2); i < a.length; i++) {
  if (a[i] === "--json") opts.json = true;
  else if (a[i] === "--run") opts.run = a[++i];
  else if (a[i] === "--previous") opts.previous = a[++i];
  else if (a[i].startsWith("--")) die(`unknown flag ${a[i]}\n${USAGE}`);
  else if (!opts.id) opts.id = a[i];
  else die(`unexpected argument "${a[i]}"\n${USAGE}`);
}

const { id } = opts;
if (!id || !opts.run) die(USAGE);
const runDir = opts.run;

const { ref, path: refPath } = loadReference(id);
const run = readRun(runDir, ref);
const scored = scoreOne(run, ref);

const previousDir = opts.previous === "auto" ? resolvePreviousAuto(id, runDir) : opts.previous;
const prev = previousDir ? scoreOne(readRun(previousDir, ref), ref) : null;
const delta = prev ? bucketDelta(scored.buckets, prev.buckets) : null;

if (opts.json) {
  console.log(JSON.stringify({
    // — the instrument that produced these numbers, so a reader comparing two archived scores can
    // tell whether the comparison is valid. A score with no `scorer_version` predates this stamp.
    scorer_version: SCORER_VERSION,
    // — the OTHER half of the same question. A consumer comparing two archived scores needs
    // both instruments: which scorer read the run, and which engine produced it.
    engine_commit: run.engineCommit,
    // — every declared assertion and control, with an outcome or an explicit "cannot evaluate".
    // Written unconditionally: an omitted assertion reads exactly like a passing one, which is the
    // state this closes.
    statements: scoreStatements({ assertions: ref?.assertions, controls: ref?.controls, buckets: scored.buckets }),
    scenario: String(id).toUpperCase(), reference: refPath, run: run.dir, lane: run.lane,
    scope_classes: run.scopeClasses, scope_territories: run.scopeTerritories, verdict: run.verdict.text, ...scored, delta,
    // — the same measure the human output prints, in the payload too. `--json` bypasses print,
    // so leaving it out would hide it from exactly the readers most likely to automate on it, and a
    // consumer would have no way to tell an absent measure from a clean one.
    carry_through: (() => { const ct = carryThrough(run.dir); return { ...ct, coverage: coverageConflicts(run.dir, ct.lost) }; })(),
  }, null, 2));
} else {
  print(String(id).toUpperCase(), ref, run, scored, delta, refPath);
  // — THE LAWYER'S OWN STATEMENTS OF WHAT THE RUN MUST DEMONSTRATE. The buckets cannot carry
  // these: an assertion says WHY a mark matters, and that reasoning is what tells a reader which lane to
  // fix. One `lost` row alone sent a diagnosis at the register lane for a mark that is register-invisible.
  const statements = scoreStatements({ assertions: ref?.assertions, controls: ref?.controls, buckets: scored.buckets });
  if (statements.length) {
    console.log(`\n  THE REFERENCE'S OWN ASSERTIONS AND CONTROLS (${statements.length}) — the scorer does not read English, so`);
    console.log("  these are the run's own facts about the marks each one names, never a verdict on the sentence:");
    for (const st of statements) {
      console.log(`\n    [${st.kind}] ${st.text}`);
      if (st.halves.length)
        for (const h of st.halves) console.log(`        ${h.mark} — ${h.state}`);
      if (st.why) console.log(`        UNEVALUATED: ${st.why}`);
    }
  } else if (ref) {
    // Absence, stated. A reference with no assertions and a reference the scorer failed to read are
    // different facts, and silence renders them the same.
    console.log("\n  THE REFERENCE DECLARES NO ASSERTIONS OR CONTROLS — nothing was skipped.");
  }
}

// Always 0. The exit code is not a verdict, and a caller that branches on it is reading a judgement
// this tool refuses to make. Nothing here blocks a merge, a deploy or a ship.
process.exit(0);
