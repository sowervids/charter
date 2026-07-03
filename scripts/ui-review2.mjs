import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const token = readFileSync("var/api_token", "utf8").trim();
const base = "http://127.0.0.1:4614";
mkdirSync("var/shots2", { recursive: true });
const shot = (page, name) => page.screenshot({ path: `var/shots2/${name}.png` });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 940 }, colorScheme: "dark" });
const page = await ctx.newPage();
const log = (m) => console.log(m);

await page.goto(`${base}/?token=${token}`);
await page.waitForSelector("text=devlog", { timeout: 8000 });
await page.waitForTimeout(500);

// 1. general channel — avatars, grouping, agent hues
await page.click("text=general");
await page.waitForTimeout(400);
await shot(page, "01-channel");

// 2. @mention autocomplete
await page.click("textarea");
await page.keyboard.type("@");
await page.waitForTimeout(300);
const popover = await page.locator("text=Mention").count();
log(`mention popover visible: ${popover > 0}`);
await shot(page, "02-mention-popover");
await page.keyboard.type("res");
await page.waitForTimeout(200);
await shot(page, "03-mention-filtered");

// 3. send a mention → agent run appears
await page.keyboard.press("Escape");
await page.fill("textarea", "");
await page.click("textarea");
await page.keyboard.type("@research in one sentence, what does the Keelson event log store?");
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
await shot(page, "04-after-mention-send");

// 4. Board — create + drawer
await page.click("text=Board");
await page.waitForTimeout(400);
await shot(page, "05-board");
await page.click("text=New task");
await page.waitForTimeout(300);
await page.fill('input[placeholder="Title"]', "Test the new board UI");
await page.fill('textarea[placeholder*="Details"]', "Verify drag, delete, and the detail drawer all work.");
await shot(page, "06-new-task-dialog");
await page.click("button:has-text('Create')");
await page.waitForTimeout(600);
await shot(page, "07-board-with-task");
// open the task drawer
await page.click("text=Test the new board UI");
await page.waitForTimeout(500);
await shot(page, "08-task-drawer");

// 5. People & Agents
await page.click("text=People");
await page.waitForTimeout(500);
await shot(page, "09-people");
await page.click("text=@research");
await page.waitForTimeout(600);
await shot(page, "10-agent-detail-charter");
await page.click("button:has-text('policy')").catch(() => {});
await page.waitForTimeout(300);
await shot(page, "11-agent-policy");
await page.click("button:has-text('budget')").catch(() => {});
await page.waitForTimeout(300);
await shot(page, "12-agent-budget");

// 6. Treasury
await page.click("text=Treasury");
await page.waitForTimeout(500);
await shot(page, "13-treasury");

// 7. Connections
await page.click("text=Connections");
await page.waitForTimeout(500);
await shot(page, "14-connections");

// 8. Approvals
await page.click("text=Approvals");
await page.waitForTimeout(400);
await shot(page, "15-approvals");

// 9. Command palette
await page.keyboard.press("Meta+k");
await page.waitForTimeout(300);
await shot(page, "16-palette");
await page.keyboard.press("Escape");

// composer border close-up on a channel
await page.click("text=general");
await page.waitForTimeout(300);
await page.click("textarea");
await page.keyboard.type("checking the composer focus ring");
await shot(page, "17-composer-focus");

await browser.close();
log("screenshots in var/shots2/");
