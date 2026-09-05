// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Turning the client door on: what it refuses, what it says, and what it must never write down.
//
//, owner rulings 2026-08-31 ("On demand is fine", then "One press does all of it,
// invisibly… No second step"). The fence stays off at install and this is what turns it on.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientDoorState, clientDoorPort, clientDoorAddress, describeDoorState,
  enablePlan, applyEnablePlan, describeChange, setEnvValue, CLIENT_DOOR_UNIT,
} from "../../shared/client-door.mjs";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ensureDenylistFile } from "../../shared/client-door.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
const NO_CORPUS = skipReason("2191-F14 denylist path has one owner");
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// NOT A HOME DIRECTORY. `` refuses any executable line naming a specific operator's home, and it
// is right to: a path like that is one copy-paste from being a real person's box in a real command.
// The fake filesystem below does not care what the key is called.
const ENV_PATH = "/dev/null/env-file-for-a-fake-filesystem";

const STARTED = { TRADEMARK_MCP_TOKEN_SECRET: "s", CLEAROTRON_ACCESS_FILE: "/srv/grants.json" };
const plan = (over = {}) => enablePlan({ env: STARTED, address: "http://127.0.0.1:18811",
  identity: "lawyer@acme.example", checkoutDir: "/opt/clearotron", ...over });

const io = (files = {}) => {
  const wrote = { ...files }; const log = []; const KEY = "issued-account-key-value";
  return {
    wrote, log, KEY,
    envPath: ENV_PATH,
    readEnv: (p) => wrote[p] ?? "",
    writeEnv: (p, t) => { wrote[p] = t; },
    installUnit: (n) => log.push(`install ${n}`),
    startUnit: (n) => log.push(`start ${n}`),
    mint: () => KEY,
    onStep: (w) => log.push(`step ${w}`),
  };
};

test("THE DOOR IS STANDING ONLY WHEN BOTH HALVES ARE — either alone is a door that does not work", () => {
  const unitDir = "/u";
  const has = (p) => p === `${unitDir}/${CLIENT_DOOR_UNIT}`;
  const none = () => false;
  assert.equal(clientDoorState({ env: { CLIENT_MCP_ACCOUNT_ACCESS: "1" }, unitDir, exists: has }).standing, true);
  // The fence on with nothing listening is a setting with no server; the unit running with the fence off
  // accepts no account key. Reporting "standing" on either would send a reader to paste at nothing.
  assert.equal(clientDoorState({ env: { CLIENT_MCP_ACCOUNT_ACCESS: "1" }, unitDir, exists: none }).standing, false);
  assert.equal(clientDoorState({ env: {}, unitDir, exists: has }).standing, false);
  assert.equal(clientDoorState({ env: { CLIENT_MCP_ACCOUNT_ACCESS: "0" }, unitDir, exists: has }).standing, false);
});

test("THE CLIENT DOOR'S PORT IS NOT THE ENGINE DOOR'S", () => {
  // The defect this is named for: Cowork was about to be handed 18790, the engine door, which refuses an
  // account key outright. A door that answers and then rejects the key is worse than no address at all.
  assert.equal(clientDoorPort({}), 18811);
  assert.notEqual(clientDoorPort({}), 18790);
  assert.equal(clientDoorAddress({ CLIENT_MCP_HTTP_PORT: "19000" }), "http://127.0.0.1:19000");
  assert.throws(() => clientDoorPort({ CLIENT_MCP_HTTP_PORT: "nope" }), /not a port number/);
});

test("EACH precondition refuses on its own — not just all three missing at once", () => {
  // A UNIFORM FIX carries the defect where ONE MEMBER differs: asserting only the empty-env case would
  // pass while any single precondition was silently ignored.
  assert.equal(plan().possible, true, "a started install with an identity can enable the door");
  const cases = [
    ["no secret", { env: { CLEAROTRON_ACCESS_FILE: "/g" } }, /no token secret/],
    ["no access file", { env: { TRADEMARK_MCP_TOKEN_SECRET: "s" } }, /no access file/],
    ["no identity", { identity: null }, /must name whose it is/],
  ];
  for (const [name, over, why] of cases) {
    const p = plan(over);
    assert.equal(p.possible, false, `${name} should refuse`);
    assert.equal(p.blockers.length, 1, `${name} should name exactly its own blocker, got: ${p.blockers.join("; ")}`);
    assert.match(p.blockers[0].why, why);
    assert.ok(p.blockers[0].fix?.length > 20, `${name} refuses without saying what would change THAT`);
  }
});

test("an impossible plan is refused WHOLE — never half-applied", () => {
  // The state to design against is the fence on with nothing listening: a reader then pastes an address
  // at nothing and reads the refusal as the product being broken. Reachable only by a caller that
  // pressed on past the blockers, so this refuses before the first effect.
  const i = io();
  assert.throws(() => applyEnablePlan(plan({ identity: null }), i), /cannot be enabled here/);
  assert.deepEqual(i.log, [], "an impossible plan did work before refusing");
  assert.deepEqual(Object.keys(i.wrote), [], "an impossible plan wrote to disk");
});

test("a mint that returns nothing is an ABSENCE, not a door that is ready", () => {
  const i = { ...io(), mint: () => "" };
  assert.throws(() => applyEnablePlan(plan(), i), /no credential to hand over/);
});

