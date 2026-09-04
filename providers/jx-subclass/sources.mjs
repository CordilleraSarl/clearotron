// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// sources.mjs — reading an office document that this repo deliberately does not carry.
//
// The office files and the verbatim extractions of them are not committed (see .gitignore and
// BUILDING.md). A script that needs one on a checkout without it must say WHICH file and WHY, not
// throw ENOENT with a stack trace: the reader's next question is "was I supposed to have that?" and a
// trace does not answer it. Same rule the loaders already follow — an absence is a finding.
import { readFileSync, existsSync } from "node:fs";

export function mustRead(path, why) {
  if (!existsSync(path)) {
    console.error(`ABSENT: ${path}`);
    console.error(`  needed for: ${why}`);
    console.error(`  This repo ships the BUILDER and public/, not the office documents. BUILDING.md`);
    console.error(`  lists what a re-derivation needs and where each source is recorded by hash.`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}
