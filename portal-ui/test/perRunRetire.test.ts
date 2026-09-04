// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// criterion 1 — retire acts on ONE read, from that read's own row.
//
// The owner's words: "i can only retire ALL runs under that grouped name not individual runs." The
// transport was never the obstacle. `setRetired` has taken a `runIds` ARRAY in both directions since
//, and `restoreRun` has always passed exactly one — so the pool could already retire a single run
// and the screen could already restore one. What was missing was a place to click: retire was bound to
// the MarkGroup while its own inverse was bound to the Run, which is not a coherent pair.
//
// WHY THIS IS A SOURCE-TEXT TEST. Stated up front so nobody replaces it with a weaker thing thinking
// they are modernising it: this package runs `node --test` over `.test.ts` with Node's built-in type
// stripping and carries no jsdom and no React test renderer. Node cannot import `.tsx` at all — no JSX
// transform, the import fails with "Unknown file extension .tsx" — so a test in this runner cannot
// mount the screen. screenCopy.test.ts and no-danger.test.ts established reading the source for exactly
// this reason and this file follows them.
//
// The limit is real and worth naming rather than papering over: these assertions prove a shape is
// present in a file. They do not prove it reaches the browser. What they DO catch is each regression
// this issue was filed for, and every one of them is an edit a reviewer makes in good faith.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/Clearances.tsx', import.meta.url)), 'utf8')

// Comment lines out. This file's own commentary quotes the very shapes it is asserting — the paragraph
// above says `runIds: [run.runId]` — so a naive search over the whole file matches the explanation and
// passes on a screen that never got the control. Same helper, same reason, as screenCopy.test.ts.
const body = SRC.split('\n')
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n')

test('#1254 a per-READ retire exists and sends exactly one run id', () => {
  // THE OBSERVED SHAPE, not a reconstruction of it. The issue quotes the defect as `retireMark` mapping
  // `mark.reads` to run ids with no single-run path beside it, so what is pinned is the single-run path:
  // a handler taking a Run and sending a one-element array. `retireMark`'s own array-over-reads stays —
  // criterion 1 says the group act remains available, so its absence would be a different defect.
  assert.match(body, /const retireRun = async \(run: Run\) =>/, 'a retire handler bound to ONE run')
  const fn = body.slice(body.indexOf('const retireRun'))
  assert.match(
    fn.slice(0, fn.indexOf('\n  const ')),
    /api\.setRetired\(\{ action: 'retire', runIds: \[run\.runId\] \}\)/,
    "and it sends that one run's id — not every read of its name",
  )
})

test('#1254 the control is ON the read row, and the read row is what renders it', () => {
  // Reaching the handler is half of it. The gap the issue actually opened with is that a per-run action
  // had no per-run place to click, so the button has to be in ReadRow — asserting only that the handler
  // exists would pass on a screen where nothing calls it.
  const readRow = body.slice(body.indexOf('function ReadRow('))
  assert.match(readRow, /readonly onRetire\?: \(\(run: Run\) => void\) \| undefined/, 'ReadRow takes a per-run retire')
  assert.match(readRow, /onRetire\(read\)/, 'and a control on the read row calls it with THAT read')
})

test('#1254 the nested control stops the row it sits inside — both handlers, not just the click', () => {
  // THE ONE THAT WOULD SURVIVE REVIEW. The read row is a `role="link"` carrying an onClick AND an
  // onKeyDown that opens the report on Enter or Space. A Retire that stops only the pointer works when
  // you click it and, for a keyboard user, retires the read and then navigates away from the screen
  // that would have shown it worked — an intermittent bug that looks like the save failing.
  const readRow = body.slice(body.indexOf('function ReadRow('))
  const btn = readRow.slice(readRow.indexOf('onRetire ? ('))
  const decl = btn.slice(0, btn.indexOf('</button>'))
  assert.match(decl, /onClick=\{\(e\) => \{\s*\n\s*e\.stopPropagation\(\)/, 'the click does not reach the row')
  assert.match(decl, /onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/, 'and neither does Enter or Space')
})

test('#1254 the two retires do not both read "Retire" on a threaded name', () => {
  // Two adjacent controls with one word between them, one taking the whole name and one taking a single
  // read, is the ambiguity the issue opened with restated as a UI rather than removed. Criterion 1 asks
  // for the group act to stay "clearly-labelled", which is a claim about the label and testable as one.
  assert.match(body, /threaded \? `Retire all \$\{mark\.reads\.length\}` : 'Retire'/, 'the group control says how many it takes')
})

test('#1254 both retires are gated by the SAME capability expression', () => {
  // 's rule: absent ⇒ no control, so a client view cannot grow a curation act by accident. A second
  // gate written independently is how the two come to disagree about who may curate — the per-run act
  // is the more granular one, so a drift here hands a client the finer control, not the coarser.
  const pairs = body.match(/onRetire=\{canGroup \? retireMark : undefined\}\s*\n\s*onRetireRun=\{canGroup \? retireRun : undefined\}/g) ?? []
  assert.equal(pairs.length, 2, 'both MarkRow call sites gate the pair on canGroup, together')
  assert.doesNotMatch(body, /onRetireRun=\{(?!canGroup \? retireRun : undefined|onRetireRun)/, 'and nothing hands it out on a different condition')
})

// ── criterion 5: failed runs come off the screen, and stay findable ──────────────────────────────
//
// Owner ruling, relayed on the issue: "Failed runs on clearance screen - no." The build shape is
// removal from the default view; the placement of their remaining home was left to the builder.

test('#1254 c5 a failed name is filtered out by the MARK, not by the read', () => {
  // The unit matters and is the whole design decision. Filtering failed READS would rewrite history
  // inside every surviving thread and silently promote an older read to `current`, so a name would
  // show a standing it does not have. The owner objected to a ROW whose status said failed.
  assert.match(
    body,
    /marksOf\(filtered, families\)\.filter\(\(m\) => \(filter === 'failed'\) === \(m\.current\.state === 'failed'\)\)/,
    'the mark is judged on the read it speaks for, and the same expression drives both directions',
  )
})

test('#1254 c5 the failed names keep exactly one route in', () => {
  // A removal with no route back is the thing this file's own rule calls worse than the defect: "a run
  // that silently disappears from the list is worse than one that says it stopped." The tab IS the
  // route, so its absence would turn a ruling about tidiness into data loss from the user's side.
  assert.match(body, /\['failed', failedCount \? `Failed \(\$\{failedCount\}\)` : 'Failed'\]/, 'a Failed tab, labelled with its count')
  assert.match(body, /type Filter = 'all' \| 'progress' \| 'finished' \| 'failed'/, "and 'failed' is a real member of the filter, not a string that happens to match nothing")
})

test('#1254 c5 `failed` stays in TERMINAL, or the older bug comes back', () => {
  // The tempting shortcut is to drop `failed` from TERMINAL and let the existing tabs do the work. That
  // reopens the bug the Finished comment was written to close: a failed run would no longer be terminal,
  // so "In progress" would show it forever and the list would poll for a run that is never coming back.
  assert.match(body, /const TERMINAL = new Set<Run\['state'\]>\(\['delivered', 'failed', 'cancelled'\]\)/, 'failed is still terminal')
})

test('#1254 c5 cancelled is NOT swept up with failed', () => {
  // The ruling names failed. A cancelled run was stopped by someone on purpose and nobody asked for it
  // to disappear — over-applying a removal hides things no one chose to hide.
  assert.doesNotMatch(body, /m\.current\.state === 'cancelled'/, 'no mark-level filter takes cancelled off the screen')
})
