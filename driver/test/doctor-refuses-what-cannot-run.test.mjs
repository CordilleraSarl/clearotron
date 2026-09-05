// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — `doctor` SAID "NOTHING WRONG" ON AN INSTALL THAT COULD NOT RUN.
//
// Measured on a greenfield public clone: "no register is selected — ... every search refuses until one
// is", four lines later "Nothing wrong with what is configured", exit 0. The body was honest and the
// verdict contradicted it, and the reader who scrolls to the bottom is the one who gets misled.
//
// THE EXIT CODE IS NOT THE FIX, AND THE FIRST VERSION OF THIS FILE GOT THAT WRONG. `--check` separates
// an ABSENCE (a fresh machine: reported, exit 0) from a MISCONFIGURATION (something set wrongly: exit 1)
// — a deliberate contract with its rationale written into onboard-wizard.test.mjs, which asserts exit 0
// on an unconfigured machine. Making a missing register exit non-zero reddened six of those arms. They
// are the contract, not an obstacle to it. So the exit status is untouched here and the VERDICT is what
// changed: it may not claim nothing is wrong while something that stops the product stands above it.
//
// The last arm is the control that keeps the distinction honest — a real misconfiguration must still
// exit 1, or this change would have flattened two states into one while looking like a fix.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Run the real command and return its status and text together.
 *
 *  `HOME` is pinned to a scratch directory: this command reads `~/.env`, and an arm that inherited the
 *  developer's home would be measuring that person's box rather than the code.
 *
 *  GIT STATE IS PINNED FOR THE SAME REASON, and this file was the only doctor arm that did not do it.
 *  `deploymentCurrency` reports `N commit(s) behind origin/main` on any checkout behind its upstream and
 *  that exits 1 — so these arms went red on a developer branch that had not merged main in that hour,
 *  while main itself was green and the same commit passed in a detached worktree. Nothing about the code
 *  under test had changed; the arm was measuring the box's git position, which is exactly the class the
 *  HOME pin above exists to prevent. Two lanes have now paid for it.
 *
 *  `CLEAROTRON_DOCTOR_ASSUME_PINNED` is the mechanism the product already ships for this, added after the
 *  same failure took main red twice in one day with eight arms each time (onboard.mjs's own note: "a CI
 *  workspace is not a deployment"). The three other doctor arms — onboard-wizard, the packaged-install
 *  upgrade and the portal-bundle check — all already set it. This file was the outlier, not the pioneer.
 *
 *  ✕ IT DOES NOT WEAKEN THE BEHIND-CHECK. That behaviour is armed where it belongs, against
 *  `deploymentCurrency` directly in onboard-wizard.test.mjs, including the arm holding that an UNPINNED
 *  checkout behind its upstream still reports behind. Pinning here says "currency is not the question
 *  this file asks", which is true of every arm below: they are about what the VERDICT says when no
 *  register is selected. It stays overridable through `env` so an arm wanting the unpinned reading can
 *  still have it. */
function doctor({ env = {}, repo = ROOT } = {}) {
  const home = mkdtempSync(join(tmpdir(), "doctor-home-"));
  try {
    const r = spawnSync(process.execPath, [join(repo, "bin", "clearotron.mjs"), "doctor"],
      { cwd: repo, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...env } });
    // The spawn's own fate before its text means anything (2064): a child that never came back returns
    // empty output, and every assert below would then fire naming the SUBJECT instead of the child.
    if (r.error || r.signal) throw new Error(`the child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

/** A throwaway REPO: `bin/` copied for real so `import.meta.url` resolves inside it, everything else
 *  symlinked so nothing is duplicated and nothing real is touched. `portal-ui` is created empty, which is
 *  the planted state — the bundle path `doctor` builds is `<repo>/portal-ui/dist`.
 *
 *  Moving the real `portal-ui/dist` aside would have been shorter and is wrong: test files run in parallel
 *  and another arm reads that bundle, so the plant would surface as an unrelated red somewhere else. */
function repoWithoutBundle() {
  const dir = mkdtempSync(join(tmpdir(), "doctor-repo-"));
  cpSync(join(ROOT, "bin"), join(dir, "bin"), { recursive: true });
  for (const entry of ["driver", "shared", "providers", "mcp-server", "scripts", "node_modules", "package.json"]) {
    symlinkSync(join(ROOT, entry), join(dir, entry));
  }
  mkdirSync(join(dir, "portal-ui"));
  return dir;
}

test("an install that cannot search says so in its VERDICT, and still exits 0", () => {
  const { status, out } = doctor();                       // CLEAROTRON_DATABASE absent from the child's env
  assert.doesNotMatch(out, /Nothing wrong with what is configured/,
    "this is the defect: the closing line claimed nothing was wrong while the line above it said every "
    + "search refuses. A reader who scrolls to the bottom must get the same answer as one who read it all");
  assert.match(out, /cannot do everything yet/,
    "the verdict must say the install is incomplete rather than fine");
  assert.match(out, /no register is selected[\s\S]*every search refuses/,
    "and it must NAME what is unset in the verdict, not merely hint that something is");
  assert.equal(status, 0,
    "exit status is a contract: an ABSENCE reports and exits 0, a MISCONFIGURATION exits 1. An install "
    + "that has not chosen a register yet is unfinished, not broken — onboard-wizard.test.mjs holds this "
    + "and six of its arms went red when an earlier version of this file made it exit 1");
});

test("and it is conditional, not a doctor that always refuses", () => {
  const { out } = doctor({ env: { CLEAROTRON_DATABASE: "free-tier" } });
  assert.doesNotMatch(out, /no register is selected/,
    "with a register named, this finding must be gone entirely — an arm that only drives the refusing "
    + "direction would pass against a doctor hard-wired to fail");
});

test("a missing portal-ui bundle reaches the verdict too, with the line that repairs it", () => {
  const repo = repoWithoutBundle();
  try {
    // No register named either, so this drives the case the verdict must handle: TWO blockers, both
    // absences, neither of them a misconfiguration.
    const { status, out } = doctor({ repo });
    assert.match(out, /no UI bundle at/,
      "an absent bundle is the one condition that stops /portal rendering, and doctor reported nothing at all");
    assert.match(out, /npm run build:ui/,
      "a finding a reader cannot act on is half a finding — the remedy travels with it");
    assert.match(out, /cannot do everything yet[\s\S]*no UI bundle/,
      "and it must reach the closing line; before this it was a `!` the verdict never counted");
    assert.equal(status, 0,
      "an unbuilt clone is an ABSENCE, not a misconfiguration — same contract as the register above");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

/**
 * The smallest bundle `doctor` will call present.
 *
 * ✕ IT MUST NOT BE THE REAL TREE'S. This arm used to symlink `<ROOT>/portal-ui/dist` into the fixture,
 * which made it pass only on a tree where `npm run build:ui` had been run — and `portal-ui/dist` is
 * withheld from the public cut and is not built by the public CI's offline-suites job, which runs
 * test:full without it. So the arm refused on the exported tree and blocked the export (measured
 * 2026-09-05). Four other arms reach for that bundle and every one of them already skips by name when
 * it is absent; this one is about doctor's PRESENT branch, and a skip would delete the assertion rather
 * than move it.
 *
 * The predicate doctor asks is `makeStaticHandler({distDir}).present()`, and that is `index() != null` —
 * one readable `index.html` under `dist/`. `assets/` is created beside it because a real bundle has one
 * and a fixture that is one file wide invites the next reader to assume the check reads the directory.
 */
function plantBundle(repo) {
  mkdirSync(join(repo, "portal-ui", "dist", "assets"), { recursive: true });
  writeFileSync(join(repo, "portal-ui", "dist", "index.html"), "<!doctype html><title>portal</title>\n");
}

test("a present bundle is reported present, and does not manufacture a problem", () => {
  const repo = repoWithoutBundle();
  try {
    plantBundle(repo);
    const { out } = doctor({ repo, env: { CLEAROTRON_DATABASE: "free-tier" } });
    assert.match(out, /✓ portal-ui\/dist is present/, "the ordinary tree must read as present");
    assert.doesNotMatch(out, /no UI bundle at/, "and carry none of the absent-bundle finding");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("THE CONTROL: a real misconfiguration still exits 1, so the two states did not collapse into one", () => {
  // Without this, everything above is satisfied by a doctor that exits 0 unconditionally — which would
  // be a worse product than the one this file was opened to fix, and would look exactly like a pass.
  const { status, out } = doctor({ env: { CLEAROTRON_CLAUDE_PATH: "./claude" } });
  assert.equal(status, 1,
    "a relative CLEAROTRON_CLAUDE_PATH is something SET WRONGLY, not something absent, and setup is the "
    + "cheap place to learn it");
  assert.match(out, /RELATIVE|not an executable file/, out);
  assert.match(out, /problem\(s\)/,
    "and it must still be reported AS a problem, with the count that decides the exit status");
  // NOT asserting that the incomplete-install wording is absent. This environment has no register
  // either, so both are true at once, and the verdict says both on purpose — printing the count while
  // staying silent about "nothing can search" is the original defect one level up. An earlier draft of
  // this arm asserted the opposite and was wrong about the product, not about the code.
});

// ── DOCTOR SPEAKS IN ITS OWN VOICE, INCLUDING WHEN IT CANNOT LOOK ───────────────────────────────────
//
// `systemctl --user show` is run to learn whether the client door is running. Its stderr was inherited,
// so on a box with no user session bus — a fresh install, before anyone has logged in properly — the
// sentence "Failed to connect to bus: No medium found" landed in the middle of the report, under a
// heading, in systemd's voice, explaining nothing to the reader who reached it. The null it produced
// was already the right answer; the leak was the defect.
//
// `doctor()` above hands the child no DBUS_SESSION_BUS_ADDRESS and no XDG_RUNTIME_DIR, so this drives
// the failing branch on any host rather than only on one without a session.

test("no raw systemd error reaches the report — the command speaks for itself", () => {
  const { out } = doctor();
  assert.doesNotMatch(out, /Failed to connect to bus|No medium found/,
    "systemctl's own stderr reached the reader mid-report. Whether the door is running is doctor's "
    + "question to ask and doctor's to answer; the tool it used to ask is not the reader's business");
  // NOT asserting the section is silent. A could-not-look is still reported — in this command's words,
  // and only where the answer would have mattered — so an arm demanding silence would be asking for
  // the opposite failure.
  assert.match(out, /Client connector/, "and the section it happened inside is still rendered");
});

// ── 2191 · THE PORT AND ITS ALLOW-LIST ARE ONE SETTING ──────────────────────────────────────────────
//
// `start` derives CLIENT_MCP_ALLOWED_HOSTS from the port it resolved, so moving the port THROUGH start
// works. Moving it in the env file the units load does not: the door binds the new port and answers
// "403 Invalid Host header" on every request, because the allow-list still names the old one. A door
// that is up, listening and refusing everything is the worst of the three states to debug, and nothing
// surfaced the mismatch. Found by an operator pass, not by any check.

test("2191 a port the allow-list does not name is reported, with what it would cost", () => {
  // NO REGISTER NAMED, deliberately: `free-tier` brings real credential problems of its own, and the
  // exit assertion below would then be measuring those instead of this. An earlier draft did exactly
  // that and failed on a tree that satisfies the criterion.
  const { status, out } = doctor({ env: {
    CLIENT_MCP_HTTP_PORT: "19318",
    CLIENT_MCP_ALLOWED_HOSTS: "127.0.0.1:18811,localhost:18811",   // left behind on the old port
  } });
  assert.match(out, /CLIENT_MCP_ALLOWED_HOSTS does not name port 19318/, out);
  assert.match(out, /403 Invalid Host header/,
    "the consequence has to travel with it — 'these disagree' is not something a reader can weigh");
  assert.equal(status, 0, "it is an absence to fix, not a misconfiguration that fails the exit contract");
});

test("2191 and an allow-list that DOES name the port says nothing at all", () => {
  // Without this the arm above is satisfied by a doctor that warns unconditionally, which would train
  // every reader to ignore the line.
  const { out } = doctor({ env: {
    CLIENT_MCP_HTTP_PORT: "19318",
    CLIENT_MCP_ALLOWED_HOSTS: "127.0.0.1:19318,localhost:19318,mcp.example.test",
  } });
  assert.doesNotMatch(out, /does not name port/,
    "a list carrying the loopback pair for this port is correct, extra public hostnames included");
});
