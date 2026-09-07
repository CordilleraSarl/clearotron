// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the onboarding verb, and the things about it that fail SILENTLY.
//
// ── WHY THE FRAMEWORK BRANCHES ARE THREE ARMS AND NOT ONE ─────────────────────────────────────────
//
// The owner's ruling has three outcomes, not two: a framework SUPPLIED and good is used; one ABSENT
// falls back to the house default and says so; one BROKEN refuses by name and never falls back. A
// single "the framework resolved" arm is satisfied by all three while testing none of them — and the
// branch it would silently stop covering is the broken one, which is the branch that rates a client's
// matters under a framework nobody chose.
//
// ── WHY THE STORE IS AN AXIS ──────────────────────────────────────────────────────────────────────
//
// cost a round because every fixture in a browser check shared one assumption about
// the deployment, so the install that lacked it was not covered — it was invisible. The equivalent axis
// for a command that WRITES is the store: configured, configured-but-empty, and not configured at all.
// The last is the dangerous one, and in a direction testing the first two would never reveal: with no
// store configured, "add a brand owner" means writing a real client into the demo roster that ships
// inside this checkout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveFramework, buildProfile, assertRosterAccepts, parseArgs } from "../../bin/brandowner.mjs";
// Refusal and storeForAdd moved to shared/ when `project add` became the second caller (tracker
// issue 1911). These arms are unchanged, and their staying green IS the proof the move was
// behaviour-neutral — they already covered storeForAdd's three outcomes and its typo case.
import { Refusal, storeForAdd } from "../../shared/onboarding-store.mjs";
import { defaultWriteProfile } from "../profile-service.mjs";
import { DEFAULT_FRAMEWORK } from "../framework.mjs";
import { config } from "../driver.config.mjs";

// THE SAME RESOLVER PRODUCTION USES. The first draft of the command joined the repo root instead —
// `skills/...` is relative to the DRIVER's skills directory, and a deployment may serve it from a
// doctrine overlay — so it refused every valid framework on every install, and this arm is what said so.
const resolveSkill = (rel) => config.resolveSkillPath(rel);
const tmp = () => mkdtempSync(join(tmpdir(), "brandowner-"));
// THE HOUSE DEFAULT IS ALWAYS UNDERNEATH. `loadProfiles` layers the store OVER the bundled set and
// hard-fails when generic is missing from both, so a roster without it is not a state this product can
// reach — and every fixture below that omitted it was modelling an impossible deployment. It is in the
// fixture now because the command reads the house default's platforms from it: a bundle with no
// platforms does not load, so onboarding that did not set them wrote a store nothing could read.
const HOUSE = { key: "generic", name: "Generic default", platforms: ["amazon.com", "apps.apple.com"] };
const rosterOf = (obj) => () => new Map(Object.entries({ generic: HOUSE, ...obj }));

