#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/probe-server.mjs — the one tool the engine probe asks the engine to call.
//
// A turn with no tools proves the credential and the model, and nothing about whether the engine can use
// the tools every search stage is given. On some hosts codex's own sandbox refuses every tool call while
// the turn reports success, and a probe with no tool passed there. So the probe hands the engine this
// server, asks it to call `ping` once, and passes only when the reply carries what `ping` returned.
//
// WHAT IT RETURNS IS THE PROOF. `CLEAROTRON_PROBE_SENTINEL` is a random word the probe mints for each
// turn and gives only to this process, so a reply that carries it cannot be the model guessing. Read-only;
// it touches no file, no network and no run.
import { serve } from "./stdio-server.mjs";

serve({
  name: "probe", version: "0.1.0",
  tools: [{
    name: "ping",
    description: "Return the word this check is waiting for.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      const word = String(process.env.CLEAROTRON_PROBE_SENTINEL ?? "").trim();
      return word ? word : { isError: true, text: "ping: this server was started without a word to return" };
    },
  }],
});
