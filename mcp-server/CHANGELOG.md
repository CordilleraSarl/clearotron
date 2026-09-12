# trademark-artifacts-mcp

## 0.3.0

No changes in this release.

## 0.3.0-beta.10

No changes in this release.

## 0.3.0-beta.9

No changes in this release.

## 0.3.0-beta.8

No changes in this release.

## 0.3.0-beta.7

No changes in this release.

## 0.3.0-beta.6

No changes in this release.

## 0.3.0-beta.5

### Patch Changes

- e7cd9e1: Fixed: On an install run with `clearotron start`, a connected assistant now lists the same saved searches as the portal, including Generic's. `clearotron doctor` no longer says working saved searches are off, and it names one place profiles come from.

## 0.3.0-beta.4

No changes in this release.

## 0.3.0-beta.3

No changes in this release.

## 0.3.0-beta.2

### Patch Changes

- eacfce4: Fixed: An assistant reading a knockout's filings through the connector now gets each filing's page at the trade mark office, as the report does. Where that register publishes no page for a single record, it gets the office and the number instead. Before, it got a reference that opens nowhere.

## 0.3.0-beta.1

### Patch Changes

- b8ec213: Fixed: A company you create in the browser now appears in your assistant's list of companies straight away.
  
  It used to appear only after the service restarted, although a search could already be started for it. Its projects were missing from the list in the same way, and so was its account in the search options.
  
  The check comparing the running service with the configuration store no longer calls a company the portal's key does not cover a disagreement. It names that gap on a line of its own, with the command that widens the key.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.3.0-beta.0

## 0.2.1

## 0.2.1-beta.2

## 0.2.1-beta.1

## 0.2.1-beta.0

## 0.2.0

## 0.1.12

## 0.1.11

## 0.1.10

## 0.1.9

## 0.1.8

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

### Patch Changes

- 19a1869: New: Ask a what-if about a delivered report and get a supplementary memo over its archived evidence, without touching the report.

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- 6d05f62: Fixed: An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

## 0.1.1-beta.1

### Patch Changes

- 6d05f62: An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

## 0.1.1-beta.0
