// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What we declare we depend on, against what we actually ship — tracker issues 99 and 115.
//
// Two failures of the same shape, both silent, both invisible to every check that existed:
//
//   99  `@anthropic-ai/sdk` was declared a PRODUCTION dependency in two manifests and imported by
//       nothing. A stranger installing the product downloaded an AI vendor SDK the code never calls,
//       and three documents told them it was load-bearing. An unused production dependency installs
//       cleanly, audits clean, and no test can tell the difference.
//
//   115 `fast-uri` was a production dependency missing from THIRD-PARTY-NOTICES, while the arm
//       watching that file passed 14/14. The arm regenerated the file and compared — a check using its
//       own producer as its evidence, which can never see the producer's blind spot.
//
// So the arms below are built to a rule: NEITHER MAY ASK THE THING IT IS CHECKING. The notices arm
// derives its expected population from npm's own tree with a traversal that is deliberately not the
// generator's, and the import arm reads the manifests and greps the tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { collect } from "../../scripts/third-party-notices.mjs";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Every manifest that declares production dependencies shipped with the product. */
const MANIFESTS = ["package.json", "driver/package.json", "portal-ui/package.json"];

/**
 * Packages that may be declared without an import, each with the reason.
 *
 * A NAME HERE IS A CLAIM SOMEBODY MADE ON PURPOSE. It is not a place to silence a failure — the entry
 * has to say why the package is needed by something other than an import, and a reader must be able to
 * check that reason.
 */
const NO_IMPORT_EXPECTED = Object.freeze({
  buffers:
    "Not a dependency of OUR code and deliberately so — it is the clean-room replacement for the "
    + "unlicensed buffers@0.1.1 (#854), vendored at vendor/buffers and forced over the real package by "
    + "`overrides: { buffers: \"$buffers\" }`. A TRANSITIVE dependency requires it; we import it "
    + "nowhere. driver/test/unlicensed-buffers-is-gone.test.mjs is what proves the substitution holds.",
});

function manifestDeps(rel) {
  const p = join(REPO, rel);
  if (!existsSync(p)) return null;   // an absent manifest is a could-not-look, handled by the caller
  return Object.keys(JSON.parse(readFileSync(p, "utf8")).dependencies ?? {});
}

