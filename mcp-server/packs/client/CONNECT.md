# Connect your AI to your clearance report

Your report has an **"Ask your AI"** panel with a personal connector address. It is scoped to this
one search, read-only, and self-contained — adding it takes a minute.

**Treat the address like the report itself**: it embeds your access credential. Don't forward it
beyond the people who may read the report. It expires on its own (typically 30 days).

## Claude — Desktop or claude.ai (recommended)

1. **Settings → Connectors** (paid plan required).
2. **Add custom connector** → paste the address from your report → **Add**.
3. Ask: *"Brief me on this clearance search."*

## ChatGPT — Business / Enterprise / Edu

1. **Settings → Connectors → Advanced → Developer mode** (an admin may need to enable it).
2. **Add a connector / MCP server** → paste the address.

## Command-line / IDE tools (Claude Code, Cursor, …)

Point the tool's MCP configuration at the same address. No further setup.

## Notes

- **Read-only, one search.** It can show what this search found and how it is qualified; it cannot
  run new searches, see other matters, or change anything.
- If the connector stops answering, the link has likely expired — ask the firm that issued the
  report for a fresh one.
