---
"clearotron-driver": patch
---

Fixed: a Clearotron install signed in to OpenAI's `codex` with a subscription keeps working after codex refreshes its login. Before, every search after the first refresh failed within seconds until you signed in again.
