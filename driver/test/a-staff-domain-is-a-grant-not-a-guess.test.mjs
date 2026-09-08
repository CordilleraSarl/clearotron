// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// One person's address must not silently become a rule about everyone who shares their email domain.
//
// `PORTAL_STAFF_DOMAINS` names email domains, and every address at a listed domain that gets past the
// sign-in door is staff: it sees every brand owner on the instance (driver/portal-access.mjs). The
// install used to build that list by taking everything after the last `@` of the one address it was
// given. With `<account>@localhost` the rule is one machine and nobody else. With a real address it is
// that address's whole employer — and it was written with nothing said and nothing asked.
//
// An outside install reached that state: an assistant filled in a documentation address on the
// operator's behalf, the install granted that domain, and the settings page reported it back to them
// as "Anyone at <that domain> — a rule, not a person". They read it as a back door. It was not one —
// nothing phones anywhere — but a grant to a group HAD been made, by nobody, and there was no way from
// the screen to find where it was written or how to undo it.
//
// WHAT THESE ARMS PIN, in the order the value travels:
//
//   1. the classifier — which domains can never be a staff rule, and which are wider than one machine;
//   2. `staffDomainFor` — refuses the first kind by throwing, and still answers "" for a non-address,
//      because nothing classified is not the same finding as something refused;
//   3. the REAL `clearotron start`, driven end to end: the local-account default still starts silently,
//      and a real domain refuses BEFORE any state is written, quoting the rule it would have made;
//   3b. the wizard's own prompt, driven with scripted answers — including the reader who pressed Enter
//      at the grant question, which must write nothing;
//   4. the settings surface — the rule now carries the setting that created it and the file it is in.
//
// Group 3 drives the shipped command rather than reading its source, because the defect was a line at a
// call site and an arm over `staffDomainFor` alone would have been green throughout. Group 3b drives
// the prompt behind an injected io for the same reason, and one arm holds it to a single call site so
// the rest cannot go on passing about a step nobody reaches.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { classifyStaffDomain, domainOfEmail, staffDomainRefusal, staffGrantSentence,
         PUBLIC_EMAIL_DOMAINS } from "../../shared/staff-domain.mjs";
import { staffDomainFor, StaffDomainRefused } from "../../bin/start.mjs";
import { askSignIn } from "../../bin/onboard.mjs";
import { accessView, staffRuleSource } from "../portal-config-view.mjs";
import { handRunEnv } from "./drive-env.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const START = join(ROOT, "bin", "start.mjs");

// ── 1. the classifier ────────────────────────────────────────────────────────────────────────────────

test("classifyStaffDomain: one machine, a provider, a placeholder, and a real domain are four answers", () => {
  // NARROW — the local-account default and its relatives. This is the path every laptop takes and the
  // one that must stay silent; an arm that only checked the refusals would let a fix break every
  // first-run install and still be green.
  for (const d of ["localhost", "localhost.localdomain", "workstation"])
    assert.equal(classifyStaffDomain(d), "narrow", `${d} names no second person and must not be treated as a grant`);

  // PUBLIC — a staff rule here admits strangers, and there is no yes that makes it right.
  for (const d of ["gmail.com", "outlook.com", "yahoo.co.uk", "hotmail.fr", "proton.me", "gmx.de", "qq.com"])
    assert.equal(classifyStaffDomain(d), "public", `${d} is a shared provider; a rule built from it grants the public`);

  // RESERVED — RFC 2606. Real mail is never delivered here, so an address at one is always a
  // placeholder somebody typed, which is exactly how the reported install came to grant a domain.
  for (const d of ["example.com", "example.net", "example.org", "sub.example.com", "staff.example", "host.invalid", "box.test"])
    assert.equal(classifyStaffDomain(d), "reserved", `${d} is reserved for documentation and receives no real mail`);

  // WIDE — an ordinary domain. Not refused: it is how a firm admits its own lawyers. But it is a grant
  // to people the operator has not met, so it is stated and confirmed rather than derived.
  for (const d of ["a-firm.ch", "example-firm.com", "cordillera.example-tld"])
    assert.equal(classifyStaffDomain(d), "wide", `${d} is a real domain and the rule about it is a grant`);

  // "" IS ITS OWN ANSWER. Nothing was classified, so nothing was decided — the caller must not be able
  // to read an empty string as a verdict.
  assert.equal(classifyStaffDomain(""), "");
  assert.equal(classifyStaffDomain(undefined), "");
});

