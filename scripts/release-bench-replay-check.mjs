// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-bench-replay-check.mjs — a cut waits while a moved engine pin has no passing bench replay.
//
//   node scripts/release-bench-replay-check.mjs [--since <tag>]    # reads REPO and GH_TOKEN
//
// The push workflow asks for a replay of saved cases whenever a push moves the engine pins
// (bench-replay-request.mjs); the machine holding the cases answers with a `bench replay` status, pass or
// flag. This is where that answer is read: before a beta or a stable is cut from HEAD.
//
// WHAT IT COMPARES. The pins at HEAD against the pins at the last version cut (`--since`, by default the
// newest `v*` tag HEAD contains), both judged by THIS checkout's rule. Equal pins: nothing to read. Moved
// pins: the commits since that tag, on main's own line, whose pins equal HEAD's are the ones that carry
// today's pins, and one of them must carry a passing `bench replay`.
//
// WHAT HOLDS THE CUT, and only one thing lets it through:
//   pass on any of those commits ............ cut
//   flag, and no pass ....................... held — fix it, or explain it on the change's issue and set pass by hand
//   waiting, or no status at all ............ held — "not reported"; an absent answer is never a pass
// The output names the commit and the state, never a count or a case: it is printed in a public log.
//
// Exit 0: nothing moved, or a replay passed. Exit 1: held. Exit 2: could not look.

import { execFileSync } from "node:child_process";
import { pinsAt, latestReplay, CONTEXT } from "./bench-replay-request.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * The verdict for a cut of `head` since `since`. PURE apart from the injected readers: `pins(commit)`
 * returns a pin state or throws, `line()` lists the commits since `since` on main's own line, newest first,
 * and `replay(sha)` returns the latest `bench replay` state or null.
 */
export async function verdict({ head, since, pins, line, replay }) {
  const now = pins(head);
  let then = null;
  try { then = pins(since); } catch { /* could not tell: the replay must answer */ }
  if (then && then.digest === now.digest) return { hold: false, why: `no engine pin moved since ${since}` };
  const carrying = [];
  for (const c of line()) {
    let p = null;
    try { p = pins(c); } catch { /* a commit the rule cannot read carries no answer */ }
    if (!p || p.digest !== now.digest) break;   // older than the last move: its answer was for other pins
    carrying.push(c);
  }
  const answers = [];
  for (const c of carrying) answers.push({ sha: c, answer: await replay(c) });
  const pass = answers.find((a) => a.answer?.state === "success");
  if (pass) return { hold: false, why: `${CONTEXT}: ${pass.answer.description || "pass"} on ${pass.sha.slice(0, 12)}` };
  const flag = answers.find((a) => a.answer?.state === "failure");
  if (flag) return { hold: true, why: `${CONTEXT}: flagged on ${flag.sha.slice(0, 12)} — fix it, or explain it on the change's issue and set pass by hand` };
  return { hold: true, why: `${CONTEXT}: not reported for the engine pins at ${String(head).slice(0, 12)}${answers.some((a) => a.answer) ? " (still waiting)" : ""}` };
}

if (isEntrypoint(import.meta.url)) {
  const { REPO, GH_TOKEN } = process.env;
  const args = process.argv.slice(2);
  try {
    if (!REPO || !GH_TOKEN) throw new Error("REPO and GH_TOKEN are required");
    if (args.length && !(args.length === 2 && args[0] === "--since")) throw new Error("usage: [--since <tag>]");
    const since = args[1] ?? git(["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"]);
    const head = git(["rev-parse", "HEAD"]);
    const api = async (path) => {
      const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`,
        { headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
      return r.json();
    };
    const v = await verdict({
      head, since, pins: (c) => pinsAt(c),
      line: () => git(["rev-list", "--first-parent", `${since}..${head}`]).split("\n").filter(Boolean),
      replay: (sha) => latestReplay(api, sha),
    });
    console.log(`release-bench-replay-check: ${v.why}`);
    process.exit(v.hold ? 1 : 0);
  } catch (e) {
    process.stderr.write(`release-bench-replay-check: could not look — ${e.message}\n`);
    process.exit(2);
  }
}
