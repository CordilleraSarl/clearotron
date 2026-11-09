#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-server.mjs — the one MCP server for every trademark register, mounting the provider it is named.
//
//   node register-server.mjs <provider>
//
// A provider states its tools in `providers/<provider>/src/mount.js`: their names, descriptions, schemas and
// handlers. What every register shares stays here and reaches the mount as arguments, so a provider folder
// imports nothing from the driver. gather-config names the provider on the command line, from the same row
// that says which tools a stage is granted.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "./stdio-server.mjs";
import { crowdNoteFor } from "./crowd-note.mjs";   // how the unit decides on a crowd, beside an answer that carries one
import { proposeSupplemental } from "./supplemental.mjs";
import { narrowingFields } from "./proposal-fields.mjs";
import { CLARIVATE_PROPOSE_TOOL } from "./clarivate-propose-tool.mjs";

const provider = process.argv[2] ?? "";
if (!/^[a-z][a-z-]*$/.test(provider)) {
  process.stderr.write(`[mcp:register] needs a provider name as its argument, and was given ${JSON.stringify(provider)}\n`);
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const { mount } = await import(pathToFileURL(join(here, "..", "..", "..", "providers", provider, "src", "mount.js")).href);
const { version, tools } = mount({ proposeSupplemental, narrowingFields, CLARIVATE_PROPOSE_TOOL });

serve({ name: "register", version, noteFor: crowdNoteFor, tools });
