// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ── THE MANIFEST ADVERTISES NO COMMAND A PUBLIC CLONE CANNOT RUN ────────────────────────────────
//
// `package.json` is a front door. Six of its script entries ran a file the cut withholds, so a stranger
// who cloned the public tree and ran one got a module-not-found — the manifest advertising a command
// that cannot exist there.
//
// THAT WAS FIXED TWICE, AND THIS FILE RECORDS BOTH. The first fix gave the six an `existsSync` guard so
// they refused BY NAME and exited nonzero instead of crashing — a real improvement over the crash, and
// over the quieter failure of succeeding by doing nothing. The second removed them. A refusal is still
// an advertisement: a stranger reading `npm run` meets six commands, tries one, and is told it was
// never for them. The entry that cannot run is better absent than politely declined.
//
// SO THE PROPERTY IS NOW STRUCTURAL AND STRONGER. It is no longer "each of these six carries a guard",
// which was a statement about a list somebody had to keep current — it is "no entry in this manifest
// runs a file this tree does not have", which discovers its own population and cannot go stale. A
// seventh wrapper added tomorrow is caught by construction.
//
// AND THE GUARD PATTERN STILL HAS A SUBJECT. `postinstall` keeps it, and must: it runs on every
// install, including in trees where the file IS present, so it cannot simply be deleted the way the six
// could. Its arm below is the one that keeps the pattern honest — a guard nobody exercises is a guard
// nobody has watched work.
//
// BREAK MATRIX:
//   · no manifest entry names an absent file   → break: re-add one of the six, arm 1 red
//   · postinstall is guarded, not bare         → break: drop its existsSync, arm 2 red
//   · postinstall is SILENT when absent        → break: make it refuse, arm 2 red
//   · postinstall RUNS the file when present   → break: invert the guard, arm 3 red
//   · the child's exit code survives           → break: swallow it, arm 3 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;

// A path-shaped token in a script entry. Deliberately narrow: it matches what a reader would call a
// file in this repository, and not a package name, a flag or a glob.
const PATH_TOKEN = /\b(?:scripts|bin|driver|shared|providers|mcp-server|portal-ui|cut|e2e)\/[A-Za-z0-9._/-]+\.(?:mjs|js|cjs|ts|sh)\b/g;

// ONE ENTRY IS EXEMPT, AND IT IS NOT A LEGACY CARVE-OUT. `postinstall` is not a command anybody types:
// npm runs it during every install, including in trees where the file IS present, so it cannot be
// deleted the way a typed verb can. Its correct behaviour is therefore the opposite of theirs — do
// nothing, silently — and the two arms below hold it to that in both directions. The exemption is
// pinned to exactly one name so a second silent wrapper cannot arrive under cover of it.
const EXEMPT = new Set(["postinstall"]);

test("no script in the manifest runs a file that is not in this tree", () => {
  assert.deepEqual([...EXEMPT], ["postinstall"],
    "the exemption grew. Every other manifest entry is a verb a reader types, and a verb that cannot "
    + "run does not belong in the front door — see the arms below for what earns postinstall its place");
  const entries = Object.entries(SCRIPTS).filter(([name]) => !EXEMPT.has(name));
  nonEmpty(entries, "package.json declares no scripts, so this arm read nothing");

  const missing = [];
  let looked = 0;
  for (const [name, entry] of entries) {
    for (const target of new Set(entry.match(PATH_TOKEN) ?? [])) {
      looked++;
      if (!existsSync(join(REPO, target))) missing.push(`${name} → ${target}`);
    }
  }
  // THE COUNT IS ASSERTED BECAUSE THE REGEX IS THE RISK. A pattern that stopped matching would report
  // zero missing files over a manifest full of them — a clean answer from an instrument that looked at
  // nothing, which is the shape this whole family of guards exists to refuse.
  assert.ok(looked >= 20, `only ${looked} file reference(s) found across ${entries.length} scripts — the pattern is broken, not the manifest`);
  assert.deepEqual(missing, [],
    "these manifest entries name a file this tree does not carry. A stranger who clones this repository "
    + "and runs one gets an error for a command that was never for them. Remove the entry rather than "
    + "guarding it: a refusal is still an advertisement.");
});

