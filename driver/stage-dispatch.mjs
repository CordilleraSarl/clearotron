// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// stage-dispatch.mjs — how the clearance runs one of its stages: the lane-wedge retry, the model the stage resolves to,
// the dispatch with its message and options, the sweep for strays after it, and the helpers that name a stage's failure.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these functions instead of having them handed in. The
// sweeps' ledger is the one thing that stayed: pipeline.mjs creates it as that module loads and hands it in here.
import { driverDir, driverFileName, ensureDriverDir } from "../shared/driver-dir.mjs";
import { isLiveRecord } from "./band-shape.mjs";
import { bandSizeForStage, ceilingRefusal, derivedLimitSec, limitExceedsCeiling } from "./band-size.mjs";
import { readBestDraft } from "./best-draft.mjs";
import { GRID_SEATS } from "./common-law-receipts.mjs";
import { declinationCallPaths, readDeclinations } from "./declination-tool.mjs";
import { derivedStateOf } from "./derived-state.mjs";
import { DISPATCH_SUFFIX } from "./dispatch-record.mjs";
import { config, resolveModel } from "./driver.config.mjs";
import { citedFindingNumbers } from "./finding-citations.mjs";
import { blankForeignRecordLinks, parseFindingsJsonLenient, salvageRepairTargets } from "./findings-model.mjs";
import { floorDutyArmed, floorDutyBlock, floorDutyBlocksSkip, reconcileFloorDuty } from "./floor-duty.mjs";
import { FOREIGN_HOST_TOKEN, recordBlanking } from "./foreign-record-links.mjs";
import { draftCarryEligible, saidBackOnly, toolWrittenArtifact } from "./gateway.mjs";
import { GOODS_EVIDENCE_AS_WRITTEN_FILE, GOODS_EVIDENCE_FILE, heldBodiesOf } from "./goods-evidence.mjs";
import { note, runLog } from "./log.mjs";
import { nextRefutationSeq, REVIEW_EXCLUSIONS_FILE } from "./narrative-refutation-record.mjs";
import { classifyPlacement, entryUris, parseCarrySurfaces } from "./placement-carry.mjs";
import { placementFloorDecisionLines, placementSetAsideGrounds, placementSetAsideLines } from "./placement-decisions.mjs";
import { readPlacementForm, readPlacementFormInput, writePlacementForm } from "./placement-form-io.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";
import { unionPlacementForm } from "./placement-union.mjs";
import { bandRecordUri, findingUris } from "./record-carry.mjs";
import { modelRecordPath } from "./record-fold.mjs";
import { activeRecordOrigins } from "./record-origins.mjs";
import { stableStringify } from "./register-plan.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { createRepairLedger } from "./repairs.mjs";
import { handResearchAfterReview, handResearchAnswers, researchAnswerKey, runResearchAnswers } from "./research-answers.mjs";
import { addressListLines, writeReviewAddresses } from "./review-addresses.mjs";
import { StageFailure } from "./run-outcome.mjs";
import { atomicWrite } from "./run-record.mjs";
import { clearedSignatures, dispatchRows } from "./seat-attempts.mjs";
import { projectStageInput, readStamp, stageStaleness, writeFindings, writeStamp } from "./stage-freshness.mjs";
import { keepPriorOutput, runLaneStage } from "./stage-runner.mjs";
import { assertEffectiveTier, axisTier, chainEntries, composeFollowup, inquiryRungDirective, paths, REGISTER_ENUMERATE_TOOL, stageInputs, stageOrdinal, STAGES, thinkingFor } from "./stages.mjs";
import { dictatedPaths, findStrayArtifacts, findStrayInTree, findStrayMatterSiblings, matterSiblings, treeSnapshot } from "./stray-artifacts.mjs";
import { handSavedFindings, lastAcceptedCall } from "./synthesis-record.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const safeReadJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/**
 * The floors reconciled against the band shape and the placements now on disk: `{artifact, placements}`, or
 * `{reason}` when they cannot be. Read, never written: `deriveFloorDuty` writes a pass's account from it, and a
 * resumed run's skip reads it (`floorDutyOwedNow`).
 */
export function floorDutyNow(P) {
  const notComputable = (reason) => ({ reason });
  if (!existsSync(P.bandShape)) return notComputable("no band-shape.json — the floors are not on disk to check against");
  if (!existsSync(P.placementModel)) return notComputable("no placements.json (a run predating the structured placement mirror)");
  let floors, placements;
  try {
    const shape = JSON.parse(readFileSync(P.bandShape, "utf8"));
    // ABSENT vs EMPTY, and they are not the same answer. A shape with no floors slice cannot be
    // reconciled and says so; a shape whose floors slice IS empty is a real answer — this band held no
    // live in-class identical record — and reconciles trivially at 0/0.
    const slice = shape?.floors?.in_class_identical_or_near;
    if (!Array.isArray(slice)) return notComputable("band-shape.json carries no floors.in_class_identical_or_near array");
    floors = slice;
  } catch (e) { return notComputable(`band-shape.json unreadable: ${String(e?.message ?? e).slice(0, 80)}`); }
  try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; }
  catch (e) { return notComputable(`placements.json unparseable: ${String(e?.message ?? e).slice(0, 80)}`); }
  return { artifact: reconcileFloorDuty({ floors, placements, setAsideGroundOf: placementSetAsideGrounds(P) }), placements };
}

/**
 * DOES PLACEMENT OWE FLOORS ON THE SHAPE NOW ON DISK? A resumed run derives the band shape afresh, and one derived
 * since the last placement pass can owe more than that pass's floor-duty artifact says: a floor the new shape adds,
 * or a crowded (b) whose row no longer stands. Read from the artifact alone, placement skipped, the duty was derived
 * again straight after it, and the report shipped clamped with the step never asked. Read here as well, placement
 * runs again, and its dispatch-time union tells the step what changed. False where nothing can be reconciled.
 */
export function floorDutyOwedNow(P, name) {   // @internal — driven by its test with a run's own files
  if (name !== "placement-inquiry" || !floorDutyArmed(P.runDir)) return false;
  try { return Boolean(floorDutyBlock(floorDutyNow(P).artifact, { armed: true })); } catch { return false; }
}

/**
 * — THE SAME SET, PRINTED FORWARD INSTEAD OF READ BACKWARD.
 *
 * `recordSynthesisSeam` below computes "what was on the findings surface" AFTER the pass, to work out
 * what was dropped. This computes it BEFORE, so the stage can be handed the list and cite a record by
 * POSITION. The two must agree or `row_index` would point at a different record than the trace blames,
 * so the derivation is written once and called twice — never copied.
 *
 * Best-effort by construction: no placements on disk (a pre-B2 run, a matter with no register layer)
 * means an empty list, `ctx.findingsSurface` stays unset, and the dictation's DECLINATIONS block is
 * absent entirely. A stage handed no list is not ordered to answer one.
 */
export function findingsSurfaceRows(P) {
  try {
    const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
    const text = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
    // THE BAND JOIN, AND IT IS LOAD-BEARING RATHER THAN DECORATIVE. A placement carries no classes and no status. Both of
    // the tool's contradiction refusals rest on exactly those two fields, so a row built from the placement alone would
    // arrive with `classes: []` and `status: null`, every check would find nothing to contradict, and the tool would
    // accept every declination while looking like it was guarding them. A guard that cannot fire is worse than none,
    // because it reads as one. The band record is where the run's own class list and status live.
    const band = new Map();
    try {
      const b = safeReadJson(P.registerNamedBand);
      for (const rec of Array.isArray(b?.enumerated) ? b.enumerated : []) {
        const u = bandRecordUri(rec);
        if (u) band.set(String(u).toLowerCase(), rec);
      }
    } catch { /* an unreadable band leaves the refusals with nothing to rest on; see above */ }
    // THE WRITER IS OWED POSITIONS, NOT RECORDS. A position is one placement entry: an owner's mark with its records.
    // Every entry the write-up carried is owed, whatever its tier: a headline entry, a sheet-2 entry the write-up adopted
    // or kept, and one it promoted. An entry the write-up dropped carries its own ending and is not owed. A finding naming
    // any record of an entry ends it, or one declination of its row, which the report lists once among the set-asides.
    // The row is the entry's first live record, else its first; its records ride with it, and each one's classes and
    // status, for the refusals to read.
    const surfaces = parseCarrySurfaces(text);
    const rows = [];
    for (const e of Array.isArray(placements) ? placements : []) {
      const uris = entryUris(e);
      if (!uris.length || classifyPlacement(e, surfaces).class !== "carried") continue;
      const uri = uris.find((u) => band.has(u) && isLiveRecord(band.get(u))) ?? uris[0];
      const rec = band.get(uri);
      rows.push({
        uri, mark: e?.mark ?? null, owner: e?.owner ?? null, tier: e?.tier ?? null,
        classes: Array.isArray(rec?.classes) ? rec.classes : [],
        status: rec?.status ?? null,
        uris,
        ...(uris.length > 1 ? { members: uris.map((u) => ({ uri: u, mark: band.get(u)?.mark_text ?? e?.mark ?? null,
          classes: Array.isArray(band.get(u)?.classes) ? band.get(u).classes : [], status: band.get(u)?.status ?? null })) } : {}),
      });
    }
    return rows;
  } catch { return []; }
}

/**
 * THE WRITER'S EXCLUSIONS, AS THE REVIEW IS TOLD THEM (ruled 2026-10-29). Every position placement put forward and the
 * writer was handed, at any tier, that ends in a declination rather than a finding: one entry per position, with
 * placement's tier and its whole reason (a borderline entry's competing readings live there), the writer's reason and
 * ground, the position's records for the band tools, and the floors it covers. The review used to be told only the
 * declinations that covered a floor, so a writer's exclusion of a headline candidate off the floors reached it as an
 * absence. Read from the run's files each time a message is built, like placement's decisions.
 *
 * "NONE" IS A CLAIM, SO IT IS EARNED. `state` is "listed", "none", "unreadable" or "no-positions". "none" means every
 * position handed to the writer is ended by a finding; an absent ledger is that answer only then, because a position
 * with no finding and no declination is a decision the record does not hold. An unreadable placements file, ledger or
 * findings file is "unreadable", never "none". "no-positions" is a run KNOWN to have handed the writer no position: its
 * placements file reads and carries none. A missing placements file is not that: placement runs on every clearance,
 * so its record is expected, and a missing one is "unreadable" (ruled 2026-10-30). A finding the report carries ends a
 * position whatever the ledger still holds; a withdrawn one ends only a position the writer never declined.
 *
 * `delivered` is every record the findings the report carries name, `deliveredBy` the ordinal of the finding that carries
 * each, and `findings` each finding's owner and
 * fingerprint, withdrawn ones included, for a later review to establish from the findings themselves which exclusions a
 * finding now delivers and which a changed finding touches; both are null where the findings cannot be read.
 *
 * Each position's `evidence` fingerprints what the run holds of its records, by content (ruled 2026-10-30): each
 * record's band row with the register's answer as it came, the body the run holds for it, and the goods state the
 * writer's list was given. Status, classes and that state are not enough: a record's registered goods can be reworded while all three
 * stay the same, and a body obtained after the full review changes what an exclusion rests on. Only what the run
 * already holds is compared; nothing is fetched for it. IMPURE.
 */
