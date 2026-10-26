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

export async function toGif(webm: string, outDir: string): Promise<string> {
  const palette = path.join(outDir, ".palette.png");
  const gif = path.join(outDir, "demo.gif");
  const filters = "fps=10,scale=800:-1:flags=lanczos";
  let r = await run("ffmpeg", ["-y", "-i", webm, "-vf", `${filters},palettegen`, palette]);
  if (r.code !== 0) throw new Error(`ffmpeg palettegen failed:\n${r.stderr.slice(-800)}`);
  r = await run("ffmpeg", [
    "-y", "-i", webm, "-i", palette,
    "-lavfi", `${filters}[x];[x][1:v]paletteuse`,
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

export async function convert(webm: string, outDir: string, want: { gif: boolean; mp4: boolean }): Promise<ConvertResult> {
  if (!want.gif && !want.mp4) return {};
  if (!(await hasFfmpeg())) {
    return { skipped: "ffmpeg was not found on PATH, so gif/mp4 conversion was skipped (install it yourself to enable)." };
  }
  const res: ConvertResult = {};
  if (want.mp4) res.mp4Path = await toMp4(webm, outDir);
  if (want.gif) res.gifPath = await toGif(webm, outDir);
  return res;
}
