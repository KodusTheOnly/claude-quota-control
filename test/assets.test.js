// The app icon is drawn from the CQC bar mark. Windows picks a size out of the .ico for the taskbar, the title bar,
// the installer and the file list, so a missing size would be scaled and look blurry.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const assets = path.join(__dirname, "..", "assets");

function pngSize(file) {
  const buf = fs.readFileSync(path.join(assets, file));
  assert.equal(buf.subarray(1, 4).toString(), "PNG", `${file} is a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test("icon.ico holds every size Windows asks for, as PNG frames", () => {
  const buf = fs.readFileSync(path.join(assets, "icon.ico"));
  assert.equal(buf.readUInt16LE(0), 0, "reserved");
  assert.equal(buf.readUInt16LE(2), 1, "type is icon");
  const count = buf.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const w = buf[at] || 256;
    const length = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    assert.equal(buf.subarray(offset + 1, offset + 4).toString(), "PNG", `frame ${w} is a PNG`);
    assert.equal(buf.readUInt32BE(offset + 16), w, `frame ${w} is ${w}px wide`);
    assert.ok(offset + length <= buf.length, `frame ${w} is inside the file`);
    sizes.push(w);
  }
  for (const wanted of [16, 24, 32, 48, 64, 128, 256]) assert.ok(sizes.includes(wanted), `has ${wanted}px`);
});

test("icon.png is 256px and the first tray icon is 32px", () => {
  assert.deepEqual(pngSize("icon.png"), [256, 256]);
  assert.deepEqual(pngSize("tray.png"), [32, 32]);
});

test("icon.svg is the bar mark: three bars, and nothing from the old gauge", () => {
  const svg = fs.readFileSync(path.join(assets, "icon.svg"), "utf8");
  assert.equal((svg.match(/<rect x="[\d.]+" y="[\d.]+" width="35.00"/g) || []).length, 3, "three bars");
  assert.ok(!/<path|<circle/.test(svg), "no dial arcs or needle");
});
