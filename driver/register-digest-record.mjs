// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── REGISTER-DIGEST'S TYPED TRANSPORT — THE DOCUMENT BECOMES THE DRIVER'S ─────────────────────────
//
// Conversion 11, and the largest artifact in the run to move: `register-findings.md` is read by NINE
// parsers across driver/, mcp-server/ and driver/publish/, and every one of them is a heading / pipe-
// table / URI scanner. That is the whole argument for the conversion and it is worth stating plainly,
// because it inverts the usual worry about reader count: those parsers exist to TOLERATE a model's
// freeform prose. A driver render satisfies them by construction rather than by luck, so the reader
// count is what this conversion pays off, not what stands against it.
//
// WHAT THE SEAT STILL DECIDES IS UNCHANGED. Seven of the stage's twenty contract elements are
// judgment and all seven stay: the relevance gate, the opposition read, the coverage `status` and
// `reason` per row (which ride `record_coverage`, untouched), the rolled-up material-slice sentence,
// the instructed-check answers, and adopt-or-override on every placement. The stage remains, in its
// own contract's words, "the only relevance judge — the funnel pre-gated nothing". What moves is the
// TYPING, not the judging: thirteen mechanical elements the seat was retyping out of artifacts the
// driver already holds.
//
// ── WHY `seatWrites: false` AND NOT THE OWN-KEY SHAPE ─────────────────────────────────────────────
//
// register-unit took an own-key transport because its lane-OFF branch genuinely still hand-writes the
// named band, so taking `Write` away would break a live configuration. This stage has no such branch.
// It was believed to have one — a no-form arm that hand-wrote the `## Coverage ledger` table when no
// coverage form existed — and the belief came from the stage's own contract-elements table, which
// still carries a full entry for it. M6 DELETED that arm on 2026-08-14 (stages.mjs records the
// deletion at the site, and pipeline.mjs's runDigest says ALWAYS ARM, ALWAYS WRITE). The contract
// table is a register of DECISIONS, not an inventory of what exists, and its retired rows stay on
// purpose so the ruling survives — which makes it trustworthy about intent and silent about state.
// So: one `writeReturn`, one artifact, no surviving hand-write arm, and the writer goes.
//
// ── WHY IT KEEPS RETRIEVAL ────────────────────────────────────────────────────────────────────────
//
// `keepsRetrieval: true`, the mixed shape narrative-refutation and synthesis declare. This stage reads
// the frozen band through band_shape / band_lookup / band_record to judge it, and rating frozen
// material is what it reads WITH. The coverage transport stays on its own `coverage` key, unchanged
// and separate, for the reason that entry gives: one tool, one key, one holder.
//
// ── THE ACCEPTANCE BOUNDARY, AND WHAT IT REPLACES ─────────────────────────────────────────────────
//
// `validators.registerFindings`'s structural arm on a form run is `nonEmpty` plus one heading matching
// `\bfindings\b` — on an artifact the driver now writes, that is code checking its own render. The
// real checks move here, to the values as received, where a refusal names the row the seat can act on
// instead of a shape it cannot see. THE VALIDATOR IS NOT DELETED: archived runs were hand-written
// under the old dictation and must keep parsing. A new way in, never a replacement.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";

export const FINDINGS_FILE = "register-findings.md";
const SCHEMA_VERSION = 1;

/**
 * The driver's own facts sidecar for this document — the report-overview precedent, and chosen for the
 * same reason its comment gives: the facts arrive as an OPTION the driver writes, never as parameters
 * the seat can set, which is what stops the thirteen mechanical elements coming back in through the
 * tool. pipeline writes it before the digest dispatches.
 *
 * It carries a SLIM record index rather than pointing at the band, so this module needs to know
 * nothing about band internals and the same call decides the same way in a test and in a run.
 */
import { applyFates } from "./hit-list.mjs";   // — the digest marks the list

export const FACTS_FILE = "register-digest-facts.json";
/** — the slim hit list the digest marks; a projection of the merged band. */
export const HIT_LIST_FILE = "register-hit-list.json";

/**
 * The ERA STAMP for the accounting refusal, and it is a SEPARATE file from the facts on purpose.
 *
 * The rule: a record leaves a stage only with a recorded reason. Enforcing it means
 * refusing a call that accounts for fewer records than the run carried into this stage — which no
 * ARCHIVED run can satisfy, because the dictation that makes the seat account for them ships with the
 * check. So the refusal is armed by a receipt the driver writes, exactly as /M6 armed the coverage
 * form: a run carrying no stamp is judged as it always was, and its replay verdict does not move.
 *
 * WRITTEN BEFORE THE FACTS, and the order is the fail-closed leg. `writeRegisterDigestFacts` is
 * non-fatal, so if the facts write failed AFTER the stamp landed, the run reaches the seat with a stamp
 * saying accounting is required and no owed list to check against — which this module refuses by name as
 * a driver fault. Stamp second would mean a failed facts write silently DISARMS the rule, which is the
 * fail-open the 1955 design named as the arm most likely to be built wrong.
 */
export const ACCOUNTING_STAMP = "digest-accounting.json";

/** Is the per-record accounting refusal armed for this run? Absent ⇒ archived era ⇒ never refuse. */
export function accountingArmed(runDir) {
  return existsSync(driverDir(String(runDir ?? ""), ACCOUNTING_STAMP));
}

