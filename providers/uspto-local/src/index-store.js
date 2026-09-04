// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// index-store.js — the LOCAL US register: schema, ingest and the four search predicates.
//
// WHY A LOCAL INDEX AT ALL. There is no free USPTO text-search API. TSDR answers by serial /
// registration number only and cannot be asked "which US marks look like ARBORA";
// tmsearch.uspto.gov has no public API; commercial resellers fail PHASE3-REQUIREMENTS R1 (raw
// register access, no black-box pre-filtering) and R9 (official programmatic API). USPTO does
// publish the whole register as bulk XML, so the only honest free route is to hold it locally and
// own the search. That is what this file is.
//
// ZERO DEPENDENCIES. node:sqlite ships inside Node 22+ with FTS5 compiled in, so the entire US
// register is one file on disk and there is nothing to install, no daemon and no database server.
// That is the whole reason this is viable for an open-source clone; it is why the engines floor
// moved to >=22 rather than adding a package.
//
// ── THE LOAD-BEARING CORRECTNESS RULE ──────────────────────────────────────────────────────────
// FTS5 supports a TRAILING star only. A reversed-text column plus a prefix query is the standard
// trick for ends-with, and it is WRONG ON ITS OWN, because FTS5 matches TOKENS, not the string:
// reversing "ARBORA LABS" gives "SBAL AROBRA", whose token AROBRA prefix-matches the reversed term
// — so a naive *ARBORA search returns a mark that STARTS with ARBORA and never ends with it.
// The over-match is DEMONSTRATED, not estimated: index-store.test.mjs holds marks that start with a
// term and do not end with it, and the naive narrower returns them. How MANY such marks the real
// register holds is unknown and does not matter — every one of them is a mark the report would have
// called a suffix conflict, and one is too many. (A specific false-positive rate used to be quoted
// here; it came from a synthetic fixture, so it described the fixture's own composition and nothing
// about the register.)
//
// So the FTS indexes are CANDIDATE NARROWERS and never the answer. Every anchored predicate verifies
// its candidates with an exact LIKE, and the LIKE is what decides.
//
// Do not "optimise" the LIKE away. It is the predicate, and dropping it does not make the query
// faster-but-looser — it makes it a different query that returns marks which do not match.
//
// (What the verification COSTS is unmeasured on real data. Whatever it turns out to be, it is not a
// reason to remove it. A cheaper wrong answer is not a trade this codebase makes.)
//
// CASE. Mark text is folded to upper case on the way in and query terms on the way through, so the
// FTS index and the LIKE agree. SQLite's LIKE is case-insensitive for ASCII only; folding both
// sides means the comparison never depends on that, which matters the moment a non-Latin mark
// arrives.
//
// GOODS & SERVICES are STORED but deliberately NOT indexed. The description text is the bulk of the
// register's weight and indexing it multiplies the index size several times over, while a clearance
// searches by mark NAME, not by description. Reports stay complete either way, and the column can be
// indexed later without a re-ingest, so the decision is reversible and cheap to revisit. (Both disk
// figures that used to be quoted here were extrapolations from a synthetic fixture and are struck;
// the decision does not rest on the exact numbers, only on the ratio being large.)

import { DatabaseSync } from "node:sqlite";

/** Every column a downstream band row is built from. Order matters — putRecords binds positionally. */
export const MARK_COLUMNS = Object.freeze([
  "serial", "regno", "text", "rtext", "owner", "owner_country",
  "status", "status_class", "classes", "filed", "regd", "expiry", "gs",
]);

/**
 * Every predicate this store can serve, and it MUST be the non-null keys of capabilities.predicates.
 *
 * "Keep them in step" was the previous instruction here and it was not enough — `owner` sat in this
 * list with no case behind it once already, and `default` sat in the CONTRACT with no case behind it
 * until a test executed the contract's keys rather than this list. The lists agreeing proves nothing;
 * the store answering every key the contract declares is the property, and index-store.test.mjs now
 * loops over capabilities.predicates to check it.
 *
 * `default` is the shared contract's name for an unanchored contains — the same query as
 * wildcardInfix, which is why capabilities gives both the same mode string. It is a real entry point,
 * not an alias for tidiness: the register_search tool takes it, and every provider's contract carries
 * the key.
 */
export const PREDICATES = Object.freeze([
  "exact", "default", "wildcardPrefix", "wildcardSuffix", "wildcardInfix", "owner",
]);

