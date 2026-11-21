// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// report-assembly.mjs — report.md assembled from the run's record: the sections code builds (the reasoned negatives, the
// answers to the asks, what only the client can do, the reviewer's open points), the origin rows, the corrections
// delivered, and the report assembled again from the record.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { foldCaption, foldCardRead } from "./card-budget.mjs";
import { carriesOwnFrame, composeCard } from "./card-frame.mjs";
import { deliveredOutcomes } from "./corrections-delivered.mjs";
import { unresolvedFlags } from "./corrections-feedforward.mjs";
import { planWriteUps, writeShortEntries } from "./coverage-rows-run.mjs";
import { actionPartyReferences, cardedParties, compareBlockingPower, deriveActionConditions, DISPOSITION_GROUP, inDispositionMode, joinAskToAnswer, parseFindingsJsonLenient, reasonedNegativeGroups, stripAskLabel } from "./findings-model.mjs";
import { leftOpenSectionOfRun } from "./left-open-md.mjs";
import { runLog } from "./log.mjs";
import { readFold } from "./record-fold.mjs";
import { CORRECTIONS_DELIVERED_FILE, CORRECTIVE_RECHECK_FILE, reviewAfterRepairPath, reviewBeforeRepairPath } from "./repair-review-run.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE } from "./reviewer-open-points.mjs";
import { atomicWrite } from "./run-record.mjs";
import { safeReadJson } from "./stage-dispatch.mjs";
import { shaOf } from "./stage-freshness.mjs";
import { paths } from "./stages.mjs";
import { parseCorrections, parseVerdict } from "./verify.mjs";
import { buildGradedEntriesSection } from "./write-up-render.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

// The ACTIVE provider's capability contract and the offices this DEPLOYMENT cannot reach both moved to
// register-unreachable.mjs, unchanged, because Depth 2's count and record lanes need the same
// two answers and a second binding of the member→variable lookup is how two lanes come to disagree
// about which variable matters. Their behaviour here — NEVER-KILL, null contract, empty list — is
// identical; the module comment carries the reasoning that used to live at this spot.

// Cited registry URIs on a delivered surface (broad form — hyphens AND underscores are legal in record
// ids: corsearch `/mark/cn/37554073-42`, Signa `/mark/us/tm_019d1db7-…`).
export const CITED_URI_RE = /\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/gi;

