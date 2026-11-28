# Changelog

## Unreleased

- The projection learns from your past weeks (up to 8, as the history keeps them). Your usual pace stands in for the days this week has not shown yet, so there is a projection from the first day instead of after a day and a half, and each day of the week counts as heavy as you usually make it: a day you always use a lot no longer reads as a spike, and heavy days still to come are counted before they arrive. A day you plan as Off stays out. With no past week on record everything works as before.
- A likely range instead of one number: "at reset 84-97%" in the verdict, a faint fan on the chart and a row in the Math drawer. About 8 weeks in 10 end inside it. It starts wide, narrows as the week goes on, and narrows more when your weeks are alike. When the pace reaches the limit but the range still starts under it, a chip says the week may still fit.
- The plan menu suggests a plan from how you really used your last weeks (after three on record): for example "Mon Heavy, Sat Light, Sun Off", with one key to accept it. Nothing changes until you do, and every day can still be set by hand.
- Follow my usual week (Settings > Plan, off by default): the plan takes the suggested weights by itself and updates when a week ends. Setting a day by hand turns it off.
- The Math drawer shows this week's pace, your usual pace and the mix the projection uses.
- When today goes past its budget, the days ahead show the smaller budget that leaves them, with how much each one lost ("▲12% ▼2"), and "week at" follows. The Math drawer says how much today took from them.
- Fixed: when Claude gives part of the week back without a reset (as with the reset that came with a new model), the week's % went down but today kept counting from the higher number: a budget of 2% and today at 550%, and the chart slid from 100% down to the new number. Today now counts from the lower number, and the chart falls straight down where it happened. The collector follows.
- Fixed: after a reset that falls past the end of the active hours (a window of 09:00 to 18:00 and a reset at 20:00), the rest of that day had a budget of 0 and any use read as 200% and Pause. Those hours are now not rated, like a day off.
- Fixed: the reserve's release ran on the clock, so the part of it that fell on a day off was lost (a reset on Monday morning with the weekend Off lost most of it). It now follows the plan: heavier days in the release get more, days off and the hours outside the active hours none, and when the release hours are all off it joins the last planned day. The collector follows.
- Fixed: on the two days a year the clock changes, the day weighed 23/24 or 25/24 of its weight. A day now always weighs its whole weight. The collector follows.
- Fixed: the Claude Code collector ignored the emergency reserve, so its budget for the day (and the status line) was higher than the app's. It now uses the same rule.
- Fixed: a reset time that cannot be real (from a damaged or hand-edited file) could freeze the window. Such a reading is ignored, an import drops it, and a reset more than a week ahead is read as the same weekly cycle.
- Readings: the app no longer waits for the usage page to finish loading before looking at its data, so a slow page does not end in a failed reading. A page that is stuck cannot hold a reading that already has its numbers. When the page asks for its data twice, a later failed answer no longer hides the good one. An answer the browser could not hand over reads as a failed reading, not as "Claude changed its format". The reading and login windows are always closed, even when the page refuses to close.
- Asking for a visible reading (to pass a check) while a hidden one is running now waits for it and opens the window, instead of returning the hidden one's failure. A Refresh asked while the app was reading on its own shows its result.
- Security: the main process only answers the app's own three windows. Claude's pages get a short list of permissions instead of everything but a list, and cannot start downloads. An import refuses files over 20 MB and times that cannot be real. The CSV export writes only dates and numbers. The update check only accepts a plain x.y.z version and builds the release link itself. Windows tools are started by their full path.
- The main window goes from 1040x520 to 1920x1080, so it also fits a 1080p screen turned on its side. The vertical and narrow formats are gone, and with them the blocks that only showed there (Today by hour, the past weeks in a block of their own) and the contents keys of Settings and Help. The past weeks stay in the chart. Under 1280px, Type it in and Math are in the "..." menu, so the header keeps the time of the reading and the full "Connect Claude account".
- A short window gives the chart more height: the status card keeps the face next to the answer (a smaller face before it stacks) with the level ruler under them, today and the pace share one line (the pace now also says slow, on pace or fast), and the session fits on one line. Today's card drops its "Today" tag, since its column is lit from the chart down, and its budget moves up next to its %. On a short chart the limit marks are smaller and the no-reading dots lighter.
- The session and week bars show what the last reading added: that stretch in a lighter tone with an edge, until the next reading, and a "+3%" box over it for 10 seconds after the reading and again when you point at it ("since 14:20"). Nothing shows after a reset or when the shown number did not change.
- On the week bar, what your pace will still use is a dashed line to a dot where the week ends, like the chart's projection, instead of a hatch. Past the limit the line runs out of the bar in red, with the time the limit comes.
- Automatic reading (Settings > Data > Danger zone, off by default): Off, every 1 to 60 minutes, or Smart (every 5 minutes while a session runs or the week is Tight or Pause, every 15 otherwise, every 60 outside the active hours). It is turned on with a warning and a hold, can keep to the active hours and pause while the PC is idle or locked. It waits a full interval after each reading, and while the 5-hour session is at its limit it waits for the reset and reads a minute after it (not when extra usage is left to spend). Refresh by hand always reads. The Advanced section is gone: the Claude Code logs moved to Sources.
- The header lamp shows the timer and its countdown, with a ring on Refresh, and opens a menu: read now, how often, pause, skip and the last readings.
- A reading and its notices no longer push the page: a reading lights the rule under the header, errors float under Refresh, go away by themselves and stay in the lamp, which says Failed until a reading works and shows the error in its menu. A reading that worked only blinks the lamp. Refresh shows the minute between readings on its base, and a click before it gets a bubble instead of an error.
- The verdict card has a level ruler, the face with the answer and its why, and rows with dotted leaders. While the week has no pace of its own yet, the verdict follows today's budget (Tight at most), and on the first day the expected line starts at the day's share instead of 0.
- Today is no longer its own tile: the week bar marks where the week can go today, with the use before today dimmer, and a line under it says how much is left.
- The session bar is colored by zones (green, yellow, orange, red), and its reset warning turns yellow from 30 minutes and red from 10, on the reset line and the time bar.
- Session lock: when the 5-hour session is at its limit, a lock chip shows on the reset line and a hatched lock on the bars. It waits 30 minutes before it shows and counts the pace from the session's start. On the chart, a padlock marks where the limit was hit (hollow when no reading came close before it), with a locked band to the reset and red hours; with extra usage on it is amber and has no band.
- While the session is at its limit, the projection, the likely range, the week's lockout and its level count the days left from the session's reset, since nothing is spent until then. The chart shows that wait as red dots.
- Stretches with no reading: a gap long enough to hold a session nobody saw spreads its rise over the active hours, at half the weight of the sessions the readings saw, instead of being left out. The chart shows such a stretch as dots, a ruler and a bar per hour, and the HRS strip shows static on the hours with none of it.
- The bars refill from zero only after 30 minutes without a reading; otherwise only the added part lights up.
- A reminder to read when Claude Code was used and there is no reading for 2 hours: checked every 15 minutes from the local logs only, never Claude, once per gap and not while the timer reads by itself. It has a switch in Settings > Notifications.
- The main window opens where it was left: position, size and maximized.
- Settings > Display: Motion (Full, Subtle or Off) and Amber and Green screens. The face is rebuilt from parts, with moods and reactions that each have a cause, and new effects for power on, the bars, rolling numbers, a reading, a lock and a new week.
- Tooltips for the last reading's stretch, Extra usage and the reading log, and the chart's tips in the app's style. The week bar has no tip.
- New test: `npm run test:reading` runs the real reading code in Electron against a fake usage page on this machine (no Claude, no account).

## 2.2.0

- Updates install from the app: Help > About shows when the last check for updates worked, and when a new version is out, "Update to X" downloads it, checks it against the release and installs it, then the app opens again. Your data stays. Nothing is checked or downloaded without a click. Versions before 2.2.0 still need the installer from GitHub once.
- The installer is now named Claude-Quota-Control-Setup-X.exe.
- Past weeks (off by default): the "Past 4 weeks" key under the week chart draws the last 4 weeks as faint dashed lines with this one, in red for a week that reached 100%. In a tall vertical window with room to spare they move to a block of their own under the chart, with where each week ended and where they usually stood at this point of the week.
- In a tall vertical window with room to spare, "Today, by hour" shows today's use per hour, with the 5-hour sessions behind the bars.
- In the vertical window the chart names the days on its own axis, and a Normal day ahead says so in its row.
- The plan menu's keys have two lines, the plan on top and the day's budget below, so they fit in both languages.
- A reading no longer opens a strip under the header: only the thin progress bar and the pulsing lamp show it, so the page does not jump. The lamp's tooltip says the numbers are from the last reading.
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
