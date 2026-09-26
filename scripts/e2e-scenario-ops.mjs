// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-scenario-ops.mjs — the whole-run assertion ops two scenarios declared and nothing implemented.
//
// A scenario names an op, the harness looks it up, and an op nobody wrote reads FAIL "UNIMPLEMENTED" on
// every run, whatever the run did. These are the ops the ecosystem-grid scenario and the crowded
// identical-mark scenario declared. Each one reads the files the engine writes, says what it counted, and
// returns one of three answers: FAIL, ok, or NOT PROBED when the run holds nothing the op could examine.
// NOT PROBED is never a pass. One op is REPORTED: it prints its counts and judges nothing.
//
// The ops read the RUN'S OWN records, never the product's gates. The gates are what a round tests, so a
// check that asked them would pass whenever they did.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { formKey } from "../providers/_shared/script-form.mjs";
import { goodsTermsList } from "../providers/_shared/term-shape.mjs";
import { isSpellingBandEntry } from "../driver/register-plan.mjs";

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => String(v ?? "").trim();
const sample = (xs, n = 5) => (xs.length ? `: ${xs.slice(0, n).join(" · ")}${xs.length > n ? ` · and ${xs.length - n} more` : ""}` : "");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dotted = (obj, path) => String(path ?? "").split(".").filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);

// ── the off-register grid ───────────────────────────────────────────────────────────────────────────

const RECEIPT_STATUSES = new Set(["hit", "no_hit"]);
const platformKey = (s) => text(s).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
const cellKey = (term, platform) => `${text(term).normalize("NFKC")}\u0000${platformKey(platform)}`;

/**
 * `covers-platforms-of` — every cell of the grid spec is decided, judged cell by cell.
 *
 * The customer profile's store list is a menu: a profile store's cell has either run or been set aside with
 * its reason. Every other platform in the spec, the channels the matter frame named and the general web
 * cell, always runs, so its cell needs a row that ran. A row that ran is a cell whose status is `hit` or
 * `no_hit`; a row saying another pass owns the cell is not one. `path` names the merged grid and `value`
 * names the spec's platform list; the profile's stores come from the run's own `_driver/profile.json`.
 */
export function coversPlatformsOf(a, runDir) {
  const [file] = String(a.path ?? "").split(":");
  const grid = readJson(join(runDir, file || ""));
  if (!grid || typeof grid !== "object") return { ok: false, saw: `${file} absent or unparseable, so no cell can be shown to have run` };
  const [specFile, specField] = String(a.value ?? "").split(":");
  const spec = readJson(join(runDir, specFile || ""));
  const platforms = list(dotted(spec, specField || "platforms"));
  const terms = list(spec?.terms);
  if (!platforms.length || !terms.length)
    return { ok: false, saw: `${specFile || "the grid spec"} names ${plural(platforms.length, "platform")} and ${plural(terms.length, "form")}, so there is no grid to cover` };
  const profile = readJson(driverDir(runDir, "profile.json"));
  if (!Array.isArray(profile?.platforms))
    return { ok: false, saw: "_driver/profile.json carries no store list, so which cells the run may set aside cannot be established" };
  const stores = new Set(profile.platforms.map(platformKey));

  const ran = new Set();
  let notReceipts = 0;
  for (const c of list(grid.cells)) {
    if (!c || typeof c.term !== "string" || typeof c.platform !== "string") continue;
    if (RECEIPT_STATUSES.has(c.status)) ran.add(cellKey(c.term, c.platform));
    else notReceipts++;
  }
  const aside = new Set(list(grid.set_aside)
    .filter((x) => x && typeof x.term === "string" && typeof x.platform === "string" && text(x.reason))
    .map((x) => cellKey(x.term, x.platform)));

  let ranCells = 0, asideCells = 0;
  const asideOffMenu = [], undecided = [];
  for (const t of terms) {
    for (const p of platforms) {
      const k = cellKey(t, p);
      if (ran.has(k)) ranCells++;
      else if (aside.has(k) && stores.has(platformKey(p))) asideCells++;
      else if (aside.has(k)) asideOffMenu.push(`${t} | ${p}`);
      else undecided.push(`${t} | ${p}`);
    }
  }
  const storesInSpec = platforms.filter((p) => stores.has(platformKey(p))).length;
  const parts = [
    `${terms.length} form(s) × ${platforms.length} platform(s) (${storesInSpec} from the profile's store list, ${platforms.length - storesInSpec} the frame's channels and the web cell)`,
    `${ranCells} cell(s) ran`,
    `${asideCells} profile-store cell(s) set aside with a reason`,
  ];
  if (asideOffMenu.length) parts.push(`${asideOffMenu.length} set aside although the platform is not on the profile's list, where every cell runs${sample(asideOffMenu)}`);
  if (undecided.length) parts.push(`${undecided.length} neither ran nor set aside${sample(undecided)}`);
  if (notReceipts) parts.push(`${notReceipts} row(s) carry a status that is not a receipt`);
  return { ok: !asideOffMenu.length && !undecided.length, saw: parts.join("; ") };
}

