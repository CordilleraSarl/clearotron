#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// merge-presence-check.mjs — a merge is a claim about a branch. This re-states it against the tree.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
//
// merged at 18:45:01Z. The commit carrying 's own acceptance check was authored at
// 18:53:12Z — eight minutes AFTER the merge — and never reached `main`. The pull request closed
// green showing one commit, the branch was deleted, and was labelled ready-for-verification
// against a fix whose check did not exist. Nothing in the repository noticed. It surfaced because
// the authoring agent said so.
//
// An hour later the same shape nearly repeated: a force-push landed between the diff being
// reviewed and the merge being run, and what it carried replaced an assertion that passed whatever
// the code did. That merge was refused — by branch protection, because the push had restarted CI.
// Not by anything that knew about this.
//
// The common property is not timing. It is that **a merge is a claim about a branch that nobody
// re-states afterwards.** The issue label, the close comment and the round tracker are all written
// FROM the merge, never from what `main` ended up holding, so the gap leaves no trace anywhere.
//
// ── TWO QUESTIONS, DELIBERATELY NOT MERGED INTO ONE VERDICT ──────────────────────────────────────
//
// They have different evidence and different lifetimes, and collapsing them is how a real answer to
// one gets read as an answer to both.
//
//   PRESENCE  — did the merged content reach `main`, and is it STILL THERE?
//               Evidence: content in the tree as it stands. Survives branch deletion, so it is
//               answerable for every merge in history.
//               Ancestry is NOT used as the proof. `git merge-base --is-ancestor` says a commit is
//               in the history; it cannot see a later commit that reverted or overwrote the lines.
//               The house rule is grep `main` for the CODE, and that is what runs here.
//
//   COMPLETENESS — did the branch carry work the merge did not take?
//               Evidence: commits on the remote branch that are not on `main`. Only answerable
//               WHILE THE BRANCH EXISTS. Once it is deleted the question is unanswerable forever —
//               the pull request's `commits` list is frozen at merge ( still reports one commit
//               while 43c0b3e exists on its branch), and the timeline records `head_ref_deleted`
//               with NO `head_ref_restored` for the push that recreated it. Both were probed. Both
//               came back empty.
//
// ── AN UNANSWERABLE QUESTION IS A FAILURE, NOT A SKIP ────────────────────────────────────────────
//
// This script exists because an absence took the success path. It must not repeat it, so
// COMPLETENESS: UNVERIFIABLE is a non-zero exit by default. The historical block — every merge whose
// branch was already deleted before this check existed — is covered by an EXPLICIT, DATED waiver
// passed on the command line, so the waiver is visible in the invocation rather than buried here:
//
//     node scripts/merge-presence-check.mjs --since 2026-08-12 --waive-unverifiable-through 2026-08-13
//
// The waiver is self-invalidating in both directions. A date that covers no unverifiable row is a
// stale waiver and fails; a row outside the waived window fails on its own terms. A blanket skip
// would greenlight the exact hole this was written to report.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────
//
//   · It is NOT a CI gate and must not become one. It reads the remote's branch list and the
//     forge's pull-request index; a check that goes red when a third party has an outage is a check
//     people learn to override. It is an ops instrument, run on demand and on a round's close.
//   · It does NOT recover anything. The branches behind the historical block are gone and this
//     script does not pretend otherwise — it names what cannot be checked and counts it.
//   · It does NOT rule on whether the work was any good. Presence is not correctness.
//
// ── THE DETECTION RULE, AND ITS ONE HOLE ─────────────────────────────────────────────────────────
//
// `delete_branch_on_merge` is FALSE on this repository, so a branch is only ever deleted by the
// merge command's own `--delete-branch`. Therefore **a branch that exists again after its merge was
// pushed to after the merge** — which is why and are visible at all and the other 73 are
// not.
//
// The hole: a merge run WITHOUT `--delete-branch` leaves the branch sitting at exactly the merged
// head, and a naive reading calls that clean. It is not the same fact. So a surviving branch whose
// tip is unreachable from `main` is only reported clean when its extra commits are shown to be on
// `main` by patch-id — never on the strength of the branch merely existing.

