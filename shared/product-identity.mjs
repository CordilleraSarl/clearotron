// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Who this software is and which build is answering — the one place all three AGPL §13 surfaces read.
//
// WHY THIS EXISTS. §13 obliges an operator running a MODIFIED version over a network to offer users
// THAT version's source. A link to the default branch is not that: it points at whatever is there now,
// which on a deployment that has not pulled in a month is not the code the user is talking to. So the
// obligation is specifically to report the RUNNING commit, and three surfaces owe it — the portal's
// About page, the MCP server's about resource, and the CLI. Three surfaces each
// deriving it separately is three chances to report a different answer, and the one that matters is
// whichever the reader did not check.
//
// IT LIVES IN shared/ BECAUSE OF WHO NEEDS IT, NOT WHERE IT STARTED. driver/engine-build.mjs already
// resolves the same sha for artifact provenance and is the model for the git call below. It
// cannot be the shared source: mcp-server/ would then import driver/, and shared/ must not depend on
// driver/ in the other direction either. The duplication is the git invocation only — four lines,
// deliberately identical, and both carry the `-C HERE` reason.
//
// THE COMMIT IS SERVED, NEVER BUILT. portal-ui/dist is committed to git and CI fails when source and
// dist disagree, so a hash baked into the bundle by a build-time define is circular — it is not known
// until after the commit carrying it, and dist could then never match its source again. The tempting
// fix at that point is to weaken the freshness check, which is worse than having no About page. The
// server knows what it is running; the bundle cannot. Every §13 surface here is server-side.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { packagedBuild } from "./packaged-build.mjs";   // F49 — the archive names its own commit

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// The public repository the source offer points at. A §13 offer must resolve for someone who is not
// us, so this is the PUBLIC mirror, not the private origin this file sits in.
export const SOURCE_REPO = "https://github.com/CordilleraSarl/Clearotron";

// Resolved once per process: the code cannot change under a running process without a restart, and a
// git spawn per request is a cost with no matching information.
let cachedCommit;
/** Which evidence answered — "git" | "build-info" | null. Resolved with `cachedCommit`, reset with it. */
let commitSource;
let cachedManifest;

/**
 * The running commit sha, or null.
 *
 * `-C HERE` so it reads the checkout THIS FILE is in, which is not the process cwd — the portal, the
 * runner and the MCP faces all start elsewhere. Reading cwd would report whichever repo happened to
 * launch the process: a wrong answer rather than a missing one, and a wrong sha in a source offer is
 * worse than an absent one because it looks satisfied.
 *
 * Best-effort by construction. A deployment that is not a git checkout gets null and every caller
 * keeps working — see `productIdentity` for what a null is allowed to mean.
 */
export function runningCommit() {
  if (cachedCommit !== undefined) return cachedCommit;
  let git = null;
  try {
    git = execFileSync("git", ["-C", HERE, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim() || null;
  } catch {
    git = null;
  }
  if (git) { cachedCommit = git; commitSource = "git"; return cachedCommit; }

  // ── F49 — THE SOURCE OFFER MUST NAME A COMMIT ON A PACKAGED INSTALL ──────
  //
  // `server_info` describes itself to every client as "the AGPL §13 source offer: this server's name,
  // version, licence, source repository and THE COMMIT IT IS RUNNING". Driven from a real packaged
  // install it answered `commit: null` — so the one surface that discharges a LICENCE OBLIGATION named
  // no commit on the install shape most people run, while `build-info.json` sat in the same tree
  // holding the answer.
  //
  // The sibling resolution in driver/engine-build.mjs already had this exact fix, for the same reason,
  // written after the same measurement. Two functions answering "which commit is this" with different
  // evidence is how one of them goes on being wrong; this is the second one converging on the first,
  // through the same shared helper rather than a copy of its logic.
  //
  // GIT STAYS FIRST AND IS NEVER OVERRIDDEN, and the reason is that sibling's, unchanged: in a checkout
  // the two can legitimately disagree — a `build-info.json` left behind by an earlier pack names the
  // commit that was PACKED, not the one running now — and the live checkout is the better answer
  // wherever there is one.
  const packed = packagedBuild(join(HERE, ".."));
  cachedCommit = packed ? packed.commit : null;
  commitSource = packed ? "build-info" : null;
  return cachedCommit;
}

/**
 * WHICH evidence named the commit: `"git"`, `"build-info"`, or `null` when nothing could.
 *
 * Same distinction the engine's resolution draws, and it matters more here rather than less: a commit
 * read from a shipped file cannot say the tree was clean, and this is the surface a reader consults to
 * obtain the corresponding source. A reader who cannot tell a stamped archive from a verified checkout
 * cannot tell how much the sha promises.
 */
export function runningCommitSource() { runningCommit(); return commitSource; }

/**
 * Name, version and licence, read from the root manifest rather than restated here.
 *
 * The licence especially: it is mid-migration, and a constant in this file would be a second answer
 * that disagrees with package.json for however long the relicence takes. Reading the manifest means
 * this surface becomes correct the moment that lands, with no edit here and no window where the About
 * page names one licence and the repository declares another.
 */
function manifest() {
  if (cachedManifest !== undefined) return cachedManifest;
  try {
    const j = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    cachedManifest = { version: j.version ?? null, license: j.license ?? null };
  } catch {
    cachedManifest = { version: null, license: null };
  }
  return cachedManifest;
}

/**
 * Everything a §13 source offer has to state.
 *
 * `sourceUrl` is pinned to the commit when there is one. When there is not, it falls back to the bare
 * repository AND `commit` stays null, so a caller can tell the difference and say so. That pair is the
 * point: a UI that renders a bare repo link while implying it is the running source is the failure this
 * is meant to prevent, and it can only avoid it if the missing sha is visible rather than papered over.
 *
 * @returns {{name: string, version: string|null, commit: string|null, sourceUrl: string,
 *            sourceRepo: string, license: string|null, copyright: string}}
 */
export function productIdentity() {
  const commit = runningCommit();
  const { version, license } = manifest();
  return {
    name: "Clearotron",
    version,
    commit,
    sourceRepo: SOURCE_REPO,
    sourceUrl: commit ? `${SOURCE_REPO}/tree/${commit}` : SOURCE_REPO,
    license,
    copyright: "Copyright 2026 Cordillera Sàrl",
  };
}

/** Test seam: forget both cached answers. */
export function resetProductIdentity() {
  cachedCommit = undefined;
  commitSource = undefined;
  cachedManifest = undefined;
}
