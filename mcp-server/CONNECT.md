# Connect this to your AI app

Ask questions about finished clearance runs from Claude Code, Claude Desktop, Codex, or any other
MCP-capable app. Two ways in, and they are not variants of each other:

| | **Local** | **Hosted** |
|---|---|---|
| What it is | your app spawns `server.mjs` from your own clone | you were given a URL by whoever operates the engine |
| Who it is for | anyone who cloned this repository | a customer or colleague reading someone else's runs |
| Setup | copy-paste below, no account, no credential | paste the URL, sign in |
| Reach | everything, including the write verbs | read-only, scoped to your own matters |

**Local is this section.** Hosted is at the bottom, and standing one up is
[`docs/CLIENT-MCP.md`](../docs/CLIENT-MCP.md).

---

## Local: what it can and cannot show you

It reads run directories off your disk. So:

- **It shows you runs you have already produced.** `CLEAROTRON_WORK_DIR` is where the engine writes
  them, and that is the one variable the server needs.
- **`npx clearotron demo` runs are not visible to it.** The demo publishes a *report* into a pool; it does not
  create a run directory. There is nothing dishonest happening if `list_runs` comes back empty — you have
  no runs yet.
- **Nothing here spends money on its own,** with two exceptions that are gated and named: `start_run`
  enqueues a real clearance, and `what_if_run` re-runs one pipeline stage. Both are refused by default on
  a sensible allowlist — see "Hold two tools back" below.

**Prove the server works before you wire anything up:**

```sh
npm install
node mcp-server/smoke.mjs
```

That spawns the real server against a built-in fixture and drives it over MCP. You should see
`tools: 30 → brief, list_runs, …` followed by a page of answered calls. It needs no credentials and
touches no network. If that works, everything below is configuration.

## Claude Code

One command. Substitute your clone's path and your workspace root:

```sh
claude mcp add trademark-artifacts \
  -e CLEAROTRON_WORK_DIR=/path/to/your/workspace \
  -- node /path/to/clearotron/mcp-server/server.mjs
```

Check it: `claude mcp list` prints `trademark-artifacts: … - √ Connected`.

Add `-s user` to make it available in every project instead of just this one. Remove it with
`claude mcp remove trademark-artifacts`.

## Claude Desktop

**Settings → Developer → Edit Config**, then add the server to `mcpServers`:

```json
{
  "mcpServers": {
    "trademark-artifacts": {
      "command": "node",
      "args": ["/path/to/clearotron/mcp-server/server.mjs"],
      "env": { "CLEAROTRON_WORK_DIR": "/path/to/your/workspace" }
    }
  }
}
```

Restart Claude Desktop. The config file lives at
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and
`%APPDATA%\Claude\claude_desktop_config.json` on Windows, if you would rather edit it directly.

## Codex CLI

Codex reads `~/.codex/config.toml`:

```toml
[mcp_servers.trademark-artifacts]
command = "node"
args = ["/path/to/clearotron/mcp-server/server.mjs"]
env = { CLEAROTRON_WORK_DIR = "/path/to/your/workspace" }
```

That is all this server needs. If you ever add one that wants a **credential**, note that Codex does not
pass your shell environment through to an MCP server the way Claude does — forward it by name with
`env_vars = ["SOME_API_KEY"]` rather than writing the secret into `env`. The engine's own generated Codex
config does exactly this (`driver/engine/mcp/codex-config.mjs`), and for the same reason: a value in `env`
is a value written to a file.

## Any other MCP host

The contract is the same three things every time: run `node mcp-server/server.mjs`, over stdio, with
`CLEAROTRON_WORK_DIR` in its environment.

```json
{
  "command": "node",
  "args": ["/path/to/clearotron/mcp-server/server.mjs"],
  "env": { "CLEAROTRON_WORK_DIR": "…", "CLEAROTRON_REPORTS_DIR": "…" }
}
```

