import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("Navigating to player page...");
  await page.goto("https://www.wsop.com/players/benjamin-tollerene/", { waitUntil: "networkidle" });
  
  console.log("Page loaded. Active URL:", page.url());

  // ALL tab elements
  const allRowsBefore = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
  console.log("ALL tab table rows:", allRowsBefore);

  // Click Title tab
  console.log("Clicking Title tab...");
  const titleTab = page.locator('button:has-text("Title"), a:has-text("Title"), [role=tab]:has-text("Title")').first();
  await titleTab.click();
  await page.waitForTimeout(2000); // 2초 대기
  
  // Inspect tables
  const tablesInfo = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((t, idx) => {
      const style = window.getComputedStyle(t);
      const rows = Array.from(t.querySelectorAll('tbody tr, tr'));
      const visibleRows = rows.filter(r => {
        const rStyle = window.getComputedStyle(r);
        return rStyle.display !== 'none' && rStyle.visibility !== 'hidden';
      });
      return {
        index: idx,
        tagName: t.tagName,
        className: t.className,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        totalRows: rows.length,
        visibleRows: visibleRows.length,
        htmlSample: t.outerHTML.substring(0, 300)
      };
    });
  });
  
  console.log("Tables info after clicking Title tab:", JSON.stringify(tablesInfo, null, 2));

  await browser.close();
}

run().catch(console.error);
