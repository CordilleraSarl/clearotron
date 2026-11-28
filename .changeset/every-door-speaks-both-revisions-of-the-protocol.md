---
"clearotron-driver": minor
---

New: The connector doors (the staff door, the client door, the local door and the case-law bridge) now speak both revisions of the Model Context Protocol. An assistant using the 2026-07-28 revision connects directly, with no opening handshake; one using an earlier revision connects as before.

For operators: The connector doors no longer keep sessions. Every request is checked on its own: its key, what that key may reach, the rate limits and the guest list. The settings `TRADEMARK_MCP_SESSION_TTL_MS`, `TRADEMARK_MCP_SESSION_MAX`, `CLIENT_MCP_SESSION_TTL_MS` and `CLIENT_MCP_SESSION_MAX` no longer do anything; an installation that still sets one is told so at start.
