import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli";
import { validateScript } from "./script";
import { luminanceOf, pillTheme } from "./theme";

test("parseArgs defaults", () => {
  const o = parseArgs(["https://example.com"]);
  assert.equal(o.url, "https://example.com");
  assert.equal(o.size, "720p");
  assert.equal(o.cards, true);
  assert.equal(o.outDir, "demo-reel-out");
});
test("parseArgs flags", () => {
  const o = parseArgs(["https://x.dev", "--size", "mobile", "--no-cards", "--gif", "--gif-seconds", "5", "--out", "o"]);
  assert.equal(o.size, "mobile");
  assert.equal(o.cards, false);
  assert.equal(o.gif, true);
  assert.equal(o.gifSeconds, 5);
  assert.equal(o.outDir, "o");
});
test("parseArgs errors", () => {
  assert.throws(() => parseArgs([]), /Missing <url>/);
  assert.throws(() => parseArgs(["ftp://x"]), /Not an http/);
  assert.throws(() => parseArgs(["https://x", "--size", "4k"]), /--size/);
  assert.throws(() => parseArgs(["https://x", "--bogus"]), /Unknown option/);
  assert.throws(() => parseArgs(["https://x", "--out"]), /needs a value/);
});
test("validateScript accepts valid steps", () => {
  const s = validateScript({ steps: [{ action: "click", selector: "a" }, { action: "wait", ms: 100 }] });
  assert.equal(s.steps.length, 2);
});
test("validateScript rejects bad input", () => {
  assert.throws(() => validateScript([]), /JSON object/);
  assert.throws(() => validateScript({ steps: [] }), /at least one/);
  assert.throws(() => validateScript({ steps: [{ action: "fly" }] }), /must be one of/);
  assert.throws(() => validateScript({ steps: [{ action: "type", selector: "#q" }] }), /needs "text"/);
  assert.throws(() => validateScript({ steps: [{ action: "goto" }] }), /needs "url"/);
});
test("luminanceOf", () => {
  assert.equal(luminanceOf("rgb(255, 255, 255)"), 1);
  assert.equal(luminanceOf("rgb(0, 0, 0)"), 0);
  assert.equal(luminanceOf("rgba(0, 0, 0, 0)"), null);
  assert.equal(luminanceOf("transparent"), null);
});
test("pillTheme walks to first opaque background", () => {
  assert.equal(pillTheme(["rgba(0, 0, 0, 0)", "rgb(10, 10, 20)", "rgb(255, 255, 255)"]), "dark");
  assert.equal(pillTheme(["rgb(250, 250, 250)"]), "light");
  assert.equal(pillTheme([]), "light");
});
