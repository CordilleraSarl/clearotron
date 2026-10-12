#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// band-server.mjs — the READ-ONLY reading layer for the register band (PR-8, Thread D2).
//
// Judgment stages (placement / digest / synthesis / refutation) no longer slice the multi-megabyte
// merged band with improvised shell — they read the deterministic band-shape whole and LOOK UP the
// records they choose through these three tools. Every lookup is APPENDED to the run's
// _driver/reading-log.jsonl: the reading layer becomes auditable the same way the frozen plan made
// the query layer auditable (the log renders as audit.md's "# Reading audit").
//
// PROVIDER-NEUTRAL: the tools serve the band artifacts the driver merged — no vendor call is ever
// made from here (read-only by construction), and the served record projection strips the
// provider-shaped noise fields (raw / highlight / score / poca_scores / onomaticsAggression) while
// keeping `screen` WHOLE (screening facts are decision content — the HK 碎冰 lesson).
//
// Env (from gather-config serverEnv): CLEAROTRON_BAND_RUN_DIR (the run dir — required),
// CLEAROTRON_GATHER_SESSION_KEY / CLEAROTRON_GATHER_AGENT (attribution for the reading log).
import { readFileSync, readdirSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //
import { serve } from "./stdio-server.mjs";
import { answerBudget, quotedBytes } from "../../../shared/answer-parts.mjs";
import { classifyRecord, prepareTargets, SHAPE_TIERS, isLiveRecord, niceClassKey } from "../../band-shape.mjs";
import { recordQids } from "../../named-band.mjs";
import { normalizeRecordUri } from "../../registry-fidelity.mjs";
import { bandGoodsIndex, goodsFor, goodsWordCounter, goodsWordsMatched } from "../../record-goods.mjs";

const RUN_DIR = process.env.CLEAROTRON_BAND_RUN_DIR || "";
const SESSION = process.env.CLEAROTRON_GATHER_SESSION_KEY || "";
const AGENT = process.env.CLEAROTRON_GATHER_AGENT || "";

const bandPath = () => join(RUN_DIR, "register-named-band.json");
const shapeJsonPath = () => driverDir(RUN_DIR, "band-shape.json");
const shapeMdPath = () => join(RUN_DIR, "band-shape.md");
const readingLogPath = () => driverDir(RUN_DIR, "reading-log.jsonl");
// — THE RUN'S OWN RECORD LEDGER, which this tool did not know about.
//
// A fetch writes here; `_records/` is populated from it by a union that does not run until the END of
// the run. So all run long this tool answered from a directory the fetches do not write to, and
// rendered the gap as a fact about the RUN — "No official record fetched for this record this run" —
// when the record was in hand. Measured on a delivered round: the seat asked for the single most
// obstructive right on the file four times over three hours and was refused every time, seventeen
// minutes after that record was fetched and logged here.
//
// Run-scoped by construction, so no prefix filter is needed: this file lives in the run dir and every
// line in it belongs to this run.
const recordLedgerPath = () => driverDir(RUN_DIR, "register-record-bodies.jsonl");

/**
 * The record body this run has already fetched, or null.
 *
 * Scanned only on a `_records/` miss — six times on the measured round, against 2,842 lines — so the
 * cost falls on the path that was previously answering wrongly, and never on the common one.
 *
 * LAST WRITE WINS, matching `assembleRunRecords`: the ledger leg overrides the run-dir leg there, so a
 * later body is the current one here too. Two readers of one ledger must not disagree about which row
 * is authoritative.
 */
function recordFromLedger(uri) {
  const p = recordLedgerPath();
  if (!existsSync(p)) return null;
  const want = normalizeRecordUri(uri) || String(uri).toLowerCase();
  let found = null;
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const t = normalizeRecordUri(row?.target) || String(row?.target ?? "").toLowerCase();
      if (t && t === want && row?.body) found = row.body;
    }
  } catch { return null; }
  return found;
}

// ── the reading log: EVERY lookup lands here, success or failure — the audit is the point ──────────
function logRead(tool, args, result) {
  if (!RUN_DIR) return;
  try {
    mkdirSync(dirname(readingLogPath()), { recursive: true });
    appendFileSync(readingLogPath(), JSON.stringify({
      ts: new Date().toISOString(), tool, args, ...result,
      ...(SESSION ? { session: SESSION } : {}), ...(AGENT ? { agent: AGENT } : {}),
    }) + "\n");
  } catch { /* best-effort — a log failure must never break a lookup */ }
}

const loadJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ── bounded serving: the transport cap is TOKENS, not the 256KB Read cap ─────────────────────────────────
// The engine carries a tool result over MCP, and claude -p caps one tool output at
// MAX_MCP_OUTPUT_TOKENS (default 25,000 tokens ≈ 100KB; verified against the live 2.1.x binary) —
// NOT the 256KB Read bound the shape's size was designed to. Floors are unconditional by design, so
// a crowded-dominant-element matter can push the md past that cap (measured: 2,500 floors →
// ~204KB ≈ 55k tokens), and the tool call would ERROR in the engine — killing the primary reading
// path exactly on the runs where the floors matter most. So band_shape serves BOUNDED PARTS:
// ≤ SHAPE_PART_CHARS per call (~17k tokens at a conservative 4 chars/token — well under the 25k
// default), split at LINE boundaries only. Every floor row is one line, so no row is ever cut, and
// the concatenation of all parts is byte-identical to the artifact on disk. The continuation
// contract is honest and explicit: an over-size shape announces "part N/M" and names the next call;
// the common single-part case is served verbatim with no banner. The part size was a test seam with a
// floor under it so a misconfiguration could never shred the shape into confetti; step 3 deleted
// the knob, and a constant cannot be misconfigured. A smaller answer size still lowers it
// (SHAPE_PART_SERVED, below), never under the answer size's own floor.
const SHAPE_PART_CHARS = 70000;   // step 3 — was a knob; no environment ever set it

// PR-11 — the SAME transport cap bounds the other two tools (they were shipped unbounded): a
// band_lookup of 100 fat records or a pathological official record could exceed the engine's
// per-tool-output token cap and error the call — killing the reading path exactly where the record
// volume is highest. band_lookup TRIMS records (the full match count always survives, with an
// honest note); band_record serves PARTS like band_shape (a record is a document — never trimmed).
// Given an answer size and no band size of its own, the band answers in five sixths of it: the rest is room
// for the quotes and line breaks a printout adds (up to 13% on band answers) and for a banner, so a band
// answer is never split a second time (shared/answer-parts.mjs). 37,500 on Claude, 30,000 on codex.
const RESPONSE_CHARS = Math.max(4096, Number(process.env.CLEAROTRON_BAND_RESPONSE_CHARS)
  || (answerBudget() ? Math.floor(answerBudget() / 1.2) : SHAPE_PART_CHARS));

// The shape is split at the smaller of its own part size and the answer size, because codex cuts the
// middle out of a read over about 39,000 bytes and is given a smaller answer size for that
// (engine/mcp/codex-config.mjs, CODEX_BAND_ANSWER_CHARS). Measured in testing, 2026-10-11: a GPT model that
// printed a 70,269-character shape part to read it named 11 of its 24 marker rows, and in one attempt of a
// real run four of five shape reads were that long. Never larger than the constant,
// so a larger answer size cannot push a part past Claude's limit; with no size set, nothing changes.
const SHAPE_PART_SERVED = Math.min(SHAPE_PART_CHARS, RESPONSE_CHARS);

// The answer size is in bytes, counted as a quoted string (shared/answer-parts.mjs), and characters are not
// bytes: a page of marks and owners in a script of three bytes a character, trimmed to the character size,
// came to about three times the answer size and was split a second time. So every answer and every part is
// held to the bytes as well, with room in a part for its banner. Latin text meets the character size first,
// so it is served as before.
const RESPONSE_BYTES = answerBudget();
const PART_ROOM = 512;
const fits = (text) => text.length <= RESPONSE_CHARS && (!RESPONSE_BYTES || quotedBytes(text) <= RESPONSE_BYTES);

/** Split text into parts of ≤ budget chars and, given an answer size, ≤ its bytes less a banner's room,
 *  cutting only at line boundaries (an over-budget single line still ships whole — never cut mid-line).
 *  Concatenating the parts with "\n" restores the input byte-for-byte. */
function splitAtLines(text, budget) {
  const bytes = RESPONSE_BYTES ? RESPONSE_BYTES - PART_ROOM : Infinity;
  const parts = [];
  let cur = null, curBytes = 0;
  for (const line of String(text).split("\n")) {
    const lineBytes = RESPONSE_BYTES ? quotedBytes(line) : 0;
    if (cur !== null && (cur.length + 1 + line.length > budget || curBytes + 2 + lineBytes > bytes)) { parts.push(cur); cur = line; curBytes = lineBytes; }
    else if (cur === null) { cur = line; curBytes = lineBytes; }
    else { cur += "\n" + line; curBytes += 2 + lineBytes; }
  }
  parts.push(cur ?? "");
  return parts;
}

// Provider-shaped noise dropped from every SERVED record; `screen` stays whole (decision content).
const NOISE_KEYS = new Set(["raw", "highlight", "score", "poca_scores", "onomaticsAggression", "onomaticsOppositions"]);
// P2-B — the stamp union rides the band, but it is only SERVED when it says something the first-seen
// `_qid`/`_query` does not. Measured on a real 2,596-record band: serving both arrays unconditionally
// cost ~10% of a limit:100 lookup's returned rows (48 → 43), because band_lookup drops trailing
// records to fit the transport cap — a quiet reduction in the reading layer's throughput on exactly
// the crowded bands where it matters. Single-slice records (the large majority) now serialise
// byte-identically to before, and a multi-slice record carries the arrays, which is precisely where
// the extra provenance is the answer ("which owner slice found this?"). The FILTER always reads the
// band file itself, never this projection, so matching is unaffected either way.
const singleton = (v, first) => !Array.isArray(v) || v.length <= 1 || (v.length === 1 && v[0] === first);
const project = (r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => {
  if (NOISE_KEYS.has(k)) return false;
  if (k === "_qids") return !singleton(v, r?._qid);
  if (k === "_queries") return !singleton(v, r?._query);
  return true;
}));