/**
 * The document's section headings, EXPORTED because three separate readers key on them and a heading
 * changed here without changing them is the failure this constant exists to make impossible.
 *
 * `negative` must keep matching placement-carry's NEGATIVE_HEADING_RE (/negative results?/i), which
 * also routes recall-reconciliation's `parseFindingsEndings` drop-row bucket and screen-gate's
 * `findScreenGateParseGaps`; `adjudication` must keep matching ADJUDICATION_HEADING_RE
 * (/disagreement resolutions?/i); `findings` must keep matching the registerFindings validator's
 * `\bfindings\b`; and `riskRelevant` / `incumbent` must keep matching audit-from-spine's
 * tablesUnder(/risk-relevant|watchlist/i). doubt-ledger's answerWatchlistLines scans any heading
 * matching /answer|watchlist/i, which is why the instructed-checks heading says "Answers".
 */
export const DIGEST_SECTIONS = Object.freeze({
  summary: "## Summary",
  findings: "## Findings",
  riskRelevant: "### Risk-relevant (orchestrator: Sheet 1 candidates)",
  incumbent: "### Incumbent-context (orchestrator: Sheet 2 candidates)",
  opposition: "### Opposition history (high-signal — captured verbatim)",
  merch: "### Cross-class merchandising sweep",
  negative: "### Negative results (orchestrator: Sheet \"Negative Results\")",
  auditTrail: "### Audit trail (orchestrator: Sheet \"Audit Trail\")",
  statusFilter: "### Status-filter summary",
  crossChecks: "### Cross-checks executed (Option D rules, cap N=10)",
  openFlags: "### Open verification flags",
  instructed: "### Answers to the instructed checks",
  adjudication: "### Disagreement resolutions",
});

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function registerDigestCallPaths(runDir) {
  const dir = driverDir(runDir, "register-digest-calls");
  return { dir, payload: join(dir, "call-001.json"), refusals: join(dir, "refusals.jsonl"), model: join(dir, "model.json") };
}

/**
 * Every record URI the seat recorded as a FINDING row, across this run's typed digest calls.
 *
 * — the INDEPENDENT population. The recall join's own population comes from the
 * reconciliation, and on one delivered clearance those two sets shared nothing at all: the join
 * examined a position the digest never ended as a finding and none of the nine it did, then reported
 * clean. This is the cross-check, and it is deliberately read from a different artifact by different
 * code — a cross-check derived from the same source as the thing it checks is not one.
 *
 * The field, not a URI-shape heuristic: `findings_rows` is what the recording tool was handed. Both
 * were tried against the archive and the field reproduces where a shape guess only approximates.
 *
 * Returns [] when the run has no calls directory — "nothing to compare" is the caller's to interpret,
 * and it is neither a pass nor a failure.
 */
export function recordedFindingUris(runDir) {
  const out = new Set();
  let names = [];
  try { names = readdirSync(registerDigestCallPaths(runDir).dir); }
  catch { return []; }   // no calls recorded on this run
  for (const name of names) {
    if (!/^call-\d+\.json$/.test(name)) continue;
    try {
      const doc = JSON.parse(readFileSync(join(registerDigestCallPaths(runDir).dir, name), "utf8"));
      for (const row of doc?.params?.findings_rows ?? []) {
        const uri = row?.uri ?? row?.record_id;
        if (uri) out.add(String(uri).toLowerCase());
      }
    } catch { /* one unreadable call must not blind the rest of them */ }
  }
  return [...out];
}

const str = (v) => String(v ?? "").trim();
const lc = (v) => str(v).toLowerCase();

// The Sheet-1 / Sheet-2 column shape, in the order audit-from-spine's parseTables reads them and
// anchor-reader's `col(row, "Owner")` / `col(row, "Classes")` look them up by NAME. The identifier
// cells are the driver's from here; only the last two are the seat's.
const FINDING_COLUMNS = Object.freeze(
  ["URI", "Mark", "Owner", "Country", "Classes", "Status", "Filed", "Expiry", "Flag reason", "Verify?"]);
// The Negative-results shape findScreenGateParseGaps indexes POSITIONALLY: cells[0] mark, cells[2]
// result, cells[3..] notes. It has no URI column by design — the URI rides Notes, and the gate keys on
// finding it there together with screen_verdict / class / status.
const NEGATIVE_COLUMNS = Object.freeze(["Mark", "Search Term / Variant", "Result", "Notes"]);

// ── THE FLOOR, AND WHAT ITS ZERO MEANS ────────────────────────────────────────────────────────────
//
// `validators.registerFindings` carried `nonEmpty(c)` with no character number, so there is no
// threshold to carry over and inventing one would be picking a new check on the way past a conversion.
// What IS carried is the question the floor was for: a findings document that surfaced nothing and
// dropped nothing has judged nothing. Measured on the ROWS, not the characters.
//
// BUT ASK WHAT THE ZERO MEANS — the same discipline M6 applied to the coverage form one artifact
// over, and the first cut of this floor got it wrong in exactly the way that ruling exists to prevent.
// A run whose band carries NO RECORDS has nothing to end, so zero rows is the complete and correct
// answer; `readCoverageFormInput` accepts a `skeleton: []` plan, so a run that executed nothing is
// reachable, and M6's own ruling for that run is a form DECLARING the absence rather than no artifact.
// A floor that refused it would refuse every call on such a run and the gateway would report a stage
// that tried and was refused — no findings document at all, where the ruling ships a declared one.
//
// So the floor is conditioned on the DRIVER's own count, never on the seat's payload alone: it fires
// when the band held records and the seat ended none of them, which is the defect it was written for.
// An empty band renders a declaration naming its cause, in the reader's own document.
const MIN_JUDGED_ROWS = 1;

/** A pipe row, cells escaped so a value carrying `|` cannot open a column. */
const row = (cells) => `| ${cells.map((c) => str(c).replace(/\|/g, "\\|").replace(/\n+/g, " ") || "—").join(" | ")} |`;
const table = (columns, rows) => [row(columns), `|${columns.map(() => "---").join("|")}|`, ...rows.map(row)].join("\n");

