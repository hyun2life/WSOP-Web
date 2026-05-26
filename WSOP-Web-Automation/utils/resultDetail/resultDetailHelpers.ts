import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { expectHrefContains, expectTextSimilar, normalizePlayerName, normalizeText } from './resultRowAssertions';

export type ResultKnownException = {
  reason?: string;
  warningOnly?: boolean;
  allowMultipleContextMentions?: boolean;
  requireProfileTarget?: boolean;
};

export type ResultDetailPlayerRow = {
  placeText: string;
  playerName: string;
  countryText: string;
  earningsText: string;
  playerHref: string;
  rowText: string;
};

export async function openResultDetail(page: Page, resultHref: string) {
  const response = await page.goto(resultHref, { waitUntil: 'domcontentloaded' });
  expect(response, `Result detail should return response: ${resultHref}`).not.toBeNull();
  expect(response!.status(), `Result detail status should be < 400: ${resultHref}`).toBeLessThan(400);
  expect(page.url().toLowerCase().includes('/tournaments/result/'), `Result detail URL should include /tournaments/result/: ${page.url()}`).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
}

export async function assertResultDetailBasicMeta(page: Page, expectedRow?: { eventName?: string; rowText?: string }) {
  const metaSignals = ['Event', 'Start Date', 'End Date', 'Buy-in', 'Entries', 'Prize', 'ITM', 'Winner', 'Final Result'];
  const surface = page.locator('main, [role="main"], section, article, [class*="result" i], [class*="event" i]');
  const text = normalizeText(await surface.first().innerText().catch(async () => page.locator('body').innerText().catch(() => '')));
  const matched = metaSignals.filter((signal) => text.includes(normalizeText(signal))).length;
  expect(matched, `Result detail page should expose basic meta fields. url=${page.url()}`).toBeGreaterThan(0);

  if (expectedRow?.eventName) {
    const eventCandidate = expectedRow.eventName.trim();
    if (eventCandidate && !/^results?$/i.test(eventCandidate)) {
      expectTextSimilar(text, eventCandidate, `Result detail event signal check url=${page.url()}`);
    }
  }
}

export async function assertResultTableVisible(page: Page) {
  const listSurface = page.locator('table, [role="table"], [role="grid"], ul, ol, [class*="result" i], [class*="list" i], [class*="player" i]');
  const hasSurface = (await listSurface.count()) > 0 && (await listSurface.first().isVisible().catch(() => false));
  expect(hasSurface, `Result detail should expose table/list surface: ${page.url()}`).toBeTruthy();

  const text = await page.locator('body').innerText().catch(() => '');
  const hasColumnSignals = /\b(no|player|country|earnings|place|rank)\b/i.test(text);
  const playerLinks = await page.locator('a[href*="/players/"]').count();
  expect(hasColumnSignals || playerLinks > 0, `Result detail should show column/list signals or player links: ${page.url()}`).toBeTruthy();
}

export async function collectResultDetailPlayerRows(page: Page): Promise<ResultDetailPlayerRow[]> {
  const containers = page.locator('table, [role="table"], [role="grid"], ul, ol, [class*="result" i], [class*="list" i], [class*="player" i]');
  const rows = containers.locator('tr, [role="row"], li, [class*="row" i], [class*="item" i], article, section, div');
  const rowCount = await rows.count();
  const collected: ResultDetailPlayerRow[] = [];

  for (let index = 0; index < Math.min(rowCount, 500); index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const parsed = await parseResultDetailRow(row);
    if (!parsed) continue;
    if (!parsed.playerHref && normalizeText(parsed.playerName).length === 0) continue;
    collected.push(parsed);
  }

  const unique = dedupeRows(collected);
  return unique;
}

export function findPlayerRowInResultDetail(
  rows: ResultDetailPlayerRow[],
  player: { displayName: string },
  expectedRow?: { rowText?: string; earningsText?: string },
  knownException?: ResultKnownException,
) {
  const normalizedPlayer = normalizePlayerName(player.displayName);
  let found =
    rows.find((row) => normalizePlayerName(row.playerName) === normalizedPlayer) ??
    rows.find((row) => normalizePlayerName(row.rowText).includes(normalizedPlayer));

  if (!found && knownException?.allowMultipleContextMentions) {
    found = rows.find((row) => normalizeText(row.rowText).includes(normalizeText(player.displayName.split(' ')[0] || player.displayName)));
  }

  if (found && expectedRow?.earningsText && found.earningsText) {
    const expectedEarnings = normalizeText(expectedRow.earningsText).replace(/[^\d.,$]/g, '');
    const actualEarnings = normalizeText(found.earningsText).replace(/[^\d.,$]/g, '');
    if (expectedEarnings && actualEarnings && expectedEarnings !== actualEarnings) {
      addWarning('phase5-earnings-expression', 'Profile row earnings and result detail row earnings differ in expression.', {
        displayName: player.displayName,
        expectedEarnings: expectedRow.earningsText,
        actualEarnings: found.earningsText,
      });
    }
  }

  return found ?? null;
}

