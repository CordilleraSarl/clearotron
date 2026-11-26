# trademark-artifacts-mcp

## 0.8.0-beta.0

### Minor Changes

- New: The connector's six actions now declare the shape of their answer: starting, stopping or adding context to a search, running a what-if, marking a delivery sent and acknowledging an event. Each answer says in a field whether the action happened, or why it was refused, so a program built on the connector reads the outcome without parsing a sentence. The text an assistant reads is unchanged.
- New: The connector's tools that list searches and read a search's record now declare the shape of their answer too, and return it as structured data beside the same text as before. That covers the run list, a run's steps, its timeline, its changes, its telemetry, its coverage, the search tools, an order's free preview and the list of searches that can be ordered. A program built on the connector can rely on the fields each answer carries.
- New: The connector's tools that answer from a delivered report (the brief, the findings, a single finding, the evidence, the searches and the coverage) now declare the shape of their answer. Each answer names the version of the report record it was read from. Where a field means what the published report data means, it is declared the same way.
- New: An assistant connected to the connector can order a search Urgent. Before it orders, it can see whether this installation can run Urgent, and both options' turnaround and count of searches. Where the installation cannot run Urgent, the search starts at Standard, counts as one search, and the reply says so.
- New: An assistant connected to the connector now lists a search a company has just ordered, as queued, before a worker starts it. The portal already showed it this way, in the same words, "Waiting to start". Another company's order stays out of the list.
- New: When a request's deadline is tight, or it says urgent, today or ASAP, an assistant connected to the connector offers Urgent. It gives Urgent's turnaround, its cost of 2 searches and what is left today, then asks Urgent or Standard, and orders Urgent only when you say so. Where Urgent cannot run or does not fit today's searches, it says so and offers Standard.

### Patch Changes

- Fixed: An order a company sends through the connector under its own reference is now filed under that reference with a mark of the company added, and the reply gives the reference it is filed under. Two companies that choose the same reference no longer meet. A company that sends its reference again is told its own order is already filed, and nothing is spent. It is never told anything of another company's order.
- Fixed: A search retired from the portal's list no longer appears in the run list an assistant reads through the connector. It can still be read by name, so a link already sent keeps working, and it comes back when it is restored.

## 0.7.0

### Patch Changes

- Fixed: A client's assistant is now told, in the description of the tool that returns one finding, that it carries a cited register record's goods and services in the register's own wording, with the provider's English translation where one exists.

## 0.7.0-beta.4

No changes in this release.

## 0.7.0-beta.3

No changes in this release.

## 0.7.0-beta.2

### Patch Changes

- Fixed: A client's assistant is now told, in the description of the tool that returns one finding, that it carries a cited register record's goods and services in the register's own wording, with the provider's English translation where one exists.

## 0.7.0-beta.1

No changes in this release.

## 0.7.0-beta.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.6.0-beta.1

No changes in this release.

## 0.6.0-beta.0

No changes in this release.

## 0.5.1

No changes in this release.

## 0.5.1-beta.2

No changes in this release.

## 0.5.1-beta.1

No changes in this release.

## 0.5.1-beta.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.5.0-beta.10

No changes in this release.

## 0.5.0-beta.9

No changes in this release.

## 0.5.0-beta.8

No changes in this release.

## 0.5.0-beta.7

No changes in this release.

## 0.5.0-beta.6

No changes in this release.

## 0.5.0-beta.5

No changes in this release.

## 0.5.0-beta.4

No changes in this release.

## 0.5.0-beta.3

No changes in this release.

## 0.5.0-beta.2

No changes in this release.

## 0.5.0-beta.1

No changes in this release.

## 0.5.0-beta.0

No changes in this release.

## 0.4.1

No changes in this release.

## 0.4.1-beta.6

No changes in this release.

## 0.4.1-beta.5

No changes in this release.

## 0.4.1-beta.4

No changes in this release.

## 0.4.1-beta.3

No changes in this release.

## 0.4.1-beta.2

No changes in this release.

## 0.4.1-beta.1

No changes in this release.

## 0.4.1-beta.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.4.0-beta.3

No changes in this release.

## 0.4.0-beta.2

No changes in this release.

## 0.4.0-beta.1

No changes in this release.

## 0.4.0-beta.0

No changes in this release.

## 0.3.3

No changes in this release.

## 0.3.3-beta.1

No changes in this release.

## 0.3.3-beta.0

No changes in this release.

