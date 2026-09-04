# Email template — Generic (RETIRED — a record, not an instruction)

> **Nothing composes from this file, and no seat should draft against it.** The client email is one
> cover note built in CODE by `composeEmailHtml` (`driver/publish/index.mjs`), pointing at the published
> report; the notify seat sends the driver's file byte-for-byte and authors none of it. `email` stopped
> selecting a body when the cover note landed — every customer gets the same shape.
>
> This file is kept as the record of the per-customer body that used to exist, so a reader tracing why
> the delivery shape changed can see what it replaced. **The live spec for the cover note is
> Deliverable 1 in [SKILL.md](../../SKILL.md); the confidentiality marking is `confPosture` in
> `shared/brand.mjs` and nowhere else.**

The default client-facing email format. Used when the forwarded request resolved to any client without a per-customer template (e.g. demo customers, internal test runs, new clients). Tight bullets, no customer-specific framing.

## Structure

The email body has these blocks, in this order:

### Opening

> "Hi [first name from request],
>
> Prelim for [mark name] complete — findings below; full audit Excel attached."

(For internal test runs, use "Hi [forwarder first name]" and add a one-line context note: "v[N] test run — replied to you only, not forwarded to [client].")

### Headline read and recommendation

One sentence stating the overall risk read for the mark, followed by one sentence on our recommendation:

> "Overall: [Low / Medium / Medium-High / High] risk on [target classes].
> Recommendation: [proceed / proceed-with-X / consider alternate / hold pending further investigation] — hedge form acceptable for borderline calls."

If multiple marks, one block per mark.

### Per-mark findings

For each mark, three bullet lists:

```
[MARK NAME]

Direct conflicts (consumer-confusion risks):
- [Finding 1 from placement-recommendations headline-candidates — 1-2 sentences with owner, jurisdiction, classes, Stage-2 mitigants]
- [Finding 2 ...]

Commercial context (lower-tier register findings, watchlist items):
- [From sheet-2 + watchlist-annex placements — 1 sentence each]

PR / reputational:
- [Findings, or "None identified" if clean]
```

### Closing

> "Local-counsel / further-investigation flags:
> - [Any flags from the workflow audit summary — non-use revocation assessments needed, jurisdiction-specific verification, etc.]
>
> Full audit trail in the attached Excel."

## Style rules

- **Tight.** Each finding bullet is 1-2 sentences. No methodology prose anywhere in the email body.
- **No methodology in the body.** "Variants generated: N. Sub-skills invoked: ..." — that's audit material, lives in the Excel Methodology tab.
- **Game-title developer attribution mandatory.** Common-law game-title findings MUST include `developer_of_record` / `publisher_of_record` from common-law-findings.md. If not extracted, write "(developer unverified)" rather than confabulating.

## What goes in the email body vs. the Excel

**Email body (this template):**
- One-line opening
- Headline risk read
- Per-mark findings (3 bulleted categories)
- Local-counsel flags
- Closing

**Excel (the Generic Excel template):**
- Findings sheet (full structured candidates per `placement-recommendations`)
- Negative Results
- Out-of-Scope / Filtered (carries matter-context off-field reasoning)
- Audit Trail (full search log + touchpoint reasoning)
- Methodology (matter-context summary + search approach + placement-inquiry summary + narrative-refutation verdict + open verification flags)

## Recipients

- If the reviewing lawyer sent it → reply to the reviewing lawyer, CC the forwarder
- If the forwarder sent it → reply to the forwarder only
- Never reply directly to the original requester