test("domainOfEmail takes the LAST @, agreeing with the door that decides privilege", () => {
  // driver/portal-access.mjs refuses a multi-@ identity outright BECAUSE a first-@ split once
  // classified `x@firm@evil` as staff while the edge saw the other half. A classifier that split on the
  // first @ would hand the wizard a different domain from the one the door would judge.
  assert.equal(domainOfEmail("alex@a-firm.ch"), "a-firm.ch");
  assert.equal(domainOfEmail("ALEX@A-Firm.CH"), "a-firm.ch");
  assert.equal(domainOfEmail("x@a-firm.ch@evil.example-tld"), "evil.example-tld");
  assert.equal(domainOfEmail("nonsense"), "");
});

test("a refusal names the domain and says what to do instead", () => {
  const pub = staffDomainRefusal("gmail.com");
  assert.match(pub, /gmail\.com/, "a refusal that does not name the domain leaves the reader guessing which value to change");
  assert.match(pub, /PORTAL_STAFF_DOMAINS/, "…and it must name the setting that would let them say what they do mean");
  assert.match(pub, /@localhost/, "…and the form that grants nothing at all, for a machine with one user");

  const res = staffDomainRefusal("example.com");
  assert.match(res, /example\.com/);
  assert.match(res, /RFC 2606|documentation/, "the reserved refusal has to say WHY it is not a real address");

  // A domain that CAN be a rule is not refused here: `wide` is answered by the confirmation the caller
  // runs, and a function that refused it too would leave a firm unable to admit its own people.
  assert.equal(staffDomainRefusal("a-firm.ch"), null);
  assert.equal(staffDomainRefusal("localhost"), null);
});

test("the consent sentence is the settings page's own words", () => {
  // ONE COMPOSER FOR BOTH SURFACES. The screen renders "Anyone at <domain>" beside a pill reading "a
  // rule, not a person", and describes staff as capable of seeing every brand owner. A prompt phrased
  // any other way asks about one thing and shows another, which is how somebody says yes to a rule they
  // would not have agreed to.
  const s = staffGrantSentence("a-firm.ch", { staffLabel: "Acme staff" });
  assert.match(s, /Anyone at a-firm\.ch/);
  assert.match(s, /a rule, not a person/);
  assert.match(s, /Acme staff/);
  assert.match(s, /every brand owner/);
});

test("the public-provider list is a list of providers, not of every domain", () => {
  // The lists are allowed to be short BECAUSE `wide` catches everything else and asks. This arm exists
  // so that stays true: an unlisted provider must land in `wide`, never in a silent pass.
  assert.ok(PUBLIC_EMAIL_DOMAINS.has("gmail.com"));
  assert.ok(!PUBLIC_EMAIL_DOMAINS.has("a-firm.ch"));
  assert.equal(classifyStaffDomain("some-webmail-nobody-listed.example-tld"), "wide",
    "an unlisted provider must still reach the state-and-confirm path, never a silent grant");
});

// ── 2. the derivation ────────────────────────────────────────────────────────────────────────────────

test("staffDomainFor: still derives, now refuses, and keeps '' for what it could not parse", () => {
  // UNCHANGED for the two shapes that were always right.
  assert.equal(staffDomainFor("svc-runner@localhost"), "localhost");
  assert.equal(staffDomainFor("alex@example-firm.com"), "example-firm.com");
  assert.equal(staffDomainFor("Alex@Example-Firm.com"), "example-firm.com");

  // AN ABSENCE IS NOT A REFUSAL. `""` means nothing was classified; throwing here would turn "this is
  // not an address" into "this domain is forbidden", and the caller already refuses a non-address one
  // line earlier with a better sentence.
  assert.equal(staffDomainFor("nonsense"), "");
  assert.equal(staffDomainFor(undefined), "");
  assert.equal(staffDomainFor(""), "");

  for (const email of ["someone@gmail.com", "mn@example.com", "ops@outlook.com"]) {
    assert.throws(() => staffDomainFor(email), StaffDomainRefused,
      `${email} would have become a staff rule about everyone at its domain`);
  }
  try { staffDomainFor("someone@gmail.com"); assert.fail("expected a refusal"); }
  catch (e) {
    assert.equal(e.domain, "gmail.com", "the error carries the domain, so a caller can report it without re-parsing");
    assert.match(e.message, /gmail\.com/);
  }
});

// ── 3. the shipped command ───────────────────────────────────────────────────────────────────────────

/**
 * Drive the REAL `clearotron start` in a HOME of its own and read what it said.
 *
 * `--user` is the shortest path to the line under test; `PORTAL_LOCAL_USER` in the environment file
 * reaches it identically and is how the reported install got there. `handRunEnv` is what makes the
 * command read that file at all (see drive-env.mjs).
 *
 * No port is bound and no unit is installed on the paths these arms take: the refusal under test is
 * decided above `markStateWritten()`, which the last arm checks rather than assumes.
 */
