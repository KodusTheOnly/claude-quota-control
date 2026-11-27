// The window sizes the Overview is tested at. The window goes from 1100x520 to 1920x1080 (WIN_MIN and WIN_MAX in
// main.js), so the Overview never scrolls. The format names the header's layout, chosen by width (overview.js):
// medium:   under 1280px (Type it in and Math in the "..." menu)
// wide:     1280px or wider (Type it in and Math in the header)
const SIZES = [
  ...[[1100, 520], [1100, 640], [1100, 780], [1200, 1000]].map(([w, h]) => ({ w, h, format: "medium" })),
  ...[[1280, 520], [1280, 720], [1366, 728], [1600, 900], [1920, 1040], [1920, 1080]].map(([w, h]) => ({ w, h, format: "wide" })),
];

function formatOf(w) {
  return w >= 1280 ? "wide" : "medium";
}
// Formats that may scroll: none, the window is never smaller than the Overview needs
const SCROLLS = [];

module.exports = { SIZES, formatOf, SCROLLS };
