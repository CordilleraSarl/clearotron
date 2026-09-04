# providers/uspto-local — the US register, built locally

The adapter for a copy of the United States register that the operator builds on their own disk from
USPTO's bulk XML products. There is no free USPTO text-search API, so this directory is the search:
`node:sqlite` (Node 22 ships it, with FTS5) holds the whole register in one file, and nothing here
needs a dependency, a daemon or a vendor. One office, `US`.

Selected on its own by `CLEAROTRON_DATABASE=uspto-local`; it is also the US half of
`../free-tier/`. `USPTO_LOCAL_DB` names the index file.

`src/` holds the adapter; **`test/` holds its suite and the zip fixtures the ingest paths are driven
over**. Neither carries a README — this file names both, and it is the only way into either.

## The build is the entry cost, and it is one-off

From `../../shared/uspto-index-size.mjs`, measured on one complete build (767 files, backfile plus
dailies): **41.5 GB** read from the bulk products, **~9 hours** of ingest at 4.6 GB/h, **20 GB** of
free disk to provision, settling to a **10.1 GB** index plus roughly 33 MB of nightly top-ups.
Downloading needs a free USPTO.gov account with ID.me identity verification (`USPTO_API_KEY`); from
the repo root, `node bin/uspto-sync.mjs --from-file <archive>` ingests a file you already have and
needs no account. The build and its schedule are below.

## Building it, and keeping it current

`npx clearotron install` will offer to start this build for you, in the background, when you give it a
`USPTO_LOCAL_DB` path that does not exist yet. It asks first, it names the download size in the
question, and it takes only a typed `yes` — pressing Enter starts nothing. If you accept, it prints the
log path to watch. If you decline, you get the command below and nothing has been downloaded.

```sh
CLEAROTRON_DATABASE=uspto-local
USPTO_LOCAL_DB=/var/lib/trademark/uspto/us.db   # where the index lives
USPTO_API_KEY=...                               # only to DOWNLOAD; free, see below
node bin/uspto-sync.mjs                          # build it, then repeat daily
```

**`USPTO_API_KEY` is free and is only used for the download.** Get it from a USPTO.gov account, which
needs ID.me identity verification; the key is then on the account's *Manage API Key* page. Nothing is
billed — the account exists so the office can rate-limit its bulk endpoint. If you already have the
bulk archive by some other route, `node bin/uspto-sync.mjs --from-file <archive>` ingests it and needs
no account at all.

### You are the scheduler. Nothing here will run the sync for you.

**`uspto-sync` has no built-in scheduler, and configuring the provider does not create one.** `npm run
setup` offers to build the index once; that is the last time anything runs it by itself. There is no
daemon, no internal timer, no "check on start". If you do not schedule it, it runs when somebody
remembers — and the first sign of that is a search that refuses.

**What breaks when you skip this**, from the provider's own two clocks:

- **The last successful sync goes past 24 hours** → the provider stops counting. Every US slice comes
  back as a **deferred gap** with the age in the reason, never as a clean negative. A search still
  completes; it just discloses the US as unanswered.
- **The newest data applied goes past 96 hours** → same refusal, different reason. This one is the
  divergence alarm: publication lag plus daily cadence plus a business-day product's weekend puts the
  honest worst case at four days, so past it either the office stopped publishing or your syncs are
  succeeding while applying nothing. The second is silent, and this is what makes it audible.

Neither ever produces a zero. That is the point — the index is allowed to be stale and is not allowed
to be *silently* stale.

**Worked example — systemd timer, daily.** Two files. Run it as whichever service user owns
`USPTO_LOCAL_DB`; it needs write access to the index and nothing else.

```ini
# /etc/systemd/system/uspto-sync.service
[Unit]
Description=USPTO bulk index — incremental sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=trademark
WorkingDirectory=/opt/trademark
# The API key belongs in a 0600 file owned by this user, never inline in the unit:
# systemd unit files are world-readable, and `systemctl show` prints Environment= blocks.
EnvironmentFile=/etc/trademark/uspto.env      # USPTO_LOCAL_DB=… and USPTO_API_KEY=…
ExecStart=/usr/bin/node bin/uspto-sync.mjs
```

```ini
# /etc/systemd/system/uspto-sync.timer
[Unit]
Description=Run the USPTO incremental sync daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=30m      # do not hammer the office at 00:00:00 with everyone else
Persistent=true             # a sync missed while the box was down runs at next boot

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now uspto-sync.timer
systemctl list-timers uspto-sync.timer     # confirm NEXT and LEFT are populated
journalctl -u uspto-sync.service -n 50     # confirm the first run actually ingested
```

`Persistent=true` is the line that earns its place: without it a box that was off overnight simply
skips the day, and the 96-hour clock is measured in days.

**Cron alternative**, if you do not run systemd. Same job, same user, and the log matters as much as
the schedule — a cron sync that fails silently is worse than no sync, because the refusal it causes
appears in a search hours later and reads as a provider problem.

```cron
# crontab -e, as the user that owns USPTO_LOCAL_DB
17 3 * * *  cd /opt/trademark && /usr/bin/node bin/uspto-sync.mjs >> /var/log/uspto-sync.log 2>&1
```

