// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — starts the real `clearotron start` once and the real runner twice, with stand-in engine programs only
//
// A BRIEF IS READ ONLY BY AN AI THAT IS CHOSEN.
//
// The portal's brief reader is a model turn, built through the jx door (engine/jx-turn.mjs). With no AI chosen
// that door resolved the code's default, so an install with no AI chosen booted "brief reading ON —
// engine=anthropic-agent", and a press of Describe-it would have run a turn on that AI's program, on whatever
// it was signed in to. Measured on a fresh install of 0.5.1-beta.0, 2026-11-07. Now the door refuses in the
// order-time gate's words, "no AI is chosen", and the portal says so through the line it already prints.
//
// The run's own lanes go through the same door, and an order with no AI chosen never reaches them: the runner
// refuses it at order time, before a stage starts. The last arm drives that, so the door's refusal is not the
// only thing standing between an unchosen AI and a turn.
//
// EVERY PROGRAM HERE IS A STAND-IN that writes down each start, `--version` included, and then answers as the
// suite's mock does, signed in. So "nothing was started" is read off the program, not off what was said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeJxTurnRunner } from "../engine/jx-turn.mjs";
import { whatIsMissing } from "../run-requirements.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const NO_AI = "no AI is chosen";
const OFF_LINE = "[portal-service] brief reading OFF — no AI is chosen. Describe-it stays disabled; "
  + "`npx clearotron doctor` reports the engine's auth state.";
const SKIP = process.platform === "win32" && "the stand-ins are shell scripts, and Windows starts none";

/** A `claude` in `dir` that logs each start and then answers as mock-claude.mjs, which is signed in. */
function standInClaude(dir) {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "claude-started.log");
  const program = join(dir, "claude");
  writeFileSync(program, [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    `exec "${process.execPath}" "${join(HERE, "mock-claude.mjs")}" "$@"`,
  ].join("\n") + "\n");
  chmodSync(program, 0o755);
  return { program, started: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []) };
}