function driveStart(args, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "staff-domain-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  // EVERY DATA-DIRECTORY NAME IS CLEARED, and that is what makes the no-state assertion below mean
  // something. `handRunEnv` clears the two names that would stop the command reading its own file and
  // inherits the rest of this process's environment — so a `CLEAROTRON_REPORTS_DIR` in the developer's
  // shell would put the data plane outside this drive's HOME, and an arm checking that HOME holds
  // nothing would be checking a question it had moved out of range. An absence has to be an absence of
  // the thing, not of the place it was looked for.
  const env = handRunEnv({
    HOME: home, PORTAL_LOCAL_USER: undefined, PORTAL_STAFF_DOMAINS: undefined,
    CLEAROTRON_REPORTS_DIR: undefined, CLEAROTRON_WORK_DIR: undefined, CLEAROTRON_QUEUE_DIR: undefined,
    CLEAROTRON_OUTBOX_DIR: undefined, CLEAROTRON_RUN_LOCK_DIR: undefined, CLEAROTRON_ACCESS_FILE: undefined,
    ...extra,
  });
  const r = spawnSync(process.execPath, [START, ...args], { encoding: "utf8", timeout: 180_000, env });
  return { home, said: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status,
    clean: () => rmSync(home, { recursive: true, force: true }) };
}

test("start refuses to invent a staff rule about a real domain, and quotes the rule it would have made", () => {
  const d = driveStart(["--user", "alex@a-firm.example-tld"]);
  try {
    assert.notEqual(d.code, 0, `start accepted a real address and built a domain-wide grant from it:\n${d.said}`);
    assert.match(d.said, /a-firm\.example-tld/, "the refusal must name the domain it declined to grant");
    // THE RULE IN THE WORDS THE SCREEN USES. The whole defect was that the operator only ever met those
    // words afterwards, on the settings page, as a description of something already true.
    assert.match(d.said, /Anyone at a-firm\.example-tld/,
      "the refusal must show the rule in the form the settings page will later show it");
    assert.match(d.said, /every brand owner/, "…including what the rule actually permits");
    // AND THE THREE WAYS OUT, because a refusal with no next step is a dead end on a first install.
    assert.match(d.said, /@localhost/, "the one-machine form must be offered");
    assert.match(d.said, /PORTAL_STAFF_DOMAINS=a-firm\.example-tld/,
      "…and the exact line to write if the grant IS what they mean");
    assert.match(d.said, /clearotron install/, "…and the command that asks the question properly");

    // NOTHING HALF-MADE. The refusal is decided before `markStateWritten()`, so a refused start leaves
    // no `.env`, no data directories and no units. An arm that only read the message would pass on a
    // refusal that had already written the grant it was declining.
    const cfg = join(d.home, ".config", "clearotron");
    assert.ok(!existsSync(join(cfg, ".env")),
      "the refusal wrote an env file, so a grant it declined to make is on disk anyway");
    assert.ok(!existsSync(join(d.home, "trademark")) || readdirSync(join(d.home, "trademark")).length === 0,
      "the refusal created the data plane, so this run was not the no-state refusal it claims to be");
  } finally { d.clean(); }
});

test("start refuses a public provider outright — there is no yes that makes it right", () => {
  const d = driveStart(["--user", "someone@gmail.com"]);
  try {
    assert.notEqual(d.code, 0, `start granted staff to every gmail.com address:\n${d.said}`);
    assert.match(d.said, /gmail\.com/);
    assert.match(d.said, /public email provider/i);
    // NO CONFIRMATION IS OFFERED for this class, so the wide refusal's "write it down" line must not
    // appear: telling somebody how to grant gmail.com is worse than not answering.
    assert.doesNotMatch(d.said, /PORTAL_STAFF_DOMAINS=gmail\.com/,
      "the refusal handed the reader the line that grants the whole provider");
  } finally { d.clean(); }
});

test("an explicit PORTAL_STAFF_DOMAINS is a decision already made, and is not second-guessed", () => {
  // The operator typed it. This command does not overrule a written decision — including one the
  // classifier would refuse to derive, because deriving and being told are different acts.
  const d = driveStart(["--user", "alex@a-firm.example-tld"], { PORTAL_STAFF_DOMAINS: "a-firm.example-tld" });
  try {
    assert.doesNotMatch(d.said, /would make every address at/,
      `start refused a rule the operator had already written down:\n${d.said}`);
  } finally { d.clean(); }
});

