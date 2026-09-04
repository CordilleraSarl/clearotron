#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// live-surface-check.mjs — does this DEPLOYMENT agree with itself?
//
//   node scripts/live-surface-check.mjs [--json] [--expect-head <sha>]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// CI tests code. This tests a deployment. Every check below failed in production while CI was green,
// because none of them is a property of the source — they are properties of the PROCESSES that are
// running, the ENVIRONMENT they were started in, and the COMMIT they were started from:
//
//   • #98 — the ops-MCP told every caller that three of five depths were "not switched on". They were
//     switched on; the portal said so on the same box at the same moment. The MCP unit had no
//     EnvironmentFile, so it read availability from an environment it did not have. The validation that
//     was supposed to catch this ran `describe_options` in a plain shell — the one environment that
//     makes it dishonest — and reported 10/10. A probe that talks to the RUNNING service cannot make
//     that mistake.
//
//   • #83 — the ops-MCP had no CLEAROTRON_CUSTOMERS_DIR, silently fell back to the bundled demo roster, and
//     refused every real customer. Nothing anywhere compared the roster a door resolves against the
//     roster on disk.
//
//   • the two-clone straddle — a deployment served its portal from one clone and ran its runner from
//     another, 91 commits apart, for weeks. Nothing asserted that a service is on the commit you think
//     it is.
//
// So: ask every reachable door the same question, assert the answers agree with each other AND with
// what is on disk, and assert every service is running the code you think it is. ~30 seconds, no model
// call, no spend.
//
// ── what it can and cannot reach ─────────────────────────────────────────────────────────────────────
//
// Stated plainly, because a check that quietly skips a surface is worse than one that says it did:
//
//   ops-MCP      loopback, TRADEMARK_MCP_AUTH_DISABLED — fully reachable, two independent code paths
//                (describe_options → lib/options.mjs, plan_run → lib/plan.mjs). #98 lived in BOTH, so
//                comparing them to each other is necessary but NOT sufficient…
//   on-disk      …which is why the load-bearing comparison is against the flag snapshot, recomputed
//                here through the ENGINE's own productAvailability(). That is the source of truth the
//                portal read and the MCP did not.
//   portal       /portal/health only. Every other route is behind Cloudflare Access and cannot be
//                called from a script without a JWT. Reported as "not probed", never as "passed".
//   client-MCP   behind CF Access (or an API key that is a crown jewel and must never be logged).
//                Liveness only. Same rule: not probed ≠ passed.
//
// ── it must call the doors AS A REAL CALLER DOES ─────────────────────────────────────────────────────
//
// Learned while writing this, and worth stating because it is the same trap as #98 wearing a different
// hat. A token-less loopback call to the ops face initialises an accounts-scoped session with NO
// accounts: `list_profiles` answers `clients: 0` and `plan_run` refuses with "an accounts-scoped session
// must set profileKey explicitly". The first version of this script read that as a live #83 and was
// WRONG — the deployment was fine; the caller was not. With the portal's own ops token the same call
// answers `clients: 10`.
//
// #98's validation failed because it ran in the wrong ENVIRONMENT. A probe can fail the same way by
// running as the wrong IDENTITY. So this check authenticates the way the portal does, and a missing
// token is reported as "not probed" rather than quietly producing a false failure.
//
// ── running it ───────────────────────────────────────────────────────────────────────────────────────
//
// Run AS THE POOL OWNER — it reads <poolRoot>/_state/, the deployed clones, and the ops token:
//
//   node scripts/live-surface-check.mjs
//
// The token comes from PORTAL_OPS_TOKEN if set, else from the portal unit's own drop-in (readable only
// by the service owner). It is never printed, never logged, and never included in --json output.
//
// Exit 0 = every check that could run, passed. Exit 1 = a real disagreement. Exit 2 = could not run.
//
// It prints SHAPE, never CONTENT: counts of customers, never their names; the register's name, never
// its credentials. The response leak-scan below is belt-and-braces on top of that.

import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";

import { mcpToolCall } from "../driver/portal-mcp-client.mjs";
import { readFlagSnapshot, builtFor, isStale, postureDelta, PRODUCTION_POSTURE } from "../driver/flag-snapshot.mjs";
import { policyFor, productAvailability, ORDERABLE_PRODUCTS } from "../driver/search-policy.mjs";
import { rosterVerdict } from "../driver/roster-verdict.mjs";
import { bundledDemoKeys } from "../driver/bundled-demos.mjs";
import { unitsActiveVerdict } from "../driver/unit-state-verdict.mjs";
import { deploymentBox } from "../shared/deployment-box.mjs";   // — extracted; one allowlist, two readers
import { unitFileDriftVerdict } from "../driver/unit-file-drift.mjs";   //
import { placeholdersIn, resolveValues, renderUnit } from "../driver/systemd/render-units.mjs";   //
import { CHECKED_UNITS, unitInventoryVerdict, serviceCommitVerdict, unitWorkingDirectory } from "../driver/unit-inventory.mjs";   // · -bundle ·
import { findUnitFiles, unitFilePath } from "../driver/unit-files.mjs";   //
import { managerGroupsVerdict } from "../driver/manager-groups-verdict.mjs";   //
import { config } from "../driver/driver.config.mjs";                          //
import { probeQueueWatch } from "../driver/queue-watch-probe.mjs";              // ·
import { doorPostureVerdict } from "../mcp-server/door-posture.mjs";   // — a door whose mode came from another door's variables
import { readDrainerStamp, drainerVerdict, defaultPpidOf } from "../driver/drainer-identity.mjs";   // — the process that EXECUTES runs
import { claimerIsAlive } from "../driver/claim-liveness.mjs";                       // the shared liveness test, same polarity as the queue's
import { processTable } from "../shared/process-table.mjs";                          // — /proc is not the only box
import { envFrom } from "../shared/env-aliases.mjs";   // — the name a reader is told to set is the one in force

const HERE = dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes("--json");
const expectHead = process.argv.includes("--expect-head")
  ? process.argv[process.argv.indexOf("--expect-head") + 1] : null;