test("with no AI chosen the jx door refuses in the gate's words, and a press of Describe-it starts no program", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-no-ai-"));
  const claude = standInClaude(join(dir, "programs"));
  // The program is found on PATH, ahead of the suite's own refusing stand-in, and by no setting.
  const saved = { PATH: process.env.PATH, CLEAROTRON_CLAUDE_PATH: process.env.CLEAROTRON_CLAUDE_PATH, CLEAROTRON_AI: process.env.CLEAROTRON_AI };
  process.env.PATH = `${join(dir, "programs")}:${process.env.PATH}`;
  delete process.env.CLEAROTRON_CLAUDE_PATH;
  delete process.env.CLEAROTRON_AI;
  try {
    // As the portal builds its reader, and as a press runs it: the turn, if the door hands one over.
    const press = async (env) => {
      const runner = await makeJxTurnRunner({ env, model: "sonnet", thinking: "off", lane: "the brief reader" });
      if (typeof runner.turn === "function") await runner.turn({ prompt: "a quick check on VELMORAX for a bicycle repair app" });
      return runner;
    };
    const none = await press({ ...process.env });
    assert.equal(none.error, NO_AI, `the door built a reader with no AI chosen: ${JSON.stringify(none)}`);
    assert.equal(none.error, whatIsMissing([{ about: "ai" }]), "the reason is no longer the order-time gate's own words");
    assert.equal(none.turn, undefined, "a refused door still handed over a turn");
    // Blank is not chosen either, as the gate reads the setting.
    assert.equal((await press({ ...process.env, CLEAROTRON_AI: "  " })).error, NO_AI);
    // THE WITNESS: the program itself was never started.
    assert.deepEqual(claude.started(), [], "a press started the program of an AI nobody chose");
    // THE CONTROL, so the silence above can mean something: with Claude chosen, the same press starts it.
    const chosen = await press({ ...process.env, CLEAROTRON_AI: "anthropic-agent" });
    assert.equal(chosen.error, undefined, chosen.error);
    assert.ok(claude.started().length > 0, "the witness never saw a press start the program, so its silence above proves nothing");
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a start with no AI chosen says its brief reader is off, in the line the portal prints when it cannot read", { skip: SKIP, timeout: 180000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "brief-no-ai-start-"));
  const claude = standInClaude(join(home, "programs"));
  const SAID = /\[portal-service\] brief reading (ON|OFF)[^\n]*/;
  const stop = async ({ child, closed }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; }
  };
  const boot = async (ports) => {
    // A machine signed in to nothing but the stand-in, with no settings file and no AI chosen.
    const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--no-open"], {
      cwd: REPO,
      env: { PATH: `${join(home, "programs")}:${process.env.PATH}`, HOME: home, USERPROFILE: home, TMPDIR: home,
        CLEAROTRON_ENGINES_DIR: join(home, "no-engines-installed"),
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => { said += c; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { said += c; });
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 120000;
    while (!SAID.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    return { child, closed, said: () => said };
  };
  const run = await withFreePorts(["portal", "mcp", "client"], boot, {
    busy: (r) => !SAID.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await stop(r); },
  });
  try {
    const said = run.said();
    const line = said.match(SAID)?.[0];
    assert.ok(line, `the portal said nothing about its brief reader:\n${said.slice(-3000)}`);
    assert.equal(line, OFF_LINE, "the portal does not say its brief reader is off, and why, in its own line");
    assert.doesNotMatch(said, /brief reading ON/, "the portal can read a brief with an AI nobody chose");
    assert.deepEqual(claude.started(), [], "the start ran the program of an AI nobody chose");
  } finally {
    await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});

// ── THE RUN'S OWN LANES ARE NEVER REACHED WITH NO AI CHOSEN ─────────────────────────────────────────────
//
// Driven through the real runner over a real queue, as a-generic-run-is-filed-and-capped-at-the-claim.test.mjs
// drives it. The job reaches the claim, and the order-time gate refuses it there, so no stage starts and no
// lane can ask the jx door for a turn.
const queueFor = (root) => join(root, "workspace-intake-agent", "studio", "clearance-search", "queue");
const runnerEnv = (root, program, extra = {}) => {
  const env = {
    ...process.env, CLEAROTRON_CLAUDE_PATH: program, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_SATPROBE_CODESIDE: "0",
    CLEAROTRON_BAND_TRUTH_GATE: "0", MOCK_FAIL_STAGE: "record_matter_frame", CLEAROTRON_DELIVERY: "handoff",
    ...extra,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
};
const drain = (env) => new Promise((resolve) => {
  const c = spawn(process.execPath, [join(REPO, "driver", "runner.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  c.stdout.setEncoding("utf8");
  c.stdout.on("data", (d) => { log += d; });
  c.stderr.setEncoding("utf8");
  c.stderr.on("data", (d) => { log += d; });
  c.on("exit", (code) => resolve({ code, log }));
});
const job = (ref) => ({ id: `brief-${ref}`, msgId: `<brief-${ref}@x>`, forwarder: "requester", forwarderDomain: "example.com",
  ref, markName: `QUILLBRAE ${ref}`, classes: [9], provider: "corsearch", profileKey: "generic", tenant: "southbank", clientPrincipal: true });

test("an order with no AI chosen is refused at order time, and no stage or lane starts a program", { skip: SKIP, timeout: 180000 }, async () => {
  const roots = [];
  const fresh = () => { const r = mkdtempSync(join(tmpdir(), "brief-no-ai-run-")); roots.push(r); mkdirSync(queueFor(r), { recursive: true }); return r; };
  try {
    const root = fresh();
    const claude = standInClaude(join(root, "programs"));
    writeFileSync(join(queueFor(root), "job-n.json"), JSON.stringify(job("TMP9411")));
    const refused = await drain(runnerEnv(root, claude.program, { CLEAROTRON_AI: undefined }));
    assert.equal(refused.code, 0, refused.log);
    assert.match(refused.log, /REFUSED at order time — this install is not configured to run a search: [^\n]*CLEAROTRON_AI/,
      `the order was not refused at order time for its missing AI:\n${refused.log}`);
    assert.ok(existsSync(join(queueFor(root), "job-n.failed")), `the refused job was not parked as failed:\n${refused.log}`);
    assert.deepEqual(claude.started(), [], "a stage or a lane started a program for an order with no AI chosen");
    // THE CONTROL: the same order with Claude chosen reaches its first stage, which starts the stand-in.
    const control = fresh();
    const chosenClaude = standInClaude(join(control, "programs"));
    writeFileSync(join(queueFor(control), "job-c.json"), JSON.stringify(job("TMP9412")));
    const ran = await drain(runnerEnv(control, chosenClaude.program, { CLEAROTRON_AI: "anthropic-agent" }));
    assert.doesNotMatch(ran.log, /REFUSED at order time/, ran.log);
    assert.ok(chosenClaude.started().length > 0, `the control never started the stand-in, so the silence above proves nothing:\n${ran.log}`);
  } finally { for (const r of roots) rmSync(r, { recursive: true, force: true }); }
});
