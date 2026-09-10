// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The person who installs is a person, not a domain.
//
// The install used to turn the one sign-in address it was given into `PORTAL_STAFF_DOMAINS`: everything
// after its `@` became a rule, and every address at that domain was staff, seeing every company on the
// install. With `<account>@localhost` that was one machine; with a real address it was a whole employer,
// written with nothing said. The rule is deleted. The address is the first person — Run, Manage, access
// to everything — as their own entry in the grants file, and setup asks one more question directly after
// it: the organisation's name.
//
// WHAT THESE ARMS PIN, in the order the value travels:
//
//   1. the refusals about the address itself — a public provider, a documentation domain — which
//      outlive the rule, and name the setting the reader changes;
//   2. the REAL `clearotron start`, driven: the local-account default and a real domain both start with
//      no domain question, and a public provider refuses before any state is written;
//   3. the wizard's prompt, driven with scripted answers: the address, then the organisation's name,
//      required, written so the product's own loader reads it back whole;
//   4. the grants file start writes: the installer's entry and the first organisation, each under its
//      own condition, through the shared editors, and nobody else at the installer's domain;
//   5. that file as the real `start` writes it, from the settings setup wrote, and left alone after.
//
// Group 2 drives the shipped command rather than reading its source, because the defect was a line at a
// call site. Group 3 drives the prompt behind an injected io for the same reason, and one arm holds it
// to a single call site so the rest cannot go on passing about a step nobody reaches.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { classifyAddressDomain, domainOfEmail, addressRefusal, PUBLIC_EMAIL_DOMAINS } from "../../shared/staff-domain.mjs";
import { childEnv, installPaths, installerGrants } from "../../bin/start.mjs";
import { askSignIn, composeEnvBody, readEnvFile } from "../../bin/onboard.mjs";
import { assertGrantsShape, resolvePerson } from "../../shared/scope.mjs";
import { handRunEnv, assertReadItsEnvFile } from "./drive-env.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const START = join(ROOT, "bin", "start.mjs");

// ── 1. the refusals about the address itself ─────────────────────────────────────────────────────────

test("a public provider and a documentation domain are refused; every other domain is simply accepted", () => {
  for (const d of ["gmail.com", "outlook.com", "yahoo.co.uk", "hotmail.fr", "proton.me", "gmx.de", "qq.com"])
    assert.equal(classifyAddressDomain(d), "public", `${d} is a personal mailbox provider, not an address an organisation controls`);

  // RFC 2606. Real mail is never delivered here, so an address at one is always a placeholder somebody
  // typed, which is how an outside install came to be set up in the name of nobody.
  for (const d of ["example.com", "example.net", "example.org", "sub.example.com", "staff.example", "host.invalid", "box.test"])
    assert.equal(classifyAddressDomain(d), "reserved", `${d} is reserved for documentation and receives no real mail`);

  // ACCEPTED, and this is the whole change. A real domain, one machine and a bare hostname are an address
  // like any other, because an accepted address admits itself and nobody else. The local-account form is
  // the path every first install takes, so an arm that checked only the refusals would let a fix break
  // it and stay green.
  for (const d of ["a-firm.ch", "example-firm.com", "localhost", "localhost.localdomain", "workstation"])
    assert.equal(classifyAddressDomain(d), "accepted", `${d} was refused as a sign-in address`);

  // "" IS ITS OWN ANSWER. Nothing was classified, so nothing was decided.
  assert.equal(classifyAddressDomain(""), "");
  assert.equal(classifyAddressDomain(undefined), "");
});

test("domainOfEmail takes the LAST @, agreeing with the resolver that decides access", () => {
  // shared/scope.mjs refuses a multi-@ identity outright BECAUSE a first-@ split once read `x@firm@evil`
  // as the firm while the edge saw the other half. A refusal that split on the first @ would judge a
  // different domain from the one the door sees.
  assert.equal(domainOfEmail("alex@a-firm.ch"), "a-firm.ch");
  assert.equal(domainOfEmail("ALEX@A-Firm.CH"), "a-firm.ch");
  assert.equal(domainOfEmail("x@a-firm.ch@evil.example-tld"), "evil.example-tld");
  assert.equal(domainOfEmail("nonsense"), "");
});

