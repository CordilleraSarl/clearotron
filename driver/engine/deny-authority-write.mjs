#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// deny-authority-write.mjs — THE WRITE BOUNDARY, enforced at the moment of the write.
//
// A PreToolUse hook. `claude -p` runs it before every Write/Edit, hands it the tool call on stdin, and
// obeys `permissionDecision: "deny"` — the tool call fails, the seat is told why, THE TURN CONTINUES.
// Measured on the live CLI (2.1.221), not assumed: see driver/test/deny-authority-write.test.mjs and the
// acceptance transcript.
//
// ── WHY A HOOK, AND NOT THE THING YOU WOULD TRY FIRST ────────────────────────────────────────────────
//
// 's incident was a live clearance writing two files into the skills tree. The obvious reading is
// "a seat did something it should not". Reading the grant layer first says otherwise: `buildClaudeArgs`
// grants that tree with `--add-dir`, WHICH HAS NO READ-ONLY FORM, under `--permission-mode acceptEdits`
// which auto-approves Write/Edit so each stage can save its output without prompting. The tree was
// writable BY GRANT. The seat did what it was permitted to do, under a comment that said READ and a
// variable named `skillsReadRoots`.
//
// So the two cheaper fixes are both unavailable, for stated reasons rather than taste:
//   - a narrower grant: there is none. `--add-dir` is read+write or absent.
//   - dropping the grant: the tree must be READ — it is the doctrine the seat is executing.
// And the shipped posture, detect-and-journal, could never have been enough: the behaviour it journals
// is PERMITTED, so it reports a fact rather than preventing one. Owner-ruled 2026-08-14: deny-hook chosen
// over notice-only. A morning veto is a revert.
//
// THE SWEEP STAYS, and for a sharper reason than corroboration. This boundary depends on the CLI honouring
// `--settings`: a renamed flag, a `--bare` added to the arg list, or a CLI upgrade that changes the hook
// contract would disable it SILENTLY — the same failure shape it exists to fix, one layer up. Nothing here
// can detect that. `stray-artifacts.mjs` snapshots the doctrine tree and diffs it after the run, so a write
// that got through by any route still surfaces. The hook is the boundary; the sweep is the witness that the
// boundary is still there.
//
// NO FILESYSTEM PERMISSION CHANGES. Considered and rejected: the pool root is set-GID and a non-member
// chmod silently strips it, after which every report 403s. That scar is why the boundary lives here.
//
// ── FAIL-CLOSED, DELIBERATELY ────────────────────────────────────────────────────────────────────────
//
// Any internal error — an undecodable policy payload, an unreadable tool call — DENIES. A boundary that
// disappears when it is buggy is not a boundary, and this is the exact failure shape the week has been
// spent on: a rule that reads correctly and enforces nothing. The blast radius is bounded and loud (a
// stage cannot write its output, the run fails at once with the reason in the tool error) rather than
// silent. The policy travels in this hook's OWN argv, so "installed but unconfigured" is unreachable:
// buildClaudeArgs emits the command and the roots as one object.

import { readFileSync, appendFileSync } from "node:fs";

import { driverDir } from "../../shared/driver-dir.mjs";   //
import { denyReason } from "../authority-trees.mjs";
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";   //

