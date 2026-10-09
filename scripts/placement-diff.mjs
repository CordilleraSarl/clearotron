#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-diff.mjs —: what did the placement tier do between two runs of the same matter?
//
//   node scripts/placement-diff.mjs --a <run dir> --b <run dir> [--json]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// needs the noise floor of the model-authored placement tier, and its offline half is answered:
// the band-shape seam moves its input, so the branch is taken and the floor needs repeat PAID arms on
// one matter. Nothing in the tree compared two `placements.json`, so the round would have spent two full
// R2 arms and then eyeballed a table.
//
// Read-only and free: no model turn, no register call, no queue admission, nothing written anywhere.
//
// ── which directory ──────────────────────────────────────────────────────────────────────────────────
//
// The agent WORKSPACE archive dir, not the published pool dir — the pool keeps report.md and
// findings.json but not `placements.json`. Same discipline as band-shape-probe.mjs, and the refusal
// below says so rather than reporting an empty diff.
//
// ── what it will NOT do ──────────────────────────────────────────────────────────────────────────────
//
// It does not say which arm is right. A tier is a lawyer's judgment and two competent answers can
// differ; this counts how often they did and on which boundary, and stops there.

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

import { parsePlacementsJson } from "../driver/placement-model.mjs";
import { diffPlacements, renderPlacementDiff } from "../driver/placement-diff.mjs";

const die = (msg) => { process.stderr.write(`\n${msg}\n\n`); process.exit(2); };

const opts = { a: null, b: null, json: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === "--a") opts.a = argv[++i];
  else if (k === "--b") opts.b = argv[++i];
  else if (k === "--json") opts.json = true;
  else die(`unknown argument ${k}\n  usage: placement-diff.mjs --a <run dir> --b <run dir> [--json]`);
}
if (!opts.a || !opts.b) die("usage: placement-diff.mjs --a <run dir> --b <run dir> [--json]");

const load = (dir, which) => {
  if (!existsSync(dir)) die(`no run directory at ${dir} (--${which})`);
  const p = join(dir, "placements.json");
  if (!existsSync(p)) {
    die(`no placements.json under ${dir} (--${which})\n`
      + "  This needs the WORKSPACE archive dir, not the published pool dir — the pool keeps report.md\n"
      + "  and findings.json but not the placement mirror.\n"
      + "  An absent mirror is a finding about that run, not an empty diff.");
  }
  let parsed;
  try { parsed = parsePlacementsJson(readFileSync(p, "utf8")); }
  catch (e) { die(`${p} did not parse: ${String(e?.message ?? e)}\n  A malformed mirror is validators.placement's business; refusing rather than diffing half of it.`); }
  const list = parsed.placements ?? [];
  if (!list.length) die(`${p} holds no placements — an empty mirror is a finding about that run, not a clean diff.`);
  return list;
};

const labelA = basename(opts.a) || "A";
const labelB = basename(opts.b) || "B";
if (labelA === labelB) die(`both directories are named "${labelA}" — the report keys its columns on the directory name, so two identical labels would be unreadable.`);

const d = diffPlacements(load(opts.a, "a"), load(opts.b, "b"), { labelA, labelB });

if (opts.json) process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
else process.stdout.write(`${renderPlacementDiff(d)}\n`);
process.exit(0);