test("THE KEY IS RETURNED AND WRITTEN NOWHERE", () => {
  // Possession is the credential. A key that reached the progress log would be in every journal on the
  // box; one that reached the env file would be on disk in clear, forever.
  const i = io({ ENV_PATH: "CLIENT_MCP_ACCOUNT_ACCESS=0\n" });
  const r = applyEnablePlan(plan(), i);
  assert.equal(r.key, i.KEY, "the caller gets the key back — it has nowhere else to come from");
  for (const line of i.log) assert.ok(!line.includes(i.KEY), `the key reached the progress log: ${line}`);
  for (const [p, text] of Object.entries(i.wrote)) assert.ok(!text.includes(i.KEY), `the key was written to ${p}`);
  assert.match(i.wrote[ENV_PATH], /^CLIENT_MCP_ACCOUNT_ACCESS=1$/m, "the fence was flipped, not appended beside itself");
  // TOKEN-ONLY IS WHAT MAKES THE DOOR STARTABLE ON A LOCAL INSTALL, and it was missing until the verb
  // was driven: without it the door demands an OIDC audience and a Cloudflare Access team, refuses to
  // start fail-closed, and crash-loops while the fence sits on and a key has been handed out.
  assert.match(i.wrote[ENV_PATH], /^CLIENT_MCP_TOKEN_ONLY=1$/m, "the API-key door was never turned on");
  // The port and the allow-list are derived from ONE number: a door whose allow-list names a different
  // port than it listens on starts cleanly and turns every request away.
  const port = /^CLIENT_MCP_HTTP_PORT=(\d+)$/m.exec(i.wrote[ENV_PATH])?.[1];
  assert.ok(port, "no port was written");
  assert.match(i.wrote[ENV_PATH], new RegExp(`^CLIENT_MCP_ALLOWED_HOSTS=127\\.0\\.0\\.1:${port},localhost:${port}$`, "m"),
    "the allow-list and the listening port disagree — the door would refuse every request");
  assert.ok(i.log.includes(`install ${CLIENT_DOOR_UNIT}`) && i.log.includes(`start ${CLIENT_DOOR_UNIT}`));
});

test("setEnvValue REPLACES an explicit value — which mergeEnvFile deliberately will not", () => {
  // `bin/start.mjs`'s mergeEnvFile never overwrites, because a hand-set value must win over a generated
  // one on a command that runs every start. This runs once, because a reader chose this assistant, and
  // the install that most needs changing is exactly the one whose file already says 0.
  const r = setEnvValue("A=1\nCLIENT_MCP_ACCOUNT_ACCESS=0\nB=2\n", "CLIENT_MCP_ACCOUNT_ACCESS", "1");
  assert.equal(r.action, "replaced");
  assert.equal(r.text, "A=1\nCLIENT_MCP_ACCOUNT_ACCESS=1\nB=2\n");
  const added = setEnvValue("A=1\n", "CLIENT_MCP_ACCOUNT_ACCESS", "1");
  assert.equal(added.action, "added");
  assert.match(added.text, /^CLIENT_MCP_ACCOUNT_ACCESS=1$/m);
  // Already correct: no rewrite, and it says so rather than claiming a change it did not make.
  assert.equal(setEnvValue("CLIENT_MCP_ACCOUNT_ACCESS=1\n", "CLIENT_MCP_ACCOUNT_ACCESS", "1").changed, false);
});

test("the change is described in the tense of the moment, from ONE author", () => {
  const p = plan();
  const after = describeChange(p, { applied: true });
  const ahead = describeChange(p, { applied: false });
  assert.notDeepEqual(after, ahead, "both moments produced the same words — one of them is now false");
  assert.ok(after.every((l) => !/would/.test(l)), "a future tense survived into the after-the-fact report");
  assert.ok(ahead.some((l) => /would/.test(l)), "the dry-run report claims a change it did not make");
  for (const set of [after, ahead]) {
    assert.ok(set.join(" ").includes("127.0.0.1:18811"), "the reader is not told which door opened");
    assert.ok(set.some((l) => /nothing/i.test(l) && /internet/.test(l)), "the fear is never answered");
    // WHAT IS NOT SAID is as deliberate as what is: no flag name, no scope, no token.
    for (const word of ["CLIENT_MCP_ACCOUNT_ACCESS", "token", "scope", "MCP"]) {
      assert.ok(!set.join(" ").includes(word), `the reader was shown "${word}"`);
    }
  }
  assert.deepEqual(describeChange(plan({ identity: null }), { applied: true }), [], "an impossible plan describes nothing");
});

test("AN OCCUPIED PORT refuses — a socket answering there is not proof it is yours", () => {
  // Measured 2026-08-31 on a shared box: 18811 was held by another user's client face. The unit was
  // installed, started, and crash-looped, while `ss` showed something listening on the expected port and
  // the verb reported the door was up. The port answered; it was never ours.
  const p = plan({ portIsFree: () => false });
  assert.equal(p.possible, false);
  assert.match(p.blockers[0].why, /already in use/);
  // The remedy must answer THIS finding, not the plan's most common one.
  assert.match(p.blockers[0].fix, /CLIENT_MCP_HTTP_PORT/);
  assert.doesNotMatch(p.blockers[0].fix, /clearotron start/);
  // And the falsification: the same plan with the port free is possible, so the refusal is a
  // MEASUREMENT of the machine rather than a branch that always refuses.
  assert.equal(plan({ portIsFree: () => true }).possible, true);
});

