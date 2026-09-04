// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A repo root whose `<repo>/.env` the FIXTURE decides.
//
// `doctor` reads `<repo>/.env` deliberately — `bin/onboard.mjs`'s `readEnvFile` calls the engine's own
// loader with a throwaway env object, so it REPORTS the file without applying it. That is correct and
// must stay: the one command whose job is to describe an install would be useless if a flag could blind
// it to the file it exists to report on.
//
// The consequence is that any arm asserting what doctor says about configuration was really asserting
// what the machine running the suite happens to have. Every CI runner has no `.env`, every real install
// has one, and three arms in one family passed in CI and failed on a deployed box for exactly that
// reason. `CLEAROTRON_NO_ENV_FILE` cannot help — it governs whether the file CONFIGURES a process, not
// whether doctor may read it.
//
// So the fixture supplies its own repo root instead of inheriting the developer's.
//
// WHY `bin/` IS COPIED AND EVERYTHING ELSE IS SYMLINKED. `REPO` is `dirname(onboard.mjs)/..`, resolved
// from the module's own location — and Node resolves symlinks, so a symlinked `bin/` would resolve
// straight back to the real checkout and the whole point would be lost. The copy makes the temp
// directory genuinely the repo root; the symlinks mean nothing is duplicated and no dependency is
// stale, because `../shared`, `../driver` and `node_modules` all point at the tree under test.

import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REAL_REPO = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "");

/** Everything `bin/*.mjs` reaches for. Symlinked, so the arm tests THIS tree and not a copy of it. */
const LINKED = ["shared", "driver", "providers", "mcp-server", "scripts", "portal-ui", "examples",
                "node_modules", "package.json", "package-lock.json"];

/**
 * A temp repo root with the `.env` you name, and the real tree behind it.
 *
 * @param {Record<string,string>|null} envFile lines to write into `<repo>/.env`; null writes no file at
 *   all, which is the "nothing is configured" state a hermetic runner used to get by accident.
 * @returns {{ root: string, onboard: string }}
 */
export function hermeticInstallRoot(envFile = null) {
  const root = mkdtempSync(join(tmpdir(), "hermetic-repo-"));
  mkdirSync(join(root, "bin"), { recursive: true });
  cpSync(join(REAL_REPO, "bin"), join(root, "bin"), { recursive: true });
  for (const entry of LINKED) {
    const from = join(REAL_REPO, entry);
    if (existsSync(from)) symlinkSync(from, join(root, entry));
  }
  if (envFile) {
    writeFileSync(join(root, ".env"),
      Object.entries(envFile).map(([k, v]) => `${k}=${v}\n`).join(""), "utf8");
  }
  return { root, onboard: join(root, "bin", "onboard.mjs") };
}
