// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Central paths + tunables for the prelim-search deterministic driver.
//
// The driver runs as an ordinary UNIX service account (launched by systemd), NOT as an LLM agent.
// The agent exec-deny is a gateway agent-tool restriction; it does not apply to this OS process.
// Every value is env-overridable so the identical code runs from a developer's shell and from the
// systemd unit on a deployed host.

import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, existsSync, accessSync, statSync, statfsSync, constants as FS } from "node:fs";
import { homedir } from "node:os";
import { envFrom } from "../shared/env-aliases.mjs";   // — an operator-facing name is the one an operator sets, and it has to work where they set it; — envFrom is the resolver that reads every spelling of it
import { invoke } from "../shared/invocation.mjs";   // — name a command the reader can actually type
import { numericSetting, resolveNumericSetting } from "./numeric-setting.mjs";   // — a number, or a refusal that names the variable; never NaN

const { X_OK } = FS;

// The driver's own dir (…/driver) — the parent of the relocated compute-skills tree
// (Phase 3 moved the compute skills here from each agent workspace). Resolved from the module path so it
// is correct regardless of cwd (the systemd unit sets WorkingDirectory, but a CLI/test run may not).
const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
// The checkout root (…/driver's parent) — used only to spell out the absolute form of a relative
// CLEAROTRON_CLAUDE_PATH in preflightEngineBinary's refusal, so the reader can paste the fix.
const REPO_ROOT = dirname(DRIVER_DIR);
// The process's own home, and nothing else. This used to consult an integrator platform's HOME
// variable first and fall back to homedir(); the two never disagreed on a deployed box (systemd set it
// to %h, which IS homedir() for the service account), so removing the read changes no path any
// deployment resolves. What it removes is a second answer to "where is home" that only one deployment
// could set — and a path default whose value depended on which product happened to export a variable.
const home = () => homedir();

// ---- the on/off idiom --------------------------------------------------------------------------------
//
// The house spelling for a behavioural gate is `process.env.X !== "0"` — default ON, the literal "0"
// disables. Flags written as a bare truthiness test do NOT follow it, and the failure is silent and
// backwards: `X=0` is a non-empty string, so it ARMS the feature the operator just tried to switch off.
// That shipped twice (CLEAROTRON_SELFTEST_PATHS_ONLY, CLEAROTRON_DUMP_JSON) and is the reason these exist.
//
// OFF_WORDS is deliberately a SET, not just "0": operators write `off` and `false` too, and a switch
// that recognises one spelling and arms on the others is the same bug wearing a different value. Both
// predicates treat an EMPTY string as unset — an `X=` line in an EnvironmentFile means "not configured",
// never "on".
//
// SCOPE, STATED RATHER THAN IMPLIED. These are NOT yet the single home for the idiom. Four call sites
// read through them today — CLEAROTRON_PLAN_DISPATCH (pipeline.mjs), CLEAROTRON_DUMP_JSON (gateway.mjs),
// CLEAROTRON_SKILLS_STORE_STRICT (skills-store-provenance.mjs). There was a fourth, CLEAROTRON_SELFTEST_PATHS_ONLY,
// and it died with driver/selftest.mjs. The first two are here because they LIED, the third because it was written
// after this note and a new gate has no excuse to spell itself a fifth way. Roughly
// FIVE gates are still inline `!== "0"`: CLEAROTRON_BAND_TRUTH_GATE, CLEAROTRON_REGISTER_GAP_CLAMP,
// CLEAROTRON_RECALL_TRIPWIRE, CLEAROTRON_WARM_RETRY, CLEAROTRON_SATPROBE_CODESIDE. Those are CORRECT — `0`
// disables each, which is what they document — they simply do not accept `off`/`false`/`no`.
//
// IT WAS TEN. Three went with their knobs: CLEAROTRON_TAINT_CHAIN, CLEAROTRON_XCHECK and
// CLEAROTRON_COUNT_FIRST were set by NOTHING — not a deployment, not CI, not the config store, not a test
// — so each was an off-path no reader had ever exercised, which is untested code rather than a
// rollback. The ones that remain stay because the test corpus sets them, and two of them are how a
// hermetic suite keeps from dialling a real provider.
//
// CLEAROTRON_RECALL_PROBES was nearly a fourth and is the cautionary one: five test files disable it with
// `||=`, and the census that cleared it for deletion looked for a plain `=` after the name. Deleting
// it armed the probes in all five. A measurement that cannot see a form reports clean.
//
// Anyone extending the accessors to the rest must update the note in .env.example's conventions header
// in the same change — a header that claims more coverage than the code has is the defect this whole
// file is fixing.
const OFF_WORDS = new Set(["0", "off", "false", "no"]);

/** Default-OFF opt-in (`X=1` arms it). Unset, empty, or an off-word ⇒ false.
 *  `env` defaults to the live environment; a caller that already threads one (the preflights take an
 *  `env` argument so a test can pass a bare object) passes it rather than mutating process.env. */
export const envOn = (name, env = process.env) => {
  const v = env?.[name];
  return v != null && v !== "" && !OFF_WORDS.has(String(v).trim().toLowerCase());
};

/** ONE reader for `CLEAROTRON_NATIVE_LANGUAGE_<CODE>`, and the reason it is not just `envGateOn` is the `env` argument.
 *
 *  FAIL-OPEN BY DOCTRINE, not by preference: kill switches are retired, availability is BUILT-only, and
 *  the switches that remain fail open (search-policy.mjs states it — "`CLEAROTRON_NATIVE_LANGUAGE_<code>` is fail-OPEN
 *  by construction (`?? "1"` — on unless explicitly \"0\")"). A built lane arms unless somebody
 *  explicitly silenced it.
 *
 * — this exists because the flag had FOUR readers and one of them defaulted the other way.
 *  jx-units.mjs and jx.mjs each carried a private `laneEnvOn` (default ON) while the slice-statement
 *  path at jx.mjs:104/121 used the default-OFF `envOn`. With CLEAROTRON_NATIVE_LANGUAGE_ZH unset — which is its state
 *  on every box — the executor armed the lane, dispatched 42 SERP cells and got a provider quota
 *  refusal, while the delivered coverage statement said the lane was "off in this run's own
 *  environment". Same value, computed twice, two answers, and the false one is the one that rendered.
 *
 *  Takes `env` because deriveJxSliceStatement is pure and threads one; `envGateOn` reads process.env
 *  directly and cannot serve a pure caller.
 */
export const laneArmed = (lane, env = process.env) => {
  const v = env?.[`CLEAROTRON_NATIVE_LANGUAGE_${String(lane ?? "").toUpperCase()}`];
  return v == null || v === "" || !OFF_WORDS.has(String(v).trim().toLowerCase());
};

/** Default-ON gate (`X=0` / `X=off` disables it). Unset or empty ⇒ true. */
export const envGateOn = (name) => {
  const v = process.env[name];
  return v == null || v === "" || !OFF_WORDS.has(String(v).trim().toLowerCase());
};

