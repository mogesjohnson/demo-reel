#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validateScript, type DemoScript } from "./script";
import { record } from "./recorder";
import { convert } from "./convert";
import { writeSnippet } from "./snippet";
import { addAudio } from "./audio";
import { writeAutoScript } from "./autoscript";
import { writeFile } from "node:fs/promises";
import type { CliOptions } from "./types";

const USAGE = `Usage: demo-reel <url> [--script demo.json] [--out dir] [--gif] [--mp4]

  --script <file>  JSON walkthrough script (default: automatic walkthrough)
  --out <dir>      Output directory (default: ./demo-reel-out)
  --gif            Also write demo.gif (720px wide, fps 10, 128 colors; needs ffmpeg)
  --gif-seconds <n> Limit the gif to the first n seconds
  --mp4            Also write demo.mp4 (needs ffmpeg on PATH)
  --size <preset>  720p (1280x720, default), 1080p (1920x1080) or mobile (390x844)
  --title <text>   Intro card title (default: the page title)
  --author <name>  Outro card "Built by" name (default: git user.name)
  --no-cards       Skip the intro and outro cards
  --music          Add a soft procedural ambient music bed (ffmpeg lavfi; nothing downloaded)
  --voice          Speak each caption with a local TTS (say, System.Speech, espeak(-ng), pico2wave)
                   Audio is muxed into demo-audio.mp4 (needs ffmpeg)
  --write-script <file>  Inspect the page and write a demo script, then exit
  --record         With --write-script, also record using the new script
  --no-zoom        Do not zoom into click and type targets
  -h, --help       Show this help`;

export function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> = { outDir: "demo-reel-out", gif: false, mp4: false, size: "720p", cards: true, music: false, voice: false, record: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--script") opts.scriptPath = val();
    else if (a === "--out") opts.outDir = val();
    else if (a === "--gif") opts.gif = true;
    else if (a === "--mp4") opts.mp4 = true;
    else if (a === "--no-cards") opts.cards = false;
    else if (a === "--music") opts.music = true;
    else if (a === "--voice") opts.voice = true;
    else if (a === "--write-script") opts.writeScript = val();
    else if (a === "--record") opts.record = true;
    else if (a === "--no-zoom") opts.zoom = false;
    else if (a === "--title") opts.title = val();
    else if (a === "--author") opts.author = val();
    else if (a === "--size") {
      const v = val();
      if (v !== "720p" && v !== "1080p" && v !== "mobile") throw new Error(`--size must be 720p, 1080p or mobile (got ${v})`);
      opts.size = v;
    } else if (a === "--gif-seconds") {
      const n = Number(val());
      if (!Number.isFinite(n) || n <= 0) throw new Error("--gif-seconds must be a positive number");
      opts.gifSeconds = n;
    }
    else if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
    else if (!opts.url) opts.url = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (!opts.url) throw new Error("Missing <url>");
  try {
    const u = new URL(opts.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new Error(`Not an http(s) URL: ${opts.url}`);
  }
  return opts as CliOptions;
}

async function loadScript(file: string): Promise<DemoScript> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(`Cannot read script file ${file}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Script ${file} is not valid JSON: ${(e as Error).message}`);
  }
  return validateScript(json);
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`demo-reel: ${(e as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  const log = (m: string) => console.log(`[demo-reel] ${m}`);
  let script = opts.scriptPath ? await loadScript(opts.scriptPath) : undefined;
  if (opts.writeScript) {
    script = validateScript(await writeAutoScript(opts.url));
    await writeFile(opts.writeScript, JSON.stringify(script, null, 2) + "\n");
    log(`wrote ${opts.writeScript} (${script.steps.length} steps)`);
    if (!opts.record) return;
  }
  const outDir = path.resolve(opts.outDir);

  const { webmPath, leadSeconds, cues } = await record({
    url: opts.url,
    outDir,
    script,
    log,
    size: opts.size,
    cards: opts.cards ? { title: opts.title, author: opts.author } : false,
    zoom: opts.zoom,
  });
  const conv = await convert(webmPath, outDir, {
    gif: opts.gif,
    mp4: opts.mp4,
    leadSeconds,
    gifSeconds: opts.gifSeconds,
  });
  if (conv.skipped) log(conv.skipped);
  if (conv.trimmed) log(`trimmed ${conv.trimmed}s of blank frames`);
  const size = (await stat(webmPath)).size;
  log(`saved ${webmPath} (${(size / 1024).toFixed(0)} KB)`);
  if (conv.mp4Path) log(`saved ${conv.mp4Path}`);
  if (conv.gifPath) log(`saved ${conv.gifPath}`);
  if (opts.music || opts.voice) {
    // The mp4 is already lead-trimmed, so cue times line up with it.
    const audio = await addAudio({ video: conv.mp4Path ?? webmPath, outDir, cues, music: opts.music, voice: opts.voice, log });
    if (audio) log(`saved ${audio}`);
  }

  const snippet = await writeSnippet({ outDir, url: opts.url, webmPath, ...conv });
  log(`wrote ${snippet}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`demo-reel: ${(e as Error).message}`);
    process.exit(1);
  });
}
