# examples

The two input files you copy. Nothing here needs a credential and nothing here contacts anything.

| Path | What it is |
|---|---|
| `job.euipo.json` | the whole input contract for one clearance — 14 fields, ready to copy and edit |
| `grants.example.json` | who may read which account's runs: three tenants, three grant shapes |

## The finished runs moved to `demo/`

They used to sit here as `sample-run/`. The owner's 2026-08-29 ruling asked for one term — **demo** —
and one frozen run per product type, so they live in [`../demo/`](../demo/) now, each in a directory
named by the product id that produced it.

`npx clearotron demo` (`bin/example.mjs`) replays one of them through the ordinary publisher into a
local pool and serves it over loopback: no model, no register, no network. `--product <id>` picks one;
with nothing given it takes the first. The installed portal seeds its archive from the same container,
so a demo added there appears in both places with no code change.

Nothing under a `demo/<product-id>/run/` directory may be hand-edited. Several driver tests read files
straight out of it and more cite it as the delivered specimen they were written against, so an edit
surfaces as a failing test rather than as a wrong report.

`grants.example.json` is loaded by `mcp-server/test/grants.test.mjs` through the real loader
(`loadGrants` in `shared/scope.mjs`) and asserted to grant what it looks like it grants — `../INSTALL.md`
§8 tells an installer to copy this file, and a row that silently resolves to nothing means an empty
world on their first sign-in. **Read it as a shape, not as a starting roster.** Most of the accounts it
names — `aurora`, `zephyr`, `petcary` — are fixtures the test suite reads and are not part of the
published package; the one a fresh install actually has is `demo-brand-owner`. Replace the names with
your own accounts and keep the shapes: a tenant with every account, a tenant with one, a tenant whose
users see different subsets.

`job.euipo.json` is what `bin/onboard.mjs` prints as the first real clearance to run. That command
spends money and takes hours; [`../docs/INTAKE.md`](../docs/INTAKE.md) is the field-by-field reference,
including what each omission means.

## Invented mark, real evidence

The candidate mark VENQORI does not exist, and the two input files name nobody real — every address in
them is an `example.com` or `.example` placeholder. The evidence is the opposite, deliberately:
`../demo/<product-id>/run/_records/` holds real EUIPO records, and the report and `common-law-grid.json`
carry the real owners, URLs and contact details the searches actually returned. That is the technique to copy — a
fictional mark searched against real public register data, so the conflicts are true and only the
candidate is made up. Scrubbing them would falsify the evidence the sample exists to be checked against;
One name here fires the client-identifier guard; it is carried in the vetted-identities record
with the reason it stays.

## Where to start

[`../demo/global-preliminary-search/run/report.md`](../demo/global-preliminary-search/run/report.md) —
what a client receives. The front matter carries the overall label and the coverage line; the body opens
with Actions, then the findings behind them. `run/audit.md` beside it is the same run seen as evidence,
finding by finding.

`job.euipo.json` — the input side, short enough to read whole in one screen.

Each demo carries its own `PROVENANCE.md` saying how that run was frozen, what was dropped, and how to
regenerate the directory with `scripts/freeze-example-run.mjs`.
