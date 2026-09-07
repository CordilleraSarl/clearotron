#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// purge-runs.mjs — the delete path this system deliberately never had.
//
// The operations runbook (docs/architecture/06-operations-runbook.md) states the pool and archive
// grow monotonically and that visibility tags are "never deletion". That is still the default: the
// three retire flags (archive-tags.json, status.json `retired`, run-activity `retired`) all hide a
// run while leaving every byte on disk. This script is the exception: it is for when the requirement
// is "backend files gone, not merely hidden".
//
// A run lives in up to THREE independent places. Clearing only the pool leaves it fully
// republishable from the workspace archive, which does not satisfy "gone":
//
//   1. pool     <poolRoot>/<runId>/                                    — published, Caddy-served
//   2. archive  <ws>/studio/prelim-search/archive/<YYYY-MM>/<matter>/<codename>/  — republish source
//   3. live     <ws>/studio/prelim-search/<matter>/<codename>/         — running/failed, never published
//
// Dry-run is the default and --apply is required to remove anything. The guards below exist because
// the failure that matters is not "deleted too little" — it is deleting the one run someone wanted
// kept, in a system with no undo.

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readdirSync, statSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
// The ONE exception to this script's no-driver-imports posture, and it is the reason that posture exists:
// this file deletes, so its liveness rule must be the SAME rule the runner claims with, not a copy that
// can drift. driver/claim-liveness.mjs is pure and carries the argument in its header.
import { claimLivenessForCodename, claimForbidsDestruction } from "../driver/claim-liveness.mjs";
// — the ERROR TEXT names the spelling an operator should actually set. The read below stays on
// the retired name because the loader has already translated into it; only the instruction is current.

// ── — A DELETION TOOL HAS NO DEFAULTS ────────────────────────────────────────────────────────
//
// These two read `|| "/srv/trademark-archive"` and a hardcoded operator workspace root. Both were
// PRODUCTION — the client archive and the production workspace — reached by an operator simply
// forgetting to export a variable, in the one script in this repo that removes bytes.
//
// later gave the driver itself the same answer for the pool: `config.poolRoot` refuses when
// CLEAROTRON_REPORTS_DIR is unset, citing this script's reasoning. That does not make the guard below
// redundant. This script must state its own refusal because it DELETES, its message has to say so, and
// a deletion tool that inherits its safety from a library it does not import has no safety at all.
//
// The `--apply` flag is not the guard people think it is. Dry-run is the default, so the intended
// workflow is: run it, read the table, add `--apply`. Nothing on that screen ever named the archive,
// so a dry run read on one root and an apply executed on another look identical to the operator. The
// failure is silent in the direction that matters: a wrong path that does not exist errors loudly and
// harmlessly, and a wrong path that IS full of real client runs does exactly what it was asked.
//
// So: no default, refuse by name, the same shape Part 1 gives the register provider. And the
// resolved roots are PRINTED on every invocation, dry-run included, because a guard the operator
// cannot see is a guard they cannot confirm.
//
// WORKSPACE_ROOT is fixed here too, though the issue names only the pool. Two of the three stores this
// script deletes from (the archive and the live run dirs) are derived from it, so leaving it defaulted
// would fail closed on one third of the blast radius and open on the rest.
const requireRoot = (name, what) => {
  const v = String(process.env[name] ?? "").trim();
  if (v) return v;
  // TELL THEM THE NAME THEY SHOULD SET, NOT THE ONE THE CODE READS. Those differ since the rename, and
  // this message named the retired one — so the operator most likely to hit it, on a box configured with
  // current spellings, was instructed to add a deprecated variable to fix a script that had just refused
  // to run. `currentName` returns its argument unchanged when a name has no alias, so this is safe for
  // any future root that is never renamed.
  const set = name;
  console.error(`\n${set} is not set, and this script DELETES.`);
  console.error(`  It has no default: the old fallback was the PRODUCTION ${what}, which is real client matter.`);
  console.error(`  Set it explicitly to the estate you mean to purge, e.g.`);
  console.error(`    ${set}=$HOME/trademark-test/${name === "CLEAROTRON_REPORTS_DIR" ? "pool" : "workspace"} node scripts/purge-runs.mjs …`);
  process.exit(2);
};
const POOL_ROOT = requireRoot("CLEAROTRON_REPORTS_DIR", "client archive");
const WORKSPACE_ROOT = requireRoot("CLEAROTRON_WORK_DIR", "workspace");
// Agents are DISCOVERED from the workspace root, not compiled in — the same doctrine the survivor list
// below states ("never compiled in"), applied one line up. A hardcoded roster silently makes every run
// of an unlisted agent invisible to this tool: not spared, not reported, just absent. Found on the test
// instance, whose agent is `test`, where `--only=<runId>` answered "matched no run (typo?)" for a run
// that was sitting on disk — the most misleading answer a delete tool can give, because it reads as
// "nothing to do" and the operator moves on.
//
// CLEAROTRON_AGENTS still overrides, for a deployment that wants to bound the sweep explicitly.
const AGENTS = (process.env.CLEAROTRON_AGENTS?.split(",").map((s) => s.trim()).filter(Boolean))
  ?? (() => {
    try {
      return readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith("workspace-"))
        .map((e) => e.name.slice("workspace-".length));
    } catch { return []; }
  })();

