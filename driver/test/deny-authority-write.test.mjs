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
import { join, dirname, resolve } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { authorityTrees, canonicalWindowsPath, denyReason, foldsCaseAt, isInside } from "../authority-trees.mjs";
import { writeBoundarySettings, buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { targetOf } from "../engine/deny-authority-write.mjs";
import { foldsCase } from "./platform-caps.mjs";

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
  const d = hook("Write", join(SKILLS, "clearance-register", "SKILL.md")).decision;
  assert.equal(d?.permissionDecision, "deny");
  // The refusal must NAME the alternative. A refusal that does not is one a model answers by trying the
  // neighbouring path — which is a retry loop, not a boundary.
  assert.match(d.permissionDecisionReason, /run directory/i);
});

test("the overlay is protected too — the customer's doctrine is doctrine", () => {
  assert.equal(hook("Edit", join(OVERLAY, "clearance-search", "method.md")).decision?.permissionDecision, "deny");
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
  const policy = JSON.parse(Buffer.from(settings.hooks.PreToolUse[0].hooks[0].args.at(-1), "base64").toString("utf8"));
  const protectedRoots = policy.trees.map((t) => t.path);
  // Every granted root is protected — except the run dir, whose TOP LEVEL must stay writable; it is
  // represented by its _driver/ subtree, resolved as the hook compares it (on Windows, with its drive).
  assert.deepEqual(protectedRoots, [OVERLAY, SKILLS, PROFILES, resolve(driverDir(RUN))]);
  assert.ok(!protectedRoots.includes(RUN));
});

test("the hook is launched with no shell: the running Node, then the script and its policy as arguments", () => {
  // EXEC FORM. A command string quoted for a POSIX shell does not parse where the CLI runs hooks in
  // PowerShell (Windows without Git Bash), and a hook that cannot start lets the write through. With
  // `args` set, the CLI spawns `command` directly and each element is one argument, whatever it holds.
  const s = JSON.parse(writeBoundarySettings({ skillsRoots: ["/a b/skills"], runDir: "/r" }));
  const h = s.hooks.PreToolUse[0].hooks[0];
  assert.equal(h.command, process.execPath, "not the Node running the driver: a bare `node` depends on a PATH that is not ours");
  assert.equal(h.args.length, 2);
  assert.match(h.args[0], /deny-authority-write\.mjs$/);
  assert.match(h.args[1], /^[A-Za-z0-9+/=]+$/);
  assert.ok(!/['"]/.test(h.command + h.args.join("")), "shell quoting survived into exec form, where it would be passed literally");
});

test("the hook, spawned exactly as the CLI spawns it, refuses a write into a protected tree", () => {
  // The CLI's side of exec form, reproduced: `command` with `args`, no shell, the tool call on stdin.
  const { args } = buildClaudeArgs({ message: "hi", skillsDir: SKILLS, skillsGrantRoots: [SKILLS], runDir: RUN });
  const h = JSON.parse(args[args.indexOf("--settings") + 1]).hooks.PreToolUse[0].hooks[0];
  const call = (file_path) => spawnSync(h.command, h.args, { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path } }), encoding: "utf8" });
  const denied = call(join(SKILLS, "planted.md"));
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout.trim()).hookSpecificOutput.permissionDecision, "deny",
    "the hook as the CLI would start it let a write into the skills tree through");
  const allowed = call(join(RUN, "findings.json"));
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout.trim(), "", "a write to the run's own top level was refused");
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

// ── LETTER CASE, DECIDED BY THE PROTECTED FOLDER'S OWN DISK ─────────────────────────────────────────────
//
// Measured on the macOS runner, 2026-09-23: a Write to P/SKILLS/probe.md was allowed while P/skills was
// protected, and the file landed in P/skills, because that disk ignores case and the boundary compared
// letter for letter.

