// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 200 — a remedy that names a variable and not the file, on a product with two env files.
//
// Driven as a stranger against published 0.1.4: `clearotron start --background` refused a port collision
// with "set PORTAL_SERVICE_PORT=<free port>" and stopped there. This product has two env files with
// different jobs — the installed units load `EnvironmentFile=%h/.env`, and a CLI entry point reads
// `~/.config/clearotron/.env` for itself — and `start` is the command that INSTALLS those units, so it is
// resolving the ports they will be born with while reading only the second file. A reader whose running
// product has the wrong port writes it in the first one, nothing changes, and the only way to see why is
// to compare two lists of variable names in a log line.
//
// THE INVARIANT IS AGREEMENT, not the presence of a path. The refusal must name the file this process
// actually read, and the process already prints that file one line above. An arm that only checked "a
// path appears" would pass on a path that names the wrong file, which is the defect itself.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { listenErrorMessage } from "../../shared/listen.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const START = join(ROOT, "bin", "start.mjs");

/** Hold a loopback port, hand back its number, and release it. */
async function heldPort() {
  const s = createServer(() => {});
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { port: s.address().port, release: () => new Promise((r) => s.close(r)) };
}

/**
 * Drive the REAL command into its port refusal, in a HOME of its own.
 *
 * The probe that produces this refusal runs before `markStateWritten()`, so a refused run installs no
 * unit and writes nothing — which the last arm here checks rather than assumes.
 */
function driveStart(port, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "ct200-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  const envFile = join(home, ".config", "clearotron", ".env");
  writeFileSync(envFile, `PORTAL_SERVICE_PORT=${port}\n`);
  const env = { ...process.env, HOME: home, ...extra };
  // THE RUNNER OPTS EVERY CHILD OUT OF .env FILES (scripts/test-run.mjs sets CLEAROTRON_NO_ENV_FILE=1
  // for the whole suite, so no test can be configured by a file on the developer's box). This drive is
  // ABOUT that file, so it must opt back in — and the first version of it did not. The .env went
  // unread, PORTAL_SERVICE_PORT fell back to the built-in 18802, and the refusal these arms measured
  // was a collision with whatever holds 18802 on the machine running the suite: on this box, the
  // owner's own portal. Nothing was written — the probe refuses before the first state change, which
  // the third arm checks — but the arms were reading a different collision than the one they set up,
  // and on a runner where 18802 is free they would have read no collision at all.
  if (!("CLEAROTRON_NO_ENV_FILE" in extra)) delete env.CLEAROTRON_NO_ENV_FILE;
  const r = spawnSync(process.execPath, [START, "--background"],
    { encoding: "utf8", timeout: 180_000, env });
  return { home, envFile, port, said: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status,
    clean: () => rmSync(home, { recursive: true, force: true }) };
}

/** The refusal must be about the port this drive HELD, never a default it fell back to. */
function refusedOurPort(d) {
  assert.match(d.said, new RegExp(`127\\.0\\.0\\.1:${d.port} is already in use`),
    `the drive refused on a port this arm did not hold, so it measured a collision it did not set up:\n`
    + `${d.said.slice(0, 900)}`);
}

