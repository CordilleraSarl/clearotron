// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// packaged-build.mjs — what a PACKAGED install knows about its own commit..
//
// `build-info.json` is written by `prepack` and ships inside the archive, so an install with no `.git`
// still knows exactly which commit it is. This reader was `bin/onboard.mjs`'s private helper and the
// driver could not reach it: `bin/onboard.mjs` pulls in the wizard's whole graph — readline, the engine
// probe, driver.config — and none of that belongs in the import closure of a module that runs on every
// publish. So the FUNCTION moves here and `bin/onboard.mjs` re-exports it. One implementation, two
// readers, which is what asks for: "reuse packagedBuild rather than writing a
// second reader of the same file."
//
// STRICT ABOUT THE SHA ON PURPOSE. A build-info that does not carry a full 40-hex commit answers `null`
// rather than something shaped like an answer — an unattributable install must stay visibly
// unattributable, because the whole point of the field is that a report can be joined to a diff.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `{ commit, version }` for a packaged install, or `null`.
 *
 * `read` is injected so the refusal cases can be driven without a filesystem — the arms this reader
 * already had in driver/test/update-refuses-on-a-packaged-install.test.mjs pass it a function.
 */
export function packagedBuild(repo, read = null) {
  const rd = read ?? ((p) => readFileSync(p, "utf8"));
  try {
    const b = JSON.parse(rd(join(repo, "build-info.json")));
    return /^[0-9a-f]{40}$/.test(String(b.commit ?? "")) ? { commit: b.commit, version: b.version } : null;
  } catch { return null; }
}
