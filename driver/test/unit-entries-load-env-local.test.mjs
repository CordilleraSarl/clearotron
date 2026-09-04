// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — EVERY LONG-RUNNING ENTRY POINT TRANSLATES THE ENV NAMES. The header's claim becomes a test.
//
// `shared/env-aliases.mjs` describes a world where the rename is transparent because the loader runs
// first everywhere. It was a SENTENCE, and it was false for the one service most exposed to it:
// `driver/portal-service.mjs` reads `process.env.CLEAROTRON_ACCESS_FILE` and its siblings directly and
// applied no translation, while INSTALL.md documents the CLEAROTRON_* rename to operators.
//
// So an operator following the install guide renamed the values in their unit, the portal stopped
// seeing ANY of them, and the mandatory-roster guard refused to start — fail-closed, correctly, on a
// machine that had been configured correctly. Measured on the test box; production shipped the same
// code, so the same edge was one operator-action away there.
//
// ── WHY A UNIT-FILE SCAN AND NOT A HAND-KEPT LIST ────────────────────────────────────────────────
//
// A list is the thing that was already wrong. `CLI_ENTRIES` is hand-kept and correct for what it
// covers, and the portal was simply not on it — deliberately, for a good reason (it reads no dotfile).
// Being off that list was right; applying no translation was not, and no list could tell those apart.
//
// The unit files ARE the population: a `.service` this repo ships names the process a box actually
// runs. Deriving from them means a new unit is covered the day it lands, by nobody remembering.
//
// TRANSLATION IS NOT THE SAME AS READING A DOTFILE, and this accepts either:
//   · `import "../shared/env-local.mjs"` — reads <repo>/.env AND translates (the CLI entries)
//   · `warnRetiredEnv()`                — refuses a retired name, no file (services whose values arrive named)
// The portal must do the second and must NOT do the first; making it read a dotfile would give it a
// second, unnamed source of values in production, which is the thing its exclusion from CLI_ENTRIES
// exists to prevent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { CLI_ENTRIES, NO_DOTFILE } from "../../shared/env-local.mjs";   // — the LIST decides the dotfile, not the import

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_CORPUS = skipReason("unit-entries-load-env-local (#1222)");
const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };

/** Repo-relative .mjs entry points named by the ExecStart of a tracked unit file. */
export function unitEntries(files, readFn) {
  const out = new Map();
  for (const f of files) {
    const t = readFn(f);
    if (!t) continue;
    for (const line of t.split("\n")) {
      const m = /^ExecStart=\S*node\s+(\S+\.mjs)/.exec(line.trim());
      if (!m) continue;
      // THE PREFIX IS ONE OF THREE FORMS, AND KEYING ON ONE OF THEM SHRANK THIS CORPUS TO NOTHING.
      //
      // This read `/cordillera\.ch-trademark\/(.+\.mjs)$/` — the directory the working home was cut
      // from. Every unit that migrated to `${CLEAROTRON_CHECKOUT_DIR}` stopped matching it, silently, so
      // the corpus had been shrinking one unit at a time and would have hit ZERO the moment the last one
      // converted. It did: the anti-vacuity assertion below is what caught it, on the change that
      // finished the migration. A selector keyed on a name that is being retired selects less every day
      // and reports the same green.
      //
      // The three live forms, each named rather than swept up by a permissive wildcard:
      //   ${CLEAROTRON_CHECKOUT_DIR}/…   the EnvironmentFile shape most units now use
      //   @CLEAROTRON_CHECKOUT_DIR@/…    the installer-resolved shape (option B)
      //   %h/<dir>/…                     the legacy literal, still valid on an archived unit
      const rel = /^(?:\$\{[A-Z][A-Z0-9_]*\}|@[A-Z][A-Z0-9_]*@|%h\/[^/]+)\/(.+\.mjs)$/.exec(m[1])?.[1];
      if (rel) out.set(rel, f);
    }
  }
  return out;
}

