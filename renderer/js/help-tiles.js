// Help: one tile per topic. A tile opens that topic in the side drawer, the same kind of drawer as "Show the math".
// The topic text stays in index.html (hidden); opening a topic moves its content into the drawer and closing puts it back.

const HELP_TOPICS = [
  { id: "helpCalc", code: "01", title: "help.g.calc", sum: "help.sum.calc", body: "helpCalcBody" },
  { id: "helpStatus", code: "02", title: "help.g.head", sum: "help.sum.head" },
  { id: "helpSession", code: "03", title: "help.g.session", sum: "help.sum.session" },
  { id: "helpWeek", code: "04", title: "help.g.week", sum: "help.sum.week" },
  { id: "helpToday", code: "05", title: "help.g.today", sum: "help.sum.today" },
  { id: "helpHistory", code: "06", title: "help.g.history", sum: "help.sum.history" },
  { id: "helpRefresh", code: "07", title: "help.g.refresh", sum: "help.sum.refresh" },
  { id: "helpTray", code: "08", title: "help.g.tray", sum: "help.sum.tray" },
];
let helpOpen = null; // { topic, node, home } while a topic is in the drawer

function paintHelpTitle(topic) {
  $("helpDrawerTitle").replaceChildren(node("b", "", topic.code), t(topic.title));
}

function openHelpTopic(topic) {
  const dlg = $("helpDrawer");
  if (helpOpen) returnHelpContent();
  const content = topic.body ? $(topic.body) : $(topic.id).querySelector(".help-list");
  helpOpen = { topic, node: content, home: content.parentNode };
  paintHelpTitle(topic);
  $("helpBody").replaceChildren(content);
  $("helpBody").scrollTop = 0;
  if (!dlg.open) dlg.showModal();
}

function returnHelpContent() {
  if (!helpOpen) return;
  helpOpen.home.appendChild(helpOpen.node);
  helpOpen = null;
}

function renderHelpTiles() {
  $("helpTiles").replaceChildren(
    ...HELP_TOPICS.map((topic) => {
      const tile = node("button", "blk tile");
      tile.type = "button";
      tile.setAttribute("aria-haspopup", "dialog");
      const head = node("span", "tile-h");
      const go = node("span", "tile-go", "\u203A");
      go.setAttribute("aria-hidden", "true");
      head.append(node("b", "", topic.code), node("span", "tile-t", t(topic.title)), go);
      tile.append(head, node("span", "tile-s", t(topic.sum)));
      tile.addEventListener("click", () => openHelpTopic(topic));
      return tile;
    })
  );
  if (helpOpen) paintHelpTitle(helpOpen.topic);
}

$("helpClose").addEventListener("click", () => $("helpDrawer").close());
// A click on the dimmed area (the dialog element itself) closes it
$("helpDrawer").addEventListener("click", (e) => {
  if (e.target === $("helpDrawer")) $("helpDrawer").close();
});
$("helpDrawer").addEventListener("close", returnHelpContent);
