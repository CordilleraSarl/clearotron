// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// dev-portal.mjs — the DEV-INSTANCE UI portal (docs/E2E.md Tier 1).
//
// THIS IS NOT THE PRODUCT, AND IT IS NOT HOW YOU START IT. If you arrived here looking for the way to
// run this system on one machine, the answer is `npm start` (bin/start.mjs, INSTALL.md §6): the real
// portal with a real sign-in, and a Start button that works. This file is a loopback pool browser and
// dev cockpit for people working ON the engine — its name is accurate and its security note below is
// meant literally.
//
// In production the pool is served
// by a real web server (Caddy) behind the deployment's auth proxy; this is the zero-dep, loopback-only
// stand-in so a UI feature (archive index, report pages, customer pages, the profile editor) can be
// developed and eyeballed in a browser against an isolated dev pool. It mirrors the prod ingress shape:
//
//   /                    → <poolRoot>/index.html            (the archive index publish maintains)
//   /<run>/report.html   → static files under CLEAROTRON_REPORTS_DIR (traversal-guarded)
//   /profiles.html       → driver/profile-page.html          (the editor UI, no pool deploy needed)
//   /profiles/*          → reverse-proxy to the profile-service (same /profiles/* matcher Caddy uses;
//                          run it in ITS dev mode: PROFILE_AUTH_DISABLED=1 PROFILE_DEV=1, loopback)
//   /recipes/*           → reverse-proxy to the recipe-service (Phase 3a saved searches; dev mode:
//                          RECIPE_AUTH_DISABLED=1 RECIPE_DEV=1, loopback — the cockpit Searches panel)
//   /dev                 → the DEV COCKPIT page (enqueue a mock job, watch runs, inspect outbox events)
//   /dev/enqueue (POST)  → validate-first intake into the dev queue (same shape as the enqueue CLI)
//   /dev/runs            → live run statuses across every workspace (status.json scan)
//   /dev/outbox          → pending outbox event packets, parsed (the delivery contract, inspectable)
//
// SECURITY: dev tool. Binds loopback ONLY (literal 127.0.0.1/::1 — a non-loopback PORTAL_HOST refuses
// to start), no auth, no TLS. Never expose it; production ingress is Caddy + the auth proxy. The /dev
// intake writes ONLY into the dev instance's own queue (INSTALL.md §8 isolation invariants).

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import { createServer, request as httpRequest } from "node:http";
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./driver.config.mjs";
import { BRAND } from "../shared/brand.mjs";
import { assembleFromFlags, resolveQueueDir } from "./enqueue.mjs";
import { validateJob } from "./enqueue-schema.mjs";
import { doorGates } from "./door-gates.mjs";   // the resolved-product checks every door runs
import { PRODUCTS } from "./products.mjs";      // the offering — the cockpit never types a menu of its own
import { readFlagSnapshot, registerTerritoriesFor } from "./flag-snapshot.mjs";
import { builtFor, registerCanCountFor } from "./flag-snapshot.mjs";
import { productAvailability, UNAVAILABLE_NOTE, PRODUCT_POLICIES } from "./search-policy.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const HERE = dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

/**
 * THE DEV COCKPIT'S HALF OF THE DECLARED-FIELD PARTITION (enqueue-schema.mjs DECLARED_JOB_FIELDS).
 *
 * `/dev/enqueue` builds a `flags` object from the posted body and hands it to the shared assembler, which
 * is an allow-list twice over — the fields this handler names, and the overlay entries assembleFromFlags
 * has. `deliveryRoute` was in neither, so this door answered 200 for a lane every other door refuses by
 * name, and the run went out by email. That is the fault this declaration exists to make un-repeatable:
 * doors-agree.test.mjs asserts `carries ∪ notCarried` is exactly the declared set, so the next field goes
 * red on the commit that declares it rather than in a delivered report.
 *
 * THIS DOOR'S WIRE NAMES ARE THE CLI'S FLAG NAMES, not the job's: `mark`, `profile`, `instructions`.
 * `carries` names the JOB fields that reach the queue, whichever wire name carried them — that is what
 * the partition is about, and it is why the totality check is a test rather than a runtime refusal.
 */
