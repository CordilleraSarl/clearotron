---
"clearotron-driver": minor
---

New: Searching by judgment.

This release changes how a clearance decides what to search. Until now the engine followed fixed rules: a set number of spellings, a fixed list of stores, a stop after the first identical mark. Fixed rules are fast and cheap, but they miss things. On a recent matter, a lawyer's review found marks the engine had counted but never read, and others it had raised that did not matter.

So the approach changes. Wherever the engine holds a pile of results, it now looks at what is there and decides what a lawyer would raise. It carries that forward and writes down what it set aside, and why. Nothing is dropped silently. Every wider search, every spelling set aside and every store left out appears in the audit workbook with its reason.

What you will notice:
- Searches widen where it could change the advice, and narrow where it cannot.
- Near spellings no buyer would confuse with the mark are set aside, with the reason recorded.
- Searches in other scripts run only in markets that file marks in that script.
- A large company's register is read for the marks that share the searched name. The rest is counted, not fetched.
- Marketplace searches cover the stores that sell the client's goods, and say which stores were left out and why.
- The report no longer opens with the internal reviewer's notes. They reach the reviewing lawyer separately.
- A large marketplace search no longer fails because its results were too big to return in one piece.
- Where a company's framework rates through named inputs, the report shows them beside each band.

A word on regressions. While testing this line we found two. A crowded search failed before delivering its report, and a knockout's ratings moved one step away from the lawyer's. Both were caught by running the same matters against a lawyer's answers, and both are fixed here. Every build is now tested that way before it ships. We are tuning for three things at once: a report that is right the first time, delivered fast, at a sensible cost. They pull against each other, and each release is our best current balance.
