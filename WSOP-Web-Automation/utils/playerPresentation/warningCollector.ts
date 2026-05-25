import type { TestInfo } from '@playwright/test';

export type PlayerPresentationWarning = {
  testName: string;
  message: string;
  metadata?: Record<string, unknown>;
};

const warnings: PlayerPresentationWarning[] = [];

export function addWarning(testName: string, message: string, metadata?: Record<string, unknown>) {
  const warning = { testName, message, metadata };
  warnings.push(warning);

  const suffix = metadata ? ` ${JSON.stringify(metadata)}` : '';
  console.warn(`[PLAYER_PRESENTATION_WARNING] ${testName}: ${message}${suffix}`);
}

export function getWarnings(): PlayerPresentationWarning[] {
  return [...warnings];
}

export function clearWarnings() {
  warnings.length = 0;
}

export function attachWarningsToTestInfo(testInfo: TestInfo) {
  for (const warning of warnings) {
    testInfo.annotations.push({
      type: 'warning',
      description: `${warning.testName}: ${warning.message}${warning.metadata ? ` ${JSON.stringify(warning.metadata)}` : ''}`,
    });
  }
}