export const DEV_COCKPIT_JOB_FIELDS = Object.freeze({
  carries: Object.freeze([
    "id", "msgId", "conversationId", "forwarder", "forwarderEmail",
    "markName", "marks", "classes", "goods", "ref",
    "jurisdictions", "platforms", "geography",
    "product", "recipeKey", "nativeLanguage", "caseLaw", "searchLevel", "deliveryRoute",
    "customer", "profileKey", "upfrontInstructions", "deadline",
    // — an OPERATOR door may declare a demo run; the client door may not.
    "demoRun",
    "dupOverride", "enqueuedAt", "enqueuedVia",
  ]),
  notCarried: Object.freeze({
    registerFixtures: "a run that reads canned register payloads instead of calling a register. The cockpit "
      + "is a form for composing REAL dev runs; a fixture run is declared by the job file that wants one, so "
      + "the fact travels with the run rather than with whoever filled in a form (tracker issue 2038).",
    promptParts: "the requester's declaration that the prose rides as SIDECAR files. The cockpit composes a job "
      + "from its own form and writes no sidecars, so it may not claim that shape (#1085).",
    forwarderDomain: "the cockpit's assembler defaults it; a dev form has no forwarding domain to state.",
    provider: "which register vendor answers is the dev instance's own configuration, not a form field.",
    name: "the pre-markName spelling of the search subject. The form posts `mark`.",
    use: "the pre-goods spelling of the goods description. The form posts `goods`.",
    tmp: "the pre-ref spelling of the reference number. The form posts `ref`.",
    projectKey: "spec-62 engagements are a customer-configuration surface; this form has no project picker "
      + "and inventing one here would let a dev job claim an overlay nobody chose.",
    parentRunId: "escalation lineage. Nothing on this form can name a parent run.",
    customerUnknown: "arms candidate-self classification. A dev form cannot honestly say the applicant was "
      + "neither stated nor implied — the Customer box above states it or leaves it blank.",
    brief: "the intake confirmation brief, written by the email door's own gate. There is no such gate here.",
    rawRequest: "the verbatim forwarded email. There is no forwarded email on this door.",
    deliverableSpec: "template/format asks are staff-curated on the profile, not typed into a dev form.",
    commercialFlexibility: "advice posture, curated on the profile. `instructions` is this form's posture field.",
    priorUse: "stated prior/intended use — a fact about the client's business that the profile and the "
      + "request prose carry. A dev form has no client to state it.",
    campaignShape: "campaign-shape FACTS, verbatim from the client (house-brand attachment, duration, "
      + "scale). Verbatim from nobody is an invented launch shape, which is what the field forbids.",
    clientPrincipal: "the daily-allowance stamp. Only the client portal sets it, from a verified principal; "
      + "a loopback dev form has no principal to verify.",
    enqueuedBy: "the verified token sub. This door has no token and no sub — stamping one would be "
      + "attribution nobody made.",
  }),
});

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function sendFile(res, path) {
  const body = readFileSync(path);
  res.writeHead(200, { "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream" });
  res.end(body);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj, null, 2));
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolveB, rejectB) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > maxBytes) { rejectB(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolveB(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { rejectB(new Error("body is not JSON")); } });
    req.on("error", rejectB);
  });
}

// Run statuses: every workspace's studio/prelim-search/<slug>/<run>/status.json — live runs PLUS the
// archive (a delivered run moves there on delivery; without it the cockpit shows a run "disappearing"
// at the exact moment it succeeds — found by the first dev smoke run). Read fresh per request.
function scanRuns(workspaceRoot) {
  const out = [];
  const readRun = (dir, slug, runName, archived) => {
    try {
      const s = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
      out.push({ runId: s.runId ?? `${slug}-${runName}`, slug: s.slug ?? slug, codename: s.codename ?? null,
        agent: s.agent ?? null, state: s.state ?? null, stepN: s.stepN ?? null, stepLabel: s.stepLabel ?? null,
        stepTotal: s.stepTotal ?? null, verdict: s.verdict ?? null, sendPending: s.sendPending ?? null,
        markName: s.markName ?? null, updatedAt: s.updatedAt ?? null, archived });
    } catch { /* not a run dir / unreadable status — skip */ }
  };
  let names = [];
  try { names = readdirSync(workspaceRoot); } catch { return out; }
  for (const name of names) {
    if (config.agentIdFromWorkspaceName(name) == null) continue;
    const studio = join(workspaceRoot, name, "studio", "prelim-search");
    let slugs = [];
    try { slugs = readdirSync(studio); } catch { continue; }
    for (const slug of slugs) {
      if (slug === "queue" || slug.startsWith("_")) continue;
      if (slug === "archive") {
        // archive/<YYYY-MM>/<slug>/<run>/
        let months = [];
        try { months = readdirSync(join(studio, "archive")); } catch { continue; }
        for (const month of months) {
          let aSlugs = [];
          try { aSlugs = readdirSync(join(studio, "archive", month)); } catch { continue; }
          for (const aSlug of aSlugs) {
            let runs = [];
            try { runs = readdirSync(join(studio, "archive", month, aSlug)); } catch { continue; }
            for (const runName of runs) readRun(join(studio, "archive", month, aSlug, runName), aSlug, runName, true);
          }
        }
        continue;
      }
      let runs = [];
      try { runs = readdirSync(join(studio, slug)); } catch { continue; }
      for (const runName of runs) readRun(join(studio, slug, runName), slug, runName, false);
    }
  }
  return out.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, 50);
}

