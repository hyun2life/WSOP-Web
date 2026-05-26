import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to Elton Tsang profile...');
  await page.goto('https://www.wsop.com/players/15758249/', { waitUntil: 'networkidle' });

  const tables = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('table')).map((table, tIdx) => {
      const rows = Array.from(table.querySelectorAll('tr')).map((row, rIdx) => {
        return {
          rIdx,
          text: row.textContent?.replace(/\s+/g, ' ').trim() || '',
          html: row.outerHTML.slice(0, 200),
          visible: (() => {
            const style = window.getComputedStyle(row);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = row.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })()
        };
      });
      return { tIdx, rows };
    });
  });

  console.log(`Found ${tables.length} tables`);
  for (const table of tables) {
    console.log(`\n--- Table ${table.tIdx} (Row Count: ${table.rows.length}) ---`);
    for (const row of table.rows) {
      console.log(`Row ${row.rIdx} [Visible: ${row.visible}]: ${row.text}`);
    }
  }

  await browser.close();
}

main().catch(console.error);
