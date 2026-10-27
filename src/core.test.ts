import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "./cli";
import { validateScript } from "./script";
import { SIZES, filterNavLinks, offsetCues } from "./recorder";
import { trimArgs, trimLead, gifPaletteArgs, gifArgs, mp4Args } from "./convert";
import { frameArgs, frameFilter } from "./frame";
import { audioMixArgs, detectTts, musicBed } from "./audio";
import { buildSteps, sampleFor, type Found } from "./autoscript";
import { writeSnippet } from "./snippet";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "test", "fixtures", name), "utf8"));
const U = "https://app.test";

test("validateScript accepts selector-only wait/scroll and empty type text", () => {
  assert.equal(validateScript(fixture("scripts.json").valid).steps.length, 4);
});
test("validateScript rejects each invalid fixture with a specific message", () => {
  for (const [input, msg] of fixture("scripts.json").invalid as [unknown, string][]) {
    assert.throws(() => validateScript(input), (e: Error) => e.message.includes(msg), JSON.stringify(input));
  }
});
test("validateScript lists every problem at once", () => {
  assert.throws(() => validateScript({ steps: [{ action: "goto" }, { action: "click" }] }), /steps\[0\][\s\S]*steps\[1\]/);
});

test("parseArgs --size accepts every preset", () => {
  for (const s of ["720p", "1080p", "mobile"] as const) assert.equal(parseArgs([U, "--size", s]).size, s);
});
test("parseArgs --frame accepts browser/phone/none and rejects others", () => {
  assert.equal(parseArgs([U]).frame, "none");
  assert.equal(parseArgs([U, "--frame", "browser"]).frame, "browser");
  assert.equal(parseArgs([U, "--frame", "phone"]).frame, "phone");
  assert.throws(() => parseArgs([U, "--frame", "tablet"]), /--frame must be/);
  assert.throws(() => parseArgs([U, "--frame"]), /needs a value/);
});
test("parseArgs --no-zoom and --no-cards", () => {
  const d = parseArgs([U]);
  assert.equal(d.zoom, true);
  assert.equal(d.cards, true);
  const o = parseArgs([U, "--no-zoom", "--no-cards"]);
  assert.equal(o.zoom, false);
  assert.equal(o.cards, false);
});
test("parseArgs --music and --voice", () => {
  assert.deepEqual([parseArgs([U]).music, parseArgs([U]).voice], [false, false]);
  const o = parseArgs([U, "--music", "--voice"]);
  assert.equal(o.music, true);
  assert.equal(o.voice, true);
});
test("parseArgs --write-script and --record", () => {
  const o = parseArgs([U, "--write-script", "demo.json", "--record"]);
  assert.equal(o.writeScript, "demo.json");
  assert.equal(o.record, true);
  assert.equal(parseArgs([U]).record, false);
  assert.throws(() => parseArgs([U, "--write-script", "--record"]), /needs a value/);
});
test("parseArgs --gif-seconds validates positive numbers", () => {
  assert.equal(parseArgs([U, "--gif-seconds", "2.5"]).gifSeconds, 2.5);
  for (const bad of ["0", "-1", "abc"]) assert.throws(() => parseArgs([U, "--gif-seconds", bad]), /positive number/);
});
test("parseArgs --title and --author keep spaces", () => {
  const o = parseArgs([U, "--title", "My App", "--author", "Ada L"]);
  assert.equal(o.title, "My App");
  assert.equal(o.author, "Ada L");
});
test("parseArgs --script, --mp4 and extra positional", () => {
  const o = parseArgs([U, "--script", "s.json", "--mp4"]);
  assert.equal(o.scriptPath, "s.json");
  assert.equal(o.mp4, true);
  assert.throws(() => parseArgs([U, "https://b.test"]), /Unexpected argument/);
});

test("size presets map to viewport dimensions", () => {
  assert.deepEqual(SIZES["720p"], { width: 1280, height: 720 });
  assert.deepEqual(SIZES["1080p"], { width: 1920, height: 1080 });
  assert.deepEqual(SIZES.mobile, { width: 390, height: 844 });
});

