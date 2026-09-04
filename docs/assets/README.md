# docs/assets — the images the documentation embeds

Committed artifacts, not generated at build time. A docs build cannot assume a headless browser or a
demo publish, so every picture the README shows is a file in this directory and its provenance is
written down here rather than left in a commit message.

| File | What it is | Where it comes from |
|---|---|---|
| `clearotron-banner-light.svg` | The README masthead, light scheme | Hand-made brand source |
| `clearotron-banner-dark.svg` | The same masthead for `prefers-color-scheme: dark` | Hand-made brand source |
| `portal-clearance-report.jpg` | A finished clearance report — verdict, risk band, the four answers | Portal screenshot |
| `portal-conflict-landscape.jpg` | Findings placed by mark similarity against goods proximity, with rights-holders by jurisdiction | Portal screenshot |
| `portal-new-clearance.png` | The intake screen — classes, marketplaces, search depth | Portal screenshot |

## Two things worth knowing before changing anything here

**The README's pictures are pinned by a test.** It asserts each one exists, carries the signature bytes
of the type its name claims, is a plausible screenshot size, and is embedded in `README.md` in the
markdown image form. Rename a file without updating the README and that arm fails, rather than the page
quietly showing a hole.

**A picture the README embeds must be one that travels with the documentation.** Embedding one that does
not produces a page whose image cannot load — a defect that shipped here once already, and one the test
above now asserts against directly rather than leaving to review.

## Adding one

Put the file here, embed it in the document that needs it, and add a row above. A new image **type**
needs one more step: the suite has a guard that treats every tracked file as source and fails on a NUL
byte, so an unfamiliar extension has to be declared as binary there — and that guard makes each
exemption earn itself in both directions, so declaring one for a type nothing uses fails too.
