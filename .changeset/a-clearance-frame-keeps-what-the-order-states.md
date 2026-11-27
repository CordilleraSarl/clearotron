---
"clearotron-driver": minor
---

Fixed: A clearance could lose the product or the sales channels an order stated, when its matter frame left them out and every later stage read the frame. The frame now carries what the order states about the product, the goods or services, the use and the sales channels, each with where it was found: the order's own fields, or a labelled line of the request, including a form sent as a table or run together on one line. Nothing is inferred, and no order is refused for it.
