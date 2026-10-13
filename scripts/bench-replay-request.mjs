// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// bench-replay-request.mjs — ask for a replay of saved cases when a push moved the engine pins.
//
//   node scripts/bench-replay-request.mjs     # in the push workflow; reads SHA, BEFORE, REPO, GH_TOKEN
//
// A change to a model or an engine program's floor changes what a clearance reads and writes while every
// test around it stays green, so it is replayed on saved cases before the beta that carries it is cut.
// This is the request: a `bench replay` status on the pushed commit, `pending` with the description
// `waiting`. The machine that holds the saved cases picks it up, replays, and sets pass or flag. Nothing
// waits for it here and nothing is blocked; the cut reads it (release-bench-replay-check.mjs).
//
// WHAT IS COMPARED. The pushed commit against the branch's previous tip (BEFORE), both judged by THIS
// commit's rule (engine-pins.mjs), so a tree from before that script existed still gets a real answer.
// A new branch has no previous tip and is compared with where it leaves main. Equal pins post nothing.
// A parent this rule cannot read posts `waiting` too: "could not tell" is never "unchanged".
//
// A SQUASH ON MAIN ASKS ONCE. When the pushed commit is the squash of a pull request whose head already
// carries a final answer for the same pins, that answer is copied rather than asked for again.
//
// The status carries the context and one word, never a link, a count or a case: it sits on a public commit.
//
// Exit 0: done (posted, copied, or nothing to ask). Exit 2: could not look.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pinState } from "./engine-pins.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const CONTEXT = "bench replay";
export const PIN_FILES = ["driver/engine/openai-agent.mjs", "driver/driver.config.mjs"];
const NO_COMMIT = /^0+$/;

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The pins of `commit`, judged by the rule in this checkout: its two pin files, laid into a scratch tree. */
export function pinsAt(commit, { cwd = process.cwd() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "engine-pins-"));
  try {
    for (const rel of PIN_FILES) {
      let text;
      try { text = execFileSync("git", ["show", `${commit}:${rel}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }); }
      catch { continue; }   // absent at that commit: the rule below says could-not-look, by name
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return pinState(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The latest `bench replay` state on `sha`, or null. `api(path)` answers a GitHub REST GET. */
export async function latestReplay(api, sha) {
  const statuses = await api(`commits/${sha}/statuses?per_page=100`);
  const mine = statuses.filter((s) => s.context === CONTEXT);   // newest first, as the API lists them
  return mine.length ? { state: mine[0].state, description: mine[0].description ?? "" } : null;
}

/**
 * What to post on `sha`, or null for nothing. PURE apart from the injected readers, so each path is tested
 * without a repository or a network: `pins(commit)` returns a pin state or throws; `squashHead()` names the
 * merged pull request's head when `sha` is a squash on main, else null; `replay(sha)` is latestReplay.
 */
export async function decide({ sha, parent, pins, squashHead, replay }) {
  const head = pins(sha);
  let before = null;
  try { before = pins(parent); } catch { /* could not tell: ask */ }
  if (before && before.digest === head.digest) return null;
  const prHead = await squashHead();
  if (prHead) {
    let prPins = null;
    try { prPins = pins(prHead); } catch { /* could not tell: ask */ }
    const answer = prPins && prPins.digest === head.digest ? await replay(prHead) : null;
    if (answer && (answer.state === "success" || answer.state === "failure")) return answer;
  }
  return { state: "pending", description: "waiting" };
}

if (isEntrypoint(import.meta.url)) {
  const { SHA, BEFORE = "", REPO, GH_TOKEN } = process.env;
  if (!SHA || !REPO || !GH_TOKEN) { process.stderr.write("bench-replay-request: SHA, REPO and GH_TOKEN are required\n"); process.exit(2); }
  const api = async (path, init = {}) => {
    const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      ...init, headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json", ...(init.headers ?? {}) } });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${r.status}`);
    return r.json();
  };
  try {
    const parent = BEFORE && !NO_COMMIT.test(BEFORE) ? BEFORE : git(["merge-base", "origin/main", SHA]);
    const decision = await decide({
      sha: SHA, parent,
      pins: (c) => pinsAt(c),
      squashHead: async () => {
        const pulls = await api(`commits/${SHA}/pulls`);
        const pr = pulls.find((p) => p.merge_commit_sha === SHA && p.merged_at);
        if (!pr) return null;
        git(["fetch", "--quiet", "origin", `refs/pull/${pr.number}/head`]);
        return pr.head.sha;
      },
      replay: (s) => latestReplay(api, s),
    });
    if (!decision) { console.log(`bench-replay-request: the engine pins did not move against ${parent.slice(0, 12)}; nothing to ask`); process.exit(0); }
    await api(`statuses/${SHA}`, { method: "POST", body: JSON.stringify({ state: decision.state, context: CONTEXT, description: decision.description }) });
    console.log(`bench-replay-request: ${CONTEXT} set to ${decision.state} (${decision.description}) on ${SHA.slice(0, 12)}`);
  } catch (e) {
    process.stderr.write(`bench-replay-request: could not look — ${e.message}\n`);
    process.exit(2);
  }
}
