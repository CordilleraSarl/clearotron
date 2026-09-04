# Example flows — ops connector

## Intake from an email (the common case)

Request: *"Please run a worldwide preliminary search for ZORVAPLUS, classes 5 and 32, for
[customer]. Run ZorvaPlus only — the other marks aren't requested yet."*

The agent: `list_profiles` → resolves the customer to a profile key by judgment → ONE `start_run`:

```json
{ "markName": "ZorvaPlus", "classes": [5, 32], "customer": "<applicant as stated>",
  "profileKey": "<resolved key>", "forwarder": "jordan", "forwarderEmail": "jordan@firm.example",
  "worldwide": true,
  "upfrontInstructions": "Run ZorvaPlus only (first/high-priority mark). The other marks are NOT requested yet.",
  "msgId": "<the email's native message id>" }
```

`worldwide: true` is there because the requester asked for worldwide. Omitting `jurisdictions`
means "whatever the account's defaults say", which is a different search — never let the two stand
for each other, and never send `"Worldwide"` as a `jurisdictions` entry.

Then it stops. No polling loop, no status chatter — the outbox brings the outcome.

## A validation refusal

`start_run` returns `classify: "clarify"` with `errors: ["neither classes nor goods present"]` →
the agent replies to the requester asking for the classes or a goods description, threaded on the
original message. It does not guess.

## Late applicant binding

Requester (mid-run): *"the applicant will be Zephyr Beverages Ltd"* → `feed_context { runId,
customer: "Zephyr Beverages Ltd" }` → the outbox later carries a `late-bind-ack` to relay.

## Courier wake

`list_outbox_events` → one `delivered` event → `get_delivery_packet` → send the embedded HTML
verbatim, threaded on the packet's `msgId` → `mark_sent { runId, messageId }`. A second wake finds
nothing pending and exits — the loop is idempotent.
