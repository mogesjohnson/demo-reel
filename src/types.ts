export interface CliOptions {
  url: string;
  scriptPath?: string;
  outDir: string;
  gif: boolean;
  mp4: boolean;
}

export interface RecordResult {
  webmPath: string;
}

export interface ConvertResult {
  gifPath?: string;
  mp4Path?: string;
  skipped?: string;
}