// Pending outbox events, parsed: JSON packets pass through; a legacy delivered marker's body is the agent id.
function scanOutbox(outboxDir) {
  let files = [];
  try { files = readdirSync(outboxDir).filter((f) => f.endsWith(".pending")); } catch { return []; }
  return files.map((f) => {
    const p = join(outboxDir, f);
    const entry = { file: f, mtime: null, packet: null, legacyAgent: null };
    try { entry.mtime = statSync(p).mtime.toISOString(); } catch { /* raced away */ }
    try {
      const raw = readFileSync(p, "utf8");
      if (raw.trimStart().startsWith("{")) entry.packet = JSON.parse(raw);
      else entry.legacyAgent = raw.trim();
    } catch { /* raced away mid-read — show the name only */ }
    return entry;
  }).sort((a, b) => String(b.mtime ?? "").localeCompare(String(a.mtime ?? "")));
}

// The cockpit page — zero external assets, BRAND-stamped, polls the /dev JSON endpoints.
function cockpitHtml() {
  // ──: the cockpit is a DOOR, and it shows what the wired register can serve ────────────────────
  //
  // Same answer as the portal and the ops-MCP, from the same snapshot field, because a request this
  // form queues is refused later by doorGates in the same words. A menu that offers what the gate
  // refuses is the asymmetry doors-agree.test.mjs exists to catch.
  //
  // Read per render, never cached: the cockpit is long-lived and a provider change must not need a
  // restart to show up. Never throws — a cockpit that will not draw because a snapshot is missing is a
  // worse failure than one that offers everything.
  //
  // THROUGH productAvailability, exactly as the portal and the ops-MCP do — not through the coverage
  // rule alone. The cockpit used to run no availability check at all, so its menu offered products the
  // gate refuses for reasons that have nothing to do with coverage (unbuilt machinery, a register that
  // cannot count). One call gets all three arms, in the same order, with the same sentences.
  const snapshot = (() => { try { return readFlagSnapshot(config.poolRootOrNull); } catch { return null; } })();
  const territories = registerTerritoriesFor(snapshot);
  const built = builtFor(snapshot);
  const canCount = registerCanCountFor(snapshot);
  const coverageCause = (p) => productAvailability(PRODUCT_POLICIES[p.id], {
    built, registerCanCount: canCount, registerTerritories: territories, geography: p.geography,
  });
  // Display names, not office codes, and only when the register enumerates. `null` (unrestricted) and
  // `undefined` (the snapshot does not say) both mean "offer everything" and print nothing.
  const territoryHint = Array.isArray(territories)
    ? ` — this deployment's register reaches ONLY: ${territories.join(", ")}. Anything else is searched by no register and comes back as a disclosed deferred gap.`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${BRAND.name} · dev cockpit</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#111418;color:#dde3ea}
 header{padding:14px 22px;background:#1a1f26;border-bottom:1px solid #2c343f}
 header b{color:#8ecbff} header span{color:#7d8790;margin-left:10px;font-size:12px}
 main{display:grid;grid-template-columns:340px 1fr 1fr;gap:16px;padding:16px 22px;align-items:start}
 section{background:#1a1f26;border:1px solid #2c343f;border-radius:8px;padding:14px 16px;overflow-x:auto}
 h2{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#9fb2c4}
 label{display:block;font-size:12px;color:#9fb2c4;margin:8px 0 2px} input,textarea{width:100%;box-sizing:border-box;background:#111418;color:#dde3ea;border:1px solid #2c343f;border-radius:5px;padding:6px 8px;font:inherit}
 textarea{min-height:54px} button{margin-top:12px;background:#2563a8;color:#fff;border:0;border-radius:6px;padding:8px 16px;font:inherit;cursor:pointer}
 button:hover{background:#2f74c0} pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:#111418;border-radius:6px;padding:8px;margin:8px 0 0}
 table{border-collapse:collapse;width:100%;font-size:12.5px} th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #232a33} th{color:#9fb2c4;font-weight:600}
 .ok{color:#7fd08b}.warn{color:#e6b45e}.err{color:#e77}
 @media (max-width:1100px){main{grid-template-columns:1fr}}
</style></head><body>
<header><b>${BRAND.name}</b> dev cockpit <span>enqueue mock jobs · watch runs · inspect outbox events — dev instance</span>
 <span style="float:right"><a href="/index.html" style="color:#8ecbff">archive index</a> · <a href="/profiles.html" style="color:#8ecbff">profile editor</a></span></header>
<main>
<section><h2>Enqueue a job</h2>
 <form id="f">
  <label>Mark *</label><input name="mark" placeholder="DemoMark" required>
  <label>Search (product — blank lets the account default, or this request's own countries, decide)</label>
  <select name="product"><option value="">(unset — the account default, else the countries)</option>${PRODUCTS.map((p) => { const c = coverageCause(p); return `<option value="${p.id}"${c ? " disabled" : ""}>${p.id} · ${p.name} — ${p.geography}; up to ${p.maxNames} name${p.maxNames === 1 ? "" : "s"}${c ? ` — UNAVAILABLE: ${UNAVAILABLE_NOTE[c]}` : ""}</option>`; }).join("")}</select>
  <label>Countries (comma — omit for the account's own)${territoryHint}</label><input name="jurisdictions" placeholder="United States, France">
  <label>Extra marketplaces (comma — ADDED to the account's own)</label><input name="platforms" placeholder="gnc.com">
  <label><input type="checkbox" name="worldwide" style="width:auto"> worldwide (search everywhere; NOT the same as leaving countries blank)</label>
  <label><input type="checkbox" name="nativeLanguage" style="width:auto"> native-language investigation (multi-country focus search only)</label>
  <label>Saved search (recipe key — leave the product blank)</label><input name="recipeKey" id="f_recipe" placeholder="quarterly-screen">
  <label>Batch marks (knockout — one per line, optional "NAME [9, 42]")</label><textarea name="marks" placeholder="IRONWHISK [8, 21]&#10;CLUVENDRA&#10;SUNDAY ROAST CLUB [21, 35]"></textarea>
  <label>Classes (comma)</label><input name="classes" placeholder="9,42">
  <label>Goods / services</label><textarea name="goods"></textarea>
  <label>Customer (applicant)</label><input name="customer">
  <label>Profile key</label><input name="profile" placeholder="demo-brand-owner | (blank = generic)">
  <label>Forwarder *</label><input name="forwarder" placeholder="dev" required>
  <label>Instructions (verbatim)</label><textarea name="instructions"></textarea>
  <label><input type="checkbox" name="dupOverride" style="width:auto"> dupOverride (confirmed re-run)</label>
  <button>Enqueue</button>
 </form><pre id="fout">—</pre></section>
<section><h2>Runs <button onclick="loadRuns()" style="float:right;margin:0;padding:2px 10px">refresh</button></h2><div id="runs">loading…</div></section>
<section><h2>Outbox events <button onclick="loadOutbox()" style="float:right;margin:0;padding:2px 10px">refresh</button></h2><div id="outbox">loading…</div></section>
<section><h2>Searches (saved + built-in) <button onclick="loadSearches()" style="float:right;margin:0;padding:2px 10px">refresh</button></h2>
 <label>Customer</label><input id="s_cust" value="demo-brand-owner" placeholder="demo-brand-owner | generic">
 <div id="searches" style="margin-top:8px">loading…</div></section>
<section><h2>Compose a saved search</h2>
 <form id="sf">
  <label>Slug (filename + trigger key) *</label><input name="slug" placeholder="quarterly-screen" required>
  <label>Label (display name) *</label><input name="label" placeholder="Quarterly product-name screen" required>
  <label>Base search (the product this saved search runs) *</label><select name="base" id="sf_base"></select>
  <label><input type="checkbox" name="registerProbe" style="width:auto"> + register filing counts (knockout bases only)</label>
  <label>Standing instructions (delivery-shaped prose — never rating rules)</label><textarea name="standing"></textarea>
  <label>Notes</label><textarea name="notes"></textarea>
  <button type="button" onclick="composeSubmit(false)">Check</button>
  <button type="button" onclick="composeSubmit(true)">Save</button>
 </form><pre id="sfout">—</pre></section>
</main>
<script>
const $=(s)=>document.querySelector(s);
$("#f").addEventListener("submit",async(e)=>{e.preventDefault();const fd=new FormData(e.target);const b=Object.fromEntries(fd.entries());b.dupOverride=fd.get("dupOverride")!=null;
 b.worldwide=fd.get("worldwide")!=null;
 // The toggle travels ONLY when ticked. An unticked box used to post nativeLanguage:false on every
 // submit, which the door then dropped — and now that false is REFUSED (it switches nothing off; the
 // investigation is what a Full country search IS), posting it would 422 every enqueue from this form.
 // The offering has no "off" to send, so the form has none to send either.
 if(fd.get("nativeLanguage")!=null)b.nativeLanguage=true;else delete b.nativeLanguage;
 const r=await fetch("/dev/enqueue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
 $("#fout").textContent=JSON.stringify(await r.json(),null,2);loadRuns();});
async function loadRuns(){const r=await(await fetch("/dev/runs")).json();
 $("#runs").innerHTML=r.length?"<table><tr><th>run</th><th>state</th><th>step</th><th>verdict</th><th>updated</th></tr>"+r.map(x=>
  '<tr><td>'+(x.markName??x.slug)+' · '+(x.codename??"?")+'</td><td class="'+(x.state==="delivered"?"ok":x.state==="failed"?"err":"warn")+'">'+(x.state??"?")+(x.sendPending?" (sendPending)":"")+'</td><td>'+(x.stepLabel??"")+'</td><td>'+(x.verdict??"")+'</td><td>'+(x.updatedAt??"").slice(0,19)+'</td></tr>').join("")+"</table>":"no runs yet";}
async function loadOutbox(){const r=await(await fetch("/dev/outbox")).json();
 $("#outbox").innerHTML=r.length?r.map(x=>'<details><summary>'+x.file+' <span class="warn">'+(x.packet?.kind??(x.legacyAgent?"delivered (legacy)":"?"))+'</span></summary><pre>'+JSON.stringify(x.packet??{legacyAgent:x.legacyAgent},null,2)+'</pre></details>').join(""):"outbox empty";}
// ── Searches panel (Phase 3a): registry levels + saved recipes via the /recipes/* proxy. EVERY
// upstream string is escaped before innerHTML (labels/errors are service-authored text — the stored-
// XSS review 2026-07-18); slugs/keys ride data- attributes into addEventListener, never string-built JS.
let REG=null;
const esc=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
async function loadSearches(){
 const cust=$("#s_cust").value.trim()||"aurora";
 try{
  const all=await(await fetch("/recipes")).json();
  if(all.error){$("#searches").innerHTML='<span class="err">'+esc(all.error)+'</span>';return;}
  REG=all;
  $("#sf_base").innerHTML=all.products.map(l=>'<option value="'+esc(l.key)+'">'+esc(l.key)+' · '+esc(l.name||l.stageLabel)+(l.baseTurnaround?' — '+esc(l.baseTurnaround):'')+'</option>').join("");
  const mine=all.recipes.filter(r=>r.customer===cust&&!r.archived);
  $("#searches").innerHTML=
   "<b style='font-size:12px;color:#9fb2c4'>BUILT-IN</b><table>"+all.products.map(l=>
    '<tr><td>'+esc(l.name||l.stageLabel)+' <code>'+esc(l.key)+'</code></td><td>'+esc(l.baseTurnaround??'')+'</td><td><button style="margin:0;padding:2px 10px" data-use-product="'+esc(l.key)+'">use</button></td></tr>').join("")+"</table>"+
   "<b style='font-size:12px;color:#9fb2c4'>SAVED — "+esc(cust)+"</b>"+(mine.length?"<table>"+mine.map(r=>
    '<tr><td>'+esc(r.label)+' <code>'+esc(r.slug)+'</code> v'+esc(r.version??'?')+'</td><td>'+esc(r.base)+'</td><td><button style="margin:0;padding:2px 10px" data-use-recipe="'+esc(cust)+'/'+esc(r.slug)+'">use</button></td></tr>').join("")+"</table>":"<div>none saved yet</div>");
  [...document.querySelectorAll("[data-use-product]")].forEach(b=>b.onclick=()=>useProduct(b.dataset.useProduct));
  [...document.querySelectorAll("[data-use-recipe]")].forEach(b=>b.onclick=()=>{const i=b.dataset.useRecipe.indexOf("/");useRecipe(b.dataset.useRecipe.slice(0,i),b.dataset.useRecipe.slice(i+1));});
 }catch(e){$("#searches").innerHTML='<span class="err">recipe-service unreachable — start it in dev mode (RECIPE_AUTH_DISABLED=1 RECIPE_DEV=1)</span>';}
}
function useProduct(k){const f=$("#f");f.product.value=k;$("#f_recipe").value="";f.mark.focus();}
function useRecipe(cust,slug){const f=$("#f");f.product.value="";$("#f_recipe").value=slug;f.profile.value=cust;f.mark.focus();}
async function composeSubmit(save){
 const cust=$("#s_cust").value.trim()||"aurora";
 const fd=new FormData($("#sf"));
 const recipe={label:(fd.get("label")||"").trim(),base:fd.get("base")};
 if(fd.get("registerProbe")!=null)recipe.components={registerProbe:true};
 const extras={};
 const st=(fd.get("standing")||"").trim();if(st)extras.standingInstructions=st;
 if(Object.keys(extras).length)recipe.extras=extras;
 const notes=(fd.get("notes")||"").trim();if(notes)recipe.notes=notes;
 const slug=(fd.get("slug")||"").trim();
 const r=await fetch("/recipes/"+encodeURIComponent(cust)+"/"+encodeURIComponent(slug)+"/"+(save?"save":"validate"),
  {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({recipe})});
 $("#sfout").textContent=JSON.stringify(await r.json(),null,2);
 if(save)loadSearches();
}
loadRuns();loadOutbox();loadSearches();setInterval(()=>{loadRuns();loadOutbox();},15000);
</script></body></html>`;
}

/**
 * startPortal({ poolRoot, port, host, profileTarget }) → Promise<http.Server> (listening).
 * Exported for the unit test; the CLI gate below wires env/flags.
 */
export function startPortal({ poolRoot = null, port = 18899, host = "127.0.0.1",
  profileTarget = { host: "127.0.0.1", port: Number(process.env.PROFILE_PORT || 18794) },
  recipeTarget = { host: "127.0.0.1", port: Number(process.env.RECIPE_PORT || 18801) },
  queueDir = null, workspaceRoot = null, outboxDir = null } = {}) {
  if (!LOOPBACK.has(host)) throw new Error(`dev-portal is loopback-only (got host=${host}) — production serving is Caddy + the auth proxy, never this`);
  // — the pool falls back to `config.poolRoot`, which REFUSES when CLEAROTRON_REPORTS_DIR is unset (it
  // used to fall back to the production archive). Resolved HERE and not in the parameter list: a default
  // parameter is evaluated before the first line of the body, so the loopback refusal above — which has
  // nothing to do with the pool — would have been pre-empted by the pool's refusal on a machine that has
  // not configured one. Two guards, and the one the caller tripped is the one that must speak.
  const root = resolve(poolRoot ?? config.poolRoot);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}`);

      // ---- the dev cockpit (see header) --------------------------------------------------------
      // The dev portal MIRRORS production: `/` is the pool archive index, exactly like the prod
      // trademark host (that parity is the dev instance's whole purpose — never repoint the landing).
      // The cockpit is a dev-only EXTRA at /dev.
      if (url.pathname === "/dev" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(cockpitHtml());
      }
      if (url.pathname === "/dev/runs" && req.method === "GET")
        return sendJson(res, 200, scanRuns(workspaceRoot ?? config.workspaceRoot));
      if (url.pathname === "/dev/outbox" && req.method === "GET")
        return sendJson(res, 200, scanOutbox(outboxDir ?? config.outboxDir));
      if (url.pathname === "/dev/enqueue" && req.method === "POST") {
        let body;
        try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
        // `searchLevel` IS REFUSED, NOT DROPPED. This form offered a "Search level" menu (prelim · Depth 4
        // / knockout · Depth 1) and posted the field to an assembler that stopped reading it, so picking
        // "knockout" enqueued a job naming no product at all and ran whatever the account default or the
        // request's own territories named — a silent product substitution at a live door, from a control
        // that said otherwise. The menu is gone; refusing the field as well is what stops a stale tab, a
        // bookmarked script or a copied curl from doing it quietly. products.mjs:293 states the rule.
        //
        // THE SENTENCE IS NO LONGER WRITTEN HERE. This door had the only searchLevel refusal in the
        // system, in its own words — so the same request was refused here and accepted at the other
        // four, and had this door's wording been the one a requester saw, no other door would have
        // agreed with it. `SEARCH_LEVEL_NOT_A_REQUEST` in products.mjs owns it now, validateJob raises
        // it, and every door quotes the same string. The local check also tested
        // `!= null && String(...).trim()`, so `searchLevel: null` and `searchLevel: ""` walked straight
        // through it; the shared rule refuses the KEY, because sending it at all means the caller is on
        // the retired wire.
        // Same flag shape as the enqueue CLI → identical job assembly + validation (one intake contract).
        const flags = { mark: body.mark, classes: body.classes, goods: body.goods, ref: body.ref,
          customer: body.customer, profile: body.profile, forwarder: body.forwarder,
          forwarderEmail: body.forwarderEmail, instructions: body.instructions, deadline: body.deadline,
          product: body.product, recipeKey: body.recipeKey, marks: body.marks,
          jurisdictions: body.jurisdictions, platforms: body.platforms,
          worldwide: body.worldwide ? true : undefined,
          // The delivery lane. THE FIELD THIS DOOR DID NOT NAME AT ALL — a `deliveryRoute: "portal"`
          // posted here vanished into the flags filter below and the cockpit answered 200 for a lane
          // start_run, the CLI, plan_run and the wall all refuse by name. Carried now; the shared
          // assembler and validateJob own the vocabulary, exactly as they do for the two fields above.
          deliveryRoute: body.deliveryRoute,
          dupOverride: body.dupOverride ? true : undefined };
        for (const k of Object.keys(flags)) if (flags[k] === undefined || flags[k] === "") delete flags[k];
        let job;
        try { job = assembleFromFlags(flags); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
        // `caseLaw` HAS NO FORM CONTROL AND IS STILL CARRIED, and the two go together. It is what a Full
        // country search IS, so nothing here offers it — but a stale tab or a hand-rolled POST can still
        // send one, and dropping it would make this the door that accepts the field and silently ignores
        // it. validateJob owns the vocabulary and refuses it in the sentence every other door uses.
        if ("caseLaw" in body && body.caseLaw != null) job.caseLaw = body.caseLaw;
        if ("searchLevel" in body) job.searchLevel = body.searchLevel;   // presence, null included
        // `nativeLanguage: false` RIDES TOO, for the same reason and by the same route. The shared
        // assembler's `--native-language` is a boolean FLAG and can only ever say true, so an explicit
        // false could not reach the job through `flags` — it was dropped here and at the other three
        // doors, uniformly, which made it a doctrine gap rather than a parity break. The form above only
        // sends the field when the box is ticked; a hand-rolled POST sending false is refused, not lost.
        if ("nativeLanguage" in body && body.nativeLanguage != null) job.nativeLanguage = body.nativeLanguage;
        if (!job.forwarder) return sendJson(res, 422, { ok: false, classify: "clarify", errors: ["missing forwarder — the requester/reply-routing key"] });
        const v = validateJob(job);
        if (!v.ok) return sendJson(res, 422, { ok: false, id: job.id, classify: v.classify, errors: v.errors });
        // THE FOURTH DOOR RUNS THE FOURTH DOOR'S CHECKS. This endpoint calls validateJob and writes the
        // queue, which is the definition of an intake door, and it had none of the resolved-product rules
        // the other three now share.
        const gates = doorGates(job);
        if (gates.errors.length) return sendJson(res, 422, { ok: false, id: job.id, classify: "clarify", errors: gates.errors });
        const qdir = queueDir ?? resolveQueueDir(flags);
        mkdirSync(qdir, { recursive: true });
        const dest = join(qdir, `${job.id}.json`);
        writeFileSync(`${dest}.tmp`, JSON.stringify(job, null, 2) + "\n");
        renameSync(`${dest}.tmp`, dest);
        return sendJson(res, 200, { ok: true, id: job.id, queueDir: qdir, warnings: [...(v.warnings ?? []), ...gates.warnings] });
      }

      // The profile editor UI + its API (same /profiles/* split the prod Caddy matcher uses).
      // The page template carries the default brand name; stamp the configured one at serve time
      // (shared/brand.mjs BRAND) so a rebranded tenant's dev portal is consistent.
      if (req.method === "GET" && url.pathname === "/profiles.html") {
        const html = readFileSync(join(HERE, "profile-page.html"), "utf8").replaceAll("Clearotron", BRAND.name);
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(html);
      }
      if (url.pathname === "/profiles" || url.pathname.startsWith("/profiles/")) {
        const up = httpRequest({ host: profileTarget.host, port: profileTarget.port, method: req.method,
          path: url.pathname + url.search, headers: { ...req.headers, host: `${profileTarget.host}:${profileTarget.port}` } },
        (upRes) => { res.writeHead(upRes.statusCode ?? 502, upRes.headers); upRes.pipe(res); });
        up.on("error", () => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `profile-service not reachable on ${profileTarget.host}:${profileTarget.port} — start it in dev mode (PROFILE_AUTH_DISABLED=1 PROFILE_DEV=1)` }));
        });
        req.pipe(up);
        return;
      }
      // Saved searches (Phase 3a) — same proxy split the prod Caddy matcher will use for /recipes/*.
      if (url.pathname === "/recipes" || url.pathname.startsWith("/recipes/")) {
        const up = httpRequest({ host: recipeTarget.host, port: recipeTarget.port, method: req.method,
          path: url.pathname + url.search, headers: { ...req.headers, host: `${recipeTarget.host}:${recipeTarget.port}` } },
        (upRes) => { res.writeHead(upRes.statusCode ?? 502, upRes.headers); upRes.pipe(res); });
        up.on("error", () => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `recipe-service not reachable on ${recipeTarget.host}:${recipeTarget.port} — start it in dev mode (RECIPE_AUTH_DISABLED=1 RECIPE_DEV=1)` }));
        });
        req.pipe(up);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      // Static pool files. decodeURIComponent + resolve + prefix check = traversal-guarded.
      let p;
      try { p = resolve(root, "." + decodeURIComponent(url.pathname)); } catch { res.writeHead(400); return res.end(); }
      if (p !== root && !p.startsWith(root + "/")) { res.writeHead(400); return res.end("bad path"); }
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
      if (!existsSync(p)) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found in the dev pool"); }
      sendFile(res, p);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e?.message ?? e));
    }
  });

  return new Promise((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(port, host, () => resolveP(server));
  });
}

