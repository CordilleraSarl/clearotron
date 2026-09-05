# Example run — provenance

Frozen by `scripts/freeze-example-run.mjs` from one finished clearance run.

- Run id: `tmpdemo2014fullcountrysearch-venqori-2026-09-03-sample-capture`
- Frozen inputs: 210 file(s), the subset `publishReport` reads
- Dropped: stage dispatch payloads, per-stage telemetry, stage inputs, run event log, history

`npx clearotron demo` republishes this directory into a local pool and serves it. Nothing here calls a
model, a register or the network.

Regenerate with:

```
node scripts/freeze-example-run.mjs --run-dir <archived run> --out demo --force
```
