# deepseek-peak — a peak / off-peak chip for the Hermes Desktop status bar

A [Hermes Desktop](https://hermes-agent.nousresearch.com/docs) disk plugin: the bottom
status bar gets a chip that answers one question at a glance — **is DeepSeek on its
peak tariff right now?**

```
🔴 peak · 3:32       → peak, double price, 3h32m left until off-peak returns
🟢 off-peak · 30m    → half price, peak starts in 30 minutes
```

The countdown is **live**: the chip reticks every second — the label changes once a
minute, and the detail panel counts the seconds down.

Click the chip for a compact panel — four lines, no tabs, no settings:

```
🔴 Peak now (price ×2)
09:27 GMT+3 · Mon 14 Sep
Off-peak at 13:00 — in 3 h 32 min 16 s
Peak: weekdays 04:00–07:00 and 09:00–13:00 (your time)
```

There is also a ⌘K command, **“DeepSeek: peak or off-peak?”**, which shows the same
status and countdown as a toast.

## Timezone: the device's own, automatically

Times are always rendered in the timezone of the machine running the app — the plugin
reads it from the OS, so there is nothing to pick and nothing to persist.

That is the correct behaviour, not a shortcut: the DeepSeek tariff is defined in UTC
(peak = weekdays 01:00–04:00 and 06:00–10:00 UTC), so peak / off-peak is a pure function
of UTC and is identical in every zone. The timezone only changes how the windows read —
in MSK (UTC+3) they show up as weekdays **04:00–07:00** and **09:00–13:00**, in Beijing as
09:00–12:00 and 14:00–18:00. A zone far enough from UTC that a window starts on the
previous day (New York: Sunday 21:00) gets explicit day names instead of the “weekdays”
shorthand, so the line never lies about which day it is.

## Install

### One-click (from this repository)

Open this link with Hermes Desktop running:

```
hermes://plugin/install?repo=antonbru/deepseek-peak&enable=1
```

The app shows a confirmation dialog, clones the repo and copies the plugin into its own
`desktop-plugins/` folder. Alternatively pass `antonbru/deepseek-peak` to the install
dialog by hand.

### Manual

Save `plugin.js` so that the folder name equals the plugin id:

```
~/.hermes/desktop-plugins/deepseek-peak/plugin.js                # macOS / Linux
%USERPROFILE%\.hermes\desktop-plugins\deepseek-peak\plugin.js    # Windows
```

The app watches that folder: the plugin loads a couple of seconds after the file lands
and hot-reloads on every later save. If it does not appear, run ⌘K → **Reload desktop
plugins**; a load failure is reported as a toast naming the reason.

Desktop plugins are **app-level** — they live on the machine running the app and serve
every gateway it connects to, including a remote one. A gateway's own
`~/.hermes/desktop-plugins/` is not visible to the app, so the file has to exist locally.

Enable or disable it in **Capabilities → Plugins** (enabled by default).

## Verify without the app

```bash
cd verify && node verify.mjs
```

The harness stands in for `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`
(`verify/node_modules/`), loads `../plugin.js` through the real ESM loader, and runs the
whole suite three times — once per timezone (`Europe/Moscow`, `UTC`, `America/New_York`) —
because the panel prints device-local times and `TZ` is the only way to vary the zone.
It asserts 184 facts in total: every peak-window boundary (both daily windows, the gap
between them, weekends, Friday → Monday), wall-clock reading and zone labelling, duration
formatting, contribution registration, the four-line panel with no switcher in it, the
live countdown ticking down second by second, local window labels (including the
day-shifted zone), and both palette-command messages.

## Tariff schedule

Source: api-docs.deepseek.com/quick_start/pricing (checked 10.09.2026). If the windows
change, edit `PEAK_WINDOWS_UTC` in `plugin.js` — minutes from UTC midnight, `[start, end)`.

## License

MIT — see `LICENSE`.
