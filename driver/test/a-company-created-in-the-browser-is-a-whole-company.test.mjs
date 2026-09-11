// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Creating a company from the browser: what it writes, and what it refuses before writing anything.
//
// THE DEFECT THIS EXISTS FOR. `save` is an upsert and looks like a create path. It is not one:
// `preserveCodeOwned` takes the on-disk value of every code-owned field and deletes the field when there
// is none, and a company being created has nothing on disk. So a create routed through save writes no
// `frameworkPath` — silently — and the company is rated under the house default from then on. That is
// live today through the staff pool page, and the first arm below is the one that would have caught it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProfileService, browserRefusal } from "../profile-service.mjs";
import { makeStoreCommit, makeCommittableAudit } from "../../shared/store-in-repo.mjs";
import { makeUpstream } from "../portal-upstream.mjs";
import { Refusal } from "../../shared/onboarding-store.mjs";
import { readFileSync } from "node:fs";
import { DEFAULT_FRAMEWORK } from "../framework.mjs";

const STAFF = { email: "staff@example-firm.com" };

function svc() {
  const dir = mkdtempSync(join(tmpdir(), "company-create-"));
  writeFileSync(join(dir, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com", "apps.apple.com", "play.google.com"] }));
  writeFileSync(join(dir, "acme.json"),
    JSON.stringify({ name: "Acme", matchDomains: ["acme.example"], platforms: ["amazon.com"] }));
  const writeCalls = [], commitCalls = [];
  const service = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; },
    gitCommit: (a) => { commitCalls.push(a); return "deadbeefsha"; },
    audit: () => {},
  });
  return { service, writeCalls, commitCalls };
}

test("a company created from the browser always carries a framework, and says which", async () => {
  const { service, writeCalls } = svc();
  const r = await service.route("POST", "/profiles", STAFF, { name: "Bellweather Foods" });
  assert.equal(r.status, 201);

  // THE ARM THAT MATTERS. Absent is the failure being prevented, so this asserts the VALUE is present
  // on the bundle that reached the writer — not that the response mentioned a framework.
  const written = writeCalls.at(-1).profile;
  assert.equal(written.frameworkPath, DEFAULT_FRAMEWORK,
    "a created company is rated under a framework that was chosen, never one that was left absent");

  // And the receipt can say which one and whether it was a default, without restating what was typed.
  assert.equal(r.json.framework.defaulted, true);
  assert.equal(r.json.marketplaces.defaulted, true);
  assert.equal(r.json.marketplaces.count, 3, "the house default list, read from generic — never hardcoded");
  assert.deepEqual(written.platforms, ["amazon.com", "apps.apple.com", "play.google.com"]);
});

test("the key comes from the name, and a name that yields none is refused rather than invented", async () => {
  const { service } = svc();
  const ok = await service.route("POST", "/profiles", STAFF, { name: "Zürich Präzision AG" });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.key, "zurich-prazision-ag", "accents are folded, not turned into separators");

  const none = await service.route("POST", "/profiles", STAFF, { name: "!!!" });
  assert.equal(none.status, 400);
  assert.equal(none.json.error, "needs_key", "a key nobody chose is worse than asking for one");
});

test("a domain another company already claims is refused BEFORE anything is written", async () => {
  const { service, writeCalls, commitCalls } = svc();
  const r = await service.route("POST", "/profiles", STAFF,
    { name: "Acme Rivals", matchDomains: ["acme.example"] });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /acme/, "the refusal names the company already holding it");

  // NOTHING WAS WRITTEN, and this is the half worth asserting: a colliding domain does not fail this
  // company, it stops the deployment resolving ANY company at the next start. A refusal that arrived
  // after the write would leave the store unloadable.
  assert.equal(writeCalls.length, 0, "no write");
  assert.equal(commitCalls.length, 0, "no commit");
});

test("an existing key is refused, and so is the house default's own key", async () => {
  const { service, writeCalls } = svc();
  const dup = await service.route("POST", "/profiles", STAFF, { name: "Acme", key: "acme" });
  assert.equal(dup.status, 400);
  // PINNED TO WHAT THE REFUSAL MUST CARRY, not to its words. This used to match the command line's own
  // sentence — and the command line's sentence is the wrong one to send a browser: it names the flag that
  // was missing and the directory that was written to, neither of which the person on the New company
  // page has ever seen. The wording is now each door's own, so the rule here is what the browser's
  // refusal has to DO: name the key, and carry the code that lets the screen offer a way to that company.
  assert.equal(dup.json.code, "key_exists", "the screen can act on the kind, not on the prose");
  assert.equal(dup.json.key, "acme", "and it knows WHICH company already holds it");
  assert.match(dup.json.message, /acme/, "the sentence names it too, for a reader who only sees the text");
  assert.doesNotMatch(dup.json.message, /--|\/(home|srv|tmp|var)\//,
    "no flag names and no filesystem paths reach a browser");

  // `generic` is the fallback every unprofiled clearance resolves to. The key rule's own comment claimed
  // the create path never allowed it while the regex matched it happily, so the rule was a sentence
  // rather than a check. Creating it would shadow the bundled fallback for every job naming no company.
  const houses = await service.route("POST", "/profiles", STAFF, { name: "Generic", key: "generic" });
  assert.equal(houses.status, 400);
  assert.match(houses.json.message, /house default/);

  assert.equal(writeCalls.length, 0, "neither refusal wrote anything");
});

