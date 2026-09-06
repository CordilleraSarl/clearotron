// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 198 — a test that writes into the checkout is read by every other test in the run.
//
// The finding: `health-tells-the-truth-about-the-bundle` planted a future mtime on a REAL file in
// `portal-ui/src`, restored it, and went green. `node --test` runs test FILES concurrently against one
// shared working tree, so for the seconds that plant was live any other arm reading that path saw a
// tree from the future. The red that produces is unattributable — it lands in a file whose diff is
// empty, on another branch, in another agent's session, and it is intermittent.
//
// ── HOW THE WIRING ARMS DRIVE A RUNNER THAT SPAWNS AT IMPORT ────────────────────────────────────────
//
// `test-run.mjs` starts a child at import, so there is no way to `import` it and inspect anything. The
// subject here is therefore a COPIED tree: `scripts/` alone, in a temp directory, with a child that
// writes into it. `snapshotRepo` resolves the root from the MODULE's own path, so moving the module is
// the only lever that changes which tree is watched — the same technique, and the same reason, as
// `product-identity.test.mjs`'s bare-tree arms.
//
// It also means these arms can prove the guard REDS without any test in this repository writing into
// this repository, which would be the one thing the guard exists to forbid.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync, chmodSync, utimesSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { snapshotRepo, repoWrites, ALLOWED_TO_MOVE, NEVER_WALK } from "../../scripts/repo-writes.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

/** A throwaway tree with a copy of `scripts/` in it, so the runner watches THAT tree and not ours. */
function fakeCheckout() {
  const root = mkdtempSync(join(tmpdir(), "ct198-repo-"));
  mkdirSync(join(root, "scripts"));
  for (const f of ["test-run.mjs", "repo-writes.mjs"]) cpSync(join(ROOT, "scripts", f), join(root, "scripts", f));
  return root;
}

/**
 * Run the copied runner over a one-liner, and hand back what a reader would see.
 *
 * PORTAL_AUDIT IS CLEARED FIRST, because these arms run UNDER a real `test-run.mjs` which has already
 * set it — and the runner's ladder honours a value it is handed. Inheriting it measured the OUTER
 * run's environment while reading as a green arm about the inner one.
 *
 * TMPDIR IS DELIBERATELY LEFT ALONE, and clearing it is the obvious wrong repair: the outer runner
 * contains CLEAROTRON_QUEUE_DIR inside its own root, and the inner runner's containment check reads
 * that root out of TMPDIR. Without it the inner run refuses to start at all — "the suite is pointed at
 * a data plane outside any temp root" — which is the containment guard working, not a fixture problem.
 */
