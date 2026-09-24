// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-entry-catch-up.mjs — finish a release npm was still validating when the publish job stopped waiting.
//
//   node scripts/release-entry-catch-up.mjs [--repo owner/name] [--bound-hours 6] [--dry-run]
//
// WHY THIS EXISTS. npm now accepts a publish before it serves it ("Your package is being processed and may
// take a few minutes to become available"), and the processing is not bounded. The publish job waits for
// an unauthenticated client to get the exact bytes it uploaded before it creates the release entry, and
// that wait has to end somewhere. Measured 2026-09-23: 0.3.3-beta.1 was served eleven minutes after npm
// accepted it; the 0.3.3 stable was still "Validating" on npmjs.com more than fifty minutes after, the
// job gave up at its bound, and no entry was ever created. GitHub went on naming 0.3.2 as the latest
// release while the stable was already published. Nothing ran again to finish it.
//
// So a tagged version with no entry is PENDING, not failed, and the scheduled run finishes it: once the
// registry serves the bytes the publish job kept, the entry is created from the changelog, exactly as the
// publish job would have created it. Past a bound with the version still not served, it says so in red.
//
// THE SAME CHECK, ON THE SAME BYTES. The publish job keeps the tarball it uploaded as an artifact named
// `published-<version>`, and this hands that file to release-visible-check.mjs, so an entry is only ever
// created over bytes the registry serves and this pipeline published. A tagged version with no kept bytes
// (one published before this existed) is reported, never guessed at.
//
// THE RELEASE RUN'S ARTIFACT, NEVER ANY ARTIFACT OF THAT NAME. Any run in the repository can upload an
// artifact called `published-<version>`, a fork's pull request included, and GitHub lists same-named
// artifacts highest id first, so a name alone takes the last upload: its parts list would ride on the
// official entry, and its tarball would report a sound release as different bytes. An artifact is used only
// when the run that made it is this repository's release workflow, on `main`, at the tagged commit or
// behind it. Behind it is the ordinary case for a cut: its publish runs on the commit it was dispatched
// from, and the version commit it tags lands on `main` after (0.3.3-beta.1: run on `1d7722ac`, tag on
// `d571d0ee`).
//
// Exit 0: nothing to do, the entry was created, or the version is pending inside the bound.
// Exit 1: the registry serves different bytes, the version is still not served past the bound, or its bytes
// cannot be found to check against.
// Exit 2: could not look.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What to do about the version at main's head. PURE, so every branch is driven without a registry.
 * @param {{ tagged: boolean, entryExists: boolean, keptBytes: boolean, visibleExit: number|null,
 *           ageSec: number|null, boundSec: number }} s
 * @returns {{ action: "none"|"create"|"wait"|"report", exit: 0|1|2, why: string }}
 */
export function decide(s) {
  if (!s.tagged) return { action: "none", exit: 0, why: "not tagged: nothing has been published to finish" };
  if (s.entryExists) return { action: "none", exit: 0, why: "the release entry already exists" };
  if (!s.keptBytes) {
    return { action: "report", exit: 1,
      why: "tagged with no release entry, and no kept bytes to check the registry against: create the entry by hand after checking what the registry serves" };
  }
  if (s.visibleExit === 0) return { action: "create", exit: 0, why: "the registry serves the published bytes" };
  // DIFFERENT BYTES ARE NEVER PENDING. The registry serves this version and it is not the build that was
  // published, so it is red at once, however young the tag.
  if (s.visibleExit === 3) {
    return { action: "report", exit: 1, why: "the registry serves DIFFERENT BYTES for this version than the publish job kept" };
  }
  if (s.visibleExit === 1) {
    if (s.ageSec != null && s.ageSec > s.boundSec) {
      return { action: "report", exit: 1,
        why: `tagged ${Math.round(s.ageSec / 3600)} h ago and the registry still does not serve these bytes` };
    }
    return { action: "wait", exit: 0, why: "npm has not served it yet; the next scheduled run looks again" };
  }
  return { action: "report", exit: 2, why: "the registry check could not look" };
}

export const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const RELEASE_EVENTS = new Set(["push", "workflow_dispatch", "schedule"]);

