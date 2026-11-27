---
"clearotron-driver": minor
---

Fixed: When a search stops or is refused before it delivers anything, its notice no longer names the stage, the failure kind or the reason as the engine reported it, whoever placed the order. The email and the messaging line carry the same words: the search stopped before it finished, or was not started, and nothing was delivered. They end with one next step: tell whoever administers the installation. When the search waited out a provider's usage cap and stopped for it, they end with the cap sentence instead.

Fixed: The connector's `list_runs`, `get_run` and `decision_timeline` describe a failed run to a session that sees every company as they already did to a company's session. `get_delivery_packet` and `list_outbox_events` hand on a stopped run's notice and its routing only, including for a notice an earlier version wrote. The portal's Clearances list gives everyone the plain failure note. The engine's own words stay in the run's records.

Fixed: The outbox files an integrator reads now hold only the notice and the routing it is sent by. A stopped run's stage, reason and repairs stay in the run's own record. When the worker starts, it rewrites any outbox files an earlier version wrote in the same shape, under the same names, before it delivers anything, so an upgrade neither loses a notice nor sends one twice.

Fixed: The connector's engineering reads no longer hand on a run's diagnostic text. `get_telemetry`, `run_changes`, `get_coverage`, `trace`, and the reads and searches of a run's status and event log give the measured facts (time, tokens, calls, model, attempts) without reasons, validator messages or file paths. Run rows no longer carry the stage a failed run stopped at or the kind it ended on. The engine's own working files are no longer served, apart from the event log and the register counts and filings. In the portal, the stop control and the company list no longer show the engine's own reasons; the screens show their usual sentences.