test("a refusal names the domain, why it is refused, and the setting to change", () => {
  const pub = addressRefusal("someone@gmail.com");
  assert.match(pub, /gmail\.com/, "a refusal that does not name the domain leaves the reader guessing which value to change");
  assert.match(pub, /public email provider/);
  assert.match(pub, /PORTAL_LOCAL_USER/, "…and it must name the setting the address lives in, which is what the reader changes");
  assert.match(pub, /@localhost/, "…and the form for a machine with one user");

  const res = addressRefusal("mn@example.com");
  assert.match(res, /example\.com/);
  assert.match(res, /RFC 2606|documentation/, "the reserved refusal has to say WHY it is not a real address");
  assert.match(res, /PORTAL_LOCAL_USER/);

  // NOTHING ABOUT A RULE. These refuse an address; a sentence offering a domain setting would hand the
  // reader the rule that was deleted.
  assert.doesNotMatch(`${pub}\n${res}`, /PORTAL_STAFF_DOMAINS|staff/i);

  assert.equal(addressRefusal("alex@a-firm.ch"), null);
  assert.equal(addressRefusal("operator@localhost"), null);
});

test("the public-provider list is a list of providers, not of every domain", () => {
  assert.ok(PUBLIC_EMAIL_DOMAINS.has("gmail.com"));
  assert.ok(!PUBLIC_EMAIL_DOMAINS.has("a-firm.ch"));
  // The list is allowed to be short BECAUSE a miss admits no stranger: an accepted address is one
  // person's entry, never a rule about their domain.
  assert.equal(classifyAddressDomain("some-webmail-nobody-listed.example-tld"), "accepted");
});

// ── 2. the shipped command ───────────────────────────────────────────────────────────────────────────

test("the portal is handed no domain rule of any kind", () => {
  const e = childEnv({ ports: { portal: 18802, mcp: 18790, client: 18811 }, paths: installPaths("/install-root/trademark"),
    user: "alex@a-firm.example-tld", portalSecret: "p", tokenSecret: "t", opsToken: "o" });
  for (const [child, env] of Object.entries(e)) {
    if (env && typeof env === "object")
      assert.equal("PORTAL_STAFF_DOMAINS" in env, false, `the ${child} environment still carries the deleted rule`);
  }
  assert.equal(e.portal.PORTAL_LOCAL_USER, "alex@a-firm.example-tld", "the address itself must still reach the portal");
});

/**
 * Drive the REAL `clearotron start` in a HOME of its own and read what it said.
 *
 * `--user` is the shortest path to the line under test; `PORTAL_LOCAL_USER` in the environment file
 * reaches it identically. `handRunEnv` is what makes the command read that file at all (see
 * drive-env.mjs).
 */
function driveStart(args, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "installer-person-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  return { ...driveStartIn(home, args, extra), clean: () => rmSync(home, { recursive: true, force: true }) };
}

