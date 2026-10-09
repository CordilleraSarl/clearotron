// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// undeclared-key-census.mjs —: which captured calls carry keys their schema does not
// declare, at any depth.
//
//   node scripts/undeclared-key-census.mjs <run-dir> [<run-dir> ...]
//
// WHY IT EXISTS. serve validates required-field PRESENCE at the seam and nothing
// else, so an undeclared key inside an already-typed object rides silently. A seat that puts a legitimate
// field in the wrong place is told the call was well-formed, and the value reaches no delivered artifact.
//
// THE DISCRIMINATOR IS `_provenance`, NOT THE FILENAME, and that is the whole method. A capture site
// writes that stamp and nothing else does. Two lanes replayed this archive independently and both got the
// same two wrong answers first: reading only `params` skips the transports that flatten their payload to
// the top level, and globbing every `.json` sweeps in driver-written state (model.json, accepted-*.json)
// as though a seat had sent it. Keying on the stamp avoids both.
//
// IT REPORTS; IT DOES NOT JUDGE. A path listed here is a key the schema does not declare — which may be a
// gap in the schema or a value nobody reads. Deciding which needs the ACCEPTOR read, never this output.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";   // the name of `_driver/` lives in ONE file
import { undeclaredKeys } from "../shared/undeclared-keys.mjs";
const MCP = new URL("../driver/engine/mcp/", import.meta.url).pathname;
const SERVERS=["recording-server.mjs","coverage-server.mjs","dispositions-server.mjs","declination-server.mjs","unit-note-server.mjs"];
const ask=(s)=>new Promise((res)=>{const c=spawn(process.execPath,[join(MCP,s)],{stdio:["pipe","pipe","pipe"],env:{...process.env,PERPLEXITY_API_KEY:"x"}});
 let b="",o=null;const d=()=>{try{c.kill("SIGKILL")}catch{};res(o||[])};const t=setTimeout(d,8000);
 c.stdout.on("data",x=>{b+=x;let n;while((n=b.indexOf("\n"))>=0){const l=b.slice(0,n).trim();b=b.slice(n+1);if(!l)continue;
  try{const m=JSON.parse(l);if(m.id===2){o=m.result?.tools??[];clearTimeout(t);d();}}catch{}}});
 c.on("error",()=>d());
 c.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18"}})+"\n");
 c.stdin.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list"})+"\n")});
const tools=new Map();
for (const s of SERVERS) for (const t of await ask(s)) tools.set(t.name, t.inputSchema??{});

// undeclared keys AT ANY DEPTH — only where the schema actually declares `properties` for that object.
const norm=(s)=>s.replace(/-calls$/,"").replace(/[-_]/g,"");
const byFam=new Map(); for (const n of tools.keys()) byFam.set(norm(n.replace(/^record_/,"")), n);
byFam.set("refutation","record_narrative_refutation"); byFam.set("disposition","record_dispositions");
byFam.set("registerunit","record_unit_note");
const runDirs = process.argv.slice(2);
if (!runDirs.length) { console.error("usage: node scripts/undeclared-key-census.mjs <run-dir> [<run-dir> ...]"); process.exit(2); }
const rows = [];
for (const dir of runDirs) {
  const base = driverDir(dir);
  let fams = [];
  try { fams = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.endsWith("-calls")).map((d) => d.name); }
  catch (e) { console.error(`could not read ${base}: ${e.message}`); process.exit(2); }
  for (const fam of fams) for (const f of readdirSync(join(base, fam)).filter((n) => n.endsWith(".json"))) {
    let d; try { d = JSON.parse(readFileSync(join(base, fam, f), "utf8")); } catch { continue; }
    if (!d || typeof d !== "object" || !("_provenance" in d)) continue;   // THE DISCRIMINATOR
    const params = (d.params && typeof d.params === "object" && !Array.isArray(d.params))
      ? d.params
      : Object.fromEntries(Object.entries(d).filter(([k]) => !["_provenance","receivedAt","seq","rowCount","capture_failed","acceptedAt"].includes(k)));
    rows.push({ family: fam, params });
  }
}
if (!rows.length) { console.error("no captured calls found — a run dir with no _driver/*-calls/ carrying a _provenance stamp is a COULD-NOT-LOOK, not a clean result"); process.exit(2); }
const hits=new Map(); let checked=0; const unmatched=new Set();
for (const r of rows) {
  const tool=byFam.get(norm(r.family));
  if (!tool||!tools.has(tool)) { unmatched.add(r.family); continue; }
  checked++;
  for (const p of undeclaredKeys({type:"object",...tools.get(tool)}, r.params)) {
    const k=`${tool} :: ${p.replace(/\[\d+\]/g,"[]")}`;
    hits.set(k,(hits.get(k)??0)+1);
  }
}
console.log(`checked ${checked} captured calls across ${new Set(rows.map(r=>r.family)).size} families\n`);
if (!hits.size) console.log("  no undeclared keys found");
for (const [k,n] of [...hits.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(4)}x  ${k}`);
if (unmatched.size) console.log(`\n⚠ families with no served tool matched (probe gap, not a pass): ${[...unmatched].join(", ")}`);
