# Report-page samples

Two saved runs the report-page guard (`driver/test/render-frozen.test.mjs`) publishes beside the `demo/` runs. Each draws
part of a report page that no demo reaches:

- `knockout-with-findings` is a Knockout run in the filings-first order with two findings: one that weighs a register
  filing, drawn before the filing cards, and one that rests on web use alone, drawn after them. The Knockout demo has
  no findings, so without this run no Knockout finding block is compared.
- `clearance-the-read` is a clearance run whose first card carries a "The read" block and whose findings carry their
  legal and practical positions with no risk-assessment bullet to replace them, so the card's "The read" fold and the
  positions are drawn.

Every name, owner, filing number and address in them is invented, and every address uses the reserved `example.test`
domain. They make no model turn and no register call. After changing either, re-stamp the record as the guard's header
says.
