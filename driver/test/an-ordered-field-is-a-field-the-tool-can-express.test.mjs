// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE ORDER AND THE SCHEMA, ACROSS THE WHOLE POPULATION.
//
// ── THE DEFECT THIS GENERALISES ─────────────────────────────────────────────────────────────────────
//
//: all three synthesis repair composers instructed the seat, verbatim, to "send the
// correction with `record_synthesis`: a PATCH call carrying `findings_patch` … and nothing else". The
// tool's schema declared no `findings_patch` and required both of the halves whose absence the
// transport used to DETECT a patch. No schema-conforming call could ever be one. The seat complied the
// only way left, sent a whole document holding the four findings it had corrected, and fifteen went.
//
// `the-repair-order-and-the-tool-schema-agree.test.mjs` pins that for `record_synthesis`. It says
// nothing about the other fourteen transports, and an order naming a field the tool cannot carry is an
// instruction with no mechanism wherever it appears.
//
// ── PROXIMITY, NOT PRESENCE — and this is the whole difficulty ───────────────────────────────────────
//
// The first cut of this scan asked "is every backticked snake_case token in the stage's instruction
// union expressible by its transport". It produced 21 candidates on synthesis alone and every one read
// was a false positive, because the union includes SHARED DOCTRINE and shared doctrine legitimately
// names other transports' fields: `phase2-execution.md` names the deliverable's `handling_note` (which
// is report-overview's) while being served to skeptic; `unit.md` names `industry_incumbent_alert`
// (which is the variant manifest's) while being served to register-unit. That is correct behaviour of
// the corpus, so token presence is the wrong test.
//
// The rule that works is the sibling guard's, generalised: an identifier counts as ORDERED only on a
// line that also names THE TOOL. A sentence that names the tool and a field in the same breath is an
// instruction to send that field; a doctrine file mentioning a field elsewhere is not.
//
// Both quoting conventions, because the composers use both: every backtick inside these template
// literals is escaped, and several rungs order their field in double quotes instead. A scan anchored on
// a bare backtick alone found NOTHING on the sibling guard's first run.
//
// Comment lines are excluded. A comment is not an order, and a guard that reads its own prose measures
// the wrong file — the sibling guard learned that by matching a `required:` array inside the comment
// documenting its removal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVERS = Object.freeze(["recording", "coverage", "dispositions", "unit-note", "declination"]);
// Where an order can be composed. Not the doctrine files: those are shared, and the proximity rule
// above is what replaces reading them.
const ORDER_SOURCES = Object.freeze(["repair-composers.mjs", "gateway.mjs", "stages.mjs"]);

const IDENT = /\\?`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\\?`/g;
const QUOTED = /(?:carrying only|send|sending|with)\s+\\?"([a-z][a-z0-9_]*)\\?"/g;

