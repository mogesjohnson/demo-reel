import type { BrowserContext, Page } from "playwright";

/**
 * Runs in the browser. Defines window.__demoReelCaption(text) which shows a
 * fixed bottom-center pill that fades in and out. Safe to run more than once.
 */
function installCaptionOverlay(): void {
  const w = window as unknown as {
    __demoReelCaption?: (text: string) => void;
    __demoReelPending?: string;
  };
  if (w.__demoReelCaption) return;
  const ensure = (): HTMLDivElement | null => {
    let el = document.getElementById("__demo-reel-caption") as HTMLDivElement | null;
    if (el) return el;
    if (!document.body) return null;
    el = document.createElement("div");
    el.id = "__demo-reel-caption";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%) translateY(8px)",
      zIndex: "2147483647",
      padding: "10px 22px",
      borderRadius: "999px",
      background: "rgba(17, 17, 17, 0.82)",
      color: "#fff",
      font: "600 18px/1.3 system-ui, -apple-system, Segoe UI, sans-serif",
      boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
      opacity: "0",
      transition: "opacity 300ms ease, transform 300ms ease",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      maxWidth: "90vw",
      overflow: "hidden",
      textOverflow: "ellipsis",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    return el;
  };
  w.__demoReelCaption = (text: string) => {
    w.__demoReelPending = text;
    const el = ensure();
    if (!el) return;
    if (!text) {
      el.style.opacity = "0";
      return;
    }
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(8px)";
    setTimeout(() => {
      el.textContent = text;
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0)";
    }, 150);
  };
  // After a navigation the init script runs before <body> exists; show the
  // pending caption once the DOM is ready.
  document.addEventListener("DOMContentLoaded", () => {
    if (w.__demoReelPending) w.__demoReelCaption?.(w.__demoReelPending);
  });
}

export class Captions {
  private current = "";

  constructor(private readonly page: Page) {}

  /** Register the overlay so it is re-installed on every navigation. */
  static async attach(context: BrowserContext, page: Page): Promise<Captions> {
    await context.addInitScript(installCaptionOverlay);
    const c = new Captions(page);
    await c.reinject();
    return c;
  }

  /** Inject into the current document (and restore the current caption). */
  async reinject(): Promise<void> {
    try {
      await this.page.evaluate(installCaptionOverlay);
      if (this.current) await this.show(this.current);
    } catch {
      // Page may be mid-navigation; the init script covers that case.
    }
  }

  async show(text: string): Promise<void> {
    this.current = text;
    try {
      await this.page.evaluate((t) => {
        const w = window as unknown as { __demoReelCaption?: (s: string) => void };
        w.__demoReelCaption?.(t);
      }, text);
    } catch {
      // ignore: navigation in progress
    }
  }
}
