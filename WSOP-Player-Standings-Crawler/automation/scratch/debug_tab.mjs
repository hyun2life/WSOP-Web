import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log("Navigating to player page...");
  await page.goto("https://www.wsop.com/players/benjamin-tollerene/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => console.log("Load state timed out, proceeding anyway"));
  
  // Hydration 대기를 위해 클릭 전 5초간 대기
  console.log("Waiting 5 seconds for hydration/scripts to initialize...");
  await page.waitForTimeout(5000);

  console.log("ALL tab table rows before click:");
  const allRowsBefore = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
  console.log("ALL tab table rows count:", allRowsBefore);

  // Click Title tab
  console.log("Clicking Title tab...");
  const titleTab = page.locator('button:has-text("Title"), a:has-text("Title"), [role=tab]:has-text("Title")').first();
  await titleTab.click();
  
  console.log("Waiting 3 seconds for tab content to render...");
  await page.waitForTimeout(3000);
  
  // Inspect table contents after click
  const tableContent = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return "No table found";
    
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return {
      rowCount: rows.length,
      rowTexts: rows.map(r => r.innerText.replace(/\s+/g, ' ').trim())
    };
  });
  
  console.log("Table contents after clicking Title tab:", JSON.stringify(tableContent, null, 2));

  await browser.close();
}

run().catch(console.error);