// ── off-register owners ─────────────────────────────────────────────────────────────────────────────

// Off the register means a marketplace or web finding. A case-law finding cites a decision, not a use, and
// is not read here.
const OFF_REGISTER = new Set(["common-law-marketplace", "common-law-web"]);
const NO_OWNER = /unidentif|not identified|could not be identified|unknown|not extracted|^n\/?a$|^none$|^[\s—–-]*$/i;

/**
 * `no-unidentified-owner-on-off-register` — every off-register finding names its owner.
 *
 * Read from the finding alone: a source that publishes no owner and one nobody read look the same here, so
 * a FAIL names the findings to open by hand rather than deciding which of the two each is.
 */
export function noUnidentifiedOwnerOnOffRegister(a, runDir) {
  const [file] = String(a.path ?? "").split(":");
  const doc = readJson(join(runDir, file || "findings.json"));
  if (!doc) return { ok: false, saw: `${file || "findings.json"} absent or unparseable` };
  const findings = list(doc.findings);
  const off = findings.filter((f) => OFF_REGISTER.has(f?.source?.source_type));
  if (!off.length)
    return { ok: true, notProbed: true, saw: `NOT PROBED (not a pass): none of the ${plural(findings.length, "finding")} is off-register, so there was no owner to read` };
  const bad = off.filter((f) => NO_OWNER.test(text(typeof f.owner === "string" ? f.owner : f.owner?.name)));
  return { ok: !bad.length,
    saw: `${plural(off.length, "off-register finding")}, ${bad.length} naming no owner${sample(bad.map((f) => `#${f.ordinal ?? "?"}`), 10)}`
      + (bad.length ? " (read from the finding alone: open each source to tell an owner it does not publish from one nobody read)" : "") };
}

// ── the register plan and the reading turn's decisions ──────────────────────────────────────────────

/** Every `<prefix><axis>.json` family record in `_driver`, merged: qids with a reason, and qids without one. */
function familyRecords(runDir, prefix) {
  const reasons = new Map(), blank = [];
  let names = [];
  try { names = readdirSync(driverDir(runDir)); } catch { return { reasons, blank }; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const doc = readJson(driverDir(runDir, name));
    for (const [qid, v] of Object.entries(doc?.families ?? {})) {
      const reason = text(v?.reason);
      if (reason) reasons.set(qid, { axis: text(doc?.axis), reason });
      else blank.push(qid);
    }
  }
  return { reasons, blank };
}

/** The reading turn's own questions, from every axis's `register-units/<axis>-supplemental-plan.json`. */
function supplementalEntries(runDir) {
  const dir = join(runDir, "register-units");
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith("-supplemental-plan.json")).flatMap((n) => list(readJson(join(dir, n))?.entries));
}

const readPlan = (runDir) => {
  const plan = readJson(driverDir(runDir, "register-plan.json"));
  return plan && Array.isArray(plan.entries) ? plan : null;
};
const waitsForReadingTurn = (e) => e?.when?.awaits_reading_turn === true;
const waitsOnParent = (e) => typeof e?.when?.runs_if_enumerated === "string" && text(e.when.runs_if_enumerated) !== "";

/** The identical-mark questions: the mark itself, asked by name, not narrowed by goods. */
function identicalQuestions(plan, markKey) {
  return plan.entries.filter((e) => e?.provenance === "mark" && text(e.predicate) !== "default"
    && !goodsTermsList(e).length && formKey(e.term ?? "") === markKey);
}

