// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the form a reader can actually type, and the regression that shipped inside the fix.
//
// The helper exists because `clearotron doctor` used to print "run: clearotron install" on a checkout
// where npm links a package's bin only for its DEPENDENCIES, never for itself — so the advice landed the
// reader back in `command not found`. The fix derived the form from how the process started.
//
// IT THEN FAILED ON THE ONE ROUTE INSTALL.md MAKES MANDATORY. npx materialises the package and runs its
// bin through a shim of the package's OWN name, so `basename(argv[1])` is `clearotron` there exactly as
// it is for a global install. A reader following §2 was told `clearotron install` and got rc 127.
//
// The four drives below are the ones that found it. They are the arm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { invocationPrefix, invoke, standFrom } from "../../shared/invocation.mjs";
import { INSTALL_DIR } from "../../shared/verb-shim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "..", "bin");

// ── — THE ANSWER SET GREW, AND THESE DRIVES PINNED TWO OF THREE VARIABLES ──
//
// Every arm below was written when this helper could return exactly `` or `npx `, and their envs named
// neither HOME nor PATH. That left the expected value under-determined the moment a third answer
// existed: the same drive returns `npx ` on a box with no shim of ours and `` on one where the reader's
// own shim is first on PATH. The drives are unchanged and so is what they protect — a reader who
// arrived BY npx must never be told the bare name. What is added is the variable that was always
// there and never stated.
//
// `npx ` alone is no longer among the answers, because it was never a runnable line anywhere but inside
// the checkout — which is the whole of issue 1916. Where the old answer was `npx `, the new one names
// the directory to run it from.
const NO_SHIM = Object.freeze({ HOME: "/home/nobody-in-particular", PATH: "/usr/bin:/bin" });
const NOTHING_ON_DISK = Object.freeze({
  exists: () => false,
  read: () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
});
const IN_PLACE = `cd ${INSTALL_DIR} && npx `;

test("#1851 the four routes a reader can arrive by, and npx is two of them", () => {
  // ✕ EACH DRIVE ISOLATES ONE SIGNAL, AND THE FIRST CUT DID NOT. It paired an `_npx` path WITH
  // `npm_command=exec`, and gave the env-free case a `.mjs` basename — so removing EITHER check left
  // this arm green: the shim case was still caught by the path, and the cache-path case fell through to
  // the final basename test and returned `npx ` for a reason that has nothing to do with the check it
  // was meant to prove. Measured by planting each check away. A control that passes on a different
  // matcher proves the outcome, never the mechanism.
  const drives = [
    // ONLY the env says npx: a path that would otherwise read as a real global bin.
    ["npx via env alone", "/usr/local/bin/clearotron", { ...NO_SHIM, npm_command: "exec" }, IN_PLACE],
    // ONLY the path says npx: npx's shim carries the package's OWN name, so the basename test reads it
    // as a global install. This is the exact case that shipped rc 127 to a reader following INSTALL §2.
    ["npx via path alone", "/opt/cache/_npx/a1b2/node_modules/.bin/clearotron", NO_SHIM, IN_PLACE],
    // Both together — the ordinary npx run, and the one a reader actually performs.
    ["npx, both signals", "/opt/cache/_npx/a1b2/node_modules/.bin/clearotron", { ...NO_SHIM, npm_command: "exec" }, IN_PLACE],
    ["node bin/clearotron.mjs", "/opt/checkout/bin/clearotron.mjs", NO_SHIM, IN_PLACE],
    ["a real global bin", "/usr/local/bin/clearotron", NO_SHIM, ""],
  ];
  for (const [name, argv1, env, want] of drives) {
    assert.equal(invocationPrefix(argv1, env, NOTHING_ON_DISK), want,
      `${name}: a reader arriving this way must be told ${want ? "a form that names where to run it" : "the bare name"} — `
      + "telling them the other one is either `command not found` or noise implying their install is lesser");
  }
});

test("#1851 `npm run` is not npx, so a bare install driven from a script keeps the bare form", () => {
  // The discriminator keys on `exec` specifically. `npm run` sets `run-script`; widening this to "any
  // npm_command" would put `npx ` in front of a global install's advice for no reason.
  assert.equal(invocationPrefix("/usr/local/bin/clearotron", { ...NO_SHIM, npm_command: "run-script" }, NOTHING_ON_DISK), "");
  assert.equal(invocationPrefix("/usr/local/bin/clearotron", { ...NO_SHIM, npm_lifecycle_event: "test" }, NOTHING_ON_DISK), "");
});

test("#1851 the dispatcher's own argv still wins for the verbs it spawns", () => {
  // A spawned verb's argv[1] is `bin/onboard.mjs` however the reader started it, so reading argv alone
  // would tell every verb to print `npx` even for someone who typed a bare `clearotron`.
  assert.equal(invocationPrefix("/opt/checkout/bin/onboard.mjs", { ...NO_SHIM, CLEAROTRON_INVOKED_AS: "/usr/local/bin/clearotron" }, NOTHING_ON_DISK), "",
    "the handed-down argv is what the reader typed; the child's own is an implementation detail");
  // …and it does not override the npx signal, because a child of an npx run is still an npx run.
  assert.equal(
    invocationPrefix("/opt/checkout/bin/onboard.mjs",
      { ...NO_SHIM, CLEAROTRON_INVOKED_AS: "/opt/cache/_npx/a/node_modules/.bin/clearotron", npm_command: "exec" }, NOTHING_ON_DISK),
    IN_PLACE);
});

