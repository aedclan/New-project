const path = require("path");
const { chromium } = require("C:/Users/aouiaiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright");

(async () => {
  const root = __dirname;
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(root, "index.html").replaceAll("\\", "/")}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(root, "insightflow-mint-website-screenshot.png"), fullPage: true });
  await browser.close();
})();
