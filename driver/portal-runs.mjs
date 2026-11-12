// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-runs.mjs — the runs a portal reader can see: delivered runs from the pool's records, live and queued ones from the
// workspace, and the account a run belongs to. Moved out of portal-service.mjs unchanged; the service exports it as before.
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve as pathResolve } from "node:path";
import { clientFailureNote } from "../shared/client-failure-note.mjs";
import { studioDirFor } from "../shared/pre-rename-spellings.mjs";
import { batchMarkName } from "./mark-name.mjs";
import { resolveNumericSetting } from "./numeric-setting.mjs";
import { seesEverything } from "./portal-access.mjs";
import { reportsOf } from "./portal-report.mjs";
import { stageNow } from "./progress.mjs";
import { readArchivedSet } from "./publish/archive-tags.mjs";
import { orderedQueueFiles } from "./queue-order.mjs";
import { paths, readJson } from "./run-record.mjs";
import { policyFor, reportIdentityFor } from "./search-policy.mjs";
import { drainingState } from "./worker-heartbeat.mjs";

// A run in one of these has finished; its step is the one its terminal write set, not the stage it last entered.
const TERMINAL_STATES = new Set(["delivered", "failed", "cancelled"]);

// The band ladder a run was rated against, and the tone of the band it landed on.
//
// Tone, not label, is what the UI colours and sorts by, and the join has to happen HERE because the
// server is the only side that knows the framework. Ladders are framework-scoped: house-default has four
// stops and says "Moderate" where house-triage says "Medium". A client that mapped labels to colours
// itself would mis-colour every customer whose framework is not the one it was written against.
//
// A run with no framework (every run archived before doc-50) yields an empty ladder and a null tone. That
// is honest — it was not rated against a ladder — and the UI renders the label alone, uncoloured.
function ladderOf(meta) {
  const bands = Array.isArray(meta.framework?.bands)
    ? meta.framework.bands.filter((b) => b && typeof b.label === "string" && typeof b.tone === "string")
      .map((b) => ({ label: b.label, tone: b.tone }))
    : [];
  const toneFor = (label) => bands.find((b) => b.label === label)?.tone ?? null;
  return { bands, toneFor };
}

// ── run listing: delivered (pool metas) + live (workspace status + frozen profile sidecar) ─────────
//
// `account` null means EVERY account — the staff "All brand owners" view. Every row carries its own
// `account` either way, so the caller never has to infer ownership from the request it made.
/** The registry's display face for a stored product key, or null for one it does not know. It answers for
 *  a RETIRED key too — a delivered run keeps the name it was sold under, which is the whole reason those
 *  rows still exist (search-policy.mjs RETIRED_POLICIES). */
const stageLabelOf = (product) => (typeof product === "string" ? policyFor(product)?.stageLabel ?? null : null);

/** THE PRODUCT'S CLIENT-FACING NAME for a run row — the same resolver, and the same field, the
 *  delivered report's masthead prints. The browser used to hold its own switch from product key to label
 *  (`home.ts depthLabel`), which is a mapping table in a second place: it drifted once already, listing
 *  only the five retired slugs so every run this build creates rendered a blank chip.
 *
 *  `.identity`, never `.banner` or `stageLabel` — on a RETIRED row those carry "Depth 4", and a depth
 *  number must never reach a client's screen. Null for a level the registry has forgotten: the chip goes
 *  blank rather than naming a search the run may not have been. */
const productNameOf = (product) => (typeof product === "string" ? reportIdentityFor(product).identity ?? null : null);