test("THE CHECKOUT PATH IS WRITTEN, not demanded — the error is avoided rather than refused", () => {
  // systemd expands an unset ${CLEAROTRON_CHECKOUT_DIR} to nothing rather than failing, so the unit
  // would install, start, and die: fence on, key issued, door dead. Driving the verb found exactly that.
  //
  // The caller is running out of the checkout, so the value is WRITTEN from what it already knows rather
  // than demanded from the environment. Refusing here would have been the product declining over a fact
  // it was holding — and it would have added a governed variable to the product's surface for a value
  // nothing needed to configure.
  assert.equal(plan().settings.CLEAROTRON_CHECKOUT_DIR, "/opt/clearotron");
  // A caller that supplies nothing is a defect in the caller, and still may not half-open a door.
  const p = enablePlan({ env: STARTED, address: "http://127.0.0.1:18811", identity: "a@b.c" });
  assert.equal(p.possible, false);
  assert.match(p.blockers[0].why, /where this checkout lives/);
});

test("STARTING IS NOT RUNNING — a door that exits leaves no key behind", () => {
  const i = io();
  let minted = false;
  const dead = { ...i, unitIsHealthy: () => false, mint: () => { minted = true; return i.KEY; } };
  assert.throws(() => applyEnablePlan(plan(), dead), /started but is not running/);
  assert.equal(minted, false, "a key was issued against a door that never came up");
  // And the falsification: the same plan through a door that DID come up completes.
  const alive = { ...io(), unitIsHealthy: () => true };
  assert.equal(applyEnablePlan(plan(), alive).key, i.KEY);
  // A caller with no probe at all still works — the check is opt-in, not a new required dependency.
  assert.equal(applyEnablePlan(plan(), io()).key, i.KEY);
});

test("AN UNENROLLED IDENTITY is refused — a key that opens the door and 403s is not a connection", () => {
  // Measured end to end on 2026-08-31: the key authenticated (401 without it, past auth with it) and
  // every request then returned 403 "this identity is not granted any account". A fresh install has an
  // empty grants file, so this was the DEFAULT outcome of connecting on a new box — the owner's own
  // complaint reproduced, with a key in his hand making him think he was finished.
  const p = plan({ grantedAccounts: [] });
  assert.equal(p.possible, false);
  assert.match(p.blockers[0].why, /not enrolled/);
  assert.match(p.blockers[0].fix, /clearotron grant/);
  // The three ways an identity DOES have reach, none of which may refuse.
  assert.equal(plan({ grantedAccounts: "*" }).possible, true, "a wildcard grant is full reach");
  assert.equal(plan({ grantedAccounts: ["acme"] }).possible, true, "a named account is reach");
  assert.equal(plan({ grantedAccounts: null }).possible, true, "no grants file at all is unrestricted, per accountsForEmail");
  // NOT LOOKING is not the same as looking and finding nothing — but it is also not this function's
  // place to invent a grants file, so an absent fact passes here and the caller is what must look.
  assert.equal(plan({}).possible, true);
});

// ══ The mirror half: the ledger, the closure, and the denylist that must exist ══

import {
  recordConnectKey, recordedKeysFor, removeRecordedKeys, connectKeyReport,
  disablePlan, revokeEveryonePlan, applyDisablePlan, describeClosure,
} from "../../shared/client-door.mjs";

test("2082: connect ARMS a denylist path when the env has none, and keeps the env's own when it has one", () => {
  // Measured on production (owner, 2026-08-31): no denylist configured anywhere, and isRevoked() fails
  // open on an unset path — a connect that assumed one made every issued key unrevokable, silently.
  const armed = plan({ denylistPath: "/var/lib/clearotron/denylist" });
  assert.equal(armed.settings.TRADEMARK_MCP_TOKEN_DENYLIST, "/var/lib/clearotron/denylist");
  assert.equal(armed.denylistPath, "/var/lib/clearotron/denylist");
  assert.ok(armed.steps.some((s) => s.id === "denylist"), "the plan says it arms the list");
  // An env that already names one wins — the running verifiers were born with that path.
  const kept = plan({ env: { ...STARTED, TRADEMARK_MCP_TOKEN_DENYLIST: "/srv/keep" }, denylistPath: "/var/new" });
  assert.equal(kept.settings.TRADEMARK_MCP_TOKEN_DENYLIST, undefined, "an existing path is not rewritten");
  assert.equal(kept.denylistPath, "/srv/keep");
  // No path from anywhere: the plan proceeds (old behaviour) and SAYS it armed nothing.
  assert.equal(plan().denylistPath, null);
});

test("2082: applyEnablePlan ensures the denylist FILE before the door starts", () => {
  const fake = io();
  const p = plan({ denylistPath: "/var/lib/clearotron/denylist" });
  const ensured = [];
  applyEnablePlan(p, { ...fake, ensureDenylist: (path) => { ensured.push(path); fake.log.push("ensure denylist"); } });
  assert.deepEqual(ensured, ["/var/lib/clearotron/denylist"]);
  // BEFORE the unit: a door born before the file exists starts life failing open on revocations.
  assert.ok(fake.log.indexOf("ensure denylist") < fake.log.indexOf(`install ${CLIENT_DOOR_UNIT}`),
    `the file must exist before the door starts (saw: ${fake.log.join(" | ")})`);
});

test("2082: the ledger records IDS and never the credential — the planted token does not survive", () => {
  const g = recordConnectKey({ tenants: { t: { accounts: "*", users: {} } } },
    { jti: "abc123", sub: "lawyer@acme.example", client: "cowork", exp: 1900000000,
      // THE PLANT: a confused caller hands the whole spec, token included. The row build is a closed
      // set, so the credential must not reach the file whatever the caller passes.
      token: "v1.this-is-the-credential.sig" });
  const text = JSON.stringify(g);
  assert.ok(!text.includes("v1.this-is-the-credential"), "the token value reached the ledger");
  assert.ok(text.includes("abc123"), "the revocation handle is recorded");
  assert.deepEqual(g.tenants, { t: { accounts: "*", users: {} } }, "the tenants rows are untouched");
  // A record that cannot revoke, or cannot be attributed, is refused rather than half-written.
  assert.throws(() => recordConnectKey({}, { sub: "x@y" }), /no jti/);
  assert.throws(() => recordConnectKey({}, { jti: "j" }), /whose key/);
});

