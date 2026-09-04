// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// provider-usage.mjs — roll up the shared REGISTER per-call ledger into per-run, billing-grade counts.
//
// Not a Corsearch ledger, and never was: whichever ONE register provider is wired — corsearch,
// clarivate, signa, euipo, uspto-local — appends to this same file through providers/_shared/ledger.mjs,
// and every row carries a `provider` discriminator saying which. It wore one vendor's name because that
// vendor wrote to it first. Where the file lives, and why an existing vendor-named one is still read,
// is settled in providers/_shared/ledger-path.mjs.
//
// The plugin chokepoint appends one JSONL line per billable API call. Each line:
//   { ts, agentId, sessionKey, sessionId, tool, target, http_status, ok, attempts, took_ms, bytes, cache_hit }
// where sessionKey/sessionId are the GATEWAY ids (the driver's per-stage --session-key), NOT the secret.
//
// This module is read-only and defensive: a missing/unreadable ledger or a torn last line (two gateway
// turns appending concurrently) returns zeros / skips that line — it never throws. The driver calls it at
// publish time to attribute THIS run's calls by the session-key prefix `prelim-<slug>-<codename>-`.

import { readFileSync, existsSync } from "node:fs";
// Aliased: three functions below take a parameter literally named `ledgerPath`, and an unaliased
// import would be shadowed by it inside its own default-value expression (a TDZ ReferenceError
// at the first call, not at load).
import { ledgerPath as resolveLedgerPath } from "../providers/_shared/ledger-path.mjs";

// — the neutral name, through the ONE resolver the writer also uses (which is what stops a
// driver-reads-new / plugin-writes-old split). Still frozen at import, as it always was: pipeline.mjs
// imports this const and passes it explicitly, and the only transition a freeze could miss is "a
// legacy-named ledger appeared after import" — which nothing creates any more. Every call-time site
// below still resolves per call, because tests re-point the env after import.
export const DEFAULT_LEDGER_PATH = resolveLedgerPath("call");

// AD-4 (2026-07-30 addendum, instrumentation house rule): this list is a CONVENIENCE projection, not the
// truth. The R2 evidence run tallied search:0 against total:286 because its calls all rode tool names this
// list had fallen behind on (`execute_plan` — the plan executor logs its internal searches under its own
// kind) — a "0" that meant "not classified", indistinguishable from "no searches happened". Two rules now
// hold: (1) the list carries every kind the MCP servers currently stamp (see driver/engine/mcp/*-server.mjs
// tctx(<kind>)); (2) falling behind again can no longer hide — every row's tool name lands in `by_tool`
// unconditionally, and a name outside this list increments `unclassified` instead of vanishing into `total`.
//: EXPORTED so the list can be checked against the servers that actually stamp these names
// (provider-usage.test.mjs scrapes `tctx("<kind>")` out of driver/engine/mcp/*-server.mjs). Rule (1)
// above — "the list carries every kind the MCP servers currently stamp" — was prose until then: nothing
// failed when a server gained a kind, and the only signal was an `unclassified` count on a run that had
// already been paid for. The reverse direction is NOT asserted: KINDS is the UNION across providers and
// only one register provider is wired per run, so entries with no stamp site under the active provider
// are expected, not drift.
export const KINDS = ["search", "record_fetch", "image", "phoneme", "batch_screen", "enumerate", "execute_plan", "propose_supplemental"];

// The gateway namespaces the driver's --session-key as `agent:<agentId>:<key>` before it reaches the
// plugin (confirmed on the first live run: sessionKey = `agent:clawdi:prelim-<slug>-<codename>-…`). Strip
// that leading `agent:<id>:` namespace so the run prefix anchors at the real start of the caller's key —
// otherwise a bare startsWith("prelim-…") matches nothing.
function stripGatewayNs(s) {
  return typeof s === "string" ? s.replace(/^agent:[^:]+:/, "") : "";
}

// Does this ledger row belong to the run identified by `runPrefix`? The driver's --session-key is
// `prelim-<slug>-<codename>-<stage><axis>` (+ optional `-rerunN`), so a prefix match catches every stage +
// axis + retry of the run. We check sessionKey (carries the key) and, defensively, sessionId.
function rowMatchesRun(row, runPrefix) {
  return stripGatewayNs(row.sessionKey).startsWith(runPrefix)
      || stripGatewayNs(row.sessionId).startsWith(runPrefix);
}

