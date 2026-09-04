// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F51 — CREATED, OFFERED, AND REFUSED ──────────────────────────────────
//
// `clearotron brandowner add acmelaw` succeeded and said "doctor will now resolve acmelaw". The account
// appeared in the portal, accepted a project made through the UI, and refused every clearance:
//
//     FORBIDDEN (start_run): your grant [generic] does not include account "acmelaw" — start_run refused
//
// The portal's trigger lane runs on a PINNED ops token, frozen to the roster as it stood when it was
// minted. Creating an account does not re-mint it and nothing in the CLI mentioned it.
//
// THE PRODUCT ALREADY DETECTED THIS — at the portal's next boot, naming the account, predicting the
// consequence and giving the remedy with its flag. It said so to the journal. The next reader was a
// client whose search was refused. The detection was never the defect; where it landed was.
//
// So the computation is shared and the surface that CREATES the account asks it too. These arms are
// mostly about the shared answer, because that is what makes three surfaces unable to disagree.
//
// BREAK MATRIX:
//   · a capped token missing a roster key → uncovered   → break: compare the wrong way, arm 1 red
//   · an UNCAPPED token covers everything               → break: treat null as empty, arm 2 red
//   · the remedy is the UNION, never the roster alone   → break: suggest the roster, arm 3 red
//   · the portal still warns, in the same words         → break: reword or drop, arm 4 red
//   · `brandowner add` says it too, and never dies      → break: remove or make it fatal, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { triggerCapGap, triggerCapWarning } from "../trigger-cap.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

test("a capped token that does not name a roster account reports exactly that account", () => {
  // F51's own numbers: the cap was ["generic"] and the operator created "acmelaw".
  const gap = triggerCapGap({ accounts: ["generic"], roster: ["generic", "acmelaw"] });
  assert.equal(gap.capped, true);
  assert.deepEqual(gap.uncovered, ["acmelaw"], "the account the portal would offer and the door would refuse is not named");
  // And a cap that already covers the roster is silent — or the warning fires on every healthy install
  // and stops being read, which is the failure one layer along.
  assert.deepEqual(triggerCapGap({ accounts: ["generic", "acmelaw"], roster: ["generic", "acmelaw"] }).uncovered, []);
});

test("an UNCAPPED token covers everything — null is not an empty list", () => {
  // The inversion this function exists to name. `accounts: null` means EVERY account; reading it as
  // "no accounts" would report every roster key as unstartable on every uncapped deployment.
  const gap = triggerCapGap({ accounts: null, roster: ["generic", "acmelaw", "zephyr"] });
  assert.equal(gap.capped, false);
  assert.deepEqual(gap.uncovered, [], "an uncapped token was reported as covering nothing");
});

test("the remedy is the UNION of the cap and the roster, never the roster alone", () => {
  // LOAD-BEARING. If the roster is ever read from the wrong directory — an unset customer store falls
  // back to bundled demo fixtures rather than failing — then `--accounts <roster>` is an instruction to
  // STRIP every real customer from the token. The union is wrong only in the harmless direction.
  const gap = triggerCapGap({ accounts: ["realclient", "generic"], roster: ["generic", "demofixture"] });
  nonEmpty(gap.uncovered, "the arm would prove nothing — this case must have a gap");
  assert.ok(gap.union.includes("realclient"),
    "the suggested cap drops an account the token already had — following it would break a live deployment");
  for (const k of ["generic", "demofixture", "realclient"]) assert.ok(gap.union.includes(k), `${k} missing from the union`);
  assert.match(triggerCapWarning(gap), /union of the current cap and the roster — check it before using it/,
    "the warning stopped telling the reader the suggestion is a union to check");
});

test("the portal still warns at boot, through the shared answer rather than its own copy", () => {
  const src = readFileSync(join(ROOT, "driver", "portal-service.mjs"), "utf8");
  assert.match(src, /triggerCapGap\(\{ accounts: posture\.accounts, roster \}\)/,
    "the portal computes the gap itself again — three surfaces, three opinions");
  assert.match(src, /triggerCapWarning\(\{ uncovered, union \}\)/, "the portal no longer speaks the shared sentence");
});

test("`brandowner add` says it where the person is looking, and never dies of it", () => {
  const src = readFileSync(join(ROOT, "bin", "brandowner.mjs"), "utf8");
  assert.match(src, /triggerCapGap/, "creating an account no longer checks whether the portal can start it");
  assert.match(src, /NOT YET STARTABLE/, "the warning has no heading a reader's eye can catch");
  // NEVER FATAL. The bundle is written and correct; what is stale is a credential elsewhere. Exiting
  // non-zero here would leave a written bundle behind a failed command, which is worse than the defect.
  // SCOPED TO THE CHECK'S OWN BLOCK, not to a window around it: this file legitimately exits and
  // refuses elsewhere — before anything is written — and an arm that swept those in would be asserting
  // something it does not mean while looking strict.
  const from = src.lastIndexOf("try {", src.indexOf("const { opsTokenPosture }"));
  const to = src.indexOf("return { written: true", from);
  assert.ok(from > 0 && to > from, "the check's block moved; this arm can no longer see it");
  const block = src.slice(from, to);
  assert.match(block, /NOT YET STARTABLE/, "the arm sliced the wrong block");
  assert.doesNotMatch(block, /process\.exit|throw new Refusal/,
    "the check can fail the command — a written bundle behind a non-zero exit is a worse state than the one being reported");
});
