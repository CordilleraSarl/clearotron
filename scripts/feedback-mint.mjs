#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// feedback-mint.mjs — the one file in this feature that touches the network.
//
// Drains the feedback store: every flag that is not yet an issue becomes one, exactly once. The shaping
// is in driver/feedback-issues.mjs and the drain is in driver/feedback-mint.mjs, both pure and both
// tested offline; what is here is the GitHub call and the argument handling.
//
// ── TWO CREDENTIAL PATHS, AND WHY THEY ARE NOT INTERCHANGEABLE ───────────────────────────────────────
//
// Either a token in FEEDBACK_GH_TOKEN — suited to an unattended run under a service account, read from a
// dedicated env file rather than a shell profile — or an authenticated `gh`, which carries its own
// credential and needs no new secret. Whichever is present is used; the two are NOT equivalent:
//
//   • `gh issue create` CANNOT use a fine-grained PAT scoped to Issues. It resolves the default branch
//     over GraphQL first and is refused (`repository.defaultBranchRef`), while the REST endpoint accepts
//     the identical request. So the token path posts to the API directly — see createIssueViaApi.
//   • `--ensure-labels` must carry the same credential as the mint. It used to shell `gh` with none, so
//     under a token-only account every label failed while minting would have worked. The label pass runs
//     first, so the tool announced itself as broken while being fine. Both call sites now share one env.
//
// If neither credential is present this refuses with a sentence saying why, rather than half-working.
//
//   node scripts/feedback-mint.mjs --dir <store> [--repo owner/name] [--dry-run] [--ensure-labels]
//
// --dry-run prints what WOULD be minted and writes nothing. Run it first: every issue this creates is
// visible to everyone who reads the issue list.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mintPending, isPending } from "../driver/feedback-mint.mjs";
import { issueForFlag, REQUIRED_LABELS } from "../driver/feedback-issues.mjs";
import { originRepoOrRefuse } from "../shared/origin-repo.mjs";

const TOKEN_VAR = "FEEDBACK_GH_TOKEN";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const dir = opt("--dir", process.env.CLEAROTRON_FEEDBACK_DIR);
// DERIVED, NEVER NAMED. This carried a hardcoded repository until; in a fork that minted
// issues against somebody else's tracker, and it was a private name in a shipping file. A checkout with
// no remote is now a refusal naming --repo, not a guess.
const repo = opt("--repo", null) ?? originRepoOrRefuse();
const dryRun = flag("--dry-run");

if (!dir) {
  console.error(`Say which store to drain: --dir <path>, or set CLEAROTRON_FEEDBACK_DIR.`);
  process.exit(2);
}

// `gh` carries its own auth, so a token is only needed when gh is absent. Both are checked up front:
// discovering there is no credential AFTER minting nine issues and failing on the tenth is the worst
// possible ordering.
function ghAvailable() {
  try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

/**
 * The environment EVERY `gh` call gets — defined once, because the two call sites drifted.
 *
 * `--ensure-labels` used to shell gh with no env at all while the mint passed GH_TOKEN, so on the host
 * this script is written for — a service account with FEEDBACK_GH_TOKEN and NO `gh auth` — labels failed
 * on every run while minting would have worked. The label pass runs first and is the operator's first
 * command, so the tool announced itself as broken while being fine. Found by running it as the service
 * account rather than as a developer, which is the only place the two paths differ.
 */
const GH_ENV = () => (process.env[TOKEN_VAR] ? { ...process.env, GH_TOKEN: process.env[TOKEN_VAR] } : process.env);

/** gh's own stderr, which is where the reason lives. `stdio: "ignore"` threw it away. */
const ghError = (e) => String(e?.stderr || e?.message || e).trim().replace(/\s+/g, " ");

const canWrite = ghAvailable() || !!process.env[TOKEN_VAR];
if (!canWrite && !dryRun) {
  console.error(
    `No GitHub credential.\n\n` +
    `This host has neither an authenticated \`gh\` nor ${TOKEN_VAR} in its environment, so it cannot\n` +
    `create an issue. That is the open question on #264 rather than a misconfiguration — see the header\n` +
    `of this file for the two ways to close it.\n\n` +
    `--dry-run works without a credential and prints what would be minted.`,
  );
  process.exit(3);
}

/**
 * WITH A TOKEN, THE MINT GOES STRAIGHT TO THE REST API — it cannot go through `gh issue create`.
 *
 * Measured on the service account, 2026-08-04, with a fine-grained PAT that has `issues=write`:
 *
 *   POST /repos/<owner>/<repo>/issues        → HTTP 201, x-accepted-github-permissions: issues=write
 *   gh issue create --repo <owner>/<repo>    → GraphQL: Resource not accessible by personal access
 *                                              token (repository.defaultBranchRef)
 *
 * Same credential, same repo, same request. `gh issue create` resolves the default branch over GraphQL
 * before posting, and a fine-grained PAT scoped to Issues alone is refused that lookup. So routing the
 * mint through `gh` would have required granting Contents access this feature has no use for — a wider
 * token to satisfy a CLI, not the API.
 *
 * It also drops the `gh` dependency from the minting path entirely, which means the unit no longer has to
 * put /usr/local/bin on its PATH to work.
 */
async function createIssueViaApi({ title, body, labels }) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env[TOKEN_VAR]}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "cordillera-feedback-mint",
    },
    body: JSON.stringify({ title, body, labels }),
  });
  const text = await res.text();
  if (!res.ok) {
    // The reason, not just the code. A 403 here is almost always a token missing `issues=write`, and the
    // header GitHub sends back says which permission the endpoint wanted — worth surfacing verbatim.
    const wanted = res.headers.get("x-accepted-github-permissions");
    throw new Error(`GitHub refused the issue (HTTP ${res.status}${wanted ? `, needs ${wanted}` : ""}): ${text.slice(0, 300)}`);
  }
  const j = JSON.parse(text);
  if (!j?.number) throw new Error(`GitHub returned no issue number: ${text.slice(0, 200)}`);
  return { number: j.number, url: j.html_url };
}

