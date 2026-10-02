// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-judgment.mjs — step 3 of a clearance: the pile laid out by owner, two sessions judging it alone,
// code checking each answer, code merging the two, and every owner's fate recorded.
//
// ── what this replaces, and why ──────────────────────────────────────────────────────────────────────
//
// Step 3 used to be two model stages, placement then the register digest, that paged the pile through
// lookup tools 20 to 100 rows at a time after reading 115,000 characters of manual, and gave every chosen
// record one of three endings on a form code refused until its books balanced. Measured on the five
// lawyer-scored cases (owner, 2026-09-29/30): 50 minutes of a 164-minute run, 178,000 to 449,000 tokens
// written, 7 of the lawyer's 43 entries that reached the pile dropped there, 5 of them with no reason
// recorded. Two short sessions handed one table of the owners, the client's materials and six sentences,
// merged by code, carried 32 of the lawyer's 43 — the engine's own count — in about five minutes each.
//
// So the model is given what a lawyer is given and left free to judge: no manual, no accounting form, no
// method. Code does the rest — lays the pile out, checks each answer against the run's own records, merges
// the two, and writes down what became of every owner. The design is the owner's (2026-10-01); every
// sentence the judges read is the owner's, or the bench's that the owner measured, and they are set out below.
//
// PURE where it can be: the words, the form, the message, the check and the merge take values and return
// values. The pipeline (pipeline.mjs, runOwnerJudgment) owns the files and the sessions.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bandIndex, normalizeBand } from "./framework.mjs";
import { ownerKey, CLOSENESS, isLive } from "./owner-table.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";

// ── THE WORDS THE JUDGES READ ────────────────────────────────────────────────────────────────────────
//
// The six sentences, approved by the owner on 2026-10-01, with
// the engine's tool names filled in where the text names a tool in words, and NOTHING ELSE ADDED. They are
// the session's whole instruction: they replace the program's own system prompt on both engines, and the
// judges carry no manual. The helper tool is the program's own and is presented under its own name on each
// engine, so the sentence that allows helpers names none.
export const OPENING_WORDS = [
  "You are advising a client on a trademark clearance.",
  "Below are the order, the client's context, the client's rating scale and the client's worked examples.",
  "Your tools: the table of every owner this search found, those with a live record in the order's classes first and the closest mark first among them, whose first pages are below and the rest by page (`owner_table`); all records of one owner (`owner_records`); the register questions this search ran, each with its count (`register_questions`); what one question returned, grouped by owner (`register_list`); one full record (`register_open`); the web results (`web_results`); and a request for a register question this search did not run, which is recorded and not answered now (`register_new_question`).",
  "You may spawn sub-agents, each with the same tools, to read parts of the table or sets of records in parallel, and fold what they find into your answer.",
  "Work as a trademark lawyer would.",
  "Answer the client in the form provided: who could object, how strong each is, and what the client should do.",
].join(" ");

// ── THE ANSWER FORM ──────────────────────────────────────────────────────────────────────────────────
//
// The bench's form, with the field descriptions the owner approved on 2026-10-01 (point b), word for word.
// It reaches the judge as the program's own structured-answer schema (Claude `--json-schema`, Codex
// `--output-schema`), as the bench measured it — never as a tool a helper could also call.
//
// THE TWO READS (owner, 2026-10-02): how alike the marks are and how close the goods are, each a fixed
// choice of the values he named, so the rating and the two reads of the records come from one session.
// Each is described as `decision` is, by its values alone, and is required on every owner, set aside
// included: the program's schema requires every field on both engines, and neither set has an empty value.
const text = { type: "string" };
export const MARKS_ALIKE = Object.freeze(["same", "close", "different"]);
export const GOODS_CLOSE = Object.freeze(["same", "overlapping", "different"]);
export const ANSWER_FORM = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["considered", "overall_rating", "advice", "questions_wished_for"],
  properties: {
    considered: {
      type: "array",
      description: "One entry per owner you considered, carried into the advice or set aside.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["owners", "decision", "records", "rating", "marks_alike", "goods_close", "reason"],
        properties: {
          owners: { type: "array", items: text, description: "The owner's name exactly as the register or the web gives it; several names only when they are the same owner." },
          decision: { type: "string", enum: ["carry", "set_aside"], description: "`carry` or `set_aside`." },
          records: { type: "array", items: text, description: "The ids of the register records, or the web addresses, this decision relies on; only ids and addresses from this search." },
          rating: { ...text, description: "One band of the client's scale, exactly as the scale names it; empty when set aside." },
          marks_alike: { type: "string", enum: [...MARKS_ALIKE], description: "`same`, `close` or `different`." },
          goods_close: { type: "string", enum: [...GOODS_CLOSE], description: "`same`, `overlapping` or `different`." },
          reason: { ...text, description: "Why, from the records." },
        },
      },
    },
    overall_rating: { ...text, description: "The overall rating for the ordered mark, one band of the client's scale." },
    advice: { ...text, description: "The advice to the client, in prose." },
    questions_wished_for: { type: "array", items: text, description: "Register questions this search did not run that would have changed or firmed up the advice, each as the question itself." },
  },
});