// — no literal fallback, for exactly the reason the note below this gives about door URLs: a check
// whose pool root falls through to a hardcoded default reports on an instance nobody asked about, and
// says "ok" while doing it. Unset refuses and names the variable.
const POOL_ROOT = envFrom(process.env, "CLEAROTRON_REPORTS_DIR") ?? "";
if (!POOL_ROOT) {
  console.error(`live-surface-check: CLEAROTRON_REPORTS_DIR is not set, and there is no default.`);
  console.error("  It used to fall back to /srv/trademark-archive — production — so an unset variable");
  console.error("  probed the production surface and reported it as this instance's. Set it to the pool");
  console.error("  of the instance you mean to check (the same value that instance's services run with).");
  process.exit(2);
}

// Every door URL is derived from THE SAME environment the services themselves are started with, so a
// check run against one instance can never silently probe another's door. This is not hypothetical: the
// first run of this script against the test instance reported on PRODUCTION's ops-MCP, because the URL
// fell through to a hardcoded default while the pool root correctly pointed at test. A cross-instance
// probe that reports "ok" is worse than no probe at all.
const at = (host, port) => `http://${host || "127.0.0.1"}:${port}`;
const MCP_URL = process.env.TRADEMARK_MCP_URL
  || (process.env.TRADEMARK_MCP_HTTP_PORT ? at(process.env.TRADEMARK_MCP_HTTP_HOST, process.env.TRADEMARK_MCP_HTTP_PORT) : "http://127.0.0.1:18792");
const PORTAL_URL = process.env.PORTAL_URL
  || (process.env.PORTAL_SERVICE_PORT ? at(process.env.PORTAL_SERVICE_HOST, process.env.PORTAL_SERVICE_PORT) : "http://127.0.0.1:18802");
const CLIENT_MCP_URL = process.env.CLIENT_MCP_URL
  || (process.env.CLIENT_MCP_HTTP_PORT ? at(process.env.CLIENT_MCP_HTTP_HOST, process.env.CLIENT_MCP_HTTP_PORT) : "http://127.0.0.1:18811");

// The bundled demo roster, as `list_profiles` REPORTS it. A door that resolves exactly this set is a
// door with no CLEAROTRON_CUSTOMERS_DIR — #83. Compared as a set, not a count: a deployment may legitimately
// have three customers.
//
// DERIVED FROM THE DIRECTORY THAT SHIPS IT, never written down here. As a hand-maintained triple this
// went stale the day a fourth bundle landed: the set-equality could no longer match anything, so the
// #83 detector returned PASS on the #83 condition — a guard that cannot match reports that it found
// nothing wrong. The two earlier faults on this same constant failed CLOSED and someone investigated;
// this one failed open. `generic` is excluded by the derivation, because `list_profiles` reports it as
// `genericFallback` rather than as a member of `clients[]`.
const BUNDLED_PROFILES_DIR = join(HERE, "..", "driver", "profiles");

// The ops token, resolved the way the portal resolves it. Held in a closure-ish const and never emitted:
// no check detail below interpolates it, and --json serialises `results` only.
const OPS_TOKEN = (() => {
  if (process.env.PORTAL_OPS_TOKEN) return process.env.PORTAL_OPS_TOKEN;
  const dropIn = process.env.PORTAL_OPS_TOKEN_FILE
    || `${process.env.HOME ?? ""}/.config/systemd/user/trademark-portal.service.d/secrets.conf`;
  try { return (readFileSync(dropIn, "utf8").match(/^\s*Environment=(?:")?PORTAL_OPS_TOKEN=(?:")?([^"\n]+)/m) ?? [])[1] ?? ""; }
  catch { return ""; }
})();

const results = [];
const record = (name, state, detail) => { results.push({ name, state, detail }); return state === "pass"; };
const pass = (n, d) => record(n, "pass", d);
const fail = (n, d) => record(n, "fail", d);
const skip = (n, d) => record(n, "skip", d);   // could not be reached — never counted as a pass

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

function getJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, method: "GET" }, (res) => {
      let d = ""; res.on("data", (c) => { d += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, text: d }); } });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

function tcpAlive(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = httpRequest({ host: u.hostname, port: u.port, path: "/", method: "GET" }, (res) => { res.resume(); resolve(true); });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

// — TWO DEFECTS IN FOUR LINES, and both were invisible because the helper was doing its job
// quietly. `execFileSync` INHERITS stderr unless told otherwise, so every failed probe printed straight
// into the deploy journal: `fatal: cannot change to '!/home/operator'` on all eleven ticks measured on
// 2026-08-19. One `fatal:` an hour is the line that trains a reader to skim past `fatal:`, which is a
// cost paid by the next incident, not this one. And the bare `catch` threw away the sentence git had
// just written explaining itself, leaving `null` to mean "no clone here" and "could not ask" equally.
//
// `gitTry` keeps the reason; `git` stays exactly as it was for the callers that only want the value.
const gitTry = (repo, ...args) => {
  try {
    return { ok: true, out: execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), err: null };
  } catch (e) {
    return { ok: false, out: null, err: String(e?.stderr || e?.message || e).replace(/\s+/g, " ").trim().slice(0, 120) };
  }
};
const git = (repo, ...args) => gitTry(repo, ...args).out;

// — `systemctl --user` NEEDS A USER BUS, and a caller without one gets an error, not an empty list.
// Under sudo, a systemd timer, or any non-login shell, XDG_RUNTIME_DIR is unset and every `--user` call
// fails with "Failed to connect to bus". The arm below swallowed that in a bare catch and reported it as
// "no unit reported a WorkingDirectory (not a systemd --user deployment?)" — a conclusion about the SHAPE
// of the deployment, derived from a failure to look, on the one instance that deploys itself hourly with
// nobody watching. This derives the bus the same way a login shell would, so the arm can actually run.
function userBusEnv() {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR) {
    try { env.XDG_RUNTIME_DIR = `/run/user/${execFileSync("id", ["-u"], { encoding: "utf8" }).trim()}`; }
    catch { /* leave it unset — the probe below then reports that it could not look */ }
  }
  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR)
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
  return env;
}

