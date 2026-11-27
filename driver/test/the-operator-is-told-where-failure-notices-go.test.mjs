// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE PERSON RUNNING THE INSTALL IS TOLD WHERE FAILURE NOTICES GO, AND WHAT WAITS ON THEM. `doctor` says, in one line,
// which route the worker reads; `status` says how many notices await an automatic retry, and for each one whose
// handoff is uncertain, how to settle it, with a command that works from a packaged install. The words are the ones
// approved for these surfaces (2026-11-27), counted for the state the install is in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { noticeRoute, noticeRouteLine } from "../notice-route.mjs";
import { noticeStatusLines } from "../notice-delivery.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const line = (env) => noticeRouteLine(noticeRoute(env));

test("doctor's line for every state of the route, in the approved words", () => {
  const url = "http://127.0.0.1:8787/notices?token=never-shown";
  assert.deepEqual(line({}), { level: "info", text: "Failure notices use the courier, if configured." });
  assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: url, CLEAROTRON_NOTICE_AUDIENCES: "submitter,operator" }),
    { level: "ok", text: "Failure notices for submitters and operators use http://127.0.0.1:8787." });
  assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: url, CLEAROTRON_NOTICE_AUDIENCES: "operator" }),
    { level: "ok", text: "Operator notices use http://127.0.0.1:8787. Submitter notices use the courier, if configured." });
  assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: url, CLEAROTRON_NOTICE_AUDIENCES: "submitter" }),
    { level: "ok", text: "Submitter notices use http://127.0.0.1:8787. Operator notices use the courier, if configured." });
  assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: "http://receiver.example.invalid/notices", CLEAROTRON_NOTICE_AUDIENCES: "operator" }),
    { level: "warn", text: "Failure notice receiver must be on this machine." });
  assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: url }),
    { level: "warn", text: "Choose who gets failure notices. Set CLEAROTRON_NOTICE_AUDIENCES to submitter, operator, or submitter,operator." });
  assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: url, CLEAROTRON_NOTICE_AUDIENCES: "operator,everyone" }),
    { level: "warn", text: "Unknown failure notice audience. Use submitter, operator, or submitter,operator." });
  for (const bad of ["not a url", "ftp://127.0.0.1/notices"])
    assert.deepEqual(line({ CLEAROTRON_NOTICE_URL: bad, CLEAROTRON_NOTICE_AUDIENCES: "operator" }),
      { level: "warn", text: "Enter a valid local HTTP or HTTPS address for failure notices." }, bad);
  // The receiver is named by its origin only: never its path or query, and not at all once refused.
  for (const audiences of ["operator", "submitter", "submitter,operator"])
    assert.doesNotMatch(line({ CLEAROTRON_NOTICE_URL: url, CLEAROTRON_NOTICE_AUDIENCES: audiences }).text, /notices\?|token/);
});

test("status's lines are counted and worded for the state, and a superseded notice asks nothing", () => {
  const cmd = "clearotron notices";
  const retry = (id) => ({ id, retriesByItself: true, nextAction: null, superseded: null });
  const uncertain = (id) => ({ id, retriesByItself: false, nextAction: "settle-with-receiver", superseded: null });
  assert.deepEqual(noticeStatusLines([], cmd), []);
  assert.deepEqual(noticeStatusLines([retry("a")], cmd), ["1 failure notice awaits automatic retry."]);
  assert.deepEqual(noticeStatusLines([retry("a"), retry("b")], cmd), ["2 failure notices await automatic retry."]);
  const id = "3f2a9c1b07de44e1a9d0c2b3";
  assert.deepEqual(noticeStatusLines([uncertain(id)], cmd), [
    `Check whether the receiver accepted notice ${id}.`,
    `  If received: clearotron notices received ${id}`,
    `  If absent:   clearotron notices absent ${id}`]);
  assert.deepEqual(noticeStatusLines([{ ...uncertain(id), superseded: "later-failure", nextAction: null }, { ...retry("b"), superseded: "report", retriesByItself: false }], cmd), [],
    "a superseded notice still asked for something");
});

/** An install of its own, with one notice record of each kind, named by its own settings file. */
function install() {
  const home = mkdtempSync(join(tmpdir(), "notice-status-"));
  const outbox = join(home, "trademark", "outbox");
  mkdirSync(join(outbox, "deliveries"), { recursive: true });
  const rec = (id, state, extra = {}) => writeFileSync(join(outbox, "deliveries", `${id}.json`), JSON.stringify({
    id, kind: "run-stopped", audience: "operator", recipient: { role: "operator" }, state, attempts: [{ at: "2026-11-27T05:00:00Z", outcome: state }],
    updatedAt: "2026-11-27T05:00:00Z", nextAttemptAt: null, ...extra }));
  rec("aaaaaaaaaaaaaaaaaaaaaaaa", "failed");
  rec("bbbbbbbbbbbbbbbbbbbbbbbb", "ambiguous");
  rec("cccccccccccccccccccccccc", "confirmed");
  writeFileSync(join(home, ".env"), `CLEAROTRON_OUTBOX_DIR=${outbox}\nCLEAROTRON_NOTICE_URL=http://127.0.0.1:8787/notices\nCLEAROTRON_NOTICE_AUDIENCES=operator\n`);
  return home;
}
const cleanEnv = (home) => {
  const env = { ...process.env, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" };
  for (const k of Object.keys(env)) if (/^CLEAROTRON_(OUTBOX_DIR|WORK_DIR|NOTICE_)/.test(k)) delete env[k];
  return env;
};

test("status, run as the person running the install, reads the install's own record and names a command that works from it", () => {
  const home = install();
  try {
    const r = spawnSync(process.execPath, [join(REPO, "bin", "status.mjs")], { env: cleanEnv(home), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 failure notice awaits automatic retry\./);
    assert.match(r.stdout, /Check whether the receiver accepted notice bbbbbbbbbbbbbbbbbbbbbbbb\./);
    // The command as this install's own launcher is invoked (a packaged `clearotron`, or the checkout's `npx` form).
    assert.match(r.stdout, /If received: .*clearotron notices received bbbbbbbbbbbbbbbbbbbbbbbb$/m);
    assert.match(r.stdout, /If absent: +.*clearotron notices absent bbbbbbbbbbbbbbbbbbbbbbbb$/m);
    assert.doesNotMatch(r.stdout, /cccccccccccccccccccccccc/, "a confirmed notice was listed");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the notices command answers from a packaged install's own launcher, reading the record status pointed at", () => {
  const home = install();
  try {
    const env = { ...cleanEnv(home), CLEAROTRON_OUTBOX_DIR: join(home, "trademark", "outbox") };
    const list = spawnSync(process.execPath, [join(REPO, "bin", "clearotron.mjs"), "notices", "list"], { env, encoding: "utf8" });
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout).map((n) => n.id).sort(), ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"]);
    const absent = spawnSync(process.execPath, [join(REPO, "bin", "clearotron.mjs"), "notices", "absent", "bbbbbbbbbbbbbbbbbbbbbbbb"], { env, encoding: "utf8" });
    assert.deepEqual([absent.status, JSON.parse(absent.stdout).state], [0, "failed"]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
