---
"clearotron-driver": minor
---

New: The data file published beside each report now names which of its two shapes it is: `report-data/clearance-1` for a clearance, `report-data/knockout-1` for a Knockout. Each shape has a JSON Schema in the documentation, so a firm building its own screens on the data can check a file against it. Reports published before this keep `report-data/1`: a published file is never rewritten.
