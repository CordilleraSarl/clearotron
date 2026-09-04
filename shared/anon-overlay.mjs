// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// anon-overlay.mjs — demo "Incognito mode" for the INTERNAL trademark.example.com surfaces
// (Clearance reports · Run status · Profiles) — site-nav.mjs's MAIN, which is the list that renders.
// It read "Archive · Run status · Quality · Feedback · Profiles" until: the Quality hub and its
// Feedback console went with the quality subsystem, so two of those five had not rendered for
// months. Lets us screen-share the site without
// revealing real client names or the marks being cleared: client names map to descriptive aliases
// (e.g. Zephyr Beverages → "Beverage company") and marks blur out, behind ONE site-wide toggle (no
// hover-reveal). Display-only — it never mutates stored data, run metadata, or form values.
//
// SHAPE (mirrors site-nav.mjs's NAV_CSS/siteNav split):
//   • anonClient(text,key) / anonMark(text,{key,run})  — PURE span builders. Safe to call inside the
//     pure render functions (indexRows, renderSections, staff-page rows): they only wrap text in a
//     `data-anon` span; the browser overlay does the actual masking.
//   • anonAssets(cfg?) → {head, js}   — the baked overlay (CSS + early anti-FOUC class + the masking
//     JS), config inlined. Reads anon-config.json. Call from the page WRITERS (non-pure) and pass the
//     strings INTO the pure render fn (like `nav`), so the render fn stays fs-free / unit-testable.
//   • anonToggle(cfg?)   — the toggle button markup for the nav ('' when disabled).
//
// Tagging conventions the browser overlay understands:
//   <span data-anon="client" data-anon-key="zephyr">Zephyr Beverages</span>  → text swapped for the alias
//   <span data-anon="mark" data-anon-key="…" data-anon-run="…">NOVA PULSE</span> → blurred (unless exempt)
//   <a data-anon-href data-anon-key="…" data-anon-run="…" href="…">     → href neutralised to # (unless exempt)
// A run/client is EXEMPT (shown real) when its key ∈ demoAllow.clientKeys or its run matches
// demoAllow.runs — that's how the week's fresh demo runs stay visible. Free text (feedback notes,
// profile prose) is tagged as a key-less/run-less mark → always blurred in privacy mode.

import { readFileSync } from "node:fs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DEFAULTS = {
  enabled: false,            // fail to a NORMAL page if the config is missing/garbled
  privacyDefaultOn: true,
  markStyle: "blur",
  fallbackClientAlias: "Confidential client",
  clients: {},
  demoAllow: { clientKeys: [], runs: [] },
};

// Read anon-config.json FRESH each call (resolved next to this module) so a deploy or an in-place
// re-render picks up the latest aliases/allowlist. Tiny file; called once per page render (in writers).
export function loadAnonConfig() {
  try {
    const raw = JSON.parse(readFileSync(new URL("./anon-config.json", import.meta.url), "utf8"));
    const da = raw.demoAllow || {};
    return {
      enabled: !!raw.enabled,
      privacyDefaultOn: raw.privacyDefaultOn !== false,
      markStyle: raw.markStyle || "blur",
      fallbackClientAlias: raw.fallbackClientAlias || DEFAULTS.fallbackClientAlias,
      clients: (raw.clients && typeof raw.clients === "object") ? raw.clients : {},
      demoAllow: {
        clientKeys: Array.isArray(da.clientKeys) ? da.clientKeys.map(String) : [],
        runs: Array.isArray(da.runs) ? da.runs.map(String) : [],
      },
    };
  } catch { return { ...DEFAULTS }; }
}

// ── PURE span builders (no fs) — usable inside the pure render functions ─────────────────────────
const keyAttr = (k) => (k != null && k !== "" ? ` data-anon-key="${esc(k)}"` : "");
const runAttr = (r) => (r != null && r !== "" ? ` data-anon-run="${esc(r)}"` : "");

export function anonClient(text, key) {
  return `<span data-anon="client"${keyAttr(key)}>${esc(text)}</span>`;
}
export function anonMark(text, { key, run } = {}) {
  return `<span data-anon="mark"${keyAttr(key)}${runAttr(run)}>${esc(text)}</span>`;
}
// anonText — a key-less/run-less anonMark wrapper for free text — was DELETED 2026-08-03 with no
// consumer tree-wide. anonMark itself is live (publish/index.mjs); call it with {} if the case returns.

