// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WS-C slot-lock across REAL processes — the feature's headline claim ("cross-process via slot
// files; manual CLI relaunches were the June-12 trigger") exercised with spawned children: wx-create
// contention between processes, pidAlive against a real foreign pid, and reclaim of a really-dead
// process. In-process tests cannot cover any of this (their whole acquire sequence is synchronous).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, "slot-child.mjs");

const waitFor = async (pred, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

test("cross-process cap: 5 child processes on cap 2 — max in-flight never exceeds 2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xproc-"));
  const log = join(dir, "log.jsonl");
  const children = Array.from({ length: 5 }, () =>
    spawn(process.execPath, [CHILD, join(dir, "slots"), "2", "120", log], { stdio: "ignore" }));
  await Promise.all(children.map((c) => new Promise((r) => c.on("exit", r))));
  const events = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.e === "start").length, 5, "all five children acquired eventually");
  let cur = 0, max = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t || (a.e === "end" ? -1 : 1))) {
    cur += e.e === "start" ? 1 : -1;
    max = Math.max(max, cur);
  }
  assert.ok(max <= 2, `max in-flight ${max} across processes exceeded cap 2`);
});

test("cross-process reclaim: a SIGKILLed child's slot (REAL dead pid) is reclaimed by the next acquirer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xproc-kill-"));
  const log = join(dir, "log.jsonl");
  const hang = spawn(process.execPath, [CHILD, join(dir, "slots"), "1", "0", log],
    { env: { ...process.env, CHILD_HANG: "1" }, stdio: "ignore" });
  assert.ok(await waitFor(() => existsSync(log) && statSync(log).size > 0), "child acquired its slot");
  hang.kill("SIGKILL");
  await new Promise((r) => hang.on("exit", r));
  const { acquireSlot, releaseSlot } = await import("../slot-lock.mjs");
  const h = await acquireSlot({ dir: join(dir, "slots"), cap: 1, pollMs: 20 });
  assert.ok(h.token.startsWith(`${process.pid}:`), "the dead child's slot was reclaimed (mutex-gated)");
  assert.equal(readFileSync(h.slot, "utf8"), h.token);
  releaseSlot(h);
});