test("the local-account default still starts with no question and no refusal", async () => {
  // THE TIGHTEST CONSTRAINT IN THIS CHANGE. Every fresh install takes this path, non-interactively, and
  // a fix that made it ask or refuse would break the product's first run.
  //
  // `start` is a supervisor: past the identity block it binds ports and runs until killed, so an arm
  // cannot simply let it finish. It is driven into a LATER refusal instead — a port this test holds —
  // which is the cheapest way to get a terminating run that has demonstrably passed the block under
  // test. Reaching the "signs in as" banner is the positive evidence; the absence of the refusal
  // sentences alone would also be satisfied by a command that died before it got there.
  const s = createServer(() => {});
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  const run = driveStart([], { PORTAL_SERVICE_PORT: String(port) });
  try {
    assert.match(run.said, /signs in as\s+\S+@localhost/,
      `the local-account default did not reach the banner, so this arm did not measure its subject:\n${run.said}`);
    assert.doesNotMatch(run.said, /would make every address at|public email provider|reserved for documentation/,
      `the local-account default reached a staff-domain refusal, which every first install would meet:\n${run.said}`);
    assert.match(run.said, /already in use/, "the drive was expected to end on the port this arm holds");
  } finally { run.clean(); await new Promise((r) => s.close(r)); }
});

// ── 3b. the wizard, driven ───────────────────────────────────────────────────────────────────────────

/**
 * Drive `askSignIn` with scripted answers and record what the reader was shown.
 *
 * The wizard refuses a non-terminal stdin, so its prompt loop is unreachable from a test through the
 * command itself. The loop was extracted behind an injected `io` for exactly the branch that matters —
 * a reader who pressed Enter at the grant question, and a rule that must therefore NOT be written.
 * Read as source it would have been green either way.
 */
function drive(answers, confirms) {
  const said = [];
  const asked = [];
  const io = {
    askValue: async (q, opts = {}) => { asked.push(q); const a = answers.shift(); return a === "" ? (opts.def ?? "") : a; },
    confirm: async (q, def = true) => { said.push(q); const c = confirms.shift(); return c === undefined ? def : c; },
    say: (s = "") => said.push(s), ok: (s) => said.push(s), info: (s) => said.push(s),
    warn: (s) => said.push(s), problem: (s) => said.push(s),
  };
  return { io, said, asked, text: () => said.join("\n") };
}

test("the wizard asks for the address and defaults to the local account, granting nothing", async () => {
  const d = drive([""], []);
  const out = await askSignIn(d.io, { localAccount: "operator", staffLabel: "Acme staff" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "operator@localhost" },
    "Enter must take the local-account form, and must not write a staff-domain rule of any kind");
  assert.ok(d.asked.some((q) => /Sign-in address/i.test(q)),
    "the wizard did not ask for the address, which is the half of this defect nobody was asked about");
  assert.equal(d.asked.length, 1, "the local-account default must cost the reader exactly one question");
});

test("a real domain is stated in the settings page's words, and Enter grants nothing", async () => {
  // THE BRANCH THIS SEAM EXISTS FOR. The reader typed a real address and then took the default at the
  // grant question. Nothing may be written: this wizard's header promises Enter takes the default, and
  // a default that granted a domain would be the original defect with a prompt drawn in front of it.
  const d = drive(["alex@a-firm.example-tld", ""], [false]);
  const out = await askSignIn(d.io, { localAccount: "operator", staffLabel: "Acme staff" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "operator@localhost" },
    "declining the grant still wrote a staff domain, or wrote the address it was told not to enrol");
  assert.match(d.text(), /Anyone at a-firm\.example-tld/,
    "the grant must be stated in the form the settings page will later show it");
  assert.match(d.text(), /every brand owner/, "…including what the rule actually permits");
  assert.match(d.text(), /nothing granted/, "…and a decline has to say so, or the reader cannot tell");
});

test("an explicit yes writes the address AND the rule, together", async () => {
  const d = drive(["alex@a-firm.example-tld"], [true]);
  const out = await askSignIn(d.io, { localAccount: "operator", staffLabel: "Acme staff" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "alex@a-firm.example-tld", PORTAL_STAFF_DOMAINS: "a-firm.example-tld" },
    "a confirmed grant must be written down as a setting — that is what stops `start` deriving it again");
});

