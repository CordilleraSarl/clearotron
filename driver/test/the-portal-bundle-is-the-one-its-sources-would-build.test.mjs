// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// On the source route `git pull` cannot update `portal-ui/dist`, and nothing
// could tell a current bundle from a stale one.
//
// In this repository `portal-ui/dist` is untracked and must be built by hand, so a pull that changes
// `portal-ui/src` leaves the build behind: the portal serves the previous screen, `/portal/health` reads
// `ui:"built"` because that field has only two states, and `doctor` did not look at the bundle's age at
// all. Every step exits 0 and the operator has no reason to look.
//
// ✕ WHAT THIS FILE IS REALLY GUARDING IS THAT THE ROUTE IS DECIDED BEFORE ANY TIMESTAMP IS READ.
// "Two mtimes, and the product already knows both paths" is the obvious fix, and it is correct on
// exactly one of the five states a tree can be in:
//
//   a packaged install ships the bundle and NOT its sources, and npm normalises mtimes when it extracts,
//   so there is nothing to compare and comparing anyway reports a false stale on a correct install;
//
//   a tree that is not a git checkout has had no pull, which is this defect's whole mechanism;
//
//   a tree whose bundle is COMMITTED AND GATED — rebuilt by CI and refused on any byte of difference —
//   already has a stronger guarantee than a timestamp, and git does not preserve mtimes: a checkout
//   stamps whatever it wrote with the time it wrote it, so a branch switch touching one source file
//   makes it "newer" than a byte-perfect bundle;
//
//   a tree whose bundle is committed with NO such gate has no guarantee at all, and saying it has one is
//   worse than saying nothing;
//
//   and an untracked bundle in a real checkout is the one that can be judged, because git never writes
//   an untracked file, so both mtimes mean what they say.
//
// The arms below drive each state with timestamps that WOULD read stale, which is the only way to prove
// the route is asked first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleFreshness } from "../../shared/bundle-freshness.mjs";   // moved there when /portal/health became its second reader (tracker issue 160)
import { hermeticInstallRoot } from "./hermetic-install-root.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

/** A bundle whose sources are an hour newer than it — the shape a pull leaves behind. */
const STALE_TIMES = { distMtime: 1_000, newestSrcMtime: 4_600_000 };

test("2206 an untracked bundle older than its sources, in a checkout, is STALE", () => {
  assert.equal(bundleFreshness({
    srcPresent: true, distPresent: true, isGitCheckout: true, distTracked: false, ...STALE_TIMES,
  }), "stale");
});

test("2206 the same bundle built AFTER the pull is current", () => {
  assert.equal(bundleFreshness({
    srcPresent: true, distPresent: true, isGitCheckout: true, distTracked: false,
    distMtime: 4_600_000, newestSrcMtime: 1_000,
  }), "current");
});

test("2206 every state that must NOT be judged on a timestamp is decided before one is read", () => {
  // Each of these is handed the stale timestamp pair. Each must answer something other than "stale",
  // and the reason is different in every row — which is why they are a table and not one assertion.
  const rows = [
    { why: "the tarball: portal-ui/src does not ship, and npm normalises mtimes when it extracts",
      input: { srcPresent: false, distPresent: true, isGitCheckout: true, distTracked: false }, want: "no-sources" },
    { why: "dist committed AND the gate that rebuilds it present — a stronger check than a timestamp",
      input: { srcPresent: true, distPresent: true, isGitCheckout: true, distTracked: true, distGated: true }, want: "guarded" },
    { why: "an extracted archive: `git pull` is this defect's whole mechanism and there is none here",
      input: { srcPresent: true, distPresent: true, isGitCheckout: false, distTracked: false }, want: "unversioned" },
    { why: "nothing built yet: the documented pre-build state on a fresh clone, and already well reported",
      input: { srcPresent: true, distPresent: false, isGitCheckout: true, distTracked: false }, want: "unbuilt" },
  ];
  assert.ok(nonEmpty(rows, "the states that may not be judged on a timestamp"));
  for (const { why, input, want } of rows) {
    const got = bundleFreshness({ ...input, ...STALE_TIMES });
    assert.equal(got, want, `${why} — got ${got}`);
    assert.notEqual(got, "stale", `a false stale on a correct install: ${why}`);
  }
});

