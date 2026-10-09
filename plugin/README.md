# Clearotron for Claude

Connect an assistant to a clearotron trademark-clearance install: the MCP server, plus the three connector
skills that teach an assistant to use it well.

## What it runs

`npx -y clearotron@<version> mcp`, the version this folder's `.mcp.json` names: Clearotron's MCP server,
over stdio, on your own machine. The first start downloads that exact version of the `clearotron` package
from npm, with its dependencies.

## What it reads

It reads run directories off your disk: the finished searches of a Clearotron install. On a machine with
no install, it answers from the four sample runs of Clearotron's demo, and every row says it is the demo.

## What it sends, and to whom

Its answers go to Claude, as anything else you show Claude does, and nowhere else. Nothing here spends
money on its own, with two exceptions that are gated and named: `start_run` enqueues a real clearance, and
`what_if_run` re-runs one pipeline stage.

## Licence

AGPL-3.0-only, with the additional terms in `ADDITIONAL-TERMS.md`. Source and documentation:
https://github.com/CordilleraSarl/clearotron