// ── THE MESSAGE ──────────────────────────────────────────────────────────────────────────────────────
//
// The bench's composition: the order and the client's own materials, each unchanged, and the table's
// first pages. The section headings are the bench's, "saved run" said as "this search".

/**
 * The order, as the bench wrote it from the run's instructed scope: the mark, the classes, the goods, the
 * territory. Then the instructing lawyer's own questions from the order, when the order asked any (owner,
 * 2026-10-01: the judges see them) — the intake asks the run froze at the frame, each as asked.
 */
export function orderText(scope, asks = []) {
  const questions = (Array.isArray(asks) ? asks : []).map((a) => String(a?.ask ?? "").trim()).filter(Boolean);
  const marks = (Array.isArray(scope?.marks) ? scope.marks : scope?.marks ? [scope.marks] : [])
    .map((m) => (typeof m === "string" ? m : m?.name ?? m?.markName ?? "")).filter(Boolean);
  const territory = scope?.geography?.mode === "worldwide" ? "worldwide"
    : Array.isArray(scope?.jurisdictions) && scope.jurisdictions.length ? scope.jurisdictions.join(", ")
    : JSON.stringify(scope?.jurisdictions ?? scope?.geography ?? null);
  return [
    `Mark: ${marks.join(", ")}`,
    `Classes: ${(Array.isArray(scope?.classes) ? scope.classes : []).join(", ")}`,
    `Goods and services: ${scope?.goods ?? ""}`,
    `Territory: ${territory}`,
    ...(questions.length ? ["The instructing lawyer's questions:", ...questions.map((q) => `- ${q}`)] : []),
  ].join("\n") + "\n";
}

/**
 * The client's context, as the bench wrote it: the client's own context page when the account has one,
 * and the facts of its profile. The client's own and affiliated owner names are the run's own list
 * (`ownNames`: the profile's names only when the applicant IS the profile's customer, the rule every
 * stage keeps), and a client bound late in the run joins them, so the judges read it where they read the
 * rest of the client.
 */
export function contextText(profile, { ownNames = [], customerBind = null } = {}) {
  const own = [...new Set([
    ...(Array.isArray(ownNames) ? ownNames : []),
    ...(customerBind?.customer ? [customerBind.customer] : []),
    ...(Array.isArray(customerBind?.exclusions) ? customerBind.exclusions : []),
  ].map((s) => String(s).trim()).filter(Boolean))];
  const facts = [
    ["Client", profile?.name],
    ["Industry", profile?.industry],
    ["Stores the client sells through", Array.isArray(profile?.platforms) ? profile.platforms.join(", ") : profile?.platforms],
    ["The client's priority markets (not the scope of this order)", Array.isArray(profile?.defaultJurisdictions) ? profile.defaultJurisdictions.join(", ") : profile?.defaultJurisdictions],
    ["The client's own and affiliated owner names", own.join("; ")],
    ["Risk appetite", profile?.riskAppetite],
  ].filter(([, value]) => value);
  const page = String(profile?.contextPack ?? "").trim();
  return !page && !facts.length
    ? "No client context was given with this order.\n"
    : `${page ? `${page}\n\n` : ""}## From the client's profile\n\n${facts.map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
}

/** The one message each judge receives. `tablePages` is `{pages, text}` from firstTablePages. PURE. */
export function composeMessage({ order, context, ratingScale, workedExamples, tablePages = null }) {
  const section = (title, body) => `# ${title}\n\n${String(body).trim()}\n`;
  return [
    section("The order", order),
    section("The client's context", context),
    section("The client's rating scale", ratingScale),
    section("The client's worked examples", workedExamples),
    ...(tablePages ? [section(tablePages.pages > 1 ? `The owners this search found, first ${tablePages.pages} pages` : "The owners this search found, first page", tablePages.text)] : []),
  ].join("\n");
}

