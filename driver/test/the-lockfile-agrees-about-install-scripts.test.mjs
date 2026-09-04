// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE LOCKFILE AND package.json DISAGREE, AND EVERY BOX PAYS FOR IT DAILY.
//
// `3c44da6` added `"postinstall"` to the root `package.json` and did not commit the lockfile change it
// causes. npm records the PRESENCE of an install script in the lock, so the first install after that
// commit writes `"hasInstallScript": true` into the root entry — and every install on every box has
// been rewriting that line ever since, leaving the tree dirty.
//
// WHY A ONE-LINE DRIFT EARNED A GUARD. A dirty tree is a REFUSAL CONDITION in this fleet, not a
// cosmetic state: `sync-skills` refuses on one and covers three checkouts, `render-skills` refuses a
// dirty base, and `e2e.mjs` prints `DIRTY working tree` in the preflight notes of every paid run. The
// cost is not the line. It is that a refusal which fires every day is one nobody reads on the day it
// means something — and that happened here before anyone connected it: this file's author spent a
// morning reporting a blocked `sync-skills` as a finding without recognising it as the consequence of
// his own commit.
//
// WHY NOTHING CAUGHT IT. `npm ci` installs happily from a lock that lacks the field — it is a record of
// what npm found, not a constraint npm checks — so the whole suite, the gate and every deploy stayed
// green while the drift persisted. There is no install to make louder; the only place this can be seen
// is by comparing the two committed files, which is what this does.
//
// SO THE GUARD READS THE COMMITTED FILES AND RUNS NO INSTALL. That is the point: it fails in CI on the
// commit that introduces the drift, rather than on the next person's `git status`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// npm runs all three around an install, and any one of them sets the flag. Guarding only `postinstall`
// would guard the instance that bit us and leave the class open — the next person to add `preinstall`
// gets the identical silent drift.
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

/**
 * Every LOCAL package the lockfile describes: the root, plus each declared workspace.
 *
 * Registry dependencies are deliberately excluded — their `hasInstallScript` is a fact about a
 * published tarball, not something this repository can be wrong about. `esbuild` and `fsevents` carry
 * it legitimately, and asserting over them would make this guard fail on an unrelated dependency bump.
 */
function localPackages() {
  const rootPkg = readJSON(join(ROOT, "package.json"));
  const dirs = ["", ...(rootPkg.workspaces ?? [])];
  const out = dirs.map((d) => ({ key: d, manifest: join(ROOT, d, "package.json") }))
    .filter((p) => existsSync(p.manifest));

  // A discovered set that came back empty reports every absence below and reads as a clean tree —
  // 's census exists for exactly this, and the root alone would be a silent narrowing too.
  assert.ok(out.length > 1,
    `only ${out.length} local package(s) found. The workspace list is not resolving, so this guard is `
    + "comparing almost nothing and would pass over any drift in the packages it lost");
  return out;
}

const declaredInstallScripts = (manifest) => {
  const scripts = readJSON(manifest).scripts ?? {};
  return INSTALL_SCRIPTS.filter((s) => Object.hasOwn(scripts, s));
};

test("#2007 the lockfile agrees with every local package.json about whether it has an install script", () => {
  const lock = readJSON(join(ROOT, "package-lock.json"));
  const drift = [];

  for (const { key, manifest } of localPackages()) {
    const entry = lock.packages?.[key];
    // A package.json the lock has no entry for is a could-not-look, not an agreement.
    assert.ok(entry, `package-lock.json has no entry for ${key || "the root package"}, so this guard `
      + "cannot say whether they agree — regenerate the lock");

    const declared = declaredInstallScripts(manifest);
    const recorded = entry.hasInstallScript === true;
    if (declared.length > 0 !== recorded) {
      drift.push(`${key || "."}: package.json declares [${declared.join(", ") || "none"}] but the lock `
        + `says hasInstallScript=${entry.hasInstallScript ?? "absent"}`);
    }
  }

  assert.deepEqual(drift, [],
    "package.json and package-lock.json disagree about install scripts. `npm install` will rewrite the "
    + "lock on every box, every install, leaving every checkout dirty — and a dirty tree is a refusal "
    + "condition here (sync-skills, render-skills, and the e2e preflight all key on it). Fix it by "
    + "running `npm install` at the ROOT and committing package-lock.json; never by editing the lock "
    + "by hand and never with --no-save.\n  " + drift.join("\n  "));
});

test("#2007 the comparison can actually SEE a declared install script — CONTROL", () => {
  // Both halves of the reader are driven, because the arm above is an absence check and an absence
  // check whose reader is broken reports a clean tree. If `scripts` stopped resolving, every package
  // would read as declaring nothing, the lock's `absent` would agree with it everywhere, and the drift
  // this file exists for would be invisible.
  const root = join(ROOT, "package.json");
  assert.deepEqual(declaredInstallScripts(root), ["postinstall"],
    "the root no longer declares `postinstall`. If that was deliberate the lock must lose "
    + "`hasInstallScript` in the same commit; if it was not, the push guards no longer arm themselves "
    + "on install, which is tracker issue 1978 back again");

  // And the negative direction, so the reader is not simply returning everything it is asked about.
  assert.deepEqual(declaredInstallScripts(join(ROOT, "driver", "package.json")), [],
    "a workspace that declares no install script read as declaring one — the reader is matching "
    + "something other than the three script names");
});