// ── STATUS ─────────────────────────────────────────────────────────────────────────────────────
//
// Table 1 of "Trademarks Application Daily XML V2.0 Documentation" (USPTO Electronic Information
// Products Division, table updated 2013-10-18). Enumerated, not inferred.
//
// THIS WAS A GUESS AND THE GUESS WAS DANGEROUS. An earlier version classified any code starting
// with 8 as dead. Code 800 is REGISTERED AND RENEWED — the most alive a US mark can be — and
// 801-825 are live prosecution and opposition states. Every renewed US registration would have been
// dropped from every conflict search, silently, as a clean negative. Ranges are not a status
// vocabulary; the office's own table is.
//
// The classification is deliberately ASYMMETRIC. Only codes whose own definition says the mark is
// gone — abandoned, cancelled, expired, IR-cancelled — are dead. Terminal-sounding procedural
// outcomes (763 refusal affirmed, 779 opposition sustained, 766 concurrent use denied) stay LIVE,
// because the case status moves to an abandonment code when it is genuinely over, and over-
// inclusion costs a lawyer one row to dismiss while under-inclusion costs a missed conflict.
// An unlisted code is "unknown", never "dead".

const DEAD_CODES = new Set([
  "400", "401", "402", "403",                                          // IR cancelled
  "600", "601", "602", "603", "604", "605", "606", "607", "608", "609", // abandoned
  "614",                                    // abandoned — petition to revive denied
  "618",                                    // abandoned file — backfile
  "622",                                    // misassigned serial number: not a mark at all
  "626",                                    // registered backfile, cancelled or expired
  "709", "710", "711", "712", "713", "714", "716",                     // cancelled (NOT 715)
  "900",                                    // expired
]);

// Codes that exist but say nothing about whether the mark is in force. Never inferred either way.
const UNKNOWN_CODES = new Set([
  "000",  // Unknown
  "620",  // backfile added to database — status not recorded
  "625",  // registration added to database — status unclear
  "969",  // non registration data
  "970",  // record created due to assignment request
]);

// 715 is CANCELLED - RESTORED TO PENDENCY: the cancellation was undone and the case is live again.
// It sits inside the cancelled run and is the reason that run is enumerated rather than a range.
const LIVE_CODES = new Set([
  "612", "616", "624", "630", "631", "632", "638",
  "640", "641", "642", "643", "644", "645", "646", "647", "648", "649",
  "650", "651", "652", "653", "654", "655", "656", "657", "658", "659",
  "660", "661", "663", "664", "665", "666", "667", "668",
  "672", "673", "680", "681", "682", "686", "689", "690", "692", "693", "694",
  "700", "701", "702", "703", "704", "705", "706", "707", "708",
  "715", "717", "718", "719", "720", "721", "722", "724", "725",
  "730", "731", "732", "733", "734",
  "740", "744", "745", "746", "748", "752", "753", "756", "757",
  "760", "762", "763", "764", "765", "766",
  "771", "772", "773", "774", "775", "777", "778", "779", "780", "790", "794",
  "800", "801", "802", "803", "804",
  "806", "807", "808", "809", "810", "811", "812", "813", "814", "815",
  "816", "817", "818", "819", "820", "821", "822", "823", "824", "825",
  "973",
]);

export function statusClassOf(code) {
  const c = String(code ?? "").trim();
  if (!c) return "unknown";
  if (DEAD_CODES.has(c)) return "dead";
  if (LIVE_CODES.has(c)) return "live";
  if (UNKNOWN_CODES.has(c)) return "unknown";
  // A code the office added after this table. Unknown is the only honest answer, and it is the safe
  // one: an unknown mark is screened, a dead one is dropped.
  return "unknown";
}

/** Exported so a test can assert the three sets stay disjoint and nothing drifts into two of them. */
export const STATUS_CODE_SETS = Object.freeze({
  dead: DEAD_CODES, live: LIVE_CODES, unknown: UNKNOWN_CODES,
});

/** Codepoint-aware reverse. Astral marks reverse correctly; grapheme clusters are not a concern for
 *  register mark text, which is stored as the office recorded it. */
export const reverseText = (s) => [...String(s ?? "")].reverse().join("");

/**
 * Nice classes to ONE spelling, on both sides of every comparison.
 *
 * USPTO writes them zero-padded to three digits ("009"); the plan, the coverage form and
 * screenVerdict all speak the bare number (9). Stored one way and queried the other, the class
 * filter matches nothing and the band comes back empty — a clean negative produced by a formatting
 * difference. Canonical here is the unpadded number, which is what screenVerdict's Number() sees.
 */
