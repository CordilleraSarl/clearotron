// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Result — one finished read, in the shell, on one scroll.
//
// The report itself is a frozen document rendered by the engine, so this screen is a wrapper around it
// rather than a rendering of it. Two things about that wrapper are load-bearing:
//
//   • The frame has NO allow-same-origin. The embedded document therefore has a null origin and cannot
//     reach the portal's storage, DOM, cookies or API, however much script it runs. That retires the
//     stored-XSS class for every report ever delivered — not just the ones we have looked at.
//   • The identity above the frame comes from the RUN, never from the document. A report's own title is
//     model-authored; the mark, the brand owner and the band on this screen come from the API.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Run } from '../contract/api.ts'
import { api } from '../contract/api.ts'
import { readsFor, hasThread, readLabel, displayName, openDocument, showsAssessment } from '../contract/reads.ts'
import { inlineSpans } from '../contract/inlineMd.ts'
import { parseSummaryBlocks, SUMMARY_BLOCK_LINE } from '../contract/summaryBlocks.ts'
import { runProductLabel } from '../contract/home.ts'
import { FIRST_PAINT, frameCommand, readFrameHeight, readFrameScroll, readCommandFailure, readFrameControls, exportMenu, exportAffordance } from '../contract/reportFrame.ts'
import type { FrameCommand } from '../contract/reportFrame.ts'
import { RiskDot } from '../components/RiskDot.tsx'
import { Icon } from '../components/Icon.tsx'
import { askAiOffer } from '../contract/askAi.ts'
import { useLoad } from '../state/useApi.ts'
import { resultPath } from '../nav/nav.config.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

/**
 * Size the frame to its document, and drive the document's own controls from outside it.
 *
 * The frame has no allow-same-origin, so none of this can be done by reaching into it: the portal cannot
 * read `contentDocument.scrollHeight` and cannot call `exportPDF()`. postMessage is the only channel that
 * crosses a null origin, which is why the document carries a small injected bridge and this listens to it.
 *
 * The message is trusted by SOURCE IDENTITY, never by origin. A null-origin frame reports its origin as
 * the string "null", so an origin check would either accept every sandboxed frame on the internet or
 * reject this one — `event.source === contentWindow` is the check that actually means "this came from the
 * report I am showing".
 */
function useReportFrame() {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(FIRST_PAINT)
  const [failed, setFailed] = useState<string | null>(null)
  // NULL UNTIL THE DOCUMENT SAYS. Not an empty array: "we have not heard yet" and
  // "this document has no controls" are different states, and only the second is a fact about the report.
  const [controls, setControls] = useState<readonly FrameCommand[] | null>(null)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = ref.current
      const mine = !!frame && e.source === frame.contentWindow
      // Identity, not origin — see readFrameHeight. Only this component holds the ref, so only it can
      // answer the question the validator needs answered.
      const h = readFrameHeight(e.data, mine)
      if (h !== null) { setHeight(h); return }
      const has = readFrameControls(e.data, mine)
      if (has !== null) { setControls(has); return }
      // B2 — an in-page anchor click inside the frame. The frame cannot scroll (it is sized to its
      // content) and scrollIntoView does not cross the null-origin boundary, so the document posts the
      // target's offset and the PAGE performs the jump. The sticky chrome (56px shell topbar + the
      // pinned .report-head) overlays the top of the viewport — subtract it, plus a little breathing
      // room, so the clicked panel's HEADLINE lands visibly below the header instead of under it.
      const jump = readFrameScroll(e.data, mine)
      if (jump !== null) {
        if (frame) {
          const head = document.querySelector('.report-head')
          const chrome = 56 + (head instanceof HTMLElement ? head.offsetHeight : 48) + 10
          const y = frame.getBoundingClientRect().top + window.scrollY + jump - chrome
          window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
        }
        return
      }
      const bad = readCommandFailure(e.data, mine)
      if (bad) { setFailed(`That did not work — the report could not ${bad.command}. (${bad.message})`); return }
      // 's flag branch was the fourth reader here and is retired. It took the run id, which
      // is why this hook no longer needs one — every remaining message is about the frame itself, not
      // about which report is in it, so the effect has no dependency and re-binds on nothing.
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // targetOrigin has to be '*': the frame's origin is "null" and cannot be addressed. That is safe here
  // because the payload is a command verb with no secret in it — the sandbox is what protects the
  // document, not the obscurity of the channel.
  const send = useCallback((command: FrameCommand, value?: boolean) => {
    setFailed(null)
    ref.current?.contentWindow?.postMessage(frameCommand(command, value), '*')
  }, [])

  return { ref, height, send, failed, controls, clearFailed: () => setFailed(null) }
}

