// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// "Was this module run directly?" — answered so that a symlink does not turn a tool into a no-op.
//
//. Sixteen entry points guarded main with `import.meta.url === \`file://${process.argv[1]}\``.
// That compares the RESOLVED module URL against the LITERAL invocation path, so under any symlinked
// path the two differ, the guard is false, and the script **exits 0 having done nothing**. Not an
// error, not a usage message — success, silently. Measured before the fix, on a symlink to
// `scripts/unexecuted-asserts.mjs`:
//
//     node scripts/unexecuted-asserts.mjs   →  usage: …            exit 2
//     node <symlink-to-it>                  →  (no output)         exit 0
//
// A CLI that silently succeeds is worse than one that fails: a wrapper, a `$PATH` shim, an installer
// that links into `bin/`, or a macOS `/tmp` → `/private/tmp` path all produce it, and every caller
// reads the 0 as "ran, nothing to report".
//
// ONE IMPLEMENTATION, not sixteen copies. The issue proposed replicating `scripts/compare.mjs:470`'s
// inline form at every site; sixteen hand-written copies of a comparison are sixteen chances to write
// the fifteenth wrong, and nothing would notice — the failure mode is silence. A predicate is the same
// fix with one place to be correct, and it absorbs the three call shapes already in the tree (an `if`
// block, a one-line `if`, and an assignment using a destructured `argv`).

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} importMetaUrl  the caller's own `import.meta.url`
 * @returns {boolean} true when this module is the process entry point
 *
 * Both sides are resolved through `realpathSync`, which is what makes a symlinked invocation answer
 * true. Either side can throw — a path that no longer exists, a permission error — and a guard that
 * throws would break a tool that today merely does nothing, so it answers FALSE and lets the module
 * stay importable. That is the conservative direction: a library import must never run main().
 */
export function isEntrypoint(importMetaUrl) {
  const argv1 = process.argv[1];
  if (!argv1 || !importMetaUrl) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
