// The window sizes the Overview is tested at, grouped by the format they should get.
// wide:     960px or wider and at least 1.3x wider than tall
// medium:   720px or wider, otherwise
// vertical: under 720px
const SIZES = [
  ...[[960, 540], [1024, 576], [1078, 550], [1080, 480], [1280, 720], [1366, 728], [1600, 900], [1920, 1040], [2560, 1400]].map(([w, h]) => ({ w, h, format: "wide" })),
  ...[[760, 900], [900, 700], [960, 800], [1100, 1000]].map(([w, h]) => ({ w, h, format: "medium" })),
  // Too short for everything to fit (about 36rem is needed): these keep the layout and let it scroll
  ...[[720, 480], [720, 540], [800, 600]].map(([w, h]) => ({ w, h, format: "medium-short" })),
  ...[[420, 480], [420, 540], [420, 900], [540, 960], [600, 1000], [420, 1240], [420, 1440]].map(([w, h]) => ({ w, h, format: "vertical" })),
];

function formatOf(w, h) {
  if (w >= 960 && w / h >= 1.3) return "wide";
  return w >= 720 ? "medium" : "vertical";
}
// Formats that may scroll
const SCROLLS = ["vertical", "medium-short"];

module.exports = { SIZES, formatOf, SCROLLS };