/**
 * Why a kept artifact is NOT the release run's own, or null when it is. PURE. Called first with the
 * artifact alone, which reads only what the artifact list already says, so a fork's upload costs no further
 * call; then with the run that made it and how that run's commit relates to the tagged one (the compare
 * API's `status` from the run's commit to the tag: "identical" or "ahead" means at the tag or behind it).
 * @param {{ artifact: object, repoId: number, run?: object, relation?: string }} s
 * @returns {string|null}
 */
export function notTheReleaseRun({ artifact, repoId, run, relation }) {
  const w = artifact.workflow_run ?? {};
  if (w.repository_id !== repoId || w.head_repository_id !== repoId) return "it was made by a run from another repository, such as a fork's pull request";
  if (w.head_branch !== "main") return `it was made by a run on ${w.head_branch ? `\`${w.head_branch}\`` : "no branch"}, not on main`;
  if (run === undefined) return null;
  if (run.id !== w.id) return "the run read back is not the run the artifact names";
  if (run.path !== RELEASE_WORKFLOW) return `it was made by ${run.path ?? "an unnamed workflow"}, not the release workflow`;
  if (!RELEASE_EVENTS.has(run.event)) return `it was made by a ${run.event ?? "nameless"} run, which never publishes`;
  if (run.head_repository?.id !== repoId || run.head_branch !== "main") return "the run that made it is not on this repository's main";
  if (relation !== "identical" && relation !== "ahead") return `it was made on a commit that is not the tagged commit or behind it (${relation ?? "unknown"})`;
  return null;
}

const arg = (argv, flag, dflt = null) => { const i = argv.indexOf(flag); return i === -1 ? dflt : argv[i + 1]; };
const gh = (args, opts = {}) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

// Whether the entry exists. Only GitHub's own "release not found" is a no; any other failure throws.
function entryFor(tag, repo) {
  const r = spawnSync("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName"], { encoding: "utf8" });
  if (r.status === 0) return true;
  if (/release not found/i.test(r.stderr ?? "")) return false;
  throw Object.assign(new Error(`could not read the release entry for ${tag}`), { stderr: r.stderr || r.error?.message });
}

// The first unexpired `published-<version>` artifact the release run made, or null. Every other one is
// named in a warning with the reason it was refused. EVERY PAGE OF THE LIST IS READ, NOT THE FIRST: any
// run can upload an artifact of that name, so a hundred uploads made after the release run's would push
// its own off a single page, and the version would be reported as having no kept bytes.
function keptArtifact(repo, version, tagSha) {
  const repoId = Number(gh(["api", `repos/${repo}`, "--jq", ".id"]).trim());
  for (let page = 1, seen = 0, total = 1; seen < total; page++) {
    const list = JSON.parse(gh(["api", `repos/${repo}/actions/artifacts?name=published-${version}&per_page=100&page=${page}`]));
    const artifacts = list.artifacts ?? [];
    if (!artifacts.length) break;   // the count named more than the pages hold: nothing further to read
    total = list.total_count ?? 0;
    seen += artifacts.length;
    for (const artifact of artifacts.filter((x) => !x.expired && x.name === `published-${version}`)) {
      let why = notTheReleaseRun({ artifact, repoId });
      if (!why) {
        const run = JSON.parse(gh(["api", `repos/${repo}/actions/runs/${artifact.workflow_run.id}`]));
        const relation = gh(["api", `repos/${repo}/compare/${run.head_sha}...${tagSha}`, "--jq", ".status"]).trim();
        why = notTheReleaseRun({ artifact, repoId, run, relation });
      }
      if (!why) return artifact;
      console.log(`::warning::release-entry-catch-up: refused artifact ${artifact.id} named published-${version}: ${why}.`);
    }
  }
  return null;
}

function main() {
  try { return catchUp(process.argv.slice(2)); }
  catch (e) {
    // A GitHub call that failed is a check that could not look, never the verdict "past the bound".
    console.log(`::error::release-entry-catch-up could not finish: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
    return 2;
  }
}

