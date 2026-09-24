// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO STOPS WHEN WHATEVER STARTED IT IS GONE.
//
// `npx clearotron demo --no-open &`, then `kill $!`: the TERM reached npm, npm passed it to the `sh -c`
// it runs the launcher under, and that `sh` exited without passing it on. The launcher was reparented and
// the demo kept all three ports and its folder, with nothing saying so. Measured on npm 10.9.8,
// 2026-09-18. The launcher now watches its parent and, for the demo, takes its parent's death as a TERM.
//
// DRIVEN, NOT DESCRIBED: a real `sh -c` stands where npm's does, a real TERM kills it, and the process
// under it has to notice by itself. The full product drive, a TERM to each of npm, that `sh`, the launcher,
// the demo wrapper and the supervisor, each leaving no port, no folder and no process behind, is recorded
// on the change that added this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { watchParent } from "../../shared/parent-watch.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ok, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (ok()) return true; await new Promise((r) => setTimeout(r, 50)); } return ok(); };

test("fires once, only when the parent pid changes, and never for a process started under init", async () => {
  let pid = 4242, calls = [];
  const stop = watchParent((e) => calls.push(e), { intervalMs: 10, parentPid: () => pid });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, [], "fired while the parent was still there");
  pid = 1;
  await until(() => calls.length > 0, 1000);
  pid = 777;
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, [{ was: 4242, now: 1 }], "must fire exactly once, with the parent it lost");
  stop();
  const underInit = [];
  const stop2 = watchParent((e) => underInit.push(e), { intervalMs: 10, parentPid: () => 1 });
  await new Promise((r) => setTimeout(r, 60));
  stop2();
  assert.deepEqual(underInit, [], "a process whose parent was init from the start has lost nothing");
});

// The watch reads a change of parent pid, which is reparenting: Linux and macOS hand an orphan to init or a
// subreaper. Windows reparents nothing and leaves a process's parent pid naming the parent that died.
test("a real sh that dies on TERM without passing it on: the process under it notices and stops", { timeout: 30000,
  skip: process.platform === "win32" && "no reparenting on Windows: an orphan keeps its dead parent's pid, so there is no change for the watch to see" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "parent-watch-"));
  const marker = join(dir, "gone.json");
  const ready = join(dir, "ready");
  const child = join(dir, "child.mjs");
  writeFileSync(child, [
    `import { writeFileSync } from "node:fs";`,
    `import { watchParent } from ${JSON.stringify(pathToFileURL(join(REPO, "shared", "parent-watch.mjs")).href)};`,
    `watchParent((e) => { writeFileSync(${JSON.stringify(marker)}, JSON.stringify(e)); process.exit(0); }, { intervalMs: 100 });`,
    `writeFileSync(${JSON.stringify(ready)}, String(process.pid));`,
    `setInterval(() => {}, 1000);`,
  ].join("\n"));
  // `; true` keeps sh waiting on the node rather than exec-ing it, which is the shape npm's `sh -c` has.
  const sh = spawn("sh", ["-c", `${JSON.stringify(process.execPath)} ${JSON.stringify(child)}; true`], { stdio: "ignore" });
  let under = null;
  try {
    // The process says its own pid once it is watching, which works on every platform the suite runs on.
    await until(() => { try { under = Number(readFileSync(ready, "utf8")) || null; } catch { under = null; } return under != null; }, 10000);
    assert.ok(under, "the process under sh never started");
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(!existsSync(marker), "the watch fired while its parent was alive");
    sh.kill("SIGTERM");
    assert.ok(await until(() => existsSync(marker), 5000), "THE REPORTED CASE: sh died and the process under it did not notice");
    const seen = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(seen.was, sh.pid, "the parent it lost must be the sh that was killed");
    assert.ok(await until(() => !alive(under), 5000), "it noticed but kept running");
  } finally {
    if (under && alive(under)) try { process.kill(under, "SIGKILL"); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the launcher takes the parent's death as a TERM for the demo, and for nothing else", () => {
  const src = readFileSync(join(REPO, "bin", "clearotron.mjs"), "utf8");
  assert.match(src, /import \{ watchParent \} from "\.\.\/shared\/parent-watch\.mjs";/, "the launcher does not use the one watch");
  assert.match(src, /if \(verb === "demo"\) watchParent\(\(\) => \{ try \{ child\.kill\("SIGTERM"\);/,
    "the demo must be stopped with a TERM, so its own shutdown removes what it made");
  assert.equal(src.split("watchParent(").length - 1, 1,
    "armed more than once, or for another verb: a foreground start or a clearance may be meant to outlive its shell");
});
