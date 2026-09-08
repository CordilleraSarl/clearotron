// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// checkout-move.mjs — is this command about to repoint the whole deployment at a different tree?
//
// ── why this exists (tracker issue 193) ─────────────────────────────────────────────────────────────
//
// `clearotron connect` writes `CLEAROTRON_CHECKOUT_DIR` into the install's env file, set to whatever
// checkout it happened to be run from. Every shipped unit's `ExecStart` is `${CLEAROTRON_CHECKOUT_DIR}/…`,
// so that one line decides which tree the whole deployment executes — and connect said nothing about
// having written it.
//
// Driven on the test deployment: a lane made a worktree to test a branch, ran `connect` from it once, and
//
//   · the next deploy tick fast-forwarded the DETACHED worktree and failed with "You are not currently
//     on a branch" — a message about branches, for a box that was silently a merge behind; and
//   · one unit was left executing from the temporary worktree while three still ran from the real
//     checkout, because only the one connect restarted had restarted. Deleting that worktree would
//     have left a door running fine and unable to ever start again — a failure that surfaces at the
//     next reboot, long after its cause.
//
// The value HAS to be written; the unit needs it. What was missing is that a machine-wide setting was
// rewritten from the process's own working directory, silently, by a verb whose stated job is to
// connect an assistant.
//
// ── WHY THE UNITS' ENV FILE IS THE WRONG THING TO ASK ───────────────────────────────────────────────
//
// `unitEnvironment()` resolves what the units WILL run with, and the natural instinct is to compare
// against that. It cannot see this defect: the file it reads is the one `connect` is about to write,
// so after the write both agree and the drift is invisible. The processes that are actually serving
// are the only witnesses, and they are witnesses precisely because they have NOT restarted.
//
// So the question this module asks is "what tree is the live process executing", answered from the
// running command line, and it is three-valued — a box where nothing could be read must say so rather
// than report a clear coast.
import { entrypointOf } from "../driver/systemd/install-census.mjs";

/**
 * Is writing `next` a MOVE, and from where?
 *
 * A first write is not a move. That distinction is the difference between an installer doing its job
 * on a fresh box and a verb quietly relocating a working deployment, and collapsing the two would make
 * every install print a warning about a move that is not happening.
 */
export function checkoutMove(current, next) {
  const from = String(current ?? "").trim();
  const to = String(next ?? "").trim();
  if (!to) return { moving: false, first: false, from: from || null, to: null,
    why: "no checkout directory was resolved, so nothing is being written" };
  if (!from) return { moving: false, first: true, from: null, to, why: null };
  return { moving: from !== to, first: false, from, to, why: null };
}

/**
 * The tree a RUNNING process is executing, read from its own command line.
 *
 * @param {string[]|string} cmdline  argv, or the NUL-separated bytes of /proc/<pid>/cmdline
 * @param {string} rel  the unit's entrypoint relative to the checkout root, from `entrypointOf`
 */
export function treeOfRunning(cmdline, rel) {
  if (!rel) return { tree: null, why: "the unit does not name a module under the checkout directory" };
  const args = Array.isArray(cmdline)
    ? cmdline.map(String)
    : String(cmdline ?? "").split("\0").filter(Boolean);
  const suffix = `/${rel}`;
  // ABSOLUTE ONLY. A relative argv[1] is resolved against the process's cwd, which this command cannot
  // read and must not guess — reporting a tree derived from the wrong base would be worse than saying
  // nothing, because the whole output of this module is a claim about which tree is live.
  const hit = args.find((a) => a.startsWith("/") && a.endsWith(suffix));
  if (!hit) {
    return { tree: null,
      why: `no argument on the running command line is an absolute path ending in ${suffix}` };
  }
  return { tree: hit.slice(0, hit.length - suffix.length), why: null };
}

/**
 * What the live processes say about a move that is about to happen.
 *
 * @param {object} a
 * @param {{moving: boolean, from: string|null, to: string|null}} a.move  from `checkoutMove`
 * @param {{unit: string, cmdline: string[]|string|null, unitText: string|null, why: string|null}[]} a.running
 * @returns {{state: "not-moving"|"clear"|"conflict"|"unknown", conflicts: object[], looked: string[], why: string|null}}
 *   `unknown` is a state and not an empty `conflicts`, because "nothing is running from elsewhere" and
 *   "this command could not tell" are different answers and only one of them is a coast.
 */
export function movePosture({ move, running = [] }) {
  if (!move?.moving) return { state: "not-moving", conflicts: [], looked: [], why: null };
  const conflicts = [];
  const looked = [];
  const blind = [];
  for (const r of running ?? []) {
    if (r?.why || !r?.cmdline) { blind.push({ unit: r?.unit ?? "(unnamed)", why: r?.why ?? "it is not running" }); continue; }
    const { rel, unreadable } = entrypointOf(r.unitText ?? "");
    if (unreadable) { blind.push({ unit: r.unit, why: unreadable }); continue; }
    const { tree, why } = treeOfRunning(r.cmdline, rel);
    if (!tree) { blind.push({ unit: r.unit, why }); continue; }
    looked.push(r.unit);
    if (tree !== move.to) conflicts.push({ unit: r.unit, tree });
  }
  if (conflicts.length) return { state: "conflict", conflicts, looked, why: null };
  // NOTHING READ IS NOT A CLEAR COAST. A box where every unit was unreadable would otherwise report the
  // same "no conflict" as a box that was genuinely all on one tree.
  if (!looked.length) {
    // ONE REASON, SAID ONCE. The first drive of this printed every unit and its identical reason on a
    // single line — a wall a reader skips, on the most common box of all: one with no units installed.
    const reasons = [...new Set(blind.map((b) => b.why))];
    const why = !blind.length
      ? "no services are running, so nothing could disagree with this write"
      : reasons.length === 1
        ? `none of the ${blind.length} installed unit(s) could be read — ${reasons[0]}`
        : `no running service could be read: ${blind.map((b) => `${b.unit} (${b.why})`).join("; ")}`;
    return { state: "unknown", conflicts: [], looked: [], why };
  }
  return { state: "clear", conflicts: [], looked, why: null };
}

