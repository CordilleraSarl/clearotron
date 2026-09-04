// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — PRODUCT CODE DOES NOT NAME `_driver`. ONE MODULE DOES.
//
// 1138 sites across 226 files built this path by hand. They are gone: `driverDir(base, …)` for a path
// under a run, `driverRel(…)` for the run-RELATIVE form the path registry declares, `DRIVER_DIR` for a
// comparison against a directory entry's name, `ensureDriverDir(base, …)` to create it.
//
// ── WHY THE GUARD IS ON THE LITERAL AND NOT ON A SHAPE ────────────────────────────────────────────
//
// The first version of this file guarded the SHAPE — `mkdir…("…_driver…")` — and it was not total, in
// two ways that both read as green:
//
//   · IT MATCHED ONE QUOTE STYLE. `"_driver"` only. `driver/publish/` quotes with apostrophes, so a
//     real product creation site — knockout.mjs, `mkdirSync(join(runDir, '_driver'), …)` — sat outside
//     a guard whose commit message called it total. Nineteen was the wrong count; twenty was right.
//   · A REGEX CANNOT SEE A NESTED BASE. `join(dirname(p), "_driver", …)` does not match
//     `join\([^)]*"_driver"`, because the character class stops at the inner `)`. About twenty sites
//     were invisible to every count taken by grep, including the ones in this issue's own filing.
//
// A guard on the LITERAL has neither failure. There is nothing to parse: the name appears in product
// code, or it does not. That is only possible because every population can now be expressed — which is
// why `driverRel` exists, and why the accessor could not have been landed usefully without it.
//
// SCOPE, STATED ON ITS FACE: **product code**. Fixtures still write the name, deliberately — a test that
// pins an on-disk name must write that name, or it is asserting the accessor against itself and will
// certify its own defect. That is not a hypothetical: an earlier draft of the recursion arm below did
// exactly that and survived a plant that broke the accessor outright.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { grepTrackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { DRIVER_DIR, driverDir, driverRel, ensureDriverDir } from "../../shared/driver-dir.mjs";

const GUARD = "driver-dir-has-one-creator";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFINES_IT = "shared/driver-dir.mjs";
/** This file quotes the shapes it forbids, in prose and in failure messages. It cannot be its own subject. */
const GUARD_FILE = "driver/test/driver-dir-has-one-creator.test.mjs";

/** A fixture, not the product. */
const isFixture = (p) => /(^|\/)test\//.test(p) || /\.test\.mjs$/.test(p) || /_fixture/.test(p);

/** `//`-led lines are commentary — this file and the module both quote the old shape when explaining it.
 *  Crude, and crude in the safe direction: a block comment whose continuation lines start with neither
 *  `//` nor `*` reads as code, so prose could RED this guard. Loud and fixable. The inverse — prose
 *  hiding a call site — is the failure that would pass silently, and nothing written this way makes it. */
const isComment = (text) => /^\s*(\/\/|\*|\/\*)/.test(text);

const parse = (hits) => hits.map((h) => {
  const i = h.indexOf(":"), j = h.indexOf(":", i + 1);
  return { file: h.slice(0, i), line: Number(h.slice(i + 1, j)), text: h.slice(j + 1) };
});

const grep = (t, args) => {
  const hits = grepTrackedFiles(GUARD, { root: REPO, args });
  if (hits === null) { t.skip(skipReason(GUARD)); return null; }
  return parse(hits);
};

test("#1336 — the accessors are actually in use, so every arm below has something to be about", (t) => {
  const all = grep(t, ["-nF", "driverDir(", "--", "*.mjs", "*.js"]);
  if (!all) return;
  const lines = all.filter((h) => !isComment(h.text)).length;
  assert.ok(lines >= 900,
    `only ${lines} lines call driverDir() across the tree — #1336 converted 1138 sites. A collapse here `
    + `means the sweep was reverted, and the emptiness arms below would then pass by having nothing left `
    + `to find. This arm is asserted first for that reason.`);
});

test("#1336 — no product code names `_driver`", (t) => {
  const hits = grep(t, ["-nE", `["']_driver["']`, "--", "*.mjs", "*.js"]);
  if (!hits) return;
  const offenders = hits.filter((h) => !isFixture(h.file) && !isComment(h.text) && h.file !== DEFINES_IT);
  assert.deepEqual(offenders.map((h) => `${h.file}:${h.line}`), [],
    `these name the directory instead of reaching it through shared/driver-dir.mjs:\n`
    + offenders.map((h) => `  ${h.file}:${h.line} ${h.text.trim()}`).join("\n")
    + `\n\nUse driverDir(base, …) for a path under a run, driverRel(…) for the run-relative form, `
    + `DRIVER_DIR to compare against a directory entry's name, ensureDriverDir(base, …) to create it. `
    + `The name lives in one file (#1336) so that moving or re-permissioning this directory is a decision `
    + `rather than a sweep of 1138 sites.`);
});

