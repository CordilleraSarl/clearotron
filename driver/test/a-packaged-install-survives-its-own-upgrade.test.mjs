// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An ordinary upgrade destroys a packaged install's configuration, and the one
// command whose job is to say what is wrong with an install could not see either half of it.
//
// TWO SEPARATE DEFECTS, ONE POPULATION. On a global install (`npm i -g clearotron` — the public route)
// the bare `clearotron` works perfectly and `doctor` said "no `clearotron` on your PATH", because the
// only identity test it had was reading OUR shim in `~/.local/bin` and npm's global executable is not a
// file this product ever wrote. And on any packaged install the wizard writes `.env` into a directory
// npm owns, so the documented upgrade replaces the tree and takes the configuration with it — after
// which `doctor` printed the same "not set up yet" note a brand-new machine gets, at rc 0.
//
// The third arm family is the LOCATION switch. Where the file should live instead is the owner's call on
// and is not taken here; what is asserted is that one resolver answers for every site,
// so the ruling is one line — and that the candidates nobody has chosen actually resolve, because wiring
// whose unchosen branches never execute is wiring that asserts itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { globalBinDirFrom, invocationForm, invocationPrefix, standFrom } from "../../shared/invocation.mjs";
import { ENV_LOCAL_LOCATION, envLocalPath, loadEnvLocal } from "../../shared/env-local.mjs";
import { DATA_DIRS, configurationLostToUpgrade } from "../../bin/onboard.mjs";
import { hermeticInstallRoot } from "./hermetic-install-root.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

// npm's global layout, POSIX: the package under <prefix>/lib/node_modules and the executable npm links
// for it at <prefix>/bin. The shape is the reporter's, measured on their box; the PREFIX below is not
// their path — ` no executable line names a specific account's home directory` refuses that, and
// rightly: a real operator's home in a test is a fact about one machine dressed as a constant. The
// measured original is recorded in shared/invocation.mjs's comment, where it is provenance rather than
// an input. `/srv/example` is the convention driver/test/invocation-prefix.test.mjs already uses.
const PREFIX = "/srv/example/.npm-global";
const GLOBAL_INSTALL = `${PREFIX}/lib/node_modules/clearotron`;
const GLOBAL_EXE = `${PREFIX}/bin/clearotron`;

/** A machine that is entirely made up: nothing here reads the disk this suite is running on. */
const machine = ({ files = [], path = [] }) => ({
  exists: (p) => files.includes(p),
  read: (p) => { if (!files.includes(p)) throw new Error("ENOENT"); return ""; },
  env: { HOME: "/srv/example/home", PATH: path.join(":") },
});

// ── the derivation ──────────────────────────────────────────────────────────────────────────────────

test("2205 the global executable is DERIVED from this install's own path, never looked up by name", () => {
  // The whole point of the fix. `shared/invocation.mjs` carries an explicit prohibition against
  // answering this with `which`/`command -v`, because a PATH lookup finds SOME clearotron and the
  // question is whether the name reaches THIS one. So the derivation is pure and takes no PATH at all.
  assert.equal(globalBinDirFrom(GLOBAL_INSTALL), `${PREFIX}/bin`);
});

test("2205 a LOCAL install derives no global executable — npm never put one on a PATH", () => {
  // <project>/node_modules/clearotron has no `lib` segment. npm links those into
  // <project>/node_modules/.bin, which is on nobody's PATH, and `standFrom` already answers that case.
  const local = "/srv/example/project/node_modules/clearotron";
  assert.equal(globalBinDirFrom(local), null);
  assert.equal(standFrom(local), "/srv/example/project", "and the case it DOES answer still answers");
});

test("2205 the derivation refuses layouts that are not ours, so it cannot name a stranger's executable", () => {
  // Each of these is one edit away from the real layout, and each must answer null. The basename check
  // is the identity half: without it this function would happily name a bin directory for any package
  // sitting in a global root.
  const notOurs = [
    `${PREFIX}/lib/node_modules/some-other-package`,   // a different package in the same global root
    `${PREFIX}/lib/node_modules/clearotron/bin`,       // a subdirectory of ours, not the root
    `${PREFIX}/node_modules/clearotron`,               // no `lib` — npm's WINDOWS layout, a different shape
    "/srv/example/checkout/clearotron",                     // a git clone that happens to be named for us
    "", null, undefined,
  ];
  assert.ok(nonEmpty(notOurs, "the near-miss layouts"));
  for (const dir of notOurs) assert.equal(globalBinDirFrom(dir), null, `derived a path for ${JSON.stringify(dir)}`);
  assert.equal(globalBinDirFrom(GLOBAL_INSTALL, "win32"), null, "and the platform npm lays out differently answers null rather than guessing");
});