// NOTE (2026-07-16): every env-derived value here is a GETTER, read at ACCESS time — not a plain
// property frozen at first import. The offline test fleet re-imports the driver modules per test with
// a cache-busting query, but `./driver.config.mjs` resolves to ONE cached instance across all of them,
// so import-time captures silently pinned every test to the FIRST test's env (workspace root, pool,
// retries) — the root of the intermittent cross-test contamination flake. Getters make "set env, then
// run" mean what it says, in tests and in prod alike.
export const config = {
  // / — A BLANK VALUE IS NOT A CONFIGURED VALUE. `process.env.X || default` treats "   " as
  // configured, because a whitespace-only string is TRUTHY in JavaScript — so a variable set to spaces
  // did not fall through to the default, it BECAME the path. `poolRoot` alone trimmed, so "blank" meant
  // two different things depending on which accessor you asked, and `queueDirs` resolved a RELATIVE
  // queue directory under the process cwd, which is 's own incident shape.
  //
  // Owner ruling 2026-08-19: a whitespace-only value counts as UNSET, everywhere. `X=` already meant
  // "not configured" and this is that rule finishing its sentence — not a reversal of it, which
  // is why the 13 sites relying on empty-means-unset are untouched: they get the same answer they
  // always did, and only the spaces-shaped near-miss changes.
  //
  // Returns undefined rather than "" so both `||` and `??` call sites keep their existing meaning.
  //
  // — THE NUMERIC HALF, and two of those were broken on the DOCUMENTED spelling, not just on
  // whitespace. `Number("")` is 0 — not NaN — so a blank survives `Number()` and then survives the floor
  // beneath it as a real-looking setting:
  //
  //   maxClaimAgeMs    `?? default` — "" passes through, so CLEAROTRON_MAX_CLAIM_AGE_MS= gave 0, and every
  //                    claim is instantly older than the maximum age. Permanently, silently.
  //   cardConcurrency  `Number.isFinite(n)` — correct for a NON-numeric value, but 0 IS finite, so a
  //                    blank gave 1 instead of 8 rather than falling to the default.
  //
  // Those two failed on `X=`, which documents as "not configured". That is independent of the
  // whitespace ruling and was true before it. The other seven use `||`, where "" is falsy and only the
  // whitespace shape got through.
  //, as it stands after closed the compatibility window. `envFrom` reads ONE name and
  // treats empty as unset; there is no second spelling for it to walk. What survives from is the
  // reason the helper is here at all: a process that never imported `shared/env-local.mjs` and therefore
  // never ran the translation. Before this, that operator read as having set nothing and the value fell
  // through to a default, silently: no error, no warning, a run against a value nobody chose.
  //
  // The owner ruled this seat over widening the entry-point list (2026-08-24): coverage by entry point
  // is only ever as complete as the list, and an incomplete list is the failure this family is about.
  envValue(name) {
    return envFrom(process.env, name);
  },

  // Live workspace root (holds workspace-<agent>/ for every agent).
  //
  // — THE DEFAULT MOVED, AND THE VARIABLE DID NOT. `CLEAROTRON_WORK_DIR` keeps its name; only the
  // fallback changed, from a dot-directory belonging to an integrator platform to
  // `$HOME/trademark/workspace`. There is no compatibility
  // shim to write because there is no old NAME to honour — an operator's `.env` line reads identically
  // before and after. What changed is where an UNSET variable lands, and that is a deployment fact, not
  // an API one. (Contrast `CORSEARCH_*_LOG` in providers/_shared/ledger-path.mjs: that WAS a rename, so
  // the old spelling had to keep working. This is not.)
  //
  // Why it moved: the old default was an integrator platform's own directory, and README.md states in
  // bold that this engine does not require any such platform. A first-time reader inheriting it gets
  // another product's folder for reasons no code here can explain. The new default is the same path `bin/onboard.mjs`
  // writes (`$HOME/trademark/workspace`), so the wizard and the bare default now agree instead of
  // describing two different installs.
  //
  // ── WHAT AN UNSET WORKSPACE ROOT COSTS A DEPLOYED BOX (read this before changing it again) ─────────
  //
  // driver/systemd/prelim-driver.path and prelim-outbox.path watch HARDCODED absolute globs — read them,
  // they carry the literal path. A .path unit cannot read an environment variable, so those globs do NOT track this default and cannot
  // be made to. If a deployment's run dirs move and its globs do not, the queue watcher stops firing:
  // jobs sit, nothing errors, nothing logs, and the 90s prelim-driver.timer is the only thing still
  // draining. That is why this default's move is paired with an EXPLICIT `CLEAROTRON_WORK_DIR` line in
  // every deployed .env (see CHANGELOG "Unreleased") rather than shipped on its own — a deployment that
  // pins the root it already runs on is unaffected by this line, which is the whole point of pinning it.
  // driver/test/data-plane-defaults.test.mjs holds the globs and the production env example to each other.
  get workspaceRoot() { return this.envValue("CLEAROTRON_WORK_DIR") || join(home(), "trademark", "workspace"); },

  // Compute-skills tree. The deterministic stage prompts reference skills by the convention
  // `skills/foo/SKILL.md`; the anthropic-agent engine rewrites those to absolute paths under THIS dir and
  // grants --add-dir on it. Phase 3 relocated the compute skills from each agent workspace to the driver's
  // own skills/ (one git-deployed canonical home), so this defaults to <driverDir>/skills. Env-overridable
  // for dev/test parity.
  get skillsDir() { return this.envValue("CLEAROTRON_INSTRUCTIONS_DIR") || join(DRIVER_DIR, "skills"); },

  // ── SKILL RESOLUTION: OVERLAY over BASE (2026-07-21) ──────────────────────────────────────────────
  // The repo split forked the whole skills tree: CLEAROTRON_INSTRUCTIONS_DIR pointed at the deployment's config
  // store, so the engine read ONLY that copy and `driver/skills/` — the git-tracked one everyone edits —
  // was dead weight at runtime. 30 of 37 shared files had silently drifted apart, in BOTH directions
  // (the repo copy anonymized for the sellable codebase; the live copy stale on facts, still describing
  // the pre-split `scripts/prelim-driver/` layout). Every methodology change had to be made twice by
  // hand, and a change made once ran nowhere — a `digest.md` edit shipped to the repo and never executed.
  //
  // The only content that genuinely CANNOT live in the repo is customer-identifying: a customer's own
  // risk framework, their worked examples, their delivery templates. That is a handful of files, not a
  // fork of the methodology.
  //
  // So resolution is now LAYERED, exactly like the config overlay: look in the OVERLAY (the deployment's
  // config store — customer-specific material) and fall back to the BASE (driver/skills — the git-tracked
  // generic methodology). One editable home per file; the customer material never enters the repo.
  //
  // SAFE BY CONSTRUCTION: the overlay wins, and today the config store holds every file — so this changes
  // NOTHING until a generic file is deleted from the overlay, at which point the repo copy takes over.
  // That makes the migration file-by-file and reversible (restore the overlay file to revert).
  get skillsBaseDir() { return join(DRIVER_DIR, "skills"); },
  get skillsOverlayDir() { return this.envValue("CLEAROTRON_INSTRUCTIONS_DIR") ?? null; },

  /**
   * Resolve a `skills/...`-relative path to the file that should actually be read.
   * Overlay first, then base; returns the BASE path when neither exists, so a genuinely missing skill
   * still fails loudly against the canonical location rather than silently against the overlay.
   */
  resolveSkillPath(relFromSkillsRoot) {
    const rel = String(relFromSkillsRoot ?? "").replace(/^\/+/, "");
    const overlay = this.skillsOverlayDir;
    if (overlay) {
      // FAIL LOUD ON AN UNREADABLE OVERLAY. existsSync() answers false for a permission error just as it
      // does for a missing file, so a config store the process cannot read would silently resolve EVERY
      // file to the repo — swapping a customer's own risk framework for the Generic default with nothing
      // in the log to say so. A configured-but-unreadable overlay is a deploy defect, not a fallback.
      if (!existsSync(overlay))
        throw new Error(`skills_overlay_unreadable:${overlay} (CLEAROTRON_INSTRUCTIONS_DIR is set but the process cannot see it — customer-specific skills would silently fall back to the repo defaults)`);
      const p = join(dirname(overlay), rel);
      if (existsSync(p)) return p;
    }
    return join(dirname(this.skillsBaseDir), rel);
  },

  /**
   * Every skills root handed to the engine's file tools (overlay + base, deduped).
   *
   * NAMED FOR WHAT IT IS, not what we want it to be (, 2026-08-14): it was `skillsReadRoots`, and the
   * engine passes it to `--add-dir`, which has no read-only form. The read-only INTENT is real and is
   * enforced by the deny-hook at driver/engine/deny-authority-write.mjs — not by this name.
   */
  get skillsGrantRoots() {
    const roots = [this.skillsBaseDir];
    const overlay = this.skillsOverlayDir;
    if (overlay && overlay !== this.skillsBaseDir) roots.unshift(overlay);
    return roots;
  },

  // The base that a profile's "skills/prelim-search/<file>.md" path is relative to — i.e. the PARENT
  // of skillsDir. Everything the DRIVER reads itself (framework manifests, band-meaning extraction)
  // must join against this, exactly as the agent resolves the same relative paths against the
  // skillsDir it is handed (gateway.mjs engineSkillsDir).
  //
  // 2026-07-19: these were joined against DRIVER_DIR, so the driver read framework manifests out of
  // its BUNDLED driver/skills while CLEAROTRON_INSTRUCTIONS_DIR pointed the agent at the config store. A
  // customer whose framework lives only in the config store therefore hard-failed at attachFramework
  // with `framework_manifest_missing` — the first Aurora Interactive run died there before any stage ran.
  get skillsRoot() { return dirname(this.skillsDir); },

  // ── Per-agent paths ───────────────────────────────────────────────────────
  // A prelim job is enqueued into the FORWARDING agent's OWN workspace queue (that agent's `write` tool
  // is sandboxed there), and we run the whole pipeline as that same agent so the reply tool
  // (`clawdi_send_<user>`), the run-dir, and the agent's memory all line up. The queue LOCATION therefore
  // encodes the agent identity — the driver derives {agentId, studioRoot} from where it claimed the job,
  // so there is no forwarder→agent map to keep in sync. Delivery is still centralized (poolRoot below).
  // The per-agent directory prefix under workspaceRoot. Inherited as a bare `workspace-` layout; now ONE
  // templated convention (CLEAROTRON_WORKSPACE_PREFIX) so a deployment can pick its own neutral layout. Every prefix consumer (scans + reverse regexes here, runner, status-snapshot,
  // progress, replay-archive, mcp runs.mjs) routes through these helpers — never inline the literal.
  get workspacePrefix() { return process.env.CLEAROTRON_WORKSPACE_PREFIX || "workspace-"; },
  workspaceDirName(agentId) { return `${this.workspacePrefix}${agentId}`; },
  // <dirName> → agent id, or null when the dir isn't an agent workspace.
  agentIdFromWorkspaceName(name) {
    const p = this.workspacePrefix;
    return typeof name === "string" && name.startsWith(p) && name.length > p.length ? name.slice(p.length) : null;
  },
  // Escaped prefix for the reverse regexes below (a custom prefix may carry regex metachars).
  get workspacePrefixRe() { return this.workspacePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); },
  studioRootForAgent(agentId) {
    return join(this.workspaceRoot, this.workspaceDirName(agentId), "studio", "prelim-search");
  },
  queueDirForAgent(agentId) {
    return join(this.studioRootForAgent(agentId), "queue");
  },
  archiveRootForAgent(agentId) {
    return join(this.studioRootForAgent(agentId), "archive");
  },
  // …/<prefix><id>/studio/prelim-search/queue → "<id>"; null if the path isn't an agent queue dir.
  agentIdFromQueueDir(qdir) {
    const m = new RegExp(`(?:^|/)${this.workspacePrefixRe}([^/]+)/studio/prelim-search/queue/?$`).exec(qdir);
    return m ? m[1] : null;
  },
  // Every agent workspace's prelim queue. The systemd `.path` watches these and the runner drains ALL of
  // them on each trigger (+ a timer fallback), so a request from ANY forwarder runs. (Pre-fix the watcher
  // and runner only looked at workspace-clawdi, silently orphaning every Alex/Sam job — the bug this fixes.)
  //
  // HEADLESS (Phase 2, standalone product): CLEAROTRON_QUEUE_DIR names ONE explicit queue dir — the intake
  // contract for a deployment with no agent workspaces at all (the enqueue CLI + ops-MCP start_run write
  // here, the runner drains it). It is ADDITIVE (listed first, deduped below): a mixed deployment keeps
  // draining any workspace queues too. Jobs claimed from it run as `defaultAgent` (agentIdFromQueueDir
  // has no workspace to derive from), so run dirs/archive still root under workspaceRoot as usual.
  get queueDirs() {
    const root = this.workspaceRoot;
    const dirs = [];
    const explicitQueue = this.envValue("CLEAROTRON_QUEUE_DIR");
    if (explicitQueue) dirs.push(explicitQueue);
    try {
      for (const name of readdirSync(root)) {
        if (this.agentIdFromWorkspaceName(name) == null) continue;
        const q = join(root, name, "studio", "prelim-search", "queue");
        if (existsSync(q)) dirs.push(q);
      }
    } catch { /* workspaceRoot may not exist in some test envs — fall through to the canonical queue */ }
    // THE ONE AGENT NAME NO CONFIGURATION REMOVES, and it is deliberate. row 5.
    //
    // `this.queueDir` is `queueDirForAgent("clawdi")` — a LITERAL, not `defaultAgent` — so every
    // deployment, however configured, watches `<workspacePrefix>clawdi/studio/prelim-search/queue`.
    // Setting CLEAROTRON_DEFAULT_AGENT does not remove it (prod runs `ops`, dev runs `dev`, and both still
    // watch this); nor does CLEAROTRON_WORKSPACE_PREFIX. An installer who copies `.env.example` gets a
    // neutral default agent AND this directory.
    //
    // WHY IT STAYS. It is back-compat for a real legacy queue that still holds work. Dropping the
    // literal stops the deployment that owns that queue draining it — silently, because an unwatched
    // queue looks exactly like an empty one. Removing it is therefore a SEQUENCED MIGRATION (drain the
    // legacy queue, or name it explicitly via CLEAROTRON_QUEUE_DIR, then drop this), not an edit: it needs
    // the box, and no repository-only change can do it safely.
    //
    // Written down because a sweep of this platform name will find it again and read it as residue.
    // It is not residue; it is the one instance whose removal has a cost outside this repository.
    const canonical = this.queueDir;
    if (!dirs.includes(canonical)) dirs.push(canonical);
    return [...new Set(dirs)];                  // CLEAROTRON_QUEUE_DIR may equal a scanned workspace queue
  },

  // Back-compat defaults for the legacy agent (selftest / docs / CLI without a derived agent), pinned
  // for the reason written at `queueDirs` above. Per-run code uses the *ForAgent helpers above with the
  // agent derived from the claimed queue dir.
  get studioRoot() {
    return this.studioRootForAgent("clawdi");
  },
  get queueDir() {
    return this.queueDirForAgent("clawdi");
  },
  get archiveRoot() {
    return this.archiveRootForAgent("clawdi");
  },

  // Delivery pool: the deterministic publish step writes report.html + audit.xlsx here; Caddy serves it
  // behind Cloudflare Access (the pool dir is owned by the driver's account, group `caddy`, set-GID, so
  // the driver's writes stay Caddy-readable).
  //
  // ── — NO DEFAULT. UNSET REFUSES, BY NAME. ────────────────────────────────────────────────────
  //
  // This read `|| "/srv/trademark-archive"` — a real deployment's client archive — so an operator who
  // forgot one export did not get "no pool", they got PRODUCTION. Two entry points already carried
  // hand-written defences against exactly that (bin/onboard.mjs writes explicit paths and never inherits
  // this; bin/example.mjs refuses to publish anywhere resolving to the archive). A default that every
  // caller has to remember to defend against is the defect, not the callers.
  //
  // The shape is the one scripts/purge-runs.mjs already uses for the same reason ("a deletion tool has
  // no defaults") and gives CLEAROTRON_DATABASE: no default, refuse, name the variable. A
  // wrong-but-harmless default and a refusal are both defensible; a wrong-and-dangerous one is not.
  //
  // READ SIDES DO NOT THROW. `poolRootOrNull` below is the same answer for a surface that only READS a
  // published pool — the flag snapshot, the status page, the MCP options face. Those degrade to "nothing
  // published here yet", which is the truthful answer on an unconfigured machine, and it is what they
  // already did whenever the file was absent. Refusing there would turn a laptop's missing config into
  // an exception on a read-only route. Anything that WRITES — publish, pool-admin, the snapshot writer,
  // the portal it is served by — takes `poolRoot` and refuses.
  get poolRoot() {
    const v = this.envValue("CLEAROTRON_REPORTS_DIR") ?? "";
    if (v) return v;
    // — the name a reader is told to SET is the one in force. This refusal reaches `doctor`'s
    // screen, beside seven lines that already name the current spelling, and told the reader to set a
    // retired one. Reproduced through the real entry path, not through the function.
    throw new Error(
      `CLEAROTRON_REPORTS_DIR is not set, and it has NO default. Unset is not "no pool": this used to fall `
      + "back to /srv/trademark-archive, a deployed server's real client archive, so a forgotten export "
      + "published into somebody else's matter. Set it to the pool this install owns, e.g. "
      + `CLEAROTRON_REPORTS_DIR=$HOME/trademark/pool — \`${invoke("install")}\` writes one for you.`,   // backticked: issue 1916 can return a `cd … && npx …` form, which runs into the next words unquoted
    );
  },
  // The same question, asked by a surface that only reads. null ⇒ "no pool configured": show nothing,
  // do not guess. Never used to decide where to WRITE.
  get poolRootOrNull() {
    const v = this.envValue("CLEAROTRON_REPORTS_DIR") ?? "";
    return v || null;
  },
  // Base URL the pool is served at (for the notification link). NO placeholder default — a forgotten env
  // must not LOOK configured. The 2026-07-17 repo split genericised this to a example.com host.
  // Unset ⇒ "" ⇒ publishReport's `poolUrl ? … : null` omits the link, and preflightDeploymentUrls()
  // makes the runner say so at activation. Deployment supplies it (EnvironmentFile, %h/.env).
  get poolUrl() { return this.envValue("CLEAROTRON_REPORTS_URL") || ""; },
  // Identity domain named in the delivery email's access note ("sign in with a <domain> account").
  // Unset ⇒ the note is omitted entirely, rather than telling the reader to sign in with a domain that
  // is not the one fronting the pool.
  get accessDomain() { return process.env.CLEAROTRON_ACCESS_DOMAIN || ""; },
  // Gather fan-out concurrency (parallel gather members per run). Never tied to an agent gateway's
  // maxConcurrent: compute runs off-gateway on the standalone engine. A turn cap used to sit below this
  // and bound gateway turns; it left with the gateway, so this is now the ONLY per-run
  // parallelism knob and the run-slot cap is the only other limit in the picture.
  // item 26 — raised 3 → 6, and it is GATED ON ITEM 25 BY CONSTRUCTION.
  //
  // The A1 comment below says why 3 stood: "raising gatherConcurrency alone does nothing while one member
  // IS the critical path". That was true and it is the whole argument. Item 25 removes it for the reopen —
  // the closure set is now partitioned evenly at dispatch rather than routed by term — so the cap is the
  // thing left in the way.
  //
  // THE CAP IS THE MEMBER COUNT, not a bigger number. At 3 the gather was two serial waves for a set of
  // independent provider-bound sweeps; at the member count it runs them once. There is nothing to gain
  // past that count, and every dispatch is a full engine subprocess with its own stream buffers and a
  // live session-cap rejection class, so a number chosen above what the run actually has would only
  // widen the burst.
  //
  // moved the count from 6 to 7. The gather was [common-law-half:a, common-law-half:b,
  // register-unit × 4] and is now [common-law-half:a, :b, :m, register-unit × 4] — the meaning sweep
  // has its own seat. Left at 6 the seventh member waits for a slot, which is the one serial wave this
  // knob exists to remove, and it would show up as a gather that got slower for a change whose whole
  // point is a stage that converges sooner. Seven is the same rule as six, applied to the new count.
  //
  // The knob is reused at six other sites (closure fan-out, skeptic escalation, envelope close,
  // frame-reopen sweep, case-law∥refute, notify), all of which are the same shape: a small set of
  // independent members that were being serialised for no reason left. Raise further with suite evidence,
  // not by intuition.
  get gatherConcurrency() { return numericSetting("CLEAROTRON_GATHER_CONCURRENCY"); },

  // Report-card fan-out. The cards reused gatherConcurrency by inertia, not by argument: a gather member
  // is a long provider-bound sweep, while a card is a short isolated sonnet turn that sees one finding and
  // writes one file. On the R2 evidence run fifteen cards ran 18-32s each and the phase still cost ~17
  // minutes, because a batch of 3 turns 15 cards into 5 serial waves.
  // Eight, not unbounded: each dispatch is a full engine subprocess with its own 64MB stream buffers, and
  // the engine has a live session-cap rejection class, so the burst risk is real and rises with the count.
  // Eight collapses the waves to two and takes the flat part of the curve — unbounded buys perhaps another
  // minute for a materially wider burst. Raise it with suite evidence, not by intuition.
  // THE ONE DECLARED EXEMPTION FROM THE NAMED REFUSAL, and it is a RULE, not an
  // oversight: a configuration typo discovered MID-RUN must never turn a delivering search into a
  // refusal. Unlike a thinking tier this knob is not grade-moving — it changes how long the phase takes
  // and nothing about what the phase concludes — so the run continues on the default.
  //
  // AND IT IS NOT ALLOWED TO DO THAT QUIETLY. pipeline.mjs's card fan-out calls fallbackNoteFor() and
  // writes a named line into the run's own record: the variable, what it holds, and the number the run
  // actually used. A fallback nobody can see is how a deployment ends up running on a number nobody
  // chose, which is this issue's own defect one register quieter. Continuing silently is not an option.
  //
  // It routes through the same resolver as the other seven so the exemption is DECLARED and greppable,
  // instead of being an accident of which guard this getter happened to use. What it shares with them,
  // and what the issue actually required: it can never answer NaN. Math.max alone would not do it —
  // Math.max(1, NaN) is NaN, and NaN reaches runBatched as a batch size.
  get cardConcurrency() {
    const r = resolveNumericSetting("CLEAROTRON_CARD_CONCURRENCY");
    return r.ok ? Math.max(1, Math.trunc(r.value)) : 8;
  },

  // A1 (perf, 2026-07-12): split the single common-law gather member into TWO concurrent members over
  // disjoint halves of the dictated term×platform grid (common-law shadows every other gather member —
  // 840s vs 145s next; raising gatherConcurrency alone does nothing while one member IS the critical
  // path). The two plugin-written half ledgers are merged in CODE into the canonical common-law-grid.json
  // before anything downstream reads it (common-law-receipts.mergeGrids). Rollback:
  // item 8 — CLEAROTRON_COMMONLAW_SPLIT is GONE. It was a rollback lane that had been on by default
  // since it landed, which is the shape ADR-0002 rules out: a hidden off switch nobody outside this box
  // could find, selecting a path nothing else selects.
  //
  // THE SINGLE-MEMBER ASSEMBLY STAYS, and item 8's instruction to delete it with the switch does not
  // survive contact with the code. The flag was never the only thing that reached it: the split also
  // self-disarms on a single-term grid (nothing to partition) and on a resume of a pre-split run (a
  // valid unsplit findings file with no half artifacts — re-running as halves would re-spend the whole
  // grid). Both are disclosed decisions recorded on ctx.clSplitDecision with their own reason, and
  // deleting the assembly would break them. What goes is the switch and the branch that read it.

  // B2 — hard ceiling on a `.processing` claim's age, measured from the `.pid` sidecar's mtime (written
  // fresh at every claim/takeover — NOT the marker's mtime, which rename(2) preserves from enqueue, so a
  // long-queued or weekend-postponed job would read over-age while its claimer is live and healthy).
  // Older than this the runner re-claims REGARDLESS of the claimer looking alive: an honest run is
  // bounded far below 48h, so an over-age "live" claimer is a wedged process or a reused pid the
  // starttime check couldn't positively unmask. 0 disables the ceiling.
  get maxClaimAgeMs() { return Math.max(0, numericSetting("CLEAROTRON_MAX_CLAIM_AGE_MS")); },

  // ── V4-7 run-slot cap + WS-C parallel runs ──────────────────────────────────────────────────────────
  // Global run-slot cap enforced INSIDE pipeline() (slot lock files in runLockDir), so it covers runner
  // jobs AND manual pipeline.mjs invocations alike. WS-C raised the V4-7 stopgap's 1 → 3 (one per agent).
  // Phase-4: 3 → 6 + per-agent admission LIFTED (pipeline.acquireRunSlot no longer tags by agent). The
  // 2026-06-12 starvation that forced one-run-at-a-time (parallel runs → every gateway lane busy → 75s
  // heartbeat timeouts → a lost mid-run reply) was a GATEWAY phenomenon; prelim COMPUTE now runs off the
  // gateway on the standalone claude -p engine, so concurrent runs no longer starve the heartbeat. The TURN
  // cap below still bounds the (now light) intake/delivery gateway demand. The runner serializes only the
  // cheap claim+dedup per queue and runs pipelines concurrently up to this cap (same-matter dedup stays
  // race-free). Env-tunable: CLEAROTRON_MAX_CONCURRENT_RUNS (the live .env sets it; this literal is the fallback
  // if the env is unset — keep the two in sync). Set to 2 on 2026-06-18 (was 6): 2 parallel is enough for now,
  // and bounds Max-5x rate-limit thrash. To change the live cap, set the env on the VM (no code deploy needed).
  get maxConcurrentRuns() { return Math.max(1, numericSetting("CLEAROTRON_MAX_CONCURRENT_RUNS")); },
  get runLockDir() { return this.envValue("CLEAROTRON_RUN_LOCK_DIR") || join(this.workspaceRoot, "prelim-run-locks"); },

  // Delivery outbox (Workstream B). On a handoff-mode finish the driver drops <runId>.pending here (naming
  // the forwarder agent); the systemd-user prelim-outbox.path unit fires an INSTANT prelim-deliver wake off
  // it, so a finished run sends in seconds instead of waiting ≤55m for the HEARTBEAT completion-watch (which
  // stays as the backstop). Mirrors runLockDir's derivation; env-overridable for dev/prod parity.
  // Phase 2: the outbox is ALSO the event seam for every other requester-facing event (run-failed,
  // intake-rejected, duplicate-skipped, late-bind-ack) — self-contained JSON packets via outbox.mjs.
  get outboxDir() { return this.envValue("CLEAROTRON_OUTBOX_DIR") || join(this.workspaceRoot, "prelim-outbox"); },

  // ── Delivery/comms (Phase 2, standalone product) ─────────────────────────────────────────────────
  // THERE IS ONE MODE AND IT IS NOT A SETTING. The driver SENDS NOTHING: every requester-facing event
  // (delivered, run-failed, intake-rejected, duplicate-skipped, late-bind-ack, pre-run-failed) is
  // written as a self-contained JSON packet + outbox marker for the integrator to consume
  // (docs/DELIVERY.md). There is no gateway and no messaging binary in the picture at all.
  //
  // What used to be here was a `CLEAROTRON_DELIVERY` switch whose second value routed those events through
  // one integrator platform's agent as chat pings. That platform is not part of this product, so the
  // second value named a deployment nobody installing this can build, and the whole branch was
  // unreachable for every reader of this file. It is gone rather than gated: the rollback is git.

  // Fallback execution agent when a job's origin agent can't be derived from its queue dir (shouldn't
  // happen in normal operation). The real per-run agent is the forwarding agent, derived from the queue
  // LOCATION (see studioRootForAgent / agentIdFromQueueDir above). `clawdi` carries all the prelim tools.
  get defaultAgent() { return process.env.CLEAROTRON_DEFAULT_AGENT || "clawdi"; },

  // Per-stage retry budget (fresh session key per retry).
  get maxRetries() { return numericSetting("CLEAROTRON_MAX_RETRIES"); },

  // Auto-resume backoff (ms) for a rate-limit POSTPONE whose 429 carried NO reset timestamp. The 5h-cap
  // rejection rides a rate_limit_event with resetsAt and is honored exactly; a plain api_error_status:429
  // (no rate_limit_event) leaves resetsAt unknown. claimDuePostponed then waits this long from postponedAt
  // before retrying, instead of resuming on the next ~90s tick — an immediate resume would just re-hit the
  // same cap and hot-loop, each iteration re-running a stage and burning real tokens (a single rate-limited
  // sweep attempt cost ~$2.4 in the 2026-06-22 incident). Default 20min; env-overridable.
  get rateLimitDefaultBackoffMs() { return Math.max(0, numericSetting("CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS")); },
  // — how long a park may sleep on a STORED reset before it re-asks the provider. The stored
  // `resetsAt` stays an upper bound; this is the ceiling on trusting it. 10 min, doubling per failed
  // probe up to 40 min: a genuinely long cap costs ~6 rejected dispatches over 24h, and a cap lifted
  // early is picked up within one interval by nobody editing anything.
  get rateLimitProbeMs() { return Math.max(60000, numericSetting("CLEAROTRON_RATE_LIMIT_PROBE_MS")); },
  get rateLimitProbeCeilingMs() { return Math.max(60000, numericSetting("CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS")); },
};