// ── WHY THE CORE IS EXPORTED AND PARAMETERISED BY A `git` FUNCTION ───────────────────────────────
//
// This script cannot be a CI gate (it reads the forge), so nothing else would ever exercise it, and
// an unexercised check is a check that quietly stops working. Worse, the arm that matters most —
// MOVED-AFTER-MERGE — has NO live fixture left: was the real one and re-landed its commit
// an hour after it was found, so the repository now correctly reports RE-LANDED and the drop arm
// runs on nothing. A check whose most important branch is never executed is decoration.
//
// So `classify` takes its `git` as an argument and the accompanying test builds a throwaway
// repository that reproduces all three shapes by construction. That is a deliberate departure from
// the house rule that fixtures come from real artifacts: the real artifact was consumed by its own
// fix, and git mechanics — squash, patch-id, a push after a delete — are reproducible exactly,
// which is the one case where a synthetic fixture is not an invented one.

import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   //
import { originRepoOrRefuse } from "../shared/origin-repo.mjs";

/** git bound to a working tree, so the core is runnable against a throwaway repository in a test. */
// stderr is CAPTURED, not inherited. Half the calls here are expected to fail — asking for a path a
// merge deleted is how the deleted-file arm is answered — and git writes "fatal: path ... does not
// exist" to the parent's stderr on every one of them. Inherited, that noise interleaves with the
// --markdown table and corrupts the artifact this script exists to produce.
export const makeGit = (cwd) => (...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"] });

// ── shelling out ─────────────────────────────────────────────────────────────────────────────────
//
// argv is read inside main(), never at module scope. A script that parses arguments and calls
// process.exit on import cannot be imported by a test, and the reason this file is factored at all
// is so its drop arm gets exercised.
const gitOkWith = (git, ...args) => { try { git(...args); return true; } catch { return false; } };
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Where a moved branch is fetched to. Namespaced so it can never collide with a real ref. */
const REF_PREFIX = "refs/merge-presence";

// ── the pull requests in the window ──────────────────────────────────────────────────────────────
//
// `--search "merged:>=DATE"` rather than a bare `--limit N` with a client-side date filter. The
// bare form is bound by the LIMIT, not the date: on this repository `--limit 200` returns exactly
// 200 rows out of 536 merged, and a window filtered inside those 200 silently understates itself the
// moment the repository is busier than the limit. That mistake produced a denominator of 73 that
// happened to be right and could not be shown to be.
function mergedPullRequests(REPO, sinceISO) {
  const raw = gh("pr", "list", "--repo", REPO, "--state", "merged",
    "--search", `merged:>=${sinceISO.slice(0, 10)}`, "--limit", "1000",
    "--json", "number,title,headRefName,headRefOid,mergedAt,mergeCommit");
  return JSON.parse(raw)
    .filter((p) => p.mergedAt >= sinceISO)
    .sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1));
}

