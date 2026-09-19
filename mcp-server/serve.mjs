#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// serve.mjs — the MCP server over stdio, with the Node check in front of it. The connect lines name
// this file.
//
// server.mjs cannot check the Node it runs on. An ES module's imports are all loaded before any of its
// code runs, so on a Node below the floor the server fails while loading, with an error that names a
// module and says nothing about the version. Measured on Node 18.20.8: "SyntaxError: The requested
// module 'node:util' does not provide an export named 'parseEnv'". On a Windows laptop running the
// connect line through WSL, the distribution's own Node 18 met "SyntaxError: Unexpected token 'with'"
// (2026-09-19). This file imports only what an old Node can load, refuses in one plain line, and only
// then loads the server.
import { fileURLToPath } from "node:url";
import { nodeFloorVerdict, nodeFloorRefusal } from "../shared/node-floor.mjs";   // one floor, read from package.json

const floor = nodeFloorVerdict();
if (!floor.ok) {
  console.error(`clearotron: ${nodeFloorRefusal(floor)}`);
  process.exit(1);
}

// THE SERVER STARTS AS THE ENTRY IT WOULD HAVE BEEN. It starts its stdio transport, and reads the
// install's settings, only when it is the process's entry file, so the entry is handed over first.
process.argv[1] = fileURLToPath(new URL("./server.mjs", import.meta.url));
await import("./server.mjs");
