import { spawn } from "node:child_process";
import path from "node:path";
import type { ConvertResult } from "./types";

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: -1, stderr: e.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** True when `ffmpeg` is on PATH. Never downloads anything. */
export async function hasFfmpeg(): Promise<boolean> {
  const r = await run("ffmpeg", ["-version"]);
  return r.code === 0;
}

/** Trim `lead` seconds of blank frames from the start; returns the trimmed webm path. */
export async function trimLead(webm: string, lead: number): Promise<string> {
  if (lead < 0.05) return webm;
  const tmp = webm.replace(/\.webm$/, ".trim.webm");
  const r = await run("ffmpeg", ["-y", "-ss", lead.toFixed(2), "-i", webm, "-c:v", "libvpx", "-b:v", "2M", "-crf", "10", "-deadline", "realtime", "-cpu-used", "8", tmp]);
  if (r.code !== 0) return webm;
  await import("node:fs/promises").then((fs) => fs.rename(tmp, webm));
  return webm;
}

export async function toGif(webm: string, outDir: string, maxSeconds?: number): Promise<string> {
  const palette = path.join(outDir, ".palette.png");
  const gif = path.join(outDir, "demo.gif");
  const filters = "fps=10,scale=720:-1:flags=lanczos";
  const limit = maxSeconds && maxSeconds > 0 ? ["-t", String(maxSeconds)] : [];
  let r = await run("ffmpeg", ["-y", ...limit, "-i", webm, "-vf", `${filters},palettegen=max_colors=128:stats_mode=diff`, palette]);
  if (r.code !== 0) throw new Error(`ffmpeg palettegen failed:\n${r.stderr.slice(-800)}`);
  r = await run("ffmpeg", [
    "-y", ...limit, "-i", webm, "-i", palette,
    "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    gif,
  ]);
  await import("node:fs/promises").then((fs) => fs.rm(palette, { force: true }));
  if (r.code !== 0) throw new Error(`ffmpeg gif failed:\n${r.stderr.slice(-800)}`);
  return gif;
}

export async function toMp4(webm: string, outDir: string): Promise<string> {
  const mp4 = path.join(outDir, "demo.mp4");
  const r = await run("ffmpeg", [
    "-y", "-i", webm,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    mp4,
  ]);
  if (r.code !== 0) throw new Error(`ffmpeg mp4 failed:\n${r.stderr.slice(-800)}`);
  return mp4;
}

export async function convert(
  webm: string,
  outDir: string,
  want: { gif: boolean; mp4: boolean; leadSeconds?: number; gifSeconds?: number },
): Promise<ConvertResult> {
  if (!(await hasFfmpeg())) {
    if (!want.gif && !want.mp4) return {};
    return { skipped: "ffmpeg was not found on PATH, so trimming and gif/mp4 conversion were skipped (install it yourself to enable)." };
  }
  const res: ConvertResult = {};
  if (want.leadSeconds) {
    await trimLead(webm, want.leadSeconds);
    res.trimmed = want.leadSeconds;
  }
  if (want.mp4) res.mp4Path = await toMp4(webm, outDir);
  if (want.gif) res.gifPath = await toGif(webm, outDir, want.gifSeconds);
  return res;
}