// ── remote branch heads ──────────────────────────────────────────────────────────────────────────
function remoteHeads(git) {
  const out = git("ls-remote", "--heads", "origin");
  const map = new Map();
  for (const line of out.split("\n")) {
    const m = line.match(/^([0-9a-f]{40})\s+refs\/heads\/(.+)$/);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

// ── PRESENCE: is the merged content still in the tree? ───────────────────────────────────────────
//
// The markers are lines the merge ADDED. A line long enough to be distinctive and not pure syntax —
// a bare brace, an import, a lone keyword — appears in a thousand places and proves nothing about
// this merge. Deletions are checked in the mirror image: a file the merge removed must still be
// absent, because a resurrection is the same class of silent loss running backwards.
const TRIVIAL = /^[\s{}()[\];,]*$|^\s*(import|export|const|let|var|\/\/|\*|#)\s*[{]?\s*$/;

// ── GENERATED, TRACKED, AND NOT EVIDENCE OF ANYTHING ─────────────────────────────────────────────
//
// portal-ui/dist is a BUILT bundle that is committed on purpose (the deploy pulls it rather than
// building it), and vite content-hashes the filenames — index-DPO0YzPB.js becomes index-P_3D0Lp1.js
// on the next build. So every merge that rebuilt the bundle has its old hashed filename absent from
// main, and a content check reads that as work that vanished.
//
// Measured, not assumed: this produced 24 MISSING rows across a July window, every single one of them
// a rotated bundle name and not one of them a real drop. A check whose false-positive rate is 100% on
// a whole directory teaches its reader to skim it, which is how the one true row gets missed.
//
// Named as a path prefix rather than a glob over "generated-looking" files, because the exclusion has
// to be legible: this is the one directory in the tree whose contents no human wrote.
const GENERATED = ["portal-ui/dist/"];
const isGenerated = (path) => GENERATED.some((g) => path.startsWith(g));

export function presenceOf(sha, git, base = "origin/main") {
  let files;
  try {
    files = git("show", "--name-status", "--format=", sha).trim().split("\n").filter(Boolean);
  } catch { return { verdict: "NO-COMMIT", detail: `cannot read ${sha}`, markers: [] }; }

  const checked = [];
  const missing = [];

  for (const row of files) {
    const [status, ...rest] = row.split("\t");
    const path = rest[rest.length - 1];
    if (!path || isGenerated(path)) continue;

    if (status.startsWith("D")) {
      // The merge deleted it. Absence is the property; presence would be the finding.
      const back = gitOkWith(git, "cat-file", "-e", `${base}:${path}`);
      checked.push({ path, kind: "deleted", ok: !back });
      if (back) missing.push(`${path} — deleted by this merge but present on main again`);
      continue;
    }

    // Added or modified: at least one distinctive added line must survive in main's copy.
    let diff;
    try { diff = git("show", "--format=", "--unified=0", sha, "--", path); } catch { continue; }
    const added = diff.split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1).trim())
      .filter((l) => l.length >= 24 && !TRIVIAL.test(l))
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);

    if (!added.length) { checked.push({ path, kind: "no-distinctive-line", ok: null }); continue; }

    let current = "";
    try { current = git("show", `${base}:${path}`); }
    catch { checked.push({ path, kind: "file-gone", ok: false }); missing.push(`${path} — file no longer on main`); continue; }

    const survivor = added.find((l) => current.includes(l));
    checked.push({ path, kind: "content", ok: Boolean(survivor), marker: survivor ?? added[0] });
    if (!survivor) missing.push(`${path} — none of its distinctive added lines are on main`);
  }

  const decided = checked.filter((c) => c.ok !== null);
  if (!decided.length) return { verdict: "NO-MARKER", detail: "nothing distinctive enough to check", markers: checked };
  if (!missing.length) return { verdict: "PRESENT", detail: `${decided.length} file(s) proved by content`, markers: checked };

  // ── LANDED-AND-SINCE-REMOVED IS NOT LOST WORK, AND CALLING IT LOST IS THE WHOLE FAILURE ────────
  //
  // The first cut of this script reported six MISSING rows and every one of them was a merge that
  // landed perfectly and was later retired ON PURPOSE: 's bin/register-ledger-prune.mjs deleted
  // by, 's snapshot machinery deleted by, three env-governance.test.mjs rows rewritten
  // by the same. Publishing those as lost work would have been six false accusations drawn
  // from a real signal — the exact shape this check exists to catch, running in the other direction.
  //
  // So the question is split. "Did it land" and "is it still there" are different, and only the
  // first is what a merge is answerable for. A marker that is gone is SUPERSEDED when a later
  // commit reachable from main touched that same path AFTER this merge — and the superseding
  // commit is NAMED, because "something else changed it" with no sha is an excuse, not a finding.
  // Only a marker that vanished with nothing having touched the file since is MISSING, and that is
  // the row worth waking somebody for.
  const stillUnexplained = [];
  const superseded = [];
  for (const m of missing) {
    const path = m.split(" — ")[0];
    let later = "";
    try {
      later = git("log", "--format=%h %s", `${sha}..${base}`, "--", path).trim().split("\n")[0] ?? "";
    } catch { /* leave it unexplained */ }
    if (later) superseded.push(`${path} → superseded by ${later.slice(0, 76)}`);
    else stillUnexplained.push(m);
  }

  if (stillUnexplained.length) {
    return { verdict: "MISSING", detail: stillUnexplained.join("; "), markers: checked };
  }
  return { verdict: "SUPERSEDED", detail: superseded.join("; "), markers: checked };
}