## 0.3.2

### Patch Changes

- Fixed: An assistant connected with nothing configured is now told which settings are missing, instead of being shown an empty list of searches.

## 0.3.2-beta.15

No changes in this release.

## 0.3.2-beta.14

No changes in this release.

## 0.3.2-beta.13

No changes in this release.

## 0.3.2-beta.12

No changes in this release.

## 0.3.2-beta.11

No changes in this release.

## 0.3.2-beta.10

### Patch Changes

- Fixed: An assistant connected with nothing configured is now told which settings are missing, instead of being shown an empty list of searches.

## 0.3.2-beta.9

No changes in this release.

## 0.3.2-beta.8

No changes in this release.

## 0.3.2-beta.7

No changes in this release.

## 0.3.2-beta.6

No changes in this release.

## 0.3.2-beta.5

No changes in this release.

## 0.3.2-beta.4

No changes in this release.

## 0.3.2-beta.3

No changes in this release.

## 0.3.2-beta.2

No changes in this release.

## 0.3.2-beta.1

No changes in this release.

## 0.3.2-beta.0

No changes in this release.

## 0.3.1

### Patch Changes

- Fixed: A clearance for a new client can be ordered through an assistant connector without setting up a company first.
- Fixed: Removing somebody's access now ends their assistant's connection on its next request. Until now an assistant that had already connected kept the access it started with for up to half an hour.
- Fixed: Ask your assistant for a client's recent searches by the client's name and it finds them. Every search in the list now says which client it was for, and which project. A search whose own record cannot be read says so, instead of appearing to belong to nobody.
- Fixed: A clearance that stops now always records that its notice is still owed, so a failure cannot be passed over as already handled.
- Fixed: Sending an access key to the engine's network address now gets a refusal that says so. It reports that the address takes an identity from the sign-in proxy and never a key.
  
  Fixed: That refusal also names the local door where a key is accepted. Before, it reported only a missing sign-in assertion, which sent operators to the wrong configuration.
  
  For operators: A program on the same machine can now reach the engine's local key door without setting a host name for it. The local door no longer applies a browser protection that only a network address needs.
- New: The free preview of a search lists, for each territory ordered, which registers legally bind it.

## 0.3.1-beta.4

No changes in this release.

## 0.3.1-beta.3

### Patch Changes

- Fixed: Removing somebody's access now ends their assistant's connection on its next request. Until now an assistant that had already connected kept the access it started with for up to half an hour.
- Fixed: Ask your assistant for a client's recent searches by the client's name and it finds them. Every search in the list now says which client it was for, and which project. A search whose own record cannot be read says so, instead of appearing to belong to nobody.

## 0.3.1-beta.2

### Patch Changes

- Fixed: A clearance for a new client can be ordered through an assistant connector without setting up a company first.
- Fixed: Sending an access key to the engine's network address now gets a refusal that says so. It reports that the address takes an identity from the sign-in proxy and never a key.
  
  Fixed: That refusal also names the local door where a key is accepted. Before, it reported only a missing sign-in assertion, which sent operators to the wrong configuration.
  
  For operators: A program on the same machine can now reach the engine's local key door without setting a host name for it. The local door no longer applies a browser protection that only a network address needs.
- New: The free preview of a search lists, for each territory ordered, which registers legally bind it.

## 0.3.1-beta.1

No changes in this release.

## 0.3.1-beta.0

### Patch Changes

- Fixed: A clearance that stops now always records that its notice is still owed, so a failure cannot be passed over as already handled.

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

- Fixed: On an install run with `clearotron start`, a connected assistant now lists the same saved searches as the portal, including Generic's. `clearotron doctor` no longer says working saved searches are off, and it names one place profiles come from.

## 0.3.0-beta.4

No changes in this release.

## 0.3.0-beta.3

No changes in this release.

## 0.3.0-beta.2

### Patch Changes

- Fixed: An assistant reading a knockout's filings through the connector now gets each filing's page at the trade mark office, as the report does. Where that register publishes no page for a single record, it gets the office and the number instead. Before, it got a reference that opens nowhere.

## 0.3.0-beta.1

### Patch Changes

- Fixed: A company you create in the browser now appears in your assistant's list of companies straight away.
  
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

- New: Ask a what-if about a delivered report and get a supplementary memo over its archived evidence, without touching the report.

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- Fixed: An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

## 0.1.1-beta.1

### Patch Changes

- An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

## 0.1.1-beta.0
