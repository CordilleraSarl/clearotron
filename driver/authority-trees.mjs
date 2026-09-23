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
// by design. Every diagnosis run on 2026-08-14 () read those files as ground
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

import { statSync } from "node:fs";
import { resolve, win32, posix } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

/**
 * Is `child` inside `root` — by path segment, never by string prefix? PURE.
 *
 * ON WINDOWS BY WINDOWS RULES. There a path may use either separator and a name matches in any case, so
 * `c:/users/x/SKILLS/a.md` is a file inside `C:\Users\x\skills`. Compared as Linux compares, the
 * write lands in the protected tree and the boundary lets it through. `platform` is a parameter so that
 * branch runs on a Linux CI. `foldCase` says whether to ignore letter case: always on Windows, and
 * elsewhere as foldsCaseAt finds the protected folder's disk, which denyReason asks for each tree.
 */
export function isInside(root, child, { platform = process.platform, foldCase = platform === "win32" } = {}) {
  const P = platform === "win32" ? win32 : posix;
  const fold = foldCase ? (s) => s.toLowerCase() : (s) => s;
  const r = fold(P.resolve(String(root ?? "")));
  const c = fold(P.resolve(String(child ?? "")));
  if (!r || r === "." || !c) return false;
  // `/a/skills-backup` is NOT inside `/a/skills`. A `startsWith` without the separator says it is, and
  // that is the classic form of this check being wrong in the direction that blocks real work.
  return c === r || c.startsWith(r.endsWith(P.sep) ? r : r + P.sep);
}

const swapCase = (s) => [...s].map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())).join("");
const foldMemo = new Map();

/**
 * Does the disk holding `root` ignore letter case? Asked of THAT folder, never of the platform.
 *
 * A Mac's default volume ignores case, so `P/SKILLS/x.md` is a file inside `P/skills`, and a boundary
 * comparing letter for letter let the write through: measured on the macOS runner, 2026-09-23. But a Mac
 * volume can be formatted to mind case, and a Linux folder can be set to ignore it, so the platform does
 * not answer. The folder is stat'ed under its own name and under that name with every letter's case
 * swapped: the same file under both means this disk ignores case. It writes nothing, so it adds nothing to
 * a protected tree.
 *
 * WINDOWS ALWAYS FOLDS, as it did before this was asked, because NTFS ignores case unless a folder is set
 * otherwise. Where the question cannot be put (the folder does not exist yet, or its name has no letters)
 * the answer is the platform's default disk, Windows and macOS folding, so a Mac errs toward refusing. The
 * answer is kept per folder for the life of the process. `stat` is injected so every branch runs on Linux.
 */
export function foldsCaseAt(root, { platform = process.platform, stat = statSync } = {}) {
  if (platform === "win32") return true;
  const abs = posix.resolve(String(root ?? ""));
  const key = `${platform}|${abs}`;
  if (foldMemo.has(key) && stat === statSync) return foldMemo.get(key);
  const byDefault = platform === "darwin";
  const name = posix.basename(abs);
  let answer = byDefault;
  const other = swapCase(name);
  if (name && other !== name) {
    try {
      const own = stat(abs);
      try {
        const swapped = stat(posix.join(posix.dirname(abs), other));
        answer = own.dev === swapped.dev && own.ino === swapped.ino;
      } catch (e) {
        answer = e?.code === "ENOENT" || e?.code === "ENOTDIR" ? false : byDefault;
      }
    } catch { answer = byDefault; }
  }
  if (stat === statSync) foldMemo.set(key, answer);
  return answer;
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
export function denyReason(targetPath, trees, { platform = process.platform, foldsCase = (root) => foldsCaseAt(root, { platform }) } = {}) {
  const t = String(targetPath ?? "").trim();
  if (!t) return null;
  for (const tree of trees ?? []) {
    if (!isInside(tree.path, t, { platform, foldCase: foldsCase(tree.path) })) continue;
    return `REFUSED by the driver's write boundary: ${t} is inside ${tree.why} (${tree.path}). `
      + `That tree is authored at deploy time and never by a running stage, so the refusal is configuration `
      + `rather than a permission prompt, and a retry of the same path returns this same answer. Stage `
      + `output belongs under the run directory, at the absolute path named in the stage instructions. `
      + `The refusal was issued by the driver, not by the model, and the run is unaffected by it.`;
  }
  return null;
}
