// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every value a shipped unit refuses to start without has a writer — tracker issue 122, item 2.
//
// 122 fixed three instances of one family and then asked for the thing that finds the fourth: *"A check
// enumerates that set, so the next value added is caught by a test rather than by whoever installs
// next. The census should be derivable, not a hand-kept list: 'what do the shipped units read' joined
// against 'what the documented install writes'."*
//
// Both sides of that join are MEASURED here rather than typed. The left side comes out of the units and
// their entrypoints (`driver/systemd/install-census.mjs`). The right side comes out of running the real
// installer against a scratch destination and diffing the env file it leaves — so a value the installer
// stops writing disappears from the right side by itself, and the arm goes red without anyone editing
// this file.
//
// ── THE ONE HAND-WRITTEN THING, AND WHY IT IS A REASON RATHER THAN A NAME ────────────────────────────
//
// `SUPPLIED_ELSEWHERE` is the only list here, and every entry has to be a sentence a reader can check.
// That shape is deliberate: 122's complaint was never "a value can be unset", it was that *"the only
// way to set it is to run a command the install instructions do not tell you to run, so the reader has
// no action available."* A declaration that names no supplier would restate the defect and pass.
//
// The list cannot grow quietly either. A new name reaches it only by being added by hand, in a diff, at
// the moment somebody makes a unit refuse over something new — which is the moment 122 wanted a person
// to have to think.
//
// ── WHAT THIS ARM DOES NOT REACH ────────────────────────────────────────────────────────────────────
//
// 122's item 4 asks for a drive against `.env.deployment.example` WHOLE, because a hand-made two-line
// env is how the `PORTAL_MCP_URL` fix first passed while failing the shipped template's empty row. That
// file is WITHHELD FROM THE PUBLIC TREE BY THE CUT — `scripts/env-audit.mjs` says so in as many words —
// so it cannot be the fixture here, and saying that is better than quietly using a different file and
// calling it the template. The fixture below is the same three-line documented install the rest of the
// install arms use, and its `CLEAROTRON_ACCESS_FILE` row is there because the installer refuses to place
// a single unit without one.
//
// The census is also a SUPERSET: a name appears because it is spoken in a refusal, which does not prove
// its absence is what refuses. Several of these refuse when SET (the dev bypasses), or when set to
// something that is not loopback, or are one of two alternatives. That direction is the safe one — it
// makes the join stricter and nothing required can hide in it — but it means an entry in the list below
// is a statement about who supplies a value, never a claim that the unit dies without it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startupCensus, everyStartupValue, entrypointOf, valuesRefusedOver } from "../systemd/install-census.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDER = join(REPO, "driver", "systemd", "render-units.mjs");

// The documented install, as the rest of this family's arms describe it. The access file rides along
// because `render-units --apply` refuses — exit 1, nothing placed — without a guest list to scope a
// client identity against, so a fixture that omitted it would measure the refusal and not the install.
const DOCUMENTED_INSTALL = "CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\nCLEAROTRON_WORK_DIR=/var/lib/clearotron\n"
  + "CLEAROTRON_ACCESS_FILE=/var/lib/clearotron/grants.json\n";

/**
 * What the documented install ADDS to the env file its units read — derived by running it.
 *
 * ADDED, not present. Reading the finished file would count the fixture's own three rows as things the
 * installer wrote, and `CLEAROTRON_ACCESS_FILE` would then look like a value with a writer when it is
 * exactly the opposite: the value the installer stops and asks a person for.
 */