const markKeyOf = (runDir) => {
  const mark = text(readJson(join(runDir, "variant-manifest.json"))?.mark);
  return mark ? formKey(mark) : null;
};

/**
 * `every-family-was-judged` — every family that waited for the reading turn was decided, one way.
 *
 * A waiting family is ASKED (released with a reason, or answered by a question the turn asked, which
 * carries its rationale when it is one of the turn's own) or WITHHELD with a reason. Neither is a family
 * nobody decided; both is a record that contradicts itself.
 */
export function everyFamilyWasJudged(a, runDir) {
  const plan = readPlan(runDir);
  if (!plan) return { ok: false, saw: "_driver/register-plan.json absent or carries no entries, so the waiting families cannot be listed" };
  const waiting = plan.entries.filter((e) => waitsForReadingTurn(e) && e.unsupported !== true);
  // The spelling band is asked as the machine writes it; a band entry that waited could be withheld
  // before it was asked, which no reason on the record makes right.
  const bandWaited = waiting.filter(isSpellingBandEntry);
  if (!waiting.length)
    return { ok: true, notProbed: true, saw: "NOT PROBED (not a pass): no family in this run's frozen plan waited for the reading turn" };
  const released = familyRecords(runDir, "released-families-");
  const withheld = familyRecords(runDir, "withheld-families-");
  const form = readJson(driverDir(runDir, "register-coverage-form.form.json"));
  const formWithheld = new Map(list(form?.rows)
    .filter((r) => r?.kind === "family" && r?.status === "withheld-by-judgment")
    .map((r) => [text(r.qid), text(r.reason)]));
  const exec = readJson(driverDir(runDir, "plan-execution.json"));
  const askedBy = new Map(list(exec?.asked).map((x) => [text(x?.qid), text(x?.asked_by)]));
  const supp = new Map(supplementalEntries(runDir).map((e) => [text(e?.qid), e]));

  let asked = 0, releasedN = 0, withheldN = 0, formOnly = 0;
  const neither = [], both = [], noRationale = [];
  for (const f of waiting) {
    const q = text(f.qid);
    const by = askedBy.get(q);
    const isReleased = released.reasons.has(q);
    const isAsked = isReleased || Boolean(by);
    const onRecord = withheld.reasons.has(q);
    const onForm = Boolean(formWithheld.get(q));
    const isWithheld = onRecord || onForm;
    if (by && supp.has(by) && !text(supp.get(by)?.rationale)) noRationale.push(q);
    if (isAsked && isWithheld) both.push(q);
    else if (isAsked) { asked++; if (isReleased) releasedN++; }
    else if (isWithheld) { withheldN++; if (!onRecord) formOnly++; }
    else neither.push(q);
  }
  const blank = [...released.blank, ...withheld.blank];
  const parts = [
    `${plural(waiting.length, "waiting family", "waiting families")}: ${asked} asked (${releasedN} released with a reason), ${withheldN} withheld with a reason`
      + (formOnly ? ` (${formOnly} settled on the coverage form, not in the reading turn's own record)` : ""),
  ];
  if (bandWaited.length) parts.push(`${plural(bandWaited.length, "spelling-band entry", "spelling-band entries")} waited for the reading turn instead of being asked${sample(bandWaited.map((e) => text(e.qid)))}`);
  if (neither.length) parts.push(`${neither.length} decided neither way${sample(neither)}`);
  if (both.length) parts.push(`${both.length} recorded both asked and withheld${sample(both)}`);
  if (noRationale.length) parts.push(`${noRationale.length} asked by a question of the turn's that gives no rationale${sample(noRationale)}`);
  if (blank.length) parts.push(`${blank.length} family record(s) with an empty reason${sample(blank)}`);
  return { ok: !bandWaited.length && !neither.length && !both.length && !noRationale.length && !blank.length, saw: parts.join("; ") };
}

/**
 * `withheld-by-judgment-carries-its-reason` — every withheld family says why, and no axis holding one is
 * written clean.
 */
