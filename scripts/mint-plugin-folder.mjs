#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// mint-plugin-folder.mjs — the folder Claude's plugin directory installs, its copies derived from the tree.
//
// The directory installs one folder, never the repository: a person who installs the plugin gets
// `plugin/` and nothing else. What the folder needs from the tree is copied into it, and `--check`
// refuses a folder whose copies have drifted from their sources:
//   - the three connector skills, byte for byte from `skills/`, which stays the one copy the server
//     briefs from and the published package ships;
//   - the licence and its additional terms, byte for byte from the root.
// Written by hand and not derived: `plugin/README.md`, the manifest, and `plugin/.mcp.json`, which names
// the exact stable version the server is started from. A stable cut moves that version and the
// manifest's together; between stables the package is a beta and the folder still names the last stable.
//
//   node scripts/mint-plugin-folder.mjs           write the copies
//   node scripts/mint-plugin-folder.mjs --check   exit 1 if any copy differs from its source, naming it
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_DIR = "plugin";
export const CONNECTOR_SKILLS = Object.freeze(["clearotron-client", "clearotron-account", "clearotron-ops"]);

/** Every copied file of the folder: its path under the root, and its exact bytes. PURE but for reads. */
export function pluginCopies(root = ROOT) {
  const read = (p) => readFileSync(join(root, p), "utf8");
  const out = [];
  for (const skill of CONNECTOR_SKILLS) {
    for (const f of readdirSync(join(root, "skills", skill)).sort()) {
      out.push({ path: join(PLUGIN_DIR, "skills", skill, f), text: read(join("skills", skill, f)) });
    }
  }
  out.push({ path: join(PLUGIN_DIR, "LICENSE"), text: read("LICENSE") });
  out.push({ path: join(PLUGIN_DIR, "ADDITIONAL-TERMS.md"), text: read("ADDITIONAL-TERMS.md") });
  return out;
}

function main(argv) {
  const check = argv.includes("--check");
  const stale = [];
  for (const { path, text } of pluginCopies()) {
    const at = join(ROOT, path);
    const now = existsSync(at) ? readFileSync(at, "utf8") : null;
    if (now === text) continue;
    if (check) { stale.push(path); continue; }
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
    console.log(`plugin-folder: wrote ${relative(ROOT, at)}`);
  }
  if (check && stale.length) {
    console.error(`plugin-folder: STALE. ${stale.length} copied file(s) differ from their sources:`);
    for (const p of stale) console.error(`  ${p}`);
    console.error("Re-mint: node scripts/mint-plugin-folder.mjs");
    return 1;
  }
  if (check) console.log("plugin-folder: current");
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