export function writerExclusions(P) {   // @internal — driven by its test with a run's own files
  const empty = (state) => ({ state, positions: [], undecided: 0, delivered: null, deliveredBy: null, findings: null });
  try {
    if (!P?.placementModel || !existsSync(P.placementModel)) return empty("unreadable");
    let placements;
    try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; } catch { return empty("unreadable"); }
    const rows = findingsSurfaceRows(P);
    if (!rows.length) return empty("no-positions");
    const key = (u) => String(normalizeRecordUri(u) ?? "");
    const declined = readDeclinations(P.runDir);
    if (existsSync(declinationCallPaths(P.runDir, 0).ledger) && !declined.present) return empty("unreadable");
    let delivered, withdrawn, findings, deliveredBy;
    try {
      const found = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"))?.findings ?? [];
      // Each delivered record with the finding that carries it, as the findings the review reads number it.
      deliveredBy = new Map([...findingUris(found.filter((f) => f?.disposition !== "withdrawn")).entries()].map(([u, v]) => [key(u), v?.ordinal ?? null]));
      delivered = new Set(deliveredBy.keys());
      withdrawn = new Set([...findingUris(found.filter((f) => f?.disposition === "withdrawn")).keys()].map(key));
      // Each finding as the writer numbered it. A later review's comparison and a ground's "finding 9" both read the
      // writer's numbering, and from the delivery seam on findings.json is the folded, renumbered record (record-fold.mjs).
      const modelAt = modelRecordPath(P.runDir, P.findings);
      const own = modelAt === P.findings ? found : (parseFindingsJsonLenient(readFileSync(modelAt, "utf8"))?.findings ?? []);
      findings = own.map((f) => ({ ordinal: f?.ordinal ?? null, owner: String(f?.owner?.name ?? f?.owner_name ?? (typeof f?.owner === "string" ? f.owner : "") ?? ""),
        fp: createHash("sha256").update(JSON.stringify(f ?? null)).digest("hex").slice(0, 16) }));
    } catch { return empty("unreadable"); }
    // The goods state each record was given on the writer's list, where the list carries one.
    const goodsOf = new Map();
    for (const r of safeReadJson(paths(P.runDir).declinationSpec)?.rows ?? [])
      for (const m of [r, ...(Array.isArray(r?.members) ? r.members : [])]) if (m?.uri) goodsOf.set(key(m.uri), m.goods ?? null);
    const bandOf = new Map();
    for (const row of rows) for (const m of (Array.isArray(row?.members) && row.members.length ? row.members : [row])) bandOf.set(key(m?.uri), m);
    const entryOf = new Map();
    for (const e of Array.isArray(placements) ? placements : []) for (const u of entryUris(e)) entryOf.set(key(u), e);
    const floors = safeReadJson(P.bandShape)?.floors?.in_class_identical_or_near;
    const floorIds = new Set((Array.isArray(floors) ? floors : []).map((f) => key(f?.record_id)).filter(Boolean));
    const positions = [];
    let undecided = 0;
    for (const row of rows) {
      const members = [...new Set((Array.isArray(row?.uris) && row.uris.length ? row.uris : [row?.uri]).map(key).filter(Boolean))];
      if (members.some((u) => delivered.has(u))) continue;
      const d = declined.byUri.get(key(row?.uri));
      if (!d) { if (!members.some((u) => withdrawn.has(u))) undecided++; continue; }
      const e = entryOf.get(key(row?.uri)) ?? null;
      positions.push({ uri: key(row.uri), members, mark: e?.mark ?? row.mark ?? null, owner: e?.owner ?? row.owner ?? null,
        tier: e?.tier ?? row.tier ?? null, borderline: e?.borderline === true, reason: e?.reason ?? null,
        writerReason: d.reason ?? null, grounds: d.grounds ?? null, floors: members.filter((u) => floorIds.has(u)),
        // The findings its ground cites, as the ledger recorded them, or read from the ground of an entry written before
        // the ledger recorded them: the writer's own number, never a name.
        cites: Array.isArray(d.cites) ? d.cites : citedFindingNumbers(d.grounds, { bare: false }) });
    }
    // WHAT EACH EXCLUSION RESTS ON, read for its own records only.
    const band = new Map();
    for (const r of safeReadJson(P.registerNamedBand)?.enumerated ?? []) if (r?.record_id) band.set(key(r.record_id), r);
    const bodies = heldBodiesOf(P.runDir, positions.flatMap((p) => p.members));
    for (const p of positions) p.evidence = createHash("sha256").update(stableStringify(p.members.map((u) => ({ uri: u,
      record: recordContent(band.get(u) ?? bandOf.get(u)), body: bodies.get(u) ?? null, goodsState: goodsOf.get(u) ?? null }))))
      .digest("hex").slice(0, 16);
    return { state: undecided ? "unreadable" : positions.length ? "listed" : "none", positions, undecided, delivered, deliveredBy, findings };
  } catch { return empty("unreadable"); }
}