export function withheldByJudgmentCarriesItsReason(a, runDir) {
  const withheld = familyRecords(runDir, "withheld-families-");
  const form = readJson(driverDir(runDir, "register-coverage-form.form.json"));
  const formRows = list(form?.rows).filter((r) => r?.kind === "family" && r?.status === "withheld-by-judgment");
  if (!withheld.reasons.size && !withheld.blank.length && !formRows.length)
    return { ok: true, notProbed: true, saw: "NOT PROBED (not a pass): no family was withheld in this run" };
  const ledger = readJson(join(runDir, "register-coverage-ledger.json"));
  if (!Array.isArray(ledger)) return { ok: false, saw: "register-coverage-ledger.json absent or not a list, so whether a withheld axis was written clean cannot be read" };
  const axes = new Set([...[...withheld.reasons.values()].map((v) => v.axis), ...formRows.map((r) => text(r.axis))].filter(Boolean));
  const blankForm = formRows.filter((r) => !text(r.reason)).map((r) => text(r.qid) || text(r.row_id));
  const cleanOverWithheld = ledger.filter((r) => text(r?.status) === "confirmed-clean" && axes.has(text(r?.axis))).map((r) => text(r.axis));
  const parts = [
    `${plural(withheld.reasons.size, "withheld family", "withheld families")} on record with a reason, ${withheld.blank.length} without${sample(withheld.blank)}`,
    `${formRows.length} coverage-form row(s) settled withheld, ${blankForm.length} without a reason${sample(blankForm)}`,
    `${cleanOverWithheld.length} ledger row(s) write clean an axis that holds a withheld family${sample(cleanOverWithheld)}`,
  ];
  return { ok: !withheld.blank.length && !blankForm.length && !cleanOverWithheld.length, saw: parts.join("; ") };
}

/** Each executed question's count, by qid: `total_hits` where the register stated one, else the records read. */
function executedCounts(exec) {
  const out = new Map();
  for (const x of list(exec?.executed)) {
    const n = Number.isFinite(Number(x?.total_hits)) && x?.total_hits !== null ? Number(x.total_hits)
      : Number.isFinite(Number(x?.records)) && x?.records !== null ? Number(x.records) : null;
    if (n !== null) out.set(text(x.qid), { count: n, state: text(x.state) });
  }
  return out;
}

/**
 * `narrowing-names-its-crowd` — every narrowing names a crowd that is on the record, and both carry a count.
 */
export function narrowingNamesItsCrowd(a, runDir) {
  const plan = readPlan(runDir);
  if (!plan) return { ok: false, saw: "_driver/register-plan.json absent or carries no entries" };
  const byQid = new Map();
  for (const e of [...plan.entries, ...supplementalEntries(runDir)]) if (text(e?.qid) && !byQid.has(text(e.qid))) byQid.set(text(e.qid), e);
  const narrowings = [...byQid.values()].filter((e) => text(e?.narrows));
  if (!narrowings.length)
    return { ok: true, notProbed: true, saw: "NOT PROBED (not a pass): no question in this run names a crowd it narrowed" };
  const exec = readJson(driverDir(runDir, "plan-execution.json"));
  if (!exec) return { ok: false, saw: "_driver/plan-execution.json absent, so no question's count can be read" };
  const counts = executedCounts(exec);
  const crowdMissing = [], crowdUncounted = [], narrowingUncounted = [];
  for (const n of narrowings) {
    const crowd = text(n.narrows);
    if (!byQid.has(crowd)) crowdMissing.push(`${n.qid} → ${crowd}`);
    else if (!counts.has(crowd)) crowdUncounted.push(`${n.qid} → ${crowd}`);
    if (!counts.has(text(n.qid))) narrowingUncounted.push(text(n.qid));
  }
  const parts = [`${plural(narrowings.length, "narrowing")} naming ${new Set(narrowings.map((n) => text(n.narrows))).size} crowd(s)`];
  if (crowdMissing.length) parts.push(`${crowdMissing.length} name a crowd that is not on the record${sample(crowdMissing)}`);
  if (crowdUncounted.length) parts.push(`${crowdUncounted.length} name a crowd with no count${sample(crowdUncounted)}`);
  if (narrowingUncounted.length) parts.push(`${narrowingUncounted.length} carry no count of their own${sample(narrowingUncounted)}`);
  if (parts.length === 1) parts.push("each crowd and each narrowing on the record with its count");
  return { ok: !crowdMissing.length && !crowdUncounted.length && !narrowingUncounted.length, saw: parts.join("; ") };
}

