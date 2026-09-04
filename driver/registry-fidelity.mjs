// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// registry-fidelity.mjs — spec A1 (citation fidelity) + the registry-arithmetic family of the A2 lint.
//
// A1: when a finding rests on a provider record that was FETCHED, every registry identifier shown for it
// (serial/application number, registration number, filing/registration/renewal dates, status) must match
// that record's fetched fields — upstream prose is an ineligible source. The plugin persists every fetched
// record body to a JSONL (logRecordBody, providers/corsearch/src/core.js); this module collects the
// run's records, archives them into the run dir (_records/), and field-compares the assembled documents
// against them. Detection is PURE CODE; repair is a named-correction redo quoting the record's true values
// (the model re-types, this module re-judges).
//
// Arithmetic family (no record needed): US serial-series era floors, registration-number era windows
// (verified anchors, interpolated, generous tolerance — GROSS violations only), filing→registration
// ordering, and renewal/expiry cycle arithmetic (renewals fall at year 10/20/… from registration — the
// check that catches "registration 2013 … renewed 2025" from the document alone).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
import { ledgerPath, runRecordLogPath, ledgerDeprecationNotice, retiredGlobalRecordLogNotice }
  from "../providers/_shared/ledger-path.mjs";
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half
import { USE_SOURCE_QUALITY } from "./findings-model.mjs";   // — the attested vocabulary; an unknown value falls back to the heuristic

// — `DEFAULT_RECORD_LOG` IS GONE, and it went because the question it answered no longer has one
// answer. It was `ledgerPath("record")` frozen at import, in the DRIVER — a long-lived process running
// several runs' pipelines at once. There is no such thing as "the record log" here any more; there is
// one per run, and `runRecordLogPath(runDir)` is how you say which. It had no non-test importer, so the
// removal costs no caller; leaving it would have left a module const that reads like the address.

// Same gateway-namespace stripping as provider-usage.mjs (sessionKey arrives as `agent:<id>:<key>`).
function stripGatewayNs(s) {
  return typeof s === "string" ? s.replace(/^agent:[^:]+:/, "") : "";
}
function rowMatchesRun(row, runPrefix) {
  return stripGatewayNs(row.sessionKey).startsWith(runPrefix)
      || stripGatewayNs(row.sessionId ?? "").startsWith(runPrefix);
}


// ── THE LEDGER IS READ LINE BY LINE, AND AN UNREADABLE ONE IS LOUD ───────────────────────────
//
// THE INCIDENT. The record ledger — then still named `corsearch-records.jsonl`, under the integrator
// platform's own dot-directory,
// renamed by — is append-only and nothing rotates it.
// On 2026-08-10 it passed Node's maximum string length:
//
//     MAX_STRING_LENGTH   536,870,888
//     the ledger          641,539,069        readFileSync(…, "utf8") ⇒ ERR_STRING_TOO_LONG
//
// All three readers below did `try { readFileSync(path, "utf8") } catch { return map }`, so from that
// moment every one returned EMPTY — on a file that exists, is readable, and holds exactly the right
// rows (2,117 for the run that first showed it, each with a well-formed target and body under a
// matching sessionKey). Nothing said a word.
//
// The blast radius was not the ledger. `assembleRunRecords` unions the ledger leg with `_records/`, and
// `_records/` is populated BY THAT UNION on a previous session — so a fresh run lost both legs at once
// and assembled ZERO record artifacts. Downstream, joinEvidenceStatus's fetch-receipt join then had an
// empty record set and raised no "presented as assumed" flag on ANY meter, so a run with no records
// read exactly like a clean one.
//
// TWO CHANGES, and the second matters as much as the first:
//   · the file is walked in CHUNKS and split on newlines, so its size stops being a cliff. Buffers have
//     no such limit and no line is ever materialised beyond its own length.
//   · a read that FAILS is reported. `catch { return map }` on a present, readable, correct file is an
//     absence presented as a pass — the exact class the hard rules exist for. The reason travels to the
//     caller, which logs it.

const LEDGER_CHUNK = 8 * 1024 * 1024;

/**
 * Walk a JSONL ledger line by line without ever holding it as one string.
 *
 * @returns {{lines:number, error:string|null}} — `error` is null on success and a REASON on failure. A
 *          missing file is not an error (a run before any fetch has no ledger, and that is ordinary);
 *          a file that exists and cannot be read is.
 * Never throws: the callers are gates, and a gate that dies on telemetry is worse than one that reports.
 */
export function forEachLedgerLine(path, onLine) {
  let fd = null;
  try { fd = openSync(path, "r"); }
  catch (e) { return { lines: 0, error: e?.code === "ENOENT" ? null : `${e?.code ?? "read failed"}` }; }
  try {
    const buf = Buffer.allocUnsafe(LEDGER_CHUNK);
    let carry = "";
    let lines = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, LEDGER_CHUNK, null);
      if (n <= 0) break;
      const text = carry + buf.toString("utf8", 0, n);
      const parts = text.split("\n");
      carry = parts.pop() ?? "";        // the tail may be a partial line; it rides to the next chunk
      for (const ln of parts) { if (ln.trim()) { onLine(ln); lines++; } }
    }
    if (carry.trim()) { onLine(carry); lines++; }
    return { lines, error: null };
  } catch (e) {
    return { lines: 0, error: String(e?.code ?? e?.message ?? "read failed").slice(0, 80) };
  } finally { try { closeSync(fd); } catch { /* nothing left to do about it */ } }
}

/** The last ledger read's failure reason, or null. Read by assembleRunRecords so the caller can LOG it. */
let lastLedgerError = null;
export const ledgerReadError = () => lastLedgerError;
const noteLedger = (r) => { if (r.error) lastLedgerError = r.error; return r; };

// Latest fetched body per record URI for the run. Never throws (a missing ledger → empty map).
//
// — NO DEFAULT PATH. It used to fall back to `ledgerPath("record")`, the box-global file. Now that
// the log is run-scoped there is no sensible box-wide default, and a caller that forgets the argument
// must not quietly read another run's records: undefined reaches `forEachLedgerLine`, which reports a
// read failure rather than an empty map, and the failure travels to the caller as `ledgerError`.
export function collectRecordBodies(recordLogPath, runPrefix) {
  const map = new Map();
  noteLedger(forEachLedgerLine(recordLogPath, (line) => {
    let row;
    try { row = JSON.parse(line); } catch { return; }
    if (!runPrefix || !rowMatchesRun(row, runPrefix)) return;
    const body = Array.isArray(row.body) ? row.body[0] : row.body;
    if (row.target && body && typeof body === "object") map.set(String(row.target).toLowerCase(), body);
  }));
  return map;
}

// WP-receipts (2026-07-05): the fetch RECEIPT per record URI — when the record was pulled and under
// which run context. Captured from the same record-body ledger rows the fetch ALREADY writes (zero new
// provider calls); replaces the "was it on disk?" inference the report's `verified` label rested on.
export function collectRecordReceipts(recordLogPath, runPrefix) {   // — no default; see above
  const map = new Map();
  noteLedger(forEachLedgerLine(recordLogPath, (line) => {
    let row;
    try { row = JSON.parse(line); } catch { return; }
    if (!runPrefix || !rowMatchesRun(row, runPrefix)) return;
    if (!row.target || !row.ts) return;
    map.set(String(row.target).toLowerCase(), { fetched_at: String(row.ts), context: stripGatewayNs(row.sessionKey ?? "") || null });
  }));
  return map;
}

// Per-URI fetch call metadata (http_status / ok / cache_hit) from the CALL ledger the plugin already
// writes — joined into receipts.json so "verified" is provable with the transport outcome attached.
export function collectFetchCallMeta(callLogPath, runPrefix) {
  const map = new Map();
  noteLedger(forEachLedgerLine(callLogPath, (line) => {
    let row;
    try { row = JSON.parse(line); } catch { return; }
    if (!runPrefix || !rowMatchesRun(row, runPrefix)) return;
    if (row.tool !== "record_fetch" || !row.target) return;
    map.set(String(row.target).toLowerCase(), {
      ...(row.http_status !== undefined ? { http_status: row.http_status } : {}),
      ...(row.ok !== undefined ? { ok: row.ok } : {}),
      ...(row.cache_hit !== undefined ? { cache_hit: row.cache_hit } : {}),
    });
  }));
  return map;
}

// Archive the run's fetched records as individual artifacts — the auditor-visible substrate the A1 check
// verifies against ("identifiers in the report match the record-fetch artifact field-for-field").
// V4-1: each artifact embeds its `_uri` so the run dir is a READABLE record set (the filename squash is
// lossy for hyphenated ids); readRecordArtifacts below re-derives legacy filenames best-effort.
export function writeRecordArtifacts(runDir, recordsByUri, receiptsByUri = null) {
  if (!recordsByUri?.size) return 0;
  const dir = join(runDir, "_records");
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [uri, body] of recordsByUri) {
    const name = uri.replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-") + ".json";
    // `_receipt` rides the artifact like `_uri` (underscore keys are inert to the REC extractors and
    // legacy readers): a FRESH receipt for this uri wins; otherwise a receipt already embedded in the
    // body (an inherited artifact) survives the rewrite — the run dir stays self-contained.
    const receipt = receiptsByUri?.get(uri);
    try { writeFileSync(join(dir, name), JSON.stringify({ ...body, _uri: uri, ...(receipt ? { _receipt: receipt } : {}) }, null, 2) + "\n"); n++; } catch { /* best-effort */ }
  }
  return n;
}

