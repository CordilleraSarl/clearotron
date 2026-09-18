// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A table's sideways scrollbar, pinned to the bottom of the screen while the table is in view.
//
// A table that continues past its right edge shows a scrollbar, always visible, and no text (ruled
// 2026-09-17). Visible was not enough on a long list: the browser draws the bar at the table's foot, and
// on a 25-row list at phone width that is several screens down, so a reader at the top met a table cut
// off at a column with no sign it continued. Pinned was ruled on the question that raised.
//
// DRAWN HERE, NOT LEFT TO THE BROWSER. A phone's scrollbars are overlays: they take no room and show only
// while the table moves, and one platform ignores scrollbar styling altogether — measured in a phone-
// emulating browser, a native bar pinned the same way was one pixel tall. So this draws the track and the
// thumb itself, from the table's own scroll position, and dragging the thumb or pressing the track moves
// the table. The table still scrolls under a finger as before; this is where its position is shown.
//
// `position: sticky` to the bottom of the screen, so it sits at the bottom edge while the table is on
// screen and settles under the table at its foot. Drawn only while the table actually scrolls sideways: a
// bar with nothing to scroll is a control that does nothing.

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

type Geometry = { readonly scrolls: boolean; readonly thumb: number; readonly left: number }

export function PinnedScrollbar({ target }: { readonly target: RefObject<HTMLElement | null> }) {
  const track = useRef<HTMLDivElement | null>(null)
  const [g, setG] = useState<Geometry>({ scrolls: false, thumb: 0, left: 0 })
  const drag = useRef<{ readonly x: number; readonly scroll: number } | null>(null)

  useEffect(() => {
    const el = target.current
    if (!el) return
    const measure = () => {
      const scrolls = /auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1
      const ratio = el.clientWidth / Math.max(1, el.scrollWidth)
      const room = Math.max(1, el.scrollWidth - el.clientWidth)
      // Percentages of the track, so the thumb is sized and placed before the track has been measured.
      setG({ scrolls, thumb: ratio * 100, left: (el.scrollLeft / room) * (100 - ratio * 100) })
      // One bar, never two: the table's own bar is hidden while this one is drawn.
      el.classList.toggle('has-pinned-bar', scrolls)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure); el.classList.remove('has-pinned-bar') }
  }, [target])

  if (!g.scrolls) return null

  // The track's width stands for the table's whole scroll width, so a pixel of thumb is this many of table.
  const scale = () => {
    const el = target.current, t = track.current
    return el && t ? el.scrollWidth / Math.max(1, t.clientWidth) : 0
  }
  const onThumbDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = target.current
    if (!el) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, scroll: el.scrollLeft }
  }
  const onThumbMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = target.current, d = drag.current
    if (el && d) el.scrollLeft = d.scroll + (e.clientX - d.x) * scale()
  }
  const onThumbUp = () => { drag.current = null }
  // A press on the track moves the table so the thumb centres on the press.
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = target.current, t = track.current
    if (!el || !t) return
    const at = e.clientX - t.getBoundingClientRect().left
    el.scrollLeft = at * scale() - el.clientWidth / 2
  }

  return (
    <div className="pinned-bar" aria-hidden="true">
      <div ref={track} className="pinned-track" onPointerDown={onTrackDown}>
        <div
          className="pinned-thumb"
          style={{ width: `${g.thumb}%`, left: `${g.left}%` }}
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
        />
      </div>
    </div>
  )
}
