# shared/

Small pure leaves — one concern each, with `node:` builtins and their own siblings as the only imports.

They live here because of who needs them, not where they started. Each is read by more than one of
`driver/`, `driver/publish/`, `mcp-server/`, `providers/`, `bin/`, `scripts/` and the repo guards in
`driver/test/`, and `shared/` imports none of those — so a module here cannot make two trees depend on
each other.
`product-identity.mjs` is the worked example, in its own header: `driver/engine-build.mjs` already
resolves the running commit for artifact provenance, but it cannot be the shared source, because
`mcp-server/` would then import `driver/`.

## What each one owns

| Module | Owns |
|---|---|
| `env-local.mjs` | `<repo>/.env`, applied only when the running process is one of the eight paths in `CLI_ENTRIES` and never on a library import. The environment always wins over the file. |
| `brand.mjs` | The locked palette and fonts, and the ready-made `:root` blocks (`WARM_ROOT`, `REPORT_ROOT`) every emitted HTML surface drops in. Tenant name, tagline and product in `BRAND`. |
| `portal-tokens.mjs` | The portal's semantic token names, read out of `brand.mjs` rather than retyped — plus `PRE_PAINT_SCRIPT`, whose hash the SPA's CSP admits. |
| `product-identity.mjs` | Who this software is and which commit is answering: the AGPL §13 source offer, served by the running server and never baked into a bundle. |
| `withheld-paths.mjs` | `WITHHELD` — the paths that do not exist in the published tree, each with a publishable reason — and the declared exceptions that are allowed to cite one. |
| `tracked-files.mjs` | The tracked corpus the guards assert over, enumerated with `git ls-files`, and the loud marker-printing skip when there is no checkout to read it from. |
| `uspto-index-size.mjs` | The three US-index quantities kept apart: the download, the peak on disk, the finished index. `uspto-peak-disk.mjs` is the sampler that measures the peak while a build runs. |
| `scope.mjs` | The MCP server's inner authorization gate: what a principal may do, on which run. The HMAC-signed token carries `ops`, `user` or `account`; `internal` is the firm-staff principal that carries no token at all. |
| `listen.mjs` | The one place a bind failure becomes a sentence rather than a stack trace. |
| `driver-dir.mjs` | Where a run's `_driver/` is: the name, the path, and the one creation call. Product code no longer builds it by hand, so the directory's location — and one day its mode — is a decision in one place rather than a convention in 1123. |
| `site-nav.mjs`, `anon-overlay.mjs` | The single top nav shared by the internal staff pages, and the display-only overlay that masks client names and marks so those pages can be screen-shared. |
| `identifier-scan.mjs`, `identifier-blocklist.mjs`, `vetted-identities.mjs` | One matcher, one name table, one list of declared exceptions — shared by the guard that sweeps the tracked tree and the scan that sweeps the whole history. |

`brand/assets/` holds the vendored logo SVGs. `tools/` holds the two brand-system generators — see
[`tools/README.md`](tools/README.md).

## Where to start

`env-local.mjs` first: it is the rule the eight declared `CLI_ENTRIES` obey, and the exclusions are the
interesting half. `driver/portal-service.mjs` carries an argv[1] main gate and is deliberately off the
list, for the same reason it carries no EnvironmentFile in production — every value arrives named; and
`bin/onboard.mjs` imports the loader only to read a candidate file into a throwaway object, because a
wizard that had already applied the `.env` it is about to replace would report the old values as the
new ones. Its header explains, with the measurement, why it must be an import rather than a call.

Then `brand.mjs`, which is where the palette every rendered surface is built from lives. Two surfaces
carry the band ramp themselves rather than reading it: `driver/publish/render.mjs`'s quadrant panel and
the gauge glow in `driver/publish/templates/report.css`. Those duplicates are held in step by
`driver/test/brand.test.mjs` rather than generated away — see [`tools/README.md`](tools/README.md).
