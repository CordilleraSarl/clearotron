// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reusable minimal MCP stdio server scaffolding (JSON-RPC 2.0 over newline-delimited stdin/stdout, no
// SDK). Generalizes the Phase-0.5 proof. Each gather server (corsearch/perplexity/euipo) defines its tools
// and a handler; this owns the protocol so the servers stay ~pure glue around the plugin cores.
//
// serve({ name, version, tools }): tools is an array of
//   { name, description, inputSchema, handler: async (args) => string | { isError?:boolean, text:string } }
// handler returns text (wrapped as a single text content block) or an {isError,text}. Thrown errors → isError.
import "./http-dispatcher.mjs";   // side effect: raise undici headersTimeout for long grid/register calls
import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //

// ── half 2 — THE TOOL CALL LOG, so a killed call is a FACT and not an inference ────────────────
//
// The R5 round of 2026-08-12 died as `named_band_missing` four times. The reading was that the model
// omitted required structure. It had not: it called `register_execute_plan` ONCE exactly as dictated,
// the call was killed at codex's 300s default, the band was never written, and the model then wrote an
// honest audit note saying so — the doctrine-compliant act, since hand-authoring the band is the
// forbidden one. The validator saw md-present/band-absent and blamed the producer.
//
// The information needed to tell those two apart existed only HERE, in the process that was running the
// call when it was killed, and it was never written down. This is that record: one line when a call
// starts, one when it settles. **A `started` with no `settled` is a call that never returned.** Nothing
// else can express that — a killed process writes no epilogue, so the absence of the second line IS the
// evidence, and it is only readable because the first line was written before the work began.
//
// ONE FILE PER RUN, resolved at CALL TIME. `providers/_shared/ledger.mjs` captures its paths at module
// load and its own comment explains why that was safe there — the path is a process-wide constant. This
// one is per-run, so a module-load capture would freeze whatever was in the environment when the module
// first loaded and write every later run's rows to the wrong place. (That distinction is the whole
// blocker; it is not repeated here.)
//
// BEST-EFFORT AND SILENT, exactly like the register ledger: telemetry must never break a tool call. A
// failed write costs this diagnostic and nothing else.
const toolLogPath = () => {
  const dir = process.env.CLEAROTRON_BAND_RUN_DIR;
  return dir ? driverDir(dir, "tool-calls.jsonl") : null;
};

// WHAT GOES IN: the tool's name, the sequence number that pairs the two lines, and — for the plan tools
// only — the axis, because the validator's question is per-axis ("did THIS unit's call return?"). No
// arguments wholesale: a proposal array carries mark text and the point of the row is the call, not its
// content.
function logToolEvent(row) {
  const path = toolLogPath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
  } catch { /* telemetry must never break a tool call */ }
}

/**
 * THE FIELDS A CALL PROMISES AND DID NOT CARRY —. PURE.
 *
 * `serve()` used to hand `params.arguments` straight to the handler and validate nothing against the
 * tool's own `inputSchema`. So every `required` array across the return-path transports was a promise
 * only an acceptor could keep, and it was kept exactly where one author happened to re-check the same
 * field by hand. Measured across 283 archived payloads: eleven transports conform, three declare nothing
 * to enforce, and one could not be asked because its archive is lossy (filed separately).
 *
 * Nested objects are walked ONLY when the parent is present: an absent parent is already reported by the
 * parent's own row, and reporting its children too would name three failures for one omission.
 *
 * `null` counts as absent. A seat that sends `"batch": null` has not sent a batch, and a schema that says
 * the field is required is not satisfied by a placeholder.
 */
export function requiredFieldViolations(schema, args, path = "") {
  const out = [];
  if (!schema || typeof schema !== "object") return out;
  const obj = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  for (const f of Array.isArray(schema.required) ? schema.required : []) {
    if (obj[f] === undefined || obj[f] === null) out.push(path ? `${path}.${f}` : f);
  }
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    if (sub && sub.type === "object" && Array.isArray(sub.required) && obj[k] != null) {
      out.push(...requiredFieldViolations(sub, obj[k], path ? `${path}.${k}` : k));
    }
  }
  return out;
}

