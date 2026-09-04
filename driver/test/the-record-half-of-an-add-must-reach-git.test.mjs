// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// An add that writes a bundle must be able to RECORD it, and must not claim it did when it could not.
//
// Two commands shipped passing the resolver's RESULT OBJECT where its `.root` path belongs. The object
// reached git as the literal `[object Object]`, so the record half of every add died on every store,
// and the message blamed the store — "fix the store's git state" — for a caller's bug no operator could
// reach. The command then exited 0.
//
// WHY THE REFUSAL IS AT THE BOUNDARY AND NOT AT THE TWO CALL SITES. Repairing both callers fixes the two
// that were wrong and leaves the trap loaded for the next one: the resolver returns `{ root, from, tried }`
// because two callers genuinely need `from` and `tried`, and that shape is exactly what makes the mistake
// easy to make and invisible to make. So the helpers refuse a non-path themselves, before any git process
// starts, and name the fix. The call-site arm below is still here because a boundary refusal proves the
// helpers cannot be fooled, not that today's callers ask for the right field.
//
// WHY THE ARMS DRIVE THE COMMAND AS A SUBPROCESS. The exit code IS the contract under test — an in-process
// call cannot observe it, and the defect this file exists for is precisely a process that exited 0 over a
// dead commit.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { makeStoreCommit, makeCommittableAudit, resolveStoreRepoRoot } from "../../shared/store-in-repo.mjs";
import { grepTrackedFiles } from "../../shared/tracked-files.mjs";
import * as profilesMod from "../profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SEED = join(ROOT, "driver", "profiles", "generic.json");

/** A store the product can actually commit into, so a pass is a success rather than an absent failure. */
function gitStore() {
  const root = mkdtempSync(join(tmpdir(), "add-record-ok-"));
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  copyFileSync(SEED, join(root, "generic.json"));
  git("add", "generic.json");
  git("commit", "-q", "-m", "seed");
  return root;
}

/** A store that is a directory and nothing more — the record half must fail LOUDLY against it. */
function plainStore() {
  const root = mkdtempSync(join(tmpdir(), "add-record-nogit-"));
  copyFileSync(SEED, join(root, "generic.json"));
  return root;
}

const requireProfiles = () => profilesMod;

const runAdd = (bin, args, store) => spawnSync(process.execPath, [join(ROOT, "bin", bin), ...args], {
  encoding: "utf8", env: { ...process.env, CLEAROTRON_CUSTOMERS_DIR: store },
});

// ── the boundary: neither helper may start a git process over a non-path ──────────────────────────

test("makeStoreCommit refuses the resolver's result object, and names the field to pass instead", () => {
  const resolved = resolveStoreRepoRoot({ names: ["NOTHING_SETS_THIS"], fallback: "/tmp" });
  assert.equal(typeof resolved, "object", "the resolver's shape changed — this arm is about that shape");

  assert.throws(() => makeStoreCommit({ repoRoot: resolved, what: "customers" }),
    (e) => {
      // THE POINT IS THE MESSAGE, not merely that something threw. A throw with git's own complaint in
      // it would be the defect: the operator is sent to fix a store that was never wrong.
      assert.match(e.message, /repoRoot must be a non-empty path string/);
      assert.match(e.message, /pass its \.root, not the result object/, "the refusal must name the fix");
      assert.doesNotMatch(e.message, /\[object Object\]/, "the object must never reach a git invocation");
      assert.doesNotMatch(e.message, /not a usable git repository/, "the store must not be blamed for this");
      return true;
    });
});

test("makeCommittableAudit refuses it too — the other half of the same wiring", () => {
  const resolved = resolveStoreRepoRoot({ names: ["NOTHING_SETS_THIS"], fallback: "/tmp" });
  assert.throws(() => makeCommittableAudit({ auditPath: "/tmp/x/audit.jsonl", repoRoot: resolved }),
    /repoRoot must be a non-empty path string/);
});

test("null is refused by name rather than dying later as an argument-type error", () => {
  // `resolveStoreRepoRoot` returns { root: null } when nothing answered and no fallback was given.
  // Handing that on reaches execFileSync as a null argument, which throws about argument types and
  // names neither the store nor the caller. Both shapes are refused here, with the same sentence.
  const empty = resolveStoreRepoRoot({ names: ["NOTHING_SETS_THIS"] });
  assert.equal(empty.root, null, "the resolver stopped returning a null root — re-read this arm");
  for (const bad of [empty.root, undefined, "", "   "]) {
    assert.throws(() => makeStoreCommit({ repoRoot: bad }), /repoRoot must be a non-empty path string/,
      `a repoRoot of ${JSON.stringify(bad)} started a git process`);
  }
});

