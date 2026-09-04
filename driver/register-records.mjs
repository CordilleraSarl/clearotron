// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-records.mjs — the FILINGS behind the narrow numbers.
//
// A count nobody can inspect is a teaser, not a finding. "59 identical" has no faces: the count
// predicate returns a total and no rows, so the one question a reader asks next — WHICH filings? — had
// no answer anywhere, not in the report, not in the workbook, not over MCP.
//
// This lane answers it for the NARROW predicates only, and lists raw register facts. It is the counts
// lane's sibling and it inherits every one of its rules unchanged.
//
// ══ WHICH PREDICATES, AND WHY NOT THE THIRD ════════════════════════════════════════════════════════
//
//   identical  — the mark itself. Listed.
//   close      — each generated variant form (register-variants.mjs). Listed, per form, with the form
//                that found it recorded on every row.
//   containing — NEVER. That column is a breadth proxy over the register's broad name match, and its
//                figures run to the hundreds; listing it would bury the two narrow answers under a
//                list nobody asked for and turn a bounded fetch into an unbounded one. The owner ruled
//                it out and the reason is the same one that keeps the column labelled a proxy.
//
// ══ THE RULES, EXTENDED FROM THE COUNTS LANE ═══════════════════════════════════════════════════════
//
// 1. NO MODEL TOUCHES A ROW. Code asks, code writes the sidecar, code renders the table. Not one field
//    passes through a turn, so a row cannot be paraphrased, re-ordered or invented.
// 2. A FETCH THAT FAILED IS NOT AN EMPTY LIST. `records: []` reads as "no filings" — which is a
//    finding, and a false one. Every term carries its own status, and a term whose fetch failed says so
//    with the provider's own words. The absence of the artifact, the absence of a term and an
//    empty-but-answered term are three different facts and they stay three.
// 3. NO JUDGMENT IS ADDED. No similarity score, no "this one matters", no status interpretation. The
//    fields are what the register said: mark, owner, status, classes, territory, and the record's own
//    address. Whether any of it blocks anything is lawyer work this product does not do.
//
// ══ WHERE IT CAN RUN ═══════════════════════════════════════════════════════════════════════════════
//
// Off `capabilities.screenSource`, which is already declared and already probed for exactly this
// question — does a search ROW carry the fields, or do the fields cost a separate billed fetch?
//
//   "search-row" / "bulk-endpoint"  euipo, uspto-local, free-tier, corsearch. The rows come back with
//                                   the search. Listing is one call per term.
//   "billed-record-fetch"           clarivate. Its search answers with record IDENTIFIERS and nothing
//                                   else, so the fields cost a further call — but that call is a BATCH
//                                   of 100 ids (POST /text, TEXT_BATCH_MAX), and it hydrates all 100.
//                                   Listing is one search + ceil(N/100) screen calls per term. The flag
//                                   says the fields cost a fetch; it does NOT say the fetch is per
//                                   record, and reading it that way priced this lane out by ~50× and
//                                   would have shipped it inert on the register the deployment wires.
//
// ══ COST ═══════════════════════════════════════════════════════════════════════════════════════════
//
// One call per listed term, on top of the count lane's own call for the same term. They cannot share:
// the count rides `cheapCountParams` (`limit:1, fields:["uri"]` — the smallest response the API will
// give), that probe is BUILT BY makeEnumerate as well as by the count kernel, and widening it would
// change what every enumerate call fetches. So the listing pays its own way, and the receipts ledger
// carries a line per call with `stage: "records"` on it so the two lanes' costs can be told apart.
//
//   corsearch     one billable page-0 search per term. This is where the delta bites.
//   euipo         free in money, one request against the daily allowance per term.
//   uspto-local   free — a local SQLite read.
//   clarivate     one search + one POST /text per 100 listed ids per term — 2 calls at this lane's cap.
//                 The ids are capped BEFORE the screen, because this provider's search is single-shot
//                 and returns the complete guid set; screening what came back would be the runaway.
//
// This counts CALLS, which is the unit the receipts ledger records. What a call costs under any
// provider contract is not in this repo, so nothing here converts these into money.

import { appendFileSync } from "node:fs";

import { resolveRegions } from "./register-plan.mjs";
import { reachableRegions } from "./register-availability.mjs";   // — pure; the env binding is injected
import { variantForms, VARIANT_CAP } from "./register-variants.mjs";
import { recordOriginsFor } from "./record-origins.mjs";           // — provider-derived, never CLEAROTRON_DATABASE

/** Records per MARK, across every listed term. A bound on cost, on artifact size and on what a reader
 *  can usefully hold — and it is stated wherever the list renders, per the owner ruling. */
export const RECORD_CAP = 100;

/** The floor on a single term's share of the cap. Without it a name generating twelve forms would give
 *  each form eight rows, and a form with eight rows tells a reader almost nothing. */
const PER_TERM_FLOOR = 5;

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

// bounded-concurrency fan-out — the same local idiom as register-count.mjs, for the same reason.
async function runBatched(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const cap = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}

