import { chromium } from '@playwright/test';

async function main() {
  console.log('Launching browser to find results URL...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Navigating to tournament details page...');
    const response = await page.goto('https://www.wsop.com/tournaments/2026-wsop-circuit-planet-hollywood/', { waitUntil: 'domcontentloaded' });
    console.log(`Tournament details page response status: ${response?.status()}`);
    
    // Collect links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.getAttribute('href')
      }));
    });
    
    console.log(`Found ${links.length} links.`);
    
    console.log('\n--- First 30 links ---');
    links.slice(0, 30).forEach(l => {
      console.log(`Text: "${l.text}" | Href: "${l.href}"`);
    });
    
    console.log('\n--- Links matching tournaments/past-tournaments ---');
    const filtered = links.filter(l => 
      l.href && (l.href.includes('/tournaments/') || l.href.includes('past-tournaments'))
    );
    
    filtered.slice(0, 10).forEach(l => {
      console.log(`Text: "${l.text}" | Href: "${l.href}"`);
    });
    
  } catch (err) {
    console.error('Error during execution:', err);
  } finally {
    await browser.close();
  }
}

main();
