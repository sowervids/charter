/**
 * UI self-review harness: screenshots every surface and runs the Phase 1
 * exit-criterion timing (two windows converge < 200ms). Dev tool, not CI.
 *
 *   node scripts/ui-review.mjs
 */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const token = readFileSync("var/api_token", "utf8").trim();
const base = "http://127.0.0.1:4614";
mkdirSync("var/shots", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});

const page = await ctx.newPage();
await page.goto(`${base}/?token=${token}`);
await page.waitForSelector("text=devlog", { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: "var/shots/01-general.png" });

// devlog channel: Phase-0 events must render retroactively
await page.click("text=devlog");
await page.waitForTimeout(400);
await page.screenshot({ path: "var/shots/02-devlog.png" });

// composer: send a message
await page.click("textarea");
await page.keyboard.type("First message sent through the Charter UI itself.");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
await page.screenshot({ path: "var/shots/03-devlog-after-send.png" });

// palette
await page.keyboard.press("Meta+k");
await page.waitForTimeout(250);
await page.screenshot({ path: "var/shots/04-palette.png" });
await page.keyboard.press("Escape");

// log view
await page.click("text=Log");
await page.waitForTimeout(400);
await page.screenshot({ path: "var/shots/05-log.png" });

// gallery (no daemon required, but same origin serves it)
await page.goto(`${base}/dev/gallery`);
await page.waitForTimeout(400);
await page.screenshot({ path: "var/shots/06-gallery.png", fullPage: true });

// ---- Exit criterion: two windows converge < 200ms ----
const a = await ctx.newPage();
const b = await ctx.newPage();
await a.goto(`${base}/c/general?token=${token}`);
await b.goto(`${base}/c/general?token=${token}`);
await a.waitForSelector("textarea");
await b.waitForSelector("textarea");
await a.waitForTimeout(500);

const marker = `convergence-${Date.now()}`;
const started = Date.now();
await a.click("textarea");
await a.keyboard.type(marker);
await a.keyboard.press("Enter");
await b.waitForSelector(`text=${marker}`, { timeout: 5000 });
const elapsed = Date.now() - started;
console.log(`convergence: window B saw window A's message in ${elapsed}ms (budget: 200ms + typing time)`);

await b.screenshot({ path: "var/shots/07-window-b-converged.png" });

await browser.close();
console.log("screenshots in var/shots/");
