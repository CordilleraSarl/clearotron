---
"clearotron-driver": minor
"trademark-artifacts-mcp": minor
---

New: An assistant connected to the connector can ask what became of an order with the new `order_status` tool, by the reference `start_run` returned or by the one it sent. The answer gives the order's state (waiting, being checked, running, parked to resume by itself, refused, failed, delivered or cancelled), its run id once it has one, and, for an order refused before it ran, why. A company is answered only about its own orders: another company's order gets the same answer as a reference nobody holds.

New: When a company sends `start_run` the reference of an order it already placed, the reply is now that order and its state, not a refusal. Nothing is queued a second time and nothing is spent.

For operators: the `enqueue` command can now print what became of an order, given its reference, without queuing anything. It exits 4 when no order answers to the reference. The intake guide shows how.
