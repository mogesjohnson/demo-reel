import { chromium } from "playwright";
import type { DemoScript, Step } from "./script";

interface Found {
  headings: { text: string; y: number }[];
  nav: { text: string; selector: string }[];
  buttons: { text: string; selector: string }[];
  inputs: { selector: string; type: string; name: string }[];
}

/** Sample value for a form input, by its type and name. Never submits. */
export function sampleFor(type: string, name: string): string {
  const n = name.toLowerCase();
  if (type === "email" || n.includes("email")) return "ada@example.com";
  if (type === "tel" || n.includes("phone")) return "555-0100";
  if (type === "url") return "https://example.com";
  if (type === "number") return "42";
  if (type === "date") return "2026-01-15";
  if (type === "password") return "demo-password";
  if (type === "search" || n.includes("search")) return "demo";
  if (n.includes("name")) return "Ada Lovelace";
  if (type === "textarea") return "Hello! This is a demo message.";
  return "Sample text";
}

/** Load `url` and build a sensible demo script from its headings, nav, buttons and first form. */
export async function writeAutoScript(url: string): Promise<DemoScript> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const found: Found = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const label = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const sel = (el: Element): string => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const href = el.getAttribute("href");
        if (el.tagName === "A" && href) return `a[href="${href.replace(/"/g, '\\"')}"]`;
        const name = el.getAttribute("name");
        if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
        const t = label(el);
        return t ? `${el.tagName.toLowerCase()}:has-text("${t.replace(/"/g, "")}")` : el.tagName.toLowerCase();
      };
      const headings = Array.from(document.querySelectorAll("h1, h2")).filter(visible).slice(0, 4)
        .map((h) => ({ text: label(h), y: Math.max(0, (h as HTMLElement).getBoundingClientRect().top + scrollY - 80) }))
        .filter((h) => h.text);
      const origin = location.origin;
      const nav = Array.from(document.querySelectorAll("nav a[href], header a[href]")).filter(visible)
        .filter((a) => { try { const u = new URL((a as HTMLAnchorElement).href); return u.origin === origin && u.pathname !== location.pathname; } catch { return false; } })
        .filter((a) => label(a)).slice(0, 3).map((a) => ({ text: label(a), selector: sel(a) }));
      const buttons = Array.from(document.querySelectorAll("main button, main a.btn, main a.button, button.primary, .btn-primary, [class*=cta]"))
        .filter(visible).filter((b) => label(b) && !b.closest("form")).slice(0, 1).map((b) => ({ text: label(b), selector: sel(b) }));
      const form = document.querySelector("form");
      const inputs = form ? Array.from(form.querySelectorAll("input, textarea")).filter(visible)
        .filter((i) => !["hidden", "submit", "button", "checkbox", "radio", "file", "reset", "image"].includes((i as HTMLInputElement).type))
        .slice(0, 5).map((i) => ({ selector: sel(i), type: i.tagName === "TEXTAREA" ? "textarea" : (i as HTMLInputElement).type, name: (i.getAttribute("name") || i.getAttribute("placeholder") || i.id || "") }))
        : [];
      return { headings, nav, buttons, inputs };
    });
    const steps: Step[] = [{ action: "wait", ms: 800, caption: "Home" }];
    for (const h of found.headings) steps.push({ action: "scroll", y: Math.round(h.y), caption: h.text }, { action: "wait", ms: 900 });
    if (found.inputs.length) {
      steps.push({ action: "scroll", y: 0 });
      for (const [i, inp] of found.inputs.entries()) {
        steps.push({ action: "type", selector: inp.selector, text: sampleFor(inp.type, inp.name), ...(i === 0 ? { caption: "Filling in the form" } : {}) });
      }
      steps.push({ action: "wait", ms: 1000 });
    }
    for (const b of found.buttons) steps.push({ action: "scroll", y: 0 }, { action: "wait", ms: 600, caption: `Primary action: ${b.text}` });
    for (const n of found.nav) {
      steps.push({ action: "click", selector: n.selector, caption: `Visiting: ${n.text}` }, { action: "wait", ms: 1200 }, { action: "goto", url });
    }
    steps.push({ action: "wait", ms: 800 });
    return { steps };
  } finally {
    await browser.close();
  }
}
