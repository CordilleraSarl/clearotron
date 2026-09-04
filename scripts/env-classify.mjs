#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// env-classify.mjs — step 1: WHAT EACH CONFIGURATION VARIABLE IS, AND WHO HAS EVER SET IT.
//
// The evidence steps 3 and 4 rest on. The issue's own words: this is what stops them being judgement
// calls. So it has to be RE-RUNNABLE by whoever reviews a deletion — an evidence base only its author
// can regenerate is an assertion wearing a measurement's clothes.
//
//   node scripts/env-classify.mjs            print the classification
//   node scripts/env-classify.mjs --apply    write docs/architecture/env-classification.json
//   node scripts/env-classify.mjs --check    rebuild and diff against the committed artifact
//   node scripts/env-classify.mjs --gather-prod --unit-dir <d> --env-file <f>   the production name list
//
// ── WHAT IS READ, AND WHAT IS NEVER READ ─────────────────────────────────────────────────────────
//
// NAMES ONLY, everywhere. No value from any environment reaches this file or its output. The
// production half additionally cannot run without privilege, so its name list is COMMITTED
// (docs/architecture/env-set-in-production.txt) and read from there: a reviewer re-runs everything
// else and diffs against that file rather than taking the production half on trust.
//
// ── THE CLASSIFIER MOVED FOUR TIMES, AND EVERY MOVE CAME FROM PRINTING THE OUTPUT ────────────────
//
// Recorded because it is the reason the sub-classification exists at all:
//
//   141 -> 117  the setup set was matched LITERALLY. The wizard writes the retired spellings and the
//               catalogue carries the current ones, so six of the fourteen variables a user MUST set
//               were classed as deletable knobs. Now routed through the alias table.
//   117 ->  88  vendor credentials are their own class: a key is set or the vendor refuses.
//    88 ->  87  the deployment rule widened against the evidence — nine names production or test
//               actually set were sitting in tuning. A directory or an identity is never a knob.
//    87 ->  22  the "set nowhere" list read one at a time, and 62 of 84 left it.
//
// None of those came from reasoning about the classifier. Each came from looking at what it printed.
import "../shared/env-local.mjs";   // — FIRST, and it became REQUIRED here:
                                     // importing AMBIENT_KEYS makes this entry statically reach
                                     // driver.config.mjs, which captures env at module top. Without this
                                     // the capture evaluates before the CLEAROTRON_* translation lands. A
                                     // call in this file's BODY would run too late. The guard named the
                                     // file, the module it reaches, and the fix.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
// — the product-owned-names rule, shared rather than a regex in this file.
import { makeIsProductOwned, partitionByOwnership, droppedShape, FILTER_DECLARATION }
  from "../shared/product-owned-names.mjs";
import { AMBIENT_KEYS } from "../bin/onboard.mjs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ART = join(ROOT, "docs/architecture/env-classification.json");
const PROD = join(ROOT, "docs/architecture/env-set-in-production.txt");
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const git = (...a) => { try { return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 1e8 }); } catch { return ""; } };