/** What a reader is told about the move itself. Named paths, both of them. */
export function describeMove(move) {
  if (move.first) return [`  This install's checkout directory will be set to ${move.to}.`];
  if (!move.moving) return [];
  return [
    "  THIS MOVES THE WHOLE DEPLOYMENT TO A DIFFERENT TREE.",
    `      from  ${move.from}`,
    `      to    ${move.to}`,
    "  Every unit's ExecStart is ${CLEAROTRON_CHECKOUT_DIR}/…, and the deploy timer fast-forwards that",
    "  same directory — so this decides which tree the box runs and updates, not just this command.",
  ];
}

/** What a reader is told when live services disagree with the write. */
export function describeConflict(posture, move) {
  if (posture.state === "conflict") {
    return [
      "  REFUSED — services on this box are running from a different checkout:",
      ...posture.conflicts.map((c) => `      ${c.unit}  is executing  ${c.tree}`),
      `  Writing ${move.to} would leave those processes running from a tree the install no longer names.`,
      "  They keep working until they restart and then cannot start at all, which surfaces at the next",
      "  reboot rather than here. Deleting the old tree has the same effect and is not recoverable by",
      "  restarting.",
      "",
      "  Run this from the checkout the box is deployed from, or restart the services onto this one",
      "  first. `--allow-checkout-move` writes it anyway.",
    ];
  }
  if (posture.state === "unknown") {
    return [
      `  This command could not tell which tree the running services are executing: ${posture.why}`,
      "  It is writing the move anyway, and saying so, because it cannot prove a conflict either way.",
    ];
  }
  return [];
}

/**
 * Programs executing this product from a tree OTHER than the one the install names (tracker issue 193).
 *
 * `doctor` already reports a running program older than the checkout. This is the same question with
 * the more dangerous answer: a process on a DIFFERENT tree keeps working until it restarts, and then
 * cannot start at all — a failure that surfaces at the next reboot, long after its cause. Deleting the
 * tree it runs from does the same thing and is not recoverable by restarting.
 *
 * `null` for the table means the instrument did not run, and it stays distinct from an empty machine
 * all the way to the reader — the property `readOwnProcesses` was rewritten to protect.
 *
 * @param {object} a
 * @param {{pid:number, cmd:string}[]|null} a.table  from `processTable()`
 * @param {string} a.checkoutDir  the tree the install NAMES, which is what the units will use next start
 * @param {string[]} a.entrypoints  unit entrypoints relative to the checkout root, from `entrypointOf`
 */
export function programsFromAnotherCheckout({ table, checkoutDir, entrypoints = [] }) {
  if (table === null) return { state: "unknown", detail: "the process table could not be read", programs: [] };
  const want = String(checkoutDir ?? "").trim();
  if (!want) return { state: "unknown", detail: "this install does not name a checkout directory, so there is nothing to differ from", programs: [] };
  if (!entrypoints.length) {
    return { state: "unknown", programs: [],
      detail: "no installed unit names a module under the checkout directory, so no command line can be attributed to this product" };
  }
  const programs = [];
  let attributed = 0;                         // running programs this product could actually place
  for (const p of table) {
    const argv = String(p?.cmd ?? "").split(/\s+/).filter(Boolean);
    for (const rel of entrypoints) {
      const { tree } = treeOfRunning(argv, rel);
      if (tree && tree !== want) { attributed++; programs.push({ pid: p.pid, tree, cmd: String(p.cmd).slice(0, 120) }); break; }
      if (tree) { attributed++; break; }       // attributed, and on the right tree
    }
  }
  if (programs.length) return { state: "elsewhere", programs, detail: null };
  // AN EMPTY RESULT IS TWO ANSWERS AND THIS USED TO GIVE ONE. `current` meant "every running program is
  // on the tree this install names" — which is only true if a running program was PLACED on a tree at
  // all. When nothing could be attributed, the same word was returned, and "I could not place anything"
  // was reported to the reader as "everything agrees". That is the absence-as-pass this repository keeps
  // paying for, wearing a verdict's clothes.
  //
  // Two shapes reach here with nothing attributed and they are indistinguishable from outside: nothing
  // of this product is running, or something is and its command line does not name its module. Neither
  // is agreement, so neither gets the word, and the verdict says which question went unanswered.
  if (!attributed) {
    return { state: "unplaced", programs: [],
      detail: "no running program could be attributed to this install — either nothing of it is "
        + "running, or what is running does not name its module on the command line. Not agreement" };
  }
  return { state: "current", programs, detail: null, attributed };
}
