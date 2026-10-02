// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A FRAME CALL WITH ITS PLACES PER NAME PASSES THE REQUIRED-FIELD GATE.
//
// Ruling 570 moved a knockout's places from the batch to each name. The manual's example payload, the
// recorder's acceptor and the plan validator all followed: the batch list is optional, and a call that
// still sends one has it checked. The tool's schema kept `places` in `batch.required`, so the gate every
// typed call passes (stdio-server.mjs, requiredFieldViolations) refused the first call shaped as the manual
// shows it, before the handler ran, with `missing_required:batch.places`. Measured on the test box: the
// frame's first call was refused on nearly every knockout from that change on, and on none of 20 before it.
//
// THE SCHEMA IS READ FROM THE SERVER THAT SERVES IT, and the call is the manual's own shape, so the arm
// reds again the day the schema, the manual or the acceptor drifts apart on this field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredFieldViolations } from "../engine/mcp/stdio-server.mjs";
import { acceptKnockoutFrame } from "../knockout-frame-record.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(DRIVER, "engine", "mcp", "recording-server.mjs");
const MANUAL = join(DRIVER, "skills", "knockout-frame", "SKILL.md");

/** The tool's own inputSchema, from the server that serves it. */
function schemaOf(name) {
  const runDir = mkdtempSync(join(tmpdir(), "frame-schema-"));
  return new Promise((resolve, reject) => {
    const p = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "";
    const done = (fn, v) => { clearTimeout(timer); p.kill(); rmSync(runDir, { recursive: true, force: true }); fn(v); };
    const timer = setTimeout(() => done(reject, new Error("tools/list did not answer — could not look")), 20000);
    p.on("error", (e) => done(reject, e));
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        const t = (m.result?.tools ?? []).find((x) => x?.name === name);
        return t?.inputSchema ? done(resolve, t.inputSchema) : done(reject, new Error(`${name} served no inputSchema`));
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

/** The keys of the manual's example batch and of its example mark, read from the manual itself. */
function manualShape() {
  const text = readFileSync(MANUAL, "utf8");
  const block = text.match(/```json\n([\s\S]*?"batch"[\s\S]*?)\n```/);
  assert.ok(block, "the frame manual carries no JSON example — the instrument has nothing to read");
  const example = JSON.parse(block[1]);
  return { batch: Object.keys(example.batch ?? {}), mark: Object.keys(example.marks?.[0] ?? {}) };
}

// One invented name, with a value for every key the manual's example shows.
const VALUES = {
  batch: { productContext: "A software tool for invented test data.", inUseAs: "a software product or app", umbrellaBrandNote: null, executionOrder: ["VELTRIN"] },
  mark: { ref: null, name: "VELTRIN", classes: [9, 42], beltAndBraces: [35], classesPlain: "Software, and software services.",
    contextFraming: "The name of the tool itself.", useKind: "software app", places: ["web", "example.com"],
    spellings: ["VELTRIN", "VELTRYN"], priorKnowledge: null, priority: 1 },
};

function manualShapedCall() {
  const shape = manualShape();
  const pick = (keys, from) => Object.fromEntries(keys.map((k) => {
    assert.ok(k in from, `the manual's example carries "${k}", which this arm has no invented value for`);
    return [k, from[k]];
  }));
  return { scope_note: "An invented batch of one name, classes 9 and 42.", schema: 1,
    batch: pick(shape.batch, VALUES.batch), marks: [pick(shape.mark, VALUES.mark)] };
}

test("a frame call shaped as the manual shows it, places per name, passes the gate and the acceptor alike", async () => {
  const call = manualShapedCall();
  assert.equal("places" in call.batch, false, "premise: the manual's example sends no batch list of places");
  assert.equal(acceptKnockoutFrame(call).ok, true, "premise: the recorder accepts this call — otherwise the gate is not the only refusal");
  const schema = await schemaOf("record_knockout_frame");
  assert.deepEqual(requiredFieldViolations(schema, call), [],
    "the required-field gate refuses a call the manual teaches and the acceptor accepts, before the handler runs");
});

test("the gate still walks into the batch: a call missing what the acceptor does require is refused there", async () => {
  // THE CONTROL. Without it the arm above cannot tell a schema that requires the right fields from a gate
  // that stopped looking inside `batch` at all.
  const call = manualShapedCall();
  delete call.batch.productContext;
  assert.equal(acceptKnockoutFrame(call).ok, false, "premise: the acceptor refuses a batch with no product context");
  const schema = await schemaOf("record_knockout_frame");
  assert.ok(requiredFieldViolations(schema, call).includes("batch.productContext"), "the gate no longer looks inside batch");
});