/** Assignment NAMES from a shell-shaped env file. Values are matched and discarded, never returned. */
export function namesInEnvFile(text) {
  return [...text.matchAll(/^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
}
/** Every house or vendor variable MENTIONED in a script — the shape the config repo's bin/ writes. */
export function namesMentioned(text) {
  return [...text.matchAll(/\b(?:PRELIM|CLEAROTRON|PORTAL|TRADEMARK_MCP|CLIENT_MCP|CLIENT_ACCESS|PROFILE|RECIPE|MOCK)_[A-Z0-9_]+/g)].map((m) => m[0]);
}

/**
 * The environments, each named, each gathered by the shape THAT source actually writes.
 *
 * The config repo returned two names on the first pass because it was read with `.env` shape alone and
 * it writes its variables in `bin/` scripts. An empty result from the wrong shape is not evidence, and
 * that mistake is why each source below states its own shape rather than sharing one.
 */
// — NO EXECUTABLE LINE NAMES A SPECIFIC ACCOUNT'S HOME. These paths are per-box facts and this
// script ships. They arrive as COMMAND-LINE FLAGS, not environment variables.
//
// The first fix used four new house-prefixed variables instead, and 's ratchet refused them —
// correctly: adding four names to the configuration surface is precisely wrong in the tool built to
// shrink it, and a maintainer's per-invocation path is an argument. The names are deliberately not
// written out even here: `namesRead` scans comments too, and a variable that exists only in prose is
// the "flattered by its own retirement notice" shape `env-audit.mjs` already documents.
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "";
};

export function gather({ root = ROOT, prodList = read(PROD) } = {}) {
  const set = (xs) => new Set(xs.filter(Boolean));
  const tracked = (glob) => git("ls-files", "--", glob).split("\n").filter(Boolean);
  const sudoRead = (p) => { try { return execFileSync("sudo", ["-n", "cat", p], { encoding: "utf8" }); } catch { return ""; } };

  const config = flag("config-repo") ? [flag("config-repo")] : [];
  return {
    // COMMITTED, not gathered: the production read needs privilege a reviewer does not have.
    prod: set(prodList.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))),
    test: set(flag("test-env") ? namesInEnvFile(sudoRead(flag("test-env"))) : []),
    config: set(config.flatMap((r) => {
      let files = []; try { files = execFileSync("sudo", ["-n", "find", r, "-type", "f", "-not", "-path", "*/.git/*"], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; }
      return files.flatMap((f) => { const t = sudoRead(f); return [...namesInEnvFile(t), ...namesMentioned(t)]; });
    })),
    ci: set([...read(join(root, ".github/workflows/ci.yml")).matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1])),
    e2e: set(["scripts/e2e.mjs", "scripts/test-run.mjs"].flatMap((f) => namesMentioned(read(join(root, f))))),
    // A DESCRIPTION, never a setting. Kept apart so `everSet` cannot be satisfied by documentation.
    docs: set([".env.example", ".env.dev.example", ".env.prod.example"]
      .flatMap((f) => [...read(join(root, f)).matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]))),
    _tracked: tracked,
  };
}

/** The setup population: what the wizard WRITES, expanded through the alias table. */
export function setupNames(root = ROOT) {
  const onboard = read(join(root, "bin/onboard.mjs"));
  const cfg = read(join(root, "driver/driver.config.mjs"));
  const seed = new Set();
  for (const m of onboard.matchAll(/candidate\.([A-Z][A-Z0-9_]*)\s*=/g)) seed.add(m[1]);
  for (const m of onboard.matchAll(/candidate\["([A-Z][A-Z0-9_]*)"\]\s*=/g)) seed.add(m[1]);
  for (const m of onboard.matchAll(/credentials:\s*\[([^\]]*)\]/g)) for (const c of m[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)) seed.add(c[1]);
  // `tokenEnv` joined the row shape with (the headless sign-in's captured token —
  // the wizard writes it through a COMPUTED key, `candidate[eng.headless.tokenEnv]`, so the literal
  // candidate-write matchers above cannot see it; the table field is the one derivable spelling).
  for (const m of cfg.matchAll(/(?:env|authEnv|apiKeyEnv|credEnv|tokenEnv):\s*"([A-Z][A-Z0-9_]*)"/g)) seed.add(m[1]);
  const out = new Set();
  for (const n of seed) for (const sp of [n]) out.add(sp);
  return out;
}

