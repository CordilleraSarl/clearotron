---
"clearotron-driver": patch
---

Fixed: When an order fails before its search starts, or is refused before it runs, the notice now reaches an integration whose access is limited to that order's company, as notices about started searches already did. A client who placed the order is told that the search was not started, without the technical reason.