// ---- CLI gate ------------------------------------------------------------------------------------
if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const port = Number(flag("--port", process.env.PORTAL_PORT || 18899));
  const host = flag("--host", process.env.PORTAL_HOST || "127.0.0.1");
  //. The CLI gate formats the failure; `startPortal` keeps REJECTING with the raw error, because
  // bin/example.mjs:140-143 reads `e.code === "EADDRINUSE"` to decide whether to try the next port. Moving
  // the handling inside startPortal would make that scan dead code and silently change `npm run example`.
  // The sentence still has one definition — listenErrorMessage, the same one listenOrDie uses.
  let server;
  try {
    server = await startPortal({ port, host });
  } catch (e) {
    const { listenErrorMessage } = await import("../shared/listen.mjs");
    process.stderr.write(`[dev-portal] ${listenErrorMessage(e, { what: "the dev portal", host, port, portVar: "PORTAL_PORT", portFlag: "--port" })}\n`);
    process.exit(1);
  }
  const a = server.address();
  process.stderr.write([
    `[dev-portal] serving pool ${resolve(config.poolRoot)}`,
    `[dev-portal] archive index → http://${a.address}:${a.port}/`,
    `[dev-portal] dev cockpit → http://${a.address}:${a.port}/dev (enqueue mock jobs · runs · outbox events)`,
    `[dev-portal] profile editor → http://${a.address}:${a.port}/profiles.html (needs profile-service in dev mode)`,
    `[dev-portal] MCP HTTP face runs separately (mcp-server/http-server.mjs, its own dev mode) — see docs/E2E.md`,
    "",
  ].join("\n"));
}
