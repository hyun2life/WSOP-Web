export interface ExpectedPlayerSummary {
  playerKey: string;
  displayName: string;
  profileUrl: string;
  country: string | null;
  bracelets: number | null;
  rings: number | null;
  finalTables: number | null;
  cashes: number | null;
  totalEarnings: string | null;
  knownExceptionKey: string | null;
}

export interface ExpectedPlayerResultRow {
  eventNameContains: string;
  seriesContains?: string;
  dateContains?: string;
  rankContains?: string;
  earnings?: string;
  resultUrlContains?: string;
}

export interface ExpectedPlayerResults {
  playerKey: string;
  profileUrl: string;
  expectedRows: ExpectedPlayerResultRow[];
}

export interface ExpectedStandingsRow {
  rank: number;
  displayName: string;
  earnings?: string | null;
  bracelets?: number | null;
  rings?: number | null;
  wins?: number | null;
  finalTables?: number | null;
  cashes?: number | null;
  profileUrlContains?: string;
}

export interface ExpectedStandingsCategory {
  categoryKey: string;
  pageUrl: string;
  sectionHeading: string;
  sectionSelector?: string;
  expectedRows: ExpectedStandingsRow[];
}

export interface ExpectedResultDetailRow {
  rank: number;
  displayName: string;
  country?: string;
  earnings?: string;
  profileUrlContains?: string;
}

export interface ExpectedResultDetail {
  resultKey: string;
  resultUrl: string;
  seriesNameContains?: string;
  eventNameContains?: string;
  startDateContains?: string;
  buyIn?: string;
  entries?: number;
  prize?: string;
  winner?: string;
  winnerEarnings?: string;
  expectedRows: ExpectedResultDetailRow[];
}

export interface ExpectedIdentityMapping {
  playerKey: string;
  displayName: string;
  profileUrl: string;
  allowedAliases: string[];
  onepassId: string | null;
  playerId: string | null;
  shouldHaveSingleProfileTarget?: boolean;
  knownExceptionKey?: string | null;
}

export interface KnownDataException {
  reason?: string;
  warningOnly?: boolean;
  allowMultipleContextMentions?: boolean;
  requireSingleProfileTarget?: boolean;
}

export interface ComparisonDetail {
  fieldName: string;
  expected: unknown;
  actual: unknown;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export interface ComparisonResult {
  passed: boolean;
  warnings: string[];
  failures: string[];
  details: ComparisonDetail[];
}
