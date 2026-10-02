// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pile.mjs — the pile, read from the run directory: the questions the run asked, the register's own count
// for each, the records each one listed, the full record behind a listed record, and the web results.
//
// Read in place and never written to. Ported from the private bench's saved-run reader, which the owner
// table and the judging tools were measured over; the engine's own file layout replaces the bench's
// assumptions where they differ, and each difference is named below.
//
// TWO SOURCES OF RECORDS, READ TOGETHER, as the bench reads them: the merged pile
// (`register-named-band.json`), where each record names the questions that returned it, and the per-axis
// band files, where each question's block holds the records the register returned for it. The per-axis
// files are the fuller source: on the run the bench was built against, three questions asked late were
// listed there (176 records) and never reached the merged pile.
//
// FULL RECORDS. A body sits in `_records/` once the run has assembled it, and before that only in the
// run's record log (`_driver/register-record-bodies.jsonl`) — which on a large run is a quarter of a
// gigabyte, so it is never loaded whole: the first read indexes it by byte offset and every read after
// that reads one line. The `_records/` file name is the record's id after `/mark/`, every run of other
// characters made `-` (registry-fidelity.mjs, writeRecordArtifacts) — not the bench's last two segments.

import { readFileSync, existsSync, readdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function need(path, what) {
  if (!existsSync(path)) throw new Error(`the run holds no ${what}`);
  return path;
}

/** The `_records/` file a record id is assembled under (registry-fidelity.mjs writeRecordArtifacts). */
export const recordFileName = (recordId) => `${String(recordId).replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-")}.json`;

/**
 * The office a band record sits at. The provider rows carry `office`; a row that does not falls back to
 * the screen's registry, then the first jurisdiction — the reading band-shape.mjs's `registryOf` gives.
 */
const officeOf = (row) => String(row?.office ?? row?.screen?.registry ?? (Array.isArray(row?.jurisdictions) ? row.jurisdictions[0] : row?.jurisdictions) ?? "").trim();

/** The order's marks, from the instructed scope: an array, or one bare mark. */
const marksOf = (scope) => (Array.isArray(scope?.marks) ? scope.marks : scope?.marks ? [scope.marks] : [])
  .map((m) => (typeof m === "string" ? m : m?.name ?? m?.markName ?? "")).map(String).filter(Boolean);

/** A plan entry's goods words: a string, or (the engine's shape) an array of them. */
const goodsOf = (g) => (typeof g === "string" ? g : Array.isArray(g) ? g.filter(Boolean).join("; ") : g ? JSON.stringify(g) : null);

/**
 * Load the pile of one run. Throws, naming what is missing, when the run holds no register plan, no
 * execution receipt or no merged band: there is no pile without them.
 */
export function loadPile(runDir) {
  const plan = readJson(need(driverDir(runDir, "register-plan.json"), "register plan"));
  const execution = readJson(need(driverDir(runDir, "plan-execution.json"), "plan-execution receipt"));
  const band = readJson(need(join(runDir, "register-named-band.json"), "merged register band"));
  const scopePath = driverDir(runDir, "instructed-scope.json");
  const scope = existsSync(scopePath) ? readJson(scopePath) : null;

  const crowdByQid = new Map(asArray(band.crowds).map((c) => [c.qid, c]));
  const scopeOffices = asArray(plan.regions);

  const recordById = new Map();
  const recordsByQid = new Map();
  const attach = (row, qids) => {
    if (!row?.record_id) return;
    let r = recordById.get(row.record_id);
    if (!r) {
      r = {
        id: row.record_id,
        mark: row.mark_text ?? "",
        owner: row.owner_name ?? "",
        ownerCountry: row.owner_country ?? "",
        office: officeOf(row),
        classes: asArray(row.classes),
        status: row.status ?? "",
        filed: row.application_date ?? null,
        registered: row.registration_date ?? null,
        expiry: row.expiry_date ?? null,
        // The screen's own verdict, where the band record carries one (the audit's "also considered"
        // groups a set-aside record by it). Never shown to a judge.
        screenVerdict: String(row.screen?.screen_verdict ?? row.screen_verdict ?? "").trim(),
        qids: [],
      };
      recordById.set(r.id, r);
    }
    for (const q of qids) {
      if (!q || r.qids.includes(q)) continue;
      r.qids.push(q);
      if (!recordsByQid.has(q)) recordsByQid.set(q, []);
      recordsByQid.get(q).push(r);
    }
  };
  for (const row of asArray(band.enumerated)) attach(row, asArray(row._qids ?? row._qid));
  const pileSize = recordById.size;
  const unitDir = join(runDir, "register-units");
  if (existsSync(unitDir)) {
    for (const name of readdirSync(unitDir).filter((n) => n.endsWith("-band.json")).sort()) {
      let file;
      try { file = readJson(join(unitDir, name)); } catch { continue; }
      for (const block of Array.isArray(file) ? file : asArray(file?.blocks)) {
        if (!block?.qid) continue;
        for (const row of asArray(block.records)) attach(row, [block.qid]);
      }
    }
  }
  const records = [...recordById.values()];

  // Questions, in the plan's own order, under short ids. The engine's identifiers embed the words asked
  // and its internal vocabulary; the short id carries neither.
  const executedByQid = new Map(asArray(execution.executed).map((e) => [e.qid, e]));
  const ordered = asArray(plan.entries).filter((e) => executedByQid.has(e.qid));
  const width = String(ordered.length).length;
  const shortIdByQid = new Map(ordered.map((e, i) => [e.qid, `Q${String(i + 1).padStart(width, "0")}`]));

  const questions = ordered.map((entry) => {
    const ran = executedByQid.get(entry.qid);
    const crowd = crowdByQid.get(entry.qid);
    const held = recordsByQid.get(entry.qid) ?? [];
    const offices = asArray(entry.regions).length ? asArray(entry.regions) : scopeOffices;
    const question = {
      id: shortIdByQid.get(entry.qid),
      qid: entry.qid,
      words: entry.terms ? asArray(entry.terms) : asArray(entry.term),
      match: entry.predicate === "default" ? "contains" : entry.predicate,
      classes: asArray(entry.nice_classes),
      offices,
      allOfficesInScope: offices.length === scopeOffices.length && scopeOffices.length > 0,
      goods: goodsOf(entry.goods_text),
      owner: entry.owner ? (typeof entry.owner === "string" ? entry.owner : entry.owner.name ?? JSON.stringify(entry.owner)) : null,
      narrows: entry.narrows ? shortIdByQid.get(entry.narrows) ?? null : null,
      count: Number.isFinite(ran.total_hits) ? ran.total_hits : null,
      listed: ran.state === "enumerated",
      recordsHeld: held.length,
    };
    if (crowd?.term_counts) {
      question.countPerWord = Object.fromEntries(Object.entries(crowd.term_counts).map(([word, v]) => [word, v?.total_hits ?? null]));
    }
    return question;
  });

  const bodies = recordBodies(runDir);
  return {
    runDir,
    // The register this run's plan was compiled for and its records were listed by. A full record is
    // fetched from it and from no other (owner-server.mjs): the deployment's register may have moved since.
    provider: typeof plan.provider === "string" && plan.provider.trim() ? plan.provider.trim() : null,
    scopeOffices,
    orderClasses: asArray(scope?.classes).length ? asArray(scope.classes) : asArray(plan.nice_classes),
    orderMarks: marksOf(scope),
    questions,
    questionById: new Map(questions.map((q) => [q.id, q])),
    records,
    pileSize,
    recordById,
    recordsOf: (question) => recordsByQid.get(question.qid) ?? [],
    /** The full record the run holds for a record id, or null. Never fetches. */
    readFullRecord: (recordId) => bodies.read(recordId),
    /** Forget what the record log index knows, so a body written since is found. */
    refreshFullRecords: () => bodies.refresh(),
    webCells: () => webCells(runDir),
  };
}

// ── full records ─────────────────────────────────────────────────────────────────────────────────────

/** `_records/` first, then the record log by its offset index; the LAST log row for a record wins, as in assembleRunRecords. */
export function recordBodies(runDir) {
  const dir = join(runDir, "_records");
  const logPath = runRecordLogPath(runDir);
  let index = null;     // normalized uri → [offset, length]
  let indexedSize = -1;
  const build = () => {
    let size = 0;
    try { size = statSync(logPath).size; } catch { index = new Map(); indexedSize = 0; return; }
    if (index && size === indexedSize) return;
    index = new Map();
    indexedSize = size;
    let fd;
    try { fd = openSync(logPath, "r"); } catch { return; }
    try {
      const CHUNK = 4 * 1024 * 1024;
      const buf = Buffer.allocUnsafe(CHUNK);
      let pos = 0, carry = Buffer.alloc(0), carryAt = 0;
      for (;;) {
        const n = readSync(fd, buf, 0, CHUNK, pos);
        if (n <= 0) break;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
        const base = carry.length ? carryAt : pos;
        let start = 0;
        for (;;) {
          const nl = data.indexOf(10, start);
          if (nl < 0) break;
          noteLine(data.subarray(start, nl), base + start);
          start = nl + 1;
        }
        carry = Buffer.from(data.subarray(start));
        carryAt = base + start;
        pos += n;
      }
      if (carry.length) noteLine(carry, carryAt);
    } catch { /* an unreadable tail leaves what was indexed; a read of a missing body says so */ }
    finally { try { closeSync(fd); } catch { /* nothing to do */ } }
  };
  const noteLine = (bytes, at) => {
    if (bytes.length < 2) return;
    let row;
    try { row = JSON.parse(bytes.toString("utf8")); } catch { return; }
    const uri = normalizeRecordUri(row?.target) || String(row?.target ?? "").toLowerCase();
    if (uri && row?.body) index.set(uri, [at, bytes.length]);
  };
  const fromLog = (uri) => {
    build();
    const at = index.get(uri);
    if (!at) return null;
    let fd;
    try {
      fd = openSync(logPath, "r");
      const b = Buffer.allocUnsafe(at[1]);
      readSync(fd, b, 0, at[1], at[0]);
      const row = JSON.parse(b.toString("utf8"));
      const body = Array.isArray(row.body) ? row.body[0] : row.body;
      return body && typeof body === "object" ? body : null;
    } catch { return null; }
    finally { try { closeSync(fd); } catch { /* nothing to do */ } }
  };
  return {
    read(recordId) {
      const id = String(recordId ?? "");
      if (!id) return null;
      // The writer keeps the record id's case and band-server.mjs's reader folds it, so both are tried.
      for (const name of new Set([recordFileName(id), recordFileName(id).toLowerCase()])) {
        const file = join(dir, name);
        if (existsSync(file)) { try { return readJson(file); } catch { /* fall through to the log */ } }
      }
      return fromLog(normalizeRecordUri(id) || id.toLowerCase());
    },
    refresh() { indexedSize = -1; },
  };
}

// ── web results ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The web search results the run saved: the canonical grid and every supplemental ledger beside it.
 * A ledger is one object or an array of per-batch objects; a cell is `{term, platform, status,
 * candidates:[{title,url}]}`. Cells of one word on one place are one cell, their results joined by URL.
 * null when the run saved no web results at all.
 */
export function webCells(runDir) {
  let names;
  try { names = readdirSync(runDir).filter((n) => /^common-law-grid(\.supp-[^.]+)?\.json$/.test(n)).sort(); } catch { return null; }
  if (!names.length) return null;
  const cells = new Map();
  for (const name of names) {
    let doc;
    try { doc = readJson(join(runDir, name)); } catch { continue; }
    for (const part of Array.isArray(doc) ? doc : [doc]) {
      for (const c of asArray(part?.cells)) {
        const word = String(c?.term ?? ""), place = String(c?.platform ?? "");
        const key = `${word.toLowerCase()}\u0000${place.toLowerCase()}`;
        if (!cells.has(key)) cells.set(key, { word, place, status: String(c?.status ?? ""), results: [] });
        const cell = cells.get(key);
        if (c?.status === "hit") cell.status = "hit";
        for (const r of asArray(c?.candidates)) {
          const url = String(r?.url ?? "");
          if (url && cell.results.some((x) => x.url === url)) continue;
          cell.results.push({ title: String(r?.title ?? ""), url });
        }
      }
    }
  }
  return [...cells.values()];
}

/**
 * Step 3's merged decisions as the audit reads them (publish/audit-from-spine.mjs, `registerDecisions`):
 * the decisions file, and each cited record's facts from this pile. The driver builds audit.md from this,
 * and the connector rebuilds it the same way when audit.md is missing. Null when the run holds no
 * decisions (a run begun before step 3); a throw when they cannot be read, for the caller to say so.
 */
export function registerDecisionsFor(runDir, decisionsPath) {
  if (!existsSync(decisionsPath)) return null;
  const decisions = JSON.parse(readFileSync(decisionsPath, "utf8"));
  const pile = loadPile(runDir);
  return {
    decisions,
    recordFacts: (id) => {
      const r = pile.recordById.get(String(id));
      return r ? { mark: r.mark, owner: r.owner, country: r.ownerCountry, office: r.office, classes: r.classes,
        status: r.status, filed: r.filed, registered: r.registered, expiry: r.expiry, screenVerdict: r.screenVerdict } : null;
    },
  };
}