/**
 * The table's first pages, as the tool serves them, up to `chars` characters: the bench put the tool's own
 * answers in the opening message, page after page, so the judge reads in the message exactly what the tool
 * would have given it. `serve` is owner-tools' `serve` (the answer, unlogged: the driver is not a judge).
 * Returns the pages' text and the owners on them, as keys, which every judge was shown.
 */
export function firstTablePages(serve, chars) {
  const taken = [];
  let used = 0;
  for (let page = 1; ; page++) {
    const r = serve("owner_table", { page });
    if (r.refused) break;
    if (taken.length && used + r.text.length > chars) break;
    taken.push(r);
    used += r.text.length;
    if (page >= r.result.pages) break;
  }
  return {
    pages: taken.length,
    text: taken.map((t) => t.text).join("\n\n"),
    keysShown: taken.flatMap((t) => t.result.keysShown ?? []),
  };
}

// ── THE CHECK ────────────────────────────────────────────────────────────────────────────────────────
//
// "Every record cited is one the run holds; every rating is a band of the client's scale; every carried
// decision names an owner and gives a reason. A session that returns nothing or fails a check runs again,
// up to the engine's usual three attempts. The form is the check; no manual." (design, 2026-10-01). The
// program enforces the form's shape; this enforces the rest, and its tokens name each failure.

/**
 * A record cited by its bare register id, with no office before it, resolved to the one record the run
 * holds whose id ends with it; null when none does, or when several different records do. A tool's
 * answer can show a record that way (a designation inside another record, say), so a judge may cite it
 * so. The check and the merge both resolve through this, so a citation the check accepts is filed under
 * the record the check accepted it as.
 */
export function bareIdResolver(ids) {
  const byTail = new Map();
  for (const raw of ids ?? []) {
    const id = String(raw ?? "").trim();
    const at = id.lastIndexOf("/");
    if (!id.startsWith("/") || at < 0 || at === id.length - 1) continue;
    const tail = id.slice(at + 1).toLowerCase();
    const canon = (normalizeRecordUri(id) ?? id).toLowerCase();
    const seen = byTail.get(tail);
    if (seen === undefined) byTail.set(tail, { id, canon });
    else if (seen && seen.canon !== canon) byTail.set(tail, null);   // several records end with it
  }
  return (ref) => {
    const s = String(ref ?? "").trim();
    if (!s || s.includes("/") || /^https?:/i.test(s)) return null;
    return byTail.get(s.toLowerCase())?.id ?? null;
  };
}

/**
 * Check one answer. `pile` gives the record ids the run holds; `webUrls` the saved web addresses;
 * `framework` the client's scale (its manifest). Returns `{ ok, failures: [token…] }`. PURE.
 */