export function normalizeClasses(classes) {
  const list = Array.isArray(classes) ? classes : (classes == null ? [] : String(classes).split(","));
  const out = [];
  for (const c of list) {
    const n = Number.parseInt(String(c).trim(), 10);
    if (Number.isFinite(n) && !out.includes(String(n))) out.push(String(n));
  }
  return out;
}

export const foldCase = (s) => String(s ?? "").toUpperCase();

// LIKE metacharacters inside a MARK. A mark may genuinely contain % or _ (and marks containing a
// literal star are exactly why register-plan carries `term_literal`). Unescaped, "50%" would match
// every row and the search would report a confident, enormous, wrong answer.
const LIKE_ESCAPE = "\\";
const escapeLike = (s) => String(s ?? "").replace(/[\\%_]/g, (m) => LIKE_ESCAPE + m);

export function openIndex(path, { readonly = false, create = false } = {}) {
  const db = new DatabaseSync(path, { readOnly: readonly, ...(create ? { open: true } : {}) });
  if (!readonly) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  return db;
}

/**
 * Refuse to answer from an index that was never built.
 *
 * THE FAILURE THIS EXISTS FOR. `openIndex` on a missing path CREATES an empty database, and
 * `createSchema` will happily give it every table. A schema with no rows then answers every query
 * with a well-formed zero: the count agrees with the search, so the kernel's count/search
 * divergence guard passes, the crowd ceiling passes, and the slice mints a positively asserted
 * clean negative over a register nobody downloaded. Nothing errors, and a lawyer reads "no US
 * conflicts".
 *
 * A missing table is loud on its own. An EMPTY one is not, so the check is a row count.
 */
export function assertIndexReady(db, { path = "the configured index" } = {}) {
  const hasTable = db.prepare(
    "SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='mark'",
  ).get().c;
  if (!hasTable) {
    throw new Error(
      `[uspto-local] ${path} holds no US register table. Run the sync before searching — an absent `
      + "index must refuse, never answer zero.",
    );
  }
  const rows = db.prepare("SELECT count(*) AS c FROM mark").get().c;
  if (!rows) {
    throw new Error(
      `[uspto-local] ${path} has the schema but no records, so every search over it would return a `
      + "confident zero. Run the sync. An index nobody built is a refusal, never a clean negative.",
    );
  }
  assertFtsBuilt(db, { path, rows });
  return rows;
}

/**
 * Refuse an index whose rows are present but whose SEARCH INDEXES were never built.
 *
 * ── THE WORST SHAPE THIS PROVIDER CAN TAKE, and the row count above does not see it ─────────────
 * The FTS tables are external-content: the rows live in `mark` and the shadow tables hold only the
 * index, which `rebuildFts` populates in a separate step. A sync killed between `putRecords` and that
 * step — a crash, a full disk, a SIGTERM — leaves an index that looks entirely healthy and answers
 * FOUR of its six predicates correctly. `exact`, `default`, `wildcardInfix` and `owner` all read the
 * table directly and are unaffected. `wildcardPrefix` and `wildcardSuffix` narrow through FTS first,
 * so they return NOTHING, for every term, forever.
 *
 * Those two are how NOVARBORA is caught when clearing ARBORA. A clearance would run, most of it
 * would be right, and the suffix band would be silently empty.
 *
 * ── WHY THIS IS A MATCH PROBE AND NOT A COUNT ───────────────────────────────────────────────────
 * `SELECT count(*) FROM mark_fts` is the obvious check and it is WORTHLESS here: on an
 * external-content table FTS5 answers it from the content table, so it returns the same number built
 * or not — measured, 200000 either way. FTS5's own `integrity-check` also passes on an unbuilt index,
 * and costs real time on a large one. The only thing that distinguishes the two states is asking the
 * index a question it can only answer if it was built. Measured at 0ms against 200k rows; it runs
 * once per process, behind the memoized handle.
 */
