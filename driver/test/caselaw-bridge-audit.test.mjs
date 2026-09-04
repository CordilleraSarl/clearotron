// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE CASE-LAW CALL LEAVES A RECORD.
//
// The lane could prove a call HAPPENED (`_driver/tool-calls.jsonl` writes server/tool/ok) and could not
// show what it was for. stages.mjs's own contract declaration has recorded that for months:
// `citations[].url` and `citations[].proceeding` are `mechanical:tool-written`, "blocked by the call-log
// absence", on the surface the same file calls "the highest-stakes hallucination surface in the
// workflow". A cited authority and an invented one left the same trace.
//
// The bridges were spawned with NO ENV AT ALL, so there was nowhere to log even if the code existed.
// Both halves are fixed: the driver hands the bridge an audit env, and the bridge writes the line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { buildGatherMcpConfig } from "../engine/mcp/gather-config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE = readFileSync(join(ROOT, "providers", "oauth-mcp-bridge", "bridge.mjs"), "utf8");
const BAND = readFileSync(join(ROOT, "driver", "engine", "mcp", "band-server.mjs"), "utf8");

const caselaw = (opts) => buildGatherMcpConfig(["caselaw"], opts)?.mcpServers ?? {};

test("THE BRIDGE NOW GETS A RUN DIR — the half that made the log impossible", () => {
  const s = caselaw({ runDir: "/srv/testhome/run", agent: "clawdi", sessionKey: "sk" });
  for (const k of ["courtlistener", "legaldatahunter"]) {
    assert.ok(s[k], `${k} is mounted`);
    assert.equal(s[k].env?.CLEAROTRON_BAND_RUN_DIR, "/srv/testhome/run", `${k} can find the run dir`);
  }
});

test("A DELIBERATELY SMALLER SET THAN THE LOCAL SERVERS' ENV", () => {
  // A bridge proxies someone else's MCP server and needs exactly three facts to write an audit line.
  // The local servers get register ledger paths because they do register work; a bridge must not
  // quietly acquire reach it has no use for.
  const s = caselaw({ runDir: "/srv/testhome/run", agent: "clawdi", sessionKey: "sk" });
  const keys = Object.keys(s.courtlistener.env).sort();
  assert.deepEqual(keys, ["CLEAROTRON_BAND_RUN_DIR", "CLEAROTRON_GATHER_AGENT", "CLEAROTRON_GATHER_SESSION_KEY"]);
  assert.ok(!keys.some((k) => /REGISTER|POOL|OUTBOX/.test(k)), "no register or pool reach");
});

test("no run context ⇒ no env key at all, rather than an empty one", () => {
  const s = caselaw({});
  assert.equal(s.courtlistener.env, undefined,
    "a bridge started outside a run is spawned exactly as it was before this change");
});

test("BOTH OUTCOMES ARE LOGGED, including the refusal path", () => {
  // Without the failure half, "the search ran and found nothing" and "the search errored" leave the
  // same trace — the ambiguity this issue is about.
  const calls = [...BRIDGE.matchAll(/logCall\(serverName, name, req\.params\.arguments, \{ ok: (true|false)/g)].map((m) => m[1]);
  assert.ok(calls.includes("true"), "a successful call is recorded");
  assert.ok(calls.includes("false"), "a failed call is recorded");
  assert.match(BRIDGE, /logCall\(serverName, name, req\.params\.arguments, \{ ok: false, error: "not in bridge allowlist" \}\)/,
    "and so is a call the allowlist refused — that is a fact about the run too");
});

test("ARGUMENTS ARE REDACTED BY KEY NAME — this bridge is GENERIC", () => {
  // Today it proxies two case-law servers whose arguments are search parameters; tomorrow it proxies
  // something whose arguments are not. A bridge that writes whatever it is handed into a run directory
  // is one upstream tool away from logging a credential, and run dirs are read by people and shipped in
  // tarballs.
  assert.match(BRIDGE, /const SECRET_KEY_RE = \/token\|secret\|password\|credential\|api\[_-\]\?key\|authorization\|bearer\/i;/);
  assert.match(BRIDGE, /SECRET_KEY_RE\.test\(k\) \? "\[redacted\]" : v/);
});

test("THE ANSWER'S SIZE, NEVER THE ANSWER", () => {
  assert.match(BRIDGE, /function resultBytes\(res\)/);
  assert.ok(!/logCall\([^)]*\bres\b[^)]*\)/.test(BRIDGE.replace(/resultBytes\(res\)/g, "")),
    "the result object itself must not reach the log");
});

test("SAME FILE, SAME RULE AS THE BAND SERVER — one pattern, not a second one", () => {
  for (const src of [BRIDGE, BAND]) {
    assert.match(src, /"reading-log\.jsonl"/);
    assert.match(src, /best-effort/i, "a log failure must never break a lookup");
  }
  assert.match(BRIDGE, /if \(!AUDIT_RUN_DIR\) return;/, "no run dir, no line, never a throw");
});

test("the line is written SYNCHRONOUSLY, inside the handler", () => {
  // An await would put the log on a different tick from the call it describes, and a process exiting
  // mid-call would lose it. The rest of this file is fs/promises; this deliberately is not.
  assert.match(BRIDGE, /import \{ appendFileSync, mkdirSync \} from "node:fs";/);
  assert.ok(!/await appendFile\(/.test(BRIDGE));
});