test("a folder's disk ignores case when its own name, case swapped, is the same file", () => {
  const same = () => ({ dev: 1, ino: 7 });
  assert.equal(foldsCaseAt("/p/skills", { platform: "darwin", stat: same }), true);
  assert.equal(foldsCaseAt("/p/skills", { platform: "linux", stat: same }), true, "a Linux folder set to ignore case was read as minding it");
  const minds = (p) => { if (p.endsWith("SKILLS")) throw Object.assign(new Error("no"), { code: "ENOENT" }); return { dev: 1, ino: 7 }; };
  assert.equal(foldsCaseAt("/p/skills", { platform: "darwin", stat: minds }), false, "a case-sensitive Mac volume was folded, which refuses real sibling folders");
  const blind = () => { throw Object.assign(new Error("no"), { code: "EACCES" }); };
  assert.equal(foldsCaseAt("/p/skills", { platform: "darwin", stat: blind }), true, "a Mac that could not look did not err toward refusing");
  assert.equal(foldsCaseAt("/p/skills", { platform: "linux", stat: blind }), false);
  assert.equal(foldsCaseAt("C:\\p\\skills", { platform: "win32", stat: minds }), true, "Windows stopped folding");
});

test("the boundary ignores case exactly where the protected folder's disk does", () => {
  const trees = authorityTrees({ skillsRoots: ["/p/skills"] });
  assert.ok(denyReason("/p/SKILLS/merge.sh", trees, { platform: "darwin", foldsCase: () => true }),
    "a write naming the protected folder in another case got past the boundary on a disk that ignores case");
  assert.equal(denyReason("/p/SKILLS/merge.sh", trees, { platform: "linux", foldsCase: () => false }), null,
    "a real sibling folder on a disk that minds case was refused");
});

test("on this machine's own disk, a write naming the protected folder in another case is refused if and only if it lands there", () => {
  const P = mkdtempSync(join(tmpdir(), "case-boundary-"));
  mkdirSync(join(P, "skills"));
  const trees = authorityTrees({ skillsRoots: [join(P, "skills")] });
  assert.equal(hook("Write", join(P, "skills", "probe.md"), { trees }).decision?.permissionDecision, "deny", "the control, the exact spelling, was not refused");
  const folds = foldsCase(P);
  const d = hook("Write", join(P, "SKILLS", "probe.md"), { trees }).decision;
  assert.equal(d?.permissionDecision === "deny", folds, folds
    ? "this disk ignores case, so P/SKILLS/probe.md is inside the protected P/skills, and the boundary let the write through"
    : "this disk minds case, so P/SKILLS is a different folder, and the boundary refused a write that could not reach the protected one");
});

// ── WINDOWS' OTHER SPELLINGS OF ONE FOLDER ──────────────────────────────────────────────────────────────
//
// Measured on a Windows runner, 2026-09-23: a device-form path and the long name of a folder recorded by
// its 8.3 short name both reached a protected folder and were allowed. Driven here with Windows' own answer
// injected; a-windows-write-boundary-knows-every-spelling asks the real Windows.

test("on Windows a device path, a short name and a long name are one folder to the boundary", () => {
  const LONG = { "C:\\Users\\RUNNER~1": "C:\\Users\\runneradmin", "C:\\Users\\runneradmin": "C:\\Users\\runneradmin",
    "C:\\Users\\RUNNER~1\\skills": "C:\\Users\\runneradmin\\skills", "C:\\Users\\runneradmin\\skills": "C:\\Users\\runneradmin\\skills" };
  const realpath = (p) => { if (LONG[p] || p === "C:\\Users" || p === "C:\\") return LONG[p] ?? p; throw Object.assign(new Error("no"), { code: "ENOENT" }); };
  const canonical = (p) => canonicalWindowsPath(p, { realpath });
  const trees = authorityTrees({ skillsRoots: ["C:\\Users\\RUNNER~1\\skills"] });
  for (const spelling of ["\\\\?\\C:\\Users\\RUNNER~1\\skills\\x.md", "\\\\.\\C:\\Users\\RUNNER~1\\skills\\x.md",
    "C:\\Users\\runneradmin\\skills\\x.md", "//?/C:/Users/runneradmin/skills/new/x.md"])
    assert.ok(denyReason(spelling, trees, { platform: "win32", canonical }), `a write spelled ${spelling} reached the protected folder and was allowed`);
  assert.equal(denyReason("C:\\Users\\runneradmin\\skills-backup\\x.md", trees, { platform: "win32", canonical }), null,
    "a sibling folder was refused once spellings were read as one");
});
