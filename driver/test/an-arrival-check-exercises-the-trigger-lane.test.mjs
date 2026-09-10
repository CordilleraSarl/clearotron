// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Criteria 3 and 4 — nothing on this box exercised the trigger lane.
//
// 2026-09-02, on a live outage: the owner could not start a run. `systemctl is-active` said active,
// `/portal/health` answered 200 with ok:true, the engine probe completed a turn, `live-surface-check`
// reported doors, products and engine agreement — and never touched the trigger lane — and the boot log
// announced the lane on the TOKEN's presence alone while `PORTAL_MCP_URL` had never been set on the box.
// A deployment can pass every arrival check here while being unable to start a search, which is the one
// thing the product is for.
//
// WIRED AND REACHABLE ARE SEPARATE SURFACES because they are different faults with different fixes, and
// on that box they failed together — which is exactly how one hides behind the other.
//
// DRIVEN THROUGH THE REAL SCRIPT, not a helper. The finding is that the CHECK did not check; an arm
// against a pure function would hold a verdict nobody calls, which is the shape this repository keeps
// finding.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const CHECK = join(ROOT, "scripts", "live-surface-check.mjs");

/** Run the real arrival check and hand back its lines. Its exit code is not the subject here. */
function surfaces({ url = "", token = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ct112-"));
  mkdirSync(join(dir, "pool"), { recursive: true });
  mkdirSync(join(dir, "ws"), { recursive: true });
  try {
    let out = "";
    try {
      out = execFileSync(process.execPath, [CHECK], { encoding: "utf8", timeout: 240_000,
        env: { ...process.env, CLEAROTRON_REPORTS_DIR: join(dir, "pool"), CLEAROTRON_WORK_DIR: join(dir, "ws"),
          PORTAL_MCP_URL: url, PORTAL_OPS_TOKEN: token } });
    } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    // DID THE CHECK EVEN GET TO ITS SURFACES? It has one preflight refusal (an unset
    // CLEAROTRON_REPORTS_DIR, exit 2) and it can also die on an unhandled throw, and in BOTH cases it
    // prints no surface lines at all. Without this the next assertion reads that silence as "the
    // trigger lane surface is missing" — the finding this file exists to make — and four arms would
    // report a runner that could not start the script as the feature being absent. Absence is a
    // finding, but it has to be the RIGHT one: say could-not-look, and quote what the script said.
    assert.ok(/== live surface check —/.test(out),
      `the arrival check never reached its report, so this arm could not look at the trigger lane `
      + `(preflight refusal or crash — its own words follow):\n${out.slice(0, 800)}`);
    const lane = out.split("\n").filter((l) => /trigger lane/i.test(l));
    assert.ok(lane.length >= 2,
      `the arrival check ran to its report but named no trigger-lane surface, which is the finding:\n${out.slice(0, 800)}`);
    return { lane, out };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const stateOf = (lines, name) => {
  const l = lines.find((x) => x.includes(name));
  assert.ok(l, `no line for "${name}" — the surface is gone`);
  return /FAIL/.test(l) ? "fail" : /skip/i.test(l) ? "skip" : /ok/.test(l) ? "pass" : "?";
};

/**
 * A door that answers 401 — which the issue names as sufficient: origin, path and listener are real.
 *
 * IT RUNS IN ITS OWN PROCESS, and that is not tidiness. The first version listened inside this test and
 * every probe failed: `execFileSync` blocks this thread for the whole run of the check, so the server
 * could never accept the connection its own arm was making. The arm then read a real 401 door as
 * unreachable — an instrument measuring itself.
 */
async function doorAnswering401() {
  const child = spawn(process.execPath, ["-e",
    'const h=require("http");const s=h.createServer((q,r)=>{r.writeHead(401,{"www-authenticate":"Bearer"});r.end("no")});'
    + 's.listen(0,"127.0.0.1",()=>console.log(s.address().port));'],
    { stdio: ["ignore", "pipe", "ignore"] });
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("the fixture door never announced a port")), 20_000);
    child.stdout.on("data", (d) => { const m = /(\d+)/.exec(String(d)); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on("error", reject);
  });
  return { url: `http://127.0.0.1:${port}`, port,
    close: () => new Promise((r) => { child.once("exit", r); child.kill(); }) };
}

test("112 the trigger lane is a surface of its own, and an unset origin FAILS it", { timeout: 300_000 }, () => {
  // The 2026-09-02 box exactly: an ops token present, `PORTAL_MCP_URL` never set. Every other surface
  // on that box was green.
  const { lane } = surfaces({ url: "", token: "v1.payload.sig" });
  assert.equal(stateOf(lane, "trigger lane wired"), "fail",
    "a box whose Start button answers 502 passed the arrival check");
  assert.ok(lane.join("\n").includes("trigger lane reachable"),
    "reachability is not reported at all, so 'wired' and 'reachable' are not separable");
});

test("112 an unset origin is NOT-PROBED for reachability, never passed and never failed", { timeout: 300_000 }, () => {
  // Probing a default would report on some other instance's door — the fault the URL derivation at the
  // top of that script exists to stop. And a skip is not a pass: the script counts them apart.
  const { lane } = surfaces({ url: "", token: "v1.payload.sig" });
  assert.equal(stateOf(lane, "trigger lane reachable"), "skip",
    "with no origin configured, reachability was decided rather than reported as not probed");
});

test("112 a door answering 401 proves the lane reachable — it starts no run", { timeout: 300_000 }, async () => {
  // `start_run` bills a real clearance, so proving the lane must never use it. A 401 rather than a
  // connection error already proves origin, path and listener, which is the issue's own criterion —
  // and treating 401 as a failure would red every correctly-secured deployment.
  const door = await doorAnswering401();
  try {
    const { lane } = surfaces({ url: door.url, token: "v1.payload.sig" });
    assert.equal(stateOf(lane, "trigger lane wired"), "pass");
    assert.equal(stateOf(lane, "trigger lane reachable"), "pass",
      "a door that answered 401 was reported unreachable");
  } finally { await door.close(); }
});

test("112 WIRED and REACHABLE are different answers: configured, and nothing behind it", { timeout: 300_000 }, async () => {
  // Criterion 4. On the outage box both failed together, and that is how one hides behind the other:
  // an unset variable is a value somebody has to write, a dead door is a service to bring up.
  const door = await doorAnswering401();
  const dead = door.url;
  await door.close();                       // the origin stays configured; the listener goes away
  const { lane } = surfaces({ url: dead, token: "v1.payload.sig" });
  assert.equal(stateOf(lane, "trigger lane wired"), "pass",
    "a configured lane was reported unwired because its door was down — two faults collapsed into one");
  assert.equal(stateOf(lane, "trigger lane reachable"), "fail",
    "a dead door was reported reachable");
});
