---
"clearotron-driver": patch
---

For operators: `clearotron doctor` now makes one real call to the configured AI engine, on its cheapest model, and fails when the engine refuses it. An install whose engine sign-in had stopped working passed the check while every new search was refused.

For operators: The background service now checks its AI engine when it starts and after seven days without a successful engine call, and `clearotron status` shows a check that failed. `CLEAROTRON_ENGINE_CHECK_ROUTINE` sets that interval, such as 12h or 30d, or turns it off.

For operators: A failed engine check also leaves one event in the outbox for the installation's operator, with no order and no requester. An integration that delivers outbox events should leave it pending; the next passing check removes it.

Fixed: When the engine is refused over its billing setting, `clearotron doctor` names the setting and no longer prints its value, which could be a pasted key.
