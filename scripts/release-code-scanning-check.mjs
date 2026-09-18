// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-code-scanning-check.mjs — is the commit about to be published as a stable one code scanning
// has finished reading, with nothing left open?
//
//   node scripts/release-code-scanning-check.mjs --sha <commit> --repo <owner/name>
//        [--ref refs/heads/main] [--timeout 1200] [--interval 30]
//
// Exit 0: code scanning has a completed analysis of <sha> for every language it analyses on <ref>, and
// no alert on <ref> is open. Exit 1: alerts are open (each named), or the analysis of <sha> did not arrive
// within the bound. Exit 2: could not look — the API refused, or the arguments were incomplete.
//
// ── WHY A STABLE, AND ONLY A STABLE ─────────────────────────────────────────────────────────────────
//
// Code scanning was on and reported alerts, and an integration merge landed with its check red: a scanner
// that can stay red without stopping anything is a notification. The owner's ruling (2026-09-18): the
// check is required on main, and a stable is published only over a clean result. Betas are not gated —
// they are how a fix reaches the people testing it. There is NO OVERRIDE: an open alert is fixed, or
// dismissed on the alert with a written reason, and then this passes.
//
// ── IT WAITS, BECAUSE THE ANALYSIS FOLLOWS THE MERGE ────────────────────────────────────────────────
//
// The commit a stable publishes is the version commit, and the version pull request merges itself
// moments before this runs; code scanning analyses that push in a few minutes (measured on the beta.10
// release commit: under five). So an analysis not there YET is waited for, bounded; an analysis never
// there fails the publish, because a verdict nobody reached is not a clean one.
//
// ── WHY THE OPEN ALERTS ARE READ ON THE BRANCH ──────────────────────────────────────────────────────
//
// Alerts belong to a ref, not to a commit: the open list for main describes main's latest analysis. So
// the check first requires that analysis to be of <sha> itself — if main has moved past the commit being
// published, the list describes a different tree and this refuses rather than answer about it.
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const arg = (argv, flag, dflt = null) => { const i = argv.indexOf(flag); return i === -1 ? dflt : argv[i + 1]; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** `gh api` as JSON, paginated where asked. Throws on a refusal, which the caller turns into exit 2. */
function gh(path, { paginate = false } = {}) {
  // Paginated pages come back as one element per line (`--jq '.[]'`), so no page boundary is ever
  // reassembled by editing text.
  const args = ["api", ...(paginate ? ["--paginate", "--jq", ".[]"] : []), path];
  const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  return paginate ? out.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : JSON.parse(out);
}

/**
 * PURE. The verdict from what the API said.
 * @param {object} o
 * @param {Array<{commit_sha:string, category?:string, error?:string, created_at?:string}>} o.analyses  on <ref>, newest first
 * @param {Array<{number:number, rule?:{id?:string}, most_recent_instance?:{location?:{path?:string, start_line?:number}}}>} o.open
 */
export function verdict({ sha, analyses, open }) {
  const categories = [...new Set(analyses.map((a) => a.category ?? ""))];
  if (!categories.length) return { state: "waiting", why: "code scanning has no analysis on this branch at all" };
  const newest = new Map();
  for (const a of analyses) if (!newest.has(a.category ?? "")) newest.set(a.category ?? "", a);
  const notYet = categories.filter((c) => newest.get(c).commit_sha !== sha);
  if (notYet.length) {
    const moved = notYet.filter((c) => analyses.some((a) => (a.category ?? "") === c && a.commit_sha === sha));
    if (moved.length) return { state: "moved", why: `the branch's newest ${moved.join(", ")} analysis is of another commit, so its alerts describe a different tree` };
    return { state: "waiting", why: `no analysis of ${sha.slice(0, 8)} yet for ${notYet.join(", ")}` };
  }
  const failed = categories.filter((c) => newest.get(c).error);
  if (failed.length) return { state: "failed", why: `the analysis of ${sha.slice(0, 8)} for ${failed.join(", ")} reported an error: ${newest.get(failed[0]).error}` };
  if (open.length) return { state: "open", why: `${open.length} alert(s) are open`, open };
  return { state: "clean", why: `${categories.length} analysis categor${categories.length === 1 ? "y" : "ies"} of ${sha.slice(0, 8)} complete, no alert open` };
}

async function main() {
  const argv = process.argv.slice(2);
  const sha = arg(argv, "--sha"), repo = arg(argv, "--repo");
  const ref = arg(argv, "--ref", "refs/heads/main");
  const timeoutSec = Number(arg(argv, "--timeout", "1200")), intervalSec = Number(arg(argv, "--interval", "30"));
  if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !(intervalSec > 0) || !Number.isFinite(timeoutSec)) {
    console.error("release-code-scanning-check: needs --sha <40-character commit> and --repo <owner/name>. Could not look.");
    process.exit(2);
  }
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    let v;
    try {
      const analyses = gh(`repos/${repo}/code-scanning/analyses?ref=${encodeURIComponent(ref)}&tool_name=CodeQL&per_page=100`);
      const open = gh(`repos/${repo}/code-scanning/alerts?ref=${encodeURIComponent(ref)}&state=open&per_page=100`, { paginate: true });
      v = verdict({ sha, analyses, open });
    } catch (e) {
      console.error(`release-code-scanning-check: the code-scanning API could not be read: ${String(e.stderr ?? e.message).split("\n")[0]}. `
        + "Could not look, which is not a clean scan.");
      process.exit(2);
    }
    console.log(`release-code-scanning-check: at ${Math.floor(Date.now() / 1000)} — ${v.why}.`);
    if (v.state === "clean") return;
    if (v.state === "open") {
      console.error(`\nA stable is not published over open code-scanning alerts. Fix each, or dismiss it on the alert with a written reason:`);
      for (const a of v.open.slice(0, 25)) {
        const l = a.most_recent_instance?.location ?? {};
        console.error(`  #${a.number}  ${a.rule?.id ?? "?"}  ${l.path ?? "?"}:${l.start_line ?? "?"}`);
      }
      if (v.open.length > 25) console.error(`  … and ${v.open.length - 25} more`);
      process.exit(1);
    }
    if (v.state === "moved" || v.state === "failed") { console.error(`\nrelease-code-scanning-check: ${v.why}. Not published.`); process.exit(1); }
    if (Date.now() + intervalSec * 1000 > deadline) {
      console.error(`\nrelease-code-scanning-check: after ${timeoutSec}s, ${v.why}. A verdict nobody reached is not a `
        + "clean one, so the stable is not published. Re-run the job once the analysis has finished.");
      process.exit(1);
    }
    await sleep(intervalSec * 1000);
  }
}

if (isEntrypoint(import.meta.url)) main();
