import { expect, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { expectHrefContains, normalizeText } from './resultRowAssertions';

export type ResultDetailPlayerFixture = {
  displayName: string;
  profileUrl: string;
  expectedResultLinkContains?: string;
  minResultRows?: number;
  sampleResultClickCount?: number;
  expectedProfileUrlContains?: string;
  knownExceptionKey?: string;
};

export type ProfileResultRow = {
  seriesName: string;
  eventName: string;
  dateText: string;
  rankText: string;
  earningsText: string;
  resultHref: string;
  rowText: string;
};

export async function openPlayerProfileForResults(page: Page, player: ResultDetailPlayerFixture) {
  const response = await page.goto(player.profileUrl, { waitUntil: 'domcontentloaded' });
  expect(response, `Profile should return response: ${player.displayName} ${player.profileUrl}`).not.toBeNull();
  expect(response!.status(), `Profile status should be < 400: ${player.displayName} ${player.profileUrl}`).toBeLessThan(400);
  await expect(page.locator('body'), `Profile body should be visible: ${player.displayName}`).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

  const mainSurface = page.locator('main, [role="main"], article, section').first();
  const profileText = await mainSurface.innerText().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const text = `${profileText} ${bodyText}`;
  expect(
    normalizeText(text).includes(normalizeText(player.displayName)),
    `Profile should show display name: ${player.displayName} ${player.profileUrl}`,
  ).toBeTruthy();

  const profileSignals = ['Stats', 'Series', 'Events', 'Results', 'Total Earnings'];
  const visibleSignalCount = profileSignals.filter((signal) => new RegExp(`\\b${signal}\\b`, 'i').test(text)).length;
  expect(visibleSignalCount, `Profile should show results/stat area signals: ${player.displayName}`).toBeGreaterThan(0);

  await focusResultsTabIfExists(page);
}

export async function collectResultRowsFromProfile(page: Page, player: ResultDetailPlayerFixture): Promise<ProfileResultRow[]> {
  const resultLinkRows = await page.locator('a[href*="/tournaments/result/"]').evaluateAll((links, playerNameRaw) =>
    links
      .slice(0, 120)
      .map((link) => {
        const normalize = (value) => (value || '').toLowerCase().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const playerName = normalize(String(playerNameRaw || ''));

        let rowNode =
          link.closest('tr, [role="row"], li, article, section, [class*="row"], [class*="item"], [class*="result"]') ||
          link.parentElement;
        let cursor = link.parentElement;
        let best = rowNode;
        let bestScore = 0;
        for (let depth = 0; depth < 6 && cursor; depth += 1) {
          const text = normalize(cursor.textContent || '');
          const score = Math.min(text.length, 600) + (playerName && text.includes(playerName) ? 1000 : 0);
          if (score > bestScore) {
            best = cursor;
            bestScore = score;
          }
          cursor = cursor.parentElement;
        }
        rowNode = best || rowNode;
        const rowText = (rowNode?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const href = link.getAttribute('href') || '';
        const linkText = (link.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return { rowText, href, linkText };
      })
      .filter((item) => item.href && item.rowText),
    player.displayName,
  );

  const collected: ProfileResultRow[] = resultLinkRows
    .filter((item) => isResultDetailHref(item.href))
    .map((item) => {
    const dateMatch = item.rowText.match(/\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b/);
    const rankMatch = item.rowText.match(/\b(?:rank|place|pos(?:ition)?)\s*[:#]?\s*\d+\b|\b\d{1,4}(?:st|nd|rd|th)\b/i);
    const earningsMatch = item.rowText.match(/\$\s?[\d,]+(?:\.\d+)?|\b(?:usd|eur)\s?[\d,]+/i);
    return {
      seriesName: '',
      eventName: item.linkText || inferEventNameFromRow(item.rowText),
      dateText: dateMatch?.[0] ?? '',
      rankText: rankMatch?.[0] ?? '',
      earningsText: earningsMatch?.[0] ?? '',
      resultHref: item.href,
      rowText: item.rowText,
    };
  });

  const uniqueRows = dedupeRows(collected).slice(0, 80);
  const playerNameNormalized = normalizeText(player.displayName);
  const targetedRows = uniqueRows.filter((row) => normalizeText(row.rowText).includes(playerNameNormalized));
  const finalRows = targetedRows.length > 0 ? targetedRows : uniqueRows.filter((row) => normalizeText(row.rowText) !== 'results');
  const minRows = player.minResultRows ?? 3;
  expect(
    finalRows.length,
    `Profile results list should expose at least ${minRows} rows: ${player.displayName} ${player.profileUrl}`,
  ).toBeGreaterThanOrEqual(minRows);
  return finalRows;
}

export function pickSampleResultRows(rows: ProfileResultRow[], count: number) {
  const filtered = rows.filter((row) => {
    if (!isResultDetailHref(row.resultHref)) return false;
    if (normalizeText(row.rowText).length < 8) return false;
    if (/tbd|coming soon|n\/a/i.test(row.rowText)) return false;
    return true;
  });
  if (filtered.length > 0) {
    return filtered.slice(0, Math.max(1, count));
  }

  const fallbackRows = rows.filter((row) => isResultDetailHref(row.resultHref));
  if (fallbackRows.length > 0) {
    addWarning('phase5-sample-fallback', 'Profile result rows did not include rich row text; using fallback result links for sample clicks.', {
      fallbackCount: fallbackRows.length,
    });
  }
  return fallbackRows.slice(0, Math.max(1, count));
}

export function assertProfileResultRowBasicFields(row: ProfileResultRow, player: ResultDetailPlayerFixture) {
  expect(normalizeText(row.rowText).length, `Result row text should not be empty: ${player.displayName}`).toBeGreaterThan(0);
  const expectedHref = player.expectedResultLinkContains ?? '/tournaments/result/';
  expectHrefContains(row.resultHref, expectedHref, `Result href should match profile row: ${player.displayName}`);

  const hasEventInfo = normalizeText(row.eventName).length > 0 || normalizeText(row.seriesName).length > 0;
  expect(hasEventInfo, `Result row should show event or series: ${player.displayName} row="${row.rowText.slice(0, 120)}"`).toBeTruthy();

  const hasRankOrEarnings = normalizeText(row.rankText).length > 0 || normalizeText(row.earningsText).length > 0;
  if (!hasRankOrEarnings && normalizeText(row.rowText) !== 'results') {
    addWarning('phase5-profile-row-basic-fields', 'Result row has no rank/earnings text.', {
      displayName: player.displayName,
      profileUrl: player.profileUrl,
      rowText: row.rowText.slice(0, 180),
    });
  }
}

function inferEventNameFromRow(text: string) {
  const parts = text
    .split('|')
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  return parts.find((part) => /event|wsop|no-limit|pot-limit|hold'em|omaha/i.test(part)) ?? parts[0] ?? '';
}

function dedupeRows(rows: ProfileResultRow[]) {
  const seen = new Set<string>();
  const result: ProfileResultRow[] = [];
  for (const row of rows) {
    const key = `${normalizeText(row.resultHref)}|${normalizeText(row.eventName)}|${normalizeText(row.rowText).slice(0, 90)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function isResultDetailHref(value: string) {
  const href = normalizeText(value);
  return /\/tournaments\/result\/[^/\s?#]+/.test(href) && !/\/tournaments\/results\/?/.test(href);
}

async function focusResultsTabIfExists(page: Page) {
  const profileTab = page
    .locator('button, a, [role="tab"], [role="button"]')
    .filter({ hasText: /^results$/i })
    .first();

  if ((await profileTab.count()) === 0 || !(await profileTab.isVisible().catch(() => false))) {
    return;
  }

  const candidateContext = await profileTab
    .evaluate((node) => {
      const wrapper = node.closest('nav, ul, [role="tablist"], [class*="tab"], [class*="switch"], [class*="menu"]') || node.parentElement;
      const text = (wrapper?.textContent || '').toLowerCase();
      return text;
    })
    .catch(() => '');

  const looksLikeProfileTabs = /stats|series|events|results/.test(candidateContext) && !/final result|winner|entries|buy-in/.test(candidateContext);
  if (!looksLikeProfileTabs) {
    return;
  }

  const beforeUrl = page.url();
  await profileTab.click({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

  const afterUrl = page.url();
  if (!afterUrl.includes('/players/')) {
    await page.goto(beforeUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