test("#1851 invoke() composes the whole line, not just the prefix", () => {
  assert.equal(invoke("install", "/usr/local/bin/clearotron", NO_SHIM, NOTHING_ON_DISK), "clearotron install");
  assert.equal(invoke("install", "/opt/checkout/bin/clearotron.mjs", NO_SHIM, NOTHING_ON_DISK),
    `cd ${INSTALL_DIR} && npx clearotron install`);
});

// ── CRITERION 2: ONE TREATMENT, NOT THREE ─────────────────────────────────────────────────────────
//
// The issue's second half is that three treatments shipped side by side — hardcoded `npx clearotron`,
// helper-derived, and bare. A reader hitting the hardcoded one on a global install is told to type
// `npx` for no reason; a reader hitting the bare one through npx gets rc 127. The helper is only worth
// having if it is the ONLY way a command reaches a reader.
test("#1851 no printed command in bin/ hardcodes its own prefix", () => {
  const files = readdirSync(BIN).filter((f) => f.endsWith(".mjs"));
  // FLOOR. A walk that finds no files reports clean, which is how a corpus guard goes quiet.
  assert.ok(files.length >= 8, `only ${files.length} verb file(s) found — the walk is broken, not the tree`);

  const offenders = [];
  for (const f of files) {
    const src = readFileSync(join(BIN, f), "utf8");
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;          // source comments are not printed to anyone
      if (!/\b(say|console\.log|console\.error)\s*\(|USAGE\s*=/.test(line) && !/^\s{4,}\S/.test(line)) return;
      if (/npx clearotron/.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 96)}`);
    });
  }
  assert.deepEqual(offenders, [],
    "these print a hardcoded `npx ` at a reader who may not need it — route them through `invocationPrefix()`, "
    + `which answers for the route they actually arrived by:\n  ${offenders.join("\n  ")}`);
});

// ✕ AND THE EXEMPTION THAT IS NOT AN OVERSIGHT, recorded so a later sweep does not "fix" it.
//
// `console.error("clearotron passphrase: unrecognised argument …")` is a DIAGNOSTIC PREFIX in the
// conventional `progname: message` form, not an instruction to type anything. Prefixing those with
// `npx ` would make an error label read as a command — the opposite of this issue's purpose. They are
// deliberately outside the guard above, which keys on printed COMMAND lines.
test("#1851 a `progname: message` diagnostic is not a command and keeps the bare name", () => {
  const src = readFileSync(join(BIN, "passphrase.mjs"), "utf8");
  assert.match(src, /console\.error\(\x60clearotron passphrase: unrecognised argument/,
    "the diagnostic prefix stays bare — if this is ever 'fixed' to `npx clearotron passphrase:` the error "
    + "line starts reading as something to run, and this arm is where that argument is written down");
});

// ── — F7 · the advice pointed a reader into node_modules ───────────────────
//
// On a packaged install this module lives in `<project>/node_modules/clearotron`, so the in-place form
// `cd <install dir> && npx` sent every printed command into node_modules — nine lines of one `doctor`
// run, the .env line among them. It WORKS, which is why it survived, and it teaches a reader that the
// product lives in a directory the install document tells them in bold not to enter. A tool and its own
// documentation disagreeing is a defect whichever of them is technically correct.
//
// npm puts the executable in `<project>/node_modules/.bin` and npx resolves it from the PROJECT ROOT —
// driven on a real packaged tree by role-dev/Grogu: `npx clearotron doctor` from the root exits 0.

test("2175-F7 a packaged install sends the reader to the project, not into node_modules", () => {
  assert.equal(standFrom("/srv/example/app/node_modules/clearotron"), "/srv/example/app");
});

test("2175-F7 a git checkout is unchanged — there is no node_modules segment to step out of", () => {
  assert.equal(standFrom("/srv/example/clearotron-checkout"), "/srv/example/clearotron-checkout");
  // And the live value: whatever this checkout is, the form must not name a node_modules directory.
  assert.doesNotMatch(`${standFrom(INSTALL_DIR)}/`, /\/node_modules\//,
    "the place a reader is told to stand must never be inside node_modules");
});

test("2175-F7 the NEAREST project root wins, and a lookalike directory is not one", () => {
  // A project may itself sit under someone else's node_modules; the root we want is the one directly
  // above this copy, not the outermost in the string.
  assert.equal(standFrom("/a/node_modules/@s/x/node_modules/clearotron"), "/a/node_modules/@s/x");
  // Separator-delimited, so a directory that merely starts with the name is left alone.
  assert.equal(standFrom("/srv/node_modules_backup/clearotron"), "/srv/node_modules_backup/clearotron");
});
