// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The check that refuses the import cycle a command cannot survive, driven against a tree that has one.
//
// A control that is merely quiet proves nothing about a detector. Every synthetic arm here asserts FIRST
// that the fixture was actually seen — an empty tree reports no cycles for the same reason a correct one
// does, and the arm that says "no cycle here" is the one that would pass over nothing and look right.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scan, POPULATION_FLOOR, KNOWN_ABSENT, topLevelAwaitLines, fragmentsOf, resolveSpecifier,
  reachedDuringTopLevelAwait, staticSpecifiers } from "../../scripts/import-cycle-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A tree in memory, addressed exactly as the check addresses the real one. */
function virtualTree(files) {
  const rel = (abs) => {
    const s = String(abs);
    return s.startsWith(ROOT) ? s.slice(ROOT.length).replace(/^[/\\]/, "") : s;
  };
  const read = (abs) => {
    const p = rel(abs);
    if (Object.hasOwn(files, p)) return files[p];
    const e = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; throw e;
  };
  const list = (abs) => {
    const base = rel(abs);
    const prefix = base ? `${base}/` : "";
    const seen = new Map();
    for (const p of Object.keys(files)) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const cut = rest.indexOf("/");
      if (cut === -1) seen.set(rest, false);
      else seen.set(rest.slice(0, cut), true);
    }
    return [...seen].map(([name, isDir]) => ({ name, isDirectory: () => isDir }));
  };
  return { read, list };
}

/** A command that awaits at its top level and reaches another module from inside that await. */
const AWAITING_COMMAND = `
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
const APPLY = isEntrypoint(import.meta.url) && process.argv.includes("--apply");
let note = "";
if (APPLY) note = await writeIt();
export async function writeIt() {
  const { helper } = await import("../shared/helper.mjs");
  return helper();
}
`;
const IS_ENTRYPOINT = "export const isEntrypoint = () => true;\n";

test("the tree as it stands has no command that is imported back by what it awaits", () => {
  const r = scan();
  assert.deepEqual(r.violations.map((v) => `${v.entry} <= ${v.importer}`), []);
  assert.equal(r.unreadable.length, 0, `files that would not read: ${r.unreadable.join(", ")}`);
  assert.deepEqual(r.undeclaredAbsent, [],
    "a module reached during a top-level await is missing and undeclared — the check stopped following it");
});

test("the population is real, so a quiet run is not a scanner that has stopped looking", () => {
  const r = scan();
  assert.ok(r.withTopLevelAwait.length >= POPULATION_FLOOR,
    `only ${r.withTopLevelAwait.length} commands await at the top level; the floor is ${POPULATION_FLOOR}`);
});

test("THE PLANT: a command imported back by what it awaits is found", () => {
  const { read, list } = virtualTree({
    "driver/command.mjs": AWAITING_COMMAND,
    "shared/helper.mjs": `import { writeIt } from "../driver/command.mjs";\nexport const helper = () => writeIt;\n`,
    "shared/is-entrypoint.mjs": IS_ENTRYPOINT,
  });
  const r = scan({ read, list });
  assert.equal(r.withTopLevelAwait.length, 1, "the fixture was not seen, so anything below it is vacuous");
  assert.equal(r.violations.length, 1, "the planted cycle was not found");
  assert.match(r.violations[0].entry, /command\.mjs$/);
  assert.match(r.violations[0].importer, /helper\.mjs$/);
});

test("a dynamic import inside a function closes no load-time loop, and is not reported", () => {
  const { read, list } = virtualTree({
    "driver/command.mjs": AWAITING_COMMAND,
    // Reaches back, but only when somebody calls it — which is legal, and deliberate in this tree.
    "shared/helper.mjs": `export async function helper() { const { writeIt } = await import("../driver/command.mjs"); return writeIt; }\n`,
    "shared/is-entrypoint.mjs": IS_ENTRYPOINT,
  });
  const r = scan({ read, list });
  assert.equal(r.withTopLevelAwait.length, 1, "the fixture was not seen, so this control finds nothing for the wrong reason");
  assert.deepEqual(r.violations, [],
    "a dynamic import inside a function was reported as a cycle — that is the repair this bug is fixed by");
});

