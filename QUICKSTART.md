# Quickstart

A first clearance in three commands, sized in minutes. [INSTALL.md](INSTALL.md) is the reference for
everything this page leaves out.

## Before you start

Three self-serve accounts. Each is yours, signed in on your own machine — this product holds no keys
of its own and calls nothing on your behalf.

| What | Why | Where |
|---|---|---|
| A reasoning CLI | Every stage runs as a headless turn of it | [Claude Code](https://claude.com/claude-code) (`claude`), or the Codex CLI (`codex`) |
| A register | Sets what the search reaches, and what it costs | [Signa](https://signa.so) — one key, self-serve, US + EU + WIPO and eight more offices |
| Web research | Covers the open web and the marketplaces | [Perplexity](https://www.perplexity.ai) |

The register is the one with a real choice in it. EUIPO and a local USPTO index cost nothing and
reach one office each; Signa is the recommended paid route and the fastest to a real clearance.
[The six, and what each reaches](providers/README.md).

## Install

```bash
npm install -g clearotron
clearotron install
clearotron doctor --probe-engine
```

`doctor` is the one to read. It checks that your CLI is on `PATH`, that it is signed in — by running
a turn, not by finding the executable — and that your register credential resolves. An executable
that is signed out passes every other check and fails at the first stage.

## Run one

Write `job.json`:

```json
{
  "id": "job-2026-0001",
  "forwarder": "alex",
  "forwarderEmail": "alex@example.com",
  "marks": [{ "ref": "TM-0001", "name": "IRONWHISK", "classes": [9, 42] }],
  "goods": "cloud software for weather analytics",
  "jurisdictions": ["US"],
  "product": "knockout-search"
}
```

```bash
clearotron run --job job.json
```

**Name `product`.** It orders a knockout search: the cheapest of the four and the fastest way to
prove the install works. Delete that line and the territories decide instead — and one country gives
you a full country search, the deepest of the four, with case law on. Narrowing the scope orders
**more** work, not less.

**A knockout search takes 5 to 10 minutes. The other three take 1.5 to 2.5 hours.** Every finished
stage stays on disk, so a run survives interruption and a resume re-runs only what is missing.

## Then

- See it before you buy anything: `clearotron demo` replays a finished clearance with no account, no
  key and no network.
- The four searches, and what each reaches: [README.md](README.md).
- Everything else — configuration, the config store, the portal, access control:
  [INSTALL.md](INSTALL.md).