// THE AUDIENCE DECISION FOR NAMES A PREFIX USED TO CARRY — listed, because a rename must not move it.
//
// Every name here was classified `deployment` by one of DEPLOY_RE's PREFIX arms and by nothing else.
// That made its audience a property of its spelling, and step 4 gives the whole tree ONE
// house prefix — so each of these would have stopped matching and fallen through to `tuning`, which is
// the bucket step 3 deletes from. Measured on 5be17c2: 39 names change class, 27 of them land on the
// deletion population, among them PORTAL_LOCAL_CREDENTIAL, TRADEMARK_MCP_TOKEN_DENYLIST and
// TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS — the key-rotation predecessor.
//
// Nothing would have said so. `--check` is the only thing that compares the artifact to the tree, and
// it ran in no workflow, no hook and no test; the reproducibility arm deliberately does not re-run the
// classifier. This commit wires `--check` into CI, which is the half that makes the drift audible.
//
// The comment beside AUDIENCE/ISSUER below already recorded this class, one name at a time:
// "a rename is exactly when a shape-based classifier goes wrong, and this one is a rename programme."
// This is that sentence applied to the whole population instead of to the name that happened to bite.
//
// DEPLOY_RE keeps its prefix arms. They are not the mechanism any more, so a sweep may retire them with
// the prefixes themselves; until then they change no answer, which is what makes this refactor provable
// — the committed artifact is byte-identical across it.
export const DEPLOYMENT_NAMES = new Set([
  "CF_ACCESS_TEAM",
  // — `CLEAROTRON_DEMO`, which is `PORTAL_DEMO` renamed. It is listed here for
  // the exact reason this list exists: the old name was `deployment` because of its `PORTAL_` prefix and
  // by nothing else, so moving it to the house prefix dropped it through to `tuning` — the bucket step 3
  // deletes from. The audience did not change; only the spelling did, and this list is what says so.
  "CLEAROTRON_DEMO",
  "CLIENT_MCP_ACCOUNT_ACCESS",
  "CLIENT_MCP_ALLOWED_HOSTS",
  "CLIENT_MCP_AUTH_DISABLED",
  "CLIENT_MCP_AUTH_HEADER",
  "CLIENT_MCP_DEV",
  "CLIENT_MCP_EMAIL_CLAIM",
  "CLIENT_MCP_SESSION_MAX",
  "CLIENT_MCP_SESSION_TTL_MS",
  "CLIENT_MCP_TOKEN_ONLY",
  "MCP_ALLOWED_EMAILS",
  "PORTAL_AUDIT",
  "PORTAL_AUTH_HEADER",
  "PORTAL_AUTH_MODE",
  "PORTAL_EMAIL_CLAIM",
  "PORTAL_LOCAL_CREDENTIAL",
  // The passphrase handoff beside it, and listed for the same reason its credential sibling above
  // is: `deployment` by the `PORTAL_` prefix arm and by nothing else, so the house-prefix sweep
  // would drop it into `tuning` — the bucket step 3 deletes from. Its audience is the install, not a
  // tuning knob, and it is never set by anyone: the supervisor mints it and hands it to the portal at
  // the spawn call. That makes it MORE important to list, not less — a name nobody sets is a name
  // nobody would miss from a sweep report.
  "PORTAL_LOCAL_PASSPHRASE",
  "PORTAL_LOCAL_USER",
  "PORTAL_LOCAL_WORKER",
  "PORTAL_OPS_TOKEN",
  "PORTAL_READ_MODEL",
  "PORTAL_SECRET",
  "PROFILE_AUDIT",
  "PROFILE_AUTH_DISABLED",
  "PROFILE_AUTH_HEADER",
  "PROFILE_DEV",
  "PROFILE_EMAIL_CLAIM",
  "RECIPE_AUDIT",
  "RECIPE_AUTH_DISABLED",
  "RECIPE_AUTH_HEADER",
  "RECIPE_DEV",
  "RECIPE_EMAIL_CLAIM",
  "TRADEMARK_MCP_ALLOWED_HOSTS",
  "TRADEMARK_MCP_AUDIT_LOG",
  "TRADEMARK_MCP_AUTH_DISABLED",
  "TRADEMARK_MCP_AUTH_HEADER",
  "TRADEMARK_MCP_AUTH_MODE",
  "TRADEMARK_MCP_DEV",
  "TRADEMARK_MCP_EMAIL_CLAIM",
  "TRADEMARK_MCP_MAX_BYTES",
  "TRADEMARK_MCP_SESSION_MAX",
  "TRADEMARK_MCP_SESSION_TTL_MS",
  "TRADEMARK_MCP_TOKEN_DENYLIST",
  "TRADEMARK_MCP_TOKEN_SECRET",
  "TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS",
]);

