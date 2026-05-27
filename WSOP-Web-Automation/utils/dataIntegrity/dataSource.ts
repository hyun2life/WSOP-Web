import type {
  ExpectedIdentityMapping,
  ExpectedPlayerResults,
  ExpectedPlayerSummary,
  ExpectedResultDetail,
  ExpectedStandingsCategory,
  KnownDataException,
} from './dataIntegrityTypes';

export interface DataSourceInfo {
  source: string;
  sourceOfTruth: boolean;
  generatedAt?: string;
  baseline?: boolean;
}

export interface DataSource {
  getExpectedPlayerProfile(playerKey: string): Promise<ExpectedPlayerSummary | null>;
  getExpectedPlayerResults(playerKey: string): Promise<ExpectedPlayerResults | null>;
  getExpectedStandings(categoryKey: string): Promise<ExpectedStandingsCategory | null>;
  getExpectedResultDetail(resultKey: string): Promise<ExpectedResultDetail | null>;
  getExpectedIdentityMapping(playerKey: string): Promise<ExpectedIdentityMapping | null>;
  getKnownException(exceptionKey: string): Promise<KnownDataException | null>;
  getInfo(): DataSourceInfo;
}
