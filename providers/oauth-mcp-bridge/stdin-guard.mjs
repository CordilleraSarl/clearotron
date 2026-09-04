// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stdin-guard.mjs — orphan self-termination for stdio-spawned MCP processes.
//
// A stdio MCP server lives exactly as long as the client that spawned it: stdin EOF/close means that
// client (`claude -p` under the prelim engine, or any other stdio MCP client) is gone and no request can ever arrive
// again. Without this guard the bridge held its upstream HTTP transport open FOREVER after the parent
// died (proven orphan: a bridge.mjs --server legaldatahunter process, PPID 1, ran 3.5 days) — still
// authenticated, still able to run billable upstream calls for a dead session. Exit 0 and abandon any
// in-flight work: continuing it is exactly the failure mode. Dependency-free on purpose (unit-tested
// from the prelim-driver suite, which does not install the bridge's SDK).
//
// NOTE: `end` fires only once something reads stdin (the MCP transport does, post-connect); `close`
// covers a destroyed stream. The steady-state orphan — connected bridge, parent dies later — is the
// production pathology and both signals cover it.
export function exitOnStdinClose({ name = "stdin-guard", stream = process.stdin, exit = (c) => process.exit(c) } = {}) {
  const bail = (why) => {
    try { process.stderr.write(`[${name}] stdin ${why} — parent gone, exiting\n`); } catch { /* stderr gone too */ }
    exit(0);
  };
  stream.on("end", () => bail("end"));
  stream.on("close", () => bail("close"));
}
