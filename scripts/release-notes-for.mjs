// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-notes-for.mjs — the GitHub release says what the changelog says.
//
// The changelog is written for a reader, in plain English, and checked at compile time by
// `release-version.mjs`. The GitHub release page is the same reader arriving from a different door, so
// it gets the same words rather than a list of commit subjects — which is what `--generate-notes` would
// hand them, and which is written for people with the repository open.
//
// PRINTS NOTHING AND EXITS 0 WHEN THERE IS NO SECTION. That is not an error: the first release cut
// before the changelog exists is a real state, and the workflow falls back to generated notes. It is
// also why this must never print a heading or a placeholder — an empty stdout is the signal.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This version's section of the changelog, without its heading, or "" when there is none. */
export function notesFor(version, changelog) {
  // Split on the headings rather than matching a range: a lookahead for "the next heading or end of
  // file" is the shape that silently returns nothing for the LAST section of a file, and the newest
  // release is the first section, never the last, only until a second one lands.
  const sections = changelog.split(/^## /m).slice(1);
  const mine = sections.find((sec) => sec.split("\n", 1)[0].trim() === version);
  return mine ? mine.split("\n").slice(1).join("\n").trim() : "";
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node scripts/release-notes-for.mjs <version>");
    process.exitCode = 2;
    return;
  }
  const p = join(ROOT, "CHANGELOG.md");
  if (!existsSync(p)) return;
  const notes = notesFor(version, readFileSync(p, "utf8"));
  if (notes) process.stdout.write(notes + "\n");
}

if (isEntrypoint(import.meta.url)) main();