// ── what doctor is told ─────────────────────────────────────────────────────────────────────────────

test("2205 a global install on PATH is the BARE form, and the shim is npm's executable", () => {
  const m = machine({ files: [GLOBAL_EXE], path: [`${PREFIX}/bin`, "/usr/bin"] });
  const form = invocationForm(m.env, m, GLOBAL_INSTALL);
  assert.equal(form.form, "bare", JSON.stringify(form));
  assert.equal(form.prefix, "");
  assert.equal(form.shim, GLOBAL_EXE);
  assert.equal(form.via, "global", "and it says which mechanism answered, so the next reader is not left inferring it");
});

test("2205 invocationPrefix and invocationForm AGREE about a global install", () => {
  // THE DISCRIMINATING ARM. Both surfaces were already self-consistent; they disagreed with each other.
  // invocationPrefix returns bare for a global install off its basename branch — it always did — while
  // invocationForm reported no clearotron on PATH, so `doctor` printed a bare command in one paragraph
  // and "there is no bare command" in the next. Two surfaces answering one question differently is the
  // shape this file's fix is about, and neither arm alone can see it.
  const m = machine({ files: [GLOBAL_EXE], path: [`${PREFIX}/bin`, "/usr/bin"] });
  assert.equal(invocationPrefix(GLOBAL_EXE, m.env, m, GLOBAL_INSTALL), "",
    "argv[1] IS the global executable — the reader typed the bare name and it worked");
  assert.equal(invocationForm(m.env, m, GLOBAL_INSTALL).prefix, "",
    "and the form derived from the install must say the same thing");
});

test("2205 a global install NOT on PATH names its executable in full — never `cd <prefix>/lib && npx`", () => {
  // The half that was actively wrong rather than merely silent. Falling through to `in-place` handed
  // back `cd ${standFrom(installDir)} && npx clearotron`, and for this layout standFrom names
  // <prefix>/lib — a directory with no package.json, where npx reports "could not determine executable
  // to run". That is the exact failure was opened to end.
  const m = machine({ files: [GLOBAL_EXE], path: ["/usr/bin"] });
  const form = invocationForm(m.env, m, GLOBAL_INSTALL);
  assert.equal(form.form, "shim-path");
  assert.equal(form.prefix, `${PREFIX}/bin${sep}`);
  assert.equal(form.onPath, false);
  assert.ok(!form.prefix.includes("npx"), `advice routed through npx from a directory with no package.json: ${form.prefix}`);
  assert.ok(!form.prefix.includes(`${sep}lib`), `advice named <prefix>/lib: ${form.prefix}`);
});

test("2205 a clearotron earlier on PATH DEMOTES the global form rather than confirming it", () => {
  // Availability would say yes here. Identity says: something else answers that name first, so name
  // ours in full. The prohibition at the top of shared/invocation.mjs is exactly about this case.
  const m = machine({ files: [GLOBAL_EXE, "/usr/local/bin/clearotron"], path: ["/usr/local/bin", `${PREFIX}/bin`] });
  const form = invocationForm(m.env, m, GLOBAL_INSTALL);
  assert.equal(form.form, "shim-path", JSON.stringify(form));
  assert.equal(form.shadowedBy, "/usr/local/bin/clearotron");
});

test("2205 OUR OWN shim still wins — the global branch is asked second, and only second", () => {
  // ~/.local/bin is where this product writes its shim, and a shim that names this install is stronger
  // evidence than a layout derivation. The new branch must not have quietly taken precedence over it.
  const shim = "/srv/example/home/.local/bin/clearotron";
  const io = {
    exists: (p) => [shim, GLOBAL_EXE].includes(p),
    read: (p) => (p === shim ? `#!/bin/sh\n# clearotron install shim v1\n# install: ${GLOBAL_INSTALL}\nexec "/usr/bin/node" x\n` : (() => { throw new Error("ENOENT"); })()),
  };
  const env = { HOME: "/srv/example/home", PATH: ["/srv/example/home/.local/bin", `${PREFIX}/bin`].join(":") };
  const form = invocationForm(env, io, GLOBAL_INSTALL);
  assert.equal(form.shim, shim, "the shim we wrote is what identifies the install when it is there");
  assert.notEqual(form.via, "global");
});

