/**
 * Offline verification of the deepseek-peak desktop plugin.
 *
 * Loads the plugin through the real ESM loader with stand-ins for
 * `@hermes/plugin-sdk` / `react` / `react/jsx-runtime` (node_modules here), so
 * import errors, missing identifiers and logic bugs surface without the app.
 *
 * The suite runs itself once per timezone (Europe/Moscow, UTC, America/New_York)
 * because the panel prints device-local times: `TZ` is the only way to make the
 * plugin resolve a different zone.
 *
 * Run: node verify.mjs   (from this directory)
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { notifications } from '@hermes/plugin-sdk'
import { renderComponent } from 'react'

const self = fileURLToPath(import.meta.url)
const here = dirname(self)

/* ------------------------------------------------------------ zone runner */

const ZONES = ['Europe/Moscow', 'UTC', 'America/New_York']

if (!process.env.VERIFY_CHILD) {
  let failed = 0

  for (const zone of ZONES) {
    console.log(`\n=== TZ=${zone} ===`)
    const result = spawnSync(process.execPath, [self], {
      env: { ...process.env, TZ: zone, VERIFY_CHILD: '1' },
      stdio: 'inherit'
    })

    if (result.status !== 0) failed++
  }

  console.log(
    failed ? `\n❌ ${failed}/${ZONES.length} timezone suites failed` : `\n✅ all ${ZONES.length} timezone suites passed`
  )

  process.exit(failed ? 1 : 0)
}

// The plugin imports bare specifiers, so it must be loaded from a directory
// that resolves them — copy it beside the stubs in node_modules/ first.
copyFileSync(join(here, '..', 'plugin.js'), join(here, 'plugin.js'))

const {
  default: plugin,
  deviceTimeZone,
  humanDuration,
  localWindowsLabel,
  preciseDuration,
  shortDuration,
  tariffAt,
  tzClock,
  zoneShortName
} = await import('./plugin.js')

let failures = 0
let checks = 0
const zone = deviceTimeZone()

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