test("THE IDIOM: a default parameter holding braces does not turn a function body into module scope", () => {
  // `opts = {}` is the commonest signature in this tree, and a look-back window split on braces reset
  // there — so the body read as module scope and every await inside it counted. driver/pipeline.mjs
  // reported 84, and the check then claimed a cycle on a tree that runs.
  assert.equal(topLevelAwaitLines("async function runDigest(ctx, opts = {}) {\n  await stage(ctx);\n}\n").length, 0);
  assert.equal(topLevelAwaitLines("const f = async (a, o = { x: 1 }) => {\n  await g();\n};\n").length, 0);
  assert.equal(topLevelAwaitLines("async function f(\n  a,\n  o = {},\n) {\n  await g();\n}\n").length, 0);
  // And the control blocks keep counting, or the fix has swung the other way and hides real ones.
  assert.equal(topLevelAwaitLines("if (APPLY) {\n  await writeIt();\n}\n").length, 1);
  assert.equal(topLevelAwaitLines("try {\n  await g();\n} catch (e) {\n  await h();\n}\n").length, 2);
  assert.equal(topLevelAwaitLines("for (const x of xs) {\n  await g(x);\n}\n").length, 1);
});

test("an await inside a function is not a top-level await, however the function is written", () => {
  assert.equal(topLevelAwaitLines("async function f() {\n  await g();\n}\n").length, 0);
  assert.equal(topLevelAwaitLines("const f = async () => {\n  await g();\n};\n").length, 0);
  // ONE LINE, which a per-line brace depth reads as top level because the brace closes before the line does.
  assert.equal(topLevelAwaitLines("export async function f() { await g(); }\n").length, 0);
  assert.equal(topLevelAwaitLines("const f = async () => { await g(); };\n").length, 0);
  // And a parameter list spanning lines still belongs to the function that opened it.
  assert.equal(topLevelAwaitLines("async function f(\n  a,\n  b\n) {\n  await g();\n}\n").length, 0);
});

test("THE REAL SHAPE: the scanner does not count itself, and says so about its own source", () => {
  // This is the arm that matters, and the synthetic one below passed while this failed. The check read
  // its own error output — a template carrying the words "commands await at the top level" — as code,
  // because a stack of independent replacements had already fallen out of phase on an earlier line.
  const src = readFileSync(join(ROOT, "scripts", "import-cycle-check.mjs"), "utf8");
  assert.equal(topLevelAwaitLines(src).length, 0,
    "the scanner reports a top-level await in its own source, so it is in the population it measures");
  assert.ok(!scan().withTopLevelAwait.some((f) => f.endsWith("import-cycle-check.mjs")),
    "the scanner counts itself among the commands that await at the top level");
});

test("a construct that merely CONTAINS the word is not code, whatever holds it", () => {
  // A template, and one whose interpolation carries braces — the case that put this file in its own
  // population. Blanking must survive `${…}` without losing the closing backtick.
  assert.equal(topLevelAwaitLines("const s = `only ${n} commands await at the top level`;\n").length, 0);
  assert.equal(topLevelAwaitLines("const s = `${a ? `${b}` : c} await g()`;\n").length, 0);
  // A string holding a `//` must not be read as opening a comment — that is what threw the phase.
  assert.equal(topLevelAwaitLines('const u = "https://example.invalid";\nconst s = "await g();";\n').length, 0);
  assert.equal(topLevelAwaitLines('const u = "https://example.invalid";\nawait g();\n').length, 1);
});

test("a regex that mentions await is not an await, which is how this scanner counted itself", () => {
  // The literal this file's own reader is built from. Comments and strings are blanked; regex literals
  // are not, so a word-boundary test read `await` here as code and put the scanner in its own population.
  assert.equal(topLevelAwaitLines("const re = /await\\s+([A-Za-z_$][\\w$]*)\\s*\\(/g;\n").length, 0);
  assert.equal(topLevelAwaitLines('const s = "await g();";\n').length, 0);
  assert.equal(topLevelAwaitLines("// await g();\n").length, 0);
  // And a real one is still seen beside them.
  assert.equal(topLevelAwaitLines("const re = /await\\s+/g;\nawait g();\n").length, 1);
});

