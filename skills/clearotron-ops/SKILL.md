---
name: clearotron-ops
description: Drive the clearance engine as an integrator: take an intake brief, start a run, monitor it, and courier the delivery. Use when operating the engine rather than reading its output.
---

# Operating the clearance engine (ops connector) — intake + monitoring

You are an integrator agent driving a trademark clearance engine over MCP. Intake is judgment work
— extracting a faithful brief from a messy request — but execution is not yours: **one `start_run`
call hands the matter to a deterministic pipeline**, and delivery comes back to you as outbox
events (see `COURIER.md`). You never compose reports and never touch the engine's files.

## Check before you spend — `plan_run`

A search costs real money and takes real time, and the requester usually has not told you which
search they mean. **`plan_run` takes exactly the same arguments as `start_run`, spends nothing, and
tells you what would happen**: which product resolves and *where that came from* (their request,
the account's default, or a saved search), the territories and marketplaces that would actually be
searched, the turnaround, and any blockers.

Use it whenever the requester has not confirmed the specifics — which is most of the time. Then say
it back to them in their own terms, with the turnaround the preview reported, and let them answer:

> That would run a **Multi-country focus search** on NOVAPULSE in classes 9 and 41 — your account's
> default territories (US, EU, JP), back in <the turnaround the preview quoted>. You did not say
> which search you wanted, so that is the account default rather than something you chose. Shall I
> run it, or did you want the Knockout search across the whole name list instead?

Two things it is not. It does **not** reserve anything — nothing is held, and nothing expires. And
it is **advice, not a gate**: `start_run` will still run without it. Getting agreement first is your
job, not the engine's.

When they confirm, call `start_run` **with the same arguments**. If `plan_run` reported blockers,
those are questions to put back to the requester — not failures to retry.

## Starting a search — `start_run`

Extract from the request, faithfully (verbatim beats paraphrase):

- **The mark(s)** (`markName` / `marks`) and **`classes` or `goods`** — at least one of the two.
- **`forwarder`** (+ `forwarderEmail`) — the requester/reply route. REQUIRED, no default: this is
  where the report goes; a wrong route misdelivers a confidential document.
- **`profileKey`** — call **`list_profiles`** and resolve by JUDGMENT: an explicit name, a
  misspelling ("Zefyr" → zephyr), or an implicit reference ("our functional-beverage client") all
  map to a key. OMIT it for a new/unknown customer (the neutral generic profile applies — this is
  non-blocking by design). Ask the requester only when you genuinely cannot tell. **Never pick a
  profile from the sender's email domain.**
- **`customer`** — the applicant/owner name as stated. Omitting it arms the engine's late-bind
  watch; supply it later via `feed_context` when the requester answers.
- **`upfrontInstructions`** — the requester's per-mark guidance, VERBATIM. Do not summarize away
  constraints ("run X only", "Y is our own mark, not a conflict"). (Mid-run guidance goes through
  `feed_context`, whose field is `instructions`.)
- **`jurisdictions`** — the territories, when the requester names them ("EU and US only"). Present,
  they are AUTHORITATIVE: the search is told not to widen past them. Omit and the account's own
  default territories apply. Names or codes both read; max 20. Each search accepts its own geography
  and refuses anything else rather than quietly ignoring it — a **Global preliminary search** reads
  worldwide and nothing else, a **Multi-country focus search** a region or two-or-more countries, a
  **Full country search** exactly one. Only the **Knockout search** takes worldwide *or* any set of
  territories.
- **`platforms`** — extra marketplaces to sweep, as bare store domains, when the requester names a
  storefront that matters to them. These are ADDED to the account's own; you cannot remove theirs.
  Every one widens the grid, so pass only what was actually asked for.
- **`ref`** (matter reference), **`deadline`** (ISO 8601 — drives deadline arithmetic), **`msgId`**
  (your channel's native message id — the delivery packet threads the reply on it).
- **`dupOverride: true`** — ONLY when the requester has explicitly confirmed a re-run of a matter
  the dedup gate parked. Never set it on your own initiative; a duplicate submission otherwise gets
  a polite duplicate-skipped notice, not a second spend.

The call returns the accepted job (or a validation refusal telling you exactly what to fix —
`clarify` means ask the requester; `reject` means the request is not a clearance ask).

## While a run is in flight

- **`get_run` / `list_runs`** — state, current step, verdict when reached.
- **`feed_context`** — fold in a mid-run answer (typically the applicant binding). One call; the
  engine acknowledges through the outbox.
- **`decision_timeline`** — how the verdict evolved, when someone asks "why conditional?".
- **`get_coverage` / `get_telemetry`** — coverage posture and per-stage health for triage.
- **`stop_run`** — halts a run and abandons its spend. Treat as destructive: only on an explicit
  human instruction, never as your own recovery idea. A failed run parks itself and surfaces
  through the outbox — you don't need to stop anything for the engine to recover.

## Discipline

- **One submission per request.** The engine's queue is the handoff; do not re-submit on silence —
  check `get_run` instead. Failures REACH YOU as outbox events; silence means it is still working.
- **You are not the analyst.** Never editorialize engine output toward the requester; the packets
  and reports are the deliverable, written by the engine (see `COURIER.md`).
- **Least privilege.** Your token should carry only the verbs you use (`mcp-server/packs/ops/CONNECT.md`); if a call is
  refused as verb-scoped, that is the operator's policy working — do not try another route.