test("2082: recordedKeysFor / removeRecordedKeys round-trip, scoped to the identity", () => {
  let g = recordConnectKey({ tenants: {} }, { jti: "j1", sub: "a@x", exp: 1900000000 });
  g = recordConnectKey(g, { jti: "j2", sub: "b@x" });
  assert.deepEqual(recordedKeysFor(g, "a@x").map((r) => r.jti), ["j1"]);
  const after = removeRecordedKeys(g, ["j1"]);
  assert.deepEqual(recordedKeysFor(after, "a@x"), [], "the struck record is gone");
  assert.deepEqual(recordedKeysFor(after, "b@x").map((r) => r.jti), ["j2"], "the other identity's record survives");
});

test("2082: connectKeyReport judges by the verifier's own pieces — valid, expired, revoked", () => {
  const NOW = Date.parse("2026-08-31T12:00:00Z");
  let g = recordConnectKey({ tenants: {} }, { jti: "live", sub: "a@x", exp: Math.floor(NOW / 1000) + 3600 });
  g = recordConnectKey(g, { jti: "old", sub: "a@x", exp: Math.floor(NOW / 1000) - 60 });
  g = recordConnectKey(g, { jti: "dead", sub: "a@x", exp: Math.floor(NOW / 1000) + 3600 });
  const rep = connectKeyReport(g, { now: NOW, revoked: (jti) => jti === "dead" });
  const by = Object.fromEntries(rep.rows.map((r) => [r.jti, r.state]));
  assert.deepEqual(by, { live: "valid", old: "expired", dead: "revoked" });
  assert.equal(rep.valid, 1);
});

const DOOR_OPEN = { env: { CLIENT_MCP_ACCOUNT_ACCESS: "1", TRADEMARK_MCP_TOKEN_DENYLIST: "/srv/deny" },
  unitDir: "/u", exists: (p) => p === `/u/${CLIENT_DOOR_UNIT}` };

test("2148 Q3: a person with no key is told so — and the test is the PERSON, not the door", () => {
  // ── SUPERSEDED 2026-09-03, rewritten rather than deleted ────────────────────────────────────────
  //
  // This asserted "disconnect on a door that is not open says so plainly", which was 2082's acceptance
  // line and was right while the door existed only because a reader had asked for it.
  //
  // Its OLD TEST — `!fenceOn && !unitInstalled && !jtis.length` — can no longer fire at all: since the
  // auto-start ruling both door halves are true on every installed box, so a reader with no key would
  // have been handed a closure plan for a door nobody was going to touch. The nothing-to-do question is
  // now about the person, and this arm drives it on an OPEN door to prove that.
  const p = disablePlan({ ...DOOR_OPEN, identity: "a@x", recorded: [] });
  assert.equal(p.possible, false);
  assert.equal(p.nothingOpen, true);
  assert.match(p.says.join(" "), /nothing to revoke/i, "it does not say there is nothing to revoke");
  assert.match(p.says.join(" "), /stays up/i,
    "it does not say the connector stays up — a reader could leave believing they closed something");
  assert.throws(() => applyDisablePlan(p, {}), /nothing to revoke/);
});

test("2148 Q3: disconnect revokes the key and TOUCHES NOTHING ELSE — no unit, no fence", () => {
  // ── SUPERSEDED 2026-09-03, and this is the arm the ruling is about ──────────────────────────────
  //
  // It used to require the step list `["revoke", "unit", "fence", "ledger"]` and to assert
  // `CLIENT_MCP_ACCOUNT_ACCESS=0` in the env afterwards. Both were correct while starting the door was
  // the consent. Q3, verbatim: *"it revokes YOUR key and nobody else notices … Neither stops the
  // service."* The fence is the WHOLE INSTALL's account access, so turning it off was one person
  // disconnecting everybody — and the unit removal deleted a door the installer re-places.
  //
  // What survives is 2082's own finding, which the new ruling does not touch: the key OUTLIVES the
  // door, so revocation leads and the ledger strike trails the denylist write.
  const p = disablePlan({ ...DOOR_OPEN, identity: "a@x", recorded: [{ jti: "j1" }, { jti: "j2" }] });
  assert.equal(p.possible, true);
  assert.deepEqual(p.steps.map((s) => s.id), ["revoke", "ledger"],
    "the plan still orders an act beyond revoking this person's key");
  const calls = [];
  let env = "";
  applyDisablePlan(p, {
    envPath: "/dev/null/env",
    readEnv: () => env,
    writeEnv: (_, t) => { env = t; calls.push("env"); },
    appendDenylist: (path, jtis) => calls.push(`deny ${path} ${jtis.join(",")}`),
    // PRESENT AND EXPECTED NEVER TO BE CALLED. Asserting on a seam the applier no longer knows about is
    // how a deleted behaviour comes back unnoticed: if some future caller re-adds a `unit` step, this
    // fails here rather than on a box.
    removeUnit: (u) => calls.push(`remove ${u}`),
    strikeRecords: (jtis) => calls.push(`strike ${jtis.join(",")}`),
  });
  assert.equal(calls[0], "deny /srv/deny j1,j2", "the denylist write is the first effect");
  assert.ok(calls.indexOf("strike j1,j2") > 0, "the ledger strike did not follow the denylist write");
  assert.ok(!calls.some((c) => c.startsWith("remove ")),
    `disconnect removed the unit — the installer re-places it, so this cuts colleagues off until the next install (${calls.join(" | ")})`);
  assert.doesNotMatch(env, /CLIENT_MCP_ACCOUNT_ACCESS/,
    "disconnect wrote the account-access fence — that is the whole install's setting, and turning it off is everybody's problem");
  const said = describeClosure(p, { applied: true }).join(" ");
  assert.match(said, /keeps running/i, "the words do not say the connector stays up");
  assert.doesNotMatch(said, /stopped and removed|access is off/i,
    "the closing words still describe a teardown that no longer happens");
});