// ── the browser overlay body (ES5-ish; runs in Node-rendered pages AND verbatim in the browser).
// References window.__ANON__ (config baked into the head by anonAssets). Disconnects its observer
// around its own DOM writes so it never self-triggers a loop.
const OVERLAY_BODY = `(function(){
  var C = window.__ANON__;
  if(!C || !C.enabled){ try{ var dt=document.querySelectorAll(".anon-toggle"); for(var di=0;di<dt.length;di++) dt[di].style.display="none"; }catch(e){} return; }
  var DEAD_TITLE = "hidden in privacy mode — toggle Privacy OFF to open";
  var DA = C.demoAllow || {clientKeys:[],runs:[]};
  // Case-insensitive client lookup, and the reason it is not redundant: surfaces tag rows by profile
  // KEY ("zephyr") and by display NAME ("Zephyr"), so lowercasing both makes a single-token name
  // resolve to its key's alias. The two surfaces that tagged by NAME were Quality and Feedback, both
  // retired (#265) — the fold stays because it is what makes the lookup total over either spelling,
  // not because those pages are coming back.
  var CL = {}; for(var ck in (C.clients||{})){ if(Object.prototype.hasOwnProperty.call(C.clients,ck)) CL[String(ck).toLowerCase()] = C.clients[ck]; }
  var KEYS = (DA.clientKeys||[]).map(function(x){return String(x).toLowerCase();});
  function aliasFor(k){ return CL[String(k).toLowerCase()] || C.fallbackClientAlias || "Confidential client"; }
  function exClient(k){ return !!k && KEYS.indexOf(String(k).toLowerCase()) >= 0; }
  function exMark(k, run){
    if(k && KEYS.indexOf(String(k).toLowerCase()) >= 0) return true;
    if(run){ run = String(run).toLowerCase(); var rs = DA.runs||[]; for(var i=0;i<rs.length;i++){ var t=rs[i]&&String(rs[i]).toLowerCase(); if(t && run.indexOf(t) >= 0) return true; } }
    return false;
  }
  function isOn(){ return document.documentElement.classList.contains("anon-on"); }
  function apply(root){
    if(!root || !root.querySelectorAll) return;
    var on = isOn();
    var nodes = root.querySelectorAll("[data-anon],[data-anon-href]");
    for(var i=0;i<nodes.length;i++){
      var el = nodes[i], kind = el.getAttribute("data-anon");
      if(kind === "client"){
        if(el.getAttribute("data-anon-real") == null) el.setAttribute("data-anon-real", el.textContent);
        var ckey = el.getAttribute("data-anon-key") || "";
        el.textContent = (on && !exClient(ckey)) ? aliasFor(ckey) : el.getAttribute("data-anon-real");
        el.classList.add("anon-done");
      } else if(kind === "mark"){
        var mkey = el.getAttribute("data-anon-key") || "", mrun = el.getAttribute("data-anon-run") || "";
        el.classList.toggle("anon-clear", !on || exMark(mkey, mrun));
      }
      if(el.hasAttribute("data-anon-href")){
        if(el.getAttribute("data-anon-hreal") == null) el.setAttribute("data-anon-hreal", el.getAttribute("href") || "");
        var hk = el.getAttribute("data-anon-key") || "", hr = el.getAttribute("data-anon-run") || "";
        if(on && !exMark(hk, hr)){ el.setAttribute("href", "#"); el.classList.add("anon-dead"); el.setAttribute("title", DEAD_TITLE); }
        else { el.setAttribute("href", el.getAttribute("data-anon-hreal")); el.classList.remove("anon-dead"); if(el.getAttribute("title") === DEAD_TITLE) el.removeAttribute("title"); }
      }
    }
  }
  var mo = null;
  function safeApply(root){ try{ if(mo) mo.disconnect(); }catch(e){} apply(root); try{ if(mo) mo.observe(document.body,{childList:true,subtree:true}); }catch(e){} }
  function refreshToggles(){
    var on = isOn(), btns = document.querySelectorAll(".anon-toggle");
    for(var i=0;i<btns.length;i++){ var b=btns[i]; b.setAttribute("aria-pressed", on?"true":"false"); b.classList.toggle("anon-active", on); var l=b.querySelector(".anon-lbl"); if(l) l.textContent = on?"Privacy ON":"Privacy OFF"; }
  }
  function setPrivacy(on){
    try{ localStorage.setItem("tmAnon", on?"1":"0"); }catch(e){}
    document.documentElement.classList.toggle("anon-on", on);
    safeApply(document.body); refreshToggles();
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest(".anon-toggle");
    if(b){ e.preventDefault(); setPrivacy(!isOn()); return; }
    // a neutralised link stays inert via preventDefault (NOT pointer-events:none, which would also
    // suppress the hover tooltip that tells you WHY it's dead and how to open it)
    var d = e.target.closest && e.target.closest(".anon-dead");
    if(d){ e.preventDefault(); }
  });
  var sched = false;
  mo = new MutationObserver(function(){ if(sched) return; sched = true; (window.requestAnimationFrame||window.setTimeout)(function(){ sched=false; safeApply(document.body); }); });
  safeApply(document.body); refreshToggles();
})();`;

