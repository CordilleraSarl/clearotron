# Couriering the engine's outbox (ops connector) — delivery

The engine never sends anything. Every requester-facing event lands in its **outbox** as a
self-contained packet; your job is to route each one EXACTLY as written and confirm it over MCP.
You are the courier, not the author.

## The loop (idempotent — safe to run on every wake)

1. **`list_outbox_events`** — every pending event. Handle each by `kind`:

2. **`kind: "delivered"`** — a finished run's report is ready to send:
   a. **`get_delivery_packet { runId }`**. If `sent: true`, it is already couriered — skip (do NOT
      ack; the marker clears on the next `mark_sent`).
   b. Send the email over YOUR channel: to the packet's forwarder route, subject as given, reply
      threaded on the packet's `msgId`, body = `emailBodyHtml` **VERBATIM** — a finished HTML
      fragment; never rewrite, wrap, summarize, or append.
   c. If `whatsappTo` is non-null, send the exact `whatsappText` there — nothing else.
   d. **`mark_sent { runId, messageId }`** — writes the engine's sent-guard and clears the event.
      `alreadySent: true` on a retry is SUCCESS.
   e. There is ONE report and one routing. An archived packet may still carry a `clientReady` field —
      the engine no longer emits it and nothing gates on it; ignore it and route exactly as above.

3. **`kind: "run-failed"`** — relay the packet's `text` to the forwarder (nothing was delivered;
   the engine usually parks resumable state). Then **`ack_event { file }`**.

4. **`kind: "intake-rejected"`** — a request died at validation; `text` says why. For a `clarify`,
   the fix is a question back to the requester — thread it on the packet's `msgId`. Then
   **`ack_event { file }`**.

5. **`kind: "duplicate-skipped"`** — the dedup gate parked a re-submission (no second spend).
   Relay `text` (it explains the confirmed-re-run path). Then **`ack_event { file }`**.

6. **`kind: "late-bind-ack"`** — a mid-run context binding was folded in; relay the one-liner.
   Then **`ack_event { file }`**.

## Discipline

- **Verbatim.** Every `text` and `emailBodyHtml` is ready to send. Your judgment is not wanted in
  the payload — only in faithful routing.
- **Never invent a recipient.** Route only to the packet's forwarder/whatsappTo. A packet with no
  usable route gets reported to your operator, not guessed.
- **Idempotent, no retry loops.** `mark_sent`/`ack_event` are safe to repeat. If a SEND fails,
  leave the event pending (no mark, no ack), log it, and let the next wake retry once — persistent
  failures go to your operator.
- **A delayed send is never data loss.** The report is already published; the event stays pending
  until you confirm it.
