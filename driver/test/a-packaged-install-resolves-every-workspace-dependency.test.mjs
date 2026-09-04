// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a tarball install resolves the ROOT's dependencies and nobody else's.
//
// `npm install -g ./clearotron-<v>.tgz` installs what the ROOT package.json declares. The workspace
// folders arrive inside the archive as plain files; their own `dependencies` are never installed,
// because a tarball is one package and workspaces are a repo-time arrangement.
//
// IT WORKS TODAY ONLY BECAUSE THE ROOT HAPPENS TO BE A SUPERSET. Nothing enforces that. Add a runtime
// dependency to `driver/` and not to the root and the packaged install breaks at require time — while
// every test in this repository passes, because this repository is only ever exercised from a workspace
// install where that dependency IS present. The failure is invisible from the one place it is looked for.
//
// This asserts a PROXY for the real property, and the trade is worth stating rather than discovering: the
// honest end-to-end test is installing the tarball on a clean home and running the bins, which needs a
// machine CI does not have. That belongs to the ceremony's packaged-install step and is driven there. The
// set comparison is what fails on the COMMIT that breaks it rather than at the flip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

/**
 * Workspaces whose runtime dependencies a packaged install would NOT install.
 *
 * BUILD-ONLY WORKSPACES ARE EXCLUDED BY NAME, WITH THE REASON BESIDE THEM — never by a silent filter,
 * because an exclusion nobody can see is how a real gap gets classified as expected.
 */
const BUILD_ONLY = Object.freeze({
  "portal-ui": "its BUILT output ships (`portal-ui/dist/`), so react and react-dom are needed to build "
    + "the bundle and never at run time. If `portal-ui/dist/` ever stops shipping, this exclusion is "
    + "wrong and this comment is where to start.",
});

export function unresolvableWorkspaceDeps(rootPkg, workspacePkgs) {
  const rootDeps = new Set(Object.keys(rootPkg.dependencies ?? {}));
  const out = [];
  for (const { name, pkg } of workspacePkgs) {
    if (name in BUILD_ONLY) continue;
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!rootDeps.has(dep)) out.push(`${name} needs ${dep}, which the root does not declare`);
    }
  }
  return out;
}

test("#1929 every workspace's runtime dependency is one the root install would resolve", () => {
  const rootPkg = read("package.json");
  const names = rootPkg.workspaces ?? [];
  // THE POPULATION IS ASSERTED BEFORE IT IS WALKED. An empty workspace list makes the loop below find
  // nothing and the assertion pass having compared no packages at all.
  assert.ok(names.length >= 3, `only ${names.length} workspace(s) declared — the reader has broken, not the tree`);

  const workspacePkgs = names.map((name) => ({ name, pkg: read(join(name, "package.json")) }));
  const declaring = workspacePkgs.filter((w) => Object.keys(w.pkg.dependencies ?? {}).length > 0);
  assert.ok(declaring.length >= 2,
    `only ${declaring.length} workspace(s) declare any dependency — if this is right the arm is nearly `
    + "vacuous and should be re-read; if it is wrong the reader has broken");

  assert.deepEqual(unresolvableWorkspaceDeps(rootPkg, workspacePkgs), [],
    "a packaged install installs the ROOT's dependencies only. Anything a workspace needs at run time "
    + "and the root does not declare is absent for every stranger who installs from the registry, and "
    + "present for everyone who runs this repository — so no test here would ever see it. Add it to the "
    + "root's `dependencies`.");
});

test("#1929 the predicate catches a workspace-only dependency, and honours the stated exclusion", () => {
  const rootPkg = { dependencies: { undici: "^6", jose: "^6" } };
  assert.deepEqual(unresolvableWorkspaceDeps(rootPkg, [{ name: "driver", pkg: { dependencies: { undici: "^6" } } }]), []);
  assert.deepEqual(
    unresolvableWorkspaceDeps(rootPkg, [{ name: "driver", pkg: { dependencies: { exceljs: "^4" } } }]),
    ["driver needs exceljs, which the root does not declare"]);
  // The exclusion must actually exclude — otherwise it is a comment, not a rule.
  assert.deepEqual(
    unresolvableWorkspaceDeps(rootPkg, [{ name: "portal-ui", pkg: { dependencies: { react: "^19" } } }]), []);
  assert.ok(BUILD_ONLY["portal-ui"].length > 40, "an exclusion carries its reason or it is not one");
});
