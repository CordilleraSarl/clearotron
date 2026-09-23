# Security mapping: OWASP risks for AI applications

*Each risk on OWASP's two lists for AI systems, what Clearotron does about it, and the file on `main`
where that lives. Where nothing does, the row says so and why.*

The two lists are the [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) and
the [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/).
Who may see which runs, and how a key is checked, is stated once in [SECURITY.md](SECURITY.md). This page
links there rather than repeating it.

## How a clearance uses AI

A clearance runs as a series of stages. For each stage the driver, which is ordinary code, starts one AI
program: Anthropic's Claude Code or OpenAI's Codex. The stage gets a written task, the tools named for
that stage, and its run folder. Code checks every file a stage writes before any other stage reads it.
The register searches are fixed in a plan before the register stages run, and code runs them. Code also
renders the report, from the checked files.

## OWASP Top 10 for LLM Applications 2025

### LLM01:2025 Prompt Injection

**Here.** Stages read web pages, marketplace listings and register records, and any of them can carry
text written to steer the model.

**What Clearotron does.** Each stage's tools are granted by name. The case-law stage is the exception: it is granted every tool its two case-law services offer. A tool outside that
grant that needs permission is refused. A Claude stage is offered no tool that runs a command. A Codex stage keeps its shell inside Codex's own sandbox, and Codex approves tool
calls only for the tool servers Clearotron starts for that stage. The AI program starts with a named list
of settings rather than the install's settings file, so the key that signs access keys is not in it.
Codex's page-fetching tool refuses loopback, private, link-local and cloud-metadata addresses. It checks
the address a name resolves to, and checks again on every redirect.

**Where.** `driver/engine/mcp/gather-config.mjs` (the tools each stage holds),
`driver/engine/anthropic-agent.mjs` (`COMMAND_TOOLS`), `driver/engine/mcp/codex-config.mjs`,
`driver/engine/engine-env.mjs`, `driver/engine/mcp/public-fetch.mjs`.

**Not covered.** Content from the web is not marked as untrusted in the text a stage reads. That text is
what the engine reasons from, so changing it is a design decision of its own.

### LLM02:2025 Sensitive Information Disclosure

**Here.** A report, the portal or a connected assistant shows one company's clearances to another, or
shows the engine's internals to a company's people.

**What Clearotron does.** Every read passes one authorization check, and a person sees only what their
grant names. A key bound to one run reads that run and writes nothing. The copy of a report a company
receives drops the staff-only notes. No real company's data is in this repository; run data lives
in folders the operator owns. CI scans the tree and the built bundle for secrets.

**Where.** [SECURITY.md](SECURITY.md) (the access model), `shared/scope.mjs`, `driver/portal-report.mjs`,
`.gitleaks.toml`, `.github/workflows/ci.yml`.

**Not covered.** A company's clearances are kept until the operator deletes them: Clearotron sets no
retention period, because how long they are held is the operator's policy.

### LLM03:2025 Supply Chain

**Here.** A compromised npm package, GitHub Action or engine program.

**What Clearotron does.** Dependabot updates the npm packages and the GitHub Actions. Each release is
published to npm through trusted publishing, with provenance that ties the package to the commit and the
build that produced it. A stable release is not published while a code-scanning alert is open. Setup
installs, and `clearotron doctor` accepts, only an engine program at or above the version this release
needs.

**Where.** `.github/dependabot.yml`, `.github/workflows/release.yml`,
`scripts/release-code-scanning-check.mjs`, `driver/driver.config.mjs` (`ENGINE_BINARIES`, each program's
`floor`).

### LLM04:2025 Data and Model Poisoning

**Here.** Tampering with what the model learns from, so that it concludes wrongly.

**What Clearotron does.** Clearotron trains and fine-tunes no model. The instructions every stage reads
are versioned in this repository. On the Claude engine a check refuses any write by a stage into those
instructions, into the company profiles, or into the run's own control folder.

**Where.** `driver/skills/` (the instructions), `driver/engine/deny-authority-write.mjs`,
`driver/authority-trees.mjs`.

**Not covered.** Codex has no such check. A Codex stage can write anywhere in its run folder, the control
folder included, because Codex offers no hook at the moment of a write.

### LLM05:2025 Improper Output Handling

**Here.** Model output passed on to something that runs or renders it unchecked.

**What Clearotron does.** A stage's output is a file, and code checks it against that stage's contract
before anything uses it. A file that fails is retried or fails the stage; it is never passed on. The
report is rendered by code from checked files, and no file a stage writes runs on the install's machine.
The common-law search asks the research service to run a search program, on that service's own servers.