export function checkAnswer(answer, { recordIds, webUrls = new Set(), framework }) {
  const failures = [];
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return { ok: false, failures: ["judgment_no_answer"] };
  const considered = Array.isArray(answer.considered) ? answer.considered : null;
  if (!considered) failures.push("judgment_considered_missing");
  const bare = bareIdResolver(recordIds);
  const held = (ref) => {
    const s = String(ref ?? "").trim();
    if (!s) return false;
    if (recordIds.has(s)) return true;
    const canon = normalizeRecordUri(s);
    if (canon && recordIds.has(canon)) return true;
    if (bare(s)) return true;
    return webUrls.has(s) || webUrls.has(s.replace(/\/+$/, ""));
  };
  const isBand = (r) => framework ? bandIndex(framework, r) !== -1 : String(r ?? "").trim() !== "";
  for (const [i, d] of (considered ?? []).entries()) {
    const n = i + 1;
    const owners = Array.isArray(d?.owners) ? d.owners.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
    const records = Array.isArray(d?.records) ? d.records : [];
    const unheld = records.filter((r) => !held(r));
    if (unheld.length) failures.push(`judgment_record_not_held:${n}:${unheld.slice(0, 3).map((r) => String(r).slice(0, 80)).join(",")}`);
    const rating = String(d?.rating ?? "").trim();
    for (const [field, values] of [["marks_alike", MARKS_ALIKE], ["goods_close", GOODS_CLOSE]]) {
      const v = String(d?.[field] ?? "").trim();
      if (!values.includes(v)) failures.push(`judgment_${field}_not_a_choice:${n}:${v.slice(0, 40)}`);
    }
    if (d?.decision === "carry") {
      if (!owners.length) failures.push(`judgment_carry_no_owner:${n}`);
      if (!String(d?.reason ?? "").trim()) failures.push(`judgment_carry_no_reason:${n}`);
      if (!isBand(rating)) failures.push(`judgment_rating_not_a_band:${n}:${rating.slice(0, 40)}`);
    } else if (d?.decision === "set_aside") {
      // "empty when set aside" — and a band, if a set-aside entry carries one anyway, is still a band.
      if (rating && !isBand(rating)) failures.push(`judgment_rating_not_a_band:${n}:${rating.slice(0, 40)}`);
    } else {
      failures.push(`judgment_decision_invalid:${n}`);
    }
  }
  if (!isBand(answer.overall_rating)) failures.push(`judgment_overall_not_a_band:${String(answer.overall_rating ?? "").slice(0, 40)}`);
  return { ok: failures.length === 0, failures };
}

// ── THE MERGE AND THE FATE OF EVERY OWNER ────────────────────────────────────────────────────────────
//
// "Carried by either session is carried; set aside by both is set aside; a decision naming a crowd of
// owners joins the other session's decisions naming them one by one; differing ratings are both kept and
// passed on. Every owner in the pile gets a recorded fate: carried, set aside with the reason, or never
// put in front of a session (shown in no opening page and looked up by neither)." (design, 2026-10-01)
//
// An owner a session WAS shown — on an opening page, or in a tool's answer — and that neither judge raised
// is a decision with a reason of its own (design ruling, 2026-10-01): seen by the judges, raised by
// neither. It is recorded as that, a ground the step's own record holds, never as a silence. The fate keeps
// its own name so the record still tells an owner judged and dismissed from one seen and passed over, and
// the report's "also considered" reads only the first (`set_aside`), never the second.

export const FATES = Object.freeze({
  CARRIED: "carried",
  SET_ASIDE: "set_aside",
  SHOWN_NOT_TAKEN_UP: "shown_not_taken_up",
  NEVER_SHOWN: "never_shown",
});

// Two folded names are one owner when they are the same, or one holds the other whole as words — the
// bench's rule (`second-look.mjs`), with its floor of six letters so a short word never swallows a name.
const holds = (long, short) => short.length >= 6 && ` ${long} `.includes(` ${short} `);
export const sameOwner = (a, b) => a === b || holds(a, b) || holds(b, a);

/**
 * The owners one decision names, as table keys: the names it gives, folded, and the owners of the records
 * it cites. A decision whose names match no owner of the pile (a web-only user) keeps its folded names.
 */
export function ownersOfDecision(d, { keyOfRecord, tableKeys }) {
  const keys = new Set();
  for (const name of Array.isArray(d?.owners) ? d.owners : []) {
    const k = ownerKey(name);
    if (!k) continue;
    const hit = tableKeys.filter((t) => sameOwner(t, k));
    if (hit.length) hit.forEach((h) => keys.add(h)); else keys.add(k);
  }
  for (const id of Array.isArray(d?.records) ? d.records : []) {
    const k = keyOfRecord(String(id)) ?? keyOfRecord(normalizeRecordUri(String(id)));
    if (k) keys.add(k);
  }
  return [...keys];
}

const isWebAddress = (s) => /^https?:\/\//i.test(String(s ?? "").trim());