function whatTheInstallWrites() {
  const dir = mkdtempSync(join(tmpdir(), "install-census-"));
  try {
    const env = join(dir, "env");
    writeFileSync(env, DOCUMENTED_INSTALL);
    const keys = (body) => new Set([...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]));
    const before = keys(DOCUMENTED_INSTALL);
    execFileSync(process.execPath, [RENDER, "--apply", "--dest", join(dir, "dest"), "--env", env],
      { encoding: "utf8", timeout: 60_000 });
    return new Set([...keys(readFileSync(env, "utf8"))].filter((k) => !before.has(k)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ── THE DECLARATIONS ────────────────────────────────────────────────────────────────────────────────
//
// One line each: who supplies this value, and why the installer does not. Every one of these is a value
// a shipped unit speaks of in a refusal and the documented install does not write.
const SUPPLIED_ELSEWHERE = Object.freeze({
  // The guest list — the one value the installer REFUSES over rather than inventing. It answers "who
  // may see this deployment's runs", which no product can guess. `render-units --apply` exits 1 naming
  // it, the wizard asks for it, and INSTALL.md §8 carries it. That is 122's second acceptable answer:
  // not written by the install, but named by it with no way to proceed while it is missing.
  CLEAROTRON_ACCESS_FILE: "the operator's grants file — the installer refuses and names it rather than inventing who may read this deployment",

  // ── THE IDENTITY PROXY'S OWN VALUES ───────────────────────────────────────────────────────────────
  // A hosted deployment puts its own identity provider in front, and these are that provider's facts:
  // an audience it issues, a team or issuer it is reached at, the people it is allowed to admit. None
  // is derivable from this box, and a placeholder would be worse than empty — the doors fail closed on
  // absence and would fail OPEN on a value that parses. INSTALL.md §8 is where they are named.
  CLEAROTRON_OIDC_AUDIENCE: "issued by the operator's identity provider for the staff door — INSTALL.md §8; nothing on this box can derive it",
  CLEAROTRON_CLIENT_OIDC_AUDIENCE: "the client door's own application audience, which must DIFFER from the staff one — INSTALL.md §8",
  CF_ACCESS_TEAM: "the operator's Cloudflare Access team, and one of two alternatives with the issuer below — neither alone is required",
  TRADEMARK_MCP_OIDC_ISSUER: "the staff door's issuer, the alternative to CF_ACCESS_TEAM — INSTALL.md §8",
  PORTAL_OIDC_ISSUER: "the portal's issuer, same choice one door along — INSTALL.md §8",
  CLIENT_MCP_OIDC_ISSUER: "the client door's issuer, same choice one door along — INSTALL.md §8",
  MCP_ALLOWED_EMAILS: "who the identity gate admits, by address — one of this pair is required on the proxy path, INSTALL.md §8",
  MCP_ALLOWED_EMAIL_DOMAINS: "who the identity gate admits, by domain — the other half of that pair",
  PORTAL_STAFF_DOMAINS: "which domains count as staff, the alternative to the grants file for sign-in — INSTALL.md §8",

  // ── THE MODE SELECTORS: ABSENCE IS THE DEFAULT, NOT A FAULT ───────────────────────────────────────
  // These refuse over a value that is not a mode the service has. Unset selects the default, so there
  // is nothing for an installer to write — writing one would be choosing a door on the operator's
  // behalf. `bin/start.mjs` DOES inject both for the local path, into its own children's environment
  // and not into any unit; a systemd unit gets neither, which `bin/onboard.mjs` calls out by name
  // because doctor once read the injected value and reported it as the unit's.
  TRADEMARK_MCP_AUTH_MODE: "unset IS the default (cf-access); the refusal is over an unrecognised value, never over absence",
  PORTAL_AUTH_MODE: "unset IS the default; `clearotron start` injects local for its own children and no unit inherits that",

  // ── THE DEV BYPASSES: THESE REFUSE WHEN SET ──────────────────────────────────────────────────────
  // Absence is the safe state and the only state a shipped install should ever be in. An installer that
  // wrote these would be writing the bypass it exists to keep off. `bin/start.mjs` writes both as "0"
  // into the local face's environment, which is a belt-and-braces zero rather than a requirement.
  TRADEMARK_MCP_AUTH_DISABLED: "refuses when SET, not when absent — the dev bypass, and no install writes it",
  TRADEMARK_MCP_DEV: "the dev companion the bypass above demands; absent on every shipped install",
  CLIENT_MCP_AUTH_DISABLED: "refuses when SET, not when absent — the client door's dev bypass",
  CLIENT_MCP_DEV: "the dev companion for that bypass; absent on every shipped install",

  // ── THE BIND ADDRESSES: THE REFUSAL IS OVER A VALUE THAT IS NOT LOOPBACK ─────────────────────────
  TRADEMARK_MCP_HTTP_HOST: "refuses over a non-loopback value; unset binds loopback, which is the shipped posture",
  PORTAL_SERVICE_HOST: "refuses over a non-loopback value; unset binds loopback, which is the shipped posture",

  // ── AND ONE THE INSTALL COULD WRITE AND DOES NOT ─────────────────────────────────────────────────
  //
  // This one is not like the others and the reason is written out rather than smoothed over. The engine
  // door's allow-list is host:port — the same derivable shape as the client door's, which the installer
  // DOES compose and write (`enablePlan`, `CLIENT_MCP_ALLOWED_HOSTS`). Two doors, one shape, one of them
  // filled in. It does not by itself stop the engine door coming up on a hosted box, because that door
  // needs the proxy's four values above and they are genuinely the operator's — but it is a value this
  // product can compute and asks a reader for, which is the arithmetic 122's remedy shape says not to
  // hand over. Raised rather than fixed here: writing it belongs with the install, not with the check
  // that found it, and this arm's job was to find it.
  TRADEMARK_MCP_ALLOWED_HOSTS: "the operator's, today — and DERIVABLE, exactly like the client door's, which the installer composes; the asymmetry is a finding this census made, not a settled design",

  // ── LOCAL SIGN-IN, WHICH THE WIZARD ASKS FOR ────────────────────────────────────────────────────
  PORTAL_LOCAL_USER: "the one address that signs in to a local install; `clearotron install` asks and `clearotron start` injects it",
  PORTAL_LOCAL_CREDENTIAL: "a passphrase file the portal creates itself on first local start, never an install-time value",
});

test("tracker issue 122 — the census can look inside every unit the documented install places", () => {
  const census = startupCensus();
  const blind = census.filter((r) => r.unreadable);
  assert.deepEqual(blind, [],
    "the census could not look inside a unit the install places, so its answer for that unit is unknown "
    + "rather than empty — and an unknown that reads as a pass is the whole failure this issue is about: "
    + blind.map((r) => `${r.unit}: ${r.unreadable}`).join("; "));
  assert.ok(census.length >= 4,
    `the install set shrank to ${census.length} units — if that is intended, this arm should say so`);
});

test("tracker issue 122 — the census still sees the values this issue was filed about", () => {
  // THE INSTRUMENT'S OWN ARM. Every other arm here compares a derived list against a derived list, and
  // both derivations read the same tree — so a parse that quietly stops matching makes the join trivially
  // true and every arm green. These three are the names 122's own table carries, and they were found the
  // hard way: intersecting refusal lines with `process.env.X` in the same file looked correct and dropped
  // CLEAROTRON_ACCESS_FILE and CLEAROTRON_OIDC_AUDIENCE, which are read through a helper.
  const by = Object.fromEntries(startupCensus().map((r) => [r.unit, r.names ?? []]));
  assert.ok(by["clearotron-portal.service"].includes("PORTAL_SECRET"),
    "the census no longer sees PORTAL_SECRET on the portal, which is the value this issue's third row "
    + "is about — the parse has stopped working and every other arm in this file is now vacuous");
  assert.ok(by["clearotron-client-mcp.service"].includes("TRADEMARK_MCP_TOKEN_SECRET"),
    "the census no longer sees the door's signing secret");
  assert.ok(by["clearotron-client-mcp.service"].includes("CLIENT_MCP_ALLOWED_HOSTS"),
    "the census no longer sees the door's allow-list");
  assert.ok(by["clearotron-portal.service"].includes("CLEAROTRON_ACCESS_FILE"),
    "the census no longer sees CLEAROTRON_ACCESS_FILE — this one is read through `envFrom(process.env, …)` "
    + "rather than as a property, and it is the exact name a tighter filter lost");
});

test("tracker issue 122 — every value a placed unit refuses over is written by the install, or declared", () => {
  const written = whatTheInstallWrites();
  const undeclared = everyStartupValue(startupCensus())
    .filter((n) => !written.has(n) && !(n in SUPPLIED_ELSEWHERE));
  assert.deepEqual(undeclared, [],
    "a unit the documented install places refuses to start over a value nothing in that install writes, "
    + "and no line in SUPPLIED_ELSEWHERE says who does. That is tracker issue 122's family exactly: the "
    + "box comes up with correct units, correct code and a value nobody set. Either make the install "
    + `write it, or declare who supplies it and why the installer cannot: ${undeclared.join(", ")}`);
});

test("tracker issue 122 — a declaration cannot outlive the refusal it explains", () => {
  // The other direction, and the one that keeps the list from becoming a graveyard. A name that no unit
  // refuses over any more needs deleting, not keeping "just in case" — a stale line reads as a live
  // constraint to the next person, and it is how a list stops describing the tree.
  const live = new Set(everyStartupValue(startupCensus()));
  const written = whatTheInstallWrites();
  const stale = Object.keys(SUPPLIED_ELSEWHERE).filter((n) => !live.has(n));
  assert.deepEqual(stale, [],
    `no unit refuses over these any more, so the declarations are describing a tree that is gone: ${stale.join(", ")}`);
  const nowWritten = Object.keys(SUPPLIED_ELSEWHERE).filter((n) => written.has(n));
  assert.deepEqual(nowWritten, [],
    "the install now writes values that are still declared as supplied from outside it — delete the "
    + `declaration, because it says the reader must act and the reader does not: ${nowWritten.join(", ")}`);
});

test("tracker issue 122 — the worker's empty answer is a measured zero, not a could-not-look", () => {
  // An absence is a finding, so it has to be possible to tell these apart. The worker's row is the one
  // place the census legitimately returns nothing, and this pins WHY: `driver/runner.mjs` has no
  // start-up refusal at all. The day somebody gives it one, that name lands in the join above.
  const worker = startupCensus().find((r) => r.unit === "clearotron-worker.service");
  assert.ok(worker, "the queue drainer is not in the install set");
  assert.equal(worker.unreadable, null, `the census could not read the worker: ${worker.unreadable}`);
  assert.deepEqual(worker.names, [],
    "the worker now refuses to start over something — which is fine, and it must be declared or written");
  const src = readFileSync(join(REPO, worker.entrypoint), "utf8");
  assert.equal(/^\s*(?!\/\/).*process\.exit\(1\)/m.test(src), false,
    "the worker has grown a refusal the census did not report — the two disagree and the census is wrong");
});

test("tracker issue 122 — a unit whose entrypoint cannot be resolved is a finding, never an empty list", () => {
  // Driving the three-valued answer, because the whole census rests on it. A caller that collapsed
  // could-not-look into requires-nothing would report a clean bill of health for a unit it never opened.
  assert.equal(entrypointOf("[Service]\nType=simple\n").rel, null);
  assert.match(entrypointOf("[Service]\nType=simple\n").unreadable, /no ExecStart/);
  assert.match(entrypointOf("ExecStart=/bin/bash /opt/thing.sh\n").unreadable ?? "", /does not name a module/);
  assert.equal(entrypointOf("ExecStart=/usr/bin/node ${CLEAROTRON_CHECKOUT_DIR}/driver/runner.mjs --watch\n").rel,
    "driver/runner.mjs", "the shape every shipped unit uses stopped resolving");
});

test("tracker issue 122 — the census reads refusals and not the prose above them", () => {
  // A file's own comments explain its gate, in the gate's vocabulary. Reading those would make the
  // answer depend on how well a module is documented — and this repo documents heavily.
  assert.deepEqual(valuesRefusedOver("// FATAL: MADE_UP_NAME is required — refusing to start.\n"), [],
    "a commented-out refusal was counted, so the census measures prose");
  assert.deepEqual(valuesRefusedOver('log("FATAL: MADE_UP_NAME is required — refusing to start."); process.exit(1);\n'),
    ["MADE_UP_NAME"]);
  assert.deepEqual(valuesRefusedOver('const MADE_UP_NAME = 1;\nlog("FATAL: MADE_UP_NAME — refusing to start.");\n'), [],
    "a module constant was reported as an environment value the install must write");
});