export function assertFtsBuilt(db, { path = "the configured index", rows = null } = {}) {
  // A row whose text can actually be tokenised. A mark with no text indexes to nothing legitimately,
  // so probing with one would report a fault that is not there.
  const sample = db.prepare(
    "SELECT rowid, text FROM mark WHERE text IS NOT NULL AND length(text) > 1 LIMIT 1",
  ).get();
  if (!sample) return;   // nothing tokenisable to probe with; the row count above already passed

  const token = String(sample.text).split(/\s+/).find((t) => t.length > 1);
  if (!token) return;

  const present = (table, term) => {
    const hit = db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ? LIMIT 1`)
      .get(`"${term.replace(/"/g, '""')}"*`);
    return Boolean(hit);
  };

  // BOTH indexes, because they are built by separate statements and can fail independently — and the
  // reversed one is the less likely to be noticed, being the one only `wildcardSuffix` reads.
  const missing = [];
  if (!present("mark_fts", token)) missing.push("mark_fts (wildcardPrefix)");
  if (!present("mark_rfts", reverseText(token))) missing.push("mark_rfts (wildcardSuffix)");
  if (!missing.length) return;

  throw new Error(
    `[uspto-local] ${path} holds ${rows ?? "its"} records but ${missing.join(" and ")} `
    + `${missing.length > 1 ? "were" : "was"} never built — a term taken from the index's own rows `
    + "does not match. The anchored wildcard predicates narrow through these indexes, so they would "
    + "return NOTHING for every term while the other predicates answered correctly, and a suffix band "
    + "would come back silently empty. Run `node bin/uspto-sync.mjs` again, or rebuildFts(db). "
    + "Refusing: a half-built index is a clean negative waiting to be reported.",
  );
}

export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mark (
      serial        TEXT PRIMARY KEY,
      regno         TEXT,
      text          TEXT NOT NULL,
      rtext         TEXT NOT NULL,
      owner         TEXT,
      owner_country TEXT,
      status        TEXT,
      status_class  TEXT,
      classes       TEXT,
      filed         TEXT,
      regd          TEXT,
      expiry        TEXT,
      gs            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mark_text   ON mark(text);
    CREATE INDEX IF NOT EXISTS idx_mark_regno  ON mark(regno);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  // NO btree on owner. Every owner query is an unanchored LIKE '%…%', which a btree cannot serve —
  // it would be paid for on every ingest of 12.7M rows and never read. The owner FTS below is what
  // actually narrows.
  //
  // External-content FTS5: the shadow tables hold only the index, the rows stay in `mark`, so the
  // text is not duplicated on disk.
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS mark_fts
             USING fts5(text, content='mark', content_rowid='rowid')`);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS mark_rfts
             USING fts5(rtext, content='mark', content_rowid='rowid')`);
  return db;
}

