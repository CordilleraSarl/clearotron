// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELPER = fileURLToPath(new URL("./helpers/portal-bundle.mjs", import.meta.url));
const HERE = dirname(fileURLToPath(import.meta.url));

// ── AN ABSENT BUNDLE AND A STALE ONE ARE DIFFERENT QUESTIONS, AND ONLY ONE IS THIS HELPER'S ────────
//
// `doctor` reports a STALE bundle with `problem` and exits 1 — a misconfiguration the reader has no
// other way to learn about, and the reason this helper exists. A bundle that is simply not there takes
// the `unbuilt` branch, which is `blocking`: named, and rc-neutral by runCheck's exit contract. So the
// twelve arms pass with no bundle, and building one for them is work that cannot succeed.
//
// It is the universal case, not a corner: `portal-ui/dist` is untracked, so it is absent on every
// fresh clone and every new worktree. Treating absent as "needs building" sent all of those into a
// build that `scripts/test-run.mjs` refuses by design, and the refusal is fatal here — three files
// failed at IMPORT and 101 assertions did not run. Measured on beta-16 at b9c1433.
//
// EACH CASE GETS ITS OWN MODULE INSTANCE. The helper latches after its first call so a suite builds at
// most once, which would make the second case here read "already checked" and assert nothing. The
// query string defeats the module cache, so every case drives a fresh latch.
// A FILE URL, BUILT WHERE THE IMPORT IS. A bare path works here and fails on Windows, and the corpus
// guard cannot see through a variable that already holds one — so the conversion is written at the
// call, which is both what the guard reads and what makes the property visible to a reader.
const freshHelper = (tag) => import(`${pathToFileURL(HELPER).href}?case=${tag}`);

const repoWith = (t, { src = true, dist = null } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "portal-bundle-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (src) {
    mkdirSync(join(dir, "portal-ui", "src"), { recursive: true });
    writeFileSync(join(dir, "portal-ui", "src", "app.js"), "// a source file\n");
  }
  if (dist) {
    mkdirSync(join(dir, "portal-ui", "dist"), { recursive: true });
    writeFileSync(join(dir, "portal-ui", "dist", "bundle.js"), dist);
  }
  return dir;
};

test("a checkout with no bundle is left alone — no build is attempted", async (t) => {
  // THE FIX. A build here cannot succeed inside a suite run, so attempting one is not a cautious
  // choice: it is the difference between 101 assertions running and none of them running.
  const { ensurePortalBundleIsCurrent } = await freshHelper("absent");
  const repo = repoWith(t, { src: true, dist: null });
  const said = ensurePortalBundleIsCurrent({ repo });
  assert.match(said, /absence/, `an absent bundle was not recognised as one — it said "${said}"`);
  assert.equal(existsSync(join(repo, "portal-ui", "dist")), false,
    "the helper built a bundle for a checkout that had none, which a suite run cannot do");
});

test("a bundle newer than its sources is left alone", async (t) => {
  // The floor on the other side: the helper must still do nothing when there is nothing to do, and
  // must not touch a bundle that is already good.
  const { ensurePortalBundleIsCurrent } = await freshHelper("current");
  const repo = repoWith(t, { src: true, dist: "built\n" });
  const bundle = join(repo, "portal-ui", "dist", "bundle.js");
  const before = readFileSync(bundle, "utf8");
  const said = ensurePortalBundleIsCurrent({ repo });
  assert.equal(said, "already current");
  assert.equal(readFileSync(bundle, "utf8"), before, "the helper rewrote a bundle that was current");
});

test("a checkout with no portal sources is left alone", async (t) => {
  // The packaged install, where the bundle ships and the sources do not, so nothing can be stale
  // against them. Asserted because this branch is what keeps the helper from building in a tree that
  // has nothing to build from.
  const { ensurePortalBundleIsCurrent } = await freshHelper("nosrc");
  const repo = repoWith(t, { src: false, dist: "shipped\n" });
  assert.match(ensurePortalBundleIsCurrent({ repo }), /no sources/);
});

test("the twelve arms that read the checkout's bundle do not name it in what they assert", () => {
  // WHY THE ABOVE IS SAFE, asserted rather than reasoned about. These three files call the helper so
  // that a STALE bundle cannot fail them, and none of them is about the bundle. If a future arm here
  // did start asserting on bundle freshness, leaving an absent bundle unbuilt could silently change
  // what it measures, and this is the line that would say so.
  for (const f of ["doctor-refuses-what-cannot-run.test.mjs", "onboard-wizard.test.mjs",
    "what-doctor-passes-a-search-accepts.test.mjs"]) {
    const src = readFileSync(join(HERE, f), "utf8");
    assert.ok(src.includes("ensurePortalBundleIsCurrent"),
      `${f} no longer calls the helper — repoint this arm or drop it`);
    assert.ok(!/assert[^\n]*OLDER than the sources/.test(src),
      `${f} asserts on bundle staleness, so it IS about the bundle — reconsider leaving one unbuilt`);
  }
});
