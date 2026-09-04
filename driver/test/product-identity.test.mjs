// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The AGPL §13 source offer states the RUNNING build, or admits it cannot.
//
// The failure this guards is not a crash. It is an About page that renders a repository link, reads as
// a satisfied source offer, and points at a branch rather than at the code the user is talking to. That
// looks identical to a correct one unless the sha is checked, so the assertions below are about the
// PAIR (commit, sourceUrl) staying honest together — including in the degraded case, where the right
// behaviour is to report nothing rather than to report the branch as if it were the version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { productIdentity, runningCommit, resetProductIdentity, SOURCE_REPO } from "../../shared/product-identity.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

// The guard name this file announces under, so a skip says which check did not run.
const GUARD = "product-identity (the AGPL §13 source offer)";

test("the commit is the one this checkout is actually on", (ctx) => {
  resetProductIdentity();
  const sha = runningCommit();
  // — SKIP, not a bare return. node:test counts a bare return as a PASS, so off a checkout this
  // arm reported the commit verified having resolved none. The comment that used to sit here said the
  // case was "covered by the degraded case below" — it was not: that arm asserted a hand-built object.
  if (sha === null) return ctx.skip(skipReason(GUARD));
  assert.match(sha, /^[0-9a-f]{40}$/, "a sha that is not a full sha is a wrong answer, not a missing one");
  const actual = execFileSync("git", ["-C", new URL("../..", import.meta.url).pathname, "rev-parse", "HEAD"],
    { encoding: "utf8" }).trim();
  assert.equal(sha, actual, "resolved a different commit than the checkout is on");
});

test("sourceUrl pins to the commit, so the offer resolves to THIS build", () => {
  resetProductIdentity();
  const id = productIdentity();
  // BOTH BRANCHES ASSERT. The `if` had no `else`, so off a checkout this arm exercised nothing
  // and still reported ok — the shape 's member exists to catch, in its early-return spelling.
  if (id.commit) {
    assert.equal(id.sourceUrl, `${SOURCE_REPO}/tree/${id.commit}`);
    assert.ok(id.sourceUrl.includes(id.commit), "a source offer that omits the sha is a branch link");
  } else {
    assert.equal(id.sourceUrl, SOURCE_REPO,
      "with no sha the URL must be the bare repo — a pinned-looking URL beside a null commit is the misstatement §13 is about");
  }
});

test("with no commit, the offer degrades to the bare repo AND says so", () => {
  // THIS ARM USED TO BUILD ITS OWN SUBJECT. It read:
  //
  //     const id = { commit: null, sourceUrl: SOURCE_REPO };
  //     assert.equal(id.sourceUrl, SOURCE_REPO);
  //
  // — a literal asserted against itself. `productIdentity()` was never called, so the degraded case
  // this file names as its reason for skipping the first arm was covered by nothing at all. Two arms
  // pointed at each other across a gap.
  //
  // The real function is driven instead, with `git` taken off PATH so `runningCommit()`'s spawn fails
  // exactly as it does on a deployment that is not a checkout. Same technique that proved the eleven
  // conversions on this issue; `process.execPath` is absolute, so node itself is unaffected.
  // ── F49 — REMOVING GIT NO LONGER MEANS "NO COMMIT" ──────────────────────
  //
  // `runningCommit()` now falls back to `build-info.json`, deliberately: the AGPL §13 source offer named
  // NO commit on every packaged install, which is the shape most people run. So "no commit" means
  // NEITHER source, and this arm has to remove both or it measures the machine it runs on.
  //
  // It bit exactly that way, and the trap is worth naming because the natural repair is the wrong one.
  // `build-info.json` is gitignored, so CI never has one and this arm passes there — while `npm pack`,
  // INCLUDING `--dry-run`, runs `prepack`, which writes one. A developer who had packed the tree saw
  // this arm fail for something absent from their diff, and the tempting fix is to weaken a correct
  // assertion to match a polluted checkout.
  //
  // So the subject is a COPIED tree that has neither: the same technique as the source-offer arms, and
  // `packagedBuild` resolves from the MODULE's own path rather than cwd, which is why moving the module
  // is the only lever that works.
  const bare = mkdtempSync(join(tmpdir(), "identity-bare-"));
  mkdirSync(join(bare, "shared"), { recursive: true });
  for (const f of ["product-identity.mjs", "packaged-build.mjs"])
    copyFileSync(new URL(`../../shared/${f}`, import.meta.url), join(bare, "shared", f));
  copyFileSync(new URL("../../package.json", import.meta.url), join(bare, "package.json"));
  const probe = "import('" + pathToFileURL(join(bare, "shared", "product-identity.mjs")).href + "')"
    + ".then(m => { const i = m.productIdentity(); console.log(JSON.stringify"
    + "({ commit: i.commit, sourceUrl: i.sourceUrl })); })";
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/nonexistent-so-git-cannot-be-found" },
  });
  const id = JSON.parse(out.trim());

  assert.equal(id.commit, null, "with git unreachable the commit must be null, not a stale or invented sha");
  assert.equal(id.sourceUrl, SOURCE_REPO, "with no sha the URL must not pretend to be pinned");
  assert.ok(!id.sourceUrl.includes("/tree/"), "a /tree/ path with no commit is a branch link wearing a pin");
});

test("the licence is read from the manifest, never restated here", () => {
  // A constant in product-identity.mjs would disagree with package.json for the whole of the relicence
  // and the About page would name a licence the repository does not declare. Asserting they MATCH,
  // rather than asserting a value, is what keeps this test true on both sides of that change.
  resetProductIdentity();
  const declared = JSON.parse(
    execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8", cwd: new URL("../..", import.meta.url).pathname }),
  ).license ?? null;
  assert.equal(productIdentity().license, declared,
    "the source offer names a different licence than package.json declares");
});

test("identity carries every field a §13 offer owes", () => {
  resetProductIdentity();
  const id = productIdentity();
  for (const k of ["name", "version", "commit", "sourceRepo", "sourceUrl", "license", "copyright"])
    assert.ok(k in id, `missing ${k} — a surface reading this would silently render undefined`);
  assert.equal(id.name, "Clearotron");
  assert.match(id.sourceRepo, /^https:\/\//, "the offer must be a URL someone outside can open");
});