Cron carries almost no environment: set `USPTO_LOCAL_DB` and `USPTO_API_KEY` in the crontab itself or
source a 0600 env file in the command. A sync that runs without them fails on the first call, and the
index goes on quietly aging.

**Three things about this source that are deliberate and will otherwise look like faults.**

*It refuses instead of returning nothing.* Until the index is built, a US search does not come back
empty — it fails, by name, telling you which variable to set. An unconfigured register that answered
"no conflicts found" would be the single most dangerous output this system can produce, so it cannot
produce it.

*It goes stale, and then it stops answering.* A local copy is only as current as its last sync. The
provider refuses to count when the last successful sync is over 24 hours old, or when the newest data
applied is further behind than a daily product's publication schedule explains. Schedule the sync — see
*You are the scheduler*, above. An index built with `--from-file` records no source date at all and
will refuse every count
until a download sync gives it one — which is the honest answer, since nothing can establish how old
that archive was.

*It covers the United States and nothing else.* Every other territory in a matter becomes a stated gap
in the report rather than a clean result. Pair it with EUIPO for Europe.

**What it does not do.** No sound-alike search — the index has no phonetic surface, so a phonetic
slice is disclosed as a gap rather than answered with something weaker. No opposition or TTAB records:
those are a separate USPTO product this index does not hold, and their absence is never rendered as
"none found". No mark images. Corsearch and Clarivate cover all three; Signa covers the first two and
holds no mark images either — the per-register table is
[providers/README.md](../README.md#what-each-register-can-do). The paid tiers also reach the
national European registers no free source does.

Sizes, so nothing surprises you. The repo is ~27 MB. A full build reads **41.5 GB** of archives across
the two bulk products and leaves a **10.1 GB** index — 0.24 index bytes per archive byte, over a whole
build rather than a sample of one. Provision **20 GB free** and you will not be caught out: the sync
downloads one part at a time and deletes it after ingesting, so the archives never all exist at once,
but the index and its write-ahead log do. It is never committed to git.

The build takes about nine hours on a small VM and is resumable — a kill or a dropped connection picks
up at the next un-ingested part rather than re-downloading. `npm run verify:uspto -- <dbPath>` reports
what an index actually holds, including whether the 1884 backfile is in it (a dailies-only build looks
identical on every other number and is missing a century).

This replaces only the *register* half of a clearance
— the reasoning engine still needs its own subscription or API key, and the unregistered-use half
still wants `PERPLEXITY_API_KEY`.

**It refuses rather than answering zero.** An absent index, a schema with no rows, or an index whose
FTS shadow tables were never built are all refusals with a named cause — `assertIndexReady` and
`assertFtsBuilt` in `src/index-store.js`. A half-built index is the dangerous shape: four of the six
predicates keep answering correctly while the two anchored wildcards return nothing forever, so the
check is a match probe against the index's own rows, not a row count. `doCount` in `src/core.js`
refuses on the same principle when the index is stale (two clocks, `FRESHNESS_HOURS`) or when
`backfile_through` is unstamped, returning `total: null` with a reason — never a zero.

## What reads it

- `../../driver/driver.config.mjs` — the `uspto-local` entry, lazily importing `src/core.js`; its
  `credEnv` is `USPTO_LOCAL_DB`, a path rather than a key.
- `../../driver/engine/mcp/uspto-local-server.mjs` — six of the eight neutral `register_*` tools.
  `register_image_fetch` and `register_expand_phoneme` are absent: the bulk product is text, and
  `predicates.phonetic` is `null`, so a phonetic slice defers and is disclosed.
- `../../driver/register-capabilities.mjs` — imports `src/capabilities.js` at module load, when there
  may be no database at all.
- `../_shared/` — the same enumerate/count/execute-plan kernels the remote providers use. Being local
  makes the queries cheap; it does not remove the completeness contract.
- `../../bin/uspto-sync.mjs` (`npm run sync:uspto`) drives `src/sync.js`; `npm run verify:uspto` and
  `npm run bench:uspto` drive `bin/verify-index.mjs` and `bench/bench.mjs`.

## Where to start

`src/index-store.js` — the schema, the six predicates, and the load-bearing rule that FTS5 matches
tokens, so the reversed-text index is only a candidate narrower and the exact `LIKE` after it is the
predicate. Then `src/capabilities.js`, unusual among these contracts because the limits are ours
rather than a vendor's wire, and explicit about which numbers are measured and which are conservative.

| File | Role |
|---|---|
| `src/capabilities.js` | The capability contract. Dependency-free; never reads the index. |
| `src/core.js` | The provider surface over the shared kernels, plus the freshness and backfile refusals. |
| `src/index-store.js` | Schema, the readiness assertions, the predicates, `freshness`. |
| `src/sync.js` | Which bulk products to pull and over what window — the register is TWO products. |
| `src/ingest.js` | The streaming XML scanner over USPTO's DTD V2.0. |
| `src/zip.js` | Just enough ZIP (including ZIP64) to stream one entry out of one archive. |
| `src/row.js` | The two row vocabularies and the injected status classifier. |
| `bin/verify-index.mjs` | Acceptance against a real index. Prints evidence; never prints "pass". |
| `bench/bench.mjs` | The OR-width and per-predicate timing curve, driven through `doSearch`. |
