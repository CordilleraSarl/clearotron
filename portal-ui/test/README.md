# portal-ui/test — contract tests, no browser

```sh
npm test -w portal-ui        # typecheck, then these files
```

Node's own test runner over `.ts` files. **No DOM, no jsdom, no component rendering.** Every test here
exercises `../src/contract/` or `../src/state/` — the pure layer — which is why the whole suite runs in
seconds and why `src/contract/` holds the logic rather than the screens.

`npm test -w portal-ui` runs `typecheck` first, deliberately: **`vite build` does not typecheck**, so a type
error would otherwise reach a committed bundle. `npm run typecheck -w portal-ui` is also its own CI step.

## What each file covers

| File | Covers |
|---|---|
| `api.test.ts` | The decode boundary and the `Result<T>` union — including that no `forbidden` member exists |
| `compose.test.ts`, `composeRead.test.ts`, `composerProduct.test.ts` | Building a clearance request, reading one back, and the per-product composer copy |
| `grouping.test.ts`, `listView.test.ts` | How runs group and list |
| `home.test.ts` | The home projection |
| `failure.test.ts` | Failure states — that each one renders as itself rather than as a generic error |
| `guard.test.ts` | The unsaved-changes registry: every exit is intercepted, and a clean screen never prompts |
| `niceClasses.test.ts`, `ownerNames.test.ts` | Class parsing and owner-name normalisation |
| `productMatrix.test.ts`, `effortModelParity.test.ts` | That the UI's product claims match `../../driver/products.mjs` and `effort-model.mjs` |
| `profileFields.test.ts` | The profile field definitions and their copy |
| `askAi.test.ts` | The shell's Ask-AI control — the question's parity with the report's own, and that the address shown is the CLIENT connector, never the staff host |
| `assistants.test.ts` | The four connection entry points, and the rule that each is handed the address ITS door uses — Perplexity cannot open the browser sign-in |
| `copyLint.test.ts` | Two rules on centrally-authored copy: a vendor-vocabulary banlist and a length ceiling |
| `exportControls.test.ts` | The Export menu composed from what the framed document announces it can do — including that an un-announced document and an empty announcement are different answers |
| `inlineMd.test.ts` | The engine's prose read as spans, never as HTML — including parity with `../../driver/publish/render-knockout.mjs`'s own inline renderer |
| `perMarkReport.test.ts` | Opening one name of a knockout: the result URL's two arguments, and the rule that the frame is fed a document while the link is a route |

## The parity tests are the point

`productMatrix.test.ts` and `effortModelParity.test.ts` read the **driver's** own product and effort tables
and assert the UI agrees with them. That is what stops the portal offering a search the engine does not run,
or quoting a duration the engine does not size — the invitation and the enforcement drifting apart. A
change to `driver/products.mjs` that the portal has not followed fails here rather than in front of a
customer.

The same discipline applies when adding a screen: if it makes a claim about what the engine will do, the
claim belongs in `../src/contract/` with a test that reads the engine's table, not in JSX.

## Adding a test

Put the logic in `../src/contract/` and test it here. A behaviour that can only be tested by rendering a
component is a signal that it belongs in the contract layer instead — there is no renderer in this suite,
and adding one would change what this directory is for.