// ── A CREATE THE STORE CANNOT RECORD IS REFUSED ─────────────────────────────────────────────────────────
//
// This answered 201 with the company live and a `commitError` beside it. Measured on the test instance: a
// fresh store with no committer identity, the default state of a machine nobody configured, got a live
// company with no commit behind it on its first create, and a grant filed for it too. Each arm below drives
// a real create against a real store and reads the response, the disk and the audit trail.
//
// NO IDENTITY, DETERMINISTICALLY. Whether git guesses an identity from the account and the hostname
// depends on the machine, so the global config these arms give git says it may not; the store under test
// then has an identity only if it sets one itself. `-c` on a seed commit would not count, and nothing here
// uses it.
const KEY = "ferrymead-instruments";
const GIT_ENV_KEYS = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];

/** A store in the given state, and a service committing into it as the portal wires one. */
function realStore(state) {
  const root = mkdtempSync(join(tmpdir(), `company-create-${state}-`));
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: "pipe" }).trim();
  const profileDir = join(root, "profiles");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "generic.json"), JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));
  if (state !== "no-repository") git("init", "-q");
  if (state === "healthy" || state === "hook-refuses") {
    git("config", "user.email", "store@example.test");
    git("config", "user.name", "store");
    git("add", "-A");
    git("commit", "-q", "-m", "seed");
  }
  if (state === "hook-refuses") writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'refused by a hook' >&2\nexit 1\n", { mode: 0o755 });
  const auditPath = join(profileDir, "_audit.log");
  const service = makeProfileService({ profileDir, gitCommit: makeStoreCommit({ repoRoot: root }), audit: makeCommittableAudit({ auditPath, repoRoot: root }) });
  const rows = () => (existsSync(auditPath) ? readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).event) : []);
  const staged = () => (state === "no-repository" ? "" : git("diff", "--cached", "--name-only"));
  return { root, git, service, file: join(profileDir, `${KEY}.json`), rows, staged };
}

/** Run `fn` with git unable to guess an identity: only a repository's own config supplies one. */
async function withNoGuessedIdentity(fn) {
  const saved = Object.fromEntries(GIT_ENV_KEYS.map((k) => [k, process.env[k]]));
  const dir = mkdtempSync(join(tmpdir(), "company-create-gitconfig-"));
  writeFileSync(join(dir, "config"), "[user]\n\tuseConfigOnly = true\n");
  for (const k of GIT_ENV_KEYS) delete process.env[k];
  process.env.GIT_CONFIG_GLOBAL = join(dir, "config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

const create = (s) => s.service.route("POST", "/profiles", STAFF, { name: "Ferrymead Instruments" });

test("THE CONTROL: a healthy store creates the company, commits it and its audit row, and leaves nothing staged", () => withNoGuessedIdentity(async () => {
  const s = realStore("healthy");
  const r = await create(s);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.commit, /^[0-9a-f]{40}$/);
  assert.ok(existsSync(s.file), "the profile is on disk");
  assert.match(s.git("log", "-1", "--format=%s"), new RegExp(`create company ${KEY}`));
  assert.deepEqual(s.git("show", "--name-only", "--format=", "HEAD").split("\n").sort(), [`profiles/${KEY}.json`, "profiles/_audit.log"].sort());
  assert.deepEqual(s.rows(), ["profile-create"]);
  assert.equal(s.staged(), "");
}));

test("a fresh store with no git identity refuses the create, names the store and the command, and writes nothing", () => withNoGuessedIdentity(async () => {
  const s = realStore("no-identity");
  const r = await create(s);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "store_no_identity");
  assert.match(r.json.error, /^No company was created: .*has no git identity/);
  assert.ok(r.json.error.includes(s.root) && r.json.error.includes(`git -C ${s.root} config user.email`), r.json.error);
  assert.doesNotMatch(r.json.error, /Please tell me who you are|Committer identity unknown/, "the operator's terms, not git's");
  assert.ok(!existsSync(s.file), "no profile on disk");
  assert.deepEqual(s.rows(), [], "nothing happened, so the audit trail records nothing");
  assert.equal(s.staged(), "");
}));

