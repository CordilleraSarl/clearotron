// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — every MCP tool we serve declares what it does, and the declaration travels.
//
// `stdio-server.mjs` built its `tools/list` reply as `map(t => ({ name, description, inputSchema }))` —
// three fields, everything else dropped. A tool that declared `annotations` had them stripped before
// they left the process, which is why no tool in the tree declared any: there was nothing to gain.
//
// MCP annotations are how a tool says what it DOES — read-only, destructive, idempotent, whether it
// reaches the open world. A stock server carries them: the reference @modelcontextprotocol/server-
// filesystem declares them on all fourteen of its tools. Ours declared none.
//
// THIS ARM READS WHAT A CLIENT RECEIVES, not what the source says. It speaks MCP to each server and
// asserts on the reply, because the defect was precisely that the source and the reply disagreed — a
// source-level check would have passed on every day this shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { KNOWN_REGISTER_PROVIDERS } from "../driver.config.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = join(HERE, "..", "engine", "mcp");
const FIELDS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

// `stdio-server.mjs` matches the `*-server.mjs` glob and is not a server — it is the shared builder
// every server below calls, and it serves nothing on its own. Excluded by name, with the reason, rather
// than by loosening the glob: a looser pattern would silently stop covering a server named later.
const NOT_A_SERVER = new Set(["stdio-server.mjs"]);
const serverFiles = () => readdirSync(MCP_DIR).filter((f) => f.endsWith("-server.mjs") && !NOT_A_SERVER.has(f));

/** Speak MCP to one server over stdio and return its tools/list reply. */
function listTools(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(MCP_DIR, file)], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const done = (v) => { try { child.kill("SIGKILL"); } catch { /* already gone */ } resolve(v); };
    const timer = setTimeout(() => done({ error: "timed out" }), 20_000);
    child.stdout.on("data", (b) => {
      out += b.toString();
      for (const line of out.split("\n")) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e?.id === 2 && e?.result?.tools) { clearTimeout(timer); done({ tools: e.result.tools }); }
      }
    });
    child.on("error", (err) => { clearTimeout(timer); done({ error: String(err?.message ?? err) }); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  });
}

test("1968 every tool a client is offered declares what it does", async () => {
  const servers = serverFiles();
  // FLOOR. A walk that finds no servers reports clean, which is how a corpus guard goes quiet.
  assert.ok(servers.length >= 14, `only ${servers.length} server(s) found — the walk is broken, not the tree`);

  const missing = [];
  let seen = 0;
  for (const file of servers) {
    const r = await listTools(file);
    // An absence is a finding: a server that will not answer is not a server with nothing to declare.
    assert.ok(!r.error, `${file} did not answer tools/list (${r.error}) — this arm cannot judge a server it could not reach`);
    for (const t of r.tools) {
      seen++;
      const a = t.annotations;
      if (!a) { missing.push(`${file}:${t.name} — no annotations at all`); continue; }
      const absent = FIELDS.filter((k) => typeof a[k] !== "boolean");
      if (absent.length) missing.push(`${file}:${t.name} — missing ${absent.join(", ")}`);
    }
  }

  // ANTI-VACUITY, and it is not the server count: a run where every server answered with an EMPTY tool
  // list would satisfy every check above.
  assert.ok(seen >= 55, `only ${seen} tool(s) enumerated across ${servers.length} servers — the handshake `
    + "is returning empty lists, so nothing below was judged");

  assert.deepEqual(missing, [],
    "these tools tell a client nothing about what they do. A client that cannot tell a frozen-band "
    + "lookup from a tool that writes a ledger has to treat both the same way, and with the tool saying "
    + "nothing that is the client's only option. Declare them HONESTLY: `readOnlyHint: true` only where the "
    + "tool writes nothing, and `openWorldHint: true` wherever it reaches a vendor. A read-only claim on "
    + `a tool that writes a ledger is a lie told to a sandbox:\n  ${missing.join("\n  ")}`);
});

test("1968 no tool that writes claims to be read-only", async () => {
  // ✕ THE FAILURE THIS SWEEP COULD HAVE INTRODUCED, and the reason it is worth an arm of its own.
  // `readOnlyHint: true` is the annotation that most reliably gets a call admitted, so it is the one a
  // future sweep reaches for when a tool is being refused. Every `record_*` tool writes a row into the
  // run's ledger; claiming otherwise would buy an approval with a false statement about what the
  // product does to a client's matter. Driven and measured: an honestly-annotated WRITE tool
  // (`readOnlyHint: false`) is admitted anyway, so there is nothing to gain by lying.
  const servers = serverFiles();
  const liars = [];
  let writers = 0;
  for (const file of servers) {
    const r = await listTools(file);
    assert.ok(!r.error, `${file} did not answer tools/list (${r.error})`);
    for (const t of r.tools) {
      if (!/^record_/.test(t.name)) continue;
      writers++;
      if (t.annotations?.readOnlyHint === true) liars.push(`${file}:${t.name}`);
    }
  }
  assert.ok(writers >= 15, `only ${writers} record_* tool(s) found — the walk is not reaching them`);
  assert.deepEqual(liars, [],
    `these tools write a row into the run ledger and declare readOnlyHint: true:\n  ${liars.join("\n  ")}`);
});

test("1968 no tool that reaches a vendor claims to stay in the closed world", async () => {
  // ✕ THE MIRROR OF THE ARM ABOVE, and the same class of false statement. `openWorldHint: false` says a
  // tool touches nothing beyond this box. On a register lane or a fetcher that is untrue about what the
  // product does with a client's matter — it sends it to a third party — and it is exactly the
  // declaration a later sweep would reach for to make a tool look cheaper to admit.
  //
  // The read-only lie had an arm and this one did not. A guard covering one side of a class is the
  // defect, not the evidence: the table in the PR that added these annotations asserted `openWorldHint:
  // true` on every register lane and both fetchers, and nothing in the tree held it there.
  //
  // THE REGISTER POPULATION IS DERIVED, never hand-listed: `KNOWN_REGISTER_PROVIDERS` is the tree's own
  // roster, so a lane added later is covered the day it is added. The two fetchers are named here with
  // their reason, in the same idiom as NOT_A_SERVER above — they are outbound by definition rather than
  // members of a growing set.
  const OUTBOUND_FETCHERS = ["fetch", "perplexity"];
  const reachesAVendor = new Set([...KNOWN_REGISTER_PROVIDERS, ...OUTBOUND_FETCHERS].map((n) => `${n}-server.mjs`));

  const liars = [];
  let reachers = 0;
  for (const file of serverFiles()) {
    if (!reachesAVendor.has(file)) continue;
    const r = await listTools(file);
    assert.ok(!r.error, `${file} did not answer tools/list (${r.error}) — this arm cannot judge a server it could not reach`);
    for (const t of r.tools) {
      reachers++;
      if (t.annotations?.openWorldHint !== true) liars.push(`${file}:${t.name} — openWorldHint: ${t.annotations?.openWorldHint}`);
    }
  }

  // ANTI-VACUITY. Measured 42 today across the six register lanes and both fetchers; a walk that reaches
  // none of them, or servers that answer with empty lists, would otherwise report clean.
  assert.ok(reachers >= 40,
    `only ${reachers} vendor-reaching tool(s) enumerated across ${reachesAVendor.size} servers — the walk `
    + "is not reaching them, so nothing below was judged");

  assert.deepEqual(liars, [],
    "these tools send a client's matter to a third-party vendor and declare that they reach nothing:\n  "
    + liars.join("\n  "));
});
