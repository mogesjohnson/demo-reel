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
```

| Option | Meaning |
| --- | --- |
| `--script <file>` | Run a JSON walkthrough script instead of the automatic one |
| `--out <dir>` | Output directory (default `./demo-reel-out`) |
| `--gif` | Also write `demo.gif` (fps 10, 800px wide, two-pass palette) |
| `--mp4` | Also write `demo.mp4` (libx264, yuv420p) |

If `ffmpeg` is not on PATH, `--gif` and `--mp4` are skipped with a message.

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
| `click` | `selector` | Clicks the first match, then waits for the page to settle |
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