// systemd user units → the clone each one actually runs from. This is what catches the straddle: the
// answer comes from the RUNNING unit's WorkingDirectory, not from a path anybody wrote down.
//
// Returns {clones, probe}. `probe` is the honest answer to "could I look at all?" — {ok, why} — and it is
// SEPARATE from the clones list on purpose. "enumerated, nothing to compare" and "could not enumerate"
// were the same empty array before, and this suite exists because absences were read as successes.
function serviceClones() {
  // — the list is DECLARED, not written here. It used to be eight names inline, which put a unit
  // inside the drift guarantee or outside it by omission: `client-access` was live on production and in
  // no list at all, and `prelim-outbox` was tracked, live on production, and equally invisible. Both are
  // in the inventory now, and so is the reason each untracked unit is untracked.
  const units = [...CHECKED_UNITS];
  const env = userBusEnv();
  const out = [];
  let reached = 0, lastErr = null;
  for (const u of units) {
    let wd = null, active = null, type = null, since = null;
    try {
      // — `Type` and `StateChangeTimestamp` ride along on a call that was already being made. Both
      // are for the MESSAGE, never for the verdict: Type tells a reader whether an `activating` unit is a
      // oneshot mid-fire or a service mid-restart, and the timestamp lets a human judge a long
      // `activating` that this check deliberately does not judge (see driver/unit-state-verdict.mjs).
      const shown = execFileSync("systemctl", ["--user", "show", u,
        "-p", "WorkingDirectory", "-p", "ActiveState", "-p", "Type", "-p", "StateChangeTimestamp"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
      // `show` answers for a unit that does not exist too (ActiveState=inactive), so a PARSED answer is
      // proof the bus was reachable — which is exactly the fact the old catch destroyed.
      reached += 1;
      for (const line of shown.split("\n")) {
        const [k, ...v] = line.split("=");
        if (k === "WorkingDirectory") wd = v.join("=") || null;
        if (k === "ActiveState") active = v.join("=") || null;
        if (k === "Type") type = v.join("=") || null;
        if (k === "StateChangeTimestamp") since = v.join("=") || null;
      }
    } catch (e) { lastErr = String(e?.stderr || e?.message || e).replace(/\s+/g, " ").trim().slice(0, 160); }
    // — an inactive unit reporting nothing is NOT a gap in the population; there is genuinely
    // nothing to compare, and `unreadable: null` says so. Only the two branches below are gaps.
    if (!wd) { out.push({ unit: u, active, type, since, clone: null, head: null, unreadable: null }); continue; }
    const parsed = unitWorkingDirectory(wd);
    if (!parsed.path) { out.push({ unit: u, active, type, since, clone: null, head: null, unreadable: parsed.why }); continue; }
    const top = gitTry(parsed.path, "rev-parse", "--show-toplevel");
    if (!top.ok) { out.push({ unit: u, active, type, since, clone: null, head: null, unreadable: `git could not read ${parsed.path}: ${top.err}` }); continue; }
    const root = top.out;
    const head = gitTry(root, "rev-parse", "HEAD");
    out.push({ unit: u, active, type, since, clone: root, head: head.ok ? head.out : null,
      unreadable: head.ok ? null : `git could not read HEAD in ${root}: ${head.err}` });
  }
  const probe = reached > 0
    ? { ok: true, why: null }
    : { ok: false, why: lastErr || "systemctl --user answered for no unit and reported no error" };
  return { clones: out, probe };
}

// A door must never hand a caller an internal name or a filesystem path. CI greps the built bundle for
// CLEAROTRON_; this is the same guard on the LIVE JSON, where a regression actually reaches a client.
function leaks(payload) {
  const s = JSON.stringify(payload ?? {});
  const hits = [];
  // step 4.0 — BOTH spellings. This matched only the retired prefix, so the day a door started
  // handing back a converted name the leak stopped being detected: the guard goes quiet, not red.
  if (/CLEAROTRON_[A-Z0-9_]+/.test(s)) hits.push("CLEAROTRON_* env name");
  if (/CLEAROTRON_[A-Z0-9_]+/.test(s)) hits.push("CLEAROTRON_* env name");
  if (/TRADEMARK_MCP_[A-Z0-9_]+/.test(s)) hits.push("TRADEMARK_MCP_* env name");
  if (/\/(srv|home)\/[a-z0-9._-]+/i.test(s)) hits.push("filesystem path");
  return hits;
}


// — the supplementary groups the RUNNING `systemd --user` manager holds, read from the kernel
// rather than inferred. Returns {groups, why}: `groups: null` with a stated reason is "could not look",
// which the verdict turns into a skip. Never throws — an environment probe must not fail a health check
// by crashing it.
function readUserManagerGroups(uid) {
  if (!uid) return { groups: null, why: "could not determine this process's uid" };
  let pids;
  try { pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d)); }
  catch (e) { return { groups: null, why: `/proc unreadable (${e.code ?? e.message})` }; }
  for (const pid of pids) {
    let cmdline;
    try { cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
    // The manager's argv is `/usr/lib/systemd/systemd --user` (NUL-separated). `--user` is what
    // separates it from the system manager and from any other systemd process.
    if (!cmdline.includes("systemd") || !cmdline.includes("--user")) continue;
    let status;
    try { status = readFileSync(`/proc/${pid}/status`, "utf8"); } catch { continue; }
    const ownUid = /^Uid:\s+(\d+)/m.exec(status)?.[1];
    if (ownUid !== String(uid)) continue;                 // someone else's manager — not ours to judge
    const groupsLine = /^Groups:\s*(.*)$/m.exec(status)?.[1] ?? "";
    const groups = groupsLine.trim() ? groupsLine.trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];
    return { groups, why: null };
  }
  return { groups: null, why: `no \`systemd --user\` process found for uid ${uid}` };
}

// ── the checks ───────────────────────────────────────────────────────────────────────────────────────

