/**
 * DeepSeek peak / off-peak status chip for the Hermes Desktop status bar.
 *
 * Answers one question at a glance: is DeepSeek on its peak tariff right now?
 *
 *   🔴 peak · 3:44       → peak, double price, 3h44m until off-peak returns
 *   🟢 off-peak · 30m    → half price, peak starts in 30 minutes
 *
 * The countdown is live: the chip reticks every second (its label changes once
 * a minute, the detail panel shows seconds counting down).
 *
 * Click the chip for the detail panel: wall-clock time in the selected
 * timezone, the live countdown to the next tariff switch, the upcoming peak
 * windows with real timestamps, the tariff schedule, and a timezone picker
 * (persisted per plugin).
 *
 * Tariff (api-docs.deepseek.com/quick_start/pricing, checked 10.09.2026):
 * peak = Mon–Fri 01:00–04:00 and 06:00–10:00 UTC; everything else — including
 * all weekend — is off-peak at half price. The state is therefore a pure
 * function of UTC; the timezone only changes how windows are *displayed*.
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
  SegmentedControl,
  atom,
  cn,
  haptic,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'deepseek-peak'
const STORAGE_TZ = 'timezone'
const DEFAULT_TZ = 'Europe/Moscow'
const SYSTEM_TZ = 'system'
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

const TZ_OPTIONS = [
  { id: 'Europe/Moscow', label: 'MSK' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Asia/Shanghai', label: 'Beijing' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'America/New_York', label: 'NY' },
  { id: SYSTEM_TZ, label: 'System' }
]

/** Selected timezone, restored from plugin storage on load. */
const $tz = atom(DEFAULT_TZ)

/* ------------------------------------------------------------------ logic */

function utcDayStart(ms) {
  const d = new Date(ms)

  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
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

/** "3 h 44 min" / "44 min" / "2 h". */
export function humanDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / MIN_MS))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes} min`
  if (!minutes) return `${hours} h`

  return `${hours} h ${minutes} min`
}

/** "3 h 44 min 12 s" — the live countdown shown in the detail panel. */
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

/** "3:44" / "44m" — the chip's compact countdown. */
export function shortDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / MIN_MS))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes}m`

  return `${hours}:${String(minutes).padStart(2, '0')}`
}

function resolveTimeZone(value) {
  if (value && value !== SYSTEM_TZ) return value

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function tzLabel(value) {
  const option = TZ_OPTIONS.find(o => o.id === value)

  return option && option.id !== SYSTEM_TZ ? option.label : resolveTimeZone(value)
}

function dayLabel(ms, timeZone, nowMs) {
  const target = tzClock(ms, timeZone)
  const today = tzClock(nowMs, timeZone)
  const tomorrow = tzClock(nowMs + DAY_MS, timeZone)

  if (target.dateKey === today.dateKey) return 'today'
  if (target.dateKey === tomorrow.dateKey) return 'tomorrow'

  return target.stamp
}

function windowLine(window, timeZone, nowMs) {
  const start = tzClock(window.start, timeZone)
  const end = tzClock(window.end, timeZone)
  const label = `${dayLabel(window.start, timeZone, nowMs)} ${start.time}–${end.time}`
  const running = nowMs >= window.start && nowMs < window.end

  return running ? `${label} — running now` : label
}

function summary(nowMs, tzValue) {
  const timeZone = resolveTimeZone(tzValue)
  const state = tariffAt(nowMs)
  const clock = tzClock(nowMs, timeZone)
  const suffix = `(${clock.time} ${tzLabel(tzValue)})`

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
  const tzValue = useValue($tz)
  const timeZone = resolveTimeZone(tzValue)
  const state = tariffAt(now)
  const clock = tzClock(now, timeZone)
  const countdown = state.changesAt ? shortDuration(state.changesAt - now) : '—'
  const label = state.peak ? `🔴 peak · ${countdown}` : `🟢 off-peak · ${countdown}`

  const headline = state.peak ? '🔴 Peak now (price ×2)' : '🟢 Off-peak now (−50%)'
  const boundary = state.changesAt
    ? state.peak
      ? `Off-peak at ${tzClock(state.changesAt, timeZone).time} ${tzLabel(tzValue)} — in ${preciseDuration(state.changesAt - now)}`
      : `Peak at ${tzClock(state.changesAt, timeZone).time} ${tzLabel(tzValue)} — in ${preciseDuration(state.changesAt - now)}`
    : 'No upcoming peak window found'
  const upcoming = state.windows.filter(w => w.end > now).slice(0, 3)
  const options = TZ_OPTIONS.map(o =>
    o.id === SYSTEM_TZ ? { ...o, label: `${o.label} (${resolveTimeZone(SYSTEM_TZ)})` } : o
  )

  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsx(Button, {
          'aria-label': state.peak ? 'DeepSeek: peak right now' : 'DeepSeek: off-peak right now',
          className: cn('gap-1 text-[0.6875rem]'),
          size: 'micro',
          title: summary(now, tzValue),
          variant: 'ghost',
          children: label
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: 'top',
        className: 'w-[19rem] p-3 text-xs',
        children: jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsx('div', { className: 'font-medium', children: headline }),
            jsx(DetailRow, {
              children: `${clock.time} ${tzLabel(tzValue)} · ${clock.stamp}`
            }),
            jsx(DetailRow, { children: boundary }),
            jsxs('div', {
              className: 'flex flex-col gap-0.5',
              children: [
                jsx(DetailRow, { children: 'Upcoming peak windows:' }),
                ...upcoming.map(window =>
                  jsx(DetailRow, {
                    muted: true,
                    children: `• ${windowLine(window, timeZone, now)} (${tzLabel(tzValue)})`
                  })
                )
              ]
            }),
            jsx(DetailRow, {
              muted: true,
              children: 'DeepSeek peak: weekdays 01:00–04:00 and 06:00–10:00 UTC. All weekend is off-peak.'
            }),
            jsxs('div', {
              className: 'flex flex-col gap-1',
              children: [
                jsx(DetailRow, { children: 'Timezone' }),
                jsx(SegmentedControl, {
                  onChange: id => {
                    haptic('tap')
                    $tz.set(id)
                  },
                  options,
                  value: tzValue
                })
              ]
            })
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
    $tz.set(ctx.storage.get(STORAGE_TZ, DEFAULT_TZ))

    $tz.listen(value => ctx.storage.set(STORAGE_TZ, value))

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
          host.notify({ kind: 'info', message: summary(Date.now(), $tz.get()) })
        }
      }
    })
  }
}
