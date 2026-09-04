# docs/architecture — how the system is built and operated

Ten reference documents, numbered so they read in order. Each answers one question about the system as
built. If you are installing rather than studying it, [`../../INSTALL.md`](../../INSTALL.md) is the
document you want; this directory is what you read when the install has raised a "but why is it like
that" question, or when you are changing something and need to know what depends on it.

| Doc | Answers |
|---|---|
| [`01-product-overview.md`](01-product-overview.md) | What the four products are, what each promises, and what a clearance is not |
| [`02-architecture.md`](02-architecture.md) | The components and how work moves between them |
| [`03-run-lifecycle.md`](03-run-lifecycle.md) | One run from intake to delivered packet — every stage, gate and resume point |
| [`04-configuration-reference.md`](04-configuration-reference.md) | Every environment variable, what reads it, and what unset means |
| [`05-config-governance.md`](05-config-governance.md) | The rules configuration obeys: who may add a name, and the drift classes |
| [`05-customer-profiles.md`](05-customer-profiles.md) | The per-customer profile: what it carries and how a run resolves one |
| [`06-operations-runbook.md`](06-operations-runbook.md) | Running a deployment — the units, the triggers, and what to do when one wedges |
| [`07-quality-and-audit.md`](07-quality-and-audit.md) | How the engine proves what it claims: the ledger, the witness, the refutation gate |
| [`08-development-guide.md`](08-development-guide.md) | Working in the code — the test tiers, the seams, the conventions |
| [`09-security-and-data.md`](09-security-and-data.md) | What leaves the machine, who may read what, and where each boundary is enforced |

**Two files are numbered `05`.** `05-config-governance.md` and `05-customer-profiles.md` are unrelated
subjects that collided; the numbers are a reading order, not an identifier, and nothing resolves a document
by its prefix. Renumbering means fixing every inbound link in the same commit
(`node scripts/markdown-link-check.mjs` is the gate), so it has not been done for tidiness alone.

## Where to start, by what you are doing

- **Understanding a verdict** — `01`, then `07`. The products decide what a run promises; the audit surface
  is how a finished run can be shown to have kept it.
- **Changing the pipeline** — `03`, then `08`. The lifecycle names every stage and gate; the development
  guide names the seams and which tier a new test belongs in.
- **Adding configuration** — `04` and `05-config-governance.md`, in that order, and expect to add a row.
  A new environment variable without one fails CI.
- **Operating a deployment** — `06`, then `09`. Everything about hostnames, service units, tokens and who
  can read which run lives across those two.

## Two things these documents are not

**Not the register contracts.** What each register can and cannot search is derived from each adapter's own
`capabilities.js`, and [`../../providers/README.md`](../../providers/README.md) is the front door. A
capability claim in prose here would be a second copy of a value that is probed elsewhere.

**Not the rulings.** Where a decision was settled and why it is not re-argued lives in
[`../decisions/`](../decisions/README.md). These documents describe the system; an ADR explains why it is
that system and not another one.
