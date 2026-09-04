// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// usage-ledger.mjs — what an account has SPENT against its daily allowance, counted from the same
// ledger the admission wall counts.
//
// Extracted from portal-service.mjs (2026-07-27) because the portal is no longer the only door that
// owes a client an honest number: the MCP preview has to be able to say "this account has used all of
// today's searches" BEFORE an agent calls start_run, and importing portal-service to get it would drag
// a whole HTTP service — its router, its static handler, its upstream client — into a tool call. Pure
// leaf: node:fs + node:path (+ queue-markers.mjs, itself import-free), no driver imports, no env reads.
// portal-service re-exports both names, so every existing caller is untouched.
//
// THIS FILE OWNS THE LEDGER PATH. It used to reconstruct a workspace-relative one —
// `<workspaceRoot>/workspace-*/studio/prelim-search/.matter-ledger.jsonl` — under a comment claiming it
// was what runner.mjs computed. The comment was right and the code was not: once the product moved the
// queue to a standalone directory, that path resolved to nothing, and because a missing ledger is a low
// count rather than an error, every account read as ZERO on every request. Two copies of one calculation
// drifting apart. There is now one copy, it lives here (the leaf, so a request path can call it without
// pulling the runner in) and runner.mjs imports it.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { isLiveQueueMarker } from "./queue-markers.mjs";   // the wall's live-state vocabulary, not a fourth copy

// The daily allowance a brand owner gets when its profile names no runCaps. Declared here rather
// than imported from runner.mjs: a request path must not pull the runner (and its queue/dispatch
// machinery) in. A test pins the two constants to the same value so they cannot drift apart.
//
// THIS ONE IS THE ADVERTISER AND runner.mjs IS THE ENFORCER, so they move together or the screen promises
// what the gate refuses. raised both from the beta's 2 to 20.
export const DEFAULT_CLIENT_DAILY_RUNS = 20;

/**
 * Where a queue's matter ledger lives — THE one calculation, called by the wall and by every display.
 *
 * BESIDE the queue dir, never inside it: out there it can never match the `*.json` claim glob or
 * checkRunCaps's own parse set. The queue dir is the only input because the queue dir is the only thing
 * a deployment configures — an agent workspace queue and a standalone `CLEAROTRON_QUEUE_DIR` both answer it
 * correctly, which is precisely what the old workspace-relative reconstruction could not do.
 */
export function matterLedgerPath(qdir) { return join(dirname(qdir), ".matter-ledger.jsonl"); }

/**
 * What an account has spent against its allowance today, and this month.
 *
 * READS THE SAME LEDGER THE WALL READS — deliberately, and it is the only reason this function is
 * worth having. The runner enforces `runCaps` by counting `.matter-ledger.jsonl` rows; if this counted
 * anything else (the runs listing, the pool, a separate tally) the number on screen could disagree with
 * the number that refuses a run, and a user told "1 of 3 used" who is then refused has been lied to by
 * their own product. One source, counted the same way, with the same day boundary.
 *
 * `queueDirs` is the SAME list the caller hands checkRunCaps (config.queueDirs). Passed in rather than
 * derived here because deriving it needs the environment, and this file reads none — a leaf that guessed
 * at the layout is exactly the defect records.
 *
 * `clientPrincipal` is the same positive-only filter checkRunCaps applies: staff runs for this account
 * are real runs and appear in `thisMonth`, but they never consume the client's daily allowance and so
 * are not in `today`. That asymmetry is the owner's decision made visible rather than hidden.
 *
 * ── `complete` — WHY A BEST-EFFORT COUNT NOW DECLARES ITSELF ────────────────────────────────────────
 *
 * The counts stay best-effort: an unreadable ledger yields a lower number, never an exception. That is
 * defensible for a DISPLAY and wrong for a GATE, because a gate cannot tell "no runs today" from "I
 * could not read the ledger" when both arrive as 0 — which is how the portal's 429 became unreachable
 * without anything failing. So the answer now says whether it read anything:
 *
 *   complete: true   AT LEAST ONE LEDGER WAS ACTUALLY READ, and no other candidate failed to read for
 *                    any reason but not being there. The numbers are a count.
 *   complete: false  no ledger was read, or one was there and could not be read. The numbers are a
 *                    floor, not a fact.
 *
 * IT IS THE READ, NOT THE DIRECTORY. An earlier attempt at this set `complete` from `existsSync(qdir)`,
 * and that flag is CONSTANT TRUE in production: driver.config's `queueDirs` appends the canonical queue
 * unconditionally, with no existence test, and drainQueue mkdir -p's whatever it is handed — so after one
 * runner activation every process sharing the workspace root has a queue dir on disk whether or not it
 * is the queue anyone drains. A service pointed at the wrong queue would have answered "0 runs today,
 * and I am sure", which is with a green light on it.
 *
 * `basis` says WHICH kind of nothing, because the ruling asks the gate to tell a real zero from a blind
 * one and a boolean cannot carry both. It is a diagnosis for the audit trail and the operator, never a
 * number and never a path.
 *
 *   "counted"     a ledger was read. complete.
 *   "no-ledger"   every named queue dir was asked and none had a ledger beside it.
 *   "unreadable"  a ledger was there and the read failed — a permission wall, a directory in its place.
 *   "no-queues"   the caller named no queue dirs at all: unwired, not empty.
 *
 * WHY "no-ledger" IS NOT A CONFIDENT ZERO, though a fresh deployment legitimately has none. From in
 * here the two are not merely similar, they are the same observation: "there is no ledger where I was
 * told to look" is what a brand-new box says AND what a box pointed at the wrong queue says, and the
 * second one is the defect. Only one of those readings can be the default, and calling it a count is
 * what made invisible for as long as it lived. So it reports blind, and the cost is bounded and
 * short: the runner writes the ledger row at CLAIM (runner.mjs::recordMatter runs before the pipeline,
 * not after), so a correctly-wired deployment stops being blind at the first run it admits — and until
 * then nobody can be at a limit anyway. A misconfigured one stays blind and says so on every request,
 * which is the outcome this whole change is for.
 *
 * No paths in the return value: it is spread into client-facing JSON by both the portal and the MCP
 * preview, and server paths are not a client's business.
 */