test("the wizard re-asks rather than accepting a provider, a placeholder or a non-address", async () => {
  // Each of the three is answered and then corrected, so the loop is driven rather than described. The
  // final answer is the local-account form, which is also the way out the refusals point at.
  const d = drive(["someone@gmail.com", "mn@example.com", "not-an-address", ""], []);
  const out = await askSignIn(d.io, { localAccount: "operator", staffLabel: "Acme staff" });
  assert.deepEqual(out, { PORTAL_LOCAL_USER: "operator@localhost" });
  assert.equal(d.asked.length, 4, "the wizard accepted an address it should have sent back");
  assert.match(d.text(), /gmail\.com/);
  assert.match(d.text(), /example\.com/);
  assert.match(d.text(), /single email address/);
});

test("the wizard has ONE sign-in step, and it is this one", () => {
  // The arms above drive `askSignIn`. This is what keeps them about the product: a second copy of the
  // prompt inside `runCli`, or none at all, would leave every one of them true and the wizard silent.
  const src = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  const calls = [...src.matchAll(/await askSignIn\(/g)];
  assert.equal(calls.length, 1, `the wizard calls askSignIn ${calls.length} times — one call site, or these arms describe code nobody runs`);
  assert.match(src, /section\("Who signs in"\)/, "the step must be a named section the reader can see they are in");
  // AND ITS ANSWER REACHES THE FILE. `composeEnvBody` writes every key of `candidate`, so assigning the
  // returned object into it is the whole of the write — an arm that only counted the call would pass on
  // a return value nobody used.
  assert.match(src, /Object\.assign\(candidate, await askSignIn\(/,
    "askSignIn's answer must land in the candidate that becomes the .env, or the question was theatre");
});

// ── 4. the settings surface ──────────────────────────────────────────────────────────────────────────

test("staffRuleSource names the file THIS process read, and answers null when there is no rule", () => {
  const cli = "/install-root/config/clearotron/.env";
  const unit = "/install-root/units/.env";

  // No rule ⇒ no sentence. The row is not rendered at all in that case, and a source for a rule that
  // does not exist would be a claim about nothing.
  assert.equal(staffRuleSource({ value: "", envLoad: { reason: "read", applied: [], path: cli } }), null);
  assert.equal(staffRuleSource({ value: "   ", envLoad: null }), null);

  // READ FROM A FILE — the hand-run CLI shape. The loader applied the name, so the file is the answer.
  const fromFile = staffRuleSource({ value: "a-firm.ch",
    envLoad: { reason: "read", applied: ["PORTAL_STAFF_DOMAINS"], path: cli }, cliEnvFile: cli, unitEnvFile: unit });
  assert.equal(fromFile.name, "PORTAL_STAFF_DOMAINS");
  assert.match(fromFile.where, /\/install-root\/config\/clearotron\/\.env/);

  // STARTED BY SYSTEMD — the units are configured by their EnvironmentFile, and naming the CLI's file
  // here would send an operator to edit a file the service never reads. That is the exact failure
  // shared/env-local.mjs's `envFileRead` exists to prevent, and this arm holds it on this surface.
  const managed = staffRuleSource({ value: "a-firm.ch", envLoad: { reason: "service-managed", path: cli },
    cliEnvFile: cli, unitEnvFile: unit });
  assert.match(managed.where, /\/install-root\/units\/\.env/);
  assert.doesNotMatch(managed.where, /\.config\/clearotron/,
    "a service configured by its EnvironmentFile was pointed at the CLI's file instead");

  // HANDED OVER BY A SUPERVISOR — `clearotron start` gives its children an explicit environment with
  // the file read switched off. The honest answer names the command, not a file this process read.
  const supervised = staffRuleSource({ value: "a-firm.ch", envLoad: { reason: "opted-out", path: cli },
    cliEnvFile: cli, unitEnvFile: unit });
  assert.match(supervised.where, /command that started it/);
});

test("the access view carries the rule's source through to the screen", () => {
  const rule = { name: "PORTAL_STAFF_DOMAINS", where: "read from /install-root/config/clearotron/.env" };
  const v = accessView({ grants: { tenants: {} }, staffDomains: ["a-firm.ch"], staffRule: rule });
  assert.deepEqual(v.staffDomains, ["a-firm.ch"], "the existing field must keep its shape — three screens parse it");
  assert.deepEqual(v.staffRule, rule, "the rule's source has to reach the page, or the reader has no way to undo it");

  // ABSENT IS NOT AN ERROR. Every existing caller omits it, and the page states the rule alone rather
  // than naming a file it cannot vouch for.
  const legacy = accessView({ grants: { tenants: {} }, staffDomains: ["a-firm.ch"] });
  assert.equal(legacy.staffRule, null);
});
