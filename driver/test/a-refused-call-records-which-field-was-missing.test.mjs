// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A CALL REFUSED FOR A MISSING FIELD RECORDS WHICH FIELD.
//
// A `settled` row carrying `ok: false` and nothing else asserts a failure and withholds everything that
// would let a reader weigh it — and a verdict turns on that, because a failed tool call counts against a
// run's cleanliness. Measured on the round of 2026-09-26: the required-field gate settled a frame call in
// the SAME MILLISECOND it started, wrote no call file, and no artifact in the run said why. The reason was
// in scope at the line that wrote the row.
//
// THE FIELD NAMES, NEVER THE MESSAGE. `unmet` is a list of schema keys, so it carries no matter content.
// The refusal sentence carries none today either, but a tool's refusal text is free to interpolate a mark,
// and this row's contract is the call and never its content — so the row copies the names and not the
// sentence. The second arm is what holds that distinction.
//
// DRIVEN THROUGH THE REAL SERVER, because the gate lives in the wrapper every typed call passes and there
// is no pure function to call: the arm spawns the recording server, sends a call missing a required field,
// and reads the row the server wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(DRIVER, "engine", "mcp", "recording-server.mjs");

/** Send one tools/call to the recording server against a real run dir, and resolve on its reply. */
function callTool(runDir, name, args) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("the recording server did not answer — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  });
}

/** The tool's own inputSchema, from the server that serves it. */
function schemaOf(runDir, name) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("tools/list did not answer — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        const t = (m.result?.tools ?? []).find((x) => x?.name === name);
        return t?.inputSchema ? resolve(t.inputSchema) : reject(new Error(`${name} served no inputSchema`));
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

/**
 * The smallest payload that satisfies every `required` path in a schema, DERIVED FROM THE SCHEMA rather
 * than typed. A hand-written "valid" payload is the trap the control below exists to avoid: my first
 * version sent `{scope_note, batch: {}, marks: []}` and the gate walked INTO `batch` and named three
 * nested fields, so the control was still a refusal and asserted nothing about a call that passed.
 */
function minimalFor(schema) {
  if (!schema || typeof schema !== "object") return "x";
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type !== "object") return "x";
  const out = {};
  for (const key of Array.isArray(schema.required) ? schema.required : [])
    out[key] = minimalFor(schema.properties?.[key]);
  return out;
}

const rowsOf = (runDir) => {
  const p = driverDir(runDir, "tool-calls.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

test("the settled row names the fields the call did not carry", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "missing-field-"));
  try {
    // `record_knockout_frame` declares scope_note, batch and marks required. Sending one of the three is
    // the shape the round of 2026-09-26 hit: a first call with nothing to merge onto.
    const out = await callTool(runDir, "record_knockout_frame", { scope_note: "a note" });
    assert.equal(out?.isError, true, "precondition: the gate refused this call at all");
    const settled = rowsOf(runDir).filter((r) => r.event === "settled");
    assert.equal(settled.length, 1, "the gate wrote no settled row, so there is nothing to assert about");
    assert.equal(settled[0].ok, false);
    assert.match(String(settled[0].reason ?? ""), /^missing_required:/,
      "the row still carries ok:false and no reason — the defect 985 is about, with the reason in scope "
      + "at the line that wrote it");
    for (const field of ["batch", "marks"])
      assert.match(settled[0].reason, new RegExp(`\\b${field}\\b`), `the row does not name the missing \`${field}\``);
    assert.doesNotMatch(settled[0].reason, /\bscope_note\b/, "the row names a field the call DID carry");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the row carries the field names and not the refusal sentence", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "missing-field-text-"));
  try {
    const out = await callTool(runDir, "record_knockout_frame", {});
    const text = String(out?.content?.[0]?.text ?? "");
    assert.match(text, /_missing_required:/, "precondition: the model was handed the refusal");
    const [settled] = rowsOf(runDir).filter((r) => r.event === "settled");
    // THE ROW IS NOT THE MESSAGE. The sentence the model reads explains the contract in prose; the row is
    // the call. A row that copied the sentence would leak the day a tool's refusal interpolates a mark.
    assert.ok(settled.reason.length < text.length,
      "the row copied the whole refusal sentence, which is content this record's own contract excludes");
    assert.doesNotMatch(settled.reason, /schema you were handed|placeholder/,
      "the prose of the refusal reached the row");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a call the gate lets past settles with no reason at all", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "no-missing-field-"));
  try {
    // THE CONTROL, AND ITS PAYLOAD COMES FROM THE SCHEMA. Without a control the arms above cannot tell a
    // row that names a reason when one exists from one that names a reason on every call — and a `reason`
    // on an ordinary settle would be a new field on every call the engine makes.
    //
    // The handler may still refuse this payload for reasons of its own; that is fine and is the point. The
    // claim is about the GATE: a call it lets past leaves a row with no `reason`, whatever the handler then
    // decides.
    const args = minimalFor(await schemaOf(runDir, "record_knockout_frame"));
    const out = await callTool(runDir, "record_knockout_frame", args);
    const settled = rowsOf(runDir).filter((r) => r.event === "settled");
    assert.equal(settled.length, 1, "precondition: the call settled at all");
    assert.doesNotMatch(String(out?.content?.[0]?.text ?? ""), /_missing_required:/,
      "premise: the schema-derived payload still trips the required-field gate, so this is not a control");
    assert.equal("reason" in settled[0], false,
      "a call past the gate carries a reason field, so the row says something about every call rather "
      + "than about the refused ones");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
