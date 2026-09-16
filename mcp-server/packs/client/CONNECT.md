# Connect your AI to your clearance report

Connect once, and the **Ask AI** button on any of your reports opens Claude with a question about that
report already typed in.

Your connector address is on the **Connect your AI** page in the portal, not on the report. It is
read-only and takes a minute to add.

**Treat the address like the report itself**: it carries your access. Don't forward it beyond the
people who may read the report.

## Claude — Desktop or claude.ai (recommended)

1. **Settings → Connectors** (paid plan required).
2. **Add custom connector** → paste the address from the Connect your AI page → **Add**.
3. Open a report, press **Ask AI**, choose a question and press **Open in Claude**.

## ChatGPT — Business / Enterprise / Edu

1. **Settings → Connectors → Advanced → Developer mode** (an admin may need to enable it).
2. **Add a connector / MCP server** → paste the address.
3. Ask ChatGPT about a report by its mark and the date it was searched — the report's **Ask AI** button opens Claude.

## Command-line / IDE tools (Claude Code, Cursor, …)

Point the tool's MCP configuration at the same address. No further setup.

## Notes

- **Read-only, one search.** It can show what this search found and how it is qualified; it cannot
  run new searches, see other matters, or change anything.
- If the connector stops answering, the link has likely expired — ask the firm that issued the
  report for a fresh one.
