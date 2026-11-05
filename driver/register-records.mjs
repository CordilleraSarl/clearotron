// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-records.mjs — the neutral record of a filing, and the sentences that speak about a name's filings.
//
// A count nobody can inspect is a teaser, not a finding. The filings behind a knockout's counts are read by its
// reading step (knockout-register-read.mjs); this module holds what every surface shares about them.
//
// 1. NO MODEL TOUCHES A ROW. Code asks, code writes the record, code renders the table. Not one field passes through a
//    turn, so a row cannot be paraphrased, re-ordered or invented.
// 2. A FETCH THAT FAILED IS NOT AN EMPTY LIST. `records: []` reads as "no filings", which is a finding and a false one.
//    A question carries its own status, and the absence of the artifact, the absence of a question and an
//    empty-but-answered question are three different facts and they stay three.
// 3. NO JUDGMENT IS ADDED by code. The fields are what the register said: mark, owner, status, classes, territory, and
//    the record's own address.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordOriginsFor } from "./record-origins.mjs";           // — provider-derived, never CLEAROTRON_DATABASE

/** What the listing is, in one client-safe sentence. Rendered verbatim on every surface. */
export const RECORD_BASIS = "The filings behind the two narrow counts — the name itself and each close "
  + "variation of it — as the register holds them, class-scoped exactly as the counts were. Raw register "
  // "RATED", NOT "WEIGHED" (owner,) — the word only; the disclaimer this sentence
  // exists to make is untouched, and it is the load-bearing half: a filing in this list is not a
  // finding that it blocks anything.
  + "facts only: nothing here is rated, ranked or interpreted, and a filing appearing in this list is "
  + "not a finding that it blocks anything.";

/**
 * May the listing run on this provider? Null when it may, else a sentence naming what stops it.
 *
 * Structural, like the count lane's preflight: no retry and no budget changes the answer, so it is
 * settled once before anything is spent rather than once per mark.
 */
export function recordsPreflight({ capabilities, hasAdapter = true }) {
  const id = capabilities?.id ?? "unknown";
  // NOTE there is no `screenSource` arm here. `billed-record-fetch` used to refuse on the reading that
  // every printed field costs its own billed call; it does not — the fetch is a 100-id batch (see the
  // cost table above), so that provider lists for two calls per term like the rest. What decides whether
  // this lane can run is whether an adapter exists, and that is the only question left below.
  if (!hasAdapter)
    return `the active register provider (${id}) exposes no record-listing adapter in this build, so the filings behind the counts cannot be fetched. The counts are unaffected and still run.`;
  return null;
}

/** One provider row → the neutral record. Every field is EXPLICIT, and an absent one is null rather
 *  than missing: a blank cell and an unstated field read alike to a human, and only one is honest. */
export function toRecord(row, { term, basis, provider }) {
  const classes = Array.isArray(row?.classes) ? row.classes
    : (Number.isInteger(row?.classes) ? [row.classes] : null);
  const territory = row?.office ?? (typeof row?.jurisdictions === "string" ? row.jurisdictions : null)
    ?? (Array.isArray(row?.jurisdictions) ? row.jurisdictions.map((j) => j?.jurisdiction ?? j).filter(Boolean).join(", ") || null : null);
  return {
    recordId: row?.record_id ?? null,
    mark: row?.mark_text ?? null,
    owner: row?.owner_name ?? null,
    ownerCountry: row?.owner_country ?? null,
    status: row?.status ?? null,
    classes,
    territory,
    applicationDate: row?.application_date ?? null,
    registrationDate: row?.registration_date ?? null,
    // The office's own numbers, where the provider hands them over. On a register with no record pages of
    // its own, publish addresses the office's page for the filing from these (office-record-links.mjs).
    applicationNumber: row?.application_number ?? null,
    registrationNumber: row?.registration_number ?? null,
    irNumber: row?.ir_number ?? null,
    filingRoute: row?.filing_route ?? null,
    // The office's page as the register gave it, where it gave one; publish uses it only when the numbers
    // above do not address the office's page.
    officeUrl: row?.office_url ?? null,
    // WHICH QUESTION FOUND IT. Without this a reader cannot tell a filing on the name from a filing on
    // a generated variant, and the two mean very different things to the person deciding on the name.
    matchedForm: term,
    matchedBasis: basis,
    url: row?.record_url ?? null,
    provider,
  };
}

