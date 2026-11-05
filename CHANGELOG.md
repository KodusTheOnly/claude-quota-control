# Changelog

## 2.0.0

- New Overview: session and today tiles, a week bar, a verdict band that answers "can I use Claude until the reset?", a weekly chart with the plan line and a projection, and one footer cell per day.
- The weekly plan (Light, Normal, Heavy, Off) is now set on the Overview by clicking a day.
- The verdict follows the projection at the reset, on its own scale: below 80% of the limit is Free, 80 to 100% Moderate, up to 140% Tight, above that Pause. A week at 95% or more always reads Pause.
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
