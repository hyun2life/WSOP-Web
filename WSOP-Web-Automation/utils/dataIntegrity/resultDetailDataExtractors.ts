import type { Page } from '@playwright/test';
import { collectResultDetailPlayerRows } from '../resultDetail/resultDetailHelpers';
import type { ExpectedResultDetail } from './dataIntegrityTypes';

export interface ExtractedResultDetailMeta {
  seriesName: string;
  eventName: string;
  startDate: string;
  buyIn: string;
  entries: string;
  prize: string;
  winner: string;
  winnerEarnings: string;
  metadata: Record<string, string>;
}

export async function extractResultDetailMeta(
  page: Page,
  expectedResult: ExpectedResultDetail
): Promise<ExtractedResultDetailMeta> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const normalizedBody = bodyText.replace(/\s+/g, ' ');

  // 1. 이벤트명과 시리즈명
  // 보통 h1, h2, h3 또는 .event-title 등에 이벤트명이 표시됨
  const titleLocator = page.locator('h1, h2, [class*="title" i], [class*="header" i]').first();
  let eventName = await titleLocator.innerText().catch(() => '');
  let eventSource = 'title-locator';

  if (!eventName || eventName.length > 200) {
    eventName = expectedResult.eventNameContains ?? '';
    eventSource = 'expected-fallback';
  }

  // 2. 메타 필드 파싱 (Buy-in, Entries, Prize, Date, Winner 등)
  const meta: Record<string, string> = {
    seriesName: '',
    startDate: '',
    buyIn: '',
    entries: '',
    prize: '',
    winner: '',
    winnerEarnings: '',
  };
  const metaSources: Record<string, string> = {};

  const metaDefs = [
    { key: 'seriesName', labels: ['series', '시리즈'] },
    { key: 'startDate', labels: ['start date', 'date', '일자'] },
    { key: 'buyIn', labels: ['buy-in', 'buyin', '바이인'] },
    { key: 'entries', labels: ['entries', 'players', '참가자'] },
    { key: 'prize', labels: ['prize pool', 'prize', 'total prize', '총상금'] },
    { key: 'winner', labels: ['winner', '우승자'] },
  ];

  for (const def of metaDefs) {
    for (const label of def.labels) {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${escapedLabel}\\s*[:\\-]?\\s*([$\\w\\d,\\.\\+\\s]+?)(?=\\b(?:buy-in|entries|prize|winner|date|start|end|\\n|$))`, 'i');
      
      const match = normalizedBody.match(pattern);
      if (match && match[1]) {
        meta[def.key] = match[1].trim();
        metaSources[def.key] = `regex-label:${label}`;
        break;
      }
    }
  }

  // fallback: Winner 및 Winner Earnings를 테이블 첫 번째 행에서 추출 시도
  if (!meta.winner) {
    const tableRows = await collectResultDetailPlayerRows(page);
    const winnerRow = tableRows.find((r) => r.placeText.replace(/[^\d]/g, '') === '1');
    if (winnerRow) {
      meta.winner = winnerRow.playerName;
      meta.winnerEarnings = winnerRow.earningsText;
      metaSources.winner = 'result-table-rank-1';
      metaSources.winnerEarnings = 'result-table-rank-1-earnings';
    }
  }

  return {
    seriesName: meta.seriesName,
    eventName: eventName.trim(),
    startDate: meta.startDate,
    buyIn: meta.buyIn,
    entries: meta.entries,
    prize: meta.prize,
    winner: meta.winner,
    winnerEarnings: meta.winnerEarnings,
    metadata: {
      eventSource,
      seriesSource: metaSources.seriesName ?? 'default-empty',
      startDateSource: metaSources.startDate ?? 'default-empty',
      buyInSource: metaSources.buyIn ?? 'default-empty',
      entriesSource: metaSources.entries ?? 'default-empty',
      prizeSource: metaSources.prize ?? 'default-empty',
      winnerSource: metaSources.winner ?? 'default-empty',
    },
  };
}

export async function extractResultDetailRows(page: Page) {
  // Phase 5에서 완성한 collectResultDetailPlayerRows 헬퍼를 완전 재사용합니다.
  const rawRows = await collectResultDetailPlayerRows(page);
  return rawRows.map((r) => {
    const rank = parseInt(r.placeText.replace(/[^\d]/g, ''), 10);
    return {
      rank: isNaN(rank) ? 0 : rank,
      displayName: r.playerName,
      country: r.countryText,
      earnings: r.earningsText,
      profileUrlContains: r.playerHref,
      rowText: r.rowText,
    };
  });
}
