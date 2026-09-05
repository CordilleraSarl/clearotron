// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-cut-decision.mjs — did the commit that is on this branch cut a version?
//
// THE STEP THAT ASKED THIS READ THE WORKING TREE, AND THE WORKING TREE HAD JUST BEEN EDITED. The version
// step before it runs `changeset version` in place: it rewrites every manifest, writes the changelog, and
// hands the result to a pull request for somebody to merge. Nothing about that is on this branch yet —
// but the files on disk say it is.
//
// So on the first push carrying release notes, the decision read `0.1.1-beta.0` out of a package.json
// the version step had just written, found no tag for it, and reported that the push had cut it. The
// publish job then started — on a version main does not carry, with nobody having merged anything.
// It failed for an unrelated reason, which is the only thing that stopped it, and "a green pipeline that
// has quietly become able to publish is the worst outcome available here" is the sentence the release
// issue opens with.
//
// The version this asks about is therefore read from the COMMIT, never from the tree, and this file
// exists so the decision is a function somebody can drive rather than four lines of shell nobody can.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

/**
 * Whether `version` has been released, and therefore whether this push cut it.
 *
 * A version with no tag has not been released: the standing pull request merging is the only thing that
 * moves the root version, and the publish job is the only thing that tags it.
 */
export function cutDecision({ version, tags }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(version ?? ""))) {
    throw new Error(`release-cut-decision: "${version}" is not a version. Refusing to decide whether it `
      + "was cut, because the safe answer to an unreadable version is not 'publish it'.");
  }
  return { version, cut: !tags.includes(`v${version}`) };
}

/** The version the COMMIT carries — not the one on disk, which the version step may have just rewritten. */
export function versionAtHead({ ref = "HEAD", run = (args) => execFileSync("git", args, { encoding: "utf8" }) } = {}) {
  const raw = run(["show", `${ref}:package.json`]);
  const version = JSON.parse(raw).version;
  if (!version) throw new Error(`release-cut-decision: ${ref}:package.json names no version`);
  return version;
}

/** Every tag in this checkout. Empty is a real answer only when the fetch brought tags — see the workflow. */
export function tagsHere({ run = (args) => execFileSync("git", args, { encoding: "utf8" }) } = {}) {
  return run(["tag", "--list"]).split("\n").map((t) => t.trim()).filter(Boolean);
}

function main() {
  const version = versionAtHead();
  const tags = tagsHere();
  // A CHECKOUT WITH NO TAGS AT ALL CANNOT ANSWER THIS. Every version would read as never released, and
  // the pipeline would publish on every push. `fetch-depth: 0` brings tags; if it ever stops, this
  // refuses rather than deciding to publish.
  if (!tags.length) {
    console.error("release-cut-decision: this checkout has no tags, so whether a version was already "
      + "released cannot be read. Refusing rather than treating every version as new.");
    process.exitCode = 2;
    return;
  }
  const { cut } = cutDecision({ version, tags });
  console.log(cut ? `v${version} has no tag — this push cut it.` : `v${version} is already released — nothing to publish.`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `version=${version}\ncut=${cut}\n`);
}

if (isEntrypoint(import.meta.url)) main();
