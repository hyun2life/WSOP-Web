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

export class CrawlerDataSource implements DataSource {
  private generatedDir: string;
  private summary: any = null;

  constructor() {
    this.generatedDir = path.join(process.cwd(), 'fixtures', 'data-integrity', 'generated');
    const summaryPath = path.join(process.cwd(), 'artifacts', 'crawlers', 'player-standings', 'latest', 'crawler-summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        this.summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      } catch {
        // Ignore parsing errors
      }
    }
  }

  private readGeneratedFile<T>(fileName: string): T {
    const filePath = path.join(this.generatedDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Generated expected fixture file not found: ${filePath}.\n` +
        `Please run the crawler and fixture generator first:\n` +
        `  npm run crawl:standings && npm run generate:phase6-fixtures\n` +
        `Or use the integrated command:\n` +
        `  npm run phase6:with-crawl`
      );
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse generated fixture file ${filePath}: ${errMsg}`);
    }
  }

  async getExpectedPlayerProfile(playerKey: string): Promise<ExpectedPlayerSummary | null> {
    const data = this.readGeneratedFile<{ players: ExpectedPlayerSummary[] }>('players.generated.expected.json');
    const player = data.players.find((p) => p.playerKey === playerKey);
    if (!player) {
      throw new Error(`Player key '${playerKey}' not found in players.generated.expected.json`);
    }
    return player;
  }

  async getExpectedPlayerResults(playerKey: string): Promise<ExpectedPlayerResults | null> {
    const data = this.readGeneratedFile<{ playerResults: ExpectedPlayerResults[] }>('player-results.generated.expected.json');
    const results = data.playerResults.find((r) => r.playerKey === playerKey);
    if (!results) {
      throw new Error(`Player key '${playerKey}' not found in player-results.generated.expected.json`);
    }
    return results;
  }

  async getExpectedStandings(categoryKey: string): Promise<ExpectedStandingsCategory | null> {
    const data = this.readGeneratedFile<{ categories: ExpectedStandingsCategory[] }>('standings.generated.expected.json');
    const category = data.categories.find((c) => c.categoryKey === categoryKey);
    if (!category) {
      throw new Error(`Category key '${categoryKey}' not found in standings.generated.expected.json`);
    }
    return category;
  }

  async getExpectedResultDetail(resultKey: string): Promise<ExpectedResultDetail | null> {
    try {
      const data = this.readGeneratedFile<{ resultDetails: ExpectedResultDetail[] }>('result-details.generated.expected.json');
      const detail = data.resultDetails.find((r) => r.resultKey === resultKey);
      if (detail) return detail;
    } catch {
      // If generated detail file doesn't exist, fallback to static
    }

    const staticDir = path.join(process.cwd(), 'fixtures', 'data-integrity');
    const staticPath = path.join(staticDir, 'result-details.expected.json');
    if (fs.existsSync(staticPath)) {
      const data = JSON.parse(fs.readFileSync(staticPath, 'utf8'));
      const detail = data.resultDetails.find((r: any) => r.resultKey === resultKey);
      if (detail) return detail;
    }
    throw new Error(`Result key '${resultKey}' not found in generated or static result-details fixture.`);
  }

  async getExpectedIdentityMapping(playerKey: string): Promise<ExpectedIdentityMapping | null> {
    const data = this.readGeneratedFile<{ players: ExpectedIdentityMapping[] }>('identity-mapping.generated.expected.json');
    const mapping = data.players.find((p) => p.playerKey === playerKey);
    if (!mapping) {
      throw new Error(`Player key '${playerKey}' not found in identity-mapping.generated.expected.json`);
    }
    return mapping;
  }

  async getKnownException(exceptionKey: string): Promise<KnownDataException | null> {
    const staticDir = path.join(process.cwd(), 'fixtures', 'data-integrity');
    const staticPath = path.join(staticDir, 'known-data-exceptions.fixture.json');
    if (fs.existsSync(staticPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(staticPath, 'utf8'));
        return data[exceptionKey] ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  getInfo(): DataSourceInfo {
    return {
      source: this.summary?.source || 'crawler-snapshot',
      sourceOfTruth: false,
      generatedAt: this.summary?.generatedAt,
      baseline: true,
    };
  }
}
