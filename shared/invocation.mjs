// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// How to tell a reader to run one of our own verbs, in the form that will actually work for THEM.
//
// — THE PRODUCT USED TO SEND PEOPLE TO A COMMAND THAT DOES NOT EXIST. `clearotron doctor` prints
// "run: clearotron install" when it finds no .env, and on a repository clone there is no `clearotron` on
// PATH: this repository IS the `clearotron` package, and npm links a package's bin into
// node_modules/.bin only for its DEPENDENCIES, never for itself. So the advice landed the reader
// back in `command not found`, one step after the install document had got them out of it.
//
// AND HARDCODING `npx clearotron` IS THE WRONG FIX, which is why this is a function and not a constant.
// A reader who installed globally — `npm i -g clearotron`, the eventual public route — DOES have the
// bare name, and telling them to type `npx` in front of it is noise that implies their install is
// somehow lesser. The form is a property of how this process was started, so it is derived from that
// rather than decided once at author time.
//
// ── — AND "THE FORM THAT REACHES THIS CODE" WAS THE SMALLER QUESTION ────────
//
// Everything above answers: given how I was started, which spelling of my name reaches me? The owner
// then typed one of these lines from his home directory and got
//
//     npm error could not determine executable to run
//
// because `npx` resolves a local package by walking UP from the current directory to find node_modules.
// Inside the checkout it finds us; from anywhere else it finds nothing and reports a generic npm
// failure that names no product and suggests no fix. Both spellings this file could return were
// unrunnable where he was standing, so answering correctly between them was never going to help.
//
// The question is therefore now: **which line can the reader type FROM WHERE THEY ARE and reach this
// install?** That is a strictly larger question, and it has three answers rather than two — see
// invocationForm(). The old two are still in there, unchanged, as the cases they always covered.
//
// ✕ THE TEST IS STILL NOT `which`. A PATH lookup answers "is some clearotron installed", which is a
// different question from "does the name the reader would type reach THIS code" — on a box with a stale
// global install those two disagree, and the wrong one sends them to somebody else's copy. What is new
// below is not a resolver check: the shim is read and must NAME THIS INSTALL, and a `clearotron` found
// earlier on PATH demotes the bare form rather than confirming it. Identity, not availability. A later
// sweep tempted to simplify this into `command -v` would be reintroducing the defect, not tidying it.
import { existsSync } from "node:fs";
import { basename, sep } from "node:path";
import { INSTALL_DIR, inspectShim, pathPosition, shimDir, shimPath } from "./verb-shim.mjs";

/**
 * Filesystem reads, injectable so the arms can drive a machine that is not this one.
 *
 * BOTH HALVES ARE INJECTABLE, not just the walk. An arm that pinned HOME and PATH but let the shim
 * read fall through to the real disk would answer differently on a developer's box, where a shim for
 * some other checkout may genuinely be sitting in ~/.local/bin — a suite that passes or fails on what
 * is in the runner's home directory is not a suite.
 */
const FS = Object.freeze({ exists: existsSync, read: undefined });

/**
 * Which of the three forms reaches this install from an arbitrary working directory, and the evidence
 * for it. `prefix` is what goes in front of the bare word `clearotron`.
 *
 *   bare       ""                       the verb is on PATH and it is ours
 *   shim-path  "/home/u/.local/bin/"    ours, but not first on PATH (or not on it at all yet)
 *   in-place   "cd /opt/install && npx" no shim of ours — name the directory, per the issue's own
 *                                       first option: "either states the directory, or is a command
 *                                       that works from anywhere"
 *
 * THE MIDDLE ONE IS THE ORDINARY CASE FOR THE FIRST FEW MINUTES OF AN INSTALL, not an edge. A login
 * profile puts `~/.local/bin` on PATH only if the directory existed when the shell started, so a shim
 * written moments ago is usually absent from the PATH of the very terminal that wrote it, and heals at
 * the next login. Printing an absolute path there is not a degraded answer — it is the only one of the
 * three that is true in that terminal.
 */
