// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// health-names-its-age-and-its-instance.test.mjs —: ok:true said nothing about how old, or which box.
//
// The filed shape: `/portal/health` on production answered `ok:true` beside a sha 101 commits behind
// `origin/main`, and nothing in the payload identified the instance. Being behind main is CORRECT on
// production — it ships when the owner asks — so the defect was never staleness. It was that an
// intentionally pinned release and a deploy that had silently stopped produced byte-identical payloads,
// and that the port `skills/deploy` documents could not be told apart from any other instance's.
//
// The arms below are ordered by what they defend. The third is the one worth reading: it is the reason
// this ships a DATE rather than the distance-from-main the issue suggested, and without it that
// reasoning lives only in a commit message nobody re-reads.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "health-age-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "health-age-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { execFileSync } from "node:child_process";

// `await import`, not a static one. `engineCommitDate` is added by the change under test, and a static
// import of a name the module does not export yet fails at LINK time — the file would report as one
// dead module instead of per-arm verdicts, which is the difference between "this fix is load-bearing"
// and "something is broken". Destructuring a dynamic import yields undefined for a missing name.
const { makeHttpHandler, makePortalService } = await import("../portal-service.mjs");
const { engineCommitDate, classifyEngineCheckout } = await import("../engine-build.mjs");

async function withPortal(fn) {
  const service = makePortalService({
    poolRoot: mkdtempSync(join(tmpdir(), "health-age-pool-")),
    workspaceRoot: mkdtempSync(join(tmpdir(), "health-age-ws-")),
    secret: "health-age-secret", staffDomains: [], grants: {},
  });
  const srv = createServer(makeHttpHandler({
    verify: null, limiter: null, service, devIdentity: { email: "dev@local" }, log: () => {},
  }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try { await fn(srv.address().port); }
  finally { await new Promise((r) => srv.close(r)); }
}

const health = (port) => new Promise((resolve, reject) => {
  const r = httpRequest({ host: "127.0.0.1", port, path: "/portal/health", method: "GET" }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => resolve(JSON.parse(data)));
  });
  r.on("error", reject);
  r.end();
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** A repo with `n` commits, committer identity forced so this passes on a box with no global config. */
function repoWith(dir, n) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "t");
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `f${i}.txt`), String(i));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", `c${i}`);
  }
  return dir;
}

test("#1475 the payload says HOW OLD the deployment is, not just which sha", async () => {
  await withPortal(async (port) => {
    const body = await health(port);
    assert.ok("engineCommitAt" in body,
      "null is a legal answer off a git checkout; ABSENT is not — a missing key reads as no answer, "
      + "which is the shape this issue was filed about");
    if (body.engineCommitAt !== null) {
      const t = Date.parse(body.engineCommitAt);
      assert.ok(Number.isFinite(t), `engineCommitAt did not parse: ${JSON.stringify(body.engineCommitAt)}`);
      // Not the epoch and not the future: a placeholder date is worse than null, because it renders.
      assert.ok(t > Date.parse("2020-01-01T00:00:00Z"), "a zero/epoch date reads as a real timestamp");
      assert.ok(t < Date.now() + 86_400_000, "a commit dated in the future is a clock or a placeholder");
    }
  });
});

test("#1475 the payload names WHICH BOX — and an unrecognised one is null, never a guess", async () => {
  const saved = process.env.CLEAROTRON_BOX;
  try {
    delete process.env.CLEAROTRON_BOX;
    await withPortal(async (port) => {
      const body = await health(port);
      assert.ok("box" in body, "the key a reader checks must exist even when nothing is configured");
      assert.equal(body.box, null, "unset must read as an absence, not as a default");
    });
    // Read at REQUEST time, not captured at import: the same process must report the new value.
    process.env.CLEAROTRON_BOX = "test";
    await withPortal(async (port) => {
      assert.equal((await health(port)).box, "test",
        "a module-scope capture would still say null here — this is the #1524 shape, one file over");
    });
    // THE ARM THAT MATTERS. A box that names itself something unrecognised is UNKNOWN, not that value:
    // the whole point of self-declaration is that a wrong answer is worse than no answer, and a reader
    // acting on `box: "prod-old"` would trust an instance nothing in the tree knows about.
    process.env.CLEAROTRON_BOX = "prod-old";
    await withPortal(async (port) => {
      assert.equal((await health(port)).box, null,
        "an unrecognised box must read as unknown — reporting it verbatim invents an instance");
    });
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_BOX; else process.env.CLEAROTRON_BOX = saved;
  }
});

test("#1475 health and the surface check read ONE box rule, so they cannot drift apart", () => {
  // The join, asserted at the source rather than by two runtime values that agree today. This is
  // 's guard shape and it is here for the same reason: the previous state of the tree had the
  // allowlist written out inline in live-surface-check, and a second copy in the endpoint would have
  // been correct on the day it was written.
  const surface = readFileSync(join(ROOT, "scripts/live-surface-check.mjs"), "utf8");
  const portal = readFileSync(join(ROOT, "driver/portal-service.mjs"), "utf8");
  for (const [what, src] of [["the surface check", surface], ["the portal", portal]]) {
    assert.match(src, /import \{[^}]*\bdeploymentBox\b[^}]*\} from ['"][^'"]*deployment-box\.mjs['"]/,
      `${what} no longer imports the shared box rule — an inline allowlist is a second derivation, and `
      + `two of them disagree the first time the set of boxes changes`);
    assert.doesNotMatch(src, /\["prod", "test"\]\.includes\(process\.env\.CLEAROTRON_BOX/,
      `${what} re-inlined the allowlist beside the import`);
  }
});