// A band row as the record it stands for: the register's fields and its answer as it came (`raw`, which holds the goods
// wording on every register). What the run adds to it (the questions that found it, how a search scored it, the
// screen's reading) is left out, so the same record found by another question reads alike. The band keeps the first
// copy of each record (named-band.mjs mergeNamedBands), so a later search does not swap its answer.
const SEARCH_SIDE = new Set(["screen", "relevance_score", "match"]);
const recordContent = (row) => (row && typeof row === "object"
  ? Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_") && !SEARCH_SIDE.has(k))) : null);

/** One position's entry, as the review reads it. PURE. */
export const writerExclusionLine = (x) => `- ${x.mark ?? "(unnamed)"}${x.owner ? ` — ${x.owner}` : ""} (${x.members.join(", ")}): `
  + `placement: ${x.tier ?? "(no tier)"}${x.borderline ? ", borderline" : ""} — ${x.reason ?? "(no reason recorded)"}; `
  + `excluded by the writer as ${x.writerReason}: ${x.grounds}`
  + (x.floors.length ? `; covers the floor${x.floors.length > 1 ? "s" : ""} ${x.floors.join(", ")}` : "")
  + (x.revisedCites?.length ? revisedCitesNote(x.revisedCites) : "");

// THE CONNECTION A GROUND RECORDS, NAMED (2026-10-30). An exclusion whose ground cites a finding that changed after the
// full review is a decision the later review checks, and its entry says which finding. Model-facing: the later review
// reads it, and only on such an entry.
export const revisedCitesNote = (ords) => `; that ground cites ${ords.length === 1 ? `finding ${ords[0]}`
  : `findings ${ords.slice(0, -1).join(", ")} and ${ords[ords.length - 1]}`}, which changed after the full review`;

/** A position the full review read as excluded that a finding now delivers, as a later review reads it. PURE. */
export const withdrawnExclusionLine = (x) => `- ${x.mark ?? "(unnamed)"}${x.owner ? ` — ${x.owner}` : ""} (${(x.members ?? [x.uri]).join(", ")}): excluded at the full review, now delivered as a finding`;

/** What the full review was shown, kept for the reviews after it; and what the last review was shown, for its flags. */
export const reviewExclusionsPaths = (P) => ({ full: paths(P.runDir).reviewExclusionsFull, shown: driverDir(P.runDir, REVIEW_EXCLUSIONS_FILE) });

/**
 * THE LIST A REVIEW IS GIVEN, and the record of it. The full review gets every exclusion. A later review (the recheck
 * after a correction, the review after a delivery-check repair) starts a fresh session, so it is given every exclusion
 * too, each once, in two parts (ruled 2026-10-30). First the decisions it is checking: the exclusions whose own
 * sentence, placement's reason or tier, or records' evidence changed since the full review, the ones touched by a
 * finding about the same owner that changed, the ones whose ground cites a finding that changed (its entry names it),
 * the ones its own flags named, and the ones a finding now delivers. Then,
 * under the ruled reference sentence, the other accepted exclusions with their recorded grounds and ids, a floor's
 * among them: it reconsiders one only where a change it identified affects its grounds. With no full review on record,
 * or a record it cannot read, a later review gets the whole list as decisions to check.
 * An exclusion the full review read is said to be delivered only where a current finding names one of its records,
 * never because it left the list.
 *
 * THE RESEARCH THE RUN OBTAINED AFTER THE FULL REVIEW rides beside them (ruled 2026-10-30): every answer the run did not
 * hold, with that text, when the full review's list was built, written to `research-after-review.md`. No record links an
 * answer to an exclusion, so none is joined to one here, and no exclusion is counted changed because research changed:
 * the reviewer judges the connection from the answers and the grounds. The review's own questions are its check, not
 * evidence the writer's grounds rest on, so they are left out.
 *
 * `{state, review, lines, reference, research, changedOnly}`; the review's flags are checked against
 * `review-exclusions.json`. IMPURE.
 */
export function writerExclusionBlock(P, { review = "full", named = [] } = {}) {   // @internal
  const x = writerExclusions(P);
  const at = reviewExclusionsPaths(P);
  const held = runResearchAnswers(P.runDir, { except: reviewSession });
  let shown = x.positions, reference = [], changedOnly = false, withdrawn = [], research = 0;
  if (review !== "full" && x.state !== "unreadable") {
    const full = safeReadJson(at.full);
    if (Array.isArray(full?.positions)) {
      const before = new Map(full.positions.map((p) => [p.uri, p]));
      const names = new Set(named.map((u) => String(normalizeRecordUri(u) ?? "")));
      const touched = changedFindingOwners(full.findings, x.findings);
      const revised = changedFindingOrdinals(full.findings, x.findings);
      const restsOn = (p) => (Array.isArray(p.cites) ? p.cites : []).filter((o) => revised.has(o));
      const changed = (p, b) => !b || b.writerReason !== p.writerReason || b.grounds !== p.grounds || b.reason !== p.reason
        || b.tier !== p.tier || Boolean(b.borderline) !== Boolean(p.borderline) || (b.evidence ?? null) !== (p.evidence ?? null);
      const checked = (p) => names.has(p.uri) || changed(p, before.get(p.uri)) || touched.has(ownerKey(p.owner)) || restsOn(p).length > 0;
      shown = x.positions.filter(checked).map((p) => (restsOn(p).length ? { ...p, revisedCites: restsOn(p) } : p));
      reference = x.positions.filter((p) => !checked(p));
      const now = new Set(x.positions.map((p) => p.uri));
      withdrawn = full.positions.filter((p) => p?.uri && !now.has(p.uri) && (p.members ?? [p.uri]).some((u) => x.delivered?.has(u)))
        // WITH THE FINDING THAT NOW DELIVERS IT, so a flag the review places on it reads as a flag on that finding
        // (narrative-refutation-record.mjs listedWithdrawnPositions). The line the review reads is unchanged.
        .map((p) => ({ ...p, ordinals: [...new Set((p.members ?? [p.uri]).map((u) => x.deliveredBy?.get(u)).filter(Number.isInteger))] }));
      changedOnly = true;
      // A record from before the answers were kept is read by time: what the run obtained after it was written.
      const had = Array.isArray(full.research) ? new Set(full.research) : null;
      research = handResearchAfterReview(P.runDir, held.filter((a) => (had ? !had.has(researchAnswerKey(a)) : a.ts > String(full.ts ?? ""))));
    }
  }
  if (review === "full") handResearchAfterReview(P.runDir, []);
  try {
    ensureDriverDir(P.runDir);
    const record = JSON.stringify({ ts: new Date().toISOString(), review, state: x.state, positions: x.positions, findings: x.findings,
      research: held.map(researchAnswerKey), shown: shown.map((p) => p.uri), reference: reference.map((p) => p.uri),
      withdrawn: withdrawn.map((p) => ({ uri: p.uri, members: p.members ?? [p.uri], ordinals: p.ordinals })) }, null, 2) + "\n";
    if (review === "full") atomicWrite(at.full, record);
    atomicWrite(at.shown, record);
  } catch (e) { runLog(P.runDir, { event: "review-exclusions-write-failed", reason: String(e?.message ?? e).slice(0, 160) }); }
  return { state: x.state, review, lines: [...shown.map(writerExclusionLine), ...withdrawn.map(withdrawnExclusionLine)],
    reference: reference.map(writerExclusionLine), research, changedOnly };
}
/** A session of the review itself, under its stage key, a retry of it, or an experiment arm's key for it. PURE. */
const reviewSession = (s) => /-narrative-refutation(?=$|-)/.test(String(s ?? ""));
/** An owner's name as two records of it are compared: trimmed, spaced once, in any case. PURE. */
const ownerKey = (o) => String(o ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** The ordinals of the findings that changed between two readings, in the writer's numbering: added, removed or
 *  rewritten. Empty where either reading is missing, so a record from before findings were kept changes nothing. PURE. */
export function changedFindingOrdinals(before, after) {   // @internal
  const out = new Set();
  if (!Array.isArray(before) || !Array.isArray(after)) return out;
  const a = new Map(before.map((f) => [f?.ordinal, f])), b = new Map(after.map((f) => [f?.ordinal, f]));
  for (const o of new Set([...a.keys(), ...b.keys()])) if (a.get(o)?.fp !== b.get(o)?.fp) out.add(o);
  return out;
}
/** The owners of those findings, on either reading. PURE. */
export function changedFindingOwners(before, after) {   // @internal
  const out = new Set();
  const a = new Map((before ?? []).map((f) => [f?.ordinal, f])), b = new Map((after ?? []).map((f) => [f?.ordinal, f]));
  for (const o of changedFindingOrdinals(before, after))
    for (const f of [a.get(o), b.get(o)]) if (ownerKey(f?.owner)) out.add(ownerKey(f.owner));
  return out;
}

// `--from <stage>` forces re-run of the named stage AND every downstream stage, while earlier stages still
// skip via idempotency. Keyed on STAGE_ORDER (axis suffix stripped); never deletes files.
export function forceFromActive(ctx, name) {
  if (ctx?.forceFrom == null) return false;
  const o = stageOrdinal(name);
  return o >= 0 && o >= ctx.forceFrom;
}

// On an idempotency SKIP we don't re-run, so we recover the WINNING attempt's session key + served model from
// the persisted per-stage telemetry (the last success in _driver/<label>.jsonl). Without this, a stage that
// originally won on a cross-provider fallback would, after a resume, report the PRIMARY model + an undefined
// key — and the verdict-gated corrective re-synthesis would then cold-cache + model-mismatch (review finding).
//
// CODE-SIDE winners have NO session (2026-07-29 hardening): the code-side saturation-probe writes its
// stageLog row with `key: <minted string>` + modelUsed "code:execute-plan", but that key never existed as a
// model session. When the executor lane is unavailable on a resume (dispatch off / no adapter) the AGENT
// member's skip would recover that phantom key and hand it to the warm escalation lane, which then tries to
// warm-resume a session no engine ever opened. A code-side winner therefore recovers its TRUE model (the
// telemetry stays honest in the skip event) with key:null — the same "resumed-past axis" contract
// runSaturationProbeCodeSide already declares (null unitKey ⇒ escalation/envelope use their code/fresh lanes).
/**
 * Is a stage's output on disk valid to reuse? A said-back refusal is a duty the pass said back and recorded, not
 * an invalid output (gateway.mjs saidBackOnly): a pass that stood on one is not run again on resume. A floor it
 * left open is the floor duty's to re-run, above. @internal
 */
export function outputStands(def, out) {
  if (!def?.validate) return true;
  const v = def.validate(out, readFileSync(out, "utf8"));
  return v.ok || saidBackOnly(v.reason);
}

export function recoverWinningAttempt(runDir, label) {   // @internal
  try {
    const lines = readFileSync(driverDir(runDir, `${label}.jsonl`), "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const a = JSON.parse(lines[i]);
      if (!a.fail && a.key) {
        const model = a.modelUsed ?? a.model;
        if (String(model ?? "").startsWith("code")) return { key: null, model };
        return { key: a.key, model };
      }
    }
  } catch { /* no prior telemetry — fall back to caller defaults */ }
  return null;
}

// ── stage contracts (2026-07-30 review round) ──────────────────────────────────────────────────────
// _driver/stage-contracts.json records, PER STAGE, the output contract the prompt THIS driver
// dispatched holds the artifact to (declared on the stage def, e.g. clearance-variants
// `contract:{romanization:1}`). Written at DISPATCH time only — a skipped stage never gains one — so
// it is evidence of PROMPT VINTAGE, which is the only honest gate for a new validation rule:
//   - crash-resume: the skip check re-validates the completed output BEFORE any dispatch, marker
//     absent ⇒ the legacy artifact keeps passing under the rules it was minted under (no forced
//     re-run, no P2 staleness cascade, no paid recompute);
//   - replay over archives: nothing ever dispatches, marker absent ⇒ verdicts never flip;
//   - fresh/forced/corrective dispatch under this code: marker written first, so the output (and
//     every later re-validation of it) is held to the new floor.
// The instructed-scope sentinel must NEVER stand in for this: it is written at intake on every
// current-era run — archived and parked included — so it proves vintage, not freshness, and
// gating a new rule on it was proven (2026-07-30 review) to flip real archived verdicts and to
// force-re-run completed stages on resume. Idempotent merge; non-fatal like every _driver sidecar.
function recordStageContract(runDir, name, contract) {
  try {
    const p = paths(runDir).stageContracts;
    let cur = {};
    try { cur = JSON.parse(readFileSync(p, "utf8")) ?? {}; } catch { /* first write */ }
    const next = { ...cur, [name]: { ...(cur[name] ?? {}), ...contract } };
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(`${p}.tmp`, JSON.stringify(next, null, 2) + "\n");
    renameSync(`${p}.tmp`, p);
    runLog(runDir, { event: "stage-contract", stage: name, contract });
  } catch (e) { note(`stage-contract write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
}

// Run one named stage on ONE model (single tier; runStage owns the same-model retry budget). opts:
// {model, thinking, force, extra, followup, sessionKey, agent, trigger, maxRetries}. Returns runStage's
// result (or a {skipped} marker). The cross-model fallback lives in stage() below — this is the leaf executor.
//
// `followup` is the cache-cheap re-run path: when set, we send ONLY that message (NOT def.message) under the
// stage's existing session key. Since the key is unchanged, the engine RESUMES the prior session — the model
// keeps its full prior context (warm cache: cache-READ, not a cold re-write) and is asked to defend/adjust
// rather than redo from scratch. CRITICAL: a followup must keep the SAME model the session was created with —
// cache is model-specific, so switching models cold-caches the whole thread and defeats the point. `extra`
// is the older append-to-original-prompt path, kept for callers that still re-issue.
/**
 * — THE PARK CONTINUES THE WORK, IT DOES NOT RESTART IT.
 *
 * A recovery park re-enters pipeline() from the top and re-dispatches the failed stage on its BASE session
 * key with `def.message(ctx)` — a cold re-commission. gateway.mjs mints `-rerunN` keys INSIDE one dispatch
 * and nothing carries them across a park; the key that would have to be resumed is not even recoverable
 * (recoverWinningAttempt only returns rows that SUCCEEDED, and a parked ladder has none). Measured on the
 * 2026-08-05 R2 run: both common-law halves converged to 1 and 2 violations, and the park restarted them
 * at 21 and 13, three times, until the defect budget ended the run.
 *
 * This hands the dispatch back the best draft the run has produced for this stage, with the outstanding
 * violations as the correction. It is the SAME repair the in-run merge-gate remedy already performs —
 * same dictated hint, same edit contract — extended to the one lane that never had it.
 *
 * WHAT IT REFUSES, and why each refusal is the point:
 *   · only a PATCH-class rejection is carried (draftCarryEligible → WARM_ELIGIBLE_RE). The tokens meaning
 *     "the sweep did not run" are excluded there deliberately: telling a model "do NOT redo the sweep"
 *     over an unsearched grid would manufacture a clean read over a grid nobody searched.
 *   · a draft written by a kill-class attempt was never preserved at all (gateway.mjs), so it can never be
 *     carried here — the artifact half of the never-patch-a-torn-file rule.
 *   · a draft is restored only when it BEATS what is on disk, scored by the stage's OWN validator so
 *     "better" is one comparison and not two rules. A tie restores nothing and only supplies the correction.
 *   · the violations are RE-DERIVED from the document that is now on disk — never replayed from the stored
 *     fail string, which described a file that may since have been superseded.
 *
 * Returns {message, from, quantity} or null. Never throws: a carry that cannot be built falls through to
 * today's cold dispatch, exactly.
 */
function planDraftCarry(ctx, label, out, def) {
  const P = ctx.paths;
  try {
    const best = readBestDraft(P.runDir, label);
    if (!best || !def?.validate || !draftCarryEligible(best.fail)) return null;
    let onDisk = null;
    if (existsSync(out)) {
      const v = def.validate(out, readFileSync(out, "utf8"));
      if (v.ok) return null;                       // already valid — the skip above should have taken it
      onDisk = Number.isFinite(v.quantity) ? v.quantity : null;
    }
    const restore = onDisk === null || best.quantity < onDisk;
    if (restore) copyFileSync(best.path, out);
    const v2 = def.validate(out, readFileSync(out, "utf8"));
    if (v2.ok) return null;
    const outstanding = Number.isFinite(v2.quantity) ? `${v2.quantity} item(s)` : "a small number of items";
    // — DERIVED FROM THE ARTIFACT, NOT FROM THE LABEL, the same source the lint-repair rung uses.
    // Six stages' outputs are now written by the driver off a typed call, and their seats hold neither
    // `Write` nor `Edit`; a carry that ordered a hand-write would be handing them the superseded path.
    // Keyed on `out` so a seventh conversion inherits it with its TOOL_WRITTEN_ARTIFACTS row.
    const toolWritten = toolWrittenArtifact(out);
    const message = repairFollowup("*:draft-carry", {
      out, restore, outstanding, reason: v2.reason, toolWritten,
    });
    runLog(P.runDir, { event: "draft-carry", stage: label, from: basename(best.path), restored: restore,
      quantity: Number.isFinite(v2.quantity) ? v2.quantity : null, priorOnDisk: onDisk,
      reason: String(v2.reason).slice(0, 200) });
    note(`[${label}] continuing the best draft (${outstanding} outstanding${restore ? `, restored over an on-disk draft at ${onDisk ?? "unscored"}` : ""}) instead of re-commissioning the stage`);
    return { message, from: best.path, quantity: Number.isFinite(v2.quantity) ? v2.quantity : null };
  } catch (e) {
    note(`[${label}] draft carry unavailable (${String(e?.message ?? e).slice(0, 100)}) — cold dispatch as before`);
    return null;
  }
}

function clearedForSeat(runDir, label) {
  try { return clearedSignatures(dispatchRows(readFileSync(driverDir(runDir, `${label}.jsonl`), "utf8"))); }
  catch { return []; }
}

/**
 * The context a stage's message is composed from. The review's floor check lists placement's standing decisions, and
 * they are read here, from the run's files, each time its message is built: the review, its recheck, the delivery
 * loop's whole review after a repeated placement pass and a review dispatched from a rebuilt context all read the
 * decisions as they stand then, never a copy an earlier pass left on the context, and never "(none)" from a context
 * that never set one. The reading step and the writer read placement's accepted set-asides the same way. Every
 * other stage composes from the context as it is.
 */
/**
 * The address list a whole review is handed, written where its recording tool reads it: the writer's accepted record
 * and the findings file together, so an ordinal from either numbering resolves, and the accepted narrative's sections.
 * IMPURE.
 */
function reviewAddressesFor(P) {
  const accepted = lastAcceptedCall(P.runDir);
  return writeReviewAddresses(P.runDir, { records: [accepted?.findings, safeReadJson(P.findings)], narratives: [accepted?.narrative],
    seq0: nextRefutationSeq(P.runDir) });
}
export function messageCtxFor(name, ctx) {   // @internal — driven by its test
  if (!ctx?.paths) return ctx;
  // The review is also pointed at the research behind the findings' use checks, where the writer's record wrote it.
  if (name === "narrative-refutation") return { ...ctx, placementFloorDecisions: placementFloorDecisionLines(ctx.paths),
    writerExclusions: writerExclusionBlock(ctx.paths, { review: "full" }),
    reviewAddressLines: addressListLines(reviewAddressesFor(ctx.paths)),
    researchChecks: ctx.paths.researchChecks && existsSync(ctx.paths.researchChecks) ? ctx.paths.researchChecks : null };
  // The reading step and the writer are told placement's accepted set-asides the same way, read when the message is built.
  if (name === "register-digest") return { ...ctx, placementSetAsides: placementSetAsideLines(ctx.paths) };
  // The writer is also handed the research this run's earlier stages and attempts got (research-answers.mjs), written to
  // the run folder when the message is built: none on a run that has asked nothing yet, whose message is unchanged.
  // A sandbox arm reproducing a FIRST attempt hands on nothing: its copy holds the run's own answers under this stage's
  // key, which a first attempt in a run never has (`researchHandOff`, set by the experiment).
  if (name === "synthesis") return { ...ctx, placementSetAsides: placementSetAsideLines(ctx.paths),
    researchAnswered: ctx.run && ctx.researchHandOff !== false ? handResearchAnswers(ctx.paths.runDir, stageSessionKey(ctx, name), { ofRun: true }) : 0,
    // The findings an earlier attempt saved, handed on as a file (synthesis-record.mjs): none on a first attempt, and none
    // in a sandbox arm, whose copy holds no saved findings.
    savedSynthesis: handSavedFindings(ctx.paths.runDir) };
  return ctx;
}

/** A stage's session key, which its retries extend with `-rerun<n>`. One statement, read where a stage is dispatched. */
export const stageSessionKey = (ctx, name, keyAxis = "") => `clearance-${ctx.run.slug}-${ctx.run.codename}-${name}${keyAxis}`;   // @internal

/**
 * Was the stage `label` itself dispatched in this run? Its dispatch record is written as its turn starts, and its attempt
 * journal as each attempt ends; either says the stage ran here. IMPURE (lists `_driver/`).
 */
function stageWasDispatched(runDir, label) {
  let names = [];
  try { names = readdirSync(driverDir(runDir)); } catch { return false; }
  const journal = driverFileName(`${label}.jsonl`);
  const dispatched = driverFileName(`${label}.attempt`);
  return names.some((n) => n === journal || (n.startsWith(dispatched) && n.endsWith(`.${DISPATCH_SUFFIX}`)));
}

async function stageOnce(name, ctx, opts = {}) {
  return runLaneStage(CLEARANCE_LANE, name, ctx, opts);
}

/**
 * One clearance dispatch, as the shared stage runner runs it (stage-runner.mjs). The runner owns the skeleton both
 * lanes share; everything below is the clearance's own and is reached by no Knockout stage: `--from` and forced
 * reruns, the floor duty that blocks a skip, the winning attempt recovered on a skip, the output contract and the
 * placement form, the follow-up, carried draft and refresh message, the model tiers and their check, the time limit
 * derived from the band and its ceiling refusal, and the document-growth trip.
 */
function clearanceDispatch(def, name, ctx, opts) {
  const P = ctx.paths;
  const out = def.out ? def.out(P, ctx.axis) : undefined;
  const tier = ctx.axis ? axisTier(ctx.axis) : {};
  const label = name + (ctx.axis ? `:${ctx.axis}` : "");
  const model = opts.model ?? def.model ?? tier.model;
  const trigger = opts.trigger ?? "fresh";

  // crash-resume / idempotency: skip if the output already exists and validates — unless explicitly forced or
  // selected by --from. `--from X` re-runs X..end even when their outputs are still valid.
  const forced = opts.force || forceFromActive(ctx, name);
  // P2 — a changed upstream artifact invalidates its consumers. The skip used to ask only "does my output
  // exist and self-validate?", so a resume that recomputed an upstream stage still shipped every consumer's
  // stale output (copper-vault, 2026-07-21). The dependency map is stages.mjs `stageInputs` — already
  // declared, already logged per stage; this consults it. Keyed on CONTENT, so a pure crash-resume (no
  // input bytes changed) still skips exactly as cheaply as before.
  const declaredInputs = () => stageInputs(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly });
  // The register picture the dispatch is handed, taken as it is composed (below) and journalled on its row.
  let derivedState = [];
  return {
    runDir: P.runDir, label, out, trigger,
    selector: resolveModel(model),
    // The caller's word that this is a followup: a FRESH session (A-1), journalled on the row beside `warm`.
    followup: opts.followup != null,
    stageInputs: declaredInputs,
    freshness: () => {
      // AN OUTPUT ITS STAGE MADE WITH NO RECORD OF WHAT IT READ IS NOT REUSED, as in the Knockout. A stage records what it
      // read when it succeeds, so where the stage itself was dispatched and its output has no record, the stage stopped
      // between writing the output and recording it, or ran before the record existed. Its freshness is unknown, so the
      // stage runs again. The register answers it holds are not bought again: the executor reuses every answer the run
      // holds to the same question. An output another step wrote, as the merge of the research halves writes the whole
      // research output, was never this stage's to record, and is reused as before.
      const unrecorded = !forced && Boolean(out) && existsSync(out) && !readStamp(P.runDir, label) && stageWasDispatched(P.runDir, label);
      return forced ? { stale: false, changed: [] }
        : unrecorded ? { stale: true, reason: "no record of the inputs it was produced from", changed: [] }
        : stageStaleness(P.runDir, label, declaredInputs());
    },
    reusable: (freshness) => {
      // ── — AN UNDISCHARGED FLOOR DUTY IS PART OF "VALID" ──────────────────────────
      //
      // The stage's own validator and the delivery floor disagreed about one placement pass, and a parked run
      // fell into the gap: on resume the stage skipped as "present and valid" while the floor called that same
      // pass's duty undischarged. The seat was never dispatched again, so the duty became permanently
      // undischargeable and the run spent every remaining stage travelling toward a failure it was already
      // doomed to. Reconciled toward the stricter side — the predicate lives in floor-duty.mjs and is CALLED,
      // never copied, so the two judgements cannot drift apart again.
      const dutyBlocksSkip = !forced && (floorDutyBlocksSkip(P.runDir, name) || floorDutyOwedNow(P, name));
      if (dutyBlocksSkip) {
        note(`[${label}] NOT skipped — its floor duty is undischarged, so its output is not valid to reuse; `
          + "re-running so the seat can place the outstanding floor(s) or name them with a ground "
          + "(the placement form unions, so nothing already answered is lost)");
        runLog(P.runDir, { event: "stage-floor-duty-rerun", stage: label });
      }
      if (!forced && !dutyBlocksSkip && !freshness.stale && out && existsSync(out) && outputStands(def, out)) return true;
      return false;
    },
    reused: () => {
      // recover the winning key + served model so a later warm-resume (corrective re-synthesis / verdict re-check)
      // targets the attempt that ACTUALLY produced this output, not the base key on the primary model.
      const won = recoverWinningAttempt(P.runDir, label);
      (ctx.skippedStages ??= []).push(label);   // V4-1: the lint receipt states which artifacts this delivery inherited
      // `won ? won.key : …` (NOT `won?.key ?? …`): a recovered CODE-SIDE winner carries key:null on purpose —
      // falling back to opts.sessionKey there would re-mint the phantom session the null exists to suppress.
      return { model: won?.model ?? resolveModel(model),
        result: { ok: true, skipped: true, sessionKey: won ? won.key : opts.sessionKey, model: won?.model ?? model } };
    },
    beforeDispatch: () => {
      // The stage is DISPATCHING (never on the skip): record the output contract this code's prompt
      // holds the artifact to, BEFORE the model runs, so a crash mid-stage still re-validates the partial
      // output under the rules it is being minted under. See recordStageContract's doc block.
      if (def.contract) recordStageContract(P.runDir, name, def.contract);
      // — THE PLACEMENT FORM IS ON DISK BEFORE THE SEAT IS ASKED ANYTHING, and it is written at the SAME
      // choke point every dispatch funnels through: the main path, the stale-repair path and the frame-reopen
      // path all reach the seat through here, and three separate pre-dispatch writes would be three chances
      // to disagree about what the seat was handed.
      //
      // ORDER MATTERS AND IT IS THE FAIL-CLOSED WAY ROUND (the lesson): the era stamp lands first, above,
      // so a form write that fails leaves a stamp saying a form was required and no form to fill — a named,
      // loud state — rather than no stamp at all, which would silently disarm the whole arm on exactly the
      // run it governs.
      //
      // A re-dispatch re-unions rather than blanking: the prior accumulator is the input, so the seat opens
      // the file already holding every tier it has placed so far, and a cold retry starts from the work
      // rather than from nothing. That is the R1 cure, one dispatch earlier than the wall rescue.
      if (name === "placement-inquiry" && def.contract?.placementForm) {
        try {
          const input = readPlacementFormInput(P.runDir);
          const priorForm = readPlacementForm(P.runDir);
          const u = unionPlacementForm({ rows: priorForm.rows, set_aside: priorForm.set_aside }, null, input);
          writePlacementForm(P.runDir, u.form);
          runLog(P.runDir, { event: "placement-form-written", trigger, rows: u.total,
            settled: u.settled, carried: u.carried, seatRows: u.seat_rows, unresolved: u.unresolved, setAside: u.set_aside,
            selectable: u.form.generated_from?.selectable_records ?? null });
        } catch (e) {
          note(`placement-form write failed: ${e.message} — the stamp is already armed, so the absence is loud rather than silent`);
        }
      }
    },
    // PR-4 (compute-don't-author, D5) — the prior output lands in _history/<ts>-<trigger>/ before every in-place
    // overwrite (corrective / followup / escalation / frame-reopen / lint-repair / verdict-recheck / coverage-closure /
    // envelope / stale-repair / …), and compare.mjs starts working the moment history is populated. The 2026-07-28
    // postmortem run's superseded narrative drafts were UNRECOVERABLE — only sizes/shas survived in telemetry. Never for
    // a shadowed --experiment: its ctx.paths already point at the sandbox, and the canonical run must stay byte-identical.
    snapshot: trigger === "experiment" ? null : (reason) => snapshotOutputs(ctx, name, reason),
    dispatch: () => clearanceRunStageOptions({ def, name, ctx, opts, out, tier, label, model, trigger, keepDerivedState: (d) => { derivedState = d; } }),
    rowExtra: () => (derivedState.length ? { derivedState } : {}),
    // P2 — record WHAT this output was produced from, so a later resume can tell whether it still holds.
    stamp: () => { if (out) writeStamp(P.runDir, label, declaredInputs(), { project: projectStageInput }); },
    after: (r, { priorSize }) => documentGrowthTrip({ r, P, out, label, trigger, priorSize }),
    result: (r) => ({ ...r, model }),
  };
}

const CLEARANCE_LANE = { stages: STAGES, prepare: clearanceDispatch };

/** The `runStage` options of one clearance dispatch, composed after its output was copied aside. May throw the ceiling refusal. */
function clearanceRunStageOptions({ def, name, ctx, opts, out, tier, label, model, trigger, keepDerivedState }) {
  const P = ctx.paths;
  const keyAxis = ctx.axis ? `-${ctx.axis}` : "";
  // A-1 — followup/freshMessage COMPOSE, they no longer REPLACE.
  //
  // Both branches open a FRESH engine session (a new stage() call is attempt 1, and `resumeRef` is passed
  // only on a warm retry — `gateway.mjs`), so the patch text used to be the entirety of what a corrective
  // pass ever saw: no methodology pointer, no `opts.extra`, no pointer to the stage's own inputs. The old
  // comment here read "followup → resume the existing session with ONLY the follow-up (warm cache)" — the
  // design was sound on that premise and the premise was false. See the block above composeFollowup in
  // stages.mjs for the trace and the measured cost.
  //
  // The task order is deliberately NOT restored: `def.message(ctx)` stays out, because re-commissioning
  // the stage fights the followup's own "do NOT redo it". freshMessage (doc-44 — a standalone message on a
  // fresh session, dispatched as any fresh stage is: its one model, with the gateway's own retries) gets
  // the same composition for the same reason: it is equally a session with nothing in it.
  //
  // The declared inputs are filtered to what is ON DISK here, not in stages.mjs — that module is a pure
  // prompt table with no filesystem reach. An input missing from the line is an OPTIONAL input this run
  // never produced, which is the "or state why not" half of the contract.
  //: a caller-supplied followup/freshMessage always wins — the in-run remedies (the connotation
  // merge gate, coverage closure, frame reopen) carry a warm session and a better-targeted correction.
  // The carry fills the gap BEHIND them: a cold re-dispatch that would otherwise re-commission the stage
  // from def.message(ctx) and throw away everything the parked cycle achieved. It runs AFTER the snapshot,
  // because it may restore a better draft over the output.
  // — WHAT THIS RUN HAS ALREADY CORRECTED FOR THIS SEAT. Read from `_driver/<seat>.jsonl`, the
  // same per-attempt record the acceptance criterion is written against, so the fix and its test
  // bind to one authority. Best-effort by construction: no log, an unreadable log or a damaged line
  // yields an empty list and the followup is byte-identical to what it was before.
  const carry = (opts.followup == null && opts.freshMessage == null && out)
    ? planDraftCarry(ctx, label, out, def) : null;
  const patch = opts.followup ?? opts.freshMessage ?? carry?.message ?? null;
  const message = patch != null
    ? composeFollowup(name, ctx, {
      followup: patch,
      extra: opts.extra ?? null,
      inputs: stageInputs(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly }).filter((f) => f && existsSync(f)),
      // — the run's own attempt record is the authority on what it has already corrected, and it
      // is read HERE because this is the one site that composes a followup. NEVER-KILL: an unreadable
      // or absent seat log yields no constraint and the dispatch is exactly what it was before.
      cleared: clearedForSeat(P.runDir, label),
      // The review after a delivery-check repair names the files that repair changed; every other dispatch
      // passes nothing and keeps its own inputs line.
      changedInputs: opts.changedInputs ?? null,
      // The reading step's and the writer's fresh sessions are given placement's accepted set-asides as they stand,
      // except a narrow repair: it fixes only the faults or objects it names, and the general order to check each
      // ground would widen it. Its inputs, the decisions file among them, are named as for any other.
      // The review holds no set-asides, and its context records the exclusions its full review was shown, so a
      // follow-up of it does not build one: that would move the record the reviews after it are compared with.
      decisions: NARROW_REPAIR_TRIGGERS.has(trigger) || name === "narrative-refutation" ? null : (messageCtxFor(name, ctx)?.placementSetAsides ?? null),
    })
    : (def.message(messageCtxFor(name, ctx)) + (opts.extra ? `\n\n${opts.extra}` : ""));
  // Every stage runs as the forwarding agent (derived from the queue location). An explicit opts.agent wins.
  const execAgent = opts.agent ?? ctx.agent;
  // thinking: ONLY Anthropic models get a --thinking token; a cross-provider model (gpt/gemini) NEVER does, so
  // it uses its own configured reasoning default. The Anthropic thinking tokens ("medium"/"adaptive"/"low"/"off")
  // are meaningless to gpt/gemini and risk a spurious rejection → a false fallthrough. This holds even when a
  // caller pins opts.thinking (e.g. a corrective resume of a fallback-won stage threads the primary's thinking).
  // opts.thinking still wins: a corrective resume threads the tier the ORIGINAL attempt ran at, and under an
  // A/B arm that value already carries the override — re-reading the env here would let a mid-run change
  // silently split one stage's attempts across two tiers.
  const effThinking = opts.thinking ?? thinkingFor(name, def, tier);
  const thinking = resolveModel(model).startsWith("anthropic/") ? effThinking : undefined;
  // corruption 4b — the haiku+adaptive guard, on the EFFECTIVE pair this dispatch is about to send.
  // `assertTierSanity()` runs once at run start over the static stage table, so it cannot see a pairing
  // assembled here from a runtime override: CLEAROTRON_STAGE_THINKING, a caller-pinned opts.thinking, or an
  // `--experiment --model haiku` over an axis whose tier is adaptive. Haiku 4.5 rejects adaptive and
  // bounces to sonnet, so those are exactly the dispatches that would measure sonnet and log haiku.
  // Evaluated on `effThinking`, not `thinking`: the anthropic gate above nulls the tier for a
  // cross-provider model, and a guard that reads the nulled value would go blind on the same overrides.
  assertEffectiveTier(label, { model, thinking: effThinking });
  // ── THE TIME LIMIT IS DERIVED FROM THE BAND THIS DISPATCH IS HANDED ─────────────────────────────
  //
  // `def.timeoutSec` was a constant chosen once against a band nobody recorded beside it, and on a
  // dense matter the two band-reading stages died AT their walls having written nothing. The base is
  // still the stage's own number; what the band decides is how far above it this dispatch may go. A
  // band at or under the reference returns the base untouched, so nothing already verified moves.
  const dispatchBand = bandSizeForStage(name, P);
  const derivedLimit = derivedLimitSec(def.timeoutSec, dispatchBand);
  // REFUSED BEFORE A SEAT IS DISPATCHED, not after the wall. A limit past the ceiling is a prediction
  // that this stage will be killed; starting it spends the whole prediction to arrive where the refusal
  // already is, and the refusal NAMES the band size, which is the finding a killed attempt never gives.
  if (limitExceedsCeiling(derivedLimit.sec)) {
    const reason = ceilingRefusal(name, derivedLimit);
    runLog(P.runDir, { event: "stage-input-over-ceiling", stage: name,
      inputBytes: derivedLimit.inputBytes, derivedLimitSec: derivedLimit.sec });
    throw new StageFailure(name, reason, undefined, { failClass: "deterministic" });
  }
  runLog(P.runDir, { event: "stage-limit-derived", stage: name, base: def.timeoutSec,
    inputBytes: derivedLimit.inputBytes, derivedLimitSec: derivedLimit.sec, basis: derivedLimit.basis });
  // The register picture this dispatch is handed, by content (derived-state.mjs), so a replay can tell whether it is
  // handed the same one. Never throws; [] when the stage's context reaches no derivation.
  keepDerivedState(derivedStateOf(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly }));
  return {
    agent: execAgent,
    message,
    model,
    thinking,
    // opts.sessionKey names the key a prior run won on (winning-key hardening), so a followup's records sit
    // beside it; else the canonical base key. No engine resumes by key (A-1): a followup is fresh either way.
    sessionKey: opts.sessionKey ?? stageSessionKey(ctx, name, keyAxis),
    timeoutSec: derivedLimit.sec ?? def.timeoutSec,
    derivedLimit,               // recorded on every attempt row: the size it was derived from, and the number
    stallSec: def.stallSec,     // per-stage stall override (heavy stages); undefined → global CLEAROTRON_STALL_MS
    expectFile: out,
    validate: def.validate,
    runDir: P.runDir, bandSize: dispatchBand,
    // ── — THE PRESENTING SIDE, RECOMPOSED PER ATTEMPT ────────────────────────────────────────
    //
    // A stage that declares `refreshCtx` is saying its dispatch text depends on state the run CHANGES
    // between attempts. The stage supplies the ctx change; this site composes the message, so a stage
    // never has to reach for its own `message` function.
    //
    // ONLY WHEN THERE IS NO FOLLOWUP PATCH. A followup is a composed correction aimed at a named defect;
    // replacing it with a re-presented base would discard the correction and re-run the turn that
    // produced it.
    //
    // It NARROWS what the seat is ASKED, never what the tool ACCEPTS: the spec sidecar stays frozen, so a
    // seat answering something it was no longer asked about is served from the ledger rather than refused
    // as out-of-list — and `still_open` keeps naming everything genuinely open.
    ...(patch == null && typeof def.refreshCtx === "function"
      ? { refreshMessage: () => def.message(messageCtxFor(name, def.refreshCtx(ctx))) + (opts.extra ? `\n\n${opts.extra}` : "") }
      : {}),
    // The caller's word that this is a followup: a FRESH session (A-1), journalled on every attempt row. At its
    // hard wall it takes the same one extended retry as any dispatch (gateway.mjs warmHardWallStop).
    followup: opts.followup != null,
    // copper-lattice re-route: a supplemental-lane register unit never sees register_enumerate — its
    // judgment additions ride register_propose_supplemental (contract-gated so frozen pre-flag resumes
    // keep the legacy lane; the band_block_unplanned validator is the backstop either way).
    ...(name === "register-unit" && ctx.registerPlan?.contract?.supplemental_lane
      ? { excludeTools: [REGISTER_ENUMERATE_TOOL] } : {}),
    ...(opts.maxRetries != null ? { maxRetries: opts.maxRetries } : {}),
    // The correction this dispatch is, when it is one: its save may add the finding for an excluded position its flags
    // name. Only the correction's own dispatches carry it.
    ...(opts.correction ? { correction: opts.correction } : {}),
  };
}

// PR-4 — document-growth tripwire, keyed on TRIGGER so it covers BOTH growth loops (the lint-repair
// "re-emit the COMPLETE updated file" cycle AND the skeptic/refutation corrective loop — the 2026-07-28 postmortem run's
// overview grew 7.1×/6.1× under the first, its narrative 62KB→102KB under the second; a lint-scoped
// tripwire would have missed the largest grower). A repair defends or corrects — it does not ADD: growth
// beyond 35% or 20KB over the prior output is a document-growth-trip event that joins the
// reasoning-integrity tripFlags (internal observability). It NEVER withholds delivery (reasoning-
// tripwires posture: a trip forces the delivered status to carry the gap, nothing more).
// What a trip MEANS changed when the corrective prompts moved to targeted edits (repair-contract.mjs):
// a repair-shaped trigger — lint-repair, the corrective followups, a settlement flush — now instructs the
// model to patch the lines the correction names and leave every other line byte-identical, so a document
// that grows past these thresholds under one of them is evidence the edit direction was ignored and the
// file retyped whole. That is a regression to alarm on, not the known noise it used to be. The triggers
// that legitimately ADD are the stated exception (coverage-closure and the frame-reopen source sweep each
// append a Negative-results row per variant × channel) and still read as ordinary growth.
function documentGrowthTrip({ r, P, out, label, trigger, priorSize }) {
  if (r.ok && out && priorSize != null && priorSize > 0 && trigger !== "fresh" && trigger !== "skip") {
    try {
      const afterSize = statSync(out).size;
      const growthBytes = afterSize - priorSize;
      const growthPct = Math.round((100 * growthBytes) / priorSize);
      if (growthBytes > 20 * 1024 || growthPct > 35) {
        runLog(P.runDir, { event: "document-growth-trip", stage: label, trigger,
          before: priorSize, after: afterSize, growthBytes, growthPct });
        note(`[${label}] document-growth-trip (${trigger}): ${priorSize} → ${afterSize} bytes (+${growthPct}%) — flagged for the reviewer, never withheld`);
      }
    } catch { /* observability only */ }
  }
}

// ── Lane-wedge whole-stage retry (teal-bastion 2026-06-15) ─────────────────────────────────────────
// gateway.runStage reclassifies a 0-token (never-admitted) timeout to `lane_wedge` — the serial gateway command
// lane was saturated (the all-agent heartbeat sweep + concurrent spawns), NOT a provider problem. Since the
// lane, not the model, is what jammed, the remedy is time: wait for it to clear and re-dispatch the whole
// stage, bounded. Per-attempt timeouts are NEVER shortcut. This is one of the three things that carry
// recovery (with the same-model retry ladder and the rate-limit postpone) now that the model-failover chain
// is deleted — nothing here changed with it; the env names keep CHAIN for compatibility.
// The retry count and the backoff were settable and nothing ever set them; step 3 made them the
// constants below.
const LANE_WEDGE_CHAIN_RETRIES = 2;   // step 3 — was a knob; no environment ever set it
const LANE_WEDGE_BACKOFF_MS = 60000;   // step 3 — was a knob; no environment ever set it
const laneWedgeSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── — A DOCUMENT NOBODY DICTATED IS A DOCUMENT NOBODY VALIDATED ─────────────────────────────────
// One R2 run dir was published carrying an 18 KB "Common-Law Findings Report" at a path no stage ever
// dictated, beside the 36 KB one that was — a reader cannot tell them apart by name, and the stray is
// the stale one. Nothing downstream could see it, because the run dir contents were never compared to
// the set of dictated artifacts.
//
// LOGS. Never deletes, never fails a run, never gates. Deleting a file a model wrote destroys evidence
// about that stage's behaviour, and failing the run turns a cosmetic defect into a lost clearance. Each
// stray is reported ONCE per run — it persists for every later stage, and a line per stage would bury
// the signal it exists to raise. A sweep that throws is swallowed whole: this must never be able to
// cost a run anything.
const strayReported = new Map();
// — the doctrine tree as it was when this run first looked. One snapshot per run dir; anything
// that appears after it appeared because a stage wrote it.
const doctrineBefore = new Map();
const readTreeDir = (d) => readdirSync(d, { withFileTypes: true });
function sweepDoctrineTree(ctx, stageName) {
  try {
    const P = ctx?.paths;
    const root = config.skillsDir;
    if (!P?.runDir || !root) return;
    if (!doctrineBefore.has(P.runDir)) { doctrineBefore.set(P.runDir, treeSnapshot(root, readTreeDir)); return; }
    const seen = strayReported.get(`${P.runDir}::doctrine`) ?? new Set();
    strayReported.set(`${P.runDir}::doctrine`, seen);
    for (const f of findStrayInTree(doctrineBefore.get(P.runDir), treeSnapshot(root, readTreeDir))) {
      if (seen.has(f)) continue;
      seen.add(f);
      // LOUD, and it names the tree rather than the file alone: a reader who has not met this defect
      // needs to know that the thing written to is the driver's doctrine INPUT, not scratch.
      note(`[doctrine-write] ${f} appeared under CLEAROTRON_INSTRUCTIONS_DIR (${root}) during this run — the doctrine `
        + `tree is an INPUT and nothing in a clearance has cause to write to it. First seen after ${stageName}; left in place.`);
      runLog(P.runDir, { event: "doctrine-write", stage: stageName, file: f, root });
    }
  } catch { /* a hygiene sweep must never be able to affect a run */ }
}

// — the STUDIO ROOT at its immediate-child level. Same shape as the doctrine sweep
// above and for the same reason: snapshot once, diff after each stage, say it loudly, never touch it.
// A matter directory that appears while a run is in flight was not created by that run — on the codex
// engine with the sandbox bypassed, a stage wrote its real output into a sibling whose slug was one
// letter off, and nothing said so until a human compared two directory listings by eye.
const matterBefore = new Map();
function sweepMatterSiblings(ctx, stageName) {
  try {
    const P = ctx?.paths;
    const root = config.studioRoot;
    if (!P?.runDir || !root) return;
    const own = basename(dirname(P.runDir));                 // this run's own matter directory
    if (!matterBefore.has(P.runDir)) { matterBefore.set(P.runDir, matterSiblings(root, readTreeDir)); return; }
    const seen = strayReported.get(`${P.runDir}::matter`) ?? new Set();
    strayReported.set(`${P.runDir}::matter`, seen);
    for (const { name, nearMiss } of findStrayMatterSiblings(matterBefore.get(P.runDir), matterSiblings(root, readTreeDir), { own })) {
      if (seen.has(name)) continue;
      seen.add(name);
      note(`[stray-matter] ${name} appeared under the studio root during this run${nearMiss ? ` and is ONE EDIT from this run's own matter "${own}"` : ""}`
        + ` — a clearance creates no matter directory but its own. First seen after ${stageName}; left in place.`
        + (nearMiss ? " A stage may have written outside its run directory; check it before reading its contents as a real matter." : ""));
      runLog(P.runDir, { event: "stray-matter", stage: stageName, name, nearMiss, own, root });
    }
  } catch { /* a hygiene sweep must never be able to affect a run */ }
}
function sweepStrayArtifacts(ctx, stageName) {
  sweepDoctrineTree(ctx, stageName);
  sweepMatterSiblings(ctx, stageName);
  try {
    const P = ctx?.paths;
    if (!P?.runDir) return;
    const seen = strayReported.get(P.runDir) ?? new Set();
    strayReported.set(P.runDir, seen);
    const entries = readdirSync(P.runDir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    for (const s of findStrayArtifacts(entries, dictatedPaths(P, { halves: GRID_SEATS, axes: ctx?.axes ?? [] }), { runDir: P.runDir })) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      note(`[stray-artifact] ${s.name} — ${s.why}. First seen after ${stageName}; left in place.`);
      runLog(P.runDir, { event: "stray-artifact", stage: stageName, name: s.name, why: s.why });
    }
  } catch { /* a hygiene sweep must never be able to affect a run */ }
}

// ── THE GOODS EVIDENCE AS THE WRITER HAD IT (goods-evidence.mjs GOODS_EVIDENCE_AS_WRITTEN_FILE) ─────────────────────
//
// The delivery check compares a finding that says its goods are cut with the goods evidence the writer was given. That
// evidence is derived again with every band merge, and the first merge of a resumed pass reads the record bodies the
// run holds by then: a record the writer had as a cut search answer read as an official record, and the check found no
// outcome for a record it had handed to the repair, or no longer found a claim the repair left standing.
//
// So the evidence a cold dispatch of the writer is given is kept, as it stood when the dispatch began, once the stage
// has returned a record. A writer that skipped wrote nothing new and leaves the copy as it was. A followup, the delivery
// check's own repair among them, corrects a record written on the copy already kept, so it leaves the copy too: the
// check after that repair compares the corrected findings with what they were first written on. A writer dispatched
// with no evidence leaves no copy, so none can describe an earlier writer.
//
// The text of the evidence a cold writer dispatch is given, null where it is given none, and undefined where no copy is
// to be kept. Never throws.
export function goodsEvidenceForTheWriter(name, ctx, opts = {}) {   // @internal — driven by its test
  if (name !== "synthesis" || opts.followup || !ctx?.paths?.runDir) return undefined;
  try { return readFileSync(driverDir(ctx.paths.runDir, GOODS_EVIDENCE_FILE), "utf8"); } catch { return null; }
}
/** Keep the evidence `goodsEvidenceForTheWriter` read, once the writer's stage returned a record it wrote. Never throws. */
export function keepGoodsEvidenceAsWritten(ctx, r, evidence) {   // @internal — driven by its test
  if (evidence === undefined || !r?.ok || r.skipped) return;
  const at = driverDir(ctx.paths.runDir, GOODS_EVIDENCE_AS_WRITTEN_FILE);
  try {
    if (evidence == null) rmSync(at, { force: true });
    else { ensureDriverDir(ctx.paths.runDir); atomicWrite(at, evidence); }
  } catch (e) {
    note(`[synthesis] the goods evidence the writer was given could not be kept (${String(e?.message ?? e).slice(0, 100)}) — the delivery check reads the evidence as it stands`);
  }
}

export async function stage(name, ctx, opts = {}) {
  const writersEvidence = goodsEvidenceForTheWriter(name, ctx, opts);
  let wedgeCycles = 0;
  for (;;) {
    const r = await stageWithChain(name, ctx, opts);
    if (r.ok || r.fail !== "lane_wedge" || wedgeCycles >= LANE_WEDGE_CHAIN_RETRIES) {
      sweepStrayArtifacts(ctx, name);
      keepGoodsEvidenceAsWritten(ctx, r, writersEvidence);
      await afterLateSynthesisSave(name, ctx, r);
      return r;
    }
    wedgeCycles++;
    note(`[${name}] command-lane wedge — the stage timed out with zero progress (saturated lane). Waiting ${Math.round(LANE_WEDGE_BACKOFF_MS / 1000)}s for it to clear, then re-dispatching (${wedgeCycles}/${LANE_WEDGE_CHAIN_RETRIES}); full per-attempt timeouts preserved.`);
    try { runLog(ctx.paths.runDir, { event: "lane-wedge-retry", stage: name + (ctx.axis ? `:${ctx.axis}` : ""), cycle: wedgeCycles, max: LANE_WEDGE_CHAIN_RETRIES }); } catch { /* telemetry best-effort */ }
    await laneWedgeSleep(LANE_WEDGE_BACKOFF_MS);
  }
}

// Dispatch a stage on THE model its definition resolves to. One model, one dispatch — everything below
// this line is the retry ladder inside runStage (same-model attempts, the one 1.5×-extended timeout shot,
// warm patch, backoff), the lane-wedge re-dispatch in stage() above, and the rate-limit postpone.
//
// It used to iterate a model-failover chain here (primary → same-family fallback → Azure → Google, advancing
// on a transient-infra failure). That chain is DELETED. It had never run: chainEntries returned
// exactly one entry for all 19 stages on both shipped engines, so the second rung, the `-fbN` fallback
// session key, the `failover` event and the `chain-exhausted` event were all unreachable. It was deleted
// rather than armed — see driver.config.mjs for the reasoning. The retry ladder is now the whole, honest
// failure story: below it a stage FAILS, loudly, and the run parks or reports.
//
// followups and explicitly model-pinned calls still delegate straight to stageOnce, on their own model. The
// reason given for followups was a resumed session's model-specific cache, which a fresh session does not have.
async function stageWithChain(name, ctx, opts = {}) {
  if (opts.followup || opts.model) return stageOnce(name, ctx, opts);
  const [entry] = chainEntries(name, ctx.axis);
  if (!entry) return {};   // no model resolves (a register-unit dispatched with no axis) — fails as before
  const { model, thinking } = entry;
  const r = await stageOnce(name, ctx, { ...opts, model, thinking });
  // On a SKIP, stageOnce already recovered the WINNING model/key from telemetry into r — do NOT clobber it
  // with this call's model/thinking. On a fresh success, this call's model IS the winner.
  return r.ok && !r.skipped ? { ...r, model, thinking } : r;
}

/**
 * A COVERED PART'S FAILURE IS NAMED WHERE IT IS THROWN (parts-not-completed.mjs). Runs `fn`, and a StageFailure it
 * throws is named as `part`, so the run-level catch, once the recovery is spent, records the part as not completed and
 * delivers without it instead of ending the run. A rate limit is not a failure and is left to its postpone; a failure
 * a throw site already named keeps its name.
 */
export async function asPartNotCompleted(part, fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof StageFailure && !e.rateLimited && !e.notCompletedPart) e.notCompletedPart = part;
    throw e;
  }
}

export function must(r, name) {
  //: the ladder's own count rides the throw — the stage knew the exact number, the catch would
  // otherwise have to read it back out of a prose reason.
  if (!r.ok) throw new StageFailure(name, r.fail ?? "failed", r.resetsAt, { quantity: r.quantity });
  return r;
}

// A3 — last-resort QUARANTINE for the synthesis findings.json. Reached ONLY after stage()'s full retry ladder
// (incl. the A2 corrective hints) has failed, so it never short-circuits a fixable run. It fires ONLY for a
// PER-FINDING shape defect (an `invalid_file:…:finding_*` token — NOT a top-level `findings_*`/unparseable
// failure) and ONLY when a lenient re-parse still yields >= 1 valid finding. In that case it drops+RECORDS the
// malformed finding(s) (run.jsonl `quarantine` event + a `_quarantine.json` sidecar — never silent) and lets
// the run reach publish (which renders the valid findings via the lenient parse + a loud banner, and BLOCKS
// the client export). findings.json on disk is left INTACT (forensics; no data-path mutation). Anything else —
// a top-level defect, or nothing salvageable — fails the run exactly as before. One bad object never silently
// suppresses a real conflict, and never silently kills a ~$40 run.
export async function quarantineSynth(r, ctx, name) {
  if (r.ok) return r; if (foreignRecordLinksBlanked(r, ctx, name)) return { ...r, ok: true, fail: undefined, repaired: "foreign-record-links-blanked" };
  // A6: a max_tokens-named content fault wraps the underlying validator token — strip the wrapper so a
  // per-finding shape defect on a ceiling-cut turn still reaches the lenient-salvage lane.
  const fail = String(r.fail || "").replace(/^max_tokens_no_output:/, "");
  const eligible = /^invalid_file:/.test(fail) && /:finding_[a-z]/.test(fail) && !/:findings_/.test(fail);
  if (eligible && existsSync(ctx.paths.findings)) {
    try {
      const lenient = parseFindingsJsonLenient(readFileSync(ctx.paths.findings, "utf8"));
      let reemitAttempted = false;
      const marks = lenient.quarantined.map((q) => q.mark);
      const targetKey = marks.slice().sort().join("|").slice(0, 120) || "findings";
      if (lenient.quarantined.length) {
        // Repair-first A4 (2026-07-05): before any terminal, ONE warm single-artifact re-emit naming
        // ONLY the quarantined finding objects and their exact parse errors — the whole-file corrective
        // ladder already ran; what's left is a per-object shape miss the model fixes reliably when the
        // defect is named. Needs quarantined objects, NOT survivors (a one-finding file whose only
        // object is malformed is the most repairable shape of all). The stage validator re-judges
        // strictly; a pass IS the repaired stage result.
        const ledger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(ctx.run.runDir, { log: (o) => runLog(ctx.run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const reemitMax = 1;
        if (r.sessionKey && ledger.canAttempt("finding-corrective-reemit", targetKey, { max: reemitMax })) {
          reemitAttempted = true;
          runLog(ctx.paths.runDir, { event: "finding-reemit", stage: name, marks, errors: lenient.quarantined.map((q) => String(q.error ?? "").slice(0, 80)) });
          note(`[${name}] ${marks.length} finding object(s) failed the strict parse — one warm single-artifact re-emit naming exactly those objects`);
          const followup = repairFollowup("synthesis:finding-reemit", { findings: ctx.paths.findings, quarantined: lenient.quarantined });
          const rr = await stage(name, ctx, { force: true, sessionKey: r.sessionKey, model: r.model,
            thinking: r.thinking, trigger: "finding-reemit",
            followup: followup + stageCharter(name, ctx.depth, ctx.framework) });
          ledger.record("finding-corrective-reemit", targetKey, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: reemitMax });
          if (rr.ok) return rr;
        }
      }
      // ── — THE ACTIONS REGISTER GETS THE SAME LEG, because it was reaching this lane already ──
      //
      // `eligible` above admits any `finding_[a-z]` token, and `finding_action_key_unknown` matches it.
      // So an ACTION defect has always entered here — into a lane whose only repair material is the
      // malformed FINDING objects. With none of those, the re-emit above never fired, the terminal
      // below never fired, and the stage exhausted: a paid run died after the whole corrective ladder
      // with the defect nameable and the seat never asked. Measured before this leg existed:
      //   res = { ok:false, failedStage:"synthesis", terminalKind:"exhausted",
      //           reason:"invalid_file:…/findings.json:finding_action_key_unknown:bogus_key" }
      //
      // A naming coincidence decided a code path. `finding_*` and `finding_action_*` are different
      // namespaces that share a prefix, and the author was already hand-excluding one neighbour
      // (`!/:findings_/`) — this is the one that was missed. The fix is not a tighter regex: it is that
      // the lane can repair what it admits.
      //
      // Same shape as the findings leg and deliberately so: ONE warm re-emit, naming exactly the
      // rejected objects and their exact errors, ledgered under its OWN key so an action repair and a
      // finding repair cannot spend each other's single attempt.
      if (!lenient.quarantined.length && lenient.actionsQuarantined.length) {
        const bad = lenient.actionsQuarantined;
        const actionKey = bad.map((q) => `${q.id ?? q.index}`).sort().join("|").slice(0, 120) || "actions";
        const ledger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(ctx.run.runDir, { log: (o) => runLog(ctx.run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const actionReemitMax = 1;
        if (r.sessionKey && ledger.canAttempt("action-corrective-reemit", actionKey, { max: actionReemitMax })) {
          reemitAttempted = true;
          runLog(ctx.paths.runDir, { event: "action-reemit", stage: name, ids: bad.map((q) => q.id),
            kinds: bad.map((q) => q.kind), errors: bad.map((q) => String(q.error ?? "").slice(0, 80)) });
          note(`[${name}] ${bad.length} action object(s) failed the strict parse — one warm single-artifact re-emit naming exactly those objects`);
          const followup = repairFollowup("synthesis:action-reemit", { findings: ctx.paths.findings, bad });
          const rr = await stage(name, ctx, { force: true, sessionKey: r.sessionKey, model: r.model,
            thinking: r.thinking, trigger: "action-reemit",
            followup: followup + stageCharter(name, ctx.depth, ctx.framework) });
          ledger.record("action-corrective-reemit", actionKey, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: actionReemitMax });
          if (rr.ok) return rr;
        }
      }
      // ── — ASK_ANSWERS, THE LAST FAMILY THE LANE ADMITTED AND COULD NOT NAME ─────────────────
      //
      // Enumerated, not guessed: of every token the `finding_[a-z]` test admits, four families exist —
      // per-finding shape (~40, repaired above), `finding_action_*` (12, repaired above),
      // `finding_ask_answer_*` (5, HERE), and `findings_four_answers_*` / `findings_mark_assessment_*`
      // (9), which the existing `!/:findings_/` guard excludes deliberately. With this leg the lane's
      // admission set and its repair set agree on one population, which is the invariant asks for.
      //
      // Worth the repair rather than a clean refusal: `ask_answers` is the join to the FROZEN intake
      // asks, so a dropped one ships a question the client committed at intake unanswered.
      if (!lenient.quarantined.length && !lenient.actionsQuarantined.length && lenient.askAnswersQuarantined?.length) {
        const bad = lenient.askAnswersQuarantined;
        const askKey = bad.map((q) => `${q.index}`).sort().join("|").slice(0, 120) || "ask-answers";
        const ledger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(ctx.run.runDir, { log: (o) => runLog(ctx.run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const askReemitMax = 1;
        if (r.sessionKey && ledger.canAttempt("ask-answer-corrective-reemit", askKey, { max: askReemitMax })) {
          reemitAttempted = true;
          runLog(ctx.paths.runDir, { event: "ask-answer-reemit", stage: name, indices: bad.map((q) => q.index),
            errors: bad.map((q) => String(q.error ?? "").slice(0, 80)) });
          note(`[${name}] ${bad.length} ask_answers object(s) failed the strict parse — one warm single-artifact re-emit naming exactly those objects`);
          const followup = repairFollowup("synthesis:ask-answer-reemit", { findings: ctx.paths.findings, bad });
          const rr = await stage(name, ctx, { force: true, sessionKey: r.sessionKey, model: r.model,
            thinking: r.thinking, trigger: "ask-answer-reemit",
            followup: followup + stageCharter(name, ctx.depth, ctx.framework) });
          ledger.record("ask-answer-corrective-reemit", askKey, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: askReemitMax });
          if (rr.ok) return rr;
        }
      }
      // ── — AND THE LANE MAY NOT ADMIT WHAT IT CANNOT NAME ────────────────────────────────────
      //
      // The guard that generalises past these three families. `eligible` is a regex over a failure
      // string; the repair material is the quarantine lists. When the regex says yes and they are empty,
      // the lane has admitted a defect it cannot describe to anybody — and the behaviour today is to
      // fall out of the `try` and let the original failure stand, which is indistinguishable from a
      // model that could not produce a valid file.
      //
      // The NEXT token to slip the `finding_[a-z]` prefix test gets this instead of silence.
      const targets = salvageRepairTargets(lenient);
      if (targets.total === 0) {
        runLog(ctx.paths.runDir, { event: "salvage-lane-no-target", stage: name, fail: fail.slice(0, 200) });
        throw new StageFailure(name,
          `${fail} — the salvage lane admitted this failure and has nothing to repair: no finding, action or ask_answers object is malformed. The eligibility test and the lane's repair material disagree about what this token means; fix the pairing, not the run`,
          undefined, { failClass: "deterministic" });
      }
      if (lenient.quarantined.length && lenient.findings.length >= 1) {
        // T3 (H3, doctrine flip): a finding still malformed after the corrective ladder is a
        // MACHINERY defect. The old quarantine-and-continue delivered best-effort with the client
        // export blocked — post-T3 that is a guaranteed delivery-preflight fail (a quarantined finding
        // closes the gate) reached only after burning the whole delivery phase. Fail HERE instead;
        // the _quarantine.json sidecar keeps the forensics.
        try { writeFileSync(join(ctx.run.runDir, "_quarantine.json"), JSON.stringify({ stage: name, fail, quarantined: lenient.quarantined, kept: lenient.findings.length }, null, 2)); } catch { /* sidecar is best-effort */ }
        runLog(ctx.paths.runDir, { event: "quarantine", stage: name, fail, dropped: marks, kept: lenient.findings.length, terminal: true });
        // failClass: with the targeted re-emit actually attempted, the defect reproduced through every
        // repair — deterministic, fail fast. Without it (no live session / ledger exhausted), leave the
        // class to the text guess ("unknown" ⇒ one park — the VENZY re-sample doctrine).
        throw new StageFailure(name, `${lenient.quarantined.length} finding(s) unparseable after corrective retries [${marks.join(", ")}] — a report never ships missing findings (the delivery preflight would refuse it anyway)`, undefined,
          reemitAttempted ? { failClass: "deterministic", repairs: [{ repair: "finding-corrective-reemit", target: targetKey, outcome: "failed" }] } : {});
      }
      if (reemitAttempted)
        throw new StageFailure(name, fail || "failed", undefined, { failClass: "deterministic", repairs: [{ repair: "finding-corrective-reemit", target: targetKey, outcome: "failed" }] });
    } catch (e) {
      if (e instanceof StageFailure) throw e;
      note(`[${name}] quarantine re-parse failed (${e.message}) — failing the run as before`);
    }
  }
  throw new StageFailure(name, fail || "failed");
}

