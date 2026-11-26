# docs/assets — the images the documentation embeds

Committed artifacts, not generated at build time. A docs build cannot assume a headless browser or a
demo publish, so every picture the README shows is a file in this directory and its provenance is
written down here rather than left in a commit message.

| File | What it is | Where it comes from |
|---|---|---|
| `clearotron-banner-light.svg` | The README masthead, light scheme | Hand-made brand source |
| `clearotron-banner-dark.svg` | The same masthead for `prefers-color-scheme: dark` | Hand-made brand source |
| `portal-clearance-report.jpg` | A finished clearance report — verdict, risk band, the four answers | Clearotron 0.8.0, taken on its line before the first beta: `node scripts/readme-pictures.mjs` |
| `portal-conflict-landscape.jpg` | Findings placed by mark similarity against goods proximity, with rights-holders by jurisdiction | Clearotron 0.8.0, taken on its line before the first beta: `node scripts/readme-pictures.mjs` |
| `portal-new-clearance.png` | The intake screen — classes, marketplaces, search depth | Clearotron 0.8.0, taken on its line before the first beta: `node scripts/readme-pictures.mjs` |

## Two things worth knowing before changing anything here

**The README's pictures are pinned by a test.** It asserts each one exists, carries the signature bytes
of the type its name claims, is a plausible screenshot size, and is embedded in `README.md` in the
markdown image form. Rename a file without updating the README and that arm fails, rather than the page
quietly showing a hole.

**A picture the README embeds must be one that travels with the documentation.** Embedding one that does
not produces a page whose image cannot load — a defect that shipped here once already, and one the test
above now asserts against directly rather than leaving to review.

## Retaking the three portal pictures

`portal-new-clearance.png`, `portal-clearance-report.jpg` and `portal-conflict-landscape.jpg` show the
portal, so they go stale whenever it changes. One command retakes all three from this checkout's own demo:

```sh
npm run build:ui
node scripts/readme-pictures.mjs
```

It starts the demo in a throwaway home, signs in, and captures New clearance, the demo's Global
preliminary search report, and that report's conflict landscape. The captures are in the light theme at
1,332 × 778 CSS pixels and device scale 1.5. It writes over the three files here and prints the line for
the table above. Only the committed demo is on screen. Run it whenever a change alters one of those
screens or regenerates `demo/`, look at each picture before committing it, and never edit one by hand.

## Adding one

Put the file here, embed it in the document that needs it, and add a row above. A new image **type**
needs one more step: the suite has a guard that treats every tracked file as source and fails on a NUL
byte, so an unfamiliar extension has to be declared as binary there — and that guard makes each
exemption earn itself in both directions, so declaring one for a type nothing uses fails too.