test("trimArgs seeks past the lead before decoding", () => {
  const a = trimArgs("v.webm", 1.234, "v.trim.webm");
  assert.deepEqual(a.slice(0, 5), ["-y", "-ss", "1.23", "-i", "v.webm"]);
  assert.equal(a.at(-1), "v.trim.webm");
});
test("gif args use palette, lanczos scale and optional -t limit", () => {
  const p = gifPaletteArgs("v.webm", "p.png");
  assert.ok(!p.includes("-t"));
  assert.match(p[p.indexOf("-vf") + 1], /fps=10,scale=720:-1:flags=lanczos,palettegen=max_colors=128/);
  const g = gifArgs("v.webm", "p.png", "d.gif", 4);
  assert.deepEqual(g.slice(0, 7), ["-y", "-t", "4", "-i", "v.webm", "-i", "p.png"]);
  assert.match(g[g.indexOf("-lavfi") + 1], /paletteuse/);
  assert.equal(g.at(-1), "d.gif");
});
test("mp4Args encodes even-sized h264 with faststart", () => {
  const a = mp4Args("v.webm", "d.mp4");
  for (const x of ["libx264", "yuv420p", "+faststart", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]) assert.ok(a.includes(x), x);
  assert.equal(a.at(-1), "d.mp4");
});
test("frameArgs overlays on a gradient of the frame size", () => {
  const { graph, W, H } = frameFilter("browser", 1280, 720, "https://app.test");
  assert.equal(W % 2, 0);
  assert.equal(H % 2, 0);
  const a = frameArgs("in.mp4", graph, W, H, "out.mp4");
  assert.match(a[a.indexOf("lavfi") + 2], new RegExp(`^gradients=s=${W}x${H}:`));
  assert.equal(a[a.indexOf("-filter_complex") + 1], graph);
  assert.match(frameFilter("phone", 390, 844, "").graph, /pad=\d+:\d+:\d+:\d+:color=0x111111/);
});
test("audioMixArgs mixes music and delayed voice clips", () => {
  const a = audioMixArgs("v.mp4", [{ file: "c0.wav", t: 1.5 }, { file: "c1.wav", t: 3 }], true, 10, "o.mp4");
  assert.deepEqual(a.slice(0, 7), ["-y", "-i", "v.mp4", "-i", "c0.wav", "-i", "c1.wav"]);
  const fc = a[a.indexOf("-filter_complex") + 1];
  assert.ok(fc.startsWith(musicBed(10)));
  assert.match(fc, /\[1:a\]aresample=44100,adelay=1500\|1500/);
  assert.match(fc, /\[2:a\].*adelay=3000\|3000/);
  assert.match(fc, /\[music\]\[v0\]\[v1\]amix=inputs=3/);
  assert.equal(a[a.indexOf("-t") + 1], "10.00");
});
test("audioMixArgs voice only skips the music bed", () => {
  const fc = audioMixArgs("v.mp4", [{ file: "c.wav", t: 0 }], false, 5, "o.mp4");
  const g = fc[fc.indexOf("-filter_complex") + 1];
  assert.ok(!g.includes("[music]"));
  assert.match(g, /\[v0\]amix=inputs=1/);
});

test("detectTts picks the engine per platform", async () => {
  const has = (...cmds: string[]) => async (c: string) => cmds.includes(c);
  assert.equal(await detectTts("darwin", has("say", "espeak")), "say");
  assert.equal(await detectTts("win32", has("powershell")), "System.Speech");
  assert.equal(await detectTts("linux", has("say", "espeak", "espeak-ng")), "espeak-ng");
  assert.equal(await detectTts("linux", has("espeak")), "espeak");
  assert.equal(await detectTts("linux", has("pico2wave")), "pico2wave");
  assert.equal(await detectTts("darwin", has()), undefined);
  assert.equal(await detectTts("win32", has("say")), undefined);
});

