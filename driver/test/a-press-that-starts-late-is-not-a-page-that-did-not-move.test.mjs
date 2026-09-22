// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PRESS THAT STARTS LATE IS NOT A PAGE THAT DID NOT MOVE.
//
// The report's section strip is measured in a real browser: one entry is pressed and the page must jump.
// The jump is animated and begins on the browser's own schedule, so the check waited for the scroll
// position to stop changing — two reads that agree, and the second is the answer. Two reads agree just
// as well BEFORE the animation starts as after it ends, so a scroll that had not yet begun was reported
// as a page that never moved. It failed once in continuous integration on a range that touched no part
// of that page and passed on re-run with nothing changed.
//
// The wait now holds until the position CHANGES, with a deadline, and only then for it to settle. The
// first arm drives the sequence that separates the two shapes: under the old one it reads as still.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrollAfterPress, MOVE_DEADLINE_MS } from "../../shared/scroll-settle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// A clock the injected wait advances, so every deadline below is exact and no arm sleeps.
const clock = () => {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; } };
};
// Reads the positions given, in order, and holds at the last one — a page comes to rest and stays there.
const reader = (positions) => {
  let i = 0;
  const seen = () => i;
  return { read: async () => positions[Math.min(i++, positions.length - 1)], seen };
};

// THE SHAPE THIS REPLACES, kept here because an arm that cannot fail against the old code proves
// nothing about the new. It stops as soon as two reads agree, whether or not anything has happened yet.
const settleOnly = async ({ read, wait, from }) => {
  let settled = from, last = -1;
  for (let i = 0; i < 40 && settled !== last; i++) { last = settled; await wait(150); settled = await read(); }
  return settled;
};

test("a jump that has not begun by the first read is waited out, where the old shape called it still", async () => {
  // The press lands, three reads find the page where it was, then the animation runs and comes to rest.
  const LATE = [0, 0, 0, 180, 420, 610, 700, 700];
  const { now, wait } = clock();
  const { read } = reader(LATE);
  const out = await scrollAfterPress({ read, wait, from: 0, now });
  assert.equal(out.moved, true, "a scroll that started late reads as a page that never moved");
  assert.equal(out.y, 700, "the position was taken mid-animation, not where the page came to rest");

  // THE CONTROL: the same sequence, the same reads, under the shape that produced the failure.
  const old = await settleOnly({ read: reader(LATE).read, wait: clock().wait, from: 0 });
  assert.equal(old, 0, "the old shape no longer answers 'still' here, so this arm no longer separates the two");
});

test("a page that truly does not move is given the deadline, and says how long it was given", async () => {
  const { now, wait } = clock();
  const { read, seen } = reader([0]);
  const out = await scrollAfterPress({ read, wait, from: 0, now });
  assert.equal(out.moved, false);
  assert.equal(out.y, 0);
  assert.ok(out.waitedMs >= MOVE_DEADLINE_MS, `gave up after ${out.waitedMs}ms, short of the ${MOVE_DEADLINE_MS}ms deadline`);
  assert.ok(seen() > 20, `the page was read ${seen()} time(s) — a single read cannot tell still from not yet`);
});

test("the answer is where the page came to rest, and a long animation is not cut short", async () => {
  const { now, wait } = clock();
  const climbing = Array.from({ length: 30 }, (_, i) => (i + 1) * 40);
  const { read } = reader([...climbing, 1200, 1200]);
  const out = await scrollAfterPress({ read, wait, from: 0, now });
  assert.equal(out.moved, true);
  assert.equal(out.y, 1200, "the wait returned a position the page was still moving through");
});

test("a page that moves upward is movement too — the direction is the caller's question, not the wait's", async () => {
  const { now, wait } = clock();
  const { read } = reader([900, 400, 0, 0]);
  const out = await scrollAfterPress({ read, wait, from: 900, now });
  assert.equal(out.moved, true);
  assert.equal(out.y, 0);
});

// A BEHAVIOURAL ARM CANNOT STOP THE DEFECT COMING BACK AT THE CALL SITE, which is where it was written
// the first time: the helper above stays correct while a fresh two-read loop is inlined beside it. The
// scan reads code only — this file's own prose names the shape it forbids, and a scan that reads
// comments is tripped by writing about the defect rather than by the defect.
test("the press in the sections check is measured through the wait, not by two reads of its own", () => {
  const SCRIPT = "scripts/report-sections-render-check.mjs";
  const code = readFileSync(join(ROOT, SCRIPT), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(code, /scrollAfterPress\(\{\s*read:/, `${SCRIPT}: the press no longer goes through the wait`);
  const inlined = code.split("\n").find((l) => /settled\s*!==\s*last|last\s*!==\s*settled/.test(l));
  assert.equal(inlined, undefined, `${SCRIPT}: a settle-only loop is back at a call site — ${String(inlined).trim()}`);
});
