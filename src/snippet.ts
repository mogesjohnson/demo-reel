import { writeFile } from "node:fs/promises";
import path from "node:path";

export interface SnippetInput {
  outDir: string;
  url: string;
  webmPath: string;
  mp4Path?: string;
  gifPath?: string;
}

/** Write README-snippet.md with relative embed markdown for the outputs. */
export async function writeSnippet(i: SnippetInput): Promise<string> {
  const rel = (p: string) => "./" + path.basename(p);
  const lines: string[] = [`<!-- demo-reel recording of ${i.url} -->`, ""];
  if (i.gifPath) lines.push(`![Demo of ${i.url}](${rel(i.gifPath)})`, "");
  const video = i.mp4Path ?? i.webmPath;
  const type = i.mp4Path ? "video/mp4" : "video/webm";
  lines.push(
    `<video src="${rel(video)}" width="640" controls muted playsinline>`,
    `  <source src="${rel(video)}" type="${type}">`,
    `</video>`,
    "",
    `[Watch the demo (${path.extname(video).slice(1)})](${rel(video)})`,
  );
  if (i.mp4Path) lines.push(`[Download the original webm](${rel(i.webmPath)})`);
  lines.push("");
  const out = path.join(i.outDir, "README-snippet.md");
  await writeFile(out, lines.join("\n"), "utf8");
  return out;
}
