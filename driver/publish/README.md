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

**`index.mjs`** — the clearance publish step in two halves. `readClearanceDocument()` reads the run once
into the report document: every fact a surface prints, which run-side stores were read (the closed table in
`publish-inputs.mjs`, where absent, damaged and read are three different facts), and `evaluateClientGate()`,
the one allowed hard structural refusal. Where two surfaces state one fact two ways, each way is its own
field. `publishReport()` writes the pool run dir from that document. `coverNoteOptions()` reads the cover
note's options from the run's frozen files, for the document and for the delivery's email.
`knockout.mjs` is built the same way: `readKnockoutDocument()`, then `publishKnockout()`.

**`render.mjs`** — but read `../test/render-frozen.test.mjs` first. The four demo runs' report pages are
compared with a stored record, so a change to what a page prints, from this file, `templates/report.css` or
`../../shared/brand.mjs`, fails that test until it is re-stamped in the same commit. Republishing a run made
by another build is refused, so a delivered report keeps the page it was issued with.

## Files

| File | Role |
|---|---|
| `index.mjs` | `readClearanceDocument` and `publishReport` — the clearance publish step; also `regenIndex` (staff + per-customer pool indexes), the email composers, `coverNoteOptions` and `riskTier`/`TONE_TIER` |
| `render.mjs` | `report.md` + `findings.json` → `report.html`. Its page is guarded — see above |
| `parse.mjs` | The presentation-agnostic `report.md` parse the clearance renderer and the audit workbook build from |
| `publish-inputs.mjs` | The closed table of run-side stores publish reads, and what an absent one means |
| `report-data.mjs` | `report-data.json` for a clearance run — the client cut by construction, pure (no IO) |
| `xlsx.mjs` | The four-tab audit workbook (exceljs, loaded lazily) |
| `audit-from-spine.mjs` | Builds the `audit.md` contract from the spine's markdown tables — no LLM, count-guarded |
| `knockout.mjs` | The knockout publisher: `readKnockoutDocument`, then per-mark reports, its workbook, its cover note |
| `shell.mjs` | What publishing does whichever report it is: the run's pool folder and its writers, a part that fails without stopping the report, `meta.json` last with the index refresh, and the staff pages |
| `render-knockout.mjs` | The knockout report's HTML. A sibling of `render.mjs`: it takes the demo banner and the served-models line from it |
| `page-shell.mjs` | The document both renderers wrap their page in: head, title, typefaces, favicon, theme script and the base, dark and print styles. Each renderer passes its own title, sheet and chrome address |
| `report-registry.mjs` | Template name → publisher, and `republishRun` |
| `archive-tags.mjs` | The pool's `archive-tags.json` visibility sidecar, and its single writer |
| `pool-admin.mjs` | Operator CLI over the pool: list, archive/unarchive, reassign, regen, republish |
| `regions.mjs` | The one country/jurisdiction naming source for every render surface |
| `profiles-page.mjs` | Generates the pool's `profiles.html` from `../profile-page.html` |
| `templates/report.css` | The report layout vocabulary, shared by both renderers |
| `templates/knockout.css` | The layout the knockout report adds on top of `report.css`, every selector `ko-`prefixed |
