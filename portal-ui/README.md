# portal-ui

The browser half of the portal: a React 18 + Vite 6 single-page app in strict TypeScript, built to a static bundle
that is **committed to git** as `dist/`. It runs nothing — it reads and writes `/portal/...` on the service that
serves it.

| Path | What it is |
|---|---|
| `src/` | the app. `contract/` decodes the wire, `screens/` are the pages, `shell/` + `nav/` are the frame |
| `dist/` | the built bundle, committed: `index.html` plus one content-hashed JS and CSS file |
| `test/` | offline unit and source-text tests. `npm test -w portal-ui` typechecks, then runs them |
| `index.html` | the document: inline favicon, the pre-paint theme script, the Fontshare stylesheet |
| `vite.config.ts` | the build. `base: '/portal/'` and `minify: false` are load-bearing, each with its reason at the line |

## The seam

`driver/portal-service.mjs` serves `dist/` under `/portal/` — which is why `base` is `/portal/` in `vite.config.ts`
— and the browser reaches no other service. The contract is `src/contract/api.ts` against the route list at the top
of `portal-service.mjs`: when a route's status codes change, that file changes with it. Nothing is configurable — no
`import.meta.env` or `VITE_*` appears anywhere in `src/`, and the app's one `fetch()` calls same-origin
`/portal/...` with `credentials: 'same-origin'`.

## What CI will fail you on

**A change under `src/` must ship with its rebuilt bundle.** `dist/` is committed so a clone is runnable and a
deploy is a pull, an `npm ci` and a restart — never a build. CI rebuilds and requires byte equality. From the repo
root, on the exact Node patch pinned in [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) — a different
Node is why a correct-looking diff fails:

```sh
npm run build:ui && git add portal-ui/dist
```

**Typecheck is its own step**, because `vite build` does not: `npm run typecheck -w portal-ui`. Types enforce the
portal's invariants, so a violation must be a compile error, not something a user finds.

**The bundle is scanned, not only rebuilt.** Two greps over `dist/` fail the build: no `prefers-color-scheme`
(client surfaces are light on first paint, dark only by explicit choice), and nothing matching
`(CLEAROTRON|PORTAL|CF_ACCESS|MCP)_[A-Z_]+` — static text only, not response bodies, which `portal-service.test.mjs`
covers instead. `npm run tokens:check` fails a stale `src/tokens.css`, or an `index.html`
whose pre-paint script no longer matches the `shared/portal-tokens.mjs` constant `driver/portal-static.mjs` admits
by sha256. And CI's "Draw the screens" and "Client lifecycle" steps serve `dist/` to a real Chrome, which `test/`
cannot: no jsdom.

## Where to start

`src/contract/api.ts` — the only file permitted to call `fetch()`, and the portal's real specification. Its
`Result<T>` union has no `forbidden` member on purpose: tenant-scoped routes answer 404 rather than 403, so a
component must be physically unable to render otherwise.

`src/nav/nav.config.ts` — navigation is data, not JSX. A new surface is an entry there plus a screen in
`src/screens/`, with no edit to the sidebar, the breadcrumb or the mobile layout.

`src/state/guard.ts` — the unsaved-changes guard, a registry rather than a prop because the exits it must intercept
share no parent: in-app navigation goes through the shell, the brand switcher is no navigation, the auth-proxy
logout is a real `<a>` leaving the document. A screen calls `useUnsaved(dirty)`; the shell calls `confirmDiscard` at
each exit it owns, neither knowing the other. A new way out asks there too — and the header names the exit
deliberately left unguarded, and why.

Who sees what, and how the service in front of this decides: [`../docs/PORTAL.md`](../docs/PORTAL.md).