test("200 the port refusal names the file this command reads, and it is the file it said it read",
  { timeout: 300_000 }, async () => {
    const held = await heldPort();
    const d = driveStart(held.port);
    await held.release();
    try {
      refusedOurPort(d);

      // The loader's own line, which the issue calls the one thing that made this diagnosable.
      const loader = /\[env-local\] applied \d+ variables? from (\S+):/.exec(d.said);
      assert.ok(loader, `no [env-local] line to compare the refusal against:\n${d.said.slice(0, 900)}`);
      assert.equal(loader[1], d.envFile);

      // AGREEMENT. The remedy names a file, and it is that same file — not merely some path.
      const remedy = d.said.split("\n").find((l) => /set PORTAL_SERVICE_PORT=<free port>/.test(l));
      assert.ok(remedy, `the remedy line is gone:\n${d.said.slice(0, 900)}`);
      assert.match(remedy, new RegExp(`in ${d.envFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
        `the remedy names the variable but not the file this command read — tracker issue 200:\n${remedy}`);
    } finally { d.clean(); }
  });

test("200 the refusal says the units' file is NOT the one it reads, so the reader stops writing there",
  { timeout: 300_000 }, async () => {
    const held = await heldPort();
    const d = driveStart(held.port);
    await held.release();
    try {
      refusedOurPort(d);
      assert.match(d.said, /`~\/\.env` is loaded by the installed units and is NOT read here/);
      // Named, so the reader knows which variable the sentence is about.
      assert.match(d.said, /setting PORTAL_SERVICE_PORT there changes nothing for this command/);
    } finally { d.clean(); }
  });

test("200 a refused run writes nothing — the probe is before the first state change",
  { timeout: 300_000 }, async () => {
    const held = await heldPort();
    const d = driveStart(held.port);
    await held.release();
    try {
      refusedOurPort(d);
      assert.equal(d.code, 1);
      // Nothing but the .env this drive wrote itself, and no unit anywhere under the HOME.
      const units = join(d.home, ".config", "systemd", "user");
      let installed = [];
      try { installed = readdirSync(units); } catch { /* the directory does not exist, which is the point */ }
      assert.deepEqual(installed, [],
        `the refusal installed units before refusing: ${installed.join(", ")}`);
    } finally { d.clean(); }
  });

// ── the other half of the class: WHEN THERE IS NO FILE TO NAME ──────────────────────────────────────
// The same sentence serves four services booted by systemd units, which set CLEAROTRON_NO_ENV_FILE=1 and
// take their configuration from `%h/.env`. Naming the CLI's file there would replace one wrong address
// with another, so the caller passes nothing and the text must stay exactly as it was.

test("200 a caller that read no env file names none, and its refusal is unchanged", () => {
  const withFile = listenErrorMessage({ code: "EADDRINUSE" },
    { what: "portal", host: "127.0.0.1", port: 18802, portVar: "PORTAL_SERVICE_PORT", portFile: "/somewhere/.env" });
  const without = listenErrorMessage({ code: "EADDRINUSE" },
    { what: "portal", host: "127.0.0.1", port: 18802, portVar: "PORTAL_SERVICE_PORT" });
  assert.match(withFile, /in \/somewhere\/\.env/);
  assert.doesNotMatch(without, /is the file this command reads/);
  assert.doesNotMatch(without, /\/somewhere/);
  // Still a complete remedy without the file — the variable is named either way.
  assert.match(without, /set PORTAL_SERVICE_PORT=<free port>/);
});

test("200 a service-managed process names no file, because it did not read one", { timeout: 300_000 },
  async () => {
    // CLEAROTRON_NO_ENV_FILE=1 is what the units set. env-local then reports `service-managed` and
    // applies nothing, so there is no file to send the reader to and the refusal must not invent one.
    const held = await heldPort();
    const d = driveStart(held.port, { CLEAROTRON_NO_ENV_FILE: "1", PORTAL_SERVICE_PORT: String(held.port) });
    await held.release();
    try {
      refusedOurPort(d);
      assert.doesNotMatch(d.said, /is the file this command reads/,
        `a process that read no env file still named one:\n${d.said.slice(0, 900)}`);
    } finally { d.clean(); }
  });

test("200 the file rides with EACCES too, which has the same remedy and the same two files", () => {
  const m = listenErrorMessage({ code: "EACCES" },
    { what: "portal", host: "127.0.0.1", port: 80, portVar: "PORTAL_SERVICE_PORT", portFile: "/somewhere/.env" });
  assert.match(m, /in \/somewhere\/\.env/);
  assert.match(m, /is the file this command reads/);
});