function checkRegex(name, value, pattern) {
  checks++
  const ok = typeof value === 'string' && pattern.test(value)

  if (!ok) {
    failures++
    console.log(`FAIL ${name}\n  ${pattern} does not match: ${JSON.stringify(value).slice(0, 200)}`)
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

/* ---------------------------------------------------------- zone reading */

check('device zone comes from the environment', zone, process.env.TZ)
check('tzClock reads a wall clock', tzClock(NOON, zone).time, new Date(NOON).toLocaleTimeString('en-GB', { timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit' }))
checkRegex('zoneShortName looks like a zone label', zoneShortName(NOON, zone), /^(UTC|GMT[+-]\d{1,2})/)

/* ------------------------------------------------------------- formatting */

check('humanDuration 3h51m', humanDuration(3 * 3_600_000 + 51 * 60_000), '3 h 51 min')
check('humanDuration 1h', humanDuration(3_600_000), '1 h')
check('humanDuration 51m', humanDuration(51 * 60_000), '51 min')
check('preciseDuration 3h51m12s', preciseDuration(3 * 3_600_000 + 51 * 60_000 + 12_000), '3 h 51 min 12 s')
check('preciseDuration 1m30s', preciseDuration(90_000), '1 min 30 s')
check('preciseDuration 45s', preciseDuration(45_000), '45 s')
check('shortDuration 3h51m', shortDuration(3 * 3_600_000 + 51 * 60_000), '3:51')
check('shortDuration 30m', shortDuration(30 * 60_000), '30m')

/* ------------------------------------------------------------ plugin wiring */

const contributions = []
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
  storage: { get: (key, fallback) => fallback, set: () => {}, remove: () => {} },
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
const realSetInterval = globalThis.setInterval

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

const intervals = []

globalThis.setInterval = (fn, delay) => {
  intervals.push(delay)

  return 0
}
globalThis.clearInterval = () => {}

function renderChip(ms) {
  Date.now = () => ms
  const chip = contributions.find(c => c.id === 'chip')
  const element = chip.render()
  const rendered = renderComponent(element.type, element.props)
  const texts = collectStrings(rendered)

  return { element: rendered, texts, text: texts.join(' | ') }
}

const peakView = renderChip(NOON)

check('chip reticks every second', intervals, [1000])
checkMatch('chip shows peak + countdown', peakView.text, '🔴 peak · 3:52')
checkMatch('panel headline', peakView.text, 'Peak now (price ×2)')
checkRegex('panel clock line', peakView.text, /(\d{2}:\d{2}) (UTC|GMT[+-]\d{1,2}) · Mon 14 Sep/)
checkMatch('panel countdown to off-peak', peakView.text, '— in 3 h 52 min 0 s')
checkMatch('panel schedule in local time', peakView.text, '(your time)')
check('panel is four lines, no tab strip', collectStrings(findElement(peakView.element, node => node.type && node.type.name === 'PopoverContent').props.children).length, 4)
check(
  'panel has no timezone switcher',
  findElement(peakView.element, node => node.type && node.type.name === 'SegmentedControl'),
  null
)

const tickedView = renderChip(NOON + 6_000)

checkMatch('countdown ticks down with the clock', tickedView.text, '— in 3 h 51 min 54 s')

const offPeakView = renderChip(Date.parse('2026-09-14T00:30:00Z'))

checkMatch('chip shows off-peak + countdown', offPeakView.text, '🟢 off-peak · 30m')
checkMatch('panel points at the coming peak', offPeakView.text, 'Peak at ')
checkMatch('off-peak panel keeps the schedule line', offPeakView.text, '(your time)')

const weekendView = renderChip(Date.parse('2026-09-19T12:00:00Z'))

checkMatch('weekend is off-peak', weekendView.text, '🟢 off-peak')

const trigger = findElement(peakView.element, node => node.props && typeof node.props.title === 'string')

checkMatch('hover text keeps the UTC schedule', trigger.props.title, 'weekdays 01:00–04:00 and 06:00–10:00 UTC, weekends off-peak')

/* ------------------------------------------------- per-zone expectations */

const label = localWindowsLabel(NOON, zone)

if (zone === 'Europe/Moscow') {
  check('MSK local windows', label, 'weekdays 04:00–07:00 and 09:00–13:00')
  checkMatch('MSK clock line', peakView.text, '09:08 GMT+3 · Mon 14 Sep')
  checkMatch('MSK countdown', peakView.text, 'Off-peak at 13:00 — in 3 h 52 min 0 s')
  checkMatch('MSK off-peak panel names the local peak start', offPeakView.text, 'Peak at 04:00 — in 30 min 0 s')
} else if (zone === 'UTC') {
  check('UTC local windows', label, 'weekdays 01:00–04:00 and 06:00–10:00')
  checkMatch('UTC clock line', peakView.text, '06:08 UTC · Mon 14 Sep')
  checkMatch('UTC countdown', peakView.text, 'Off-peak at 10:00 — in 3 h 52 min 0 s')
} else {
  checkRegex('day-shifted zone gets explicit day names', label, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}:\d{2}–\d{2}:\d{2}, (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}:\d{2}–\d{2}:\d{2}$/)
  checkRegex('day-shifted clock line', peakView.text, /(\d{2}:\d{2}) GMT[+-]\d{1,2} · Mon 14 Sep/)
  check('day-shifted schedule is not called "weekdays"', label.startsWith('weekdays'), false)
}

/* ----------------------------------------------------------- palette run */

notifications.length = 0
Date.now = () => NOON
contributions.find(c => c.id === 'status').data.run()

check('palette command notifies once', notifications.length, 1)
checkRegex('palette message reports peak', notifications[0].message, /^🔴 DeepSeek: peak right now \(×2\)\. Off-peak in \d/)
checkRegex('palette message carries the clock', notifications[0].message, /\(\d{2}:\d{2} (UTC|GMT[+-]\d{1,2})\)$/)

Date.now = () => Date.parse('2026-09-19T12:00:00Z')
contributions.find(c => c.id === 'status').data.run()

checkRegex('palette message reports off-peak on a weekend', notifications[1].message, /^🟢 DeepSeek: off-peak right now \(−50%\)\. Peak in \d/)

Date.now = realNow
globalThis.setInterval = realSetInterval

console.log(`\n${zone}: ${checks - failures}/${checks} checks passed`)

process.exit(failures ? 1 : 0)
