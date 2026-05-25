import { expect, type Page } from '@playwright/test';

import {
  collectProfileImageCandidates,
  expectProfilePageLoaded,
  type PlayerFixture,
  type ProfileImageCandidate,
} from './playerPresentationChecks';

export async function gotoPlayerProfile(page: Page, player: PlayerFixture) {
  await expectProfilePageLoaded(page, player);
}

export async function getProfileHeaderText(page: Page): Promise<string> {
  const headerLocator = page.locator('h1, h2, [class*="profile" i], [class*="player" i]').first();
  if ((await headerLocator.count()) > 0 && (await headerLocator.isVisible().catch(() => false))) {
    return normalize(await headerLocator.innerText());
  }

  const bodyText = await page.locator('body').innerText();
  return normalize(bodyText).slice(0, 1000);
}

export async function getProfileImageCandidates(page: Page): Promise<ProfileImageCandidate[]> {
  const candidates = await collectProfileImageCandidates(page);
  expect(Array.isArray(candidates), 'Profile image candidate collection should return an array').toBeTruthy();
  return candidates;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
