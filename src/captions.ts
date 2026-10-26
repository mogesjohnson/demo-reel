import type { BrowserContext, Page } from "playwright";

/**
 * Runs in the browser. Installs window.__demoReel with a high-contrast caption
 * pill (theme picked from the page background luminance), a fake cursor with a
 * click ripple, and full-screen title cards. Safe to run more than once.
 */
function installOverlays(): void {
  type DR = {
    caption: (t: string) => void;
    cursorTo: (x: number, y: number, ms: number) => void;
    ripple: (x: number, y: number) => void;
    card: (title: string, sub: string) => void;
    hideCard: () => void;
    pending?: string;
    cx: number;
    cy: number;
  };
  const w = window as unknown as { __demoReel?: DR };
  if (w.__demoReel) return;
  const Z = "2147483647";

  const luminance = (): number => {
    const els = [document.body, document.documentElement].filter(Boolean) as HTMLElement[];
    for (const el of els) {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m) continue;
      const [r, g, b, a = 1] = m.map(Number);
      if (a === 0) continue;
      const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
    return 1; // default white page
  };
  const make = (id: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement | null => {
    let el = document.getElementById(id) as HTMLDivElement | null;
    if (el) return el;
    if (!document.body) return null;
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, { position: "fixed", zIndex: Z, pointerEvents: "none" }, style);
    document.body.appendChild(el);
    return el;
  };

  const pill = (): HTMLDivElement | null => {
    const dark = luminance() < 0.4; // dark page -> bright pill
    const el = make("__demo-reel-caption", {
      left: "50%",
      bottom: "36px",
      padding: "12px 26px",
      borderRadius: "999px",
      font: "700 20px/1.3 system-ui, -apple-system, Segoe UI, sans-serif",
      opacity: "0",
      transition: "opacity 300ms ease, transform 300ms ease",
      whiteSpace: "nowrap",
      maxWidth: "90vw",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    if (el) {
      el.style.background = dark ? "#fff7d6" : "#111827";
      el.style.color = dark ? "#111827" : "#ffffff";
      el.style.border = dark ? "2px solid #facc15" : "2px solid rgba(255,255,255,0.25)";
      el.style.boxShadow = dark
        ? "0 8px 32px rgba(250,204,21,0.35), 0 2px 8px rgba(0,0,0,0.5)"
        : "0 8px 28px rgba(0,0,0,0.35)";
    }
    return el;
  };

  const cursor = (): HTMLDivElement | null =>
    make("__demo-reel-cursor", {
      left: "0",
      top: "0",
      width: "22px",
      height: "22px",
      marginLeft: "-3px",
      marginTop: "-2px",
      background:
        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><path d='M3 2 L3 18 L7.5 14 L10.5 20.5 L13.5 19 L10.5 12.8 L16.5 12.8 Z' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'/></svg>\") no-repeat",
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))",
      transition: "transform 0ms linear",
    });

  const dr: DR = {
    cx: 640,
    cy: 360,
    caption(text) {
      dr.pending = text;
      const el = pill();
      if (!el) return;
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(10px)";
      if (!text) return;
      setTimeout(() => {
        el.textContent = text;
        el.style.opacity = "1";
        el.style.transform = "translateX(-50%) translateY(0)";
      }, 150);
    },
    cursorTo(x, y, ms) {
      const el = cursor();
      if (!el) return;
      const sx = dr.cx, sy = dr.cy, t0 = performance.now();
      const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / Math.max(1, ms));
        const e = ease(t);
        dr.cx = sx + (x - sx) * e;
        dr.cy = sy + (y - sy) * e;
        el.style.transform = `translate(${dr.cx}px, ${dr.cy}px)`;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    ripple(x, y) {
      const r = make("__demo-reel-ripple-" + Date.now(), {
        left: `${x - 24}px`,
        top: `${y - 24}px`,
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        border: "3px solid #facc15",
        background: "rgba(250,204,21,0.25)",
        transform: "scale(0.3)",
        opacity: "1",
        transition: "transform 450ms ease-out, opacity 450ms ease-out",
      });
      if (!r) return;
      requestAnimationFrame(() => {
        r.style.transform = "scale(1.6)";
        r.style.opacity = "0";
      });
      setTimeout(() => r.remove(), 600);
    },
    card(title, sub) {
      const el = make("__demo-reel-card", {
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "18px",
        background: "linear-gradient(135deg, #0f172a 0%, #312e81 100%)",
        color: "#fff",
        font: "800 56px/1.15 system-ui, -apple-system, Segoe UI, sans-serif",
        textAlign: "center",
        padding: "0 8vw",
        opacity: "0",
        transition: "opacity 350ms ease",
      });
      if (!el) return;
      el.innerHTML = "";
      const h = document.createElement("div");
      h.textContent = title;
      const s = document.createElement("div");
      s.textContent = sub;
      Object.assign(s.style, { font: "500 24px/1.4 system-ui, sans-serif", color: "#facc15" });
      el.append(h, s);
      requestAnimationFrame(() => (el.style.opacity = "1"));
    },
    hideCard() {
      const el = document.getElementById("__demo-reel-card");
      if (el) {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 400);
      }
    },
  };
  w.__demoReel = dr;
  document.addEventListener("DOMContentLoaded", () => {
    if (dr.pending) dr.caption(dr.pending);
  });
}

type Fn = "caption" | "cursorTo" | "ripple" | "card" | "hideCard";

export class Captions {
  private current = "";

  constructor(private readonly page: Page) {}

  /** Register the overlays so they are re-installed on every navigation. */
  static async attach(context: BrowserContext, page: Page): Promise<Captions> {
    await context.addInitScript(installOverlays);
    const c = new Captions(page);
    await c.reinject();
    return c;
  }

  private async call(fn: Fn, ...args: unknown[]): Promise<void> {
    try {
      await this.page.evaluate(
        ([f, a]) => {
          const w = window as unknown as { __demoReel?: Record<string, (...x: unknown[]) => void> };
          w.__demoReel?.[f as string]?.(...(a as unknown[]));
        },
        [fn, args] as const,
      );
    } catch {
      // ignore: navigation in progress
    }
  }

  /** Inject into the current document (and restore the current caption). */
  async reinject(): Promise<void> {
    try {
      await this.page.evaluate(installOverlays);
      if (this.current) await this.show(this.current);
    } catch {
      // Page may be mid-navigation; the init script covers that case.
    }
  }

  async show(text: string): Promise<void> {
    this.current = text;
    await this.call("caption", text);
  }

  /** Animate the fake cursor to (x, y) over `ms` and wait for it to arrive. */
  async moveCursor(x: number, y: number, ms = 600): Promise<void> {
    await this.call("cursorTo", x, y, ms);
    await new Promise((r) => setTimeout(r, ms + 50));
  }

  async ripple(x: number, y: number): Promise<void> {
    await this.call("ripple", x, y);
  }

  async card(title: string, sub: string): Promise<void> {
    await this.call("card", title, sub);
  }

  async hideCard(): Promise<void> {
    await this.call("hideCard");
  }
}