test("2082: an install whose env never named a denylist gets one ARMED LATE, and the words say what that cannot do", () => {
  // A pre-2082 connect or a hand-built box: the running door was born without the variable, so a write
  // to the new file revokes nothing that is already up. The plan still arms it (the next start consults
  // it) and the sentence says the limit out loud rather than letting the reader believe otherwise.
  const p = disablePlan({ env: { CLIENT_MCP_ACCOUNT_ACCESS: "1" }, unitDir: "/u",
    exists: (q) => q === `/u/${CLIENT_DOOR_UNIT}`, identity: "a@x",
    recorded: [{ jti: "j1" }], denylistPath: "/srv/late-arm/token-denylist" });
  assert.equal(p.lateArm, true);
  assert.match(describeClosure(p, { applied: true }).join(" "), /only armed now/i);
  // And the apply NAMES the path in the env, so the next start is born consulting it.
  let env = "";
  applyDisablePlan(p, {
    envPath: "/dev/null/env", readEnv: () => env, writeEnv: (_, t) => { env = t; },
    appendDenylist: () => {}, removeUnit: () => {}, strikeRecords: () => {},
  });
  assert.match(env, /TRADEMARK_MCP_TOKEN_DENYLIST=\/srv\/late-arm\/token-denylist/);
});

test("2148 Q3: --everyone states BOTH counts before acting, and still leaves the service up", () => {
  // The admin act the ruling names: "a separate, deliberate admin act with its own name that states how
  // many people it affects before acting." Two counts, because five keys held by one person and five
  // keys held by five people are the same number and not the same act.
  const grants = { tenants: {}, connectKeys: {
    j1: { sub: "a@x" }, j2: { sub: "a@x" }, j3: { sub: "b@x" },
  } };
  const p = revokeEveryonePlan({ env: {}, grants, denylistPath: "/srv/deny" });
  assert.equal(p.possible, true);
  assert.deepEqual(p.jtis.sort(), ["j1", "j2", "j3"], "not every issued key is named");
  assert.deepEqual(p.people.sort(), ["a@x", "b@x"], "the people are not counted, so the size cannot be stated");
  const said = p.says.join(" ");
  assert.match(said, /3 issued key/, "the number of keys is not said before acting");
  assert.match(said, /2 people/, "the number of PEOPLE is not said — the count that makes this a different act");
  assert.match(said, /connector itself keeps running/i, "it implies the service stops, which Q3 forbids");
  assert.ok(!p.steps.some((s) => s.id === "unit" || s.id === "fence"),
    "the admin act tears something down — Q3: NEITHER revocation path stops the service");
  // Nothing to cut is its own answer, not a plan over an empty set.
  const none = revokeEveryonePlan({ env: {}, grants: { tenants: {} }, denylistPath: "/srv/deny" });
  assert.equal(none.possible, false);
  assert.match(none.says.join(" "), /nobody to cut off/i);
});

test("2148 Q3: a revocation with no denylist anywhere SAYS the keys stay live", () => {
  // An absence is a finding. With no path configured the ids have nowhere to go, so reporting a
  // revocation would be the exact "every check looked done" that connect-time arming exists to prevent.
  const p = disablePlan({ env: { CLIENT_MCP_ACCOUNT_ACCESS: "1" }, unitDir: "/u",
    exists: () => true, identity: "a@x", recorded: [{ jti: "j1" }], denylistPath: null });
  assert.equal(p.denylistPath, null);
  assert.match(describeClosure(p, { applied: true }).join(" "), /stay live/i,
    "a revocation with nowhere to write the id reported itself as done");
  // And the ledger is NOT struck, or the record of a live key disappears.
  const calls = [];
  applyDisablePlan(p, { envPath: "/dev/null/env", readEnv: () => "", writeEnv: () => {},
    appendDenylist: () => calls.push("deny"), strikeRecords: () => calls.push("strike") });
  assert.ok(!calls.includes("strike"),
    "the record of a key that is still live was struck — the key survives with nothing naming it");
});

test("2082: a secret in the shell but not in the unit's env file is refused AT PLAN TIME", () => {
  // Found by driving connect: the shell-exported secret satisfied every check, the unit read ~/.env,
  // and the door died at birth. The health probe refused before a key was issued — right — but nothing
  // named the cause until the journal. The plan names it now, with the remedy.
  const p = plan({ unitEnvHasSecret: false });
  assert.equal(p.possible, false);
  assert.match(p.blockers.map((b) => b.why).join(" "), /NOT in the env file the door reads/);
  assert.equal(plan({ unitEnvHasSecret: true }).possible, true);
  // `undefined` = the caller did not look; a pure function does not invent a filesystem read.
  assert.equal(plan().possible, true);
});

