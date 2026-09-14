/**
 * Offline verification of the deepseek-peak desktop plugin.
 *
 * Loads the plugin through the real ESM loader with stand-ins for
 * `@hermes/plugin-sdk` / `react` / `react/jsx-runtime` (node_modules here), so
 * import errors, missing identifiers and logic bugs surface without the app.
 */
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { notifications } from '@hermes/plugin-sdk'
import { renderComponent } from 'react'

// The plugin imports bare specifiers, so it must be loaded from a directory
// that resolves them — copy it beside the stubs in node_modules/ first.
const here = dirname(fileURLToPath(import.meta.url))

copyFileSync(join(here, '..', 'plugin.js'), join(here, 'plugin.js'))

const { default: plugin, humanDuration, shortDuration, tariffAt, tzClock } = await import('./plugin.js')

let failures = 0
let checks = 0

function check(name, actual, expected) {
  checks++
  const ok = JSON.stringify(actual) === JSON.stringify(expected)

  if (!ok) {
    failures++
    console.log(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

function checkMatch(name, haystack, needle) {
  checks++
  const ok = typeof haystack === 'string' && haystack.includes(needle)

  if (!ok) {
    failures++
    console.log(`FAIL ${name}\n  "${needle}" not found in: ${JSON.stringify(haystack).slice(0, 400)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

/* ------------------------------------------------------------- tariff math */

const NOON = Date.parse('2026-09-14T06:08:00Z')

const CASES = [
  ['2026-09-14T00:30:00Z', false, '2026-09-14T01:00:00Z', 'Mon before peak'],
  ['2026-09-14T01:00:00Z', true, '2026-09-14T04:00:00Z', 'Mon peak 1 starts'],
  ['2026-09-14T03:59:59Z', true, '2026-09-14T04:00:00Z', 'Mon peak 1 ends'],
  ['2026-09-14T04:00:00Z', false, '2026-09-14T06:00:00Z', 'Mon gap'],
  ['2026-09-14T05:59:59Z', false, '2026-09-14T06:00:00Z', 'Mon gap ends'],
  ['2026-09-14T06:00:00Z', true, '2026-09-14T10:00:00Z', 'Mon peak 2 starts'],
  ['2026-09-14T09:59:59Z', true, '2026-09-14T10:00:00Z', 'Mon peak 2 ends'],
  ['2026-09-14T10:00:00Z', false, '2026-09-15T01:00:00Z', 'Mon off-peak afternoon'],
  ['2026-09-14T13:30:00Z', false, '2026-09-15T01:00:00Z', 'Mon 16:30 MSK off-peak'],
  ['2026-09-18T09:00:00Z', true, '2026-09-18T10:00:00Z', 'Fri peak'],
  ['2026-09-19T02:00:00Z', false, '2026-09-21T01:00:00Z', 'Sat all off-peak'],
  ['2026-09-20T23:00:00Z', false, '2026-09-21T01:00:00Z', 'Sun night off-peak'],
  ['2026-09-21T01:00:00Z', true, '2026-09-21T04:00:00Z', 'Mon peak again']
]

for (const [iso, peak, changeIso, label] of CASES) {
  const state = tariffAt(Date.parse(iso))

  check(`tariff ${label}: peak`, state.peak, peak)
  check(`tariff ${label}: next boundary`, state.changesAt, Date.parse(changeIso))
}

/* -------------------------------------------------------- timezone reading */

check('tzClock MSK time', tzClock(NOON, 'Europe/Moscow').time, '09:08')
check('tzClock MSK weekday', tzClock(NOON, 'Europe/Moscow').weekday, 1)
check('tzClock MSK stamp', tzClock(NOON, 'Europe/Moscow').stamp, '14.09')
check('tzClock UTC time', tzClock(NOON, 'UTC').time, '06:08')
check('tzClock Beijing time', tzClock(NOON, 'Asia/Shanghai').time, '14:08')

check('humanDuration 3h51m', humanDuration(3 * 3_600_000 + 51 * 60_000), '3 ч 51 мин')
check('humanDuration 1h', humanDuration(3_600_000), '1 ч')
check('humanDuration 51m', humanDuration(51 * 60_000), '51 мин')
check('shortDuration 3h51m', shortDuration(3 * 3_600_000 + 51 * 60_000), '3:51')
check('shortDuration 30m', shortDuration(30 * 60_000), '30м')

/* ------------------------------------------------------------ plugin wiring */

const contributions = []
const storage = new Map()
const ctx = {
  source: 'plugin:deepseek-peak',
  register: contribution => {
    contributions.push(contribution)

    return () => {}
  },
  registerMany: list => {
    contributions.push(...list)

    return () => {}
  },
  storage: {
    get: (key, fallback) => (storage.has(key) ? storage.get(key) : fallback),
    set: (key, value) => storage.set(key, value),
    remove: key => storage.delete(key)
  },
  i18n: { register: () => {}, t: key => key },
  onDispose: () => {},
  rest: async () => ({}),
  socket: () => () => {},
  os: {}
}

plugin.register(ctx)

check('plugin id', plugin.id, 'deepseek-peak')
check('contributions', contributions.map(c => c.id).sort(), ['chip', 'status'])
check('chip area', contributions.find(c => c.id === 'chip').area, 'statusBar.right')

/* ------------------------------------------------------------- rendering */

const realNow = Date.now

function collectStrings(node, out = []) {
  if (typeof node === 'string') {
    out.push(node)

    return out
  }

  if (!node || typeof node !== 'object') return out

  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out)

    return out
  }

  collectStrings(node.props && node.props.children, out)

  return out
}

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findElement(item, predicate)

      if (hit) return hit
    }

    return null
  }
  if (predicate(node)) return node

  return findElement(node.props && node.props.children, predicate)
}

function renderChip(ms) {
  Date.now = () => ms
  const chip = contributions.find(c => c.id === 'chip')
  const element = chip.render()
  const rendered = renderComponent(element.type, element.props)

  return { element: rendered, text: collectStrings(rendered).join(' | ') }
}

const peakView = renderChip(NOON)
checkMatch('chip shows peak', peakView.text, '🔴 пик · 3:52')
checkMatch('popover headline', peakView.text, 'Сейчас пик (цена ×2)')
checkMatch('popover clock in MSK', peakView.text, '09:08 МСК')
checkMatch('popover current window', peakView.text, 'сегодня 09:00–13:00')
checkMatch('popover window running marker', peakView.text, 'идёт')
checkMatch('popover schedule note', peakView.text, '01:00–04:00 и 06:00–10:00 UTC')

const offPeakView = renderChip(Date.parse('2026-09-14T00:30:00Z'))
checkMatch('chip shows off-peak + countdown', offPeakView.text, '🟢 офф-пик · 30м')
checkMatch('popover next peak line', offPeakView.text, 'Пик в 04:00 МСК')
checkMatch('popover upcoming window', offPeakView.text, 'сегодня 04:00–07:00')

const weekendView = renderChip(Date.parse('2026-09-19T12:00:00Z'))
checkMatch('weekend off-peak', weekendView.text, '🟢 офф-пик')
checkMatch('weekend next peak is Monday', weekendView.text, 'пн 21.09 04:00–07:00')

/* -------------------------------------------------------- timezone picker */

const segment = findElement(peakView.element, node => node.type && node.type.name === 'SegmentedControl')

check('segmented control rendered', Boolean(segment), true)
check('segmented options', segment.props.options.map(o => o.id).includes('Europe/Moscow'), true)

segment.props.onChange('UTC')

const utcView = renderChip(NOON)

checkMatch('chip follows selected timezone', utcView.text, '06:08 UTC')
checkMatch('windows re-render in UTC', utcView.text, 'сегодня 06:00–10:00')
check('timezone persisted to storage', storage.get('timezone'), 'UTC')

/* ----------------------------------------------------------- palette run */

notifications.length = 0
contributions.find(c => c.id === 'status').data.run()
check('palette command notifies once', notifications.length, 1)
checkMatch('palette message mentions peak', notifications[0].message, 'сейчас пик')
checkMatch('palette message has MSK clock', notifications[0].message, '(06:08 UTC)')

Date.now = realNow

console.log(`\n${checks - failures}/${checks} checks passed`)

process.exit(failures ? 1 : 0)