/**
 * The driver facts this render composes from — assembled by the CALLER, never by the seat.
 *
 * Every field here discharges one or more of the stage's thirteen mechanical contract elements, and
 * the mapping is stated so a field added without an element (or an element left without a field)
 * is visible rather than inferred:
 *   identity      → source attribution (pre-bound) + the document title
 *   recordsByUri  → the Sheet-1/Sheet-2 identifier cells + the Negative-results Notes cell
 *   recordHost    → the full clickable record URL (code-rendered)
 *   counts        → ## Summary counts (code-extracted)
 *   auditRows     → Audit trail (code-extracted)
 *   readIds       → the record ids read while answering each instructed check (code-extracted)
 *   positions     → the crowd row's counted denominator (code-rendered, via the coverage form)
 */
export function emptyFacts() {
  return { identity: {}, recordsByUri: new Map(), recordHost: "", counts: null, auditRows: [], readIds: [],
    positions: [], owed: null, armed: false };
}

/** The canonical join key both sides use. Band uris and seat-sent uris meet here and nowhere else. */
export const joinKey = (u) => lc(u).replace(/^https?:\/\/[^/]+/, "");

/**
 * The facts the driver holds for this render, read from its own sidecar.
 *
 * `emptyFacts()` when absent — an archived or replayed run has no sidecar, and the caller renders what
 * it holds. That degradation is deliberate and bounded: with no record index every seat-sent uri
 * refuses by name (`registerdigest_uri_unknown`) rather than rendering a row of blank identifier
 * cells, so a missing sidecar fails loud on the first call instead of shipping a hollow document.
 */
export function readDigestFacts(runDir) {
  let raw;
  try { raw = JSON.parse(readFileSync(driverDir(String(runDir ?? ""), FACTS_FILE), "utf8")); }
  // THE STAMP IS READ EVEN WHEN THE FACTS ARE NOT, and this line is the whole of the stamp-lands-first
  // ordering being worth anything. `emptyFacts()` hardcodes `armed:false`, so returning it bare made the
  // STAMPED-BUT-NO-FACTS state — the exact state that ordering exists to catch — unreachable: the call
  // came back `registerdigest_uri_unknown` (a seat defect) instead of `registerdigest_accounting_
  // unreadable` (a driver one), which are opposite repairs. Measured on a run dir with the stamp present
  // and the sidecar deleted, 2026-08-27.
  catch { const f = emptyFacts(); f.armed = accountingArmed(runDir); return f; }
  const facts = emptyFacts();
  facts.identity = raw?.identity ?? {};
  facts.recordHost = str(raw?.recordHost);
  facts.counts = Array.isArray(raw?.counts) && raw.counts.length ? raw.counts : null;
  facts.auditRows = Array.isArray(raw?.auditRows) ? raw.auditRows : [];
  facts.readIds = Array.isArray(raw?.readIds) ? raw.readIds : [];
  facts.positions = Array.isArray(raw?.positions) ? raw.positions : [];
  // The OWED set: every record placement carried into this stage. `null` (not `[]`) when the sidecar
  // carries none, because "the driver did not tell me" and "the driver told me none" are different
  // facts and only the second may be checked against.
  facts.owed = Array.isArray(raw?.owed) ? raw.owed.map(joinKey).filter(Boolean) : null;
  facts.armed = accountingArmed(runDir);
  for (const rec of Array.isArray(raw?.records) ? raw.records : []) {
    const key = joinKey(rec?.record_id ?? rec?.uri);
    if (key) facts.recordsByUri.set(key, rec);
  }
  return facts;
}

/**
 * A record's identifier cells, from the band record the driver already holds.
 *
 * Returns nulls for a record the band does not carry — the caller REFUSES on that rather than
 * rendering a row of dashes, because a Sheet-1 row whose identifiers are all blank is exactly the
 * silent recall loss the negative-results provenance rule exists to prevent, arriving through the
 * front door instead.
 */
export function identifierCells(rec, recordHost) {
  if (!rec) return null;
  const uri = str(rec.record_id ?? rec.uri ?? rec?.screen?.uri ?? rec.guid);
  // ── NO HOST MEANS NO URL, AND "NO URL" IS THE EMPTY STRING — NEVER THE PATH ──────────────────────
  //
  // This read `: uri`, so a provider that publishes no per-record page produced a `url` that was the
  // bare relative `/mark/<cc>/<id>` path. That is the exact reading the digest's own doctrine was
  // written to forbid — "compose nothing, and nothing has a spelling: the empty string. NOT the `uri`"
  // — and it burned a synthesis attempt when a seat did it. The conversion moved the composition from
  // the seat into this function and carried the defect across with it, which is the whole risk of
  // moving a rule from prose into code: the prose was deleted as satisfied while the code did the
  // thing it forbade. The record-URL guards caught it.
  //
  // The `uri` itself is untouched and still rendered — it is the record's identity and belongs in its
  // own column. What must not happen is a relative path presented where a resolvable link belongs.
  const url = recordHost && uri.startsWith("/") ? `${String(recordHost).replace(/\/+$/, "")}${uri}` : "";
  const classes = Array.isArray(rec.classes) ? rec.classes.join(", ") : str(rec.classes);
  const country = str(rec.owner_country ?? rec?.screen?.owner_country
    ?? (Array.isArray(rec.jurisdictions) ? rec.jurisdictions.join(", ") : rec.jurisdictions));
  return {
    uri, url,
    // Plain text when there is nothing to link to, so a reader is never handed a dead link.
    link: url ? `[${uri}](${url})` : uri,
    mark: str(rec.mark_text),
    owner: str(rec.owner_name),
    country,
    classes,
    status: str(rec.status ?? rec?.screen?.status),
    filed: str(rec.application_date ?? rec?.screen?.application_date),
    // NO FALLBACK TO registration_date. They are different facts and the column header says Expiry; a
    // registration date rendered under it is a wrong date in a lawyer's table, which is worse than an
    // empty cell that says the band does not carry one.
    expiry: str(rec.expiry_date),
  };
}

