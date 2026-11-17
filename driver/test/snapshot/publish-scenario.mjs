// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish-scenario.mjs <spec.json> — publish one saved run, and compose its email, in a process of its own: the driver
// reads its configuration at import, and the clock is frozen before anything loads so two commits can be compared byte for byte.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FROZEN = Date.UTC(2026, 0, 15, 12, 0, 0);
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(FROZEN); }
  static now() { return FROZEN; }
};

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const load = (rel) => import(pathToFileURL(join(spec.driver, rel)).href);
const { republishRun } = await load("publish/report-registry.mjs");
const meta = JSON.parse(readFileSync(spec.metaFile, "utf8"));
const url = "https://reports.example.test";
// The rows publishing appends to the run's own log are part of what it does, so they are kept with what it returns.
const runLogFile = join(spec.runDir, "_driver", "run.jsonl");
const logBefore = existsSync(runLogFile) ? readFileSync(runLogFile, "utf8").length : 0;
const published = await republishRun({ runId: meta.runId, meta, pool: spec.pool, poolUrl: url, runDir: spec.runDir });
const logRows = existsSync(runLogFile) ? readFileSync(runLogFile, "utf8").slice(logBefore).split("\n").filter(Boolean) : [];

const profileFile = join(spec.runDir, "_driver", "profile.json");
const delivery = existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, "utf8"))?.delivery : undefined;
const reportMd = join(spec.runDir, "report.md");
const email = {};
if (existsSync(reportMd)) {
  const { composeEmailBody, composeEmailHtml, coverNoteOptions } = await load("publish/index.mjs");
  email.text = composeEmailBody(reportMd, published.url, published.auditFile);
  if (coverNoteOptions) {
    // The cover note composed with the options the publisher's one function reads, which the report document carries too.
    const opts = coverNoteOptions(spec.runDir);
    email.html = composeEmailHtml(reportMd, published.url, published.auditFile, [], delivery, opts);
    email.cover = JSON.stringify({ tier: opts.tier ?? null, statement: opts.statement ?? null });
  } else {
    // The cover note composed as the delivery composes it from its own reads: the frozen policy's product name, the verdict
    // record as written, and the run's band ladder.
    const { reportIdentityFor } = await load("search-policy.mjs");
    const { clientConditions } = await load("terminal-clamp.mjs");
    const { parseFrameworkManifest } = await load("framework.mjs");
    const frozen = (name, parse = JSON.parse) => { try { return parse(readFileSync(join(spec.runDir, "_driver", name), "utf8")); } catch { return null; } };
    const opts = { productName: reportIdentityFor(frozen("search-policy.json")).identity ?? undefined };
    const v = frozen("verdict.json");
    if (v) Object.assign(opts, { verdict: v.verdict, conditions: clientConditions(v), tier: v.tier, statement: v.statement ?? null });
    const framework = frozen("framework.json", parseFrameworkManifest);
    if (framework) opts.bands = framework.bands.map((b) => ({ label: b.label, tone: b.tone }));
    email.html = composeEmailHtml(reportMd, published.url, published.auditFile, [], delivery, opts);
    email.cover = JSON.stringify({ tier: opts.tier ?? null, statement: opts.statement ?? null });
  }
} else {
  const { composeKnockoutEmail, knockoutName } = await load("publish/knockout.mjs");
  const { worstBand } = await load("verify-knockout.mjs");
  const findings = JSON.parse(readFileSync(join(spec.runDir, "knockout-findings.json"), "utf8"));
  const framework = JSON.parse(readFileSync(join(spec.runDir, "_driver", "framework.json"), "utf8"));
  // The product's name as the delivery takes it, from the run's frozen policy, where the build names it at all.
  const policyFile = join(spec.runDir, "_driver", "search-policy.json");
  const named = knockoutName ? { productName: knockoutName(existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, "utf8")) : null) } : {};
  email.html = composeKnockoutEmail({ findings, framework, overall: worstBand(framework, findings.marks ?? []), reports: published.reports, auditUrl: published.auditUrl, job: meta.job ?? {}, ...named });
}
writeFileSync(spec.resultFile, JSON.stringify({ email, returned: published ?? null, logRows }));
process.exit(0);
