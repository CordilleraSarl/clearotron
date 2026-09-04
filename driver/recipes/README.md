# Saved searches ("recipes")

One subdirectory per customer — `aurora/` and `zephyr/` — each holding one JSON file per saved search at
`<customer>/<slug>.json`; the loader walks directories only, so nothing else here is a store. A recipe is a
small named bundle: a base product, optional component toggles, an optional `scope` block (where the
machinery points: `jurisdictions`, `platforms`, `classes`), and instruction-shaped `extras`.
The display field is `label`, deliberately not `name` — `name` is a profile key, and the two key sets are
disjoint by design, so a saved search can never carry rating config.

## What reads it

`loadRecipes()` in `../search-policy.mjs` walks `<dir>/<customer>/<slug>.json` into a
`Map("customer/slug" → recipe)`, validating each file with `validateRecipe` — the same validator the write
door uses, so the UI cannot persist a recipe the driver would later reject. `resolveSearchPolicy` then
turns a job's `recipeKey` into the product, components, extras and scope the run uses; a recipe only runs
for its own customer, and an `archived` one refuses with a clarify.

The write side is `../recipe-service.mjs` (loopback, CF Access JWT, git auto-commit as the verified
identity). The portal mounts those routes through `../portal-upstream.mjs`, which rebuilds the customer
path segment from the resolved account; `../dev-portal.mjs` proxies `/recipes/*` for dev.

**The store is named, never guessed.** `CLEAROTRON_RECIPES_DIR` unset means the deployment has no saved
searches — not that it falls back to this directory. That fallback existed and was removed: production is
exactly where the variable is unset, so it would have surfaced invented customers inside the product.

## These are synthetic demos

`aurora` and `zephyr` are fictional customers (`../profiles/aurora.json`, `../profiles/zephyr.json`) that
exist so the dev cockpit and the test suite have something to render. A real deployment's recipes live
outside the repo, in the customer-config store beside the profiles — no client data in git.

| File | Base product, and any extras it carries |
|---|---|
| `aurora/quarterly-screen.json` | `knockout-search`, `extras.emailTable` |
| `aurora/screen-with-register-counts.json` | `knockout-search` |
| `zephyr/standard-clearance.json` | `multi-country-focus-search`, `extras.standingInstructions` + `extras.defaultDeadlineDays` |

Two of them carry settings the product no longer offers, which is not an oversight: `emailTable` is inert
but still validated so recipes written while it worked keep loading, and `defaultDeadlineDays` is a retired
extra that `loadRecipes` drops on read and `validateRecipe` refuses on save. A stored recipe must not brick
on a change it never asked for.

## Where to start

`zephyr/standard-clearance.json` — twelve lines, and the one whose `extras` show both what an
instruction-shaped setting looks like (`standingInstructions`) and what a retired one looks like still
sitting in a stored file. Then the recipe block in `../search-policy.mjs` (`RECIPE_KEYS`,
`RECIPE_SCOPE_KEYS`, `RECIPE_EXTRA_KEYS`, `validateRecipe`), which is where every rule above is enforced
and commented.