test("#1475 THE MEASUREMENT (premise pin) — a distance from a LOCAL ref reads zero on the stalest instance", () => {
  // PREMISE PIN: green against the pre-fix sources too, deliberately. It asserts the git behaviour that
  // makes the issue's suggested field wrong, not this change's code — so it is worth keeping and worth
  // naming, because an unlabelled always-green arm in a fix's test file reads as coverage it is not.
  //
  // Why this ships a date and not the distance-from-main the issue suggested. A health probe must not
  // touch the network, so the only `origin/main` it can read is the one the last `pull --ff-only`
  // wrote — which equals HEAD by construction. Measured on production 2026-08-22: the checkout's own
  // refs gave `HEAD..origin/main = 0` while the true distance was 101.
  //
  // So `behind_main: 0` beside `ok:true` on a stale release is strictly WORSE than the bare sha: the
  // sha is merely uninformative, and the zero actively asserts currency. This arm reproduces that with
  // real git so the finding cannot be re-derived away by someone reinstating the suggestion.
  const root = mkdtempSync(join(tmpdir(), "health-age-git-"));
  const remote = repoWith(join(root, "remote"), 2);
  const deployed = join(root, "deployed");
  execFileSync("git", ["clone", "-q", remote, deployed]);

  // The remote moves on — three releases the deployment never pulled.
  writeFileSync(join(remote, "later.txt"), "x");
  git(remote, "add", "-A"); git(remote, "commit", "-q", "-m", "later 1");
  writeFileSync(join(remote, "later2.txt"), "x");
  git(remote, "add", "-A"); git(remote, "commit", "-q", "-m", "later 2");
  writeFileSync(join(remote, "later3.txt"), "x");
  git(remote, "add", "-A"); git(remote, "commit", "-q", "-m", "later 3");

  const localAnswer = Number(git(deployed, "rev-list", "--count", "HEAD..origin/main"));
  assert.equal(localAnswer, 0,
    "a distance computed from the deployment's own refs reads 0 — this is the number a network-free "
    + "health probe would have printed beside ok:true");

  // And the truth, which only a fetch can see. The gap between these two is the whole argument.
  git(deployed, "fetch", "-q", "origin", "main");
  assert.equal(Number(git(deployed, "rev-list", "--count", "HEAD..origin/main")), 3,
    "the deployment really was three commits behind while its own refs said zero");

  // The date, by contrast, needs no remote at all and cannot be made to lie by a stale ref.
  assert.ok(Date.parse(git(deployed, "log", "-1", "--format=%cI")) > 0,
    "the commit's own date is local, network-free, and makes no claim about what HEAD should be");
});

test("#1475 a PINNED release and an unreachable probe must not look alike (premise pin)", () => {
  // PREMISE PIN, like the arm above: `classifyEngineCheckout` predates this change, so this is green on
  // both sides. It pins the fact the payload's `engineState` field rests on — remove that field and
  // this arm still passes, which is exactly why it is labelled rather than counted as coverage.
  //
  // engineBranch alone collapses them: a detached checkout reports null because it is deliberately
  // pinned, and a directory git cannot read reports null because nothing was measured. Same field,
  // same value, opposite meanings — carry the value without its discriminator and the payload invents
  // agreement between two states a reader needs to tell apart.
  const root = mkdtempSync(join(tmpdir(), "health-age-pin-"));
  const pinned = repoWith(join(root, "pinned"), 2);
  git(pinned, "checkout", "-q", "--detach", "HEAD~1");
  const pin = classifyEngineCheckout(pinned);

  const notARepo = join(root, "not-a-repo");
  mkdirSync(notARepo, { recursive: true });
  const blocked = classifyEngineCheckout(notARepo);

  assert.equal(pin.engineBranch, null, "a pinned release runs detached and has no branch to report");
  assert.equal(blocked.engineBranch, null, "and neither does a checkout git could not read");
  assert.notEqual(pin.outcome, blocked.outcome,
    "so `outcome` is the field that separates them — a pinned release is a healthy state and an "
    + "unreadable checkout is a finding, and the payload must not report them identically");
  assert.equal(blocked.outcome, "blocked", "could-not-determine is its own answer, never `clean`");
});

test("#1475 the new fields are ADDITIVE — the existing payload a monitor reads is untouched", async () => {
  // The control. Without it, a red arm above cannot be told apart from a handler that stopped
  // answering at all, and every assertion in this file would be measuring the same single failure.
  await withPortal(async (port) => {
    const body = await health(port);
    assert.equal(body.ok, true);
    assert.ok(["built", "missing", "unwired"].includes(body.ui), `ui was ${JSON.stringify(body.ui)}`);
    assert.ok("engineCommit" in body, "#1136's field must survive #1475 adding siblings beside it");
    assert.ok(body.store && typeof body.store === "object", "and so must the doctrine store answer");
  });
});

test("#1475 engineCommitDate answers a string or null — never throws, never a bare Date", () => {
  // A provenance stamp never breaks a health probe: the endpoint answers before identity and is what a
  // deploy confirmation reads, so a git failure here has to degrade to null rather than to a 500.
  const v = engineCommitDate();
  assert.ok(v === null || typeof v === "string",
    `engineCommitDate must serialise as an ISO string or null, got ${typeof v}`);
  assert.equal(v, engineCommitDate(), "and it is cached to one value, like the sha beside it");
});
