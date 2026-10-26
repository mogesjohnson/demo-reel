import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Cue {
  /** Seconds from the start of the (trimmed) video. */
  t: number;
  text: string;
}

function run(cmd: string, args: string[], input?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: -1, stderr: e.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
    if (input) child.stdin?.end(input);
  });
}

async function onPath(cmd: string): Promise<boolean> {
  const probe = process.platform === "win32" ? ["where", [cmd]] : ["sh", ["-c", `command -v ${cmd}`]];
  return (await run(probe[0] as string, probe[1] as string[])).code === 0;
}

type Tts = (text: string, outFile: string) => Promise<boolean>;

/** Find a locally installed TTS engine. Never installs or downloads anything. */
export async function findTts(): Promise<{ name: string; speak: Tts } | undefined> {
  const ok = async (r: Promise<{ code: number }>) => (await r).code === 0;
  if (process.platform === "darwin" && (await onPath("say"))) {
    return { name: "say", speak: (t, f) => ok(run("say", ["-o", f, "--data-format=LEI16@22050", t])) };
  }
  if (process.platform === "win32" && (await onPath("powershell"))) {
    const speak: Tts = (t, f) =>
      ok(run("powershell", ["-NoProfile", "-Command",
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
        `$s.SetOutputToWaveFile('${f.replace(/'/g, "''")}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`], t));
    return { name: "System.Speech", speak };
  }
  for (const e of ["espeak-ng", "espeak"]) {
    if (await onPath(e)) return { name: e, speak: (t, f) => ok(run(e, ["-w", f, t])) };
  }
  if (await onPath("pico2wave")) return { name: "pico2wave", speak: (t, f) => ok(run("pico2wave", ["-w", f, t])) };
  return undefined;
}

/** lavfi source for a soft ambient pad: a quiet A-minor-ish sine chord with tremolo and fades. */
function musicBed(seconds: number): string {
  const d = seconds.toFixed(2);
  const fadeOut = Math.max(0, seconds - 2).toFixed(2);
  const tones = [110, 164.81, 220, 261.63]
    .map((f, i) => `sine=f=${f}:d=${d}[s${i}]`).join(";");
  return `${tones};[s0][s1][s2][s3]amix=inputs=4,tremolo=f=0.25:d=0.4,volume=0.12,` +
    `afade=t=in:d=2,afade=t=out:st=${fadeOut}:d=2[music]`;
}

async function duration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("error", () => resolve(0));
    c.on("close", () => resolve(Number(out.trim()) || 0));
  });
}

export interface AudioOptions {
  video: string;
  outDir: string;
  cues: Cue[];
  music: boolean;
  voice: boolean;
  log: (m: string) => void;
}

/** Mix music and/or voiceover and mux it with `video` into demo-audio.mp4. */
export async function addAudio(o: AudioOptions): Promise<string | undefined> {
  if ((await run("ffmpeg", ["-version"])).code !== 0) {
    o.log("ffmpeg not found; skipping --music/--voice");
    return undefined;
  }
  const secs = (await duration(o.video)) || Math.max(5, ...o.cues.map((c) => c.t + 3));
  const tmp = path.join(os.tmpdir(), `demo-reel-tts-${process.pid}`);
  const clips: { file: string; t: number }[] = [];
  if (o.voice) {
    const tts = await findTts();
    if (!tts) o.log("no local TTS found (say, System.Speech, espeak, espeak-ng, pico2wave); skipping --voice");
    else {
      await mkdir(tmp, { recursive: true });
      for (const [i, c] of o.cues.entries()) {
        if (!c.text.trim()) continue;
        const f = path.join(tmp, `cue${i}.${tts.name === "say" ? "aiff" : "wav"}`);
        if ((await tts.speak(c.text, f)) && (await stat(f).catch(() => undefined))) clips.push({ file: f, t: Math.max(0, c.t) });
      }
      o.log(`voiced ${clips.length} caption(s) with ${tts.name}`);
    }
  }
  if (!o.music && clips.length === 0) {
    await rm(tmp, { recursive: true, force: true });
    return undefined;
  }
  const inputs = ["-i", o.video, ...clips.flatMap((c) => ["-i", c.file])];
  const parts: string[] = [];
  const mixIn: string[] = [];
  if (o.music) {
    parts.push(musicBed(secs));
    mixIn.push("[music]");
  }
  clips.forEach((c, i) => {
    const ms = Math.round(c.t * 1000);
    parts.push(`[${i + 1}:a]aresample=44100,adelay=${ms}|${ms},volume=1.6[v${i}]`);
    mixIn.push(`[v${i}]`);
  });
  parts.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:duration=longest:normalize=0[aout]`);
  const out = path.join(o.outDir, "demo-audio.mp4");
  const r = await run("ffmpeg", ["-y", ...inputs, "-filter_complex", parts.join(";"),
    "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", secs.toFixed(2), "-movflags", "+faststart", out]);
  await rm(tmp, { recursive: true, force: true });
  if (r.code !== 0) throw new Error(`ffmpeg audio mux failed:\n${r.stderr.slice(-800)}`);
  return out;
}