function catchUp(argv) {
  const repo = arg(argv, "--repo", process.env.GITHUB_REPOSITORY);
  const boundSec = Number(arg(argv, "--bound-hours", "6")) * 3600;
  const dry = argv.includes("--dry-run");
  if (!repo || !(boundSec > 0)) { console.error("release-entry-catch-up: needs --repo (or GITHUB_REPOSITORY) and a positive --bound-hours. Could not look."); return 2; }

  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const tag = `v${version}`;
  const prerelease = version.includes("-");

  // THE EXACT REF, as the publish job asks it: a prefix read would take v0.3.1 for v0.3.1-beta.0.
  let tagged;
  try { tagged = gh(["api", `repos/${repo}/git/ref/tags/${tag}`, "--jq", ".ref"]).trim() === `refs/tags/${tag}`; }
  catch (e) { if (/HTTP 404/.test(String(e.stderr))) tagged = false; else { console.error(`release-entry-catch-up: could not read the tag ${tag}: ${String(e.stderr || e.message).trim()}`); return 2; } }
  const entryExists = tagged ? entryFor(tag, repo) : false;

  let keptBytes = false, visibleExit = null, ageSec = null, work = null, sbom = null;
  if (tagged && !entryExists) {
    const [tagSha, when] = gh(["api", `repos/${repo}/commits/${tag}`, "--jq", `.sha + " " + .commit.committer.date`]).trim().split(" ");
    ageSec = Math.max(0, (Date.now() - Date.parse(when)) / 1000);
    const a = keptArtifact(repo, version, tagSha);
    if (a) {
      work = mkdtempSync(join(tmpdir(), "entry-catch-up-"));
      writeFileSync(join(work, "kept.zip"), execFileSync("gh", ["api", `repos/${repo}/actions/artifacts/${a.id}/zip`],
        { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
      execFileSync("unzip", ["-q", "-o", join(work, "kept.zip"), "-d", join(work, "kept")]);
      const kept = readdirSync(join(work, "kept"));
      const tgz = kept.find((f) => f.endsWith(".tgz"));
      const cdx = kept.find((f) => f.endsWith(".cdx.json"));
      if (cdx) sbom = join(work, "kept", cdx);
      if (tgz) {
        keptBytes = true;
        const r = spawnSync(process.execPath, [join(ROOT, "scripts", "release-visible-check.mjs"), "--version", version,
          "--tag", prerelease ? "beta" : "latest", "--tarball", join(work, "kept", tgz), "--timeout", "60", "--interval", "15"],
        { encoding: "utf8" });
        process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
        visibleExit = r.status;
      }
    }
  }

  const d = decide({ tagged, entryExists, keptBytes, visibleExit, ageSec, boundSec });
  console.log(`release-entry-catch-up: ${tag}: ${d.why}.`);
  if (d.action === "create") {
    if (dry) { console.log(`release-entry-catch-up: --dry-run, so no entry is created for ${tag}.`); }
    else {
      // THE SAME ENTRY THE PUBLISH JOB WRITES: the changelog's section for this version, flagged as a
      // pre-release for a beta, and GitHub's own notes only when the changelog has no section.
      const notes = spawnSync(process.execPath, [join(ROOT, "scripts", "release-notes-for.mjs"), version], { encoding: "utf8" }).stdout ?? "";
      // The parts list the publish job kept beside the bytes rides as an asset, as it does on an entry the
      // publish job writes itself. A version kept before the list existed has none, and gets none.
      const args = ["release", "create", tag, ...(sbom ? [sbom] : []), "--repo", repo, "--verify-tag", "--title", tag];
      if (notes.trim()) { const f = join(work ?? mkdtempSync(join(tmpdir(), "entry-notes-")), "notes.md"); writeFileSync(f, notes); args.push("--notes-file", f); }
      else args.push("--generate-notes");
      if (prerelease) args.push("--prerelease");
      gh(args);
      console.log(`release-entry-catch-up: created the release entry for ${tag}${prerelease ? " as a pre-release" : ""}.`);
    }
  }
  if (d.exit === 1) console.log(`::error::${tag}: ${d.why}.`);
  else if (d.action === "wait") console.log(`::notice::${tag}: ${d.why}.`);
  if (work) rmSync(work, { recursive: true, force: true });
  return d.exit;
}

if (isEntrypoint(import.meta.url)) process.exitCode = main();