function toolsOf(server) {
  const script = join(DRIVER, "engine", "mcp", `${server}-server.mjs`);
  return new Promise((resolve, reject) => {
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${server}-server.mjs did not answer tools/list — could not look`)); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        const tools = m.result?.tools;
        if (!Array.isArray(tools) || tools.length === 0)
          return reject(new Error(`${server}-server.mjs served no tools — a scan that finds nothing is not a pass`));
        return resolve(tools);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "order-census", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

/** name -> every property name anywhere in its resolved schema. */
async function transports() {
  const out = new Map();
  const walk = (node, acc) => {
    if (!node || typeof node !== "object") return acc;
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) { acc.add(k); walk(v, acc); }
    if (node.items) walk(node.items, acc);
    return acc;
  };
  for (const s of SERVERS)
    for (const t of await toolsOf(s))
      if (t.name.startsWith("record_")) out.set(t.name, walk(t.inputSchema ?? {}, new Set()));
  return out;
}

/**
 * The findings DOCUMENT's own top-level registers, read from the model rather than restated.
 *
 * WHY AN ALLOWANCE IS NEEDED AT ALL, and why it is narrow. `record_synthesis` declares `findings` as an
 * object with NO declared properties, so the whole findings document rides inside it. A rung ordering
 * `actions` or `ask_answers` is ordering a register of that document, which IS sendable — and without
 * this the census would report two false refusals on the one transport whose contract is already pinned.
 *
 * ✕ AND THIS ALLOWANCE IS ALSO THE HOLE. An object with no declared properties is exactly where an
 * undeclared key rides while still conforming, which is how 1955's `findings_patch` reached the
 * transport inside `findings` and was refused as unknown. The allowance is granted ONLY to a tool that
 * really does declare such an object, so it cannot quietly widen to a typed one.
 */
function findingsDocumentRegisters() {
  const src = readFileSync(join(DRIVER, "findings-model.mjs"), "utf8");
  const decls = [...src.matchAll(/const TOP_KEYS(?:_V\d)? = \[([\s\S]*?)\]/g)];
  assert.ok(decls.length >= 2,
    `findings-model.mjs declares ${decls.length} TOP_KEYS list(s) — this scan expects the version ladder, `
    + "and finding fewer means it is reading a shape that has changed");
  const names = new Set();
  for (const d of decls) for (const q of d[1].matchAll(/["']([a-z_][a-z0-9_]*)["']/g)) names.add(q[1]);
  return names;
}

/** Does this tool declare an object property with no declared properties of its own? */
async function declaresUntypedObject(tool) {
  for (const s of SERVERS)
    for (const t of await toolsOf(s)) {
      if (t.name !== tool) continue;
      for (const v of Object.values(t.inputSchema?.properties ?? {}))
        if (v?.type === "object" && !v.properties) return true;
    }
  return false;
}

/** Every field ORDERED for this tool, with where it was ordered. */
function orderedFieldsFor(tool) {
  const found = new Map();
  let orderLines = 0;
  for (const file of ORDER_SOURCES) {
    const src = readFileSync(join(DRIVER, file), "utf8");
    src.split("\n").forEach((line, i) => {
      if (!line.includes(tool)) return;
      if (/^\s*\/\//.test(line)) return;
      orderLines++;
      for (const m of line.matchAll(IDENT)) if (!found.has(m[1])) found.set(m[1], `${file}:${i + 1}`);
      for (const m of line.matchAll(QUOTED)) if (!found.has(m[1])) found.set(m[1], `${file}:${i + 1}`);
    });
  }
  return { found, orderLines };
}

test("every field an order names for a transport is a field that transport can express", async () => {
  const served = await transports();
  assert.ok(served.size > 0, "no return-path transport was served — could not look");

  const registers = findingsDocumentRegisters();
  const toolNames = new Set(served.keys());
  let toolsWithOrders = 0;

  for (const [tool, can] of served) {
    assert.ok(can.size > 0, `${tool} served a schema declaring no property — every check below would be vacuous`);

    const { found, orderLines } = orderedFieldsFor(tool);
    // A transport no live order names is a could-not-look, not a clean row. Every one of the fifteen is
    // named today; a conversion that stops naming its own tool in any order should say so here.
    assert.ok(orderLines > 0,
      `no non-comment line in ${ORDER_SOURCES.join(", ")} names ${tool} — this census cannot see its orders, `
      + "which is a finding about the scan or about a stage that lost its dispatch, not a pass");
    toolsWithOrders++;

    const allowed = (await declaresUntypedObject(tool)) ? registers : new Set();
    for (const [field, at] of found) {
      if (toolNames.has(field)) continue;          // the tool naming a sibling tool, not a field
      if (can.has(field)) continue;
      assert.ok(allowed.has(field),
        `${at} orders the seat to send \`${field}\` via ${tool}, and that tool's schema cannot express it. `
        + "An order for a field the tool cannot carry is an instruction with no mechanism — it is the shape "
        + "that lost fifteen findings on R2. Either declare the field on the tool, or stop ordering it.");
    }
  }

  // FLOOR. If the proximity rule ever stops matching, every row above passes by finding nothing.
  assert.equal(toolsWithOrders, served.size,
    `only ${toolsWithOrders} of ${served.size} transports had any order line — the scan has stopped seeing orders`);
});