/**
 * `questions-and-records-at-most` — REPORTED, never judged. A run that widens by judgment may ask more than
 * a baseline did and be right to, so the counts are printed beside the scenario's baseline and nothing
 * passes or fails on them.
 */
export function questionsAndRecordsAtMost(a, runDir) {
  const exec = readJson(driverDir(runDir, "plan-execution.json"));
  if (!exec) return { ok: false, saw: "_driver/plan-execution.json absent, so the questions asked cannot be counted" };
  const executed = list(exec.executed);
  const records = executed.reduce((s, x) => s + (Number.isFinite(Number(x?.records)) ? Number(x.records) : 0), 0);
  const released = familyRecords(runDir, "released-families-").reasons.size;
  const base = a.value && typeof a.value === "object" ? a.value : {};
  return { ok: true, reported: true,
    saw: `REPORTED, NOT JUDGED: ${plural(executed.length, "question")} asked and ${plural(records, "record")} read`
      + (Number.isFinite(base.questions) || Number.isFinite(base.records) ? `, against ${base.questions ?? "?"} and ${base.records ?? "?"} on the scenario's baseline` : "")
      + `; ${released} waiting famil${released === 1 ? "y" : "ies"} released, each with its reason` };
}

/**
 * `families-gate-on-the-identical-question` — every family waits, except the identical-mark questions, the
 * saturation count, the goods-narrowed questions, entries the register cannot express and the spelling band,
 * which is asked as the machine writes it. A family waits for the reading turn, or on a parent question of
 * its own.
 */
export function familiesGateOnTheIdenticalQuestion(a, runDir) {
  const plan = readPlan(runDir);
  if (!plan) return { ok: false, saw: "_driver/register-plan.json absent or carries no entries" };
  const markKey = markKeyOf(runDir);
  if (!markKey) return { ok: false, saw: "variant-manifest.json names no mark, so the identical-mark questions cannot be told apart" };
  const identical = new Set(identicalQuestions(plan, markKey));
  let waitTurn = 0, waitParent = 0, idN = 0, satN = 0, goodsN = 0, unsupN = 0, bandN = 0, turnN = 0;
  const ungated = [];
  for (const e of plan.entries) {
    if (waitsForReadingTurn(e)) { waitTurn++; continue; }
    if (waitsOnParent(e)) { waitParent++; continue; }
    // The plan file grows as the run asks: the reading turn's own questions are appended to it, and they
    // are the asking, not a family waiting to be asked.
    if (e?.origin === "supplemental") { turnN++; continue; }
    if (e?.unsupported === true) { unsupN++; continue; }
    if (e?.axis === "saturation-probe") { satN++; continue; }
    if (goodsTermsList(e).length) { goodsN++; continue; }
    if (identical.has(e)) { idN++; continue; }
    if (isSpellingBandEntry(e)) { bandN++; continue; }
    ungated.push(`${e?.axis ?? "?"}/${e?.predicate ?? "?"} ${e?.qid ?? "?"}`);
  }
  const parts = [
    `${plural(plan.entries.length, "plan entry", "plan entries")}: ${waitTurn + waitParent} wait (${waitTurn} for the reading turn, ${waitParent} on a parent question)`,
    `${idN + satN + goodsN + unsupN + bandN} run without waiting as the rule allows (${idN} identical-mark, ${satN} saturation count, ${goodsN} goods-narrowed, ${unsupN} the register cannot express, ${bandN} spelling band)`,
    `${turnN} the reading turn's own question(s)`,
  ];
  if (!identical.size) parts.push("the plan holds no identical-mark question for the families to wait on");
  if (ungated.length) parts.push(`${ungated.length} other entr${ungated.length === 1 ? "y runs" : "ies run"} without waiting${sample(ungated)}`);
  return { ok: identical.size > 0 && !ungated.length, saw: parts.join("; ") };
}

/**
 * `identical-read-per-market` — the identical question came back as a list, or each crowded form was
 * narrowed until a narrowing came back as one. A narrowing is a question naming the crowd in `narrows`, or
 * the plan's own goods-narrowed question for the mark, which narrows the identical question by design.
 */
