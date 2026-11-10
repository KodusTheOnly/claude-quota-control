# Changelog

## 2.2.0

- Active hours (Settings > Plan, off by default): the hours you usually use Claude, as a window such as 09:00 to 01:00. The plan only moves inside them, so the expected line, the pace, the projection and the hours locked out stop treating a night of sleep as falling behind. A whole day keeps its share of the week; only the partial days at the reset change. Hours after midnight count for that calendar day. Use outside the window still counts. The chart shades the hours outside the window, a thin bar under the HRS strip marks the window on every day (with "active hours" in the legend), and the Claude Code collector follows the same rule.
- Fixed: when the last hours before the reset fall outside the active hours (a window of 09:00 to 23:00 and a reset at 08:00), today had a budget of 0, so any use after midnight showed as 200% and Pause. Today now gets everything left of the week, the reserve included, since it is lost at the reset. The collector follows the same rule.
- The Reserve section in Settings is now Plan, with Active hours and Reserve.
- The verdict is the headline of the Overview: its answer is as big as the Session and Today numbers (a step smaller when its screen is narrow).
- The chart dims the time after now. The room box is gone: what there is to spend is a bracket at the reset, from where the projection ends to the plan's ceiling, with "~N% to spend" (only the number in a narrow chart). When the projection stays within 2 points of the plan, the expected line stops at now and the projection carries on alone, named "projection ≈ expected". When the chart is too tight for them, the names of the lines and the "to spend" number are left out instead of sitting on a line; "now" always stays.
- The days ahead show their budget and where the week should stand at their end ("→ 64%"), with no % and no empty bar, and only the day of the month as the date.
- The selected key (tabs, History ranges, Settings contents, the plan menu) is lit: pressed in, with an ink face, instead of a dark key with a small square.
- Fewer outlines: the verdict's chips and the plates on the tray card sit on a tint, today's column has a tint and no frame, and the lines between the days match the chart's day lines. The warning chip keeps its outline.
- A new reading slides the bars to their new values and makes a changed number glow for a moment (none with reduced motion).
- On paper screens the tray card writes the level's name in ink; the shape and the bars keep the level's color.
- The verdict's face has a small screen of its own, left of the answer, bigger and with a phosphor glow (none on paper). Each part of it means one thing: the eyes say how much you can relax, the mouth the tension, a side mark the extra (; sweat, ! alarm), and arms only show in good moments. The faces are new: Room `^.~`, Free `^.^`, Moderate `o.o`, Tight `o_o;`, Pause `O_O!`, Limit reached `T_T` (it had Pause's face), Warming up `'.'` and Reserve `O_o` (Room and Reserve never moved before).
- The face lives: it blinks and acts at random times, faster when the pace is fast and calmer when it is slow, turns its head toward the pointer and reacts to a click. Moderate and Tight glance at the chart, and today's point there pings.
- It shows what the app is doing, in the muted color: its eyes run along the page during a reading, `x.x` after a failed one and `?.?` when Claude asks to sign in again (both until a reading works), and it sleeps outside the active hours, but only from Moderate down: from Tight on it stays awake.
- It reacts: a start when the level gets worse, a smile when it gets better, relief (still sweating) when it comes back from Tight or Pause, a start and a glance at the chart when a reading jumps 5 points or more, a nod when a reading brings nothing new, a wave the first time the Overview shows each day, and a cheer for a new week. Nothing moves while the window is hidden, on another screen or with reduced motion.

## 2.1.0

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