/** The developer-side door — option 2 in the header. `gh` carries its own auth, so no token is needed. */
async function createIssueViaGh({ title, body, labels }) {
  const out = execFileSync(
    "gh",
    ["issue", "create", "--repo", repo, "--title", title, "--body", body, ...labels.flatMap((l) => ["--label", l])],
    { encoding: "utf8", env: GH_ENV() },
  ).trim();
  const m = /\/issues\/(\d+)\s*$/.exec(out);
  if (!m) throw new Error(`gh did not return an issue url: ${out.slice(0, 200)}`);
  return { number: Number(m[1]), url: out };
}

// Token first: it is the service-account path, and it is the one that works there. `gh` is the fallback
// for a developer running this against the shared store with no token in their environment.
const createIssue = process.env[TOKEN_VAR] ? createIssueViaApi : createIssueViaGh;

if (flag("--ensure-labels")) {
  // Mechanical, idempotent, and safe to re-run: `gh label create` on an existing label is a no-op with
  // --force. Separate from minting so a first run can create the labels without creating any issues.
  let labelFailures = 0;
  for (const l of REQUIRED_LABELS) {
    try {
      // Same credential as the mint (GH_ENV), and stderr CAPTURED rather than ignored — a failure whose
      // reason is thrown away reads as "gh is broken" when the truth is "this account has no token".
      execFileSync("gh", ["label", "create", l.name, "--repo", repo, "--color", l.color, "--description", l.description, "--force"],
        { encoding: "utf8", env: GH_ENV(), stdio: ["ignore", "ignore", "pipe"] });
      console.log(`label ok: ${l.name}`);
    } catch (e) { labelFailures++; console.error(`label FAILED: ${l.name} — ${ghError(e).slice(0, 300)}`); }
  }
  // A label the minter applies but could not create makes `gh issue create --label` fail per flag, which
  // would leave every flag unstamped and retried forever. Refuse here instead, where one message explains it.
  if (labelFailures) {
    console.error(`\n${labelFailures} of ${REQUIRED_LABELS.length} labels could not be created. The mint applies\n`
      + `every one of them, so it would fail per flag. Fix the credential before minting.`);
    process.exit(4);
  }
}

/**
 * The store's flag files, or an empty list when the store does not exist yet.
 *
 * IT DOES NOT EXIST UNTIL THE FIRST FLAG. `feedbackDir` is created by appendFlag on write, so on a
 * freshly deployed host — which is every host until a lawyer flags something — the directory is simply
 * absent. mintPending already treats that as an empty drain; the dry run did a bare readdirSync and
 * crashed with an unhandled ENOENT and a stack trace. That is the FIRST command this tool's own header
 * tells an operator to run, so the first thing a new install did was look broken.
 *
 * Absent and empty are reported differently on purpose: "no store yet" tells the reader the capture
 * side has never fired, which is a different thing to know from "the store is drained".
 */
function flagFiles(d) {
  try { return readdirSync(d).filter((n) => n.endsWith(".json")).sort(); }
  catch (e) {
    if (e?.code !== "ENOENT") throw e;
    return null;   // null = no store; [] = a store with nothing in it
  }
}

if (dryRun) {
  const names = flagFiles(dir);
  if (names === null) {
    console.log(`No feedback store at ${dir} yet — it is created by the first flag a reader raises.\n`
      + `Nothing to mint, and nothing is wrong.`);
    process.exit(0);
  }
  let pending = 0;
  for (const name of names) {
    let f; try { f = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { continue; }
    if (!isPending(f)) continue;
    pending++;
    const issue = issueForFlag(f);
    console.log(`\n── ${name} ──\n${issue.title}\nlabels: ${issue.labels.join(", ")}\n\n${issue.body}\n`);
  }
  console.log(`\n${pending} flag(s) would be minted into ${repo}. Nothing was written.`);
  process.exit(0);
}

// Same distinction on the live path. mintPending already returns an empty result for an absent store, so
// this is not a crash guard — it is so the TIMER's log says "the capture side has never fired" rather than
// "minted 0", which reads identically to a drained store and would hide a portal that stopped capturing.
if (flagFiles(dir) === null) {
  console.log(`No feedback store at ${dir} yet — it is created by the first flag a reader raises. Nothing to mint.`);
  process.exit(0);
}

const res = await mintPending({ dir, createIssue, log: (m) => console.log(m) });
console.log(`minted ${res.minted.length}, failed ${res.failed.length}, already done ${res.skipped}`);
// A failure is not a crash: the flags stay unstamped and the next drain retries them. Exit non-zero so a
// timer's own failure reporting sees it.
process.exit(res.failed.length ? 1 : 0);
