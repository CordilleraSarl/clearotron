---
"prelim-driver": patch
---

Fixed: The link in your completion email and message now opens the report. It previously pointed at a path the site does not serve, so it led to a sign-in and then a dead page. This affected every delivered report on both search products, in the email, the chat notice and the assistant's own answer. The workbook link in the same email was always correct and is unchanged.

Fixed: The chat notice now goes to the person who ordered the search, with the operator keeping a copy they can switch off. Before, it went only to whoever runs the service, so the requester was never told their search had finished.

For operators: hold requesters' numbers in CLEAROTRON_REQUESTER_WHATSAPP, keyed by email address or by the handle a request arrives under. Where no number is held, the delivery record says so by name instead of quietly sending the notice to you. Set CLEAROTRON_WHATSAPP_OPERATOR_COPY=0 to stop receiving copies of other people's runs.
