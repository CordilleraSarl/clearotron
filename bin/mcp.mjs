#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// mcp.mjs — `clearotron mcp`: the MCP server over stdio, started from the package itself.
//
// An install's own connect lines run the server from that install's copy (shared/stdio-connect.mjs), so
// an assistant never keeps an old server after an upgrade, and they stay as they are. This verb is for a
// machine with no install, and for a listing that launches the published package with `npx`.
//
// WHICH RUNS IT READS. An install's, wherever one is found; the demo's four sample runs where none is.
// Standard output belongs to the protocol from its first byte, so nothing here prints to it.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { demoMode } from "../mcp-server/demo-mode.mjs";

/** The two settings the install's own connect lines hand the server: where runs are, and where reports are. */
export const INSTALL_FOLDERS = Object.freeze(["CLEAROTRON_WORK_DIR", "CLEAROTRON_REPORTS_DIR"]);

/** The demo's own base, and where it keeps its runs and its access log: the layout `installPaths` gives it. */
export const demoBase = (home = homedir()) => join(home, "trademark-demo");
export const demoWorkspace = (home = homedir()) => join(demoBase(home), "workspace");

/**
 * WHAT COUNTS AS AN INSTALL, and so whether this server reads an install's runs or the demo's. PURE.
 *
 * An install is any one of these:
 *   - a work folder or a reports folder named in this process's environment, in the settings file a
 *     packaged install writes (`~/.config/clearotron/.env`), or in the file a background install's
 *     services read (`~/.env`);
 *   - either of those files carrying any Clearotron setting at all, which is an install configured and
 *     not yet pointed at its folders: the server then reads its default and names what is missing;
 *   - the default workspace, `~/trademark/workspace`, on disk.
 * The demo writes neither file and keeps its runs under its own base, so a machine that has only run the
 * demo still reads as no install. An install never gets the demo: a misconfigured one is refused by name.
 *
 * Returns the folders to hand the server (only what is set, and never over the environment's own value),
 * or `demo: true` where there is no install.
 */
export function mcpTarget({ env = process.env, home = homedir(), exists = existsSync, read = (p) => readFileSync(p, "utf8") } = {}) {
  const parsed = (p) => { try { return parseEnv(read(p)); } catch { return null; } };
  const settings = parsed(join(home, ".config", "clearotron", ".env"));
  const services = parsed(join(home, ".env"));
  const set = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const folders = {};
  for (const k of INSTALL_FOLDERS) {
    const v = set(env[k]) ?? set(settings?.[k]) ?? set(services?.[k]);
    if (v) folders[k] = v;
  }
  const configures = (file) => Boolean(file) && Object.keys(file).some((k) => /^(CLEAROTRON|TRADEMARK|PORTAL)_/.test(k));
  const install = Object.keys(folders).length > 0 || configures(settings) || configures(services)
    || exists(join(home, "trademark", "workspace"));
  return install ? { demo: false, env: folders } : { demo: true, env: {} };
}

async function main() {
  const target = mcpTarget();
  if (target.demo) {
    // The four sample runs, copied where the connector walks, under the demo's own base: nothing is
    // written anywhere an install reads (driver/demo-container.mjs).
    const { seedDemoRuns } = await import("../driver/demo-container.mjs");
    const workspace = demoWorkspace();
    seedDemoRuns({ workspace, examplesDir: join(import.meta.dirname, "..", "demo") });
    process.env.CLEAROTRON_WORK_DIR = workspace;
    // The door's access log too, which would otherwise open the install's own telemetry folder.
    if (!set(process.env.TRADEMARK_MCP_AUDIT_LOG)) process.env.TRADEMARK_MCP_AUDIT_LOG = join(demoBase(), "telemetry", "trademark-mcp-access.jsonl");
    demoMode.on = true;
  } else {
    for (const [k, v] of Object.entries(target.env)) if (!set(process.env[k])) process.env[k] = v;
  }
  // The server starts through the entry that refuses an old Node in one plain line before it loads.
  await import("../mcp-server/serve.mjs");
}

const set = (v) => typeof v === "string" && v.trim() !== "";

if (isEntrypoint(import.meta.url)) await main();
