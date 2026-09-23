// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The delivery stale-repair can re-run the reviewer long after the verdict settled. A stricter review is
// adopted; a softer one never is, because the verdict path only tightens. In testing on 2026-09-23 the
// reviewer said BLOCKING twice and the run recorded BLOCKING, then a stale repair rewrote the review
// opening CONDITIONAL. BLOCKING rightly stood, but nothing in the run said so, and a reader found two
// answers. The repair now logs `verdict-softening-not-adopted` beside the verdict it did not change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lateReviewAgainst } from "../verify.mjs";

const review = (verdict) => `${verdict}\n\n1. one open point the narrative has not yet stated\n`;

test("a softer late review is reported as softened and never as hardened", () => {
  assert.deepEqual(lateReviewAgainst("BLOCKING", review("CONDITIONAL")), { hardened: null, softened: "CONDITIONAL" });
  assert.deepEqual(lateReviewAgainst("BLOCKING", review("CLEAR")), { hardened: null, softened: "CLEAR" });
  assert.deepEqual(lateReviewAgainst("CONDITIONAL", review("CLEAR")), { hardened: null, softened: "CLEAR" });
});

test("THE CONTROL: a stricter review is still adopted, and a same or unreadable one is neither", () => {
  assert.deepEqual(lateReviewAgainst("CONDITIONAL", review("BLOCKING")), { hardened: "BLOCKING", softened: null });
  assert.deepEqual(lateReviewAgainst("CLEAR", review("CONDITIONAL")), { hardened: "CONDITIONAL", softened: null });
  assert.deepEqual(lateReviewAgainst("BLOCKING", review("BLOCKING")), { hardened: null, softened: null });
  assert.deepEqual(lateReviewAgainst("BLOCKING", "no verdict here\n"), { hardened: null, softened: null });
  assert.deepEqual(lateReviewAgainst(undefined, review("CLEAR")), { hardened: null, softened: null });
});

// The site is deep in delivery, behind a stale repair of the reviewer that no offline scenario reaches
// after a settled CONDITIONAL or BLOCKING. So the wiring is read from the source: the one place the late
// review is read must decide through lateReviewAgainst and log the softening it returns.
test("the delivery stale-repair decides through lateReviewAgainst and logs the softening", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  const at = src.indexOf('if (s2.label === "narrative-refutation") {');
  assert.ok(at > 0, "the stale-repair branch for the reviewer is where this test reads");
  const site = src.slice(at, at + 2500);
  assert.match(site, /const \{ hardened, softened: reviewSays \} = lateReviewAgainst\(verdict, reviewNow\);/);
  assert.match(site, /if \(reviewSays\) \{\s*runLog\(run\.runDir, \{ event: "verdict-softening-not-adopted", was: verdict, reviewSays, stage: s2\.label \}\);/);
  assert.equal(src.split("lateReviewAgainst(").length - 1, 1, "one call site, so no second reading of the late review can skip the log");
});
