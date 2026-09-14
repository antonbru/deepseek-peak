/**
 * DeepSeek peak / off-peak status chip for the Hermes Desktop status bar.
 *
 * Answers one question at a glance: is DeepSeek on its peak tariff right now?
 *
 *   🔴 peak · 3:32       → peak, double price, 3h32m until off-peak returns
 *   🟢 off-peak · 30m    → half price, peak starts in 30 minutes
 *
 * The countdown is live: the chip reticks every second (the label changes once
 * a minute, the detail panel counts the seconds down).
 *
 * Click the chip for a compact detail panel — four lines, no tabs:
 *
 *   🔴 Peak now (price ×2)
 *   09:27 GMT+3 · Mon 14 Sep
 *   Off-peak at 13:00 — in 3 h 32 min 16 s
 *   Peak: weekdays 04:00–07:00 and 09:00–13:00 (your time)
 *
 * Times are always shown in the timezone of the machine running the app — no
 * picker to set, nothing to configure.
 *
 * Tariff (api-docs.deepseek.com/quick_start/pricing, checked 10.09.2026):
 * peak = Mon–Fri 01:00–04:00 and 06:00–10:00 UTC; everything else — including
 * all weekend — is off-peak at half price. The state is therefore a pure
 * function of UTC, which is why this plugin never lets you "choose" it: the
 * timezone only changes how the windows are displayed (for MSK the same
 * windows read 04:00–07:00 and 09:00–13:00).
 *
 * Install: <HERMES_HOME>/desktop-plugins/deepseek-peak/plugin.js
 * (folder name must equal the plugin id). Hot reloads on save.
 */

import {
  Button,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  STATUSBAR_AREAS,
  cn,
  haptic,
  host
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'deepseek-peak'
const DAY_MS = 86_400_000
const MIN_MS = 60_000
const TICK_MS = 1000

/** Peak windows as [startMinute, endMinute) of a UTC weekday. */
const PEAK_WINDOWS_UTC = [
  [60, 240], // 01:00–04:00 UTC
  [360, 600] // 06:00–10:00 UTC
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ------------------------------------------------------------------ logic */

function utcDayStart(ms) {
  const d = new Date(ms)

  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Midnight UTC of the next weekday — the anchor for local window labels. */
function nextWeekdayUtcMidnight(nowMs) {
  const start = utcDayStart(nowMs)

  for (let offset = 0; offset <= 7; offset++) {
    const day = start + offset * DAY_MS
    const weekday = new Date(day).getUTCDay()

    if (weekday >= 1 && weekday <= 5) return day
  }

  return start
}

/** Every peak window from yesterday to +8 days, oldest first. */
export function peakWindows(nowMs) {
  const windows = []

  for (let offset = -1; offset <= 8; offset++) {
    const dayStart = utcDayStart(nowMs + offset * DAY_MS)
    const weekday = new Date(dayStart).getUTCDay()

    if (weekday === 0 || weekday === 6) continue

    for (const [start, end] of PEAK_WINDOWS_UTC) {
      windows.push({ start: dayStart + start * MIN_MS, end: dayStart + end * MIN_MS })
    }
  }

  return windows.sort((a, b) => a.start - b.start)
}

/**
 * Tariff state at an instant. `changesAt` is the next boundary: while peak it
 * is the moment the discount returns, otherwise the moment peak begins.
 */
export function tariffAt(nowMs) {
  const windows = peakWindows(nowMs)
  const current = windows.find(w => nowMs >= w.start && nowMs < w.end)

  if (current) {
    return { peak: true, startedAt: current.start, changesAt: current.end, windows }
  }

  const next = windows.find(w => w.start > nowMs)

  return { peak: false, startedAt: null, changesAt: next ? next.start : null, windows }
}

/** The timezone of the machine running the app. */
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** "GMT+3" / "UTC" — how the zone reads next to a clock. */
export function zoneShortName(ms, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      hourCycle: 'h23'
    }).formatToParts(new Date(ms))
    const name = (parts.find(part => part.type === 'timeZoneName') || {}).value

    return name || timeZone
  } catch {
    return timeZone
  }
}

