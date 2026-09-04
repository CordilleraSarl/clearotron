#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Copy every agent's recall store into the archive pool, so the engine's memory of confirmed
// conflicts survives the loss of a workspace.
//
// WHY THIS EXISTS. `<studioRoot>/_known-conflicts/<mark>.json` is what stops the engine re-litigating
// a conflict a lawyer already confirmed, and what carries a remembered opposition window into the
// deadline-carry clamp. It lives only in the live workspace: no code copies it anywhere, and the
// agent-state git backup does not reach it. One lost disk and every prior confirmed conflict is
// forgotten silently — the next run on that mark reads clean and nothing says a memory used to exist.
//
// WHY THE POOL AND NOT GIT. These files name real client matters. The agent-state repo is pushed to
// GitHub nightly, so backing them up THERE would widen exactly the exposure the 2026-07 audit found
// (client matter reaching a shared repo). The archive pool is the access-controlled home for client
// data — the same doctrine that moved the quality corpus out of the integrator-platform repo — and it is what the
// VM-level snapshot covers.
//
// Idempotent, additive, and never deletes: a mark that disappears from a workspace keeps its last
// backed-up copy, because the failure this guards against is loss, not staleness.
//
//   node scripts/backup-recall-stores.mjs [--dry-run]
//
// Suggested cron (after the pool exists, before the nightly snapshot window):
//   30 1 * * *  cd ~/clearotron && node scripts/backup-recall-stores.mjs >> ~/trademark/logs/recall-backup.log 2>&1

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readdirSync, existsSync, mkdirSync, copyFileSync, statSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { config } from "../driver/driver.config.mjs";

const DRY = process.argv.includes("--dry-run");
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function storesFor(agentId) {
  const dir = join(config.studioRootForAgent(agentId), "_known-conflicts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } });
}

// Agents are discovered from the queue dirs the driver already scans — no hardcoded roster, same
// reason queueDir() in the MCP ops face derives its own.
function agents() {
  const found = new Set([config.defaultAgent]);
  for (const q of config.queueDirs) {
    const id = config.agentIdFromQueueDir(q);
    if (id) found.add(id);
  }
  return [...found];
}

let copied = 0, skipped = 0, unreadable = 0;
const dest = join(config.poolRoot, "_state", "known-conflicts");

for (const agentId of agents()) {
  const files = storesFor(agentId);
  if (!files.length) continue;
  const outDir = join(dest, agentId);
  if (!DRY) mkdirSync(outDir, { recursive: true });
  for (const src of files) {
    const out = join(outDir, basename(src));
    // A store the engine itself could not parse is still backed up verbatim — this script's job is
    // custody, not judgement — but it is REPORTED, because an unreadable store silently disables the
    // recall clamps at run time and nobody would otherwise know.
    try { JSON.parse(readFileSync(src, "utf8")); }
    catch { unreadable++; console.warn(`  ! unparseable (backed up anyway, but the recall clamps skip it at run time): ${src}`); }
    try {
      if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) { skipped++; continue; }
      if (!DRY) copyFileSync(src, out);
      copied++;
    } catch (e) {
      console.error(`  ! copy failed for ${src}: ${String(e?.message ?? e)}`);
      process.exitCode = 1;
    }
  }
}

console.log(`[${stamp()}] recall-store backup${DRY ? " (dry run)" : ""} → ${dest}: ${copied} copied, ${skipped} already current${unreadable ? `, ${unreadable} UNPARSEABLE` : ""}`);
if (!copied && !skipped) console.log("  (no recall stores found — nothing to back up yet)");
