---
"clearotron-driver": patch
---

Fixed: An assistant placing an order through the connector now tells the requester the search is submitted, not that it is starting, and confirms it only once the order has been accepted. It reports a start only once the search has a status of its own, and checks that status rather than reading silence as progress.