/** How many marks got at least one filing. Zero means the listing produced nothing anyone can read. */
export function listedMarks(doc) {
  return (doc?.marks ?? []).filter((m) => (m?.records ?? []).length).length;
}

/** One mark's listing, by name — the publisher's join. Absent ⇒ null, never an empty list. */
export function recordsForMark(doc, name) {
  const key = String(name ?? "").trim().toLowerCase();
  return (doc?.marks ?? []).find((m) => String(m.name).trim().toLowerCase() === key) ?? null;
}

/**
 * — reduce every record URL this sidecar carries that the run's own register cannot have produced.
 * Mutates in place and returns what it reduced, for the publisher's log line.
 *
 * THE KNOCKOUT LANE HAD NO RECORD-ORIGIN LOGIC AT ALL. derived the record host from the provider
 * and repaired the clearance lane's links against it; neither reached here, so `render-knockout.mjs`
 * linked whatever the model wrote and a run on any provider could cite a filing and link to a DIFFERENT
 * registry. It is invisible — the link resolves to a real page and nothing errors — and knockout is the
 * cheap screen people try first, so it is the product most likely to be run against a register the
 * reader has never heard of.
 *
 * WHICH FIELD, FROM THE DATA. `record.url` is a register record's address by its position in this
 * sidecar, not by what the URL looks like. Nothing here pattern-matches a host to decide whether a URL
 * is a record — that move is what produced this defect class. The evidence URLs on a knockout finding
 * live on a different object (`finding.evidence`) and are deliberately untouched: a storefront link is
 * not a register citation and gating it would delete the run's own proof.
 *
 * WHAT REPLACES A FOREIGN URL, and why it is not an origin swap: `null`, so the surfaces fall through to
 * `recordId` — the `/mark/<cc>/<number>` path that IS the canonical record identity this system stores.
 * The reader gets the record number in plain text beside the office label, which is word for word the
 * remedy the refusal message prescribes. Composing the run provider's origin onto the path instead
 * would invent a URL nobody fetched, and on `free-tier` there are two offices and no single origin to
 * swap to.
 *
 * `null` RATHER THAN `""` is load-bearing: the workbook's Record cell is `r.url ?? r.recordId ?? '—'`,
 * and `??` passes an empty string through — so clearing to "" blanks the cell that is supposed to carry
 * the fallback. The HTML surfaces test truthiness and would have hidden that.
 *
 * @param {object|null} doc  the parsed register-records.json, mutated in place
 * @returns {{mark:string,recordId:string|null,was:string}[]}
 */
