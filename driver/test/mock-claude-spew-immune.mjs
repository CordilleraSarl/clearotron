#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// SIGTERM-immune `claude` stand-in for the engine maxBuffer-overflow test (A3): emits system:init (so the
// engine considers the turn started + streaming) then writes an ENDLESS newline-free line to stdout at max
// rate forever — the "one unbounded line with no separator" model that pre-fix grew the engine's `buf` to
// V8's string cap (uncaught RangeError → runner crash) while every byte kept resetting the stall clock.
// Ignores SIGTERM (like the real MCP-holding tree), so only the group SIGKILL escalation can reap it.
// Writes its pid to MOCK_CLAUDE_SPEW_PIDFILE so the test can assert death.
import { writeFileSync } from "node:fs";

process.on("SIGTERM", () => {});
if (process.env.MOCK_CLAUDE_SPEW_PIDFILE) writeFileSync(process.env.MOCK_CLAUDE_SPEW_PIDFILE, String(process.pid));

// system:init (newline-terminated) — the one framed event; everything after is the endless newline-free spew.
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "spew", apiKeySource: "none" }) + "\n");
const chunk = "x".repeat(64 * 1024);   // NO "\n" → the engine's line-parser never drains `buf`, it just grows
const spew = () => { while (process.stdout.write(chunk)) { /* fill the pipe until backpressure */ } };
process.stdout.on("error", () => {});   // stdout destroyed at the engine's overflow settle → ignore EPIPE
process.stdout.on("drain", spew);
spew();
setInterval(() => {}, 1 << 30);