/** Insert or replace a batch. Caller owns the transaction — ingest wraps ~100k at a time. */
export function putRecords(db, rows) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO mark (${MARK_COLUMNS.join(",")})
     VALUES (${MARK_COLUMNS.map(() => "?").join(",")})`,
  );
  let n = 0;
  for (const r of rows) {
    const text = foldCase(r.text);
    stmt.run(
      String(r.serial), r.regno ?? null, text, reverseText(text),
      foldCase(r.owner) || null, r.owner_country ?? null,
      r.status ?? null, r.status_class ?? statusClassOf(r.status),
      normalizeClasses(r.classes).length ? `,${normalizeClasses(r.classes).join(",")},` : null,
      r.filed ?? null, r.regd ?? null, r.expiry ?? null, r.gs ?? null,
    );
    n++;
  }
  return n;
}

/** Rebuild both FTS indexes from `mark`. Run once after a bulk load rather than maintaining
 *  incremental triggers: a trigger pays per row on every ingest, a rebuild pays once. The size of
 *  that difference at register scale is UNMEASURED and no figure is claimed. */
export function rebuildFts(db) {
  db.exec("INSERT INTO mark_fts(mark_fts) VALUES('rebuild')");
  db.exec("INSERT INTO mark_rfts(mark_rfts) VALUES('rebuild')");
}

export function setMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)").run(String(key), String(value));
}

export function getMeta(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key = ?").get(String(key))?.value ?? null;
}

/**
 * What this index knows about its own currency.
 *
 * PHASE3-REQUIREMENTS R5 puts USPTO freshness at 24 hours. An index is allowed to be stale; it is
 * NOT allowed to be silently stale, because a count taken over old data reads downstream as a clean
 * negative. `newestDelta` is the date of the most recent bulk file applied — the caller decides what
 * to do, but it can never say it did not know.
 */
// ── TWO CLOCKS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS ──────────────────────────────────────────
//
// The first version of this measured one thing — how old the newest DATA is — against R5's 24 hours,
// and it was wrong in a way that made the provider dead on arrival: USPTO publishes the daily file for
// data date D on D+1, so an index synced the instant the office published holds data dated YESTERDAY.
// It was already ~27 hours old at the moment it became maximally fresh, and every count refused. A
// threshold below the source's own publication lag is unsatisfiable by construction, and it took
// building the index and asking it a question to see that; the unit tests injected a data date no real
// sync could ever produce, so both files were green and the seam between them was where it failed.
//
// R5 is titled "Maximum Acceptable SYNC LAG" and says "24 hours (daily acceptable)" for USPTO. That is
// the clock it names: how long since we last checked with the office, not how old the newest filing is.
//
//   syncLagHours  24  — hours since a sync last SUCCEEDED. Past this we have not asked, so we do not
//                       know what we are missing. R5's own number, and its own meaning.
//   dataLagHours  96  — hours since the newest data we hold. Not a second freshness rule but a
//                       DIVERGENCE alarm: publication lag (1 day) + cadence (1 day) + a business-day
//                       product's weekend (a Friday-data file is newest until Tuesday) puts the honest
//                       worst case at four days. Past that, either the office stopped publishing or our
//                       syncs are succeeding while applying nothing — and the second one is silent.
//
// Either one blown is a refusal with `total: null`, never a zero. They carry different reasons because
// the fix is different: one says re-run the sync, the other says the sync is lying to you.
export const FRESHNESS_HOURS = Object.freeze({ sync: 24, data: 96 });

export function freshness(db, {
  nowIso = null, syncLagHours = FRESHNESS_HOURS.sync, dataLagHours = FRESHNESS_HOURS.data,
} = {}) {
  const newestDelta = getMeta(db, "newest_delta");
  // `synced_at` is what syncIndex writes. It was read here as `ingested_at` — a name nothing has ever
  // written — so this was silently always null before the two clocks existed to notice.
  const syncedAt = getMeta(db, "synced_at");
  const records = Number(getMeta(db, "records") ?? 0);
  const base = { newestDelta, syncedAt, records };

  if (!newestDelta) {
    return { ...base, newestDelta: null, stale: null,
      reason: "this index has recorded no source file date, so its currency cannot be established" };
  }
  if (!nowIso) return { ...base, stale: null, reason: null };
  const now = Date.parse(nowIso);
  const hoursSince = (iso) => (iso ? (now - Date.parse(iso)) / 3_600_000 : null);
  const syncAgeHours = hoursSince(syncedAt);
  const ageHours = hoursSince(newestDelta);

  if (syncAgeHours === null || !Number.isFinite(syncAgeHours)) {
    return { ...base, ageHours, syncAgeHours: null, stale: null,
      reason: "this index has recorded no successful sync, so it cannot be shown to be current — "
        + "currency cannot be established" };
  }
  if (syncAgeHours > syncLagHours) {
    return { ...base, ageHours, syncAgeHours, stale: true,
      reason: `the last successful sync of this index was ${Math.round(syncAgeHours)}h ago, past the `
        + `${syncLagHours}h lag this office requires. We have not asked the register what changed, so a `
        + "result over it is a deferred gap, never a clean negative" };
  }
  if (Number.isFinite(ageHours) && ageHours > dataLagHours) {
    return { ...base, ageHours, syncAgeHours, stale: true,
      reason: `the sync is current but the newest US register file applied here is dated ${newestDelta}, `
        + `${Math.round(ageHours)}h back and past the ${dataLagHours}h a daily product's publication lag `
        + "explains. Either the office has stopped publishing or the syncs are succeeding without "
        + "applying anything — a result over it is a deferred gap, never a clean negative" };
  }
  return { ...base, ageHours, syncAgeHours, stale: false, reason: null };
}

// ── the predicates ────────────────────────────────────────────────────────────────────────────────
//
// Each returns { sql, params } over `mark`. The anchored three narrow with FTS and then VERIFY with
// LIKE; see the header for why the verification is the predicate rather than an optimisation.

