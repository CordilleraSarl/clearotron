#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/probe-server.mjs — the tools the engine probe asks the engine to call.
//
// A turn with no tools proves the credential and the model, and nothing about whether the engine can use
// the tools every search stage is given. On some hosts codex's own sandbox refuses every tool call while
// the turn reports success, and a probe with no tool passed there. So the probe hands the engine this
// server, asks it to call each tool once, and passes only when the reply carries what each one returned.
//
// WHAT THEY RETURN IS THE PROOF. Each tool's word is a random one the probe mints for each turn and gives
// only to this process, as its arguments in the order the tools are listed, so a reply that carries them
// cannot be the model guessing. They touch no file, no network and no run.
//
// EACH TOOL IS DECLARED AS A KIND OF TOOL A STAGE CALLS, NOT AS WHAT IT DOES. codex decides from a tool's
// annotations whether a call needs approval, and `codex exec` refuses every call that does ("MCP tool call
// requires approval, but approval policy is never") unless its approval mode or its sandbox lets it
// through. A read-only `ping` passed on hosts where `register_execute_plan` — marked not read-only and
// open-world on every register server — was refused on every call and no search could run. The probe
// exists to answer for the tools a search calls, so it carries one tool per kind, and a test keeps each
// equal to the tool it stands in for:
//   ping  the register search      not read-only, open-world
//   note  the recording tools      not read-only, closed-world
//   look  the page fetch           read-only, open-world
// The rule, in codex's own source, identical from 0.150.1 to 0.156.1: read-only → no approval; otherwise
// approval when destructive, or open-world, or either left unmarked.
import { serve } from "./stdio-server.mjs";

const DESCRIPTION = "Return the word this check is waiting for.";

/** The tool at `index` returns the word it was given at that position, or says it was given none. */
const answer = (name, index) => async () => {
  const word = String(process.argv[2 + index] ?? "").trim();
  return word ? word : { isError: true, text: `${name}: this server was started without a word to return` };
};

serve({
  name: "probe", version: "0.1.0",
  tools: [
    {
      name: "ping", description: DESCRIPTION,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: answer("ping", 0),
    },
    {
      name: "note", description: DESCRIPTION,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: answer("note", 1),
    },
    {
      name: "look", description: DESCRIPTION,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: answer("look", 2),
    },
  ],
});
