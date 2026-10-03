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
// hold yet: that is fetched WHEN A JUDGE OPENS IT, and not before (owner, 2026-10-01 — fetch on open, never
// every body first), from the register this run used. The fetch is the provider's own `recordFetch`, the
// call the record closure makes, and it writes the body to this run's record log.
//
// THE RUN'S REGISTER, NEVER THE DEPLOYMENT'S. A record id is the id one register gave it. The frozen plan
// names the register the run listed its records from, and the deployment may have moved to another since;
// opened at another register, the same id is another record or none. A run whose register this build does
// not know, or which fetches no record, has its fetch refused by name — never sent to the active register
// in its place. Each fetch is a billed call with no cap (owner, 2026-10-01); the run records how many.
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
import { fetchRunRecord, FETCH_MS } from "../../record-fetch.mjs";

const SESSION = process.env.CLEAROTRON_GATHER_SESSION_KEY || "";
const AGENT = process.env.CLEAROTRON_GATHER_AGENT || "";

let tools = null;
let loadFailure = null;
function toolsForRun() {
  if (tools || loadFailure) return tools;
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) { loadFailure = "this server was started without a run — the driver wires it per run"; return null; }
  try {
    const pile = loadPile(runDir);
    tools = makeOwnerTools(pile, {
      fetchRecord: (id) => fetchRunRecord({ runDir, providerId: pile.provider, id, agentId: AGENT, sessionKey: SESSION,
        recordLog: process.env.CLEAROTRON_REGISTER_RECORD_LOG || null, timeoutMs: FETCH_MS }),
      log: (row) => appendRequestLog(driverDir(runDir, "reading-log.jsonl"), {
        ts: new Date(row.at).toISOString(), ...row, ...(SESSION ? { session: SESSION } : {}), ...(AGENT ? { agent: AGENT } : {}),
      }),
    });
  } catch (e) { loadFailure = `the pile could not be read: ${String(e?.message ?? e).slice(0, 200)}`; }
  return tools;
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