// A LIKE disjunction over N terms, e.g. (text LIKE ? OR text LIKE ?).
//
// THE OBVIOUS ASSUMPTION IS WRONG, and it is worth stating even without a number to attach. "One scan
// carries the whole OR stack, so extra terms are nearly free" is what you would expect; SQLite
// evaluates every LIKE per row, so an unanchored stack costs roughly linearly in its width. The three
// index-narrowed predicates behave the other way, because the narrowing happens before any row is
// touched. That is a statement about the query plan, which is why it stands without a benchmark.
//
// What DOES have a measured number is the hard ceiling, and it is a property of SQLite rather than of
// the register: this disjunction fails to compile at width 1000 on SQLITE_MAX_EXPR_DEPTH. See
// capabilities.js maxOrWidth, and index-store.test.mjs, which pins both the ceiling and the fact that
// the declared width stays under it.
//
// Per-predicate latencies are deliberately absent. The ones that used to be here were extrapolated
// from a synthetic fixture, and from queries written before the class-spelling and match_mode fixes —
// so they measured something other than what they claimed. They are not restated until a real
// ingested register exists to measure.
const orLike = (col, patterns) =>
  `(${patterns.map(() => `${col} LIKE ? ESCAPE '${LIKE_ESCAPE}'`).join(" OR ")})`;

function predicateClause(predicate, term) {
  const raw = Array.isArray(term) ? term : [term];
  const ts = raw.map((x) => foldCase(x).trim()).filter(Boolean);
  if (!ts.length) throw new Error("[uspto-local] a search predicate needs a non-empty term");
  const escs = ts.map(escapeLike);
  // FTS5 MATCH takes a native OR between prefix terms, so the narrower stays one index probe
  // however wide the stack gets.
  const ftsOr = (list) => list.map((x) => `${ftsTerm(x)}*`).join(" OR ");
  switch (predicate) {
    case "exact":
      return { where: `text IN (${ts.map(() => "?").join(",")})`, params: [...ts] };
    case "wildcardPrefix":
      return {
        where: `rowid IN (SELECT rowid FROM mark_fts WHERE mark_fts MATCH ?) AND ${orLike("text", escs)}`,
        params: [ftsOr(ts), ...escs.map((e) => `${e}%`)],
      };
    case "wildcardSuffix":
      return {
        where: `rowid IN (SELECT rowid FROM mark_rfts WHERE mark_rfts MATCH ?) AND ${orLike("text", escs)}`,
        params: [ftsOr(ts.map(reverseText)), ...escs.map((e) => `%${e}`)],
      };
    // `default` is the shared contract's name for the unanchored contains and wildcardInfix is this
    // store's; they are the SAME query and share a case rather than one delegating to the other, so
    // there is no path on which they can drift apart. capabilities.predicates gives both the same mode
    // string for the same reason.
    case "default":
    case "wildcardInfix":
      // No index can serve an unanchored contains, so this is an honest full scan. Declared as
      // supported because the alternative — declaring it null — would strip infix from the free-tier
      // composite for the EU side too, where EUIPO's contains CAN serve it.
      //
      // Do NOT be tempted to substitute a bare `mark_fts MATCH '"TERM"'` here. It looks like a cheap
      // unanchored contains and is TOKEN contains: it misses NOVAARBORA entirely. That would be the
      // "different search wearing the right answer's name" the capability contract exists to stop.
      // The LIKE scan or an honest null — nothing in between.
      //
      // The whole OR stack rides ONE scan, which is why maxOrWidth is worth more than 1 here: the
      // scan is the cost and the extra terms are nearly free.
      return { where: orLike("text", escs), params: escs.map((e) => `%${e}%`) };
    case "owner":
      // Search BY owner, as opposed to the owner FILTER below, which intersects with a mark
      // predicate. Unanchored, because corporate names arrive in every spelling there is.
      //
      // NO FTS NARROWER HERE, deliberately, and it is the same trap as the suffix one. An FTS
      // token-prefix candidate set is NOT a superset of an unanchored contains: owner "AURORA INTERACTIVE"
      // searched for "URORA" satisfies the LIKE, but no token starts with URORA, so the narrower
      // would drop a true match and the verification could never put it back. A narrower may only
      // ever be a superset of its verifier. So this is an honest full scan, and how expensive that is
      // at register scale is UNMEASURED.
      //
      // If it proves too slow on real data, the fix is to DECLARE word-prefix owner semantics and
      // narrow against them — not to bolt a narrower onto contains and hope.
      return { where: orLike("owner", escs), params: escs.map((e) => `%${e}%`) };
    default:
      throw new Error(
        `[uspto-local] unsupported predicate "${predicate}". Known: ${PREDICATES.join(", ")}. `
        + "A predicate this source cannot express must be declared null in capabilities.js so the "
        + "planner stamps the slice unsupported — never quietly answered with a weaker search.",
      );
  }
}

