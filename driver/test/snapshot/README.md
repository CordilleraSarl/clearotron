# driver/test/snapshot — what a change does to a run, before and after

Two comparison tools for code moves that should change nothing. Each records one commit, records another, and
prints what differs. Neither is a test: they are not in `npm test` or `test:full`, they make no model turn and no
register call, and they report rather than judge. Exit 0 means they looked, exit 2 means they could not.

| Tool | What it compares |
|---|---|
| `behaviour-snapshot.mjs` | What a run does. It drives the mock pipeline over a fixed set of scenarios on both engines, with the network refused, and records the stages in order, a hash of each prompt, the tools each stage was granted, the output files, the terminal state and the driver lines the scenarios ran. `.github/workflows/behaviour-snapshot.yml` runs it on every push to a `next-*` line. |
| `publish-compare.mjs` | What a saved run publishes. It publishes each sample under a frozen clock and compares the page, the data files, the workbook entry by entry, the pool's index pages, the email, what the publisher returns and the rows it appends to the run's log. A saved run is a folder holding `meta.json` and `run/`, the shape `demo/` uses. |

The other four files serve those two:

- `run-scenario.mjs` and `publish-scenario.mjs` run one scenario or one sample in a process of its own, because
  the driver reads its configuration when it is imported.
- `no-network.mjs` is preloaded into every scenario process and refuses any connection that leaves the machine.
- `workbook-entries.mjs` reads a workbook's entries so that only its two generation timestamps are set aside.

Usage is at the top of each tool.