// ── the callers: every one asks for the field, not the object ─────────────────────────────────────

test("every caller of the resolver reads .root — derived from the tree, not from a list in this file", () => {
  const callers = grepTrackedFiles("resolver-callers", {
    root: ROOT, args: ["-l", "resolveStoreRepoRoot(", "--", "*.mjs", "*.js"],
  });
  assert.ok(callers, "no tracked corpus — this is a SKIP dressed as a pass; run it in a git checkout");

  const shipping = callers.filter((f) => !f.includes("/test/") && !f.endsWith("shared/store-in-repo.mjs"));
  assert.ok(shipping.length >= 4,
    `only ${shipping.length} shipping caller(s) found — the grep stopped seeing the call, which would make `
    + "every assertion below vacuous");

  for (const f of shipping) {
    const src = readFileSync(join(ROOT, f), "utf8");
    // Either form is correct: `.root` on the call, or the result bound and `.root` read off the binding.
    // What is NOT correct is the object travelling onward, which is what this asserts against.
    const onTheCall = /resolveStoreRepoRoot\([\s\S]*?\}\)\.root/.test(src);
    const viaBinding = /const\s+(\w+)\s*=\s*resolveStoreRepoRoot\([\s\S]*?\}\);/.exec(src);
    const bindingRead = viaBinding ? new RegExp(`\\b${viaBinding[1]}\\.root\\b`).test(src) : false;
    assert.ok(onTheCall || bindingRead,
      `${f} takes the resolver's RESULT OBJECT and never reads .root off it — that object reaches git as `
      + "the literal [object Object]");
  }
});

// ── driven at the door: the command itself, against both kinds of store ───────────────────────────

test("brandowner add records what it wrote, against a real git store", () => {
  const store = gitStore();
  const r = runAdd("brandowner.mjs", ["add", "acme", "--name", "Acme Ltd"], store);

  assert.equal(r.status, 0, `add failed: ${r.stderr}`);
  assert.match(r.stdout, /recorded [0-9a-f]{40}/, "the command must say which commit carries the write");
  assert.doesNotMatch(r.stdout + r.stderr, /\[object Object\]/);

  // THE COMMIT ITSELF, not the sentence about it. The claim is that the bundle and its audit row rode in
  // together; reading the command's own output back would only prove it printed something.
  const show = execFileSync("git", ["-C", store, "show", "--stat", "--format=", "HEAD"], { encoding: "utf8" });
  assert.match(show, /acme\.json/, "the profile is not in the commit");
  assert.match(show, /audit\.jsonl/, "the audit row did not ride with it");
});

test("project add records what it wrote too — the mirror command, driven separately", () => {
  const store = gitStore();
  const r = runAdd("project.mjs", ["add", "generic", "alpha", "--name", "Alpha"], store);

  assert.equal(r.status, 0, `add failed: ${r.stderr}`);
  assert.match(r.stdout, /recorded [0-9a-f]{40}/);
  assert.doesNotMatch(r.stdout + r.stderr, /\[object Object\]/);
});