// ── band-truth gate (2026-07-14, teal-foundry): count the ledger rows attributed to ONE unit lane ──────
// A register unit whose band carries qid-stamped blocks but whose lane logged ZERO rows here never called
// the provider — the band was AUTHORED, not executed (the fabrication that shipped ashen-causeway 07-06,
// teal-lattice 07-07 and teal-foundry 07-13). This ledger is code-written at the plugin chokepoint,
// outside the model's reach, so it is the ground truth the fan-in gate judges bands against.
// SUBSTRING match (not prefix): the lane's session-key variants (-fbN fallback, -taint-rerun-N,
// -plan-join-fresh, the gateway's `agent:<id>:` namespace) all carry the base lane key inside them.
// Returns null when the ledger file is absent/unreadable — the gate cannot judge and must skip, never
// guess (hermetic tests and fresh installs have no ledger; production has appended here since 2026-06-07).
// env read at CALL time (default-param expression), matching assembleRunRecords — tests re-point the path.
export function countLaneCalls(laneSubstr,
  // ONE resolver, which keeps homedir per call rather than a literal home: a hardcoded
  // /home/operator here read a DIFFERENT path than the homedir-based DEFAULT_LEDGER_PATH above under
  // any other service account — silently splitting the billing-grade ledger. (Still a call-time
  // expression, NOT DEFAULT_LEDGER_PATH: that const freezes at import, and tests re-point the env after
  // import.)
  ledgerPath = resolveLedgerPath("call")) {
  if (!laneSubstr || !existsSync(ledgerPath)) return null;
  let raw;
  try { raw = readFileSync(ledgerPath, "utf8"); } catch { return null; }
  let n = 0;
  for (const line of raw.split("\n")) {
    if (!line.includes(laneSubstr)) continue;   // cheap pre-filter — parse only candidate lines
    try {
      const row = JSON.parse(line);
      if (stripGatewayNs(row.sessionKey).includes(laneSubstr) || stripGatewayNs(row.sessionId).includes(laneSubstr)) n++;
    } catch { /* torn concurrent append — skip the line, never throw */ }
  }
  return n;
}

// The run-identity of a row, for the same/cross-session duplicate breakdown (prefer the gateway session
// key, fall back to sessionId). Two rows with the same value came from the same gateway turn/axis.
function rowSession(row) {
  return (typeof row.sessionKey === "string" && row.sessionKey)
      || (typeof row.sessionId === "string" && row.sessionId)
      || "";
}

function emptyTally() {
  return {
    // — DERIVED from KINDS, not re-typed beside it. These eight counters were a second hand-written
    // copy of the same eight names, and the two were coupled silently: `out[row.tool]++` on a kind added
    // to KINDS but forgotten here is `undefined++` → NaN → `null` once status.json is stringified, while
    // `unclassified` stays 0 because KINDS.includes() passed. The module's own drift tripwire could not
    // fire on the module's own drift. One list, so the pair cannot disagree.
    ...Object.fromEntries(KINDS.map((k) => [k, 0])),
    total: 0,
    // AD-4 house rule: the COMPLETE per-tool-name census, written unconditionally. `by_tool` records every
    // tool value the ledger carried (a row with no tool name lands under "(none)"); `unclassified` counts
    // rows whose name is outside KINDS — so "this kind was never called" (a genuine 0 above) can never be
    // confused with "the ledger used a name this module doesn't know" again.
    by_tool: {},
    unclassified: 0,
    // …and the PROVENANCE of the zeros above. Same house rule, the last place in this module still broken
    // by it: a ledger that is missing, mis-pointed or unreadable returned a clean all-zero tally that was
    // indistinguishable from "the run made no provider calls", and the note line printed `total=0 ((none))`
    // — which reads like a measurement. These four facts are different and are now recorded as different:
    //   configured  — a ledger path was supplied at all (CLEAROTRON_REGISTER_CALL_LOG / the default)
    //   present     — that path exists on disk
    //   readable    — it could actually be read (permissions, a vanished file, an IO fault)
    //   rowsScanned — how many non-blank lines were examined BEFORE the run-prefix filter; 0 here with
    //                 readable:true means the ledger is genuinely empty, not that this run missed it
    // A tally with rowsScanned > 0 and total 0 is a real "this run made no calls"; anything else is "not
    // measured", and the pre-flight/greenlight check is `present:true` before a run starts.
    //
    // NO `path` HERE, deliberately. The tally rides status.json (writeRunStatus providerUsage) and is
    // returned wholesale by the MCP's get_provider_usage / trace_run — and the default path is a service
    // account's home directory plus a vendor filename. The four booleans carry the entire diagnosis; the
    // path itself belongs on the driver's stderr note, which is internal by construction.
    ledger: { configured: false, present: false, readable: false, rowsScanned: 0 },
    retries: 0,            // Σ max(0, attempts-1) — wasted retry calls
    errors: 0,             // calls that returned ok:false (incl. transport throws → http_status 0)
    cache_hits: 0,         // calls served from a dedup cache (0 until Workstream B ships)
    bytes: 0,              // total response bytes (proxy for payload cost)
    // The dedup opportunity, split so Workstream B's scope is decided from data, not guessed:
    duplicate_fetches: 0,               // record_fetch on a URI already fetched this run (real network ones)
    duplicate_fetches_same_session: 0,  // …by the SAME axis/turn — cleanly cacheable at the plugin now
    duplicate_fetches_cross_session: 0, // …across axes/stages — needs run-id plumbing to dedup safely
  };
}