// Survivors are SUPPLIED BY THE CALLER, never compiled in.
//
// This file used to hardcode four runIds and a customer key from one 2026-07 clear-out. That was wrong
// twice over. Each entry was "the latest X" *on the day it was written*, so the list went stale the
// moment a newer run landed — a later re-run would spare the superseded run and delete the current one,
// in a tool whose own header says the failure that matters is "deleting the one run someone wanted
// kept, in a system with no undo". And it froze an operational decision — which runs to spare — into
// source, where nobody re-reads it. Same doctrine --expect already states below: the reviewer supplies
// it.
//
//   --keep=<runId>[,<runId>…]       spare these exact runs
//   --keep-file=<path>              spare the runIds listed one per line (blank lines and # comments ok)
//   --keep-customer=<key>[,<key>…]  spare EVERY run of these customers — a RULE, so a customer's
//                                   second run is protected without editing anything
//
// A rule beats an id list wherever one is expressible: --keep-customer stays correct as runs accrue,
// --keep does not.
const parseList = (argv, flag) =>
  argv.filter((a) => a.startsWith(`${flag}=`))
    .flatMap((a) => a.slice(flag.length + 1).split(","))
    .map((s) => s.trim()).filter(Boolean);

const readKeepFile = (p) =>
  readFileSync(p, "utf8").split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);

// Pool-root-level shared surfaces that are NOT runs. This list is a convenience, not the guard —
// new shared dirs appear over time (`_state` was created by the flag-snapshot writer mid-way through
// this very change, and a name blacklist alone would have queued it for deletion). The real test is
// looksLikeRun() below: a directory must carry run ARTIFACTS to be treated as a run.
const POOL_NON_RUN = new Set(["assets", "customer", "_state"]);

// A pool directory is a run if it has meta.json (regenIndex's own definition) or, for orphans whose
// meta.json never landed, if it still carries the artifacts a run produces. Anything else — a state
// dir, a future shared surface — is left alone. Deleting too little is recoverable; deleting the
// system's own state is not.
const RUN_ARTIFACTS = ["meta.json", "report.html", "report.md", "findings.json", "status.json"];
const looksLikeRun = (dir) => RUN_ARTIFACTS.some((f) => existsSync(join(dir, f)));
// Not matter directories inside a workspace prelim-search root.
const WS_NON_MATTER = new Set(["STATUS.md", "archive", "queue", "_known-conflicts"]);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };

// customerKey resolution mirrors every read boundary in the driver: absent/blank ⇒ "generic".
// Pool runs carry it on meta.json; workspace runs carry it as profileKey on the frozen
// _driver/profile.json. A run with neither (pre-profiles legacy) is house-default by definition.
const customerKeyOf = (runDir, { pool }) => {
  if (pool) return readJson(join(runDir, "meta.json"))?.customerKey || "generic";
  const prof = readJson(driverDir(runDir, "profile.json"));
  return prof?.profileKey || prof?.customerKey || "generic";
};