// V4-1: read the run dir's archived record set back. The inverse of writeRecordArtifacts — `_uri` is the
// embedded key; legacy artifacts (pre-V4) re-derive `/mark/<cc>/<rest>` from `<cc>-<rest>.json`.
export function readRecordArtifacts(runDir) {
  const map = new Map();
  const dir = join(runDir, "_records");
  let files;
  try { files = readdirSync(dir); } catch { return map; }
  for (const f of files.filter((x) => x.endsWith(".json")).sort()) {
    let body;
    try { body = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    if (!body || typeof body !== "object" || Array.isArray(body)) continue;
    const uri = typeof body._uri === "string" && body._uri
      ? body._uri.toLowerCase()
      : `/mark/${f.slice(0, 2)}/${f.slice(3, -5)}`.toLowerCase();
    map.set(uri, body);
  }
  return map;
}

/**
 * V4-1 — the run's record set, assembled for THIS delivery: run-dir `_records/` artifacts (inherited or
 * prior-session) ∪ this-session ledger rows (newest fetch wins), persisted back so the run dir is
 * self-contained after every session. Gates consume THIS, never the prefix-filtered ledger alone — the
 * copper-conduit fork shipped a false registry citation because the comparator's record set was "rows
 * fetched under this codename" (empty on a fork) instead of "records backing this artifact set".
 *
 * — THE RECORD LOG IS THIS RUN'S. Both legs now live under `runDir`: `_records/` and
 * `_driver/register-record-bodies.jsonl`. That is the redesign's exit criterion — ONE address for a
 * register response, read by the fidelity check and by the audit surfaces alike — and it is what lets
 * the log be purged with the run instead of growing on the box for ever.
 *
 * THE PREFIX FILTER STAYS, and is now belt-and-braces rather than the mechanism. Its remaining job is
 * the copper-conduit fork: a forked run dir carries the parent's record log, whose rows were written
 * under the parent's codename. Those records are already in the inherited `_records/`, so keeping the
 * filter costs nothing and stops a fork claiming the parent's fetches as this session's.
 *
 * @returns {{records: Map<string,object>, fromRunDir: number, fromLedger: number, receipts: number,
 *            ledgerError: string|null, fetchedWithoutRecord: number, unrecordedFetches: string[]}}
 */
export function assembleRunRecords(runDir, runPrefix,
  // — the run's own log, derived from the run dir the caller already passed. Resolved at CALL time,
  // as it always was, so a test can pin a fixture path positionally.
  recordLogPath = runRecordLogPath(runDir),
  // The CALL ledger does NOT move: provider-usage.mjs tallies it across runs, and it is the only
  // record of the fetches a run made that survives independently of where the bodies landed — which is
  // what `fetchedWithoutRecord` below rests on. ONE resolver for every site: homedir per call
  // rather than a literal home — a hardcoded /home/operator diverged from every other read site under
  // any other service account, splitting the provider ledger — plus the legacy name/dir fallbacks.
  callLogPath = ledgerPath("call")) {
  lastLedgerError = null;                      // this assembly's own verdict, not a previous one's
  const fromRunDir = readRecordArtifacts(runDir);
  const fromLedger = collectRecordBodies(recordLogPath, runPrefix);
  const records = new Map(fromRunDir);
  for (const [uri, body] of fromLedger) records.set(uri, body);
  // WP-receipts: receipts assemble the same way the records do — artifact-embedded ones (inherited run
  // dir) ∪ this-session ledger rows (fresh fetch wins) — so a re-assembled run dir keeps its proof.
  const receipts = new Map();
  for (const [uri, body] of fromRunDir) if (body?._receipt && typeof body._receipt === "object") receipts.set(uri, body._receipt);
  for (const [uri, receipt] of collectRecordReceipts(recordLogPath, runPrefix)) receipts.set(uri, receipt);
  writeRecordArtifacts(runDir, records, receipts);
  // — the ledger's own verdict travels with the result. A caller that cannot tell "no records were
  // fetched" from "the ledger could not be read" will report the second as the first, which is what let
  // a 641 MB file silently empty every run's record set for hours.
  const ledgerError = lastLedgerError;

  // ── — AN EMPTY RECORD LOG CAN NEVER READ AS "NOTHING WAS FETCHED" ────────────────────────────
  //
  // This is the constraint the run-scoping redesign was allowed to ship on, and it exists because the
  // move MAKES the shape the default. Under the old global address a populated ledger was the
  // normal state, so an empty one was unusual. Under run-scoping every run starts with no record log at
  // all, `forEachLedgerLine` maps ENOENT to `error: null` on purpose (a run before its first fetch
  // genuinely has none), and so a run whose bodies were written to the wrong address — a writer that
  // was not handed `recordLog`, a resumed run pointed at a different dir — assembles ZERO records and
  // reports exactly like a clean one. That is the incident: nineteen `verified-from-record` meters with
  // no record on disk and no flag anywhere.
  //
  // THE CALL LEDGER IS THE INDEPENDENT WITNESS, and it is why it stays global and out of this move. It
  // records that a record_fetch HAPPENED, under this run's prefix, whatever became of the body. So:
  // fetch calls this run that reported ok, whose target is absent from the assembled set, are a
  // FAILURE — never a zero.
  //
  // `_driver/receipts.json` could not do this job: `assembleRunRecords` writes it, from this same map,
  // so it agrees with whatever this function already believes.
  //
  // NOT counted: calls that reported `ok: false`. A fetch the register refused has no body to file, and
  // flagging it here would report a disclosed provider failure as an evidence-plumbing fault.
  //
  // AND THE WITNESS'S OWN SILENCE IS A FINDING. An unreadable call ledger yields no fetch rows, which
  // would make this check pass on every run it could ever fail on. `lastLedgerError` is re-armed around
  // the read so that failure is reported as its own fact rather than folded into the record log's.
  lastLedgerError = null;
  const fetchCalls = collectFetchCallMeta(callLogPath, runPrefix);
  const callLedgerError = lastLedgerError;
  const unrecordedFetches = [...fetchCalls.entries()]
    .filter(([uri, meta]) => meta.ok !== false && !records.has(uri))
    .map(([uri]) => uri).sort();

  // _driver/receipts.json — the run-level fetch-receipt index the report render + lint consume: what was
  // pulled, from where, when, with the transport outcome joined from the call ledger.
  //
  // THE PROVIDER NAME IS READ, NOT DEFAULTED. This line carried its own `|| "corsearch"` — a
  // THIRD copy of the same decision, deliberately not importing driver.config so as to stay
  // dependency-free, and therefore left defaulting after both other copies were fixed. Every receipt
  // in the run would then have named a vendor this deployment did not choose, stamped onto the
  // artifact the report render and the delivery lint both read as evidence of where a fact came from.
  // A wrong provenance label is worse than none. Unset now writes `null`, which reads as "we do not
  // know" rather than as an attribution.
  //
  // Best-effort write: receipt trouble must never fail a gate that only needed records.
  try {
    if (records.size) {
      const callMeta = fetchCalls;   // — one read of the call ledger per assembly, not two
      const provider = (envFrom(process.env, "CLEAROTRON_DATABASE") || "").toLowerCase() || null;
      // — WHICH CORPUS ANSWERED, ON THE MACHINE RECORD.
      //
      // put `environment` on euipo_search's response envelope and taught two skill files to carry
      // the word into the findings prose as `EUIPO (production)` / `EUIPO (sandbox)`. The code half is
      // right; the disclosure half is a dictation line, and a dictation line has no failure branch. On
      // the only real EUIPO run this repository holds it did not fire: 20 mentions of EUIPO across
      // report.md, findings.json and audit.md, none of them tagged, and 27 receipts carrying `provider`
      // and no environment. The artifact is SILENT rather than wrong, and silence reads as fine — the
      // family this program keeps finding. So the driver writes it, beside the provider it already
      // writes, from the same kind of read.
      //
      // UNSET WRITES null, NEVER "sandbox". euipo-server.mjs makes the same choice at the other end and
      // says why: a default here would reinstate the silent wrong-corpus read the field exists to
      // prevent. null says "this run did not record it", which is a fact; "sandbox" would be a claim.
      // A live EUIPO call cannot reach this state anyway — core.js refuses to run with the variable
      // empty — so a null on a euipo receipt means the DRIVER lost it, which is worth failing on.
      //
      // STAMPED ONLY WHERE IT MEANS SOMETHING. `environment` is a EUIPO concept; on any other provider
      // the key would be a null nobody can act on, and this file already refuses to attribute what it
      // does not know rather than writing a placeholder.
      const environment = provider === "euipo"
        ? ((process.env.EUIPO_ENVIRONMENT || "").trim().toLowerCase() || null)
        : null;
      const rows = [...records.keys()].sort().map((uri) => {
        const receipt = receipts.get(uri);
        const body = records.get(uri);
        return {
          uri, provider,
          ...(provider === "euipo" ? { environment } : {}),
          fetched_at: receipt?.fetched_at ?? null,
          context: receipt?.context ?? null,
          fields: Object.keys(body ?? {}).filter((k) => !k.startsWith("_")).sort(),
          ...(callMeta.get(uri) ?? {}),
        };
      });
      ensureDriverDir(runDir);
      writeFileSync(driverDir(runDir, "receipts.json"), JSON.stringify({ schema_version: 1, receipts: rows }, null, 2) + "\n");
    }
  } catch { /* best-effort — the records map above remains the gate substrate */ }
  // 's legacy-name notice is REPLACED, not deleted. That one told an operator which of four
  // global candidates was being read; nothing reads any of them for a new run any more, so the sentence
  // had become false. What an operator still needs is the fact underneath it: a box upgraded across this
  // change is carrying a large global record log that is now written by nothing and read by nothing —
  // 432 MB on production, 2.0 GB on test. It is history, not a fault, and archiving it is a one-time
  // manual step by design (a code fallback that kept reading it would be the third address this redesign
  // exists to remove). `null` on a fresh install, so a caller can print it unconditionally.
  //
  // AND THE CALL LEDGER'S OWN NOTICE MOVES HERE RATHER THAN DYING WITH IT. `ledgerDeprecationNotice` had
  // exactly one product caller — the record line above — so deleting that line would have left NOTHING
  // announcing the ledger that is still global, still live and still on production's pre- filename.
  // Gated on the path ACTUALLY WALKED: the notice re-resolves from the environment, so on a call that
  // passed an explicit `callLogPath` it would describe a file this assembly never opened, and a
  // diagnostic that names something other than what happened is worse than no diagnostic.
  const ledgerNotice = [
    callLogPath === ledgerPath("call") ? ledgerDeprecationNotice("call") : null,
    retiredGlobalRecordLogNotice(),
  ].filter(Boolean).join("\n") || null;
  if (ledgerNotice) process.stderr.write(ledgerNotice + "\n");   // once per process — see ledger-path.mjs
  return { records, fromRunDir: fromRunDir.size, fromLedger: fromLedger.size, receipts: receipts.size,
    ledgerError, ledgerNotice,
    // — the two facts that stop an empty run-scoped log reading as a clean run.
    callLedgerError, fetchedWithoutRecord: unrecordedFetches.length, unrecordedFetches };
}

// ── claimed-identifier extraction (labeled patterns ONLY — never bare numbers) ──────────────────────────

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const yearOf = (s) => { const m = String(s ?? "").match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; };

// Split a document into blocks at h2/h3 headings so claims pair with the finding that cites the record.
// A "### " sub-block (e.g. a card's "Full detail & provenance") inherits its parent "## " card heading
// as `parent` — the owner name and the record link live on the card head while the registry claims live
// in the detail sub-block, so pairing must see both.
export function splitBlocks(text) {
  const out = [];
  let parentH2 = "";
  let cur = { heading: "(preamble)", parent: "", body: [] };
  for (const ln of String(text ?? "").split("\n")) {
    const h = ln.match(/^(#{2,3})\s+(.*)/);
    if (h) {
      out.push(cur);
      if (h[1] === "##") { parentH2 = h[2].trim(); cur = { heading: parentH2, parent: "", body: [] }; }
      else cur = { heading: h[2].trim(), parent: parentH2, body: [] };
      continue;
    }
    cur.body.push(ln);
  }
  out.push(cur);
  return out.map((b) => ({ heading: b.heading, parent: b.parent, text: b.body.join("\n") }));
}

// CLAIM SCOPES inside a block (2026-07-29). The heading is a sound pairing key inside a finding CARD —
// one card, one subject, so every literal in it is "shown for" the record the card cites. It is not sound
// inside a flat list, where each top-level item is a DIFFERENT subject. One such list named one
// owner's EU and UK records in one bullet (stating no dates at all), a third party's application "filed
// 2026-03-31" in another, and a fourth party's "registered 2004-05-06" in a third. The block-wide pool
// compared every year against every URI and reported six registry-record-match mismatches plus one
// "registration 2004 before filing 2026" — over a report in which every stated year was correct.
//
// So a literal is judged against a citation only when the two share a claim scope:
//   • each TOP-LEVEL list item is a scope of its own (an indented continuation or a nested bullet stays
//     with its parent item — it is the same claim);
//   • the block's non-list prose is a further scope;
//   • the parent/heading lines belong to every scope in the block (the card's own subject).
// Returns [{start, end, text}] with offsets into `blockBody`, so a caller that edits the body (the
// corrector) can ask which scope a match sits in. A body with no list items yields exactly one scope,
// which is why every block that states its registry claims in one place behaves exactly as before.
const TOP_LEVEL_LIST_ITEM_RE = /^(?:[-*+]|\d+[.)])\s+/;
export function splitClaimScopes(blockBody) {
  const src = String(blockBody ?? "");
  const bounds = [];
  let inItem = false;
  let pos = 0;
  for (const ln of src.split("\n")) {
    if (TOP_LEVEL_LIST_ITEM_RE.test(ln)) { bounds.push(pos); inItem = true; }
    // a non-indented, non-blank line closes the list and opens a fresh prose scope
    else if (inItem && ln.trim() && !/^[ \t]/.test(ln)) { bounds.push(pos); inItem = false; }
    pos += ln.length + 1;   // +1 for the "\n" that split removed (harmless overshoot on the last line)
  }
  if (!bounds.length || bounds[0] !== 0) bounds.unshift(0);
  return bounds.map((start, i) => {
    const end = i + 1 < bounds.length ? bounds[i + 1] : src.length;
    return { start, end, text: src.slice(start, end) };
  });
}

export function extractRegistryClaims(blockText) {
  const t = String(blockText ?? "");
  const grab = (re) => { const out = []; let m; while ((m = re.exec(t))) out.push(m[1]); return out; };
  return {
    // hyphens AND underscores are legal in record ids (/mark/cn/37554073-42; Signa /mark/us/tm_019d1db7-…)
    // — truncating at one would mint a phantom "unfetched" citation for a URI nobody wrote
    uris: grab(/(\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*)/gi).map((u) => u.toLowerCase().replace(/-$/, "")),
    regNumbers: grab(/\bReg(?:istration)?\.?\s*(?:No\.?|Number|#)?\s*:?\s*([0-9][\d,.]{5,9})\b/gi).map(digits),
    serials: grab(/\b(?:Application|Serial)\s*(?:No\.?|Number|#)?\s*:?\s*([0-9][\d\/,.]{5,11})\b/gi).map(digits),
    filingYears: grab(/\b(?:filed|filing date|application date)[:\s]+(?:on\s+)?((?:19|20)\d{2}(?:-\d{2}-\d{2})?)/gi).map(yearOf),
    regYears: grab(/\bregist(?:ered|ration)(?:\s+date)?[:\s,]+(?:in\s+)?((?:19|20)\d{2}(?:-\d{2}-\d{2})?)/gi).map(yearOf)
      // "…, 2013 registration" / "their 2013 registration"
      .concat(grab(/\b((?:19|20)\d{2})\s+registration\b/gi).map(yearOf)),
    // The REVERSED forms read the year BEFORE the word ("their 2025 renewal", "a 2029 expiry"). A year
    // that already carries a FILING or REGISTRATION label is not available to them, and their window
    // does not cross a clause break. Without those two guards the form reaches back over the sentence and
    // reads the REGISTRATION year as an expiry claim —
    //   "registered 2019-11-15, live, expiry 2029-11-15"   →  expiry 2019
    //   "the earlier registered 2017 / expiry 2027 reading" →  expiry 2017
    // — and because a cycle of zero years can never pass, the report is then told "expiry 2019 is not a
    // 10-year cycle from registration 2019": one literal contradicting itself, over a record that is
    // entirely correct. Both lines are real, from two of the nine archived runs. The FORWARD forms
    // ("renewed 2025", "expires 2029") are untouched — they carry the documented catches.
    renewalYears: grab(/\brenew(?:ed|al)[^.\n]{0,24}?((?:19|20)\d{2})/gi).map(yearOf)
      .concat(grab(/(?<!\b(?:filed|filing|registered|registration|application)(?:\s+date)?[:\s]{1,3})((?:19|20)\d{2})[^.,;\n]{0,16}?\brenewal\b/gi).map(yearOf)),
    expiryYears: grab(/\bexpir\w*[^.\n]{0,24}?((?:19|20)\d{2})/gi).map(yearOf)
      .concat(grab(/(?<!\b(?:filed|filing|registered|registration|application)(?:\s+date)?[:\s]{1,3})((?:19|20)\d{2})[^.,;\n]{0,16}?\bexpir/gi).map(yearOf)),
    claimsLive: /\b(?:live|registered and active|active registration|in force)\b/i.test(t),
    claimsDead: /\b(?:abandoned|cancelled|canceled|expired|dead|lapsed)\b/i.test(t),
  };
}

// ── A1: field-for-field comparison against the fetched record ───────────────────────────────────────────

// serial/regNumber/filing/reg read NEUTRAL field names (applicationNumber/registrationNumber/
// applicationDate/registrationDate) that BOTH providers' normalized records carry. Only live/dead is
// vendor-shaped, so a neutral `statusClass` (live|dead, set by the normalizer from the authoritative
// active flag) is checked first; the corsearch raw-status regex is the fallback (corsearch records carry
// no statusClass, so its behaviour is unchanged).
// Exported so render.mjs (publish) extracts registry identifiers from the SAME fetched-record fields the
// A1 backstop compares against — render-from-record and the registry-record-match gate MUST agree or the
// kept backstop would false-fire on its own rendering. `digits`/`yearOf` stay private (REC closes over them).
export const REC = {
  serial: (r) => digits(r.applicationNumber),
  regNumber: (r) => digits(r.registrationNumber ?? r.onomaticsRegistrationNumber),
  filingYear: (r) => yearOf(r.applicationDate),
  regYear: (r) => yearOf(r.registrationDate),
  isDead: (r) => r.statusClass === "dead" || (r.statusClass !== "live" && /invalid|abandon|cancel|expir|dead|terminat/i.test(
    [r.onomaticsStatus, r.corsearchStatusCode, r.markCurrentStatusCode, r.corsearchEstimatedStatusCode].join(" "))),
  isLive: (r) => r.statusClass === "live" || /\b(valid|live|registered)\b/i.test(String(r.onomaticsStatus ?? r.corsearchStatusCode ?? "")),
  statusStr: (r) => String(r.statusText ?? r.onomaticsStatus ?? r.corsearchStatusCode ?? r.statusClass ?? ""),
  // doc-31 step 4: the proprietor/applicant name as the record holds it — the AUTHORITATIVE owner display, so a
  // model-typed/​invented variant ("Lo.Li. Pharma International" for a record that says "Lo.Li. Pharma S.r.l.")
  // never becomes the card's owner. Provider-blind: every normalizer writes `owner` (legacy: ownerName/proprietor).
  owner: (r) => String(r.owner ?? r.ownerName ?? r.proprietor ?? "").trim(),
  // — the owner's name in its ORIGINAL script, when the record draws that distinction. Its presence
  // is the signal that the Latin field above is a ROMANISATION and not a name anyone reads: for a CN
  // proprietor the provider fills it with character-by-character pinyin. Provider-blind, same as `owner`.
  ownerNative: (r) => String(r.ownerNative ?? r.applicantNameNative ?? "").trim(),
  // A5 (a staff lawyer's catch) — an international (WIPO/Madrid) registration's rights reach ONLY its
  // designated countries; never imply "international = global". Corsearch bodies carry the
  // per-designated-country statuses as `onomaticsJurisdictionsStatuses` (array of strings or of
  // {jurisdiction,status} objects — fail-open on either shape; null when the record lacks it).
  designations: (r) => {
    const j = r.onomaticsJurisdictionsStatuses ?? r.jurisdictions ?? null;
    if (!Array.isArray(j) || !j.length) return null;
    const out = j.map((e) => typeof e === "string" ? e.trim()
      : (e && typeof e === "object") ? [e.jurisdiction ?? e.code ?? "", e.status ? `(${e.status})` : ""].filter(Boolean).join(" ").trim()
      : "").filter(Boolean);
    return out.length ? out : null;
  },
};

// ── A4 — evidence status derived by MACHINE JOIN, never trusted from the enum alone ──────────
// classifyUseSource: what KIND of evidence a use-check URL is. Deterministic + fail-open (an unknown
// host stays "independent" — unless the model itself attests use_check.quality "register-mirror",
// which joinEvidenceStatus honours as a demotion); a register-replicating page can never
// count as USE evidence (citing a register mirror to prove use is circular — the VENZY
// markenmeldungen.ch case).
export const REGISTER_MIRROR_HOSTS = [
  "markenmeldungen.ch", "trademarks.justia.com", "trademarkia.com", "tmdn.org", "tmview.org",
  "euipo.europa.eu", "wipo.int", "uspto.gov", "swissreg.ch", "register.dpma.de", "trademarkelite.com",
];
export function classifyUseSource(url, ownerName = "") {
  let host = "";
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "independent"; }
  if (REGISTER_MIRROR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "register-mirror";
  // legal suffixes never appear in a domain ("MAN Sports LLC" must still match mansports.com;
  // punctuation folds first so "S.r.l." / "S.A." strip too)
  const ownerTok = String(ownerName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:inc|incorporated|llc|llp|ltd|limited|gmbh|s ?r ?l|sarl|s ?a|ag|nv|bv|oy|ab|as|plc|corp|corporation|co|company|holdings?|group|international)\b/g, " ")
    .replace(/\s+/g, "").slice(0, 12);
  if (ownerTok.length >= 5 && host.replace(/[^a-z0-9]+/g, "").includes(ownerTok)) return "owner-site";
  return "independent";
}

// joinEvidenceStatus: derive a per-meter `_status` by joining each meter's self-declared source to
// the run's ACTUAL fetch receipts. `confirmed` = basis verified AND the source joins a fetched
// record (/mark/… against recordsByUri). An http(s) source has no fetch ledger to join — the
// perplexity fetch-ledger is a future workstream, and the web-receipt join lands WITH its producer
// — so http-sourced "verified" honestly degrades to `assumed`.
// `assumed` = claims verified but the receipt is missing/un-joined (the KANION class — demoted).
// `inferred` = basis inferred-from-signal. `not-checked` = token unknown / no meter. Also demotes a
// use meter whose use_check source is a register mirror (register listing ≠ use evidence) — by URL
// host OR by the model's own `quality` attestation, whichever is stricter. PURE
// (mutates only the private `_status`/`_useSourceClass` display fields, like bindFindingsToRecords).
// WP-receipts W2 (the VENZY join defect): meter sources sometimes arrive as FULL provider URLs
// (https://tm.corsearch.com/mark/ae/229552) while the record set keys on /mark/ paths — without
// normalization a genuinely FETCHED record demotes to "assumed" at render, with a false integrity
// flag on top. Same broad id shape as pipeline.mjs CITED_URI_RE.
export function normalizeRecordUri(src) {
  const m = String(src ?? "").trim().match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/i);
  return m ? m[0].toLowerCase() : "";
}

// ── spec 64 (B3) — opposition-window extraction ─────────────────────────────────────────────────────────
// The DEMVENZY drop: teal-conduit recorded "CH opposition window open to 2026-07-13"; copper-causeway's
// bands carried the SAME structured date two days before it closed — and it never reached the delivered
// findings or prose. These accessors are the deterministic join from the run's register substrates to a
// per-record opposition end date; the pipeline stamps it onto findings (enrichFindingDeadlines) and onto
// the recall store rows (opposition_end), and the deadline-carry tripwire judges it at read time.
// Alias-tolerant by DATA (provider shapes differ): the date has been observed at rec.jurisdictions[].
// oppositionEndDate, rec.screen.jurisdictions[].oppositionEndDate and rec.raw.jurisdictions[].
// oppositionEndDate. The LATEST window end wins (the last chance to act on a multi-designation record).
export function recordOppositionEnd(rec) {
  const dates = [];
  const push = (v) => { if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.push(v.slice(0, 10)); };
  push(rec?.oppositionEndDate);
  for (const src of [rec?.jurisdictions, rec?.screen?.jurisdictions, rec?.raw?.jurisdictions])
    if (Array.isArray(src)) for (const j of src) push(j?.oppositionEndDate);
  return dates.length ? dates.sort().at(-1) : null;
}

// Scan the run's register substrates (the merged named band, every unit band, every fetched record body)
// and return Map<canonical /mark uri, latest opposition end "YYYY-MM-DD">. A deep walk, not a schema
// bind: band shapes differ per axis and per provider, and a record node is recognisable by its
// record_id / /mark uri wherever it nests. Read-only; unreadable files are skipped (never-kill caller).
export function collectOppositionDeadlines(runDir) {
  const map = new Map();
  const fold = (rec) => {
    const uri = normalizeRecordUri(rec?.record_id ?? rec?.uri ?? "");
    if (!uri) return;
    const end = recordOppositionEnd(rec);
    if (!end) return;
    const prev = map.get(uri);
    if (!prev || end > prev) map.set(uri, end);
  };
  const walk = (node) => {
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (!node || typeof node !== "object") return;
    if (node.record_id || (typeof node.uri === "string" && node.uri.startsWith("/mark/"))) fold(node);
    for (const v of Object.values(node)) walk(v);
  };
  const tryWalk = (path) => { try { if (existsSync(path)) walk(JSON.parse(readFileSync(path, "utf8"))); } catch { /* skip unreadable */ } };
  tryWalk(join(runDir, "register-named-band.json"));
  try {
    const unitDir = join(runDir, "register-units");
    for (const f of readdirSync(unitDir)) if (f.endsWith("-band.json")) tryWalk(join(unitDir, f));
  } catch { /* no units dir */ }
  try {
    const recDir = join(runDir, "_records");
    for (const f of readdirSync(recDir)) if (f.endsWith(".json")) tryWalk(join(recDir, f));
  } catch { /* no records dir */ }
  return map;
}

// fetchFailures (404-card caveat, 2026-07-22): the V4-2 registry-record-closure pass records every
// cited record its targeted fetch DEFINITIVELY could not retrieve (pipeline recordFetchFailures →
// persisted in _driver/predelivery-lint.json artifactSet.recordFetchFailures). Accepts a Map, a plain
// object, or the persisted [{uri, cause}] array; keys canonicalized via normalizeRecordUri. Returns a
// Map<canonical uri, cause> (empty when nothing failed). PURE.
function normalizeFetchFailures(fetchFailures) {
  const out = new Map();
  const put = (uri, cause) => { const u = normalizeRecordUri(uri); if (u && !out.has(u)) out.set(u, String(cause ?? "fetch failed")); };
  if (fetchFailures instanceof Map) { for (const [u, c] of fetchFailures) put(u, c); }
  else if (Array.isArray(fetchFailures)) { for (const e of fetchFailures) put(e?.uri, e?.cause); }
  else if (fetchFailures && typeof fetchFailures === "object") { for (const [u, c] of Object.entries(fetchFailures)) put(u, c); }
  return out;
}

export function joinEvidenceStatus(findings, recordsByUri = new Map(), fetchFailures = null) {
  const flags = [];
  const failed = normalizeFetchFailures(fetchFailures);
  for (const f of findings ?? []) {
    // 404-card caveat (2026-07-22 — a delivered card claimed "verified directly from the record" over
    // a record whose fetch 404'd): a finding citing a registration whose closure fetch FAILED (and
    // that is absent from the assembled record set) is stamped `_recordFetchFailure` — a display-only
    // field, like `_status` — so the render appends the deterministic unverified-caveat line to that
    // card and no "verified from the record" style claim survives the join for it. Never a gate,
    // never a verdict change: the finding ships, visibly caveated.
    const failedRegs = (Array.isArray(f?.owner?.registrations) ? f.owner.registrations : [])
      .map((r) => normalizeRecordUri(r?.uri))
      .filter((u) => u && failed.has(u) && !recordsByUri.has(u));
    if (failedRegs.length) {
      f._recordFetchFailure = { uris: [...new Set(failedRegs)], cause: failed.get(failedRegs[0]) };
      flags.push(`official register record for "${f.mark}" could not be retrieved (${failed.get(failedRegs[0])}) — registry details in this card are presented unverified`);
    }
    for (const [name, entry] of Object.entries(f?.meters ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      let status;
      if ((entry.token ?? "unknown") === "unknown") status = "not-checked";
      else if (entry.basis === "inferred-from-signal") status = "inferred";
      else if (entry.basis === "verified-from-record") {
        const src = String(entry.source ?? (name === "use" ? f.use_check?.source : "") ?? "").trim();
        const joined = Boolean(normalizeRecordUri(src)) && recordsByUri.has(normalizeRecordUri(src));
        status = joined ? "confirmed" : "assumed";
        if (!joined) flags.push(`meter "${name}" on "${f.mark}" claims verified-from-record but its source ${src ? `(${src.slice(0, 60)})` : "(none)"} joins no fetch receipt — presented as assumed`);
      } else status = "inferred";
      if (name === "use" && f.use_check?.source) {
        // — THE SEAT'S ATTESTATION DECIDES THE SOURCE CLASS; the host heuristic is the
        // FALLBACK for when it is absent. The old rule read the attestation only for register-mirror
        // and called that "can only DEMOTE" — but owner-site → independent is an UPGRADE in evidential
        // weight, and it happened silently over the seat's correct answer on four of five rows of one
        // delivered report: classifyUseSource needs the full de-suffixed owner token as a contiguous
        // substring of the host, and real brand domains are shorter than corporate names
        // ("propperdocs" is not inside "propperai"). What survives exactly: the register-mirror
        // demotion's precedence — attested OR host-detected, a mirror wins over everything, because
        // that direction can only weaken the evidence.
        const host = /^https?:\/\//i.test(f.use_check.source) ? classifyUseSource(f.use_check.source, f.owner?.name) : null;
        const attested = USE_SOURCE_QUALITY.includes(f.use_check.quality) ? f.use_check.quality : null;
        const mirror = host === "register-mirror" || attested === "register-mirror";
        const cls = mirror ? "register-mirror" : (attested ?? host);
        if (cls) f.meters.use._useSourceClass = cls;
        if (mirror) {
          status = "not-checked";
          flags.push(`use-check on "${f.mark}" cites a register listing (${f.use_check.source.slice(0, 60)}${host === "register-mirror" ? "" : " — model-attested"}) — a register mirror is never evidence of use`);
        }
      }
      entry._status = status;
    }
    // Own-rights sweeps carry the same four-tuple on their cite line: `confirmed` when the source
    // joins a fetch receipt, else `assumed` (a "— no result" negative sweep is the model's own
    // attestation by design, so no integrity flag — the label alone is the honesty).
    if (f?.own_rights && typeof f.own_rights === "object") {
      const uri = normalizeRecordUri(f.own_rights.source);
      f.own_rights._status = uri && recordsByUri.has(uri) ? "confirmed" : "assumed";
    }
  }
  return flags;   // internal integrity-flag lines for the review bar
}

// D2 — provider enforcement telemetry, surfaced as a STRUCTURED aim-attention artifact.
// Corsearch detail records carry `onomaticsAggression` (an enforcement-posture enrichment) and
// `onomaticsOppositions[]` (actual opposition proceedings); no driver code read them before — the
// enforcer meter was purely model-judged. This extractor lifts them into _driver/enforcer-signals.json
// for the synthesis prompt context: a signal AIMS ATTENTION at an owner's enforcement posture, it
// never decides a rating by itself (explicitly NOT the rejected escalation filter). PURE.
export function extractEnforcerSignals(recordsByUri) {
  const out = [];
  for (const [uri, rec] of (recordsByUri ?? new Map())) {
    const aggression = rec?.onomaticsAggression ?? null;
    const oppositions = Array.isArray(rec?.onomaticsOppositions) ? rec.onomaticsOppositions.length : 0;
    if (aggression == null && !oppositions) continue;
    out.push({ uri, owner: REC.owner(rec) || null, aggression, oppositions });
  }
  return out.sort((a, b) => String(a.uri).localeCompare(String(b.uri)));
}

// C2 — the Paris-Convention priority window: an application filed within the last 6
// months (183 days) can be re-filed in other jurisdictions claiming the ORIGINAL filing date, so a
// fresh local filing may backdate globally. Pure date arithmetic; `asOf` is caller-supplied (the
// renderer stays deterministic — no clock in render). Fail-closed to false on any unparseable date.
export function inPriorityWindow(rec, asOf) {
  const app = rec?.applicationDate ?? rec?.application_date ?? null;
  const a = app ? Date.parse(String(app)) : NaN;
  const now = asOf ? Date.parse(String(asOf)) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(now)) return false;
  const days = (now - a) / 86400000;
  return days >= 0 && days <= 183;
}

// Returns [{block, uri, field, claimed, record, kind}] — kind 'mismatch' (claimed ≠ record, both present),
// 'unverified' (identifier claimed, cited record fetched, but the record lacks the field to verify), or
// 'unfetched' (V4-2: the surface cites a record URI with NO record in the run's set — a citation owes its
// record to THIS delivery; the old behavior silently skipped these, which is exactly how a fork shipped
// "Reg. 4349603, renewed 2025" unbound: an empty record set meant ZERO checks, a vacuous pass).
// A block citing NO record URI is out of A1 scope (nothing was claimed against a record).
export function findRegistryViolations(text, recordsByUri) {
  const out = [];
  for (const b of splitBlocks(text)) {
    // headings (incl. the inherited parent card heading) carry the record link — extract over all three
    const head = `${b.parent}\n${b.heading}`;
    const c = extractRegistryClaims(`${head}\n${b.text}`);
    const uris = [...new Set(c.uris)];
    // A block citing ONE record is unambiguous: every literal in it is shown for that record, so its
    // claims pair block-wide exactly as before (this is the same "single" doctrine applyRegistryCorrections
    // already applies, and it keeps every card-shaped block byte-identical). A block citing SEVERAL is
    // ambiguous, and a literal is only judged against a record cited on the heading or in the literal's
    // own claim scope — see splitClaimScopes for the delivery this cost.
    const headClaims = extractRegistryClaims(head);
    const headUris = new Set(headClaims.uris);
    const scopes = uris.length > 1 ? splitClaimScopes(b.text).map((s) => extractRegistryClaims(s.text)) : null;
    const claimsFor = (uri) => {
      if (!scopes) return c;
      const parts = [headClaims, ...scopes.filter((s) => headUris.has(uri) || s.uris.includes(uri))];
      return {
        serials: parts.flatMap((p) => p.serials),
        regNumbers: parts.flatMap((p) => p.regNumbers),
        filingYears: parts.flatMap((p) => p.filingYears),
        regYears: parts.flatMap((p) => p.regYears),
        // STATUS claims scope exactly like the literals above (the residual, audit item 1): the
        // block-wide pool read one bullet's "live and in force" as a claim about every cited record, so
        // a flat list pairing a live claim on one subject with another subject's dead record minted a
        // status mismatch nobody wrote — the same false-lint shape, still reachable for field:status
        // until this.
        claimsLive: parts.some((p) => p.claimsLive),
        claimsDead: parts.some((p) => p.claimsDead),
      };
    };
    for (const uri of uris) {
      const rec = recordsByUri?.get(uri);
      if (!rec) {
        out.push({ block: b.heading, uri, field: "record", claimed: uri, record: null, kind: "unfetched" });
        continue;
      }
      const scoped = claimsFor(uri);
      const cmp = (field, claimedList, recVal, norm = (x) => x) => {
        for (const claimed of claimedList) {
          if (claimed == null || claimed === "") continue;
          if (recVal == null || recVal === "" ) {
            out.push({ block: b.heading, uri, field, claimed, record: null, kind: "unverified" });
          } else if (norm(claimed) !== norm(recVal)) {
            out.push({ block: b.heading, uri, field, claimed, record: recVal, kind: "mismatch" });
          }
        }
      };
      cmp("applicationNumber", scoped.serials, REC.serial(rec));
      cmp("registrationNumber", scoped.regNumbers, REC.regNumber(rec));
      cmp("filingYear", scoped.filingYears, REC.filingYear(rec), String);
      cmp("registrationYear", scoped.regYears, REC.regYear(rec), String);
      if (scoped.claimsLive && !scoped.claimsDead && REC.isDead(rec))
        out.push({ block: b.heading, uri, field: "status", claimed: "live/active", record: REC.statusStr(rec), kind: "mismatch" });
      if (scoped.claimsDead && !scoped.claimsLive && REC.isLive(rec) && !REC.isDead(rec))
        out.push({ block: b.heading, uri, field: "status", claimed: "dead/abandoned", record: REC.statusStr(rec), kind: "mismatch" });
    }
  }
  return out;
}

// ── A1 close-the-loop: deterministic auto-correction from the fetched record (doc-27 Item 1b) ────────────
// The registry-record-match guard already holds the record's TRUE value at the mismatch point, so for
// cleanly-tokenized NUMERIC IDENTIFIERS (registration number, filing/registration date-or-year) the source
// of truth is in hand — overwrite the stated value FROM the record (and log it) instead of asking the model
// to re-type it (the common-law dataplane discipline: keep the LLM out of the verbatim-data path). STATUS
// joined the corrected set (PR-4 compute-don't-author, B4: the 2026-07-28 postmortem run's ONLY gate-closing residual was a
// "dead/abandoned" claim over a record whose fetched body says Valid — exactly the class this closes): a
// status TOKEN in a label/parenthetical position ("Status: Abandoned", "(expired)") is replaced with the
// record's own status text when its live/dead polarity CONTRADICTS the fetched record. Free prose around
// the token is never rewritten (a prose rewrite stays unsafe → flag + redo). A block is
// corrected ONLY when it cites exactly ONE record (no mis-attribution) and only where the record HAS the
// field. Returns {text, corrections:[{block,field,from,to,uri}]}; reconstructs the document verbatim except
// for the replaced literals (heading lines untouched).
function dateCorrection(lit, recDate) {
  const recYear = yearOf(recDate);
  if (recYear == null) return null;                       // record carries no date — nothing to copy from
  const litYear = yearOf(lit);
  if (litYear == null || litYear === recYear) return null; // year already matches (or unreadable) → no edit
  const isFullIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
  return isFullIso(lit) && isFullIso(recDate) ? String(recDate) : String(recYear);
}

export function applyRegistryCorrections(text, recordsByUri) {
  const src = String(text ?? "");
  if (!src || !recordsByUri?.size) return { text: src, corrections: [] };
  const corrections = [];
  const headingRe = /^(#{2,3})[ \t]+.*$/gm;
  const marks = [];
  let h;
  while ((h = headingRe.exec(src))) marks.push({ idx: h.index, end: headingRe.lastIndex, level: h[1].length, line: h[0] });

  const correctBody = (body, headLine, parentTitle) => {
    const uris = [...new Set((`${parentTitle}\n${headLine}\n${body}`.match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9-]*/gi) || [])
      .map((u) => u.toLowerCase().replace(/-$/, "")))];
    const recUris = uris.filter((u) => recordsByUri.get(u));
    if (recUris.length === 0) return body;               // out of A1 scope — nothing cites a fetched record
    const headTitle = headLine.replace(/^#{2,3}[ \t]+/, "").trim() || "(preamble)";
    // The SINGLE-record block: the cited record is the unambiguous source for every literal (unchanged path).
    // CHANGE 5a — a MULTI-record block no longer early-returns. For each literal we attribute it to AT MOST ONE
    // cited record by the field's own discriminator (a reg number by era window; a date/year by year proximity).
    // Attribution must be UNIQUE: exactly one cited record can own the literal, else we leave it untouched and
    // let the per-record STRUCTURED render (fullDetail, bound from the record via REC) be the source of truth —
    // never risk a mis-attribution by guessing. The single-record path is preserved EXACTLY: when there is one
    // cited record `single` owns every literal (the attribute() discriminator is skipped), so a one-record
    // block behaves byte-for-byte as before CHANGE 5a.
    const recs = recUris.map((u) => ({ uri: u, rec: recordsByUri.get(u) }));
    const single = recs.length === 1 ? recs[0] : null;
    // The status corrector must never be BROADER than the detector that justifies it (review issue 1).
    // findRegistryViolations deliberately suppresses MIXED blocks (claimsDead && claimsLive — a block
    // that truthfully narrates both polarities, "Status: Live … an earlier application for the mark
    // (abandoned) was refiled", is prosecution history, not a mismatch), so a mixed block's status
    // tokens are never rewritten here either: overwriting the true "(abandoned)" with the live record's
    // status text would turn a true statement false, silently. Same claim-extraction as the detector
    // (parent + heading + body), so corrector and gate agree on which blocks are in scope. Dates and
    // numbers keep correcting — they carry their own per-literal label anchors + per-record attribution.
    const blockClaims = extractRegistryClaims(`${parentTitle}\n${headLine}\n${body}`);
    const statusMixed = blockClaims.claimsDead && blockClaims.claimsLive;
    let out = body;
    // The CORRECTOR must never reach further than the detector (the invariant stated above, applied to
    // dates and numbers too): findRegistryViolations now judges a literal in a multi-record block only
    // against records cited on the heading or in the literal's OWN claim scope, so attribution here is
    // offered the same candidates. Without this a bullet about someone else's filing could be silently
    // rewritten — turning a true statement false — with no gate failure to justify the edit. Scopes are
    // recomputed from the CURRENT text inside each pass so the offsets `replace` reports stay aligned
    // after an earlier pass changed a literal's length. Single-record blocks skip all of it, unchanged.
    const headUrisC = new Set((`${parentTitle}\n${headLine}`.match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9-]*/gi) || [])
      .map((u) => u.toLowerCase().replace(/-$/, "")));
    // replaceLiteral applies decideValue from the literal's owning record: `single` when one record is cited,
    // else the attribute() discriminator returns { rec, uri } when EXACTLY ONE cited record can own it, else null.
    const replaceLiteral = (re, field, decideValue, attribute) => {
      const scopes = single ? null : splitClaimScopes(out);
      const recsAt = (offset) => {
        if (!scopes) return recs;
        const s = scopes.find((x) => offset >= x.start && offset < x.end) ?? scopes[scopes.length - 1];
        const inScope = new Set((s.text.match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9-]*/gi) || [])
          .map((u) => u.toLowerCase().replace(/-$/, "")));
        return recs.filter((r) => headUrisC.has(r.uri) || inScope.has(r.uri));
      };
      out = out.replace(re, (full, lit, offset) => {
        const owner = single || attribute(lit, recsAt(offset));
        if (!owner) return full;                          // ambiguous in a multi-record block → leave it
        const want = decideValue(lit, owner.rec);
        if (want == null || want === lit) return full;
        corrections.push({ block: headTitle, field, from: lit, to: want, uri: owner.uri });
        // replace the captured value at its ACTUAL position — the value sits at the END of these
        // label+value patterns, so the LAST occurrence is the captured one; never a same-digits substring
        // inside the label prefix (the "Reg123 No. 999" failure class).
        const idx = full.lastIndexOf(lit);
        return idx === -1 ? full : full.slice(0, idx) + want + full.slice(idx + lit.length);
      });
    };
    // attribute a reg-number literal: the unique cited record whose reg-number ERA window contains the literal's
    // implied era (regNumberDateWindow). A literal that already equals a record's digits is attributed to that
    // record (a no-op correction, but it keeps the era branch from mis-claiming an already-correct number).
    const attributeRegNumber = (lit, cands) => {
      const d = digits(lit);
      const exact = cands.filter((x) => d && digits(x.rec.registrationNumber ?? x.rec.onomaticsRegistrationNumber) === d);
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return null;                  // two records carry the same number — ambiguous
      const litW = regNumberDateWindow(d);
      if (!litW) return null;                             // no era for the literal → can't attribute
      const hit = cands.filter((x) => {
        const rd = digits(x.rec.registrationNumber ?? x.rec.onomaticsRegistrationNumber);
        const rw = rd ? regNumberDateWindow(rd) : null;
        return rw && rw.lo <= litW.hi && litW.lo <= rw.hi;  // era windows overlap
      });
      return hit.length === 1 ? hit[0] : null;
    };
    // attribute a date/year literal: the unique cited record whose target date-year equals the literal's year,
    // else (no exact-year match) the unique record whose target year is within ±1 of the literal's year.
    const attributeDate = (recField) => (lit, cands) => {
      const ly = yearOf(lit);
      if (ly == null) return null;
      const exact = cands.filter((x) => yearOf(x.rec[recField]) === ly);
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return null;
      const near = cands.filter((x) => { const ry = yearOf(x.rec[recField]); return ry != null && Math.abs(ry - ly) <= 1; });
      return near.length === 1 ? near[0] : null;
    };
    // registration number — reformat the record's canonical digits to the literal's grouping style
    replaceLiteral(/\bReg(?:istration)?\.?\s*(?:No\.?|Number|#)?\s*:?\s*([0-9][\d,.]{5,9})\b/gi, "registrationNumber",
      (lit, r) => {
        const recDigits = digits(r.registrationNumber ?? r.onomaticsRegistrationNumber);
        if (!recDigits || digits(lit) === recDigits) return null;
        return /[,.]/.test(lit) ? recDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : recDigits;
      }, attributeRegNumber);
    // filing date/year
    replaceLiteral(/\b(?:filed|filing date|application date)[:\s]+(?:on\s+)?((?:19|20)\d{2}(?:-\d{2}-\d{2})?)/gi, "filingDate",
      (lit, r) => dateCorrection(lit, r.applicationDate), attributeDate("applicationDate"));
    // registration date/year (both claim shapes the extractor recognises)
    replaceLiteral(/\bregist(?:ered|ration)(?:\s+date)?[:\s,]+(?:in\s+)?((?:19|20)\d{2}(?:-\d{2}-\d{2})?)/gi, "registrationDate",
      (lit, r) => dateCorrection(lit, r.registrationDate), attributeDate("registrationDate"));
    replaceLiteral(/\b((?:19|20)\d{2})\s+registration\b/gi, "registrationDate",
      (lit, r) => dateCorrection(lit, r.registrationDate), attributeDate("registrationDate"));
    // status (PR-4) — ONLY cleanly-tokenized positions (a label cell / a bare parenthetical), only when
    // the token's polarity contradicts the fetched record, and only single-record blocks (status has no
    // per-record discriminator, so multi-record attribution is never guessed — the attribute fn is null).
    // The replacement is the record's OWN status text (REC.statusStr — what findRegistryViolations would
    // report), so the corrected surface and the registry-record-match gate agree by construction.
    const statusCorrection = (lit, r) => {
      const tok = String(lit).trim().toLowerCase();
      const claimsDead = /^(?:abandoned|cancelled|canceled|expired|dead|lapsed)$/.test(tok);
      const claimsLive = /^(?:live|active|in force)$/.test(tok);
      if (!claimsDead && !claimsLive) return null;
      const truth = String(REC.statusStr(r)).replace(/\s+/g, " ").trim().slice(0, 40);
      if (!truth) return null;                               // record carries no status text — nothing to copy from
      if (claimsDead && REC.isLive(r) && !REC.isDead(r)) return truth;
      if (claimsLive && REC.isDead(r)) return truth;
      return null;                                           // polarity agrees (or is undecidable) → no edit
    };
    if (!statusMixed) {
      replaceLiteral(/\b(?:status|current status|register status)\b[:*\s]{1,6}((?:live|active|in force|abandoned|cancelled|canceled|expired|dead|lapsed))\b/gi,
        "status", statusCorrection, () => null);
      // Bare parenthetical — ONLY when anchored to a registry noun/identifier on the same line
      // ("Reg. No. 4,641,314 (expired)", "the registration (abandoned)", "/mark/us/123 (dead)").
      // An UNANCHORED "(expired)" can truthfully describe a non-record subject — "the matching .com
      // domain (expired)" — and rewriting it from the cited record would fabricate a false statement;
      // unanchored parentheticals stay registry-record-match flag + redo territory (review issue 1).
      replaceLiteral(/(?:\bReg(?:istration)?\.?\s*(?:No\.?|Number|#)?\s*:?\s*[0-9][\d,.]{5,9}|\b(?:registration|application|filing|serial|record|trademark|mark)\b|\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*)[^()\n]{0,40}\(\s*((?:live|active|in force|abandoned|cancelled|canceled|expired|dead|lapsed))\s*\)/gi,
        "status", statusCorrection, () => null);
    }
    return out;
  };

  let out = "";
  let parentTitle = "";
  const firstIdx = marks.length ? marks[0].idx : src.length;
  out += correctBody(src.slice(0, firstIdx), "", "");    // preamble
  let cursor = firstIdx;
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    if (cur.level === 2) parentTitle = cur.line.replace(/^#{2,3}[ \t]+/, "").trim();
    const bodyEnd = i + 1 < marks.length ? marks[i + 1].idx : src.length;
    out += src.slice(cursor, cur.end);                   // the heading line, verbatim
    out += correctBody(src.slice(cur.end, bodyEnd), cur.line, cur.level === 3 ? parentTitle : "");
    cursor = bodyEnd;
  }
  return { text: out, corrections };
}

// ── doc-31 Tier-2: bind findings.json registration fields from the fetched record (the data layer) ───────
// The renderer already prefers the record at display time, but the AUDIT (xlsx) and the persisted findings.json
// read the model's structured fields directly. This binds them deterministically from the record set so NO
// delivery artifact carries a model-typed/​invented class/status/date/owner. Mutates `findings` in place and
// returns the bindings (for the log). When the run has NO record set (recordsByUri empty) it is a NO-OP — the
// back-compat path trusts the model's fields (archived/replay runs without a record set must not be blanked).
//   • a registration whose URI matches a record → fields overwritten from the record;
//   • a registration cited but NOT in the set (run has records) → fields nulled (NEVER-INVENT, mirrors render);
//   • owner.name → the record's proprietor (first matched registration that carries one).
const recClasses = (rec) => {
  const c = Array.isArray(rec.classList) ? rec.classList : (Array.isArray(rec.niceClasses) ? rec.niceClasses : null);
  return c ? c.map((x) => String(x)) : null;
};
/**
 * WHICH owner name a delivery artifact SHOWS. ONE definition, deliberately, because the renderer
 * and bindFindingsToRecords each resolve the owner independently — publish/render.mjs does its own
 * record lookup and preferred the record outright, so binding the finding alone changed no heading and
 * no lint surface. A second copy of the same decision is how 's provider default survived two fixes.
 *
 * The record decides, not a guess about what "looks romanised": a record carrying BOTH a Latin name and
 * a native-script one is itself saying the Latin field is a transliteration, and only then does a
 * rendering the run resolved beat it. Everywhere else the register's own string wins, unchanged.
 *
 * Idempotent — feeding it an already-chosen name returns that name, which is what lets render call it
 * after bindFindingsToRecords has already run.
 */
export function ownerDisplayName({ raw, native, resolved }) {
  const R = String(raw ?? "").trim();
  const N = String(native ?? "").trim();
  const S = String(resolved ?? "").trim();
  if (R && N && S) return S;
  return R || S || "";
}

export function bindFindingsToRecords(findings, recordsByUri) {
  const bound = [];
  if (!Array.isArray(findings) || !recordsByUri || recordsByUri.size === 0) return bound;
  for (const f of findings) {
    const regs = f.owner?.registrations || [];
    let ownerFromRecord = null;
    let ownerNativeFromRecord = null;
    for (const r of regs) {
      if (!r || typeof r !== "object") continue;
      const rec = r.uri ? recordsByUri.get(String(r.uri).toLowerCase()) : null;
      if (rec) {
        const cls = recClasses(rec); if (cls) r.classes = cls;
        const st = REC.statusStr(rec); r.status = st || null;
        r.filed = rec.applicationDate ?? null;
        r.expiry = rec.expiryDate ?? null;
        if (rec.jurisdiction) r.jurisdiction = rec.jurisdiction;
        if (!ownerFromRecord) ownerFromRecord = REC.owner(rec) || null;
        if (!ownerNativeFromRecord) ownerNativeFromRecord = REC.ownerNative(rec) || null;
        bound.push({ uri: r.uri, source: "record" });
      } else if (r.uri) {
        // never-invent at the data layer: cited, not fetched, but the run HAS a record set ⇒ drop model fields.
        // The PENDING/registered distinction is snapshotted FIRST as a display-only hint (_wasPending):
        // nulling the status made the landscape plot a Pending application in the solid registered style
        // while its own card said 'Pending' — the dot ENCODING is presentation, not an asserted fact,
        // so it may survive the null (the card's asserted status stays honestly absent).
        if (/pending|application|app\.?|non-final/i.test(String(r.status || ''))) r._wasPending = true;
        r.classes = []; r.status = null; r.filed = null; r.expiry = null;
        bound.push({ uri: r.uri, source: "unverified" });
      }
    }
    // ── the owner's name: one asserted fact, one presentation choice ──────────────────────────
    //
    // doc-31 step 4 binds owner.name from the record so a model-typed variant ("Lo.Li. Pharma
    // International" for a record that says "Lo.Li. Pharma S.r.l.") never becomes the card's owner. That
    // still holds, and the test that pins it is unchanged.
    //
    // What it got wrong is the CJK case. The provider's Latin field is a ROMANISATION there — for a
    // Chinese proprietor, character-by-character pinyin — so binding it produced a client-facing section
    // heading of eleven lowercase syllables, while the narrative one file away had the company's proper
    // English name. Worse, the action list used the readable name, `reference-integrity` looked for that
    // party among the carded findings, found only the pinyin, could not join them, and reported that no
    // finding card identified them. It did. The check was right about the strings and wrong about the
    // world, and the client was shown an amber banner for a defect that did not exist.
    //
    // The record itself says which case it is. A record that carries BOTH a Latin name and a native-script
    // one is telling us the Latin field is a transliteration — exactly the distinction the record already
    // draws for the MARK (markTransliteration). So:
    //
    //   nameRaw     always the record's own string. The asserted fact, never model-typed, never lost.
    //   nameNative  the original script, when the record distinguishes it.
    //   name        the record's string — UNLESS the record is a romanisation case AND the run resolved
    //               a rendering, in which case the resolved one is kept and the raw rides alongside.
    //
    // A display name is presentation, which is the same line this function already draws ten lines up,
    // where the pending/registered ENCODING survives the never-invent nulling and the asserted status
    // does not. Nothing is lost either way: nameRaw carries the register's truth in every case.
    if (f.owner && typeof f.owner === "object") {
      if (ownerFromRecord) f.owner.nameRaw = ownerFromRecord;
      if (ownerNativeFromRecord) f.owner.nameNative = ownerNativeFromRecord;
      const shown = ownerDisplayName({ raw: ownerFromRecord, native: ownerNativeFromRecord, resolved: f.owner.name });
      if (shown) f.owner.name = shown;
    }
  }
  return bound;
}

// ── arithmetic family (document-only; GROSS violations, generous tolerance) ─────────────────────────────
// Anchors verified 2026-06-10 against live sources:
//   serial series start dates — TMEP §402-403 (uspto.gov);
//   Reg 4,000,000 → 2011-07-19; Reg 5,000,000 → 2016-06; Reg 6,000,000 → 2020-03-03 (USPTO milestones).
// Beyond the last anchor we extrapolate at ~300k regs/year with widened tolerance.

const SERIES_START = {
  72: "1956-01-03", 73: "1973-09-04", 74: "1989-11-16", 75: "1995-10-01", 76: "2000-03-20",
  78: "2002-10-01", 77: "2006-09-14", 79: "2003-11-02", 85: "2010-04-01", 86: "2013-07-01",
  87: "2016-04-13", 88: "2018-06-14", 90: "2020-06-13", 97: "2021-08-28", 98: "2023-05-17", 99: "2025-01-16",
};
// e-filing chain: a series' filings end when the next e-series starts (legacy/paper series have no upper bound).
const E_CHAIN = [85, 86, 87, 88, 90, 97, 98, 99];

const REG_ANCHORS = [
  [4000000, Date.UTC(2011, 6, 19)],
  [5000000, Date.UTC(2016, 5, 14)],
  [6000000, Date.UTC(2020, 2, 3)],
];
const MS_YEAR = 365.25 * 24 * 3600 * 1000;
const TOL_MS = 1.25 * MS_YEAR;          // ±15 months between anchors
const TOL_BEYOND_MS = 2 * MS_YEAR;      // ±24 months beyond the last anchor (extrapolated)

export function regNumberDateWindow(regNo) {
  const n = Number(digits(regNo));
  if (!n || n < REG_ANCHORS[0][0]) return null;          // pre-2011 numbers: era table not maintained — skip
  const last = REG_ANCHORS[REG_ANCHORS.length - 1];
  if (n > last[0] + 1500000) return null;                // far beyond extrapolation confidence — skip
  let est, tol;
  if (n <= last[0]) {
    for (let i = 1; i < REG_ANCHORS.length; i++) {
      const [n0, t0] = REG_ANCHORS[i - 1], [n1, t1] = REG_ANCHORS[i];
      if (n <= n1) { est = t0 + ((n - n0) / (n1 - n0)) * (t1 - t0); tol = TOL_MS; break; }
    }
  } else {
    est = last[1] + ((n - last[0]) / 300000) * MS_YEAR; tol = TOL_BEYOND_MS;
  }
  return { lo: est - tol, hi: est + tol };
}

export function serialSeriesWindow(serial) {
  const d = digits(serial);
  if (d.length !== 8) return null;
  const series = Number(d.slice(0, 2));
  const start = SERIES_START[series];
  if (!start) return null;
  const lo = Date.parse(start) - 90 * 24 * 3600 * 1000;
  const i = E_CHAIN.indexOf(series);
  const next = i >= 0 && i < E_CHAIN.length - 1 ? SERIES_START[E_CHAIN[i + 1]] : null;
  const hi = next ? Date.parse(next) + 120 * 24 * 3600 * 1000 : null;
  return { series, lo, hi, startYear: new Date(Date.parse(start)).getUTCFullYear() };
}

// Renewal/expiry cycles: a US registration renews at year 10, 20, 30 … (±18-month combined window/grace).
function cycleOk(eventYear, regYear) {
  const d = eventYear - regYear;
  if (d <= 0) return false;
  const r = ((d % 10) + 10) % 10;
  return r <= 1.5 || r >= 8.5;
}

// Owner-tied registration-year claims made OUTSIDE a finding's own block ("…predating High 5 Games'
// 2013 registration" in the actions). The real TMP8552 report split the claims this way — the reg
// number + renewal sat in the finding card, the registration YEAR in an actions bullet tied only by
// the owner's name — so cycle arithmetic must merge them by owner or it misses the documented case.
function ownerRegYearClaims(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/([A-Z][A-Za-z0-9&.,' ]{2,40}?)'s?\s+((?:19|20)\d{2})\s+registration/g)) {
    const owner = m[1].replace(/^(the|of|by|to|from|with)\s+/i, "").trim();
    if (owner.length >= 4) out.push({ owner, year: Number(m[2]) });
  }
  return out;
}

// Pure, document-only arithmetic issues: [{block, check, detail}]. Year-only claims are judged at their
// most favorable month — only impossible-on-any-reading pairings flag.
export function findRegistryArithmeticIssues(text) {
  const out = [];
  const seen = new Set();
  const push = (row) => { const k = `${row.block}|${row.check}|${row.detail}`; if (!seen.has(k)) { seen.add(k); out.push(row); } };
  const ownerYears = ownerRegYearClaims(text);
  for (const b of splitBlocks(text)) {
    // Same claim scoping as findRegistryViolations — INCLUDING its single-record gate (audit item 2).
    // Two years pair only when they are stated about the same subject: a flat list of independent items
    // no longer reads one item's registration year against another item's filing year (the "registration
    // 2004 before filing 2026" false-lint — two correct dates, two different owners, one heading).
    // But a block citing EXACTLY ONE record is unambiguous — one card,
    // one subject, every literal in it is "shown for" that subject — so its whole body stays ONE scope,
    // exactly as findRegistryViolations pools it. Splitting those too (the first cut of this scoping)
    // silently dropped every single-subject cross-bullet check: a card stating "registered 2013" in one
    // bullet and "renewed 2019" in another no longer flagged the impossible cycle. A ZERO-record block
    // (bare prose, e.g. an actions list naming several parties' dates with no /mark/ citations) must
    // SPLIT, not pool: unlike findRegistryViolations, the arithmetic checks fire on bare prose, and
    // pooling minted "registration 2004 before filing 2026" across two different owners' bullets —
    // the exact false-lint class this scoping exists to kill.
    const uriCount = [...new Set(extractRegistryClaims(`${b.parent}\n${b.heading}\n${b.text}`).uris)].length;
    const multiRecord = uriCount !== 1;
    for (const scope of (multiRecord ? splitClaimScopes(b.text) : [{ text: b.text }])) {
    const c = extractRegistryClaims(`${b.parent}\n${b.heading}\n${scope.text}`);
    // adopt an owner-tied registration year stated elsewhere in the SAME document when this block (or
    // its parent card heading) names that owner and carries no registration year of its own
    if (!c.regYears.some((y) => y != null)) {
      const head = `${b.parent} ${b.heading}`.toLowerCase();
      const tied = ownerYears.find((o) => head.includes(o.owner.toLowerCase()));
      if (tied) c.regYears = [tied.year];
    }
    const serialsAll = c.serials.concat(c.uris.filter((u) => /^\/mark\/us\//.test(u)).map((u) => digits(u.split("/").pop())));
    const sw = serialsAll.map(serialSeriesWindow).find(Boolean) ?? null;
    const regYear = c.regYears.find((y) => y != null) ?? null;
    const filingYear = c.filingYears.find((y) => y != null) ?? null;

    if (sw && filingYear != null && filingYear < sw.startYear)
      push({ block: b.heading, check: "serial-vs-filing", detail: `claimed filing ${filingYear} predates serial series ${sw.series} (starts ${sw.startYear})` });
    if (sw && regYear != null && regYear < sw.startYear)
      push({ block: b.heading, check: "serial-vs-registration", detail: `claimed registration ${regYear} predates serial series ${sw.series} (starts ${sw.startYear}) — a registration cannot predate its own application` });
    if (regYear != null && filingYear != null && regYear < filingYear)
      push({ block: b.heading, check: "filing-before-registration", detail: `claimed registration ${regYear} before claimed filing ${filingYear}` });
    for (const rn of c.regNumbers) {
      const w = regNumberDateWindow(rn);
      if (w && regYear != null) {
        const yLo = new Date(w.lo).getUTCFullYear(), yHi = new Date(w.hi).getUTCFullYear();
        if (regYear < yLo || regYear > yHi)
          push({ block: b.heading, check: "regnumber-era", detail: `registration number ${rn} issues ~${new Date((w.lo + w.hi) / 2).getUTCFullYear()} (±); claimed registration year ${regYear} is outside [${yLo}, ${yHi}]` });
      }
    }
    if (regYear != null) {
      // THE TERM DOES NOT RUN FROM REGISTRATION EVERYWHERE (2026-07-29). Anchoring the cycle only on the
      // registration year is the US convention. The Paris/TRIPS norm — and what South Africa, Panama and
      // most national registers actually do — is TEN YEARS FROM FILING, with registration landing
      // somewhere in between. Two live records from the 2026-07-28 worldwide run, both correct and both
      // failed by the old rule:
      //   ZA SUPA STICKY  filed 2023-07-12  registered 2025-04-23  expires 2033-07-12  (filing +10)
      //   PA TAKIS        filed 2023-10-19  registered 2025-04-16  expires 2033-10-19  (filing +10)
      // It blocked delivery of a finished report — "expiry 2033 is not a 10-year cycle from claimed
      // registration 2025" — over data that was right. So the cycle may anchor on EITHER year when both
      // are stated; an expiry that fits neither is still a real arithmetic fault and still fails.
      const cycleOkEither = (y) => cycleOk(y, regYear) || (filingYear != null && cycleOk(y, filingYear));
      const anchors = filingYear != null ? `registration ${regYear} or filing ${filingYear}` : `registration ${regYear}`;
      for (const ry of c.renewalYears) if (ry != null && !cycleOkEither(ry))
        push({ block: b.heading, check: "renewal-cycle", detail: `renewal ${ry} is not a 10-year cycle from ${anchors} (renewals fall at +10/+20/… ±grace)` });
      for (const ey of c.expiryYears) if (ey != null && !cycleOkEither(ey))
        push({ block: b.heading, check: "expiry-cycle", detail: `expiry ${ey} is not a 10-year cycle from ${anchors}` });
    }
    }
  }
  return out;
}