/**
 * WHERE A READER SHOULD STAND to run `npx clearotron` —, F7.
 *
 * On a packaged install this module lives in `<project>/node_modules/clearotron`, so `cd`-ing to its own
 * directory sent every piece of advice into node_modules: nine lines of one `doctor` run, the .env line
 * among them. It WORKS, which is why it survived — but it teaches a reader that the product lives in a
 * directory they are otherwise told never to touch, and it contradicts the install document, which says
 * in bold not to go there. A tool and its own documentation disagreeing is a defect in its own right,
 * whichever of them is technically right.
 *
 * npm puts the executable in `<project>/node_modules/.bin`, and npx resolves it from the PROJECT ROOT —
 * measured on a real packaged install, `npx clearotron doctor` from the root exits 0. So the honest
 * place to stand is the project, and it is the ancestor above node_modules.
 *
 * In a git checkout there is no node_modules segment in this path and the answer is unchanged.
 *
 * PURE, and separated out so both cases are drivable without building a packaged tree per assertion.
 */
export function standFrom(dir) {
  const s = String(dir ?? "");
  // The LAST occurrence: a project may itself sit under someone's node_modules, and the root we want is
  // the nearest one above this copy, not the outermost in the string.
  const at = s.lastIndexOf(`${sep}node_modules${sep}`);
  return at === -1 ? s : s.slice(0, at);
}

/**
 * WHERE npm PUT THE EXECUTABLE for a GLOBAL install of this package —.
 *
 * ✕ AND THIS IS STILL NOT `which`, FOR THE SAME REASON THE HEADER GIVES. Read the prohibition above
 * before touching this: a PATH lookup answers "is some clearotron installed", and on a box with a
 * stale global install beside this one it answers YES about somebody else's copy. Nothing here looks
 * up a name. This derives, from THIS module's own location, the single path npm would have written
 * for THIS install and no other — and the caller then asks only whether that exact path is on PATH.
 * Identity, not availability, arrived at by a second route.
 *
 * THE SECOND ROUTE IS NECESSARY BECAUSE inspectShim CANNOT ANSWER HERE. Everywhere else in this file
 * identity comes from reading the shim and finding our marker in it. A global install's executable is
 * npm's own wrapper, not a file this product ever wrote, so `inspectShim` correctly reports it
 * `foreign` — and a global install, which is the eventual public route, was therefore told it had no
 * `clearotron` on its PATH while the bare name worked perfectly. The identity has to come from the
 * path instead, so it comes from the layout, which npm fixes:
 *
 *     <prefix>/lib/node_modules/clearotron      ← this module's install directory
 *     <prefix>/bin/clearotron                   ← the executable npm links for it
 *
 * Measured on the reporter's box: `/home/hardening-b/.npm-global/lib/node_modules/clearotron` and
 * `/home/hardening-b/.npm-global/bin/clearotron`. A LOCAL install — `<project>/node_modules/clearotron`,
 * no `lib` segment — is deliberately NOT matched: npm links those into `<project>/node_modules/.bin`,
 * which is not on anybody's PATH, and `standFrom` already gives that case its correct answer.
 *
 * POSIX ONLY. npm's global layout on Windows is `<prefix>/node_modules/<pkg>` with a `.cmd` beside it,
 * a different shape; `installShim` already refuses that platform by name and this returns null there
 * rather than deriving a path that does not exist.
 *
 * PURE, like `standFrom` above it, so both the matching and the non-matching layouts are drivable
 * without building a global install per assertion.
 *
 * @returns {string|null} the directory npm put the executable in, or null when this is not that layout
 */
export function globalBinDirFrom(dir, platform = process.platform) {
  if (platform === "win32") return null;
  const s = String(dir ?? "");
  const tail = `${sep}lib${sep}node_modules${sep}clearotron`;
  // The basename must be OUR package name: this is the identity half of the derivation, and without it
  // the function would happily name a bin directory for any package that happens to sit in a global root.
  if (!s.endsWith(tail)) return null;
  return `${s.slice(0, -tail.length)}${sep}bin`;
}

