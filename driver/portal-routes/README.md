# portal-routes — the portal service's routes, one module per group

`../portal-service.mjs` answers every request under `/portal` by asking these groups in turn, in the order its routes
have always been matched. Each module exports one function, `<group>Routes(svc, request)`: `svc` is what the service
holds (its directories, its injected seams, its own constants), `request` is what the request carries (`method`,
`parts`, `principal`, `body`, `query`). A group answers a request it serves and returns `undefined` for any other.

| Module | Routes |
|---|---|
| `me.mjs` | `/portal/api/me`, `/portal/api/about`, `/portal/api/searches` |
| `compose.mjs` | `/portal/api/compose/read` |
| `run.mjs` | `/portal/api/run/plan`, `/portal/api/run`, a run's stop and summary |
| `queue.mjs` | cancelling and reordering queued searches |
| `config.mjs` | `/portal/api/config/*`, through `portal-upstream` |
| `usage.mjs` | `/portal/api/usage` |
| `connect.mjs` | `/portal/api/mcp-access`, `/portal/api/connect-key`, `/portal/connect-help` |
| `runs.mjs` | `/portal/api/runs`, `/portal/api/ack` |
| `report.mjs` | `/portal/report/<run>/…` and its audit workbook |
| `feedback.mjs` | `/portal/api/feedback` |
| `admin.mjs` | the staff pages under `/portal/admin` |

A group imports nothing from `portal-service.mjs`: what several groups share lives in `../portal-runs.mjs` (the runs a
reader can see) and `../portal-confirmation.mjs` (the token that confirms an order), or rides in `svc`. Tests that pin
the service's text read it through `../test/driver-source.mjs`, which appends these modules.