export function accountUsage({ queueDirs, account, now = Date.now() }) {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const monthKey = new Date(now).toISOString().slice(0, 7);
  let today = 0, thisMonth = 0, queued = 0;
  // `read` is set ONLY where a ledger came back. Nothing about a directory sets it — see the header.
  let read = false, unreadable = false;
  const dirs = (Array.isArray(queueDirs) ? queueDirs : []).filter((d) => typeof d === "string" && d);
  for (const qdir of dirs) {
    try {
      const rows = readFileSync(matterLedgerPath(qdir), "utf8").split("\n").filter(Boolean);
      // The read SUCCEEDED, so this is a count — an empty ledger included. A file that is there and
      // holds no rows is the one shape that says "no runs" with evidence behind it.
      read = true;
      for (const line of rows) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.profileKey !== account || typeof e.ts !== "number") continue;
        const stamp = new Date(e.ts).toISOString();
        if (stamp.slice(0, 7) === monthKey) thisMonth++;
        // `today` must count exactly what the WALL counts, or the screen lies. checkRunCaps skips failed
        // rows for the daily allowance (a client is not charged their day for our failure) while the
        // monthly figure still includes them (a failed run spent). Same asymmetry, same source.
        if (stamp.slice(0, 10) === dayKey && e.clientPrincipal === true && e.failed !== true) today++;
      }
    } catch (e) {
      // ENOENT is "no ledger beside this queue" — indistinguishable from "wrong queue", so it leaves
      // `read` false rather than claiming a zero. Anything else is a ledger that IS there and would not
      // open, which is worth naming separately: a permission wall is fixed by a different person than a
      // misconfigured queue path.
      if (e?.code !== "ENOENT") unreadable = true;
    }
    // queued/in-flight, counted the way checkRunCaps counts maxQueued — including `.processing.claimed-*`,
    // which the old inline regex here missed (isLiveQueueMarker is the one definition;).
    try {
      for (const f of readdirSync(qdir).filter(isLiveQueueMarker)) {
        try { if ((JSON.parse(readFileSync(join(qdir, f), "utf8")).profileKey ?? null) === account) queued++; }
        catch { /* mid-rename — skip */ }
      }
    } catch { /* no queue dir */ }
  }
  // `unreadable` outranks a successful read: two queues where one ledger opened and one refused is a
  // floor, not a total, and the number it produces is exactly the kind that reads as a fact.
  const basis = unreadable ? "unreadable" : read ? "counted" : dirs.length ? "no-ledger" : "no-queues";
  return { today, thisMonth, queued, complete: basis === "counted", basis };
}