// Strip the non-runtime keys before baking the config into the page.
function clean(cfg) {
  return { enabled: cfg.enabled, privacyDefaultOn: cfg.privacyDefaultOn, markStyle: cfg.markStyle,
    fallbackClientAlias: cfg.fallbackClientAlias, clients: cfg.clients, demoAllow: cfg.demoAllow };
}

// CSS — gated entirely on html.anon-on so the page is untouched when privacy is OFF or the feature is
// disabled. Default-masked (blur marks / hide un-aliased clients) the instant nodes appear, so there's
// no flash before the JS runs and the status poller's 5s re-renders never leak.
const ANON_CSS = `
html.anon-on [data-anon="mark"]:not(.anon-clear){filter:blur(.42em);-webkit-user-select:none;user-select:none;cursor:default;transition:filter .12s}
html.anon-on [data-anon="client"]:not(.anon-done){visibility:hidden}
.anon-dead{cursor:not-allowed}
.anon-toggle{appearance:none;-webkit-appearance:none;cursor:pointer;font:inherit;font-size:12px;font-weight:700;letter-spacing:.02em;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;border:1px solid rgba(240,232,216,.34);background:rgba(240,232,216,.10);color:#f0e8d8;line-height:1.1;margin-left:6px}
.anon-toggle:hover{background:rgba(240,232,216,.2)}
.anon-toggle .anon-eye{font-size:13px;line-height:1}
.anon-toggle.anon-active{background:#efe6d8;border-color:#efe6d8;color:#4E030F}`;

// {head, js} for one page, config baked in. '' when disabled (fully inert).
export function anonAssets(cfg = loadAnonConfig()) {
  if (!cfg.enabled) return { head: "", js: "" };
  const json = JSON.stringify(clean(cfg));
  const head = `<style>${ANON_CSS}</style><script>window.__ANON__=${json};(function(){var c=window.__ANON__;if(!c||!c.enabled)return;var on;try{var s=localStorage.getItem("tmAnon");on=(s===null)?!!c.privacyDefaultOn:(s==="1");}catch(e){on=!!c.privacyDefaultOn;}if(on)document.documentElement.classList.add("anon-on");})();</script>`;
  const js = `<script>${OVERLAY_BODY}</script>`;
  return { head, js };
}

// The nav toggle button ('' when disabled). Default label assumes masking ON (privacyDefaultOn); the
// overlay JS corrects it from localStorage on load.
export function anonToggle(cfg = loadAnonConfig()) {
  if (!cfg.enabled) return "";
  const on = cfg.privacyDefaultOn;
  return `<button type="button" class="anon-toggle${on ? " anon-active" : ""}" aria-pressed="${on ? "true" : "false"}" title="Demo privacy — blur client names &amp; marks site-wide"><span class="anon-eye" aria-hidden="true">🕶</span><span class="anon-lbl">${on ? "Privacy ON" : "Privacy OFF"}</span></button>`;
}