/** The screen's verdict, on record-carry's alias-tolerant read (band shapes differ by provider). */
const screenVerdictOf = (rec) => str(rec?.screen?.screen_verdict ?? rec?.screen_verdict ?? rec?.screen?.verdict);

/**
 * Render the findings document.
 *
 * DRIVEN BY THE CONSUMER LIST, not by this file's own reader — conversion 3's finding. The shape below
 * is what parseFindingsEndings, parseCarrySurfaces, findScreenGateParseGaps, answerWatchlistLines,
 * anchor-reader's parseTables and audit-from-spine's parseSpineFindingBlocks read, and DIGEST_SECTIONS
 * above says which heading each of them keys on.
 *
 * The `## Coverage ledger` section is NOT rendered here. It is the coverage form's, spliced by
 * pipeline's renderCoverageLedgerFromForm after every digest pass — the conversion, which already
 * moved that section to the driver and which this one does not disturb. Same for the document-coverage
 * sentence. Both splices REPLACE their section and are idempotent, so they compose with a
 * document this function rewrites from scratch on every pass. PURE.
 */
export function renderRegisterFindings(model, facts = emptyFacts()) {
  const id = facts.identity ?? {};
  const out = [];
  const title = [str(id.mark) || "the applied-for mark",
    [str(id.date), str(id.provider) ? `provider: ${id.provider}` : ""].filter(Boolean).join(", ")]
    .filter(Boolean);
  out.push(`# Register findings — ${title[0]}${title[1] ? ` (${title[1]})` : ""}`, "");

  // ## Summary — every count is the driver's arithmetic over its own receipts. The seat sends none.
  if (facts.counts) {
    out.push(DIGEST_SECTIONS.summary, "");
    for (const [label, value] of facts.counts) out.push(`- ${label}: ${value}`);
    out.push("");
  }

  out.push(`${DIGEST_SECTIONS.findings} — Mark: ${str(id.mark) || "(unnamed)"}`, "");

  const findingRow = (r) => {
    const c = r.cells;
    return [c.link, c.mark, c.owner, c.country, c.classes, c.status, c.filed, c.expiry, r.flag_reason, r.verify];
  };
  out.push(DIGEST_SECTIONS.riskRelevant, "");
  // A DECLARED ABSENCE IS RENDERED, NOT SKIPPED — renderCoverageLedgerFromForm's own rule, applied to
  // the document beside it: a reader cannot tell a missing section from a run that swept everything and
  // had nothing to say, so the empty-band case says which it is, in the section a lawyer opens.
  out.push(model.band_empty
    ? "_This run's register band carries no records, so no position could earn a row and none could be dropped. This is a declared absence of findings, not a clean result: no coverage claim is made here._"
    : model.findings_rows.length ? table(FINDING_COLUMNS, model.findings_rows.map(findingRow))
      : "_No position earned a Sheet-1 row._", "");
  if (model.incumbent_rows.length) {
    out.push(DIGEST_SECTIONS.incumbent, "", table(FINDING_COLUMNS, model.incumbent_rows.map(findingRow)), "");
  }
  for (const [heading, body] of [[DIGEST_SECTIONS.opposition, model.opposition], [DIGEST_SECTIONS.merch, model.merch_sweep]])
    if (body) out.push(heading, "", body, "");

  // ### Negative results — the drop DECISION and its one-line why are the seat's; the Notes cell's
  // four provenance fields are the band's, assembled here so the acceptance gate is checking the
  // driver's own read of the record rather than the seat's retyping of it.
  out.push(DIGEST_SECTIONS.negative, "");
  out.push(model.negative_rows.length
    ? table(NEGATIVE_COLUMNS, model.negative_rows.map((r) => [
      r.cells.mark, r.variant || r.cells.mark, r.drop_reason,
      [`URI ${r.cells.uri}`, r.screen_verdict ? `screen_verdict=${r.screen_verdict}` : "",
        r.cells.classes ? `class=${r.cells.classes}` : "", r.cells.status ? `status=${r.cells.status}` : ""]
        .filter(Boolean).join("; "),
    ]))
    : "_No candidate was screened out._", "");

  for (const [heading, body] of [[DIGEST_SECTIONS.crossChecks, model.cross_checks], [DIGEST_SECTIONS.openFlags, model.open_flags]])
    if (body) out.push(heading, "", body, "");

  // ### Answers to the instructed checks — the ANSWER is the seat's, the record ids it read while
  // answering are the reading audit's. doubt-ledger's answerWatchlistLines scans this section by its
  // /answer|watchlist/i heading test, so every line under it is a line that join can reach.
  if (model.instructed_checks.length) {
    out.push(DIGEST_SECTIONS.instructed, "");
    for (const c of model.instructed_checks) {
      out.push(`- You asked: ${c.ask} → ${c.answer}`);
      if (facts.readIds?.length) out.push(`  - records read: ${facts.readIds.join(", ")}`);
    }
    out.push("");
  }

  if (model.disagreement_resolutions.length) {
    out.push(DIGEST_SECTIONS.adjudication, "");
    for (const d of model.disagreement_resolutions)
      out.push(`- ${d.subject} — **${d.decision}**: ${d.reason}`);
    out.push("");
  }

  if (facts.auditRows?.length) {
    out.push(DIGEST_SECTIONS.auditTrail, "",
      table(["Unit", "Searches", "Detail fetches", "_query"], facts.auditRows.map((a) =>
        [a.unit, a.searches, a.detail_fetches, a.query ?? ""])), "");
  }
  if (facts.counts) {
    const statusRow = facts.counts.find(([l]) => /status/i.test(l));
    if (statusRow) out.push(DIGEST_SECTIONS.statusFilter, "", `- ${statusRow[0]}: ${statusRow[1]}`, "");
  }

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

// ── THE TWO CLOSED VOCABULARIES THIS TRANSPORT OWNS ───────────────────────────────────────────────
//
// EXPORTED so `skill-contract-enumerations` can pin them as code-owned sets. That guard's rule is that
// a passage using the phrase "EXACTLY one bare token" must enumerate a set the CODE owns, matched as one
// contiguous slash list — a member-by-member check cannot pin a set, which it found the hard way twice.
// A vocabulary taught in a skill file with no code counterpart is a vocabulary the guard exempts, and an
// exemption is how the next one drifts.
// ── WHY A RECORD LEAVES THE DIGEST — A CLOSED VOCABULARY, JOINED TO THE BAND ──────────────────────
//
// The owner's rule: a record leaves a stage only with a recorded reason. On R2 the digest
// dropped 88 records and 81 carried no reason at all — `digest:silent-drop`, `reason_source: absent`.
//
// NOT `DECLINATION_REASONS`, and the reason is authority rather than taste. Every token in that set
// cites `synthesis-rules.md` line ranges as the rule that licenses it; they are synthesis's grounds for
// not DELIVERING a finding. A digest drop is a different act under different doctrine — the relevance
// gate, the status filter, class scope — and reusing the other set would attach a rule authority that
// does not govern this seat. Same shape, own vocabulary, cited to this stage's own doctrine.
//
// THE TOKEN IS A JOINED CLAIM, NOT A FREE LABEL. Two of these five are grounds the SCREEN already
// recorded on the record, so the driver holds the answer and the acceptance boundary checks the seat's
// token against it. That is what makes the vocabulary worth having: `dead-status` on a record the band
// screened `surface:in-scope-live` is refused by name, which is the exact shape digest.md forbids in as
// many words ("Never batch-drop a surface:in-scope-live / surface:all-class row on goods/services").
export const DIGEST_DROP_REASONS = Object.freeze({
  "off-field": {
    seatJudged: true,
    rules: "digest.md — Step 2, the relevance gate: the only relevance judge",
    gloss: "the relevance gate dropped it as genuinely field-irrelevant, decided on the record's own goods",
  },
  "goods-distance": {
    seatJudged: true,
    rules: "digest.md — kept and noted with its goods-distance",
    gloss: "close enough to surface but far enough in goods that it is recorded rather than carried",
  },
  "duplicate-of-surfaced": {
    seatJudged: true,
    rules: "digest.md — one row per POSITION, never one per registration of the same right",
    gloss: "the same right already has a row under another constituent record",
  },
  "dead-status": {
    seatJudged: false, verdict: "drop:dead",
    rules: "digest.md — the status filter; the screen's own verdict",
    gloss: "the screen recorded this record dead",
  },
  "out-of-class": {
    seatJudged: false, verdict: "drop:out-of-class",
    rules: "digest.md — class scope; the screen's own verdict",
    gloss: "the screen recorded this record outside the instructed classes",
  },
});
export const DIGEST_DROP_REASON_TOKENS = Object.freeze(Object.keys(DIGEST_DROP_REASONS));
/** The verdicts that mean the screen SURFACED this record as a real in-scope candidate. */
const SURFACING_VERDICTS = Object.freeze(["surface:in-scope-live", "surface:all-class"]);

export const VERIFY_VALUES = Object.freeze(["yes", "no"]);
export const ADJUDICATION_DECISIONS = Object.freeze(["ADOPTED", "OVERRODE"]);
const VERIFY_SET = new Set(VERIFY_VALUES);
const ADJUDICATIONS = new Set(ADJUDICATION_DECISIONS);

/**
 * Validate the typed values against the run's own band, then render.
 *
 * Returns `{ok:true, model, content}` or `{ok:false, reason}`, reason token-first. PURE — every fact it
 * checks against arrives in `facts`, so the same call decides the same way in a test and in a run.
 *
 * THE JOIN IS THE CHECK. A seat-sent uri that names no band record is REFUSED rather than rendered
 * with empty identifier cells: under the old dictation the seat retyped those cells and a wrong one
 * was caught downstream or not at all, whereas a uri the band cannot resolve is a defect the seat can
 * fix in the same turn it made it.
 */
export function acceptRegisterDigest(params, facts = emptyFacts()) {
  // ── A DRIVER FAULT IS ANSWERED FIRST, AND UNDER ITS OWN NAME ─────────────────────────────────────
  //
  // THIS USED TO SIT BESIDE THE ACCOUNTING JOIN, 90 LINES DOWN, AND IT WAS UNREACHABLE THERE. A run
  // stamped for accounting whose facts cannot be read has an EMPTY record index too, so every row's
  // uri failed to resolve and the seat met `registerdigest_uri_unknown` — a seat defect — when the
  // truth was that the driver had not written the file. Opposite repairs: the seat then re-states uris
  // that were right, cannot succeed, and burns its bounded refusal budget doing it. Measured on a run
  // directory with the stamp present and the sidecar deleted, 2026-08-27.
  //
  // A PRECONDITION, NOT A ROW CHECK. Nothing the seat sent can be judged when the driver's own facts
  // are missing, so this is answered before a single row is read.
  if (facts.armed && !Array.isArray(facts.owed)) {
    return { ok: false, reason: `registerdigest_accounting_unreadable: this run is stamped for per-record accounting and the driver's facts carry no owed list, so nothing can be checked against. The stamp lands BEFORE the facts precisely so this fails loud instead of disarming the rule silently (driver-written — this is a bug, not a model defect, and re-stating the call cannot fix it)` };
  }
  const byUri = facts.recordsByUri instanceof Map ? facts.recordsByUri : new Map();
  const resolve = (uri, where) => {
    const key = joinKey(uri);
    if (!key) return { bad: `registerdigest_uri_missing:${where} — every row joins to a band record by its \`/mark/…\` uri` };
    const rec = byUri.get(key);
    if (!rec) return { bad: `registerdigest_uri_unknown:${str(uri).slice(0, 60)} (${where}) — no record in this run's band carries that uri; the identifier cells are rendered FROM the band, so a uri it cannot resolve has no row to render` };
    const cells = identifierCells(rec, facts.recordHost);
    return { rec, cells };
  };

  const readFindingRows = (raw, where) => {
    const rows = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const j = resolve(r?.uri, where);
      if (j.bad) return { bad: j.bad };
      const flag_reason = str(r?.flag_reason);
      if (!flag_reason)
        return { bad: `registerdigest_flag_reason_missing:${j.cells.uri} (${where}) — the reason this position earns a row is the judgment the row exists to carry` };
      const verify = lc(r?.verify);
      if (!VERIFY_SET.has(verify))
        return { bad: `registerdigest_verify_invalid:${str(r?.verify).slice(0, 30) || "(empty)"} (${j.cells.uri}) — EXACTLY one bare token of: ${VERIFY_VALUES.join(" / ")}` };
      rows.push({ uri: j.cells.uri, cells: j.cells, flag_reason, verify });
    }
    return { rows };
  };

  const sheet1 = readFindingRows(params?.findings_rows, "findings_rows");
  if (sheet1.bad) return { ok: false, reason: sheet1.bad };
  const sheet2 = readFindingRows(params?.incumbent_rows, "incumbent_rows");
  if (sheet2.bad) return { ok: false, reason: sheet2.bad };

  const negative_rows = [];
  for (const r of Array.isArray(params?.negative_rows) ? params.negative_rows : []) {
    const j = resolve(r?.uri, "negative_rows");
    if (j.bad) return { ok: false, reason: j.bad };
    const drop_reason = str(r?.drop_reason);
    if (!drop_reason)
      return { ok: false, reason: `registerdigest_drop_reason_missing:${j.cells.uri} — a drop with no stated reason is a silent recall loss, which is the one thing this table exists to prevent` };
    // ── THE CLOSED TOKEN, AND THE JOIN THAT MAKES IT WORTH HAVING ─────────────────────────────────
    const ground = str(r?.ground);
    if (!DIGEST_DROP_REASONS[ground])
      return { ok: false, reason: `registerdigest_drop_ground_invalid:${ground.slice(0, 30) || "(empty)"} (${j.cells.uri}) — EXACTLY one bare token of: ${DIGEST_DROP_REASON_TOKENS.join(" / ")}. The prose in \`drop_reason\` says why THIS record; the token says under which rule` };
    const verdict = screenVerdictOf(j.rec);
    const spec = DIGEST_DROP_REASONS[ground];
    // A ground the SCREEN records is checked against the screen. The seat may not relabel a record the
    // band surfaced as a live in-scope candidate into a status or class drop — digest.md forbids exactly
    // that ("Never batch-drop a surface:in-scope-live / surface:all-class row"), and until now nothing
    // could see it happen, because the ground was prose.
    if (!spec.seatJudged && verdict && SURFACING_VERDICTS.includes(verdict))
      return { ok: false, reason: `registerdigest_drop_ground_contradicted:${ground} on ${j.cells.uri}, which this run's band screened \`${verdict}\` — that is a real in-scope candidate, so it cannot be dropped on status or class. Decide it on its own goods (\`off-field\`/\`goods-distance\`) or carry it` };
    if (!spec.seatJudged && verdict && spec.verdict && verdict !== spec.verdict)
      return { ok: false, reason: `registerdigest_drop_ground_contradicted:${ground} on ${j.cells.uri}, which this run's band screened \`${verdict}\` — the token names a screen verdict this record does not carry` };
    // The provenance the acceptance gate keys on is the BAND's read of the record, not the seat's.
    negative_rows.push({ uri: j.cells.uri, cells: j.cells, drop_reason, ground, variant: str(r?.variant),
      screen_verdict: verdict });
  }

  const instructed_checks = [];
  for (const c of Array.isArray(params?.instructed_checks) ? params.instructed_checks : []) {
    const ask = str(c?.ask), answer = str(c?.answer);
    if (!ask || !answer)
      return { ok: false, reason: `registerdigest_instructed_incomplete:${(ask || answer).slice(0, 60) || "(empty)"} — every instructed check carries the ask AND the answer, including the honest "the frozen material cannot answer this"` };
    instructed_checks.push({ ask, answer });
  }

  const disagreement_resolutions = [];
  for (const d of Array.isArray(params?.disagreement_resolutions) ? params.disagreement_resolutions : []) {
    const decision = str(d?.decision).toUpperCase();
    if (!ADJUDICATIONS.has(decision))
      return { ok: false, reason: `registerdigest_adjudication_invalid:${str(d?.decision).slice(0, 30) || "(empty)"} — EXACTLY one bare token of: ${ADJUDICATION_DECISIONS.join(" / ")}` };
    const subject = str(d?.subject), reason = str(d?.reason);
    if (!subject || !reason)
      return { ok: false, reason: `registerdigest_adjudication_incomplete:${(subject || reason).slice(0, 60) || "(empty)"} — an override quotes the reason it contradicts; a kept tier still says why` };
    disagreement_resolutions.push({ subject, decision, reason });
  }

  const model = {
    schema_version: SCHEMA_VERSION,
    findings_rows: sheet1.rows,
    incumbent_rows: sheet2.rows,
    negative_rows,
    opposition: str(params?.opposition),
    merch_sweep: str(params?.merch_sweep),
    cross_checks: str(params?.cross_checks),
    open_flags: str(params?.open_flags),
    instructed_checks,
    disagreement_resolutions,
  };

  // ASK WHAT THE ZERO MEANS. A digest that surfaced nothing AND dropped nothing has not judged the
  // band — it has skipped it. That is the shape `nonEmpty` was reaching for on a document the seat
  // wrote, measured here on the rows instead of on the characters of a render that always has a title.
  // ── THE ACCOUNTING REFUSAL — EVERY RECORD THE RUN CARRIED IN ENDS SOMEWHERE ───────────────────────
  //
  // Armed only by the era stamp, so archived runs keep their verdicts (/M6's pattern). The three
  // accounted exits are the ones `record-carry.mjs` already names for this seam, quoted from its own
  // `digest:silent-drop` detail: a findings surface, a Negative-results drop row, or a
  // Disagreement-resolutions row. Nothing new is invented here — the join is over lists this call
  // already carries.
  if (facts.armed) {
    const accounted = new Set();
    for (const r of [...model.findings_rows, ...model.incumbent_rows, ...model.negative_rows]) accounted.add(joinKey(r.uri));
    // A disagreement resolution accounts for a record when its subject names that record's uri — the
    // third exit, and the one a reader is least likely to expect, so it is joined rather than assumed.
    for (const d of model.disagreement_resolutions)
      for (const k of facts.owed) if (k && lc(d.subject).includes(k)) accounted.add(k);
    const unaccounted = facts.owed.filter((k) => !accounted.has(k));
    if (unaccounted.length) {
      const show = unaccounted.slice(0, 5).join(", ");
      return { ok: false, reason: `registerdigest_unaccounted_records:${unaccounted.length} of ${facts.owed.length} record(s) this run carried into the digest end nowhere — neither a findings row, nor a Negative-results drop, nor a Disagreement resolution: ${show}${unaccounted.length > 5 ? ` (+${unaccounted.length - 5} more)` : ""}. Each needs one of the three, and a drop needs its ground token` };
    }
  }

  const judged = model.findings_rows.length + model.incumbent_rows.length + model.negative_rows.length;
  if (judged < MIN_JUDGED_ROWS && byUri.size > 0)
    return { ok: false, reason: `registerdigest_nothing_judged:0 rows against ${byUri.size} record(s) in this run's band — no Sheet-1 row, no incumbent row and no negative-results drop. Every screened-live record must END somewhere a reader can see; a digest that ends none of them has not read the band` };
  model.band_empty = byUri.size === 0 && judged === 0;

  return { ok: true, model, content: renderRegisterFindings(model, facts) };
}

