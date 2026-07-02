const path = require("path");
const { chromium } = require("C:/Users/aouiaiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright");

const pages = [
  ["dashboard", "theme-dashboard.png"],
  ["bills", "theme-bills.png"],
  ["subscriptions", "theme-subscriptions.png"],
  ["favors", "theme-favors.png"],
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  const authModal = page.locator("#authModal");
  if (await authModal.isVisible().catch(() => false)) {
    await page.fill('#authForm input[name="email"], #authForm input[name="username"]', "admin");
    await page.fill('#authForm input[name="password"]', "hub2026");
    await page.click("#authSubmitButton");
    await page.waitForFunction(() => !document.body.classList.contains("auth-gate-active"), null, { timeout: 5000 });
  }

  for (const [pageId, filename] of pages) {
    await page.click(`[data-page="${pageId}"]`);
    await page.waitForFunction((active) => document.body.dataset.activePage === active, pageId, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(process.cwd(), filename), fullPage: true });
  }

  await browser.close();
})();