/** Non-test source that ships. `.js` and `.ts` are in: providers carry non-test `.js`. */
function shippedSources() {
  const tracked = execFileSync("git", ["-C", REPO, "ls-files", "*.mjs", "*.js", "*.ts", "*.tsx"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }).split("\n").filter(Boolean);
  return tracked.filter((f) => !/(^|\/)(test|tests|bench)\//.test(f) && !/\.test\.(mjs|ts|js|tsx)$/.test(f));
}

test("tracker issue 99 — every production dependency is imported by something that ships", () => {
  const sources = shippedSources();
  nonEmpty(sources, "no shipped sources were walked, so every dependency would read as unused");
  const text = sources.map((f) => readFileSync(join(REPO, f), "utf8")).join("\n");

  const unused = [];
  let checked = 0;
  for (const rel of MANIFESTS) {
    const deps = manifestDeps(rel);
    // AN ABSENT MANIFEST IS A FINDING, NOT A PASS. A manifest that moves or is renamed would
    // otherwise take its whole dependency list out of this check silently.
    assert.ok(deps !== null, `${rel} is missing — this arm cannot check the dependencies it declares`);
    for (const name of deps) {
      checked += 1;
      if (name in NO_IMPORT_EXPECTED) continue;
      // Static, dynamic and require, because one way is not a measurement — 99 was found by checking
      // all three and each alone would have missed a real call site elsewhere in the tree.
      const q = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const imported = new RegExp(
        `(from\\s*["'']${q}(/[^"'']*)?["''])`
        + `|(import\\s*\\(\\s*["'']${q}(/[^"'']*)?["''])`
        + `|(require\\s*\\(\\s*["'']${q}(/[^"'']*)?["''])`,
      ).test(text);
      if (!imported) unused.push(`${rel}: ${name}`);
    }
  }
  nonEmpty([String(checked)], "no dependencies were checked at all");
  assert.deepEqual(unused, [],
    "declared as a production dependency and imported by nothing that ships. Remove it from the "
    + "manifest, or add it to NO_IMPORT_EXPECTED with the reason it is needed without an import");
});

test("tracker issue 99 — the import check fails on a package nothing imports", () => {
  // THE GUARD HAS TO FAIL BEFORE IT PASSES. A green tree on the day it was written is exactly the
  // evidence that was not enough last time. Drive the negative through the same predicate.
  const sources = shippedSources();
  const text = sources.map((f) => readFileSync(join(REPO, f), "utf8")).join("\n");
  const fake = "a-package-this-tree-does-not-import-0000";
  const q = fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imported = new RegExp(`(from\\s*["'']${q}["''])|(require\\s*\\(\\s*["'']${q}["''])`).test(text);
  assert.equal(imported, false, "the predicate claims an imaginary package is imported");

  // …and passes on one that genuinely is, so a predicate that simply always says false cannot pass
  // this file. `undici` is a declared production dependency with real call sites.
  const real = new RegExp(`from\\s*["']undici(/[^"']*)?["']`).test(text);
  assert.equal(real, true, "the predicate cannot see a real import, so its `false` means nothing");
});

test("tracker issue 115 — every production package npm resolves has a notices entry", () => {
  // ── DERIVED WITHOUT ASKING THE GENERATOR ─────────────────────────────────────────────────────
  //
  // The population comes from `npm ls` and is walked HERE, with a traversal that visits every
  // occurrence of every node. The generator's own walk descends once per package; that difference is
  // the entire bug this arm exists to catch, so restating the generator's logic would reproduce its
  // blind spot and pass. The evidence is then compared against the notices file AS TEXT.
  let raw;
  try {
    raw = execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
      cwd: REPO, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // npm exits non-zero for any tree problem while still printing the whole tree.
    raw = e.stdout;
  }
  assert.ok(raw && raw.trim(), "npm ls produced nothing — this arm could not look, which is not a pass");
  const tree = JSON.parse(raw);

  // OUR OWN PACKAGES ARE NOT THIRD PARTIES. Derived from every package.json TRACKED IN THIS REPO —
  // workspaces and the vendored clean-room `buffers` alike — rather than by calling the generator's
  // own `ourNames`, which would make this arm depend on the thing it is checking.
  const ours = new Set(
    execFileSync("git", ["-C", REPO, "ls-files", "package.json", "*/package.json", "*/*/package.json"],
      { encoding: "utf8" })
      .split("\n").filter(Boolean)
      .map((rel) => { try { return JSON.parse(readFileSync(join(REPO, rel), "utf8")).name; } catch { return null; } })
      .filter(Boolean),
  );
  nonEmpty([...ours], "no local package names were derived, so our own workspaces would read as third parties");

  const resolved = new Map();
  const stack = [tree];
  const guard = new Set();
  while (stack.length) {
    const node = stack.pop();
    for (const [name, d] of Object.entries(node?.dependencies ?? {})) {
      if (d?.version && !ours.has(name)) resolved.set(`${name}@${d.version}`, name);
      const id = `${name}@${d?.version}@${d?.path ?? ""}`;
      if (d?.dependencies && !guard.has(id)) { guard.add(id); stack.push(d); }
    }
  }
  nonEmpty([...resolved.keys()], "npm resolved no production packages, so this arm compared nothing");

  const notices = readFileSync(join(REPO, "THIRD-PARTY-NOTICES.md"), "utf8");
  const missing = [...resolved.keys()].filter((k) => !notices.includes(`## ${k}`));
  assert.deepEqual(missing, [],
    "production package(s) resolved by npm with no entry in THIRD-PARTY-NOTICES.md. Regenerate with "
    + "`node scripts/third-party-notices.mjs` — and if regenerating does not add them, the GENERATOR "
    + "is missing them and that is the defect, not the file");
});

test("tracker issue 115 — the generator descends through a deduped node", () => {
  // The mechanism, pinned directly. npm emits a hoisted package more than once and only one
  // occurrence carries its children; meeting the childless one first used to end the walk there and
  // silently drop the whole subtree. Driven on a synthetic tree so it cannot drift with npm's layout.
  const tree = {
    dependencies: {
      // the stub, met first — this is the shape that caused the bug
      alpha: { version: "1.0.0", path: null },
      host: {
        version: "2.0.0", path: null,
        dependencies: { alpha: { version: "1.0.0", path: null, dependencies: { deep: { version: "3.0.0", path: null } } } },
      },
    },
  };
  const rows = collect(REPO, tree).map((r) => `${r.name}@${r.version}`);
  assert.ok(rows.includes("deep@3.0.0"),
    "the walk stopped at the deduped occurrence and never reached its children — the tracker issue 115 defect");
});
