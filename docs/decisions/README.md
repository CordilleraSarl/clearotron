# Decisions

Architecture Decision Records. One file per ruling that would otherwise be re-argued.

**Read these before proposing a change to what they cover.** A decision recorded here is settled: it was
made deliberately, with the evidence and the consequences written down. Re-open one by adding a new record
that supersedes it, never by quietly doing something else.

A task closes and a release ships; both have end dates and both live elsewhere — issues, and git
history. A decision has no end date, which is why it needs a home of its own.

| # | Decision | Status |
|---|---|---|
| [0001](0001-register-ladder.md) | Signa is the recommended register; the ladder has three tiers | Accepted |
| [0002](0002-no-dark-functionality.md) | A switch that silently changes output does not ship | Accepted |
| [0003](0003-credential-model.md) | One model credential, one register, one research key — and degradation is disclosed | Accepted |
| [0004](0004-documentation-structure.md) | README front doors, ADRs for decisions, no hand-kept changelogs | Accepted, amended 2026-08-31 (: the release pipeline compiles the root changelog) |
| [0005](0005-comments-carry-reasoning.md) | Source comments carry reasoning, not history | Accepted |
| [0006](0006-what-the-public-repository-carries.md) | The public repository carries what you need to install, choose, run and change — nothing else | Accepted, amended 2026-08-31 (: the compiled changelog travels) |

## Writing one

Four headings, and short. Context (what forced the decision), Decision (what we do), Consequences (what
this costs and what it forbids), and Evidence where a claim needs it — file and line, or a measurement with
its date. If it runs past a page, the decision is probably two decisions.