test("wrote-but-did-not-record exits non-zero, and the write still stands", () => {
  const store = plainStore();
  const r = runAdd("brandowner.mjs", ["add", "acme", "--name", "Acme Ltd"], store);

  // THE DEFECT IN ONE ASSERTION. A scripted onboarding reads the exit code; it read 0 over a dead commit.
  assert.notEqual(r.status, 0, "a write that was never recorded reported success");
  assert.equal(r.status, 3, "not 1, which is a refusal that wrote nothing, and not 2, which is usage");
  assert.match(r.stdout, /WROTE THE BUNDLE BUT DID NOT RECORD IT/, "the loud line must still be said");

  // AND THE STORE IS NAMED HONESTLY. This is the half that sent operators to fix a healthy store.
  assert.doesNotMatch(r.stdout + r.stderr, /\[object Object\]/);
  assert.match(r.stdout, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the message must name the real store path");

  // The bundle is NOT rolled back: losing an operator's work over a git fault they can fix is the worse
  // failure, and the exit code is what makes leaving it honest.
  const written = JSON.parse(readFileSync(join(store, "acme.json"), "utf8"));
  assert.equal(written.name, "Acme Ltd", "the write was rolled back — the exit code was the fix, not deletion");
});

// ── and the bundle it records must be one the store can read back ─────────────────────────────────
//
// Recording a bundle the loader then rejects is not an onboarding. Two independent invalidities shipped
// in the document this command wrote: a `key` field the loader injects itself from the FILENAME and
// hard-rejects in the file, and a missing `platforms`, which the loader requires on every profile and
// the command had no way to supply. Either one made the first successful onboarding unloadable — so the
// next command to read profiles threw, and on a fresh install that is the next thing anyone runs.

test("every field the writer emits is one the loader knows — checked against its own vocabulary", async () => {
  const { KNOWN_PROFILE_KEYS, validateProfileEdit } = await import("../profiles.mjs");
  const { buildProfile, resolveFramework } = await import("../../bin/brandowner.mjs");

  const profile = buildProfile({
    key: "acme", name: "Acme Ltd", domains: ["acme.test"],
    platforms: ["amazon.com"], framework: resolveFramework(undefined), industry: "widgets",
  });

  // THE REGRESSION, NAMED. `readProfilesLayer` composes `{ key, ...p }` from the filename, so a `key` in
  // the document is redundant going in and fatal coming out.
  assert.ok(!("key" in profile), "the written document carries a `key` the loader injects and rejects");

  // AND THE CLASS, not just that field: a future field added to the writer and not to the loader's
  // vocabulary cannot pass this, because the assertion is over what the writer PRODUCES.
  for (const k of Object.keys(profile))
    assert.ok(KNOWN_PROFILE_KEYS.includes(k),
      `the writer emits "${k}", which is not in KNOWN_PROFILE_KEYS — the loader hard-fails the whole `
      + "roster on an unknown key, so this bundle would make the store unreadable");

  const v = validateProfileEdit("acme", profile);
  assert.ok(v.ok, `the loader refuses what the writer produced: ${v.errors.join("; ")}`);
});

test("onboarding a brand owner then a project leaves a store that still loads", () => {
  const store = gitStore();
  const { loadProfiles } = requireProfiles();

  const owner = runAdd("brandowner.mjs", ["add", "acme", "--name", "Acme Ltd"], store);
  assert.equal(owner.status, 0, `brandowner add failed: ${owner.stderr}`);

  // THE STEP THAT USED TO THROW. project add reads the roster, so it is the first thing to meet the
  // bundle brandowner just wrote — and it died on it.
  const project = runAdd("project.mjs", ["add", "acme", "alpha", "--name", "Alpha"], store);
  assert.equal(project.status, 0, `project add failed on the bundle brandowner just wrote: ${project.stderr}`);

  const roster = loadProfiles({ dir: store, force: true });
  assert.ok(roster.has("acme"), "the onboarded owner is not in the roster the store loads");
  assert.ok((roster.get("acme").platforms ?? []).length, "the onboarded owner carries no platforms");
});

test("an operator who supplies no platforms is TOLD which they got", () => {
  const store = gitStore();
  const r = runAdd("brandowner.mjs", ["add", "acme", "--name", "Acme Ltd"], store);
  assert.equal(r.status, 0, r.stderr);
  // Which marketplaces a client's clearance searches is not a thing to decide silently, and this is the
  // command's own idiom — the framework line one above it says exactly the same thing.
  assert.match(r.stdout, /platforms: .*GENERIC DEFAULT/,
    "the default was applied without saying so, which is how nobody notices what was chosen for them");
});

test("supplied platforms are recorded as supplied, and are what lands in the file", () => {
  const store = gitStore();
  const r = runAdd("brandowner.mjs",
    ["add", "acme", "--name", "Acme Ltd", "--platforms", "etsy.com,ebay.com"], store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /platforms: etsy\.com, ebay\.com — as supplied/);
  assert.doesNotMatch(r.stdout, /platforms: .*GENERIC DEFAULT/);

  const written = JSON.parse(readFileSync(join(store, "acme.json"), "utf8"));
  assert.deepEqual(written.platforms, ["etsy.com", "ebay.com"], "the file did not get what the operator said");
});