function driveStartIn(home, args, extra = {}) {
  // EVERY DATA-DIRECTORY NAME IS CLEARED, and that is what makes the no-state assertion below mean
  // something: a `CLEAROTRON_REPORTS_DIR` in the developer's shell would put the data plane outside this
  // drive's HOME, and an arm checking that HOME holds nothing would be checking a question it had moved
  // out of range. The organisation's name is cleared for the same reason.
  const env = handRunEnv({
    HOME: home, PORTAL_LOCAL_USER: undefined, CLEAROTRON_ORGANISATION_NAME: undefined,
    CLEAROTRON_REPORTS_DIR: undefined, CLEAROTRON_WORK_DIR: undefined, CLEAROTRON_QUEUE_DIR: undefined,
    CLEAROTRON_OUTBOX_DIR: undefined, CLEAROTRON_RUN_LOCK_DIR: undefined, CLEAROTRON_ACCESS_FILE: undefined,
    ...extra,
  });
  const r = spawnSync(process.execPath, [START, ...args], { encoding: "utf8", timeout: 180_000, env });
  return { home, said: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
}

test("start refuses a public provider before it writes anything, and names where the address came from", () => {
  const d = driveStart(["--user", "someone@gmail.com"]);
  try {
    assert.notEqual(d.code, 0, `start accepted a personal mailbox as the first person on the install:\n${d.said}`);
    assert.match(d.said, /gmail\.com/);
    assert.match(d.said, /public email provider/i);
    assert.match(d.said, /--user/, "the refusal must name the value it came from, or the reader edits the wrong one");

    // NOTHING HALF-MADE. The refusal is decided before `markStateWritten()`, so a refused start leaves
    // no `.env`, no data directories and no units. An arm that only read the message would pass on a
    // refusal that had already written the person it was declining.
    const cfg = join(d.home, ".config", "clearotron");
    assert.ok(!existsSync(join(cfg, ".env")), "the refusal wrote an env file, so the address it declined is on disk anyway");
    assert.ok(!existsSync(join(d.home, "trademark")) || readdirSync(join(d.home, "trademark")).length === 0,
      "the refusal created the data plane, so this run was not the no-state refusal it claims to be");
  } finally { d.clean(); }
});

/**
 * `start` is a supervisor: past the identity block it binds ports and runs until killed, so an arm
 * cannot simply let it finish. It is driven into a LATER refusal instead — a port this test holds, named
 * explicitly so it is refused rather than moved — which is the cheapest way to get a terminating run that
 * has demonstrably passed the block under test. Reaching the "signs in as" banner is the positive
 * evidence; the absence of a refusal alone would also be satisfied by a command that died before it.
 */
async function driveToThePortRefusal(args) {
  const s = createServer(() => {});
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const run = driveStart(args, { PORTAL_SERVICE_PORT: String(s.address().port) });
  return { ...run, clean: async () => { run.clean(); await new Promise((r) => s.close(r)); } };
}

test("the local-account default still starts with no question and no refusal", async () => {
  // THE TIGHTEST CONSTRAINT IN THIS CHANGE. Every fresh install takes this path, non-interactively, and
  // a fix that made it ask or refuse would break the product's first run.
  const run = await driveToThePortRefusal([]);
  try {
    assert.match(run.said, /signs in as\s+\S+@localhost/,
      `the local-account default did not reach the banner, so this arm did not measure its subject:\n${run.said}`);
    assert.doesNotMatch(run.said, /public email provider|reserved for documentation/,
      `the local-account default reached an address refusal, which every first install would meet:\n${run.said}`);
    assert.match(run.said, /already in use/, "the drive was expected to end on the port this arm holds");
  } finally { await run.clean(); }
});

test("a real domain starts like any other address: the part after the @ is no longer a rule", async () => {
  // THE ARM THIS REPLACES asserted a refusal here, quoting "Anyone at <domain>" and handing the reader a
  // PORTAL_STAFF_DOMAINS line to write. With the rule deleted there is nothing to consent to: the address
  // becomes one person and admits nobody else, so it must start exactly as the local-account form does.
  const run = await driveToThePortRefusal(["--user", "alex@a-firm.example-tld"]);
  try {
    assert.match(run.said, /signs in as\s+alex@a-firm\.example-tld/,
      `a real domain did not reach the banner:\n${run.said}`);
    assert.doesNotMatch(run.said, /Anyone at|PORTAL_STAFF_DOMAINS|would make every address at/,
      `start still speaks of a domain rule:\n${run.said}`);
    assert.match(run.said, /already in use/, "the drive was expected to end on the port this arm holds");
  } finally { await run.clean(); }
});

// ── 3. the wizard, driven ────────────────────────────────────────────────────────────────────────────

/**
 * Drive `askSignIn` with scripted answers and record what the reader was shown.
 *
 * The wizard refuses a non-terminal stdin, so its prompt loop is unreachable from a test through the
 * command itself. The loop sits behind an injected `io` for exactly the branches that matter — an answer
 * that must be sent back. Read as source it would have been green either way.
 */
function drive(answers) {
  const said = [];
  const asked = [];
  const io = {
    askValue: async (q, opts = {}) => { asked.push(q); const a = answers.shift(); return a === "" ? (opts.def ?? "") : a; },
    ok: (s) => said.push(s), problem: (s) => said.push(s),
  };
  return { io, said, asked, text: () => said.join("\n") };
}

test("the wizard asks for the address, then the organisation's name, and nothing about a domain", async () => {
  const d = drive(["", "Acme Trading"]);
  const out = await askSignIn(d.io, { localAccount: "operator" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "operator@localhost", CLEAROTRON_ORGANISATION_NAME: '"Acme Trading"' },
    "Enter must take the local-account form, and the name must be carried to the settings file");
  assert.match(d.asked[0] ?? "", /Sign-in address/i, "the wizard did not ask for the address");
  assert.match(d.asked[1] ?? "", /organisation's name/i, "the organisation's name must be asked directly after the address");
  assert.equal(d.asked.length, 2, "the local-account default must cost the reader the address and the name, nothing more");
});

test("a real domain is asked nothing more: no rule is stated, offered or written", async () => {
  const d = drive(["alex@a-firm.example-tld", "A Firm Sàrl"]);
  const out = await askSignIn(d.io, { localAccount: "operator" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "alex@a-firm.example-tld", CLEAROTRON_ORGANISATION_NAME: '"A Firm Sàrl"' },
    "a real address must be kept as typed, with no domain setting beside it");
  assert.equal(d.asked.length, 2, "a real domain was asked a question the address alone no longer raises");
  assert.doesNotMatch(d.text(), /Anyone at|PORTAL_STAFF_DOMAINS|a rule, not a person/);
});

test("the wizard re-asks rather than accepting a provider, a placeholder or a non-address", async () => {
  // Each of the three is answered and then corrected, so the loop is driven rather than described. The
  // final answer is the local-account form, which is also the way out the refusals point at.
  const d = drive(["someone@gmail.com", "mn@example.com", "not-an-address", "", "Acme"]);
  const out = await askSignIn(d.io, { localAccount: "operator" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "operator@localhost", CLEAROTRON_ORGANISATION_NAME: '"Acme"' });
  assert.equal(d.asked.length, 5, "the wizard accepted an address it should have sent back");
  assert.match(d.text(), /gmail\.com/);
  assert.match(d.text(), /example\.com/);
  assert.match(d.text(), /single email address/);
});

test("the organisation's name is required, and the product's own loader reads it back whole", async () => {
  const d = drive(["", "", "   ", 'Say "hi" Ltd', "Café #1 Sàrl"]);
  const out = await askSignIn(d.io, { localAccount: "operator" });
  assert.equal(d.asked.length, 5, "a blank name, or one holding a double quote, was accepted");
  assert.match(d.text(), /A name is needed here/);
  assert.match(d.text(), /double quote/);

  // THE ROUND TRIP, through the writer and the reader setup itself uses. Written bare, this name comes
  // back as "Café": the loader's parser ends an unquoted value at `#`. A name that survives the prompt
  // and dies in the file is an organisation nobody named.
  const home = mkdtempSync(join(tmpdir(), "org-name-"));
  try {
    const file = join(home, ".env");
    writeFileSync(file, composeEnvBody(out, {}));
    const back = readEnvFile(file, { home });
    assert.equal(back.CLEAROTRON_ORGANISATION_NAME, "Café #1 Sàrl",
      `the settings file does not give back the name typed:\n${readFileSync(file, "utf8")}`);
    assert.equal(back.PORTAL_LOCAL_USER, "operator@localhost");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the wizard has ONE sign-in step, and neither command reads or writes the deleted setting", () => {
  // The arms above drive `askSignIn`. This is what keeps them about the product: a second copy of the
  // prompt inside `runCli`, or none at all, would leave every one of them true and the wizard silent.
  const src = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  const calls = [...src.matchAll(/await askSignIn\(/g)];
  assert.equal(calls.length, 1, `the wizard calls askSignIn ${calls.length} times — one call site, or these arms describe code nobody runs`);
  assert.match(src, /section\("Who signs in"\)/, "the step must be a named section the reader can see they are in");
  // AND ITS ANSWER REACHES THE FILE. `composeEnvBody` writes every key of `candidate`, so assigning the
  // returned object into it is the whole of the write.
  assert.match(src, /Object\.assign\(candidate, await askSignIn\(/,
    "askSignIn's answer must land in the candidate that becomes the .env, or the question was theatre");
  // A read or a write of the setting, not a mention: a dated record of the rule may still name it.
  const touches = /PORTAL_STAFF_DOMAINS\s*:|\(\s*["'`]PORTAL_STAFF_DOMAINS["'`]\s*\)|process\.env\.PORTAL_STAFF_DOMAINS/;
  for (const f of ["onboard.mjs", "start.mjs"])
    assert.doesNotMatch(readFileSync(join(ROOT, "bin", f), "utf8"), touches, `bin/${f} still reads or writes PORTAL_STAFF_DOMAINS`);
});

// ── 4. the grants file start writes ──────────────────────────────────────────────────────────────────

test("a fresh install's grants file holds the installer, with access to everything, and the organisation", () => {
  const r = installerGrants(null, { user: "alex@a-firm.example-tld", organisation: "A Firm Sàrl" });
  assert.deepEqual(r.changed, ["person", "organisation"]);
  assert.deepEqual(r.grants.people, { "alex@a-firm.example-tld": { run: true, manage: true, everything: true } },
    "the person who installs is the first person: Run, Manage, access to everything");
  const keys = Object.keys(r.grants.tenants);
  assert.equal(keys.length, 1, "exactly one organisation, the one setup was told");
  assert.equal(r.grants.tenants[keys[0]].name, "A Firm Sàrl", "the organisation carries its name as typed");
  assert.deepEqual(r.grants.tenants[keys[0]].accounts, [], "a new organisation holds no company yet");
  assert.doesNotThrow(() => assertGrantsShape(r.grants, "the installer's grants"), "start must write a file the portal loads");

  const p = resolvePerson("alex@a-firm.example-tld", r.grants);
  assert.equal(p?.everything, true);
  assert.deepEqual(p.permissions, { run: true, manage: true });
  assert.equal(r.unadmitted, false);
  // AND NOBODY ELSE AT THAT DOMAIN — the deleted rule, asserted absent where it used to act.
  assert.equal(resolvePerson("colleague@a-firm.example-tld", r.grants), null,
    "a colleague at the installer's domain was admitted: the domain rule is back");
});

test("with no organisation's name, none is invented, and the installer still sees everything", () => {
  const r = installerGrants(null, { user: "operator@localhost" });
  assert.deepEqual(r.changed, ["person"]);
  assert.deepEqual(r.grants.tenants, {}, "an organisation was invented for a name nobody gave");
  const p = resolvePerson("operator@localhost", r.grants);
  assert.equal(p?.everything, true, "access to everything must not depend on an organisation existing");
  assert.deepEqual(p.genericOrgs, [], "Generic files under no organisation, as it did before organisations existed");
});

test("the file an earlier start wrote gains the installer — the upgrade that would otherwise lock them out", () => {
  // `{"tenants":{}}` is what this command wrote before `people` existed, and its local user was admitted
  // by the domain rule alone. Left as it was, the first start after an upgrade locks them out of their
  // own install.
  const r = installerGrants({ tenants: {} }, { user: "operator@localhost", organisation: "Acme" });
  assert.deepEqual(r.changed, ["person", "organisation"]);
  assert.equal(resolvePerson("operator@localhost", r.grants)?.everything, true);
});

test("a file that names anybody is left exactly as it is, and an unadmitted installer is reported, not repaired", () => {
  const existing = {
    tenants: { acme: { name: "Acme", accounts: ["acme-main"], users: { "boss@acme.example-tld": "*" } } },
    people: { "boss@acme.example-tld": { run: true, manage: true } },
  };
  const before = JSON.stringify(existing);
  const r = installerGrants(existing, { user: "operator@localhost", organisation: "Something Else" });
  assert.deepEqual(r.changed, []);
  assert.equal(JSON.stringify(r.grants), before, "a file somebody populated was rewritten");
  assert.equal(JSON.stringify(existing), before, "the caller's object was changed in place");
  assert.equal(r.unadmitted, true, "the installer resolves to nothing here, and the caller must be told so");
  assert.equal(resolvePerson("operator@localhost", r.grants), null, "…and must not have been given access by a side door");
});

test("an organisation is filed only into a file that holds none", () => {
  const r = installerGrants({ tenants: { acme: { name: "Acme", accounts: [], users: {} } } },
    { user: "operator@localhost", organisation: "Second" });
  assert.deepEqual(r.changed, ["person"], "a second organisation was filed from a setting meant only for the first");
  assert.deepEqual(Object.keys(r.grants.tenants), ["acme"]);
});

// ── 5. the same file, written by start itself ──────────────────────────────────────────────────────

/** Ports nobody holds, stated explicitly so the probe checks them and moves none. */
async function freePorts(n) {
  const servers = await Promise.all(Array.from({ length: n }, () => new Promise((resolve) => {
    const s = createServer(() => {});
    s.listen(0, "127.0.0.1", () => resolve(s));
  })));
  const ports = servers.map((s) => String(s.address().port));
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return ports;
}

/**
 * Drive start through the grants file and stop it at the very next step: the revocation list, pointed
 * under a regular file so it cannot be created. The grants file is on disk when start exits, nothing has
 * been spawned, and that refusal's wording is the evidence the grants block ran rather than was skipped.
 */
async function driveThroughTheGrantsFile(home, args) {
  const [portal, mcp, client] = await freePorts(3);
  const blocker = join(home, "not-a-directory");
  writeFileSync(blocker, "");
  const run = driveStartIn(home, args, {
    PORTAL_SERVICE_PORT: portal, TRADEMARK_MCP_HTTP_PORT: mcp, CLIENT_MCP_HTTP_PORT: client,
    TRADEMARK_MCP_TOKEN_DENYLIST: join(blocker, "token-denylist"),
  });
  assert.match(run.said, /could not use the revocation list/,
    `the drive did not stop at the step after the grants file, so this arm did not measure its subject:\n${run.said}`);
  return run;
}

test("start files what setup wrote — the installer and the organisation — and a second start changes nothing", async () => {
  // THE WIRING, which section 4 cannot see: every arm there stays green with the call to
  // `installerGrants` deleted from start. This one reads the file start wrote, from the settings setup
  // wrote, with no flag — the path a fresh install takes.
  const home = mkdtempSync(join(tmpdir(), "installer-write-"));
  try {
    const envFile = join(home, ".config", "clearotron", ".env");
    mkdirSync(dirname(envFile), { recursive: true });
    const out = await askSignIn(drive(["alex@a-firm.example-tld", "Café #1 Sàrl"]).io, { localAccount: "operator" });
    writeFileSync(envFile, composeEnvBody(out, {}), { mode: 0o600 });

    const first = await driveThroughTheGrantsFile(home, []);
    assertReadItsEnvFile(first.said, envFile);
    const grantsFile = installPaths(join(home, "trademark")).grants;
    const written = JSON.parse(readFileSync(grantsFile, "utf8"));
    assert.doesNotThrow(() => assertGrantsShape(written, grantsFile), "start wrote a grants file the portal refuses");
    assert.deepEqual(written.people, { "alex@a-firm.example-tld": { run: true, manage: true, everything: true } });
    assert.deepEqual(Object.values(written.tenants).map((t) => t.name), ["Café #1 Sàrl"],
      "the organisation setup was told did not reach the grants file whole");
    assert.equal(resolvePerson("alex@a-firm.example-tld", written)?.everything, true);
    assert.match(first.said, /organisation "Café #1 Sàrl", filed there/);

    // NEVER OVERWRITTEN. Told another name, a second start finds the file and leaves every byte of it.
    const bytes = readFileSync(grantsFile, "utf8");
    const second = await driveThroughTheGrantsFile(home, ["--organisation", "Another Name"]);
    assert.equal(readFileSync(grantsFile, "utf8"), bytes, "a second start rewrote a grants file that already named its people");
    assert.doesNotMatch(second.said, /Run, Manage, access to everything|filed there/,
      `a second start reported a change to a file it must leave alone:\n${second.said}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
