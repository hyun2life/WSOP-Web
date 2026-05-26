import { expect } from '@playwright/test';

export function normalizeText(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizePlayerName(value: string | null | undefined) {
  return normalizeText(value).replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

export function expectTextSimilar(actual: string | null | undefined, expected: string | null | undefined, context: string) {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);

  expect(normalizedExpected.length, `${context} expected text should not be empty`).toBeGreaterThan(0);
  expect(normalizedActual.length, `${context} actual text should not be empty`).toBeGreaterThan(0);

  if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) {
    return;
  }

  const actualTokens = new Set(normalizedActual.split(' ').filter(Boolean));
  const expectedTokens = normalizedExpected.split(' ').filter(Boolean);
  const matched = expectedTokens.filter((token) => actualTokens.has(token)).length;
  const ratio = expectedTokens.length === 0 ? 0 : matched / expectedTokens.length;
  expect(
    ratio,
    `${context} text similarity was too low. expected="${expected}" actual="${actual}" matchedTokens=${matched}/${expectedTokens.length}`,
  ).toBeGreaterThanOrEqual(0.5);
}

export function expectHrefContains(href: string | null | undefined, expectedPart: string, context: string) {
  const actualHref = String(href ?? '');
  expect(
    normalizeText(actualHref).includes(normalizeText(expectedPart)),
    `${context} href mismatch. href="${actualHref}" expectedPart="${expectedPart}"`,
  ).toBeTruthy();
}