test("2206 a COMMITTED bundle with no gate behind it is not a guaranteed one", () => {
  // ✕ THE FALSE REASSURANCE THIS CELL ALMOST SHIPPED. An earlier cut read "tracked" as "guaranteed".
  // Measured on the exported tree: .gitignore does not ignore dist, the cut withholds dist itself, and
  // there is no .github/workflows at all — so a public reader who builds the bundle and runs `git add -A`
  // makes it tracked, and would have been told CI was checking it when nothing was. Same staleness as
  // the defect this file is about, with a tick over it, which is worse than the silence.
  //
  // Driven with the stale pair, so a wrong answer here is a wrong answer about a bundle that IS old.
  assert.equal(bundleFreshness({
    srcPresent: true, distPresent: true, isGitCheckout: true, distTracked: true, distGated: false, ...STALE_TIMES,
  }), "tracked-unguarded");
  assert.equal(bundleFreshness({
    srcPresent: true, distPresent: true, isGitCheckout: true, distTracked: true, distGated: true, ...STALE_TIMES,
  }), "guarded", "and the tree that DOES carry the gate still gets the guarantee — this is not a widening");
});

test("2206 a workflow that is not the gate does not confer the gate's guarantee", () => {
  // THE ARM THAT MAKES THE PREVIOUS ONE MEAN SOMETHING. Detecting the gate by the FILE NAME `ci.yml`
  // passes every other arm in this file — driven and confirmed — because every fixture that has a
  // workflow has the real one. The public repo carries its own CI, committed there directly and not from
  // this tree, and it does not rebuild the bundle: reading its NAME would hand a reader the guarantee on
  // the strength of a filename. So the gate is measured by the refusal text it prints, and this plants a
  // same-named workflow that does something else.
  const root = publicSourceClone({
    distOlder: true, commitDist: true,
    workflowBody: 'jobs:\n  offline-suites:\n    steps:\n      - run: npm run test:full\n',
  });
  const r = doctor(root);
  assert.match(r.out, /committed here, but nothing in this tree rebuilds it/, r.out);
  assert.ok(!r.out.includes("CI rebuilds it and fails on any difference"),
    "a workflow named ci.yml that never mentions the bundle was read as the bundle's gate");
});

test("2206 NOTHING TO SERVE is reported before any route is decided", () => {
  // The case every route row silently assumed away: they all describe a bundle that EXISTS. Asking the
  // route first meant a tree with neither bundle nor sources answered "no sources, so the bundle ships
  // with them" — a tick over an empty directory, and the absent-bundle finding lost. Caught by the arm
  // that drives doctor against a fixture repo with an empty portal-ui, which is exactly that tree.
  for (const srcPresent of [true, false]) {
    assert.equal(bundleFreshness({
      srcPresent, distPresent: false, isGitCheckout: false, distTracked: false, ...STALE_TIMES,
    }), "unbuilt", `srcPresent=${srcPresent} — with no bundle there is nothing to be current or stale about`);
  }
});

test("2206 a timestamp that could not be read is REPORTED, not ticked and not called stale", () => {
  // An absence is a finding. Both trees are there and one read back nothing, so neither answer this cell
  // exists to give is available: ticking would be absence-as-pass on the only branch that matters, and
  // calling it stale would send an operator to rebuild a bundle nobody has shown to be old.
  const times = [{ distMtime: 0, newestSrcMtime: 4_600_000 }, { distMtime: 4_600_000, newestSrcMtime: 0 }];
  assert.ok(nonEmpty(times, "the unreadable-timestamp shapes"));
  for (const t of times) {
    const got = bundleFreshness({ srcPresent: true, distPresent: true, isGitCheckout: true, distTracked: false, ...t });
    assert.equal(got, "unmeasured", JSON.stringify(t));
    assert.notEqual(got, "current", "a could-not-look reported as a pass is the shape this suite exists to refuse");
  }
});

// ── driven at the door ──────────────────────────────────────────────────────────────────────────────

const NODE_BIN = mkdtempSync(join(tmpdir(), "bundle-node-"));
symlinkSync(process.execPath, join(NODE_BIN, "node"));

