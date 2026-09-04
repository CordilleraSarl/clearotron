// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// authority-trees.mjs — WHAT A SEAT MAY NEVER WRITE INTO, and the pure decision behind the deny-hook.
//
//: a live clearance wrote two files into the skills tree. Reading the grant layer first showed the
// incident was not a seat doing something exotic — `buildClaudeArgs` grants that tree with `--add-dir`,
// which has NO read-only form, under `--permission-mode acceptEdits` which auto-approves Write and Edit
// so stages can save their outputs without prompting. The tree is writable BY GRANT, under a comment
// that said READ and a variable called `skillsReadRoots`. Dictated intent with no mechanism — the
// week's defect class, in the tool-grant layer.
//
// So the boundary cannot be a narrower grant (none exists) and cannot be removing the grant (the tree
// must be read). It is enforced at the moment of the write.
//
// ── THE ENUMERATION IS THE SPEC, and it was written before this file ──────────────────────────
//
// A hook that cannot tell "the driver writes this, a seat must not" from "a seat legitimately writes
// this" either blocks real work or protects nothing. So:
//
//   skillsDir / skillsOverlayDir   deploy-authored doctrine       seat write NEVER legitimate — LIVE hole
//   profilesDir                    deploy-authored profiles       NEVER legitimate — DEFENSIVE, see below
//   <runDir>/_driver/**            driver-authored per-run facts  NEVER legitimate — LIVE hole
//   <runDir>/*  (top level)        THE SEAT'S OWN WORKSPACE       always legitimate — must stay open
//
// `_driver/` is the sharpest inclusion. It holds the frozen plan, the grid specs, the plan-execution
// receipt, the form sidecars and `run.jsonl` — and it sits inside `runDir`, which is granted READ+WRITE
// by design. Every diagnosis run on 2026-08-14 (,) read those files as ground
// truth. A seat writing them would be forging the record the engine is judged by.
//
// `profilesDir` is DEFENSIVE, not a live hole: it appears in no `--add-dir`, so the file tools cannot
// reach it today. It is in scope anyway, because a hook covering only what is reachable today stops
// covering the thing the day someone widens a grant — but the distinction is stated rather than letting
// four entries read as four live holes.
//
// THE RUN DIR'S TOP LEVEL MUST STAY WIDE OPEN. A seat writes its findings, its forms, its grids and its
// prose there on every run. A hook keyed on "anywhere unexpected" would break every run; this one is
// keyed on authority, and blocks nothing a seat legitimately does.
//
// ── DIRECTION, so a veto is a revert rather than an excavation ───────────────────────────────────────
//
// Owner-ruled 2026-08-14: a DENY-HOOK, chosen over the shipped notice-only posture. The rejected
// alternative was detect-and-journal alone — which could never have been enough, because the behaviour
// it journalled was PERMITTED. Filesystem permission changes were explicitly recommended against (the
// set-GID scar on the pool root). The existing detect-and-journal sweep STAYS as corroboration; its
// never-kill-a-run property is sound and survives.

import { resolve, sep } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

/** Is `child` inside `root` — by path segment, never by string prefix? PURE. */
export function isInside(root, child) {
  const r = resolve(String(root ?? ""));
  const c = resolve(String(child ?? ""));
  if (!r || r === "." || !c) return false;
  // `/a/skills-backup` is NOT inside `/a/skills`. A `startsWith` without the separator says it is, and
  // that is the classic form of this check being wrong in the direction that blocks real work.
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * The trees a seat may never write into, for one run.
 * @returns {Array<{path:string, why:string, live:boolean}>}
 */
export function authorityTrees({ skillsRoots = [], profilesDir = null, runDir = null } = {}) {
  const out = [];
  for (const r of skillsRoots.filter(Boolean))
    out.push({ path: r, why: "the doctrine tree — the instructions this seat is obeying", live: true });
  if (profilesDir)
    out.push({ path: profilesDir, why: "the customer profile + framework authority", live: false });
  if (runDir)
    out.push({ path: driverDir(resolve(runDir)), why: "the driver's own per-run record — the plan, the receipts, the attempt log", live: true });
  return out;
}

/**
 * Should this write be denied? Returns the reason, or null to allow. PURE.
 *
 * THE WORDING IS DECLARATIVE, AND THAT IS A MEASURED REQUIREMENT, not a style preference. The first
 * version of this text told the seat what to do next — "continue with your task and write your file where
 * you were told to". The live probe came back with the seat refusing to trust it: "that's a
 * prompt-injection pattern (a tool result trying to redirect my behavior), not something I'm treating as
 * authoritative" — and it then declined the remaining legitimate step. A well-aligned model is SUPPOSED to
 * distrust instructions arriving through a tool result, so a refusal written as an instruction derails the
 * very turn it exists to let continue.
 *
 * So this states facts about the configuration and nothing about the model's behaviour: what was refused,
 * why it is refused, that a retry gets the same answer, and where stage output lives. No second person, no
 * imperative. The seat decides what to do with a fact, which is the whole difference.
 */
export function denyReason(targetPath, trees) {
  const t = String(targetPath ?? "").trim();
  if (!t) return null;
  for (const tree of trees ?? []) {
    if (!isInside(tree.path, t)) continue;
    return `REFUSED by the driver's write boundary: ${t} is inside ${tree.why} (${tree.path}). `
      + `That tree is authored at deploy time and never by a running stage, so the refusal is configuration `
      + `rather than a permission prompt, and a retry of the same path returns this same answer. Stage `
      + `output belongs under the run directory, at the absolute path named in the stage instructions. `
      + `The refusal was issued by the driver, not by the model, and the run is unaffected by it.`;
  }
  return null;
}