function drive(root, script, arg = root, extra = {}) {
  const env = { ...process.env, ...extra };
  if (!("PORTAL_AUDIT" in extra)) delete env.PORTAL_AUDIT;
  const r = spawnSync(process.execPath, [join(root, "scripts", "test-run.mjs"), process.execPath, "-e", script, arg],
    { encoding: "utf8", timeout: 120_000, env });
  return { code: r.status, said: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── THE WIRING: the runner itself, driven end to end ────────────────────────────────────────────────

test("198 a run that creates a file inside the checkout FAILS, and the file is named", () => {
  const root = fakeCheckout();
  try {
    const r = drive(root, `require("fs").writeFileSync(process.argv[1] + "/scratch.json", "{}")`);
    assert.equal(r.code, 1, `a run that wrote into the checkout exited ${r.code}; it must fail`);
    assert.match(r.said, /THIS RUN WROTE INSIDE THE CHECKOUT/);
    assert.match(r.said, /\+ scratch\.json/, "the reader is told WHICH path, or the message is unactionable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a run that changes a file already in the checkout FAILS, and the file is named", () => {
  const root = fakeCheckout();
  try {
    writeFileSync(join(root, "kept.txt"), "before");
    const r = drive(root, `require("fs").writeFileSync(process.argv[1] + "/kept.txt", "after")`);
    assert.equal(r.code, 1);
    assert.match(r.said, /~ kept\.txt/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a run that REMOVES a file from the checkout fails too — a deletion is a write", () => {
  const root = fakeCheckout();
  try {
    writeFileSync(join(root, "doomed.txt"), "here");
    const r = drive(root, `require("fs").rmSync(process.argv[1] + "/doomed.txt")`);
    assert.equal(r.code, 1);
    assert.match(r.said, /- doomed\.txt/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a run that touches nothing passes, and says nothing about writes", () => {
  const root = fakeCheckout();
  try {
    const r = drive(root, `void 0`);
    assert.equal(r.code, 0, `a clean run must still pass — this guard may not red an innocent run:\n${r.said}`);
    assert.doesNotMatch(r.said, /WROTE INSIDE THE CHECKOUT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a run that ALREADY FAILED keeps its own exit code, even though it also wrote", () => {
  // THE DIRECTION THAT MATTERS. This guard may turn a green run red; it must never turn a red run
  // green, because what the tests found matters more than what they wrote while finding it. An
  // implementation that returned 1 for "wrote" would silently rewrite every other failure's code.
  const root = fakeCheckout();
  try {
    const r = drive(root, `require("fs").writeFileSync(process.argv[1] + "/scratch.json", "{}"); process.exit(3)`);
    assert.equal(r.code, 3, "the suite's own exit code was replaced by the guard's");
    assert.match(r.said, /\+ scratch\.json/, "and the write is still reported");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 the run's own temp root is not mistaken for a write — TMPDIR is where tests are told to go", () => {
  const root = fakeCheckout();
  try {
    // mkdtemp under TMPDIR is the sanctioned move, and the guard must be silent about it or the advice
    // it prints ("write to a temp dir") would be advice to fail.
    const r = drive(root, `require("fs").mkdtempSync(require("os").tmpdir() + "/fixture-")`);
    assert.equal(r.code, 0, `writing to TMPDIR was reported as a checkout write:\n${r.said}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 the portal's audit log lands in the run's temp root, not in the checkout", () => {
  // The repair that came with the guard, EXERCISED rather than read: `portal-service.mjs` defaults
  // PORTAL_AUDIT to `join(HERE, "..", "portal-audit.log")` — the checkout root — and one full suite run
  // appended a row there. The runner now names a path inside the run root instead.
  const root = fakeCheckout();
  try {
    const r = drive(root, `console.log(JSON.stringify({ audit: process.env.PORTAL_AUDIT, tmp: process.env.TMPDIR }))`);
    assert.equal(r.code, 0, r.said);
    const seen = JSON.parse(r.said.split("\n").find((l) => l.startsWith("{")));
    assert.ok(seen.audit, "PORTAL_AUDIT was not set, so the portal would fall back to the checkout root");
    assert.ok(seen.audit.startsWith(seen.tmp), `PORTAL_AUDIT (${seen.audit}) is not inside the run root (${seen.tmp})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a caller that names its own PORTAL_AUDIT keeps it", () => {
  // Same ladder as TRADEMARK_MCP_AUDIT_LOG beside it: the runner fills what is UNSET, and never
  // overrides a value a test set deliberately in order to assert on the file afterwards.
  const root = fakeCheckout();
  const mine = join(mkdtempSync(join(tmpdir(), "ct198-audit-")), "mine.log");
  try {
    const r = spawnSync(process.execPath,
      [join(root, "scripts", "test-run.mjs"), process.execPath, "-e", `console.log(process.env.PORTAL_AUDIT)`],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, PORTAL_AUDIT: mine } });
    assert.match(`${r.stdout}`, new RegExp(mine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── THE READERS, driven directly ────────────────────────────────────────────────────────────────────

test("198 repoWrites separates created, changed and removed, and is silent on an untouched tree", () => {
  const root = mkdtempSync(join(tmpdir(), "ct198-pure-"));
  try {
    writeFileSync(join(root, "kept.txt"), "same");
    writeFileSync(join(root, "edited.txt"), "before");
    writeFileSync(join(root, "doomed.txt"), "here");
    const before = snapshotRepo(root);
    assert.deepEqual(repoWrites(before, snapshotRepo(root), root), [],
      "an untouched tree reported writes, so every arm below would be vacuous");

    writeFileSync(join(root, "edited.txt"), "after-and-longer");
    writeFileSync(join(root, "new.txt"), "new");
    rmSync(join(root, "doomed.txt"));
    const rows = repoWrites(before, snapshotRepo(root), root).join("\n");
    assert.match(rows, /\+ new\.txt/);
    assert.match(rows, /~ edited\.txt/);
    assert.match(rows, /- doomed\.txt/);
    assert.doesNotMatch(rows, /kept\.txt/, "a file nobody touched was reported");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a rewrite that keeps the mtime is still caught, because the size is in the stamp", () => {
  // A same-millisecond rewrite is not hypothetical on a fast filesystem, and a plant that restores the
  // mtime afterwards — which is precisely what 198's planter did — would otherwise be invisible.
  const root = mkdtempSync(join(tmpdir(), "ct198-mtime-"));
  try {
    // AN INTEGER NUMBER OF SECONDS, because `utimesSync` does not round-trip a stat's sub-millisecond
    // mtime — restoring `statSync().mtime` lands ~0.1ms away, and the arm would then pass on the very
    // mtime difference it was written to rule out. Pinned, the only thing left that differs is size.
    const stamp = 1_700_000_000;
    const f = join(root, "victim.txt");
    writeFileSync(f, "short");
    utimesSync(f, stamp, stamp);
    const before = snapshotRepo(root);
    writeFileSync(f, "very much longer than before");
    utimesSync(f, stamp, stamp);                    // the restore that hides the plant
    assert.equal(statSync(f).mtimeMs, stamp * 1000, "the mtime restore did not take, so this proves nothing");
    assert.match(repoWrites(before, snapshotRepo(root), root).join("\n"), /~ victim\.txt/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a directory created by a run is named, even with nothing in it", () => {
  const root = mkdtempSync(join(tmpdir(), "ct198-dir-"));
  try {
    const before = snapshotRepo(root);
    mkdirSync(join(root, "scratch"));
    assert.match(repoWrites(before, snapshotRepo(root), root).join("\n"), /\+ scratch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 node_modules and .git are not walked, and nothing else is skipped by name", () => {
  const root = mkdtempSync(join(tmpdir(), "ct198-skip-"));
  try {
    for (const d of ["node_modules", ".git", "driver"]) mkdirSync(join(root, d), { recursive: true });
    for (const d of ["node_modules", ".git", "driver"]) writeFileSync(join(root, d, "f.txt"), "x");
    const seen = [...snapshotRepo(root).keys()].join("\n");
    assert.doesNotMatch(seen, /node_modules/, "an npm install would red every run");
    assert.doesNotMatch(seen, /\.git/, "a read-only git command touches the index");
    assert.match(seen, /driver\/f\.txt/, "the source tree itself must be walked");
    assert.deepEqual([...NEVER_WALK].sort(), [".git", "node_modules"],
      "the skip list grew — a new entry is a blind spot, and needs a measurement saying why");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 a symlink is recorded by its OWN identity, never by what it points at", () => {
  // Following a link can leave the checkout entirely — the farm `test-run.mjs` builds is made of them,
  // and a `stat` here would have walked into whatever a fixture happened to point at.
  const root = mkdtempSync(join(tmpdir(), "ct198-link-"));
  const outside = mkdtempSync(join(tmpdir(), "ct198-outside-"));
  try {
    writeFileSync(join(outside, "target.txt"), "one");
    symlinkSync(join(outside, "target.txt"), join(root, "link.txt"));
    const before = snapshotRepo(root);
    writeFileSync(join(outside, "target.txt"), "two — changed, but OUTSIDE the checkout");
    assert.deepEqual(repoWrites(before, snapshotRepo(root), root), [],
      "the link's stamp moved when its target did, so the walk is following links out of the tree");

    rmSync(join(root, "link.txt"));
    symlinkSync(join(outside, "other.txt"), join(root, "link.txt"));
    assert.match(repoWrites(before, snapshotRepo(root), root).join("\n"), /~ link\.txt/,
      "a link REPOINTED inside the checkout is a write, and was not reported");
  } finally { for (const d of [root, outside]) rmSync(d, { recursive: true, force: true }); }
});

test("198 a directory that cannot be read is recorded, never quietly skipped", () => {
  // An absence is a finding. A run that removed read permission from a directory must not look
  // identical to a run that did nothing.
  const root = mkdtempSync(join(tmpdir(), "ct198-perm-"));
  try {
    const shut = join(root, "shut");
    mkdirSync(shut);
    writeFileSync(join(shut, "inside.txt"), "x");
    const before = snapshotRepo(root);
    chmodSync(shut, 0o000);
    try {
      const rows = repoWrites(before, snapshotRepo(root), root).join("\n");
      assert.match(rows, /shut/, "closing a directory read as no change at all");
    } finally { chmodSync(shut, 0o755); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("198 the build-output allow-list is empty, and an entry needs a measurement", () => {
  // A RATCHET, not a formality. The list was expected to carry build outputs; a full green suite moved
  // exactly two paths and both were defects, so it carries nothing. The cheap repair for the next
  // offender is to add its path here, which would retire the guard one line at a time.
  assert.deepEqual([...ALLOWED_TO_MOVE], [],
    "something was exempted from the no-writes rule — the fix is to point that code at a temp "
    + "directory, and an exemption needs a measurement on the issue saying why it cannot be");
});
