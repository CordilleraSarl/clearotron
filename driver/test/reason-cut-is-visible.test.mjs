// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reason-cut-is-visible.test.mjs —: every writer of status.reason says when it cut one.
//
// built the mechanism and applied it to the two terminal writes in the pipelines: `reason` capped
// at 200 because it rides the ping, `reasonTruncated` on every terminal failure true or false, and
// `reasonFull` holding the tail. Its header says why the cap cannot simply be widened — it is
// load-bearing for the ping, and "the next message longer than whatever number replaced it would reopen
// this silently".
//
// FOUR OTHER WRITERS NEVER GOT IT, and they are the ones this closes. Each cut a reason to 200 with a
// bare `.slice` and wrote no companion keys, so on those paths the defect fixed was still live:
//
//   runner pre-run          a job that dies before the pipeline starts
//   runner self-resume      a resume that errored past its re-park cap
//   runner queue-reclaim    a crash-reclaim that exhausted its cap — and its reason NAMES THE ARTIFACT
//                           DIRECTORY at the very end, which is exactly what a 200-char cut destroys
//   pipeline recovering     the PARKED state, which is the one a reader diagnoses from status.json alone
//
// WHY IT IS ASSERTED ON THE SOURCE. These four sit inside long runner/pipeline paths that need a claimed
// queue, an agent workspace and a live pipeline to reach; the offline suite drives that end to end in
// pipeline.anthropic.test.mjs and it does not cover these four branches. So the claim made here is the
// one that can be made honestly: every writer of a terminal or parked `reason` goes through the one
// function, and none of them cuts with a bare slice. That is a weaker statement than "the field is
// right on disk" and it is stated as such rather than dressed up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { terminalReasonFields } from "../pipeline.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
// Non-comment lines only: these files discuss `.slice(0, 200)` at length in prose, and counting a
// comment as a writer would make an unfixed file look fixed — the inversion this repo keeps paying for.
const code = (f) => read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("#1064 the mechanism itself: a cut is stated, and the tail is kept", () => {
  const long = `${"x".repeat(260)} — the evidence is at _driver/reviewer-flags.json`;
  const r = terminalReasonFields(long);
  assert.equal(r.reason.length, 200);
  assert.equal(r.reasonTruncated, true, "the cut must be STATED, never inferred from a missing key");
  assert.ok(r.reasonFull.includes("_driver/reviewer-flags.json"),
    "the pointer past the cut is what #1064 was filed about — it has to survive somewhere in status.json");
});

test("#1064 a short reason says NOTHING WAS CUT, rather than saying nothing", () => {
  const r = terminalReasonFields("provider refused the count probe");
  assert.equal(r.reasonTruncated, false, "false and absent are different facts — #755's own argument");
  assert.equal(r.reasonFull, null, "and there is no tail to keep, which is not the same as a lost one");
});

// ── the four writers that never got it ──────────────────────────────────────────────────────────────

test("#1064 NO writer of a terminal or parked reason cuts with a bare slice", () => {
  const offenders = [];
  // SCOPED TO status.json, deliberately. These files slice at 200 in plenty of other places — a
  // provider cause on a call record, an `unsupported_reason` on a dropped variant, an audit detail —
  // and none of those is `status.reason`. is about the ONE field a diagnosing agent is sent to,
  // so the window below requires a status write within three lines of the cut. A broader sweep would
  // redden on unrelated records and get relaxed by the next person who hit it, which is worse than a
  // narrow guard that holds.
  const STATUS_WRITE = /writeRunStatus\(|state:\s*"(failed|recovering)"|"status\.json"/;
  for (const f of ["driver/runner.mjs", "driver/pipeline.mjs", "driver/pipeline-knockout.mjs"]) {
    const lines = code(f).split("\n");
    lines.forEach((line, i) => {
      if (!/\breason\w*\s*:\s*[^,]*\.slice\(0,\s*200\)/.test(line)) return;
      const window = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
      if (STATUS_WRITE.test(window)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    `these write a cut reason and say nothing about the cut:\n  ${offenders.join("\n  ")}\n\n`
    + `Route it through terminalReasonFields(reason) and write reason/reasonTruncated/reasonFull, as the `
    + `two pipeline terminals already do. Widening the 200 cap is NOT the fix — #755's header says why.`);
});

test("#1064 all four repaired sites use the ONE function, so they cannot drift from it", () => {
  const runner = code("driver/runner.mjs");
  assert.match(runner, /terminalReasonFields.*from "\.\/pipeline\.mjs"/,
    "the runner must take the shared function rather than growing its own copy of the rule");
  // pre-run, self-resume, queue-reclaim: three call sites in the runner.
  const calls = (runner.match(/terminalReasonFields\(/g) ?? []).length;
  assert.ok(calls >= 3, `only ${calls} terminalReasonFields call(s) in the runner — expected the three repaired writers`);
  assert.match(code("driver/pipeline.mjs"), /state: "recovering"[\s\S]{0,200}\.\.\.terminalReasonFields\(reason\)/,
    "the parked state is the one a reader diagnoses from status.json alone, and it must carry the fields too");
});

test("#1064 the three fields travel together — a writer carrying one and not the others is the same defect", () => {
  // reasonFull without reasonTruncated is unreadable (was it cut, or is the tail just absent?), and
  // reasonTruncated without reasonFull says a pointer was destroyed without keeping it.
  const runner = code("driver/runner.mjs");
  for (const m of runner.matchAll(/state: "failed"[^\n]*\n?[^\n]*/g)) {
    const seg = m[0];
    if (!/reason(?!Truncated|Full|Detail|Verbatim|Quantity|Text)\s*:/.test(seg)) continue;
    if (/reason:\s*null/.test(seg)) continue;                      // a cancel carries no reason at all
    assert.ok(/reasonTruncated/.test(seg) && /reasonFull/.test(seg),
      `a terminal status write carries a reason without saying whether it was cut:\n  ${seg.trim()}`);
  }
});
