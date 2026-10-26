# demo-reel

Record a short walkthrough video of a web app for your portfolio or README.
`demo-reel` opens the page in headless Chromium (Playwright), walks through it with
on-screen captions, and saves a 1280x720 `.webm`. With `ffmpeg` on your PATH it can
also write a `.gif` and an `.mp4`.

## Install

```sh
npm install
npx playwright install chromium   # the only binary demo-reel downloads
npx tsc
```

`ffmpeg` is optional and is never downloaded. Install it yourself if you want `--gif` or `--mp4`.

## Usage

```sh
node dist/cli.js <url> [--script demo.json] [--out dir] [--gif] [--mp4]
  [--size 720p|1080p|mobile] [--title text] [--author name] [--no-cards] [--gif-seconds n]
```

| Option | Meaning |
| --- | --- |
| `--script <file>` | Run a JSON walkthrough script instead of the automatic one |
| `--out <dir>` | Output directory (default `./demo-reel-out`) |
| `--gif` | Also write `demo.gif` (fps 10, 720px wide, two-pass palette with 128 colors) |
| `--gif-seconds <n>` | Limit the gif to the first `n` seconds |
| `--mp4` | Also write `demo.mp4` (libx264, yuv420p) |
| `--size <preset>` | `720p` (1280x720, default), `1080p` (1920x1080) or `mobile` (390x844) |
| `--title <text>` | Intro card title (default: the page title) |
| `--author <name>` | Outro card "Built by" name (default: `git config user.name`) |
| `--no-cards` | Skip the 2 second intro and outro title cards |

With `ffmpeg` on PATH, demo-reel also trims the blank frames before the first paint.
If `ffmpeg` is not on PATH, trimming, `--gif` and `--mp4` are skipped with a message.

## What the video shows

- Intro and outro cards: a full-screen title card (page title or `--title`, plus the URL)
  and a "Built by" card, about 2 seconds each.
- Captions: a high-contrast pill at the bottom center. It is bright on dark pages and dark
  on light pages, picked from the page's computed background luminance.
- Camera: eased scrolling (requestAnimationFrame, easeInOut) that pauses briefly at headings and images.
- Cursor: a visible pointer that glides to each click target and nav link, with a ripple on click.

Output in the out dir:

- `demo.webm`: the recording (always)
- `demo.mp4`, `demo.gif`: when requested and ffmpeg exists
- `README-snippet.md`: markdown and an HTML `<video>` tag to paste into your README

## Default walkthrough

With no script, demo-reel:

1. loads the page and waits for network idle (caption "Home"),
2. scrolls slowly to the bottom and back to the top ("Scrolling through"),
3. visits up to 3 same-origin links, preferring `nav` and `header` links, skipping
   `#hash`, `mailto:` and duplicates, and scrolls each briefly ("Visiting: <link text>"),
4. returns home.

## Script format

```json
{
  "steps": [
    { "action": "wait", "ms": 1200, "caption": "Welcome" },
    { "action": "click", "selector": "nav a[href$='about/']", "caption": "About page" },
    { "action": "type", "selector": "input[type=search]", "text": "agents" },
    { "action": "scroll", "y": 800, "caption": "Scrolling" },
    { "action": "scroll", "selector": "#pricing" },
    { "action": "goto", "url": "/docs/", "caption": "Docs" },
    { "action": "wait", "selector": ".loaded" }
  ]
}
```

| Action | Needs | Notes |
| --- | --- | --- |
| `click` | `selector` | Moves the cursor to the first match, ripples, clicks, then waits for the page to settle |
| `type` | `selector`, `text` | Types with a short per-key delay |
| `wait` | `ms` or `selector` | Sleeps, or waits for the selector (timeout `ms`, default 10s) |
| `scroll` | `y` or `selector` | Smooth-scrolls to a y offset or to the element |
| `goto` | `url` | Absolute, or relative to the start URL |

Every step can have a `caption`, shown as a fading pill at the bottom center of the page.
Invalid scripts fail before the browser starts, with one line per problem.

## Example

[`examples/demo.json`](examples/demo.json) is a short script for the BEST-OF-AI-DEV docs site:

```sh
node dist/cli.js https://mogesjohnson.github.io/BEST-OF-AI-DEV/ --script examples/demo.json --mp4
```

A default-walkthrough run against https://mogesjohnson.github.io/BEST-OF-AI-DEV/ produced a
15 second, 1280x720 `demo.webm` of about 5.6 MB (2.6 MB as mp4). Videos are kept out of git
because they are over 2 MB; run the command above to make your own.

## License

MIT

## Music and voiceover

```sh
demo-reel https://example.com --mp4 --music --voice
```

- `--music` generates a quiet ambient chord bed with ffmpeg's lavfi sine sources (tremolo, fade in/out). Nothing is downloaded.
- `--voice` speaks each caption with a TTS engine that is already installed: `say` (macOS), PowerShell System.Speech (Windows), or `espeak-ng`/`espeak`/`pico2wave` (Linux). If none is found it prints a skip message.
- Caption timestamps are recorded during the run; each spoken clip is placed at its timestamp (`adelay` + `amix`) and the mix is muxed into `demo-audio.mp4`. Without ffmpeg, both flags are skipped with a message.

## Auto-generated scripts

```sh
demo-reel https://example.com --write-script demo.json          # write the script and exit
demo-reel https://example.com --write-script demo.json --record # write it, then record with it
```

The page is loaded once and its main headings, nav links, primary button and first form are turned into steps: scroll to each heading, fill form inputs with sample data by input type (never submitted), and click nav links with captions. Edit the JSON and pass it back with `--script`.