function doctor(root) {
  const home = mkdtempSync(join(tmpdir(), "bundle-home-"));
  try {
    const out = execFileSync(process.execPath, [join(root, "bin", "onboard.mjs"), "--check"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" },
    });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}

/**
 * A tree shaped like a fresh PUBLIC clone: a real git checkout with `portal-ui/src` committed and
 * `portal-ui/dist` untracked, exactly as the cut leaves it. The hermetic root symlinks the real
 * portal-ui, so that link is replaced with real files — the ages are the whole subject here.
 */
function publicSourceClone({ distOlder, commitDist = false, withGate = false, workflowBody = null }) {
  const { root } = hermeticInstallRoot(null);
  rmSync(join(root, "portal-ui"), { recursive: true, force: true });
  mkdirSync(join(root, "portal-ui", "src"), { recursive: true });
  mkdirSync(join(root, "portal-ui", "dist"), { recursive: true });
  writeFileSync(join(root, "portal-ui", "src", "main.tsx"), "export const x = 1;\n");
  writeFileSync(join(root, "portal-ui", "dist", "index.html"), "<!doctype html><title>portal</title>\n");
  if (withGate || workflowBody) {
    // The gate is recognised by its own refusal text, so the fixture carries that text and nothing else —
    // and `workflowBody` lets an arm put a workflow of the same NAME there that is not the gate.
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflowBody
      ?? 'jobs:\n  x:\n    steps:\n      - run: echo "portal-ui/dist does not match a fresh build."\n');
  }
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "suite@example.invalid");
  git("config", "user.name", "suite");
  // Only src is committed. dist untracked is what the cut produces, and it is the premise of the defect.
  git("add", "--", commitDist ? "portal-ui" : "portal-ui/src");
  git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "sources");
  const older = new Date(1_600_000_000_000), newer = new Date(1_700_000_000_000);
  const [distTime, srcTime] = distOlder ? [older, newer] : [newer, older];
  utimesSync(join(root, "portal-ui", "dist", "index.html"), distTime, distTime);
  utimesSync(join(root, "portal-ui", "src", "main.tsx"), srcTime, srcTime);
  return root;
}

test("2206 doctor names the stale bundle and the rebuild, at rc 1, on a tree shaped like a public clone", () => {
  const root = publicSourceClone({ distOlder: true });
  const r = doctor(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /is OLDER than the sources it was built from/, r.out);
  assert.match(r.out, /npm run build:ui/, r.out);
  assert.match(r.out, /serves the previous screen and reports itself healthy/,
    "the reason an operator has not noticed is the half they most need told");
});

test("2206 the same tree with the bundle built AFTER the sources passes, at rc 0", () => {
  // The other side of the discriminator. Without this the arm above would pass on a check that simply
  // always fires.
  const root = publicSourceClone({ distOlder: false });
  const r = doctor(root);
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.out.includes("is OLDER than the sources"), r.out);
});

test("2206 a tree whose bundle is COMMITTED is judged by that guarantee, not by its checkout timestamps", () => {
  // A committed-and-gated tree's shape, BUILT rather than borrowed. An earlier draft drove the real
  // checkout and asserted its bundle was present — which is the defect class measured across the
  // exported tree on 2026-09-05: an arm that reaches for the tree's own `portal-ui/dist` passes only
  // where `build:ui` has been run, and the public CI's offline-suites job runs test:full WITHOUT it.
  // Building the shape costs four lines and the arm then means the same thing on every tree.
  //
  // The timestamps are planted STALE. If the tracked branch were ever reached by the mtime comparison
  // this would go red — which is the point: git stamps whatever a checkout writes with the time it
  // wrote it, so on a committed bundle that comparison is noise over a stronger guarantee.
  const root = publicSourceClone({ distOlder: true, commitDist: true, withGate: true });
  const r = doctor(root);
  assert.match(r.out, /portal-ui\/dist is present and tracked here/, r.out);
  assert.ok(!r.out.includes("is OLDER than the sources"),
    "a committed bundle that CI rebuilds and compares byte for byte cannot be stale, whatever its mtime says");
  assert.equal(r.code, 0, r.out);
});

test("2206 no arm here reaches for a bundle this tree may not have built", () => {
  // THE CLASS, PINNED. `portal-ui/dist` is untracked here and the offline-suites job does not build it,
  // so any arm in this file that read the real tree's bundle would pass on a machine where somebody had
  // run a build and refuse on every other. Every fixture above builds its own.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  // The needle is COMPOSED, never written whole. Spelled literally, this line is itself the thing it
  // forbids and the arm refuses on its own text — a red that teaches nothing.
  const needle = ["REPO", `"portal${"-"}ui"`].join(", ");
  const reaches = [...self.matchAll(new RegExp(`^.*${needle}.*$`, "gm"))].map((m) => m[0].trim());
  assert.deepEqual(reaches, [],
    `an arm reads the real tree's bundle: ${reaches.join(" | ")} — build the shape into a fixture instead`);
});
