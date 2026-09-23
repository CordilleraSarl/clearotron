// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// "I COULD NOT LOOK" AND "THIS HAS DRIFTED" ARE DIFFERENT ANSWERS AND WANT DIFFERENT THINGS DONE.
//
// The deployment check reported both through one FAIL. Two of its arms said, in their own message, "This
// is a failure to look, never a pass" — and then returned the verdict a genuine drift returns, so a reader
// could not tell the two apart without reading to the end of the message. A drift is fixed by redeploying.
// A could-not-look is fixed by pointing the check at something it can read, and until somebody does,
// nothing is known about that surface either way.
//
// The cost of leaving it is that a FAIL which turns out to be "could not look" teaches whoever runs the
// check to read FAIL as noise, and the run where it means drift is the one nobody acts on.
//
// AND THE FIX HAD TO AVOID DOING THE SAME THING ONE LEVEL UP. Several surfaces are deliberately not
// probed — the client door answers behind an access proxy, a door this instance does not name has no
// address to dial — and those are the resting state of a healthy box. An exit code that moved on every
// skip would fire on every good run and be ignored inside a week, which is this defect wearing a hat.
// So a could-not-look is marked distinctly from an ordinary skip, and only it moves the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exitFor } from "../surface-exit-verdict.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SRC = readFileSync(join(ROOT, "scripts", "live-surface-check.mjs"), "utf8");

test("the three answers are three exit codes, and a drift outranks a could-not-look", () => {
  assert.equal(exitFor({ failed: 0, couldNotLook: 0 }), 0, "everything read, nothing disagreed");
  assert.equal(exitFor({ failed: 2, couldNotLook: 0 }), 1, "a drift — redeploy, and the report names which");
  assert.equal(exitFor({ failed: 0, couldNotLook: 3 }), 3,
    "nothing drifted and a surface could not be read: a different errand, so a different code");
  assert.equal(exitFor({ failed: 1, couldNotLook: 5 }), 1,
    "both present ⇒ the drift wins, because it is actionable now and the unreadable surface is a second "
    + "errand. It is on the report either way; only the code is ordered.");
});

test("no argument is not a pass by omission", () => {
  // `exitFor()` with nothing is a caller that measured nothing. It answers 0 here because the counts
  // default to zero, and that is only safe while the caller cannot reach it without having counted — so
  // this arm exists to make the assumption visible rather than to bless it.
  assert.equal(exitFor(), 0);
  assert.equal(exitFor({}), 0);
});

test("an ordinary skip does NOT move the exit code", () => {
  // The direction that keeps this usable. A healthy box skips several surfaces by design, and a code that
  // moved on those would be indistinguishable from a code that never moves.
  assert.equal(exitFor({ failed: 0, couldNotLook: 0 }), 0,
    "skips that are not blocked never reach this function, and nothing else may imply them");
});