// spec 62 — the per-field CONFIGURATION PROVENANCE rows for a project run: for each PROJECT_KEY, its effective
// value (compact) and where it came from (project | customer | house). Read off the frozen sidecar `pr` (both
// origins and the effective values live there), serialised to a single-line JSON string for the report
// front-matter. It was rendered internal-only in the scope fold; the 2026-09-16 redesign takes that fold
// off the page, and this row set went with it — it was the one block in there labelled internal, which is
// the class that ruling removed. IT IS STILL RECORDED, here and in the workbook, which is where a reader
// who wants to know which layer set a knob now finds out. Absent origins ⇒ [] ⇒ nothing injected.
export function originRowsForReport(pr) {
  if (!pr?.origins) return [];
  const short = (s, n = 48) => { const t = String(s ?? "").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const spec = {
    platforms:            ["Marketplaces",          (v) => `${(v ?? []).length} store${(v ?? []).length === 1 ? "" : "s"} + web`],
    defaultClasses:       ["Default classes",       (v) => (v ?? []).length ? v.join(", ") : "—"],
    defaultJurisdictions: ["Default jurisdictions",  (v) => (v ?? []).length ? v.join(", ") : "—"],
    marketplaceDensity:   ["Marketplace density",   (v) => v ?? "sparse"],
    delivery:             ["Delivery format",       (v) => v ? `${v.email ?? "summary"}${v.privileged ? ", privileged" : ""}` : "summary"],
    riskAppetite:         ["Risk posture",          (v) => (v && String(v).trim()) ? "set" : "—"],
    industry:             ["Sector",                (v) => (v && String(v).trim()) ? short(v) : "—"],
  };
  const rows = [];
  for (const f of ["platforms", "defaultClasses", "defaultJurisdictions", "marketplaceDensity", "delivery", "riskAppetite", "industry"]) {
    const origin = pr.origins[f];
    if (!origin) continue;
    rows.push({ field: spec[f][0], value: short(spec[f][1](pr[f]), 60), origin });
  }
  return rows;
}

// Imported down here, below every line the rest of the tree cites by number, so adding them moved none of those lines.
// ASSEMBLE report.md = the overview shell (front-matter + Actions) + `# Left open` + `# Marks` + the
// per-card files in render order (composite desc, ordinal asc — mirrors render.mjs `sortedAll`), `open: true` on the
// single top card. Findings with no card file (a failed report-card, or a secondary finding) are NOT emitted —
// render.mjs synthesizes them structured-only from findings.json, so nothing is silently dropped. Pure file IO.
// spec 64 — "### Only you can close these" is CODE-BUILT from the typed actions register (the report-
// overview stage no longer authors it), so the section, the "subject to" bound line, the email box and
// the derived disposition all read from ONE source and can never drift apart. Ordering: time-critical
// conditions (deadline asc) → other conditions (id) → advisories (tagged — actYouConditions skips them,
// so an open question never reads as a condition). Returns "" when nothing renders.
//
// — ALL FOUR ADVISORY KINDS RENDER, AND THE FOURTH USED TO BE UNREACHABLE. What stood here said
// "filing-routine never renders here (ordinary filing mechanics are not an ask)", written 2026-07-16 with
// the ADVISORY_TAG filter itself. then split this section into an ask group and a watch group on
// 2026-08-10, and its own comment below names the watch group's members as "monitoring and filing-routine"
// — but `advisories` was already filtered by ADVISORY_TAG upstream, and did not touch that filter.
// So the group written to hold filing-routine could only ever receive monitoring, and a schema-valid
// ADVISORY_KINDS member could never reach a client document at all. The 2026-07-16 comment described the
// behaviour it shipped with and became stale prose sitting next to code that contradicted it.
//
// Ruling 2026-08-19 (relayed), on a renewal-deadline example: it renders. That intent is the
// ruled behaviour. The tag is REQUIRED, not decoration — `advisoryLine` interpolates ADVISORY_TAG[a.kind]
// directly, so a kind that passes the filter without an entry here renders "- **undefined** …" into a
// client document. Whoever adds a fifth kind adds it in both places, and render.mjs needs the matching
// chip replace or the reader sees the literal token.
const ADVISORY_TAG = { "client-fact": "[Open question]", "commercial-decision": "[Your decision]", monitoring: "[Monitor]", "filing-routine": "[Filing step]" };
// — the condition-side counterpart of ADVISORY_TAG, and the token the report renders as the fourth
// chip. It repeats the group heading deliberately: the chip's job is to say what an item IS wherever the
// eye lands on it, and a list where three kinds are chipped and the fourth is bare reads as three kinds
// plus leftovers. render.mjs has the matching replace beside the other three.
const CONDITION_TAG = "[Before you can rely]";
// PR-3 (report voice) — diacritic-folded lowercase for the subject-join containment test only.
const softNorm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/**
 * THE HEADINGS THIS FILE CODE-BUILDS, and the ONE list of them.
 *
 * Every value below is emitted by a builder in this file and by nothing else. They are declared here and
 * USED by those builders rather than repeated in them, because the whole point of the constant is that it
 * cannot drift from what the code actually writes — a second, hand-kept list is the thing it exists to
 * prevent, and this repo has paid for that shape more than once.
 *
 * ── WHY A CONSTANT AND NOT A COMMENT ───────────────────────────────────────────────────────────────
 *
 * A section that becomes code-built stops being a thing a seat may author, and the dictation that used to
 * order it goes false WITHOUT ANYBODY EDITING IT. Measured: the refutation reviewer was still ordered to
 * "verify the ... section answers EACH of these verbatim intake asks" months after that section became
 * code-built from a validated register — an instruction spending a reviewer's attention on a failure the
 * code had made unrepresentable. Nobody wrote it wrong; a stage underneath it got better.
 *
 * So the guard that catches the next one walks THIS list against what actually reaches a seat, and a
 * section joins the list by the same act that makes it code-built: its builder returning one of these.
 */
export const CODE_BUILT_SECTIONS = Object.freeze({   // @internal
  onlyYou: "### Only you can close these",
  reviewerOpenPoints: "### Reviewer's open questions",
  // Under it, the points of the review that stood when the recheck after the correction saved none.
  earlierReview: "#### Earlier review — correction not rechecked",
  askAnswers: "### Answers to your instructions",
  reasonedNegatives: "# Reasoned negatives",
});

export function buildOnlyYouSection(actions, findings, { nowMs = Date.now(), withinDays = 60, graceDays = 14 } = {}) {   // @internal
  const { conditionActions, advisoryActions } = deriveActionConditions(actions, findings);
  // ── PR-3 (report voice), CORRECTED BY — WHAT THE SUBJECT JOIN DOES AND DOES NOT GUARANTEE ───
  //
  // This comment used to read: "an ask can never name an entity no finding identifies — the
  // reference-integrity property holds by construction". IT DID NOT HOLD, and the sentence sat directly
  // above the code that falsified it, which is worse than never claiming it: a reader stops looking.
  //
  // The join reads `action.ordinals`, resolves each to a finding, and appends that finding's label when
  // the ask does not already name it. Nothing read the OTHER names in the text, so an ask bound to a
  // live finding whose text named a different party delivered as
  //
  //     Obtain consent from PARTY-B before launch. (re: PARTY-A (Party A Ltd))
  //
  // — two parties the reader now believes are connected, manufactured by the mechanism whose comment
  // promised it prevented exactly that.
  //
  // WHAT HOLDS NOW, stated as what it is rather than as a guarantee:
  //   · The label is code-joined from the store and never model-typed. That part was always true.
  //   · An ask that names ANOTHER carded party gets NO appended subject — the run's own party index
  //     (findings-model.mjs `cardedParties`) can see that case, and suppressing the join is the whole
  //     fix for it: a sentence that names its own party needs no "(re:", and one that names a different
  //     party must not be given one.
  //   · An ask citing ordinals that ALL fail to resolve is not silently unsubjected any more. It used
  //     to `continue` past every one and render exactly like a run-level ask, so a broken reference and
  //     a deliberate absence were the same bytes.
  //
  // WHAT DOES NOT HOLD, and is not claimed: an ask may still name a party THE RUN NEVER SAW — a
  // supplier, a licensee, a distributor no finding carries. No index built from findings can see it.
  // That orphan lint is what catches that at delivery, and this is the producer telling the truth
  // about its own reach instead of covering for it.
  const byOrd = new Map((findings ?? []).filter((f) => f && f.disposition !== "withdrawn").map((f) => [f.ordinal, f]));
  const partyIndex = cardedParties(findings);
  const subjectFor = (a) => {
    const t = softNorm(a?.text);
    const refs = actionPartyReferences(a, partyIndex);
    const bound = new Set();
    const missing = [];
    for (const n of (Array.isArray(a?.ordinals) ? a.ordinals : [])) {
      const f = byOrd.get(n);
      if (!f) continue;
      const mark = String(f.mark ?? "").trim(), owner = String(f.owner?.name ?? "").trim();
      bound.add(softNorm(mark)); bound.add(softNorm(owner));
      if ((mark && t.includes(softNorm(mark))) || (owner && t.includes(softNorm(owner)))) continue;
      const label = mark && owner && softNorm(mark) !== softNorm(owner) ? `${mark} (${owner})` : (mark || owner);
      if (label && !missing.some((x) => softNorm(x) === softNorm(label))) missing.push(label);
    }
    // — THE ASK ALREADY NAMES SOMEONE THE RUN KNOWS, AND IT IS NOT WHO WE WERE ABOUT TO APPEND.
    // Appending here is what builds the false association. The ask still renders, whole and unedited —
    // a forward legal step the opinion authored survives this, which is the rule one layer up
    // ("Do not resolve a defect by DELETING the action") applied to its rendering.
    if (missing.length && refs.names.some((n) => !bound.has(softNorm(n)))) return "";
    if (!missing.length) return "";
    return ` (re: ${missing.slice(0, 2).join("; ")}${missing.length > 2 ? `; +${missing.length - 2} more` : ""})`;
  };
  // Terminal punctuation on the ask BEFORE the subject join. This was written to work around a cut —
  // actYouConditions ended its bound line at the first '.' or ':' before whitespace, and the subject's
  // own "(re:" qualified, so a period-less ask (the synthesis prompt demands one sentence but nothing
  // enforces terminal punctuation) delivered as a mangled "…terms (re". THAT CUT IS GONE (ruling
  // 2026-08-10): the conditions box now renders the ask and its subject whole. The punctuation
  // stays because it was always the right output — "Instruct counsel on the joined-script forms (re: X)"
  // reads as one run-on sentence, and the period is what separates the ask from the driver's own note.
  // Asks with no subject are untouched.
  const askLine = (a) => {
    const text = String(a.text).trim();
    const subj = subjectFor(a);
    if (!subj) return text;
    return `${text}${/[.!?:]$/.test(text) ? "" : "."}${subj}`;
  };
  const dated = conditionActions.filter((a) => a.deadline?.date).sort((x, y) => String(x.deadline.date).localeCompare(String(y.deadline.date)));
  const undated = conditionActions.filter((a) => !a.deadline?.date).sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
  const advisories = advisoryActions.filter((a) => ADVISORY_TAG[a.kind]).sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
  // spec 64 A×B glue — a FINDING-level in-window deadline (enrichFindingDeadlines injects them from the
  // register's own opposition windows) surfaces as a code-built time-critical alert when no action
  // already carries that date: a recorded deadline must never silently disappear, even when synthesis
  // authored no action for it. In-window only (an archived 2015 window is history, not an ask).
  const actionDates = new Set([...dated, ...advisories].map((a) => a.deadline?.date).filter(Boolean));
  const inWindow = (d) => {
    const days = Math.round((Date.parse(d) - nowMs) / 86400000);
    return Number.isFinite(days) && days <= withinDays && days >= -graceDays;
  };
  const findingAlerts = (findings ?? [])
    .filter((f) => f && f.disposition !== "withdrawn" && typeof f.deadline?.date === "string" && f.deadline.date.trim())
    .filter((f) => inWindow(f.deadline.date) && !actionDates.has(f.deadline.date))
    .sort((x, y) => String(x.deadline.date).localeCompare(String(y.deadline.date)))
    .map((f) => `- **[Time-critical]** ${String(f.mark ?? "the conflicting mark").trim()}: the ${String(f.deadline.kind ?? "deadline").trim()} window closes ${f.deadline.date} — decide how to respond before it does.`);
  // ── (c) — THREE OBLIGATIONS IN ONE LIST, VISUALLY IDENTICAL ────────────────────────────────────
  // A delivered report put the conditions the verdict DEPENDS ON next to "[Open question] Confirm how
  // the product will be presented" as undifferentiated bullets. A reader skimming has to reconstruct
  // which ones block from the sentences themselves.
  //
  // NOTHING IS INFERRED FROM PROSE. The register already carries the distinction the reader needs:
  // CONDITION_KINDS are the kinds that condition reliance (findings-model.mjs states it — "an advisory
  // never conditions reliance", which is why `action.condition` is refused on an advisory), and the
  // advisory kinds carry their own tags. So this groups on `kind` — the author's own legal
  // classification — and a renderer that guessed severity from wording would be the defect this repo
  // keeps removing.
  //
  // Sub-headings, not a new section: "Only you can close these" is the heading the report, the email's
  // conditional bound and three predelivery checks all key on, and the ordering within each group
  // (dated first, then finding-level alerts, then undated) is unchanged.
  //
  // ── — EVERY ITEM CARRIES ITS LABEL ─────────────────────────────────────────────────────────────
  // The undated arm emitted a bare `- text` while every other line in the section carried a tag. So the
  // items that BLOCK reliance were the only items with no chip, and a reader skimming the list read the
  // unlabelled ones as the residue — the opposite of what they are. Nothing here is inferred: a condition
  // is a condition because its kind is in CONDITION_KINDS, exactly as the tagged arms are.
  // [Time-critical] stays on the DATED arm. A deadline is a fact about the item, not a second class of
  // it, and the date is what the reader has to act on first.
  const conditionLines = [
    ...dated.map((a) => `- **[Time-critical]** ${askLine(a)} (due by ${a.deadline.date})`),
    ...findingAlerts,
    ...undated.map((a) => `- **${CONDITION_TAG}** ${askLine(a)}`),
  ];
  // "we need an answer from you" vs "watch this": the client-fact / commercial-decision kinds are asks
  // addressed TO the reader; monitoring and filing-routine are standing items. Same tags as before, so
  // a reader who knows the old list reads the new one unchanged, one level down.
  const ASK_KINDS = new Set(["client-fact", "commercial-decision"]);
  // ── THE KINDS THAT DO NOT REACH A CLIENT SURFACE ────────────────────────────────────────────────
  //
  // Owner ruling, 2026-10-01, on the clearance emails production sent in the preceding day: the
  // "[Open question]" rows are non-critical and confuse, and they come OUT of the client's report and
  // email. They are not reworded and nothing replaces them.
  //
  // THE FILTER IS HERE AND NOT ON `advisories` ABOVE, which is the whole care in this change. That list
  // also feeds `actionDates`, so dropping a kind from it would silently take a declared deadline out of
  // the date set three predelivery checks key on — a client-facing removal quietly changing a date
  // check. Filtering at the point of RENDERING removes the rows from the document and touches nothing
  // else: the register in findings.json is unchanged, the kind stays valid, an advisory still never
  // conditions reliance, and the verdict and its bound read from the register rather than from these
  // lines.
  //
  // So the row is gone from what the client reads and the fact is still on the run, which is what the
  // ruling asks for.
  const NOT_FOR_CLIENT = new Set(["client-fact"]);
  const advisoryLine = (a) => `- **${ADVISORY_TAG[a.kind]}** ${askLine(a)}${a.deadline?.date ? ` (by ${a.deadline.date})` : ""}`;
  const forClient = (a) => !NOT_FOR_CLIENT.has(a.kind);
  const askLines = advisories.filter((a) => ASK_KINDS.has(a.kind)).filter(forClient).map(advisoryLine);
  const watchLines = advisories.filter((a) => !ASK_KINDS.has(a.kind)).filter(forClient).map(advisoryLine);
  const groups = [
    ["Before you can rely on this result", conditionLines],
    ["We need an answer from you", askLines],
    ["Keep an eye on", watchLines],
  ].filter(([, ls]) => ls.length);
  if (!groups.length) return "";
  // ── — THE ONE-GROUP COLLAPSE IS RE-RULED, AND THIS IS THE ROOT OF THE DRIFT ────────────────────
  //
  // What stood here: `groups.length === 1 ? groups[0][1].join("\n") : …`, on the argument that "a
  // single-bucket list with a lone sub-head is a heading that separates nothing". Read once, that is
  // true about a heading. Read across runs, it makes the section's SHAPE a function of how many buckets
  // a matter happened to fill — which is a property of the client's facts, not of the report. Two runs
  // both carrying blocking conditions rendered them under a named heading or as an anonymous list
  // depending on whether some unrelated third item was a monitoring ask. That is the drift reports,
  // and the flat-list run is the same code path as the three-group one, not a second one.
  //
  // A heading that separates nothing still says what the list IS. The reader is not comparing it with
  // its neighbours; they are asking whether these lines block them, and "Before you can rely on this
  // result" answers that where a bare list does not.
  //
  // ARCHIVED RUNS DO NOT MOVE. This function runs at ASSEMBLY, once, and its output is frozen into the
  // run's report.md; publish and republish read that file and never call it. So no delivered report is
  // rewritten by this — the change reaches runs assembled after it lands, and nothing else.
  const body = groups.map(([head, ls]) => `**${head}**\n\n${ls.join("\n")}`).join("\n\n");
  return `${CODE_BUILT_SECTIONS.onlyYou}\n\n${body}`;
}

// ── T3a — THE REVIEWER'S OPEN POINTS, CODE-BUILT FROM THE REVIEW ────────────────────────────────────
//
// Ruling 2026-08-26, verbatim: "Deliver always, with open points printed. The refusal on a
// blocking review goes." The delivery half stands: a refusing review never withholds a report.
//
// WHERE THE SECTION GOES CHANGED. Owner ruling 2026-09-24: reviewer notes never reach the client page, and
// a report the reviewer still refuses ships with its rating and nothing added. This builder is unchanged
// and its output goes to the run record beside the review (the call site in assembleReportMd), for the
// reviewing lawyer. The rest of this note describes how the section is built, which still holds.
//
// ── CODE-BUILT, LIKE THE ONLY-YOU SECTION, AND FOR THE SAME REASON ─────────────────────────────────
//
// Spec 64's ruling on `### Only you can close these` applies here word for word: code wins, so the
// section can never contradict the artifact it derives from. The one seat that must not be asked to
// summarise the reviewer's objections is the seat the reviewer objected to. So this reads
// senior-eye-review.md through `parseVerdict` and `parseCorrections` — the SHIPPED parsers, the same
// ones the corrective ladder builds its worklist from — and never asks a model to restate them.
//
// ── NOT BLOCKING-ONLY ANY MORE — OWNER DECISION, 2026-08-26 (T3b) ─────────────
//
// This section used to return "" on every verdict but BLOCKING, and the reason it gave was that
// CONDITIONAL reviews already deliver and their flags already reach the corrective pass. That is true
// of where the flags GO and says nothing about whether they LANDED. A flag can reach the corrective
// pass, be worked, and leave the report unchanged — and the client then reads a delivered report with
// no sign that the reviewer objected to something nobody fixed.
//
// Decided as the client outcome, with options put first: print them, on any verdict.
// So the set is no longer chosen by the verdict. It is:
//
//   BLOCKING            every ground the reviewer cites — unchanged, the reviewer refused to sign
//   ANY VERDICT         plus every objection the run tried and could not show it closed
//   A HARDENED VERDICT  plus every point of the review after a repair that hardened it, even one its correction
//                       changed: nothing reviewed that change, so the label keeps a visible ground (`ground`)
//
// The second source is `corrections-applied.json`, the driver's own flag-by-flag observation,
// which already exists and is already written on both the CONDITIONAL and the BLOCKING path. What
// counts as "could not show it closed" is `unresolvedFlags` — decided in corrections-feedforward.mjs
// beside the code that mints the outcomes, so the question has one implementation.
//
// THE UNION IS DEDUPED, AND IT IS A UNION RATHER THAN A CHOICE ON PURPOSE. On BLOCKING the review the
// driver reads at assembly is the RECHECK's rewrite, so a reviewer who dropped an objection it had
// raised — while still refusing on another — would take an unfixed point out of the report with it.
// The pre-corrective observation still holds that row. Both sources, deduped on normalised text.
//
// ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────────────────────────
//
// It renders NOTHING when the reviewer signed and every objection is observably closed — the majority
// of runs. An empty heading would be worse than no section: it tells a lawyer a refusal happened.
//
// Returns "" only when the reviewer SIGNED. A BLOCKING that cites nothing still renders, and that is a
// correction to this function's first cut: the degenerate re-ask upstream makes that state rare, not
// impossible, and rendering nothing would ship a report whose body reads as reviewed while the reviewer
// refused. Silence is the one thing the section exists to prevent. The wording is the sidecar's own,
// already carried at the degenerate branch above — one sentence for one fact, in both places.
//
// ── THE EARLIER REVIEW'S POINTS SAY WHOSE THEY ARE (heading approved 2026-11-04) ──────────────────
//
// A recheck after the correction that saved no review leaves the review from before the correction in
// place, and its verdict stands. Built from it with nothing said, the points read as the reviewer's view of
// the corrected record, and nobody reviewed that record. So the caller passes `earlier` — the file holding
// that review, and whether it is the one in place (earlierReviewNotRechecked) — and the section puts that
// review's points under `CODE_BUILT_SECTIONS.earlierReview`, with that file as a value and no sentence added.
//
// THE HEADING GOES BY THE POINT, NOT BY THE SECTION. A review of a delivery-check repair can be read after that
// recheck and print its points in the same record. It read only the repair, so the correction is still not
// rechecked and the earlier review's points are still the earlier review's; its own points (`later`, from the
// caller) stay above the heading. The lead is chosen by the verdict of the review in place, so it goes where that
// review's points go: under the heading when that is the earlier review, above it when a later one hardened the
// verdict. The points, their outcomes and the leads are untouched, nothing is dropped, and the section's own
// heading stays first for every reader that keys on it. Without `earlier`, not a byte of the section changes.
export function buildReviewerOpenPointsSection(reviewMd, appliedRows = null, { earlier = null } = {}) {   // @internal
  const blocking = parseVerdict(reviewMd) === "BLOCKING";
  const cited = blocking ? parseCorrections(reviewMd) : [];
  const unfixed = (Array.isArray(appliedRows) ? appliedRows : []).filter((r) => r?.ground === true || unresolvedFlags([r]).length);
  const seen = new Set();
  const rows = [];
  for (const r of [...cited, ...unfixed]) {
    // Deduped on normalised text, which catches a row carried by both sources and nothing cleverer. A
    // reviewer who REPHRASES an objection between the two reads prints twice; that is the direction
    // this section is meant to fail in, and a similarity match here would be a filter deciding which
    // of a lawyer's objections the client is allowed to see.
    const key = String(r?.text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  // The earlier review's heading, then where its points come from, as a value: the review's file.
  const fromEarlier = earlier
    ? [CODE_BUILT_SECTIONS.earlierReview, "", ...(earlier.review ? [`*(\`${earlier.review}\`)*`, ""] : [])]
    : [];
  if (!rows.length) {
    // Signed, and nothing left open: no section. This is the majority of runs and it is the whole
    // reason the emptiness is checked AFTER the union rather than by the verdict.
    if (!blocking) return "";
    return [
      "### Reviewer's open questions",
      "",
      ...(earlier?.inPlace ? fromEarlier : []),
      "**The independent reviewer did not sign this report off, and cited no specific defect.** A "
      + "refusal without a named ground is not a finding you can act on — read the reviewer's own note "
      + "before relying on this report.",
    ].join("\n");
  }
  // ── THE QUALIFIER IS PER ROW, BECAUSE THE LEAD CANNOT BE TRUE OF ALL OF THEM ─────────────────────
  //
  // ✕ The first cut of this said, in the lead, "the version you are reading did not change in
  // response." That is a claim the driver can only make about `findings-unchanged` — it checked, and
  // nothing moved. It is FALSE of `not-entity-scoped`, where the flag's prose joined no entity, and of
  // `not-checkable`, where there was no pre-corrective document to compare. Both mean the run does not
  // KNOW whether the point was addressed.
  //
  // Not a rare shape. `on` is optional in the typed call BY DESIGN — "omit it for a flag about the
  // document rather than a finding" — and a reviewer's objections about the summary, the methodology
  // note or the caption have no ordinal to declare. Measured on the entity join with nine
  // document-level flags: 9 of 9 land on `not-entity-scoped`, and 9 of 9 of the same flags land on
  // `findings-unchanged` once an ordinal is declared. So the unchecked shape is the NORMAL one for a
  // whole class of objection, and a single lead asserting the report was worked and did not move would
  // be an over-claim on most of a real section.
  //
  // The lead now says only what is true of every row — the report does not SHOW them closed — and each
  // row carries what the driver actually knows. A row with no outcome at all comes from the review
  // itself on a BLOCKING, where the refusal is the whole fact and a qualifier would add nothing.
  const QUALIFIER = {
    "findings-unchanged": "the report did not change in response",
    "findings-removed": "the finding this named was removed rather than corrected",
    "not-entity-scoped": "the run could not check whether this was addressed",
    "not-checkable": "the run could not check whether this was addressed",
    "line-unchanged": "the line this named was left as written",
    // A narrative section a flag of the review after a repair named, left as written: the shipped words.
    "section-unchanged": "the line this named was left as written",
    "line-removed": "the line this named was removed rather than corrected",
  };
  const item = (r) => {
    const bits = [];
    if (Array.isArray(r.ordinals) && r.ordinals.length) bits.push(`finding ${r.ordinals.join(", ")}`);
    // An outcome nobody has classified takes the unchecked wording, never the checked one — the same
    // direction `unresolvedFlags` fails in, for the same reason.
    // A ground the correction changed keeps its observed outcome in the record and prints as unchecked: no review
    // read the change, so the run cannot say it was addressed, and "did not change" would be false.
    if (r.outcome) bits.push((r.ground === true ? null : QUALIFIER[r.outcome]) ?? "the run could not check whether this was addressed");
    const tail = bits.length ? ` *(${bits.join(" — ")})*` : "";
    return `- ${ADVISORY_TAG["client-fact"]} ${String(r.text).trim()}${tail}`;
  };
  // Two leads for two different facts about the report in the reader's hands. Collapsing them into one
  // sentence would either tell a client the reviewer refused when it signed, or bury a refusal.
  const lead = blocking
    ? "**The independent reviewer did not sign this report off.** The points below are the ones they "
      + "raised and the run could not close. They are open questions for the reviewing lawyer's "
      + "judgment — not conditions for you to satisfy, and not steps that complete the work."
    : "**The independent reviewer raised the points below, and this report does not show them "
      + "closed.** Each was put back to the drafting pass; what the run could establish about each one "
      + "is noted against it. They are open questions for the reviewing lawyer's judgment — not "
      + "conditions for you to satisfy, and not steps that complete the work.";
  // Whose each point is: what the review in place cites is that review's, a row of the first correction is the
  // earlier review's flag, and a row the caller marks `later` is the later review's.
  const isEarlier = (r) => Boolean(earlier) && r.later !== true && (earlier.inPlace === true || !cited.includes(r));
  const earlierItems = rows.filter(isEarlier).map(item).join("\n");
  const otherItems = rows.filter((r) => !isEarlier(r)).map(item).join("\n");
  if (!earlierItems) return [CODE_BUILT_SECTIONS.reviewerOpenPoints, "", lead, "", otherItems].join("\n");
  const others = otherItems ? [otherItems, ""] : [];
  return [CODE_BUILT_SECTIONS.reviewerOpenPoints, "",
    ...(earlier.inPlace ? [...others, ...fromEarlier, lead, ""] : [lead, "", ...others, ...fromEarlier]), earlierItems].join("\n");
}

// PR-9 — the code-built "Answers to your instructions" section, the only-you pattern one lane over:
// synthesis authors the top-level ask_answers[] register in findings.json; the driver renders the
// section FROM it, joined to the frozen _driver/intake-asks.json rows (joinAskToAnswer — the same join
// the lint judges), so the answer the client reads and the answer the lint verifies are one record.
// Frozen-intake order leads (the requester's own sequence); answers that join no frozen ask follow in
// register order (an answer synthesis chose to give is never dropped). Returns "" when no answers.
export function buildAskAnswersSection(askAnswers, intakeAsks) {   // @internal
  const entries = (Array.isArray(askAnswers) ? askAnswers : [])
    .filter((a) => a && typeof a.ask === "string" && a.ask.trim() && typeof a.answer === "string" && a.answer.trim());
  if (!entries.length) return "";
  const used = new Set();
  const out = [];
  // Neutral label, ask VERBATIM after the colon: intake asks are captured as imperatives ("check
  // whether…", "confirm…"), so a sentence-shaped prefix ("You asked us to check …") doubles the verb
  // on nearly every real run — code cannot rephrase the way the retired model-authored contract could.
  //
  // ── — THE ANCHORED DE-DUPLICATION OF THIS FUNCTION'S OWN LABEL ────────────────────────────────
  //
  // THIS IS NOT THE SUBSTITUTION FORBIDS, and the difference is not a matter of degree. The
  // ban list read arbitrary client prose and the trademark register, matching words ANYWHERE in a
  // string, which is how `axis` -> `group` renamed the live mark AXIS Bank inside the report clearing
  // it. This reads ONE field and removes an anchored prefix in the shape of THIS FUNCTION'S OWN LABEL:
  // the words "You asked" at position 0, through the first arrow. Not a vocabulary — a position.
  //
  // Stated exactly, because the difference is the whole review question: it does not require the
  // between-text to equal the label the next line emits, because the delivered doubling does not
  // either — synthesis wrote `You asked: "EU register only." → …` while the code emits
  // `- You asked: EU register only → `. Matching only the code's exact bytes would miss every real
  // specimen. What bounds it instead is POSITION: it cannot fire mid-sentence, it never touches `ask`,
  // and a mark named "You asked" would still have to open the answer AND be followed by an arrow.
  //
  // A joinAskToAnswer GATE WAS CONSIDERED AND REJECTED, so it is not re-proposed each review: the
  // second loop below emits entries that joined NO frozen intake ask, so there is no ask to gate them
  // on, and gating would leave exactly those unstripped. Position is the only bound that covers both
  // loops.
  //
  // WHY IT IS NEEDED AT ALL, given the stages.mjs dictation now says "the answer alone": the dictation
  // governs what a MODEL writes on a FUTURE run, and a prompt is not a guarantee. Every archived
  // findings.json on disk carries the old doubled form permanently — demo's does today —
  // and assembly re-runs over an archived register on resume and on every re-assembly. The author fix
  // stops the doubling being written; this stops it being printed.
  //
  // MOVED THE RULE, AND THIS CALL IS WHAT IS LEFT OF IT. The strip used to be a private copy here,
  // and report-data.json's projection of the SAME register had no copy at all — so one answer shipped
  // two ways, which is the drift report-data's own doctrine exists to prevent. findings-model's
  // stripAskLabel is the one implementation, applied at the register read (validateAskAnswer), so both
  // parsers hand every consumer an already-bare answer. This call stays because buildAskAnswersSection is
  // EXPORTED and can be handed a register that never went through a parser; it is idempotent, and being
  // the same function it cannot drift from the choke point.
  //
  // WHAT IT DOES NOT REACH, stated rather than implied: a report.md already frozen by a previous
  // assembly is never rewritten here — publish reads that file and never calls this.
  const line = (ask, answer) => `- You asked: ${String(ask).trim().replace(/[.\s]+$/, "")} → ${stripAskLabel(answer)}`;
  for (const a of (Array.isArray(intakeAsks) ? intakeAsks : [])) {
    const hit = joinAskToAnswer(a?.ask, entries);
    if (hit && !used.has(hit)) { used.add(hit); out.push(line(a.ask, hit.answer)); }
  }
  for (const e of entries) if (!used.has(e)) out.push(line(e.ask, e.answer));
  return out.length ? `${CODE_BUILT_SECTIONS.askAnswers}\n\n${out.join("\n")}` : "";
}

/**
 * The grouped reasoned negatives, for report.md.
 *
 * report.html has rendered these since: shared ground once as a heading, then one line per member.
 * report.md rendered NONE of it, and for the off-field members it rendered nothing at all — a stronger
 * fact than "the grouping is missing". fullProseOrdinals admits a finding on `band != null || composite >=
 * 3 || level in [A,B]`; an off-field finding is REQUIRED to carry `band == null` (findings-model
 * finding_band_forbidden) and its composite is null on a v4+ record, so it fails all three, gets no
 * ordinal, gets no report-card file, and is dropped by the existsSync filter. Four reasoned negatives
 * about named proprietors were therefore silent on one delivered surface while another rendered them in
 * full — and the standing criterion is that every retrieved close match ends as a finding or a reasoned
 * negative, never as silence.
 *
 * ONE AUTHOR. Both surfaces call reasonedNegativeGroups over the same findings.json and print the typed
 * `net`; nothing here re-summarises anything, so the two cannot disagree. That is the distinction
 * drew — its defect was two AUTHORS of one summary, not one summary appearing on two surfaces.
 *
 * The heading is the group's own `ground` label from findings-model.mjs, not render.mjs's short display
 * heading: one map, in the typed source, rather than a second copy here that drifts from it.
 *
 * THE DIVERGENCE THIS USED TO DEFER IS NOW ONE-COUNTRY-ONLY, AND OWNS IT.
 *
 * What stood here said report.html gives a band-2 negative ONLY a group line while report.md also gives
 * it a full card (because .md cards key on `band != null`), so a coexistence-partner or distinguished
 * finding appears twice in the Markdown — and that changing which findings earn a .md card "belongs to
 * whoever takes that on". is whoever takes that on: the depth ladder IS a change to which findings
 * earn a full card, so the two surfaces' card sets move under it.
 *
 * RULED (§9): on multi-country and worldwide a mark demoted to a group line stops also getting a .md
 * card — `.md` aligns with `.html` and the divergence closes for those marks. On ONE COUNTRY it PERSISTS,
 * deliberately: the byte-identical guarantee for product 4 outranks it, and closing it there would be a
 * change to the delivered report nobody asked for. So the divergence is now one-country-only and owned,
 * rather than general and deferred.
 *
 * This section itself is untouched by the ladder: the grouping is not extended and not re-keyed. The
 * graded entries render in a SIBLING section (buildGradedEntriesSection) using the same line grammar.
 */
export function buildReasonedNegativesSection(findings) {   // @internal
  const { total, groups } = reasonedNegativeGroups(findings ?? []);
  // ZERO IS NOT ABSENCE — the same rule the HTML section states. A run that grouped and found none says
  // so, so a reader never has to guess whether there were no negatives or the grouping never ran.
  if (!total) {
    return `${CODE_BUILT_SECTIONS.reasonedNegatives}\n\nNone. Every retrieved close match on this run is an on-field conflict above — nothing was cleared into this section.`;
  }
  const lines = groups.map((g) => {
    const head = `**${g.ground[0].toUpperCase()}${g.ground.slice(1)}** — ${g.findings.length} mark${g.findings.length === 1 ? "" : "s"}.`;
    const members = g.findings.map((f) => {
      const who = String(f.owner?.name ?? "").trim();
      // The typed net is the sentence. `legal_position` is the fallback for an archived record that
      // predates the net, exactly as the HTML line falls back — never a summary written here.
      const why = String(f.net ?? f.legal_position ?? "").trim();
      return `- **#${f.ordinal} ${f.mark}**${who ? ` — ${who}` : ""}${why ? ` · *${why}*` : ""}`;
    });
    return `${head}\n${members.join("\n")}`;
  });
  return `${CODE_BUILT_SECTIONS.reasonedNegatives}\n\n${lines.join("\n\n")}`;
}

/**
 * Where the review from before the correction stands when the recheck after it saved none, as `{review, inPlace}`: the
 * file holding it, relative to the run, and whether that is the review in place. null when the recheck saved a review,
 * when a review that read the corrected record has replaced it, or when the records cannot be read; each of those
 * builds the open points as they were. Never throws.
 *
 * THE BYTES SAY WHICH REVIEW STANDS, NOT THE CALLS. The recheck's record keeps the sha of the review it found. Those
 * bytes in place mean that review stands, whatever was accepted since: a narrowed review after a repair is accepted and
 * the whole review then put back. Other bytes in place mean another review was saved over it, through the tool or by
 * rewriting the file, and its points are its own. The one such review that did not read the corrected record is a
 * narrowed review that hardened the verdict and stays in place: the earlier review is then the one kept beside it, and
 * the correction's rows are still its flags.
 */
function earlierReviewNotRechecked(P) {
  try {
    const runDir = dirname(P.report);
    const recheck = JSON.parse(readFileSync(driverDir(runDir, CORRECTIVE_RECHECK_FILE), "utf8"));
    if (recheck?.status !== "unread") return null;
    const named = (file) => relative(runDir, file).replace(/\\/g, "/");
    const inPlace = shaOf(P.seniorEyeReview);
    if (inPlace === recheck.reviewSha) return { review: named(P.seniorEyeReview), inPlace: true };
    const narrowed = JSON.parse(readFileSync(paths(runDir).postRepairReview, "utf8"));
    const kept = reviewBeforeRepairPath(runDir);
    return narrowed?.status === "read" && narrowed.whole !== true && inPlace === shaOf(reviewAfterRepairPath(runDir)) && shaOf(kept) === recheck.reviewSha
      ? { review: named(kept), inPlace: false } : null;
  } catch { return null; }
}

/**
 * Read the basis against the record this assembly was built from, and record the outcome: the file, and one
 * run-log row. A run with no basis records nothing. A delivered record that cannot be read is recorded as a
 * failure to look, never as an outcome. Never throws.
 */
export function recordCorrectionsDelivered(P) {   // @internal
  if (!P?.runDir) return null;
  const at = driverDir(P.runDir, CORRECTIONS_DELIVERED_FILE);
  let held = null;
  try { held = JSON.parse(readFileSync(at, "utf8")); } catch { return null; }   // no corrective basis on this run
  if (!Array.isArray(held?.basis)) return null;
  let deliveredDoc = null, reportMd = null;
  try { deliveredDoc = parseFindingsJsonLenient(readFileSync(P.findings, "utf8")); } catch { deliveredDoc = null; }
  try { reportMd = readFileSync(P.report, "utf8"); } catch { reportMd = null; }
  let foldMap = null;
  try { foldMap = readFold(P.runDir)?.map ?? null; } catch { foldMap = null; }
  const rows = deliveredOutcomes({ basis: held.basis, deliveredDoc, foldMap, reportMd });
  const { rows: _rows, error: _error, assembledAt: _assembledAt, ...kept } = held;
  const out = { ...kept, assembledAt: new Date().toISOString(), rows: rows ?? null,
    ...(rows ? {} : { error: "the record the report was built from could not be read, so no correction was compared" }) };
  try { atomicWrite(at, JSON.stringify(out, null, 2) + "\n"); } catch { /* the run-log row below is the record */ }
  try {
    const outcomes = (rows ?? []).reduce((a, r) => (a[r.outcome] = (a[r.outcome] ?? 0) + 1, a), {});
    runLog(P.runDir, rows
      ? { event: "corrections-delivered", ok: true, flags: rows.length, outcomes, reportMdRead: reportMd != null }
      : { event: "corrections-delivered", ok: false, error: out.error });
  } catch { /* a log that cannot be written must not stop the report it describes */ }
  return out;
}

export function assembleReportMd(P, findings, cardOrdinals, { grouped = [], byRight = false } = {}) {   // @internal
  const overviewRaw = existsSync(P.reportOverview) ? readFileSync(P.reportOverview, "utf8") : "---\n---\n";
  let overview = overviewRaw.split(/^#\s+Marks\b/m)[0].replace(/\s*$/, "");   // defensive: overview owns down to # Marks
  // PR-9 (Levels) — the caption budget, enforced at assembly: overall_caption clipped at 3 sentences,
  // overflow MOVED into the Scope-section bucket (motion, never deletion). Recorded for the
  // fold-observability lint row below.
  const folds = [];
  {
    const fc = foldCaption(overview);
    overview = fc.md;
    if (fc.fold) folds.push({ ...fc.fold, surface: "overview:caption" });
  }
  // spec 64 — merge the code-built only-you section into the overview's # Actions block. A model-
  // authored "### Only you can close these" (pre-change prompt, or drift) is REPLACED wholesale —
  // code wins, so the section can never contradict the register the verdict derives from.
  // PR-9 — same pattern for "### Answers to your instructions": code-built from the findings.json
  // ask_answers register joined to the frozen intake asks; an authored section is replaced wholesale.
  try {
    const fdoc = (P.findings && existsSync(P.findings)) ? parseFindingsJsonLenient(readFileSync(P.findings, "utf8")) : null;
    if (Array.isArray(fdoc?.askAnswers)) {
      let intakeAsks = [];
      try { intakeAsks = JSON.parse(readFileSync(paths(P.runDir).intakeAsks, "utf8")).asks ?? []; } catch { /* refless run — register order alone */ }
      const ansSection = buildAskAnswersSection(fdoc.askAnswers, intakeAsks);
      const hasAuthoredAns = /^###\s+Answers to your instructions\b/m.test(overview);
      if (hasAuthoredAns) {
        overview = overview.replace(/^###\s+Answers to your instructions\b[^\n]*\n?[\s\S]*?(?=^###\s|^#\s|$(?![\s\S]))/m, () => (ansSection ? `${ansSection}\n\n` : ""));
      } else if (ansSection) {
        const m = /^#\s+Actions\b[^\n]*\n?/m.exec(overview);
        if (m) {
          // The section OPENS # Actions (the render's hero picks the `ans` bucket wherever it sits,
          // but the .md reads best with the requester's answers first).
          const at = m.index + m[0].length;
          overview = `${overview.slice(0, at)}\n${ansSection}\n\n${overview.slice(at).replace(/^\n+/, "")}`;
        } else {
          overview = `${overview}\n\n# Actions\n\n${ansSection}`;
        }
      }
      overview = overview.replace(/\s*$/, "");
    }
    //, THE SECOND DRIFT PATH — and it produced the same symptom from the other end. The guard was
    // `if (Array.isArray(fdoc?.actions))`, so a run whose findings.json carried NO actions register at
    // all skipped this block entirely and a MODEL-AUTHORED "### Only you can close these" survived
    // verbatim, in whatever shape the model wrote it: no groups, no tags, no relation to the register the
    // verdict derives from. Spec 64 already ruled the section code-built ("code wins, so the section can
    // never contradict the register") — this is that ruling applied to the case it did not cover.
    //
    // WITH NO REGISTER THE SECTION IS REMOVED, not rewritten and not inferred. buildOnlyYouSection("")
    // is the honest answer to "which of these does the code vouch for?" when the answer is none, and
    // reading kinds back out of authored prose is the guess this file's own comment forbids six lines up.
    // A run with no register also has no conditions to bound the email or the verdict, so nothing
    // downstream loses an input it had.
    //
    // THE GATE IS "IS THERE A REGISTER DOCUMENT", NOT "DOES IT DECLARE ACTIONS". A run with a
    // findings.json has a register and the code answers for the section, empty answer included. A run
    // with NO findings.json at all — no synthesis reached, a replay of a shape that predates the
    // register — is not a register saying nothing, it is nothing to compare against, and the overview
    // passes through as it always did.
    //
    // Assembly-time, like the collapse above: no archived report.md is rewritten by this.
    if (fdoc) {
      const section = Array.isArray(fdoc.actions) ? buildOnlyYouSection(fdoc.actions, fdoc.findings) : "";
      const hasAuthored = /^###\s+Only you can close these\b/m.test(overview);
      if (hasAuthored) {
        // Replace the authored subsection body: from its heading to the next ### / # heading or end.
        // (function replacement — an action text containing "$" must never trigger $-patterns)
        overview = overview.replace(/^###\s+Only you can close these\b[^\n]*\n?[\s\S]*?(?=^###\s|^#\s|$(?![\s\S]))/m, () => (section ? `${section}\n\n` : ""));
      } else if (section) {
        // \n? — a bodiless final "# Actions" heading (a run with actions but no 'Checks we ran'
        // results, exactly the shape the overview prompt instructs) has no trailing newline after
        // the trailing-whitespace strip above; requiring one made match() null and threw.
        const m = /^#\s+Actions\b/m.test(overview)
          ? overview.match(/^#\s+Actions\b[^\n]*\n?[\s\S]*?(?=^#\s|$(?![\s\S]))/m)
          : null;
        if (m) {
          // Insert at the END of the # Actions section (before the next top-level heading or EOF).
          const head = m[0].replace(/\s*$/, "");
          overview = overview.replace(m[0], () => `${head}\n\n${section}\n\n`);
        } else {
          overview = `${overview}\n\n# Actions\n\n${section}`;
        }
      }
      overview = overview.replace(/\s*$/, "");
    }
  } catch { /* never-kill: a malformed findings.json leaves the overview untouched (its own gates own that) */ }
  // ── THE REVIEWER'S OPEN POINTS GO TO THE RUN RECORD, NEVER TO THE CLIENT PAGE ─────────────────────
  //
  // Owner ruling, 2026-09-24: reviewer notes never reach the client page, and a report the reviewer still
  // refuses ships with its rating and nothing added. This site used to put the section at the top of the
  // body, under an earlier ruling that asked for open points printed; the client page then opened with
  // the reviewer's objections in the engine's own vocabulary, most of them about wording, while the
  // objections that mattered went unnoticed. The section is still built, from the same review and the
  // same corrective observation, and it is written beside them for the reviewing lawyer. The overview is
  // not touched, so nothing here can reach a surface a client reads.
  //
  // Assembly-time, like every sibling here: no archived report.md is rewritten by this, and a stale file
  // from an earlier assembly of the same run is removed rather than left to be read as current.
  try {
    // T3b — the driver's own flag-by-flag observation rides in beside the review. NEVER-KILL, and the
    // direction matters: an unreadable or absent corrections-applied.json yields `null`, which records
    // the BLOCKING grounds alone. A run that never had a corrective pass (SIGNED first time) has no such
    // file BY DESIGN and has no unfixed objections either.
    let applied = null;
    try { applied = JSON.parse(readFileSync(P.correctionsApplied, "utf8"))?.rows ?? null; }
    catch { /* absent or malformed — the record falls back to the review alone */ }
    // …and the correction after the review of a delivery-check repair, which records its rows beside them. Its
    // points print through the same rule: anything not positively resolved. Which review raised a point stays in
    // the run's own records (_driver/post-repair-review.json); the printed line adds nothing.
    // Where that review hardened the verdict its points are the verdict's grounds, and print even when changed.
    try {
      const doc = JSON.parse(readFileSync(paths(dirname(P.report)).postRepairCorrections, "utf8"));
      const after = doc?.rows;
      if (Array.isArray(after) && after.length) applied = [...(applied ?? []), ...after.map((r) => ({ ...r, later: true, ...(doc.grounds === true ? { ground: true } : {}) }))];
    } catch { /* no correction after a repair on this run */ }
    // …and a review after a repair that was read and never corrected: the run was parked before its one correction,
    // and nothing on a resume repeats it. Its points are not shown closed, so they print through the same rule.
    try {
      const runDir = dirname(P.report);
      const rec = JSON.parse(readFileSync(paths(runDir).postRepairReview, "utf8"));
      if (rec?.status === "read" && !existsSync(paths(runDir).postRepairCorrections)) {
        const rows = (Array.isArray(rec.points) ? rec.points : []).filter((x) => String(x?.text ?? "").trim())
          .map((x) => ({ text: String(x.text), kind: x.kind ?? null, outcome: "not-checkable", later: true }));
        if (rows.length) applied = [...(applied ?? []), ...rows];
      }
    } catch { /* no review after a repair on this run */ }
    // …and where the recheck after the correction saved no review, the earlier review's points are named as its own.
    const openPoints = existsSync(P.seniorEyeReview)
      ? buildReviewerOpenPointsSection(readFileSync(P.seniorEyeReview, "utf8"), applied, { earlier: earlierReviewNotRechecked(P) })
      : "";
    const record = driverDir(dirname(P.report), REVIEWER_OPEN_QUESTIONS_FILE);
    if (openPoints) {
      mkdirSync(dirname(record), { recursive: true });
      writeFileSync(record, `${openPoints}\n`);
    } else {
      rmSync(record, { force: true });
    }
  } catch { /* never-kill: an unreadable review leaves no record here — the verdict still ships on its own path */ }
  const set = new Set(cardOrdinals ?? []);
  // T6 (H8): the.md assembly and the HTML render share ONE adversarial-ordering comparator.
  const sorted = [...(findings ?? [])]
    .filter((f) => set.has(f.ordinal) && existsSync(P.reportCard(String(f.ordinal))))
    .sort((a, b) => compareBlockingPower(a, b, inDispositionMode(findings)));
  const cards = sorted.map((f, i) => {
    let body = readFileSync(P.reportCard(String(f.ordinal)), "utf8").trim();
    // PR-9 (Levels) — "### The read" budget: 2 sentences / ~120 words at a sentence boundary; the
    // overflow MOVES to the head of "### Full detail" under a "Continued read" bullet. Runs BEFORE the
    // group/open stamps (both key on the card head, which the fold never touches).
    const fr = foldCardRead(body);
    if (fr.fold) { body = fr.md.trim(); folds.push({ ...fr.fold, surface: `card:${f.ordinal}` }); }
    // S2 — THE FRAME IS COMPOSED, NOT DICTATED. A card written under the current contract opens at
    // `### Full detail`: its head, `- ord:`, `- group:` and `- source:` come from the record here rather
    // than being typed by the seat out of the same record and re-parsed back out of its typing. See
    // card-frame.mjs for the head rule and why it is pinned to the delivered corpus, not to any wording.
    //
    // EVERY OTHER SHAPE TAKES THE PATH BELOW, UNCHANGED — archived cards, replays, and a drifted seat
    // that types a head anyway. That is the fail-safe direction: drift renders as it does today instead
    // of being handed a second, composed head above its own. carriesOwnFrame() carries the argument.
    if (!carriesOwnFrame(body)) {
      const netNew = String(f.net ?? "").replace(/\s+/g, " ").trim();
      return composeCard(f, body, {
        group: DISPOSITION_GROUP[f.disposition],
        netLine: `- net: ${netNew || "[no one-clause net on this finding's record]"}`,
        open: i === 0,
      });
    }
    // WP-56 A4 — deterministic `- group:` stamp from the finding's disposition (DISPOSITION_GROUP):
    // presentation plumbing, never a rating gate. The model mislabeled a rated conflict `off-field`
    // (VIBRANTE) and the client summary selected on that label. Gated on disposition being present so
    // legacy/archived cards (composite-era findings) pass through byte-identical.
    const group = DISPOSITION_GROUP[f.disposition];
    if (group) {
      body = /^\s*- group:/m.test(body)
        ? body.replace(/^(\s*)- group:[^\n]*$/m, `$1- group: ${group}`)
        : body.replace(/^(##[^\n]*\n(?:\s*- ord:[^\n]*\n)?)/, `$1- group: ${group}\n`);
    }
    // — the one-clause net is STAMPED from the typed record, exactly as `- group:` is, and for the
    // same reason one level up: report.md was the last surface still carrying a SEPARATELY AUTHORED
    // summary of a finding that report.html and report-data.json already rendered from findings.json.
    // One finding had three summaries and only one source of truth; they happened to agree on the case
    // that was checked, and nothing made them.
    //
    // FULL TEXT. Nothing on any surface shortens a judgment sentence — the renderer's 240-character fold
    // was deleted with (2026-08-06) and no cap replaced it; the sentence is bounded by the shape
    // contract instead. Whitespace is collapsed only so the value cannot break the one-line `- key:`
    // shape parseCards keys on.
    //
    // AN ABSENT NET IS LOUD, NEVER BLANK. The v6 parser refuses a findings.json whose finding carries no
    // net (finding_net_missing — it rides the corrective ladder at synthesis), so reaching here without
    // one means the lenient/quarantine path or a down-level record. That card still renders, and it says
    // what is missing: a stamped marker is distinguishable from a filtered-out finding, which has no `##`
    // block in report.md at all. An omitted line would have been the silent-absence bug this file family
    // has now shipped seven times.
    const net = String(f.net ?? "").replace(/\s+/g, " ").trim();
    const netLine = `- net: ${net || "[no one-clause net on this finding's record]"}`;
    body = /^\s*- net:/m.test(body)
      ? body.replace(/^\s*- net:[^\n]*$/m, netLine)
      : body.replace(/^(##[^\n]*\n(?:\s*- ord:[^\n]*\n)?)/, `$1${netLine}\n`);
    // The retired authored line. The prompt no longer asks for it and nothing reads it any more,
    // but a drifted card that still emits one would put two summaries of one finding back into the
    // delivered report.md — so the assembly drops it rather than trusting the prompt to hold.
    body = body.replace(/^\s*- one:[^\n]*\n?/m, "");
    // open the single highest-risk (first) card: insert `- open: true` right after its `## ` / `- ord:` head.
    if (i === 0) body = body.replace(/^(##[^\n]*\n(?:\s*- ord:[^\n]*\n)?)/, `$1- open: true\n`);
    return body;
  });
  // — the reasoned negatives, from the SAME typed source report.html reads. Appended after the
  // cards rather than woven into them: the card set is frozen on `fullProseOrdinals`, and an off-field
  // finding has no card to weave into — that is the whole reason it was silent here.
  // Read from findings.json rather than the `findings` argument so the section sees EVERY finding,
  // including the ones cardOrdinals excluded, which is the set at issue.
  let negatives = "";
  try {
    const fdocN = (P.findings && existsSync(P.findings)) ? parseFindingsJsonLenient(readFileSync(P.findings, "utf8")) : null;
    const all = Array.isArray(fdocN?.findings) && fdocN.findings.length ? fdocN.findings : (findings ?? []);
    negatives = buildReasonedNegativesSection(all);
  } catch { negatives = buildReasonedNegativesSection(findings ?? []); }   // never-kill: the cards still ship
  // §8 — the grouped section, a SIBLING of the reasoned negatives in the same line grammar with a
  // different grouping key. The negatives grouping is not extended and not touched. Empty on one country
  // (nothing is graded to an entry there), so the assembled bytes are unchanged for product 4.
  const groupedSection = grouped.length ? buildGradedEntriesSection(grouped, { byRight }) : "";
  // "LEFT OPEN", the rows the page will draw (left-open-md.mjs), before the cards: the connector serves this file when a
  // reader's assistant asks for the report, and it listed none of them (design, 2026-11-19). Nothing open draws no
  // heading. Assembly-time, like the sections above: no stored report.md is rewritten by this.
  let leftOpen = "";
  try {
    if (P.findings && existsSync(P.findings)) leftOpen = leftOpenSectionOfRun(P.runDir, parseFindingsJsonLenient(readFileSync(P.findings, "utf8")).coverage, { already: overview });
  } catch { /* never-kill: an unreadable record leaves the section out, and the cards still ship */ }
  writeFileSync(P.report, `${overview}${leftOpen ? `\n\n${leftOpen}` : ""}\n\n# Marks\n\n${cards.join("\n\n")}\n`
    + `${groupedSection ? `\n${groupedSection}\n` : ""}${negatives ? `\n${negatives}\n` : ""}`);
  // PR-9 — fold observability: every fold this assembly performed, persisted for the predelivery lint's
  // flag-only row (and for anyone auditing where the assembly moved words). Overwritten per assembly so
  // a repair re-assembly reports ITS folds, not a stale set. Best-effort — a sidecar miss never blocks
  // the report.
  try {
    ensureDriverDir(P.runDir);
    writeFileSync(paths(P.runDir).cardFolds, `${JSON.stringify({ schema: 1, folds }, null, 2)}\n`);
  } catch { /* observability only */ }
  // Whether each reviewer correction reached the record this report was built from: rewritten on every
  // assembly, like the fold record above, so the last assembly's answer stands. Nothing without a basis.
  try { recordCorrectionsDelivered(P); } catch { /* observability only: the report is assembled either way */ }
  return { cards: cards.length, folds };
}

/**
 * Reassemble report.md from the record as it stands, as the first assembly did: the plan made again, each short entry
 * composed again from its finding, and the grouped section built. Returns the plan.
 */
export function reassembleFromTheRecord(P, findings, depth) {   // @internal
  const plan = planWriteUps(findings, depth, safeReadJson(P.bandShape));
  writeShortEntries(P, plan.entrySingles);
  assembleReportMd(P, findings, plan.assembledOrdinals, { grouped: plan.groupedMembers, byRight: plan.byRight });
  return plan;
}
