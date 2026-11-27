---
"clearotron-driver": minor
---

Fixed: When a search stops or is refused before it delivers anything, its notice no longer names the stage, the failure kind or the reason as the engine reported it, whoever placed the order. The email and the messaging line carry the same words: the search stopped before it finished, or was not started, and nothing was delivered. They end with one next step: tell whoever administers the installation. When the search waited out a provider's usage cap and stopped for it, they end with the cap sentence instead.

Fixed: The connector's `list_runs`, `get_run` and `decision_timeline` describe a failed run to a session that sees every company as they already did to a company's session. `get_delivery_packet` and `list_outbox_events` hand on a stopped run's notice and its routing only, including for a notice an earlier version wrote. The portal's Clearances list gives everyone the plain failure note. The engine's own words stay in the run's records.