// A hosted concern: identity, address, directory, tenancy. Never a knob — it says WHERE this instance's
// data is or WHO may reach it, and both differ per deployment by definition.
export const DEPLOY_RE = new RegExp([
  "^PORTAL_", "^TRADEMARK_MCP_", "^CLIENT_MCP_", "^CLIENT_ACCESS_", "^CLIENT_CF_", "^CF_ACCESS_",
  "^MCP_ALLOWED", "^PROFILE_", "^RECIPE_",
  "_HOST$", "_PORT$", "_URL$", "_DIR$", "_ROOT$", "_FILE$", "_DOMAIN$", "_DOMAINS$",
  "GRANTS", "ACCESS_FILE", "STAFF_DOMAINS", "BRAND", "RATE", "TENANT", "BLOCKLIST",
  // AUDIENCE and ISSUER joined the day renamed `CLEAROTRON_OIDC_AUDIENCE` to `CLEAROTRON_OIDC_AUDIENCE`:
  // the prefix rule no longer matched, and an IDENTITY AUDIENCE landed in the tuning bucket. It was
  // excluded from the deletion list for an unrelated reason (no default found), which is luck, not a
  // guard. A rename is exactly when a shape-based classifier goes wrong, and this one is a rename
  // programme.
  "AUDIENCE", "ISSUER", "OIDC",
].join("|"));
export const VENDOR_RE = /^(AZURE_OPENAI|OPENAI|ANTHROPIC|CODEX|PERPLEXITY|SERPAPI|SIGNA|EUIPO|USPTO|CORSEARCH|CLARIVATE|OAUTH_BRIDGE)_/;

/**
 * Test files that SET this name — an env pin, an object-literal key, or a `pinEnv` call.
 *
 * The governance and classification suites are excluded by name: they LIST every variable as data, and
 * counting a catalogue as a setter would make every knob an instrument and the bucket meaningless.
 */
export function testFilesSetting(name, root = ROOT) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `(^|[{,[:space:]])${n}[[:space:]]*:|process\\.env\\.${n}[[:space:]]*=|pinEnv\\([^)]*${n}`;
  return git("grep", "-lE", pattern, "--", "driver/test/*", "mcp-server/test/*")
    .split("\n").filter(Boolean)
    .filter((f) => !/env-governance|env-classification|env-aliases/.test(f));
}

/** The default literal at a read site, or null when the code branches on presence instead. */
export function defaultAtReadSite(name, root = ROOT) {
  const hits = git("grep", "-h", "--", name, "--", "*.mjs", "*.js").split("\n");
  for (const line of hits) {
    if (line.trim().startsWith("//")) continue;
    const m = new RegExp(`${name}\\s*(?:\\]|\\))?\\s*(?:\\|\\||\\?\\?)\\s*("([^"]*)"|'([^']*)'|[0-9_.]+|true|false)`).exec(line);
    if (m) return m[1];
  }
  return null;
}

