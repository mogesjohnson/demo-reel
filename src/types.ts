export interface CliOptions {
  url: string;
  scriptPath?: string;
  outDir: string;
  gif: boolean;
  mp4: boolean;
  size: "720p" | "1080p" | "mobile";
  cards: boolean;
  zoom?: boolean;
  title?: string;
  author?: string;
  gifSeconds?: number;
  frame: "browser" | "phone" | "none";
  music: boolean;
  voice: boolean;
  writeScript?: string;
  record: boolean;
}

export interface RecordResult {
  webmPath: string;
}

export interface ConvertResult {
  gifPath?: string;
  mp4Path?: string;
  skipped?: string;
  trimmed?: number;
}