/**
 * The body npm hands to node, recovered from the manifest entry.
 *
 * Deliberately NOT a re-implementation: the entry is `node -e "<body>"` with the inner double quotes
 * escaped by JSON, so unwrapping it is the only step between what ships and what runs here.
 */
function bodyOf(name) {
  const entry = SCRIPTS[name];
  assert.ok(entry.startsWith('node -e "') && entry.endsWith('"'), `${name} is not a node -e entry: ${entry}`);
  return entry.slice('node -e "'.length, -1).replace(/\\"/g, '"');
}

const run = (name, cwd) => spawnSync(process.execPath, ["-e", bodyOf(name)], { cwd, encoding: "utf8" });

test("postinstall is guarded, and on a tree without the file it does nothing and says nothing", () => {
  const entry = SCRIPTS.postinstall;
  assert.ok(entry, "postinstall is gone — this arm is asserting about nothing");
  assert.ok(entry.includes("existsSync"), "postinstall runs its file bare, so `npm install` fails on a public clone");
  assert.ok(entry.includes("scripts/install-hooks.mjs"), "postinstall no longer names the file it guards");

  // SILENCE IS RIGHT HERE AND WOULD BE WRONG FOR A VERB SOMEBODY TYPED. `postinstall` runs itself,
  // unasked, during every `npm install`. Nobody is waiting on an answer from it, so a refusal would be
  // noise on a successful install — the opposite of the ruling for the six, and for the same reason:
  // the reader's expectation is what decides.
  const empty = mkdtempSync(join(tmpdir(), "public-clone-"));
  const r = run("postinstall", empty);
  assert.equal(r.status, 0, `postinstall failed on a tree with no install-hooks.mjs: ${r.stderr}`);
  assert.equal(r.stdout, "", "postinstall printed to stdout on a tree it has nothing to do in");
  assert.equal(r.stderr, "", "postinstall printed to stderr on a tree it has nothing to do in");
});

test("where the file IS there postinstall runs it, and the child's exit code survives", () => {
  // THE CONTROL THAT MAKES THE ARM ABOVE MEAN SOMETHING. Without it, a guard that never ran anything
  // would satisfy every assertion up there — silent and inert reads exactly like silent and correct.
  const present = mkdtempSync(join(tmpdir(), "internal-tree-"));
  mkdirSync(join(present, "scripts"), { recursive: true });
  const marker = join(present, "ran.txt");
  writeFileSync(join(present, "scripts/install-hooks.mjs"), [
    // .mjs is ESM — the stand-in is written the way the real script is, not with require().
    'import { appendFileSync } from "node:fs";',
    `appendFileSync(${JSON.stringify(marker)}, "x");`,
    'process.exit(Number(process.env.STANDIN_EXIT ?? 0));',
    "",
  ].join("\n"));

  const ok = run("postinstall", present);
  assert.equal(ok.status, 0, `a present file did not run cleanly: ${ok.stderr}`);
  nonEmpty(readFileSync(marker, "utf8"), "the guard reported success without running the file");

  // A FAILING HOOK INSTALL MUST FAIL THE INSTALL. A wrapper that swallowed the child's status would
  // turn a broken hook set into a clean `npm install`, which is the same class of lie as the silent
  // no-op the six were rewritten to avoid.
  const failed = spawnSync(process.execPath, ["-e", bodyOf("postinstall")],
    { cwd: present, encoding: "utf8", env: { ...process.env, STANDIN_EXIT: "7" } });
  assert.notEqual(failed.status, 0, "the child's failure did not survive the wrapper — a broken hook install would read as a clean one");
});