export function invocationForm(env = process.env, io = FS, installDir = INSTALL_DIR) {
  const dir = shimDir(env);
  const path = shimPath(env);
  const shim = path
    // installDir travels WITH the read. `inspectShim` decides "ours" by comparing the install the shim
    // names against this one, and leaving it to default while the caller has injected a different
    // installDir would judge a fixture's shim against the real checkout — the two halves of one
    // identity question answered about two different installs.
    ? inspectShim(path, io.read ? { installDir, read: io.read } : { installDir })
    : { kind: "absent-or-unreadable", installDir: null };
  if (shim.kind === "ours" && shim.interpreterMissing !== true) {
    const { onPath, shadowedBy } = pathPosition(dir, env, { exists: io.exists });
    if (onPath && !shadowedBy) {
      return { form: "bare", prefix: "", shim: path, dir, onPath: true, shadowedBy: null, staleInterpreter: null };
    }
    return { form: "shim-path", prefix: `${dir}${sep}`, shim: path, dir, onPath, shadowedBy, staleInterpreter: null };
  }
  // A GLOBAL INSTALL IS ASKED SECOND, AND ONLY SECOND. `~/.local/bin` is where this product writes its
  // own shim, so a shim of ours there is the stronger evidence and keeps its precedence; this branch is
  // for the install that never wrote one because npm had already put the name on PATH itself. It is
  // below the broken-shim note deliberately: a shim of ours that is BROKEN must still not be handed
  // back as the form, and a global executable is a genuine way around it.
  const globalDir = globalBinDirFrom(installDir);
  const globalExe = globalDir ? `${globalDir}${sep}clearotron` : null;
  // io.exists, not a bare existsSync: an arm that pinned PATH but let this read fall through to the real
  // disk would answer differently on a box that really has a global install — the reason the FS note at
  // the top of this file gives for injecting both halves.
  if (globalExe && shim.kind !== "ours" && io.exists(globalExe)) {
    const { onPath, shadowedBy } = pathPosition(globalDir, env, { exists: io.exists });
    if (onPath && !shadowedBy) {
      return { form: "bare", prefix: "", shim: globalExe, dir: globalDir, onPath: true, shadowedBy: null, staleInterpreter: null, via: "global" };
    }
    // NOT ON PATH IS ALSO ANSWERED HERE, AND THIS IS THE HALF THAT WAS ACTIVELY WRONG. Falling through
    // to `in-place` hands back `cd ${standFrom(INSTALL_DIR)} && npx clearotron` — and for this layout
    // `standFrom` names `<prefix>/lib`, a directory with no package.json in it, so npx there reports
    // "could not determine executable to run": the exact failure the tracker-1916 block above this
    // file's imports was written to end, reached by the one layout it did not cover. The executable is
    // right there and naming it in full is true from any directory.
    return { form: "shim-path", prefix: `${globalDir}${sep}`, shim: globalExe, dir: globalDir, onPath, shadowedBy, staleInterpreter: null, via: "global" };
  }
  // ✕ A BROKEN SHIM MUST NOT BE THE FORM WE HAND BACK, however well it identifies itself. Driven and
  // caught: doctor reported the stale interpreter and then told the reader to run `clearotron install`
  // to fix it — through the very shim it had just called broken. The advice for repairing a route
  // cannot travel that route. Both remaining forms go around it.
  return {
    form: "in-place", prefix: `cd ${standFrom(installDir)} && npx `, shim: path, dir,
    onPath: false, shadowedBy: null, shimKind: shim.kind, otherInstall: shim.installDir,
    staleInterpreter: shim.interpreterMissing === true ? shim.interpreter : null,
  };
}

/**
 * The prefix a reader should type to reach this program.
 *
 * @param argv1  process.argv[1] — the script node was asked to run
 */
