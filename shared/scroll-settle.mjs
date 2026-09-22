// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scroll-settle.mjs — after a press, wait for the page to START moving, then for it to STOP.
//
// ── WHY A SETTLE WAIT ALONE IS NOT ENOUGH, WHICH IS THE WHOLE POINT ──────────────────────────────
//
// A check that presses something and reads the scroll position wants the position the page came to
// rest at. The obvious shape reads twice and stops when two reads agree:
//
//     let settled = before, last = -1
//     for (let i = 0; i < 40 && settled !== last; i++) { last = settled; await wait(150); settled = await read() }
//
// That is a settle detector, and it cannot tell a page that has STOPPED from one that has not STARTED.
// A smooth scroll begins on the browser's own schedule; when it has not begun by the first read, the
// first two reads are both the position before the press, they agree, the loop ends, and the caller is
// told the page never moved. The page then moves, a moment after nobody is looking.
//
// This failed once in continuous integration on a branch whose range touched no part of that page, and
// passed on re-run with nothing changed — the signature of a measurement that races the thing it
// measures rather than a defect in the page.
//
// So the wait is in two parts, and only the first is new: hold until the position CHANGES, giving up at
// a deadline; then hold until it stops changing. A page that does not move is now told apart from one
// that has not moved yet by how long it was given — which is why the deadline is returned, for the
// caller to name in its failure. A caller that says only "it did not move" leaves the next reader
// unable to tell a real defect from this race.
//
// PURE, with the read and the clock injected, so a test drives every path without a browser: a wait
// that can only be exercised against a real renderer cannot be shown to fail.

// Long enough that a scroll which has not begun by then is not merely late. The press is animated, so
// this is a deadline for the FIRST movement, never for the whole journey — the settle below carries that.
export const MOVE_DEADLINE_MS = 4000;
const STEP_MS = 150;
const QUIET_STEPS = 40;

/**
 * Wait for a press to move the page, then for the movement to stop.
 *
 * @param {object} o
 * @param {() => Promise<number|null>} o.read     reads the scroll position now
 * @param {(ms: number) => Promise<void>} o.wait  sleeps
 * @param {number} o.from                         the position before the press
 * @param {() => number} [o.now]                  the clock the deadline is measured on
 * @returns {Promise<{moved: boolean, y: number|null, waitedMs: number}>}
 *   `moved` false means the position never changed within `waitedMs` — the page was given that long.
 */
export async function scrollAfterPress({ read, wait, from, now = Date.now,
  deadlineMs = MOVE_DEADLINE_MS, stepMs = STEP_MS, quietSteps = QUIET_STEPS }) {
  const started = now();
  let y = from;
  // FIRST, THAT IT MOVED AT ALL. The deadline is what makes the answer below a finding rather than a race.
  while (y === from) {
    if (now() - started >= deadlineMs) return { moved: false, y, waitedMs: now() - started };
    await wait(stepMs);
    y = await read();
  }
  // THEN, WHERE IT CAME TO REST. `last` starts at a value no read returns, so the position is always
  // read at least once more: the first changed position is mid-animation, not the answer.
  let last = null;
  for (let i = 0; i < quietSteps && y !== last; i++) {
    last = y;
    await wait(stepMs);
    y = await read();
  }
  return { moved: true, y, waitedMs: now() - started };
}
