import { Page, Locator } from '@playwright/test';

interface MaskDefinition {
  description: string;
  selectorCandidates: string[];
}

interface MaskFixture {
  [key: string]: MaskDefinition;
}

/**
 * 지정된 mask keys에 해당하는 DOM 요소를 찾아 실제 스냅샷 마스킹에 사용될 Locator 목록을 만듭니다.
 */
export async function buildMasks(
  page: Page,
  maskKeys: string[],
  maskFixture: MaskFixture
): Promise<Locator[]> {
  const locators: Locator[] = [];

  for (const key of maskKeys) {
    const maskDef = maskFixture[key];
    if (!maskDef) {
      console.warn(`[VisualMaskHelpers] Mask key "${key}" not found in mask fixture.`);
      continue;
    }

    for (const selector of maskDef.selectorCandidates) {
      try {
        const elements = page.locator(selector);
        const count = await elements.count();
        for (let i = 0; i < count; i++) {
          const el = elements.nth(i);
          if (await el.isVisible()) {
            locators.push(el);
          }
        }
      } catch (e) {
        // Selector가 유효하지 않거나 에러 발생 시 무시
      }
    }
  }

  return locators;
}

/**
 * 페이지 내 동적으로 바뀔 가능성이 높은 영역들의 후보군을 찾아 메타데이터를 수집합니다 (디버깅/리포트용).
 */
export async function collectDynamicAreaCandidates(page: Page): Promise<{
  iframes: number;
  ads: number;
  carousels: number;
  dates: number;
}> {
  const counts = {
    iframes: 0,
    ads: 0,
    carousels: 0,
    dates: 0,
  };

  try {
    counts.iframes = await page.locator('iframe').count();
    counts.ads = await page.locator('[id*="ad"], [class*="ad"], [class*="advert"]').count();
    counts.carousels = await page.locator('[class*="carousel"], [class*="slider"]').count();
    counts.dates = await page.locator('[class*="date"], [class*="time"]').count();
  } catch (e) {
    console.error('[VisualMaskHelpers] Failed to collect dynamic area candidates', e);
  }

  return counts;
}
