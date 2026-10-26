export interface CliOptions {
  url: string;
  scriptPath?: string;
  outDir: string;
  gif: boolean;
  mp4: boolean;
  size: "720p" | "1080p" | "mobile";
  cards: boolean;
  title?: string;
  author?: string;
  gifSeconds?: number;
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
