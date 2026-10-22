// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE UNIT IS TOLD HOW TO DECIDE A CROWD BESIDE THE ANSWER, AND THE RECORD CARRIES FACTS ONLY.
//
// A crowd's recorded reason told whoever read it to decide on it with the narrowing steps in unit.md. The reason is
// stored on the band block and rides the hit list into the write-up, placement and the writer, none of which has that
// manual, so to them it was an order addressed to someone else. The reason now carries facts only, and a register
// server hands the unit the instruction as a block of its own, once, beside any answer that carries a crowd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { CROWD_NOTE, carriesCrowd, crowdNoteFor } from "../engine/mcp/crowd-note.mjs";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
const CROWD = { state: "incomplete", total_hits: 2416, fetched: 0, sample: [],
  reason: "total_hits 2416 exceeds the enumerate ceiling 600 — this is a CROWD, not a named exact/near band, and never a clean; what stays a crowd is recorded with its count." };
const ENUMERATED = { state: "enumerated", total_hits: 3, fetched: 3, records: [{ record_id: "/mark/us/1", mark_text: "ORBANTIQ" }] };

test("an answer carries a crowd wherever the register tools put one, and an error or an unrun search is not one", () => {
  assert.equal(carriesCrowd(JSON.stringify(CROWD)), true, "the enumerate answer's crowd block");
  assert.equal(carriesCrowd(JSON.stringify({ written: "band.json", states: { "primary-sweep:contains:orbantiq": "incomplete", "q2": "enumerated" } })), true,
    "the plan tool's per-question states");
  assert.equal(carriesCrowd(JSON.stringify({ minted: ["supp:q1"], results: { "supp:q1": { state: "incomplete", total_hits: 980 } } })), true,
    "the supplemental tool's per-question results");
  assert.equal(carriesCrowd(JSON.stringify(ENUMERATED)), false);
  assert.equal(carriesCrowd(JSON.stringify({ ...CROWD, error: true })), false, "an errored slice is not a crowd");
  assert.equal(carriesCrowd(JSON.stringify({ ...CROWD, deferred: true })), false, "a planned search that never ran is not a crowd");
  assert.equal(carriesCrowd("ERROR: the plan carries no entries"), false, "an answer that is not JSON carries nothing");
  assert.equal(crowdNoteFor("register_enumerate", JSON.stringify(CROWD)), CROWD_NOTE);
  assert.equal(crowdNoteFor("register_enumerate", JSON.stringify(ENUMERATED)), null);
  assert.ok(!CROWD.reason.includes("unit.md"), "guard: the recorded reason here is the facts-only one");
});

test("a register server hands the line over once, as its own block, and leaves the answer as it was", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crowd-note-"));
  const server = join(dir, "server.mjs");
  writeFileSync(server, `import { serve } from ${JSON.stringify(pathToFileURL(join(MCP, "stdio-server.mjs")).href)};
import { crowdNoteFor } from ${JSON.stringify(pathToFileURL(join(MCP, "crowd-note.mjs")).href)};
serve({ name: "register", noteFor: crowdNoteFor, tools: [
  { name: "crowd_answer", description: "a crowd", inputSchema: { type: "object", properties: {} }, handler: async () => ${JSON.stringify(JSON.stringify(CROWD))} },
  { name: "clean_answer", description: "a named band", inputSchema: { type: "object", properties: {} }, handler: async () => ${JSON.stringify(JSON.stringify(ENUMERATED))} },
]});
`);
  const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (l) => { try { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); } catch { /* not ours */ } });
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const mine = ++id; const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 10000);
    pending.set(mine, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }) + "\n");
  });
  try {
    await request("initialize", { protocolVersion: "2025-06-18" });
    const crowd = (await request("tools/call", { name: "crowd_answer", arguments: {} })).result.content;
    assert.equal(crowd.length, 2, "the crowd's answer comes with the line beside it");
    assert.deepEqual(JSON.parse(crowd[0].text), CROWD, "the answer itself is the data, unchanged");
    assert.equal(crowd[1].text, CROWD_NOTE);
    const clean = (await request("tools/call", { name: "clean_answer", arguments: {} })).result.content;
    assert.equal(clean.length, 1, "an answer with no crowd carries no line");
  } finally { child.kill("SIGKILL"); }
});

test("every register server hands the unit the line, and the band tools the later stages read do not", () => {
  const servers = readdirSync(MCP).filter((f) => f.endsWith("-server.mjs"))
    .filter((f) => /serve\(\{\s*name: "register"/.test(readFileSync(join(MCP, f), "utf8")));
  assert.ok(servers.length >= 6, `guard: only ${servers.length} register server(s) found`);
  for (const f of servers) assert.match(readFileSync(join(MCP, f), "utf8"), /noteFor: crowdNoteFor/, `${f} does not hand the unit the crowd line`);
  assert.doesNotMatch(readFileSync(join(MCP, "band-server.mjs"), "utf8"), /crowdNoteFor/, "the band tools the write-up reads carry the unit's line");
});
