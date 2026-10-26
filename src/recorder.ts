import { chromium, type Page } from "playwright";
import { mkdir, rename, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Captions } from "./captions";
import type { DemoScript, Step } from "./script";

const SIZE = { width: 1280, height: 720 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RecordOptions {
  url: string;
  outDir: string;
  script?: DemoScript;
  log?: (msg: string) => void;
}

async function settle(page: Page, timeout = 10_000): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout });
  } catch {
    // Some pages never go idle; carry on.
  }
}

/** Scroll in small steps to `targetY` so the motion looks smooth on video. */
async function smoothScrollTo(page: Page, targetY: number, step = 120, delay = 40): Promise<void> {
  const startY = await page.evaluate(() => window.scrollY);
  const dist = targetY - startY;
  const n = Math.max(1, Math.ceil(Math.abs(dist) / step));
  for (let i = 1; i <= n; i++) {
    const y = Math.round(startY + (dist * i) / n);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(delay);
  }
}

async function scrollHeight(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  );
}

interface NavLink {
  href: string;
  text: string;
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
    out.push({ href: u.origin + u.pathname + u.search, text: l.text || u.pathname });
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
    await smoothScrollTo(page, h);
    await sleep(500);
    await smoothScrollTo(page, 0);
    await sleep(500);
  }
  const links = await findNavLinks(page);
  log(`found ${links.length} nav link(s)`);
  for (const link of links) {
    const label = link.text.replace(/\s+/g, " ").slice(0, 40);
    log(`visiting ${link.href}`);
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
      await page.locator(step.selector!).first().click({ timeout: 10_000 });
      await settle(page, 5_000);
      if (page.url() !== before) await captions.reinject();
      break;
    }
    case "type":
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
export async function record(opts: RecordOptions): Promise<string> {
  const log = opts.log ?? (() => {});
  await mkdir(opts.outDir, { recursive: true });
  const tmpDir = path.join(opts.outDir, ".raw");
  const browser = await chromium.launch({ headless: true });
  let webm: string | undefined;
  try {
    const context = await browser.newContext({
      viewport: SIZE,
      recordVideo: { dir: tmpDir, size: SIZE },
    });
    const page = await context.newPage();
    const captions = await Captions.attach(context, page);
    try {
      log(`loading ${opts.url}`);
      await gotoAndSettle(page, captions, opts.url);
      if (opts.script) {
        for (const [i, step] of opts.script.steps.entries()) {
          log(`step ${i + 1}/${opts.script.steps.length}: ${step.action}`);
          await runStep(page, captions, step, opts.url);
        }
        await sleep(800);
      } else {
        await defaultWalkthrough(page, captions, opts.url, log);
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
  return dest;
}
