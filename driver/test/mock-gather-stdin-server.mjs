#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Minimal stdio-server fixture for the C2 stdin-EOF self-exit tests: one instant tool + one that hangs
// 60s (the "in-flight billable call" stand-in — the server must NOT wait for it when stdin closes).
import { serve } from "../engine/mcp/stdio-server.mjs";

serve({
  name: "mock-stdin",
  tools: [
    { name: "quick", description: "answers immediately", inputSchema: { type: "object" }, handler: async () => "quick ok" },
    { name: "sleepy", description: "hangs 60s", inputSchema: { type: "object" }, handler: async () => { await new Promise((r) => setTimeout(r, 60000)); return "late"; } },
  ],
});