// The stage vocabulary is a FRIENDLY ALIAS — "opus", "haiku" — and no provider takes one on the wire.
// This table is the one place an alias becomes a full `provider/model` catalog id, so a tier named in a
// stage definition and the id stamped on a token-rollup row are the same fact rather than two spellings
// of it. resolveModel below is the only reader that matters; an engine with its own resolveModelId
// overrides it, and anything already in catalog form passes through untouched.
export const MODELS = {
  haiku: "anthropic/claude-haiku-4-5",
  sonnet: "anthropic/claude-sonnet-5",
  opus: "anthropic/claude-opus-5",
  gemini: "google/gemini-3.1-pro-preview",
  "gemini-flash": "google/gemini-3-flash-preview",
  "deepseek-v4-pro": "together/deepseek-ai/DeepSeek-V4-Pro",
  // azure = the proven-working Azure GPT-5.4 (api: openai-completions). It REPLACED the dead
  // azure-openai-pro/gpt-5.4-pro (api: azure-openai-responses), which rejected every payload at the
  // provider level — "provider rejected the request schema or tool payload" — and was retired
  // 2026-06-08 (live-probed both: 5.4-pro exit 1, 5.4 completions clean). Env-overridable for dev/prod
  // parity; default is the rendered $AZURE_OPENAI_DEPLOYMENT catalog id.
  azure: process.env.CLEAROTRON_AZURE_MODEL || "azure-openai/gpt-5.4",
};

// alias → full id; a value that's already a full provider/model id (contains "/") passes through.
//
// A BARE Anthropic id (dated or not — "claude-haiku-4-5-20251001", "claude-opus-5") normalises to the
// catalog form too. The direct-API lanes (jx completions/judge/nativeread, driver.config JX_PROVIDERS)
// name their model that way because that is what the Messages API takes, so without this the same model
// lands in a token rollup under two keys — "anthropic/claude-haiku-4-5" from the gateway's alias rows and
// "claude-haiku-4-5-20251001" from the jx rows — and a per-model total is silently split. The date suffix
// is dropped because the catalog ids carry none; anything that does not look like a bare claude id is
// returned untouched, so a genuinely unknown model still keys as-is rather than being guessed at.
export function resolveModel(model) {
  if (!model) return model;
  if (MODELS[model]) return MODELS[model];
  if (model.includes("/")) return model;
  const bareClaude = /^claude-(.+?)(?:-\d{8})?$/.exec(model);
  return bareClaude ? `anthropic/claude-${bareClaude[1]}` : model;
}

/**
 * The model FAMILY an id names — the only unit in which "what we asked for" and "what the provider
 * says it ran" can honestly be compared ( corruption 3).
 *
 * Deliberately COARSE, and that is the design. `claude --model haiku` comes back on the wire as
 * `claude-haiku-4-5-20251001`, so a string comparison would fire on every honest turn and be turned off
 * within a day; a FAMILY comparison fires only when a genuinely different model served the turn — which
 * is the corruption (`--model gemini` logging gemini and running sonnet, a haiku stage bouncing to
 * sonnet). Version drift inside a family (sonnet-4-6 → sonnet-5) is not this check's business.
 *
 * It runs the id through `resolveModel` first rather than carrying a second normaliser: the alias table
 * and the bare/dated-claude rewrite are already there, and two ladders that must agree forever is the
 * defect this codebase keeps paying for.
 *
 * THREE-VALUED BY CONTRACT. `null` = "this build recognises no family in that id", NEVER a guess and
 * never a default. A null on either side makes the comparison UNKNOWN, and an unknown must never be
 * recorded as a match — that is the absence-read-as-a-pass class this whole issue is about.
 */
const MODEL_FAMILY_RE = /(?:^|\/)(?:claude-)?(opus|sonnet|haiku)(?:[-.]|$)/i;

// — THE OPENAI SIDE, added when the codex path could first answer "what ran".
//
// This used to return null for every gpt id, on a stated rationale: a model this build cannot place is
// unknown, never a guess. That rationale has lapsed rather than been overruled — it was written when the
// codex adapter had no way to observe the served model at all, so the only id available to compare was
// the one we asked for, and placing it would have compared a request against itself. The adapter now
// reads the served id from codex's own session rollout, so there are two independently-sourced ids on
// the codex path and the comparison is real. Leaving this null would keep `modelMismatch` null forever
// and the substitution guard inert on that engine, which is.
//
// THE UNIT IS THE ID, not a tier, and that asymmetry with claude is deliberate. A claude tier is a
// family because the wire adds a DATE to it (`haiku` → `claude-haiku-4-5-20251001`), so a string
// comparison would fire on every honest turn. codex reports back the id it was given, so the id itself
// is what can be compared; the only normalisation needed is the provider prefix and a trailing date.
// Collapsing every `gpt-*` to "gpt" would be the wrong direction — a substitution from a full model to a
// mini one would then read as agreement, which is exactly the corruption this gauge exists to catch.
const OPENAI_ID_RE = /^(?:openai\/)?(gpt-[\w.-]+|o\d[\w.-]*)$/i;
const DATE_SUFFIX_RE = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;
export function modelFamily(model) {
  if (!model) return null;
  const resolved = resolveModel(String(model));
  const m = MODEL_FAMILY_RE.exec(resolved);
  if (m) return m[1].toLowerCase();
  const g = OPENAI_ID_RE.exec(String(resolved).trim());
  return g ? g[1].toLowerCase().replace(DATE_SUFFIX_RE, "") : null;
}

// ── Cost telemetry: REMOVED (owner directive 2026-07-11) ────────────────────
// The driver tracks TOKENS ONLY — no USD, no price table. The per-model price table (PRICING) and
// priceFor() that lived here were deleted with it; the token rollup is tokens.mjs (was cost.mjs), and
// the per-attempt stage telemetry keeps its raw `usage` counts (gateway.mjs). Spend questions are
// answered provider-side (console/invoice), never by driver arithmetic.

// ── Model failover: DELETED (issue, 2026-08-03) ────────────────────────
// `CROSS_PROVIDER_FALLBACKS` (an Azure + Google tail) and `engineIsMultiProvider()` (the gate that
// decided whether to append it) lived here. The tail was never appended on either shipped engine —
// both are single-provider, the gate's engine set was empty, and so `chainEntries()` returned exactly
// one entry for all 19 stages. Nothing ever failed over and nothing could. It was deleted rather than
// armed: untested code firing for the first time mid-production-failure is the worst possible moment,
// and a silent mid-run model swap changes which model makes judgment calls inside one matter.
// A stage whose model cannot do its work is a capability problem fixed at assignment time.
// What carries recovery, and always did: the same-model retry ladder (gateway.mjs runStage), the
// lane-wedge whole-stage retry (pipeline.mjs), and the rate-limit postpone.
// `MODELS.azure` above survives — the engines alias-map it as a tier name.

// ── Register provider — ONE at a time, NEVER both, and NEVER by default ────────────────────────────
//
// THE TOGGLE is `CLEAROTRON_DATABASE`, and it is REQUIRED. That one value selects, in lock-step:
// the driver's record-fetch credential + plugin core (recordFetch), the per-finding Source label, and
// the provider doc + tool vocabulary injected into the register-search spawns (stages.mjs).
//
// ── WHY THERE IS NO LONGER A DEFAULT ───────────────────────────────────────────────────────
// It used to be `|| "corsearch"`, and the comment here claimed "an unknown id throws LOUDLY (never a
// silent default)". Half true, and the wrong half was the one that could happen: an UNKNOWN id threw,
// an UNSET variable took Corsearch in silence. A firm with no Corsearch licence would have made the
// call. The credential guard would not have caught it either — both boxes still carry
// CORSEARCH_SESSION_KEY, so `recordFetch` sails past its own `if (!process.env.CORSEARCH_SESSION_KEY)`.
//
// The correct provider was held ENTIRELY by one systemd drop-in per service, in neither box's `~/.env`
// and not in git. A rebuilt unit, a fresh box, a `systemctl --user` reset, or a service added without
// the drop-in copied, and the engine resolved to a vendor this deployment did not choose — with no error
// anywhere, because a default is the one wrong value that never announces itself.
//
// A default is a decision nobody made. So: unset resolves to `null` here, and every USE of it throws.
// Not at module load — this module is imported by the whole test suite and by tools that never run a
// clearance — but at `activeProvider()`, `preflightCredentials()` and the MCP config build, which are
// the three doors a real run passes through.
//
// The rest of the old comment was wrong too and is gone: production runs on the env var, not on a
// committed literal (the opposite of what it said), and the two deploy-machinery files it named —
// a provider renderer script and a platform config template — do not exist in this repo.
// ── TAIL — BOTH SPELLINGS ARE READ HERE, BECAUSE THE TRANSLATION REACHES ONLY SOME PROCESSES ──
//
// The rename is normally applied once, early, by `shared/env-local.mjs`, and every read site goes on
// reading the old name. That holds in the processes that import the loader — the declared CLI entries
// and the declared translation-only files — and in no others. A bare `node --test driver/test/<x>.mjs`
// imports neither, so nothing translates and this capture saw only the legacy name. Measured on
// origin/main, three ways, before this loop existed:
//
//     node --test driver/test/preflight-credentials.test.mjs
//       -> [register-provider] CLEAROTRON_DATABASE is not set, and there is NO default.   (exit 1)
//     CLEAROTRON_DATABASE=euipo node --test <same file>
//       -> the SAME refusal. Setting the name the message names does nothing.
//     CLEAROTRON_DATABASE=euipo node --test <same file>
//       -> the register-provider refusal clears.
//
// So the message was right on the deploy path and wrong in the one place a person reads it, and the
// obvious correction — telling that reader to set the legacy name — advertises the spelling this whole
// rename exists to retire. Neither half of that is acceptable, so the name works instead.
//
// RESOLVED THROUGH `spellingsOf`, CURRENT FIRST. Same shape and same argument as `env-local.mjs`'s own
// `optedOut` gate, which reads both spellings because it runs BEFORE the aliases are applied; this one
// reads both because it may run where they are never applied at all. Current-first is not a preference
// — it is the order `applyEnvAliases` resolves in, so a half-migrated environment holding both cannot
// get one answer here and a different one through the loader.
//
// WHAT IT DOES NOT DO, stated so nobody reads more into it: the other renamed names are still
// translated by the loader alone, and a bare `node --test` remains blind to them. This makes the
// sentence the refusal prints true; it does not make the loader redundant.
export const REGISTER_PROVIDER = (() => {
  for (const name of ["CLEAROTRON_DATABASE"]) {
    const v = (process.env[name] || "").trim().toLowerCase();
    if (v) return v;
  }
  return null;
})();