export function assertResultDetailPlayerRow(
  row: ResultDetailPlayerRow | null,
  player: { displayName: string; expectedProfileUrlContains?: string; profileUrl: string },
  knownException?: ResultKnownException,
) {
  expect(row, `Result detail row should exist for player: ${player.displayName} profile=${player.profileUrl}`).not.toBeNull();
  const requiredRow = row as ResultDetailPlayerRow;

  expect(
    normalizePlayerName(requiredRow.rowText).includes(normalizePlayerName(player.displayName)) ||
      normalizePlayerName(requiredRow.playerName).includes(normalizePlayerName(player.displayName)),
    `Result detail row should contain player name: ${player.displayName}. row="${requiredRow.rowText.slice(0, 180)}"`,
  ).toBeTruthy();

  const hasCoreStat = normalizeText(requiredRow.placeText).length > 0 || normalizeText(requiredRow.earningsText).length > 0;
  expect(hasCoreStat, `Result detail row should expose place or earnings: ${player.displayName}`).toBeTruthy();

  if (requiredRow.playerHref) {
    const expected = player.expectedProfileUrlContains || '/players/';
    expectHrefContains(requiredRow.playerHref, expected, `Result detail player href should match target: ${player.displayName}`);
  } else if (knownException?.warningOnly) {
    addWarning('phase5-legacy-player-link', 'Legacy result row has player text but no profile link.', {
      displayName: player.displayName,
      reason: knownException.reason ?? 'legacy-player-link-missing',
      rowText: requiredRow.rowText.slice(0, 180),
    });
  } else {
    expect(false, `Result detail player link is missing: ${player.displayName} row="${requiredRow.rowText.slice(0, 180)}"`).toBeTruthy();
  }
}

async function parseResultDetailRow(row: Locator): Promise<ResultDetailPlayerRow | null> {
  const rowText = normalizeWhitespace(await row.innerText().catch(() => ''));
  if (!rowText) return null;

  const playerLink = row.locator('a[href*="/players/"]').first();
  const playerHref = (await playerLink.getAttribute('href').catch(() => '')) || '';
  const playerName = normalizeWhitespace(await playerLink.innerText().catch(() => inferPlayerName(rowText)));
  const placeMatch = rowText.match(/\b(?:#?\d{1,4}|(?:\d{1,4})(?:st|nd|rd|th)|(?:rank|place)\s*[:#]?\s*\d{1,4})\b/i);
  const earningsMatch = rowText.match(/\$\s?[\d,]+(?:\.\d+)?|\b(?:usd|eur)\s?[\d,]+/i);

  const countryText = inferCountryText(rowText);
  return {
    placeText: placeMatch?.[0] ?? '',
    playerName,
    countryText,
    earningsText: earningsMatch?.[0] ?? '',
    playerHref,
    rowText,
  };
}

function inferPlayerName(text: string) {
  const parts = text.split(/\s{2,}|\|/).map((item) => normalizeWhitespace(item)).filter(Boolean);
  return parts.find((part) => /^[A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,4}$/.test(part)) ?? '';
}

function inferCountryText(text: string) {
  const countryMatch = text.match(
    /\b(United States|USA|Canada|United Kingdom|England|Germany|France|Spain|Italy|Brazil|Australia|Norway|Sweden|Finland|Netherlands|Taiwan|China|Japan|South Korea|Belgium|Luxembourg|New Zealand)\b/i,
  );
  return countryMatch?.[0] ?? '';
}

function dedupeRows(rows: ResultDetailPlayerRow[]) {
  const seen = new Set<string>();
  const unique: ResultDetailPlayerRow[] = [];
  for (const row of rows) {
    const key = `${normalizePlayerName(row.playerName)}|${normalizeText(row.earningsText)}|${normalizeText(row.rowText).slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