// ── COMPLETENESS: did the branch carry more than the merge took? ─────────────────────────────────
//
// patch-id, never subject lines. A commit re-landed through another pull request has a different
// sha and usually a different message; its PATCH is what stays the same. is the fixture: its
// post-merge commit dcdee41 was carried onto main by as bfd07f2, and only a patch-id
// comparison calls that re-landed rather than dropped.
export function basePatchIdSet(git, cwd, sinceISO, base = "origin/main") {
  const ids = new Set();
  const shas = git("log", "--since", sinceISO, "--format=%H", base).trim().split("\n").filter(Boolean);
  for (const sha of shas) {
    try {
      const out = execFileSync("bash", ["-c", `git show ${sha} | git patch-id --stable`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const id = out.trim().split(/\s+/)[0];
      if (id) ids.add(id);
    } catch { /* a commit whose patch cannot be computed is simply not matchable */ }
  }
  return ids;
}

export function patchIdOf(sha, cwd) {
  try {
    const out = execFileSync("bash", ["-c", `git show ${sha} | git patch-id --stable`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out.trim().split(/\s+/)[0] || null;
  } catch { return null; }
}

export function completenessOf(pr, heads, git, cwd, sinceISO, base = "origin/main") {
  const tip = heads.get(pr.headRefName);
  if (!tip) return { verdict: "UNVERIFIABLE", detail: "branch deleted — the question cannot be answered from any surviving source" };
  if (tip === pr.headRefOid) {
    return { verdict: "INTACT", detail: `branch still at the merged head ${tip.slice(0, 8)} — nothing was pushed after the merge` };
  }

  // The branch moved. Fetch it and ask what it holds that main does not.
  if (!gitOkWith(git, "fetch", "origin", `${pr.headRefName}:${REF_PREFIX}/${pr.headRefName}`, "--force")) {
    return { verdict: "UNVERIFIABLE", detail: `branch ${pr.headRefName} moved to ${tip.slice(0, 8)} but cannot be fetched` };
  }
  let extra = [];
  try {
    extra = git("log", "--format=%H %s", `${base}..${REF_PREFIX}/${pr.headRefName}`)
      .trim().split("\n").filter(Boolean);
  } catch { /* fall through */ }

  if (!extra.length) return { verdict: "INTACT", detail: `branch moved to ${tip.slice(0, 8)} but holds nothing main does not` };

  const known = basePatchIdSet(git, cwd, sinceISO, base);
  const dropped = [];
  const relanded = [];
  for (const line of extra) {
    const [sha, ...subj] = line.split(" ");
    const pid = patchIdOf(sha, cwd);
    if (pid && known.has(pid)) relanded.push(`${sha.slice(0, 8)} re-landed on main (patch-id match)`);
    else dropped.push(`${sha.slice(0, 8)} ${subj.join(" ").slice(0, 70)}`);
  }
  if (dropped.length) {
    return { verdict: "MOVED-AFTER-MERGE", detail: `${dropped.length} commit(s) on the branch and NOT on main: ${dropped.join("; ")}` };
  }
  return { verdict: "RE-LANDED", detail: relanded.join("; ") };
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
export function main(argv, cwd = process.cwd()) {
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const has = (name) => argv.includes(name);

  const SINCE = arg("--since");
  // DERIVED, NEVER NAMED — see shared/origin-repo.mjs. A hardcoded default asked about our tree from
  // inside a fork, and read as a real answer.
  const REPO = arg("--repo", null) ?? originRepoOrRefuse();
  const WAIVE_THROUGH = arg("--waive-unverifiable-through");
  const AS_MARKDOWN = has("--markdown");
  const QUIET = has("--quiet");

  if (!SINCE) {
    console.error("usage: merge-presence-check.mjs --since <ISO-date> [--repo O/R] "
      + "[--waive-unverifiable-through <ISO-date>] [--markdown] [--quiet]");
    return 2;
  }
  const sinceISO = SINCE.length === 10 ? `${SINCE}T00:00:00Z` : SINCE;
  const git = makeGit(cwd);
    const heads = remoteHeads(git);
    const prs = mergedPullRequests(REPO, sinceISO);
    const rows = [];

  for (const pr of prs) {
    const sha = pr.mergeCommit?.oid;
      const presence = sha ? presenceOf(sha, git) : { verdict: "NO-COMMIT", detail: "no merge commit recorded", markers: [] };
      const completeness = completenessOf(pr, heads, git, cwd, sinceISO);
    rows.push({ pr, sha, presence, completeness });
  }

  const tally = (sel) => rows.reduce((m, r) => { const k = sel(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});

  if (AS_MARKDOWN) {
    console.log(`| PR | merge | presence | completeness |`);
    console.log(`|---|---|---|---|`);
    for (const r of rows) {
      console.log(`| #${r.pr.number} | \`${(r.sha ?? "").slice(0, 8)}\` | ${r.presence.verdict} | ${r.completeness.verdict} |`);
    }
  } else if (!QUIET) {
    for (const r of rows) {
      console.log(`#${r.pr.number}\t${(r.sha ?? "").slice(0, 8)}\tpresence=${r.presence.verdict}\tcompleteness=${r.completeness.verdict}\t${r.pr.title.slice(0, 58)}`);
      if (r.presence.verdict !== "PRESENT") console.log(`         presence: ${r.presence.detail}`);
      if (["MOVED-AFTER-MERGE", "RE-LANDED"].includes(r.completeness.verdict)) console.log(`         completeness: ${r.completeness.detail}`);
    }
  }

  console.log("");
  console.log(`window          ${sinceISO} → now`);
  console.log(`pull requests   ${rows.length}`);
  console.log(`presence        ${JSON.stringify(tally((r) => r.presence.verdict))}`);
  console.log(`completeness    ${JSON.stringify(tally((r) => r.completeness.verdict))}`);

  // ── the exit code ────────────────────────────────────────────────────────────────────────────────
  const failures = [];

  const missing = rows.filter((r) => ["MISSING", "NO-COMMIT", "NO-MARKER"].includes(r.presence.verdict));
  for (const r of missing) failures.push(`#${r.pr.number} presence ${r.presence.verdict}: ${r.presence.detail}`);

  const moved = rows.filter((r) => r.completeness.verdict === "MOVED-AFTER-MERGE");
  for (const r of moved) failures.push(`#${r.pr.number} ${r.completeness.detail}`);

  const unverifiable = rows.filter((r) => r.completeness.verdict === "UNVERIFIABLE");
  const waiveThrough = WAIVE_THROUGH ? (WAIVE_THROUGH.length === 10 ? `${WAIVE_THROUGH}T23:59:59Z` : WAIVE_THROUGH) : null;
  const waived = waiveThrough ? unverifiable.filter((r) => r.pr.mergedAt <= waiveThrough) : [];
  const unwaived = unverifiable.filter((r) => !waived.includes(r));

  for (const r of unwaived) {
    failures.push(`#${r.pr.number} completeness UNVERIFIABLE (merged ${r.pr.mergedAt}) — `
      + `its branch is gone, so nobody can now show whether it carried more than the merge took`);
  }
  // A waiver that covers nothing is stale, and a stale waiver is how the next hole gets greenlit.
  if (waiveThrough && !waived.length) {
    failures.push(`--waive-unverifiable-through ${WAIVE_THROUGH} covers no row in this window — `
      + `remove it rather than leaving a waiver nobody re-reads`);
  }
  if (waived.length) {
    console.log(`waived          ${waived.length} UNVERIFIABLE row(s) merged on or before ${WAIVE_THROUGH} `
      + `— branches already deleted before this check existed`);
  }

  if (failures.length) {
    console.log("");
    console.log(`FLAGGED ${failures.length}:`);
    for (const f of failures) console.log(`  · ${f}`);
    return 1;
  }
  console.log("");
  console.log("nothing flagged.");
  return 0;
}

// Only run as a program. Imported (by the test), this file defines and does nothing.
// — DECIDING BY FILENAME IS THE SEVENTH SPELLING, and it is the one the
// entry-point census could not see: it compares argv[1] to a literal name and never mentions
// `import.meta.url`, which is half of that guard's population test. Measured — this file under any
// other name exited 0 with ZERO BYTES of output, and comparing basenames also answers TRUE for an
// unrelated script that happens to share the name. `isEntrypoint` realpaths both sides.
if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