/** The known provider ids, for error messages that tell the reader what to set. */
// FIVE values, and the split matters to a reader of the error message below: the first three are
// global sweeps behind a subscription; `euipo` and `uspto-local` are FREE and each covers
// ONE office — the EU register and the US register respectively. Selecting a free one is a deliberate
// single-office choice, not a cheaper corsearch: every other territory becomes a disclosed deferred
// gap, which is exactly what those capability contracts declare.
//
// `uspto-local` was ABSENT from this list until now, and the omission was invisible in the worst way:
// it still WORKED (activeProvider reads PROVIDERS, not this array), so the only symptom was that the
// one message telling an operator what to set left out the free US register. branched before
// created this constant, so neither branch's tests covered it — it surfaced from reading the two diffs
// side by side, not from a red run.
//
// SIX values now: 's `free-tier` composes the two free sources into ONE register, so an EU+US
// clearance needs no paid vendor. It is a TIER, not a fourth free source — precedence runs between
// tiers, never within one: a paid vendor configured IS the register alone, and the free sources are not
// run beside it (corsearch and clarivate already aggregate both offices, so the second call buys
// nothing). `euipo` and `uspto-local` remain selectable on their own for a deliberate single-office
// deployment; `free-tier` requires BOTH members and refuses by name without them.
// item 11 — ADR-0001's ladder order: the recommended register first, then the free tier, then the
// rest. This is what the preflight refusal PRINTS, so a reader who hits it is shown the same order the
// wizard offers rather than a second, older opinion about which register to buy.
export const KNOWN_REGISTER_PROVIDERS = ["signa", "free-tier", "euipo", "uspto-local", "corsearch", "clarivate"];

/**
 * The provider id, or a loud refusal. Every consumer that needs a provider calls this rather than
 * reading REGISTER_PROVIDER, so "unset" and "unknown" fail identically — which is the whole point,
 * since only the first can happen by accident.
 */
export function requireRegisterProvider() {
  if (REGISTER_PROVIDER) return REGISTER_PROVIDER;
  // — THE NAME AN OPERATOR SETS, not the name the code reads. This said
  // `CLEAROTRON_DATABASE`, which is the legacy spelling: an operator told to set it writes a line
  // that works, and then finds every document and every other refusal naming something else. DERIVED
  // written once, here, and read out of the message by the arm that checks it — so the name an operator
  // is told to set cannot drift from the name this code reads.
  const setThis = "CLEAROTRON_DATABASE";
  throw new Error(
    `[register-provider] ${setThis} is not set, and there is NO default. Set it in the `
    + `environment the deploy carries — one of: ${KNOWN_REGISTER_PROVIDERS.join(", ")}. Refusing rather `
    + "than picking one: this value decides which vendor gets called and billed, and the previous "
    + "default named a vendor this deployment did not choose.",
  );
}

// WP-receipts W4 — the senior lawyer's decided policy (2026-07-05) for a verdict-driving conflict whose SENIOR
// right cannot be retrieved through the provider: "open-item" (default) = the report states it plainly
// where the finding lives (simple clear English), verdict untouched — a stated qualification, judgment
// stays the verdict authority. "clamp" = additionally a CLEAR verdict clamps to CONDITIONAL. Flipping
// the decision is exactly this one line (or CLEAROTRON_UNREACHABLE_SENIOR for dev).
export const UNREACHABLE_SENIOR_POLICY = (process.env.CLEAROTRON_UNREACHABLE_SENIOR || "open-item").toLowerCase();

// Each provider = one adapter the driver knows by shape (id/label/credential/skill-doc + a driver-side
// record fetch). recordFetch(uri,{agentId,sessionKey,recordLog}) runs the V4-2 registry-evidence closure
// as pure code at the comparator's named point (no agent turn, no gateway lane): it imports the provider's
// dependency-free plugin core and calls doRecordFetch directly. The plugin chokepoint writes BOTH ledgers
// (call row + normalized record body) under the un-namespaced sessionKey we pass, so the row prefix-matches
// the run and the assembled record set picks it up on re-assembly. uri is the synthetic /mark/<office>/<id>
// surfaced by search (Clarivate guids ride that shape too — see providers/clarivate/src/core.js).
//
// ── `recordLog` — WHICH RUN'S RECORD LOG THIS CALL WRITES TO ─────────────────────────────────
//
// The record log is run-scoped now, and the DRIVER is the one caller that cannot infer the answer: it is
// long-lived and runner.mjs drains queues concurrently, so several runs' pipelines are in flight in this
// one process. A process-global address — the module const in providers/_shared/ledger.mjs, or a mutated
// process.env — would file one run's register responses under another, and it would do it silently:
// the record set assembles from the run dir, so a body written elsewhere is simply not there and
// `forEachLedgerLine` maps a missing file to `error: null`. So the path travels WITH the call, on the
// telemetry context, resolved by the caller from `run.runDir` (providers/_shared/ledger-path.mjs
// `runRecordLogPath`). The spawned MCP register servers need none of this — one child per run, address
// in its env.
//
// IT IS ON EVERY METHOD, not only the two that write bodies today. `countHits` and `executePlan` do not
// call `logRecordBody` in this build; a core that starts to would otherwise write to the global fallback
// and lose the rows to a reader that only looks in the run dir — an omission with no error attached.
// Passing it everywhere costs one destructured name and removes that class.
// Omission is still CAUGHT rather than trusted: registry-fidelity's `fetchedWithoutRecord` compares the
// run's record set against the record_fetch rows in the (still global) call ledger, so bodies that went
// to the wrong address surface as a failure, not as a clean zero.
// The free tier's REQUIRED variables, in one place: the PROVIDERS adapters below and preflightCredentials
// must not drift apart on which ones matter.
//
// USPTO_LOCAL_DB left this list with and is deliberately not checked here. These guards front the
// driver-side record/count calls, and those route BY OFFICE — an EU record fetch on a box with no US
// index is a call the free tier can serve perfectly well, and refusing it because a variable the call
// never touches is unset would turn a disclosed US deferral into a run that also cannot cite its EU
// evidence. The US half's absence is stated once, at plan compile, as a deferred coverage row; a member
// that IS asked for and is not configured refuses inside its own core, naming its own variable.
function freeTierMissing(env = process.env) {
  return ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"]
    .filter((k) => !String(env[k] ?? "").trim());
}

// ── The record-listing shim ( part 5) ───────────────────────────────────────────────────────────
//
// Every provider core already answers a search with normalized rows, and every core's row vocabulary is
// the same flat corsearch-shaped one (`record_id`, `mark_text`, `owner_name`, `classes`, `status`) —
// euipo/row.js states that key naming IS the contract, and uspto-local follows it. So the driver-side
// listing needs no new core: it is doSearch, parsed, with the errors read the way every other kernel
// reads them.
//
// ONE COPY, because the five adapters below would otherwise carry five copies of the same parse and the
// same ERROR-prefix check, and a provider whose copy drifted would report a failed fetch as an empty
// list of filings — the exact "absence reads as a finding" defect this lane exists to avoid.
//
// THE URL IS BUILT HERE, not in the renderer, because it is provider knowledge: a row that already
// carries a resolved link keeps it, and otherwise the provider's own public origin is joined to the
// record ref. A provider with no public record URL yields null, and the surfaces print the reference
// without a link rather than inventing an address.
function recordsFromSearch(run, { origin = null } = {}) {
  return async (params, tctx) => {
    let r;
    try { r = await run(params, tctx); }
    catch (e) { return { ok: false, records: null, reason: `record listing threw: ${e.message}` }; }
    const text = typeof r?.text === "string" ? r.text : "";
    if (r?.isError || text.startsWith("ERROR")) return { ok: false, records: null, reason: text.slice(0, 300) || "provider error" };
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return { ok: false, records: null, reason: "unparseable search response on the record listing" }; }
    if (!Array.isArray(parsed?.results))
      return { ok: false, records: null, reason: "the search response carried no results[], so nothing was listed — which is not the same as no filings" };
    const link = (row) => {
      const resolved = row?.resolved_link ?? row?.record_url ?? null;
      if (typeof resolved === "string" && /^https?:\/\//i.test(resolved)) return resolved;
      const ref = row?.record_id;
      return (origin && typeof ref === "string" && ref.startsWith("/")) ? `${origin}${ref}` : null;
    };
    return {
      ok: true,
      records: parsed.results.map((row) => ({ ...row, record_url: link(row) })),
      // NULL, never the row count, when the body carried no integer. `fetched` under a null `total` is
      // an honest "we do not know how many more there are"; under a minted total it is a lie about
      // completeness — the count kernel's one rule, applied to the listing.
      total: Number.isFinite(parsed?.total_hits) ? parsed.total_hits : null,
    };
  };
}