/**
 * The two answers merged, and the fate of every owner of the pile. PURE.
 *
 * `table` is the owner table (owner-table.mjs; null when the run records no mark, in which case every
 * decision keeps its own folded names and no owner of the pile has a row to be given a fate). `judges` is
 * one entry per judge whose answer passed its check: `{ judge, answer, opening, looked }`, where `opening`
 * holds the owners on the opening pages its message carried and `looked` the owners its accepted session
 * was shown in a tool's answer, both as table keys.
 *
 * Returns `{ carried, setAside, fates, overall, advice, questions }`:
 *   · carried — the carry decisions, joined where they name one owner (a decision naming a crowd joins the
 *     other judge's decisions naming its owners one by one), each with every decision either judge made
 *     about those owners, set-aside ones included, and each judge's rating kept as that judge gave it,
 *     with that judge's two reads beside it;
 *   · setAside — the set-aside decisions about owners nobody carried, joined the same way;
 *   · fates — one row per owner of the pile: carried, set aside, shown and not taken up, or never shown.
 */
export function mergeJudgments({ table = null, judges = [] } = {}) {
  const rows = table?.rows ?? [];
  const tableKeys = rows.map((r) => r.key);
  const ownerOfRecord = new Map();
  for (const r of rows) for (const rec of r.records) ownerOfRecord.set(String(rec.id).toLowerCase(), r.key);
  const keyOfRecord = (id) => ownerOfRecord.get(String(id ?? "").toLowerCase()) ?? null;
  const bare = bareIdResolver(rows.flatMap((r) => r.records.map((rec) => rec.id)));

  const entries = [];
  for (const j of judges) {
    for (const [i, raw] of (Array.isArray(j.answer?.considered) ? j.answer.considered : []).entries()) {
      // A record cited by its bare id is filed under the record the check accepted it as.
      const d = { ...raw, records: (Array.isArray(raw?.records) ? raw.records : []).map((r) => bare(r) ?? r) };
      const cited = d.records.map((r) => String(r ?? "").trim()).filter(Boolean);
      entries.push({
        judge: j.judge, n: i + 1, decision: d?.decision,
        owners: (Array.isArray(d?.owners) ? d.owners : []).map((o) => String(o ?? "").trim()).filter(Boolean),
        records: cited.filter((r) => !isWebAddress(r)),
        web: cited.filter(isWebAddress),
        rating: String(d?.rating ?? "").trim(),
        marks_alike: String(d?.marks_alike ?? "").trim(),
        goods_close: String(d?.goods_close ?? "").trim(),
        reason: String(d?.reason ?? "").trim(),
        keys: ownersOfDecision(d, { keyOfRecord, tableKeys }),
      });
    }
  }
  const carryEntries = entries.filter((e) => e.decision === "carry");
  const asideEntries = entries.filter((e) => e.decision === "set_aside");
  const carriedKeys = new Set(carryEntries.flatMap((e) => e.keys));

  // Joined where they name one owner: a union of entries over the keys they share. A decision that names
  // no owner (a web-only decision with no name) stands alone.
  const join = (list) => {
    const groups = [];
    for (const e of list) {
      const into = e.keys.length ? groups.filter((g) => e.keys.some((k) => g.keys.has(k))) : [];
      const g = into.length ? into[0] : { keys: new Set(), entries: [] };
      for (const other of into.slice(1)) { other.keys.forEach((k) => g.keys.add(k)); g.entries.push(...other.entries); groups.splice(groups.indexOf(other), 1); }
      e.keys.forEach((k) => g.keys.add(k));
      g.entries.push(e);
      if (!into.length) groups.push(g);
    }
    return groups;
  };
  const readsOf = (e) => ({ ...(e.marks_alike ? { marks_alike: e.marks_alike } : {}), ...(e.goods_close ? { goods_close: e.goods_close } : {}) });
  const decisionOf = (e) => ({ judge: e.judge, decision: e.decision, owners: e.owners, records: e.records, web: e.web,
    ...(e.rating ? { rating: e.rating } : {}), ...readsOf(e), reason: e.reason });
  const ownersInPile = (keys) => [...keys].filter((k) => table?.byKey?.has(k)).map((k) => {
    const r = table.byKey.get(k);
    return { owner: r.row.owner, closeness: r.row.closeness, records: r.row.records, live_in_the_order_classes: r.row.live_in_the_order_classes };
  });
  const unique = (list) => [...new Set(list)];

  const carried = join(carryEntries).map((g) => {
    const dissent = asideEntries.filter((e) => e.keys.some((k) => g.keys.has(k)));
    const all = [...g.entries, ...dissent].sort((a, b) => a.judge - b.judge || a.n - b.n);
    const ratings = g.entries.map((e) => ({ judge: e.judge, rating: e.rating, ...readsOf(e) }));
    const byJudge = unique(g.entries.map((e) => e.judge));
    return {
      owners: unique(g.entries.flatMap((e) => e.owners)),
      owners_in_the_pile: ownersInPile(g.keys),
      records: unique(all.flatMap((e) => e.records)),
      web: unique(all.flatMap((e) => e.web)),
      ratings,
      carried_by: byJudge,
      agreed: byJudge.length === judges.length && judges.length > 1 && unique(ratings.map((r) => r.rating)).length === 1,
      decisions: all.map(decisionOf),
    };
  });
  const setAside = join(asideEntries.filter((e) => !e.keys.length || e.keys.some((k) => !carriedKeys.has(k)))).map((g) => ({
    owners: unique(g.entries.flatMap((e) => e.owners)),
    owners_in_the_pile: ownersInPile([...g.keys].filter((k) => !carriedKeys.has(k))),
    records: unique(g.entries.flatMap((e) => e.records)),
    web: unique(g.entries.flatMap((e) => e.web)),
    set_aside_by: unique(g.entries.map((e) => e.judge)),
    decisions: g.entries.sort((a, b) => a.judge - b.judge || a.n - b.n).map(decisionOf),
  }));

  const fates = rows.map((r) => {
    const k = r.key;
    const carriers = carryEntries.filter((e) => e.keys.includes(k));
    if (carriers.length) return { key: k, owner: r.row.owner, fate: FATES.CARRIED, by: unique(carriers.map((e) => e.judge)), ratings: carriers.map((e) => ({ judge: e.judge, rating: e.rating })) };
    const asiders = asideEntries.filter((e) => e.keys.includes(k));
    if (asiders.length) return { key: k, owner: r.row.owner, fate: FATES.SET_ASIDE, by: unique(asiders.map((e) => e.judge)), reasons: asiders.map((e) => ({ judge: e.judge, reason: e.reason })) };
    const opening = judges.filter((j) => j.opening?.has(k)).map((j) => j.judge);
    const looked = judges.filter((j) => j.looked?.has(k)).map((j) => j.judge);
    if (opening.length || looked.length) return { key: k, owner: r.row.owner, fate: FATES.SHOWN_NOT_TAKEN_UP, opening, looked };
    return { key: k, owner: r.row.owner, fate: FATES.NEVER_SHOWN };
  });

  return {
    carried, setAside, fates,
    overall: judges.map((j) => ({ judge: j.judge, rating: String(j.answer?.overall_rating ?? "").trim() })),
    advice: judges.map((j) => ({ judge: j.judge, advice: String(j.answer?.advice ?? "").trim() })),
    questions: judges.flatMap((j) => (Array.isArray(j.answer?.questions_wished_for) ? j.answer.questions_wished_for : [])
      .map((q) => String(q ?? "").trim()).filter(Boolean).map((question) => ({ judge: j.judge, question }))),
  };
}

