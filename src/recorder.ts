import { chromium, type Page } from "playwright";
import { mkdir, rename, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Captions } from "./captions";
import { zoomPulse } from "./zoom";

let zoomEnabled = true;
import type { DemoScript, Step } from "./script";

export const SIZES = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  mobile: { width: 390, height: 844 },
} as const;
export type SizeName = keyof typeof SIZES;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RecordOptions {
  url: string;
  outDir: string;
  script?: DemoScript;
  log?: (msg: string) => void;
  size?: SizeName;
  /** Intro/outro cards; omit or set false to disable. */
  cards?: { title?: string; author?: string } | false;
  /** Zoom into click and type targets (default true). */
  zoom?: boolean;
}

export interface Recording {
  webmPath: string;
  /** Seconds of blank video before the first paint (for trimming). */
  leadSeconds: number;
}

async function settle(page: Page, timeout = 10_000): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout });
  } catch {
    // Some pages never go idle; carry on.
  }
}

/** Eased (easeInOut) scroll to `targetY` driven by requestAnimationFrame. */
async function smoothScrollTo(page: Page, targetY: number, pxPerSec = 900): Promise<void> {
  const startY = await page.evaluate(() => window.scrollY);
  const ms = Math.min(4000, Math.max(300, (Math.abs(targetY - startY) / pxPerSec) * 1000));
  await page.evaluate(
    ([from, to, dur]) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          window.scrollTo(0, from + (to - from) * ease(t));
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    [startY, targetY, ms] as const,
  );
}

/** Scroll down, pausing briefly when a heading or image comes into view. */
async function tourDown(page: Page, maxY: number): Promise<void> {
  const stops = await page.evaluate((limit) => {
    const ys = Array.from(document.querySelectorAll("h1, h2, h3, img"))
      .filter((el) => (el as HTMLElement).offsetHeight > 40 || /^H/.test(el.tagName))
      .map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3))
      .filter((y) => y > 80 && y < limit)
      .sort((a, b) => a - b);
    const out: number[] = [];
    for (const y of ys) if (!out.length || y - out[out.length - 1] > 350) out.push(y);
    return out.slice(0, 6);
  }, maxY);
  for (const y of stops) {
    await smoothScrollTo(page, y);
    await sleep(450);
  }
  await smoothScrollTo(page, maxY);
}

/** Move the fake cursor to the element center and ripple; returns false if not visible. */
async function pointAt(page: Page, captions: Captions, selector: string): Promise<boolean> {
  try {
    const loc = page.locator(selector).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
    const box = await loc.boundingBox();
    if (!box) return false;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await captions.moveCursor(x, y, 650);
    if (zoomEnabled) await zoomPulse(page, x, y, () => captions.ripple(x, y));
    else await captions.ripple(x, y);
    await sleep(250);
    return true;
  } catch {
    return false;
  }
}

function gitUser(): string | undefined {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function showCard(captions: Captions, title: string, sub: string): Promise<void> {
  await captions.card(title, sub);
  await sleep(2000);
  await captions.hideCard();
  await sleep(400);
}

async function scrollHeight(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  );
}

interface NavLink {
  href: string;
  text: string;
  attr: string;
}

/** Up to `max` same-origin links, preferring nav/header, deduped, no hashes or mailto. */
async function findNavLinks(page: Page, max = 3): Promise<NavLink[]> {
  const raw = await page.evaluate(() => {
    const pick = (sel: string) =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>(sel)).map((a) => ({
        href: a.href,
        attr: a.getAttribute("href") || "",
        text: (a.innerText || a.getAttribute("aria-label") || a.title || "").trim(),
      }));
    return [...pick("nav a[href], header a[href]"), ...pick("a[href]")];
  });
  const home = new URL(page.url());
  const seen = new Set<string>([home.origin + home.pathname]);
  const out: NavLink[] = [];
  for (const l of raw) {
    if (out.length >= max) break;
    if (!l.attr || l.attr.startsWith("#") || /^(mailto|tel|javascript):/i.test(l.attr)) continue;
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (u.origin !== home.origin) continue;
    if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|webm)$/i.test(u.pathname)) continue;
    const key = u.origin + u.pathname + u.search;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href: u.origin + u.pathname + u.search, text: l.text || u.pathname, attr: l.attr });
  }
  return out;
}

async function gotoAndSettle(page: Page, captions: Captions, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  await captions.reinject();
}

