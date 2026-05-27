import fs from 'fs';
import path from 'path';

function generateFixtures() {
  const artifactsBase = path.join(process.cwd(), "artifacts", "crawlers", "player-standings", "latest");
  const fixtureDest = path.join(process.cwd(), "fixtures", "data-integrity", "generated");

  fs.mkdirSync(fixtureDest, { recursive: true });

  const summaryPath = path.join(artifactsBase, "crawler-summary.json");
  const standingsPath = path.join(artifactsBase, "standings.snapshot.json");
  const candidatesPath = path.join(artifactsBase, "player-candidates.json");
  const identityPath = path.join(artifactsBase, "identity-targets.json");

  // 필수 파일 존재 여부 검사
  const requiredFiles = [summaryPath, standingsPath, candidatesPath, identityPath];
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`[ERROR] Crawler output file is missing: ${file}. Please run 'npm run crawl:standings' first.`);
    }
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const standingsSnapshot = JSON.parse(fs.readFileSync(standingsPath, 'utf8'));
  const playerCandidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
  const identityTargets = JSON.parse(fs.readFileSync(identityPath, 'utf8'));

  const generatedAt = summary.generatedAt || new Date().toISOString();
  const source = summary.source || "https://www.wsop.com/player-standings/";

  const metadata = {
    generatedAt,
    generatedBy: "crawlers",
    source,
    sourceOfTruth: false,
    baseline: true,
    calculationScope: "sample"
  };

  // 1. standings.generated.expected.json 변환
  const pageUrlMap: Record<string, string> = {
    "2026-standings": "/player-standings/",
    "all-time-earnings-men": "/player-standings/all-time-earnings-men/",
    "all-time-earnings-women": "/player-standings/all-time-earnings-women/",
    "all-time-bracelets": "/player-standings/all-time-bracelets/",
    "all-time-rings": "/player-standings/all-time-rings/",
    "all-player-stats": "/player-standings/"
  };
  const headingMap: Record<string, string> = {
    "2026-standings": "2026 Standings",
    "all-time-earnings-men": "All-Time Earnings - Men",
    "all-time-earnings-women": "All-Time Earnings - Women",
    "all-time-bracelets": "All-Time Bracelets",
    "all-time-rings": "All-Time Rings",
    "all-player-stats": "All Player Stats"
  };
  const sectionSelectorMap: Record<string, string> = {
    "all-player-stats": ".standings-all-player-stats"
  };

  const categories = (standingsSnapshot.categories || []).map((cat: any) => {
    const key = cat.categoryKey;
    return {
      categoryKey: key,
      pageUrl: pageUrlMap[key] || "/player-standings/",
      sectionHeading: headingMap[key] || cat.categoryLabel,
      sectionSelector: sectionSelectorMap[key] || undefined,
      expectedRows: (cat.players || []).map((p: any) => ({
        rank: p.rank,
        displayName: p.displayName,
        earnings: p.earnings,
        bracelets: null,
        rings: null,
        wins: null,
        finalTables: null,
        cashes: null,
        profileUrlContains: p.profileUrl ? p.profileUrl.replace("https://www.wsop.com", "") : undefined
      }))
    };
  });

  const standingsGenerated = {
    metadata,
    categories
  };

  fs.writeFileSync(
    path.join(fixtureDest, "standings.generated.expected.json"),
    JSON.stringify(standingsGenerated, null, 2) + "\n",
    'utf8'
  );

  // 2. players.generated.expected.json 변환
  const playersGenerated = {
    metadata,
    players: (playerCandidates.players || []).map((p: any) => ({
      playerKey: p.playerKey,
      displayName: p.displayName,
      profileUrl: p.profileUrl,
      country: p.country,
      bracelets: p.bracelets,
      rings: p.rings,
      finalTables: p.finalTables,
      cashes: p.cashes,
      totalEarnings: p.totalEarnings,
      knownExceptionKey: p.knownExceptionKey
    }))
  };

  fs.writeFileSync(
    path.join(fixtureDest, "players.generated.expected.json"),
    JSON.stringify(playersGenerated, null, 2) + "\n",
    'utf8'
  );

  // 3. player-results.generated.expected.json 변환
  const resultsGenerated = {
    metadata,
    playerResults: (playerCandidates.players || []).map((p: any) => ({
      playerKey: p.playerKey,
      profileUrl: p.profileUrl,
      expectedRows: (p.results || []).map((r: any) => ({
        eventNameContains: r.eventNameContains,
        seriesContains: r.seriesContains,
        dateContains: r.dateContains,
        rankContains: r.rankContains,
        earnings: r.earnings,
        resultUrlContains: r.resultUrlContains
      }))
    }))
  };

  fs.writeFileSync(
    path.join(fixtureDest, "player-results.generated.expected.json"),
    JSON.stringify(resultsGenerated, null, 2) + "\n",
    'utf8'
  );

  // 4. identity-mapping.generated.expected.json 변환
  const identityGenerated = {
    metadata,
    players: (identityTargets.players || []).map((p: any) => ({
      playerKey: p.playerKey,
      displayName: p.displayName,
      profileUrl: p.profileUrl,
      expectedProfileUrlContains: p.expectedProfileUrlContains,
      aliases: p.aliases,
      allowedAliases: p.aliases
    }))
  };

  fs.writeFileSync(
    path.join(fixtureDest, "identity-mapping.generated.expected.json"),
    JSON.stringify(identityGenerated, null, 2) + "\n",
    'utf8'
  );

  console.log("[SUCCESS] Phase 6 expected fixtures successfully generated from crawler snapshot.");
}

generateFixtures();