/** Each fate's count, for the run's record and the step's log line. PURE. */
export function fateCounts(fates) {
  const out = Object.fromEntries(Object.values(FATES).map((f) => [f, 0]));
  for (const f of fates ?? []) out[f.fate] = (out[f.fate] ?? 0) + 1;
  return { owners: (fates ?? []).length, ...out };
}

const clipTo = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * Why a record the judging step did not carry left it: its owner's fate, in the step's words where a judge
 * gave them and in the code's where the fate is a fact of what each judge was shown. The reason sources
 * are the discard ledger's (record-carry.mjs, REASON_SOURCES): a judge's stated reason is `step-stated`;
 * an owner seen by the judges and raised by neither is `step-structural` (what each judge was shown is the
 * step's own record); an owner never shown is `step-structural` too (the table's order and the judges'
 * reading decided it). PURE.
 */
export function judgmentDiscardReason(fate, { cited = true } = {}) {
  if (!fate) return { reason: "judgment:indeterminate", reason_source: "absent", detail: "this record's owner has no recorded fate" };
  // A carried owner is carried on the records the judges cited, and those are what the writer is handed;
  // the owner's other records are not findings, and the reason is a fact code holds, not a silence.
  if (fate.fate === FATES.CARRIED && !cited) {
    return { reason: "judgment:owner-carried-on-other-records", reason_source: "step-structural",
      detail: "its owner was carried on the records the judges cited, and this record was not among them" };
  }
  if (fate.fate === FATES.SET_ASIDE) {
    const said = fate.reasons.map((r) => `judge ${r.judge}: ${r.reason}`).join(" / ");
    return { reason: "judgment:set-aside", reason_source: "step-stated", detail: clipTo(`set aside by ${fate.by.length > 1 ? "both judges" : `judge ${fate.by[0]}`} — ${said}`, 300) };
  }
  if (fate.fate === FATES.SHOWN_NOT_TAKEN_UP) {
    // A GROUND, NOT A SILENCE: what each judge was shown is the step's own record (the opening pages and the
    // reading log), so code states it. Read as `step-silent`, every such owner counted as a record that left
    // the judges with no ground (hand-off-exits.mjs), which is the loss the step exists to end.
    const seenBy = [...new Set([...(fate.opening ?? []), ...(fate.looked ?? [])])].sort((a, b) => a - b);
    const who = seenBy.length > 1 ? "both judges" : `judge ${seenBy[0]}`;
    return { reason: "judgment:seen-not-raised", reason_source: "step-structural", detail: `seen by ${who}, raised by neither` };
  }
  if (fate.fate === FATES.NEVER_SHOWN) {
    return { reason: "judgment:never-shown", reason_source: "step-structural", detail: "this owner was put in front of neither judge: it was on no opening page and neither judge looked it up" };
  }
  return null;   // carried: no reason is owed
}