// The tools that can name a file to write. Matched here AND in the settings matcher that installs this
// hook; the matcher is the real gate, since a tool it does not name never reaches this process.
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// ── — THE BASH ARM IS A DETECTOR. IT IS NOT A BOUNDARY, AND THE DIFFERENCE COST US A DAY ────────
//
// WHAT USED TO BE WRITTEN HERE, as fact, in the present tense: "`allowedToolsFor()` grants exactly
// Read/Write/Edit plus namespaced MCP tools — no Bash, no MultiEdit — so the granted write surface today
// is Write and Edit."
//
// Its first half was true and checkable: `Bash` appears nowhere in `gather-config.mjs`, in any group,
// including the `extra` escape, and nowhere in its history either. THE CONCLUSION WAS FALSE. The flag
// carrying that table is passed only when set and does not restrain BUILT-IN tools at all. Seats have
// Bash — 4,593 calls across 567 recorded sessions, naming absolute paths outside the granted roots,
// including the seat at the centre of the 2026-08-15 failure.
//
// Three readers checked that premise at source in one day and all three were satisfied, and it came
// within one review of putting a claim of impossibility into a design. NO SENTENCE REPLACES IT: the
// grant table is one file away, and a reader who wants to know what is granted should open it rather
// than trust a summary that ages silently. That is the whole lesson and it is why nothing is asserted
// here about what is granted.
//
// WHAT THIS ARM DOES, AND WHAT IT CANNOT DO. It sees a REDIRECT or a KNOWN WRITING COMMAND naming a
// guarded path. It does not parse the shell. A shell parser is the thing this codebase keeps deciding
// not to build, and it would still lose to a command composed to defeat it — so this is evadable by
// anyone trying, and it is not defending against anyone trying. It covers the shape that actually
// happened: was files written into a guarded tree.
//
// TRUE COVERAGE LIVES OUTSIDE THE AGENT — the seat process not holding write permission to the guarded
// paths at all. That is an OS-level decision with owner history behind it, and it is not this file's.
//
// FALSE DENIES ARE THE REAL RISK, not missed ones. A hook that blocks legitimate work gets removed, and
// then nothing is guarded at all. So a path is only ever a WRITE target here when the command's own
// syntax says so — a `grep`, a `jq` or a `cat` READING a guarded file passes untouched, which is normal
// and frequent seat behaviour.
const REDIRECT_RE = /(?:^|[\s;|&(])(?:\d?>>?|&>)\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&)]+))/g;
const WRITER_CMDS = new Set(["tee", "cp", "mv", "dd", "install", "truncate", "touch", "ln", "rsync", "unzip", "tar"]);
// `sed -i` and `perl -i` edit in place; the flag is what makes them writers, so the flag is what is read.
const INPLACE_RE = /(?:^|[\s;|&(])(?:sed|perl)\s+(?:-\S*\s+)*-i\S*/;

/** Every path a Bash command's own syntax marks as a WRITE target. PURE, and deliberately narrow. */
export function bashWriteTargets(command) {
  const cmd = String(command ?? "");
  if (!cmd.trim()) return [];
  const out = [];
  for (const m of cmd.matchAll(REDIRECT_RE)) {
    const p = m[1] ?? m[2] ?? m[3];
    if (p && !/^&?\d+$/.test(p) && !/^\/dev\//.test(p)) out.push(p);   // `2>&1` and /dev/null are not files
  }
  // A known writer's arguments: every non-flag token that looks like a path. `cp a b` marks BOTH, because
  // deciding which argument is the destination is argument-order parsing per command, and being wrong in
  // the permissive direction is the failure this arm exists to avoid.
  const inplace = INPLACE_RE.test(cmd);
  for (const seg of cmd.split(/[;|&]+|\$\(|\)/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const head = toks[0].split("/").pop();
    if (!WRITER_CMDS.has(head) && !(inplace && (head === "sed" || head === "perl"))) continue;
    for (const t of toks.slice(1)) {
      if (t.startsWith("-")) continue;
      const p = t.replace(/^["']|["']$/g, "");
      if (p.includes("/")) out.push(p);
    }
  }
  return [...new Set(out)];
}

/** The path a write tool names. PURE. */
export function targetOf(toolName, toolInput = {}) {
  if (!WRITE_TOOLS.has(String(toolName ?? ""))) return null;
  return toolInput?.file_path ?? toolInput?.notebook_path ?? null;
}

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
};

// A denial nobody records is a denial nobody learns from — was noticed days late. Its own file, so
// it never races run.jsonl's writer. Best-effort BY CONSTRUCTION: the deny is emitted whether or not the
// journal lands, because a boundary that depends on a successful write is not one.
function journal(runDir, row) {
  if (!runDir) return;
  try { appendFileSync(driverDir(runDir, "authority-denials.jsonl"), JSON.stringify(row) + "\n"); } catch { /* the deny still stands */ }
}

function main() {
  let policy, call;
  try {
    policy = JSON.parse(Buffer.from(String(process.argv[2] ?? ""), "base64").toString("utf8"));
    call = JSON.parse(readFileSync(0, "utf8"));
  } catch (e) {
    return deny(`REFUSED by the driver's write boundary: it could not read this tool call `
      + `(${String(e?.message ?? e).slice(0, 120)}), so it cannot confirm the target is a permitted one, and it `
      + `refuses rather than assumes. This is a driver fault and it affects every write in this run until it is `
      + `fixed. The refusal was issued by the driver, not by the model.`);
  }
  // — a file tool names ONE target; a Bash command can mark several, so both shapes reduce to a list.
  // An empty list is "not a write we can locate", which is this arm's normal answer and not a pass: the
  // arm is a detector and says so at its declaration.
  const targets = String(call?.tool_name ?? "") === "Bash"
    ? bashWriteTargets(call?.tool_input?.command)
    : [targetOf(call?.tool_name, call?.tool_input)].filter(Boolean);
  if (!targets.length) process.exit(0);               // not a write we can locate — not this hook's business
  // AN EMPTY TREE LIST IS NOT "NOTHING IS PROTECTED". A policy that decoded but carries no trees is a
  // policy that did not arrive — valid JSON with the wrong shape — and reading it as an empty boundary is
  // the exact zero-means-pass mistake this shop has paid for repeatedly. buildClaudeArgs never installs
  // the hook with nothing to protect (it omits --settings entirely), so this state is unreachable except
  // through corruption.
  if (!Array.isArray(policy?.trees) || policy.trees.length === 0)
    return deny(`REFUSED by the driver's write boundary: its policy decoded but names no protected tree, so `
      + `it cannot confirm this target is a permitted one, and it refuses rather than assumes. This is a driver `
      + `fault. The refusal was issued by the driver, not by the model.`);
  for (const target of targets) {
    const reason = denyReason(target, policy.trees);
    if (!reason) continue;
    journal(policy?.runDir, { at: new Date().toISOString(), event: "authority-write-denied", tool: call?.tool_name, target, session: call?.session_id ?? null, toolUseId: call?.tool_use_id ?? null });
    deny(reason);
  }
  process.exit(0);
}

// — DECIDING BY FILENAME IS THE SEVENTH SPELLING, and it is the one the
// entry-point census could not see: it compares argv[1] to a literal name and never mentions
// `import.meta.url`, which is half of that guard's population test. Measured — this file under any
// other name exited 0 with ZERO BYTES of output, and comparing basenames also answers TRUE for an
// unrelated script that happens to share the name. `isEntrypoint` realpaths both sides.
if (isEntrypoint(import.meta.url)) main();
