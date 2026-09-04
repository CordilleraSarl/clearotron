#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Fixture for the bridge stdin-guard test: arms exitOnStdinClose exactly as bridge.mjs does, then
// mimics the connected bridge's shape — the MCP transport reads stdin (flowing mode, so EOF surfaces)
// and an "in-flight upstream call" (the interval) would otherwise hold the process open forever.
import { exitOnStdinClose } from "../../providers/oauth-mcp-bridge/stdin-guard.mjs";

exitOnStdinClose({ name: "test-bridge" });
process.stdin.on("data", () => {});   // the StdioServerTransport reads stdin once connected
setInterval(() => {}, 1 << 30);       // the held upstream HTTP transport / in-flight call stand-in