/** The terms one mark is listed under, in report order: the mark, then its generated forms. */
export function listedTerms(name, { variantCap = VARIANT_CAP } = {}) {
  const v = variantForms(name, { cap: variantCap });
  return [
    { term: v.base, basis: "identical", label: "the name itself" },
    ...v.forms.map((f) => ({ term: f.form, basis: "close", label: `close variation (${f.rules.join(", ")})`, rules: [...f.rules] })),
  ];
}

/** One provider row → the neutral record. Every field is EXPLICIT, and an absent one is null rather
 *  than missing: a blank cell and an unstated field read alike to a human, and only one is honest. */
function toRecord(row, { term, basis, provider }) {
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
    // WHICH QUESTION FOUND IT. Without this a reader cannot tell a filing on the name from a filing on
    // a generated variant, and the two mean very different things to the person deciding on the name.
    matchedForm: term,
    matchedBasis: basis,
    url: row?.record_url ?? null,
    provider,
  };
}

/**
 * List the filings behind the narrow counts, for every mark in the batch.
 *
 * @param marks   [{ name, classes? }] — the request's rows, same source as the counts lane.
 * @param lister  async (term, { classes, regions, limit }) => { ok, records[], total, reason }
 * @returns the sidecar document, ready to write. Never throws for one mark or one term: a failed fetch
 *          is a recorded status, and the caller decides what a batch-wide failure means.
 */