test("#1336 — product code creates the directory only through ensureDriverDir", (t) => {
  const hits = grep(t, ["-nE", String.raw`mkdir[A-Za-z]*\(\s*driverDir\(`, "--", "*.mjs", "*.js"]);
  if (!hits) return;
  const offenders = hits.filter((h) => !isFixture(h.file) && !isComment(h.text));
  assert.deepEqual(offenders.map((h) => `${h.file}:${h.line}`), [],
    `these create \`_driver/\` with a bare mkdir instead of ensureDriverDir():\n`
    + offenders.map((h) => `  ${h.file}:${h.line} ${h.text.trim()}`).join("\n")
    + `\n\nCreation is where the directory's MODE would be decided. One call site means one line to change; `
    + `twenty means twenty that must agree and keep agreeing, which is how it came to be 775 by accident.`);

  const adopters = grep(t, ["-nF", "ensureDriverDir(", "--", "*.mjs", "*.js"]);
  if (!adopters) return;
  const product = adopters.filter((h) => !isFixture(h.file) && !isComment(h.text) && h.file !== DEFINES_IT);
  assert.ok(product.length >= 20,
    `only ${product.length} product call sites of ensureDriverDir() — #1336 converted 20. Fewer means a `
    + `creation went back to being hand-built somewhere the pattern above no longer sees.`);
});

test("#1336 — the run-relative form has adopters too", (t) => {
  const hits = grep(t, ["-nF", "driverRel(", "--", "*.mjs", "*.js"]);
  if (!hits) return;
  const callers = hits.filter((h) => !isComment(h.text) && h.file !== DEFINES_IT);
  assert.ok(callers.length >= 30,
    `only ${callers.length} driverRel() call sites — driver/stages.mjs alone declares 29. This helper `
    + `exists for the path registry; if its callers vanish the registry has gone back to a literal.`);
});

test("#1336 — nothing shadows the accessors with a local of the same name", (t) => {
  const hits = grep(t, ["-nE", String.raw`(const|let|var)\s+(driverDir|driverRel|ensureDriverDir|DRIVER_DIR)\s*=`,
    "--", "*.mjs", "*.js"]);
  if (!hits) return;
  // Only where it can actually shadow: the file must import THAT name. `driver/pipeline.mjs` has had its
  // own `const DRIVER_DIR = dirname(fileURLToPath(import.meta.url))` — the driver's SOURCE directory,
  // an unrelated meaning — since long before this module existed. It imports driverDir(), not
  // DRIVER_DIR, so nothing is shadowed and nothing is wrong; a rule that flagged it would be a naming
  // opinion wearing a guard's clothes. If that file ever imports DRIVER_DIR the collision is a duplicate
  // declaration, which is a SyntaxError at load — loud, immediate, and not this guard's job.
  const importLines = grep(t, ["-nE", String.raw`^import \{[^}]*\} from ["'][^"']*driver-dir\.mjs["']`,
    "--", "*.mjs", "*.js"]);
  if (!importLines) return;
  assert.ok(importLines.length >= 100,
    `only ${importLines.length} files import shared/driver-dir.mjs — #1336 left 226 importing it. `
    + `A collapsed importer set makes the assertion below vacuous, so it is asserted first.`);
  const importedBy = new Map(importLines.map((h) =>
    [h.file, new Set((h.text.match(/\{([^}]*)\}/)?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean))]));
  const offenders = hits.filter((h) => !isComment(h.text) && h.file !== DEFINES_IT && h.file !== GUARD_FILE
    && importedBy.get(h.file)?.has((h.text.match(/(?:const|let|var)\s+(\w+)\s*=/) ?? [])[1]));
  assert.deepEqual(offenders.map((h) => `${h.file}:${h.line}`), [],
    `these declare a local with an accessor's name, in a file that imports that accessor:\n`
    + offenders.map((h) => `  ${h.file}:${h.line} ${h.text.trim()}`).join("\n")
    + `\n\nA const shadows the import across its WHOLE block, including its own initializer — so `
    + `\`const driverDir = driverDir(runDir)\` is a temporal dead zone, not a path. The sweep wrote exactly `
    + `that in five files and cost 42 tests. Name the local something else.`);
});

test("#1336 — the accessors answer where `_driver/` is", () => {
  assert.equal(DRIVER_DIR, "_driver");
  assert.equal(driverDir("/runs/r1"), join("/runs/r1", "_driver"));
  assert.equal(driverDir("/runs/r1", "stage-inputs"), join("/runs/r1", "_driver", "stage-inputs"));
  assert.equal(driverDir("/runs/r1", "jx", "slice.json"), join("/runs/r1", "_driver", "jx", "slice.json"));
  // Relative, and it stays relative — the registry resolves it later against whichever run it is asked about.
  assert.equal(driverRel("grid-spec.json"), join("_driver", "grid-spec.json"));
  assert.equal(driverRel("jx", "zh-grid.json"), join("_driver", "jx", "zh-grid.json"));
  assert.equal(driverRel(), "_driver");
});

test("#1336 — creation is recursive, nested-capable and idempotent", () => {
  const base = mkdtempSync(join(tmpdir(), "driver-dir-"));
  try {
    // Every on-disk assertion names the directory LITERALLY rather than asking driverDir() where it put
    // things. Comparing the two functions against each other is the shape that survives its own defect:
    // break the accessor and both sides move together, so the arm stays green while nothing is where the
    // product expects it. Measured — an earlier draft of this arm did exactly that.
    const deep = join(base, "not", "yet", "there");
    assert.equal(ensureDriverDir(deep), join(deep, "_driver"));
    assert.ok(statSync(join(deep, "_driver")).isDirectory(),
      "the parent run directory need not exist yet — all twenty call sites created recursively");

    const child = ensureDriverDir(base, "stage-inputs");
    assert.equal(child, join(base, "_driver", "stage-inputs"));
    assert.ok(existsSync(join(base, "_driver")), "the parent `_driver/` is created on the way to the child");

    assert.equal(ensureDriverDir(base), join(base, "_driver"));
    assert.equal(ensureDriverDir(base, "stage-inputs"), child);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