/** Wall-clock reading of an instant in a timezone (locale-independent). */
export function tzClock(ms, timeZone) {
  try {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(ms))
    const dateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(ms))
    const [year, month, day] = dateKey.split('-').map(Number)
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

    return {
      time,
      dateKey,
      weekday,
      month,
      day,
      stamp: `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`
    }
  } catch {
    const d = new Date(ms)
    const weekday = d.getUTCDay()

    return {
      time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
      dateKey: d.toISOString().slice(0, 10),
      weekday,
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      stamp: `${WEEKDAYS[weekday]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
    }
  }
}

/**
 * The peak windows on a weekday, in the reader's own timezone:
 * "weekdays 04:00–07:00 and 09:00–13:00". A zone far enough from UTC that a
 * window lands on the previous day (e.g. New York) gets explicit day names
 * instead of the "weekdays" shorthand.
 */
export function localWindowsLabel(nowMs, timeZone) {
  const anchor = nextWeekdayUtcMidnight(nowMs)
  const anchorKey = tzClock(anchor, timeZone).dateKey
  const windows = PEAK_WINDOWS_UTC.map(([start, end]) => ({
    start: anchor + start * MIN_MS,
    end: anchor + end * MIN_MS
  }))
  const sameDay = windows.every(w => tzClock(w.start, timeZone).dateKey === anchorKey)
  const ranges = windows.map(w => `${tzClock(w.start, timeZone).time}–${tzClock(w.end, timeZone).time}`)

  if (sameDay) return `weekdays ${ranges.join(' and ')}`

  return windows.map((w, index) => `${tzClock(w.start, timeZone).stamp.split(' ')[0]} ${ranges[index]}`).join(', ')
}

/** "3 h 32 min" / "32 min" / "2 h". */
export function humanDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / MIN_MS))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes} min`
  if (!minutes) return `${hours} h`

  return `${hours} h ${minutes} min`
}

/** "3 h 32 min 16 s" — the live countdown shown in the detail panel. */
export function preciseDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []

  if (hours) parts.push(`${hours} h`)
  if (hours || minutes) parts.push(`${minutes} min`)
  parts.push(`${seconds} s`)

  return parts.join(' ')
}

/** "3:32" / "32m" — the chip's compact countdown. */
export function shortDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / MIN_MS))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes}m`

  return `${hours}:${String(minutes).padStart(2, '0')}`
}

function utcScheduleNote() {
  const ranges = PEAK_WINDOWS_UTC.map(([start, end]) => `${minutesToClock(start)}–${minutesToClock(end)}`)

  return `weekdays ${ranges.join(' and ')} UTC, weekends off-peak`
}

function minutesToClock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function summary(nowMs, timeZone) {
  const state = tariffAt(nowMs)
  const clock = tzClock(nowMs, timeZone)
  const suffix = `(${clock.time} ${zoneShortName(nowMs, timeZone)})`

  if (!state.changesAt) return `DeepSeek: tariff window not found ${suffix}`
  if (state.peak) {
    return `🔴 DeepSeek: peak right now (×2). Off-peak in ${humanDuration(state.changesAt - nowMs)} ${suffix}`
  }

  return `🟢 DeepSeek: off-peak right now (−50%). Peak in ${humanDuration(state.changesAt - nowMs)} ${suffix}`
}

/* --------------------------------------------------------------- widgets */

function useNowMs() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)

    return () => clearInterval(timer)
  }, [])

  return now
}

function DetailRow({ children, muted = false }) {
  return jsx('div', {
    className: muted ? 'text-(--ui-text-quaternary)' : 'text-(--ui-text-tertiary)',
    children
  })
}

function PeakChip() {
  const now = useNowMs()
  const timeZone = deviceTimeZone()
  const state = tariffAt(now)
  const clock = tzClock(now, timeZone)
  const countdown = state.changesAt ? shortDuration(state.changesAt - now) : '—'
  const label = state.peak ? `🔴 peak · ${countdown}` : `🟢 off-peak · ${countdown}`
  const headline = state.peak ? '🔴 Peak now (price ×2)' : '🟢 Off-peak now (−50%)'
  const boundary = state.changesAt
    ? state.peak
      ? `Off-peak at ${tzClock(state.changesAt, timeZone).time} — in ${preciseDuration(state.changesAt - now)}`
      : `Peak at ${tzClock(state.changesAt, timeZone).time} — in ${preciseDuration(state.changesAt - now)}`
    : 'No upcoming peak window found'
  const schedule = `Peak: ${localWindowsLabel(now, timeZone)} (your time)`

  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsx(Button, {
          'aria-label': state.peak ? 'DeepSeek: peak right now' : 'DeepSeek: off-peak right now',
          className: cn('gap-1 text-[0.6875rem]'),
          size: 'micro',
          title: `${summary(now, timeZone)} — peak ${utcScheduleNote()}`,
          variant: 'ghost',
          children: label
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: 'top',
        className: 'w-[17rem] p-3 text-xs',
        children: jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'font-medium', children: headline }),
            jsx(DetailRow, { children: `${clock.time} ${zoneShortName(now, timeZone)} · ${clock.stamp}` }),
            jsx(DetailRow, { children: boundary }),
            jsx(DetailRow, { muted: true, children: schedule })
          ]
        })
      })
    ]
  })
}

/* ---------------------------------------------------------------- plugin */

export default {
  id: ID,
  name: 'DeepSeek peak',
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 118,
      render: () => jsx(PeakChip, {})
    })

    ctx.register({
      id: 'status',
      area: PALETTE_AREA,
      data: {
        id: 'deepseek-peak.status',
        label: 'DeepSeek: peak or off-peak?',
        keywords: ['deepseek', 'peak', 'off-peak', 'tariff', 'price', 'countdown'],
        run: () => {
          haptic('tap')
          host.notify({ kind: 'info', message: summary(Date.now(), deviceTimeZone()) })
        }
      }
    })
  }
}
