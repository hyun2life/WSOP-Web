import fs from "node:fs";
import path from "node:path";

type CrawlerSource = {
  brand?: string;
};

type CrawlerPlayer = {
  name?: string;
  url?: string;
  standingsSources?: CrawlerSource[];
};

type CrawlerData = {
  brandFilter?: string;
  players?: CrawlerPlayer[];
};

type Options = {
  livePath: string;
  stagePath: string;
  outDir: string;
  liveDefaultBrand: string;
  stageDefaultBrand: string;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    livePath: "",
    stagePath: "",
    outDir: "automation/output",
    liveDefaultBrand: "LIVE_UNSPECIFIED",
    stageDefaultBrand: "STAGE_UNSPECIFIED",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") opts.livePath = argv[++i];
    else if (arg === "--stage") opts.stagePath = argv[++i];
    else if (arg === "--out-dir") opts.outDir = argv[++i];
    else if (arg === "--live-default-brand") opts.liveDefaultBrand = argv[++i];
    else if (arg === "--stage-default-brand") opts.stageDefaultBrand = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.livePath || !opts.stagePath) {
    throw new Error("--live and --stage are required.");
  }
  return opts;
}

function printHelp(): void {
  console.log(`Compare Live/Stage brand coverage from crawler JSON

Usage:
  npx tsx tools/crawlers/compareBrandCoverage.ts --live <live-data.json> --stage <stage-data.json> [options]

Options:
  --out-dir <dir>               Output directory. Default: automation/output
  --live-default-brand <name>   Fallback brand when live source has no brand field
  --stage-default-brand <name>  Fallback brand when stage source has no brand field
`);
}

function readJson(filePath: string): CrawlerData {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as CrawlerData;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalBrand(raw: string): string {
  const text = normalizeText(raw);
  const upper = text.toUpperCase();

  if (!text) return "UNKNOWN";
  if (upper.startsWith("WSOP")) return "WSOP";
  if (upper.startsWith("WPT")) return "WPT";
  if (upper.startsWith("PGT")) return "PGT";
  if (upper === "IRISH POKER OPEN" || upper === "IRISH POKER TOUR") return "IRISH POKER";
  if (upper.startsWith("GG")) return "GGPOKER";
  return text;
}

function playerKey(player: CrawlerPlayer): string {
  const urlText = normalizeText(player.url);
  if (urlText) {
    try {
      const url = new URL(urlText);
      const parts = url.pathname.split("/").filter(Boolean);
      const slug = parts[parts.length - 1];
      if (slug) return slug.toLowerCase();
    } catch {
      const parts = urlText.split("/").filter(Boolean);
      const slug = parts[parts.length - 1];
      if (slug) return slug.toLowerCase();
    }
  }

  const name = normalizeText(player.name).toLowerCase();
  if (name) return `name:${name}`;
  return "unknown-player";
}

function collectBrandBuckets(data: CrawlerData, defaultBrand: string): Map<string, Set<string>> {
  const buckets = new Map<string, Set<string>>();
  const players = Array.isArray(data.players) ? data.players : [];
  const runBrandFilter = normalizeText(data.brandFilter);

  for (const player of players) {
    const key = playerKey(player);
    const rawBrands = new Set<string>();

    for (const src of player.standingsSources || []) {
      const b = normalizeText(src.brand);
      if (b) rawBrands.add(b);
    }

    if (rawBrands.size === 0 && runBrandFilter) {
      rawBrands.add(runBrandFilter);
    }
    if (rawBrands.size === 0) {
      rawBrands.add(defaultBrand);
    }

    for (const rawBrand of rawBrands) {
      const brand = canonicalBrand(rawBrand);
      if (!buckets.has(brand)) buckets.set(brand, new Set<string>());
      buckets.get(brand)!.add(key);
    }
  }

  return buckets;
}

function formatTimestamp(date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildComparisonRows(
  liveBuckets: Map<string, Set<string>>,
  stageBuckets: Map<string, Set<string>>
): Array<Record<string, string | number>> {
  const brandSet = new Set<string>([...liveBuckets.keys(), ...stageBuckets.keys()]);
  const brands = Array.from(brandSet).sort((a, b) => a.localeCompare(b));
  const rows: Array<Record<string, string | number>> = [];

  for (const brand of brands) {
    const live = liveBuckets.get(brand) ?? new Set<string>();
    const stage = stageBuckets.get(brand) ?? new Set<string>();
    const missingInStage = [...live].filter((p) => !stage.has(p)).sort();
    const newInStage = [...stage].filter((p) => !live.has(p)).sort();

    rows.push({
      canonical_brand: brand,
      live_count: live.size,
      stage_count: stage.size,
      count_diff: stage.size - live.size,
      missing_in_stage_count: missingInStage.length,
      new_in_stage_count: newInStage.length,
      missing_in_stage_players: missingInStage.join("|"),
      new_in_stage_players: newInStage.join("|"),
    });
  }

  return rows;
}

function writeCsv(filePath: string, rows: Array<Record<string, string | number>>): void {
  const headers = [
    "canonical_brand",
    "live_count",
    "stage_count",
    "count_diff",
    "missing_in_stage_count",
    "new_in_stage_count",
    "missing_in_stage_players",
    "new_in_stage_players",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(String(row[h] ?? ""))).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const live = readJson(opts.livePath);
  const stage = readJson(opts.stagePath);

  const liveBuckets = collectBrandBuckets(live, opts.liveDefaultBrand);
  const stageBuckets = collectBrandBuckets(stage, opts.stageDefaultBrand);
  const rows = buildComparisonRows(liveBuckets, stageBuckets);

  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const ts = formatTimestamp();
  const csvPath = path.join(outDir, `wsop-brand-coverage-compare-${ts}.csv`);
  const jsonPath = path.join(outDir, `wsop-brand-coverage-compare-${ts}.json`);

  writeCsv(csvPath, rows);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        liveInput: path.resolve(opts.livePath),
        stageInput: path.resolve(opts.stagePath),
        liveDefaultBrand: opts.liveDefaultBrand,
        stageDefaultBrand: opts.stageDefaultBrand,
        summary: rows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Brand comparison CSV: ${csvPath}`);
  console.log(`Brand comparison JSON: ${jsonPath}`);
}

main();
