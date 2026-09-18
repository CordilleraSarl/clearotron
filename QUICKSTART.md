# Quickstart

A first clearance in three commands, sized in minutes. [INSTALL.md](INSTALL.md) is the reference for
everything this page leaves out.

## Before you start

Three self-serve accounts. Each is yours, signed in on your own machine — this product holds no keys
of its own and calls nothing on your behalf.

| What | Why | Where |
|---|---|---|
| A reasoning program | Every stage runs as a headless turn of it | [Claude Code](https://claude.com/claude-code) (`claude`) or the Codex CLI (`codex`). Setup installs it if the machine has none. Sign in with the program setup installed (doctor prints its path), or with `claude` or `codex login` if the machine has its own |
| A register | Sets what the search reaches, and what it costs | [Signa](https://signa.so) — one key, self-serve, US + EU + WIPO and eight more offices |
| Web research | Covers the open web and the marketplaces | [Perplexity](https://www.perplexity.ai) |

The register is the one with a real choice in it. EUIPO and a local USPTO index cost nothing and
reach one office each; Signa is the recommended paid route and the fastest to a real clearance.
[The six, and what each reaches](providers/README.md).

**macOS, Linux, or native Windows for the demo; WSL2 for a clearance.** `npx clearotron demo` runs
anywhere Node does, native Windows included. A real clearance does not: the engine spawns each stage
with POSIX path and process semantics, so on native Windows a clearance is refused before it
starts, even with the program installed. On Windows, `wsl --install -d Ubuntu`, then
`wsl -d Ubuntu`, and work through this page from **inside** that distribution. Name it: plain `wsl`
can open a minimal image with no apt, no curl and no bash, and everything below assumes Ubuntu. A
fresh Ubuntu has no Node, and apt's package is below what this needs, so `npx` answers "not found"
before anything of ours runs. From the Ubuntu prompt:

```bash
sudo apt update && sudo apt install -y curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh" && nvm install 22
```

Then carry on below. [INSTALL.md](INSTALL.md) §1 has the exact version floor and why it is one.

## Install

```bash
npx clearotron install  # offers to install the reasoning program if the machine has none, and shows you how to sign it in
npx clearotron doctor --probe-engine
```

`install` puts the program under `~/.local` and needs no root. Installing with npm's own global form
instead is covered in [INSTALL.md](INSTALL.md) §2.

`doctor` is the one to read. It checks that the reasoning program is there, on `PATH` or as the copy
setup installed; that it is signed in, by running a turn rather than by finding the executable; and
that your register credential resolves. An executable that is signed out passes every other check and
fails at the first stage.

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
npx clearotron run --job job.json
```

**Name `product`.** It orders a knockout search: the cheapest of the four and the fastest way to
prove the install works. Delete that line and the territories decide instead — and one country gives
you a full country search, the deepest of the four, with case law on. Narrowing the scope orders
**more** work, not less.

**A knockout search takes 5 to 10 minutes. The other three take 1.5 to 2.5 hours.** Every finished
stage stays on disk, so a run survives interruption and a resume re-runs only what is missing.

## Then

- See it before you buy anything: `npx clearotron demo` replays a finished clearance with no account, no
  key and no network.
- The four searches, and what each reaches: [README.md](README.md).
- Everything else — configuration, the config store, the portal, access control:
  [INSTALL.md](INSTALL.md).