function collect() {
  const items = [];

  // 1. Pool. A run is "a directory containing meta.json" (regenIndex's own definition), but we also
  // sweep meta-less run-shaped dirs — they are orphans that render nowhere and belong to no customer,
  // so they fall to generic and are purged with the rest of the house bucket.
  for (const name of ls(POOL_ROOT)) {
    if (POOL_NON_RUN.has(name)) continue;
    const dir = join(POOL_ROOT, name);
    if (!isDir(dir)) continue;
    if (!looksLikeRun(dir)) continue;   // shared surface or unknown dir — never a delete candidate
    const meta = readJson(join(dir, "meta.json"));
    items.push({
      store: "pool",
      dir,
      runId: meta?.runId || name,
      customerKey: meta?.customerKey || "generic",
      orphan: !meta,
    });
  }

  for (const agent of AGENTS) {
    const base = join(WORKSPACE_ROOT, `workspace-${agent}`, "studio", "prelim-search");
    if (!isDir(base)) continue;

    // 2. Workspace archive — <YYYY-MM>/<matter>/<codename>. runId is matter+codename, matching the
    // pool's runId so a keeper is recognised in BOTH stores and survives in both.
    const archiveBase = join(base, "archive");
    for (const month of ls(archiveBase)) {
      const monthDir = join(archiveBase, month);
      if (!isDir(monthDir)) continue;
      for (const matter of ls(monthDir)) {
        const matterDir = join(monthDir, matter);
        if (!isDir(matterDir)) continue;
        for (const codename of ls(matterDir)) {
          const dir = join(matterDir, codename);
          if (!isDir(dir)) continue;
          items.push({
            store: "archive",
            dir,
            agent,
            runId: `${matter}-${codename}`,
            customerKey: customerKeyOf(dir, { pool: false }),
            matterDir,
          });
        }
      }
    }

    // 3. Live workspace — matters that never reached the pool (running/failed). These are the rows a
    // portal user still sees under a failed state.
    for (const matter of ls(base)) {
      if (WS_NON_MATTER.has(matter)) continue;
      const matterDir = join(base, matter);
      if (!isDir(matterDir)) continue;
      for (const codename of ls(matterDir)) {
        const dir = join(matterDir, codename);
        if (!isDir(dir)) continue;
        const status = readJson(join(dir, "status.json"));
        if (!status) continue;
        items.push({
          store: "live",
          dir,
          agent,
          runId: status.runId || `${matter}-${codename}`,
          customerKey: customerKeyOf(dir, { pool: false }),
          state: status.state,
          matterDir,
        });
      }
    }
  }
  return items;
}

// Two selection modes.
//
// SWEEP (no --only) — the original one-off shape: everything is a DELETE unless a keep rule saves it.
// Correct for "clear the estate down to these survivors", and dangerous for anything narrower, because
// the blast radius is "all runs" and a forgotten keeper is silently a delete.
//
// TARGET (--only=<pat>[,<pat>…]) — the inverse, added 2026-07-22 for the ION clear-out: NOTHING is a
// delete unless its runId matches a caller-supplied pattern. The keep rules still veto on top, so a
// pattern can never overrule a protected run. Use this for "remove these runs" — the common ask — so
// nobody has to name the whole surviving estate via --keep (which is the sweep's blast radius stated
// backwards) or reach for rm, which skips every guard in this file.
//
// A RUNNING run is never a delete candidate in either mode. The tool already noted that "a running run
// can deliver into the pool" but only defended against it with the --expect count; a live run's
// directory is being written to right now, and removing it mid-flight loses work no retry can recover.
const isRunning = (it) => String(it.state ?? "").toLowerCase() === "running";

// ── AND THE STATE FIELD IS NOT THE ONLY QUESTION, BECAUSE ANY WRITER CAN FLIP IT ────────────────────
//
// `isRunning` was this tool's ONLY defence for a live run, and it reads a string out of a JSON file.
// scripts/e2e.mjs teardown wrote `failed` over exactly that field for every run it tore down, announcing
// "no process was producing this run" while checking nothing — so a live round, torn down, arrived here
// looking terminal and became a delete candidate. This file's own header, three lines up, says removing a
// run mid-flight "loses work no retry can recover."
//
// So ask the process, not the record. `claimLivenessForCodename` reads the queue claim and its `.pid`
// sidecar; its polarity is fail-safe — DEAD only on positive evidence, ALIVE when it cannot tell.
//
// ADDITIVE, DELIBERATELY: this can only turn a DELETE into a KEEP, never the reverse. `unclaimed` — no
// queue claim owns this codename and every queue directory was read cleanly — leaves the existing rules
// in charge, because a pipeline started by hand holds no claim, and reading that silence as death would
// be the same mistake being fixed here, inverted.
export const claimHold = (it, liveness = claimLivenessForCodename) => {
  const { state, why } = liveness(basename(it.dir));
  return claimForbidsDestruction(state) ? { state, why } : null;
};

