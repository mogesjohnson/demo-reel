import type { Page } from "playwright";

export interface ZoomOptions {
  /** Zoom factor at the peak (default 1.6). */
  scale?: number;
  /** Ease duration in and out, ms (default 600). */
  ms?: number;
}

/**
 * Smoothly zoom into viewport point (x, y) with a CSS transform on
 * document.documentElement. Call zoomOut() afterwards to return.
 * Fixed overlays (cursor, caption) are compensated while zoomed, because a
 * transformed <html> becomes their containing block.
 */
export async function zoomIn(page: Page, x: number, y: number, opts: ZoomOptions = {}): Promise<void> {
  const scale = opts.scale ?? 1.6;
  const ms = opts.ms ?? 600;
  await page
    .evaluate(
      ([px, py, s, dur]) => {
        const html = document.documentElement;
        const sx = window.scrollX;
        const sy = window.scrollY;
        const cursor = document.getElementById("__demo-reel-cursor");
        if (cursor) {
          cursor.dataset.zoomMargin = `${cursor.style.marginLeft}|${cursor.style.marginTop}`;
          cursor.style.marginLeft = `${sx - 3}px`;
          cursor.style.marginTop = `${sy - 2}px`;
        }
        const pill = document.getElementById("__demo-reel-caption");
        if (pill) pill.style.visibility = "hidden";
        html.style.transition = `transform ${dur}ms cubic-bezier(0.65, 0, 0.35, 1)`;
        html.style.transformOrigin = `${px + sx}px ${py + sy}px`;
        html.style.transform = `scale(${s})`;
      },
      [x, y, scale, ms] as const,
    )
    .catch(() => {});
  await new Promise((r) => setTimeout(r, ms));
}

export async function zoomOut(page: Page, opts: ZoomOptions = {}): Promise<void> {
  const ms = opts.ms ?? 600;
  await page.evaluate(() => (document.documentElement.style.transform = "scale(1)")).catch(() => {});
  await new Promise((r) => setTimeout(r, ms));
  await page
    .evaluate(() => {
      const html = document.documentElement;
      html.style.transition = "";
      html.style.transform = "";
      html.style.transformOrigin = "";
      const cursor = document.getElementById("__demo-reel-cursor");
      if (cursor?.dataset.zoomMargin !== undefined) {
        const [l, t] = cursor.dataset.zoomMargin.split("|");
        cursor.style.marginLeft = l;
        cursor.style.marginTop = t;
        delete cursor.dataset.zoomMargin;
      }
      const pill = document.getElementById("__demo-reel-caption");
      if (pill) pill.style.visibility = "";
    })
    .catch(() => {});
}

/** Zoom in on (x, y), run `during` (for example a click ripple), hold, then zoom out. */
export async function zoomPulse(
  page: Page,
  x: number,
  y: number,
  during?: () => Promise<void>,
  holdMs = 800,
  opts: ZoomOptions = {},
): Promise<void> {
  await zoomIn(page, x, y, opts);
  if (during) await during();
  await new Promise((r) => setTimeout(r, holdMs));
  await zoomOut(page, opts);
}