export function invocationPrefix(argv1 = process.argv[1] ?? "", env = process.env, io = FS, installDir = INSTALL_DIR) {
  // THE DISPATCHER SPAWNS ITS VERBS AS SEPARATE PROCESSES, so a child's argv[1] is `bin/onboard.mjs`
  // however the reader started it — and reading argv[1] alone would tell every spawned verb to print
  // `npx` even for somebody who typed a bare `clearotron`. bin/clearotron.mjs therefore hands its OWN
  // argv[1] down in CLEAROTRON_INVOKED_AS, and that wins when present. Without this the helper is
  // right in the dispatcher and wrong in all nine verbs, which is the shape that would have shipped.
  const s = String(env?.CLEAROTRON_INVOKED_AS || argv1);
  // ── ✕ npx IS TESTED FIRST, BECAUSE ITS SHIM IS ALSO NAMED `clearotron` ──────────────────────────
  //
  // The comment below used to claim "an npx cache path" fell through to the `npx ` branch. It does not:
  // npx materialises the package and runs its bin through a shim of the package's OWN name, so
  // `basename(argv[1])` is `clearotron` there exactly as it is for a global install. The reader who
  // followed INSTALL.md §2 — which makes the npx form mandatory — was told to type `clearotron install`
  // and got rc 127, one step after the document had got them out of `command not found`. That is the
  // defect this whole file was written to prevent, arriving through the one route it did not test.
  //
  // `npm_command` is what npm sets for the process it spawns, and `npx` IS `npm exec`. Measured on this
  // box: `npm exec -- node -e …` carries `npm_command=exec` and `npm_lifecycle_event=npx`; a bare global
  // run carries neither. It is checked before the basename because that is the case the basename cannot
  // see. `npm run <script>` sets `npm_command=run-script`, so a bare install driven from a package
  // script does not falsely gain the prefix.
  //
  // What these two return is no longer the literal string `npx `: arriving BY npx tells us the bare name
  // did not get the reader here, which is a fact about the spelling and says nothing about where they
  // will be standing when they type the next one. That is invocationForm()'s question now.
  if (String(env?.npm_command ?? "") === "exec") return invocationForm(env, io, installDir).prefix;
  // AND THE PATH, INDEPENDENTLY OF THE ENVIRONMENT. npx keeps its materialised trees under `_npx/` in
  // the npm cache. This catches a recorded or replayed argv that arrives without npm's env — which is
  // how the case above was driven when it was found, and a discriminator that only worked when the
  // environment cooperated would go quiet exactly where a test could reach it.
  if (/[\\/]_npx[\\/]/.test(s)) return invocationForm(env, io, installDir).prefix;
  // ── THE ONE CASE THAT NEEDS NO FILESYSTEM AT ALL ────────────────────────────────────────────────
  //
  // Started through a bin shim named `clearotron` — a global install, or our own shim on PATH. The
  // reader typed the bare name and it worked, FROM WHEREVER THEY WERE STANDING WHEN THEY TYPED IT.
  // That is not an inference about their PATH; it is the strongest possible evidence about it, and it
  // is why this branch is not routed through invocationForm() and cannot be weakened by a missing HOME
  // or an unreadable shim.
  if (basename(s) === "clearotron") return "";
  // `node bin/clearotron.mjs`, a direct file run, a spawned verb with no handed-down argv. The bare name
  // is not what got them here, so ask what would.
  return invocationForm(env, io, installDir).prefix;
}

/** `clearotron doctor` or whatever the reader can actually type from where they are. */
export const invoke = (verb, argv1 = process.argv[1] ?? "", env = process.env, io = FS, installDir = INSTALL_DIR) =>
  `${invocationPrefix(argv1, env, io, installDir)}clearotron ${verb}`;

/**
 * The verb by NAME ONLY — no prefix, no path, no `npx`.
 *
 * ✕ A DELIBERATE EXCEPTION TO "ONE TREATMENT", AND THE ONE SURFACE THAT NEEDS IT. 's
 * second requirement is that the choice is made once rather than per site, so an exception has to be
 * named rather than quietly spelled differently somewhere.
 *
 * The portal's SIGN-IN page is read by somebody who is not authenticated and may not be on the machine
 * at all. invoke() there resolves to whatever reaches THIS install — which, with no shim, is
 * `cd /srv/whatever && npx clearotron …`, putting the server's absolute filesystem path, its home
 * directory and its account name on a page a stranger can load. Caught by portal-local-login's arm,
 * which forbids the refusal describing the credential it checked: the install path contained the word
 * "user" and the assertion fired. The word was a coincidence; the disclosure was not.
 *
 * So that page names the verb and says which machine to run it on. Anyone with shell access there can
 * resolve a name; nobody without it should be handed the layout. `doctor`, which runs ON the machine
 * and for somebody who already has it, names the exact runnable form.
 */
export const bareInvocation = (verb) => `clearotron ${verb}`;

/**
 * Refuse a prompt when there is nobody to answer it.
 *
 * — bb8's F14 item 5. `install` has said this since it was written; `connect`
 * and `disconnect` prompt through readline and did not, so piped or redirected they read EOF and took
 * it as an answer. `install`'s exit code and wording are the model, and this is that model shared
 * rather than copied a third time.
 *
 * Called at the PROMPT, never at entry: both commands have `--list` and `--dry-run`, which are
 * legitimately scriptable, and a guard at the top would break them.
 */
export function requireInteractive({ verb, stdin = process.stdin, exit = (c) => process.exit(c), err = console.error }) {
  if (stdin.isTTY) return;
  err(`\n${verb}: this step asks a question and stdin is not a terminal.\n`
    + "Run it in a terminal. `--list` and `--dry-run` need no answer and work either way.\n");
  exit(2);
}