test("buildSteps turns page elements into a valid script", () => {
  const found: Found = fixture("page-elements.json");
  const s = validateScript(buildSteps(found, U));
  assert.deepEqual(s.steps[0], { action: "wait", ms: 800, caption: "Home" });
  assert.deepEqual(s.steps[3], { action: "scroll", y: 612, caption: "Features" });
  const types = s.steps.filter((x) => x.action === "type");
  assert.deepEqual(types.map((t) => t.text), ["ada@example.com", "Hello! This is a demo message."]);
  assert.equal(types[0].caption, "Filling in the form");
  assert.ok(s.steps.some((x) => x.caption === "Primary action: Get started"));
  const click = s.steps.findIndex((x) => x.action === "click");
  assert.equal(s.steps[click].caption, "Visiting: Pricing");
  assert.deepEqual(s.steps[click + 2], { action: "goto", url: U });
});
test("buildSteps with an empty page still yields a valid script", () => {
  const s = validateScript(buildSteps({ headings: [], nav: [], buttons: [], inputs: [] }, U));
  assert.equal(s.steps.length, 2);
});
test("sampleFor covers input types", () => {
  assert.equal(sampleFor("tel", ""), "555-0100");
  assert.equal(sampleFor("text", "full_name"), "Ada Lovelace");
  assert.equal(sampleFor("text", "q"), "Sample text");
});

test("filterNavLinks keeps same-origin pages, deduped, no hash/mailto/tel/files", () => {
  const out = filterNavLinks(fixture("links.json"), `${U}/`, 3);
  assert.deepEqual(out.map((l) => l.href), [`${U}/about`, `${U}/blog?p=2`, `${U}/docs`]);
  assert.equal(out[1].text, "/blog");
  assert.equal(filterNavLinks(fixture("links.json"), `${U}/`, 10).length, 4);
});

test("offsetCues shifts captions by the trimmed lead and clamps at 0", () => {
  const cues = offsetCues([{ t: 0.2, text: "a" }, { t: 1.5, text: "" }, { t: 2.756, text: "b" }], 0.5);
  assert.deepEqual(cues, [{ t: 0, text: "a" }, { t: 2.26, text: "b" }]);
});

test("offsetCues drops a caption re-shown back to back but keeps one shown again after a clear", () => {
  const raw = [{ t: 1, text: "Visiting: About" }, { t: 2, text: "Visiting: About" }, { t: 3, text: "" }, { t: 4, text: "Visiting: About" }];
  assert.deepEqual(offsetCues(raw, 0), [{ t: 1, text: "Visiting: About" }, { t: 4, text: "Visiting: About" }]);
});

test("writeSnippet embeds relative gif/mp4 paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dr-snip-"));
  try {
    const f = await writeSnippet({ outDir: dir, url: U, webmPath: path.join(dir, "demo.webm"), mp4Path: path.join(dir, "demo.mp4"), gifPath: path.join(dir, "demo.gif") });
    assert.equal(path.basename(f), "README-snippet.md");
    const md = await readFile(f, "utf8");
    assert.match(md, /!\[Demo of https:\/\/app.test\]\(\.\/demo\.gif\)/);
    assert.match(md, /<source src="\.\/demo\.mp4" type="video\/mp4">/);
    assert.match(md, /\[Download the original webm\]\(\.\/demo\.webm\)/);
    assert.ok(!md.includes(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("writeSnippet falls back to webm without mp4", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dr-snip-"));
  try {
    const md = await readFile(await writeSnippet({ outDir: dir, url: U, webmPath: path.join(dir, "demo.webm") }), "utf8");
    assert.match(md, /type="video\/webm"/);
    assert.ok(!md.includes("gif") && !md.includes("Download the original"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("trimLead reports false when the lead is too short or ffmpeg cannot trim", async () => {
  assert.equal(await trimLead("missing.webm", 0.01), false);
  assert.equal(await trimLead("does-not-exist.webm", 1), false);
});