/**
 * Capture, validate, then write — in that order.
 *
 * The capture happens BEFORE the decision, as in every sibling transport: it exists even for a REFUSED
 * call, which is what makes its presence the discriminator this conversion is proven by. The refusal
 * is appended too, so `refusalsFor` can tell a stage that met a defect and could not restate from one
 * that never tried — the distinction gateway.mjs reports on a missing tool-written artifact.
 */
export function recordRegisterDigest(runDir, received, { facts = null, now = () => new Date().toISOString() } = {}) {
  const paths = registerDigestCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed
  // `call-001.json`, so a call refused and then re-sent kept only the survivor. Sequence 1 still
  // resolves to `call-001.json`, so every consumer reading that name is unmoved. Best-effort
  // throughout, as the capture always was — a lost forensic record never fails a run.
  const nameFor = (seq) => join(paths.dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // A PATCH call merges onto the stored model BEFORE acceptance, so the whole document is validated
  // as one thing every time — a patch cannot slip a row past a check by arriving alone.
  const params = received?.patch === true ? mergeDigestPatch(lastAcceptedModel(runDir), received) : received;
  const verdict = acceptRegisterDigest(params, facts ?? readDigestFacts(runDir));
  if (!verdict.ok) {
    try { writeFileSync(paths.refusals, `${JSON.stringify({ at: now(), reason: verdict.reason })}\n`, { flag: "a" }); }
    catch { /* the refusal record is best-effort; the refusal itself is returned regardless */ }
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  // ── — THE DIGEST MARKS THE LIST, AND IT CANNOT KILL THE CALL ───────────────────
  //
  // Accepted-when-present, never required. A call carrying no `fates` behaves exactly as it did before
  // this existed; the owed-keyed refusal above is untouched and no new refusal is created here. That is
  // the deliver-always principle one layer down: a new dictation rule read-and-not-applied is a known
  // failure mode on this engine, and wiring codes to a refusal on their first live outing would put a
  // no-report path on the run that exercises them.
  //
  // Best-effort like the model write below it — a lost marking costs the next reader a projection, and
  // it must never cost a client a report.
  if (Array.isArray(received?.fates) && received.fates.length) {
    try {
      applyFates(join(String(runDir ?? ""), HIT_LIST_FILE), received.fates, {
        readJson: (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } },
        writeJson: (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + "\n"),
      });
    } catch { /* the marking is a projection; the accepted call stands regardless */ }
  }

  const at = join(String(runDir ?? ""), FINDINGS_FILE);
  // The model lands BEFORE the document: a later patch merges onto what was accepted, so a write that
  // fails must not leave a stored model describing a document nobody has.
  try { writeFileSync(paths.model, JSON.stringify(verdict.model, null, 2) + "\n"); }
  catch { /* best-effort; a lost model costs the next patch its base, and it says so by refusing */ }
  try { writeFileSync(at, verdict.content); }
  catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }
  return {
    written: at, refused: null,
    surfaced: verdict.model.findings_rows.length,
    incumbent: verdict.model.incumbent_rows.length,
    dropped: verdict.model.negative_rows.length,
    captured: closeCapture({ ok: true }), capture_failed: captureFailed,
  };
}

