# deepseek-peak — a peak / off-peak chip for the Hermes Desktop status bar

A [Hermes Desktop](https://hermes-agent.nousresearch.com/docs) disk plugin: the bottom
status bar gets a chip that answers one question at a glance — **is DeepSeek on its
peak tariff right now?**

```
🔴 peak · 3:44       → peak, double price, 3h44m left until off-peak returns
🟢 off-peak · 30m    → half price, peak starts in 30 minutes
```

The countdown is **live**: the chip reticks every second (the label changes once a
minute, the detail panel counts seconds down).

Click the chip for the detail panel:

- wall-clock time in the selected timezone (default **MSK**), weekday and date;
- the live countdown to the next tariff switch, with the exact switch time;
- the upcoming peak windows with real timestamps in the selected timezone;
- a timezone picker — MSK / UTC / Beijing / Berlin / NY / System — persisted per plugin
  across restarts;
- the schedule reminder: peak is weekdays 01:00–04:00 and 06:00–10:00 UTC, all weekend
  is off-peak.

There is also a ⌘K command, **“DeepSeek: peak or off-peak?”**, which shows the current
status and countdown as a toast.

## Timezone: what it does and does not change

Peak / off-peak is a pure function of UTC (`Mon–Fri 01:00–04:00` and `06:00–10:00 UTC`),
so the picker **changes the display only** — never the tariff. In MSK (UTC+3) peak falls
on weekdays **04:00–07:00** and **09:00–13:00 MSK**.

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
~/.hermes/desktop-plugins/deepseek-peak/plugin.js          # macOS / Linux
%USERPROFILE%\.hermes\desktop-plugins\deepseek-peak\plugin.js   # Windows
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
(`verify/node_modules/`), loads `../plugin.js` through the real ESM loader and asserts
65 facts: peak-window boundaries (weekends, Friday → Monday, both daily windows), time
reading in several zones, duration formatting, contribution registration, the chip
renders, the live countdown ticking down, the timezone switch persisting to storage, and
the palette command.

## Tariff schedule

Source: api-docs.deepseek.com/quick_start/pricing (checked 10.09.2026). If the windows
change, edit `PEAK_WINDOWS_UTC` in `plugin.js` — minutes from UTC midnight, `[start, end)`.

## License

MIT — see `LICENSE`.