async function defaultWalkthrough(page: Page, captions: Captions, url: string, log: (m: string) => void) {
  await captions.show("Home");
  await sleep(1200);
  const h = await scrollHeight(page);
  if (h > 0) {
    await captions.show("Scrolling through");
    await tourDown(page, h);
    await sleep(500);
    await smoothScrollTo(page, 0);
    await sleep(500);
  }
  const links = await findNavLinks(page);
  log(`found ${links.length} nav link(s)`);
  for (const link of links) {
    const label = link.text.replace(/\s+/g, " ").slice(0, 40);
    log(`visiting ${link.href}`);
    const sel = `a[href=${JSON.stringify(link.attr)}]`;
    await captions.show(`Visiting: ${label}`);
    await pointAt(page, captions, `nav ${sel}, header ${sel}, ${sel}`);
    try {
      await gotoAndSettle(page, captions, link.href);
    } catch (e) {
      log(`skip ${link.href}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    await captions.show(`Visiting: ${label}`);
    await sleep(900);
    const lh = await scrollHeight(page);
    if (lh > 0) {
      await smoothScrollTo(page, Math.min(lh, 900));
      await sleep(300);
      await smoothScrollTo(page, 0);
    }
    await sleep(400);
  }
  if (links.length) {
    await gotoAndSettle(page, captions, url);
    await captions.show("Home");
    await sleep(1200);
  }
}

async function runStep(page: Page, captions: Captions, step: Step, baseUrl: string): Promise<void> {
  if (step.caption) await captions.show(step.caption);
  switch (step.action) {
    case "click": {
      const before = page.url();
      await pointAt(page, captions, step.selector!);
      await page.locator(step.selector!).first().click({ timeout: 10_000 });
      await settle(page, 5_000);
      if (page.url() !== before) await captions.reinject();
      break;
    }
    case "type":
      await pointAt(page, captions, step.selector!);
      await page.locator(step.selector!).first().pressSequentially(step.text!, { delay: 60 });
      break;
    case "wait":
      if (step.selector) await page.locator(step.selector).first().waitFor({ timeout: step.ms ?? 10_000 });
      else await sleep(step.ms!);
      break;
    case "scroll":
      if (step.selector) {
        const y = await page
          .locator(step.selector)
          .first()
          .evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 80);
        await smoothScrollTo(page, Math.max(0, y));
      } else {
        await smoothScrollTo(page, step.y!);
      }
      break;
    case "goto":
      await gotoAndSettle(page, captions, new URL(step.url!, baseUrl).href);
      if (step.caption) await captions.show(step.caption);
      break;
  }
  await sleep(step.action === "wait" ? 0 : 600);
}

/** Record the walkthrough and return the path of the saved .webm. */
export async function record(opts: RecordOptions): Promise<Recording> {
  const log = opts.log ?? (() => {});
  await mkdir(opts.outDir, { recursive: true });
  const tmpDir = path.join(opts.outDir, ".raw");
  const browser = await chromium.launch({ headless: true });
  let webm: string | undefined;
  let leadSeconds = 0;
  zoomEnabled = opts.zoom !== false;
  const SIZE = SIZES[opts.size ?? "720p"];
  try {
    const context = await browser.newContext({
      viewport: SIZE,
      recordVideo: { dir: tmpDir, size: SIZE },
    });
    const page = await context.newPage();
    const t0 = Date.now();
    const captions = await Captions.attach(context, page);
    try {
      log(`loading ${opts.url}`);
      await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const fcp = await page
        .evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0)
        .catch(() => 0);
      const navStart = Date.now() - (await page.evaluate(() => performance.now()).catch(() => 0));
      leadSeconds = Math.max(0, (navStart + fcp - t0) / 1000 - 0.1);
      await settle(page);
      await captions.reinject();
      const cards = opts.cards === false ? undefined : opts.cards ?? {};
      if (cards) {
        const title = cards.title || (await page.title()) || new URL(opts.url).hostname;
        await showCard(captions, title, opts.url);
      }
      if (opts.script) {
        for (const [i, step] of opts.script.steps.entries()) {
          log(`step ${i + 1}/${opts.script.steps.length}: ${step.action}`);
          await runStep(page, captions, step, opts.url);
        }
        await sleep(800);
      } else {
        await defaultWalkthrough(page, captions, opts.url, log);
      }
      if (cards) {
        await captions.show("");
        await showCard(captions, `Built by ${cards.author || gitUser() || "the author"}`, opts.url);
      }
    } finally {
      const video = page.video();
      await context.close();
      if (video) webm = await video.path();
    }
  } finally {
    await browser.close();
  }
  if (!webm) throw new Error("No video was recorded");
  const dest = path.join(opts.outDir, "demo.webm");
  try {
    await rename(webm, dest);
  } catch {
    await copyFile(webm, dest);
    await unlink(webm).catch(() => {});
  }
  await import("node:fs/promises").then((fs) => fs.rm(tmpDir, { recursive: true, force: true }));
  return { webmPath: dest, leadSeconds: Math.round(leadSeconds * 100) / 100 };
}
