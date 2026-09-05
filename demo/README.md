# demo

One finished clearance per product type, frozen and replayable with no credential, no model call and no
network. This is what `clearotron demo` shows you, and what a fresh install seeds its archive from.

| Path | What it is |
|---|---|
| `knockout-search/` | a Knockout search — the fast first look, one band per mark |
| `global-preliminary-search/` | a Global preliminary search — worldwide, one mark |
| `multi-country-focus-search/` | a Multi-country focus search — a chosen set of countries in depth |
| `full-country-search/` | a Full country search — the deepest single-country read |

One per product the engine sells, so a reader can see what each one actually produces rather than being
told. They are real runs of different shapes, not four renderings of the same one — the knockout demo
carries no `report.md` at all, because for that lane the markdown is an output of publishing rather than
an input to it.

Each directory is named by the product that produced it — the id in the run's own frozen search policy,
not a label chosen afterwards. `clearotron demo` replays the first; `clearotron demo --product <id>`
replays a named one; `clearotron demo --run-dir <dir>` replays any frozen run from anywhere.

## The marks are invented; the data behind them is real

The runs are for a fictional mark. They were executed against the live registers, so every number, band
and citation is genuine engine output — which is the point, and also why nothing under a
`<product-id>/run/` directory may be hand-edited. Driver tests read these files directly and more cite
them as the delivered specimen they were written against, so an edit surfaces as a failing test rather
than as a wrong report.

## What is inside one

`<product-id>/run/` is the frozen run itself — the subset of a finished run's directory that
`publishReport` reads, and nothing else. Two of its subdirectories have no README of their own because
they are machine output with a fixed shape, described here instead:

- `<product-id>/run/_driver/` — the driver's own records for that run: the verdict, the register plan,
  the search policy, the receipts, the pre-delivery lint. These are what the report is assembled from
  and what the audit surfaces read.
- `<product-id>/run/_records/` — the register records the run actually retrieved, one file per record,
  named by register and number. Real EUIPO records for a fictional mark.

`<product-id>/PROVENANCE.md` says how each run was frozen, what was dropped, and how to regenerate it.

## Adding one

`node scripts/freeze-example-run.mjs --run-dir <a finished run> --out demo/<product-id>` — the run's
identity is renamed on the way in, so a frozen demo never carries the codename it was born with. Both
readers pick it up with no code change: `clearotron demo --product <id>`, and the installed portal,
which seeds every complete child it finds here.