test("an await inside a module-scope if is a top-level await, because that is where one of ours lives", () => {
  assert.equal(topLevelAwaitLines("if (!imported) {\n} else {\n  await runCli();\n}\n").length, 1);
  assert.equal(topLevelAwaitLines("if (APPLY) note = await writeIt();\n").length, 1);
});

test("a specifier is read whether it is quoted, joined or interpolated", () => {
  assert.deepEqual(fragmentsOf('"../shared/helper.mjs"'), ["../shared/helper.mjs"]);
  // The shape that hid a real edge: computed, not quoted.
  assert.deepEqual(fragmentsOf('pathToFileURL(join(REPO, "bin", "start.mjs")).href'), ["bin", "start.mjs"]);
  assert.equal(resolveSpecifier(["bin", "start.mjs"], "driver/systemd/render-units.mjs"), "bin/start.mjs");
  assert.deepEqual(fragmentsOf("`../driver/profiles.mjs?doctor=${Date.now()}`"), ["../driver/profiles.mjs?doctor="]);
  assert.equal(resolveSpecifier(["../driver/profiles.mjs?doctor="], "bin/onboard.mjs"), "driver/profiles.mjs");
});

test("only what the top-level await reaches counts, not everything the module imports", () => {
  const src = `
const APPLY = true;
if (APPLY) await onPath();
export async function onPath() {
  const m = await import("./reached.mjs");
  return m;
}
export async function offPath() {
  const m = await import("./not-reached.mjs");
  return m;
}
`;
  const { modules } = reachedDuringTopLevelAwait("driver/command.mjs", src);
  assert.ok(modules.has("driver/reached.mjs"), "the module on the await's call path was not followed");
  assert.ok(!modules.has("driver/not-reached.mjs"),
    "a function nothing awaits at the top level was followed, which reports cycles that cannot happen");
});

test("a re-export is an edge, because importing the re-exporter evaluates what it re-exports", () => {
  assert.deepEqual(staticSpecifiers('export { parseEnvFile } from "../../shared/env-file-merge.mjs";\n'),
    ["../../shared/env-file-merge.mjs"]);
});

test("a side-effect import is an edge too — it has no `from`, and it evaluates the module all the same", () => {
  assert.deepEqual(staticSpecifiers('import "../shared/env-local.mjs";\n'), ["../shared/env-local.mjs"]);
  assert.deepEqual(staticSpecifiers("import '../shared/env-local.mjs'\n"), ["../shared/env-local.mjs"]);
  // A DYNAMIC import is not one of these, and must not be read as one: the parenthesis is the difference.
  assert.deepEqual(staticSpecifiers('const m = await import("../shared/env-local.mjs");\n'), []);
});

test("THE PLANT: a bare side-effect import back into the command is found", () => {
  const { read, list } = virtualTree({
    "driver/command.mjs": AWAITING_COMMAND,
    // No `from`. This evaluates the command while the command's own await is still settling.
    "shared/helper.mjs": `import "../driver/command.mjs";\nexport const helper = () => 1;\n`,
    "shared/is-entrypoint.mjs": IS_ENTRYPOINT,
  });
  const r = scan({ read, list });
  assert.equal(r.withTopLevelAwait.length, 1, "the fixture was not seen, so anything below it is vacuous");
  assert.equal(r.violations.length, 1, "a side-effect import closing the cycle was not found");
  assert.match(r.violations[0].importer, /helper\.mjs$/);
});

test("the one declared absence is declared with its reason, not skipped in silence", () => {
  assert.ok(KNOWN_ABSENT.includes("cut/packed-artifact.mjs"),
    "the withheld pack gate is no longer declared, so its absence now reads as nothing to check");
  for (const m of scan().missing)
    assert.ok(KNOWN_ABSENT.includes(m), `${m} is reached during a top-level await and is absent undeclared`);
});