test("no arm in the check admits a failure to look and then returns a drift", () => {
  // THE PROPERTY, not the two sites. Stated over the whole file so it catches a new arm written the old
  // way, which a test naming the two known ones could not. It is a rule about this file's own prose
  // contract: the sentence "failure to look" is the author saying the surface was not compared, and the
  // verdict beside it may not be the one a real disagreement returns.
  //
  // Read off the source because the two arms it guards need a deployment whose workspace root cannot be
  // resolved — not a state reachable from a test box, and a check that could only be driven where it
  // cannot run would be worth less than this.
  const failSites = SRC.split(/\bfail\(/).slice(1);
  const offenders = failSites
    .map((chunk) => chunk.slice(0, chunk.indexOf(");") + 1))
    .filter((chunk) => ADMITS.test(chunk));
  assert.deepEqual(offenders, [],
    "an arm says it could not look and returns the verdict a drift returns — use the blocked reporter, "
    + `which is a skip that moves the exit code. Offending text: ${offenders.join(" · ").slice(0, 300)}`);
});

test("every result carries the marker, so a reader of the JSON can tell the two apart", () => {
  // The distinction has to survive to the consumer or it is only a nicer terminal. Asserted on the shape
  // of the record rather than on a live run, which needs a deployment.
  assert.match(SRC, /const record = \(name, state, detail, blocked = false\) =>/,
    "every record carries the marker, defaulted, so an arm that does not think about it is not blocked");
  assert.match(SRC, /results\.push\(\{ name, state, detail, blocked \}\)/,
    "…and it is written into the result the --json consumer reads, not only used for the terminal");
});

// ── THE SAME RULE, ONE LAYER DOWN: A VERDICT COMPUTED ELSEWHERE AND FORWARDED ─────────────────────────
//
// The arm above reads `fail(` sites in the check. Most arms do not decide anything there: a verdict
// module decides, and the check forwards `v.state` and `v.message` through `record`. Two of those
// verdicts said in their own message that they could not look — "This is a failure to look, not a
// finding about the deployment", "nothing was checked" — and returned a plain skip, which moves no exit
// code. The forwarding site dropped the marker as well. So a check that could not compare a single unit
// file exited 0: a could-not-look wearing a HEALTHY box's verdict, which is the more expensive of the two
// ways to get this wrong.
//
// Two halves, and each is useless without the other: the verdict has to set the marker, and the check
// has to carry it to the bucket that counts.

const VERDICT_ROOT = join(ROOT, "driver");
const relImports = (text) => [...text.matchAll(/from "(\.{1,2}\/[^"]+\.mjs)"/g)].map((m) => m[1]);

/** Every module the check imports from the driver and the MCP server, and the modules those import. */
function verdictModules() {
  const direct = relImports(SRC)
    .filter((p) => /^\.\.\/(driver|mcp-server)\//.test(p))
    .map((p) => join(ROOT, "scripts", p));
  const all = new Set(direct);
  for (const f of direct) {
    for (const p of relImports(readFileSync(f, "utf8"))) {
      const abs = join(dirname(f), p);
      if (abs.startsWith(VERDICT_ROOT) || abs.startsWith(join(ROOT, "mcp-server"))) all.add(abs);
    }
  }
  return [...all].sort();
}

// WORDS A MESSAGE USES TO ADMIT IT DID NOT LOOK. The criterion is the message's own text, not a judgment
// about what each surface means: an author who wrote one of these was saying the surface was not
// compared, and the verdict beside it may not be one a reader takes as a pass or as a drift. Deliberate
// skips — "NOT PROBED", "unscoped for this door", "0 active units" — are not on this list and stay
// ordinary skips, because they are the resting state of a healthy box somewhere and a code that moved on
// them would fire every hour.
const ADMITS = /failure to look|failing to look|could not (?:enumerate|ask|read|be read|be resolved)|nothing was checked|not checked, not passed/i;

// THE ONE VERDICT LEFT OUT, and why. `serviceCommitVerdict` answers "services share one commit", and the
// hourly deploy excuses that arm's skip by name: on a box whose units carry no WorkingDirectory in the
// checkout the arm cannot answer, and the deploy logs it and passes. The deploy reads the exit code
// BEFORE that excuse, so marking this skip
// would turn every such tick red with no disagreement to name. Whether that arm's could-not-look should
// move the code is a question about the deploy, not about this file.
const EXCUSED = ["serviceCommitVerdict"];

function withoutExcused(text) {
  let out = text;
  for (const name of EXCUSED) {
    const at = out.indexOf(`export function ${name}(`);
    if (at < 0) continue;
    const end = out.indexOf("\n}\n", at);
    out = out.slice(0, at) + out.slice(end < 0 ? out.length : end + 3);
  }
  return out;
}

/** Each `return { … }` that sets a state, with whether its own message admits it could not look. */
function verdictReturns(file) {
  const text = withoutExcused(readFileSync(file, "utf8"));
  return text.split(/\breturn \{/).slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("};") < 0 ? chunk.length : chunk.indexOf("};")))
    .filter((obj) => /\bstate: "(pass|fail|skip|warn|unknown)"/.test(obj))
    .map((obj) => ({ obj, state: /\bstate: "(\w+)"/.exec(obj)[1], admits: ADMITS.test(obj), blocked: /\bblocked: true\b/.test(obj) }));
}

test("the population the verdict arms read is real, so an empty walk cannot pass", () => {
  // A cross-file arm over a set it discovered is exactly the shape that passes green having looked at
  // nothing — the import pattern stops matching, the set comes back empty, every loop below is a no-op.
  const mods = verdictModules();
  assert.ok(mods.length >= 15, `only ${mods.length} module(s) found behind the check — the import walk is not reading what it should`);
  for (const must of ["unit-file-drift.mjs", "unit-state-verdict.mjs", "unit-inventory.mjs", "queue-watch-verdict.mjs",
    "manager-groups-verdict.mjs", "drainer-identity.mjs", "plan-run-agreement-verdict.mjs"]) {
    assert.ok(mods.some((m) => m.endsWith(`/${must}`)), `${must} is not in the walk`);
  }
  const returns = mods.flatMap(verdictReturns);
  assert.ok(returns.length >= 40, `only ${returns.length} verdict return(s) read`);
  assert.ok(returns.filter((r) => r.admits).length >= 8, "the admission pattern matches almost nothing — it has stopped reading the messages");
});

test("a verdict whose own message admits it could not look returns a MARKED skip", () => {
  const offenders = [];
  for (const f of verdictModules()) {
    for (const r of verdictReturns(f)) {
      if (!r.admits) continue;
      if (r.state === "skip" && r.blocked) continue;
      offenders.push(`${f.slice(ROOT.length + 1)}: state ${r.state}${r.blocked ? "" : ", no marker"} — ${r.obj.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  assert.deepEqual(offenders, [],
    "a verdict says it could not look and returns something a reader takes as a pass or as a drift. Return "
    + "`{ state: \"skip\", blocked: true, … }`, which the check counts toward exit 3:\n  " + offenders.join("\n  "));
});

test("every verdict the check forwards carries its marker to the bucket that counts", () => {
  // A verdict that sets the marker and a site that drops it is the defect this file was filed about, and
  // it is the one that survived the first repair: six of seven forwarding sites passed `v.state` and
  // `v.message` and nothing else.
  const forwards = [...SRC.matchAll(/\brecord\(\s*("[^"]*"),\s*(\w+)\.state,\s*\2\.message\b([^;]*?)\);/g)];
  assert.ok(forwards.length >= 8, `only ${forwards.length} forwarding site(s) found — the pattern is not reading the check`);
  const dropped = forwards.filter(([, , v, rest]) => !new RegExp(`^\\s*,\\s*${v}\\.blocked === true\\s*$`).test(rest))
    .map(([, name]) => name);
  assert.deepEqual(dropped, [], `these arms forward a verdict and drop its marker: ${dropped.join(", ")}`);
  // THE SHORTHAND CANNOT CARRY IT AT ALL. `({ pass, fail, skip })[state](name, message)` has no slot for
  // the marker, so a verdict routed through it loses the distinction however carefully it was computed.
  assert.doesNotMatch(SRC, /\(\{\s*pass,\s*fail,\s*skip\s*\}\)\[\w+(?:\.\w+)?\]\(/,
    "a verdict is forwarded through the ({ pass, fail, skip })[state] shorthand, which drops the marker");
});

test("each could-not-look branch, driven, comes back marked", async () => {
  // The static arm above reads the source. This drives the branches the first repair missed, so a
  // marker that is present in the text and lost on the way out still reds here.
  const { unitFileDriftVerdict } = await import("../unit-file-drift.mjs");
  const { unitsActiveVerdict } = await import("../unit-state-verdict.mjs");
  const { unitInventoryVerdict, timerVerdict } = await import("../unit-inventory.mjs");
  const { managerGroupsVerdict } = await import("../manager-groups-verdict.mjs");
  const cases = {
    "unit files: systemd could not be enumerated": unitFileDriftVerdict({ units: [], probe: { ok: false, why: "no bus" } }),
    "unit files: systemd answered and nothing could be compared": unitFileDriftVerdict({ units: [{ unit: "a.service", live: null, tracked: null }], probe: { ok: true } }),
    "units active: systemd could not be enumerated": unitsActiveVerdict({ units: [], probe: { ok: false, why: "no bus" } }),
    "inventory: systemd could not be enumerated": unitInventoryVerdict({ live: [], files: [], probe: { ok: false, why: "no bus" } }),
    "timers: systemd could not be asked": timerVerdict(null, { probeFailed: "no bus" }),
    "manager groups: the user's groups could not be read": managerGroupsVerdict({ idGroups: null, managerGroups: null, user: "u", uid: 1 }),
  };
  for (const [what, v] of Object.entries(cases)) {
    assert.equal(v.state, "skip", `${what}: ${v.state}`);
    assert.equal(v.blocked, true, `${what}: the marker is missing, so the check would exit 0`);
  }
  // AND THE OTHER DIRECTION, which is half of the test. A box with no user manager at all is a legitimate
  // shape, so that skip stays ordinary; a marker there would fire on every such box.
  const noManager = managerGroupsVerdict({ idGroups: [1000], managerGroups: null, user: "u", uid: 1 });
  assert.equal(noManager.state, "skip");
  assert.notEqual(noManager.blocked, true, "a box with no user manager is not a failure to look");
});

test("the JSON a script reads gives the exit code's answer, not a second opinion", () => {
  // `ok: failed.length === 0` printed `ok: true` for a run that could not look at anything and exited 3.
  // A machine reader is the one that believes a field without reading the prose beside it.
  assert.doesNotMatch(SRC, /JSON\.stringify\(\{ ok: failed\.length === 0/, "--json still decides `ok` on disagreements alone");
  assert.match(SRC, /const code = exitFor\(\{ failed: failed\.length, couldNotLook: couldNotLook\.length \}\);/,
    "the exit code is decided once, where both surfaces read it");
  assert.match(SRC, /ok: code === 0, exit: code,/, "--json carries the exit code's answer and the code itself");
  assert.match(SRC, /process\.exit\(code\);/, "the process exits with the same decision the JSON printed");
});

// ── THE TWO OTHER DOOR CALLS: "roster resolves" AND "ops-MCP reachable" ─────────────────────────────
//
// Each FAILed on every error but an unset door, so a 429, a refusal of the check's own key, or a request
// that got no answer exited 1 although nothing was compared. The plan_run call was repaired first; these
// are the other two calls to the same door.
test("a door call refused or unanswered is a marked skip, and a door that answered badly is still a drift", async () => {
  const { doorCallVerdict } = await import("../door-call-verdict.mjs");
  const { exitFor } = await import("../surface-exit-verdict.mjs");
  const said = { asked: "list_profiles", notCompared: "the roster was not compared" };
  const withStatus = (status, message) => Object.assign(new Error(message), { status, transport: true });
  for (const [what, e] of [
    ["rate limit", withStatus(429, 'MCP initialize refused (429): {"error":"ops principal rate limit exceeded — retry shortly"}')],
    ["the check's key refused", withStatus(401, 'MCP initialize refused (401): {"error":"a key has no door here"}')],
    ["forbidden", withStatus(403, "MCP tools/call refused (403): forbidden")],
    ["no answer in time", Object.assign(withStatus(null, "MCP request timed out after 15000ms"), { timedOut: true })],
  ]) {
    const v = doorCallVerdict(e, said);
    assert.equal(v?.state, "skip", `${what}: ${JSON.stringify(v)}`);
    assert.equal(v.blocked, true, `${what}: the marker is missing, so the check would exit 0`);
    assert.match(v.message, ADMITS, `${what}: the message does not say the check could not look`);
    assert.equal(exitFor({ failed: 0, couldNotLook: 1 }), 3);
  }
  // AND THE OTHER DIRECTION. A door that answered, badly, is a finding; so, until it is ruled otherwise, is
  // a door with nothing listening.
  for (const [what, e] of [
    ["a 500", withStatus(500, "MCP tools/call refused (500): boom")],
    ["nothing listening", withStatus(null, "connect ECONNREFUSED 127.0.0.1:1")],
    ["a malformed answer", new Error("MCP initialize returned no mcp-session-id — transport contract changed")],
  ]) assert.equal(doorCallVerdict(e, said), null, `${what} was excused as a failure to look`);
});

test("the real client marks a request that got no answer, and not a door with nothing listening", async () => {
  const { mcpToolCall } = await import("../portal-mcp-client.mjs");
  const { doorCallVerdict } = await import("../door-call-verdict.mjs");
  const { createServer } = await import("node:net");
  const listen = (onConn) => new Promise((resolve) => { const s = createServer(onConn); s.listen(0, "127.0.0.1", () => resolve(s)); });
  const silent = await listen(() => { /* accepts, never answers */ });
  const closed = await listen(() => {});
  const closedPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  const caught = async (url) => { try { await mcpToolCall({ url, token: "t", tool: "list_profiles", args: {}, timeoutMs: 300 }); } catch (e) { return e; } return null; };
  try {
    const hung = await caught(`http://127.0.0.1:${silent.address().port}/mcp`);
    assert.equal(hung?.timedOut, true, `a request with no answer is not marked: ${hung?.message}`);
    assert.equal(doorCallVerdict(hung, { asked: "list_profiles", notCompared: "x" })?.blocked, true);
    const refused = await caught(`http://127.0.0.1:${closedPort}/mcp`);
    assert.ok(refused, "a call to a closed port did not throw");
    assert.notEqual(refused.timedOut, true, "nothing listening was marked as a request with no answer");
    assert.equal(doorCallVerdict(refused, { asked: "list_profiles", notCompared: "x" }), null);
  } finally {
    silent.close();
  }
});

test("both door calls hand a thrown error to the verdict, and forward its marker", () => {
  // The verdict line and the forward, together: the same `record(name, v.state, …)` shape appears for
  // other verdicts on these rows, so either line alone could be found somewhere it proves nothing.
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const name of ["roster resolves", "ops-MCP reachable"]) {
    const pair = new RegExp(`const v = doorCallVerdict\\(e, \\{[^\\n]*\\}\\);\\s*if \\(v\\) ${esc(`record("${name}", v.state, v.message, v.blocked === true);`)}\\s*else fail\\("${esc(name)}"`);
    assert.match(SRC, pair, `"${name}" does not hand a thrown door call to doorCallVerdict and forward its marker before failing`);
  }
});
