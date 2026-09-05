// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT COUNTS AS A FROZEN DEMO — one rule, one file.
//
// `demo/` is a container holding one frozen run per product the engine sells, named by the product's own
// id. Three things in this repository decide whether a child in it is usable, and they answered
// DIFFERENTLY:
//
//   bin/example.mjs          the player a stranger runs — demanded meta.json + run/report.md
//   cut/packed-artifact.mjs  the pack gate — learned the knockout shape only because it refused
//   scripts/pack-publishable.mjs  printed the player's old rule in its refusal message
//
// A knockout demo has NO report.md and never will: for that lane the markdown is an OUTPUT of publishing
// rather than an input to it, and `knockout-findings.json` is what the publisher reads as its source. So
// `demo/knockout-search` shipped — in the git tree AND in the npm tarball, all sixteen files including the
// research payloads its receipts door reads — and the player could not list it, choose it, or default to
// it. `--product knockout-search` exited 1 naming only the other three: the product enumerated three while
// the gate counted four.
//
// The defect was not the predicate. The defect was that the predicate existed in more than one place, so
// teaching one site the knockout shape left the others behind — which is exactly what happened, twice, one
// stage apart. This module is the single answer. `cut/` cannot import it (that directory does not travel
// and this one does), so the pack gate restates the disjunction and its own test pins the two together.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The entry file each lane's publisher reads as its source, in the order a child is probed for one. */
export const ENTRY_FILES = Object.freeze(["report.md", "knockout-findings.json"]);

/** The entry file this child actually carries, or null. NULL IS THE ANSWER "no", never "not looked". */
export function entryFile(dir) {
  for (const f of ENTRY_FILES) if (existsSync(join(dir, "run", f))) return f;
  return null;
}

/** A child is frozen when it carries a manifest AND its lane's entry file. Both, or it is not one. */
export function isFrozen(dir) {
  return existsSync(join(dir, "meta.json")) && entryFile(dir) !== null;
}

/**
 * Every frozen child of a container, by product id, sorted so the default is stable across machines.
 * An unreadable container is an empty list rather than a throw: the caller reports the absence itself,
 * naming the directory it looked in, which is a better message than a stack trace.
 */
export function demoChildren(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    .filter((n) => isFrozen(join(root, n)));
}