const norm = (s) => String(s ?? "").trim().toLowerCase();
// A3 (addendum 2026-07-30): the READER lowercases the incoming uri — reader-side ONLY. The archived
// store is lowercase by construction (writeRecordArtifacts receives the run's canonical lowercase uris,
// and readRecordArtifacts lowercases on the way back), but the uri arriving HERE is MODEL-CITED text —
// findings/band prose quotes "/mark/US/…" in whatever case the narrative used — and the case-preserving
// read turned every such cite into a false MISS: a record sitting in _records/ the whole time reported
// as an honest coverage gap. Do NOT "re-converge" this expression with the writer's in
// registry-fidelity.mjs (they look identical apart from the fold, which is exactly how the defect
// shipped): the writer keeps the store's canonical case, the reader folds what the model typed. The
// uppercase-uri regression test in test/band-server.test.mjs pins this asymmetry.
const recordUriFile = (uri) => String(uri ?? "").toLowerCase().replace(/^\/mark\//, "").replace(/[^a-z0-9]+/g, "-") + ".json";

// ── resolving a MODEL-CITED reference to the archived document ───────────────────────────────────────
// The filename above is a lossy squash of ONE exact uri string, and the digest does not type exact uri
// strings: it quotes what the band prose, the findings table or a provider page gave it. Every form
// below is the same document and only the first one resolved before this ladder:
//   /mark/ae/229552                       the bare uri (the only form that resolved) → ae-229552.json
//   https://tm.corsearch.com/mark/ae/229552   a provider URL (the VENZY join defect's shape)
//   `/mark/ae/229552`, "…/mark/ae/229552."    a cite carrying markdown/punctuation
//   /mark/ch/30419  vs  ch-30419-2014.json    the store holds the registration-INSTANCE uri while
//                                             judgment cites the record (`findScreenGateViolations` in screen-gate.mjs — a
//                                             false hard-halt, the same fact at a different
//                                             granularity)
// So: canonicalise the CITE through normalizeRecordUri (registry-fidelity.mjs) — the canonical form
// pipeline, recall-reconciliation and presence-reconciliation already join on, and the
// same idea screen-gate.mjs re-implements as its own `toGateUri` fold — then resolve it against the
// directory. A fifth copy of that idea is the last thing this defect class needs. The FILENAME
// transform stays local and stays asymmetric to the writer's (the A3 note above); what is shared is the
// uri canonicaliser, which is a pure string function — no vendor call and no vendor-shaped path enters
// the reading layer through it, so the server stays provider-neutral by construction.
//
// An instance expansion is only ever accepted when the artifact's own embedded `_uri` canonicalises to
// the cite: the squash conflates "-" and "/", so a filename-prefix match alone would serve
// /mark/cn/37554073-42 to a cite of /mark/cn/37554073 — a WRONG document, which is worse than the miss
// it replaces. A legacy artifact carrying no `_uri` therefore resolves on its exact name only.
// Two instance documents under one cite is an ANSWERED ambiguity (both named), never a silent pick.
const listRecordFiles = (dir) => { try { return readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return []; } };

/** Resolve `uri` (as the model typed it) to an archived record file.
 *  → {file, via, resolved?} | {ambiguous: [uri…], files} | {miss: <reason>, files}. Never throws. */
function resolveRecordFile(dir, uri) {
  const files = listRecordFiles(dir);
  const names = [recordUriFile(uri)];
  // "" when the cite names no /mark/ record at all; the second form recovers a leading slash the model
  // dropped ("record mark/us/90000001"), which the canonicaliser requires.
  const canon = normalizeRecordUri(uri) || normalizeRecordUri(`/${uri.replace(/^\/+/, "")}`);
  if (canon && recordUriFile(canon) !== names[0]) names.push(recordUriFile(canon));
  for (const [i, name] of names.entries()) {
    const via = i === 0 ? "exact" : "canonical";
    if (existsSync(join(dir, name))) return { file: join(dir, name), via, files };
    // …and the same name in another CASE: the writer (registry-fidelity.mjs) keeps the store's case
    // while this reader folds, so an upper-case-keyed archive would be invisible to a folded read.
    const ci = files.filter((f) => f.toLowerCase() === name);
    if (ci.length === 1) return { file: join(dir, ci[0]), via: `${via}-case`, files };
  }
  if (!canon) return { miss: "unparsable-uri", files };
  const base = recordUriFile(canon).slice(0, -".json".length);
  const confirmed = [];
  for (const f of files) {
    if (!f.toLowerCase().startsWith(base + "-")) continue;   // an instance suffix, or an unrelated id
    let body;
    try { body = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    if (typeof body?._uri === "string" && normalizeRecordUri(body._uri) === canon)
      confirmed.push({ file: join(dir, f), uri: body._uri });
  }
  if (confirmed.length === 1) return { file: confirmed[0].file, via: "instance", resolved: confirmed[0].uri, files };
  if (confirmed.length > 1) return { ambiguous: confirmed.map((c) => c.uri), files };
  return { miss: "not-fetched", files };
}

// WHAT A PART OF THE SHAPE HOLDS. A group's row is checked against the lines the step READ, so each md part
// served logs the listed lines printed in it, found through the md line the shape's data records for each
// (`md_lines`), and which parts hold each group, so a refusal can name the parts left unread. The json form
// is the machine shape: reading it serves no line. A shape with no recorded lines logs none.
function linesByPart(parts) {
  let shape = null;
  try { shape = loadJson(shapeJsonPath()); } catch { shape = null; }
  const at = shape?.md_lines && typeof shape.md_lines === "object" ? shape.md_lines : {};
  const ends = [];
  let line = 0;
  for (const p of parts) { line += p.split("\n").length; ends.push(line - 1); }
  const partOf = (n) => ends.findIndex((end) => n <= end);
  const keys = parts.map(() => []);
  for (const [key, n] of Object.entries(at)) { const i = partOf(n); if (i >= 0) keys[i].push(key); }
  const groupParts = {};
  for (const g of ["a", "b", "c", "d", "no_goods"]) {
    const ps = new Set((shape?.groups?.[g]?.list ?? []).map((l) => at[l.key]).filter((n) => n != null).map((n) => partOf(n) + 1));
    if (ps.size) groupParts[g] = [...ps].sort((x, y) => x - y);
  }
  return { keys, groupParts };
}

function bandShape(params) {
  const format = params?.format === "json" ? "json" : "md";
  const p = format === "json" ? shapeJsonPath() : shapeMdPath();
  if (!RUN_DIR) { logRead("band_shape", { format }, { ok: false }); return { isError: true, text: "ERROR: CLEAROTRON_BAND_RUN_DIR not set — band tools are wired per run by the driver." }; }
  if (!existsSync(p)) { logRead("band_shape", { format }, { ok: false }); return { isError: true, text: `ERROR: ${p} not found — the driver derives it after the register fan-in; if the band exists but the shape does not, report this as a driver defect (do NOT slice the raw band instead).` }; }
  const text = readFileSync(p, "utf8");
  const parts = splitAtLines(text, SHAPE_PART_SERVED);
  const total = parts.length;
  const read = format === "md" ? linesByPart(parts) : null;
  if (total === 1) {                                    // the common case — served verbatim, no banner
    logRead("band_shape", { format }, { ok: true, bytes: text.length, ...(read ? { part: 1, parts: 1, served_lines: read.keys[0], group_parts: read.groupParts } : {}) });
    return text;
  }
  const part = Math.min(Math.max(1, Math.floor(Number(params?.part)) || 1), total);
  logRead("band_shape", { format, part, parts: total }, { ok: true, bytes: parts[part - 1].length, total_bytes: text.length,
    ...(read ? { served_lines: read.keys[part - 1], group_parts: read.groupParts } : {}) });
  const head = `[band_shape part ${part}/${total} — the shape is served in ${total} parts, split between lines. Read every part:` +
    ` the band's groups, in the lawyer's order, run through them, and every floor in them has a fate on the form` +
    `${format === "json" ? "; concatenate the parts before parsing the JSON" : ""}.]`;
  const tail = part < total
    ? `\n[end of part ${part}/${total} — call band_shape again with {"part": ${part + 1}} for the next part]`
    : `\n[end of part ${total}/${total} — the shape is complete once parts 1..${total} are all read]`;
  return head + "\n" + parts[part - 1] + tail;
}

// THE GOODS ON THE ROW, AS THE SHAPE TESTS THEM. Each record served carries the goods words its goods
// hold, "k of N: the words", tested on the same words and stems the shape grouped on (its `goods_test`),
// from the records the register already logged to this run (record-goods.mjs). The goods text is one
// `band_record` away; a row never carries it. A record whose goods cannot be read says so with null.
let goodsCache = null;
const goodsIndex = () => (goodsCache ??= bandGoodsIndex(RUN_DIR));
let testCache = null;
const shapeGoodsTest = () => {
  if (testCache) return testCache;
  let words = [];
  try { words = loadJson(shapeJsonPath()).groups?.goods_test?.words ?? []; } catch { words = []; }
  testCache = { words, matched: goodsWordsMatched(words, { stems: true }) };
  return testCache;
};
// The record's body first; a row that carries goods of its own stands in where the run holds no body.
const goodsOfRow = (r) => goodsFor(goodsIndex(), r)
  ?? (typeof r?.goods === "string" && r.goods.trim() ? [{ classes: [], text: r.goods.trim() }] : null);
const withGoods = (r) => {
  const { words, matched } = shapeGoodsTest();
  const m = words.length ? matched(goodsOfRow(r)) : null;
  const { goods: _text, ...row } = project(r);   // a row's own goods text stands in for the test, and is not served
  return { ...row, goods_words: m == null ? null : `${m.length} of ${words.length}${m.length ? `: ${m.join(", ")}` : ""}` };
};

// A GROUP, PAGED AS THE SHAPE LISTS IT. The shape lists a group of a thousand records or more by its first
// page; the rest of its lines are served here, one compact line per mark of an owner, in the group's own
// order. A group's row is refused until every line was read (placement-union.mjs), so the step can always
// reach every line it is asked to answer for. Each answer logs the lines it served.
const GROUP_LINE_LIMIT = 200;
function groupLookup(params) {
  const g = String(params.group ?? "").trim().toLowerCase();
  let groups;
  try { groups = loadJson(shapeJsonPath()).groups; } catch { groups = null; }
  if (!groups?.[g]?.list) { logRead("band_lookup", params, { ok: false, reason: "no-group" }); return { isError: true, text: `ERROR: the band shape lists no group "${g}" — one of a, b, c, d, no_goods.` }; }
  const lines = groups[g].list;
  const total = groups.goods_words_total || 0;
  const limit = Math.max(1, Math.min(Number(params.limit) || GROUP_LINE_LIMIT, GROUP_LINE_LIMIT));
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  const page = lines.slice(offset, offset + limit).map((l) => ({
    mark: l.mark, owner: l.owner_name, classes: l.classes, live: `${l.live} of ${l.records}`, territories: l.territories,
    goods_words: l.goods_words == null ? null : `${l.goods_words.length} of ${total}${l.goods_words.length ? `: ${l.goods_words.join(", ")}` : ""}`,
    ...(l.goods_words == null && l.goods_on_file != null ? { goods_on_file: l.goods_on_file } : {}),
    floor: l.floors > 0, record: l.record_id, _key: l.key,
  }));
  const body = () => JSON.stringify({
    group: g, lines_total: lines.length, returned: page.length, ...(offset ? { offset } : {}),
    ...(lines.length > offset + page.length ? { next_offset: offset + page.length,
      note: `call again with offset: ${offset + page.length} for the next lines of group ${g}` } : {}),
    lines: page.map(({ _key, ...l }) => l),
  }, null, 2);
  let out = body();
  while (!fits(out) && page.length > 1) { page.pop(); out = body(); }
  logRead("band_lookup", params, { ok: true, group: g, returned: page.length, served_lines: page.map((l) => l._key) });
  return out;
}

function bandLookup(params = {}) {
  if (!RUN_DIR) return { isError: true, text: "ERROR: CLEAROTRON_BAND_RUN_DIR not set — band tools are wired per run by the driver." };
  if (params.group != null && String(params.group).trim()) return groupLookup(params);
  if (!existsSync(bandPath())) { logRead("band_lookup", params, { ok: false }); return { isError: true, text: "ERROR: register-named-band.json not found in this run — the band has not been merged yet." }; }
  let band;
  try { band = loadJson(bandPath()); } catch (e) { logRead("band_lookup", params, { ok: false }); return { isError: true, text: `ERROR: band unreadable (${e.message}) — a driver-side defect; report it, never hand-repair the band.` }; }
  const { record_id, owner, nice_class, tier, qid, query, text, status, live_only = false, goods } = params;
  // Words, as a list or one string. A record whose goods the run does not hold passes: unknown is not a mismatch.
  const goodsWords = (Array.isArray(goods) ? goods : goods == null ? [] : [goods]).map((w) => String(w ?? "").trim()).filter(Boolean);
  const goodsCount = goodsWords.length ? goodsWordCounter(goodsWords, { stems: true }) : null;   // the shape's own matcher
  const limit = Math.max(1, Math.min(Number(params.limit) || 20, 100));
  // PAGING. A large band is read page by page from `offset`, in the band's own order, and a capped answer
  // names the next offset. Without it the only way to see every record was to slice the band by owner or
  // text fragments, and a seat told to judge the complete band read it many times over (1,423 records,
  // 2,287 lookups, 65.8 MB, until the engine's output cap stopped the turn).
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  if (tier && !SHAPE_TIERS.includes(tier)) return { isError: true, text: `ERROR: tier must be one of ${SHAPE_TIERS.join(" | ")}.` };

  // tier filtering classifies against the SHAPE's own frozen targets — same classifier, same result.
  let prepared = null;
  if (tier) {
    try { prepared = prepareTargets(loadJson(shapeJsonPath()).targets ?? []); }
    catch { return { isError: true, text: "ERROR: tier filter needs _driver/band-shape.json (not derived yet)." }; }
  }

  const all = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const hits = [];
  let matched = 0;
  for (const r of all) {
    if (record_id && norm(r?.record_id) !== norm(record_id)) continue;
    if (owner && !norm(r?.owner_name).includes(norm(owner))) continue;
    if (nice_class != null) {
      const cls = (Array.isArray(r?.classes) ? r.classes : [r?.classes]).map(niceClassKey);   // "09" is class 9
      if (!cls.includes(niceClassKey(nice_class))) continue;
    }
    if (status && !norm(r?.status ?? r?.screen?.status).includes(norm(status))) continue;
    if (live_only === true && !isLiveRecord(r)) continue;
    // P2-B - the qid join matches MEMBERSHIP of the stamp union, not just the first-seen stamp. A
    // record surfaced by four slices carries four qids (named-band.mjs mergeNamedBands); matching
    // only `_qid` answered 0 for slices that had really answered, which is how the owner screen
    // vanished from its own coverage instrument. Still an EXACT qid match, one qid at a time.
    if (qid && !recordQids(r).some((q) => norm(q) === norm(qid))) continue;
    if (query && ![...(Array.isArray(r?._queries) ? r._queries : []), r?._query].some((q) => norm(q).includes(norm(query)))) continue;
    if (text && !norm(r?.mark_text).includes(norm(text))) continue;
    if (prepared && classifyRecord(r?.mark_text, prepared).tier !== tier) continue;
    if (goodsCount && goodsCount(goodsOfRow(r)) === 0) continue;
    matched++;
    if (matched > offset && hits.length < limit) hits.push(withGoods(r));
  }
  // matching crowd descriptors ride along (a lookup that lands in an un-enumerated zone must SEE that).
  const crowds = (Array.isArray(band?.crowds) ? band.crowds : []).filter((c) => {
    const q = norm(c?.query);
    return (query && q.includes(norm(query))) || (text && q.includes(norm(text))) || (owner && q.includes(norm(owner)));
    // — THE HONESTY LAYER HAS TO CARRY THE REFUSAL, or its own note asks for something the
    // reader cannot do. `crowd_note` below says "weigh the descriptor, never treat this result as
    // their clean" — and a descriptor reading `total_hits:0, fetched:0` IS a clean to anyone reading
    // it. The executor's 0 on a refused slice is a placeholder beside an `error` stamp, so a refusal
    // ships as a refusal here and never as a count of zero. This is the fourth projection in the same
    // chain and the one judgment actually calls.
  }).map((c) => ((c?.error === true || c?.deferred === true)
    ? { query: c.query, answered: false,
        refusal: c.deferred === true ? "capability-gap" : "provider-error",
        note: "NO COUNT WAS TAKEN for this slice — it is unsearched, not empty", reason: c.reason }
    : c.total_hits == null
      ? { query: c.query, size: "unknown", fetched: c.fetched,
          // — a bare `"total_hits": null` in a tool result is read by a model as "zero" or as a
          // missing key about as often as it is read as "unknown". The slice DID run here — `fetched`
          // is real — so what is absent is named, and named as a limit on what may be concluded.
          note: "the register would not state a total for this slice — its SIZE IS UNKNOWN, so no completeness claim can rest on it; whatever was fetched is real, the remainder is unmeasured rather than absent",
          reason: c.reason }
      : { query: c.query, total_hits: c.total_hits, fetched: c.fetched, reason: c.reason }));
  const refusedCrowds = crowds.filter((c) => c.answered === false).length;
  const unsizedCrowds = crowds.filter((c) => c.size === "unknown").length;

  // Byte-bound the response: drop trailing records (never crowds — the honesty layer) until it fits.
  // The full `matched` count always ships, and the note says exactly how many records were withheld.
  let byteCapped = 0;
  const body = () => JSON.stringify({
    matched, returned: hits.length, ...(offset ? { offset } : {}),
    ...(matched > offset + hits.length ? { next_offset: offset + hits.length } : {}),
    ...(matched > offset + hits.length ? { note: `capped at ${hits.length} — call again with offset: ${offset + hits.length} for the next page; the count above is the full match` } : {}),
    ...(byteCapped ? { byte_cap_note: `${byteCapped} matched record(s) withheld to fit one tool response — call again with offset: ${offset + hits.length} for the rest` } : {}),
    records: hits,
    ...(crowds.length ? { matching_crowds: crowds, crowd_note: "these matching slices were NOT enumerated — records under them may exist that no lookup can return; weigh the descriptor, never treat this result as their clean"
      + (refusedCrowds ? ` — and ${refusedCrowds} of them was/were NEVER ANSWERED at all (see "refusal"): no count exists for those, so they are unsearched rather than empty, and nothing about them can be read off a zero` : "")
      + (unsizedCrowds ? ` — and ${unsizedCrowds} of them has/have an UNKNOWN SIZE (see "size"): the register stated no total, so how much lies under those slices is unmeasured` : "") } : {}),
  }, null, 2);
  let out = body();
  while (!fits(out) && hits.length > 1) { hits.pop(); byteCapped++; out = body(); }
  logRead("band_lookup", params, { ok: true, matched, returned: hits.length, crowds: crowds.length, ...(byteCapped ? { byte_capped: byteCapped } : {}),
    served: hits.map((h) => h.record_id).filter(Boolean) });
  return out;
}

function bandRecord(params = {}) {
  if (!RUN_DIR) return { isError: true, text: "ERROR: CLEAROTRON_BAND_RUN_DIR not set — band tools are wired per run by the driver." };
  const uri = String(params.record_id ?? "").trim();
  if (!uri) { logRead("band_record", { record_id: uri }, { ok: false, reason: "no-record-id" }); return { isError: true, text: "ERROR: record_id is required (the /mark/... uri from the band or the findings)." }; }
  const dir = join(RUN_DIR, "_records");
  const hit = resolveRecordFile(dir, uri);
  const available = hit.files ?? [];
  // A cite that resolved to more than one instance document: the model is told WHICH uris, so its next
  // call is exact. Never a silent pick between two documents, never a miss the reader cannot act on.
  if (hit.ambiguous) {
    logRead("band_record", { record_id: uri }, { ok: false, reason: "ambiguous", candidates: hit.ambiguous });
    return { isError: true, text: `"${uri}" names ${hit.ambiguous.length} fetched records in this run — the store holds them at registration-instance granularity: ${hit.ambiguous.join(", ")}. Call band_record again with the exact uri of the one you mean (read them all if the point turns on more than one). This is an ambiguity, NOT an absence: the documents are on file.` };
  }
  if (hit.file) {
    let text;
    // The document is on file and could NOT be read (permissions, a torn write, a directory in its
    // place). That is a real unopenable document, and it must land in the reading audit as one: before
    // this, the throw travelled to the model as an isError and left NO row in the log, so the run's
    // record of what it failed to read was silently short.
    try { text = readFileSync(hit.file, "utf8"); }
    catch (e) {
      logRead("band_record", { record_id: uri }, { ok: false, reason: "unreadable", fail: String(e?.message ?? e).slice(0, 120) });
      return { isError: true, text: `The record for "${uri}" IS on file for this run but could not be read (${String(e?.message ?? e).slice(0, 120)}). This is an unopened document, not a record without one: state it as an open Coverage-ledger row naming the record, never as an absent record and never as a clean.` };
    }
    // How the cite resolved rides the log: an `exact` hit is the model quoting the store's own key; any
    // other value is this ladder doing work, and the reading audit says which and to what.
    const resolution = hit.via === "exact" ? {} : { via: hit.via, ...(hit.resolved ? { resolved: hit.resolved } : {}) };
    const parts = splitAtLines(text, RESPONSE_CHARS);
    const total = parts.length;
    if (total === 1) {                                  // the common case — served verbatim, no banner
      logRead("band_record", { record_id: uri }, { ok: true, bytes: text.length, ...resolution });
      return text;
    }
    // An oversize official record serves in PARTS, same contract as band_shape: line-boundary splits,
    // byte-identical concatenation, and an explicit "complete only once all parts are read" banner.
    const part = Math.min(Math.max(1, Math.floor(Number(params.part)) || 1), total);
    logRead("band_record", { record_id: uri, part, parts: total }, { ok: true, bytes: parts[part - 1].length, total_bytes: text.length, ...resolution });
    const head = `[band_record part ${part}/${total} — this record exceeds one tool response, so it is served in ${total} parts` +
      ` split at line boundaries. The record is COMPLETE only once ALL ${total} parts are read; concatenate the parts before parsing.]`;
    const tail = part < total
      ? `\n[end of part ${part}/${total} — call band_record again with {"record_id": "${uri}", "part": ${part + 1}} for the next part]`
      : `\n[end of part ${total}/${total} — the record is complete once parts 1..${total} are all read]`;
    return head + "\n" + parts[part - 1] + tail;
  }
  // ── BEFORE CALLING IT A MISS, ASK THE LEDGER — ─────────────────────────────────
  //
  // `_records/` is not where a fetch lands; it is where the end-of-run union puts what was fetched. So
  // an absence here means "not materialised yet", and this tool used to report it as "nothing was
  // fetched this run", which is a different claim and was false four times on a delivered round.
  const fromLedger = recordFromLedger(uri);
  if (fromLedger) {
    const text = JSON.stringify(fromLedger, null, 2);
    const parts = splitAtLines(text, RESPONSE_CHARS);
    if (parts.length === 1) {
      logRead("band_record", { record_id: uri }, { ok: true, bytes: text.length, via: "ledger" });
      return { type: "text", text };
    }
    const wanted = Number(params.part ?? 1);
    const part = Number.isInteger(wanted) && wanted >= 1 && wanted <= parts.length ? wanted : 1;
    logRead("band_record", { record_id: uri }, { ok: true, bytes: text.length, via: "ledger", part, parts: parts.length });
    return { type: "text", text: `[record ${uri} — part ${part}/${parts.length}]\n` + parts[part - 1]
      + (part < parts.length ? `\n[end of part ${part}/${parts.length} — call band_record again with {"record_id": "${uri}", "part": ${part + 1}}]` : "") };
  }

  // A GENUINE miss — neither materialised NOR in this run's ledger. Now the sentence below is true.
  // It stays an error, it stays in the reading audit with the reason that made it one, and it still says
  // what IS on file: the deferral this tool reports must stay visible for the real failures, or a dead
  // document reads back as a record that never had one.
  logRead("band_record", { record_id: uri }, { ok: false, reason: hit.miss });
  // The uri grammar is the same one screen-gate reads, and it does not cover every segment shape (a
  // 7+ character office segment parses nowhere). So this message never tells the model its uri is
  // wrong: it says what the resolver could not do, and what to do about it either way.
  const why = hit.miss === "unparsable-uri"
    ? `"${uri}" did not parse as a record reference (expected /mark/<cc>/<id> — a full provider URL carrying one is fine) and no archived record matches it exactly. If the uri IS right, its shape is outside this tool's grammar: state the gap, never read it as a clean.`
    : `No official record fetched for "${uri}" this run.`;
  return { isError: true, text: `${why} ${available.length ? `Records on file (${available.length}): ${available.slice(0, 40).join(", ")}${available.length > 40 ? ", …" : ""}.` : "No records fetched yet."} This tool is read-only — it never fetches; a record you need but do not have is an honest gap to state, not a reason to guess.` };
}

serve({
  name: "band", version: "0.1.0",
  tools: [
    {
      name: "band_shape",
      description: "The deterministic shape of this run's merged register band: totals, mechanical tiers, the floors (every live in-class identical/near-identical record), each marked on its line in the band in the lawyer's order, class/status/registry/recency census, owner concentrations, crowd descriptors (with crowd-context joins) and blind spots. Read this FIRST, then pull what it names via band_lookup/band_record. A large shape is served in parts, each naming the next call: read every part, since the band's groups, in the lawyer's order, run through them, and every floor in them has a fate on the form. Every call is logged to the run's reading audit.",
      inputSchema: { type: "object", properties: { format: { type: "string", enum: ["md", "json"], description: "md (default, readable) or json (machine shape)" }, part: { type: "number", description: "1-based part number when the shape is served in parts (default 1)" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: bandShape,
    },
    {
      name: "band_lookup",
      description: "Look up enumerated records in this run's frozen register band (read-only; logged to the reading audit). Filters AND together: record_id (exact uri), owner (substring), nice_class, tier (identical|near-identical|same-family|other|unclassifiable — classified against the shape's frozen targets), qid (exact plan-entry id — the plan-execution ledger join; a record surfaced by several slices matches under EVERY one of them), query (the _query slice that surfaced the record), text (substring of mark_text), status (substring), live_only, goods (words: records whose goods contain any of them, as whole words, singular or plural; a record with no goods on file matches too), group (a, b, c, d or no_goods: that list's lines in the shape's order, one per mark of an owner), limit (default 20, max 100), offset (default 0: where in the matching records or lines to start — a capped answer names the next offset, so a large band or group is read page by page). On each record served, `goods_words` gives the client's goods words its goods hold, as the shape tests them (k of N: the words), or null where its goods cannot be read; the goods text is in band_record. Matching un-enumerated crowd descriptors ride along so a lookup can never mistake a counted-only zone for a clean.",
      inputSchema: { type: "object", properties: {
        record_id: { type: "string" }, owner: { type: "string" }, nice_class: { type: "string" },
        tier: { type: "string", enum: SHAPE_TIERS }, qid: { type: "string" }, query: { type: "string" }, text: { type: "string" },
        status: { type: "string" }, live_only: { type: "boolean" }, goods: { type: "array", items: { type: "string" } },
        group: { type: "string", enum: ["a", "b", "c", "d", "no_goods"] },
        limit: { type: "number" }, offset: { type: "number" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: bandLookup,
    },
    {
      name: "band_record",
      description: "The OFFICIAL registry record the driver fetched into this run's _records/ for a given record_id (/mark/... uri) — the fetched document itself, for detail the band row does not carry. Cite the uri in whatever form the band, the findings or the provider gave you: case, a wrapping provider URL and the registration-instance suffix are all resolved to the same document. Read-only: it never fetches; an unfetched record returns an honest miss listing what is on file, and a record that IS on file but cannot be opened says so — both are gaps to state, never records without documents. Every call is logged to the reading audit.",
      inputSchema: { type: "object", required: ["record_id"], properties: { record_id: { type: "string", description: "the /mark/<cc>/<id> uri" }, part: { type: "number", description: "1-based part number when an oversize record is served in parts (default 1)" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: bandRecord,
    },
  ],
});
