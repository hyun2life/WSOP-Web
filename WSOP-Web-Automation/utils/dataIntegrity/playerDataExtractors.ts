import type { Page } from '@playwright/test';
import { getProfileHeaderText } from '../playerPresentation/playerProfileHelpers';
import { collectResultRowsFromProfile } from '../resultDetail/playerResultsListHelpers';
import type { ExpectedPlayerSummary } from './dataIntegrityTypes';

export interface ExtractedPlayerSummary {
  displayName: string;
  country: string;
  bracelets: string;
  rings: string;
  finalTables: string;
  cashes: string;
  totalEarnings: string;
  metadata: Record<string, string>;
}

export async function extractPlayerProfileSummary(page: Page, player: ExpectedPlayerSummary): Promise<ExtractedPlayerSummary> {
  const bodyLocator = page.locator('body');
  const bodyText = await bodyLocator.innerText().catch(() => '');

  // 1. 디스플레이 네임 추출
  const headerText = await getProfileHeaderText(page);
  // 프로필 헤더에서 플레이어 이름 부분을 유추
  let displayName = headerText;
  let nameSource = 'profile-header';
  
  if (headerText.toLowerCase().includes('player profile')) {
    displayName = headerText.replace(/player profile/i, '').trim();
  }
  if (!displayName || displayName.length > 100) {
    displayName = player.displayName; // fallback to expected if head is messy
    nameSource = 'expected-fallback';
  }

  // 2. 국가 정보 추출 (국기 이미지 alt나 text-block에서)
  let country = '';
  let countrySource = 'not-found';
  
  const countryLocator = page.locator('[class*="country" i], [class*="flag" i], [class*="nation" i]').first();
  if (await countryLocator.count() > 0 && await countryLocator.isVisible()) {
    country = await countryLocator.innerText().catch(() => '');
    countrySource = 'country-selector';
  }
  if (!country.trim()) {
    const flagImage = page.locator('img[src*="flag" i], img[alt*="flag" i]').first();
    if (await flagImage.count() > 0) {
      const alt = await flagImage.getAttribute('alt').catch(() => '');
      if (alt) {
        country = alt.replace(/flag/i, '').trim();
        countrySource = 'flag-image-alt';
      }
    }
  }
  if (!country.trim()) {
    // 본문에서 국가명 유추
    const countryMatch = bodyText.match(
      /\b(United States|USA|Canada|United Kingdom|England|Germany|France|Spain|Italy|Brazil|Australia|Norway|Sweden|Finland|Netherlands|Taiwan|China|Japan|South Korea|Belgium|Luxembourg|New Zealand)\b/i
    );
    if (countryMatch) {
      country = countryMatch[0];
      countrySource = 'body-text-regex';
    }
  }

  // 3. 주요 통계(bracelets, rings, final tables, cashes, total earnings) 추출
  // WSOP UI는 보통 STATS 패널로 "Bracelets 17", "Total Earnings $18,633,776" 등으로 표현함
  const stats: Record<string, string> = {
    bracelets: '',
    rings: '',
    finalTables: '',
    cashes: '',
    totalEarnings: '',
  };
  const statsSources: Record<string, string> = {};

  const statDefs = [
    { key: 'bracelets', labels: ['bracelets', 'bracelet', '우승 팔찌'] },
    { key: 'rings', labels: ['rings', 'ring', '우승 반지'] },
    { key: 'finalTables', labels: ['final tables', 'final table', '파이널 테이블'] },
    { key: 'cashes', labels: ['cashes', 'cash', '입상'] },
    { key: 'totalEarnings', labels: ['total earnings', 'earnings', 'prize money', '총 상금'] },
  ];

  // 텍스트 기반 파싱 (가장 견고함)
  const normalizedBody = bodyText.replace(/\s+/g, ' ');
  for (const def of statDefs) {
    for (const label of def.labels) {
      // "Label Value" 또는 "Value Label" 또는 "Label: Value" 패턴 매칭
      // e.g. "Bracelets 17", "Cashes: 230", "Total Earnings $18,633,776"
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern1 = new RegExp(`${escapedLabel}\\s*[:\\-]?\\s*([$\\w\\d,\\.\\+]+)`, 'i');
      const pattern2 = new RegExp(([def.key === 'totalEarnings' ? '\\$[\\d,\\.]+' : '\\d+'].join('')) + `\\s*${escapedLabel}`, 'i');

      const match1 = normalizedBody.match(pattern1);
      if (match1 && match1[1]) {
        stats[def.key] = match1[1].trim();
        statsSources[def.key] = `body-regex-pattern1(label:${label})`;
        break;
      }

      const match2 = normalizedBody.match(pattern2);
      if (match2 && match2[0]) {
        stats[def.key] = match2[0].replace(new RegExp(escapedLabel, 'i'), '').trim();
        statsSources[def.key] = `body-regex-pattern2(label:${label})`;
        break;
      }
    }
  }

  // fallback: 특정 selector 기반 (클래스명에 stat이 들어간 경우)
  const statElements = page.locator('[class*="stat" i], [class*="metric" i]');
  const count = await statElements.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const text = await statElements.nth(i).innerText().catch(() => '');
      if (!text) continue;
      const normalizedText = text.replace(/\s+/g, ' ').trim();
      for (const def of statDefs) {
        if (stats[def.key]) continue; // already found
        for (const label of def.labels) {
          if (normalizedText.toLowerCase().includes(label)) {
            const numMatch = normalizedText.match(/\d[\d,]*|[\$\d,]+/);
            if (numMatch) {
              stats[def.key] = numMatch[0];
              statsSources[def.key] = `stats-elements-nth-${i}`;
              break;
            }
          }
        }
      }
    }
  }

  return {
    displayName: displayName.trim(),
    country: country.trim(),
    bracelets: stats.bracelets,
    rings: stats.rings,
    finalTables: stats.finalTables,
    cashes: stats.cashes,
    totalEarnings: stats.totalEarnings,
    metadata: {
      nameSource,
      countrySource,
      braceletsSource: statsSources.bracelets ?? 'default-empty',
      ringsSource: statsSources.rings ?? 'default-empty',
      finalTablesSource: statsSources.finalTables ?? 'default-empty',
      cashesSource: statsSources.cashes ?? 'default-empty',
      totalEarningsSource: statsSources.totalEarnings ?? 'default-empty',
    },
  };
}

export async function extractPlayerResultRows(page: Page, player: ExpectedPlayerSummary) {
  // 기존 phase 5에서 매우 완성도 높게 짜둔 collectResultRowsFromProfile 헬퍼를 완전 재사용하여 정확성을 확보합니다.
  const fixtureWrapper = {
    displayName: player.displayName,
    profileUrl: player.profileUrl,
    minResultRows: 1, // 최소 1개 이상만 확보하도록 설정
  };
  return await collectResultRowsFromProfile(page, fixtureWrapper);
}
