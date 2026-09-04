// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A DEAD-CLAIMER FIXTURE MUST BE DEAD FOR A REASON THE PRODUCT CAN CHECK.
//
// Two arms in runner.crash-identity failed intermittently on CI and passed on re-run. The mechanism is
// not timing: the fixtures wrote `String(await deadPid())`, a LEGACY BARE-PID sidecar, and
// `claimerIsAlive`'s bare-pid branch has no birth stamp to compare — so it answers ALIVE for any pid
// that happens to answer `kill(pid, 0)`. The arm then reads `IN FLIGHT`, the job is never consumed,
// and `consumed as .done` fails.
//
// Nothing about that needs load. The forced arm below reproduces it deliberately, which is what turns
// a flake into a test: a loaded box can never become one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimerIsAlive, parseClaimSidecar, procStarttime } from "../claim-liveness.mjs";
import { deadClaimToken, PROC_GATE } from "./claim-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("#1808 the forced condition: a bare-pid sidecar cannot tell a dead claimer from whoever holds that pid now", PROC_GATE, () => {
  // process.pid stands in for the pid AFTER it was reissued — by a wrap of pid_max, or by another
  // user's process on a shared runner (kill raises EPERM there, which counts as ALIVE by design).
  const reissued = process.pid;

  assert.equal(claimerIsAlive(parseClaimSidecar(String(reissued))), true,
    "THE DEFECT: a bare-pid sidecar reads ALIVE once anything holds that pid — this is the flake");

  const authentic = procStarttime(reissued);
  assert.notEqual(authentic, null, "this arm needs a readable birth stamp; PROC_GATE should have skipped it");
  assert.equal(claimerIsAlive(parseClaimSidecar(`${reissued}:${Number(authentic) - 4242}`)), false,
    "THE CURE: with a birth stamp the mismatch is POSITIVE evidence the claimer died");

  // And the cure must not overreach: the pid's OWN stamp still reads alive, or a live claim would be
  // stolen and a billable search would run twice.
  assert.equal(claimerIsAlive(parseClaimSidecar(`${reissued}:${authentic}`)), true,
    "a genuinely live claimer must still read ALIVE");
});

test("#1808 deadClaimToken stamps a birth stamp, and the claim it writes reads dead", PROC_GATE, async () => {
  const tok = await deadClaimToken();
  assert.match(tok, /^\d+:\S+$/, "the fixture stamps pid+starttime, not a bare pid");
  assert.equal(claimerIsAlive(parseClaimSidecar(tok)), false,
    "a claimer that has died reads dead — whoever holds its pid number now");
});

test("#1808 no test builds a dead-claimer sidecar from a bare pid", () => {
  // The scan is what fails closed. The behavioural arms above prove the helper is right TODAY; only a
  // scan stops the next fixture from reintroducing the shape, and that is how this defect arrived —
  // cured it in one file and three others kept their own copy for two months.
  const offenders = [];
  // — the CORPUS is asserted before it is walked. An empty read here would report zero offenders
  // and pass, which is the state this scan exists to distinguish from "there are none".
  const corpus = readdirSync(HERE).filter((n) => n.endsWith(".test.mjs"));
  assert.ok(corpus.length > 20, `only ${corpus.length} test file(s) discovered — the scan read nothing`);
  for (const f of corpus) {
    const body = readFileSync(join(HERE, f), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    // `String(await <anything>Pid())` is the shape: a real pid, stringified, with no birth stamp.
    for (const m of body.match(/String\(await \w*[Pp]id\(\)\)/g) ?? []) offenders.push(`${f}: ${m}`);
  }
  assert.deepEqual(offenders, [], `bare-pid dead-claimer sidecars: ${offenders.join(", ")}`);
});

test("#1808 the dead-claimer fixture has exactly one definition", () => {
  const defs = readdirSync(HERE)
    .filter((n) => n.endsWith(".mjs"))
    .filter((n) => /(^|\n)\s*(export )?async function deadClaimToken\b/.test(readFileSync(join(HERE, n), "utf8")));
  assert.deepEqual(defs, ["claim-fixtures.mjs"],
    `deadClaimToken is defined in ${defs.length} file(s) — four copies of this fixture is how #665's cure went unpropagated`);
});