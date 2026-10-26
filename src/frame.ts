import { spawn } from "node:child_process";
import path from "node:path";

export type FrameKind = "browser" | "phone" | "none";

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: -1, stderr: e.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** geq alpha expression that cuts rounded corners of radius r. */
function roundAlpha(r: number): string {
  const dx = `max(max(${r}-X\\,X-(W-1-${r}))\\,0)`;
  const dy = `max(max(${r}-Y\\,Y-(H-1-${r}))\\,0)`;
  return `geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='if(gt(hypot(${dx}\\,${dy})\\,${r})\\,0\\,255)'`;
}

/** Escape drawtext special characters. Truncate first so an escape is never split. */
export function esc(text: string): string {
  return text.slice(0, 80).replace(/[\\:'%,\[\];]/g, (c) => `\\${c}`);
}

/** Build the filtergraph for the frame around a w x h video. */
export function frameFilter(kind: Exclude<FrameKind, "none">, w: number, h: number, url: string, withText = true): { graph: string; W: number; H: number } {
  const margin = Math.round(Math.max(w, h) * 0.06);
  let inner: string;
  let fw: number;
  let fh: number;
  if (kind === "browser") {
    const bar = 44;
    fw = w;
    fh = h + bar;
    const urlW = Math.round(w * 0.6);
    const urlX = Math.round((w - urlW) / 2);
    const text = withText
      ? `,drawtext=text='${esc(url)}':x=${urlX + 14}:y=${bar / 2 - 8}:fontsize=16:fontcolor=0x4b5563`
      : "";
    inner =
      `pad=${fw}:${fh}:0:${bar}:color=0xe5e7eb` +
      `,drawbox=x=18:y=16:w=12:h=12:color=0xff5f57:t=fill` +
      `,drawbox=x=38:y=16:w=12:h=12:color=0xfebc2e:t=fill` +
      `,drawbox=x=58:y=16:w=12:h=12:color=0x28c840:t=fill` +
      `,drawbox=x=${urlX}:y=9:w=${urlW}:h=26:color=white:t=fill${text}` +
      `,format=rgba,${roundAlpha(14)}`;
  } else {
    const bez = Math.round(Math.min(w, h) * 0.05) + 8;
    fw = w + bez * 2;
    fh = h + bez * 2;
    const notchW = Math.round(w * 0.3);
    inner =
      `pad=${fw}:${fh}:${bez}:${bez}:color=0x111111` +
      `,drawbox=x=${Math.round((fw - notchW) / 2)}:y=${bez}:w=${notchW}:h=${Math.round(bez * 0.9)}:color=0x111111:t=fill` +
      `,format=rgba,${roundAlpha(Math.round(bez * 2.2))}`;
  }
  const W = Math.ceil((fw + margin * 2) / 2) * 2;
  const H = Math.ceil((fh + margin * 2) / 2) * 2;
  const graph =
    `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,${inner}[fg];` +
    `[1:v][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[out]`;
  return { graph, W, H };
}

/** ffmpeg args that overlay `input` on a W x H gradient using `graph`. */
export function frameArgs(input: string, graph: string, W: number, H: number, out: string): string[] {
  return [
    "-y", "-i", input,
    "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=0x6366f1:c1=0xec4899:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.0001`,
    "-filter_complex", graph, "-map", "[out]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-preset", "veryfast",
    out,
  ];
}

async function probeSize(file: string): Promise<{ w: number; h: number } | undefined> {
  const r = await run(["-hide_banner", "-i", file]);
  const m = /, (\d{2,5})x(\d{2,5})[, ]/.exec(r.stderr);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
}

/** Pad the video onto a gradient with a browser or phone frame; writes demo-framed.mp4. */
export async function frameVideo(input: string, outDir: string, kind: Exclude<FrameKind, "none">, url: string): Promise<string> {
  const size = await probeSize(input);
  if (!size) throw new Error(`could not read the video size of ${input}`);
  const w = size.w - (size.w % 2);
  const h = size.h - (size.h % 2);
  const out = path.join(outDir, "demo-framed.mp4");
  let lastErr = "";
  for (const withText of [true, false]) {
    const { graph, W, H } = frameFilter(kind, w, h, url, withText);
    const r = await run(frameArgs(input, graph, W, H, out));
    if (r.code === 0) return out;
    lastErr = r.stderr.slice(-800);
  }
  throw new Error(`ffmpeg frame failed:\n${lastErr}`);
}