/**
 * Tally every ledger line whose gateway id starts with `runPrefix`.
 * @param {string} ledgerPath  path to the JSONL ledger
 * @param {string} runPrefix   e.g. `prelim-acme-bluejay-` (note the trailing hyphen)
 * @returns {object} the tally (see emptyTally) — never throws
 */
export function tallyRegisterCalls(ledgerPath = DEFAULT_LEDGER_PATH, runPrefix) {
  const out = emptyTally();
  // Each early return below leaves a DIFFERENT ledger provenance behind, so the zeros are never mute.
  out.ledger.configured = Boolean(ledgerPath);
  if (!ledgerPath || !runPrefix) return out;              // nothing to look at / no run to attribute to
  if (!existsSync(ledgerPath)) return out;                // configured and NOT there — the mis-pointed case
  out.ledger.present = true;

  let text;
  try { text = readFileSync(ledgerPath, "utf8"); } catch { return out; }   // there but unreadable
  out.ledger.readable = true;

  const firstFetchSession = new Map(); // record_fetch target → the session that first (network-)fetched it

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    out.ledger.rowsScanned++;          // counted BEFORE the run-prefix filter: "the ledger had traffic,
                                       // none of it this run" is a different fact from "empty ledger"
    let row;
    try { row = JSON.parse(line); } catch { continue; } // tolerate a torn concurrent-append line
    if (!rowMatchesRun(row, runPrefix)) continue;

    out.total++;
    out.bytes += Number(row.bytes) || 0;
    if (Number(row.attempts) > 1) out.retries += Number(row.attempts) - 1;
    if (row.ok === false) out.errors++;
    const isCacheHit = row.cache_hit === true;
    if (isCacheHit) out.cache_hits++;

    const toolName = typeof row.tool === "string" && row.tool ? row.tool : "(none)";
    out.by_tool[toolName] = (out.by_tool[toolName] ?? 0) + 1;
    if (KINDS.includes(row.tool)) out[row.tool]++;
    else out.unclassified++;

    // Duplicate detail-fetches = the Workstream-B opportunity. Count only REAL network fetches (a cache
    // hit is already a saved duplicate, not a new one). First network fetch of a URI seeds the map; any
    // later network fetch of the same URI is a duplicate, attributed same- vs cross-session.
    if (row.tool === "record_fetch" && !isCacheHit) {
      const target = row.target ?? "";
      const sess = rowSession(row);
      if (firstFetchSession.has(target)) {
        out.duplicate_fetches++;
        if (firstFetchSession.get(target) === sess) out.duplicate_fetches_same_session++;
        else out.duplicate_fetches_cross_session++;
      } else {
        firstFetchSession.set(target, sess);
      }
    }
  }
  return out;
}

/**
 * The SET of record_fetch target URIs for the run identified by `runPrefix`. Backs the Fix-1b acceptance
 * gate (the screen-gate predicate cross-checks each in-scope-live goods/field drop against this set). Reuses
 * the same gateway-namespace stripping + run-prefix matching as tallyRegisterCalls; read-only and defensive
 * (missing/unreadable ledger or a torn last line ⇒ skips that line, never throws). A cache_hit record_fetch
 * still counts — the URI WAS fetched this run, which is exactly what the gate asks.
 * @param {string} ledgerPath  path to the JSONL ledger
 * @param {string} runPrefix   e.g. `prelim-acme-bluejay-` (note the trailing hyphen)
 * @returns {Set<string>} the set of fetched record URIs
 */
export function fetchedRecordUris(ledgerPath = DEFAULT_LEDGER_PATH, runPrefix) {
  const out = new Set();
  if (!ledgerPath || !runPrefix || !existsSync(ledgerPath)) return out;

  let text;
  try { text = readFileSync(ledgerPath, "utf8"); } catch { return out; }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // tolerate a torn concurrent-append line
    if (!rowMatchesRun(row, runPrefix)) continue;
    if (row.tool === "record_fetch" && typeof row.target === "string" && row.target) out.add(row.target);
  }
  return out;
}

// ── the deprecated name is GONE ──────────────────────────────────────────────────────────────
// `tallyCorsearchCalls` named a vendor for a ledger five providers write to, and lived one release as
// an alias because its four callers sat in files another agent was mid-flight in. Those callers are
// renamed and the alias is deleted with them.
//
// A FUNCTION ALIAS AND AN ENV ALIAS ARE NOT THE SAME DECISION, and that is why only one of them goes.
// The legacy env names are read off a DEPLOYED BOX and stay for their release: dropping one costs an
// operator their ledger silently, because `forEachLedgerLine` maps ENOENT to `error: null`. Nothing
// outside this repo imports a JS symbol from here, so this one costs nobody anything. They are spelled
// in exactly one place, `providers/_shared/ledger-path.mjs`, which is the resolver that maps old to
// new; ends them.

export { tallyRegisterCalls as tallyCorsearchCalls };