test("a store that is not a repository refuses the create the same way, and writes nothing", () => withNoGuessedIdentity(async () => {
  const s = realStore("no-repository");
  const r = await create(s);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "store_not_a_repository");
  assert.match(r.json.error, /is not a git repository this install can record into[\s\S]*git init/);
  assert.ok(!existsSync(s.file), "no profile on disk");
  assert.deepEqual(s.rows(), []);
}));

test("a commit refused after the write is withdrawn: the file is gone, nothing is staged, and the trail says so", () => withNoGuessedIdentity(async () => {
  const s = realStore("hook-refuses");
  const r = await create(s);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "store_commit_failed");
  assert.match(r.json.error, /^No company was created: the store could not record it .*Nothing was left behind\.$/);
  assert.ok(!existsSync(s.file), "the profile was removed");
  assert.ok(!s.staged().split("\n").includes(`profiles/${KEY}.json`), `the profile is still staged, and the next save would commit it: ${s.staged()}`);
  assert.deepEqual(s.rows(), ["profile-create", "store-commit-failed", "profile-create-withdrawn"]);
  assert.match(s.git("log", "-1", "--format=%s"), /^seed$/, "no commit landed");
}));

test("a refused create files no grant: the organisation's grant rides a 201 only", () => withNoGuessedIdentity(async () => {
  const filed = [];
  const principal = { email: STAFF.email, genericOrgs: ["firm"], everything: true, permissions: { run: true, manage: true } };
  for (const [state, status, grants] of [["no-identity", 409, 0], ["healthy", 201, 1]]) {
    const s = realStore(state);
    filed.length = 0;
    const upstream = makeUpstream({
      callUpstream: (method, path, body) => s.service.route(method, path, STAFF, body ?? {}),
      fileCompany: async (g) => { filed.push(g); },
    });
    const r = await upstream.createCompany(principal, { name: "Ferrymead Instruments" });
    assert.equal(r.status, status, `${state}: ${JSON.stringify(r.json)}`);
    assert.equal(filed.length, grants, `${state}: grants filed`);
  }
}));

test("a name is required, and the refusal is the one a person can act on", async () => {
  const { service } = svc();
  const r = await service.route("POST", "/profiles", STAFF, {});
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "needs_name");
  assert.match(r.json.message, /needs a name/i);
});

test("NO REFUSAL SENDS TERMINAL VOCABULARY TO A BROWSER", () => {
  // The shared create path's own sentences are written for somebody standing in a terminal: they name
  // the flag that was missing and the directory that was written to, which is right for that reader and
  // useless to a lawyer on the New company page. Each refusal now carries a code, and this door words it.
  //
  // Driven over EVERY code the shared path can raise rather than the two that were easy to reach, and
  // taken from the create path itself rather than a list retyped here — a code added there without a
  // wording here fails this rather than reaching somebody as a flag name.
  const cases = [
    { code: "key_exists", detail: { key: "acme" } },
    { code: "domain_claimed", detail: { domain: "acme.example", heldBy: "other" } },
    { code: "no_marketplaces", detail: {} },
    { code: "framework_missing", detail: { path: "own/deck.md" } },
    { code: "invalid_bundle", detail: { errors: ["profiles/acme.json: name is required"] } },
  ];

  // FLOOR: every code the create path actually raises is covered above. A silently shrinking list is how
  // this arm would pass while a new refusal reached a browser saying "--platforms".
  const src = readFileSync(new URL("../company-bundle.mjs", import.meta.url), "utf8");
  const raised = [...src.matchAll(/code:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(raised, cases.map((c) => c.code).sort(),
    "every refusal the create path raises is worded for the browser here");

  for (const { code, detail } of cases) {
    const e = new Refusal("no --platforms was given; repair the generic profile in /srv/store", { code, ...detail });
    const worded = browserRefusal(e);
    assert.equal(worded.code, code, `${code} keeps its kind`);
    assert.ok(worded.message && worded.message.length > 20, `${code} says something a person can read`);
    assert.doesNotMatch(worded.message, /--[a-z]/, `${code} names no command-line flag`);
    assert.doesNotMatch(worded.message, /\/(home|srv|tmp|var|Users)\//, `${code} prints no filesystem path`);
    assert.doesNotMatch(worded.message, /brand owner/i, `${code} does not use the retired noun`);
  }

  // The other direction: an UNKNOWN code must still say something. An unworded refusal becoming a silent
  // one is worse than an unworded refusal.
  const unknown = browserRefusal(new Refusal("something else went wrong", { code: "not_a_code_we_word" }));
  assert.match(unknown.message, /something else went wrong/);
});