// ── THE FACTS EACH ANSWER IS CHECKED AGAINST ─────────────────────────────────────────────────────────
//
// Written by the driver before the judges run, beside their answers, so the stage's validator — which is
// handed a file and nothing else — checks an answer against this run's own records, web results and scale.

/** How many sessions judge the pile, each alone. */
export const JUDGES = 2;

/** The facts file's name, beside the answers in `_driver/`. */
export const JUDGMENT_FACTS_FILE = "owner-judgment-facts.json";

/** Write the facts: every record id the pile holds, every saved web address, and the client's scale. */
export function writeJudgmentFacts(file, { pile, framework }) {
  const webUrls = new Set();
  try {
    for (const cell of pile.webCells() ?? []) for (const c of cell.results ?? []) if (c?.url) webUrls.add(String(c.url).trim());
  } catch { /* no web results: none to cite */ }
  const facts = { recordIds: pile.records.map((r) => r.id), webUrls: [...webUrls], framework: framework ?? null };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(facts));
  renameSync(`${file}.tmp`, file);
  return { records: facts.recordIds.length, web: facts.webUrls.length };
}

/** Read the facts as the check takes them, or null when the file is absent or unreadable. */
export function readJudgmentFacts(file) {
  if (!existsSync(file)) return null;
  try {
    const f = JSON.parse(readFileSync(file, "utf8"));
    const recordIds = new Set();
    for (const id of f.recordIds ?? []) { recordIds.add(String(id)); const canon = normalizeRecordUri(String(id)); if (canon) recordIds.add(canon); }
    return { recordIds, webUrls: new Set((f.webUrls ?? []).map(String)), framework: f.framework ?? null };
  } catch { return null; }
}

/**
 * The stage's validator: the answer file the driver wrote, checked against the facts beside it. Returns
 * `{ ok, failures }`; an absent facts file is the driver's own failure and says so.
 */
export function checkJudgmentFile(path, content) {
  let answer;
  try { answer = JSON.parse(content); } catch { return { ok: false, failures: ["judgment_answer_unparseable"] }; }
  const facts = readJudgmentFacts(join(dirname(path), JUDGMENT_FACTS_FILE));
  if (!facts) return { ok: false, failures: ["judgment_facts_missing"] };
  return checkAnswer(answer, facts);
}
