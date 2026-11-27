---
"clearotron-driver": minor
"trademark-artifacts-mcp": minor
---

New: After Start, the portal shows the order's receipt and follows it while it waits, when its search starts and if it is refused before any search runs. A refused order says why in one sentence, such as "Your company has reached its search limit.", and shows its order reference to give to an administrator. The receipt opens again from the order's row in Clearances.

New: An order that is still being checked, or was refused before any search ran, has its own row in Clearances. It sits among the names by date and reads "Waiting to start" or "Order did not start".

New: `order_status` now says which check refused an order before it started, as `reasonKind`: run-cap, details, policy, setup, duplicate or other. On the operator connector it also gives the recorded reason.

Fixed: When intake refused an order placed from the portal or a company's own connector, the notice quoted the check's own words and named the queue. It now carries the not-started sentence a failed start already uses, and the check's words stay with the operator.