// ──, wired 2026-09-03 — CONFIGURED IS NOT RUNNING ───────────
//
// `describeDoorState` shipped with NO CALLER. Nothing in `bin/` or `driver/` read it, and nothing here
// drove it either — so the four-state split existed as text while `doctor` went on printing the three
// sentences it replaces. A function nobody calls and nobody tests is not a fix; it is a description of
// one. These arms drive the states, and the last one drives the surface.

const DOOR = (over = {}) => ({ standing: true, fenceOn: true, unitInstalled: true, active: null, serving: false, ...over });

test("2145 CONFIGURED IS NOT RUNNING — the state a half-applied connect leaves is a PROBLEM, not an 'on'", () => {
  // The measured defect, in the words it was measured in: a `connect` that died at `daemon-reload` had
  // already written the fence and placed both units, and doctor said "the client door is on" over a unit
  // that was inactive with nothing listening. Every angle read as configured, because configured was all
  // anything asked.
  const down = describeDoorState(DOOR({ active: false }));
  assert.equal(down.level, "problem", "a door that is installed, fenced and NOT RUNNING reported as anything but a problem");
  assert.match(down.text, /NOT RUNNING/, "the sentence must name the half that is wrong");
  assert.match(down.text, /connect/, "and the remedy, or the reader has a diagnosis and no action");

  const up = describeDoorState(DOOR({ active: true }));
  assert.equal(up.level, "ok", "a door that IS running must not read as a problem — or the rule is noise");
  assert.notEqual(down.text, up.text, "running and not-running produced the same sentence");
});

test("2145 NOBODY ASKED is a third answer — a door whose runtime was not measured is not a door that is down", () => {
  // `active: null` is the state of a caller that cannot reach systemd — the very shell that produced the
  // measured defect. Reporting that as down is the same lie in the other direction.
  const unknown = describeDoorState(DOOR({ active: null }));
  assert.equal(unknown.level, "info", "an unmeasured runtime was given a colour");
  assert.match(unknown.text, /not that it answers|was not checked/,
    "the sentence must say the runtime was not checked, or a reader takes it for a green");
  assert.doesNotMatch(unknown.text, /NOT RUNNING/, "unmeasured was reported as measured-and-down");
});

test("2145 AN ABSENCE IS NOT A MISCONFIGURATION — a fresh box is reported, a half-applied one is refused", () => {
  // Doctor's own written rule, not a new one: "No `claude` and nothing set is a fresh machine: reported,
  // exit 0." A first cut returned `problem` for every not-standing door — true of an install, and doctor
  // cannot tell an install from a checkout. Wired, it failed eleven arms including
  // `--check on an unconfigured machine exits 0`.
  const fresh = describeDoorState(DOOR({ standing: false, fenceOn: false, unitInstalled: false }));
  assert.equal(fresh.level, "info",
    "neither half configured is an ABSENCE — a problem here exits doctor 1 on every box that never installed");

  // Exactly one half is a door somebody began setting up and did not finish. That is a misconfiguration.
  for (const half of [{ fenceOn: true, unitInstalled: false }, { fenceOn: false, unitInstalled: true }]) {
    const r = describeDoorState(DOOR({ standing: false, ...half }));
    assert.equal(r.level, "problem",
      `a HALF-configured door (${JSON.stringify(half)}) was not reported as a misconfiguration`);
    assert.match(r.text, /HALF configured/);
  }
});

test("2145 a door that is not configured names WHICH half is missing — the two have different remedies", () => {
  // The sentence this replaced in doctor already named the halves independently ("fence off, unit
  // installed"). Collapsing them into "the unit or the setting" would have been a worse sentence than
  // the one it replaced.
  const neither = describeDoorState(DOOR({ standing: false, fenceOn: false, unitInstalled: false }));
  assert.match(neither.text, new RegExp(CLIENT_DOOR_UNIT.replace(/\./g, "\\.") + " is not installed"));
  assert.match(neither.text, /account access .* is off/);

  const fenceOnly = describeDoorState(DOOR({ standing: false, fenceOn: true, unitInstalled: false }));
  assert.match(fenceOnly.text, /is not installed/, "the missing half must be named");
  assert.doesNotMatch(fenceOnly.text, /account access .* is off/,
    "a half that is FINE was reported as missing — a reader sent to fix what is already right");

  const unitOnly = describeDoorState(DOOR({ standing: false, fenceOn: false, unitInstalled: true }));
  assert.match(unitOnly.text, /account access .* is off/);
  assert.doesNotMatch(unitOnly.text, /is not installed/, "the installed unit was reported absent");
});