const verdict = (it, only, keepRunIds, keepCustomerKeys, liveness = claimLivenessForCodename) => {
  if (isRunning(it)) return "KEEP";
  // A live-or-unprovable claim outranks every delete rule below, including an --only pattern naming it.
  if (claimHold(it, liveness)) return "KEEP";
  if (keepCustomerKeys.has(it.customerKey)) return "KEEP";
  if (keepRunIds.has(it.runId)) return "KEEP";
  if (only.length) return only.some((p) => it.runId.toLowerCase().includes(p)) ? "DELETE" : "KEEP";
  return "DELETE";
};

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const expectRaw = argv.find((a) => a.startsWith("--expect="));
  const expect = expectRaw ? Number(expectRaw.split("=")[1]) : null;
  const only = parseList(argv, "--only").map((s) => s.toLowerCase());

  const keepFiles = parseList(argv, "--keep-file");
  const keepRunIds = new Set([...parseList(argv, "--keep"), ...keepFiles.flatMap(readKeepFile)]);
  const keepCustomerKeys = new Set(parseList(argv, "--keep-customer"));

  // SWEEP mode deletes everything no keep rule saves. While the survivors were compiled in, forgetting
  // them was impossible; now that the caller supplies them, an invocation that simply omits them is no
  // longer a narrow slip — it is "delete the estate". Refuse, and make sparing nothing something the
  // caller has to say out loud.
  if (!only.length && !keepRunIds.size && !keepCustomerKeys.size && !argv.includes("--keep-none")) {
    console.error("\nSWEEP mode with no keepers would delete EVERY run in every store.");
    console.error("  Narrow it:      --only=<pat>[,<pat>…]");
    console.error("  Or name keepers: --keep=<runId> / --keep-file=<path> / --keep-customer=<key>");
    console.error("  Or, if clearing the whole estate really is the intent: --keep-none");
    process.exit(2);
  }

  const items = collect().map((it) => ({ ...it, verdict: verdict(it, only, keepRunIds, keepCustomerKeys) }));
  const del = items.filter((i) => i.verdict === "DELETE");
  const keep = items.filter((i) => i.verdict === "KEEP");

  // --paths prints ONLY the delete-set directories, one per line, so the backup archive is built
  // from the same computation that does the deleting. Piping the human table through awk to
  // reconstruct paths is how a backup ends up not matching what was removed.
  if (argv.includes("--paths")) {
    for (const it of del) console.log(it.dir);
    return;
  }

  for (const it of items.sort((a, b) => (a.store + a.runId).localeCompare(b.store + b.runId))) {
    // THE CLAIM STATE IS PRINTED, AND `alive` IS NOT COLLAPSED INTO `unknown`. Both keep the run, so the
    // behaviour is one branch — but a reader who cannot tell "a live process holds this" from "we could
    // not look" cannot tell a working guard from a blind one, and this table is what an operator reads
    // before typing --apply.
    const hold = claimHold(it);
    const flags = [
      it.orphan ? "orphan" : null,
      it.state ? `state=${it.state}` : null,
      hold ? `claim=${hold.state}` : null,
    ].filter(Boolean);
    console.log(
      `${it.verdict.padEnd(6)} ${it.store.padEnd(8)} ${(it.customerKey || "-").padEnd(10)} ${it.runId}` +
        (flags.length ? `  (${flags.join(", ")})` : ""),
    );
  }

  // — THE TARGET, ON SCREEN, EVERY TIME. The hazard this closes is not a wrong flag; it is a dry
  // run and an apply that resolved different roots while the operator read an identical table.
  console.log(`\n-- pool:      ${POOL_ROOT}`);
  console.log(`-- workspace: ${WORKSPACE_ROOT}`);
  console.log(`-- mode: ${only.length ? `TARGET (--only=${only.join(",")})` : "SWEEP (delete-all-but-keepers)"} --`);
  console.log(`-- ${del.length} DELETE / ${keep.length} KEEP --`);
  const byStore = {};
  for (const d of del) byStore[d.store] = (byStore[d.store] || 0) + 1;
  for (const [s, n] of Object.entries(byStore)) console.log(`   delete ${s}: ${n}`);
  console.log("   keep:", keep.map((k) => `${k.store}:${k.runId}`).join("\n         ") || "(none)");

  // ---- Guards. Each one encodes a way this could delete the wrong thing. ----

  // A keeper that does not resolve means a typo in --keep/--keep-file — and a typo'd keeper is
  // silently a DELETE. Both directions are asserted: present, AND absent from the delete set.
  const problems = [];
  for (const id of keepRunIds) {
    const hits = items.filter((i) => i.runId === id);
    if (!hits.length) problems.push(`keeper never resolved (typo?): ${id}`);
    for (const h of hits.filter((h) => h.verdict === "DELETE"))
      problems.push(`keeper is in the DELETE set: ${id} [${h.store}]`);
  }
  // A protected customer is a RULE, not a run. Assert the rule, so that customer's second run is
  // protected too — and so a --keep-customer key that matches no run is caught as a typo the same way.
  for (const d of del.filter((d) => keepCustomerKeys.has(d.customerKey)))
    problems.push(`protected customer in DELETE set: ${d.customerKey} ${d.runId}`);
  for (const k of keepCustomerKeys) {
    if (!items.some((i) => i.customerKey === k))
      problems.push(`--keep-customer matched no run (typo?): ${k}`);
  }

  // A --only pattern that matches nothing is a typo, and a typo in TARGET mode fails SILENTLY (an
  // empty delete set looks exactly like "already clean"). Same asymmetry the keeper guard above
  // defends: assert every pattern resolved to at least one run.
  for (const p of only) {
    if (!items.some((i) => i.runId.toLowerCase().includes(p)))
      problems.push(`--only pattern matched no run (typo?): ${p}`);
  }
  // Belt and braces on the live-run rule: nothing in flight may reach the delete set by any path.
  for (const d of del.filter(isRunning)) problems.push(`RUNNING run in DELETE set: ${d.runId} [${d.store}]`);

  if (problems.length) {
    console.error("\nREFUSING TO PROCEED:");
    for (const p of problems) console.error("  - " + p);
    process.exit(2);
  }

  if (!apply) {
    console.log(`\nDry run. Nothing removed. Re-run with --apply --expect=${del.length} --expect-root=${POOL_ROOT} to delete.`);
    return;
  }

  // The approved list must equal the executed list. State can drift between planning and execution
  // (a running run can deliver into the pool), so --apply refuses unless the caller states the count
  // they actually reviewed. No hardcoded number here — the reviewer supplies it.
  if (expect === null || Number.isNaN(expect)) {
    console.error("\n--apply requires --expect=<count> naming the DELETE count you reviewed.");
    process.exit(2);
  }
  if (expect !== del.length) {
    console.error(`\nCOUNT MISMATCH: you approved ${expect}, the manifest is ${del.length}. Re-review.`);
    process.exit(2);
  }

  // — THE ROOT IS RESTATED, not remembered. The issue asks that --apply refuse if the root differs
  // from the one the preceding dry run reported. A stored receipt would do that badly: it can be
  // satisfied by a dry run nobody read, it goes stale, and it is written into an estate this tool is
  // about to delete from. So the root joins --expect on the SAME doctrine this file already states two
  // paragraphs down — "No hardcoded number here — the reviewer supplies it". The operator copies the
  // root off the dry run they actually read, which is the confirmation the issue is asking for, and a
  // dry run on one estate can no longer authorise an apply on another.
  const rootRaw = argv.find((a) => a.startsWith("--expect-root="));
  const expectRoot = rootRaw ? rootRaw.slice("--expect-root=".length) : null;
  if (!expectRoot) {
    console.error(`\n--apply requires --expect-root=<path> naming the pool root you reviewed.`);
    console.error(`  This run resolved: ${POOL_ROOT}`);
    process.exit(2);
  }
  if (expectRoot.replace(/\/+$/, "") !== POOL_ROOT.replace(/\/+$/, "")) {
    console.error(`\nROOT MISMATCH: you approved ${expectRoot}, this run resolved ${POOL_ROOT}.`);
    console.error(`  A dry run on one estate cannot authorise an apply on another. Nothing removed.`);
    process.exit(2);
  }

  for (const it of del) rmSync(it.dir, { recursive: true, force: true });
  console.log(`\nRemoved ${del.length} run directories.`);

  // A matter dir left with no runs is dead weight that still renders as a matter. Clean up only
  // those we emptied, and only if they are genuinely empty.
  const matterDirs = [...new Set(del.map((d) => d.matterDir).filter(Boolean))];
  let pruned = 0;
  for (const m of matterDirs) {
    if (existsSync(m) && ls(m).length === 0) { rmSync(m, { recursive: true, force: true }); pruned++; }
  }
  if (pruned) console.log(`Pruned ${pruned} emptied matter directories.`);

  console.log("\nNext: pool-admin regen, then prune archive-tags.json and review .matter-ledger.jsonl.");
}

main();