export const PROVIDERS = {
  corsearch: {
    id: "corsearch",
    label: "Corsearch",
    credEnv: "CORSEARCH_SESSION_KEY",
    skillDoc: "skills/prelim-register/providers/corsearch.md",
    hasPublicRecordUrl: true,
    // WP-receipts W2: the public per-record origin (publicRecordOrigin + /mark/<jur>/<id> is a working
    // link) — replaces the fragile resolved-link-origin inference at render for receipt-carrying runs.
    publicRecordOrigin: "https://tm.corsearch.com",
    async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, cause: "CORSEARCH_SESSION_KEY absent from driver env" };
      let doRecordFetch;
      try { ({ doRecordFetch } = await import("../providers/corsearch/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doRecordFetch(process.env.CORSEARCH_SESSION_KEY,
          { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
        const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
        return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
      } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
    },
    // Depth 2 (knockout-register): "how many filings match this name?" and nothing else. Same lazy
    // import + credential guard as recordFetch above; the counting itself is the shared kernel
    // (providers/_shared/count.mjs), so every provider answers in one shape. ONE BILLABLE SEARCH per
    // call on this provider (the count rides page 0 — capabilities.countProbe "cheap").
    async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, total: null, reason: "CORSEARCH_SESSION_KEY absent from driver env" };
      let doCountHits;
      try { ({ doCountHits } = await import("../providers/corsearch/src/core.js")); }
      catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
      try {
        return await doCountHits(process.env.CORSEARCH_SESSION_KEY,
          { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
          { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
      } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
    },
    // part 5 — the FILINGS behind the narrow counts. A SECOND billable search per term, and it
    // cannot be folded into the count above: that call rides `cheapCountParams` (`limit:1,
    // fields:["uri"]`, the smallest response the API gives) and makeEnumerate builds the same probe, so
    // widening it to carry rows would change what every enumerate call fetches. The listing pays its
    // own way and the receipts ledger stamps `stage:"records"` on it so the two are told apart.
    async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, records: null, reason: "CORSEARCH_SESSION_KEY absent from driver env" };
      let doSearch;
      try { ({ doSearch } = await import("../providers/corsearch/src/core.js")); }
      catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
      return recordsFromSearch(
        (p, t) => doSearch(process.env.CORSEARCH_SESSION_KEY, p, t),
        { origin: "https://tm.corsearch.com" },
      )({ name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}), limit },
        { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
    },
    // Repair-first (2026-07-05): the fan-in plan-direct-execute repair. Re-runs ONLY the dictated qids
    // that own no band block, as pure code at the gate (no agent turn, no gateway lane) — the tool's
    // qid-ownership merge preserves every untargeted/judgment block, and the chunked doEnumerate under
    // it is the same executor the initial gather used. Corsearch-only today: providers without an
    // executePlan adapter fall back to the LLM followup at the gate. (Corsearch + Clarivate carry one
    // as of phase 5, 2026-07-21; Signa does not — it has no enumerate/execute surface yet.)
    async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, cause: "CORSEARCH_SESSION_KEY absent from driver env" };
      let doExecutePlan;
      try { ({ doExecutePlan } = await import("../providers/corsearch/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doExecutePlan(process.env.CORSEARCH_SESSION_KEY,
          { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
          { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
        try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
        catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
      } catch (e) { return { ok: false, cause: `execute_plan threw: ${e.message}` }; }
    },
  },
  clarivate: {
    id: "clarivate",
    label: "Clarivate Compumark",
    credEnv: "CLARIVATE_API_KEY",
    skillDoc: "skills/prelim-register/providers/clarivate.md",
    hasPublicRecordUrl: false, // Compumark Content has no public record URL — cite the office register
    //, owner ruling 2026-08-20 — WHAT A CARD SHOWS WHERE A LINK CANNOT GO. A UI exists for this
    // provider and we do not know its per-record URL, so the card says so and says it is unfinished.
    // "placeholder" is the reader-facing admission; anything else would read as a citation.
    recordCitation: "placeholder",
    async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CLARIVATE_API_KEY) return { ok: false, cause: "CLARIVATE_API_KEY absent from driver env" };
      let doRecordFetch, DEFAULT_BASE;
      try { ({ doRecordFetch, DEFAULT_BASE } = await import("../providers/clarivate/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
      try {
        const r = await doRecordFetch(process.env.CLARIVATE_API_KEY, base,
          { record_ids: [uri] }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
        const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
        return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
      } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
    },
    // Depth 2's count, same contract as corsearch's (see above). A TRUE count-only call here: POST
    // /count fetches no records and works at any magnitude. regions[] is mandatory on this provider,
    // so a worldwide count is a disclosed capability gap rather than a number — register-count.mjs
    // refuses the run up front instead of letting every mark fail one at a time.
    async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CLARIVATE_API_KEY) return { ok: false, total: null, reason: "CLARIVATE_API_KEY absent from driver env" };
      let doCountHits, DEFAULT_BASE;
      try { ({ doCountHits, DEFAULT_BASE } = await import("../providers/clarivate/src/core.js")); }
      catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
      try {
        return await doCountHits(process.env.CLARIVATE_API_KEY, base,
          { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
          { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
      } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
    },
    // part 5 — TWO calls, not a per-record bill. Compumark's POST /search answers with record
    // IDENTIFIERS and nothing else (normalizeSearchResponse fills mark_text, classes, status and
    // owner_name with null on every row, by construction), so the fields a filings list prints have to
    // be fetched. But the fetch is a BATCH: TEXT_BATCH_MAX is 100 ids per call and POST /text hydrates
    // every id in the call. A 100-filing listing for one name is ONE search plus ONE screen call.
    //
    // An earlier draft of this method refused here and priced the listing at "up to 100 extra billed
    // calls per name". That was wrong by the batch factor, and it mattered: clarivate is the register
    // wired on the test deployment, so the refusal would have shipped this whole part inert on the one
    // provider that runs. `screenSource: "billed-record-fetch"` states that the fields cost a fetch —
    // it does not state that the fetch is per record, and doRecordFetch chunks at the same 100.
    //
    // THE CAP IS APPLIED TO THE IDS, BEFORE THE SCREEN, because this provider's search is single-shot:
    // capabilities.pageParams is empty and POST /search returns the COMPLETE guid set up to the 30000
    // ceiling. Screening whatever came back would be exactly the runaway the cap exists to prevent.
    //
    // Class scope comes from the SEARCH (`classFilter: "native"`), as on every other provider here.
    // `in_scope_classes` is deliberately NOT sent to the screen: there it drives `screen_verdict`, a
    // keep/drop judgment, and this lane adds none — it prints what the register said.
    async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CLARIVATE_API_KEY) return { ok: false, records: null, reason: "CLARIVATE_API_KEY absent from driver env" };
      let doSearch, doBatchScreen, DEFAULT_BASE;
      try { ({ doSearch, doBatchScreen, DEFAULT_BASE } = await import("../providers/clarivate/src/core.js")); }
      catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
      const tctx = { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog };
      const readJson = (r, what) => {
        const text = typeof r?.text === "string" ? r.text : "";
        if (r?.isError || text.startsWith("ERROR")) return { err: text.slice(0, 300) || `provider error on the ${what}` };
        try { return { doc: JSON.parse(text) }; }
        catch { return { err: `unparseable ${what} response on the record listing` }; }
      };
      let ids, total;
      try {
        const { doc, err } = readJson(await doSearch(process.env.CLARIVATE_API_KEY, base,
          { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) }, tctx), "search");
        if (err) return { ok: false, records: null, reason: err };
        if (!Array.isArray(doc?.results))
          return { ok: false, records: null, reason: "the search response carried no results[], so nothing was listed — which is not the same as no filings" };
        // NULL, never the id count: the same rule the rest of this lane runs on.
        total = Number.isFinite(doc?.total_hits) ? doc.total_hits : null;
        const want = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : doc.results.length;
        ids = doc.results.map((row) => row?.record_id).filter((u) => typeof u === "string" && u).slice(0, want);
      } catch (e) { return { ok: false, records: null, reason: `record listing threw: ${e.message}` }; }
      // Nothing to hydrate is a real, answered zero — and it keeps the screen call unmade.
      if (!ids.length) return { ok: true, records: [], total };
      try {
        const { doc, err } = readJson(await doBatchScreen(process.env.CLARIVATE_API_KEY, base, { uris: ids }, tctx), "screen");
        if (err) return { ok: false, records: null, reason: err };
        if (!Array.isArray(doc?.rows))
          return { ok: false, records: null, reason: "the screen response carried no rows[], so nothing was listed — which is not the same as no filings" };
        // A PARTIAL HYDRATE IS NOT A LISTING. doBatchScreen only hard-errors when EVERY chunk failed;
        // one failed chunk among several comes back as rows plus a populated `errors`, and returning
        // those rows would present a short list as the whole answer — the same lie the count lane
        // refuses when it declines to sum a partial variant sweep. Fewer rows than ids with NO errors is
        // a different thing (an id the register no longer resolves) and rides through as a real result.
        if (Array.isArray(doc.errors) && doc.errors.length)
          return { ok: false, records: null, reason: `the hydrate failed on ${doc.errors.length} of ${Math.ceil(ids.length / 100)} batch(es), so this listing would be short without saying so: ${String(doc.errors[0]).slice(0, 200)}` };
        return { ok: true, total, records: doc.rows.map((row) => ({
          record_id: row?.uri ?? null,
          mark_text: row?.mark_text ?? null,
          // The screen row names this `owner`; the neutral record reads `owner_name`. Mapped here so the
          // seam is in one place rather than as a second spelling inside register-records.mjs.
          owner_name: row?.owner ?? null,
          owner_country: row?.owner_country ?? null,
          status: row?.status ?? null,
          classes: Array.isArray(row?.classes) ? row.classes : null,
          office: row?.office ?? null,
          application_date: row?.application_date ?? null,
          registration_date: row?.registration_date ?? null,
          // hasPublicRecordUrl:false on this provider — there is no per-record page to link, and a
          // fabricated one would be worse than none.
          record_url: null,
        })) };
      } catch (e) { return { ok: false, records: null, reason: `record hydrate threw: ${e.message}` }; }
    },
    // The repair-first plan-direct-execute lane, same contract as corsearch's (see above). Without it
    // Clarivate would silently fall back to the LLM followup at the fan-in gate — a model turn doing
    // what code can do deterministically, which is the transcription lane this whole design closes.
    // Signature note: the clarivate core takes (apiKey, base, params, tctx), not corsearch's
    // (sessionKey, params, tctx) — the base is threaded explicitly here.
    async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.CLARIVATE_API_KEY) return { ok: false, cause: "CLARIVATE_API_KEY absent from driver env" };
      let doExecutePlan, DEFAULT_BASE;
      try { ({ doExecutePlan, DEFAULT_BASE } = await import("../providers/clarivate/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
      try {
        const r = await doExecutePlan(process.env.CLARIVATE_API_KEY, base,
          { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
          { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
        try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
        catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
      } catch (e) { return { ok: false, cause: `execute_plan threw: ${e.message}` }; }
    },
  },
  signa: {
    id: "signa",
    label: "Signa",
    credEnv: "SIGNA_API_KEY",
    skillDoc: "skills/prelim-register/providers/signa.md",
    hasPublicRecordUrl: false, // Signa exposes no per-record public URL — cite the office register
    //, owner ruling 2026-08-20 — no register UI exists to link to at all, so the card points at
    // the artifact that DOES carry the record: the audit workbook. Naming it is the whole of this
    // branch; constructing a per-record URL for a provider that publishes none would be a fabricated
    // citation on a legal deliverable, and the ruling forbids it in those words.
    recordCitation: "workbook",
    async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
      let doRecordFetch, DEFAULT_BASE;
      try { ({ doRecordFetch, DEFAULT_BASE } = await import("../providers/signa/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.SIGNA_BASE_URL || DEFAULT_BASE;
      try {
        const r = await doRecordFetch(process.env.SIGNA_API_KEY, base,
          { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
        const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
        return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
      } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
    },
    // ── the three adapters that make this a code-driven provider ─────────────────────────
    //
    // Until these existed signa declared `recordFetch` alone, `planExec` resolved to null, and a run
    // fell to the agent lane — a model asked to page a register by hand. Preflight refuses that
    // outright now, so signa was unrunnable end to end until this landed.
    async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
      let core;
      try { core = await import("../providers/signa/src/core.js"); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.SIGNA_BASE_URL || core.DEFAULT_BASE;
      try {
        // THROUGH toSignaParams, not around it. `strategies: [matchMode]` is the same defect
        // fixed one layer down: `contains`, `starts_with` and `ends_with` are DETERMINISTIC
        // modes, not strategies, and the API rejects them in the strategies array. These wrappers
        // hand-built the vendor shape and so were untouched by that fix — the translator is the one
        // place that knows which mode rides which request shape, and every caller must go through it.
        const r = await core.doCountHits(process.env.SIGNA_API_KEY, base,
          core.toSignaParams({ name, match_mode: matchMode || "exact", nice_classes: classes, regions }),
          { kind: "count", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
        const p = JSON.parse(text);
        // The total is REAL now: `options.include_total` puts the register's own corpus total
        // on the search response, so this no longer has to answer `present` and nothing else. It is
        // still null whenever the vendor would only approximate it — and null there means UNKNOWN,
        // which is the whole reason the field may never be filled in with a figure from anywhere else.
        return { ok: true, total: Number.isFinite(p.total_hits) ? p.total_hits : null,
          approximate: p.total_approximate === true, present: p.present === true, note: p.note };
      } catch (e) { return { ok: false, cause: `countHits threw: ${e.message}` }; }
    },
    async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
      let core;
      try { core = await import("../providers/signa/src/core.js"); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.SIGNA_BASE_URL || core.DEFAULT_BASE;
      try {
        const r = await core.doSearch(process.env.SIGNA_API_KEY, base,
          { ...core.toSignaParams({ name, match_mode: matchMode || "exact", nice_classes: classes, regions }), limit },
          { kind: "search", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
        const p = JSON.parse(text);
        return { ok: true, records: Array.isArray(p.results) ? p.results : [] };
      } catch (e) { return { ok: false, cause: `listRecords threw: ${e.message}` }; }
    },
    async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
      let core;
      try { core = await import("../providers/signa/src/core.js"); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      const base = process.env.SIGNA_BASE_URL || core.DEFAULT_BASE;
      try {
        const r = await core.doExecutePlan({ apiKey: process.env.SIGNA_API_KEY, base },
          { plan_path: planPath, axis, output_path: outputPath, qids },
          { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
        try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
        catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
      } catch (e) { return { ok: false, cause: `executePlan threw: ${e.message}` }; }
    },
  },
  // ── EUIPO — the first FREE register provider ─────────────────────────────────────────────
  // Everything above is a paid vendor with a global sweep. This one covers ONE office (the EU register:
  // EUTMs plus international registrations designating the EU) and is free to query, which is what
  // makes an open-source install possible at all.
  //
  // The auth object is a credential PAIR plus an environment, not a single key — hence the shape
  // difference below. `environment` is load-bearing and not a preference: sandbox and production are
  // separate deployments holding different corpora, and a sandbox cross-check must never be read as a
  // live one. The core refuses an unknown value rather than falling back.
  euipo: {
    id: "euipo",
    label: "EUIPO",
    credEnv: "EUIPO_CLIENT_ID",
    // The ONLY provider with more than one required variable. preflightCredentials checks the whole
    // list — without this, an instance holding the id and no secret passes preflight and dies on the
    // first token request, after model spend and reported as a provider fault.
    credEnvAlso: ["EUIPO_CLIENT_SECRET"],
    skillDoc: "skills/prelim-register/providers/euipo.md",
    hasPublicRecordUrl: true,
    publicRecordOrigin: "https://euipo.europa.eu",
    async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
        return { ok: false, cause: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
      }
      let doRecordFetch;
      try { ({ doRecordFetch } = await import("../providers/euipo/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doRecordFetch(null,   // null ⇒ the core reads the credential pair from env
          { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
        const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
        return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
      } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
    },
    // countProbe "cheap": the total rides page 0 of an ordinary search, so this is ONE call — free in
    // money terms, but it still spends the daily request allowance.
    async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
        return { ok: false, total: null, reason: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
      }
      let doCountHits;
      try { ({ doCountHits } = await import("../providers/euipo/src/core.js")); }
      catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
      try {
        return await doCountHits(null,
          { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
          { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
      } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
    },
    // part 5. Free in money, one request against the daily allowance per term. The page knob is
    // `size`, not `limit` — this API has no `limit` at all, which is the exact trap the count kernel's
    // own header warns about, so the neutral cap is translated here rather than passed through.
    async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
        return { ok: false, records: null, reason: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
      }
      let doSearch;
      try { ({ doSearch } = await import("../providers/euipo/src/core.js")); }
      catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
      return recordsFromSearch((p, t) => doSearch(null, p, t))(
        { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}), size: limit, page: 0 },
        { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
    },
    async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
        return { ok: false, cause: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
      }
      let doExecutePlan;
      try { ({ doExecutePlan } = await import("../providers/euipo/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doExecutePlan(null,
          { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
          { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        return text.startsWith("ERROR") ? { ok: false, cause: text.slice(0, 200) } : { ok: true, summary: text.slice(0, 400) };
      } catch (e) { return { ok: false, cause: `executePlan threw: ${e.message}` }; }
    },
  },
 "uspto-local": {
    id: "uspto-local",
    label: "USPTO (local index)",
    credEnv: "USPTO_LOCAL_DB",
    skillDoc: "skills/prelim-register/providers/uspto-local.md",
    hasPublicRecordUrl: true,
    // TSDR publishes a page per serial, so a finding can cite an address the reader can open. The
    // record ref is /mark/us/<serial>, and the core builds the full statusSearch link on the record.
    publicRecordOrigin: "https://tsdr.uspto.gov",
    async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.USPTO_LOCAL_DB) return { ok: false, cause: "USPTO_LOCAL_DB absent from driver env" };
      let doRecordFetch;
      try { ({ doRecordFetch } = await import("../providers/uspto-local/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doRecordFetch({ dbPath: process.env.USPTO_LOCAL_DB },
          { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
        const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
        return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
      } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
    },
    // Depth 2's count. A true count-only call — `SELECT count(*)` fetches no rows and works at any
    // magnitude — but see the freshness note above: this is also the seam where a stale index refuses.
    async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.USPTO_LOCAL_DB) return { ok: false, total: null, reason: "USPTO_LOCAL_DB absent from driver env" };
      let doCountHits;
      try { ({ doCountHits } = await import("../providers/uspto-local/src/core.js")); }
      catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
      try {
        // `regions` is accepted and NOT forwarded: this source holds one office, and the plan resolved
        // its territorial scope against capabilities.offices.covered before ever reaching here — a
        // jurisdiction other than US is already a deferred gap upstream. Forwarding it would let a
        // caller believe it had narrowed a search that has nothing to narrow.
        return await doCountHits({ dbPath: process.env.USPTO_LOCAL_DB },
          { name, match_mode: matchMode, nice_classes: classes ?? [] },
          { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
      } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
    },
    // part 5. Free — a local SQLite read. `regions` is accepted and NOT forwarded for the same
    // reason the count above does not forward it: this source holds one office.
    async listRecords({ name, matchMode, classes, limit }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.USPTO_LOCAL_DB) return { ok: false, records: null, reason: "USPTO_LOCAL_DB absent from driver env" };
      let doSearch;
      try { ({ doSearch } = await import("../providers/uspto-local/src/core.js")); }
      catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
      return recordsFromSearch(
        (p, t) => doSearch({ dbPath: process.env.USPTO_LOCAL_DB }, p, t),
        { origin: "https://tsdr.uspto.gov" },
      )({ name, match_mode: matchMode, nice_classes: classes ?? [], limit },
        { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
    },
    // The repair-first plan-direct-execute lane. Without it this provider would fall back to the LLM
    // followup at the fan-in gate — a model turn doing what code does deterministically.
    async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null }) {
      if (!process.env.USPTO_LOCAL_DB) return { ok: false, cause: "USPTO_LOCAL_DB absent from driver env" };
      let doExecutePlan;
      try { ({ doExecutePlan } = await import("../providers/uspto-local/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doExecutePlan({ dbPath: process.env.USPTO_LOCAL_DB },
          { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
          { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
        try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
        catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
      } catch (e) { return { ok: false, cause: `execute_plan threw: ${e.message}` }; }
    },
  },
  // ──: the free tier — EUIPO + the local US index as ONE register ──────────────────────────────
  //
  // WHAT PREFLIGHT REQUIRES IS THE EU HALF, NOT BOTH HALVES.
  //
  // This list used to carry USPTO_LOCAL_DB, and the argument was that joinPlanToBands has three outcomes
  // per qid — executed, missing, deferred — with no shape for "half of this ran", so a two-office slice
  // whose US half is unconfigured would defer WHOLE and take its EU coverage with it. Refusing up front
  // looked like the only honest answer.
  //
  // That invariant is real and is unchanged. What was wrong is where it was enforced. The two offices
  // now part company at PLAN COMPILE (driver/register-availability.mjs → compileRegisterPlan), so every
  // qid the executor sees is already single-office: every entry is EU-only, and nothing is ever
  // half-run. With the split early, refusing the whole run buys nothing and costs the EU coverage the
  // box genuinely has.
  //
  // CORRECTED 2026-08-11. This paragraph used to say "the US entry is a disclosed `deferred_coverage`
  // row". THERE IS NO US ENTRY — the unreachable office produces no plan entry at all, which is exactly
  // why every surviving qid is single-office. The distinction was not pedantic: nothing a reader sees
  // was reading `deferred_coverage`, so the run shipped an EU-only clean with no row saying the US
  // register was never searched, and this comment was the argument for dropping the variable from the
  // list above. The disclosure now exists — coverage-form.mjs reads `plan.deferred_coverage` and emits
  // an `open` row per active axis — so the reasoning below stands on something real. Before that it did
  // not, and this list was right for the wrong reason.
  //
  // It also gated the wrong thing in practice. The US index is the one piece of this tier an operator
  // cannot get in a minute — it is a 41.5 GB build over two bulk products, behind an account with ID.me
  // identity verification, and it takes hours — so requiring it made the free tier unusable for exactly
  // the person it exists for. 's CODE was merged; the INDEX is what no box had, and that was enough
  // to keep and from ever being exercised.
  //
  // The EU pair stays REQUIRED: a free tier with no configured member at all is not degraded, it is
  // unconfigured, and it must refuse by name rather than produce a register layer with nothing in it.
  // credEnvAlso is still what makes that a whole check — a single credEnv string cannot express a
  // two-variable OAuth provider, and the half-check that reads credEnv alone is a known second site.
  "free-tier": {
    id: "free-tier",
    label: "Free tier (EUIPO + USPTO local index)",
    credEnv: "EUIPO_CLIENT_ID",
    credEnvAlso: ["EUIPO_CLIENT_SECRET"],
    skillDoc: "skills/prelim-register/providers/free-tier.md",
    hasPublicRecordUrl: true,
    // NULL, deliberately: the two members have DIFFERENT public origins (euipo.europa.eu and the USPTO),
    // so a single origin string here would stamp one office's host onto the other's citations. The
    // record-level link is built from the record itself; publish/index.mjs reads this only as a prefix
    // and treats null as "no prefix", which is the honest answer for a two-office register.
    publicRecordOrigin: null,
    // — WHICH HOSTS THIS PROVIDER MAY LEGITIMATELY PRODUCE. The record-URL gate reads origins
    // through recordOriginsFor(), and a composite's are its MEMBERS'. Keyed on the null above: a gate
    // that took `publicRecordOrigin` at face value here would resolve to an EMPTY allow-list and refuse
    // every free-tier delivery — every one of whose record links is legitimately a EUIPO or a USPTO one.
    composedOf: ["euipo", "uspto-local"],
    async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
      const missing = freeTierMissing();
      if (missing.length) return { ok: false, cause: `${missing.join(" + ")} absent from driver env` };
      let doRecordFetch;
      try { ({ doRecordFetch } = await import("../providers/free-tier/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doRecordFetch(null, { record_id: uri },
          { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
        const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
        return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
      } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
    },
    // countProbe "cheap" — the WEAKEST member's mode. EUIPO's total rides page 0 of an ordinary search,
    // so the composite pays that price even though the US index has a true count endpoint.
    async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
      const missing = freeTierMissing();
      if (missing.length) return { ok: false, total: null, reason: `${missing.join(" + ")} absent from driver env` };
      let doCountHits;
      try { ({ doCountHits } = await import("../providers/free-tier/src/core.js")); }
      catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
      try {
        return await doCountHits(null,
          { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
          { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
      } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
    },
    // part 5. Free on both members. `size` AND `limit` ride together on purpose: this composite
    // fans out to EUIPO (which pages on `size`) and to the local US index (which pages on `limit`), and
    // its own doSearch hands each member the params it understands. Sending one knob would silently
    // give the other member its default page size — a listing capped somewhere nobody chose.
    async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
      const missing = freeTierMissing();
      if (missing.length) return { ok: false, records: null, reason: `${missing.join(" + ")} absent from driver env` };
      let doSearch;
      try { ({ doSearch } = await import("../providers/free-tier/src/core.js")); }
      catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
      return recordsFromSearch((p, t) => doSearch(null, p, t))(
        { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}), size: limit, limit, page: 0 },
        { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
    },
    async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null }) {
      const missing = freeTierMissing();
      if (missing.length) return { ok: false, cause: `${missing.join(" + ")} absent from driver env` };
      let doExecutePlan;
      try { ({ doExecutePlan } = await import("../providers/free-tier/src/core.js")); }
      catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
      try {
        const r = await doExecutePlan(null,
          { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
          { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog });
        const text = typeof r?.text === "string" ? r.text : "";
        return text.startsWith("ERROR") ? { ok: false, cause: text.slice(0, 200) } : { ok: true, summary: text.slice(0, 400) };
      } catch (e) { return { ok: false, cause: `executePlan threw: ${e.message}` }; }
    },
  },
};

// — AN ENVIRONMENT MAY BE PASSED, AND THEN IT IS THE ONE THAT DECIDES.
//
// `REGISTER_PROVIDER` is a module const, evaluated once at first import from the real `process.env`.
// Every caller holding a CANDIDATE environment — a setup wizard validating what it is about to
// persist — got the ambient provider instead, silently, and the wrong answer presented as a pass:
// validate `{CLEAROTRON_DATABASE: "euipo", …}` from a shell holding `corsearch` and a live
// CORSEARCH_SESSION_KEY, and it checked the corsearch key, found it, and returned
// `{provider: "corsearch"}`. It was also right at most once per process, because the second call read
// the frozen const again.
//
// PROD-NEUTRAL BY CONSTRUCTION: no argument ⇒ `requireRegisterProvider()`, byte-identical to before,
// including its refusal to default. An argument ⇒ that environment answers, which is what a caller
// passing one was always asking for.
// null when the environment names none — which is NOT the same fact as naming a wrong one, and the
// difference is what keeps this prod-neutral. CI found it: a caller passing `{[credEnv]: "key"}` is
// asking about the VARIABLES and has said nothing about the provider, so the ambient one still answers,
// exactly as it did. is the other case — the env DOES name a provider and was ignored.
export function providerIdFrom(env) {
  // BOTH SPELLINGS ( tail), and here the case is sharper than in the module capture above. The
  // environment handed in is a CANDIDATE — a `.env` the wizard is about to write — and the wizard writes
  // the CURRENT spelling, through `currentName`, on purpose. Reading only the legacy name answered
  // `null` for a file that names the provider on the one line an operator can see, and `activeProvider`
  // reads that null as "this environment said nothing" and falls back to the ambient value. That is
  // 's defect exactly, wearing the new name.
  for (const name of ["CLEAROTRON_DATABASE"]) {
    const v = String(env?.[name] ?? "").trim().toLowerCase();
    if (v) return v;
  }
  return null;
}

export function activeProvider(env = null) {
  const id = (env && providerIdFrom(env)) || requireRegisterProvider();
  const a = PROVIDERS[id];
  if (!a) throw new Error(`[register-provider] unknown REGISTER_PROVIDER "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  return a;
}

// — the record-URL host allow-list is derived from `composedOf` / `publicRecordOrigin` /
// `hasPublicRecordUrl` above, by `recordOriginsFor` in record-origins.mjs. It lives in its own module so
// that verify.mjs can import it without dragging this file's vocabularies into the gate surface that
// skill-contract-enumerations.test.mjs derives from verify.mjs's imports.


// ── Research providers (Phase 2a, knockout lane) — the same lazy-import + cred-guard idiom as
// PROVIDERS, for CODE-side research calls (no model in the data path). The knockout sweep's live
// executor; tests inject their own, the dev instance uses CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES. Knobs:
//   PERPLEXITY_API_KEY                — required for live sweeps (absent ⇒ every call degrades, loud)
//   CLEAROTRON_KNOCKOUT_PRESET            — perplexity preset (default "pro-search"; "deep-research" = deeper/costlier)
//   CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES    — dir of <mark-kebab>.md canned payloads ($0 dev/e2e)
//   CLEAROTRON_KNOCKOUT_MODEL             — LLM override for the frame/assess turns (default opus)
export const RESEARCH_PROVIDERS = {
  perplexity: {
    // The vendor's own name, for the staff config page's provider inventory (config-inventory.mjs).
    // Stated here beside the credential rather than derived from the key, so the two cannot disagree
    // and so the page never renders a title-cased guess at an id.
    label: "Perplexity",
    credEnv: "PERPLEXITY_API_KEY",
    // READER-TERMS FIELDS (tracker issues 2072/2089): what its absence costs, in the reader's world,
    // and where a key comes from. Stated beside the credential like `label`, so setup and doctor can
    // DERIVE their prompts from this table instead of keeping a second hand list — the second list is
    // how SERPAPI_API_KEY went unprompted while the code said "required for live grid cells".
    absentMeans: "the three clearance searches refuse before spending anything; a Knockout still runs and discloses the open-web half it skipped",
    obtain: "https://www.perplexity.ai/settings/api — self-serve, the key is shown once",
    async research(task, { preset = "pro-search" } = {}) {
      if (!process.env.PERPLEXITY_API_KEY) return { ok: false, cause: "PERPLEXITY_API_KEY absent from driver env" };
      let core;
      try { core = await import("../providers/perplexity/src/core.js"); }
      catch (e) { return { ok: false, cause: `perplexity core unavailable: ${e.message}` }; }
      try {
        const started = Date.now();
        const body = core.buildRequestBody({ task, preset });
        const data = await core.callAgentAPI(process.env.PERPLEXITY_API_KEY, body, { retries: core.retriesForPreset(preset) });
        const text = core.formatResponse(data, preset);
        if (!text || !String(text).trim()) return { ok: false, cause: "empty research response" };
        return { ok: true, text: String(text), bytes: Buffer.byteLength(String(text)), tookMs: Date.now() - started };
      } catch (e) {
        // OUTAGE-SHAPED OR NOT — the caller cannot tell from prose, so say it here.
        //
        // A failed sweep is the knockout lane's one un-recoverable moment: it has no recovery ladder, and
        // a whole paid batch dies on a research call. Whether that is right depends entirely on WHY, and
        // the answer was being discarded — every status collapsed into one `cause` string, which the
        // driver's outage patterns cannot read (they require a literal "http" before the code).
        //
        // Deliberately NARROW: 429 and 5xx only. A missing key, a 401/403, a dead endpoint or a network
        // throw is a broken CONFIGURATION, and calling that an outage would make it park and auto-resume
        // forever — burning the run slot while hiding the real error from whoever could fix it. Those stay
        // terminal and loud, which is the correct answer for something no amount of waiting repairs.
        //
        // Note core.js has already retried a 429/5xx twice by the time we see it, so a status arriving
        // here means the provider stayed down across those attempts — a postpone is the honest response,
        // not a way of papering over a fast blip.
        const status = Number.isInteger(e?.status) ? e.status : null;
        return {
          ok: false,
          cause: `research call threw: ${String(e?.message ?? e).slice(0, 200)}`,
          status,
          outage: status === 429 || (status >= 500 && status <= 599),
        };
      }
    },
  },
};

// ── jx providers (Phase 2b, Stage-1.5 lanes) — the same lazy-import + cred-guard idiom. ONE
// non-agentic schema-enforced completions call per mark×lane turns the mark into native-script
// register candidates; tests inject an executor, the dev instance uses CLEAROTRON_JX_FIXTURES. Knobs:
//   CLEAROTRON_JX_MODEL                          — model override (default haiku — cheap structured task)
//   CLEAROTRON_JX_FIXTURES                       — dir of <mark-kebab>.<lane>.json canned candidate lists
//                                              ({candidates:[{term,kind,rationale}]}) — the $0 seam
//
// ── / — THE NATIVE-LANGUAGE LANES RUN ON THE PROGRAM THE CUSTOMER CHOSE ────────────────
//
// Owner ruling 2026-08-20, verbatim: "one LLM provider only ever, API or auth, no mix." These three
// lanes were the mix. They POSTed to the Anthropic Messages API on `ANTHROPIC_API_KEY` at a hardcoded
// haiku tier no matter which engine the run was configured for — so round 21f9b0ad's receipt carried
// engine `openai-agent` / SUBSCRIPTION on its agentic stages and `anthropic-direct` / API-KEY on all
// eleven jx calls, and every round this project has run has mixed subscription with metered spend.
//
// They now take `engine.runTurn()`, the same door every stage uses, through `engine/jx-turn.mjs` —
// which resolves the run's billing mode first (the trap probe.mjs documents) and reports the vendor,
// the billing mode and the SERVED model on every result, success or degrade.
//
// `JX_ANTHROPIC_API_KEY` was deleted by and `ANTHROPIC_API_KEY` follows it out of this path: the
// lanes no longer authenticate anything themselves. There is no `credEnv` here any more because there
// is no separate credential — the engine's is the only one, and its absence is refused at the engine
// door rather than re-checked here.
//
// WHAT THIS COSTS, STATED. `tool_choice` forced the answer's shape and a CLI turn cannot be forced, so
// the shape is asked for and validated instead — this engine's house pattern everywhere else. The
// safety that replaces the forcing lives in providers/jx/src/turn-envelope.mjs: an answer the parser
// cannot read is a DEGRADE with a cause, never an empty result. Without that, an unreadable judge reply
// would have meant every SERP hit came back unclassified, which a report reads as no adverse hits.
async function jxRunner() {
  const { makeJxTurnRunner } = await import("./engine/jx-turn.mjs");
  return makeJxTurnRunner();
}

/** One lane's dispatch: resolve the engine, lazy-import the pure core, run it on the turn. */
async function jxLane(kind, mod, call) {
  const runner = await jxRunner();
  if (runner.error) return { ok: false, cause: `jx ${kind}: ${runner.error}` };
  let core;
  try { core = await import(mod); }
  catch (e) { return { ok: false, cause: `jx ${kind} core unavailable: ${e.message}` }; }
  try { return await call(core, runner.turn); }
  catch (e) { return { ok: false, cause: `jx ${kind} call threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
}

export const JX_PROVIDERS = {
  completions: {
    generate: ({ mark, productContext, lane }) =>
      jxLane("completions", "../providers/jx/src/core.js",
        (core, turn) => core.generateCandidates({ mark, productContext, lane, turn })),
  },
  // Phase 4 slice 2 — the SERP-grid hit judge (classification only; retrieval is code-side).
  judge: {
    judge: ({ mark, hits }) =>
      jxLane("judge", "../providers/jx/src/judge.js",
        (mod, turn) => mod.judgeHits({ mark, hits, turn })),
  },
  // Phase 4 slice 3 — the nativeread lane (reads the code-inlined zh evidence slice, returns structured
  // flags; severity_hint never sets a band).
  nativeread: {
    read: ({ mark, lane, payload }) =>
      jxLane("nativeread", "../providers/jx/src/nativeread.js",
        (mod, turn) => mod.generateReadItems({ mark, lane, payload, turn })),
  },
};

// ── SERP providers (Phase 4, jx platform grid) — the same lazy-import + cred-guard idiom, for
// CODE-side search-engine calls (no model in the data path; the executePlan discipline). Knobs:
//   SERPAPI_API_KEY          — required for live grid cells (absent ⇒ every cell gaps, loud)
//   (the three CLEAROTRON_JX_* arms and the two model overrides are GONE —  item 8 deleted the arms,
//    / deleted the overrides when the lanes moved onto the run's engine. The zh units now run
//    whenever the product carries jxLanes and the lane is not killed, and say why when they do not.)
//   CLEAROTRON_JX_FIXTURES       — same dir as slice 1: <mark-kebab>.<lane>.serp.json / .judge.json /
//                              .read.json canned payloads — the $0 seam for all three units
export const SERP_PROVIDERS = {
  serpapi: {
    // As for perplexity above — the vendor's name, for the provider inventory.
    label: "SerpAPI",
    credEnv: "SERPAPI_API_KEY",
    // As above — the field pair setup derives its prompt from (: this key was never
    // prompted for, and a reader who finished setup as designed had every marketplace grid cell gap).
    absentMeans: "every marketplace grid cell comes back as a disclosed gap instead of a result",
    obtain: "https://serpapi.com/manage-api-key — self-serve, free tier exists",
    async search({ engine, term, site, count }) {
      if (!process.env.SERPAPI_API_KEY) return { ok: false, cause: "SERPAPI_API_KEY absent from driver env" };
      let core;
      try { core = await import("../providers/serpapi/src/core.js"); }
      catch (e) { return { ok: false, cause: `serpapi core unavailable: ${e.message}` }; }
      try {
        return await core.searchCell({ engine, term, site, count, apiKey: process.env.SERPAPI_API_KEY });
      } catch (e) { return { ok: false, cause: `serp call threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
    },
  },
};

// doc-27 Item 2: fail fast / fail closed on a missing register credential. The active provider's record
// fetch is the ONLY way to verify a cited registry record's fields; without its credential every registry
// citation ships UNVERIFIED — a degradation that must surface at run START (and on resume), never be
// discovered at delivery (the teal-bastion cascade: a resume inherited artifacts but not CORSEARCH_SESSION_KEY).
// Provider-agnostic — reads the active adapter's `credEnv`, never a baked-in provider name. Throws; the
// caller (pipelineInner) lets it abort the run before any model spend.
/**
 * Which of a provider's required credential variables are missing. EVERY variable, not just `credEnv`.
 *
 * Exported because preflightCredentials was not the only site asking this question, and the other one
 * asked it with `Boolean(process.env[adapter.credEnv])` — a HALF check that says "credential present"
 * for a euipo instance holding the id and no secret, and for a free-tier instance holding one member of
 * two. fixed the half-check here and left the other site; would have made it a THIRD-check.
 * One predicate, so they cannot drift apart again.
 */
export function missingCredentials(provider = activeProvider(), env = process.env) {
  const required = [provider.credEnv, ...(Array.isArray(provider.credEnvAlso) ? provider.credEnvAlso : [])];
  return required.filter((k) => k && !String(env[k] ?? "").trim());
}

export function preflightCredentials(env = process.env) {
  // — the provider comes from the SAME env as the variables. It used to come from a module const
  // frozen at import, so a caller validating a candidate environment was told about the ambient one.
  // `env === process.env` (the default, and every production call site) takes the const path exactly as
  // before; anything else answers about what it was handed.
  const p = activeProvider(env);
  // EVERY required variable, not just the first. Three providers authenticate with a single key, so
  // `credEnv` alone was the whole check — and it silently became a HALF check when euipo arrived
  //, which needs an OAuth id AND secret. With only `credEnv` tested, an instance holding
  // EUIPO_CLIENT_ID and no secret passes preflight, spawns the stage, and dies on the first token
  // request — after model spend, and reported as a provider fault rather than a missing credential.
  // `credEnvAlso` is optional, so the three single-key providers are unchanged.
  const required = [p.credEnv, ...(Array.isArray(p.credEnvAlso) ? p.credEnvAlso : [])];
  const missing = required.filter((k) => !String(env[k] ?? "").trim());
  if (missing.length) {
    throw new Error(`[preflight] missing ${missing.join(" + ")} for register provider "${p.id}" — set `
      + `${missing.length > 1 ? "them" : "it"} in ~/.env / the systemd EnvironmentFile and reload before `
      + "running (a run cannot verify registry citations without it)");
  }
  // A CREDENTIAL IS NOT A CAPABILITY, and this door checked only the first.
  //
  // The key proves the vendor will answer. It does not prove this adapter can run a frozen search
  // plan, and the two come apart: signa ships `recordFetch` alone, so `planExec` resolves to null in
  // pipeline.mjs and the run falls to the AGENT lane. That is not a slower search, it is a model
  // asked to page a register by hand. The provider call log on the saturation-probe axis showed the
  // model silently skipping its one required call in roughly a third of runs and shipping a
  // hand-written band in its place (four named runs, July 2026) — and that was WITH an executor tool
  // present to skip. Signa was the case that made the door necessary: its MCP server mounted only
  // `register_search` and `register_record_fetch`, so there was no such tool, and its search returned
  // no corpus total against which a short answer could be caught. mounted the two missing tools
  // and turned the total on, so signa passes this door now — the example is kept because it is
  // what the refusal is FOR, and the next provider wired will arrive in exactly that state.
  //
  // REFUSED BY NAME, HERE, because the failure it prevents does not look like one: the run completes,
  // the report renders, and the coverage it claims was never searched. A thin band discovered
  // downstream is the same defect after the spend.
  if (typeof p.executePlan !== "function") {
    const capable = Object.values(PROVIDERS).filter((x) => typeof x.executePlan === "function").map((x) => x.id);
    throw new Error(`[preflight] register provider "${p.id}" has no plan executor — it can hold a `
      + `credential but cannot run a frozen search plan, so the run would fall to the model lane and `
      + `report coverage it never searched; set CLEAROTRON_DATABASE to one of `
      + `${capable.join(" / ")}, or wire an executePlan adapter for "${p.id}"`);
  }
  return { provider: p.id, credEnv: p.credEnv, checked: required, planExecutor: true };
}

// ── The RESEARCH credential, for the products whose answer is not severable without it ───────────────
//
// preflightCredentials' sibling, at the same door and for the same reason, and DELIBERATELY NOT the same
// answer for every lane — because the two lanes were already ruled apart and this only moves WHEN the
// clearance half fails, never WHETHER it does.
//
// ADR-0003's table (docs/decisions/0003-credential-model.md) settles it per component: a Knockout search
// carries `registerProbe: true`, so its register half is a whole product without the sweep — it SKIPS and
// discloses ( acceptance 6, pipeline-knockout.mjs's resolveSweepExecutor). The three clearance
// searches carry `commonLawGrid: true`, and their unregistered-use half is NOT severable: a clearance
// missing it is not a smaller clearance, it is the same report with a hole where the answer was. So the
// clearance must fail — and it already did, at the common-law stage, after every early stage had been
// paid for. This door is that same failure, moved in front of the spend.
//
// GATED ON THE COMPONENT, NEVER ON THE PIPELINE. `pipeline === "clearance"` is the wrong predicate and
// fails in the expensive direction: `prelim-register-only` is a clearance that carries
// `commonLawGrid: false`, searches no unregistered-use half by design, and would be refused for a
// credential its lane never reads. The component IS the question — search-policy.mjs calls it "the
// clearance's unregistered-use half" in as many words.
//
// RETIRED ROWS ARE CAUGHT, which is the case that matters most and is easy to miss: `policyFor` answers
// from RETIRED_POLICIES too, and the retired Depth 4 / Depth 5 rows carry `commonLawGrid: true`. A resume
// of an archived clearance therefore refuses here rather than falling through to the old late failure.
//
// An UNRESOLVABLE product does NOT fire it. `policyFor` returns null for a product this build cannot
// name, and a null policy is an unknown, not a clearance — so the run behaves exactly as it does today
// and fails late if it fails at all. That is the conservative direction: this door can only ever move a
// failure earlier, never invent one.
//
// THE CREDENTIAL PREDICATE IS `missingCredentials`, the same one the register door uses, reading the
// adapter's own `credEnv`. Not `process.env.PERPLEXITY_API_KEY`. The literal is what makes a check a
// HALF check the day a second variable arrives — and are both that bug, found twice, and the
// note on missingCredentials above says one predicate exists so they cannot drift apart again.
/**
 * Refuse, before any spend, a product whose unregistered-use half cannot run. Throws, like
 * preflightCredentials, and is called at the same door in pipelineInner — before buildRunContext, so the
 * throw rides the queue-level `intake-<base>.prerun-failed` packet lane with no run dir behind it.
 *
 * Takes the resolved POLICY rather than the product string: the caller already has it (it computes the
 * knockout exemption from the same lookup), and passing the row keeps this file from importing the
 * product registry.
 *
 * @returns `{ checked: false }` when the product carries no common-law grid — a statement that the door
 *          did not apply, never a pass. An absence is a finding, so it is said rather than implied.
 */
export function preflightResearchCredential(policy, env = process.env) {
  if (policy?.components?.commonLawGrid !== true)
    return { checked: false, component: "commonLawGrid", credEnv: null, missing: [] };
  const research = RESEARCH_PROVIDERS.perplexity;
  const missing = missingCredentials(research, env);
  if (missing.length) {
    throw new Error(`[preflight] missing ${missing.join(" + ")} for the common-law / marketplace sweep `
      + `on product "${policy.product}" — every clearance searches the unregistered-use half and it `
      + `cannot be switched off, so this run would spend on its register stages and then fail at the `
      + `grid with no answer for that half; set ${missing.length > 1 ? "them" : "it"} in ~/.env / the `
      + "systemd EnvironmentFile and reload before running (a Knockout search needs no research "
      + "credential — it discloses the half it skipped instead)");
  }
  return { checked: true, component: "commonLawGrid", credEnv: research.credEnv, missing: [] };
}

// ── The engine binary exists and can be executed — checked the same way, at the same door ────────────
//
// preflightCredentials' sibling, and for the same reason: a run whose work is impossible must say so
// before it costs anything and before it leaves a run directory behind. A missing register key was
// already caught here. A missing ENGINE was not, and it is the one every first-time reader hits — the
// engine is spawned per stage, so an unusable binary surfaced as a stage failure, after the run dir,
// the frozen profile and the status sidecar existed, wearing the shape of a model fault.
//
// FILESYSTEM ONLY. It never spawns anything. `claude --version` would be a truer test and is the wrong
// one: it costs a process at every run start, some builds of a coding CLI touch the network or a
// credential store on any invocation, and a preflight that can hang is worse than the failure it
// screens for. What is checked is what spawn(2) itself needs — a regular file, on the resolved path,
// with the execute bit for this process.
//
// ── the relative-path trap this exists to name ───────────────────────────────────────────────────────
//
// `CLEAROTRON_CLAUDE_PATH=driver/test/mock-claude.mjs` looks obviously correct and cannot work. Node resolves
// a relative command against the CHILD's cwd, and since the child's cwd is the RUN DIRECTORY
// (engine/common.mjs resolveSpawnCwd: cwd || runDir || tmpdir) — so the engine looks for
// `<pool>/<run>/driver/test/mock-claude.mjs` and finds nothing. The path was never relative to the
// repo, and the failure arrives per stage with an ENOENT naming a path nobody typed. the developer env example
// shipped exactly this value, so the trap was the documented setting, not an unlucky one. Refused here
// by name, with the absolute form spelled out.
// EXPORTED, because setup was asking the same question with a second, hardcoded answer:
// bin/onboard.mjs resolved `CLEAROTRON_CLAUDE_PATH || "claude"` and wrote `CLEAROTRON_AI=anthropic-agent`
// unconditionally, so a reader who runs codex had no supported path through the wizard and the two
// lists could disagree in silence. One registry now, read by the run-door preflight below, by the
// turn probe (engine/probe.mjs) and by the wizard's engine menu.
//
// `module`/`adapter` are STRINGS, deliberately: driver.config must not import an engine (see the drift
// test's note at preflight-engine-binary.test.mjs), and a path is not an import. engine/probe.mjs
// dynamic-imports the one leaf it needs, so nothing here gains an engine dependency.
//
// `label` and `signIn` live here for the same reason the binary variable does — they are per-engine
// facts, and a second place to write them down is a second place for them to go stale. `signIn` is the
// instruction the openai adapter already emits at runtime (openai-agent.mjs, the auth.json refusal).
export const ENGINE_BINARIES = {
  // item 5 — `authEnv` / `apiKeyEnv` are HERE because this table is what the wizard and the
  // run-door preflight both read, and the billing mode is the one engine fact they were each guessing
  // at separately. `engine/auth.mjs` still owns the DECISION (it resolves and refuses); this only names
  // the two variables that decision reads, so setup can ask about them without hardcoding a second copy.
  //
  // THE PAIRING IS THE POINT, and getting it wrong is the defect item 5 exists to fix from the other
  // side: openai's key is `CODEX_API_KEY`, NOT `OPENAI_API_KEY` — `openai-agent.mjs` deliberately strips
  // OPENAI_API_KEY for a clean subscription bill, so a wizard that adopted it would write a .env whose
  // api-key mode `auth.mjs` refuses. `driver/test/onboard-wizard.test.mjs` drives resolveAuthMode from
  // these fields rather than comparing them to literals, so the table cannot drift from the resolver.
  "anthropic-agent": {
    // `vendor` is the one word a person needs — the staff config page answers "which engine is
    // running the searches", and `label` below is the MECHANISM, which is what took off that page.
    vendor: "Anthropic",
    env: "CLEAROTRON_CLAUDE_PATH", fallback: "claude",
    label: "Anthropic — each stage runs as a headless `claude -p` turn",
    module: "engine/anthropic-agent.mjs", adapter: "anthropicAgentEngine",
    signIn: "run `claude` once in a terminal and complete the sign-in",
    authEnv: "CLEAROTRON_AI_BILLING", apiKeyEnv: "ANTHROPIC_API_KEY",
    subscriptionHow: "sign in once with `claude`",
    // — HERE RATHER THAN IN THE WIZARD, for the same reason `authEnv` is: this table is what the
    // wizard and the run-door preflight both read, and an install command living in the wizard would be
    // a second place an engine is described. Verified against the registry 2026-08-24: 2.1.241.
    //
    // npm, NOT the vendor's shell installer. `curl … | bash` is the other documented route for this CLI
    // and the wizard will not run one: a command this product executes on someone's box has to be one
    // they can read in full before they answer, and a piped remote script is not.
    install: "npm install -g @anthropic-ai/claude-code",
    // — THE NO-ROOT ROUTE, NAMED AND NEVER EXECUTED. The stance above holds: this
    // product does not run a piped remote script. But on a box whose npm prefix needs root, the npm
    // route CANNOT work as this user, and offering only it was a dead end the owner hit. The wizard
    // prints this for the reader to run BY THEIR OWN HAND in another terminal — their shell, their
    // eyes, their decision — and says where it lands so the path answer afterwards is not a guess.
    installNoRoot: { cmd: "curl -fsSL https://claude.ai/install.sh | bash", lands: "~/.local/bin" },
    // — the documented headless ending. `claude setup-token` walks the sign-in and
    // prints a long-lived token; the stage subprocess env is a spread of the driver's — spawnEnv
    // strips ONLY the API key under subscription — so a token in the env file reaches the CLI
    // untouched, and that inheritance is the whole mechanism (armed in engine.anthropic.test.mjs). The wizard
    // captures it by paste: the vendor's stream layout is not ours to guess at, and a paste works
    // whatever it prints where.
    headless: { cmd: "claude setup-token", tokenEnv: "CLAUDE_CODE_OAUTH_TOKEN" },
  },
  "openai-agent": {
    vendor: "OpenAI",
    env: "CLEAROTRON_CODEX_PATH", fallback: "codex",
    label: "OpenAI — each stage runs as a headless `codex exec` turn",
    module: "engine/openai-agent.mjs", adapter: "openaiAgentEngine",
    signIn: "run `codex login`",
    authEnv: "CLEAROTRON_AI_BILLING", apiKeyEnv: "CODEX_API_KEY",
    subscriptionHow: "sign in once with `codex login` — the adapter reads ~/.codex/auth.json and refuses before spending if it is absent",
    // Verified against the registry 2026-08-24: 0.149.1.
    install: "npm install -g @openai/codex",
    // — no vendor shell installer exists for this CLI; the no-root answer on a
    // root-only prefix is npm's own prefix move, which the wizard names the same way.
    installNoRoot: null,
    // — codex's headless ending writes its own ~/.codex/auth.json; there is no
    // token to capture into an env file, and inventing one would be a route nobody has driven.
    headless: { cmd: "codex login --device-auth", tokenEnv: null },
  },
};

/** The production default, in ONE place rather than a literal repeated at every reader. */
export const DEFAULT_ENGINE_ID = "anthropic-agent";

/**
 * The adapter module for an engine, as an import specifier — or null for an id this driver does not ship.
 *
 * A specifier, not a module: the caller decides when (and whether) to pay for the import. The wizard
 * pays only when it is actually about to probe; nothing pays on a `--check` that was not asked to.
 */
export function engineAdapterSpecifier(engine) {
  const spec = ENGINE_BINARIES[String(engine ?? "").trim().toLowerCase()];
  return spec ? pathToFileURL(join(DRIVER_DIR, spec.module)).href : null;
}

/** Resolve `name` the way spawn(2) would, or null. No separator ⇒ a PATH walk; otherwise the path itself. */
function resolveExecutable(name, env) {
  const executable = (p) => { try { return statSync(p).isFile() && (accessSync(p, X_OK), true); } catch { return null; } };
  if (name.includes("/")) return executable(name) ? name : null;
  for (const dir of String(env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const p = join(dir, name);
    if (executable(p)) return p;
  }
  return null;
}

/**
 * Refuse a run whose engine binary is missing, unexecutable, or written as a relative path.
 *
 * Throws, like preflightCredentials, and is called at the same door — pipelineInner, before the run
 * context is built. Returns {engine, binEnv, bin, resolved} when the binary is usable.
 *
 * An UNKNOWN CLEAROTRON_AI returns without checking rather than throwing a second, differently-worded
 * version of gateway.selectEngine's error. One definition of "that is not an engine", and it is the
 * registry's.
 */
export function preflightEngineBinary(env = process.env, { platform = process.platform } = {}) {
  // item 3 — NATIVE WINDOWS REFUSES BY NAME, BEFORE ANYTHING READS PATH.
  //
  // INSTALL.md promises a native-Windows run "refuses at preflight" and names the reason. Nothing
  // implemented it, so what a Windows user actually got was the PATH resolver below — which splits on
  // ":" and therefore tears `C:\Users\…` in half at the drive letter. The refusal then told them their
  // `claude.cmd` was "not on PATH as an executable file" and printed a PATH that had been mangled on the
  // way to saying so. A true statement about a false premise, and a wild-goose chase for the reader.
  //
  // This fires FIRST for that reason: any message mentioning PATH on win32 is misleading whatever else
  // it says, because the value it quotes has already been destroyed by the split.
  //
  // `platform` is injectable so the refusal is testable off win32 — the population this protects is the
  // one that cannot run this suite to find out.
  if (platform === "win32") {
    throw new Error("[preflight] this engine does not run on native Windows. Stage subprocesses are spawned "
      + "with POSIX path and process semantics, and the PATH resolution below splits on \":\", which cuts a "
      + "Windows path at its drive letter — so any message it produced about your engine binary would be "
      + "about a mangled path. Run it under WSL2, or in the devcontainer (.devcontainer/), where the "
      + "documented install path applies unchanged (#1149 item 3).");
  }
  const engine = (env.CLEAROTRON_AI || DEFAULT_ENGINE_ID).trim().toLowerCase();
  const spec = ENGINE_BINARIES[engine];
  if (!spec) return { engine, binEnv: null, bin: null, resolved: null };   // selectEngine owns this refusal

  // — THE DIAGNOSTIC NAMES THE CURRENT SPELLING, WHICH IS NOT WHAT IT DID.
  //
  // `spec.env` is the RETIRED name. Every refusal below quoted it whichever spelling the operator had
  // actually set, so someone who typoed `CLEAROTRON_CLAUDE_PATH` was told the problem lay in a variable
  // they never touched. Measured on the bare install; it is the same defect `install --check` had.
  //
  // THE LOOKUP WAS NEVER BROKEN, and that correction matters more than the fix. `shared/env-local.mjs`
  // runs `warnRetiredEnv()` at module load, which back-fills the retired key from the current one
  // before any consumer reads it — so the value has always arrived. A first reading of this site said
  // otherwise; it was taken by calling this function with a hand-built env object, which never passes
  // through that module. Testing the function is not testing the path.
  //
  // `envFrom` is therefore BELT-AND-BRACES, not the repair: it makes this site correct on its own terms
  // rather than correct because something upstream normalised the environment first — a coupling
  // nothing at this site declares and nothing here could notice breaking.
  const bin = String(envFrom(env, spec.env) ?? "").trim() || spec.fallback;
  const where = `${spec.env}${envFrom(env, spec.env) ? "" : ` (unset — defaulting to "${spec.fallback}")`}`;

  if (bin.includes("/") && !isAbsolute(bin)) {
    throw new Error(`[preflight] ${where} is the RELATIVE path "${bin}", which cannot work: the engine is `
      + "spawned with the RUN DIRECTORY as its cwd (#524), not the repo, so a relative command is looked "
      + `for inside the run. Give an absolute path — e.g. ${join(REPO_ROOT, bin)} — or a bare name on PATH.`);
  }

  const resolved = resolveExecutable(bin, env);
  if (!resolved) {
    throw new Error(`[preflight] the ${engine} engine cannot run: ${where} names "${bin}", which is `
      + (bin.includes("/")
        ? "not an executable file (it is missing, is a directory, or lacks the execute bit for this user)"
        : `not on PATH as an executable file (PATH=${env.PATH || "(empty)"})`)
      + ". Every stage of a run spawns it, so the run is refused now rather than at the first stage.");
  }
  return { engine, binEnv: spec.env, bin, resolved };
}

// Report which deployment hostnames are unset, so the runner can say so out loud at activation.
//
// Deliberately does NOT throw, unlike its sibling preflightCredentials. A missing register credential
// makes the work impossible; a missing hostname only makes a LINK impossible — the report is still
// researched, published to poolRoot and delivered. Aborting there would suppress a sound deliverable
// over a config typo, which is the opposite of how this system is meant to fail (see the delivery gate:
// the artifact ships and the gate annotates). Every consumer already degrades honestly on its own —
// publishReport's `poolUrl ? … : null`, render.mjs's fail-closed connectors, the omitted access note —
// so this exists to make that degradation LOUD rather than silent.
//
// The bug it guards against: before this, each of those consumers carried a `|| "…example.com"` fallback,
// so a forgotten env did not degrade at all. It shipped a confident, dead link (2026-07-19).
export function preflightDeploymentUrls(env = process.env) {
  const unset = (k) => !String(env[k] ?? "").trim();
  const missing = [];
  const warnings = [];
  // Required in practice: a delivered report nobody can open is a broken deliverable, even though the
  // run itself succeeded. Loud, not fatal.
  if (unset("CLEAROTRON_REPORTS_URL")) missing.push("CLEAROTRON_REPORTS_URL — delivered reports will carry NO link (set the pool's public base URL in the EnvironmentFile)");
  // Optional: their absence removes an affordance, not the deliverable.
  if (unset("CLEAROTRON_MCP_URL")) warnings.push("CLEAROTRON_MCP_URL — the report omits its 'Ask your AI' connector (one report; the block is staff-only at serve time)");
  if (unset("CLEAROTRON_CLIENT_MCP_URL")) warnings.push("CLEAROTRON_CLIENT_MCP_URL — the portal's /portal/api/mcp-access answers {url:null}, so the client Use-your-AI screen shows its empty state");
  if (unset("CLEAROTRON_ACCESS_DOMAIN")) warnings.push("CLEAROTRON_ACCESS_DOMAIN — the delivery email omits its access note");
  return { poolUrl: env.CLEAROTRON_REPORTS_URL ?? "", missing, warnings };
}

// ── There is room to write the run — the third refusal at the same door ──────────────────────────────
//
//. A run that exhausts the disk does NOT report a disk error. It reports a MISSING ARTIFACT,
// because that is what the next stage observes: the stage wrote a truncated or zero-byte file, the
// reader threw on it, and the failure is filed against the reader — a stage unrelated to the cause,
// after arbitrary model spend. "Artifact absent" is indistinguishable from a genuine engine or provider
// fault, so the debugging goes to the wrong subsystem. That is the same shape bin/uspto-sync.mjs's disk
// block was written to prevent on the index side; the clearance side had nothing at all.
//
// ── THE NUMBER, AND WHERE IT COMES FROM ──────────────────────────────────────────────────────────────
//
// NOT the index build's figure. INSTALL.md §3a's 41.5 GB download and 20 GB provisioning figure (both
// from shared/uspto-index-size.mjs,) are what a US register build costs; a
// clearance run's footprint is three orders of magnitude smaller, and borrowing that number would
// refuse every run on every laptop the product is meant to run on.
//
// Measured 2026-08-12, on the UNFROZEN source of demo — one real delivered run on the
// fictional mark VENQORI (Nice 9 + 41, EU, 174 register-plan entries, nine stages, verdict
// CONDITIONAL). The run's codename is deliberately not written here: this repo is de-identified by
// design and `driver/test/no-client-identifiers.test.mjs` fails the build on a real one.
//
//   run directory          5.85 MB apparent / 6.6 MB allocated, 269 files
//   its archived copy      5.72 MB — both exist at once through delivery, so ~11.6 MB is the peak
//   of which _driver/      2.95 MB, half the total: the dispatch prompts, per-stage telemetry, the
//                          run event log. THIS is the half that scales.
//   demo    1.15 MB / 43 files — the frozen publish-subset, a floor and not a footprint
//
// The scaling term is axes × classes × attempts, and the engine records its own worst case:
// engine/anthropic-agent.mjs notes a register-unit primary-sweep prompt at "150 KB+ on a 4-class mark",
// against this two-class run's 23 KB — about 6.5×. Ten times the measured run, ~60 MB, is therefore a
// generous reading of the largest run this evidence supports.
//
// The floor below is 500 MB: roughly 8× that projected worst case and 85× the run actually measured.
// It is deliberately NOT a sizing estimate. It is the line below which a Linux filesystem is in trouble
// for reasons that have nothing to do with this product, and the issue's constraint decides the
// direction to err — "a check that refuses runs on a machine with plenty of room is worse than no
// check". No machine with plenty of room has less than 500 MB free.
const RUN_FREE_BYTES_FLOOR = 500e6;

/** Nearest ancestor of `p` that exists. statfs needs a real path, and on a first run NONE of
 *  …/workspace-<agent>/studio/prelim-search exists yet — measuring the leaf would throw ENOENT and land
 *  in the unmeasurable branch, which would disable this check on exactly the fresh installs it is for. */
function nearestExistingDir(p) {
  let dir = p;
  for (let i = 0; i < 64; i++) {
    if (existsSync(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) return dir;
    dir = up;
  }
  return dir;
}

/**
 * The DECISION, with no filesystem in it. Split out for the same reason bin/onboard.mjs splits
 * usptoSyncPlan from offerUsptoSync: a threshold nobody can test without filling a disk is a threshold
 * nobody tests.
 */
export function freeSpacePlan({ freeBytes, needBytes, path }) {
  const gb = (n) => `${(n / 1e9).toFixed(2)} GB`;
  if (freeBytes >= needBytes) return { ok: true, freeBytes, needBytes, path, reason: null };
  return {
    ok: false, freeBytes, needBytes, path,
    reason: `[preflight] not enough free disk to run. ${gb(freeBytes)} free on the filesystem holding `
      + `${path}; this door requires ${gb(needBytes)}.\n`
      + `  A run that fills the disk does not report a disk error — it reports a MISSING ARTIFACT at `
      + `whatever stage reads the truncated file next, after the model spend that produced it. The run `
      + `is refused here instead, before anything is written and before a run directory exists.\n`
      + `  Free space on that filesystem, point CLEAROTRON_WORK_DIR at one that has room, or set `
      + `CLEAROTRON_MIN_FREE_DISK_MB to a lower floor (0 disables this check) if you know something it does not.`,
  };
}

/**
 * Refuse a run that has nowhere to write. Throws, like preflightCredentials and preflightEngineBinary,
 * and is called at the same door — pipelineInner, before the run context is built.
 *
 * UNCONDITIONAL, like preflightEngineBinary and unlike preflightCredentials. Every lane writes a run
 * directory: a knockout does, a run with an injected recordFetcher does, a resume does. There is no
 * shape of run that can proceed without one, so there is no exemption to write.
 *
 * MEASURES THE FILESYSTEM THAT WILL HOLD THE BYTES, which is the workspace root's, not `/` and not the
 * repo's. Run directories live under config.studioRoot (…/workspace-<agent>/studio/prelim-search); the
 * published report goes to poolRoot and the packet to outboxDir, which on a laptop are different
 * filesystems again. A check aimed at the wrong mount passes while the right one is full, which is the
 * silent-pass this exists to prevent — so the path is taken from the caller's studioRoot when the runner
 * passes one, exactly as buildRunContext does.
 *
 * ONE FILESYSTEM, DELIBERATELY: the run directory's. Not an oversight — poolRoot and outboxDir receive a
 * published copy at the END of a run, measured at 5.72 MB and a few KB respectively, while the run
 * directory takes every byte written DURING it. Refusing a run over the pool's free space would also
 * make the door depend on a mount the run does not need until it has already succeeded, and on
 * production it is not readable by every account that can start a run. A pool that is full is a
 * delivery failure with an artifact to point at, which is a different and far less silent shape than
 * the one this guards.
 *
 * AN UNMEASURABLE DISK IS NOT A PASS. Returned as a warning for the caller to say out loud, following
 * bin/uspto-sync.mjs's precedent: "an unread guard reported as silence is how the rule it enforces stops
 * existing." It does not refuse, because statfs failing is a fact about the checker, not about the disk.
 *
 * `statfs` is injectable for the same reason bin/onboard.mjs's wizard injects one: the unmeasurable
 * branch is the arm most likely to rot, it cannot be reached by choosing an awkward path (statfs answers
 * for files and for missing leaves alike), and an untested fail-open arm is how a guard quietly stops
 * being one.
 */
export function preflightFreeSpace(env = process.env, studioRoot = null, statfs = statfsSync) {
  const raw = String(env.CLEAROTRON_MIN_FREE_DISK_MB ?? "").trim();
  let needBytes = RUN_FREE_BYTES_FLOOR;
  if (raw) {
    const mb = Number(raw);
    // A typo'd threshold must not silently disable the check — that is the failure mode of the guard
    // itself. Only an explicit 0 turns it off.
    if (!Number.isFinite(mb) || mb < 0)
      throw new Error(`[preflight] CLEAROTRON_MIN_FREE_DISK_MB="${raw}" is not a number of megabytes. Set a `
        + "number (0 disables the free-space check), or unset it for the default "
        + `${RUN_FREE_BYTES_FLOOR / 1e6} MB.`);
    if (mb === 0) return { checked: false, disabled: true, path: null, freeBytes: null, needBytes: 0, warning: null };
    needBytes = mb * 1e6;
  }
  const target = nearestExistingDir(studioRoot || config.studioRoot);
  let freeBytes;
  try {
    const fsInfo = statfs(target);
    freeBytes = fsInfo.bavail * fsInfo.bsize;
  } catch (e) {
    return {
      checked: false, disabled: false, path: target, freeBytes: null, needBytes,
      warning: `[preflight] could not measure free space on ${target} (${e?.message ?? e}). Proceeding `
        + `UNCHECKED — this run wants at least ${(needBytes / 1e6).toFixed(0)} MB, and a disk that fills `
        + "mid-run surfaces as a missing artifact, not as a disk error.",
    };
  }
  const plan = freeSpacePlan({ freeBytes, needBytes, path: target });
  if (!plan.ok) throw new Error(plan.reason);
  return { checked: true, disabled: false, path: target, freeBytes, needBytes, warning: null };
}