/**
 * The report's own Export popover, lifted out of the document and into the master header.
 *
 * The PDF items drive the frozen document through the bridge; the workbook is an ordinary download link,
 * because it is an ordinary file. It is NOT a bridge command: the report's own .xlsx link is stripped on
 * the way into the frame (it points at the archive, which the portal does not serve from), so there is
 * nothing in the document left to click. The link here points at the portal's own audit route, which
 * ownership-checks the run and reads the filename from its metadata.
 *
 * Every role, not just staff. This was staff-gated on the reasoning that the workbook is the working paper
 * behind the opinion — a disclosure decision, flagged as one, and made by the owner on 2026-07-27 alongside
 * retiring the two-report split: one report for everyone, and a reader who owns the run gets its workbook.
 * The route enforces the same ownership check either way, so this control now matches what the door allows
 * instead of hiding a capability the caller has.
 */
/**
 * ASK AI — the control the shell strips from every client report and never put back.
 *
 * The full clearance report carries an "Ask your AI about this run" band. `prepareReportForEmbed` strips
 * it from every client-facing framed report because the band names the STAFF host — and unlike the
 * report's Export menu, which the shell strips and then reproduces here, nothing reproduced this one.
 * The knockout renderer never had a band at all. So no client, on any run kind, could reach one.
 *
 * DRAWN FOR EVERY RUN KIND, and not gated on the framed document. It sends no bridge command and needs
 * nothing of the report: the question is composed from the run, and the address is the deployment's.
 * That is the difference from Export, which can only offer what the document defines.
 *
 * THE ADDRESS IS THE CLIENT DOOR. Re-introducing the staff host through a control the shell draws itself
 * would defeat the strip rather than complete it — so it comes from /portal/api/mcp-access, which
 * reports the client connector or null, and a null renders as an honest sentence rather than a host that
 * will not connect.
 */
