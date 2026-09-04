#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// cancel.mjs — stop ONE run, from the box, without stopping the product.
//
//. Before this verb the only ways to stop a run were to stop the worker —
// which stops every other lane's work, and which the run survives, because it comes back the moment
// the worker does — or to move the run directory out of the studio tree, which is undocumented and
// which leaves the round unreportable. Neither is a cancel; both are ways of coping with not having one.
//
// WHY THIS WRITES `.cancel` AND NOTHING ELSE. That marker is the surface every resume path already
// honours: the queue lane refuses it in claimDuePostponed, the run-dir watcher skips it, the gateway
// ends the run on it at the next turn boundary, and both pipelines catch RunCancelled. The operator's
// problem was never that the engine ignores a stop — it is that `.cancel` had exactly ONE caller, the
// MCP's stop_run, so a person at a shell had no way to write the one thing the engine reads. They
// reached instead for the surfaces they COULD write, a terminal status.json and a retired queue
// marker, and on 2026-09-03 the measured R6 run resumed itself twice straight past both of them.
//
// (Those two surfaces are honoured now as well — see scanDueRunDirOrphans and the pipeline's resume
// door. This verb exists so that an operator does not have to know that, and reaches the marker with
// the strongest guarantees rather than the one that happens to be writable.)
//
// STOPPING IS COOPERATIVE AND THIS SAYS SO. The run is a detached process tree behind a queue; the
// marker is noticed at the next turn boundary, never instantly, and work already dispatched finishes.
// Copy that implied otherwise would be lying, and an operator who believes a stop was instant is an
// operator who reads the next stage's output as a defect.

// FIRST IMPORT — the rename layer must apply before any module-top env capture evaluates.
import "../shared/env-local.mjs";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { requestCancel, isCancelled, readCancel } from "../driver/cancel.mjs";
import { agentStudioRoots, runDirDelivered } from "../driver/runner.mjs";
import { invoke } from "../shared/invocation.mjs";

const codename = process.argv.slice(2).find((a) => !a.startsWith("-"));

if (!codename) {
  console.error(`\n  ${invoke("cancel")} <codename> — stop one run, and leave everything else running.\n`);
  console.error("  The codename is the second half of a run's name, as `clearotron status` prints it");
  console.error("  (it is the part after the date — the run's own name).\n");
  process.exit(1);
}

// EVERY studio root, because a box runs more than one agent and an operator naming a codename does not
// owe us which agent it belonged to. A codename is unique across a studio tree by construction.
const found = [];
for (const studio of agentStudioRoots()) {
  let slugs = [];
  try { slugs = readdirSync(studio); } catch { continue; }
  for (const slug of slugs) {
    if (slug === "queue" || slug === "archive") continue;
    let runs = [];
    try { runs = readdirSync(join(studio, slug)); } catch { continue; }
    for (const runName of runs) {
      if (!/^\d{4}-\d\d-\d\d-/.test(runName) || !runName.endsWith(`-${codename}`)) continue;
      found.push(join(studio, slug, runName));
    }
  }
}

// AN ABSENCE IS A FINDING, and here it has two very different causes worth separating: a name that
// never existed, and a run that has already finished and been archived. Telling an operator "no such
// run" about a run that delivered an hour ago sends them looking for a typo.
if (found.length === 0) {
  console.error(`\n  No live run called "${codename}".\n`);
  console.error("  A run that has already delivered is archived and cannot be cancelled — there is");
  console.error(`  nothing left to stop. \`${invoke("status")}\` lists what is running now.\n`);
  process.exit(1);
}

let stopped = 0;
for (const runDir of found) {
  if (runDirDelivered(runDir)) {
    console.log(`  ${codename} has already delivered — nothing to stop.`);
    continue;
  }
  if (isCancelled(runDir)) {
    const prior = readCancel(runDir);
    console.log(`  ${codename} was already asked to stop${prior?.ts ? ` at ${prior.ts}` : ""} — the decision stands.`);
    stopped += 1;
    continue;
  }
  // `by` NAMES THE PERSON AT THIS SHELL, because this marker travels into the archived matter record
  // and "unattributed" there means a caller forgot to pass anything — which would be false of a verb
  // whose whole job is that a human typed it.
  const rec = requestCancel(runDir, { via: "cli/cancel", by: `ops:${userInfo().username}` });
  console.log(`  ${codename} will stop. Asked at ${rec.ts}, by ${rec.by}.`);
  stopped += 1;
}

if (stopped) {
  console.log("\n  It stops at the next step boundary, not this second — work already sent to a model");
  console.log("  finishes first. Nothing resumes it afterwards: no worker restart, no rate-limit window,");
  console.log("  no crash recovery. The run keeps everything it produced up to the stop.\n");
}
process.exit(0);
