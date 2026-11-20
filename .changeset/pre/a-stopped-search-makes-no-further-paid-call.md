---
"clearotron-driver": patch
---

Fixed: Stopping a search now stops its spending. A Knockout stopped while it read the register went on to search its filings' owners on the web, a paid search each, until the service itself was stopped. Now a stopped search, Knockout or clearance, starts no further register request, web search or record fetch, and ends as stopped. A request already under way still finishes, and a stop pressed once the report is being published does not prevent its delivery, as before.
