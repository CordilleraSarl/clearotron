---
"clearotron-driver": patch
---

Fixed: A register record that a repeated search finds after the results were ranked is now ranked and reviewed before the report is written. If that cannot be done, the report is still delivered, and it counts the record among those left open. Before, such a record could be left out of the ranking, the review and the report.
