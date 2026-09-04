# publish — a finished run becomes a delivered report

Deterministic Node, not a model turn. Publish reads a completed run's contract artifacts — `report.md`,
`audit.md`, `findings.json` and the `_driver/` sidecars — and writes the delivery set into the archive
pool (`config.poolRoot`, from `CLEAROTRON_REPORTS_DIR`, which has no default): `report.html`, a reader-safe
copy of `report.md`, `report-data.json`, `meta.json`, the `<runId>-audit.xlsx` workbook, and the
regenerated pool indexes. Because it is code and not a stage it cannot hang or time out, so the driver
calls it directly instead of through `runStage`.

## What reads it

`../pipeline.mjs` calls `publishReport` (and `composeEmailHtml` / `deliverySubject` for the cover note);
`../pipeline-knockout.mjs` calls `publishKnockout`, the batch lane's own publisher. Everything that
re-renders an already-delivered run goes through `republishRun` in `report-registry.mjs`, which turns
`meta.template` (`"clearance"` or `"knockout"`) into the matching publisher — that is the door
`pool-admin.mjs`, `../../bin/example.mjs` and `../../scripts/freeze-example-run.mjs` use.

Several modules here are read from outside the publish step: `../portal-service.mjs` takes
`readArchivedSet` / `updateArchived` from `archive-tags.mjs`; `../../mcp-server/lib/driver.mjs` takes the
`report.md` parse from `parse.mjs` and `buildAuditMd` from `audit-from-spine.mjs`, both of which
`../pipeline.mjs` also imports; and `../predelivery-lint.mjs` takes `REGION_NAMES` from `regions.mjs`.

## Start here

**`index.mjs`** — `publishReport()` is the whole step in one function: what gets written into the pool
run dir, which run-side stores are read (the closed table in `publish-inputs.mjs`, where absent, damaged
and read are three different facts), and `evaluateClientGate()`, the one allowed hard structural refusal.

**`render.mjs`** — but read `../test/render-frozen.test.mjs` first. The renderer is pinned by a sha256
over its exact bytes, because `republishRun` re-renders reports already delivered to clients through it.
Editing it is a decision to argue for in the commit message; almost every visual change belongs in
`templates/report.css` or `../../shared/brand.mjs` instead, neither of which is frozen.

## Files

| File | Role |
|---|---|
| `index.mjs` | `publishReport` — the clearance publish step; also `regenIndex` (staff + per-customer pool indexes), the email composers and `riskTier`/`TONE_TIER` |
| `render.mjs` | `report.md` + `findings.json` → `report.html`. FROZEN — see above |
| `parse.mjs` | The presentation-agnostic `report.md` parse the clearance renderer and the audit workbook build from |
| `publish-inputs.mjs` | The closed table of run-side stores publish reads, and what an absent one means |
| `report-data.mjs` | `report-data.json` for a clearance run — the client cut by construction, pure (no IO) |
| `xlsx.mjs` | The four-tab audit workbook (exceljs, loaded lazily) |
| `audit-from-spine.mjs` | Builds the `audit.md` contract from the spine's markdown tables — no LLM, count-guarded |
| `knockout.mjs` | The knockout publisher: per-mark reports, its workbook, its cover note |
| `render-knockout.mjs` | The knockout report's HTML. A sibling of `render.mjs`; imports nothing from it |
| `report-registry.mjs` | Template name → publisher, and `republishRun` |
| `archive-tags.mjs` | The pool's `archive-tags.json` visibility sidecar, and its single writer |
| `pool-admin.mjs` | Operator CLI over the pool: list, archive/unarchive, reassign, regen, republish |
| `regions.mjs` | The one country/jurisdiction naming source for every render surface |
| `profiles-page.mjs` | Generates the pool's `profiles.html` from `../profile-page.html` |
| `templates/report.css` | The report layout vocabulary, shared by both renderers. Not frozen |