function AskAiMenu({ runId, mark, ctx }: {
  readonly runId: string
  readonly mark: string | null
  readonly ctx: ShellContext
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const { result } = useLoad(() => api.mcpAccess(), [])
  const access = result?.kind === 'ok' ? result.value : null
  const offer = askAiOffer(runId, mark, access)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copy = (what: string, value: string) => {
    // navigator.clipboard is absent on an insecure origin and in some embedded views. Failing silently
    // would leave a button that does nothing, which is the class the bridge's commandFailed reply exists
    // to end — so the label says what happened either way.
    void (async () => {
      try { await navigator.clipboard?.writeText(value); setCopied(what) }
      catch { setCopied(`${what}-failed`) }
    })()
  }

  const line = (label: string, value: string, key: string) => (
    <div style={{ padding: '7px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-strong)', wordBreak: 'break-all', flex: 1 }}>{value}</span>
        <button type="button" className="link-btn" style={{ fontSize: 12, flex: 'none' }} onClick={() => copy(key, value)}>
          {copied === key ? 'Copied' : copied === `${key}-failed` ? 'Copy failed' : 'Copy'}
        </button>
      </div>
    </div>
  )

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        className="nav-item"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ width: 'auto', margin: 0, padding: '6px 11px', border: '1px solid var(--border-hairline)' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="sparkles" size={14} />
        <span>Ask AI</span>
      </button>
      {open ? (
        <div className="float" role="menu" style={{ position: 'absolute', right: 0, top: 38, width: 320, padding: 6, zIndex: 50 }}>
          {line('Say this to your assistant', offer.question, 'question')}
          {offer.address
            ? line('Connector address', offer.address, 'address')
            : (
              /* NOT SET UP HERE — AND THE BAND POINTS RATHER THAN TEACHES.
                 The finalized design rules that the band "stops teaching setup inline and carries one
                 line into this page": teaching connection inside a report is the fancy-readme problem in
                 miniature. So a reader with no address gets the reason and one way forward, and the page
                 is where the route that works for THEIR deployment is derived — including the local
                 one-liner, which is 1959's half and belongs there, not repeated here. */
              <p style={{ margin: 0, padding: '7px 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {offer.stdio
                  ? 'This deployment has no published address, but your assistant can connect to it directly. '
                  : 'No connector is set up on this deployment yet, so there is no address to paste. '}
                The question above is what to ask once it is connected.
              </p>
            )}
          <div style={{ height: 1, background: 'var(--border-hairline)', margin: '5px 8px' }} />
          <button
            type="button"
            role="menuitem"
            className="nav-item"
            style={{ fontSize: 13, padding: '7px 10px' }}
            onClick={() => { setOpen(false); ctx.go(offer.instructionsPath) }}
          >
            How to connect your assistant
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ExportMenu({
  send,
  runId,
  offered,
}: {
  readonly send: (c: FrameCommand, v?: boolean) => void
  readonly runId: string
  /** The verbs the framed document announced. Every item below is drawn from this and nothing else. */
  readonly offered: readonly FrameCommand[]
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = (label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className="nav-item"
      style={{ fontSize: 13, padding: '7px 10px' }}
      onClick={() => {
        onClick()
        setOpen(false)
      }}
    >
      {label}
    </button>
  )

  const rows = exportMenu(offered)
  const auditHref = `/portal/report/${encodeURIComponent(runId)}/audit.xlsx`

  // THE WORKBOOK IS A RUN-LEVEL FILE AND NEVER DEPENDED ON THE DOCUMENT. When the
  // framed report announces no verbs — every knockout published before this change, whose functions sit
  // inside an IIFE — the composed menu is the download alone. Drawing NOTHING for that case would take
  // the workbook away from exactly the population this issue is about: the report's own .xlsx link is
  // stripped on the way into the frame, so the shell's link is the only one there is. A menu holding one
  // download is a button pretending to be a menu; the answer is to draw the button, not to draw nothing.
  if (exportAffordance(offered) === 'download') {
    return (
      <a
        className="nav-item"
        style={{ width: 'auto', margin: 0, padding: '6px 11px', border: '1px solid var(--border-hairline)', textDecoration: 'none' }}
        href={auditHref}
        download
      >
        <Icon name="layers" size={14} />
        <span>Download audit</span>
      </a>
    )
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        className="nav-item"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ width: 'auto', margin: 0, padding: '6px 11px', border: '1px solid var(--border-hairline)' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="layers" size={14} />
        <span>Export</span>
      </button>
      {open ? (
        <div className="float" role="menu" style={{ position: 'absolute', right: 0, top: 38, width: 250, padding: 6, zIndex: 50 }}>
          {/* THE ROWS ARE `exportMenu(offered)`, not a list written here. Which rows
              exist is a rule about what the document can do, so it lives in the contract with a test —
              this is the rendering of it and nothing more. */}
          {rows.map((row, i) => {
            if (row.kind === 'command') {
              return item(row.label, () => (row.value === null ? send(row.command) : send(row.command, row.value)))
            }
            if (row.kind === 'separator') {
              return <div key={`sep${i}`} style={{ height: 1, background: 'var(--border-hairline)', margin: '5px 8px' }} />
            }
            if (row.kind === 'note') {
              return (
                <p key={`note${i}`} style={{ margin: '6px 10px 4px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  {row.text}
                </p>
              )
            }
            // An anchor, not a button: this is a file, and letting the browser do the download means it
            // behaves like every other download — right-click, save-as, resumable — instead of being a
            // click handler that has to reimplement all of that badly.
            return (
              <a
                key="dl"
                role="menuitem"
                className="nav-item"
                style={{ fontSize: 13, padding: '7px 10px', textDecoration: 'none' }}
                href={auditHref}
                download
                onClick={() => setOpen(false)}
              >
                Download full audit (Excel)
              </a>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One paragraph of engine prose, rendered as TEXT NODES.
 *
 * The assessment carries inline markdown — the model writes it because every surface it feeds renders
 * it, and the reports themselves render it. Matching that with the reports' own string replacement would
 * mean setting innerHTML on model-authored text arriving over the wire, which is a stored-XSS path onto
 * a client's legal opinion and is closed for the whole bundle by test/no-danger.ts. So the markdown is
 * read into spans and each span is a React child: `<script>` in an assessment renders as the characters
 * `<script>`, because React escapes every text node and nothing here is ever markup.
 */
/* / — THE SUMMARY'S BLOCKS, not only its paragraphs.
   The assess seat writes sub-headers and bullets inside the summary now (owner ruling 2026-08-31:
   "keep the length, add the structure"). <Prose> renders INLINE spans only, so before this a reader met
   the literal characters `##` and `-` on the page the ruling was about.
   A chunk with no block line renders as the same <p> it always did — which is what keeps an already
   delivered run looking like itself. The grammar is shared; see contract/summaryBlocks.ts. */
function SummaryBlocks({ chunk, first }: { readonly chunk: string; readonly first: boolean }) {
  if (!SUMMARY_BLOCK_LINE.test(chunk)) {
    return <p style={{ margin: first ? '6px 0 0' : '10px 0 0', color: 'var(--text-body)' }}><Prose text={chunk} /></p>
  }
  return (
    <>
      {parseSummaryBlocks(chunk).map((b, i) =>
        b.kind === 'heading' ? (
          /* Depth is the report's, not the page's: the summary sits under the run's own heading, so a
             sub-header inside it renders as a strong label and never as another page title. */
          <div key={i} style={{ margin: i === 0 && first ? '6px 0 4px' : '14px 0 4px', fontWeight: 800, fontSize: 13.5, color: 'var(--text-body)' }}>
            <Prose text={b.text} />
          </div>
        ) : b.kind === 'bullets' ? (
          <ul key={i} style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--text-body)' }}>
            {b.items.map((it, j) => <li key={j} style={{ margin: '0 0 4px' }}><Prose text={it} /></li>)}
          </ul>
        ) : (
          <p key={i} style={{ margin: i === 0 && first ? '6px 0 0' : '10px 0 0', color: 'var(--text-body)' }}><Prose text={b.text} /></p>
        ),
      )}
    </>
  )
}

function Prose({ text }: { readonly text: string }) {
  return (
    <>
      {inlineSpans(text).map((s, i) =>
        s.style === 'strong' ? <b key={i}>{s.text}</b>
        : s.style === 'em' ? <i key={i}>{s.text}</i>
        : s.style === 'code' ? <span key={i} className="mono">{s.text}</span>
        : <span key={i}>{s.text}</span>,
      )}
    </>
  )
}

export function Result({
  ctx,
  runId,
  markSlug,
}: {
  readonly ctx: ShellContext
  readonly runId: string
  /** One name out of a batch, when the URL named one. Null means "the run", which is what it always was. */
  readonly markSlug: string | null
}) {
  // EVERY RUN THIS IDENTITY HOLDS — the same question Clearances asks, deliberately.
  //
  // This used to fetch `api.runs(ctx.owner ?? …)`, i.e. the list narrowed to whichever brand owner the
  // sidebar switcher had selected, and then find the run in it. Clearances lists with `runsMine()`,
  // which for staff spans every account including the staff-only `generic`. The two disagreed, and the
  // gap was the whole bug: you could see a row on the list and not open it, and — worse — changing the
  // switcher while a report was open made that report vanish under you, because it was never scoped to
  // the owner you had just picked.
  //
  // A run is identified by its id, not by who happens to be selected in a menu. The switcher scopes
  // LISTS; it must never decide whether a report you are already reading exists. Same call as the list
  // means the two can no longer drift: anything Clearances can show, this can open.
  //
  // Ownership is unchanged and still enforced server-side — `runsMine` returns exactly the accounts this
  // identity holds, and /portal/report/<id> re-checks the run's owner against the caller regardless.
  const { result } = useLoad(() => api.runsMine(), [])
  const runs: readonly Run[] = result?.kind === 'ok' ? result.value : []

  const run = useMemo(() => runs.find((r) => r.runId === runId) ?? null, [runs, runId])
  const reads = useMemo(() => (run ? readsFor(runs, run) : []), [runs, run])
  // NO PRODUCT-MENU FETCH. The reads strip used to load `api.searches` purely to turn
  // `run.product` into a name; that menu holds the ORDERABLE products only, so every archived read
  // missed it and its pill printed `stageLabel` — a Depth number — beside a masthead naming the
  // product. The name rides the row now, off the same registry the masthead prints from.
  // Hooks run before any early return — the loading and not-found branches below are returns, and a hook
  // after them would change call order between renders.
  const frame = useReportFrame()

  // — THE CROSS-MARK PARAGRAPH, asked for only by the view that shows it.
  //
  // A grouped run's assessment reads its names against each other and lives nowhere else: there is no
  // combined document, and the per-mark documents deliberately carry none of it. It is the substance of
  // this page when no single name is open.
  //
  // The hook is unconditional — it has to be — but the REQUEST is not: any other view answers `notFound`
  // without reaching the network, which is the same answer the route gives for a run that has no such
  // paragraph. One rendering path for "there is none", however it came to be true.
  const grouped = run !== null && showsAssessment(run, markSlug)
  const { result: summaryResult } = useLoad<readonly string[]>(
    () => (grouped ? api.runSummary(runId) : Promise.resolve({ kind: 'notFound' } as const)),
    [runId, grouped],
  )
  const assessment = summaryResult?.kind === 'ok' ? summaryResult.value : []

  // NO `pickAccount` BRANCH. There used to be one here, telling a multi-account client to pick a brand
  // owner before the report would open. That state came from `api.runs(null)`, which the server answers
  // "name an account (?account=)" — and `runsMine` is the route that exists precisely so nobody has to.
  // It is unreachable now, and a screen that asks someone to choose an owner before reading a report
  // they own would be re-introducing the bug above in a politer voice.

  if (result && result.kind !== 'ok') {
    return <Missing go={ctx.go} reason={result.kind === 'notFound' ? 'notFound' : 'error'} />
  }
  if (!result) return <div className="screen report" />
  // Not in the list means not ours, or not a run at all — indistinguishable on purpose.
  if (!run) return <Missing go={ctx.go} reason="notFound" />

  // WHICH PRODUCT THIS IS. A reader holding two open reads must be able to tell them apart from
  // this screen alone, and until now nothing on it said which of the four products they were looking at.
  //
  // The name comes off the WIRE — `run.productName`, resolved server-side by the one resolver the report
  // masthead prints from (reportIdentityFor → `.identity`), so the shell and the document it frames cannot
  // disagree. `runProductLabel` is the same composer the list rows use; a second mapping table in the
  // browser is exactly what deleted, and it drifted the moment it existed.
  //
  // NEVER `run.stageLabel`: on a retired row that is a Depth rung, and a depth number is not a product.
  // Null is a real answer and it means SILENCE — a level the registry has forgotten names nothing rather
  // than guessing.
  //
  // The label folds the mark count in on a knockout, so the standalone count below rides only when the
  // product is null and the count would otherwise be lost with it.
  const product = runProductLabel(run.productName, run.marks.length)

  // WHICH DOCUMENT IS OPEN.
  //
  // A batch's names used to be listed here as plain links to the frozen document. Following one LEFT
  // THE PORTAL: the report filled the window with no shell, no navigation, and nothing pointing back at
  // the other names it was published beside. Each name is a route into this screen now, and this is the
  // other end of it.
  //
  // `openDocument` is the choosing, and it lives in the contract because what it must never return is
  // worth a test: a ROUTE where the frame expects a document.
  const { doc, mark: pickedMark, missing } = openDocument(run, markSlug)
  const heading = markSlug === null ? displayName(run) : pickedMark ?? markSlug
  const family = resultPath(run.runId)
  // Back is ONE step, not always the list. With a name open the step back is the family it came out of;
  // without one there is no family above this and the step back is the clearances list, as before.
  const back = markSlug === null
    ? { label: 'Clearances', href: '/portal/clearances' }
    : { label: 'All names', href: family }

  return (
    <div className="screen report">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          className="nav-item"
          style={{ width: 'auto', padding: '4px 8px', margin: 0 }}
          onClick={() => ctx.go(back.href)}
        >
          <Icon name="chevron-left" size={14} />
          <span>{back.label}</span>
        </button>
        <span className="crumb">›</span>
        <span className="crumb" data-anon="mark">{displayName(run)}</span>
        {markSlug === null ? null : (
          <>
            <span className="crumb">›</span>
            <span className="crumb" data-anon="mark">{pickedMark ?? markSlug}</span>
          </>
        )}
      </div>

      {/* PINNED, because a header you scroll away from is a header you do not have.
          The page scrolls now (that is the point), which took the mark name and the Export button off
          screen the moment the reader started reading. `.report-head` sticks at 56px — the height of the
          shell topbar, which is itself sticky at 0 — so the two stack and Export stays reachable at any
          depth in a 6,000px document. */}
      <div className="report-head">
      {/* ONE line, not a title block.
          The report restates all of this immediately below in its own hero — mark at 58px, band on the
          gauge, scope in the chips — because it is a document that has to stand alone when exported or
          printed. Repeating it here at title size meant the reader met the same four facts three times
          (shell topbar, this header, the report's own) before reaching a word of the opinion, and the
          document started below the fold. This line exists to say WHICH read is open and to carry the
          controls the frame can no longer host; the report is the thing worth the space. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 2 }}>
        {/* THE MARK, not the report's headline.
            `run.title` is model-authored front matter: a real delivered run carries "AquaPlus — US
            Preliminary Trademark Clearance" there. Printing it here is what made this header restate a
            whole sentence the report says again, larger, two centimetres below. `markName` is the name
            the user typed; runs delivered before publish started carrying it fall back to the headline
            and will read verbosely until they are re-rendered. */}
        <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: 'var(--text-strong)' }} data-anon="mark">
          {heading}
        </h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          <span data-anon="mark">{ctx.ownerName(run.account)}</span>
          {/* NOT `data-anon` — a product name is what we sell, not what a client bought it for. The
              screen-share blur covers the mark and the owner; blurring "Full country search" would hide
              the one word that tells the reader which of two open reads is in front of them. */}
          {product ? <> · {product}</> : null}
          {!product && run.kind === 'knockout-batch' ? <> · {run.marks.length} names</> : null}
          {run.date ? <> · <span className="mono">{run.date}</span></> : null}
        </div>
        <RiskDot tone={run.tone} label={run.band} />
        <span style={{ flex: 1 }} />
        {/* The stale note that used to sit here — "STILL GATED ON THE RUN-LEVEL DOCUMENT … this gate
            moves to `doc` there, not here" — went with  landing, because the gate DID
            move to `doc` and the note then contradicted the two lines under it. Removed here rather than
            left, since this is the region being rebuilt. */}
        {/* EVERY RUN KIND, and beside Export rather than instead of it: Export
            drives the framed document and can only offer what that document defines; this drives the
            reader's own assistant and needs nothing of the report. */}
        <AskAiMenu runId={run.runId} mark={run.markName} ctx={ctx} />
        {/* THE COMMAND ROWS ARE GATED ON WHAT THE DOCUMENT SAYS IT HAS, not on the run's kind (tracker
            issue 1922) — and the AUDIT DOWNLOAD is gated on neither, because it is a run-level file the
            renderer never had anything to do with. Null controls means the frame has not announced yet
            and an empty list means it announced nothing; both draw no command rows, and both still draw
            the workbook, which ExportMenu renders as a plain button rather than a one-item menu. Hiding
            it in either state would take the workbook away from every knockout published before this
            change, whose .xlsx link is stripped on the way into the frame. The old gate on `run.report`
            is gone: a per-name document out of a batch is a framed document like any other. */}
        {doc ? (
          <ExportMenu send={frame.send} runId={run.runId} offered={frame.controls ?? []} />
        ) : null}
      </div>
      </div>

      {/* Only when there is genuinely a thread — a strip with one pill implies somewhere to go. */}
      {hasThread(reads) ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 4px' }}>
          <span className="eyebrow" style={{ alignSelf: 'center' }}>Reads</span>
          {reads.map((r) => {
            const active = r.runId === run.runId
            return (
              <button
                key={r.runId}
                type="button"
                className="pill"
                aria-current={active ? 'true' : undefined}
                onClick={() => ctx.go(resultPath(r.runId))}
                style={{
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  background: active ? 'var(--accent-wash)' : 'var(--surface-sunken)',
                  borderColor: active ? 'var(--accent)' : 'var(--border-hairline)',
                  color: active ? 'var(--text-accent)' : 'var(--text-muted)',
                }}
              >
                {r.tone ? (
                  <span className="dot" style={{ background: `var(--tone-${r.tone})`, width: 7, height: 7 }} />
                ) : null}
                {readLabel(r)}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* A control that fails now says so. It used to fail silently, which is indistinguishable from a
          control that is merely slow, and is why a broken Export survived a whole round of review. */}
      {frame.failed ? (
        <div className="notice" style={{ borderLeftColor: 'var(--tone-high)' }} role="alert">
          <b>{frame.failed}</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            The report itself is unaffected — you can still read and print it from the page.
          </p>
        </div>
      ) : null}

      {/* The "This report is with Cordillera — a lawyer is reading it" state is GONE. It was the face of
          a release gate with no key: nothing in the product could release a held report, so the message
          was a promise it could not keep. A run either has a report or has not produced one yet. */}
      {doc ? (
        /* The frame's accessible name is composed HERE, from the product this run actually is. It used to
           be a hardcoded product word inside ReportFrame, so a knockout announced itself as a clearance on
           every knockout ever published — the shell contradicting the document it framed.
           `heading` is the NAME being read: the run's on a single-document run, and the one picked name
           on a batch — so a reader with two of a batch's names open in two tabs can tell them apart. */
        <ReportFrame
          src={doc}
          title={product ? `${product} — ${heading}` : heading}
          frameRef={frame.ref}
          height={frame.height}
        />
      ) : missing ? (
        /* A SLUG THAT NAMES NOTHING SAYS SO. The tempting repair is to fall through to the family list,
           which turns a stale or mistyped link into a silent redirect — the reader asked for one name
           and is shown the whole batch with no word about why. The list is one press away below. */
        <div className="notice" style={{ marginTop: 20 }} role="alert">
          <b>That name is not in this search</b>
          <p style={{ margin: '6px 0 10px', color: 'var(--text-muted)' }}>
            This search has no report for <span className="mono">{markSlug}</span>. It may have been
            published under a different name, or the link may be from an older version of this search.
          </p>
          <button type="button" className="nav-item" style={{ width: 'auto', margin: 0 }} onClick={() => ctx.go(family)}>
            <Icon name="chevron-left" size={14} />
            <span>All names in this search</span>
          </button>
        </div>
      ) : run.reports.length > 1 ? (
        <>
        {/* THE CROSS-MARK ASSESSMENT, and it leads (, owner ruling 2026-08-26).
            This paragraph is the only place the names are read against each other: the engine composes
            it on every grouped run, deliberately keeps it OFF each per-mark document (where it would be
            another name's answer under this name's heading), and wrote it to a file no route reached.
            It is the substance of this page; the list below it is navigation. Absent — a run whose
            summary came out empty, or one still being composed — renders nothing rather than an empty
            panel, because a heading over no prose is a promise the page cannot keep. */}
        {assessment.length ? (
          <div className="notice" style={{ marginTop: 20 }} data-anon="mark">
            <div className="eyebrow">Assessment</div>
            {assessment.map((p, i) => <SummaryBlocks key={i} chunk={p} first={i === 0} />)}
          </div>
        ) : null}
        {/* ONE REPORT PER MARK. A batch has no single document, so the page does not frame one —
           it lists what the run produced, one row per name. Framing the first would put one name's
           answer under the whole batch's heading, which is the thing this replaced. */}
        <div className="notice" style={{ marginTop: 20 }}>
          {/* The product leads, bare: `product` folds the mark count in, and the count is already this
              line's subject. A batch never reaches the frame above, so this is the only place it says
              what it is. */}
          <b>{run.productName ? `${run.productName} · ` : ''}{run.reports.length} reports — one per name</b>
          <p style={{ margin: '6px 0 10px', color: 'var(--text-muted)' }}>
            This knockout screened {run.reports.length} names. Each has its own report.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {run.reports.map((r) => {
              // A ROUTE, NOT THE DOCUMENT. `r.path` is the frozen file, and linking it here is
              // what sent a client out of the portal into a full-screen report with no shell and no way
              // back. The press goes through the router to /portal/result/<run>/<slug>, which frames
              // that same file inside this screen. A document published before slugs existed has no
              // route to offer, so it keeps its direct link rather than losing its only way in.
              const slug = r.slug
              return (
                <li key={r.path} style={{ margin: '4px 0' }}>
                  {slug ? (
                    <button
                      type="button"
                      className="link-btn"
                      style={{ fontSize: 'inherit', textDecoration: 'none' }}
                      onClick={() => ctx.go(resultPath(run.runId, slug))}
                    >
                      {r.mark ?? slug}
                    </button>
                  ) : (
                    <a href={r.path}>{r.mark ?? r.path}</a>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        </>
      ) : (
        <div className="notice" style={{ marginTop: 20 }}>
          <b>No report yet</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            This search has not produced a report yet.
          </p>
        </div>
      )}
    </div>
  )
}

function ReportFrame({
  src,
  title,
  frameRef,
  height,
}: {
  readonly src: string
  readonly title: string
  readonly frameRef: React.MutableRefObject<HTMLIFrameElement | null>
  readonly height: number
}) {
  return (
    // The PAGE owns the only scrollbar, and the frame is as tall as its document.
    //
    // This has now been wrong in both directions, so both are worth recording. Originally the frame had a
    // fixed height inside a scrolling page: the report scrolled in its own box while the page scrolled
    // behind it, two scrollbars for one document and neither reaching the end. The fix was to lock the
    // screen to the viewport and let the frame scroll alone — one scrollbar, correct, and it made the
    // report the only screen in the portal that did not behave like a page. The sidebar and header were
    // pinned by a different mechanism from every other screen, and the reader lost the browser scrollbar
    // as a sense of how much document was left.
    //
    // A frame cannot size itself to a cross-origin document, and this one is deliberately null-origin, so
    // the document measures ITSELF and posts the number out (the bridge injected by portal-report.mjs).
    // The page then scrolls normally, .sidebar and .topbar stay put on their existing position:sticky,
    // and there is still exactly one scrollbar. The sandbox is untouched.
    //
    // There is also no explanatory banner here any more. It apologised for the report rendering in its
    // own light theme, which is not something a reader should be told about a document they asked to
    // read — the honest fix was to stop it looking wrong, not to caption it.
    // `data-anon` sits on the CONTAINER, and that is the only place it can sit.
    //
    // The screen-share blur is a CSS filter driven by `html.anon-on [data-anon='mark']` (base.css).
    // Inside the frame it has no reach at all: the document has a null origin, so the parent's
    // stylesheet does not apply to it and no script can add markup to it. The report also carries no
    // per-name tagging of its own. For a while the Preferences screen simply CLAIMED the blur covered
    // the report, which was untrue in the one situation the feature exists for — a lawyer sharing a
    // screen with a client's report open.
    //
    // A filter on an ancestor rasterises the iframe along with it, so tagging the container makes the
    // promise true. The trade is that the WHOLE document blurs rather than just the names in it, which
    // for a screen-share is the safer direction: the alternative was covering nothing.
    <div data-anon="mark" style={{ marginTop: 12 }}>
      <iframe
        ref={frameRef}
        src={src}
        // VERBATIM, composed by the caller. This used to prepend a hardcoded product word — a product
        // name, in the browser, that no run could contradict — so a knockout, a Global preliminary search
        // and a Full country search all announced themselves to a screen reader as the same thing.
        title={title}
        // NO allow-same-origin. The document gets a null origin, so it cannot touch this page's
        // localStorage, DOM, cookies or API no matter what script it carries. That is what retires the
        // stored-XSS class for every report already delivered, rather than for the ones we inspected.
        // allow-modals is here for window.print(); allow-downloads for the export.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        // "auto", not "no", and the difference only shows up when something has already gone wrong.
        //
        // In normal operation there is nothing to scroll: the bridge reports a height 16px GREATER than
        // the content, so the frame is always slightly taller than its document and no inner scrollbar
        // appears. If the bridge fails — script error, blocked message, a body that cannot be measured —
        // the frame stays at its first-paint guess, and "auto" degrades that to a scrollable frame
        // instead of a legal opinion truncated at 1400px with no way to read the rest.
        scrolling="auto"
        // NO BORDER, NO RADIUS, NO BACKGROUND, and the first of those is not cosmetic.
        //
        // base.css sets `*{box-sizing:border-box}`, so a 1px border made the frame's VIEWPORT 2px
        // shorter than the height set on it — content overflowed by exactly 2px and the report got its
        // own scrollbar with a 2px range. Measured in Chrome as `borderSteals: 2` on every load; on
        // screen it is a scrollbar that appears to twitch and go nowhere.
        //
        // The rest is what made the report read as a card inside a panel that already has edges: the
        // document brings its own background, so the frame only needs to get out of its way.
        style={{ height, width: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}

function Missing({ go, reason }: { readonly go: (p: string) => void; readonly reason: 'notFound' | 'error' }) {
  return (
    <div className="screen report">
      <div className="empty">
        <p>
          {reason === 'notFound'
            ? 'That clearance is not available.'
            : 'The clearance could not be loaded just now.'}
        </p>
        <button type="button" className="nav-item" style={{ width: 'auto', margin: '0 auto' }} onClick={() => go('/portal/clearances')}>
          Back to Clearances
        </button>
      </div>
    </div>
  )
}