export function identicalReadPerMarket(a, runDir) {
  const plan = readPlan(runDir);
  if (!plan) return { ok: false, saw: "_driver/register-plan.json absent or carries no entries" };
  const markKey = markKeyOf(runDir);
  if (!markKey) return { ok: false, saw: "variant-manifest.json names no mark, so the identical-mark questions cannot be told apart" };
  const exec = readJson(driverDir(runDir, "plan-execution.json"));
  if (!exec) return { ok: false, saw: "_driver/plan-execution.json absent, so no question's answer can be read" };
  const identical = identicalQuestions(plan, markKey);
  if (!identical.length) return { ok: false, saw: "the plan holds no identical-mark question" };
  const state = new Map(list(exec.executed).map((x) => [text(x?.qid), text(x?.state)]));
  const all = new Map();
  for (const e of [...plan.entries, ...supplementalEntries(runDir)]) if (text(e?.qid) && !all.has(text(e.qid))) all.set(text(e.qid), e);
  const goodsNarrowed = [...all.values()].filter((e) => goodsTermsList(e).length && formKey(e.term ?? "") === markKey);
  const narrowingsOf = (qid, isIdentical) => [
    ...[...all.values()].filter((e) => text(e?.narrows) === qid),
    ...(isIdentical ? goodsNarrowed : []),
  ];
  const readAsList = (qid, isIdentical, depth = 0) => state.get(qid) === "enumerated"
    || (depth < 8 && narrowingsOf(qid, isIdentical).some((n) => readAsList(text(n.qid), false, depth + 1)));

  let outright = 0, viaNarrowing = 0;
  const unanswered = [], neverRan = [];
  for (const q of identical) {
    const qid = text(q.qid);
    if (!state.has(qid)) neverRan.push(qid);
    else if (state.get(qid) === "enumerated") outright++;
    else if (readAsList(qid, true)) viaNarrowing++;
    else unanswered.push(qid);
  }
  const parts = [`${plural(identical.length, "identical-mark question")}: ${outright} came back as a list, ${viaNarrowing} crowded and were narrowed until a narrowing came back as one`];
  if (unanswered.length) parts.push(`${unanswered.length} crowded with no narrowing that came back as a list${sample(unanswered)}`);
  if (neverRan.length) parts.push(`${neverRan.length} never ran${sample(neverRan)}`);
  return { ok: !unanswered.length && !neverRan.length, saw: parts.join("; ") };
}

/**
 * The file each op above reads when it reads one file the scenario could have named. Two scenario paths
 * name files the engine never writes (`_driver/coverage-ledger.json`, `_driver/plan-execution-census.json`);
 * `pathsAnOpDoesNotRead` reports them against this, and the op's own answer says so beside the count.
 */
export const SCENARIO_FILE_OP_READS = Object.freeze({
  "every-family-was-judged": "_driver/register-plan.json",
  "withheld-by-judgment-carries-its-reason": "register-coverage-ledger.json",
  "narrowing-names-its-crowd": "_driver/plan-execution.json",
  "questions-and-records-at-most": "_driver/plan-execution.json",
  "families-gate-on-the-identical-question": "_driver/register-plan.json",
  "identical-read-per-market": "_driver/register-plan.json",
});

/** When the scenario names a file the op does not read, the answer says which file it read instead. */
const noting = (op, fn) => (a, runDir) => {
  const r = fn(a, runDir);
  const reads = SCENARIO_FILE_OP_READS[op];
  const declared = String(a?.path ?? "").split(":")[0];
  return reads && declared && declared !== reads
    ? { ...r, saw: `${r.saw} (the scenario names ${declared}, which this op does not read: it reads ${reads} and the records beside it)` }
    : r;
};

/** Op name → implementation. `evalAssertion` consults this table before the field ops. */
export const SCENARIO_FILE_OPS = Object.freeze(Object.fromEntries(Object.entries({
  "covers-platforms-of": coversPlatformsOf,
  "no-unidentified-owner-on-off-register": noUnidentifiedOwnerOnOffRegister,
  "every-family-was-judged": everyFamilyWasJudged,
  "withheld-by-judgment-carries-its-reason": withheldByJudgmentCarriesItsReason,
  "narrowing-names-its-crowd": narrowingNamesItsCrowd,
  "questions-and-records-at-most": questionsAndRecordsAtMost,
  "families-gate-on-the-identical-question": familiesGateOnTheIdenticalQuestion,
  "identical-read-per-market": identicalReadPerMarket,
}).map(([op, fn]) => [op, noting(op, fn)])));
