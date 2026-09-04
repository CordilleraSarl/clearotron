// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE WRITE BOUNDARY. A seat may read the doctrine tree and may write its own outputs; it may
// never write the doctrine tree, the profile store, or the driver's own per-run record.
//
// These tests run the REAL hook process over the REAL tool-call shape. The shape is not invented: it was
// captured from the live CLI (2.1.221) before the hook was written — `{tool_name, tool_input.file_path}`
// with `permissionDecision:"deny"` as the refusal — because a fixture invented from documentation is how
// a test certifies the bug it was written to catch.
//
// What CI cannot cover, and where it is covered instead: whether `claude -p` OBEYS the decision, and
// whether the turn continues afterwards. CI has no claude binary and no subscription. That half is the
// acceptance transcript, produced by scripts/authority-boundary-probe.mjs against the live CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { authorityTrees, denyReason, isInside } from "../authority-trees.mjs";
import { writeBoundarySettings, buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { targetOf } from "../engine/deny-authority-write.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "deny-authority-write.mjs");
const SKILLS = "/srv/app/driver/skills";
const OVERLAY = "/srv/cfg/skills";
const PROFILES = "/srv/cfg/profiles";
const RUN = "/srv/pool/runs/2026-08-14-x";
const TREES = authorityTrees({ skillsRoots: [OVERLAY, SKILLS], profilesDir: PROFILES, runDir: RUN });

/** Run the hook exactly as claude runs it: policy in argv, the tool call on stdin. */
function hook(toolName, filePath, { trees = TREES, runDir = null } = {}) {
  const payload = Buffer.from(JSON.stringify({ trees, runDir }), "utf8").toString("base64");
  const r = spawnSync(process.execPath, [HOOK, payload], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { file_path: filePath }, session_id: "s1", tool_use_id: "t1" }),
    encoding: "utf8",
  });
  const out = String(r.stdout ?? "").trim();
  return { status: r.status, decision: out ? JSON.parse(out).hookSpecificOutput : null };
}

test("the incident: a write into the doctrine tree is denied", () => {
  const d = hook("Write", join(SKILLS, "prelim-register", "SKILL.md")).decision;
  assert.equal(d?.permissionDecision, "deny");
  // The refusal must NAME the alternative. A refusal that does not is one a model answers by trying the
  // neighbouring path — which is a retry loop, not a boundary.
  assert.match(d.permissionDecisionReason, /run directory/i);
});

test("the overlay is protected too — the customer's doctrine is doctrine", () => {
  assert.equal(hook("Edit", join(OVERLAY, "prelim-search", "method.md")).decision?.permissionDecision, "deny");
});

test("the profile store is denied (defensive: it is granted by no --add-dir today)", () => {
  assert.equal(hook("Write", join(PROFILES, "petcary.json")).decision?.permissionDecision, "deny");
});

test("_driver/ is denied — a seat writing its own attempt record would forge the forensic file", () => {
  for (const f of ["run.jsonl", "register-unit-1.jsonl", "plan.frozen.json", join("forms", "coverage.json")])
    assert.equal(hook("Write", driverDir(RUN, f)).decision?.permissionDecision, "deny", f);
});

test("THE SEAT'S OWN WORKSPACE STAYS OPEN — every stage writes there on every run", () => {
  for (const f of ["findings.json", "register-findings.json", join("grids", "g1.json"), join("_driverish", "x.json")]) {
    const r = hook("Write", join(RUN, f));
    assert.equal(r.status, 0, f);
    assert.equal(r.decision, null, f);
  }
});

test("a sibling whose name merely starts with a protected root is NOT inside it", () => {
  // `/srv/app/driver/skills-backup` vs `/srv/app/driver/skills`. A string prefix says inside; the segment
  // check says otherwise. Getting this wrong blocks legitimate work, which is how a boundary gets removed.
  assert.equal(hook("Write", `${SKILLS}-backup/x.md`).decision, null);
  assert.equal(isInside(SKILLS, `${SKILLS}-backup/x.md`), false);
  assert.equal(isInside(SKILLS, `${SKILLS}/a/b/c.md`), true);
});

test("relative and dot-segment paths cannot walk out of the run dir into doctrine", () => {
  assert.equal(hook("Write", join(RUN, "..", "..", "..", "app", "driver", "skills", "x.md")).decision?.permissionDecision, "deny");
  assert.equal(hook("Write", `${RUN}/_driver/../_driver/run.jsonl`).decision?.permissionDecision, "deny");
});

test("a non-write tool is not this hook's business", () => {
  assert.equal(targetOf("Read", { file_path: join(SKILLS, "x.md") }), null);
  assert.equal(targetOf("Bash", { command: "cat /etc/hosts" }), null);
  assert.equal(hook("Read", join(SKILLS, "SKILL.md")).decision, null);
});