**Where.** `driver/gateway.mjs` (`runStage`), `driver/stages.mjs` (each stage's contract),
`driver/publish/`.

### LLM06:2025 Excessive Agency

**Here.** A stage that can do more than its task needs: run commands, spend, write where it should not.

**What Clearotron does.** Tools are granted per stage, by name. The case-law stage is the exception: it is granted every tool its two case-law services offer. A Claude
stage is offered no command tool.
Register searches beyond the fixed plan go through a proposal that code checks and runs. A key issued for
automation can be limited to named actions. A what-if requested by a company's people is queued for a
separate process rather than run by the door that received it.

**Where.** `driver/engine/mcp/gather-config.mjs`, `driver/engine/anthropic-agent.mjs`,
`driver/engine/mcp/supplemental.mjs`, `shared/scope.mjs`, `driver/whatif-worker.mjs`.

**Not covered.** As ASI02: the Claude program also offers a stage built-in tools that act without asking.

### LLM07:2025 System Prompt Leakage

**Here.** The instructions given to the model leak, and with them anything secret they hold.

**What Clearotron does.** The instructions are published in this repository and hold no credential.
Credentials reach the tool servers through their environment, never through text a model reads.

**Where.** `driver/skills/`, `driver/engine/engine-env.mjs`.

### LLM08:2025 Vector and Embedding Weaknesses

**Not applicable.** Clearotron keeps no vector store and computes no embeddings. The one search over
finished runs is a word search.

**Where.** `mcp-server/lib/lexsearch.mjs`.

### LLM09:2025 Misinformation

**Here.** A report states a conflict that is not there, or misses one that is.

**What Clearotron does.** Register counts come from the register, never from the model, and a register
finding names the register record it rests on. A search that could not run is listed in the report as a gap,
never reported as a clean result. Before a report is published, separate stages argue against its
conclusions.

**Where.** `driver/register-plan.mjs`, `providers/_shared/execute-plan.mjs`, `driver/stages.mjs`,
[architecture/07-quality-and-audit.md](architecture/07-quality-and-audit.md).

### LLM10:2025 Unbounded Consumption

**Here.** A run that consumes model time or money without limit.

**What Clearotron does.** Each stage runs under a stall watchdog and a hard time limit, and a failing
stage stops retrying once a retry would repeat the same failure. An install runs a set number of
clearances at a time. The connector doors limit requests per identity.

**Where.** `driver/engine/common.mjs`, `driver/engine/anthropic-agent.mjs`, `driver/gateway.mjs`,
`mcp-server/lib/http-handler.mjs`.

**Not covered.** There is no spend ceiling on a search. By policy, no model is given a time, token or cost
budget.

## OWASP Top 10 for Agentic Applications 2026

### ASI01 Agent Goal Hijack

**Here.** Text a stage reads redirects it to a goal that is not the clearance.

**What Clearotron does.** The controls under LLM01 above. The stage's task is also fixed by the driver,
and code checks what the stage hands back against that task's contract.

**Where.** As LLM01, and `driver/stages.mjs`.

**Not covered.** As LLM01: web content is not marked as untrusted.

### ASI02 Tool Misuse

**Here.** A stage uses a legitimate tool for something its task does not need.

**What Clearotron does.** Each stage is granted its tools by name. The case-law stage is the exception: it is granted every tool its two case-law services offer. A tool outside
that grant that needs permission is refused. Codex's approval covers only the tool servers Clearotron starts for the stage, and
Codex's fetch tool refuses internal addresses. Register
calls follow the fixed plan or a proposal code checks. Every tool call is written to the run's tool-call
log, and each stage's attempt record counts the calls made and the calls refused.

**Where.** `driver/engine/mcp/gather-config.mjs`, `driver/engine/mcp/codex-config.mjs`,
`driver/engine/mcp/public-fetch.mjs`, `driver/engine/mcp/stdio-server.mjs` (the tool-call log),
`driver/gateway.mjs` (`toolGauge`).

**Not covered.** The Claude program also offers every stage some of its built-in tools that need no
permission: starting a subagent, which keeps the stage's restrictions; scheduling a task on the operator's
Claude account; messaging the account's other sessions; and sending a notification. Clearotron does not
remove them.

### ASI03 Identity and Privilege Abuse

**Here.** A stage acts with more authority than its task, or takes a credential it can reuse.

**What Clearotron does.** The AI program starts with a named list of settings, and the key that signs
access keys is not on it. The worker that starts the AI program does not hold that key either, whether
the install runs in a terminal or under systemd. Access keys are scoped to a run, a company or named
actions, and one check enforces the scope. On Claude, a stage's file tools read only its run folder, its
instruction folders and any folder the machine's own Claude settings add. On Codex with its sandbox on, a
stage's commands read only its run folder, its instruction folders, the temporary folders, and the system
and program files a command needs to run.

**Where.** `driver/engine/engine-env.mjs`, `bin/start.mjs` (`SIGNING_KEY_NAMES`),
`driver/systemd/clearotron-worker.service`, `shared/scope.mjs`, `driver/engine/anthropic-agent.mjs`
(`READ_FENCE`), `driver/engine/mcp/codex-config.mjs` (`fenceToml`).

**Not covered.** With Codex's sandbox off, a stage's commands run with every permission of the install's
account and can read any file it can, the settings file included. With it on, the temporary folders are
shared by every stage of the install, so a stage's commands can read what another stage left there.

### ASI04 Agentic Supply Chain Vulnerabilities

**Here.** A tool server or engine component that a stage trusts is compromised.

**What Clearotron does.** The tool servers a stage uses are Clearotron's own code in this repository. Two
of them are bridges Clearotron starts to the case-law services CourtListener and Legal Data Hunter, and
they pass through the tools those services define. On Codex, the configuration written for each turn lists
only the servers granted to that stage. The supply-chain controls under LLM03 apply here too.

**Where.** `driver/engine/mcp/`, `providers/oauth-mcp-bridge/bridge.mjs`,
`driver/engine/mcp/codex-config.mjs`.

### ASI05 Unexpected Code Execution

**Here.** A stage is talked into running code.

**What Clearotron does.** A Claude stage has no tool that runs a command: Bash, PowerShell and Monitor
are removed by name from every stage. A Codex stage runs its commands inside Codex's own sandbox. They
can read only the stage's own folders, the temporary folders, and the system and program files a command
needs to run, and write only its run folder and the temporary folders. Before a search is paid for, a
check runs one turn through the engine with the settings the search will use.

**Where.** `driver/engine/anthropic-agent.mjs` (`COMMAND_TOOLS`), `driver/engine/openai-agent.mjs`
(`buildCodexArgs`), `driver/engine/mcp/codex-config.mjs` (`fenceToml`), `driver/engine/probe.mjs`.

**Not covered.** Where Codex's sandbox cannot start on a machine, the setting
`CLEAROTRON_CODEX_SANDBOX_BYPASS=1` runs Codex without it, and a stage's commands then run with every
permission of the install's account. The engine check says when a machine needs it.

### ASI06 Memory and Context Poisoning

**Here.** Poisoned content persists and steers later work.

**What Clearotron does.** The engine keeps no memory of its own: every stage starts from its task and its
run folder, and a retried stage resumes only its own session. What does persist between runs is each
company's configuration, its profile, risk framework and background notes, which every run reads and which
only people with Manage can edit in the portal. On the Claude engine a stage cannot write to it.

**Where.** `driver/gateway.mjs` (`runStage`), `driver/profiles.mjs`, [SECURITY.md](SECURITY.md) (who
holds Manage), `driver/engine/deny-authority-write.mjs`.

**Not covered.** As LLM01: web content that a stage reads, and that a later stage reads in its output, is
not marked as untrusted.

### ASI07 Insecure Inter-Agent Communication

**Not applicable in its usual sense.** Stages do not message each other. The driver passes files from one
stage to the next, and checks each one first.

**Where.** `driver/gateway.mjs`, `driver/stages.mjs`.

### ASI08 Cascading Failures

**Here.** One failed stage corrupts the stages after it.

**What Clearotron does.** Code checks each stage's output before the next stage reads it. A stage whose
retries fail the same way twice stops retrying, and a stage whose every tool call was refused stops after
one attempt. The engine check before a search refuses a machine that would fail every stage.

**Where.** `driver/gateway.mjs`, `driver/engine/probe.mjs`, `driver/engine/tool-refusal.mjs`.

### ASI09 Human-Agent Trust Exploitation

**Here.** A reader trusts a confident report more than its evidence supports.

**What Clearotron does.** A register finding names the register record it rests on, and every search that
could not run is listed in the report.

**Where.** `driver/publish/`, `driver/register-plan.mjs`.

### ASI10 Rogue Agents

**Here.** An agent that keeps running, spreads, or acts outside its task.

**What Clearotron does.** No agent outlives its stage. Each stage is one process under a watchdog and a
hard time limit, and the driver stops its whole process group. The driver records every program it
starts. On the Claude engine a stage cannot write into the instructions it runs from.

**Where.** `driver/engine/anthropic-agent.mjs`, `driver/engine/common.mjs`,
`driver/engine/child-record.mjs`, `driver/engine/deny-authority-write.mjs`.

**Not covered.** As LLM04: on Codex, no check refuses a stage's write inside its run folder.

## Repository protections

Measured on 2026-09-23 with the GitHub API.

| Protection | State |
|---|---|
| Secret scanning | On |
| Push protection | On |
| CodeQL (Actions, JavaScript and TypeScript) | Configured, and a required check on `main` |
| Code scanning before a stable release | A stable is not published while an alert is open |
| Private vulnerability reporting | On |
| npm provenance | Every release, through trusted publishing |
| Required checks on `main` | Six; force pushes and branch deletion refused |
