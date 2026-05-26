const { chromium } = require('playwright');

// Helper functions from crawl_player_standings.mjs
function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function parseRank(value) {
  const text = normalizeText(value);
  const patterns = [
    /(?:^|\s)(\d{1,5})\s*\/\s*\d{1,6}(?:\s|$)/,
    /(?:^|\s)#\s*(\d{1,5})(?:st|nd|rd|th)?(?:\s|$)/i,
    /(?:^|\s)(\d{1,5})(?:st|nd|rd|th)(?:\s|$)/i,
    /(?:place|rank|finish|result)\D{0,12}(\d{1,5})/i,
    /^(\d{1,5})$/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}
function parseMoney(value) {
  const text = normalizeText(value);
  const match = text.match(/(?:[^-\d]*)(-?\d[\d,]*(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}
function valueByHeader(row, patterns) {
  for (let i = 0; i < row.headers.length; i += 1) {
    const header = normalizeText(row.headers[i]);
    if (patterns.some((pattern) => pattern.test(header))) return row.cells[i] || "";
  }
  return "";
}
function normalizeEvent(row) {
  const rankSource =
    valueByHeader(row, [/rank/i, /place/i, /finish/i, /result/i]) ||
    row.cells.find((cell) => parseRank(cell) !== null) ||
    row.text;
  const dateSource =
    valueByHeader(row, [/date/i]) ||
    row.cells.find((cell) => /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(cell)) ||
    "";
  const earningSource =
    valueByHeader(row, [/earning/i, /prize/i, /winnings/i, /cash/i]) ||
    row.cells.find((cell) => /[$₩₱€£¥]/.test(cell)) ||
    "";
  const eventSource =
    valueByHeader(row, [/event/i, /tournament/i, /series/i]) ||
    row.cells.find((cell) => !/[$₩₱€£¥]/.test(cell) && parseRank(cell) === null && !/^result$/i.test(cell)) ||
    row.text;

  return {
    rowIndex: row.rowIndex,
    eventName: normalizeText(eventSource),
    date: normalizeText(dateSource),
    rankText: normalizeText(rankSource),
    rank: parseRank(rankSource),
    earnings: parseMoney(earningSource),
    rowText: row.text,
    cells: row.cells
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to Elton Tsang profile...');
  await page.goto('https://www.wsop.com/players/15758249/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const result = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const rows = [];
    let rowIndex = 0;

    function headersForTable(table) {
      // thead tr 이나 tr 중 th를 가진 행을 찾음
      for (const row of Array.from(table.querySelectorAll("thead tr, tr")).slice(0, 2)) {
        const cells = Array.from(row.querySelectorAll("th"));
        if (cells.length) return cells.map((cell) => normalize(cell.textContent));
      }
      return [];
    }

    function looksLikeEventRow(text) {
      return /[$₩₱€£¥]\s*[\d,]+/.test(text) || /\b(result|results|place|rank|finish|event|bracelet|ring|circuit|wsop)\b/i.test(text);
    }

    function isVisibleElement(element) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
      return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    }

    for (const table of Array.from(document.querySelectorAll("table"))) {
      if (!isVisibleElement(table)) continue;
      const headers = headersForTable(table);
      const tableRows = Array.from(table.querySelectorAll("tbody tr")).length
        ? Array.from(table.querySelectorAll("tbody tr"))
        : Array.from(table.querySelectorAll("tr")).slice(headers.length ? 1 : 0);

      for (const row of tableRows) {
        if (!isVisibleElement(row)) continue;
        const cells = Array.from(row.querySelectorAll("td, th")).map((cell) => normalize(cell.textContent));
        const text = normalize(row.textContent);
        
        // looksLikeEventRow 필터 결과 저장
        const passesLooksLike = looksLikeEventRow(text);

        rows.push({
          rowIndex,
          text,
          cells,
          headers,
          passesLooksLike
        });
        rowIndex += 1;
      }
    }
    return rows;
  });

  console.log(`Evaluated ${result.length} raw rows`);

  const processed = result.map(normalizeEvent);
  
  processed.forEach((event, idx) => {
    const raw = result[idx];
    const eventName = normalizeText(event.eventName);
    const hasEventShape = event.cells.length >= 3 && eventName && !/^series\s*\/?\s*events?$/i.test(eventName);
    const passesFinalFilter = hasEventShape || event.rank !== null || event.earnings !== null;
    
    console.log(`\nRow ${event.rowIndex}: "${event.rowText.slice(0, 80)}..."`);
    console.log(`  - passesLooksLikeEventRow: ${raw.passesLooksLike}`);
    console.log(`  - headers: ${JSON.stringify(raw.headers)}`);
    console.log(`  - cells (${event.cells.length}): ${JSON.stringify(event.cells)}`);
    console.log(`  - eventName: "${event.eventName}"`);
    console.log(`  - hasEventShape: ${hasEventShape}`);
    console.log(`  - rank: ${event.rank} (${event.rankText})`);
    console.log(`  - earnings: ${event.earnings}`);
    console.log(`  - passesFinalFilter: ${passesFinalFilter}`);
  });

  await browser.close();
}

main().catch(console.error);
