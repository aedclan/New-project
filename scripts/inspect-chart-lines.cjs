const { chromium } = require("C:/Users/aouiaiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  if (await page.locator("#authModal").isVisible().catch(() => false)) {
    await page.fill('#authForm input[name="email"], #authForm input[name="username"]', "admin");
    await page.fill('#authForm input[name="password"]', "hub2026");
    await page.click("#authSubmitButton");
    await page.waitForFunction(() => !document.body.classList.contains("auth-gate-active"), null, { timeout: 5000 });
  }
  await page.click('[data-page="bills"]');
  await page.waitForFunction(() => document.body.dataset.activePage === "bills", null, { timeout: 5000 });
  await page.waitForTimeout(500);
  const rows = await page.$$eval(".bill-trend-line, .bill-forecast-control-line", (nodes) =>
    nodes.slice(0, 20).map((node) => ({
      className: node.getAttribute("class"),
      attr: node.getAttribute("stroke-width"),
      style: node.getAttribute("style"),
      computed: getComputedStyle(node).strokeWidth,
      stroke: getComputedStyle(node).stroke,
    })),
  );
  console.log(JSON.stringify(rows, null, 2));
  await browser.close();
})();