`CLEAROTRON_REPORTS_DIR` is optional for reading and points at the published archive; set it if you want the
published report bytes rather than the run's working copies. Every variable is listed in `.env.example`.

## Hold two tools back

`start_run` **enqueues a real clearance** — hours of model time and vendor calls. `what_if_run`
**re-runs a pipeline stage**. Neither belongs on an allowlist an agent can fire unattended.

The pattern that works: let the agent call `what_if_plan` freely — it costs nothing and returns the
price and what will and will not be recomputed — and only call `what_if_run` after a person has said yes.
`what_if_plan` hands back a `confirmationToken` precisely so that handshake exists.

## When your clone and your runs belong to different users

If the engine runs as a service account and the run directories are owned by it, your own app cannot
read them. Spawn the server as that user:

```json
{
  "command": "sudo",
  "args": ["-u", "<operator>", "node", "/path/to/clearotron/mcp-server/server.mjs"]
}
```

That needs a one-time NOPASSWD rule, or the stdio handshake hangs on a password prompt:

```
# /etc/sudoers.d/trademark-artifacts-mcp   (chmod 0440)
<caller> ALL=(<operator>) NOPASSWD: /usr/bin/node /path/to/clearotron/mcp-server/server.mjs
```

## What to ask it

Plain language. Start with *"brief me on …"* — you do not need the tool names.

- "**Brief me on** the latest clearance." / "What did the search on *&lt;mark&gt;* find?"
- "What's the **risk** on *&lt;mark&gt;*, in plain terms?"
- "Has the **'MYRK' root** shown up in any prior clearance?" (searches every run)
- "**How did** the verdict on *&lt;mark&gt;* get to Conditional?"
- "List the **recent** runs and their outcomes."

It reaches for the audit and trace views only when you ask *how* something was decided.
`README.md` in this directory is the full tool catalogue.

---

## Hosted: someone gave you a URL

Nothing in this repository to install. Paste the address into your app and sign in with the account the
operator enrolled.

| App | Where |
|---|---|
| **Claude** — Desktop or claude.ai | Settings → Connectors → **Add custom connector** → paste the URL → **Connect**. Needs a paid plan; on Team/Enterprise an admin may have to allow it first. |
| **ChatGPT** — Business / Enterprise / Edu | Settings → Connectors → Advanced → **Developer mode** (admin may need to enable) → add an MCP server → paste the URL. |
| **Perplexity** | Settings → Connectors → **+ Custom Connector** → paste the URL → accept the risk notice. |
| **Claude Code, Cursor, Gemini CLI, …** | Point them at the same URL; they open a browser for you to sign in. |

**A hosted connector is read-only and narrower than a local one.** It shows what searches found and how
they were reached; it cannot spend money or change a report. A signed-in client reaches eighteen tools
against their own matters — the report, the evidence under it, the audit chain behind that (the audit
trail, the reasoning narrative, the step-by-step decision walk), and what-if: a single step re-run in a
sandbox, queued on the server, with the original untouched. What it never shows is what the work cost or
which model did it. The exact list, and the reason for each withheld tool, is in
[`docs/CLIENT-MCP.md`](../docs/CLIENT-MCP.md).

**Calls to a hosted connector are logged** — who signed in, which tool, which run, when; never report
contents. That log belongs to the hosted service. A server you spawned locally writes no access-log entry
at all ([`docs/SECURITY.md` § Audit](../docs/SECURITY.md#audit) has the mechanism).

If sign-in is rejected you are not logged in with the enrolled account. Signing in successfully but
finding no runs is a different thing — which matters an account may read is set separately, so ask the
operator.

**To stand one of these up,** including the API-key door for agents that cannot sign in, read
[`docs/CLIENT-MCP.md`](../docs/CLIENT-MCP.md). The provisioning runbook worked end to end through one
auth proxy is [`remote/REMOTE-SETUP.md`](remote/REMOTE-SETUP.md).