export function serve({ name, version = "0.1.0", tools = [] }) {
  // Pairs the two lines of one call. Per PROCESS, and a register server is spawned per stage, so a
  // reader must key on (server, seq) and never on seq alone.
  let callSeq = 0;
  const byName = new Map(tools.map((t) => [t.name, t]));
  // ── — THE ANNOTATIONS TRAVEL, BECAUSE A TOOL MUST BE ABLE TO SAY WHAT IT DOES ──
  //
  // This line used to pick three fields and drop the rest, so a tool that declared `annotations` had
  // them stripped before `tools/list` — which is why no tool in the tree declared any: there was no
  // point. That is a defect on its own terms, and it is the whole of what this change stands on.
  //
  // MCP annotations are how a tool says what it DOES — read-only, destructive, idempotent, whether it
  // reaches the open world. A stock server carries them on every tool; ours carried none.
  //
  // ✕ THIS IS NOT THE ESTABLISHED CAUSE OF THE CODEX REFUSALS, and nothing here may be read as one. The
  // universal claim — "codex cannot call any MCP tool" — was WITHDRAWN on 1968 by the lane that filed
  // it: real codex completed 1,292 MCP calls across three pre-rebuild runs. What differs after the
  // 2026-08-24 rebuild is open under. The probe below is ONE measurement on ONE CLI
  // version, recorded so nobody re-derives it. It is a candidate, not a finding, and this fix does not
  // rest on it.
  //
  // MEASURED on codex-cli 0.150.1 with today's engine args, isolated CODEX_HOME, policy `never`:
  //   the reference @modelcontextprotocol/server-filesystem (14 annotated tools)  → completed
  //   a one-tool probe with NO annotations                                        → refused
  //   the same probe with `annotations: { readOnlyHint: true }` and nothing else  → completed
  //   an honest WRITE tool — readOnlyHint:false, destructiveHint:false            → completed
  //     …and its ledger line was actually written.
  //
  // ✕ THE LAST ROW IS THE ONE THAT MATTERS. The rule is that a tool must DECLARE what it does, not that
  // it must be read-only. Nothing here needs to claim a write is a read to get called, and a
  // `readOnlyHint: true` on a tool that writes a ledger would be a lie told to a sandbox for
  // convenience — the exact thing annotations exist to prevent.
  const list = tools.map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
  const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    line = line.trim();
    if (!line) return;
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    try {
      if (method === "initialize") {
        ok(id, { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version } });
      } else if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
        /* notification: no reply */
      } else if (method === "ping") {
        ok(id, {});
      } else if (method === "tools/list") {
        ok(id, { tools: list });
      } else if (method === "tools/call") {
        const tool = byName.get(params?.name);
        if (!tool) return ok(id, { isError: true, content: [{ type: "text", text: `unknown tool: ${params?.name}` }] });
        // — STAMPED BEFORE THE WORK, settled after it, and the pair is the whole mechanism. A
        // process killed mid-call cannot write anything, so "started with no settled" is the only shape
        // that can record a call that never returned.
        const seq = ++callSeq;
        const axis = typeof params?.arguments?.axis === "string" ? params.arguments.axis : null;
        logToolEvent({ event: "started", seq, server: name, tool: tool.name, ...(axis ? { axis } : {}) });
        // ── — THE ONE SEAM EVERY TYPED CALL PASSES THROUGH ───────────────────────
        //
        // Refused HERE, before the handler, because here is the only place that can see the schema and
        // the arguments together. An acceptor can only enforce what its own author remembered to
        // re-check by hand, which made "this field is required" a property of one author's diligence
        // rather than of the contract. The refusal names the fields in the acceptors' own token shape so
        // a seat can act on it in the turn it happens.
        const unmet = requiredFieldViolations(tool.inputSchema, params?.arguments);
        if (unmet.length) {
          logToolEvent({ event: "settled", seq, server: name, tool: tool.name, ...(axis ? { axis } : {}), ok: false });
          return ok(id, { isError: true, content: [{ type: "text", text:
            `${tool.name}_missing_required:${unmet.join(",")} — the schema you were handed declares `
            + `${unmet.length === 1 ? "this field" : "these fields"} REQUIRED and the call did not carry `
            + `${unmet.length === 1 ? "it" : "them"}. Send the field itself, not null and not a placeholder.` }] });
        }
        let out;
        try { out = await tool.handler(params?.arguments || {}); }
        catch (e) {
          // A THROWN tool error SETTLES. It returned an answer — a wrong one, but the model saw it and
          // could act on it. Recording it as unsettled would attribute a live failure to a timeout.
          logToolEvent({ event: "settled", seq, server: name, tool: tool.name, ...(axis ? { axis } : {}), ok: false });
          return ok(id, { isError: true, content: [{ type: "text", text: `${tool.name} error: ${e?.message ?? e}` }] });
        }
        const isError = typeof out === "object" && out?.isError === true;
        const text = typeof out === "string" ? out : (out?.text ?? JSON.stringify(out));
        logToolEvent({ event: "settled", seq, server: name, tool: tool.name, ...(axis ? { axis } : {}), ok: !isError });
        ok(id, { isError: isError || undefined, content: [{ type: "text", text }] });
      } else if (id != null) {
        err(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      if (id != null) err(id, -32603, `internal error: ${e?.message ?? e}`);
    }
  });

  // Orphan self-termination (C2 defense-in-depth): stdin EOF/close means the client that spawned us
  // (claude -p) is gone — no request can ever arrive again, but an IN-FLIGHT handler would keep running
  // (billable vendor calls for a dead stage, and a late *-band.json write racing the retry's
  // read-modify-write). Exit immediately: abandoning the in-flight work is the point. This holds even
  // when the engine's group kill misses us (claude setpgid'ing its MCP children).
  rl.on("close", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));

  // Surface fatal startup problems (e.g. missing creds) on stderr; the server still answers the handshake
  // so `claude --mcp-config` reports a connected server whose tool calls return a clear isError.
  process.on("uncaughtException", (e) => { process.stderr.write(`[mcp:${name}] ${e?.stack ?? e}\n`); });
}
