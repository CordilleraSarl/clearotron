# shared/tools/

Two generators for the brand system. Neither is imported by anything; both are run.

| File | How it is run | What it does |
|---|---|---|
| `emit-tokens.mjs` | `npm run tokens`, `npm run tokens:check` | Writes the portal's generated token stylesheet and its generated logo module, or verifies them. |
| `derive-band-pairs.mjs` | `node shared/tools/derive-band-pairs.mjs` | Prints the risk-ramp companion values derived from the designer's five base hexes. A working note with a runtime. |

## The chain

`../brand.mjs` holds the hexes. `../portal-tokens.mjs` reads them and re-exports the same colours under
the portal's semantic names. `emit-tokens.mjs` renders that into `portal-ui/src/tokens.css`. So a colour
change is one edit in `brand.mjs` plus one `npm run tokens`; the generated file has no second copy to
remember, and a hand-pasted hex is what that arrangement exists to prevent.

It also emitted the ridge mark's path data into `portal-ui/src/brand-art.ts` until. Nothing this
product renders draws the ridge, so the module, its generator and its staleness check went together.

The band ramp is the exception, and it is guarded rather than generated. `driver/publish/render.mjs`'s
quadrant panel hardcodes the light ramp's `--med` and `--clear`, because that panel stays a fixed light
surface in dark mode and so cannot read tokens that flip; `driver/publish/templates/report.css` carries
the gauge marker's glow as the same colour in decimal `rgba()`, where a hex grep will not find
it. `driver/test/brand.test.mjs` fails when either drifts off the tokens — so a recolour that edits
`brand.mjs` and runs `npm run tokens` alone gets a red suite, not a finished recolour.

`npm run tokens:check` writes nothing and is what CI runs. It fails when either generated file is stale,
and it asserts one thing more: that `portal-ui/index.html` carries `PRE_PAINT_SCRIPT` verbatim, and that
the built portal's entry document still does. That inline script has to run before first paint or a
dark-mode reader gets a white flash, so the SPA's CSP admits it by `sha256-` hash computed from the same
exported constant. If the file drifts, or the build rewrites the script, the CSP blocks it silently and
everyone who chose dark first-paints light.

`derive-band-pairs.mjs` validates its own rule before applying it: it re-derives the previously shipped
soft/text pairs from the previously shipped bases and prints the comparison, on the grounds that a rule
which reproduces the old pairs is a rule that expresses the original intent. The values it prints are
pasted into `brand.mjs`, where `driver/test/brand.test.mjs` pins them.

## Where to start

`emit-tokens.mjs`. It is 113 lines, and its `--check` branch is the clearest statement anywhere of what
the generated files are allowed to be.
