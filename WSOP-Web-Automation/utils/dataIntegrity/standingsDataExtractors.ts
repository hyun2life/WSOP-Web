import type { Page } from '@playwright/test';
import type { ExpectedStandingsCategory } from './dataIntegrityTypes';
import { normalizePlayerName } from './dataNormalizers';

export interface ExtractedStandingsRow {
  rank: number;
  displayName: string;
  earnings: string;
  bracelets: number | null;
  rings: number | null;
  wins: number | null;
  finalTables: number | null;
  cashes: number | null;
  profileHref: string;
  rowText: string;
}

export async function extractStandingsSection(
  page: Page,
  category: ExpectedStandingsCategory
): Promise<ExtractedStandingsRow[]> {
  // 1. 해당 카테고리 섹션 찾기
  // sectionHeading 텍스트를 가진 제목(h2, h3, h1, div 등)을 찾은 뒤 그 주변의 테이블이나 리스트를 추출
  let sectionRoot = page.locator('body');

  if (category.sectionSelector) {
    const selectorLocator = page.locator(category.sectionSelector);
    if (await selectorLocator.count() > 0) {
      sectionRoot = selectorLocator.first();
    }
  } else {
    const headingLocator = page.locator(`h1, h2, h3, [class*="heading" i], [class*="title" i]`).filter({ hasText: category.sectionHeading });
    if (await headingLocator.count() > 0) {
      // 제목 노드 근처의 컨테이너를 찾음
      const closestSection = headingLocator.first().locator('xpath=./ancestor::section | ./ancestor::div[contains(@class, "section") or contains(@class, "panel") or contains(@class, "container") or contains(@class, "wrapper")][1]');
      if (await closestSection.count() > 0) {
        sectionRoot = closestSection.first();
      }
    }
  }

  // 2. 테이블 tr 또는 리스트 아이템 찾기 (무분별한 다중 셀렉터 결합 대신, 우선순위에 따라 좁혀서 탐색)
  let rows = sectionRoot.locator('table tbody tr');
  let count = await rows.count();

  if (count === 0) {
    rows = sectionRoot.locator('table tr');
    count = await rows.count();
  }
  if (count === 0) {
    rows = sectionRoot.locator('[role="row"]');
    count = await rows.count();
  }
  if (count === 0) {
    rows = sectionRoot.locator('ul li, ol li, li');
    count = await rows.count();
  }
  if (count === 0) {
    rows = sectionRoot.locator('[class*="row" i], [class*="item" i]');
    count = await rows.count();
  }

  const extracted: ExtractedStandingsRow[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if (!(await row.isVisible().catch(() => false))) continue;

    // 셀 값 추출
    const cells = await row.locator('td, th, [role="cell"]').evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
    ).catch(() => []);

    const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!rowText || rowText.toLowerCase().includes('rank') || rowText.toLowerCase().includes('player')) {
      continue; // Skip header row
    }

    const playerLink = row.locator('a[href*="/players/"]').first();
    const profileHref = (await playerLink.getAttribute('href').catch(() => '')) || '';
    const displayName = (await playerLink.innerText().catch(() => '')) || inferDisplayNameFromCells(cells, rowText);

    if (!displayName || (!profileHref && !rowText)) continue;

    // 수치 파싱
    const rank = parseRankFromRow(rowText, cells, i + 1);
    const earnings = parseEarningsFromRow(rowText, cells);
    const bracelets = parseStatFromRow(rowText, cells, ['bracelet', 'bracelets', 'wins', '우승']);
    const rings = parseStatFromRow(rowText, cells, ['ring', 'rings', '반지']);
    const wins = parseStatFromRow(rowText, cells, ['win', 'wins', '우승']);
    const finalTables = parseStatFromRow(rowText, cells, ['final table', 'final tables', 'ft']);
    const cashes = parseStatFromRow(rowText, cells, ['cash', 'cashes', '입상']);

    extracted.push({
      rank,
      displayName,
      earnings,
      bracelets,
      rings,
      wins,
      finalTables,
      cashes,
      profileHref,
      rowText,
    });
  }

  return dedupeStandingsRows(extracted);
}

export function findStandingsRowByPlayer(
  rows: ExtractedStandingsRow[],
  expectedName: string,
  expectedRank?: number
): { row: ExtractedStandingsRow | null; diagnostics: string[] } {
  const normalizedExpected = normalizePlayerName(expectedName);
  const diagnostics: string[] = [];

  // 1. 이름 완전 일치 우선
  let found = rows.find((r) => normalizePlayerName(r.displayName) === normalizedExpected);

  // 2. 랭크 기준 보완 매칭
  if (!found && expectedRank) {
    found = rows.find((r) => r.rank === expectedRank && normalizePlayerName(r.displayName).includes(normalizedExpected));
  }

  // 3. 이름 토큰 포함 매칭
  if (!found) {
    found = rows.find((r) => normalizePlayerName(r.rowText).includes(normalizedExpected));
  }

  if (!found) {
    // 진단 후보군 목록 작성
    const closeNames = rows.slice(0, 10).map((r) => `#${r.rank} ${r.displayName} (${r.earnings})`);
    diagnostics.push(`Available rows sampled: [${closeNames.join(', ')}]`);
  }

  return {
    row: found ?? null,
    diagnostics,
  };
}

function inferDisplayNameFromCells(cells: string[], rowText: string): string {
  if (cells.length > 1) {
    // 보통 1번째 혹은 2번째 열이 이름
    const nameCandidate = cells[1] || cells[0];
    if (/^[A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,3}$/.test(nameCandidate)) {
      return nameCandidate;
    }
  }
  const parts = rowText.split(/\s{2,}/);
  const namePart = parts.find((part) => /^[A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,3}$/.test(part));
  return namePart ?? '';
}

function parseRankFromRow(rowText: string, cells: string[], fallback: number): number {
  if (cells.length > 0) {
    const parsed = parseInt(cells[0].replace(/[^\d]/g, ''), 10);
    if (!isNaN(parsed)) return parsed;
  }
  const match = rowText.match(/^(?:#\s*)?(\d+)\b/);
  return match ? parseInt(match[1], 10) : fallback;
}

function parseEarningsFromRow(rowText: string, cells: string[]): string {
  const moneyMatch = rowText.match(/\$\s*[\d,]+/);
  if (moneyMatch) return moneyMatch[0];

  for (const cell of cells) {
    if (cell.includes('$')) return cell;
  }
  return '';
}

function parseStatFromRow(rowText: string, cells: string[], keywords: string[]): number | null {
  // 간단한 숫자 찾기
  const match = rowText.match(/\b\d+\b/g);
  if (!match) return null;

  // 테이블 구조인 경우 열 인덱스 등으로 유추할 수도 있지만, 일단은 null 처리
  return null;
}

function dedupeStandingsRows(rows: ExtractedStandingsRow[]) {
  const seen = new Set<string>();
  const unique: ExtractedStandingsRow[] = [];
  for (const row of rows) {
    const key = `${row.rank}|${normalizePlayerName(row.displayName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}