/**
 * Every refusal this run's digest transport recorded, oldest first.
 *
 * gateway.mjs reads this through `toolWrittenArtifact` so a MISSING register-findings.md can say which
 * it is: a stage that tried and was refused (the last reason is quoted) or one that never called at
 * all. Those two reported identically before the refusal reader existed, and the first reads as the
 * second — a stage that met a defect and could not restate looks like one that never started.
 */
export function refusalsFor(runDir) {
  const { refusals } = registerDigestCallPaths(String(runDir ?? ""));
  if (!existsSync(refusals)) return [];
  const out = [];
  for (const line of readFileSync(refusals, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is not a reason to lose the rest */ }
  }
  return out;
}

/**
 * The last model this run accepted, or null. The patch path's base.
 */
export function lastAcceptedModel(runDir) {
  try { return JSON.parse(readFileSync(registerDigestCallPaths(String(runDir ?? "")).model, "utf8")); }
  catch { return null; }
}

/**
 * Merge a PATCH call onto the stored model. Returns the merged params, ready for acceptance.
 *
 * WHY THE PATCH PATH EXISTS, and it is a measurement rather than a symmetry with synthesis. The
 * recall-reconciliation followup ADDS endings for positions that end nowhere and changes nothing
 * already written; register-findings.md was the largest document in the run (103 KB on the evidence
 * run, 160 KB by the end of its ladder), and `repair-contract.mjs` exists to retire the "re-emit the
 * COMPLETE updated file" instruction for exactly that reason. A whole-document re-send is far cheaper
 * once the rows are typed values — but "cheaper" is not "free", and on this one repair the correct
 * cost is the four rows it actually adds.
 *
 * ROWS MERGE BY URI, which is the only key either side agrees on. A patched row REPLACES the row with
 * that uri and a new uri is appended, so refreshing an ending is idempotent. A row is never deleted by
 * a patch: dropping a finding is a decision, and a decision arrives as a whole re-send where it is
 * visible, not as an absence in a partial payload. Prose sections replace only when the patch carries
 * them — an omitted section keeps what the stored model holds rather than being blanked.
 */