test("FAIL CLOSED: an undecodable policy denies rather than waving the write through", () => {
  const r = spawnSync(process.execPath, [HOOK, "not-base64-json!!"], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(SKILLS, "x.md") } }), encoding: "utf8" });
  const d = JSON.parse(String(r.stdout).trim()).hookSpecificOutput;
  assert.equal(d.permissionDecision, "deny");
  assert.match(d.permissionDecisionReason, /driver fault/i);
});

test("a denial is journalled where the driver's own facts live", () => {
  const run = mkdtempSync(join(tmpdir(), "deny-journal-"));
  mkdirSync(driverDir(run), { recursive: true });
  const trees = authorityTrees({ skillsRoots: [SKILLS], runDir: run });
  hook("Write", join(SKILLS, "SKILL.md"), { trees, runDir: run });
  const rows = readFileSync(driverDir(run, "authority-denials.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, "authority-write-denied");
  assert.equal(rows[0].target, join(SKILLS, "SKILL.md"));
});

test("an unjournallable denial is STILL a denial", () => {
  // The journal is best-effort by construction. A boundary that depends on a successful write is not one.
  const gone = join(tmpdir(), "deny-journal-does-not-exist-" + process.pid);
  assert.equal(existsSync(gone), false);
  assert.equal(hook("Write", join(SKILLS, "SKILL.md"), { runDir: gone }).decision?.permissionDecision, "deny");
});

test("the boundary is derived from the SAME roots the grant hands out", () => {
  // The defect class this whole day is about: one fact with two authors. buildClaudeArgs must not be able
  // to grant a root it does not protect, so the settings are read back out of the args it produced.
  const { args } = buildClaudeArgs({ message: "hi", skillsDir: SKILLS, skillsGrantRoots: [OVERLAY, SKILLS], profilesDir: PROFILES, runDir: RUN });
  const granted = args.filter((a, i) => args[i - 1] === "--add-dir");
  assert.deepEqual(granted, [OVERLAY, SKILLS, RUN]);
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
  const cmd = settings.hooks.PreToolUse[0].hooks[0].command;
  const policy = JSON.parse(Buffer.from(cmd.split(" ").at(-1), "base64").toString("utf8"));
  const protectedRoots = policy.trees.map((t) => t.path);
  // Every granted root is protected — except the run dir, whose TOP LEVEL must stay writable; it is
  // represented by its _driver/ subtree.
  assert.deepEqual(protectedRoots, [OVERLAY, SKILLS, PROFILES, driverDir(RUN)]);
  assert.ok(!protectedRoots.includes(RUN));
});

test("the hook command survives a checkout path with a space in it", () => {
  const s = JSON.parse(writeBoundarySettings({ skillsRoots: ["/a b/skills"], runDir: "/r" }));
  const cmd = s.hooks.PreToolUse[0].hooks[0].command;
  assert.match(cmd, /^'[^']*node[^']*' '.*deny-authority-write\.mjs' [A-Za-z0-9+/=]+$/);
  assert.ok(cmd.startsWith(`'${process.execPath}'`));   // absolute node: the hook shell's PATH is not ours
});

test("FAIL CLOSED: a policy that decoded but names no tree is a policy that did not arrive", () => {
  // The zero question. An empty list must not read as an empty boundary — that is the shape that reports
  // a pass for a check that never ran.
  const r = spawnSync(process.execPath, [HOOK, Buffer.from(JSON.stringify({ runDir: RUN }), "utf8").toString("base64")], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(SKILLS, "x.md") } }), encoding: "utf8" });
  const d = JSON.parse(String(r.stdout).trim()).hookSpecificOutput;
  assert.equal(d.permissionDecision, "deny");
  assert.match(d.permissionDecisionReason, /names no protected tree/);
});

test("a missing hook file refuses the dispatch — the CLI would fail OPEN", () => {
  // A hook command that cannot start is a NON-BLOCKING error in the CLI: the write proceeds. So a
  // half-deployed checkout must not produce a dispatch at all.
  assert.throws(() => writeBoundarySettings({ skillsRoots: [SKILLS], runDir: RUN, hookPath: "/no/such/deny-hook.mjs" }),
    /write_boundary_hook_missing/);
});

test("THE REFUSAL ISSUES NO INSTRUCTIONS — a tool result that redirects behaviour is distrusted", () => {
  // Measured, not stylistic: the first live probe had the seat identify the refusal as a prompt-injection
  // pattern and skip the remaining legitimate step. Second person and imperatives are the tell.
  const reason = denyReason(join(SKILLS, "x.md"), TREES);
  assert.match(reason, /issued by the driver, not by the model/);
  assert.equal(/\byou\b|\byour\b|\bcontinue with\b|\bdo not\b/i.test(reason), false, reason);
});

test("nothing to protect ⇒ no settings flag at all", () => {
  assert.equal(writeBoundarySettings({}), null);
  const { args } = buildClaudeArgs({ message: "hi" });
  assert.equal(args.includes("--settings"), false);
});
