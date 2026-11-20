---
"clearotron-driver": patch
---

Fixed: An assistant connected to a clearance now gets the report's own answers about a finding and about what was searched. Asked about a finding, it was given the owner, status and classes the assessment wrote, even where the report showed different ones from the register's saved record. It now gets the ones the report shows, with each registration the finding cites listed separately. Asked what was searched, it listed a row twice that the report shows once. A Knockout's answer about what was searched now uses the register results the report was published with.
