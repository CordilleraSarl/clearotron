// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Custom searches — the named set-ups a brand owner runs clearances under.
//
// A saved search is a name over two things: a DEPTH (which machinery runs) and a SCOPE (where it points).
// "Zephyr Beverages knockouts — US focus" is exactly that: a quick screen, aimed at the US. Without the scope half
// it would only ever restate a level that is already one click away in the composer, which is why saving
// one is worth doing at all.
//
// THIS SCREEN LISTS AND RETIRES. IT DOES NOT BUILD.
//
// It used to carry its own editor: a second form, with its own depth picker, its own scope fields and its
// own idea of what a search is. That is the same form New clearance is, and once the composer learned to
// Save as search the two were duplicates — one of which quietly stopped receiving the design work the
// other got, which is exactly how "Create one" came to land on a page that looked a year older than the
// rest of the product. So the editor is gone and both roads lead to the composer: New builds one, Edit
// opens the existing one over the same levers. There is one place a search is described, and it is the
// place where you can see what it costs.
//
// TWO WORDS ARE HELD APART HERE, as they are in the engine:
//
//   LABEL — what the customer called this set-up. The only thing displayed.
//   NAME  — a profile key: the brand owner's own legal identity. Belongs to a different record entirely,
//           and the backend keeps the two key sets provably disjoint so they can never be conflated.
//
// RETIRED, NEVER DELETED is a rule of the record, not of the UI. A saved search that produced a report is
// part of how that report came to say what it says; destroying it would orphan the reasoning. There is no
// delete door here because there is none in the engine either — retiring is a save carrying archived:true,
// and it is reversible from this screen, which is the half that was missing.
//
// WHICH LIST THIS READS MATTERS. `api.searches` is the COMPOSER's menu and filters retired rows out
// server-side; drawn from it, this screen could show a retired search neither as present nor as
// restorable, so retiring one would have made it vanish for good. `api.savedSearches` is the config
// surface: it carries `archived`, `version` and `updatedAt`, which is what a screen that MANAGES these
// rather than picks between them actually needs.

import { useState } from 'react'
import type { Product, SavedSearchRow } from '../contract/api.ts'
import { api, isOk, notCommitted } from '../contract/api.ts'
import { statusFor, isUsable, displayLabel, versionLabel, sortSavedSearches } from '../contract/savedSearches.ts'
import type { SavedSearchStatus } from '../contract/savedSearches.ts'
import { draftFromSaved } from '../contract/composerProduct.ts'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

