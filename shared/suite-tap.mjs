// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reading a `node --test` run's output well enough to say WHAT failed.
//
//. `scripts/publication-scan.mjs` ran the full suite, parsed the per-workspace `# fail N`
// counts, and reported `fail counts: 1, 0, 0` — never the `not ok` lines. The operator learned that
// one test failed and nothing about which, from a script whose entire argument is that "the scanner
// was missing" and "the scanner found nothing" must not produce the same silence. A failure that
// cannot say what failed is that silence one layer in: it answers in form and carries nothing anyone
// can act on. The information was in the same stdout that produced the counts.
//
// It cost a real diagnosis: the failure was the roster half of the identifier sweep — the SAME two
// hits the scan's own `retired identities` check reported four lines further down — and establishing
// that took a separate twenty-minute suite run.

const FAIL_COUNT = /^# fail (\d+)$/gm;
const NOT_OK = /^not ok \d+ - (.*)$/gm;

/** Per-workspace `# fail N` counts, in the order the run printed them. */
export const suiteFailCounts = (stdout) =>
  [...String(stdout ?? "").matchAll(FAIL_COUNT)].map((m) => Number(m[1]));

/** Every `not ok` line's test name, deduped, in order. */
export const suiteFailedTests = (stdout) => {
  const seen = new Set();
  for (const m of String(stdout ?? "").matchAll(NOT_OK)) {
    // `node --test` escapes `#` in names as `\#`; unescape so the reported name matches the source.
    const name = m[1].replace(/\\#/g, "#").trim();
    if (name) seen.add(name);
  }
  return [...seen];
};

/**
 * Did the run reach a verdict at all? A suite killed mid-flight prints no `# fail` line and no
 * failures — which reads exactly like a clean run to anything counting failures. Signals matter
 * enough to name: a run this box terminated (143 = SIGTERM) is not a result.
 */
export function suiteCompleted({ stdout, status, signal } = {}) {
  const counts = suiteFailCounts(stdout);
  if (!counts.length) {
    const why = signal ? `it was terminated by ${signal}`
      : typeof status === "number" && status > 128 ? `it was terminated by signal ${status - 128}`
      : "it did not run to completion";
    return { completed: false, counts, why };
  }
  return { completed: true, counts, why: null };
}

/**
 * The message a failing suite check reports. Names the tests; caps the list and SAYS what it dropped,
 * because a silent truncation reads as "that was all of them".
 */
export function summariseSuiteFailure({ stdout, status, signal, max = 20 } = {}) {
  const { completed, counts, why } = suiteCompleted({ stdout, status, signal });
  if (!completed) {
    return `npm run test:full produced no '# fail' line — ${why}. No failures were reported because `
      + "the run never reached a verdict, which is not the same as a run that found none.";
  }
  const named = suiteFailedTests(stdout);
  const head = `fail counts: ${counts.join(", ")}`;
  if (!named.length) {
    // Counts say something failed and no `not ok` line says what. Worth stating plainly rather than
    // printing the bare counts as before — it means the output is not the shape this parser expects.
    return `${head}\n    (no 'not ok' line was found in the output, so the failing test cannot be named — `
      + "the suite's output format may have changed)";
  }
  const shown = named.slice(0, max);
  const dropped = named.length - shown.length;
  return [`${head} — ${named.length} failing test(s):`,
    ...shown.map((n) => `      not ok  ${n}`),
    ...(dropped ? [`      … and ${dropped} more not listed`] : [])].join("\n");
}