/** The whole classification, pure over its inputs so a test drives it without a box. */
export function classify({ catalogue, sources, setup = setupNames(), readSites = defaultAtReadSite,
  deploymentNames = DEPLOYMENT_NAMES } = {}) {
  // ONE NAMED OVERRIDE, and it is listed rather than folded into a pattern so that it can be argued
  // with. `CLEAROTRON_AGENT_WHATSAPP` matches no deployment shape and is not a knob: production sets it to
  // a contact map, so it is a notification DESTINATION. Established from the SHAPE of the value, never
  // its content. A pattern wide enough to catch it would have swept in real knobs.
  const OVERRIDES = { CLEAROTRON_AGENT_WHATSAPP: "deployment" };

  const cls = (name) => OVERRIDES[name] ?? (setup.has(name) ? "setup"
    : VENDOR_RE.test(name) ? "vendor-credential"
    // The listed audience is consulted BEFORE the shapes, so a renamed name keeps the class a human gave
    // it rather than the one its new spelling happens to match.
    : deploymentNames.has(name) ? "deployment"
    : DEPLOY_RE.test(name) ? "deployment" : "tuning");

  const rows = catalogue.map((name) => {
    const setIn = ["prod", "test", "config", "ci", "e2e"].filter((k) => sources[k]?.has(name));
    return { name, class: cls(name), everSet: setIn, documented: Boolean(sources.docs?.has(name)) };
  });

  // "Set nowhere" is not by itself a licence to delete, and this is where 62 of 84 left the list.
  const tuning = rows.filter((r) => r.class === "tuning" && !r.everSet.length).map((r) => r.name);
  const GATE_RE = /(===|!==|==|!=)\s*"[01]"|"[01]"\s*(===|!==|==|!=)|\|\|\s*"1"/;
  const sub = {};
  for (const n of tuning) {
    const body = git("grep", "-n", "--", n, "--", "*.mjs", "*.js")
      .split("\n").filter((l) => l && !/(^|\/)test\//.test(l)).join("\n");
    const onlyTests = git("grep", "-l", "--", n, "--", "*.mjs", "*.js").split("\n").filter(Boolean)
      .every((f) => /(^|\/)test\/|\.test\.mjs$|^scripts\/e2e\.mjs$|mock-/.test(f));
    // AN INSTRUMENT IS A KNOB A TEST SETS, whoever reads it. The first rule here was "read ONLY by
    // tests", which is narrower than the thing it was trying to name: `CLEAROTRON_OUTBOX_BACKOFF_BASE_SEC`
    // is read by product code and SET by `outbox-backoff.test.mjs` to make a 60-second backoff
    // testable in milliseconds. Deleting it does not remove a knob nobody uses — it removes the only
    // way that test can run at all.
    //
    // Measured when the 23 candidates were finally read one at a time: TWELVE of them are set by a
    // test, `CLEAROTRON_RECOVERY_MAX` by fifty-two. The population went 84 → 23 → 11, and each shrink came
    // from looking rather than from pattern-matching.
    const setByATest = testFilesSetting(n).length > 0;
    if (onlyTests || setByATest || /FIXTURES|PROBE|REPLAY|DUMP|DISPATCH_RECORD|SEED|SESSION_(KEY|ID)|EXPECT_/.test(n)) sub[n] = "instrument";
    else if (/MODEL|PRESET|_AGENT$|AGENTS$/.test(n)) sub[n] = "model-or-agent-selector";
    else if (GATE_RE.test(body)) sub[n] = "path-switch";
    else {
      const d = readSites(n);
      sub[n] = d === null ? "no-default-found" : /^[0-9_.]+$/.test(d) ? "deletable-number" : "non-numeric-default";
    }
  }
  const of = (k) => tuning.filter((n) => sub[n] === k).sort();
  return { rows, sub, buckets: {
    instrument: of("instrument"), "path-switch": of("path-switch"),
    "model-or-agent-selector": of("model-or-agent-selector"),
    "non-numeric-default": of("non-numeric-default"), "no-default-found": of("no-default-found"),
    "deletable-number": of("deletable-number"),
  } };
}

function build() {
  const audit = JSON.parse(execFileSync(process.execPath, [join(ROOT, "scripts/env-audit.mjs"), "--json"],
    { encoding: "utf8", cwd: ROOT, maxBuffer: 1e8 }));
  const catalogue = audit.catalogue.rows.map((r) => r.name);
  const sources = gather();
  const { rows, buckets } = classify({ catalogue, sources });
  const by = (k) => rows.filter((r) => r.class === k).length;
  return {
    _what: "#1838 step 1 — every catalogued variable classified, and for every TUNING name the environments that have ever set it.",
    _how: "Regenerate with: node scripts/env-classify.mjs --check   (the production half is read from docs/architecture/env-set-in-production.txt, which needs `--gather-prod` on the production box to refresh).",
    _values: "NO VALUE from any environment is read into this artifact. Names only.",
    _counts: { rows: rows.length, setup: by("setup"), deployment: by("deployment"), vendorCredential: by("vendor-credential"), tuning: by("tuning") },
    _stepThreePopulation: {
      _what: "What step 3 may act on: a numeric default, and no environment anywhere sets it.",
      _warning: "A candidate list, not a licence. Each still needs its read site read and its guard checked before deletion.",
      names: buckets["deletable-number"], count: buckets["deletable-number"].length,
    },
    _excludedFromDeletion: {
      instrument: buckets.instrument, "path-switch": buckets["path-switch"],
      "model-or-agent-selector": buckets["model-or-agent-selector"],
      "non-numeric-default": buckets["non-numeric-default"], "no-default-found": buckets["no-default-found"],
    },
    rows,
  };
}

function main() {
  const arg = process.argv[2];
  if (arg === "--gather-prod") {
    // ON THE PRODUCTION BOX ONLY, and names only. Never the block: prod unit Environment= lines carry
    // live keys inline, and dumping one to read a name would print a secret.
    const D = flag("unit-dir"), envFile = flag("env-file");
    if (!D || !envFile) {
      console.error("env-classify --gather-prod --unit-dir <dir> --env-file <file>\n"
        + "  Both are required and neither is defaulted: a hardcoded account name is the defect this "
        + "tool exists to find.");
      process.exitCode = 2; return;
    }
    const names = new Set();
    for (const f of execFileSync("sudo", ["-n", "sh", "-c", `ls ${D}/*.service ${D}/*.service.d/*.conf 2>/dev/null`], { encoding: "utf8" }).split("\n").filter(Boolean)) {
      for (const l of execFileSync("sudo", ["-n", "cat", f], { encoding: "utf8" }).split("\n")) {
        if (!l.startsWith("Environment=")) continue;
        for (const tok of l.slice("Environment=".length).split(/\s+/)) { const n = tok.replace(/^"/, "").split("=")[0]; if (/^[A-Z][A-Z0-9_]*$/.test(n)) names.add(n); }
      }
    }
    for (const n of namesInEnvFile(execFileSync("sudo", ["-n", "cat", envFile], { encoding: "utf8" }))) names.add(n);
    // and the de-identification rule — THIS LIST SHIPS. A production box runs more than this
    // product, and dumping its whole environment name list into the repository carried another
    // product's variables, a retired platform's, and personal integrations whose names identify a
    // PERSON into a tree that must name none of them.
    //
    // — THE FILTER IS NOW A SHARED RULE, NOT A REGEX HERE. It was prefixes only, and
    // measured against the committed file that drops 16 of 72 names, MOST OF THEM THIS PRODUCT'S OWN:
    // the register and research credentials are named after the vendors they reach. A gather with that
    // filter would have silently deleted them from the file a reviewer diffs against.
    //
    // AND IT REPORTS WHAT IT DROPPED. A filter that drops silently replaces one invisible loss with
    // another; the shape goes to stderr so the artifact stays exactly the names, and it is grouped by
    // first token and COUNTED rather than listed, because a dropped name can identify someone.
    const catalogueNames = [];
    for (const f of [".env.example", ".env.deployment.example", ".env.dev.example", ".env.prod.example"]) {
      try {
        const txt = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
        for (const m of txt.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)) catalogueNames.push(m[1]);
      } catch { /* an absent example file narrows the allowlist; the drop report shows the effect */ }
    }
    const isOwned = makeIsProductOwned({ credentialNames: AMBIENT_KEYS, catalogueNames });
    const { kept, dropped } = partitionByOwnership([...names], isOwned);
    console.error(`# ${FILTER_DECLARATION}`);
    console.error(`# gathered ${names.size}, kept ${kept.length}, dropped ${dropped.length}`);
    for (const [head, n] of droppedShape(dropped)) console.error(`#   dropped ${n} beginning ${head}_`);
    console.log(kept.sort().join("\n"));
    return;
  }
  const next = build();
  if (arg === "--apply") { writeFileSync(ART, JSON.stringify(next, null, 2) + "\n"); console.log(`wrote ${ART}`); return; }
  if (arg === "--check") {
    const prev = existsSync(ART) ? readFileSync(ART, "utf8") : "";
    const same = prev === JSON.stringify(next, null, 2) + "\n";
    console.log(same ? "CHECK — the committed classification matches this tree." : "CHECK FAILED — the classification is stale. Re-stamp: node scripts/env-classify.mjs --apply");
    if (!same) process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(next._counts));
  console.log(`step-3 population: ${next._stepThreePopulation.count}`);
  for (const [k, v] of Object.entries(next._excludedFromDeletion)) console.log(`  excluded ${k.padEnd(24)} ${v.length}`);
}

if (isEntrypoint(import.meta.url)) main();
