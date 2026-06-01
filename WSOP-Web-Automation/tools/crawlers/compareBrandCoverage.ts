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

type ComparisonRow = {
  canonical_brand: string;
  live_count: number;
  stage_count: number;
  count_diff: number;
  missing_in_stage_count: number;
  new_in_stage_count: number;
  missing_in_stage_players: string;
  new_in_stage_players: string;
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
  const compact = upper.replace(/[^A-Z0-9]+/g, "");

  if (!text) return "UNKNOWN";
  if (upper.startsWith("WSOP")) return "WSOP";
  if (upper.startsWith("WPT") || compact === "WPTPRIME") return "WPT";
  if (upper.startsWith("PGT") || upper.includes("POKER GO TOUR")) return "PGT";
  if (upper.startsWith("TRITON")) return "TRITON";
  if (upper === "IRISH POKER OPEN" || upper === "IRISH POKER TOUR") return "IRISH POKER OPEN";
  if (compact === "GGMASTERS" || compact === "GGMILLION" || compact === "GGMILLIONS" || compact === "GGMILLON" || compact === "GGMILLONS") return "GGPOKER";
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
): ComparisonRow[] {
  const brandSet = new Set<string>([...liveBuckets.keys(), ...stageBuckets.keys()]);
  const brands = Array.from(brandSet).sort((a, b) => a.localeCompare(b));
  const rows: ComparisonRow[] = [];

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

function writeCsv(filePath: string, rows: ComparisonRow[]): void {
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

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitPlayers(value: string): string[] {
  return normalizeText(value) ? value.split("|").filter(Boolean) : [];
}

function renderPlayerList(players: string[]): string {
  if (!players.length) return `<span class="muted">-</span>`;
  return `<div class="player-list">${players.map((p) => `<code>${htmlEscape(p)}</code>`).join("")}</div>`;
}

function renderHtmlReport(args: {
  rows: ComparisonRow[];
  generatedAt: string;
  liveInput: string;
  stageInput: string;
  liveDefaultBrand: string;
  stageDefaultBrand: string;
}): string {
  const totalLive = args.rows.reduce((sum, row) => sum + row.live_count, 0);
  const totalStage = args.rows.reduce((sum, row) => sum + row.stage_count, 0);
  const totalMissing = args.rows.reduce((sum, row) => sum + row.missing_in_stage_count, 0);
  const totalNew = args.rows.reduce((sum, row) => sum + row.new_in_stage_count, 0);
  const changedBrands = args.rows.filter((row) => row.count_diff !== 0 || row.missing_in_stage_count || row.new_in_stage_count).length;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WSOP Brand Coverage Comparison</title>
  <style>
    :root {
      --bg: #0f1115;
      --panel: #171b22;
      --panel-soft: #202632;
      --text: #f4f6f8;
      --muted: #9aa4b2;
      --border: #303846;
      --accent: #3fb06b;
      --warn: #d6a63a;
      --danger: #e35b5b;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Segoe UI, Malgun Gothic, sans-serif; line-height: 1.5; }
    header { padding: 28px 32px; border-bottom: 1px solid var(--border); background: #12161d; }
    main { padding: 28px 32px 48px; max-width: 1500px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 18px; }
    .meta { color: var(--muted); font-size: 13px; display: flex; gap: 12px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--panel-soft); border-radius: 999px; padding: 5px 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin: 22px 0; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 700; }
    .value { font-size: 28px; font-weight: 800; margin-top: 6px; }
    .value.warn { color: var(--warn); }
    .value.danger { color: var(--danger); }
    table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 14px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; font-size: 13px; }
    th { color: var(--muted); background: #131820; font-size: 12px; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .diff-pos { color: var(--accent); font-weight: 800; }
    .diff-neg { color: var(--danger); font-weight: 800; }
    details { margin-top: 8px; }
    summary { cursor: pointer; color: var(--muted); }
    .player-list { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; max-height: 180px; overflow: auto; }
    code { background: #0c0f14; border: 1px solid var(--border); border-radius: 5px; padding: 3px 6px; color: #dce7f3; }
    .muted { color: var(--muted); }
    .path { word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <h1>WSOP Brand Coverage Comparison</h1>
    <div class="meta">
      <span class="pill">Generated: ${htmlEscape(args.generatedAt)}</span>
      <span class="pill">Live default: ${htmlEscape(args.liveDefaultBrand)}</span>
      <span class="pill">Stage default: ${htmlEscape(args.stageDefaultBrand)}</span>
    </div>
  </header>
  <main>
    <section class="grid">
      <div class="card"><div class="label">Live Count</div><div class="value">${totalLive}</div></div>
      <div class="card"><div class="label">Stage Count</div><div class="value">${totalStage}</div></div>
      <div class="card"><div class="label">Changed Brands</div><div class="value warn">${changedBrands}</div></div>
      <div class="card"><div class="label">Missing In Stage</div><div class="value danger">${totalMissing}</div></div>
      <div class="card"><div class="label">New In Stage</div><div class="value warn">${totalNew}</div></div>
    </section>

    <section class="card">
      <div class="label">Input Files</div>
      <p class="path"><strong>Live:</strong> ${htmlEscape(args.liveInput)}</p>
      <p class="path"><strong>Stage:</strong> ${htmlEscape(args.stageInput)}</p>
    </section>

    <h2>Brand Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Canonical Brand</th>
          <th class="num">Live</th>
          <th class="num">Stage</th>
          <th class="num">Diff</th>
          <th class="num">Missing</th>
          <th class="num">New</th>
          <th>Player Differences</th>
        </tr>
      </thead>
      <tbody>
        ${args.rows.map((row) => {
          const diffClass = row.count_diff > 0 ? "diff-pos" : row.count_diff < 0 ? "diff-neg" : "";
          const missing = splitPlayers(row.missing_in_stage_players);
          const added = splitPlayers(row.new_in_stage_players);
          return `<tr>
            <td><strong>${htmlEscape(row.canonical_brand)}</strong></td>
            <td class="num">${row.live_count}</td>
            <td class="num">${row.stage_count}</td>
            <td class="num ${diffClass}">${row.count_diff}</td>
            <td class="num">${row.missing_in_stage_count}</td>
            <td class="num">${row.new_in_stage_count}</td>
            <td>
              <details ${missing.length || added.length ? "" : "open"}>
                <summary>Missing ${missing.length} / New ${added.length}</summary>
                <div><strong>Missing in Stage</strong>${renderPlayerList(missing)}</div>
                <div style="margin-top:10px;"><strong>New in Stage</strong>${renderPlayerList(added)}</div>
              </details>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </main>
</body>
</html>`;
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
  const htmlPath = path.join(outDir, `wsop-brand-coverage-compare-${ts}-report.html`);
  const generatedAt = new Date().toISOString();

  writeCsv(csvPath, rows);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt,
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
  fs.writeFileSync(
    htmlPath,
    renderHtmlReport({
      rows,
      generatedAt,
      liveInput: path.resolve(opts.livePath),
      stageInput: path.resolve(opts.stagePath),
      liveDefaultBrand: opts.liveDefaultBrand,
      stageDefaultBrand: opts.stageDefaultBrand,
    }),
    "utf8"
  );

  console.log(`Brand comparison CSV: ${csvPath}`);
  console.log(`Brand comparison JSON: ${jsonPath}`);
  console.log(`Brand comparison HTML: ${htmlPath}`);
}

main();
