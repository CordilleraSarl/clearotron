// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pre-rename-spellings.mjs — names the identifier rename moved that an install still carries on disk.
//
// The internal identifier `prelim` became `clearance`. Where that identifier is only a name in the code, the
// rename is complete. Where it names something an install has already WRITTEN — a directory its runs live
// under, the session-key prefix its fetched records are filed by — the new name finds nothing, and nothing
// says so. Each such name is read in both spellings here, the old one as the new.
//
// ── The studio segment ──
//
// THE SEGMENT IS A PLACE ON DISK, NOT A NAME. Every run an install has made — its slug directories, its
// `archive/`, its queue, its matter ledger — sits under `<workspace>/studio/<segment>/`. The identifier
// rename changed the segment the code computes from `prelim-search` to `clearance-search`, which moves
// nothing on disk: it points every reader at an empty directory, and an empty directory reads as "no runs"
// and "no queued jobs", never as an error. So an install keeps the segment it has: the old spelling
// wherever that directory exists, and the new one only for an install that has no other.
//
// One definition, imported by every site that builds or recognises the path, including the scripts and
// servers that deliberately do not load the driver's configuration module.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The two spellings, the one every pre-rename install wrote under first: it wins wherever it exists. */
export const STUDIO_SEGMENTS = Object.freeze(["prelim-search", "clearance-search"]);

/** A regex source matching either spelling, for code that recognises a studio path rather than builds one. */
export const STUDIO_SEGMENT_RE = "(?:prelim|clearance)-search";

/** The segment the install under `workspaceDir` uses. */
export function studioSegmentFor(workspaceDir) {
  try { if (existsSync(join(String(workspaceDir ?? ""), "studio", STUDIO_SEGMENTS[0]))) return STUDIO_SEGMENTS[0]; }
  catch { /* unreadable ⇒ the new spelling, whose read then fails loudly where it happens */ }
  return STUDIO_SEGMENTS[1];
}

/** `<workspaceDir>/studio/<segment>`. */
export const studioDirFor = (workspaceDir) => join(String(workspaceDir ?? ""), "studio", studioSegmentFor(workspaceDir));

// ── The run's session-key prefix ──
//
// A run's register calls and fetched record bodies are filed under `<prefix><slug>-<codename>-…`, and the
// run's own readers filter by that prefix. A run started before the rename and resumed after it has rows
// under `prelim-` and is now asked about `clearance-`: its records would read as never fetched, and the
// delivery check fails the run on records it holds.
/** Every spelling of one run prefix: `[prefix, the same run under the other identifier]`. PURE. */
export function runPrefixSpellings(runPrefix) {
  const p = String(runPrefix ?? "");
  if (p.startsWith("clearance-")) return [p, `prelim-${p.slice("clearance-".length)}`];
  if (p.startsWith("prelim-")) return [p, `clearance-${p.slice("prelim-".length)}`];
  return [p];
}