// FTS5 query syntax: bare terms are fine, but anything with punctuation must be a quoted string or
// the MATCH is a syntax error (and a mark like "AT&T" is not exotic). Double quotes are escaped by
// doubling, per the FTS5 grammar.
const ftsTerm = (t) => `"${t.replace(/"/g, '""')}"`;

function filterClauses({ classes, status, owner } = {}) {
  const where = [];
  const params = [];
  const wanted = normalizeClasses(classes);
  if (wanted.length) {
    // `classes` is stored delimited — ",9,42," — so a whole-element match is a plain LIKE and class
    // 9 can never drag in 19 or 90. Both sides go through normalizeClasses, because USPTO writes
    // "009" and the plan writes 9.
    where.push(`(${wanted.map(() => "classes LIKE ?").join(" OR ")})`);
    for (const c of wanted) params.push(`%,${c},%`);
  }
  if (status === "live" || status === "dead" || status === "unknown") {
    where.push("status_class = ?");
    params.push(status);
  }
  if (owner) {
    where.push(`owner LIKE ? ESCAPE '${LIKE_ESCAPE}'`);
    params.push(`%${escapeLike(foldCase(owner))}%`);
  }
  return { where, params };
}

const SELECT_COLUMNS = MARK_COLUMNS.filter((c) => c !== "rtext").join(",");

/** One page of hits. `limit` is a page size, never a silent ceiling — countHits reports the whole. */
export function search(db, { predicate = "exact", term, classes, status, owner, limit = 100, offset = 0 } = {}) {
  const p = predicateClause(predicate, term);
  const f = filterClauses({ classes, status, owner });
  const where = [p.where, ...f.where].join(" AND ");
  const rows = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM mark WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`,
  ).all(...p.params, ...f.params, Number(limit), Number(offset));
  return rows.map(toRecord);
}

/**
 * How many marks match — the whole number, not the page.
 *
 * capabilities declares countProbe "endpoint", not "cheap". The shared kernel defines those
 * precisely (providers/_shared/count.mjs:16-19): "cheap" is one billable metered search whose total
 * rides the first page, "endpoint" is a true count-only call that works at any magnitude and fetches
 * nothing. `SELECT count(*)` over a local index is squarely the second.
 *
 * REGISTER-HIT-COUNTS' rule still binds: a count we could not take is never zero. A local index can
 * always take it — but only once it EXISTS and has rows, which is why callers must pass
 * assertIndexReady first. A zero from an index nobody built is the most dangerous artifact this
 * provider can produce.
 */
export function countHits(db, { predicate = "exact", term, classes, status, owner } = {}) {
  const p = predicateClause(predicate, term);
  const f = filterClauses({ classes, status, owner });
  const where = [p.where, ...f.where].join(" AND ");
  return db.prepare(`SELECT count(*) AS c FROM mark WHERE ${where}`).get(...p.params, ...f.params).c;
}

export function getRecord(db, serial) {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM mark WHERE serial = ?`).get(String(serial));
  return row ? toRecord(row) : null;
}

/** The synthetic ref every provider surfaces: /mark/<office>/<id>. Office is always `us` here. */
export const makeRef = (serial) => `/mark/us/${String(serial).toLowerCase()}`;

function toRecord(row) {
  return {
    uri: makeRef(row.serial),
    record_id: makeRef(row.serial),
    provider: "uspto-local",
    office: "US",
    id: row.serial,
    applicationNumber: row.serial,
    registrationNumber: row.regno ?? null,
    mark_text: row.text,
    markText: row.text,
    status: row.status ?? null,
    statusClass: row.status_class ?? "unknown",
    owner_name: row.owner ?? null,
    owner: row.owner ?? null,
    owner_country: row.owner_country ?? null,
    classes: normalizeClasses(row.classes),
    niceClasses: normalizeClasses(row.classes),
    applicationDate: row.filed ?? null,
    registrationDate: row.regd ?? null,
    expiryDate: row.expiry ?? null,
    goodsAndServices: row.gs ?? null,
    // USPTO publishes a public record page per serial, so a finding can always cite an address.
    resolved_link: `https://tsdr.uspto.gov/#caseNumber=${row.serial}&caseType=SERIAL_NO&searchType=statusSearch`,
  };
}