export function normalizeRegisterRecordLinks(doc) {
  // No provider on the sidecar ⇒ the gate is OFF and the output is byte-identical. A run that never
  // recorded which register it searched cannot be judged against one, and legacy/archived sidecars are
  // exactly that case. Same call the clearance lane makes for a run with no fetch receipts.
  const provider = String(doc?.provider ?? "").trim().toLowerCase();
  if (!provider) return [];

  // An EMPTY allow-list is an answer, not an absence: clarivate and signa publish no per-record page, so
  // no absolute record URL is legitimate on them. An UNRECOGNISED provider id lands here too and every
  // absolute URL goes — deliberately, and the same way the clearance lane resolves it, because a host
  // that cannot be established as legitimate is not one to put in front of a client.
  const origins = recordOriginsFor(provider);
  const dropped = [];
  for (const m of doc?.marks ?? []) {
    for (const r of m?.records ?? []) {
      const s = String(r?.url ?? "").trim();
      // A relative value is not a host claim — findings-model.mjs says so in the same words — and is
      // left exactly as written.
      if (!/^https?:\/\//i.test(s)) continue;
      let u;
      try { u = new URL(s); } catch { continue; }
      if (origins.includes(u.origin)) continue;
      dropped.push({ mark: m?.name ?? null, recordId: r?.recordId ?? null, was: s });
      r.url = null;
    }
  }
  return dropped;
}

/**
 * The one-line, client-safe summary of a mark's listing. Code-owned wording, so the report, the
 * workbook and report-data.json can never phrase the same fact three ways.
 *
 * It states the truncation and the failures, because both are the difference between "these are the
 * filings" and "these are some of the filings".
 */
export function recordsLine(entry) {
  if (!entry) return null;
  const failed = (entry.terms ?? []).filter((t) => !t.ok && !t.notAsked);
  const skipped = (entry.terms ?? []).filter((t) => t.notAsked);
  // — the register(s) this listing did not reach, appended to whichever sentence comes back below.
  // The EMPTY-LIST branch is the one that needs it most and is the easiest to leave out: "the register
  // returned none under the name or any close variation of it" is a clean negative, and over a scope
  // silently narrowed to EU it is a false one. Same rule as countLine — the narrowing and the sentence
  // ship together.
  const unlisted = entry.officeScope?.unlisted ?? [];
  const one = unlisted.length === 1;
  const officeNote = unlisted.length
    ? ` ${unlisted.map((u) => u.office).join(", ")} ${one ? "is" : "are"} covered by this register but `
      + `${one ? "was" : "were"} not searched on this system, so no filing from ${one ? "it" : "them"} `
      + `appears here.`
    : "";
  // — the ordered territories this register never covered. Appended to whichever sentence comes
  // back, and needed most in the EMPTY-LIST branch below for the same reason the note is: "the
  // register returned none under the name or any close variation of it" is a clean negative, and over a
  // matter that ordered Japan on a register with no Japanese coverage it is a false one.
  const outside = entry.deferredScope ?? [];
  const oneOutside = outside.length === 1;
  const coverageNote = outside.length
    ? ` ${outside.join(", ")} ${oneOutside ? "was" : "were"} ordered for this matter and ${oneOutside ? "is" : "are"} `
      + `outside this register's coverage entirely, so no filing from ${oneOutside ? "it" : "them"} could `
      + `appear here whatever the register holds.`
    : "";
  if (!entry.records?.length) {
    // A failed search's own text is not printed: it is a provider's or the program's words, and it stays in
    // the run's filings record and its ledger, where the listing wrote it.
    //
    // — A SEARCH NEVER ASKED IS NOT A SEARCH THAT FOUND NOTHING, and this branch could not tell them
    // apart. `failed` deliberately excludes `notAsked`, and the loop above is equally deliberate about
    // recording it ("the term was never asked, and saying so is the difference"). With the record cap at
    // zero EVERY term comes back notAsked, so `failed` is empty, and the sentence that came out was the
    // clean negative — word for word what a listing that ran on every form and found nothing prints. The
    // populated branch below has said `form(s) not reached before the cap` all along; the empty one threw
    // the same fact away in the one place it decided the whole sentence.
    //
    // So the clean negative now needs POSITIVE EVIDENCE: a term asked and answered, with nothing unasked
    // beside it. Anything else is a listing that did not complete, which is the wording of the ruling and
    // the clause the knockout page already prints for the same fact.
    //
    // THE ORDER OF THE THREE IS DELIBERATE. The failed branch stays first and its sentence is unchanged to
    // the byte: a listing whose searches failed already said so, and this is not the item that touches it.
    // A run with both failures and stopped forms therefore still reports only its failures — pre-existing,
    // and left alone rather than widened on the way past.
    // A LIST COUNTED AND NOT READ IS NOT NONE EITHER: the register holds filings under it and this run set them aside.
    const answered = (entry.terms ?? []).filter((t) => t.ok && !t.setAside);
    const setAside = (entry.terms ?? []).filter((t) => t.setAside);
    if (failed.length) {
      return `Filings: not available — ${failed.length} of ${(entry.terms ?? []).length} search(es) could not be run.`
        + officeNote + coverageNote;
    }
    return (answered.length && !skipped.length && !setAside.length
      ? `Filings: the register returned none under the name or any close variation of it, in the classes counted${unlisted.length ? ` and in the register${(entry.officeScope?.listed ?? []).length === 1 ? "" : "s"} searched (${(entry.officeScope?.listed ?? []).join(", ")})` : ""}.`
      : "Filings: the listing did not complete, so nothing here says whether one stands.")
      + officeNote + coverageNote;
  }
  const parts = [`${entry.records.length} filing${entry.records.length === 1 ? "" : "s"} listed`];
  // "of N" is the SUM ACROSS THE SEARCHES, not a count of distinct filings — a filing that answers both
  // the name and a variation of it is listed once here and counted twice there. Worded so a reader does
  // not read it as a distinct-record total, which would make the listed fraction look smaller than it is.
  if (Number.isFinite(entry.available) && entry.available > entry.records.length)
    parts.push(`out of ${entry.available} hits across the searches run`);
  if (entry.capped) parts.push(`capped at ${entry.cap} per name`);
  if (failed.length) parts.push(`${failed.length} search(es) could not be run`);
  if (skipped.length) parts.push(`${skipped.length} form(s) not reached before the cap`);
  // — the note rides the populated branch too. A listing WITH filings is where a reader is most
  // likely to stop reading and assume the scope was the one they ordered.
  return `${parts.join(", ")}.${coverageNote}`;
}

// The fixture seam, mirroring the counts lane's — a dev instance never bills a register. The parameter
// below already outranked `process.env.CLEAROTRON_KNOCKOUT_RECORD_FIXTURES` and nobody ever passed it, so
// the environment was in practice the only way in. The job declares it now.
// `recordLog` — the run's own record-body log. The knockout listing hydrates its filings through
// the provider's batch-screen surface on some providers, and that surface writes record BODIES. Left
// unset those bodies land in the box-global file this issue retires, so the lane that never reads them
// would still be the thing filling the disk.
export function resolveRecordExecutor({ lister = null, adapter = null, agentId = null, sessionKey = null, recordLog = null, fixtureDir = null, offline = false } = {}) {
  if (typeof lister === "function") return { list: lister, source: "injected" };
  if (fixtureDir) return { list: fixtureLister(fixtureDir), source: `fixtures:${fixtureDir}` };
  // A FIXTURE RUN NEVER FALLS THROUGH TO A LIVE REGISTER. The counts lane on this run is on fixtures —
  // a dev box, a CI suite, an E2E round — and this lane has none configured. Reaching for the provider
  // here would put a real register call inside a run whose whole guarantee is that it makes none, and
  // it would do it silently: the call fails on a dud credential, the listing records the failure, and
  // the run looks exactly like a run that tried honestly. `none` refuses instead, and the surfaces say
  // the listing was not taken.
  if (offline) return { list: null, source: "none" };
  if (typeof adapter?.listRecords !== "function") return { list: null, source: "none" };
  return {
    source: "provider",
    list: (term, { classes, regions, limit }) =>
      adapter.listRecords({ name: term, matchMode: "exact", classes, regions, limit }, { agentId, sessionKey, recordLog }),
  };
}

const fixtureSlug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Which file answers a question. The term alone is the exact question over the run's whole scope. A question with a
 * filter is a different question and has a different answer, so each filter is in the name: a goods-narrowed question
 * never reads the crowd's file, and one with no file is a question the fixture does not answer. PURE.
 */
export function fixtureFileName(term, { matchMode = "exact", goods = null, regions = null, classes = null, scoped = false } = {}) {
  const parts = [fixtureSlug(term)];
  if (matchMode && matchMode !== "exact") parts.push(fixtureSlug(matchMode));
  if (Array.isArray(goods) && goods.length) parts.push(`goods-${fixtureSlug(goods.join(" "))}`);
  if (scoped && Array.isArray(regions) && regions.length) parts.push(`in-${fixtureSlug(regions.join(" "))}`);
  if (scoped && Array.isArray(classes) && classes.length) parts.push(`class-${fixtureSlug(classes.join(" "))}`);
  return `${parts.join(".")}.json`;
}

/** The $0 dev/e2e executor: a directory of answer files (fixtureFileName), each `{ records: [...], total: n }`. */
export function fixtureLister(dir) {
  return async (term, question = {}) => {
    const file = join(dir, fixtureFileName(term, question));
    let doc;
    try { doc = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { return { ok: false, records: null, reason: `record fixture missing for ${term}: ${e.message}` }; }
    if (!Array.isArray(doc?.records)) return { ok: false, records: null, reason: `record fixture for ${term} carries no records[]` };
    return { ok: true, records: doc.records, total: Number.isFinite(doc.total) ? doc.total : doc.records.length };
  };
}