// ── the .env that an upgrade ate ────────────────────────────────────────────────────────────────────

/** Real existence, for the temp directories the fixtures actually create. */
const existsOnDisk = (p) => { try { statSync(p); return true; } catch { return false; } };

const HOME_WITH_DATA = (dirs) => {
  const home = mkdtempSync(join(tmpdir(), "upgrade-home-"));
  for (const sub of dirs) mkdirSync(join(home, "trademark", sub), { recursive: true });
  return home;
};

test("2205 a packaged install whose .env is gone and whose data directories stand is a LOST CONFIGURATION", () => {
  const home = HOME_WITH_DATA(Object.values(DATA_DIRS));
  try {
    const lost = configurationLostToUpgrade({
      envPath: join(home, "p", "node_modules", "clearotron", ".env"),
      installDir: join(home, "p", "node_modules", "clearotron"),
      env: {}, home, exists: (p) => !p.endsWith(".env") && existsOnDisk(p),
    });
    assert.ok(lost, "the wizard ran (five directories) and its output is gone — that is not a fresh machine");
    assert.equal(lost.base, join(home, "trademark"));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2205 a SOURCE CHECKOUT is never accused of this, whatever is in the developer's home", () => {
  // The false positive that would have shipped. This very box has ~/trademark/{pool,workspace,queue,
  // outbox,locks} and no .env in the checkout, so a discriminator resting on the data directories alone
  // would have turned every developer's `doctor` red — and reddened the arms that drive it.
  const home = HOME_WITH_DATA(Object.values(DATA_DIRS));
  try {
    assert.equal(configurationLostToUpgrade({
      envPath: "/srv/example/checkout/.env", installDir: "/srv/example/checkout",
      env: {}, home, exists: (p) => !p.endsWith(".env") && existsOnDisk(p),
    }), null, "npm does not replace a git checkout, so an upgrade cannot have eaten anything here");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2205 an environment that still carries the configuration is not a lost one", () => {
  // A shell or a service file supplying these is a configured install with no .env — a supported shape,
  // and silent about upgrades. Only when nothing else supplies them is the missing file why it is down.
  const home = HOME_WITH_DATA(Object.values(DATA_DIRS));
  try {
    assert.equal(configurationLostToUpgrade({
      envPath: "/p/node_modules/clearotron/.env", installDir: "/p/node_modules/clearotron",
      env: { CLEAROTRON_WORK_DIR: "/srv/work" }, home, exists: (p) => !p.endsWith(".env") && existsOnDisk(p),
    }), null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2205 the signature is ALL FIVE directories — any one of them alone is somebody's unrelated folder", () => {
  const subs = Object.values(DATA_DIRS);
  assert.ok(nonEmpty(subs, "the wizard's data directories"));
  for (const missing of subs) {
    const home = HOME_WITH_DATA(subs.filter((s) => s !== missing));
    try {
      assert.equal(configurationLostToUpgrade({
        envPath: "/p/node_modules/clearotron/.env", installDir: "/p/node_modules/clearotron",
        env: {}, home, exists: (p) => !p.endsWith(".env") && existsOnDisk(p),
      }), null, `four of five (no ${missing}) was read as a completed wizard run`);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

// ── where the file lives: wired, not chosen ─────────────────────────────────────────────────────────

test("2177 every candidate location RESOLVES, including the ones nobody has chosen", () => {
  // Wiring whose unchosen branches never execute is wiring that asserts itself. The owner's ruling has
  // to be a one-line flip, and this is what makes that claim testable before the ruling exists.
  const repoRoot = "/p/node_modules/clearotron";
  const home = "/srv/example/home";
  const resolved = {
    "package-root": envLocalPath({ repoRoot, home, location: "package-root" }),
    "project-root": envLocalPath({ repoRoot, home, location: "project-root" }),
    "xdg-config": envLocalPath({ repoRoot, home, location: "xdg-config" }),
  };
  assert.equal(resolved["package-root"], "/p/node_modules/clearotron/.env");
  assert.equal(resolved["project-root"], "/p/.env", "option 1 — outside the tree npm replaces");
  assert.equal(resolved["xdg-config"], "/srv/example/home/.config/clearotron/.env", "option 2b");
  assert.equal(new Set(Object.values(resolved)).size, 3,
    "on a PACKAGED install the three candidates are three different files — which is the whole subject of 2177");
});

test("2177 the location in force is the one the owner ruled", () => {
  // THE FLIP LANDED (tracker issue 140, 2026-09-05). This arm used to assert `package-root` and to say
  // that a failure here means the flip is landing — it did, and the two things it told the next reader
  // to check were done with it: the ruling is on the thread, and doctor's door-divergence pair follows
  // the resolver rather than composing its own path.
  assert.equal(ENV_LOCAL_LOCATION, "xdg-config",
    "the location is the owner's ruling, not a dev call — moving it again is a ruling, not a refactor");
});

test("2177 the WRITER and the READER resolve to the same file under a candidate that is not in force", () => {
  // THE FAILURE THIS PREVENTS IS SILENT. Nine sites used to compute this path themselves; a flip that
  // moved the writer and left the reader would lose an operator's configuration while every command
  // still exited 0. Driven against `project-root` precisely BECAUSE it is not the one in force.
  const repoRoot = "/p/node_modules/clearotron";
  // DRIVEN AT `project-root`, WHICH IS NOT IN FORCE, and that is the only spelling of this arm that can
  // fail. `package-root` resolves to exactly the string the nine sites used to compose by hand, so a
  // reader that ignored the resolver entirely would still agree with it today — and would still agree
  // on the day the flip landed and the configuration went missing.
  const want = envLocalPath({ repoRoot, location: "project-root" });
  assert.equal(want, "/p/.env", "option 1 puts it above the tree npm replaces");
  const seen = loadEnvLocal({ env: {}, repoRoot, location: "project-root", note: () => {} });
  assert.equal(seen.path, want,
    "the reader asks the resolver rather than composing the path, so it follows the constant wherever it goes");
  assert.notEqual(seen.path, join(repoRoot, ".env"),
    "and it is genuinely a different file from today's — otherwise this arm proves nothing");
});

test("2177 an unknown location REFUSES rather than falling back to today's", () => {
  // A typo in the flip must not read as "the ruling landed and nothing moved".
  assert.throws(() => envLocalPath({ location: "wherever" }), /names no candidate/);
});

// ── driven at the door ──────────────────────────────────────────────────────────────────────────────

const NODE_BIN = mkdtempSync(join(tmpdir(), "upgrade-node-"));
symlinkSync(process.execPath, join(NODE_BIN, "node"));

function doctor(root, home) {
  try {
    const out = execFileSync(process.execPath, [join(root, "bin", "onboard.mjs"), "--check"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" },
    });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}

test("2205 doctor REPORTS the upgrade as the cause, at rc 1, on a real packaged tree", () => {
  const { root } = hermeticInstallRoot(null, { packaged: true });
  const home = HOME_WITH_DATA(Object.values(DATA_DIRS));
  try {
    const r = doctor(root, home);
    assert.equal(r.code, 1, r.out);
    // The path named is the one configuration is written to NOW — under the operator's config directory,
    // which no upgrade replaces. The shape this branch reports is unchanged: a packaged tree with every
    // data directory standing and no .env anywhere is a wizard run whose output was destroyed.
    assert.match(r.out, /no \.env at .*\.config[/\\]clearotron[/\\]\.env/, r.out);
    assert.match(r.out, /it cannot happen again/, r.out);
    assert.match(r.out, /replaced the package tree and took the configuration with it/, r.out);
    assert.match(r.out, new RegExp(`Nothing in ${join(home, "trademark")} was touched`), r.out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2205 and a FRESH machine is still an absence at rc 0 — the exit contract is unchanged", () => {
  // The contract this could most easily have broken: `--check` separates an ABSENCE from a
  // MISCONFIGURATION, and making every missing .env rc 1 would fail a new machine for being new.
  const { root } = hermeticInstallRoot(null, { packaged: true });
  const home = mkdtempSync(join(tmpdir(), "upgrade-fresh-"));
  try {
    const r = doctor(root, home);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /none at .*\.env/, r.out);
    assert.ok(!r.out.includes("took the configuration with it"),
      "a machine that never ran the wizard has had nothing taken from it");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