// 1. The flag snapshot — the on-disk truth every other answer is measured against.
const snapshot = readFlagSnapshot(POOL_ROOT);
let built = null;
if (!snapshot) {
  fail("flag snapshot readable", `absent under ${POOL_ROOT}/_state — availability cannot be verified against anything`);
} else {
  built = builtFor(snapshot);
  const stale = isStale(snapshot, { now: Date.now() });
  const age = snapshot.capturedAt ? `captured ${snapshot.capturedAt}` : "no capturedAt";
  // Staleness is SHOWN, never acted on (flag-snapshot.mjs's own rule) — the driver rewrites it every
  // fire, so a stale one means the driver has not run, which is worth saying and is not this check's call.
  record("flag snapshot readable", stale ? "warn" : "pass",
    `${age}${stale ? " — STALE (>24h): has the driver fired?" : ""} · built=${Object.entries(built).filter(([, v]) => v).map(([k]) => k).join(",") || "none"}`);
}

// 1a. — DOES THE USER MANAGER STILL HOLD THE USER'S GROUPS?
//
//     Placed FIRST among the environment checks because it explains other checks' failures. When it
//     fired for real, what the operator saw was `roster resolves` failing with EACCES on a path whose
//     permissions were correct — a symptom that points at chmod, which on a set-GID tree makes it worse.
//     The cause is that `systemd --user` captures supplementary groups once, at start, and every service
//     it spawns inherits that set until `user@<uid>.service` itself is restarted.
//
//     ADDITIVE AND SAFE ON PRODUCTION: prod runs its services from SYSTEM units, so there is no user
//     manager to compare against and this SKIPS. A skip is never a pass here (see record()).
{
  const uid = (() => { try { return execFileSync("id", ["-u"], { encoding: "utf8" }).trim(); } catch { return null; } })();
  const user = (() => { try { return execFileSync("id", ["-un"], { encoding: "utf8" }).trim(); } catch { return "this user"; } })();
  const idGroups = (() => {
    try { return execFileSync("id", ["-G"], { encoding: "utf8" }).trim().split(/\s+/).map(Number).filter(Number.isFinite); }
    catch { return null; }
  })();
  const { groups: managerGroups, why } = readUserManagerGroups(uid);
  const { state, message } = managerGroupsVerdict({ idGroups, managerGroups, user, uid, why });
  ({ pass, fail, skip })[state]("user manager groups are current", message);
}

// 1b. — HOW THIS BOX DIFFERS FROM PRODUCTION on the flags that change output without saying so.
//     This check exists because a round report said "the China lane is verified" when two of its three
//     slices could not run here: the flags were unset, jx-units.mjs makes a run byte-identical to
//     slice-1 behaviour with them off, and nothing anywhere compared the two boxes. Not probed is not
//     passed — but here it was not probed AND not mentioned, which is worse.
//
//     A DELTA IS NOT A FAILURE. Test is allowed to differ from production; what it is not allowed to do
//     is differ silently, and then have a round claim coverage it does not have. So a delta is a `warn`
//     that names every line of itself, and the absent snapshot — which cannot be compared at all — is
//     the one that fails.
if (!snapshot) {
  fail("posture vs production", "no flag snapshot, so this box's jx and EUIPO posture cannot be compared with production's — an unknown posture is not a matching one");
} else {
  const delta = postureDelta(snapshot);
  if (delta === null) {
    fail("posture vs production", "the snapshot carries no flags block");
  } else if (!delta.length) {
    pass("posture vs production", `matches production on ${Object.keys(PRODUCTION_POSTURE.flags).join(", ")} and EUIPO`);
  } else {
    record("posture vs production", "warn",
      `${delta.length} difference(s) from production — a round report must not claim coverage for any of these: `
      + delta.map((d) => `${d.what} here=${d.here} prod=${d.production}`).join(" · ")
      + ` [production posture: ${PRODUCTION_POSTURE.source}]`);
  }
}

// 2. The register that is actually wired. A deployment whose register cannot count reports Depth 2
//    unavailable — so this is not trivia, it is an INPUT to check 3.
const wiredRegister = snapshot?.register?.provider ?? null;
if (wiredRegister) pass("register wired", `${wiredRegister} · canCount=${snapshot.register?.canCount === true}`);
else skip("register wired", "the snapshot carries no register block");

// 3a. The roster a door RESOLVES, vs the roster on disk. #83: no CLEAROTRON_CUSTOMERS_DIR ⇒ the bundled demos
//     ⇒ every real customer refused. Counts and set-identity only — never a customer name.
//     Runs BEFORE the availability checks because plan_run needs a profile to plan against, and taking
//     it from what the door itself resolved is what keeps a customer key out of this source file.
let probeProfileKey = null;
try {
  const listed = await mcpToolCall({ url: MCP_URL, token: OPS_TOKEN, tool: "list_profiles", args: {}, timeoutMs: 15000 });
  const keys = (Array.isArray(listed?.clients) ? listed.clients : []).map((p) => p.key ?? p.profileKey).filter(Boolean).sort();
  probeProfileKey = keys[0] ?? null;
  const dir = envFrom(process.env, "CLEAROTRON_CUSTOMERS_DIR");
  // `generic` is EXCLUDED, for the same reason the derivation above drops it: `list_profiles`
  // reports it as `genericFallback`, not as a member of `clients[]`. Comparing a directory listing that
  // counts it against a door answer that does not would report a disagreement on every correctly
  // configured store — 4 files vs 3 clients on test, 11 vs 10 on prod. Both sides must mean the same
  // thing before they can be compared at all.
  const onDisk = dir && existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
        .filter((k) => k !== "generic").sort() : null;

  // Distinguish the two zero-ish answers, because they mean opposite things and an earlier draft of this
  // script conflated them:
  //   clients: 0        → an accounts-scoped session with NO accounts, i.e. THIS CALLER is unscoped.
  //                       A statement about the probe, not the deployment. Never a failure.
  //   clients: <demos>  → the door resolved the BUNDLED roster, i.e. CLEAROTRON_CUSTOMERS_DIR is not reaching
  //                       the service. A statement about the deployment. This is #83.
  // On the TEST instance the bundled roster is the CORRECT answer — CLEAROTRON_CUSTOMERS_DIR is deliberately
  // unset there so real client bundles never reach it. Same observation, opposite verdict, so the
  // instance has to say which it is rather than the check guessing from a hostname or a path.
  // The decision lives in driver/roster-verdict.mjs so it can be tested. It had produced a false
  // refusal twice, both from an exact match against a hard-coded list standing in for the property being
  // protected; inside this top-level-await script neither could be caught by a test.
  // The derivation THROWS rather than handing back an empty set, and the throw is caught here on its own
  // so it cannot be reported as a list_profiles fault. Either way it is never a pass: an unreadable
  // profiles directory means #83 cannot be ruled out, which is a could-not-look and says so.
  let bundledDemos = null;
  try { bundledDemos = bundledDemoKeys({ profilesDir: BUNDLED_PROFILES_DIR }); }
  catch (e) { fail("roster resolves", `the bundled roster could not be derived, so #83 cannot be ruled out: ${e.message}`); }

  if (bundledDemos) {
    const { state, message } = rosterVerdict({ keys, onDisk, bundledDemos, expectDemos: process.env.CLEAROTRON_E2E_EXPECT_DEMO_ROSTER === "1" });
    ({ pass, fail, skip })[state]("roster resolves", message);
  }
} catch (e) {
  fail("roster resolves", `list_profiles failed: ${e.message}`);
}