test("2145 EVERY COMMAND IT PRINTS IS INJECTED — a literal verb is `command not found` for a reader with no shim", () => {
  //, and this is the arm that would have caught it before the wiring did: doctor's
  // own guard runs every command doctor prints from a directory that is not the install. The first cut
  // of this function hardcoded `clearotron start` and `clearotron connect`, and both reached doctor's
  // output the moment it acquired a caller.
  const opts = { unit: "u.service", closeCmd: "CLOSE-CMD", startCmd: "START-CMD", connectCmd: "CONNECT-CMD" };
  const texts = [
    describeDoorState(DOOR({ standing: false, fenceOn: false, unitInstalled: false }), opts),
    describeDoorState(DOOR({ standing: false, fenceOn: true, unitInstalled: false }), opts),
    describeDoorState(DOOR({ active: false }), opts),
    describeDoorState(DOOR({ active: true }), opts),
  ].map((r) => r.text);
  for (const t of texts) {
    assert.doesNotMatch(t, /`clearotron /,
      `a bare product verb survived injection, so doctor would print it verbatim: ${t}`);
  }
  // And the injected strings actually arrive — an arm that only checks the absence passes on a function
  // that prints no command at all.
  assert.ok(texts.some((t) => t.includes("START-CMD")), "the start command never reached the text");
  assert.ok(texts.some((t) => t.includes("CONNECT-CMD")), "the connect command never reached the text");
  assert.ok(texts.some((t) => t.includes("CLOSE-CMD")), "the close command never reached the text");
});

test("2145 DOCTOR ACTUALLY CALLS IT — the arms above pass just as well on a function nobody reaches", () => {
  // This is the defect itself, so it is driven at the door rather than asserted from the source: the
  // split was correct, tested-by-inspection and UNREACHED for a day. A grep for the identifier in
  // `bin/onboard.mjs` would go green on an import that nothing invokes.
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"],
    { cwd: ROOT, env: { ...process.env }, encoding: "utf8" });
  if (r.error || r.signal) throw new Error(`the child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.match(out, /Client connector/, "doctor did not reach the section under test — this arm asserts nothing");
  // THE CAN-FAIL HALF. The three superseded sentences are string-matched and must be GONE; without this
  // the arm passes on the old code, because the old code also prints something about the client door.
  assert.doesNotMatch(out, /the client door is on \(/,
    "doctor still prints the sentence tracker issue 2145 refuted — configured reported as running");
  assert.doesNotMatch(out, /the client door is HALF open/, "the superseded half-open sentence is still printed");
  assert.doesNotMatch(out, /its unit is installed by .*connect.* only, never at install/,
    "doctor still prints the pre-2148 sentence, which is false of every install now");
  // And it prints one of the four this function produces.
  // FIVE SENTENCES NOW, not four: 2191-F11 added the listening one, because unit-file presence could
  // not see a foreground door. Added here rather than loosened — the point of this arm is that the line
  // came from describeDoorState, so the set it may print has to be enumerated.
  assert.match(out, /the client door is (on and running|not set up here|HALF configured)|whether it is RUNNING was not checked|is NOT RUNNING|something is listening on the client door's address/,
    "doctor's door line came from neither the old code nor describeDoorState");
});

// ── 2191 F14 · A REVOKED KEY THAT STILL WORKED ──────────────────────────────────────────────────────
//
// On a default `clearotron start` install, revoking a client key did nothing. The door was started with
// TRADEMARK_MCP_TOKEN_DENYLIST pointing at ~/.config/clearotron/token-denylist; nothing created it; and
// `isRevoked` returns false on an unreadable file by its own stated contract. So `disconnect` wrote a
// jti into a file no verifier could read, every check looked done, and the revoked key completed a full
// handshake with nothing logged.
//
// `connect` had armed AND created the file since 2082, with a comment naming this exact landmine. One of
// the two doors stood outside a guard the other one had — which is why the arm below is about the PATH
// having one owner, not about either door remembering.

test("2191-F14 the denylist path has exactly one owner in the tree", (ctx) => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  // THE SHARED HELPER, not a git call of my own. `no test enumerates the tracked corpus behind the
  // helper's back` exists so every corpus guard announces itself and SKIPS LOUDLY where there is no
  // checkout — a raw `git ls-files` returns nothing there and reads as a clean sweep over an empty
  // population. The first version of this arm did exactly that and CI caught it.
  const all = trackedFiles("denylist path has one owner", { root: REPO_ROOT, pathspec: ["bin", "shared", "mcp-server", "driver"] });
  // DECLARED, not a bare return. exists because an arm that bails on an unmeetable precondition
  // without saying so reports as a pass over a population it never had — which is the same vacuous green
  // this arm was written to prevent, one level up.
  if (!all) return ctx.skip(NO_CORPUS);
  const files = all.filter((f) => f.endsWith(".mjs"));
  assert.ok(files.length > 20, `only ${files.length} files scanned — this sweep would be free`);
  const owners = files.filter((f) => {
    if (f === "shared/client-door.mjs") return false;                    // the owner itself
    if (/(^|\/)test\//.test(f) || f.endsWith(".test.mjs")) return false;   // arms may name a path deliberately
    // THE WORKING TREE, not HEAD. An earlier draft read `git show HEAD:<f>` and so judged the last
    // commit rather than the change under review — green on a tree that reintroduces the copies, red on
    // one that removes them, until the commit lands. `git ls-files` still supplies the population, so
    // an untracked scratch file cannot fail this.
    return /"token-denylist"/.test(readFileSync(join(REPO_ROOT, f), "utf8"));
  });
  assert.deepEqual(owners, [],
    `these compose the denylist path themselves instead of importing defaultDenylistPath: ${owners.join(", ")}. `
    + "Four copies is how one door created the file and the other only named it");
});

test("2191-F14 ensureDenylistFile creates an absent list and never touches an existing one", () => {
  const seen = { mkdir: null, wrote: null };
  const io = { exists: () => false, dirname: (p) => p.replace(/\/[^/]+$/, ""),
    mkdir: (d) => { seen.mkdir = d; }, write: (f, t) => { seen.wrote = { f, t }; } };
  const made = ensureDenylistFile("/srv/x/token-denylist", io);
  assert.equal(made.created, true);
  assert.equal(seen.mkdir, "/srv/x", "the parent is created too — a missing directory is the same landmine");
  assert.match(seen.wrote.t, /one jti per line/, "and the header says who writes it");

  // AN EXISTING LIST IS LEFT ALONE. Recreating it would erase every revocation on the box, which is the
  // opposite failure and a worse one.
  let wrote = false;
  const kept = ensureDenylistFile("/srv/x/token-denylist",
    { exists: () => true, dirname: () => "/srv/x", mkdir: () => {}, write: () => { wrote = true; }, read: () => "" });
  assert.equal(kept.created, false);
  assert.equal(wrote, false, "an existing denylist must never be rewritten");
});

test("2191-F14 present-but-unreadable is NOT accepted — that is the state that fails open", () => {
  assert.throws(() => ensureDenylistFile("/srv/x/token-denylist", {
    exists: () => true, dirname: () => "/srv/x", mkdir: () => {}, write: () => {},
    read: () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); },
  }), /EACCES/,
  "a list the door cannot open is exactly what isRevoked turns into \"not revoked\" — it has to stop the "
  + "start, not pass an existence check");
});

// ── 2191 F11 · A DOOR THAT ANSWERS IS SET UP, WHATEVER THE UNITS SAY ────────────────────────────────
//
// `standing` is unit-file + fence, and a FOREGROUND `clearotron start` has neither — it runs the door as
// its own child. Measured on this branch before the fix: the door listening on its port while doctor
// said "the client door is not set up here" and pointed the reader at the command they had just run.

test("2191-F11 a listening door is reported as answering, not as absent", () => {
  const door = clientDoorState({
    env: {}, unitDir: "/nowhere", exists: () => false, active: null, listening: true,
  });
  assert.equal(door.standing, false, "no unit and no fence — `standing` is unchanged and still means configured");
  const said = describeDoorState(door);
  assert.equal(said.level, "info", "something answering is not a fault, and not proof the door is ours");
  assert.match(said.text, /something is listening on the client door's address/, said.text);
  assert.match(said.text, /--background/, "and it must say what would make it outlive the terminal");
});

test("2191-F11 not listening still reads as not set up, and an UNKNOWN probe changes nothing", () => {
  const base = { env: {}, unitDir: "/nowhere", exists: () => false, active: null };
  // FALSE is a real answer: nothing is there.
  const off = describeDoorState(clientDoorState({ ...base, listening: false }));
  assert.match(off.text, /not set up here/, off.text);
  // NULL is a could-not-look, and it must not be read as either — the sentence is the one from before
  // this signal existed, which is the honest thing to say when nobody asked.
  const unknown = describeDoorState(clientDoorState({ ...base, listening: null }));
  assert.match(unknown.text, /not set up here/, unknown.text);
  assert.doesNotMatch(unknown.text, /something is listening/,
    "a probe that could not be made must never be reported as a door that answered");
});

// ── 2191 · DOCTOR NAMES THE STATE, AND READS THE PROBE ON EVERY BRANCH ──────────────────────────────
//
// `door.listening` was computed, passed in, and read ONLY inside `if (!door.standing)`. So on a STANDING
// door the probe was ignored and doctor asserted "nothing is listening on the client door" — measured
// false with a decoy holding the port. A computed input consulted on one branch is a dead input, and it
// reads as thoroughness.
//
// The same branch collapsed ActiveState and SubState into a boolean, so a crash loop and a connect that
// stopped half-way printed one sentence and had different next steps.

const standing = (o) => clientDoorState({
  env: { CLIENT_MCP_ACCOUNT_ACCESS: "1" }, unitDir: "/u", exists: () => true, ...o,
});

test("2191 a standing door that is down, with the port HELD, says what holds it", () => {
  const said = describeDoorState(standing({ active: false, listening: true, activeState: "inactive", subState: "dead" }));
  assert.equal(said.level, "problem");
  assert.match(said.text, /something IS listening/,
    "the probe was already taken and passed in; asserting an empty port without reading it is the defect");
  assert.match(said.text, /ss -ltnp/, "and the reader needs the way to find the holder, not just the fact");
  assert.doesNotMatch(said.text, /re-applies it cleanly/,
    "re-placing the unit onto a port something else holds is not the remedy for this state");
});

test("2191 a crash loop and a half-finished connect are different sentences", () => {
  const loop = describeDoorState(standing({ active: false, listening: false, activeState: "activating", subState: "auto-restart" }));
  const half = describeDoorState(standing({ active: false, listening: false, activeState: "inactive", subState: "dead" }));
  assert.match(loop.text, /CRASH-LOOPING/, loop.text);
  assert.match(loop.text, /journalctl/, "a looping unit's own words are the fastest route");
  assert.match(half.text, /connect` that failed part-way/, half.text);
  assert.notEqual(loop.text, half.text,
    "collapsed to a boolean these were one sentence, and they have different next steps");
  // THE PAIR IS PRINTED, so a reader can check it themselves rather than trusting the label.
  assert.match(loop.text, /activating\/auto-restart/, loop.text);
});

test("2191 an unasked systemd plus an answering port is still an answer", () => {
  const said = describeDoorState(standing({ active: null, listening: true }));
  assert.equal(said.level, "ok",
    "not asking systemd is not knowing nothing — if the port answers, the door is serving");
  assert.match(said.text, /the port's word rather than the unit's/, "and it must say which evidence it has");
});

test("2191 a running door is unchanged, and none of this fires on it", () => {
  const said = describeDoorState(standing({ active: true, listening: true, activeState: "active", subState: "running" }));
  assert.equal(said.level, "ok");
  assert.match(said.text, /on and running/, said.text);
  assert.doesNotMatch(said.text, /CRASH-LOOPING|something IS listening/, "the ordinary case stays the ordinary sentence");
});