export async function listRegisterRecords({
  marks, classes = null, jurisdictions = null, provider, capabilities,
  lister, concurrency = 3, ledgerPath = null, now = () => new Date(),
  cap = RECORD_CAP, variantCap = VARIANT_CAP, unreachable = [],
}) {
  const { regions: coveredRegions, deferred, worldwide } = resolveRegions(jurisdictions, capabilities);
  // — the same office split the count lane above does, for the same reason and with the same
  // helper. This lane had the identical defect: full declared coverage handed straight to a composite
  // adapter, which fans out to a member the box cannot reach. Fixing only the counts would leave a
  // report whose figures cover EU and whose listed filings claim to cover EU+US.
  //
  // NO PREFLIGHT REFUSAL HERE, deliberately. The empty-coverage case is caught by countPreflight, which
  // runs first and throws inside the same `if (probeWanted)` block (pipeline-knockout.mjs), so this lane
  // is only reached when something is reachable. Adding a second refusal would also change this lane's
  // contract: recordsPreflight's refusals are non-fatal by design — "the counts are unaffected and still
  // run" — and a fatal one here would take down the product for a gap in its explanation.
  const { regions, dropped } = reachableRegions(coveredRegions, unreachable, capabilities?.offices?.covered, worldwide === true);
  const officeScope = dropped.length
    ? { listed: regions, unlisted: dropped.map((d) => ({ office: d.office, memberId: d.memberId, missing: [...(d.missing ?? [])] })) }
    : null;
  const batchClasses = (Array.isArray(classes) ? classes : []).filter((n) => Number.isInteger(n));
  const markCap = Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 0;

  const rows = await runBatched(marks ?? [], concurrency, async (m) => {
    const name = String(m?.name ?? "").trim();
    const own = (Array.isArray(m?.classes) ? m.classes : []).filter((n) => Number.isInteger(n));
    const scoped = own.length ? own : batchClasses;
    const terms = listedTerms(name, { variantCap });
    // THE SHARE IS DECIDED BEFORE THE FIRST CALL, and it is even. The obvious alternative — let the
    // identical predicate fill the cap and give the forms what is left — silently produces a listing
    // with no close variations in it on exactly the crowded names where the close variations are the
    // point. A term with fewer filings than its share simply returns fewer; the unused room is not
    // redistributed, because doing so would need a second pass and a second call per term.
    const perTerm = Math.max(PER_TERM_FLOOR, Math.floor(markCap / Math.max(1, terms.length)));

    const seen = new Set();
    const records = [];
    let capped = false;
    const termRows = await runBatched(terms, 1, async (t) => {
      const started = Date.now();
      const remaining = markCap - records.length;
      if (remaining <= 0) {
        capped = true;
        // NOT AN EMPTY RESULT. The term was never asked, and saying so is the difference between "no
        // filings under this form" and "we stopped before we got here".
        return { ...t, ok: false, fetched: 0, total: null, notAsked: true,
          reason: `the ${markCap}-record cap for this name was reached before this form was fetched` };
      }
      const want = Math.min(perTerm, remaining);
      let r;
      try { r = await lister(t.term, { classes: scoped, regions, limit: want, basis: t.basis }); }
      catch (e) { r = { ok: false, records: null, reason: `record listing threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
      const ok = Boolean(r?.ok) && Array.isArray(r?.records);
      let fetched = 0;
      if (ok) {
        for (const raw of r.records) {
          // THE SHARE IS ENFORCED ON INGEST, not only on the request. `limit` is a request to the
          // provider and a provider is free to answer with more — a fixture does, and so does any
          // source whose paging knob was named differently from the one we sent (euipo pages on `size`
          // and would ignore a `limit` entirely). Trusting the request alone let the first term swallow
          // the whole cap, which is exactly the outcome the even share exists to prevent: a crowded
          // name crowding its own variants off its own listing.
          if (fetched >= want) break;
          if (records.length >= markCap) { capped = true; break; }
          const rec = toRecord(raw, { term: t.term, basis: t.basis, provider });
          // Dedupe across terms: one filing can answer the name AND a variation of it, and printing it
          // twice would inflate a list a reader counts. The FIRST term to find it keeps it, and terms
          // run in report order, so a filing on the name is attributed to the name.
          const key = rec.recordId ?? `${rec.mark}|${rec.owner}|${rec.territory}`;
          if (seen.has(key)) continue;
          seen.add(key);
          records.push(rec);
          fetched += 1;
        }
      }
      if (ledgerPath) {
        try {
          appendFileSync(ledgerPath, JSON.stringify({
            ts: now().toISOString(), stage: "records", mark: name, term: t.term, basis: t.basis,
            classes: scoped, regions, provider, ok, requested: want, fetched,
            total: Number.isFinite(r?.total) ? r.total : null, took_ms: Date.now() - started,
            ...(ok ? {} : { cause: String(r?.reason ?? "unknown").slice(0, 300) }),
          }) + "\n");
        } catch { /* receipts are best-effort, never fatal */ }
      }
      return {
        ...t, ok, fetched,
        // How many the register HOLDS under this term, where it said. `fetched` under `total` is the
        // truncation, and it is stated rather than left for a reader to notice.
        total: Number.isFinite(r?.total) ? r.total : null,
        ...(ok ? {} : { reason: String(r?.reason ?? "the filings could not be fetched").slice(0, 300) }),
      };
    });

    return {
      name,
      classes: scoped.length ? scoped : null,
      classScope: scoped.length ? (own.length ? "mark" : "batch") : "all-classes",
      terms: termRows,
      records,
      // The three numbers a reader needs to trust the list: how many are here, how many the register
      // said there are under the listed terms, and whether the cap cut it.
      fetched: records.length,
      available: termRows.reduce((n, t) => (Number.isFinite(t.total) ? n + t.total : n), 0),
      capped: capped || records.length >= markCap,
      cap: markCap,
      // — which registers this listing covers, present only when one was dropped. Per-mark for the
      // same reason as the counts lane: recordsLine is handed one row.
      ...(officeScope ? { officeScope } : {}),
      // — territories ordered for this matter that this register does not cover at all. Carried
      // beside officeScope and never merged with it: covered-but-unreachable and never-covered send an
      // operator to different places.
      ...(deferred.length ? { deferredScope: deferred.map((d) => d.jurisdiction) } : {}),
    };
  });

  return {
    schema: 1,
    provider, providerLabel: capabilities?.label ?? provider,
    takenAt: now().toISOString(),
    basis: RECORD_BASIS,
    cap: markCap,
    // Stated on the artifact so a reader never has to infer it from an absence: the breadth column is
    // not listed, on purpose.
    listedPredicates: ["identical", "close"],
    excludedPredicates: [{ key: "containing", why: "a breadth proxy over the register's broad name match — its figures run to the hundreds, and listing them would bury the two narrow answers" }],
    scope: {
      jurisdictions: (jurisdictions ?? []).length ? jurisdictions : null,
      regions: regions.length ? regions : null,
      deferredJurisdictions: deferred.length ? deferred.map((d) => d.jurisdiction) : null,
      // — covered by the provider, unreachable on this box. See the counts sidecar for why this is
      // a separate field from the line above and not folded into it.
      ...(officeScope ? { unreachableOffices: officeScope.unlisted } : {}),
      classes: batchClasses.length ? batchClasses : null,
    },
    marks: rows,
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
 * remedy 's refusal message prescribes. Composing the run provider's origin onto the path instead
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
  // back, and needed most in the EMPTY-LIST branch below for the same reason 's note is: "the
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
    return (failed.length
      ? `Filings: not available — ${failed.length} of ${(entry.terms ?? []).length} search(es) could not be run (${failed[0].reason}).`
      : `Filings: the register returned none under the name or any close variation of it, in the classes counted${unlisted.length ? ` and in the register${(entry.officeScope?.listed ?? []).length === 1 ? "" : "s"} searched (${(entry.officeScope?.listed ?? []).join(", ")})` : ""}.`)
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

/** The $0 dev/e2e executor: a directory of <term-lower>.json files, each `{ records: [...], total: n }`. */
function fixtureLister(dir) {
  return async (term) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const file = join(dir, `${String(term).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`);
    let doc;
    try { doc = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { return { ok: false, records: null, reason: `record fixture missing for ${term}: ${e.message}` }; }
    if (!Array.isArray(doc?.records)) return { ok: false, records: null, reason: `record fixture for ${term} carries no records[]` };
    return { ok: true, records: doc.records, total: Number.isFinite(doc.total) ? doc.total : doc.records.length };
  };
}