// `account` accepts one key, or an ARRAY of keys for an identity that holds several — the multi-brand
// client asking for all of its own work at once. An array is exactly the union of what that caller can
// already fetch one key at a time, so it widens no boundary; it just spares the browser one request per
// brand owner against a 120/min limit. It is NOT a wildcard: an empty array matches nothing, which is
// the safe direction, and `null` (every account) stays reachable only from scanAllRuns.
export function scanAccountRuns({ poolRoot, workspaceRoot, account = null, generic = null, includeRetired = false,
  // — THE QUEUES THE RUNNER ACTUALLY DRAINS, which is not the same set as the
  // directories under `workspaceRoot`. Defaults to [] so a caller that passes none keeps exactly the
  // behaviour it had; the service passes `config.queueDirs`, the same getter the allowance counter reads.
  queueDirs = [] }) {
  const out = [];
  const only = Array.isArray(account) ? new Set(account) : null;
  // GENERIC IS MATCHED BY ORGANISATION when the caller says which. `generic` is `{ all: true }` or
  // `{ orgs, unfiled }`: a Generic run matches when it was filed under one of `orgs`, or was filed under
  // none and `unfiled` asks for those too. Without it, `account` alone decides, exactly as before.
  const mine = (owner, organisation = null) => {
    if (owner === "generic" && generic) return generic.all === true
      || (organisation != null ? (generic.orgs ?? []).includes(organisation) : generic.unfiled === true);
    return only ? only.has(owner) : account === null || owner === account;
  };
  // RETIRED RUNS ARE NOT LISTED HERE — unless the caller is the staff retired view, and asks.
  //
  // `pool-admin archive` has always written this sidecar, and until now the ONLY reader was the old
  // static index — the surface the edge stopped serving at the portal cutover. So the command reported
  // success, the staff index it re-rendered was unreachable, and the run stayed in full view on the one
  // page anybody actually opens. A curation verb that silently does nothing to the live surface is worse
  // than not having one: it is a control that lies about having worked.
  //
  // Retired for EVERY reader, staff included: that has not changed, and `includeRetired` does not widen
  // it. What changed is where the CONTROL lives. This comment used to argue that a portal fold
  // would be "a second place to look, out of step with the CLI" — true while retiring was only a CLI
  // act, and wrong the moment staff could retire from the screen they are already on. A control whose
  // inverse lives in a terminal on another host is a one-way door. So the portal now carries both, and
  // `includeRetired` is what the staff-only "Show retired" route reads. The default is unchanged, every
  // client-facing caller takes it, and nothing a client can request reaches this flag.
  //
  // Read once per scan rather than per run: a scan is a directory walk over the whole pool and this is
  // one small file, so re-reading it per entry would be the only O(n) sidecar read in the function.
  //
  // THE REPORT ROUTE IS DELIBERATELY NOT GATED ON THIS. Retiring a run takes it off the list; it does
  // not revoke a link. Report URLs are in email we have already sent, and the Caddyfile's legacy-report
  // rewrite exists precisely so those keep resolving — 404ing them here would rot them from a curation
  // command, which is not what "archive" means to the person typing it. Ownership is still enforced at
  // that route, unchanged; retirement is about what the pool ADVERTISES, not about who may read what.
  const retired = readArchivedSet(poolRoot);
  try {
    for (const name of readdirSync(poolRoot)) {
      const metaPath = join(poolRoot, name, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = readJson(metaPath);
        const owner = meta.customerKey || "generic";
        if (!mine(owner, meta.organisation ?? null)) continue;
        // Tagged by runId — the same key pool-admin writes, which is the pool DIRECTORY name. Checking
        // both guards the one case where they differ: a meta whose runId was rewritten by a republish.
        const isRetired = retired.has(meta.runId ?? name) || retired.has(name);
        if (isRetired && !includeRetired) continue;
        // The retired view is EXCLUSIVELY retired runs, not the whole pool with a flag: it is the fold
        // you open to find something you filed, and mixing the live list into it would make "Show
        // retired" a second copy of the page you are already looking at.
        if (!isRetired && includeRetired) continue;
        // ONE report, one audience rule: a run you have rights to is always listed and served (spec
        // 2026-07-30 §5). The client gate's "held" state is retired — the machine-QC record lives in
        // meta.clientGate for the workbook/staff-index surfaces and decides nothing here.
        // WHICH DOCUMENTS THIS RUN HAS, off its own meta. `existsSync("report.html")` was the
        // test, and a knockout batch no longer publishes that file — every batch would have listed as
        // having no report at all while carrying three. reportsOf() reads the published list and answers
        // `report.html` for a run that predates it, which is every archived run and every clearance.
        const docs = reportsOf(meta).filter((r) => existsSync(join(poolRoot, name, r.file)));
        const { bands, toneFor } = ladderOf(meta);
        const band = meta.overall ?? null;   // the rating; a meta's retired `verdict` held the reviewer's sign-off on the full-search lane
        out.push({ runId: meta.runId ?? name, account: owner, ...(owner === "generic" ? { organisation: meta.organisation ?? null } : {}),
          title: meta.title ?? meta.matter ?? name, kind: meta.kind ?? "clearance",
          // THE MARK, separate from the report's headline.
          //
          // `title` is model-authored front matter: a real run carries "AquaPlus — US Preliminary
          // Trademark Clearance" as its title while the typed mark is "AquaPlus". The UI needs the mark
          // to name a row and to group reads; it needs the headline for nothing. Written into meta at
          // publish, so runs delivered before that carry null and consumers fall back to title.
          markName: typeof meta.markName === "string" ? meta.markName : null,
          // WHICH PROJECT (engagement) THIS RAN UNDER.
          //
          // Stamped into meta at publish from the run's frozen profile sidecar. Absent on every run
          // delivered before that stamp, and deliberately not back-filled: the sidecar is the only
          // honest source and it does not travel with a pool dir. Null therefore means "we do not know",
          // never "no project" — so nothing downstream may render it as "no project".
          projectKey: typeof meta.projectKey === "string" ? meta.projectKey : null,
          projectName: typeof meta.projectName === "string" ? meta.projectName : null,
          // Which read this is, for the Stages cell.
          //
          // THE REGISTRY FIRST, the frozen stamp only as a last resort — the same rule reportIdentityFor
          // follows, and it has to be the same rule or the product has two names on one screen. This read
          // the stamp FIRST, so after the Depth 1-5 renumbering a run's report banner said "Depth 2" while
          // its own row in this list still said "Stage 0.5". One system: the label is a pure function of
          // the level, so deriving it from the level names every run the way the product is named today.
          //
          // `meta.stageLabel` survives as the fallback for a run whose LEVEL the registry no longer knows
          // (a retired row) — there is no current answer there and the stamp beats a blank. A run older
          // than the level registry carries neither and stays null: the cell goes blank rather than
          // inventing a depth that never ran.
          // `meta.searchLevel` is the STORED key on a delivered run's meta.json and keeps its name on
          // disk — an archived run's record is not this build's to rewrite. What the wire carries is
          // `product`, because that is the word every client-facing surface uses now.
          product: meta.searchLevel ?? null,
          stageLabel: stageLabelOf(meta.searchLevel) ?? meta.stageLabel ?? null,
          productName: productNameOf(meta.searchLevel),
          state: "delivered", date: meta.date ?? null,
          // WHEN IT FINISHED, to the second. `date` is DAY precision and always was — it is
          // parsed out of the run directory name. Two reads of one mark delivered on the same day
          // therefore TIE, Array.prototype.sort is stable, and which one the parent row spoke for was
          // decided by readdirSync order rather than by recency.
          //
          // `issuedAt` has been written full-ISO into meta.json at every publish for as long as there
          // has been a publisher; it simply never crossed the wire. Measured on the test instance
          // 2026-08-04, the two House-default reads differ by 2m08s in this field and in nothing else
          // the page renders — which is the whole.
          issuedAt: typeof meta.issuedAt === "string" ? meta.issuedAt : null,
          // `overall` stays for the existing consumers; `band` is the same value under the name the UI
          // uses, alongside the ladder it belongs to.
          overall: band, band, tone: toneFor(band), bands,
          // Knockout batches summarise per name — the list renders "N names, worst: <band>" from this.
          // Each mark's band is resolved against the SAME ladder, so a batch cannot mix vocabularies.
          marks: Array.isArray(meta.marks)
            ? meta.marks.filter((m) => m && typeof m.name === "string")
              .map((m) => ({ name: m.name, band: m.band ?? null, tone: toneFor(m.band ?? null) }))
            : [],
          // Present ⇒ the run has a report-data.json and can render natively. Absent ⇒ legacy: the Result
          // screen iframes the baked file. Legacy is identified by ABSENCE, so this must stay undefined
          // rather than defaulting to 0 or 1.
          // BOTH writers (publish/knockout.mjs and the clearance producer) stamp the STRING
          // 'report-data/1' — gating on `typeof === "number"` alone meant the native-render flag NEVER
          // armed, even for runs with a report-data.json on disk (2026-07-29, filed during PR-9). The
          // string form maps to its numeric version; a bare number is honoured; anything else is legacy.
          reportSchema: typeof meta.reportSchema === "number" ? meta.reportSchema
            : typeof meta.reportSchema === "string" && /^report-data\/(\d+)$/.test(meta.reportSchema)
              ? Number(meta.reportSchema.slice("report-data/".length)) : null,
          // `report` is the run-level link and it is NULL for a batch — there is no run-level document
          // to open. `reports` is the list, one entry per name, and it is what a batch's row renders.
          // A single-document run carries both, pointing at the same place, so nothing that reads
          // `report` today changes shape.
          //
          // BOTH ARE DOCUMENT URLS, and `path` STAYS one. The obvious repair for "the per-mark
          // links open outside the portal" is to point `path` at the portal route instead — and it is
          // wrong twice. `report` is consumed as an IFRAME SOURCE, not as a link, so making its sibling
          // mean something else leaves two fields of the same name-shape with different kinds, and the
          // client that framed one would frame the other and load the shell inside itself. The client
          // needs to build a route; what it lacks for that is the NAME of the document, not a second
          // spelling of its address. That is `slug`, below.
          //
          // `slug` is null on a single-document run: there is one document and no name to pick between,
          // which is the same thing `report` being non-null already says.
          report: docs.length === 1 ? `/portal/report/${encodeURIComponent(name)}/` : null,
          reports: docs.map((r) => ({
            mark: r.mark,
            slug: r.slug ?? null,
            path: r.slug
              ? `/portal/report/${encodeURIComponent(name)}/${encodeURIComponent(r.slug)}/`
              : `/portal/report/${encodeURIComponent(name)}/`,
          })),
          // — stamped only where it is true. A row that says nothing about retirement is a live
          // row, on every surface that has ever consumed this listing; a `retired: false` on all of
          // them would be a new field for every reader to ignore.
          ...(isRetired ? { retired: true } : {}) });
      } catch { /* unreadable meta — skip */ }
    }
  } catch { /* no pool yet */ }
  // live runs: status.json + the frozen profile sidecar (freezeProfile writes `profileKey`)
  const readRun = (dir) => {
    try {
      const s = readJson(join(dir, "status.json"));
      const p = readJson(paths(dir).profile);
      const owner = p.profileKey ?? p.key ?? "generic";
      if (!mine(owner, p.organisation ?? null)) return;
      if (s.state === "delivered") return;   // the pool row is the delivered face
      // ── — RETIREMENT REACHES A RUN THAT NEVER PUBLISHED ──────────────────
      //
      // The pool branch above has honoured the sidecar since; this branch never did, so a tag
      // written for a run that ended without publishing sat in the file doing nothing and the run
      // stayed on the list. That is worse than the refusal it replaces: a control that reports success
      // and changes nothing is the failure `scanAccountRuns`'s own retirement comment is about.
      //
      // The failed and abandoned runs are exactly the ones a reader most wants off the list, so this is
      // the population the control was wanted for, not an edge of it. Same key as the pool branch —
      // the runId — and the same two-way filter, so "Show retired" stays exclusively retired.
      const liveRetired = retired.has(s.runId) || retired.has(basename(dir));
      if (liveRetired && !includeRetired) return;
      if (!liveRetired && includeRetired) return;
      // A live run already HAS the typed mark — status.json is where it has always lived. The frozen
      // search-policy sidecar carries the stage. Both are read here so a run does not change identity
      // when it crosses from live to delivered: same mark, same stage, same thread.
      let sp = null;
      try { sp = readJson(paths(dir).searchPolicy); } catch { /* legacy/early run */ }
      // A PAUSE IS NOT A RUN. The engine writes `postponed` (a rate-limit park, auto-resuming at
      // `resetsAt`) and `recovering` (an auto-retry backing off), and the portal contract knows neither
      // — its coercion treats anything unrecognised as `running`. So a run parked for five hours showed
      // "Running", with the step it had reached before it stopped, and the customer had no way to tell a
      // pause from work. The UI has had a `paused` state and a `.dot.paused` rule the whole time, and
      // nothing on the wire could ever reach them.
      //
      // Mapped here rather than in the browser: the run listing is the one place that already turns
      // engine vocabulary into the words a client reads, and a second translation in the UI is a second
      // thing to keep in step. `pausedKind` keeps the two apart, because they say different things to
      // the person waiting — one has a time, the other is the system retrying itself.
      // `parked-for-human` (A5): the engine's grace-exit park — the runner was stopped (deploy restart)
      // with the run in flight. Mapped HERE, like the other two, so the wire NEVER carries the raw
      // value: the portal contract would coerce an unknown state to "running", which is exactly the
      // zombie face this state exists to end. pausedKind "operator" tells the UI which words to use.
      const paused = s.state === "postponed" || s.state === "recovering" || s.state === "parked-for-human";
      out.push({ ...(liveRetired ? { retired: true } : {}),
        runId: s.runId, account: owner, ...(owner === "generic" ? { organisation: p.organisation ?? null } : {}), title: s.markName ?? s.slug,
        // THE RUN’S OWN PIPELINE, off the frozen policy sidecar this branch already reads — the same
        // source the `product` field two lines down takes, so a row cannot contradict its own product.
        // `s.lane` is the runner’s queue directory and it is not that: a knockout claimed from any other
        // lane arrived here as a clearance, and Home then quoted it the clearance turnaround — hours,
        // against a search that finishes in minutes. The queued rows below were fixed for exactly this
        // and this row was left on the weaker field. The lane stays as the fallback for a run whose
        // sidecar predates the stamp, and an unplaceable product stays a clearance, which is what every
        // listing has always shown for something it could not identify.
        kind: (policyFor(sp?.level)?.pipeline ?? (s.lane === "knockout" ? "knockout" : null)) === "knockout" ? "knockout-batch" : "clearance",
        markName: typeof s.markName === "string" ? s.markName : null,
        // The project, straight off the frozen sidecar this branch already reads as `p`. A LIVE run needs
        // no publish stamp and no back-fill — the sidecar is right there, and freezeProfile has written
        // both fields since spec 62.
        projectKey: typeof p.projectKey === "string" ? p.projectKey : null,
        projectName: typeof p.projectName === "string" ? p.projectName : null,
        // Registry first here too — a live run's frozen policy sidecar names WHICH level is running; what
        // that level is CALLED comes from the registry, so an in-flight run and a delivered one agree.
        product: sp?.level ?? null, stageLabel: stageLabelOf(sp?.level) ?? sp?.stageLabel ?? null,
        productName: productNameOf(sp?.level),
        state: paused ? "paused" : (s.state ?? "running"),
        pausedKind: paused ? (s.state === "recovering" ? "recovering" : s.state === "parked-for-human" ? "operator" : "rate-limit") : null,
        // The ONE honest ETA this system possesses. The engine computes it from the provider's own
        // reset header and has always written it; it reached the ops surface and stopped one hop short
        // of the browser. Absent for a recovery park, which backs off on a schedule rather than to a
        // stated time — so the UI must not promise a clock it does not have.
        resetsAt: typeof s.resetsAt === "string" ? s.resetsAt : null,
        // Elapsed, so a card can say how long this has been going without inventing a finish time.
        startedAt: typeof s.startedAt === "string" ? s.startedAt : null,
        // THE STAGE IT IS IN NOW, a step back into an earlier stage included (owner, 2026-09-19): see
        // stageNow. Only while it is live; a run that has finished keeps the step its terminal write set.
        ...(TERMINAL_STATES.has(s.state)
          ? { step: s.stepLabel ?? null, stepN: s.stepN ?? null, stepTotal: s.stepTotal ?? null }
          : stageNow(s)),
        // — a requested stop is a state the screen shows. Stamped by stop_run,
        // preserved by writeRunStatus's spread-merge, replaced by the terminal when the honour check
        // fires. The UI derives "Stopping…" from this beside a non-terminal state.
        stopRequestedAt: typeof s.stopRequestedAt === "string" ? s.stopRequestedAt : null,
        // — whether a stop can still prevent delivery. FALSE only once a lane has written it, at the
        // moment it commits to publishing. Absent means the run has not reached that point, which is
        // the truthful reading on this build: both lanes write it immediately after their last cancel
        // read. The screen shows its promise on true and withdraws it on false.
        stoppable: s.stoppable === false ? false : true,
        // A failed run with no reason on screen is a run the user has to phone somebody about. Both
        // fields are already written by every failure path (pipeline-knockout.mjs, the driver's
        // writeRunStatus); the listing simply used to drop them.
        reason: s.reason ?? null, failedStage: s.failedStage ?? null,
        // — the engine's OPEN-SET payload, its own field so the portal can show the sentence and
        // hide this. Staff only: the client redaction below replaces `reason` and must drop this too,
        // or the redaction would be defeated by the field that carries the raw words.
        reasonDetail: s.reasonDetail ?? null,
        date: (s.updatedAt ?? "").slice(0, 10), overall: s.tier ?? null,   // the rating, never the reviewer's sign-off word
        // A live run has not been issued, so its last progress write is the honest ordering key — the
        // same role issuedAt plays for a delivered one, never presented as a finish time.
        issuedAt: typeof s.updatedAt === "string" ? s.updatedAt : null,
        // A live run has not been rated yet, so it has no band and no ladder. The UI shows an em-dash.
        //
        // `marks` IS NOT THE BAND LADDER. One array answered two questions and the second answer was a
        // false one: the Result screen reads its LENGTH as a name count, so an empty array told the
        // customer a three-name knockout batch had "0 names" for the entire run — on a row whose own mark
        // string beside it said the batch had three. The names are known from the moment the batch is
        // planned; the BANDS are what a live run does not have, and they stay null here.
        band: null, tone: null, bands: [],
        marks: Array.isArray(s.marks)
          ? s.marks.filter((m) => m && typeof m.name === "string").map((m) => ({ name: m.name, band: null, tone: null }))
          : [],
        reportSchema: null, report: null });
    } catch { /* not a run dir */ }
  };
  // QUEUED BUT NOT YET PICKED UP — the gap between pressing Start and the driver writing a status.json.
  //
  // The queue directory used to be skipped outright, so for that window a started clearance appeared in
  // NOTHING: not the pool, not the live list. The screen that had just promised "it will appear in
  // Clearances" was, for those seconds, wrong — and to anyone who pressed Start and went straight to
  // the list, indistinguishable from a run that never started at all. That ambiguity is the whole
  // reason this exists; the window itself is short (prelim-driver.path fires on the file landing).
  //
  // A PENDING job is `<id>.json` with no suffix — the runner renames to `.done`/`.failed` when it is
  // through, and those are history the pool and live scans already own. Reading only the bare `.json`
  // is therefore what keeps a finished run from appearing twice.
  //
  // ── AND THE TERMINAL MARKERS STAY OUT. THIS IS A DEAD-LETTER STORE, NOT A WORK SURFACE. ────────────
  //
  // 2026-07-28: this scan was briefly widened to also read `<id>.failed` / `.duplicate` /
  // `.manifest.failed`, reasoning that a job refused at the runner's intake gate never gets a run dir,
  // never gets a status.json, and so appears in no surface at all — the row says "Queued · Waiting to
  // start" and then silently disappears. The reasoning was sound. The inference from the data was not.
  //
  // The evidence offered for it was "the live queue is holding thirty of these". What that actually
  // meant is that THIS DIRECTORY HAS NO RETENTION AND NOBODY EVER CLEANS IT. The thirty spanned six
  // weeks and were test artefacts, raw Outlook message ids from the email door, and `mcp-*` dev runs;
  // twenty-six had no `.reason` sidecar at all, so each rendered as a row saying, in effect, something
  // stopped and we cannot say what or why. Twelve carried no `profileKey` and fell through to `generic`.
  // Home and Clearances both read this scan, so both filled with six weeks of dead letters on a morning
  // when nothing was running.
  //
  // A job refused at intake deserves an answer. That answer belongs AT SUBMISSION — the door that
  // refused it knows why, immediately, and can say so to the person standing there. It does not belong
  // to a directory that never forgets. Narrowing this by age or by owner would only make the junk
  // smaller: the source would still be a store with no retention, one policy change away from returning.
  //
  // So: a PENDING job is `<id>.json` with no suffix. The runner renames to `.done`/`.failed` when it is
  // through, and those are history the pool and live scans already own. Reading only the bare `.json` is
  // what keeps a finished run from appearing twice — and what keeps this list about work in progress.
  //
  // ORDER. The rows come back in the order the runner will ADMIT them (queue-order.mjs — the same
  // function drainQueue sorts with, so the list and the engine can never disagree), and each carries
  // a dense 1-based `queuePos`.
  //
  // Dense over the rows THIS CALLER CAN SEE, not the raw index in the lane. A client whose two jobs
  // sit at lane positions 4 and 9 must not be told "4" and "9" — that publishes how much work other
  // tenants have queued, which is the same thing the 404-never-403 rule exists to prevent. Staff
  // reading across every account see the true lane depth anyway, because for them every row is visible.
  const queuedRows = [];   // { row, lane, laneIdx } — positions assigned once the whole scan is in
  // — READ ONCE per scan, not per row: every row of one response must agree about whether a worker
  // exists, and a boundary crossed mid-scan would otherwise put "waiting its turn" and "waiting for a
  // worker" in the same list. A queued job cannot answer this itself — it has no claim and no sidecar, so
  // claim liveness is silent on precisely the rows that need it.
  //
  // `null` means NOT KNOWN, and that is the default EVERYWHERE except a local install. A deployed instance
  // drains through the systemd path/timer units, which run `main({once:true})` and write no heartbeat — so
  // a service that read a missing heartbeat as "no worker" would put a false alarm on every queued row in
  // production. Only the launcher that actually supervises a worker claims to know, and it is the same
  // launcher that sets the lock dir, so the two can never be set without each other.
  const draining = drainingState();
  const readQueued = (dir) => {
    let files = []; try { files = readdirSync(dir); } catch { return; }
    const ordered = orderedQueueFiles(dir, files.filter((f) => f.endsWith(".json") && !f.startsWith(".")));
    for (const [laneIdx, f] of ordered.entries()) {
      try {
        const j = readJson(join(dir, f));
        const owner = j.profileKey ?? "generic";
        if (!mine(owner, j.tenant ?? null)) continue;
        // ALL the names, spelled the way the run's own status.json and its delivered meta.json spell
        // them — this took `marks[0].name` and named ONE mark of N, so a client who had just ordered a
        // three-name knockout screen saw a single name on the row that tells them it went in.
        const mark = batchMarkName(j.marks, typeof j.markName === "string" && j.markName ? j.markName : undefined);
        queuedRows.push({ lane: dir, laneIdx, row: { runId: j.id ?? f.replace(/\.json$/, ""), account: owner, ...(owner === "generic" ? { organisation: j.tenant ?? null } : {}), title: mark ?? (j.id ?? "Queued"),
          // THE JOB'S OWN PIPELINE, not the literal "clearance". The row already carried
          // `product: "knockout-search"` and still called itself a clearance, so it was the one row in
          // the listing that contradicted its own product field — and Result.tsx gates the names line on
          // this, so a queued batch showed no names at all. A product the registry cannot place stays a
          // clearance: that is what the listing has always shown for anything it could not identify.
          kind: policyFor(j.product)?.pipeline === "knockout" ? "knockout-batch" : "clearance",
          markName: mark,
          // The job carries the KEY (portal-service stamps it from the composer) but no name — the name
          // is resolved by the engine when the run starts, and this job has not started. Null name, real
          // key: a consumer that wants a label falls back to the key rather than being told the run has
          // no project when it has one.
          projectKey: typeof j.projectKey === "string" && j.projectKey ? j.projectKey : null,
          projectName: null,
          // The ORDER's product, and its name off the same resolver every other row uses. The name was
          // missing here alone, and the browser covered for it by joining `product` against the composer
          // menu; with that join deleted a queued row would have degraded to a bare date — the one
          // row a client looks at straight after pressing Start. `stageLabel` stays null: nothing is
          // frozen until the run starts, and the registry answers for every product this door accepts.
          product: j.product ?? null, stageLabel: null,
          productName: productNameOf(j.product),
          // — "Waiting to start" is true of both a job behind other work and a job nothing will
          // ever pick up, and those are not the same thing to whoever just pressed Start. The position
          // still says where it sits in the line; this says whether the line is moving at all.
          state: "queued", step: draining === false ? "Waiting for a worker" : "Waiting to start", stepN: null, stepTotal: null,
          reason: null, failedStage: null,
          // Part of the row contract now; a job that has not started has none of them.
          pausedKind: null, resetsAt: null, startedAt: null,
          // A job file has no updatedAt — it has not run. Its MTIME is when it was queued, which is a
          // real fact rather than a fabricated one, sorts a just-queued run to the top where the
          // person who pressed Start will look, and is deterministic under test.
          date: new Date(statSync(join(dir, f)).mtimeMs).toISOString().slice(0, 10), overall: null,
          // Queued: its mtime, at full precision, for the same reason the day-level `date` uses it.
          issuedAt: new Date(statSync(join(dir, f)).mtimeMs).toISOString(),
          // The names the job was submitted with — no bands, because nothing has been rated. Same rule as
          // the live row: this array answers "which names", and only the delivered row can answer "at
          // what band".
          band: null, tone: null, bands: [],
          marks: (Array.isArray(j.marks) ? j.marks : [])
            .filter((m) => m && typeof m.name === "string" && m.name.trim())
            .map((m) => ({ name: m.name, band: null, tone: null })),
          reportSchema: null, report: null,
          queuePos: null } });   // filled below, once every lane has been read
      } catch { /* not a job file */ }
    }
  };
  // EVERY QUEUE ONCE. A directory can be reached both ways — `config.queueDirs`
  // lists the workspace queues too — and reading one twice would list every job in it twice and give
  // each row two positions in the line.
  const scannedQueues = new Set();
  const scanQueue = (dir) => {
    const key = pathResolve(dir);
    if (scannedQueues.has(key)) return;
    scannedQueues.add(key);
    readQueued(dir);
  };
  // THE CANONICAL INTAKE FIRST, and it is why this parameter exists. `CLEAROTRON_QUEUE_DIR` is where the
  // enqueue CLI and ops-MCP `start_run` write — which is where the PORTAL's own submissions land, since
  // its `trigger` is an ops-MCP hop. The walk below finds only `workspace-*/studio/clearance-search/queue`,
  // and a documented headless install has no workspaces at all: measured on the test box, the only queue
  // under the whole tree is the configured one, and it holds portal-prefixed jobs. So this scan ran ZERO
  // times there, and a submitted search was invisible on the dashboard from submit until claim — a
  // minute and a half of a client believing their order was lost.
  for (const d of Array.isArray(queueDirs) ? queueDirs : []) {
    if (typeof d === "string" && d) scanQueue(d);
  }
  try {
    for (const ws of readdirSync(workspaceRoot).filter((n) => n.startsWith("workspace-"))) {
      const studio = studioDirFor(join(workspaceRoot, ws));
      let slugs = []; try { slugs = readdirSync(studio); } catch { continue; }
      for (const slug of slugs) {
        // Still walked, so a deployment whose queue is not in `queueDirs` keeps working. The union is
        // deliberate: this must add a place to look, never remove one.
        if (slug === "queue") { scanQueue(join(studio, slug)); continue; }
        if (slug === "archive" || slug.startsWith("_") || slug.startsWith(".")) continue;
        let runs = []; try { runs = readdirSync(join(studio, slug)); } catch { continue; }
        for (const r of runs) readRun(join(studio, slug, r));
      }
    }
  } catch { /* no workspace */ }
  // Assign the ordinals last, across every lane at once. Cross-lane order is genuinely undefined —
  // the lanes are per-agent and drain concurrently against one shared pair of slots — so lanes are
  // ordered by path purely to make the result STABLE. An ordinal that reshuffled between two polls
  // of an unchanged queue would read as the queue churning when nothing had moved.
  queuedRows.sort((a, b) => a.lane.localeCompare(b.lane) || a.laneIdx - b.laneIdx);
  queuedRows.forEach((q, i) => { q.row.queuePos = i + 1; out.push(q.row); });
  return out.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

// A failure `reason` is NOT client-safe, and the listing must not hand it to a browser.
//
// The engine writes `reason = String(e?.stack ?? e)` truncated to 200 characters
// (pipeline.mjs, pipeline-knockout.mjs). That is a raw stack trace: absolute filesystem
// paths, internal module names, provider error text. Useful to staff, and none of a client's business
// — and redacting it in the UI would be theatre, because the field still travels over the wire and
// sits in devtools whatever React chooses to render.
//
// A client still learns that the run stopped and roughly where, because the plan is right that an
// invisible failure is worse than a visible one: they keep `state`, `failedStage` (product vocabulary
// like "register-probe", not a stack), and a stable sentence telling them what happens next. What they
// lose is the trace.
// — the owner's failed-run ruling. ONE author for this sentence now: it was
// written out here and again in mcp-server/lib/audit-view.mjs, and a reword that fixed two of three
// copies is how the retired claim survives in whichever surface nobody is looking at.
const CLIENT_FAILURE_NOTE = clientFailureNote();

// The run-slot cap, resolved from the SAME table pipeline.acquireRunSlot resolves it from, so the number
// the screen states and the number the engine enforces cannot drift apart. It used to re-read
// `process.env` behind a second copy of the literal 2 — two independent copies of one number is the
// shape that drifts, and reading the raw environment skipped the alias resolution every other read of
// this variable gets. `numeric-setting.mjs` is imported at module scope where
// `driver.config.mjs` cannot be: it pulls in nothing but the alias table this file already imports.
//
// It is one global cap over one lock directory, never per brand owner: two owners each running one
// search fill the whole deployment, and saying it per-owner would over-promise throughput.
//
// NULL WHEN THE VALUE IS UNUSABLE, AND THE SCREEN THEN SAYS NOTHING. The engine REFUSES a non-numeric
// cap; this surface must not, because a misconfiguration that took out the screen an operator reads to
// find it would be a worse failure than the one being fixed. `slotNote` already renders a null cap by
// drawing no line at all, so the page states the number it has or stays quiet — never a number nobody
// chose.
export const concurrentRunsCap = () => {
  const r = resolveNumericSetting("CLEAROTRON_MAX_CONCURRENT_RUNS");
  return r.ok ? Math.max(1, r.value) : null;
};

export function forRole(runs, principal) {
  // A person who sees everything reads failure reasons verbatim; everyone else gets the plain note. That redaction is the ONLY
  // role-shaping left: the held-run suppression is retired (one report, spec 2026-07-30 §5 — a run you
  // have rights to is always listed; the machine-QC record lives on the audit workbook).
  if (seesEverything(principal)) return runs;
  return runs.map((r) => {
    let out = r;
    // — the redaction must take `reasonDetail` with it. `reason` is replaced by a fixed note for a
    // client session; a second field carrying the engine's raw words would walk straight past that.
    if (r.state === "failed") out = { ...out, reason: CLIENT_FAILURE_NOTE, reasonDetail: null, reasonRedacted: true };
    return out;
  });
}

/** Every account's runs, in one pass. Staff only — the route enforces that, not this function. */
export function scanAllRuns({ poolRoot, workspaceRoot, queueDirs = [] }) {
  return scanAccountRuns({ poolRoot, workspaceRoot, account: null, queueDirs });
}

/**
 * ── — WHICH RUN IS THIS, ASKED THE WAY THE LIST ASKS IT ────────────────────
 *
 * The Retire control refused every run the owner pressed it on, with `400 unknown run`, because the
 * route resolved the id by reading `<pool>/<runId>/meta.json` — and **a run that was stopped never
 * publishes into the pool**. The Clearances list that offered the button reads a wider set: the pool,
 * the workspaces and the queues. So the screen showed a control for a run the endpoint could not see,
 * and the failed and abandoned ones — the population a reader most wants off the list — were exactly
 * the ones it could never act on.
 *
 * THE POOL READ STAYS FIRST, and that is not an optimisation for its own sake: a delivered run is the
 * common case and one targeted `readFileSync` answers it. The scan is the FALLBACK, so the cost of a
 * directory walk is paid only on the ids the pool cannot answer — which is the case that used to be a
 * refusal, so nothing that worked before got slower.
 *
 * IT ANSWERS WITH THE ACCOUNT, never with a boolean. The account is what the caller needs: the retire
 * and family routes take the owner from the RUN and never from the request body, because a body-supplied
 * owner is a body-supplied tenancy claim. A resolver that returned "yes, it exists" would leave that
 * rule needing a second lookup.
 *
 * @returns `{ account, state }`, or `null` when no surface this deployment lists knows the id.
 */
export function resolveRunAccount({ poolRoot, workspaceRoot, queueDirs = [], runId }) {
  try {
    const meta = readJson(join(poolRoot, runId, "meta.json"));
    return { account: meta.customerKey || "generic", state: "delivered" };
  } catch { /* not published — which is the whole case this function exists for */ }
  // BOTH DIRECTIONS of the retired filter, because the way BACK from retirement has to resolve a run
  // that is currently hidden. `includeRetired` is exclusive on either setting, so one call cannot see
  // both, and a restore that could not resolve its own id would be a one-way door.
  for (const includeRetired of [false, true]) {
    for (const row of scanAccountRuns({ poolRoot, workspaceRoot, account: null, includeRetired, queueDirs })) {
      if (row.runId === runId) return { account: row.account ?? "generic", state: row.state ?? null };
    }
  }
  return null;
}
