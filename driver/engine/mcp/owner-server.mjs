#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-server.mjs — the judging step's tools: the pile laid out by owner, and the reads behind it.
//
// Seven tools over this run's pile (owner-tools.mjs): the owner table in pages, all records of one owner,
// the register questions this search ran with their counts, what one question returned, one full record,
// the saved web results, and a request for a question this search did not run (recorded, not answered).
//
// READS, AND ONE FETCH. Everything is served from the run directory, except a full record the run does not
// hold yet: that is fetched from the active register WHEN A JUDGE OPENS IT, and not before (owner,
// 2026-10-01 — fetch on open, never every body first). The fetch is the provider's own `recordFetch`, the
// call the screen gate and the record closure make, and it writes the body to this run's record log.
//
// EVERY REQUEST IS LOGGED to the run's reading log (`_driver/reading-log.jsonl`, the reading audit), with
// the owners and records it put in front of the judge, under the session that asked. That log is what
// the step's fate record is built from: an owner a session never saw is told apart from one it saw and
// set aside, by this and nothing else.
//
// Env (gather-config serverEnv): CLEAROTRON_BAND_RUN_DIR (the run — required, read at call time),
// CLEAROTRON_GATHER_SESSION_KEY / CLEAROTRON_GATHER_AGENT (attribution), CLEAROTRON_REGISTER_RECORD_LOG
// (where a fetched body lands).
import { serve } from "./stdio-server.mjs";
import { loadPile } from "../../pile.mjs";
import { makeOwnerTools, OWNER_TOOLS, appendRequestLog } from "../../owner-tools.mjs";
import { driverDir } from "../../../shared/driver-dir.mjs";
import { runRecordLogPath } from "../../../providers/_shared/ledger-path.mjs";

const SESSION = process.env.CLEAROTRON_GATHER_SESSION_KEY || "";
const AGENT = process.env.CLEAROTRON_GATHER_AGENT || "";
// A fetch that does not answer in this long is answered as a failure: a judge waiting on a hung register
// is a judge doing nothing, and the record can still be read from the list.
const FETCH_MS = 90_000;

let tools = null;
let loadFailure = null;
function toolsForRun() {
  if (tools || loadFailure) return tools;
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) { loadFailure = "this server was started without a run — the driver wires it per run"; return null; }
  try {
    const pile = loadPile(runDir);
    tools = makeOwnerTools(pile, {
      fetchRecord: (id) => fetchOnOpen(runDir, id),
      log: (row) => appendRequestLog(driverDir(runDir, "reading-log.jsonl"), {
        ts: new Date(row.at).toISOString(), ...row, ...(SESSION ? { session: SESSION } : {}), ...(AGENT ? { agent: AGENT } : {}),
      }),
    });
  } catch (e) { loadFailure = `the pile could not be read: ${String(e?.message ?? e).slice(0, 200)}`; }
  return tools;
}

async function fetchOnOpen(runDir, id) {
  let provider;
  try {
    const { activeProvider } = await import("../../driver.config.mjs");
    provider = activeProvider();
  } catch (e) { return { ok: false, cause: `no register to fetch from: ${String(e?.message ?? e).slice(0, 120)}` }; }
  if (typeof provider?.recordFetch !== "function") return { ok: false, cause: `the register ${provider?.id ?? "?"} fetches no record` };
  const recordLog = process.env.CLEAROTRON_REGISTER_RECORD_LOG || runRecordLogPath(runDir);
  let timer;
  try {
    return await Promise.race([
      provider.recordFetch(id, { agentId: AGENT, sessionKey: SESSION, recordLog }),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, cause: `the register did not answer in ${FETCH_MS / 1000}s` }), FETCH_MS); }),
    ]);
  } catch (e) { return { ok: false, cause: `the fetch failed: ${String(e?.message ?? e).slice(0, 120)}` }; }
  finally { clearTimeout(timer); }
}

// What each tool does, declared (stdio-server.mjs says why every tool must): all of them read; the one
// that opens a record may reach the register to fetch it. Logging a request is the audit, not a write.
const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ANNOTATIONS = { register_open: { ...READS, openWorldHint: true } };

serve({
  name: "owners", version: "0.1.0",
  tools: OWNER_TOOLS.map((t) => ({
    ...t,
    annotations: ANNOTATIONS[t.name] ?? READS,
    handler: async (args) => {
      const ready = toolsForRun();
      if (!ready) return { text: JSON.stringify({ refused: true, text: loadFailure }), isError: true };
      const r = await ready.call(t.name, args);
      return { text: r.text, isError: r.refused };
    },
  })),
});