export function SavedSearches({ ctx }: { readonly ctx: ShellContext }) {
  // Who this is FOR — resolved exactly as the composer resolves it. A staff member acting for a client
  // sees that client's saved searches, and a single-account client sends null and has it resolved
  // server-side. This screen never decides tenancy; it only says who it is asking about.
  const account = ctx.owner
  const needsOwner = ctx.me.allAccounts && account === null

  const { result, reload } = useLoad(() => api.savedSearches(account), [account])
  // The OFFERING, for the "Builds on" column. A separate call because it is a different question — what
  // this deployment offers, as against what this brand owner has saved — and a refusal of one must not
  // blank the other.
  const { result: menu } = useLoad(() => api.searches(account), [account])
  const levels: readonly Product[] = menu?.kind === 'ok' ? menu.value.products : []

  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  if (needsOwner) return <PickOwner />

  // Every non-ok shape is handled BEFORE the empty state, and the ordering is the whole point.
  //
  // The tidy-looking version of this screen reads the rows out with `result?.kind === 'ok' ? … : []` and
  // then renders "no saved searches yet" when the list is short. On a listing screen that turns every
  // refusal — a rate limit, a 404, a dropped tunnel, a staff identity that has not named an account —
  // into a confident statement that this brand owner has none.
  if (!result) return <div className="screen" />
  if (result.kind === 'pickAccount') return <PickOwner />

  if (result.kind !== 'ok') {
    return (
      <div className="screen">
        <Heading />
        <div className="notice">
          <b>{result.kind === 'rateLimited' ? 'Too many requests just now' : 'Custom searches could not be loaded'}</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            {result.kind === 'rateLimited'
              ? 'The portal is pacing requests. Try again in a minute.'
              : 'Nothing has been changed or lost. Try again shortly.'}
          </p>
        </div>
      </div>
    )
  }

  /**
   * Retire, or bring back.
   *
   * A save REPLACES the record, so this reads the whole recipe back before flipping one flag. Composing a
   * patch from what the LIST carries would write a saved search stripped of everything this screen does
   * not display — its scope, its components, its notes.
   *
   * `archived: false` is sent EXPLICITLY to restore, and that is not belt and braces: recipe-service keeps
   * archive state sticky against omission, so only an explicit false brings one back.
   */
  const setRetired = async (row: SavedSearchRow, retired: boolean) => {
    setBusy(row.slug)
    setProblem(null)
    const full = await api.savedSearch(account, row.slug)
    if (!isOk(full)) {
      setBusy(null)
      setProblem('That could not be opened just now. Nothing has been changed.')
      return
    }
    const r = await api.saveSavedSearch(account, row.slug, 'save', {
      recipe: { ...full.value.recipe, archived: retired },
      // Naming the version this was based on turns a silent last-writer-wins clobber into a 409 that can
      // be acted on — someone may have edited it in the composer while this list sat open.
      expectedVersion: row.version,
    })
    setBusy(null)
    setConfirming(null)
    if (!isOk(r)) {
      setProblem(r.kind === 'conflict'
        ? 'Someone else changed this while the list was open. Reload and try again.'
        : `That could not be ${retired ? 'retired' : 'brought back'}. Nothing has been changed.`)
      return
    }
    // — live but uncommitted is a WARNING, not a failure: the change is on disk.
    const uncommitted = notCommitted(r)
    if (uncommitted) setProblem(uncommitted)
    reload()
  }

  const rows = sortSavedSearches(result.value)
  // Counted over the LIVE rows only: a retired search whose level is switched off is not a problem
  // anybody has, and reporting it as one would send someone looking for a fault in a search they
  // deliberately stopped using.
  const unusable = rows.filter((r) => !r.archived && !isUsable(statusFor(r, levels))).length

  if (!rows.length) return <Empty go={ctx.go} />

  return (
    <div className="screen">
      <Heading />
      <p className="prose" style={{ margin: 0, color: 'var(--text-muted)' }}>
        A custom search is a named set-up — how deep to search and where to point it — so a search you run
        often is run the same way every time. They are built on New clearance: set the levers there, and
        press <b>Save as search</b>.
      </p>

      {unusable ? (
        <div className="notice" style={{ borderLeftColor: 'var(--tone-medium)' }}>
          <b>
            {unusable === 1
              ? 'One of these cannot be used as it stands'
              : `${unusable} of these cannot be used as they stand`}
          </b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            The search underneath is not available right now. The custom search itself is untouched — each
            row below says which one and why.
          </p>
        </div>
      ) : null}

      {problem ? (
        <div className="notice" style={{ borderColor: 'var(--tone-high)' }}>
          <b>{problem}</b>
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="pill" style={{ cursor: 'pointer' }} onClick={() => ctx.go('/portal/new')}>
          New custom search
        </button>
      </div>

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Custom search</th>
              <th>Builds on</th>
              <th style={{ width: 90 }}>Version</th>
              <th style={{ width: 210 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              // The slug is the key half of `account/slug` and is unique; the label is free text and is
              // not, so the label would be an unstable React key on exactly the rows the sort had to
              // break a tie between.
              <SavedRow
                key={r.slug}
                recipe={r}
                products={levels}
                status={statusFor(r, levels)}
                busy={busy === r.slug}
                confirming={confirming === r.slug}
                onEdit={() => ctx.go(`/portal/new?search=${encodeURIComponent(r.slug)}`)}
                onRetire={() => (r.archived ? void setRetired(r, false) : setConfirming(r.slug))}
                onConfirm={() => void setRetired(r, true)}
                onCancel={() => setConfirming(null)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One saved search. A retired row is SHOWN, greyed — hiding it is what made retiring a one-way door. */
function SavedRow({
  recipe, products, status, busy, confirming, onEdit, onRetire, onConfirm, onCancel,
}: {
  readonly recipe: SavedSearchRow
  /** The offering, so the row can say whether the composer is able to state this record's product. */
  readonly products: readonly Product[]
  readonly status: SavedSearchStatus
  readonly busy: boolean
  readonly confirming: boolean
  readonly onEdit: () => void
  readonly onRetire: () => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const version = versionLabel(recipe)
  // Whether the composer can state this record's product — decided from the base alone, which is all a
  // list row carries and all the answer depends on. A record it cannot state has no Edit button rather
  // than an Edit button that opens a form which would rewrite it; see draftFromSaved.
  const editable = draftFromSaved({ base: recipe.base }, products) !== null
  return (
    <tr style={recipe.archived ? { opacity: 0.55 } : undefined}>
      <td>
        {/* A label is customer-composed and routinely contains a brand, so it blurs with everything else
            the screen-share toggle blurs. A saved search called "SEAHORSE relaunch" is as disclosing as
            the mark itself. */}
        <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>
          {displayLabel(recipe)}
        </b>
        {recipe.archived ? (
          <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px', marginLeft: 8 }}>Retired</span>
        ) : null}
      </td>
      <td>
        <BuildsOn status={status} />
      </td>
      <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        {/* No version was ever assigned. An em-dash says that; "v1" would claim otherwise. */}
        {version ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {confirming ? (
            <>
              {/* Two presses, and the second one names what it does. This is a confirm rather than a
                  warning because retiring is reversible from this same screen, one row up. */}
              <button
                type="button"
                className="pill"
                style={{ cursor: 'pointer', fontSize: 12, borderColor: 'var(--tone-high)' }}
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? 'Working…' : 'Confirm — retire'}
              </button>
              <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {editable && !recipe.archived ? (
                <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} onClick={onEdit}>
                  Edit
                </button>
              ) : null}
              <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} disabled={busy} onClick={onRetire}>
                {busy ? 'Working…' : recipe.archived ? 'Bring back' : 'Retire'}
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

/**
 * What this saved search sits on, and whether that still works.
 *
 * The three states are worded the way the composer words them, because a client meeting the same fact on
 * two screens should not have to work out that it is the same fact. In particular an unavailable level is
 * SHOWN with the server's own note rather than hidden: hiding it leaves someone with a saved search that
 * silently stopped working and no reason to ask about it.
 */
function BuildsOn({ status }: { readonly status: SavedSearchStatus }) {
  if (status.kind === 'unknownBase') {
    // The base key does not appear in the registry the server just sent, so we genuinely do not know what
    // this builds on — and the key itself is not an answer we are allowed to print. This is the honest
    // shape of "stored config outlived the level it named".
    return <span style={{ color: 'var(--text-muted)' }}>No longer available</span>
  }
  if (status.kind === 'unavailable') {
    return (
      <span>
        <span style={{ color: 'var(--text-strong)' }}>{status.name}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{status.stageLabel}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{status.note}</span>
      </span>
    )
  }
  // The NAME leads and the stage sits under it. This table compares the products a client has
  // configured, so the ladder position earns its place here — it is the only thing that orders them.
  return (
    <span>
      <span style={{ color: 'var(--text-strong)' }}>{status.name}</span>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{status.stageLabel}</span>
    </span>
  )
}

function Empty({ go }: { readonly go: (path: string) => void }) {
  return (
    <div className="screen">
      <Heading />
      <div className="notice">
        <b>No custom searches yet</b>
        <p className="prose" style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
          A custom search is a named set-up — how deep to search and where to point it. Build one on New
          clearance: set the levers, see what it costs, then press <b>Save as search</b>. It becomes a
          single choice the next time, instead of a form to fill in the same way every time.
        </p>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="pill" style={{ cursor: 'pointer' }} onClick={() => go('/portal/new')}>
            Build one on New clearance
          </button>
        </div>
      </div>
    </div>
  )
}

function PickOwner() {
  return (
    <div className="screen">
      <div className="notice">
        <b>Choose a brand owner first</b>
        <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
          Custom searches belong to one brand owner. Pick one at the top left.
        </p>
      </div>
    </div>
  )
}

/** The screen's own title. The brand owner is named in the rail, and once is enough. */
function Heading() {
  return (
    <>
      <div className="eyebrow">Custom searches</div>
      <h1 style={{ fontSize: 27, margin: '4px 0 6px', color: 'var(--text-strong)' }}>Custom searches</h1>
    </>
  )
}