// `assert.throws` returns UNDEFINED. The first draft wrote `const e = assert.throws(...)` and then read
// `e.message` off undefined. That failed loudly here — but the same mistake written defensively, as
// `assert.match(e?.message ?? "", ...)`, passes while asserting nothing at all.
function refusalFrom(fn) {
  try { fn(); } catch (e) {
    assert.ok(e instanceof Refusal, `expected a Refusal, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail("expected a Refusal, nothing was thrown");
}

test("1945 the refusal helper fails when nothing throws — its own guard rail, driven", () => {
  // THE `assert.fail` INSIDE refusalFrom ONLY RUNS HERE. By construction it is unreachable while the
  // command is correct, and the coverage census is right that an assert site which never runs is
  // indistinguishable from an arm that stopped asserting. Baselining it would park a dead line in the
  // census forever; driving it once keeps the helper honest and the census truthful.
  assert.throws(() => refusalFrom(() => {}), /nothing was thrown/);
});

// ── THE STORE AXIS ─────────────────────────────────────────────────────────────────────────────────

test("1945 a configured store is where an add writes", () => {
  // A REAL DIRECTORY, because storeForAdd now checks the store is actually there. The first version of
  // this arm named a path that does not exist on any box, and it passed only while nothing looked.
  const store = tmp();
  assert.equal(storeForAdd({ situation: "overlay", inForce: store, store }), store);
});

test("1945 WITH NO STORE CONFIGURED, an add would write a real client into the shipped demo roster — refused by name", () => {
  const bundled = "/repo/driver/profiles";
  const e = refusalFrom(() => storeForAdd({ situation: "bundled-fallback", inForce: null, configured: null, store: bundled }));
  // Three things, because an operator who gets only one of them has to guess the other two: which
  // switch, what would have happened, and what to do instead.
  assert.match(e.message, /CLEAROTRON_CUSTOMERS_DIR/, "names the switch that is unset");
  assert.match(e.message, /demo/i, "says what the bundled directory IS — our fixtures, not an empty default");
  assert.match(e.message, /\/repo\/driver\/profiles/, "names the directory it would have written to");
  assert.match(e.message, /Set CLEAROTRON_CUSTOMERS_DIR/, "and what to do about it");
});

test("1945 a store set AFTER the process started is refused too — and for a different reason", () => {
  const e = refusalFrom(() => storeForAdd({ situation: "env-arrived-late", inForce: null, configured: "/srv/customers", store: "/repo/driver/profiles" }));
  assert.match(e.message, /\/srv\/customers/, "names the store the operator can see in their shell");
  assert.match(e.message, /NOT the store in force/i);
  // THE DISTINCTION IS THE POINT. Both are "no usable store" and the fixes are opposite: one is
  // "configure a store", the other is "you did — export it earlier". One message for both sends half
  // the readers to the wrong fix.
  assert.doesNotMatch(e.message, /is unset/, "does not tell an operator who DID configure a store that they did not");
});

// ── THE FRAMEWORK AXIS: three branches, three arms ─────────────────────────────────────────────────

test("1945 ABSENT framework — the house default is applied and NAMED, never silently", () => {
  const r = resolveFramework(undefined, { resolveSkill });
  assert.equal(r.path, DEFAULT_FRAMEWORK);
  assert.equal(r.source, "default", "the caller can tell a default from a choice — the output sentence depends on it");
});

test("1945 SUPPLIED framework — used as given, and reported as the client's own", () => {
  // The house deck is the one framework certain to exist in every checkout, so this asserts the
  // SUPPLIED path without a fixture deck that a later sweep could delete.
  const r = resolveFramework(DEFAULT_FRAMEWORK, { resolveSkill });
  assert.equal(r.path, DEFAULT_FRAMEWORK);
  assert.equal(r.source, "supplied",
    "explicitly choosing a framework is a CHOICE even when it names the same document as the default");
});

test("1945 BROKEN framework — refused BY NAME, and never quietly rated under the default", () => {
  const e = refusalFrom(() => resolveFramework("skills/prelim-search/no-such-framework.md", { resolveSkill }));
  assert.match(e.message, /no-such-framework\.md/, "names the document that is missing");
  assert.match(e.message, /Refusing rather than/, "and says why it is not falling back");
  assert.match(e.message, /mistake, not an absence/, "the ruling's own distinction, in the message");
});

test("1945 a framework whose manifest will not load is BROKEN, not absent", () => {
  // Injected, because the state asserted is "the deck is there and the sidecar is unusable" — one no
  // tracked fixture should be created to hold.
  const e = refusalFrom(() => resolveFramework(DEFAULT_FRAMEWORK, {
    resolveSkill,
    loadManifest: () => { throw new Error("framework_manifest_missing:whatever"); },
  }));
  assert.match(e.message, /will not load/);
  assert.match(e.message, /mistake, not an absence/);
});

test("1945 a path outside the shipped skills directory is refused before anything is read", () => {
  for (const bad of ["/etc/passwd", "skills/prelim-search/../../secrets.md", "framework.md", "skills/other/x.md"]) {
    const e = refusalFrom(() => resolveFramework(bad, { resolveSkill }));
    assert.match(e.message, /skills\/prelim-search/, `${bad} should be refused against the stated shape`);
  }
});

// ── THE FIELD THE SAVE PATH WOULD HAVE DELETED ─────────────────────────────────────────────────────

test("1945 the bundle carries frameworkPath in BOTH branches — the field a create through the service deletes", () => {
  for (const supplied of [undefined, DEFAULT_FRAMEWORK]) {
    const framework = resolveFramework(supplied, { resolveSkill });
    const profile = buildProfile({ key: "northwind", name: "Northwind Trading SA", domains: ["northwind.test"], platforms: HOUSE.platforms, framework });
    assert.equal(profile.frameworkPath, framework.path,
      "the ruling is that the tool SETS it — an absent field rates the same way today and loses the record of the decision");
  }
});

test("1945 the written file still has the framework after a real round-trip", () => {
  // preserveCodeOwned deletes frameworkPath whenever no profile exists on disk, which is every create.
  // This drives the writer the command actually uses and reads the bytes back, so a later refactor that
  // routes the verb through the service door reds here rather than in production.
  const store = tmp();
  const framework = resolveFramework(undefined, { resolveSkill });
  const profile = buildProfile({ key: "acme", name: "Acme SA", domains: ["acme.test"], platforms: HOUSE.platforms, framework });
  const { files } = defaultWriteProfile({ profileDir: store, key: "acme", profile, contextPack: null });
  const onDisk = JSON.parse(readFileSync(join(store, "acme.json"), "utf8"));
  assert.equal(onDisk.frameworkPath, DEFAULT_FRAMEWORK, "the framework survived the write");
  assert.ok(files.some((f) => f.endsWith("acme.json")));
});

// ── A BAD ADD MUST FAIL ONE CUSTOMER, NEVER THE DEPLOYMENT ────────────────────────────────────────

test("1945 an EMPTY configured store accepts the first brand owner", () => {
  const framework = resolveFramework(undefined, { resolveSkill });
  const profile = buildProfile({ key: "acme", name: "Acme SA", domains: ["acme.test"], platforms: HOUSE.platforms, framework });
  assert.doesNotThrow(() => assertRosterAccepts({ store: "/srv/customers", key: "acme", profile, loadProfiles: rosterOf({}) }));
});

test("1945 a key that already exists is refused — this command creates, it never overwrites", () => {
  const framework = resolveFramework(undefined, { resolveSkill });
  const profile = buildProfile({ key: "acme", name: "Acme SA", domains: [], platforms: HOUSE.platforms, framework });
  const e = refusalFrom(() => assertRosterAccepts({
    store: "/srv/customers", key: "acme", profile,
    loadProfiles: rosterOf({ acme: { key: "acme", name: "Acme, older" } }),
  }));
  assert.match(e.message, /already exists/);
});

test("1945 A COLLIDING DOMAIN IS REFUSED BEFORE THE WRITE — it stops the WHOLE roster loading, not just this one", () => {
  const framework = resolveFramework(undefined, { resolveSkill });
  const profile = buildProfile({ key: "acme", name: "Acme SA", domains: ["Shared.test"], platforms: HOUSE.platforms, framework });
  const e = refusalFrom(() => assertRosterAccepts({
    store: "/srv/customers", key: "acme", profile,
    loadProfiles: rosterOf({ zephyr: { key: "zephyr", matchDomains: ["shared.test"] } }),
  }));
  assert.match(e.message, /shared\.test/, "names the domain");
  assert.match(e.message, /zephyr/, "and who already claims it — the operator cannot fix this without knowing");
  assert.match(e.message, /WHOLE roster/, "and the blast radius, which is why it refuses before writing");
  assert.match(e.message, /nothing has been written/);
});

test("1945 the collision check is case-insensitive on the roster's side too", () => {
  const framework = resolveFramework(undefined, { resolveSkill });
  const profile = buildProfile({ key: "acme", name: "Acme SA", domains: ["shared.test"], platforms: HOUSE.platforms, framework });
  refusalFrom(() => assertRosterAccepts({
    store: "/s", key: "acme", profile,
    loadProfiles: rosterOf({ zephyr: { key: "zephyr", matchDomains: ["SHARED.TEST"] } }),
  }));
});

// ── THE PARSER, WHICH IS PART OF THE SAFETY ────────────────────────────────────────────────────────

test("1945 an unknown option is REFUSED rather than ignored", () => {
  // `--fraemwork skills/…` under a permissive parser onboards the client under the house default while
  // the operator believes they set theirs — a silent wrong answer on the one field this verb exists for.
  const e = refusalFrom(() => parseArgs(["acme", "--fraemwork", "skills/prelim-search/x.md"]));
  assert.match(e.message, /--fraemwork/, "names what was typed");
  assert.match(e.message, /--framework/, "and what exists");
});

test("1945 an option with no value is refused rather than swallowing the next flag", () => {
  refusalFrom(() => parseArgs(["acme", "--name", "--domains", "a.test"]));
});

test("1945 domains are split, trimmed and lower-cased", () => {
  const a = parseArgs(["acme", "--domains", " Acme.test , ACME.CO ,"]);
  assert.deepEqual(a.domains, ["acme.test", "acme.co"]);
});

// ── WHAT THE PAGE SAYS ABOUT THE FRAMEWORK, WHICH THIS RULING CHANGED ─────────────────────────────
//
// NOTHING PINNED THIS COMPUTATION BEFORE. Several tests pass a `custom` flag INTO downstream views, so
// they assert what a view does with the answer and never how the answer is reached — which is why
// changing it reddened nothing at all. The gap is the finding; these three arms close it.
//
// The verb above sets frameworkPath ALWAYS, per the owner's ruling. Read as "the field is set at all",
// custom is then true for every brand owner onboarded without a framework of their own, and the Brand
// profile page tells a lawyer: "Custom framework: House default — this brand owner's OWN framework
// rates every matter for them, in its own words." That box was rewritten once already for the inverse
// lie. Custom means NOT THE HOUSE DEFAULT — what the engine's run record has always meant, and what
// the word means to the person reading the page.

import { makeProfileService } from "../profile-service.mjs";
import { writeFileSync } from "node:fs";

const STAFF_IDENTITY = { email: "staff@example-firm.com" };

function serviceOver(profiles) {
  const dir = tmp();
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  for (const [key, p] of Object.entries(profiles)) writeFileSync(join(dir, `${key}.json`), JSON.stringify(p));
  return makeProfileService({ profileDir: dir, writeProfile: () => ({ files: [] }) });
}

test("1945 a brand owner with NO framework of their own is not called custom", async () => {
  const service = serviceOver({ acme: { name: "Acme", platforms: ["amazon.com"] } });
  const r = await service.route("GET", "/profiles/acme", STAFF_IDENTITY);
  assert.equal(r.status, 200);
  assert.equal(r.json.framework.path, DEFAULT_FRAMEWORK);
  assert.equal(r.json.framework.custom, false);
});

test("1945 A BRAND OWNER ONBOARDED ONTO THE HOUSE DEFAULT IS NOT CALLED CUSTOM EITHER — the arm this ruling needed", async () => {
  // Exactly what the verb writes when no framework is supplied: the default, explicitly. Under the old
  // reading this said custom:true and the page called the house deck "their own framework, in its own
  // words". Nothing existed to catch that.
  const service = serviceOver({ acme: { name: "Acme", platforms: ["amazon.com"], frameworkPath: DEFAULT_FRAMEWORK } });
  const r = await service.route("GET", "/profiles/acme", STAFF_IDENTITY);
  assert.equal(r.status, 200);
  assert.equal(r.json.framework.path, DEFAULT_FRAMEWORK);
  assert.equal(r.json.framework.custom, false,
    "an explicit house default is still the house default — the page must not call it this client's own");
});

test("1945 a brand owner with a framework of their own IS custom", async () => {
  // The capability has to survive the fix: this is the client whose page must say their matters are
  // NOT rated under the generic default.
  const own = "skills/prelim-search/risk-framework-aurora.md";
  const service = serviceOver({ acme: { name: "Acme", platforms: ["amazon.com"], frameworkPath: own } });
  const r = await service.route("GET", "/profiles/acme", STAFF_IDENTITY);
  assert.equal(r.status, 200);
  assert.equal(r.json.framework.path, own);
  assert.equal(r.json.framework.custom, true);
});

// ── THE COMMAND ITSELF, END TO END ────────────────────────────────────────────────────────────────
//
// EVERY ARM ABOVE DRIVES A PART. None of them drove `add()`, so the things that only exist in the whole
// — the order the refusals fire in, the sentence naming which framework was applied (which is the
// ruling's own requirement), the receipt row, and dry-run writing nothing — were unasserted. A refactor
// reordering the checks so the store refusal fires before the framework is ever reported would have
// passed all twenty.

import { add } from "../../bin/brandowner.mjs";
import { existsSync } from "node:fs";

const overlayOn = (dir) => ({ situation: "overlay", inForce: dir, store: dir, configured: dir });

test("1945 --dry-run writes nothing AND still says which framework would apply", async () => {
  const dir = tmp();
  const said = [];
  // THE FLAG IS THE SUBJECT. The first version of this arm was named for --dry-run and did not pass it,
  // so it asserted the ordinary write path under a name promising the opposite. Its own first assertion
  // is what said so.
  const r = await add(["acme", "--name", "Acme SA", "--domains", "acme.test", "--dry-run"],
    { resolution: overlayOn(dir), loadProfiles: rosterOf({}), out: (l) => said.push(l) });
  assert.equal(r.written, false);
  assert.equal(existsSync(join(dir, "acme.json")), false, "a dry run must not write the bundle");
  assert.ok(said.some((l) => /nothing was written/.test(l)));
  // THE RULING'S REQUIREMENT, asserted where an operator would read it. A dry run is the first thing
  // someone reaches for, and "which framework will this client be rated under" is the question it is
  // being asked.
  assert.ok(said.some((l) => l.includes(DEFAULT_FRAMEWORK) && /GENERIC DEFAULT/.test(l)),
    `the framework line must name the default and say it IS the default — said: ${JSON.stringify(said)}`);
});

test("1945 a real add writes the bundle, names the framework, and reports where doctor will find it", async () => {
  const dir = tmp();
  const said = [];
  const r = await add(["acme", "--name", "Acme SA", "--domains", "acme.test"],
    { resolution: overlayOn(dir), loadProfiles: rosterOf({}), out: (l) => said.push(l) });
  assert.equal(r.written, true);
  const onDisk = JSON.parse(readFileSync(join(dir, "acme.json"), "utf8"));
  assert.equal(onDisk.frameworkPath, DEFAULT_FRAMEWORK, "the field the service door would have deleted");
  assert.deepEqual(onDisk.matchDomains, ["acme.test"]);
  assert.ok(said.some((l) => /^wrote /.test(l)));
  assert.ok(said.some((l) => l.includes(DEFAULT_FRAMEWORK)), "the framework is named on a real add too");
  assert.ok(said.some((l) => /doctor will now resolve acme/.test(l)),
    "and the operator is told how to see it — the issue asked for what doctor would say");
});

test("1945 a supplied framework is reported as the client's own, not as the default", async () => {
  const dir = tmp();
  const said = [];
  await add(["acme", "--name", "Acme SA", "--framework", DEFAULT_FRAMEWORK],
    { resolution: overlayOn(dir), loadProfiles: rosterOf({}), out: (l) => said.push(l) });
  const line = said.find((l) => l.startsWith("framework:"));
  assert.match(line, /as supplied/, "a chosen framework is reported as a choice");
  assert.doesNotMatch(line, /GENERIC DEFAULT/, "and never described as the fallback the operator did not take");
});

test("1945 a BROKEN framework refuses BEFORE the bundle is written", async () => {
  // ORDER MATTERS, and only a whole-command arm can see it. If the write happened first, a refused
  // framework would leave a half-onboarded brand owner on disk rated under nothing anyone chose.
  const dir = tmp();
  let threw = null;
  try {
    await add(["acme", "--name", "Acme SA", "--framework", "skills/prelim-search/no-such-framework.md"],
      { resolution: overlayOn(dir), loadProfiles: rosterOf({}), out: () => {} });
  } catch (e) { threw = e; }
  assert.ok(threw instanceof Refusal, `expected a Refusal, got ${threw?.name}: ${threw?.message}`);
  assert.equal(existsSync(join(dir, "acme.json")), false, "nothing on disk after a refused framework");
});

test("1945 a store that does not exist is refused by name, not as a stack trace", async () => {
  // Measured before the check existed: this surfaced as `ENOENT: no such file or directory, scandir
  // '<path>'` — the raw error from the roster read, naming a path and nothing else. An operator with a
  // typo in the switch got a stack trace where a sentence belongs.
  const missing = join(tmp(), "not-created");
  const e = refusalFrom(() => storeForAdd({ situation: "overlay", inForce: missing, store: missing }));
  assert.match(e.message, /CLEAROTRON_CUSTOMERS_DIR/, "names the switch");
  assert.match(e.message, /no such directory/);
  assert.match(e.message, /typo/, "and offers the likely cause, because that is the fix");
});

// ── the refusal reaches the OPERATOR, not the debugger (, acceptance 2) ────────────
//
// SPAWNED, not called. The defect was never in the validation — `assertProfileKey` has always rejected
// a bad key with the right sentence. It was in the CLASS of what it threw: main() deliberately lets a
// non-Refusal keep its stack, because an unexpected throw there is a defect and hiding it costs the
// debug. A key an operator typed is not an unexpected throw, and answering a typo with a Node stack
// trace naming a line in driver/profiles.mjs is exactly what "refuses malformed input BY NAME" rules
// out. Only a real invocation can tell those two apart, so this one runs the command.

test("1945 a malformed key is a named refusal on stderr, not a stack trace", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: j } = await import("node:path");
  const root = j(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const store = mkdtempSync(join(tmpdir(), "brandowner-key-"));

  const run = spawnSync(process.execPath, [j(root, "bin", "brandowner.mjs"), "add", "Bad Key!", "--name", "X"], {
    encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CLEAROTRON_CUSTOMERS_DIR: store },
  });

  // FATE BEFORE TEXT. A refusal that wrote nothing is exit 1 — the same code this file already spends
  // on every other refusal, so a scripted caller cannot tell a typo from a crash by code alone and the
  // TEXT is what has to carry it.
  assert.equal(run.status, 1, `expected a refusal, got status ${run.status}\n${run.stderr}`);
  assert.match(run.stderr, /^brandowner: /m, "the command names itself, the way its other refusals do");
  assert.match(run.stderr, /must be a lowercase slug/, "and states what was wrong with the key");

  // THE ACTUAL REGRESSION. Every one of these is a stack trace's fingerprint, and the point of the fix
  // is that none of them reaches an operator who mistyped a name.
  assert.doesNotMatch(run.stderr, /\bat \w+ \(/, "no stack frames");
  assert.doesNotMatch(run.stderr, /driver\/profiles\.mjs/, "no internal file path");
  assert.doesNotMatch(run.stderr, /Node\.js v/, "no Node version banner");
});
