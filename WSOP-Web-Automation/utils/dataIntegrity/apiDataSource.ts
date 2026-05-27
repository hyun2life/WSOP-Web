import type { DataSource, DataSourceInfo } from './dataSource';
import type {
  ExpectedIdentityMapping,
  ExpectedPlayerResults,
  ExpectedPlayerSummary,
  ExpectedResultDetail,
  ExpectedStandingsCategory,
  KnownDataException,
} from './dataIntegrityTypes';

export class ApiDataSource implements DataSource {
  constructor() {
    // API 데이터 소스는 구현 예정 상태입니다.
    // 임의의 API endpoint를 생성하지 않고, 에러 또는 스킵 처리를 위한 placeholder로만 둡니다.
  }

  private triggerNotImplementedError(): never {
    throw new Error(
      'API Data Source is not implemented yet. Please use DATA_SOURCE=fixture (default) to run data integrity checks against local expected JSON files.'
    );
  }

  async getExpectedPlayerProfile(playerKey: string): Promise<ExpectedPlayerSummary | null> {
    this.triggerNotImplementedError();
  }

  async getExpectedPlayerResults(playerKey: string): Promise<ExpectedPlayerResults | null> {
    this.triggerNotImplementedError();
  }

  async getExpectedStandings(categoryKey: string): Promise<ExpectedStandingsCategory | null> {
    this.triggerNotImplementedError();
  }

  async getExpectedResultDetail(resultKey: string): Promise<ExpectedResultDetail | null> {
    this.triggerNotImplementedError();
  }

  async getExpectedIdentityMapping(playerKey: string): Promise<ExpectedIdentityMapping | null> {
    this.triggerNotImplementedError();
  }

  async getKnownException(exceptionKey: string): Promise<KnownDataException | null> {
    this.triggerNotImplementedError();
  }

  getInfo(): DataSourceInfo {
    return {
      source: 'api-placeholder',
      sourceOfTruth: false,
      baseline: false,
    };
  }
}
