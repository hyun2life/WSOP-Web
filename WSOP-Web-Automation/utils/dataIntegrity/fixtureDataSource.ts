import fs from 'fs';
import path from 'path';
import type { DataSource, DataSourceInfo } from './dataSource';
import type {
  ExpectedIdentityMapping,
  ExpectedPlayerResults,
  ExpectedPlayerSummary,
  ExpectedResultDetail,
  ExpectedStandingsCategory,
  KnownDataException,
} from './dataIntegrityTypes';

export class FixtureDataSource implements DataSource {
  private fixtureDir: string;

  constructor() {
    this.fixtureDir = path.join(process.cwd(), 'fixtures', 'data-integrity');
  }

  private readFixtureFile<T>(fileName: string): T {
    const filePath = path.join(this.fixtureDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fixture file not found: ${filePath}`);
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse fixture file ${filePath}: ${errMsg}`);
    }
  }

  async getExpectedPlayerProfile(playerKey: string): Promise<ExpectedPlayerSummary | null> {
    const data = this.readFixtureFile<{ players: ExpectedPlayerSummary[] }>('players.expected.json');
    const player = data.players.find((p) => p.playerKey === playerKey);
    if (!player) {
      throw new Error(`Player key '${playerKey}' not found in players.expected.json`);
    }
    return player;
  }

  async getExpectedPlayerResults(playerKey: string): Promise<ExpectedPlayerResults | null> {
    const data = this.readFixtureFile<{ playerResults: ExpectedPlayerResults[] }>('player-results.expected.json');
    const results = data.playerResults.find((r) => r.playerKey === playerKey);
    if (!results) {
      throw new Error(`Player key '${playerKey}' not found in player-results.expected.json`);
    }
    return results;
  }

  async getExpectedStandings(categoryKey: string): Promise<ExpectedStandingsCategory | null> {
    const data = this.readFixtureFile<{ categories: ExpectedStandingsCategory[] }>('standings.expected.json');
    const category = data.categories.find((c) => c.categoryKey === categoryKey);
    if (!category) {
      throw new Error(`Category key '${categoryKey}' not found in standings.expected.json`);
    }
    return category;
  }

  async getExpectedResultDetail(resultKey: string): Promise<ExpectedResultDetail | null> {
    const data = this.readFixtureFile<{ resultDetails: ExpectedResultDetail[] }>('result-details.expected.json');
    const detail = data.resultDetails.find((r) => r.resultKey === resultKey);
    if (!detail) {
      throw new Error(`Result key '${resultKey}' not found in result-details.expected.json`);
    }
    return detail;
  }

  async getExpectedIdentityMapping(playerKey: string): Promise<ExpectedIdentityMapping | null> {
    const data = this.readFixtureFile<{ players: ExpectedIdentityMapping[] }>('identity-mapping.expected.json');
    const mapping = data.players.find((p) => p.playerKey === playerKey);
    if (!mapping) {
      throw new Error(`Player key '${playerKey}' not found in identity-mapping.expected.json`);
    }
    return mapping;
  }

  async getKnownException(exceptionKey: string): Promise<KnownDataException | null> {
    try {
      const data = this.readFixtureFile<Record<string, KnownDataException>>('known-data-exceptions.fixture.json');
      return data[exceptionKey] ?? null;
    } catch {
      return null;
    }
  }

  getCalculationScope(fileName: string): string {
    try {
      const data = this.readFixtureFile<{ metadata?: { calculationScope?: string } }>(fileName);
      return data.metadata?.calculationScope ?? 'sample';
    } catch {
      return 'sample';
    }
  }

  getInfo(): DataSourceInfo {
    return {
      source: 'static-fixture',
      sourceOfTruth: true,
      baseline: false,
    };
  }
}