export function mergeDigestPatch(stored, patch) {
  const base = stored ?? { findings_rows: [], incumbent_rows: [], negative_rows: [], instructed_checks: [], disagreement_resolutions: [] };
  const mergeRows = (was, now) => {
    if (!Array.isArray(now)) return (was ?? []).map((r) => ({ ...r }));
    const out = (was ?? []).map((r) => ({ ...r }));
    for (const r of now) {
      const k = joinKey(r?.uri);
      const at = out.findIndex((x) => joinKey(x?.uri) === k);
      if (at >= 0) out[at] = { ...out[at], ...r };
      else out.push({ ...r });
    }
    return out;
  };
  // ── EVERY KEY MERGES ON ITS OWN JOIN KEY. NONE IS REPLACED WHOLESALE ──────────────────────────────
  //
  // These two were `Array.isArray(patch?.X) ? patch.X : base.X` — replaced whenever the patch carried
  // them, so a seat correcting ONE entry silently dropped the rest. That is the defect that took R2's
  // synthesis from nineteen findings to four (`mergeSynthesisPatch`'s
  // `if (patch?.findings !== undefined) out.findings = patch.findings`), reproduced here on the two keys
  // that have no uri — which is exactly where it goes, because a key with no obvious join key is the one
  // that gets the cheap branch. It is reachable: the flush rung tells the seat to send "only the rows
  // and sections you are changing".
  //
  // They DO have join keys and both are already required and already refused when empty: an instructed
  // check is keyed on its `ask`, a resolution on its `subject`. Same rule as the uri rows above — the
  // named entry is replaced in place, a new one is appended, and an entry the patch does not mention
  // comes back byte-identical.
  const mergeKeyed = (was, now, field) => {
    if (!Array.isArray(now)) return (was ?? []).map((r) => ({ ...r }));
    const k = (r) => lc(r?.[field]);
    const out = (was ?? []).map((r) => ({ ...r }));
    for (const r of now) {
      const at = out.findIndex((x) => k(x) === k(r));
      if (at >= 0) out[at] = { ...out[at], ...r };
      else out.push({ ...r });
    }
    return out;
  };
  const keep = (now, was) => (now === undefined || now === null || str(now) === "" ? was : now);
  return {
    findings_rows: mergeRows(base.findings_rows, patch?.findings_rows),
    incumbent_rows: mergeRows(base.incumbent_rows, patch?.incumbent_rows),
    negative_rows: mergeRows(base.negative_rows, patch?.negative_rows),
    instructed_checks: mergeKeyed(base.instructed_checks, patch?.instructed_checks, "ask"),
    disagreement_resolutions: mergeKeyed(base.disagreement_resolutions, patch?.disagreement_resolutions, "subject"),
    opposition: keep(patch?.opposition, base.opposition),
    merch_sweep: keep(patch?.merch_sweep, base.merch_sweep),
    cross_checks: keep(patch?.cross_checks, base.cross_checks),
    open_flags: keep(patch?.open_flags, base.open_flags),
  };
}

/** Was this run's findings document written through the typed transport? The ruled discriminator. */
export function registerDigestWasRecorded(runDir) {
  return existsSync(registerDigestCallPaths(String(runDir ?? "")).payload);
}