export async function runBatched(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * — THE CHARTER: the depth directive a stage family's every dispatch must carry.
 *
 * The architecture's delivery rule: the directive is composed ONCE per run and rides every dispatch of
 * that family — fresh, corrective, re-dispatch — with the inclusion asserted at the call site.
 *
 * WHY A FOLLOWUP DISPATCH NEEDS IT AT ALL. A dispatch with no `sessionKey` is a fresh turn: the driver
 * rebuilds the whole message from `STAGES.<name>.message`, and the directive is in there. A dispatch
 * WITH a `sessionKey` sends its followup in place of that message — so it inherits nothing the
 * message builder produces. That is not a theoretical gap: it is how the delivered narrative came from
 * a pass carrying no directive at all while the fresh pass carried one.
 *
 * Composed from the same function the fresh dispatch uses, so the two are the same string rather than
 * two texts that agree today.
 */
export function stageCharter(stageName, depth) {   // @internal
  // SYNTHESIS CARRIES NO DEPTH RUNG ANY MORE: its per-finding write-up rules contradicted the synthesis call, which records
  // sections only (design, 2026-11-06). The placement inquiry's rung still rides every dispatch of that stage.
  const directive = stageName === "placement-inquiry" ? inquiryRungDirective(depth) : "";
  return directive ? `\n\n${directive}` : "";
}

// Copy a stage's about-to-be-overwritten output (+ its per-stage telemetry) into _history/<ts>-<reason>/ so a
// prior result is NEVER lost and stays comparable. Returns the snapshot dir (or null if there was no output). The copy
// itself is stage-runner.mjs `keepPriorOutput`, the one the Knockout's stages use too; this names the clearance's files.
//
// STRUCTURED SIBLINGS (B2, review 2026-07-31): a stage may declare `outSibs` — machine artifacts written
// BESIDE its markdown output that downstream stages treat as authoritative. They are snapshotted with the
// md and then REMOVED from the run dir, because "the md was regenerated, the JSON was not" is exactly how
// a consumer ends up joining the previous pass's data while being told not to re-read the prose. The
// alternative (require sibling mtime ≥ the md's) does not survive an archive restore, where every file
// lands with a fresh mtime; removal is deterministic and its failure mode is a loud validator miss.
function snapshotOutputs(ctx, name, reason) {
  const def = STAGES[name];
  const label = name + (ctx.axis ? `:${ctx.axis}` : "");
  return keepPriorOutput({ runDir: ctx.paths.runDir, out: def?.out ? def.out(ctx.paths, ctx.axis) : null,
    sibs: def?.outSibs ? def.outSibs(ctx.paths, ctx.axis) : [], telemetry: driverDir(ctx.paths.runDir, `${label}.jsonl`), reason, label });
}

/**
 * A SYNTHESIS SAVE AFTER THE SEAM (the pre-delivery narrative redo, the in-pass stale repair) rewrites
 * findings.json from the seat's own call, and the seam's writes go with it: the coverage-judgment rows, the
 * injected coverage rows, the fold. The seam leaves them on the run's context, and they run again here,
 * before anything downstream reads the record. Before the seam there is nothing on the context, so nothing
 * runs. It sits at the end of this file so that adding it moved no line another file cites.
 */
async function afterLateSynthesisSave(name, ctx, r) {
  if (r?.ok && !r.skipped && name === "synthesis" && typeof ctx?.afterSynthesisSave === "function") await ctx.afterSynthesisSave();
}

// ── THE SALVAGE FOR A FOREIGN RECORD LINK: BLANK IT, RE-CHECK, DELIVER ──────────────────────────────────
//
// A seat that writes an office's page, or another register's, into a record link is refused by the
// findings gate (`finding_record_url_foreign_host`). The salvage lane below takes that token, because it is
// a `finding_…` token, but its lenient re-parse does not judge hosts, so it found nothing to repair and
// failed the run: R2 on 0.4.1-beta.1 delivered no report over eleven copied office links. Here the driver
// blanks every foreign link itself (blankForeignRecordLinks says how), keeps what it changed beside the run,
// and re-checks the file with the stage's own validator. A pass delivers; anything still refused falls
// through to the lanes below exactly as before, with fewer defects in the file.
export function foreignRecordLinksBlanked(r, ctx, name) {   // exported for its test
  const fail = String(r?.fail || "").replace(/^max_tokens_no_output:/, "");
  if (!fail.includes(FOREIGN_HOST_TOKEN) || !existsSync(ctx.paths.findings)) return false;
  let doc;
  try { doc = JSON.parse(readFileSync(ctx.paths.findings, "utf8")); } catch { return false; }
  const { doc: repaired, blanked, kept } = blankForeignRecordLinks(doc, activeRecordOrigins());
  if (!blanked.length) return false;
  writeFindings(ctx.paths.runDir, repaired, { why: "foreign-record-links-blanked", settles: [] });
  recordBlanking(ctx.paths.runDir, { stage: name, layer: "salvage", blanked, kept, fail });
  note(`[${name}] ${blanked.length} record link(s) on a host this register does not publish were blanked by the driver; the originals are in _driver/foreign-record-links.json`);
  const def = STAGES[name];
  const out = def?.out ? def.out(ctx.paths, ctx.axis) : null;
  const v = out && existsSync(out) && def.validate ? def.validate(out, readFileSync(out, "utf8")) : null;
  if (v?.ok) return true;
  runLog(ctx.paths.runDir, { event: "foreign-record-links-recheck", stage: name, ok: false, fail: String(v?.reason ?? "no validator").slice(0, 200) });
  return false;
}

/**
 * The repairs that fix only what they name: a delivery lint fault, or an object of the writer's record that failed the
 * strict parse. They are not told placement's set-asides with the order to check each ground (ruled 2026-10-19); every
 * other follow-up of the reading step and the writer is.
 */
export const NARROW_REPAIR_TRIGGERS = new Set(["lint-repair", "finding-reemit", "action-reemit", "ask-answer-reemit"]);   // @internal — driven by its test