// 3. THE LOAD-BEARING CHECK — every door's availability answer vs the engine's own, recomputed here
//    from the snapshot. This is #98: the MCP disagreed with the portal because it derived availability
//    from its own process environment instead of from this file.
let mcpOptions = null;
try {
  mcpOptions = await mcpToolCall({ url: MCP_URL, token: OPS_TOKEN, tool: "describe_options", args: {}, timeoutMs: 20000 });
  pass("ops-MCP reachable", `${MCP_URL} answered describe_options`);
  // ── — REACHABLE IS NOT THE SAME AS DELIBERATE ─────────────────────────────
  //
  // The arm above already travels the route the harness uses (`mcpToolCall` on `MCP_URL`, the same
  // client `scripts/e2e.mjs` enqueues through), so a door that 401s every caller ALREADY fails this
  // check and already fails the deploy — `scripts/deploy-test.sh` gates on this script's exit code.
  // That is the issue's first criterion, by its sanctioned second branch, and its third and fourth.
  //
  // What neither arm could say is WHY the door has the posture it has. This face reaches the auth-proxy
  // branch when `TRADEMARK_MCP_AUTH_MODE` is unset OR EMPTY, and then satisfies itself from the
  // PORTAL's `CF_ACCESS_TEAM` / `CLEAROTRON_OIDC_AUDIENCE` — so one door's configuration decides
  // another's, which is the issue's second criterion. It is recorded whether or not the probe above
  // succeeded, because a door that answers today through a tunnel somebody set up by hand is one
  // ingress change away from the four-and-a-half-hour silence, and nothing else on this box says so.
  {
    const posture = doorPostureVerdict({
      declaredMode: process.env.TRADEMARK_MCP_AUTH_MODE,
      effectiveMode: (process.env.TRADEMARK_MCP_AUTH_MODE || "").trim().toLowerCase() === "token" ? "token" : "cf-access",
      allowedHosts: (process.env.TRADEMARK_MCP_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
    });
    record("the ops door's auth mode was chosen for it", posture.state, posture.message);
  }
} catch (e) {
  fail("ops-MCP reachable", `${MCP_URL}: ${e.message}`);
}

if (mcpOptions && built) {
  const doorSays = new Map();
  // `products`, not `levels` — the wire key the offering ships under. Reading the old key would
  // hand this loop an empty map and it would compare NOTHING while reporting a pass, which is the exact
  // failure shape this whole script exists to catch, turned on itself.
  const offered = mcpOptions.products;
  if (!Array.isArray(offered)) fail("describe_options returns the offering", "no `products` array in the response — this check cannot compare what it cannot read");
  for (const lvl of (offered ?? [])) doorSays.set(lvl.key ?? lvl.product, lvl.available !== false);

  const disagreements = [];
  const seen = [];
  for (const key of ORDERABLE_PRODUCTS) {
    const engineSays = productAvailability(policyFor(key), { built }) === null;
    if (!doorSays.has(key)) { disagreements.push(`${key}: the door does not offer it at all; the engine says ${engineSays ? "AVAILABLE" : "unbuilt"}`); continue; }
    seen.push(key);
    if (doorSays.get(key) !== engineSays) {
      disagreements.push(`${key}: door=${doorSays.get(key) ? "available" : "unavailable"} engine=${engineSays ? "available" : "unbuilt"}`);
    }
  }
  for (const key of doorSays.keys()) if (!ORDERABLE_PRODUCTS.includes(key)) disagreements.push(`${key}: the door offers a product the engine's registry does not define`);

  if (disagreements.length) fail("doors agree with the engine on product availability", disagreements.join(" · "));
  else pass("doors agree with the engine on product availability", `${seen.length} products, all matching: ${seen.join(", ")}`);

  // 3b. describe_options and plan_run are two independent code paths (lib/options.mjs, lib/plan.mjs).
  //     #98 lived in both, so agreement here is necessary-but-not-sufficient — 3 above is the real test.
  //
  //     plan_run needs an explicit profileKey: an accounts-scoped session refuses without one. The key
  //     comes from what the door ITSELF resolved (below), so no customer is ever hardcoded here.
  const planDisagreements = [];
  for (const key of (probeProfileKey ? seen : [])) {
    try {
      const plan = await mcpToolCall({ url: MCP_URL, token: OPS_TOKEN, tool: "plan_run",
        args: { markName: "SURFACE CHECK", classes: [9], product: key, profileKey: probeProfileKey }, timeoutMs: 20000 });
      const unavailable = (plan?.blockers ?? []).some((b) => /not part of the current release|not switched on|unavailable/i.test(String(b)));
      if (unavailable !== !doorSays.get(key)) {
        planDisagreements.push(`${key}: describe_options=${doorSays.get(key) ? "available" : "unavailable"} plan_run=${unavailable ? "unavailable" : "available"}`);
      }
    } catch (e) { planDisagreements.push(`${key}: plan_run errored — ${e.message.slice(0, 120)}`); }
  }
  if (!probeProfileKey) skip("describe_options and plan_run agree", "no customer resolved to plan against — see the roster check");
  else if (planDisagreements.length) fail("describe_options and plan_run agree", planDisagreements.join(" · "));
  else pass("describe_options and plan_run agree", `${seen.length} products checked through both code paths`);
}

// 5. Leak scan on what a door actually returned. An env name or a path in a live response is a defect
//    whether or not a client happened to be the one reading it.
if (mcpOptions) {
  const hits = leaks(mcpOptions);
  if (hits.length) fail("no internal names leak through the door", hits.join(", "));
  else pass("no internal names leak through the door", "describe_options carries no env name and no filesystem path");
}

// 6. The portal. Only /portal/health is reachable without a Cloudflare Access JWT — everything else is
//    NOT PROBED, and says so rather than passing by omission.
const health = await getJson(`${PORTAL_URL}/portal/health`);
if (health.status !== 200 || !health.json) fail("portal health", `${PORTAL_URL}/portal/health → ${health.status || health.error}`);
else if (health.json.ui !== "built") fail("portal health", `ui="${health.json.ui}" — the portal is serving a stale or missing bundle (never add --omit=dev to the deploy)`);
else pass("portal health", `ok=${health.json.ok} ui="${health.json.ui}"`);
skip("portal gates agree", "every portal route but /portal/health is behind Cloudflare Access — not callable from a script, so NOT probed");

// 7. client-MCP liveness only, for the same reason. Its API-key door's secret is a crown jewel and is
//    never read, let alone logged, by this script.
skip("client-MCP", (await tcpAlive(CLIENT_MCP_URL)) ? "listening; behind CF Access so its answers are NOT probed" : `not listening on ${CLIENT_MCP_URL}`);

// 8. Every service on the commit you think it is. This is the straddle check.
const { clones, probe: unitProbe } = serviceClones();
const running = clones.filter((c) => c.head);
const heads = [...new Set(running.map((c) => c.head))];
// — THREE OUTCOMES, NOT TWO. This arm is the one whose entire purpose is to catch a service still
// running an old bundle after a deploy, and deploy-test.sh runs it as the final gate on an instance that
// deploys itself every hour. It had been degrading to `skip` with a reason that ASSERTED the deployment
// was not systemd --user — on a box where it is, and where the units are running.
//   · could not look       → skip, naming the error. Not probed is not passed.
//   · looked, found none   → skip, saying so. A genuinely non-systemd deployment lands here honestly.
//   · looked, found units  → the real comparison below.
//
// SCOPED TO THE UNITS THIS DEPLOY OWNS. Until now the comparison ran over every unit in CHECKED_UNITS,
// which is "every unit this repo has heard of on any box" — on production that includes `client-access`
// (a script from a different product's checkout) and the Clawdi bridges, whose WorkingDirectories are in
// another clone. The deploy skill forbids a trademark deploy from restarting `client-access`, so the arm
// demanded commit agreement from services this deploy must not move, and reddened on every prod deploy
// for units behaving correctly. The discriminator is the CLONE, which `serviceClones()` has read all
// along; see `serviceCommitVerdict` for why it is not `tracked`.
const deployClone = git(HERE, "rev-parse", "--show-toplevel");
if (!unitProbe.ok)
  skip("services share one commit", `could not enumerate systemd --user units, so the commit was NOT compared — ${unitProbe.why}. This is a failure to look, not a finding about the deployment`);
// — THE SAME DEFECT ONE BRANCH UP, found reviewing this change rather than in the issue. This
// short-circuit answered "no unit reported a WorkingDirectory" for EVERY empty population, including one
// where all five units reported a WorkingDirectory and none of them could be read. That is the arm
// narrowing its population silently, one level above the place names — and it is the branch that
// fires precisely when the box is most broken. The verdict already distinguishes the two and carries the
// unreadable disclosure, so the decision belongs there and not in a pre-filter.
else {
  const ownedClone = running.find((c) => String(c.clone ?? "").replace(/\/+$/, "") === String(deployClone ?? "").replace(/\/+$/, ""));
  const ahead = ownedClone ? (git(ownedClone.clone, "status", "-sb")?.includes("ahead") ?? false) : false;
  // — ALL the clones, not just the ones with a head. The verdict scopes to owned units itself;
  // passing it the pre-filtered list is what made the units it could not read invisible to the sentence
  // it prints.
  const v = serviceCommitVerdict({ clones, deployClone, expectHead, ahead });
  if (v.state === "fail") fail("services share one commit", v.message);
  else if (v.state === "skip") skip("services share one commit", v.message);
  else pass("services share one commit", v.message);
}
// ── 8b. — THE PROCESS THAT EXECUTES RUNS, WHICH ARM 8 CANNOT SEE ────────────
//
// Arm 8 above compares the commits of unit-managed SERVICES. None of them runs a clearance. The queue
// drainer does — it imports the pipeline and calls it in-process — and on 2026-08-27 it was not a unit
// at all: an orphan of an earlier `clearotron start` in a `closing` SSH session with PPID 1. It sat 22
// commits back through two deploys while arm 8 compared its three services, found them all on the
// deployed commit, and passed. A population derived from `systemctl list-units` cannot contain a
// process that is in no unit, so this arm derives from the PROCESS TABLE and from a stamp the drainer
// writes about itself.
//
// IT FAILS ON COULD-NOT-LOOK, and that is deliberate. This script exits non-zero on `fail` only —
// `skip` does not move the exit code — so recording an absent stamp as a skip would let the deploy
// report a build live having never established what the executing process holds, which is the exact
// state the incident's drainer was in. The fourth criterion of that issue is that the deploy does not
// report a build live until this arm has looked; a skip here would be that criterion silently unmet.
{
  let workspaceRoot = null, resolveError = null;
  try { workspaceRoot = config.workspaceRoot; }
  catch (e) { resolveError = String(e?.message ?? e).slice(0, 160); }

  if (!workspaceRoot) {
    fail("the process that executes runs is on the deployed commit",
      `the workspace root could not be resolved (${resolveError ?? "no value"}), so the drainer's stamp could not be found. `
      + "This is a failure to look, never a pass.");
  } else {
    // `null` from processTable is UNREADABLE, not empty — the verdict distinguishes them, because
    // "no drainer is running" and "I could not see the process table" are the same empty array and only
    // one of them is a finding about the box.
    let processes = null;
    try { processes = processTable(); } catch { processes = null; }
    const v = drainerVerdict({
      stamp: readDrainerStamp(workspaceRoot),
      headCommit: git(deployClone ?? HERE, "rev-parse", "HEAD"),
      isAlive: claimerIsAlive,
      processes,
      // second criterion — an orphaned drainer in a closed login session is a
      // state health must say out loud, whatever the ruling on the posture.
      ppidOf: defaultPpidOf,
    });
    record("the process that executes runs is on the deployed commit", v.state, v.message);
  }
}

//: "0 active" is not a pass. It is either "I could not look" or "there is nothing running here".
//: and "not active" is not "broken". Both state comparisons this arm used to make lived here as
// inline string equality over a two-word vocabulary, which is why a `Type=oneshot` doing its job read as
// a fault on the deploy's final gate. The decision now lives in driver/unit-state-verdict.mjs, where a
// test can reach it — same move made for the roster arm, for the same reason.
// `record`, not the ({pass, fail, skip})[state] shorthand used above: `warn` is a real outcome here.
{
  const v = unitsActiveVerdict({ units: clones, probe: unitProbe });
  record("units active", v.state, v.message);
}

// 10. — THE UNIT A BOX RUNS versus the unit the deployed commit SHIPS. The deploy syncs code, not
// systemd units, and nothing said so: the test instance pulled a commit changing
// driver/systemd/prelim-driver.service, the live unit did not change, and every check above stayed
// green — because the unit that is running is a perfectly valid unit, just not the one in the commit.
// The verdict is in driver/unit-file-drift.mjs so a test can reach it; the reading is here.
//
// second pass: the tracked file is now found by a REPO-WIDE walk, not by joining driver/systemd/.
// mcp-server/remote/ holds three tracked units and providers/oauth-mcp-bridge/systemd/ a fourth; every
// one of them reported "runs from no file" and was compared against nothing, while the repo's own
// governance doc names both directories. One walk per clone, memoised, so a straddled deployment does
// not walk the same tree twice.
{
  const env = userBusEnv();
  const walks = new Map();
  const walkFor = (clone) => {
    if (!walks.has(clone)) walks.set(clone, findUnitFiles(clone));
    return walks.get(clone);
  };
  const rows = clones.map((c) => {
    let live = null, dropIns = [], fragName = null;
    try {
      const shown = execFileSync("systemctl", ["--user", "show", c.unit, "-p", "FragmentPath", "-p", "DropInPaths"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
      const frag = /^FragmentPath=(.*)$/m.exec(shown)?.[1]?.trim() || null;
      dropIns = (/^DropInPaths=(.*)$/m.exec(shown)?.[1] ?? "").split(/\s+/).filter(Boolean);
      if (frag) {
        // THE FRAGMENT'S OWN BASENAME IS THE KEY, not the name this script asked about. The unit list
        // above carries bare names (`prelim-driver`), systemd resolves them to `prelim-driver.service`,
        // and driver/systemd/ is keyed by the resolved name — so joining the bare name found nothing and
        // every unit reported "no tracked file", which is a comparison that never happens wearing the
        // shape of one that did.
        fragName = frag.slice(frag.lastIndexOf("/") + 1);
        try { live = readFileSync(frag, "utf8"); } catch { live = null; }
      }
    } catch { /* unreadable ⇒ live stays null, and the verdict counts it as NOT compared */ }
    let tracked = null;
    if (c.clone && fragName) {
      const rel = unitFilePath(walkFor(c.clone), fragName);
      if (rel) { try { tracked = readFileSync(join(c.clone, rel), "utf8"); } catch { tracked = null; } }
    }
    // option B — COMPARE AGAINST THE RENDERED TEXT, NOT THE TEMPLATE.
    //
    // Three tracked units carry `@NAME@` placeholders because configuration cannot reach them (a .path
    // unit reads no environment at all; two others deliberately load no EnvironmentFile). The installed
    // copy is RESOLVED, so comparing it to the tracked template would report drift on every box, for
    // every one of them, forever — a guard that cries wolf is a guard that gets ignored, and exists
    // because a real drift went unnoticed.
    //
    // AND A VALUE WE CANNOT RESOLVE MAKES THE UNIT UNCOMPARED, NOT DRIFTED. `tracked = null` routes it
    // into the verdict's "had no readable fragment and were NOT compared" channel, which this file
    // already states separately rather than absorbing into the pass — the rule, one layer down.
    // Reporting drift we cannot substantiate would be a finding about the deployment invented out of a
    // failure to look.
    if (tracked && placeholdersIn(tracked).length) {
      const { values, missing } = resolveValues(placeholdersIn(tracked), { envFile: join(homedir(), ".env") });
      tracked = missing.length ? null : renderUnit(tracked, values);
    }
    return { unit: fragName ?? c.unit, live, tracked, dropIns };
  });
  const v = unitFileDriftVerdict({ units: rows, probe: unitProbe });
  record("units match the deployed commit", v.state, v.message);
}

// 10a. — IS EVERY UNIT THIS BOX RUNS ACCOUNTED FOR AT ALL?
//
// The check above compares a unit against its tracked file. It can only do that for units it was told
// to look at, and the list was eight names written inline — so `client-access` ran on production, in no
// list, compared against nothing, and reported by nothing. `prelim-outbox` was the mirror: tracked and
// live on production, and equally absent from the list, so its drift was never checked either.
//
// This arm asks the question one level up. It is deliberately NOT the drift comparison: a unit can be
// legitimately untracked (the CF Access units carry live values inline and ship as templates), and that
// is a DECLARATION, with a reason, in driver/unit-inventory.mjs. What must never happen is a unit being
// outside the guarantee by nobody having written it down.
{
  const env = userBusEnv();
  let liveUnits = [], probe = { ok: true };
  try {
    // Every unit the user manager knows about, not only the ones asked for — the whole point is to find
    // the ones nobody thought to ask about. Asking only about the declared names would make "undeclared"
    // unreachable by construction.
    const out = execFileSync("systemctl", ["--user", "list-units", "--type=service,timer,path", "--all",
      "--no-legend", "--plain", "--no-pager"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    const all = out.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((u) => u && u.includes("."));
    // ── SCOPED TO THIS DEPLOYMENT'S OWN UNITS, BY WHERE THE FRAGMENT LIVES ──────────────────────────
    //
    // A user manager carries the distribution's units too — dbus, gpg-agent, dirmngr, keyboxd,
    // snapd.session-agent, launchpadlib-cache-clean and friends. Measured on this box: 11 units, 9 of
    // them the distribution's. Feeding those to the inventory would report nine undeclared units and
    // fail the deploy's final gate on every box, which is a check that cries wolf until it is ignored.
    //
    // The discriminator is the fragment's location, read from systemd rather than guessed: a unit this
    // deployment installed lives under the account's own ~/.config/systemd/user/; a distribution unit
    // lives under /usr/lib/systemd/user/ or /etc/systemd/user/. Measured on this box:
    //     sync-skills.service   ~/.config/systemd/user/sync-skills.service
    //     dbus.service          /usr/lib/systemd/user/dbus.service
    //
    // A unit whose fragment cannot be read is EXCLUDED and counted, never assumed to be one of ours:
    // silently promoting an unreadable unit into the inventory's scope would invent a fault.
    const ours = [];
    let unreadable = 0;
    for (const u of all) {
      let frag = null;
      try {
        frag = execFileSync("systemctl", ["--user", "show", u, "-p", "FragmentPath", "--value"],
          { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
      } catch { /* falls through to the unreadable count */ }
      if (!frag) { unreadable++; continue; }
      // Matched anywhere in the path rather than against $HOME. `systemctl --user` only ever answers
      // for THIS user's manager, so "installed as a user unit" is the whole discriminator — and tying
      // it to $HOME would make the arm depend on sudo's env handling, which is the kind of dependency
      // that turns a green check red on one box and nowhere else.
      if (frag.includes("/.config/systemd/user/")) ours.push(u);
    }
    liveUnits = ours;
    if (unreadable) probe = { ok: true, note: `${unreadable} unit(s) had no readable FragmentPath and were not scoped` };
  } catch (e) {
    probe = { ok: false, why: String(e?.message ?? e).slice(0, 160) };
  }
  // Every unit file this tree tracks, wherever it sits — not driver/systemd/ alone. A walk that could
  // not run reports its error rather than an empty list, because "no unit file is unaccounted for" and
  // "I could not look for unit files" are the same empty array and only one of them is a pass.
  const walk = findUnitFiles(join(HERE, ".."));
  // The box names ITSELF via CLEAROTRON_BOX ("prod" | "test"), and is NOT guessed: an unset or
  // unrecognised value suppresses the expected-but-absent arm rather than reporting every production
  // unit missing. Deployments set it in the service environment file beside the other box-scoped vars.
  const box = deploymentBox();   // — the shared rule, so /portal/health cannot disagree with this
  const v = unitInventoryVerdict({ live: liveUnits, files: walk.files, collisions: walk.collisions,
    filesError: walk.error, box, probe });
  record("every live unit is declared", v.state, v.message);
}

// ── — EVERY QUEUE THIS DEPLOYMENT WOULD DRAIN IS WATCHED BY SOMETHING ──────────────────────────
//
// A client clearance was enqueued, acknowledged to the requester, and landed in a queue directory no
// .path unit watches; it sat there while the drain ran twice, with nothing errored and nothing logged.
//
// THE COMPARISON EXISTED AND NOTHING RAN IT. `compareWatches` is pure and tested in
// scripts/drain-preflight.mjs, which is referenced by no unit, no deploy script, and nothing in this
// repo but an npm script and its own tests — a manual diagnostic somebody has to remember. It moves
// here, into the check the deploy already runs and already logs.
//
// IT READS THE RESOLUTION, NOT THE VARIABLE. The incident's empty CLEAROTRON_WORK_DIR fell through to
// a moved default; an ABSENT one falls through identically and is the commoner shape. Asking
// `config.queueDirs` what this deployment would ACTUALLY drain answers both, and the ones nobody has
// thought of yet. The verdict itself is pure and lives beside the other four.
{
  let queueDirs = null, resolveError = null;
  try { queueDirs = config.queueDirs; }
  catch (e) { resolveError = String(e?.message ?? e).slice(0, 160); }

  // — through the SHARED probe. The enqueue doors ask the same question at the other end of the
  // job's life, and two readers of one unit file is how the deploy tick and a door come to different
  // conclusions about the same box. The unit path now has one home.
  const v = probeQueueWatch({ queueDirs, resolveError });
  record("every queue this deployment would drain is watched", v.state, v.message);
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────

const failed = results.filter((r) => r.state === "fail");
const skipped = results.filter((r) => r.state === "skip");

if (asJson) {
  console.log(JSON.stringify({ ok: failed.length === 0, poolRoot: POOL_ROOT, register: wiredRegister, results }, null, 2));
} else {
  const mark = { pass: "  ok  ", fail: " FAIL ", warn: " warn ", skip: " skip " };
  console.log(`\n== live surface check — ${POOL_ROOT} ==\n`);
  for (const r of results) console.log(`[${mark[r.state]}] ${r.name}\n            ${r.detail}`);
  console.log(`\n${failed.length === 0 ? "PASS" : `FAIL — ${failed.length} disagreement(s)`}`
    + `${skipped.length ? ` · ${skipped.length} surface(s) NOT probed (see above — not probed is not passed)` : ""}\n`);
}

process.exit(failed.length === 0 ? 0 : 1);
