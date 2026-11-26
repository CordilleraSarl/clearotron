# The demos as they shipped until 2026-11-22

Byte-for-byte copies of the four samples `demo/` carried before they were re-frozen from fresh runs on
2026-11-22, except that a few third-party page titles and one link in the common-law grids were
replaced with invented text on 2026-11-26. Tests that need what these captures held, and the fresh runs do not, read them here:

- ruled-out (off-field) finding cards, which the multi-country and full country captures carry;
- a Knockout with negative results;
- a full country case-law pass that kept no record and says its source was unavailable;
- a worldwide clearance whose audit lists register searches.

Each of `full-country-search/`, `global-preliminary-search/`, `knockout-search/` and `multi-country-focus-search/`
holds one capture: its `meta.json`, its `PROVENANCE.md` and the frozen `run/` that publishing reads.

`global-preliminary-search/run/_records/` is left out (13 MB): the tests that read that capture use its
workbook and report, not its record links.

They are not shipped and not replayed by `npx clearotron demo`. A test about the shipped samples reads
`demo/`.
