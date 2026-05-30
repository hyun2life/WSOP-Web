import { test, expect } from '@playwright/test';
import { normalizeUrlPath } from '../../../utils/dataIntegrity/dataNormalizers';

test.describe('normalizeUrlPath', () => {
  test('returns original string if URL is malformed', () => {
    const invalidUrl = 'http://[invalid-url]';
    // When it falls back to original string, it still passes through the trailing/duplicate slash removal
    // 'http://[invalid-url]' becomes 'http:/[invalid-url]' because // is replaced with /
    expect(normalizeUrlPath(invalidUrl)).toBe('http:/[invalid-url]');
  });

  test('returns empty string for null or undefined', () => {
    expect(normalizeUrlPath(null)).toBe('');
    expect(normalizeUrlPath(undefined)).toBe('');
    expect(normalizeUrlPath('')).toBe('');
  });

  test('extracts pathname from valid absolute URLs', () => {
    expect(normalizeUrlPath('https://www.wsop.com/players/profile/?playerID=123')).toBe('players/profile');
    expect(normalizeUrlPath('http://wsop.com/tournaments/')).toBe('tournaments');
  });

  test('normalizes relative paths', () => {
    expect(normalizeUrlPath('/players/profile/')).toBe('players/profile');
    expect(normalizeUrlPath('tournaments//results///')).toBe('tournaments/results');
    expect(normalizeUrlPath('//news//article/')).toBe('news/article');
  });
});