// COMMENT LINES ARE STRIPPED FIRST, and that is not fastidiousness — the first version of this file
// matched the phrase `import "../shared/env-local.mjs"` inside its own explanatory comment and reported
// the portal as reading a dotfile it does not read. A guard that cannot tell prose from code reports the
// documentation instead of the program.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
const code = (src) => String(src ?? "").split("\n").filter((l) => !COMMENT_LINE.test(l)).join("\n");

/** Does this entry translate the env names, by either sanctioned route? */
export function emitsRetiredWarning(src) {
  const t = code(src);
  return /^\s*import\s+["']\.{1,2}\/[^"']*env-local\.mjs["']/m.test(t) || /\bwarnRetiredEnv\s*\(/.test(t);
}

/**
 * Does this entry IMPORT the loader? Code only, never a comment.
 *
 * — THIS USED TO BE CALLED `readsDotfile` AND THE NAME WAS THE BUG. Importing `env-local` does two
 * separable things: it TRANSLATES the rename (unconditional, at the bottom of that module) and it reads
 * `<repo>/.env` (gated on `isCliEntry(process.argv[1])`, i.e. on CLI_ENTRIES membership). Equating the
 * import with the file read is what made "translate without gaining a dotfile" look impossible, and it
 * is why the portal was given a body call that translated too late to matter. Whether a file reads the
 * dotfile is decided by the LIST, not by the import — so ask the list.
 */
export function importsLoader(src) {
  return /^\s*import\s+["']\.{1,2}\/[^"']*env-local\.mjs["']/m.test(code(src));
}

// A PASS-THROUGH SPREAD IS NOT A READ, and widening the corpus is what exposed the difference.
//
// The in-scope test was `/\bprocess\.env\b/` — any mention at all. `bin/clearotron.mjs` mentions it
// exactly once, spreading it into a child's environment:
//
//     env: { ...process.env, CLEAROTRON_INVOKED_AS: process.argv[1] ?? "" },
//
// It reads no value. The rename cannot reach it: whatever names are set are handed on untouched, and the
// CHILD does its own refusal. Demanding `warnRetiredEnv()` there would add a no-op import to satisfy
// a guard — which is the exact failure this arm's own comment already warns about one paragraph down,
// arrived at from the other direction. The old selector never reached this file, so the coarse predicate
// had never been tested against a pass-through.
//
// So the predicate now asks for an actual READ — a property or an index — by removing spreads before
// looking. Everything else stays in scope, including `const e = process.env` aliasing, because only the
// spread form is stripped.
export const readsEnv = (src) =>
  /\bprocess\.env\b/.test(String(src ?? "").replace(/\.\.\.\s*process\.env\b/g, ""));

test("#1222 a pass-through spread is not a read — a guard must not manufacture a no-op import", () => {
  assert.equal(readsEnv('spawn(cmd, { env: { ...process.env, X: "1" } })'), false,
    "spreading the environment into a child hands every name on untouched — the rename cannot reach it");
  assert.equal(readsEnv('const root = process.env.CLEAROTRON_WORK_DIR;'), true, "a property read is in scope");
  assert.equal(readsEnv('const v = process.env["CLEAROTRON_WORK_DIR"];'), true, "an index read is in scope");
  assert.equal(readsEnv('const e = process.env; use(e.CLEAROTRON_WORK_DIR);'), true,
    "aliasing the whole object is still a read — only the SPREAD form is stripped");
});

test("#1222 every unit-run entry point loads shared/env-local.mjs", (ctx) => {
  const tracked = trackedFiles("unit-entries-load-env-local", { root: ROOT });
  if (!tracked) return ctx.skip(NO_CORPUS);
  const entries = unitEntries(tracked.filter((f) => f.endsWith(".service")), read);
  assert.ok(entries.size > 0, "no unit file named a node entry — the scan has broken, not the tree");

  // ONLY ENTRIES THAT ACTUALLY READ THE ENVIRONMENT ARE IN SCOPE. The first version of this arm demanded
  // translation from every unit entry and flagged `providers/oauth-mcp-bridge/warm-server.mjs`, which
  // reads no `process.env` at all — so the rename cannot reach it and the import would have been a no-op
  // added to satisfy a guard. A check that manufactures work it does not need is a check people route
  // around. Reads the environment ⇒ owes the refusal; does not ⇒ owes nothing.
  const bare = [...entries]
    .filter(([rel]) => { const s = read(rel); return s && readsEnv(s) && !emitsRetiredWarning(s); })
    .map(([rel, unit]) => `${rel}  (run by ${unit})`);
  assert.deepEqual(bare, [],
    `${bare.length} entry point(s) a systemd unit runs read the environment WITHOUT translating the `
    + `CLEAROTRON_* rename:\n  ${bare.join("\n  ")}\n\n`
    + `An operator following INSTALL.md's rename table renames the values in the unit and this process `
    + `stops seeing them. Add \`warnRetiredEnv()\` before the first config read (the refusal only, no `
    + `file), or import shared/env-local.mjs if the process is also meant to read <repo>/.env.`);
});

test("#1222/#1532 the portal refuses, refuses EARLY, and still does NOT read a dotfile", () => {
  // Three halves now, and the middle one is the whole. The CLI_ENTRIES exclusion is still right
  // — "every value arrives named" — and was right that the portal translated nothing. What
  // got wrong is that a body `warnRetiredEnv()` call cannot translate in time: the body runs after every
  // static import has evaluated, and this service statically reaches two module-top captures.
  const src = read("driver/portal-service.mjs");
  assert.ok(src, "portal-service.mjs is gone");
  assert.ok(emitsRetiredWarning(src), "the portal no longer refuses a retired name");

  // EARLY. The loader import must be the FIRST import, or a capture beneath it has already run.
  const firstImport = (code(src).match(/^\s*import\s.*$/m) || [""])[0];
  assert.match(firstImport, /env-local\.mjs/,
    "the portal's first import is not the loader — anything earlier captures env before the rename applies");

  // AND STILL NO DOTFILE — decided by the list, which is what actually gates the file read.
  assert.ok(!CLI_ENTRIES.includes("driver/portal-service.mjs"),
    "the portal must NOT read <repo>/.env — that would give it a second, unnamed value source in "
    + "production. Importing the loader does not do that; joining CLI_ENTRIES does.");
  assert.ok(NO_DOTFILE.includes("driver/portal-service.mjs"),
    "the portal imports the loader but is declared in neither list — that is the state nobody can audit");
});

test("#1222 the scan can FAIL, and tells the refusal apart from a dotfile read", () => {
  // Constructed, because the tree is clean once this lands and a tree-driven arm would certify nothing.
  const units = { "u.service": "ExecStart=/usr/bin/node %h/clearotron/driver/x.mjs" };
  const found = unitEntries(Object.keys(units), (f) => units[f]);
  assert.deepEqual([...found.keys()], ["driver/x.mjs"], "the ExecStart parse no longer resolves a repo path");

  assert.equal(emitsRetiredWarning('const g = process.env.CLEAROTRON_ACCESS_FILE;'), false, "a bare read must be caught");
  assert.equal(emitsRetiredWarning('import "../shared/env-local.mjs";'), true, "the dotfile route counts");
  assert.equal(emitsRetiredWarning('warnRetiredEnv();'), true, "the direct-call route counts — a service whose values all arrive named needs the warning, not the dotfile");
  // THE FAULT THIS FILE ALREADY COMMITTED ONCE: prose read as code.
  assert.equal(importsLoader('// WHY warnRetiredEnv() AND NOT import "../shared/env-local.mjs" — they differ'), false,
    "a comment mentioning the import must not read as the import");
  assert.equal(emitsRetiredWarning('// warnRetiredEnv() would go here'), false, "nor a comment mentioning the call");

  // AND THE SCOPE RULE ITSELF, driven rather than asserted in prose.
  const noEnv = { "u.service": "ExecStart=/usr/bin/node %h/clearotron/providers/x.mjs" };
  const src = { "providers/x.mjs": "const p = path.join('a','b');   // never reads process dot env" };
  const scoped = [...unitEntries(Object.keys(noEnv), (f) => noEnv[f])]
    .filter(([rel]) => /\bprocess\.env\b/.test(src[rel] ?? "") && !emitsRetiredWarning(src[rel] ?? ""));
  assert.deepEqual(scoped, [], "an entry that reads no environment must not be asked to translate one");
});
