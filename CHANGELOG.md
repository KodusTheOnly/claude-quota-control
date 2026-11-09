# Changelog

## Unreleased

- The weekly goal is gone: the plan always aims at 100% at the reset. A goal under 100% only left quota unused at the reset. The emergency reserve stays, and is the way to keep a cushion: it is released before the reset, so it does not go to waste. The section in Settings is now called Reserve, and a goal saved by an older version is ignored.
- The verdict, the hours locked out and "slow down" now count to 100%, where Claude stops (they counted to 97%). The chart's line at the top has no label of its own, since the scale already says 100%.
- The Overview screens now sit in wells of the panel, with a narrow gutter, so the light or dark theme shows around the data. The verdict band is split into two screens, in line with Session and Today.
- The light theme now prints the data on paper screens (light, like a console printout), with darker inks so each level stays readable. Settings > Screens can switch it back to CRT. The dark theme, the taskbar strip and the tray icon are always CRT.
- A new install opens in the dark theme (it was the system theme).
- In a narrow window, Session and Today show only the level's shape: its name ran into the number.
- The chart and the hours now run to the reset, not to the seventh midnight, so the week's last hours are drawn.
- The chart shows the room left before the reset as a box from now to the reset, up to 100%. Up to where the projection ends it is faint; above it, stronger, with the same number as "to spend". When the pace reaches 100% it stays faint, with no number. The week bar outlines the same room.
- The hours on the HRS strip and each day's piece of the chart's used line take the color of that day's level, as the day's card.
- The projection ends in a dot.
- On the last day, when the pace ends well under 100%, the week turns to the accent color (Room) instead of green: the risk then is leaving quota unused.
- Today's bar hatches the part of the budget carried over from earlier days, after the plan's own share of the day.

## 2.0.0

- New Overview: session and today tiles, a week bar, a verdict band that answers "can I use Claude until the reset?", a weekly chart with the plan line and a projection, and one footer cell per day.
- The weekly plan (Light, Normal, Heavy, Off) is now set on the Overview by clicking a day.
- The verdict follows the projection, on its own scale: the hours you would be without Claude before the reset if your pace holds, counting up to your goal (97% by default). 0 h is Free, up to 5 h (one session) Moderate, up to 24 h Tight, above that Pause. A week at 95% or more always reads Pause.
- Levels are rated on the number as shown, so a value and its level never disagree.
- Math drawer with every rule and your own numbers, and a Help screen with a "How we calculate" section.
- Hourly strip (HRS) above the days, with optional use of local Claude Code logs (timestamps and token counts only).
- Reading now uses the usage data the page itself receives instead of the page text, with a strict format check. If the format changes, the app says so and asks you to type the numbers in. The page text is still used for Extra usage.
- Each reading has a hard time limit and writes a step log without numbers, for diagnosis.
- Optional 5 minute timer in Settings > Advanced, off by default, with a warning about Claude's Consumer Terms.
- Extra usage moved to a slim strip under the Overview.
- The taskbar strip shows how much of today's budget is left.
- Light, dark or system theme, and an optional global shortcut to refresh.
- The settings file is restored from its previous copy if it gets damaged.
- New fonts: IBM Plex Sans and IBM Plex Mono.
- Layout tests for every screen at many window sizes, in both languages and themes.
- Design tokens for type, corners and chart colors; errors now show in a strip that pushes the content down; clearer wording in Today, the verdict and the day cards.

## 1.1.0

- Status card with a gauge, and a progress-ring tray icon.
- Weekly plan: a weight per weekday changes how the week is split into daily budgets.
- Session start chart in History, heavy session alert, export and import of your data.
- Optional small status strip with a usage ring. It can be dragged anywhere, remembers its place, and has a refresh button and a button that opens the card.
- Smart reminders, reset notifications with a summary of the week that ended, previous weeks panel.
- The weekly forecast now counts pace per weighted day of your plan and waits for more data.
- "You can spend" is now "Per day from now", with a note on how it differs from today's budget.
- Extra usage card with credits and the monthly spend limit, plus an optional alert at 80% and 100%.
- Claude's own "you will run out before the reset" notice is shown in the status card and raises the status to at least Moderate.
- A master switch for notifications, and a clear message when there is no internet connection.
- English by default, Brazilian Portuguese in Settings.
- Fixed reading reset times written as "2 hr 46 min", where the minutes were dropped.

## 1.0.0

- First version: session and weekly usage, daily budget, history, tray card and notifications.
