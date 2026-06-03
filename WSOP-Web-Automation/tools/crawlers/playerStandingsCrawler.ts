import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// WSOP 선수 순위 크롤러.
//
// 전체 흐름:
// 1. 각 standings 카테고리에서 선수 프로필 URL을 수집한다.
// 2. 선수 프로필을 열고 상단 요약 카운터를 읽는다.
// 3. ALL 탭을 펼쳐 전체 row 기준 요약값을 계산한다.
// 4. 각 지표 탭을 열고 같은 조건으로 독립 계산한다.
// 5. 검증 가능한 Result 페이지를 열어 순위/선수명/상금을 확인한다.
// 6. JSON, CSV, 영문 HTML, 국문 HTML 리포트를 생성한다.
//
// 정합성이 최우선이다. 속도를 위해 작은 페이지 제한이 설정되어 있어도,
// Result 페이지는 target rank 구간을 실제로 덮었다고 판단될 때까지 탐색한다.
const DEFAULT_PLAYERS_URL = "https://wsop-stage.ggnweb.com/players";

// WSOP 선수 프로필 상단에 표시되는 요약 지표.
const STAT_DEFS = [
  { key: "titles", label: "Title", type: "number" },
  { key: "bracelets", label: "Bracelets", type: "number" },
  { key: "rings", label: "Rings", type: "number" },
  { key: "finalTables", label: "Final Tables", type: "number" },
  { key: "cashes", label: "Cashes", type: "number" },
  { key: "totalEarnings", label: "Total Earnings", type: "money" }
];

// 크롤러 진입점으로 사용하는 공개 standings 카테고리.
// path: null + sectionSelector가 있으면 메인 standings 페이지에서 해당 섹션만 추출한다.
const STANDINGS_CATEGORIES = [
  { label: "2026 Standings", path: "2026-standings" },
  { label: "All-Time Earnings - Men", path: "all-time-earnings-men" },
  { label: "All-Time Earnings - Women", path: "all-time-earnings-women" },
  { label: "All-Time Bracelets", path: "all-time-bracelets" },
  { label: "All-Time Rings", path: "all-time-rings" },
  { label: "All Player Stats", path: null, sectionSelector: ".standings-all-player-stats" }
];

const BRAND_FILTER_EXCLUDED_CATEGORIES = new Set([
  "2026 Standings",
  "All-Time Bracelets",
  "All-Time Rings"
]);

// ALL 탭과 별도로 독립 검증할 프로필 지표 탭.
const PROFILE_TAB_CHECKS = [
  { key: "titles", label: "Title", summaryKey: "titles", tabLabels: ["TITLES", "TITLE"] },
  { key: "bracelets", label: "Bracelets", summaryKey: "bracelets", tabLabels: ["BRACELETS", "BRACELET"] },
  { key: "rings", label: "Rings", summaryKey: "rings", tabLabels: ["RINGS", "RING"] },
  { key: "finalTables", label: "Final Tables", summaryKey: "finalTables", tabLabels: ["FINAL TABLES", "FINAL TABLE"] }
];

const PROFILE_BADGE_DEFS = [
  { key: "bracelets", label: "Bracelets", fileName: "badge_WSOPBracelet.webp", altPattern: /wsop\s+bracelet/i },
  { key: "rings", label: "Rings", fileName: "badge_WSOPRing.webp", altPattern: /wsop\s+ring/i }
];

const DEFAULT_STANDINGS_LIMIT = 50;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;
const DEFAULT_RESULT_PAGE_LIMIT = 0;
const DEFAULT_OUT_PATH = "automation/output/wsop-player-crawler-data.json";
const DEFAULT_HTML_PATH = "automation/output/wsop-player-crawler-report.html";
const DEFAULT_DEFECTS_PATH = "automation/output/wsop-player-crawler-defects.csv";
const DISABLED_RESULT_MODES = new Set(["skip", "fail", "check"]);

// WSOP Result 페이지는 동률/순위 공백이 있어서 예상 페이지 계산만 믿기 어렵다.
// 그래서 예상 rank 페이지보다 몇 페이지 앞에서 탐색을 시작한다.
const RESULT_SEARCH_LOOKBEHIND_PAGES = 2;

// 결과 페이지 캐시 (url -> cachedPages 배열)
// cachedPages 구조: { pageIndex, resultPageNumber, url, title, rows, bodyText } 배열
// Result URL 기준 페이지 캐시.
// 캐시는 target rank 구간을 실제로 덮었다는 근거가 있을 때만 재사용한다.
// 일부 페이지만 보거나 target보다 뒤쪽으로 overshoot된 캐시는 무시한다.
const resultPageRowsCache = new Map();

// 지수 백오프 기반 재시도 유틸리티
// 일시적인 네비게이션/네트워크 실패만 재시도한다. 영구 오류는 숨기지 않는다.
async function retryWithBackoff(fn, retries = 3, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`    [경고] 작업 실패 (시도 ${i + 1}/${retries}): ${error.message}. ${delayMs}ms 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

function parseArgs(argv) {
  const args = {
    playersUrl: DEFAULT_PLAYERS_URL,
    playerUrls: [],
    limit: Number(process.env.PHASE3_STANDINGS_LIMIT || DEFAULT_STANDINGS_LIMIT),
    resultLimit: 0,
    resultRankLimit: 0,
    maxLoadMore: 100,
    resultPageLimit: DEFAULT_RESULT_PAGE_LIMIT,
    disabledResultMode: "skip",
    timeout: 45000,
    browserChannel: null,
    userDataDir: "automation/.auth/wsop-player-crawler-chromium",
    authWaitMs: null,
    headed: false,
    out: DEFAULT_OUT_PATH,
    html: DEFAULT_HTML_PATH,
    defects: DEFAULT_DEFECTS_PATH,
    outputPathOverrides: { out: false, html: false, defects: false },
    selfTest: false,
    standingsOnly: false,
    profileOnly: false,
    concurrency: DEFAULT_CONCURRENCY,
    brand: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--players-url") args.playersUrl = argv[++i];
    else if (arg === "--player-url") args.playerUrls.push(argv[++i]);
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--result-limit") args.resultLimit = Number(argv[++i]);
    else if (arg === "--result-rank-limit") args.resultRankLimit = Number(argv[++i]);
    else if (arg === "--max-load-more") args.maxLoadMore = Number(argv[++i]);
    else if (arg === "--result-page-limit") args.resultPageLimit = Number(argv[++i]);
    else if (arg === "--disabled-result-mode") args.disabledResultMode = String(argv[++i] || "").toLowerCase();
    else if (arg === "--timeout") args.timeout = Number(argv[++i]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg === "--browser-channel") {
      const value = argv[++i];
      args.browserChannel = value === "none" ? null : value;
    }
    else if (arg === "--user-data-dir") {
      const value = argv[++i];
      args.userDataDir = value === "none" ? null : value;
    }
    else if (arg === "--auth-wait-ms") args.authWaitMs = Number(argv[++i]);
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--out") {
      args.out = argv[++i];
      args.outputPathOverrides.out = true;
    }
    else if (arg === "--html") {
      args.html = argv[++i];
      args.outputPathOverrides.html = true;
    }
    else if (arg === "--defects") {
      args.defects = argv[++i];
      args.outputPathOverrides.defects = true;
    }
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--standings-only") args.standingsOnly = true;
    else if (arg === "--profile-only") args.profileOnly = true;
    else if (arg === "--brand") args.brand = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  applyManualPlayerOutputDefaults(args);
  applyBrandOutputDefaults(args);
  return args;
}

function formatRunTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("") + `-${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function safeFilePart(value, fallback = "manual-player") {
  const safe = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function splitBrandArgument(value) {
  const text = normalizeText(value);
  if (!text) return [];

  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of text) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);

    if ((char === "," || char === "|") && depth === 0) {
      const item = current.trim();
      if (item) parts.push(item);
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

function playerSlugForOutput(playerUrls) {
  if (!playerUrls?.length) return "wsop-player-crawler";
  if (playerUrls.length > 1) return "manual-players";

  try {
    const url = new URL(playerUrls[0]);
    const parts = url.pathname.split("/").filter(Boolean);
    return safeFilePart(parts[1] || playerNameFromUrl(playerUrls[0]), "manual-player");
  } catch {
    return safeFilePart(playerNameFromUrl(playerUrls[0]), "manual-player");
  }
}

function applyManualPlayerOutputDefaults(args) {
  if (!args.playerUrls.length || args.selfTest) return;

  const tag = `wsop-player-crawler-${playerSlugForOutput(args.playerUrls)}-${formatRunTimestamp()}`;
  if (!args.outputPathOverrides.out && args.out === DEFAULT_OUT_PATH) {
    args.out = `automation/output/${tag}-data.json`;
  }
  if (!args.outputPathOverrides.html && args.html === DEFAULT_HTML_PATH) {
    args.html = `automation/output/${tag}-report.html`;
  }
  if (!args.outputPathOverrides.defects && args.defects === DEFAULT_DEFECTS_PATH) {
    args.defects = `automation/output/${tag}-defects.csv`;
  }
}

function applyBrandOutputDefaults(args) {
  if (args.selfTest || !args.brand) return;

  const brandSuffix = splitBrandArgument(args.brand)
    .map((b) => safeFilePart(b.trim(), "brand"))
    .filter(Boolean)
    .join("-");

  if (!brandSuffix) return;

  if (!args.outputPathOverrides.out) {
    args.out = insertBrandSuffix(args.out, brandSuffix);
  }
  if (!args.outputPathOverrides.html) {
    args.html = insertBrandSuffix(args.html, brandSuffix);
  }
  if (!args.outputPathOverrides.defects) {
    args.defects = insertBrandSuffix(args.defects, brandSuffix);
  }
}

function insertBrandSuffix(filePath, suffix) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}-${suffix}${ext}`;
}

function printHelp() {
  console.log(`WSOP player standings crawler

Usage:
  node automation/crawl_player_standings.mjs [options]

Options:
  --players-url <url>       Players list URL. Default: ${DEFAULT_PLAYERS_URL}
  --player-url <url>        Crawl a specific player URL. Can be repeated.
  --limit <n>               Number of players to collect per standings category. Default: ${DEFAULT_STANDINGS_LIMIT}
  --result-limit <n>        Result pages to crawl per player. Use 0 for every Result. Default: 0
  --result-rank-limit <n>   Skip Result checks when player rank is above this value. Use 0 for no rank cap. Default: 0
  --max-load-more <n>       Max Load more clicks per player All tab. Default: 50
  --result-page-limit <n>   Max Final Result pages to inspect per result. Use 0 for every page. Default: ${DEFAULT_RESULT_PAGE_LIMIT}
  --disabled-result-mode <skip|fail|check>
                            How to handle disabled Result controls. skip: ignore as unavailable, fail: report as defect, check: open disabled href if present. Default: skip
  --timeout <ms>            Page timeout. Default: 45000
  --concurrency <n>         Max concurrent player crawls. Default: ${DEFAULT_CONCURRENCY}, max: ${MAX_CONCURRENCY}
  --browser-channel <name>  Installed browser channel, for example chrome. Use none for Playwright Chromium.
  --user-data-dir <path>    Reusable browser profile. Use none for a temporary profile.
  --auth-wait-ms <ms>       Wait for manual Cloudflare Access login when needed.
  --headed                  Show browser while running.
  --out <path>              Structured JSON output path.
  --html <path>             HTML report path.
  --defects <path>          Defect candidate CSV path.
                            Direct --player-url runs use timestamped output names unless these paths are set.
  --standings-only          Collect standings player targets only, then skip profile and Result crawling.
  --profile-only            Crawl profile summary/tabs/events only, then skip Result page checks.
  --self-test               Run local data-model checks without opening a browser.
`);
}

function normalizeConcurrency(value) {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`--concurrency must be a positive number. Recommended range: 1-${MAX_CONCURRENCY}.`);
  }

  return Math.min(Math.floor(value), MAX_CONCURRENCY);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeDisabledResultMode(value) {
  const mode = String(value || "skip").toLowerCase();
  if (!DISABLED_RESULT_MODES.has(mode)) {
    throw new Error("--disabled-result-mode must be one of: skip, fail, check.");
  }
  return mode;
}

// 선수명 비교용 후보를 만든다. WSOP 셀에는 닉네임, 실명, 국가명,
// 여러 문자권 텍스트가 섞일 수 있으므로 원문 완전 일치는 너무 취약하다.
function comparableNameCandidates(value) {
  const originalText = normalizeText(value);
  const text = originalText.toLowerCase();
  const candidates = new Set();
  const add = (candidate) => {
    const comparable = normalizeComparable(candidate);
    if (comparable.length >= 3) candidates.add(comparable);
  };

  add(text);
  add(text.replace(/^[a-z0-9_ -]+(?=[^\p{ASCII}])/iu, ""));
  add(text.replace(/[\p{ASCII}]+/gu, " "));

  const tokens = originalText.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    add(tokens.slice(0, 2).join(" "));
    add(tokens.slice(-2).join(" "));
    if (tokens.length >= 3) add(tokens.slice(0, -1).join(" "));
  }

  const capitalizedSuffix = originalText.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)$/);
  if (capitalizedSuffix) add(capitalizedSuffix[1]);

  return Array.from(candidates);
}

function resultPlayerNameMatches(rowPlayer, playerName) {
  const rowNames = comparableNameCandidates(rowPlayer);
  const targetNames = comparableNameCandidates(playerName);
  if (!targetNames.length) return true;
  if (!rowNames.length) return false;
  return rowNames.some((rowName) => targetNames.some((targetName) => rowName.includes(targetName) || targetName.includes(rowName)));
}

function playerNameCandidates(player) {
  const values = [
    player?.name,
    ...(player?.standingsSources || []).map((source) => source.name)
  ];
  return Array.from(new Set(values.flatMap(comparableNameCandidates)));
}

function resultPlayerMatches(rowPlayer, player) {
  const rowNames = comparableNameCandidates(rowPlayer);
  const targetNames = playerNameCandidates(player);
  if (!targetNames.length) return true;
  if (!rowNames.length) return false;
  return rowNames.some((rowName) => targetNames.some((targetName) => rowName.includes(targetName) || targetName.includes(rowName)));
}

function parseLastNumberAsMoney(value) {
  if (!value) return null;
  const matches = Array.from(normalizeText(value).matchAll(/-?\d[\d,]*(?:\.\d+)?/g));
  if (matches.length === 0) return null;
  const lastMatch = matches[matches.length - 1][0];
  const parsed = Number(lastMatch.replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseMoneyFromText(value) {
  const match = normalizeText(value).match(/(?:[$\u20ac\u00a3\u20a9\u20b1₱₩]|[A-Z]{1,4}\$?)\s*(-?\d[\d,]*(?:\.\d+)?)/);
  return match ? Math.round(Number(match[1].replace(/[,\s]/g, ""))) : parseLastNumberAsMoney(value);
}

function parseLastMoneyFromText(value) {
  const matches = Array.from(normalizeText(value).matchAll(/(?:[$\u20ac\u00a3\u20a9\u20b1₱₩]|[A-Z]{1,4}\$?)\s*(-?\d[\d,]*(?:\.\d+)?)/g));
  const match = matches[matches.length - 1];
  return match ? Math.round(Number(match[1].replace(/[,\s]/g, ""))) : parseLastNumberAsMoney(value);
}

function parseMoneyNearPlayerName(text, rawNames) {
  const normalizedText = normalizeText(text);
  for (const name of rawNames || []) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) continue;
    const nameIndex = normalizedText.toLowerCase().indexOf(normalizedName.toLowerCase());
    if (nameIndex < 0) continue;
    const afterName = normalizedText.slice(nameIndex + normalizedName.length);
    const beforeNextRank = afterName.split(/\s+\d{1,6}\s+/)[0] || afterName;
    const match = beforeNextRank.match(/(?:[$\u20ac\u00a3\u20a9\u20b1₱₩]|[A-Z]{1,4}\$?)\s*(-?\d[\d,]*(?:\.\d+)?)/);
    if (match) return Math.round(Number(match[1].replace(/[,\s]/g, "")));
  }
  const hasName = (rawNames || []).some(name => {
    const norm = normalizeText(name);
    return norm && normalizedText.toLowerCase().includes(norm.toLowerCase());
  });
  if (hasName) {
    return parseLastNumberAsMoney(text);
  }
  return null;
}

function findRankRowSegment(text, targetRank) {
  if (!targetRank) return null;
  const normalizedText = normalizeText(text);
  const rowStartPattern = /(?:^|\s)(\d{1,6})\s+/g;
  const starts = [];
  let match = null;
  while ((match = rowStartPattern.exec(normalizedText)) !== null) {
    starts.push({
      rank: Number(match[1].replace(/,/g, "")),
      index: match.index,
      textStart: match.index + (match[0].startsWith(" ") ? 1 : 0)
    });
  }
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i].rank !== targetRank) continue;
    const end = starts[i + 1]?.index ?? normalizedText.length;
    return normalizedText.slice(starts[i].textStart, end).trim();
  }
  return null;
}

function findTextMatchIndexes(text, needle) {
  const indexes = [];
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return indexes;
  const lowerText = text.toLowerCase();
  const lowerNeedle = normalizedNeedle.toLowerCase();
  let index = lowerText.indexOf(lowerNeedle);
  while (index >= 0) {
    indexes.push(index);
    index = lowerText.indexOf(lowerNeedle, index + lowerNeedle.length);
  }
  return indexes;
}

// Result 페이지 표 파싱이 실패했을 때 쓰는 보수적인 본문 텍스트 fallback.
// 다른 선수의 상금을 잘못 잡지 않도록 순위/선수명 근접성을 함께 확인한다.
function findResultRowInBodyText(bodyText, player, targetRank, targetEarnings) {
  const text = normalizeText(bodyText);
  if (!text) return null;

  const targetNames = playerNameCandidates(player);
  if (!targetNames.length) return null;

  const rawTargetNames = Array.from(new Set([
    player?.name,
    ...(player?.standingsSources || []).map((source) => source.name)
  ].filter(Boolean)));
  const rankRowSegment = findRankRowSegment(text, targetRank);
  if (rankRowSegment) {
    const segmentComparable = normalizeComparable(rankRowSegment);
    const nameMatches = targetNames.some((targetName) => segmentComparable.includes(targetName));
    if (nameMatches) {
      return {
        no: targetRank,
        player: player.name,
        country: "",
        earnings: parseMoneyNearPlayerName(rankRowSegment, rawTargetNames) ?? parseLastMoneyFromText(rankRowSegment),
        rowText: rankRowSegment,
        source: "final-result-text"
      };
    }
  }
  const moneyText = targetEarnings === null || targetEarnings === undefined
    ? null
    : targetEarnings.toLocaleString("en-US");
  const moneyPattern = moneyText
    ? new RegExp(`(?:[$€£₩\u20a9₱\u20b1]\\s*)?${escapeRegExp(moneyText)}\\b`, "g")
    : null;
  const matchIndexes = new Set(moneyPattern ? Array.from(text.matchAll(moneyPattern)).map((match) => match.index ?? -1) : []);
  for (const name of rawTargetNames) {
    for (const index of findTextMatchIndexes(text, name)) matchIndexes.add(index);
  }

  for (const index of matchIndexes) {
    if (index < 0) continue;
    const nearbyText = text.slice(Math.max(0, index - 180), Math.min(text.length, index + 260));
    const nearbyComparable = normalizeComparable(nearbyText);
    const nameMatches = targetNames.some((targetName) => nearbyComparable.includes(targetName));
    if (!nameMatches) continue;

    const beforeMoney = nearbyText.slice(0, Math.max(0, index - Math.max(0, index - 180)));
    const rankMatch = beforeMoney.match(/(?:^|\s)(\d{1,6})\s+[^$€£₩\u20a9₱\u20b1]{2,180}$/);
    const parsedRank = rankMatch ? Number(rankMatch[1].replace(/,/g, "")) : null;
    // targetRank가 있는 검증에서는 rank를 명시적으로 읽어내지 못한 fallback 조각을 신뢰하지 않는다.
    // (과거에는 parsedRank를 targetRank로 대체해 오탐을 만들 수 있었다.)
    if (targetRank && parsedRank === null) continue;
    if (targetRank && parsedRank !== targetRank) continue;

    return {
      no: parsedRank || targetRank,
      player: player.name,
      country: "",
      earnings: parseMoneyNearPlayerName(nearbyText, rawTargetNames) ?? parseMoneyFromText(nearbyText),
      rowText: nearbyText,
      source: "final-result-text"
    };
  }

  return null;
}

function resultRowMatchesTarget(row, player) {
  return resultPlayerMatches(row.player, player);
}

function resultMissingChecks(checks) {
  return Object.entries(checks)
    .filter(([key, ok]) => !ok && key !== "directPageClicked")
    .map(([key]) => key);
}

// targetRankCovered가 false면 예상 순위 구간을 실제로 확인했다고 볼 수 없다.
// 이 상태는 데이터 불일치가 아니라 탐색 미완료로 분리한다.
function resultSearchIncomplete(result) {
  return (result?.missing || []).includes("targetRankCovered");
}

function isTransientResultPageFailure(bodyText, title = "", statusCode = null) {
  const status = Number(statusCode);
  if (Number.isFinite(status) && status >= 500) return true;
  const text = normalizeText(`${title || ""} ${bodyText || ""}`).toLowerCase();
  return /(?:502|503|504)\s+(?:bad gateway|service temporarily unavailable|gateway timeout)/i.test(text)
    || text.includes("service temporarily unavailable")
    || text.includes("bad gateway")
    || text.includes("gateway timeout");
}

async function resultPageUnavailableWarning(page, event, statusCode = null) {
  const title = await page.title().catch(() => "");
  const bodyText = normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
  if (!isTransientResultPageFailure(bodyText, title, statusCode)) return null;
  const statusLabel = Number.isFinite(Number(statusCode)) ? `HTTP ${statusCode}` : "server unavailable";
  const message = `Result page temporarily unavailable (${statusLabel}). Retrying later is required before judging row consistency.`;
  return {
    url: page.url() || event.resultUrl,
    title,
    status: "warn",
    resultUnavailable: true,
    resultUnavailableReason: message,
    error: message,
    checks: { resultPageAvailable: false },
    missing: ["resultPageAvailable"],
    searchedPages: [],
    extractedTextSample: bodyText.slice(0, 1000)
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function isBrowserClosedError(error) {
  return /Target page, context or browser has been closed/i.test(error?.message || String(error || ""));
}

function localizeWarning(warning, isKo) {
  if (!isKo) return warning;
  const crawlError = String(warning || "").match(/^Crawl error: (.*)$/);
  if (crawlError) return `크롤링 에러: ${crawlError[1]}`;
  return warning;
}

function parseNumber(value) {
  const match = normalizeText(value).match(/-?\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
}

function parseMoney(value) {
  const text = normalizeText(value);
  const match = text.match(/(?:[^-\d]*)(-?\d[\d,]*(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseRank(value) {
  const text = normalizeText(value);
  const patterns = [
    /(?:^|\s)(\d{1,5})\s*\/\s*\d{1,6}(?:\s|$)/,
    /(?:^|\s)#\s*(\d{1,5})(?:st|nd|rd|th)?(?:\s|$)/i,
    /(?:^|\s)(\d{1,5})(?:st|nd|rd|th)(?:\s|$)/i,
    /(?:place|rank|finish|result)\D{0,12}(\d{1,5})/i,
    /^(\d{1,5})$/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }

  return null;
}

function parseEntries(value) {
  const match = normalizeText(value).match(/(?:^|\s)\d{1,5}\s*\/\s*(\d{1,6})(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

// 화면 텍스트에서 상단 요약 카운터를 읽는다.
// 이 값은 독립 수집한 프로필 row 계산값과 비교할 기준값이다.
function parseSummary(bodyText) {
  const compact = normalizeText(bodyText);
  const summary = {};

  for (const stat of STAT_DEFS) {
    const escapedLabel = stat.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const valuePattern = stat.type === "money" ? "([$\\u20ac\\u00a3\\u20a9\\u20b1₱₩]?\\s*[\\d,]+(?:\\.\\d+)?)" : "([\\d,]+)";
    const match = compact.match(new RegExp(`${escapedLabel}\\s+${valuePattern}`, "i"));
    summary[stat.key] = match
      ? stat.type === "money"
        ? parseMoney(match[1])
        : parseNumber(match[1])
      : null;
  }

  return summary;
}

function isZeroProfileSummary(summary) {
  return STAT_DEFS.every((stat) => summary?.[stat.key] === 0);
}

function profileDataUnavailableWarningPlayer({ name, url, standingsSources = [], summary = {}, bodyText = "" }) {
  const warning = "Profile data was not available: summary values and collected event rows were both zero. Check whether the profile URL is a legacy or unavailable page before treating this as a valid zero profile.";
  return {
    name: name || playerNameFromUrl(url) || url,
    url,
    standingsSources,
    summary,
    events: [],
    calculated: {},
    comparisons: [],
    tabChecks: [],
    tabEventsByKey: {},
    warnings: [warning],
    defects: [],
    status: "warn",
    profilePage: {
      status: "warn",
      error: warning,
      extractedTextSample: normalizeText(bodyText).slice(0, 1000)
    }
  };
}

async function extractProfileBadgeCounts(page) {
  const emptyCounts = PROFILE_BADGE_DEFS.reduce((counts, badgeDef) => {
    counts[badgeDef.key] = 0;
    return counts;
  }, {});

  try {
    return await page.evaluate((badgeDefs) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const parseCount = (value, strict = false) => {
        const text = normalize(value);
        const exactMatch = text.match(/^(?:#\s*)?(\d[\d,]*)$/);
        if (exactMatch) return Number(exactMatch[1].replace(/,/g, ""));
        if (strict) return null;
        const match = text.match(/\d[\d,]*/);
        return match ? Number(match[0].replace(/,/g, "")) : null;
      };
      const parseCountFromElement = (element, strict = true) => element ? parseCount(element.textContent, strict) : null;
      const isVisibleElement = (element) => {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
        return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
      };
      const findExplicitCountElement = (root) => {
        if (!root) return null;
        const elements = Array.from(root.querySelectorAll?.("*") || []);
        return elements.find((element) => {
          const className = String(element.getAttribute("class") || "");
          if (!/(^|[-_\s])(count|qty|quantity|number|badge-count)([-_\s]|$)/i.test(className)) return false;
          if (!isVisibleElement(element)) return false;
          return parseCountFromElement(element, true) !== null;
        }) || null;
      };
      const readBadgeCount = (img) => {
        const container = img.closest("li") || img.parentElement;
        const explicitCountElement = findExplicitCountElement(img.parentElement) || findExplicitCountElement(container) || findExplicitCountElement(img.parentElement?.parentElement);
        const candidates = [
          explicitCountElement,
          img.nextElementSibling,
          img.previousElementSibling,
          img.parentElement?.nextElementSibling,
          img.parentElement?.previousElementSibling
        ];
        for (const candidate of candidates) {
          const count = parseCountFromElement(candidate, true);
          if (count !== null) return count;
        }
        return 1;
      };
      const counts = {};
      const details = {};
      for (const badgeDef of badgeDefs) {
        counts[badgeDef.key] = 0;
        details[badgeDef.key] = [];
      }

      for (const img of Array.from(document.querySelectorAll("img"))) {
        if (!isVisibleElement(img)) continue;
        const sourceText = normalize([
          img.getAttribute("src"),
          img.getAttribute("srcset"),
          img.getAttribute("alt"),
          img.currentSrc
        ].filter(Boolean).join(" "));
        const badgeDef = badgeDefs.find((def) => sourceText.includes(def.fileName) || new RegExp(def.altPatternSource, "i").test(sourceText));
        if (!badgeDef) continue;

        const count = readBadgeCount(img);
        counts[badgeDef.key] += count;
        details[badgeDef.key].push({
          count,
          alt: img.getAttribute("alt") || "",
          src: img.getAttribute("src") || img.currentSrc || ""
        });
      }

      return { ...counts, details };
    }, PROFILE_BADGE_DEFS.map((badgeDef) => ({
      key: badgeDef.key,
      fileName: badgeDef.fileName,
      altPatternSource: badgeDef.altPattern.source
    })));
  } catch (error) {
    return {
      ...emptyCounts,
      details: {},
      error: error.message
    };
  }
}

function classifyAward(textValue) {
  const text = textValue.toLowerCase();
  if (/national championship/i.test(text)) return "bracelet";
  if (/(wsopc|wsop-c|wsop circuit|\bring\b|\bcircuit\b)/i.test(text)) return "ring";
  if (/\b(bracelet|online bracelet)\b|wsop|world series of poker/i.test(text)) return "bracelet";
  return "other";
}

function valueByHeader(row, patterns) {
  for (let i = 0; i < row.headers.length; i += 1) {
    const header = normalizeText(row.headers[i]);
    if (patterns.some((pattern) => pattern.test(header))) return row.cells[i] || "";
  }
  return "";
}

// 원본 표 row를 크롤러 전체에서 쓰는 이벤트 구조로 정규화한다.
// 포함 정보: 이벤트명, 날짜, 순위, 상금, Result URL, Result 상태.
function normalizeEvent(row) {
  const rankSource =
    valueByHeader(row, [/rank/i, /place/i, /finish/i, /result/i]) ||
    row.cells.find((cell) => parseRank(cell) !== null) ||
    row.text;
  const dateSource =
    valueByHeader(row, [/date/i]) ||
    row.cells.find((cell) => /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(cell)) ||
    "";
  const earningSource =
    valueByHeader(row, [/earning/i, /prize/i, /winnings/i, /cash/i]) ||
    row.cells.find((cell) => /[$₩₱€£¥\u20a9\u20b1]/.test(cell)) ||
    "";
  const eventSource =
    valueByHeader(row, [/event/i, /tournament/i, /series/i]) ||
    row.cells.find((cell) => !/[$₩₱€£¥\u20a9\u20b1]/.test(cell) && parseRank(cell) === null && !/^result$/i.test(cell)) ||
    row.text;

  return {
    rowIndex: row.rowIndex,
    eventName: normalizeText(eventSource),
    date: normalizeText(dateSource),
    rankText: normalizeText(rankSource),
    rank: parseRank(rankSource),
    entries: parseEntries(rankSource),
    earnings: parseMoney(earningSource),
    resultUrl: row.resultUrl,
    disabledResultUrl: row.disabledResultUrl || null,
    hasResultControl: row.hasResultControl,
    resultUnavailable: Boolean(row.resultUnavailable),
    resultUnavailableReason: row.resultUnavailableReason || "",
    rowText: row.text,
    cells: row.cells,
    resultPage: null
  };
}

function eventCollectionKey(event) {
  const comparisonKey = eventComparisonKey(event);
  const resultKey = normalizeComparable(event?.resultUrl || event?.disabledResultUrl || "");
  const rowKey = normalizeComparable(event?.rowText || "");
  return [comparisonKey, resultKey || rowKey].filter(Boolean).join("|");
}

function mergeVisibleEventRows(collectedEvents = [], visibleEvents = []) {
  const merged = [...collectedEvents];
  const byKey = new Map();
  for (const event of merged) {
    const key = eventCollectionKey(event);
    if (key) byKey.set(key, event);
  }

  let added = 0;
  for (const event of visibleEvents || []) {
    const key = eventCollectionKey(event);
    const existing = key ? byKey.get(key) : null;
    if (existing) {
      existing.resultUrl = existing.resultUrl || event.resultUrl;
      existing.disabledResultUrl = existing.disabledResultUrl || event.disabledResultUrl;
      existing.hasResultControl = existing.hasResultControl || event.hasResultControl;
      existing.resultUnavailable = existing.resultUnavailable || event.resultUnavailable;
      existing.resultUnavailableReason = existing.resultUnavailableReason || event.resultUnavailableReason;
      continue;
    }

    merged.push(event);
    if (key) byKey.set(key, event);
    added += 1;
  }

  return { events: merged, added };
}

function eventRowsSignature(events = []) {
  return events.map(eventCollectionKey).join("||");
}

function calculateFromEvents(events) {
  const winningEvents = events.filter((event) => event.rank === 1);
  return {
    titles: winningEvents.length,
    bracelets: winningEvents.filter((event) => classifyAward(`${event.eventName} ${event.rowText}`) === "bracelet").length,
    rings: winningEvents.filter((event) => classifyAward(`${event.eventName} ${event.rowText}`) === "ring").length,
    finalTables: events.filter((event) => event.rank !== null && event.rank >= 1 && event.rank <= 9).length,
    cashes: events.length,
    totalEarnings: events.reduce((sum, event) => sum + (event.earnings || 0), 0)
  };
}

function calculateSummaryFromEvents(events, summary, countCandidateEvents = events) {
  const rawCalculated = calculateFromEvents(events || []);
  const calculated = { ...rawCalculated };
  const candidates = [];

  const addCandidate = (candidateEvents) => {
    if (!candidateEvents || !candidateEvents.length) return;
    const candidateCalculated = calculateFromEvents(candidateEvents);
    candidates.push(candidateCalculated);

    const deduped = deduplicateComparisonEvents(candidateEvents);
    if (deduped.duplicateEvents.length) {
      candidates.push(calculateFromEvents(deduped.uniqueEvents));
    }
  };

  addCandidate(events || []);
  if (countCandidateEvents !== events) addCandidate(countCandidateEvents || []);

  for (const key of ["titles", "bracelets", "rings", "finalTables"]) {
    const expected = summary?.[key];
    if (!Number.isFinite(expected)) continue;

    let bestValue = calculated[key] ?? 0;
    let bestDifference = Math.abs(bestValue - expected);
    for (const candidate of candidates) {
      const candidateValue = candidate[key] ?? 0;
      const candidateDifference = Math.abs(candidateValue - expected);
      if (candidateDifference < bestDifference) {
        bestValue = candidateValue;
        bestDifference = candidateDifference;
      }
    }
    calculated[key] = bestValue;
  }

  return calculated;
}

// 중복 처리는 의도적으로 제한한다. 중복 제거가 프로필 비교 정확도를
// 높이는 경우에만 사용하고, 그 외에는 원본 row를 유지한다.
function eventDeduplicationKey(event) {
  if (!event) return "";
  return eventComparisonKey(event);
}

function looseEventDeduplicationKey(event) {
  if (!event) return "";
  const date = normalizeComparable(event.date || "");
  if (date && event.rank !== null && event.rank !== undefined && event.earnings !== null && event.earnings !== undefined) {
    return `${date}|${event.rank}|${event.earnings}`;
  }
  return "";
}

function areLikelyDuplicateEvents(left, right) {
  const leftStrongKey = eventDeduplicationKey(left);
  const rightStrongKey = eventDeduplicationKey(right);
  if (leftStrongKey && leftStrongKey === rightStrongKey) return true;

  const leftLooseKey = looseEventDeduplicationKey(left);
  const rightLooseKey = looseEventDeduplicationKey(right);
  if (!leftLooseKey || leftLooseKey !== rightLooseKey) return false;

  const leftName = normalizeComparable(left?.eventName || "");
  const rightName = normalizeComparable(right?.eventName || "");
  const namesOverlap = Boolean(leftName && rightName && (leftName.includes(rightName) || rightName.includes(leftName)));
  const rowDistance = Math.abs((left?.rowIndex ?? Number.NaN) - (right?.rowIndex ?? Number.NaN));
  const adjacentRows = Number.isFinite(rowDistance) && rowDistance <= 1;
  const missingResultUrl = !left?.resultUrl || !right?.resultUrl;

  return namesOverlap || (adjacentRows && missingResultUrl);
}

function deduplicateComparisonEvents(events) {
  const uniqueEvents = [];
  const duplicateEvents = [];

  for (const event of events || []) {
    const duplicateIndex = uniqueEvents.findIndex((existingEvent) => areLikelyDuplicateEvents(existingEvent, event));
    if (duplicateIndex === -1) {
      uniqueEvents.push(event);
      continue;
    }

    const existingEvent = uniqueEvents[duplicateIndex];
    if (!existingEvent.resultUrl && event.resultUrl) {
      duplicateEvents.push(existingEvent);
      uniqueEvents[duplicateIndex] = event;
    } else {
      duplicateEvents.push(event);
    }
  }

  return { uniqueEvents, duplicateEvents };
}

function expectedCashesCount(summary) {
  const cashes = summary?.cashes;
  return Number.isFinite(cashes) && cashes > 0 ? cashes : null;
}

function splitEventsByExpectedCashes(events, summary) {
  const expected = expectedCashesCount(summary);
  if (!expected || events.length <= expected) {
    return { comparisonEvents: events, overflowEvents: [] };
  }
  return {
    comparisonEvents: events.slice(0, expected),
    overflowEvents: events.slice(expected)
  };
}

function comparisonEventsForSummary(events, summary) {
  const rawSplit = splitEventsByExpectedCashes(events || [], summary);
  const expected = expectedCashesCount(summary);
  if (!expected || (events || []).length <= expected) {
    return { ...rawSplit, duplicateEvents: [], strategy: "raw" };
  }

  const deduped = deduplicateComparisonEvents(events || []);
  const dedupedSplit = splitEventsByExpectedCashes(deduped.uniqueEvents, summary);
  const rawScore = summaryCountMismatchScore(summary, calculateFromEvents(rawSplit.comparisonEvents));
  const dedupedScore = summaryCountMismatchScore(summary, calculateFromEvents(dedupedSplit.comparisonEvents));

  if (dedupedScore < rawScore) {
    return { ...dedupedSplit, duplicateEvents: deduped.duplicateEvents, strategy: "deduped" };
  }

  return { ...rawSplit, duplicateEvents: [], strategy: "raw" };
}

function summaryCountMismatchScore(summary, calculated) {
  const keys = ["titles", "bracelets", "rings", "finalTables", "cashes"];
  return keys.reduce((score, key) => {
    const expected = summary?.[key];
    const actual = calculated?.[key];
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return score;
    return score + Math.abs(expected - actual);
  }, 0);
}

function eventComparisonKey(event) {
  return [
    normalizeComparable(event?.eventName || ""),
    normalizeComparable(event?.date || ""),
    event?.rank ?? "",
    event?.earnings ?? ""
  ].join("|");
}

function eventContributesToProfileTab(event, tabKey) {
  if (!event) return false;
  if (tabKey === "finalTables") return event.rank !== null && event.rank >= 1 && event.rank <= 9;
  if (event.rank !== 1) return false;
  if (tabKey === "titles") return true;
  if (tabKey === "bracelets") return classifyAward(`${event.eventName} ${event.rowText}`) === "bracelet";
  if (tabKey === "rings") return classifyAward(`${event.eventName} ${event.rowText}`) === "ring";
  return false;
}

function pickClosestCountVariant(variants, preferredName = "raw") {
  const sorted = [...variants].sort((left, right) => {
    if (left.difference !== right.difference) return left.difference - right.difference;
    if (left.name === preferredName) return -1;
    if (right.name === preferredName) return 1;
    return left.priority - right.priority;
  });
  return sorted[0] || variants[0];
}

function compareSummary(summary, calculated, badgeCounts = null) {
  return STAT_DEFS.map((stat) => {
    const top = summary[stat.key];
    const calculatedValue = calculated[stat.key];
    const comparable = top !== null && top !== undefined && calculatedValue !== null && calculatedValue !== undefined;

    if (stat.key === "bracelets" || stat.key === "rings") {
      const badgeValue = badgeCounts?.[stat.key];
      const hasBadgeValue = Number.isFinite(badgeValue);
      const comparisonValue = hasBadgeValue ? badgeValue : calculatedValue;
      const comparableBadgeValue = top !== null && top !== undefined && comparisonValue !== null && comparisonValue !== undefined;
      const exactBadgeMatch = comparableBadgeValue && top === comparisonValue;
      return {
        key: stat.key,
        label: stat.label,
        top,
        calculated: comparisonValue,
        allCalculated: calculatedValue,
        source: hasBadgeValue ? "profile-badge" : "all-tab-fallback",
        sourceLabel: hasBadgeValue ? "Profile Badge Count" : "Calculated From ALL Tab (fallback)",
        status: exactBadgeMatch ? "pass" : "fail"
      };
    }

    const exactMatch = comparable && top === calculatedValue;
    return {
      key: stat.key,
      label: stat.label,
      top,
      calculated: calculatedValue,
      source: "all-tab",
      sourceLabel: "Calculated From ALL Tab",
      status: exactMatch ? "pass" : stat.type === "money" ? "warn" : "fail"
    };
  });
}

function reconcileSummaryComparisons(comparisons = [], tabChecks = [], expansion = {}) {
  return (comparisons || []).map((comparison) => {
    if ((comparison.key === "titles" || comparison.key === "finalTables") && comparison.source === "all-tab") {
      const tabCheck = (tabChecks || []).find((check) => check?.key === comparison.key);
      if (tabCheck?.selectedTab && tabCheck.status === "pass" && Number.isFinite(tabCheck.actual)) {
        return {
          ...comparison,
          calculated: tabCheck.actual,
          allCalculated: comparison.calculated,
          source: "profile-tab",
          sourceLabel: "Profile Tab Visible Rows",
          status: comparison.top === tabCheck.actual ? "pass" : "fail"
        };
      }
    }

    if (
      comparison.key === "cashes"
      && comparison.status === "fail"
      && expansion?.expectedCashes
      && !expansion?.reachedExpectedCashes
      && Number.isFinite(expansion?.finalEventCount)
      && expansion.finalEventCount < expansion.expectedCashes
    ) {
      return {
        ...comparison,
        sourceLabel: "Calculated From ALL Tab (collection incomplete)",
        collectionIncomplete: true,
        status: "warn"
      };
    }

    return comparison;
  });
}

function standingsMetricDef(category) {
  if (/all-time earnings/i.test(category || "")) {
    return { key: "totalEarnings", label: "Total Earnings", type: "money" };
  }
  if (/all-time bracelets/i.test(category || "")) {
    return { key: "bracelets", label: "Bracelets", type: "number" };
  }
  if (/all-time rings/i.test(category || "")) {
    return { key: "rings", label: "Rings", type: "number" };
  }
  return null;
}

function parseStandingMetricValue(category, rowText) {
  const metric = standingsMetricDef(category);
  if (!metric) return null;

  const text = normalizeText(rowText);
  if (metric.type === "money") return parseMoneyFromText(text);

  const withoutLeadingRank = text.replace(/^\s*\d{1,6}\s+/, "");
  const matches = Array.from(withoutLeadingRank.matchAll(/\d[\d,]*/g));
  if (!matches.length) return null;
  return Number(matches[matches.length - 1][0].replace(/,/g, ""));
}

function buildStandingMetricSource(category, rowText) {
  const metric = standingsMetricDef(category);
  if (!metric) return {};
  return {
    metricKey: metric.key,
    metricLabel: metric.label,
    metricValue: parseStandingMetricValue(category, rowText)
  };
}

function compareStandingsSourcesToSummary(standingsSources = [], summary = {}) {
  return (standingsSources || [])
    .map((source) => {
      if (!source?.metricKey) return null;
      const profileValue = summary?.[source.metricKey];
      const standingValue = source.metricValue;
      const comparable = Number.isFinite(profileValue) && Number.isFinite(standingValue);
      return {
        category: source.category,
        brand: source.brand || "All",
        rank: source.rank,
        label: source.metricLabel,
        metricKey: source.metricKey,
        profileValue,
        standingValue,
        sourceUrl: source.sourceUrl,
        rowText: source.rowText,
        status: comparable ? (profileValue === standingValue ? "pass" : "fail") : "warn",
        detail: comparable
          ? `${source.category}: standings ${source.metricLabel}=${formatValue(source.metricLabel, standingValue)}, profile ${source.metricLabel}=${formatValue(source.metricLabel, profileValue)}`
          : `${source.category}: standings/profile ${source.metricLabel} value was not comparable`
      };
    })
    .filter(Boolean);
}

function formatValue(label, value) {
  if (value === null || value === undefined || value === "") return "-";
  if (/earning/i.test(label)) return `$${Number(value).toLocaleString("en-US")}`;
  return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
}

function formatLabel(label) {
  return {
    Title: "Title",
    Bracelets: "Bracelets Badge",
    Rings: "Rings Badge",
    "Final Tables": "Final Tables",
    Cashes: "Cashes",
    "Total Earnings": "Total Earnings"
  }[label] || label;
}

function formatStatus(status) {
  return {
    pass: "통과",
    fail: "실패",
    warn: "주의"
  }[status] || status || "-";
}

// 모든 비교 계층에서 결함 후보를 만든다.
// 크롤러/탐색 미완료와 실제 페이지 데이터 불일치는 리포트에서 구분한다.
function buildDefects(player) {
  const defects = [];
  const playerBrands = Array.from(new Set((player.standingsSources || []).map(s => s.brand || "All"))).join(", ");

  for (const comparison of player.comparisons || []) {
    if (comparison.status !== "fail") continue;
    const isBadgeComparison = comparison.source === "profile-badge";
    const detailParts = [
      isBadgeComparison
        ? `${comparison.label}: profile=${formatValue(comparison.label, comparison.top)}, badge=${formatValue(comparison.label, comparison.calculated)}`
        : `${comparison.label}: top=${formatValue(comparison.label, comparison.top)}, calculated=${formatValue(comparison.label, comparison.calculated)}`
    ];
    if (isBadgeComparison && Number.isFinite(comparison.allCalculated)) {
      detailParts.push(`ALL tab calculated=${formatValue(comparison.label, comparison.allCalculated)}`);
    }
    if (comparison.source === "profile-tab" && Number.isFinite(comparison.allCalculated)) {
      detailParts.push(`ALL tab calculated=${formatValue(comparison.label, comparison.allCalculated)}`);
    }
    if (player.expansion?.expectedCashes && !player.expansion?.reachedExpectedCashes) {
      detailParts.push(`ALL tab collection incomplete: rows=${player.expansion.finalEventCount ?? (player.events || []).length}, expectedCashes=${player.expansion.expectedCashes}, loadMoreClicks=${player.expansion.loadMoreClicks ?? 0}, stopped=${player.expansion.stoppedReason || "-"}`);
    }
    defects.push({
      brand: playerBrands,
      type: isBadgeComparison ? "Profile badge count mismatch" : "Profile summary mismatch",
      player: player.name,
      item: comparison.label,
      expected: formatValue(comparison.label, comparison.top),
      actual: formatValue(comparison.label, comparison.calculated),
      url: player.url,
      detail: detailParts.join(". ")
    });
  }

  for (const tabCheck of player.tabChecks || []) {
    if (tabCheck.status !== "fail") continue;
    defects.push({
      brand: playerBrands,
      type: "Profile tab count mismatch",
      player: player.name,
      item: tabCheck.label,
      expected: formatValue(tabCheck.label, tabCheck.expected),
      actual: tabCheck.selectedTab ? formatValue(tabCheck.label, tabCheck.actual) : "Tab not found",
      url: player.url,
      detail: tabCheck.detail
    });
  }

  for (const standingCheck of player.standingsChecks || []) {
    if (standingCheck.status !== "fail") continue;
    defects.push({
      brand: standingCheck.brand || playerBrands,
      type: "Standings/profile summary mismatch",
      player: player.name,
      item: `${standingCheck.category} ${standingCheck.label}`,
      expected: formatValue(standingCheck.label, standingCheck.standingValue),
      actual: formatValue(standingCheck.label, standingCheck.profileValue),
      url: player.url,
      detail: `${standingCheck.detail}. source=${standingCheck.sourceUrl || "-"}, row=${standingCheck.rowText || ""}`
    });
  }

  for (const event of player.events || []) {
    const result = event.resultPage;
    if (!result) continue;
    if (result.status === "pass" || result.status === "warn") continue;
    defects.push({
      brand: playerBrands,
      type: resultSearchIncomplete(result) ? "Result search incomplete" : "Result page mismatch",
      player: player.name,
      item: event.eventName,
      expected: `Final Result row: No ${event.rank ?? "-"}, ${player.name}, ${formatValue("Total Earnings", event.earnings)}`,
      actual: result.error || (resultSearchIncomplete(result) ? "Crawler did not fully cover the target rank range" : (result.foundRow ? `Found No ${result.foundRow.no}, ${result.foundRow.player}, ${formatValue("Total Earnings", result.foundRow.earnings)}` : `Missing: ${(result.missing || []).join(", ")}`)),
      url: result.url || event.resultUrl || player.url,
      detail: result.error || JSON.stringify({ checks: result.checks, searchedPages: result.searchedPages, foundRow: result.foundRow })
    });
  }

  if (player.error) {
    defects.push({
      brand: playerBrands,
      type: "Crawler error",
      player: player.name,
      item: "player crawl",
      expected: "Crawl completed",
      actual: player.error,
      url: player.url,
      detail: player.error
    });
  }

  return defects;
}

function hasWarningStatus(items) {
  return (items || []).some((item) => item?.status === "warn");
}

function playerStatus(player) {
  if (player?.error) return "fail";
  const defects = player?.defects?.length ? player.defects : buildDefects(player || {});
  if (defects.length) return "fail";
  if ((player?.warnings || []).length || hasWarningStatus(player?.comparisons) || hasWarningStatus(player?.tabChecks) || hasWarningStatus(player?.standingsChecks) || (player?.events || []).some((event) => event.resultPage?.status === "warn")) {
    return "warn";
  }
  return "pass";
}

async function waitForAccessLogin(page, authWaitMs) {
  const bodyText = normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
  const title = normalizeText(await page.title().catch(() => ""));
  const isAccessPage = /cloudflare access|sign in with|send login code/i.test(`${title} ${bodyText}`);

  if (!isAccessPage) return;
  if (!authWaitMs || authWaitMs <= 0) {
    throw new Error("Cloudflare Access login is required. Run headed with --auth-wait-ms 300000.");
  }

  console.log(`Cloudflare Access login detected. Complete login within ${authWaitMs}ms.`);
  await page.waitForFunction(
    () => !/cloudflare access|sign in with|send login code/i.test(`${document.title} ${document.body?.innerText || ""}`),
    null,
    { timeout: authWaitMs }
  );
  await page.waitForLoadState("networkidle").catch(() => {});
}

// 설정된 standings 카테고리에서 선수 URL을 수집한다. 같은 선수가 여러
// 카테고리에 등장할 수 있으므로 출처 정보는 보존하고 프로필 URL 기준으로 중복 제거한다.
async function collectPlayerUrls(page, playersUrl, limit, authWaitMs) {
  const entries = await collectPlayerEntries(page, playersUrl, limit, authWaitMs);
  return entries.map((entry) => entry.url);
}

async function clickExactTextControl(page, label) {
  const selector = `button:has-text("${label}"), a:has-text("${label}"), [role=tab]:has-text("${label}"), [role=button]:has-text("${label}")`;
  const controls = page.locator(selector);
  const count = await controls.count().catch(() => 0);
  const exactPattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, "i");

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const text = normalizeText(await control.innerText({ timeout: 1000 }).catch(() => ""));
    if (!exactPattern.test(text)) continue;
    if (!(await control.isVisible().catch(() => false))) continue;
    await control.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  }

  return false;
}

async function clickControlWithFallback(control, timeout = 5000) {
  try {
    await control.click({ timeout });
    return true;
  } catch (error) {
    const message = String(error?.message || "");
    const canFallback = /intercepts pointer events|not receiving pointer events|Timeout/i.test(message);
    if (!canFallback) throw error;
  }

  // Playwright force click fallback
  const forceClickSuccess = await control.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
  if (forceClickSuccess) return true;

  // DOM evaluate click fallback
  return await control.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    if (typeof element.click === "function") {
      element.click();
      return true;
    }
    return element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }).catch(() => false);
}

async function extractStandingPlayerLinks(page, limit, containerSelector) {
  const links = await page.evaluate((selector) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const root = selector ? document.querySelector(selector) : document;
    if (!root) return [];
    return Array.from(root.querySelectorAll("a[href]"))
      .map((anchor) => {
        const row = anchor.closest('tr, li, [class*="row" i], [class*="item" i], [class*="card" i]');
        return {
          href: anchor.href,
          text: normalize(anchor.textContent),
          rowText: normalize(row?.textContent || anchor.textContent)
        };
      })
      .filter((item) => {
        try {
          const url = new URL(item.href);
          const parts = url.pathname.split("/").filter(Boolean);
          return parts[0] === "players" && parts.length >= 2;
        } catch {
          return false;
        }
      });
  }, containerSelector || null);

  const seen = new Set();
  const rows = [];
  for (const link of links) {
    const cleanUrl = link.href.split("#")[0];
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    rows.push({
      url: cleanUrl,
      name: cleanPlayerName(link.text, cleanUrl),
      rowText: link.rowText,
      rank: rows.length + 1
    });
    if (limit > 0 && rows.length >= limit) break;
  }
  return rows;
}

// standings 카테고리 URL을 만든다. 기존 stage URL과 공개 wsop.com 경로 형식을 모두 지원한다.
// path가 null인 카테고리 (예: All Player Stats)는 URL을 생성하지 않고 null을 반환한다.
function categoryUrlFor(playersUrl, category) {
  if (!category.path) return null;
  try {
    const url = new URL(playersUrl);
    return new URL(`/player-standings/${category.path}/`, url.origin).href;
  } catch {
    return null;
  }
}

function parseItmCount(bodyText) {
  if (!bodyText) return null;
  const match = bodyText.match(/itm\b[^\d]*(\d[\d,]*)/i);
  if (match) {
    return Number(match[1].replace(/,/g, ""));
  }
  return null;
}

function normalizeBrandOptionLabel(value) {
  return normalizeText(value)
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderBrandOption(value) {
  const label = normalizeBrandOptionLabel(value).toLowerCase();
  return !label
    || label === "all"
    || label === "all brand"
    || label === "all brands"
    || label === "brand"
    || label === "brands"
    || label === "select brand"
    || label === "select brands";
}

function uniqueBrandOptionLabels(values) {
  const seen = new Set();
  const result = [];

  for (const value of values || []) {
    const label = normalizeBrandOptionLabel(value);
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(label);
  }

  return result;
}

function compactBrandLabel(value) {
  return normalizeBrandOptionLabel(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function brandSelectionAliases(brand) {
  const label = normalizeBrandOptionLabel(brand);
  const compact = compactBrandLabel(label);
  const aliases = new Set([label]);

  if (compact.startsWith("WSOP")) {
    aliases.add("WSOP");
  }
  if (compact === "GGPOKER") {
    aliases.add("GGPoker");
  }
  if (compact === "GGMASTERS") {
    aliases.add("GGMasters");
    aliases.add("GGMASTERS");
  }
  if (compact === "GGMILLION" || compact === "GGMILLIONS" || compact === "GGMILLON" || compact === "GGMILLONS") {
    aliases.add("GGMillion$");
    aliases.add("GGMillions");
    aliases.add("GGMILLION$");
    aliases.add("GGMILLIONS");
  }
  if (compact === "WPTPRIME") {
    aliases.add("WPT Prime");
    aliases.add("WPT PRIME");
  }
  if (compact === "IRISHPOKEROPEN") {
    aliases.add("Irish Poker Open");
    aliases.add("IRISH POKER OPEN");
  }
  if (compact === "IRISHPOKERTOUR") {
    aliases.add("Irish Poker Tour");
    aliases.add("IRISH POKER TOUR");
  }
  if (compact === "TRITON") {
    aliases.add("Triton");
    aliases.add("TRITON");
  }
  if (compact === "PGT" || compact === "PGTPOKERGOTOUR") {
    aliases.add("PGT");
    aliases.add("PGT (Poker Go Tour)");
    aliases.add("Poker Go Tour");
  }
  if (compact === "BSOP" || compact === "BSOPBRAZILIANSERIESOFPOKER") {
    aliases.add("BSOP");
    aliases.add("BSOP (Brazilian Series of Poker)");
    aliases.add("Brazilian Series of Poker");
  }
  if (compact === "APT" || compact === "APTASIANPOKERTOUR") {
    aliases.add("APT");
    aliases.add("APT (Asian Poker Tour)");
    aliases.add("Asian Poker Tour");
  }

  return Array.from(aliases).filter(Boolean);
}

function shouldApplyBrandFilter(category) {
  return !BRAND_FILTER_EXCLUDED_CATEGORIES.has(category.label);
}

async function selectBrandFilter(page, brand) {
  const aliases = brandSelectionAliases(brand);
  const aliasKeys = aliases.map(compactBrandLabel);
  const selectLocator = page.locator("select").first();
  const hasSelect = (await selectLocator.count()) > 0 && (await selectLocator.isVisible().catch(() => false));

  if (hasSelect) {
    const options = await selectLocator.evaluate((select) => Array.from(select.options || []).map((option) => ({
      label: (option.textContent || "").trim(),
      value: option.value
    }))).catch(() => []);

    const matched = options.find((option) => {
      const labelKey = compactBrandLabel(option.label);
      const valueKey = compactBrandLabel(option.value);
      return aliasKeys.some(aliasKey => 
        labelKey.includes(aliasKey) || 
        aliasKey.includes(labelKey) || 
        valueKey.includes(aliasKey) || 
        aliasKey.includes(valueKey)
      );
    });

    if (matched) {
      await selectLocator.selectOption({ value: matched.value }).catch(async () => {
        await selectLocator.selectOption({ label: matched.label }).catch(() => {});
      });
      return true;
    }
  }

  const triggerPatterns = [
    "All Brands", "Brand", "Brands", "Select Brand", "Select Brands", "WSOP", "GGPoker", "WPT", "PGT", "BSOP", "APT", "Triton", "Irish Poker",
    ...aliases
  ];
  const triggerRegex = new RegExp(triggerPatterns.map(escapeRegExp).join("|"), "i");

  let dropdownTrigger = page.locator("button.select-box, button.select-container, button").filter({ hasText: triggerRegex }).first();
  if ((await dropdownTrigger.count()) === 0 || !(await dropdownTrigger.isVisible().catch(() => false))) {
    dropdownTrigger = page.locator("div.select-box, div.select-container, [class*=select-box i], a, div, span").filter({ hasText: triggerRegex }).first();
  }

  if ((await dropdownTrigger.count()) > 0 && (await dropdownTrigger.isVisible().catch(() => false))) {
    await dropdownTrigger.click().catch(() => {});
    await page.waitForTimeout(500);

    const matchedOptionText = await page.evaluate((keys) => {
      const normalize = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };

      const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, a, button'))
        .filter(visible)
        .map(el => ({ text: (el.textContent || "").trim(), compact: normalize(el.textContent) }))
        .filter(item => item.text.length > 0 && item.text.length < 80);

      const found = items.find(item => 
        keys.some(aliasKey => 
          item.compact.includes(aliasKey) || aliasKey.includes(item.compact)
        )
      );
      return found ? found.text : null;
    }, aliasKeys).catch(() => null);

    if (matchedOptionText) {
      const optionItem = page.locator('[role="option"], li, a, button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(matchedOptionText)}\\s*$`, "i") }).first();
      if ((await optionItem.count()) > 0) {
        await optionItem.click().catch(() => {});
        return true;
      }
    }

    for (const alias of aliases) {
      const optionItems = page.locator('[role="option"], li, a, button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(alias)}\\s*$`, "i") }).first();
      if ((await optionItems.count()) > 0 && (await optionItems.isVisible().catch(() => true))) {
        await optionItems.click().catch(() => {});
        return true;
      }
    }
  }

  return false;
}

async function collectBrandOptionsFromCurrentPage(page) {
  const selectCandidates = await page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    return Array.from(document.querySelectorAll("select"))
      .filter(visible)
      .map((select) => {
        const options = Array.from(select.options || [])
          .map((option) => (option.textContent || option.value || "").trim())
          .filter(Boolean);
        const label = [
          select.getAttribute("aria-label"),
          select.getAttribute("name"),
          select.id,
          select.closest("label")?.textContent
        ].filter(Boolean).join(" ");
        return { label, options };
      });
  }).catch(() => []);

  const brandishSelect = selectCandidates.find((candidate) => {
    const haystack = `${candidate.label || ""} ${(candidate.options || []).join(" ")}`;
    return /brand|wsop|ggpoker|wpt|pgt|poker/i.test(haystack);
  }) || selectCandidates.find((candidate) => (candidate.options || []).length > 1);

  if (brandishSelect?.options?.length) {
    return uniqueBrandOptionLabels(brandishSelect.options);
  }

  let trigger = page.locator("button.select-box, button.select-container, button").filter({ hasText: /All Brands|Brand|WSOP/i }).first();
  if (await trigger.count() === 0) {
    trigger = page.locator("div.select-box, div.select-container, [class*=select-box i], a, div, span").filter({ hasText: /All Brands|Brand|WSOP/i }).first();
  }
  if ((await trigger.count()) > 0 && (await trigger.isVisible().catch(() => false))) {
    await trigger.click().catch(() => {});
    await page.waitForTimeout(1000);

    const dropdownOptions = await page.evaluate(() => {
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };

      const listboxOptions = Array.from(document.querySelectorAll('ul.option-list li, [role="listbox"] [role="option"], .select-container ul li'))
        .filter(visible)
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);

      if (listboxOptions.length > 0) {
        return { source: 'listbox', options: listboxOptions };
      }

      const fallback = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, a, button'))
        .filter(visible)
        .map((el) => (el.textContent || "").trim())
        .filter((text) => text && text.length <= 80);

      return { source: 'fallback', options: fallback };
    }).catch(() => ({ source: 'error', options: [] }));

    if (dropdownOptions.source === 'listbox') {
      return uniqueBrandOptionLabels(dropdownOptions.options);
    }
    return uniqueBrandOptionLabels(dropdownOptions.options.filter((text) => /brand|wsop|ggpoker|wpt|pgt|poker|masters|million|circuit|paradise|europe|asia|online|irish/i.test(text)));
  }

  return [];
}

async function collectBrandOptions(page, playersUrl, authWaitMs) {
  const sourceCategory = STANDINGS_CATEGORIES.find((category) => category.label !== "2026 Standings" && categoryUrlFor(playersUrl, category))
    || STANDINGS_CATEGORIES.find((category) => categoryUrlFor(playersUrl, category));
  const sourceUrl = sourceCategory ? categoryUrlFor(playersUrl, sourceCategory) : playersUrl;

  await retryWithBackoff(async () => {
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await waitForAccessLogin(page, authWaitMs);
  }, 2, 1500);

  const rawOptions = uniqueBrandOptionLabels(await collectBrandOptionsFromCurrentPage(page));
  const options = rawOptions.filter((option) => !isPlaceholderBrandOption(option));

  return {
    collectedAt: new Date().toISOString(),
    sourceCategory: sourceCategory?.label || "Player standings",
    sourceUrl: page.url(),
    count: options.length,
    rawCount: rawOptions.length,
    options,
    rawOptions
  };
}


async function collectPlayerEntries(page, playersUrl, limit, authWaitMs, brand = null) {
  if (limit <= 0) return [];

  const byUrl = new Map();
  let selectedAnyCategory = false;
  const brands = brand ? splitBrandArgument(brand) : [null];

  for (const currentBrand of brands) {
    await retryWithBackoff(async () => {
      await page.goto(playersUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await waitForAccessLogin(page, authWaitMs);
    }, 2, 2000);

    for (const category of STANDINGS_CATEGORIES) {
      if (currentBrand && !shouldApplyBrandFilter(category)) {
        console.log(`  [크롤러] 브랜드 필터 제외 카테고리 skip: ${category.label}`);
        continue;
      }

      const categoryUrl = categoryUrlFor(playersUrl, category);
      let selected = false;

      if (category.sectionSelector) {
        try {
          const currentUrl = page.url();
          const isOnMainPage = /\/player-standings\/?$/i.test(new URL(currentUrl).pathname);
          if (!isOnMainPage) {
            await retryWithBackoff(async () => {
              await page.goto(playersUrl, { waitUntil: "domcontentloaded" });
              await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
              await waitForAccessLogin(page, authWaitMs);
            }, 2, 1500);
          }
          const sectionExists = await page.locator(category.sectionSelector).count().then((c) => c > 0).catch(() => false);
          selected = sectionExists;
        } catch {
          selected = false;
        }
      } else if (categoryUrl) {
        try {
          await retryWithBackoff(async () => {
            await page.goto(categoryUrl, { waitUntil: "domcontentloaded" });
            await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
            await waitForAccessLogin(page, authWaitMs);
          }, 2, 1500);
          selected = true;
        } catch {
          selected = false;
        }
      } else {
        selected = await clickExactTextControl(page, category.label);
      }
      if (!selected) continue;

      if (currentBrand) {
        console.log(`  [크롤러] 브랜드 필터 적용 중: "${currentBrand}"`);
        const applied = await selectBrandFilter(page, currentBrand);
        if (!applied) {
          console.warn(`  [경고] 브랜드 필터 옵션을 찾지 못했습니다: "${currentBrand}"`);
        }
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }

      let rows = await extractStandingPlayerLinks(page, limit, category.sectionSelector || null);

      if (currentBrand && rows.length < limit) {
        const nextButton = page.locator('button, a').filter({ hasText: /next|load more|show more/i }).first();
        const hasNext = (await nextButton.count()) > 0 && (await nextButton.isVisible().catch(() => false));

        if (hasNext) {
          console.log(`  [크롤러] 다음 페이지(2페이지) 수집을 시도합니다.`);
          await nextButton.click().catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(1000);

          const page2Rows = await extractStandingPlayerLinks(page, limit - rows.length, category.sectionSelector || null);
          rows = rows.concat(page2Rows);
        }
      }

      if (!rows.length) continue;
      selectedAnyCategory = true;

      for (const row of rows) {
        if (!byUrl.has(row.url)) {
          byUrl.set(row.url, { url: row.url, standingsSources: [] });
        }
        byUrl.get(row.url).standingsSources.push({
          category: category.label,
          rank: row.rank,
          name: row.name,
          rowText: row.rowText,
          sourceUrl: page.url(),
          brand: currentBrand || "All",
          ...buildStandingMetricSource(category.label, row.rowText)
        });
      }
    }
  }

  if (!selectedAnyCategory) {
    const rows = await extractStandingPlayerLinks(page, limit);
    for (const row of rows) {
      byUrl.set(row.url, {
        url: row.url,
        standingsSources: [{ category: "Default standings view", rank: row.rank, name: row.name, rowText: row.rowText, selected: false, brand: "All" }]
      });
    }
  }

  return Array.from(byUrl.values());
}
function playerNameFromUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split("/").filter(Boolean);
    const slug = parts[1] || "";
    if (!slug || /^\d+$/.test(slug)) return "";
    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

// 프로필 제목에 배지, 반복 텍스트, 닉네임이 섞이면 standings 출처의 이름을 우선 사용한다.
function cleanPlayerName(nameValue, urlValue) {
  let name = normalizeText(nameValue).replace(/\bPlayer Profile\b/gi, "").trim();
  const slugName = playerNameFromUrl(urlValue);
  const normalizedName = normalizeComparable(name);
  const normalizedSlug = normalizeComparable(slugName);

  if (slugName && normalizedSlug) {
    if (normalizedName === normalizedSlug.repeat(2) || (normalizedName.includes(normalizedSlug) && normalizedName !== normalizedSlug)) {
      return slugName;
    }
  }

  if (name.length % 2 === 0) {
    const half = name.length / 2;
    const first = name.slice(0, half);
    const second = name.slice(half);
    if (normalizeComparable(first) === normalizeComparable(second)) {
      return normalizeText(first);
    }
  }

  return name || slugName || urlValue;
}

function canonicalPlayerName(profileName, standingsSources = []) {
  const cleanedProfileName = normalizeText(profileName);
  const sourceNames = standingsSources
    .map((source) => normalizeText(source.name))
    .filter(Boolean);

  for (const sourceName of sourceNames) {
    const profileComparable = normalizeComparable(cleanedProfileName);
    const sourceComparable = normalizeComparable(sourceName);
    if (sourceComparable && profileComparable.includes(sourceComparable)) {
      return sourceName;
    }
  }

  return cleanedProfileName;
}

async function extractPlayerName(page) {
  const headings = await page.locator("h1, h2, [data-testid*=name i], [class*=name i]").evaluateAll((nodes) => nodes.map((node) => node.textContent || "")).catch(() => []);
  const title = await page.title().catch(() => "");
  const heading = headings.map(normalizeText).find((value) => value && !/^player profile$/i.test(value));
  return cleanPlayerName(heading || normalizeText(title).replace(/\s*\|\s*WSOP\.com.*$/i, ""), page.url());
}

// WSOP가 어떤 표 구조로 렌더링하든 보이는 프로필 이벤트 row를 추출한다.
// Result 컨트롤은 링크, 버튼, 비활성 컨트롤, 숨은 href일 수 있어 row 구조를 넓게 받는다.
async function extractEventRows(page) {
  const rawRows = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const rows = [];
    let rowIndex = 0;

    function headersForTable(table) {
      for (const row of Array.from(table.querySelectorAll("thead tr, tr")).slice(0, 2)) {
        const cells = Array.from(row.querySelectorAll("th"));
        if (cells.length) return cells.map((cell) => normalize(cell.textContent));
      }
      return [];
    }

    function looksLikeEventRow(text) {
      return /[$₩₱€£¥\u20a9\u20b1]\s*[\d,]+/.test(text) || /\b(result|results|place|rank|finish|event|bracelet|ring|circuit|wsop)\b/i.test(text);
    }

    function isVisibleElement(element) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
      return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    }

    function isDisabledControl(element) {
      const disabledClassPattern = /(?:^|[\s_-])(disabled|disable|inactive|unavailable|locked)(?:$|[\s_-])/i;
      const closestDisabled = element.closest("[disabled], [aria-disabled='true'], .disabled, .is-disabled, .inactive, .unavailable, .locked");
      const className = typeof element.className === "string" ? element.className : "";
      const style = window.getComputedStyle(element);
      return Boolean(element.disabled)
        || element.getAttribute("aria-disabled") === "true"
        || element.getAttribute("disabled") !== null
        || disabledClassPattern.test(className)
        || Boolean(closestDisabled)
        || style.pointerEvents === "none";
    }

    for (const table of Array.from(document.querySelectorAll("table"))) {
      if (!isVisibleElement(table)) continue;
      const headers = headersForTable(table);
      const tableRows = Array.from(table.querySelectorAll("tbody tr")).length
        ? Array.from(table.querySelectorAll("tbody tr"))
        : Array.from(table.querySelectorAll("tr")).slice(headers.length ? 1 : 0);

      for (const row of tableRows) {
        if (!isVisibleElement(row)) continue;
        const cells = Array.from(row.querySelectorAll("td, th")).map((cell) => normalize(cell.textContent));
        const text = cells.length ? cells.join(" ") : normalize(row.textContent);
        if (!cells.length || !looksLikeEventRow(text)) continue;

        row.setAttribute("data-wsop-crawler-row", String(rowIndex));
        const resultControls = Array.from(row.querySelectorAll("a[href], button, [role='button']")).map((element) => ({
          element,
          href: element.href || "",
          text: normalize([
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.href || ""
          ].filter(Boolean).join(" ")),
          disabled: isDisabledControl(element)
        })).filter((control) => /result/i.test(control.text));
        const enabledResultControls = resultControls.filter((control) => !control.disabled);
        const resultLink = enabledResultControls.find((control) => control.href);
        const disabledResultLink = resultControls.find((control) => control.disabled && control.href);
        const hasDisabledResultControl = resultControls.some((control) => control.disabled);

        rows.push({
          rowIndex,
          text,
          cells,
          headers,
          resultUrl: resultLink?.href || null,
          disabledResultUrl: disabledResultLink?.href || null,
          hasResultControl: enabledResultControls.length > 0,
          resultUnavailable: enabledResultControls.length === 0 && hasDisabledResultControl,
          resultUnavailableReason: enabledResultControls.length === 0 && hasDisabledResultControl
            ? "Result 버튼/링크가 비활성화되어 아직 검증 가능한 Result 페이지가 아닙니다."
            : ""
        });
        rowIndex += 1;
      }
    }

    return rows;
  });

  return rawRows
    .map(normalizeEvent)
    .filter((event) => {
      const eventName = normalizeText(event.eventName);
      const hasEventShape = event.cells.length >= 3 && eventName && !/^series\s*\/?\s*events?$/i.test(eventName);
      return hasEventShape || event.rank !== null || event.earnings !== null || event.hasResultControl || event.resultUnavailable;
    });
}

// 전역 사이트 네비게이션이 아니라 프로필 내부 탭만 선택한다.
// header의 "BRACELETS" 같은 링크를 잘못 눌러 프로필 페이지를 벗어나는 일을 막는다.
async function selectProfileTab(page, tabLabel) {
  const selector = `button:has-text("${tabLabel}"), a:has-text("${tabLabel}"), [role=tab]:has-text("${tabLabel}")`;
  const controls = page.locator(selector);
  const count = await controls.count().catch(() => 0);
  const exactPattern = new RegExp(`^\\s*${escapeRegExp(tabLabel)}\\s*$`, "i");
  const currentPath = new URL(page.url()).pathname.replace(/\/+$/, "");
  const candidates = [];

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const text = normalizeText(await control.innerText({ timeout: 1000 }).catch(() => ""));
    if (!exactPattern.test(text)) continue;
    if (!(await control.isVisible().catch(() => false))) continue;
    const candidate = await control.evaluate((element, currentPathname) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const href = element.href || element.getAttribute("href") || "";
      let hrefPath = "";
      try {
        hrefPath = href ? new URL(href, window.location.href).pathname.replace(/\/+$/, "") : "";
      } catch {}
      const inGlobalChrome = Boolean(element.closest("header, nav, footer"));
      const classText = normalize([
        element.className,
        element.getAttribute("role"),
        element.getAttribute("aria-controls"),
        element.getAttribute("data-tab"),
        element.getAttribute("data-testid")
      ].filter(Boolean).join(" "));
      const hrefLeavesProfile = Boolean(hrefPath && hrefPath !== currentPathname);
      const tabLike = element.tagName === "BUTTON"
        || element.getAttribute("role") === "tab"
        || /\b(tab|filter|category|profile)\b/i.test(classText)
        || !href
        || href.startsWith("#")
        || hrefPath === currentPathname;
      let score = 0;
      if (element.getAttribute("role") === "tab") score += 6;
      if (element.tagName === "BUTTON") score += 5;
      if (/\b(tab|filter|category|profile)\b/i.test(classText)) score += 4;
      if (!href || href.startsWith("#") || hrefPath === currentPathname) score += 3;
      if (inGlobalChrome) score -= 10;
      if (hrefLeavesProfile) score -= 20;
      if (!tabLike || hrefLeavesProfile) return null;
      return { score };
    }, currentPath).catch(() => null);
    if (!candidate) continue;
    candidates.push({ control, score: candidate.score });
  }

  candidates.sort((left, right) => right.score - left.score);
  for (const { control } of candidates) {
    const beforeUrl = page.url();
    await control.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const afterUrl = page.url();
    const afterPath = new URL(afterUrl).pathname.replace(/\/+$/, "");
    if (afterPath !== currentPath) {
      await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      continue;
    }
    return true;
  }

  return false;
}

async function findVisibleLoadMoreControl(page) {
  const handle = await page.evaluateHandle(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    
    // button, a, [role=button], input 등과 더보기 관련 텍스트가 있을 만한 div, span 요소를 쿼리합니다.
    const candidates = Array.from(document.querySelectorAll(
      "button, a, [role=button], input[type=button], input[type=submit], div, span"
    ));

    // 역순으로 탐색 (더보기 버튼은 보통 하단에 가깝습니다)
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const element = candidates[i];
      const tagName = element.tagName.toLowerCase();
      const textContent = element.textContent || "";
      const className = element.className || "";

      // div와 span인 경우 텍스트에 관련 키워드가 없으면 빠르게 건너뛰어 성능을 향상시킵니다.
      if ((tagName === "div" || tagName === "span") && !/more|load|show|view/i.test(textContent)) {
        continue;
      }

      // div와 span은 단순 안내 텍스트(예: "Show 10 more results")일 가능성이 크므로, 
      // 명확한 버튼 형태의 속성이나 스타일(cursor: pointer)을 가진 경우만 후보로 채택합니다.
      if (tagName === "div" || tagName === "span") {
        const isClickableClass = /btn|button|click|load-more|show-more|pointer/i.test(className)
          || /btn|button|click|load-more|show-more|pointer/i.test(element.getAttribute("id") || "")
          || element.getAttribute("role") === "button";
        const style = window.getComputedStyle(element);
        const hasPointerCursor = style.cursor === "pointer";

        if (!isClickableClass && !hasPointerCursor) {
          continue;
        }
      }

      const visibleText = normalize(
        element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("value") || ""
      );

      // 고정 loading 클래스로 활성 버튼이 비활성 오인되는 것을 방지
      const isActuallyLoading = /(^|\s)(is-loading|active-loading|loading-active|loading-state)(\s|$)/i.test(className)
        || (/(^|\s)loading(\s|$)/i.test(className) && !/lazy|more|placeholder/i.test(className));

      const disabled = Boolean(element.disabled)
        || element.getAttribute("aria-disabled") === "true"
        || /disabled/i.test(className)
        || isActuallyLoading;

      if (disabled) continue;

      // 텍스트 매칭 검사
      const loadMoreLike = /\b(load\s*more|show\s*more|view\s*more|more\s*results|more\s*events)\b/i.test(visibleText)
        || /\b(loadmore|showmore|more-results|more-events)\b/i.test(visibleText)
        || (/\b(more|show|view)\b/i.test(visibleText) && !/\b(less|hide)\b/i.test(visibleText));

      if (!loadMoreLike) continue;

      // wrongControl 검사 (오분류 차단)
      const wrongControl = /\b(result|results page|search|filter|sort|previous|prev|next)\b/i.test(visibleText)
        && !/\b(load\s*more|show\s*more|more\s*results|more\s*events|loadmore|showmore)\b/i.test(visibleText);

      if (wrongControl) continue;

      // 요소의 실제 가시성(Visibility) 체크
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const isVisible = style.display !== "none" 
        && style.visibility !== "hidden" 
        && rect.width > 0 
        && rect.height > 0;

      if (isVisible) {
        return element;
      }
    }
    return null;
  }).catch(() => null);

  if (handle) {
    const element = handle.asElement();
    if (element) return element;
  }
  return null;
}

async function waitForVisibleLoadMoreControl(page, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastControl = await findVisibleLoadMoreControl(page);
  let scrollStep = 0;

  while (!lastControl && Date.now() < deadline) {
    if (scrollStep % 2 === 0) {
      await page.evaluate(() => {
        const height = document.body.scrollHeight;
        window.scrollTo(0, height * 0.7);
        setTimeout(() => window.scrollTo(0, height), 150);
      }).catch(() => {});
    } else {
      await page.keyboard.press("PageDown").catch(() => {});
      await page.keyboard.press("PageDown").catch(() => {});
    }
    scrollStep += 1;

    await page.waitForLoadState("networkidle", { timeout: 400 }).catch(() => {});
    await page.waitForTimeout(300);
    lastControl = await findVisibleLoadMoreControl(page);
  }

  return lastControl;
}

// 더보기 클릭 후 이벤트 수가 늘어날 때까지 기다린다.
// 최신 row를 반환해 버튼 정체를 감지하면서도 부분 수집 데이터는 보존한다.
async function waitForEventRowsToIncrease(page, beforeCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let latestEvents = await extractEventRows(page);

  while (Date.now() < deadline) {
    if (latestEvents.length > beforeCount) return latestEvents;
    await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(700);
    latestEvents = await extractEventRows(page);
  }

  return latestEvents;
}

// Load more can append rows or replace the visible window.
// Keep a cumulative event list and accept either count growth or visible-row changes.
async function waitForEventRowsUpdate(page, collectedEvents, beforeVisibleEvents = [], timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const beforeSignature = eventRowsSignature(beforeVisibleEvents);
  let latestVisibleEvents = await extractEventRows(page);
  let latestMerge = mergeVisibleEventRows(collectedEvents, latestVisibleEvents);

  while (Date.now() < deadline) {
    const latestSignature = eventRowsSignature(latestVisibleEvents);
    if (latestMerge.added > 0 || (beforeSignature && latestSignature && latestSignature !== beforeSignature)) {
      return {
        events: latestMerge.events,
        visibleEvents: latestVisibleEvents,
        added: latestMerge.added,
        changed: latestSignature !== beforeSignature
      };
    }
    await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(700);
    latestVisibleEvents = await extractEventRows(page);
    latestMerge = mergeVisibleEventRows(collectedEvents, latestVisibleEvents);
  }

  return {
    events: latestMerge.events,
    visibleEvents: latestVisibleEvents,
    added: latestMerge.added,
    changed: eventRowsSignature(latestVisibleEvents) !== beforeSignature
  };
}

// ALL 탭을 프로필 Cashes 수까지 펼친다.
// ALL 탭은 요약 계산과 Result 페이지 검증에 쓰는 기본 이벤트 목록이다.
async function expandAllEventRows(page, expectedCashes, maxLoadMore) {
  const expansion = {
    tab: "ALL",
    selectedAllTab: await selectProfileTab(page, "ALL"),
    loadMoreClicks: 0,
    expectedCashes,
    reachedExpectedCashes: false,
    stoppedReason: "not-started"
  };

  let visibleEvents = await extractEventRows(page);
  let events = visibleEvents;
  const expected = Number.isFinite(expectedCashes) && expectedCashes > 0 ? expectedCashes : null;
  let stalledClicks = 0;

  while (expansion.loadMoreClicks < maxLoadMore) {
    const uniqueCount = deduplicateComparisonEvents(events).uniqueEvents.length;
    if (expected && uniqueCount >= expected) {
      expansion.reachedExpectedCashes = true;
      expansion.stoppedReason = "expected-cashes-reached";
      break;
    }

    const loadMore = await waitForVisibleLoadMoreControl(page);
    if (!loadMore) {
      if (expected && events.length < expected && stalledClicks < 3) {
        stalledClicks += 1;
        await page.waitForTimeout(2000);
        continue;
      }
      console.log(`[디버그] ALL 탭 Load More 버튼을 찾지 못했습니다. (현재 수집된 이벤트 수: ${events.length}, 기대치: ${expected || '없음'})`);
      expansion.stoppedReason = expected && events.length < expected ? "load-more-not-found" : "complete";
      break;
    }

    const beforeCount = events.length;
    const beforeVisibleEvents = visibleEvents;
    await loadMore.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await clickControlWithFallback(loadMore, 10000);
    expansion.loadMoreClicks += 1;
    const update = await waitForEventRowsUpdate(page, events, beforeVisibleEvents);
    events = update.events;
    visibleEvents = update.visibleEvents;

    if (events.length <= beforeCount) {
      stalledClicks += 1;
      if (stalledClicks >= 3) {
        await page.waitForTimeout(3000);
        const finalVisible = await extractEventRows(page);
        const finalMerge = mergeVisibleEventRows(events, finalVisible);
        if (finalMerge.events.length > events.length) {
          events = finalMerge.events;
          visibleEvents = finalVisible;
          stalledClicks = 0;
          await page.waitForTimeout(500);
          continue;
        }
        expansion.stoppedReason = "row-count-did-not-increase";
        break;
      }
      await page.waitForTimeout(2000);
      continue;
    }

    stalledClicks = 0;
    await page.waitForTimeout(500);
  }

  if (expansion.stoppedReason === "not-started") {
    expansion.stoppedReason = expansion.loadMoreClicks >= maxLoadMore ? "max-load-more-reached" : (expected && events.length < expected ? "load-more-not-found" : "complete");
  }
  const finalUniqueCount = deduplicateComparisonEvents(events).uniqueEvents.length;
  if (expected && finalUniqueCount >= expected) expansion.reachedExpectedCashes = true;
  expansion.finalEventCount = events.length;
  return { events, expansion };
}

// 단일 지표 탭을 펼친 뒤 ALL과 같은 규칙으로 해당 지표를 계산한다.
// Title/Final Tables는 프로필 요약 비교의 우선 비교값으로도 사용한다.
async function expandCurrentProfileTabRows(page, expectedRows, maxLoadMore) {
  let visibleEvents = await extractEventRows(page);

  // 탭 전환 직후 렌더링 지연에 대한 방어 로직 (이벤트가 0개면 최대 5초간 폴링)
  if (visibleEvents.length === 0 && Number.isFinite(expectedRows) && expectedRows > 0) {
    for (let wait = 0; wait < 5; wait++) {
      await page.waitForTimeout(1000);
      visibleEvents = await extractEventRows(page);
      if (visibleEvents.length > 0) break;
    }
  }
  let events = visibleEvents;
  const expected = Number.isFinite(expectedRows) && expectedRows > 0 ? expectedRows : null;
  const expansion = {
    loadMoreClicks: 0,
    reachedExpectedRows: false,
    stoppedReason: expected ? "not-started" : "no-expected-count"
  };
  let stalledClicks = 0;

  while (expected && deduplicateComparisonEvents(events).uniqueEvents.length < expected && expansion.loadMoreClicks < maxLoadMore) {
    const loadMore = await waitForVisibleLoadMoreControl(page);
    if (!loadMore) {
      if (expected && events.length < expected && stalledClicks < 3) {
        stalledClicks += 1;
        await page.waitForTimeout(2000);
        continue;
      }
      console.log(`[디버그] 단일 지표 탭 Load More 버튼을 찾지 못했습니다. (현재 수집된 이벤트 수: ${events.length}, 기대치: ${expected || '없음'})`);
      expansion.stoppedReason = expected && events.length < expected ? "load-more-not-found" : "complete";
      break;
    }

    const beforeCount = events.length;
    const beforeVisibleEvents = visibleEvents;
    await loadMore.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await clickControlWithFallback(loadMore, 10000);
    expansion.loadMoreClicks += 1;
    const update = await waitForEventRowsUpdate(page, events, beforeVisibleEvents);
    events = update.events;
    visibleEvents = update.visibleEvents;

    if (events.length <= beforeCount) {
      stalledClicks += 1;
      if (stalledClicks >= 3) {
        await page.waitForTimeout(3000);
        const finalVisible = await extractEventRows(page);
        const finalMerge = mergeVisibleEventRows(events, finalVisible);
        if (finalMerge.events.length > events.length) {
          events = finalMerge.events;
          visibleEvents = finalVisible;
          stalledClicks = 0;
          await page.waitForTimeout(500);
          continue;
        }
        expansion.stoppedReason = "row-count-did-not-increase";
        break;
      }
      await page.waitForTimeout(2000);
      continue;
    }

    stalledClicks = 0;
    await page.waitForTimeout(500);
  }

  if (expected && deduplicateComparisonEvents(events).uniqueEvents.length >= expected) {
    expansion.reachedExpectedRows = true;
    expansion.stoppedReason = "expected-rows-reached";
  } else if (expected && expansion.stoppedReason === "not-started") {
    expansion.stoppedReason = expansion.loadMoreClicks >= maxLoadMore ? "max-load-more-reached" : (expected && events.length < expected ? "load-more-not-found" : "complete");
  }

  return { events, expansion };
}

// 모든 지표 탭을 열어 각 탭 자체의 조건 계산값을 구한다.
// 이후 프로필 요약값 및 ALL 탭 계산값과 각각 비교한다.
async function collectProfileTabChecks(page, summary, maxLoadMore, disabledResultMode, skippedComparisonEvents = [], allEvents = []) {
  const checks = [];
  const tabEventsByKey = {};
  const skippedEvents = disabledResultMode === "skip" ? skippedComparisonEvents || [] : [];

  for (const tabCheck of PROFILE_TAB_CHECKS) {
    const expected = summary?.[tabCheck.summaryKey];
    const check = {
      key: tabCheck.key,
      label: tabCheck.label,
      summaryKey: tabCheck.summaryKey,
      expected,
      actual: null,
      selectedTab: null,
      status: "warn",
      detail: ""
    };

    for (const tabLabel of tabCheck.tabLabels) {
      if (await selectProfileTab(page, tabLabel)) {
        check.selectedTab = tabLabel;
        break;
      }
    }

    if (!check.selectedTab) {
      check.status = Number.isFinite(expected) && expected > 0 ? "fail" : "warn";
      check.detail = `Profile tab not found. Tried: ${tabCheck.tabLabels.join(", ")}.`;
      checks.push(check);
      continue;
    }

    const { events: tabEvents, expansion } = await expandCurrentProfileTabRows(page, expected, maxLoadMore);
    const skippedForTab = skippedEvents.filter((event) => eventContributesToProfileTab(event, tabCheck.key));
    const skippedKeys = new Set(skippedForTab.map((event) => eventComparisonKey(event)));
    const rawComparableTabEvents = skippedKeys.size
      ? tabEvents.filter((event) => !skippedKeys.has(eventComparisonKey(event)))
      : tabEvents;
    const dedupedTabEvents = deduplicateComparisonEvents(tabEvents);
    const dedupedComparableTabEvents = skippedKeys.size
      ? dedupedTabEvents.uniqueEvents.filter((event) => !skippedKeys.has(eventComparisonKey(event)))
      : dedupedTabEvents.uniqueEvents;
    const allTabConditionalEvents = (allEvents || []).filter((event) => eventContributesToProfileTab(event, tabCheck.key));
    const dedupedAllTabConditionalEvents = deduplicateComparisonEvents(allTabConditionalEvents);
    const shouldUseAllTabFallback = Number.isFinite(expected)
      && expected > 0
      && tabEvents.length === 0
      && dedupedAllTabConditionalEvents.uniqueEvents.length > 0;
    const adjustedExpected = Number.isFinite(expected)
      ? Math.max(0, expected - skippedForTab.length)
      : expected;
    const variantExpected = (value) => Number.isFinite(value) ? value : expected;
    const variantDifference = (actual, value) => Number.isFinite(value) ? Math.abs(actual - value) : 0;
    const variants = [
      { name: "raw", priority: 0, actual: tabEvents.length, expected, duplicateCount: 0, skippedCount: 0 },
      { name: "deduped", priority: 1, actual: dedupedTabEvents.uniqueEvents.length, expected, duplicateCount: dedupedTabEvents.duplicateEvents.length, skippedCount: 0 },
      { name: "disabled-skipped", priority: 2, actual: rawComparableTabEvents.length, expected, duplicateCount: 0, skippedCount: skippedForTab.length },
      { name: "disabled-skipped-adjusted", priority: 3, actual: rawComparableTabEvents.length, expected: adjustedExpected, duplicateCount: 0, skippedCount: skippedForTab.length },
      { name: "deduped-disabled-skipped", priority: 4, actual: dedupedComparableTabEvents.length, expected, duplicateCount: dedupedTabEvents.duplicateEvents.length, skippedCount: skippedForTab.length },
      { name: "deduped-disabled-skipped-adjusted", priority: 5, actual: dedupedComparableTabEvents.length, expected: adjustedExpected, duplicateCount: dedupedTabEvents.duplicateEvents.length, skippedCount: skippedForTab.length },
      ...(shouldUseAllTabFallback
        ? [{ name: "all-tab-conditional-fallback", priority: -1, actual: dedupedAllTabConditionalEvents.uniqueEvents.length, expected, duplicateCount: dedupedAllTabConditionalEvents.duplicateEvents.length, skippedCount: 0 }]
        : [])
    ].map((variant) => ({
      ...variant,
      expected: variantExpected(variant.expected),
      difference: variantDifference(variant.actual, variantExpected(variant.expected))
    }));
    const selectedVariant = pickClosestCountVariant(variants);
    tabEventsByKey[tabCheck.key] = selectedVariant.name === "all-tab-conditional-fallback"
      ? dedupedAllTabConditionalEvents.uniqueEvents
      : tabEvents;
    check.expected = selectedVariant.expected;
    check.actual = selectedVariant.actual;
    check.status = Number.isFinite(selectedVariant.expected) && selectedVariant.expected === check.actual ? "pass" : "fail";
    check.skipped = skippedForTab.length;
    check.duplicates = selectedVariant.name.includes("deduped") ? dedupedTabEvents.duplicateEvents.length : 0;
    check.rawRows = tabEvents.length;
    check.comparableRows = rawComparableTabEvents.length;
    check.countStrategy = selectedVariant.name;
    const detailParts = [
      `${check.selectedTab} tab rows=${check.actual}`,
      `profile ${tabCheck.label}=${check.expected ?? "-"}`
    ];
    if (selectedVariant.name !== "raw") detailParts.push(`strategy=${selectedVariant.name}`);
    if (check.duplicates) detailParts.push(`duplicates ignored=${check.duplicates}`);
    if (selectedVariant.skippedCount) detailParts.push(`disabled skipped=${selectedVariant.skippedCount}`);
    if (selectedVariant.name !== "raw" && check.rawRows !== check.actual) detailParts.push(`raw=${check.rawRows}`);
    if (selectedVariant.name === "all-tab-conditional-fallback") detailParts.push(`fallbackFromAll=${dedupedAllTabConditionalEvents.uniqueEvents.length}`);
    if (check.expected !== expected) detailParts.push(`original=${expected ?? "-"}`);
    detailParts.push(`loadMoreClicks=${expansion.loadMoreClicks}`);
    detailParts.push(`stopped=${expansion.stoppedReason}`);
    check.detail = `${detailParts.join(", ")}.`;
    checks.push(check);
  }

  await selectProfileTab(page, "ALL").catch(() => {});
  return { checks, tabEventsByKey };
}

// 토너먼트 Result 페이지의 row를 추출한다. 표 파싱을 우선하고,
// 표가 없으면 보수적인 본문 텍스트 파서로 Final Result row 복구를 시도한다.
async function extractFinalResultRows(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const parseNumber = (value) => {
      const match = normalize(value).match(/\d[\d,]*/);
      return match ? Number(match[0].replace(/,/g, "")) : null;
    };
    const parseMoney = (value) => {
      const match = normalize(value).match(/-?\d[\d,]*(?:\.\d+)?/);
      return match ? Math.round(Number(match[0].replace(/[,\s]/g, ""))) : null;
    };
    const isVisibleElement = (element) => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
      return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    };
    const rows = [];
    const seen = new Set();

    const addRow = (row) => {
      if (row.no === null || !row.player) return;
      const key = `${row.no}:${row.player}:${row.earnings ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    for (const table of Array.from(document.querySelectorAll("table"))) {
      if (!isVisibleElement(table)) continue;
      const headerText = normalize(table.querySelector("thead")?.textContent || table.textContent || "");
      
      const hasRank = /no|rank|pos|place/i.test(headerText);
      const hasPlayer = /player|name/i.test(headerText);
      const hasEarnings = /earnings|prize|payout|cash|\$/i.test(headerText);

      if (!hasRank || !hasPlayer || !hasEarnings) continue;

      for (const row of Array.from(table.querySelectorAll("tr"))) {
        if (!isVisibleElement(row)) continue;
        const cells = Array.from(row.querySelectorAll("td, th")).map((cell) => normalize(cell.textContent));
        if (cells.length < 3) continue;
        const no = parseNumber(cells[0]);
        const earnings = parseMoney(cells[cells.length - 1]);
        const player = cells[1] || "";
        const country = cells.length >= 4 ? cells[cells.length - 2] : "";
        addRow({ no, player, country, earnings, cells, rowText: normalize(row.textContent) });
      }
    }

    if (rows.length) return rows;

    const bodyText = normalize(document.body?.innerText || "");
    const resultStart = bodyText.search(/Final Result/i);
    const headerStart = bodyText.search(/\bNo\s+Player\s+Country\s+Earnings\b/i);
    const start = headerStart >= 0 ? headerStart : resultStart;
    const finalResultText = start >= 0 ? bodyText.slice(start) : bodyText;
    const rowPattern = /(?:^|\s)(\d{1,6})\s+(.{2,180}?)\s+[$€£₩\u20a9₱\u20b1]([\d,]+)(?=\s+\d{1,6}\s+|$)/g;
    let match = null;
    while ((match = rowPattern.exec(finalResultText)) !== null) {
      const no = Number(match[1].replace(/,/g, ""));
      const player = normalize(match[2]);
      const earnings = parseMoney(match[3]);
      addRow({
        no,
        player,
        country: "",
        earnings,
        cells: [String(no), player, earnings === null ? "" : `$${earnings.toLocaleString("en-US")}`],
        rowText: normalize(match[0])
      });
    }

    return rows;
  });
}

// Result 페이지 내용 시그니처는 pagination 클릭 정체를 감지하는 데 쓴다.
// 같은 페이지가 반복되면 바로 포기하지 않고 다른 전진 경로를 한 번 더 시도한다.
async function currentResultPageContentSignature(page) {
  const rows = await extractFinalResultRows(page).catch(() => []);
  const bodyText = normalizeText(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  return resultRowsSignature(rows, bodyText);
}

async function waitForResultPageContentChange(page, previousSignature, timeoutMs = 12000) {
  if (!previousSignature) return true;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
    const currentSignature = await currentResultPageContentSignature(page);
    if (currentSignature && currentSignature !== previousSignature) return true;
    await page.waitForTimeout(400);
  }

  return false;
}

// canonical URL을 다시 열어 Result 첫 페이지로 복구한다.
// 목표 구간을 지나친 뒤 이전 페이지 이동이 불가능할 때 처음부터 다시 확인하기 위한 경로다.
async function reloadResultPageAtFirstPage(page, timeoutMs = 30000) {
  const previousSignature = await currentResultPageContentSignature(page);
  await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await waitForResultPageContentChange(page, previousSignature, 5000).catch(() => false);
  return activeResultPageNumber(page);
}

// 보이는 컨트롤에서 현재 활성 Result 페이지 번호를 읽는다.
async function activeResultPageNumber(page) {
  const controls = page.locator("a, button, [role=button]");
  const count = await controls.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const text = normalizeText(await control.innerText({ timeout: 1000 }).catch(() => ""));
    if (!/^\d{1,5}$/.test(text)) continue;
    const active = await control.evaluate((element) => {
      const classes = String(element.className || "");
      return element.getAttribute("aria-current") === "page" || /\bactive\b/i.test(classes);
    }).catch(() => false);
    if (active) return Number(text);
  }

  return null;
}

// 보이는 특정 pagination 번호를 클릭한다.
// 이미 해당 페이지가 활성 상태라면 성공으로 처리한다.
async function clickResultPageNumber(page, pageNumber) {
  if (!pageNumber || pageNumber <= 1) return false;
  const pattern = new RegExp(`^\\s*${pageNumber}\\s*$`);
  const controls = page.locator("a, button, [role=button]").filter({ hasText: pattern });
  const count = await controls.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const disabled = await control.evaluate((element) => Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true" || /disabled/i.test(element.className || "")).catch(() => false);
    if (disabled) continue;
    const current = await control.evaluate((element) => {
      const classes = String(element.className || "");
      return element.getAttribute("aria-current") === "page" || /\bactive\b/i.test(classes);
    }).catch(() => false);
    if (current) return true;
    const previousSignature = await currentResultPageContentSignature(page);
    if (!(await clickControlWithFallback(control, 5000))) continue;
    if (await waitForResultPageContentChange(page, previousSignature)) return true;
  }
  return false;
}

// Result 페이지는 이동형 pagination 창을 쓰는 경우가 많다.
// 보이는 페이지 번호를 찾고, target 페이지가 숨겨져 있으면 창을 넘긴다.
async function visibleResultPageNumbers(page) {
  const controls = page.locator("a, button, [role=button]");
  const count = await controls.count().catch(() => 0);
  const pageNumbers = [];

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const text = normalizeText(await control.innerText({ timeout: 1000 }).catch(() => ""));
    if (!/^\d{1,5}$/.test(text)) continue;
    pageNumbers.push(Number(text));
  }

  return [...new Set(pageNumbers)].sort((a, b) => a - b);
}

async function clickNextVisibleResultPageNumber(page, currentPageNumber) {
  const visibleNumbers = await visibleResultPageNumbers(page);
  const nextVisibleNumber = visibleNumbers.find((pageNumber) => pageNumber > currentPageNumber);
  if (!nextVisibleNumber) return null;
  if (await clickResultPageNumber(page, nextVisibleNumber)) {
    return nextVisibleNumber;
  }
  return null;
}

// target 페이지가 현재 보이지 않아도 도달을 시도한다.
// 페이지 번호 창을 전진시킨 뒤 매번 목표 번호가 나타났는지 다시 확인한다.
async function clickPreciseNextResultPageNumber(page, currentPageNumber) {
  const nextPageNumber = currentPageNumber + 1;

  if (await clickResultPageNumber(page, nextPageNumber)) {
    return nextPageNumber;
  }

  return clickNextVisibleResultPageNumber(page, currentPageNumber);
}

async function clickResultPageNumberThroughPaginationWindow(page, targetPageNumber, maxWindowAdvances = null) {
  if (!targetPageNumber || targetPageNumber <= 1) return false;
  if (await clickResultPageNumber(page, targetPageNumber)) return true;

  const maxAttempts = maxWindowAdvances ?? Math.min(Math.max(targetPageNumber + 2, 10), 120);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const activePageNumber = await activeResultPageNumber(page);
    if (activePageNumber && activePageNumber >= targetPageNumber) break;
    const advance = await advanceResultPage(page, activePageNumber || attempt + 1, targetPageNumber, true);
    if (!advance.advanced) break;
    if (await clickResultPageNumber(page, targetPageNumber)) return true;
  }

  return false;
}

async function clickNextResultPage(page) {
  const controls = page.locator("a, button, [role=button]").filter({ hasText: /^(next|>|›|»|…|\.\.\.)\s*$/i });
  const count = await controls.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const disabled = await control.evaluate((element) => Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true" || /disabled/i.test(element.className || "")).catch(() => false);
    if (disabled) continue;
    const previousSignature = await currentResultPageContentSignature(page);
    if (!(await clickControlWithFallback(control, 5000))) continue;
    if (await waitForResultPageContentChange(page, previousSignature)) return true;
  }
  return false;
}

async function clickForwardResultPaginationControl(page) {
  const controls = page.locator("a, button, [role=button]");
  const count = await controls.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const forward = await control.evaluate((element) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const text = normalize([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("rel"),
        element.getAttribute("class")
      ].filter(Boolean).join(" "));
      const disabled = Boolean(element.disabled)
        || element.getAttribute("aria-disabled") === "true"
        || /disabled/i.test(element.className || "");
      if (disabled) return false;
      if (/\b(prev|previous|back)\b/i.test(text)) return false;
      return /\b(next|forward)\b/i.test(text)
        || text === ">"
        || text === ">>"
        || text === "..."
        || text === "\u2026"
        || text === "\u203a"
        || text === "\u00bb"
        || /(^|\s)(>|\.\.\.|\u2026|\u203a|\u00bb)(\s|$)/.test(text);
    }).catch(() => false);
    if (!forward) continue;

    const previousSignature = await currentResultPageContentSignature(page);
    if (!(await clickControlWithFallback(control, 5000))) continue;
    if (await waitForResultPageContentChange(page, previousSignature)) return true;
  }

  return false;
}

// 엄격한 next/previous 탐색은 잘못된 네비게이션 클릭을 줄이기 위한 좁은 선택자다.
// 넓은 fallback은 strict 경로가 실패한 뒤에만 사용한다.
async function clickStrictNextResultPage(page) {
  const controls = page.locator("a, button, [role=button]");
  const count = await controls.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const next = await control.evaluate((element) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const text = normalize([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("rel"),
        element.getAttribute("class")
      ].filter(Boolean).join(" "));
      const disabled = Boolean(element.disabled)
        || element.getAttribute("aria-disabled") === "true"
        || /disabled/i.test(element.className || "");
      if (disabled) return false;
      if (/\b(prev|previous|back)\b/i.test(text)) return false;
      return /\bnext\b/i.test(text)
        || text === ">"
        || text === "\u203a";
    }).catch(() => false);
    if (!next) continue;

    const previousSignature = await currentResultPageContentSignature(page);
    if (!(await clickControlWithFallback(control, 5000))) continue;
    if (await waitForResultPageContentChange(page, previousSignature)) return true;
  }

  return false;
}

async function clickStrictPreviousResultPage(page) {
  const controls = page.locator("a, button, [role=button]");
  const count = await controls.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;
    const previous = await control.evaluate((element) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const text = normalize([
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("rel"),
        element.getAttribute("class")
      ].filter(Boolean).join(" "));
      const disabled = Boolean(element.disabled)
        || element.getAttribute("aria-disabled") === "true"
        || /disabled/i.test(element.className || "");
      if (disabled) return false;
      if (/\b(next|forward)\b/i.test(text)) return false;
      return /\b(prev|previous|back)\b/i.test(text)
        || text === "<"
        || text === "\u2039";
    }).catch(() => false);
    if (!previous) continue;

    const previousSignature = await currentResultPageContentSignature(page);
    if (!(await clickControlWithFallback(control, 5000))) continue;
    if (await waitForResultPageContentChange(page, previousSignature)) return true;
  }

  return false;
}

// Result 페이지 번호 이동의 중앙 전진 함수.
// 직접 target 클릭, strict next, broader next, forward-window, 보이는 번호 순으로 시도한다.
// 이 순서는 정확성을 유지하면서 WSOP의 불규칙한 pagination 마크업을 처리하기 위한 것이다.
async function advanceResultPage(page, currentPageNumber, targetPageNumber, inspectEveryPage) {
  const nextPageNumber = currentPageNumber + 1;

  if (targetPageNumber && targetPageNumber > currentPageNumber) {
    if (await clickResultPageNumber(page, targetPageNumber)) {
      return { advanced: true, resultPageNumber: targetPageNumber, directPageClicked: true };
    }

    const preciseNextPageNumber = await clickPreciseNextResultPageNumber(page, currentPageNumber);
    if (preciseNextPageNumber) {
      return { advanced: true, resultPageNumber: preciseNextPageNumber, directPageClicked: true };
    }

    const visibleNumbers = await visibleResultPageNumbers(page);
    const maxVisibleNumber = visibleNumbers.length ? Math.max(...visibleNumbers) : null;
    if (maxVisibleNumber && targetPageNumber > maxVisibleNumber) {
      if (await clickForwardResultPaginationControl(page)) {
        if (await clickResultPageNumber(page, targetPageNumber)) {
          return { advanced: true, resultPageNumber: targetPageNumber, directPageClicked: true };
        }
        if (await clickResultPageNumber(page, Math.max(nextPageNumber, maxVisibleNumber + 1))) {
          return { advanced: true, resultPageNumber: Math.max(nextPageNumber, maxVisibleNumber + 1), directPageClicked: true };
        }
      }
    }
  }

  const preciseNextPageNumber = await clickPreciseNextResultPageNumber(page, currentPageNumber);
  if (preciseNextPageNumber) {
    return { advanced: true, resultPageNumber: preciseNextPageNumber, directPageClicked: true };
  }

  if (await clickStrictNextResultPage(page)) {
    return { advanced: true, resultPageNumber: nextPageNumber, directPageClicked: false };
  }

  if (await clickNextResultPage(page)) {
    return { advanced: true, resultPageNumber: nextPageNumber, directPageClicked: false };
  }

  if (await clickForwardResultPaginationControl(page)) {
    if (await clickResultPageNumber(page, nextPageNumber)) {
      return { advanced: true, resultPageNumber: nextPageNumber, directPageClicked: true };
    }
    return { advanced: true, resultPageNumber: nextPageNumber, directPageClicked: false };
  }

  if (inspectEveryPage && targetPageNumber && targetPageNumber !== currentPageNumber && targetPageNumber !== nextPageNumber) {
    if (await clickResultPageNumber(page, targetPageNumber)) {
      return { advanced: true, resultPageNumber: targetPageNumber, directPageClicked: true };
    }
  }

  return { advanced: false, resultPageNumber: currentPageNumber, directPageClicked: false };
}

// 페이지의 최소/최대 순위를 계산한다. 이 값은 진단용이며,
// range만으로 target rank 검증 완료를 선언하지 않는다.
function rankRangeForRows(rows) {
  const ranks = rows
    .map((row) => row.no)
    .filter((rank) => Number.isFinite(rank));
  if (!ranks.length) return null;
  return {
    min: Math.min(...ranks),
    max: Math.max(...ranks)
  };
}

function resultRangeResolvesTargetRank(range, targetRank) {
  return Boolean(targetRank && range && ((targetRank >= range.min && targetRank <= range.max) || range.min > targetRank));
}

// 목표 순위를 지나쳤을 때 한 페이지 뒤로 이동한다.
// 실패하면 호출부에서 마지막 복구 수단으로 1페이지 reload를 시도할 수 있다.
async function retreatResultPage(page, currentPageNumber) {
  const previousPageNumber = Math.max(1, currentPageNumber - 1);

  if (await clickStrictPreviousResultPage(page)) {
    const activePageNumber = await activeResultPageNumber(page);
    return { advanced: true, resultPageNumber: activePageNumber || previousPageNumber, directPageClicked: false };
  }

  if (previousPageNumber !== currentPageNumber && await clickResultPageNumber(page, previousPageNumber)) {
    return { advanced: true, resultPageNumber: previousPageNumber, directPageClicked: true };
  }

  return { advanced: false, resultPageNumber: currentPageNumber, directPageClicked: false };
}

// 단일 페이지가 target rank를 해결했다고 보려면 target을 실제로 포함하고 그 뒤 순위도 보여야 한다.
// 또는 페이지가 target 뒤에서 시작해야 한다. [1, 100] 같은 sparse row의 조기 종료를 막기 위함이다.
function resultRowsResolveTargetRank(rows, targetRank) {
  if (!targetRank) return false;
  const ranks = (rows || [])
    .map((row) => row.no)
    .filter((rank) => Number.isFinite(rank));
  if (!ranks.length) return false;
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  return minRank > targetRank || (ranks.includes(targetRank) && maxRank > targetRank);
}

// 캐시와 최종 탐색 결과의 다중 페이지 coverage 확인.
// 목표 순위가 없다고 판단할 만큼 충분히 확인했는지 답한다.
function resultPagesCoverTargetRank(pages, targetRank) {
  if (!targetRank) return true;
  const rankedPages = (pages || [])
    .map((page) => ({
      ...page,
      ranks: (page.rows || [])
        .map((row) => row.no)
        .filter((rank) => Number.isFinite(rank))
    }))
    .filter((page) => page.ranks.length)
    .map((page) => ({
      ...page,
      minRank: Math.min(...page.ranks),
      maxRank: Math.max(...page.ranks)
    }))
    .sort((left, right) => left.minRank - right.minRank);

  let sawTargetOrLowerRank = false;
  let previousMaxRank = null;
  let previousPageNumber = null;

  for (const page of rankedPages) {
    const pageNumber = Number.isFinite(page.resultPageNumber) ? page.resultPageNumber : null;

    if (page.maxRank < targetRank) {
      sawTargetOrLowerRank = true;
      previousMaxRank = page.maxRank;
      if (pageNumber !== null) previousPageNumber = pageNumber;
      continue;
    }

    if (page.ranks.includes(targetRank)) {
      if (page.maxRank > targetRank) return true;
      sawTargetOrLowerRank = true;
      previousMaxRank = page.maxRank;
      if (pageNumber !== null) previousPageNumber = pageNumber;
      continue;
    }

    if (page.minRank > targetRank) {
      if (!sawTargetOrLowerRank || previousMaxRank === null) return false;
      const rankGap = page.minRank - previousMaxRank - 1;
      const pageGap = pageNumber !== null && previousPageNumber !== null ? pageNumber - previousPageNumber : 1;
      if (previousMaxRank < targetRank && (pageGap > 1 || rankGap > RESULT_ROWS_PER_PAGE * 2)) return false;
      return sawTargetOrLowerRank;
    }

    if (page.minRank <= targetRank && page.maxRank >= targetRank) {
      sawTargetOrLowerRank = true;
      previousMaxRank = page.maxRank;
      if (pageNumber !== null) previousPageNumber = pageNumber;
    }
  }

  return false;
}

// target을 포함하는 순위 공백을 감지한다.
// 실제 순위 누락과 크롤러 네비게이션 실패를 사람이 구분할 수 있도록 출력에 남긴다.
function targetRankGap(previousRange, currentRange, targetRank) {
  if (!targetRank || !previousRange || !currentRange) return null;
  const gapStart = previousRange.max + 1;
  const gapEnd = currentRange.min - 1;
  if (gapEnd < gapStart) return null;
  if (targetRank < gapStart || targetRank > gapEnd) return null;
  return { start: gapStart, end: gapEnd };
}

function resultPageInspectionLimit(resultPageLimit) {
  if (resultPageLimit === 0) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(resultPageLimit) || resultPageLimit < 0) {
    throw new Error("--result-page-limit must be 0 or a positive number.");
  }
  return Math.floor(resultPageLimit);
}

// 설정된 limit은 속도 힌트일 뿐 정합성 경계가 아니다.
// 깊은 순위는 target rank를 덮을 수 있도록 검사 예산을 자동 확장한다.
function effectiveResultPageInspectionLimit(resultPageLimit, targetRank, itmCount = null) {
  let effectiveRank = targetRank;
  if (itmCount && targetRank && targetRank > itmCount) {
    effectiveRank = itmCount;
  }
  const configuredLimit = resultPageInspectionLimit(resultPageLimit);
  if (configuredLimit === Number.MAX_SAFE_INTEGER || !effectiveRank) return configuredLimit;
  const targetPage = resultPageNumberForRangeStart(effectiveRank);
  return Math.max(configuredLimit, targetPage + RESULT_SEARCH_LOOKBEHIND_PAGES + 10);
}

function shouldInspectEveryResultPage(resultPageLimit) {
  return resultPageLimit === 0;
}

function resultPageNumberForRank(rank) {
  return rank && rank > 50 ? Math.ceil(rank / 50) : null;
}

function resultPageNumberForRangeStart(rank) {
  return rank && rank > 50 ? Math.ceil(rank / 50) : 1;
}

function resultSearchStartPageForRank(rank) {
  const targetPage = resultPageNumberForRank(rank);
  if (!targetPage) return null;
  return Math.max(1, targetPage - RESULT_SEARCH_LOOKBEHIND_PAGES);
}

// 예상 시작 페이지가 1페이지보다 뒤라면 target 근처로 점프한다.
// 초반 무관 페이지에 검사 횟수를 모두 쓰지 않기 위해서다.
function shouldUseDirectResultRankJump(targetRank, resultPageLimit) {
  const searchStartPage = resultSearchStartPageForRank(targetRank);
  if (!searchStartPage || searchStartPage <= 1) return false;
  return true;
}

// 본격 Result 탐색 전에 target rank 근처로 이동한다.
// 먼저 직접 페이지 번호 클릭을 시도하고, 숨은 페이지는 pagination 창을 넘겨 도달한다.
async function navigateToResultSearchStartPage(page, targetRank, resultPageLimit, itmCount = null) {
  let effectiveRank = targetRank;
  if (itmCount && targetRank && targetRank > itmCount) {
    effectiveRank = itmCount;
  }
  const searchStartPageNumber = shouldUseDirectResultRankJump(effectiveRank, resultPageLimit) ? resultSearchStartPageForRank(effectiveRank) : null;
  let resultPageNumber = 1;
  let directPageClicked = false;

  if (!searchStartPageNumber || searchStartPageNumber <= 1) {
    return { resultPageNumber, directPageClicked, searchStartPageNumber };
  }

  directPageClicked = await clickResultPageNumberThroughPaginationWindow(page, searchStartPageNumber);
  let activePageNumber = await activeResultPageNumber(page);
  if (activePageNumber) resultPageNumber = activePageNumber;
  else if (directPageClicked) resultPageNumber = searchStartPageNumber;
  directPageClicked = directPageClicked || Boolean(activePageNumber && activePageNumber > 1);

  const maxAttempts = Math.min(Math.max(searchStartPageNumber + 2, 10), 120);
  for (let attempt = 0; resultPageNumber < searchStartPageNumber && attempt < maxAttempts; attempt += 1) {
    const advance = await advanceResultPage(page, resultPageNumber, searchStartPageNumber, true);
    if (!advance.advanced) break;
    directPageClicked = directPageClicked || advance.directPageClicked;
    activePageNumber = await activeResultPageNumber(page);
    resultPageNumber = activePageNumber || advance.resultPageNumber;
  }

  return { resultPageNumber, directPageClicked, searchStartPageNumber };
}

// 페이지 이동 중 중복/정체 페이지를 감지하기 위한 시그니처.
function resultRowsSignature(rows, bodyText) {
  const range = rankRangeForRows(rows || []);
  const rangeKey = range ? `${range.min}-${range.max}` : "no-ranks";
  const rowKey = (rows || [])
    .slice(0, 5)
    .map((row) => `${row.no}:${normalizeComparable(row.player)}:${row.earnings ?? ""}`)
    .join("|");
  return `${rangeKey}::${rowKey || normalizeText(bodyText).slice(0, 500)}`;
}

function resultPageSignature(url, rows, bodyText) {
  return `${url || "unknown-url"}::${resultRowsSignature(rows, bodyText)}`;
}

// 캐시는 cached pages가 target rank 구간을 덮을 때만 안전하다.
function cachedPagesCoverEvent(cachedPages, event) {
  const targetRank = event.rank;
  if (!targetRank) return false;
  return resultPagesCoverTargetRank(cachedPages, targetRank);
}

// 같은 URL의 서로 다른 pagination 창 정보를 잃지 않도록 캐시 페이지를 병합한다.
function mergeCachedResultPages(existingPages = [], incomingPages = []) {
  const merged = new Map();
  for (const page of [...existingPages, ...incomingPages]) {
    const range = rankRangeForRows(page.rows || []);
    const rangeKey = range ? `${range.min}-${range.max}` : "no-ranks";
    const key = `${page.url || "unknown-url"}::${page.resultPageNumber || page.pageIndex || "unknown-page"}::${rangeKey}`;
    merged.set(key, page);
  }
  return Array.from(merged.values()).sort((a, b) => {
    const aRank = rankRangeForRows(a.rows || [])?.min ?? Number.MAX_SAFE_INTEGER;
    const bRank = rankRangeForRows(b.rows || [])?.min ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

function storeResultPageCache(urlKey, cachedPages) {
  if (!urlKey || !cachedPages?.length) return;
  const existingPages = resultPageRowsCache.get(urlKey) || [];
  resultPageRowsCache.set(urlKey, mergeCachedResultPages(existingPages, cachedPages));
}

// 캐시된 결과 페이지 데이터를 가지고 로컬에서 검증을 수행하는 유틸리티
// 캐시로 Result 데이터를 평가한다.
// 캐시 페이지가 목표 순위를 덮기에 부족하면 null을 반환해 실제 페이지를 다시 크롤링한다.
function evaluateResultFromCachedPages(cachedPages, player, event, urlKey) {
  const targetRank = event.rank;
  const targetEarnings = event.earnings;
  const searchedPages = [];
  let foundRow = null;

  for (const cachedPage of cachedPages) {
    const range = rankRangeForRows(cachedPage.rows || []);
    searchedPages.push({ pageIndex: cachedPage.pageIndex, resultPageNumber: cachedPage.resultPageNumber ?? cachedPage.pageIndex, url: cachedPage.url, rows: cachedPage.rows.length, rankRange: range ? `${range.min}-${range.max}` : null });
    const candidates = targetRank ? cachedPage.rows.filter((row) => row.no === targetRank) : cachedPage.rows;
    foundRow = candidates.find((row) => resultRowMatchesTarget(row, player)) || null;

    if (foundRow) break;
  }

  if (!foundRow) {
    for (const cachedPage of cachedPages) {
      const lastBody = cachedPage.bodyText || "";
      foundRow = findResultRowInBodyText(lastBody, player, targetRank, targetEarnings);
      if (foundRow) {
        break;
      }
    }
  }

  const cacheCoversTarget = cachedPagesCoverEvent(cachedPages, event);
  const checks = {
    hasFinalResultRows: searchedPages.some((item) => item.rows > 0) || Boolean(foundRow),
    directPageClicked: false,
    targetRankCovered: !targetRank || Boolean(foundRow) || cacheCoversTarget,
    rankMatches: !targetRank || Boolean(foundRow && foundRow.no === targetRank),
    playerMatches: Boolean(foundRow),
    earningsMatches: targetEarnings === null || targetEarnings === undefined || Boolean(foundRow && (foundRow.earnings === targetEarnings || (targetEarnings !== null && targetEarnings !== undefined && foundRow.rowText && foundRow.rowText.replace(/[^0-9]/g, "").includes(String(targetEarnings)))))
  };
  const missing = resultMissingChecks(checks);

  if (missing.length && !cacheCoversTarget) {
    return null;
  }

  return {
    url: urlKey,
    title: cachedPages[0]?.title || "",
    status: missing.length ? "fail" : "pass",
    checks,
    missing,
    cacheHit: true,
    cacheCoversTarget,
    expectedRow: {
      player: player.name,
      no: targetRank,
      earnings: targetEarnings
    },
    foundRow,
    searchedPages,
    extractedTextSample: cachedPages[cachedPages.length - 1]?.bodyText?.slice(0, 1000) || ""
  };
}

// Result 페이지 핵심 스캐너.
// 확인한 모든 페이지를 기록하고 순위/선수명/상금을 검증한다.
// row 누락 결론을 신뢰할 만큼 충분히 확인한 뒤에만 targetRankCovered를 true로 둔다.
async function extractResultPageData(page, player, event, resultPageLimit, timeout = 30000) {
  const targetRank = event.rank;
  const targetEarnings = event.earnings;
  const inspectEveryPage = shouldInspectEveryResultPage(resultPageLimit);
  const visitedPageContentSignatures = new Set();
  const searchedPages = [];
  const cachedPages = [];
  let foundRow = null;
  let directPageClicked = false;
  let lastBody = "";
  let targetGap = null;
  let resultPageNumber = 1;
  let previousRange = null;
  let resetFromOvershotFirstPage = false;
  const pendingResultPageNumbers = [];
  const gapRecoveryPageNumbers = new Set();

  // 1페이지(진입 페이지)에서 ITM 수량 파싱
  const initialBodyText = normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
  const unavailableWarning = await resultPageUnavailableWarning(page, event);
  if (unavailableWarning) return unavailableWarning;
  const itmCount = parseItmCount(initialBodyText);
  if (itmCount) {
    console.log(`    [디버그] Result ITM 수량 감지: ${itmCount}명 (Target Rank: ${targetRank}위)`);
  }

  const searchStart = await navigateToResultSearchStartPage(page, targetRank, resultPageLimit, itmCount);
  resultPageNumber = searchStart.resultPageNumber;
  directPageClicked = searchStart.directPageClicked;
  const pageInspectionLimit = effectiveResultPageInspectionLimit(resultPageLimit, targetRank, itmCount);

  for (let pageIndex = 1; pageIndex <= pageInspectionLimit; pageIndex += 1) {
    await page.waitForTimeout(1000);
    const url = page.url();
    await page.waitForSelector("table tr", { timeout: 6000 }).catch(() => {});

    const rows = await extractFinalResultRows(page);
    const title = await page.title().catch(() => "");
    const bodyText = normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
    const range = rankRangeForRows(rows);
    const activePageNumber = await activeResultPageNumber(page);
    if (activePageNumber) resultPageNumber = activePageNumber;
    targetGap = targetGap || targetRankGap(previousRange, range, targetRank);
    const pageContentSignature = resultRowsSignature(rows, bodyText);
    if (visitedPageContentSignatures.has(pageContentSignature)) {
      const nextTargetPageNumber = resultPageNumber < searchStart.searchStartPageNumber ? searchStart.searchStartPageNumber : null;
      const advance = await advanceResultPage(page, resultPageNumber, nextTargetPageNumber, true);
      if (!advance.advanced) break;
      directPageClicked = directPageClicked || advance.directPageClicked;
      resultPageNumber = advance.resultPageNumber;
      continue;
    }
    visitedPageContentSignatures.add(pageContentSignature);

    cachedPages.push({ pageIndex, resultPageNumber, url, title, rows, bodyText });
    searchedPages.push({ pageIndex, resultPageNumber, url, rows: rows.length, rankRange: range ? `${range.min}-${range.max}` : null });
    const candidates = targetRank ? rows.filter((row) => row.no === targetRank) : rows;
    let pageFoundRow = candidates.find((row) => resultRowMatchesTarget(row, player)) || null;

    if (!pageFoundRow) {
      lastBody = bodyText;
      pageFoundRow = findResultRowInBodyText(lastBody, player, targetRank, targetEarnings);
    }
    if (pageFoundRow && !foundRow) foundRow = pageFoundRow;
    previousRange = range || previousRange;

    if (foundRow) break;
    if (targetRank && range && range.min > targetRank) {
      const retreat = await retreatResultPage(page, resultPageNumber);
      if (!retreat.advanced) {
        if (!resetFromOvershotFirstPage) {
          resetFromOvershotFirstPage = true;
          const reloadedPageNumber = await reloadResultPageAtFirstPage(page, timeout);
          resultPageNumber = reloadedPageNumber || 1;
          previousRange = null;
          continue;
        }
        break;
      }
      directPageClicked = directPageClicked || retreat.directPageClicked;
      resultPageNumber = retreat.resultPageNumber;
      continue;
    }
    if (resultRowsResolveTargetRank(rows, targetRank)) break;
    const pendingPageNumber = pendingResultPageNumbers.shift();
    if (pendingPageNumber && pendingPageNumber !== resultPageNumber && await clickResultPageNumber(page, pendingPageNumber)) {
      directPageClicked = true;
      resultPageNumber = pendingPageNumber;
      continue;
    }
    const nextTargetPageNumber = resultPageNumber < searchStart.searchStartPageNumber ? searchStart.searchStartPageNumber : null;
    const advance = await advanceResultPage(page, resultPageNumber, nextTargetPageNumber, inspectEveryPage);
    if (!advance.advanced) break;
    directPageClicked = directPageClicked || advance.directPageClicked;
    resultPageNumber = advance.resultPageNumber;
  }

  const targetRankCovered = !targetRank || Boolean(foundRow) || resultPagesCoverTargetRank(cachedPages, targetRank);
  const checks = {
    hasFinalResultRows: searchedPages.some((item) => item.rows > 0) || Boolean(foundRow),
    directPageClicked,
    targetRankCovered,
    rankMatches: !targetRank || Boolean(foundRow && foundRow.no === targetRank),
    playerMatches: Boolean(foundRow),
    earningsMatches: targetEarnings === null || targetEarnings === undefined || Boolean(foundRow && (foundRow.earnings === targetEarnings || (targetEarnings !== null && targetEarnings !== undefined && foundRow.rowText && foundRow.rowText.replace(/[^0-9]/g, "").includes(String(targetEarnings)))))
  };
  const missing = resultMissingChecks(checks);
  const body = lastBody || normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    status: missing.length ? "fail" : "pass",
    checks,
    missing,
    cachedPages,
    targetGap,
    expectedRow: {
      player: player.name,
      no: targetRank,
      earnings: targetEarnings
    },
    foundRow,
    searchedPages,
    extractedTextSample: body.slice(0, 1000)
  };
}

// 알려진 Result URL을 직접 연다.
// 프로필 row에 href가 있으면 불안정한 UI 클릭보다 이 경로를 우선한다.
async function crawlResultByUrl(context, player, event, timeout, authWaitMs, resultPageLimit) {
  const urlKey = event.resultUrl;

  // 캐시 확인
  if (resultPageRowsCache.has(urlKey)) {
    const cachedResult = evaluateResultFromCachedPages(resultPageRowsCache.get(urlKey), player, event, urlKey);
    if (cachedResult) {
      console.log(`    [Cache Hit] 결과 페이지 캐시 데이터 사용 (${player.name}): ${urlKey}`);
      return cachedResult;
    }
    console.log(`    [Cache Miss] 캐시 범위 밖 Result입니다. 실제 페이지를 확인합니다 (${player.name}): ${urlKey}`);
  }

  const page = await context.newPage();
  let resultPageStatusCode = null;
  try {
    // 백오프 재시도를 페이지 로드에 반영
    await retryWithBackoff(async () => {
      try {
        const response = await page.goto(event.resultUrl, { waitUntil: "domcontentloaded", timeout });
        resultPageStatusCode = response?.status?.() ?? null;
      } catch (gotoError) {
        const tableCount = await page.locator("table").count().catch(() => 0);
        if (tableCount > 0) {
          console.log(`    [경고] page.goto 타임아웃이 발생했으나 테이블 돔이 감지되어 크롤링을 속행합니다: ${event.resultUrl}`);
        } else {
          throw gotoError;
        }
      }
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await waitForAccessLogin(page, authWaitMs);
    }, 2, 2000);

    const unavailableWarning = await resultPageUnavailableWarning(page, event, resultPageStatusCode);
    if (unavailableWarning) return unavailableWarning;

    // 크롤링하면서 데이터를 누적하여 캐시 데이터 수집
    const cachedPages = [];
    const targetRank = event.rank;
    const targetEarnings = event.earnings;
    const inspectEveryPage = shouldInspectEveryResultPage(resultPageLimit);
    const visitedPageContentSignatures = new Set();
    const searchedPages = [];
    let foundRow = null;
    let directPageClicked = false;
    let lastBody = "";
    let targetGap = null;
    let resultPageNumber = 1;
    let previousRange = null;
    let resetFromOvershotFirstPage = false;
    const pendingResultPageNumbers = [];
    const gapRecoveryPageNumbers = new Set();

    // 1페이지(진입 페이지)에서 ITM 수량 파싱
    const initialBodyText = normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
    const itmCount = parseItmCount(initialBodyText);
    if (itmCount) {
      console.log(`    [디버그] Result ITM 수량 감지: ${itmCount}명 (Target Rank: ${targetRank}위)`);
    }

    const searchStart = await navigateToResultSearchStartPage(page, targetRank, resultPageLimit, itmCount);
    resultPageNumber = searchStart.resultPageNumber;
    directPageClicked = searchStart.directPageClicked;
    const pageInspectionLimit = effectiveResultPageInspectionLimit(resultPageLimit, targetRank, itmCount);

    for (let pageIndex = 1; pageIndex <= pageInspectionLimit; pageIndex += 1) {
      await page.waitForTimeout(1000);
      const url = page.url();

      const rows = await extractFinalResultRows(page);
      const title = await page.title().catch(() => "");
      const bodyText = normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
      const range = rankRangeForRows(rows);
      const activePageNumber = await activeResultPageNumber(page);
      if (activePageNumber) resultPageNumber = activePageNumber;
      targetGap = targetGap || targetRankGap(previousRange, range, targetRank);
      const pageContentSignature = resultRowsSignature(rows, bodyText);
      if (visitedPageContentSignatures.has(pageContentSignature)) {
        const nextTargetPageNumber = resultPageNumber < searchStart.searchStartPageNumber ? searchStart.searchStartPageNumber : null;
        const advance = await advanceResultPage(page, resultPageNumber, nextTargetPageNumber, true);
        if (!advance.advanced) break;
        directPageClicked = directPageClicked || advance.directPageClicked;
        resultPageNumber = advance.resultPageNumber;
        continue;
      }
      visitedPageContentSignatures.add(pageContentSignature);

      // 캐시 페이지 적재
      cachedPages.push({ pageIndex, resultPageNumber, url, title, rows, bodyText });

      searchedPages.push({ pageIndex, resultPageNumber, url, rows: rows.length, rankRange: range ? `${range.min}-${range.max}` : null });
      const candidates = targetRank ? rows.filter((row) => row.no === targetRank) : rows;
      let pageFoundRow = candidates.find((row) => resultRowMatchesTarget(row, player)) || null;

      if (!pageFoundRow) {
        lastBody = bodyText;
        pageFoundRow = findResultRowInBodyText(lastBody, player, targetRank, targetEarnings);
      }
      if (pageFoundRow && !foundRow) foundRow = pageFoundRow;
      previousRange = range || previousRange;

      if (foundRow) break;
      if (targetRank && range && range.min > targetRank) {
        const retreat = await retreatResultPage(page, resultPageNumber);
        if (!retreat.advanced) {
          if (!resetFromOvershotFirstPage) {
            resetFromOvershotFirstPage = true;
            const reloadedPageNumber = await reloadResultPageAtFirstPage(page, timeout);
            resultPageNumber = reloadedPageNumber || 1;
            previousRange = null;
            continue;
          }
          break;
        }
        directPageClicked = directPageClicked || retreat.directPageClicked;
        resultPageNumber = retreat.resultPageNumber;
        continue;
      }
      if (resultRowsResolveTargetRank(rows, targetRank)) break;
      const pendingPageNumber = pendingResultPageNumbers.shift();
      if (pendingPageNumber && pendingPageNumber !== resultPageNumber && await clickResultPageNumber(page, pendingPageNumber)) {
        directPageClicked = true;
        resultPageNumber = pendingPageNumber;
        continue;
      }
      const nextTargetPageNumber = resultPageNumber < searchStart.searchStartPageNumber ? searchStart.searchStartPageNumber : null;
      const advance = await advanceResultPage(page, resultPageNumber, nextTargetPageNumber, inspectEveryPage);
      if (!advance.advanced) break;
      directPageClicked = directPageClicked || advance.directPageClicked;
      resultPageNumber = advance.resultPageNumber;
    }

    // 전역 캐시에 저장
    storeResultPageCache(urlKey, cachedPages);

    const targetRankCovered = !targetRank || Boolean(foundRow) || resultPagesCoverTargetRank(cachedPages, targetRank);
    const checks = {
      hasFinalResultRows: searchedPages.some((item) => item.rows > 0) || Boolean(foundRow),
      directPageClicked,
      targetRankCovered,
      rankMatches: !targetRank || Boolean(foundRow && foundRow.no === targetRank),
      playerMatches: Boolean(foundRow),
      earningsMatches: targetEarnings === null || targetEarnings === undefined || Boolean(foundRow && (foundRow.earnings === targetEarnings || (targetEarnings !== null && targetEarnings !== undefined && foundRow.rowText && foundRow.rowText.replace(/[^0-9]/g, "").includes(String(targetEarnings)))))
    };
    const missing = resultMissingChecks(checks);
    const body = lastBody || normalizeText(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));

    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      status: missing.length ? "fail" : "pass",
      checks,
      missing,
      targetGap,
      expectedRow: {
        player: player.name,
        no: targetRank,
        earnings: targetEarnings
      },
      foundRow,
      searchedPages,
      extractedTextSample: body.slice(0, 1000)
    };
  } catch (error) {
    return { url: event.resultUrl, status: "fail", error: error.message, checks: {}, missing: ["pageError"] };
  } finally {
    await page.close().catch(() => {});
  }
}

// 프로필 row 안의 클릭이 필요한 경우를 위한 Result fallback 크롤러.
// 팝업과 동일 페이지 이동을 모두 지원하고, 최종 Result 페이지는 직접 URL 경로와 같은 스캐너/캐시 흐름에 넣는다.
async function crawlResultByClick(context, player, event, timeout, authWaitMs, resultPageLimit) {
  const page = await context.newPage();
  try {
    await retryWithBackoff(async () => {
      try {
        await page.goto(player.url, { waitUntil: "domcontentloaded", timeout });
      } catch (gotoError) {
        const hasContainer = await page.locator("body").count().catch(() => 0);
        if (hasContainer > 0) {
          console.log(`    [경고] 플레이어 프로필 page.goto 타임아웃이 발생했으나 바디 영역이 감지되어 크롤링을 속행합니다: ${player.url}`);
        } else {
          throw gotoError;
        }
      }
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await waitForAccessLogin(page, authWaitMs);
    }, 2, 2000);

    await extractEventRows(page);

    const row = page.locator(`[data-wsop-crawler-row="${event.rowIndex}"]`);
    const control = row.locator("a:has-text('Result'), button:has-text('Result')").first();
    if (!(await control.count())) {
      throw new Error(`Result control not found for row ${event.rowIndex}`);
    }

    const popupPromise = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
    const navigationPromise = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null);
    await control.click({ timeout: 10000 });
    const popup = await popupPromise;

    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      const finalUrl = popup.url();

      // 만약 팝업 URL이 캐시에 있으면 바로 처리하고 팝업 닫기
      if (resultPageRowsCache.has(finalUrl)) {
        const cachedResult = evaluateResultFromCachedPages(resultPageRowsCache.get(finalUrl), player, event, finalUrl);
        if (cachedResult) {
          console.log(`    [Cache Hit via Popup] 결과 페이지 캐시 데이터 사용 (${player.name}): ${finalUrl}`);
          await popup.close().catch(() => {});
          return cachedResult;
        }
        console.log(`    [Cache Miss via Popup] 캐시 범위 밖 Result입니다. 실제 페이지를 확인합니다 (${player.name}): ${finalUrl}`);
      }

      await popup.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await waitForAccessLogin(popup, authWaitMs);

      // 팝업 페이지 크롤링 및 결과 캐시 적재
      const result = await extractResultPageData(popup, player, event, resultPageLimit, timeout);
      storeResultPageCache(finalUrl, result.cachedPages);
      delete result.cachedPages;

      await popup.close().catch(() => {});
      return result;
    }

    await navigationPromise;
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const finalUrl = page.url();

    if (resultPageRowsCache.has(finalUrl)) {
      const cachedResult = evaluateResultFromCachedPages(resultPageRowsCache.get(finalUrl), player, event, finalUrl);
      if (cachedResult) {
        console.log(`    [Cache Hit via Navigation] 결과 페이지 캐시 데이터 사용 (${player.name}): ${finalUrl}`);
        await popup.close().catch(() => {});
        return cachedResult;
      }
      console.log(`    [Cache Miss via Navigation] 캐시 범위 밖 Result입니다. 실제 페이지를 확인합니다 (${player.name}): ${finalUrl}`);
    }

    const result = await extractResultPageData(page, player, event, resultPageLimit, timeout);
    storeResultPageCache(finalUrl, result.cachedPages);
    delete result.cachedPages;

    return result;
  } catch (error) {
    return { url: player.url, status: "fail", error: error.message, checks: {}, missing: ["clickError"] };
  } finally {
    await page.close().catch(() => {});
  }
}

// 선수 프로필 하나를 끝까지 크롤링한다.
// 요약, ALL 탭, 지표 탭, Result 페이지, 경고, 결함, 최종 상태를 모두 만든다.
async function crawlPlayer(context, url, timeout, resultLimit, resultRankLimit, authWaitMs, maxLoadMore, resultPageLimit, disabledResultMode, profileOnly = false, standingsSources = []) {
  const page = await context.newPage();
  const warnings = [];
  try {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    } catch (gotoError) {
      const hasContainer = await page.locator("body").count().catch(() => 0);
      if (hasContainer > 0) {
        console.log(`    [경고] crawlPlayer page.goto 타임아웃이 발생했으나 바디 영역이 감지되어 크롤링을 속행합니다: ${url}`);
      } else {
        throw gotoError;
      }
    }
     await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await waitForAccessLogin(page, authWaitMs);

    // 가림막 요소(쿠키 배너, 오버레이 등)를 강제로 제거하여 클릭이 막히는 것을 방지
    await page.evaluate(() => {
      const selectors = [
        '#onetrust-consent-sdk',
        '.cookie-banner',
        '.cookie-consent',
        '.cookie-notice',
        '[id*="cookie" i]',
        '[class*="cookie" i]',
        '.sol-cookie-banner',
        '#hs-eu-cookie-confirmation'
      ];
      for (const s of selectors) {
        try {
          const elements = document.querySelectorAll(s);
          elements.forEach(el => el.remove());
        } catch {}
      }
    }).catch(() => {});

    // Cashes 또는 Earnings 통계 텍스트가 렌더링될 때까지 명시적 대기
    await page.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return /cashes/i.test(text) || /earnings/i.test(text);
    }, null, { timeout: 10000 }).catch(() => {});

    // Hydration 안정화 대기 (캐러셀 탭 버튼의 클릭 이벤트 리스너 바인딩 보장)
    await page.waitForTimeout(3000);

    const profileName = await extractPlayerName(page);
    const name = canonicalPlayerName(profileName, standingsSources);
    const bodyText = await page.locator("body").innerText({ timeout });
    const summary = parseSummary(bodyText);
    const badgeCounts = await extractProfileBadgeCounts(page);
    if (badgeCounts.error) {
      warnings.push(`Profile badge count extraction failed: ${badgeCounts.error}`);
    }
    const { events, expansion } = await expandAllEventRows(page, summary.cashes, maxLoadMore);
    if (!events.length && isZeroProfileSummary(summary)) {
      return profileDataUnavailableWarningPlayer({ name, url, standingsSources, summary, bodyText });
    }
    const { comparisonEvents: profileComparisonEvents, overflowEvents, duplicateEvents, strategy: comparisonStrategy } = comparisonEventsForSummary(events, summary);
    // 요약 비교는 프로필 Cashes 수에 맞춘다.
    // 초과 수집 row는 리포트에는 남기지만 요약 비교와 Result 검증에는 쓰지 않는다.
    for (const event of duplicateEvents) {
      event.resultSkipped = event.resultSkipped || "건너뜀 (중복 이벤트 row)";
      event.duplicateEvent = true;
    }
    for (const event of overflowEvents) {
      event.resultSkipped = `건너뜀 (프로필 Cashes ${summary.cashes}개를 초과해 수집된 row)`;
      event.outsideProfileCashes = true;
    }
    const unavailableResultEvents = profileComparisonEvents.filter((event) => event.resultUnavailable);
    const skippedUnavailableResultEvents = disabledResultMode === "skip" ? unavailableResultEvents : [];
    const summaryForComparison = summary;
    const rawSummaryEvents = splitEventsByExpectedCashes(events, summary).comparisonEvents;
    const { checks: tabChecks, tabEventsByKey } = await collectProfileTabChecks(page, summary, maxLoadMore, disabledResultMode, skippedUnavailableResultEvents, events);
    const calculated = calculateSummaryFromEvents(rawSummaryEvents, summary, events);
    // Summary는 ALL 탭 수집값으로, 각 탭은 자기 탭 수집값으로 독립 계산한다.

    // ALL 탭 기반 지표별 계산 수량과 개별 지표 탭 수집 수량 교차 정합성 검증 (Cross-Tab Validation)
    const allCollectionIncomplete = Boolean(summary.cashes && events.length < summary.cashes && expansion?.expectedCashes && !expansion?.reachedExpectedCashes);
    if (!allCollectionIncomplete && tabEventsByKey && Object.keys(tabEventsByKey).length > 0) {
      const keys = ["titles", "finalTables"];
      for (const key of keys) {
        const tabEvents = tabEventsByKey[key] || [];
        const allTabMatching = events.filter(e => eventContributesToProfileTab(e, key));
        
        const dedupedTab = deduplicateComparisonEvents(tabEvents).uniqueEvents.length;
        const dedupedAll = deduplicateComparisonEvents(allTabMatching).uniqueEvents.length;
        
        if (dedupedTab !== dedupedAll) {
          const detail = `${key.toUpperCase()} 탭의 고유 데이터 수(${dedupedTab})와 ALL 탭에서 분류 계산한 수(${dedupedAll})가 일치하지 않습니다. (사이트 데이터 누락/불일치 의심)`;
          warnings.push(detail);
          console.warn(`    [경고] 교차 탭 정합성 불일치 (${name} - ${key}): tab=${dedupedTab}, all=${dedupedAll}`);
        }
      }
    }
    // Summary는 ALL 탭 수집값으로, 각 탭은 자기 탭 수집값으로 독립 계산한다.

    if (!events.length) warnings.push("수집된 이벤트 행이 존재하지 않습니다.");
    if (summary.cashes && events.length < summary.cashes) {
      const missingRows = summary.cashes - events.length;
      warnings.push(`프로필 요약 Cashes는 ${summary.cashes}개이나, ALL 탭에 렌더링/수집된 row는 ${events.length}개입니다. (${missingRows}개 부족, 중단 사유: ${expansion.stoppedReason}) 프로필 요약값을 기준으로 보고, ALL 탭 목록 수집 미완료로 분류합니다.`);
    }
    for (const tabCheck of tabChecks) {
      if (tabCheck.status === "warn") warnings.push(tabCheck.detail);
    }

    const player = {
      name,
      url,
      standingsSources,
      summary,
      badgeCounts,
      summaryForComparison,
      summaryAdjustment: null,
      events,
      expansion,
      duplicateEvents: duplicateEvents.length,
      comparisonStrategy,
      tabChecks,
      tabEventsByKey,
      calculated,
      comparisons: [],
      standingsChecks: [],
      warnings,
      defects: [],
      status: "fail"
    };

    player.comparisons = reconcileSummaryComparisons(
      compareSummary(player.summaryForComparison || player.summary, player.calculated, player.badgeCounts),
      player.tabChecks,
      player.expansion
    );
    player.standingsChecks = compareStandingsSourcesToSummary(player.standingsSources, player.summary);
    for (const standingCheck of player.standingsChecks) {
      if (standingCheck.status === "warn") warnings.push(standingCheck.detail);
    }
    for (const event of unavailableResultEvents) {
      // 비활성 Result 컨트롤도 프로필 요약 계산에는 포함한다.
      // Result 결함으로 볼지는 disabledResultMode 설정에 따른다.
      if (disabledResultMode === "fail") {
        event.resultPage = {
          url: event.disabledResultUrl || event.resultUrl || player.url,
          status: "fail",
          error: event.resultUnavailableReason || "Result 버튼/링크가 비활성화되어 검증할 수 없습니다.",
          checks: { resultControlEnabled: false },
          missing: ["resultControlEnabled"]
        };
      } else if (disabledResultMode === "check" && event.disabledResultUrl) {
        event.resultUrl = event.disabledResultUrl;
      } else {
        event.resultSkipped = event.resultUnavailableReason || "Result 버튼/링크가 비활성화되어 검증을 건너뜀";
      }
    }

    if (profileOnly) {
      for (const event of profileComparisonEvents) {
        if (!event.resultPage) {
          event.resultSkipped = event.resultSkipped || "Skipped (profile-only mode)";
        }
      }
      player.defects = buildDefects(player);
      player.status = playerStatus(player);
      return player;
    }

    const checkableResultEvents = profileComparisonEvents.filter((event) => !event.resultPage && (event.resultUrl || event.hasResultControl));
    const rankEligibleResultEvents = [];
    const rankSkippedResultEvents = [];

    for (const event of checkableResultEvents) {
      // rank limit은 선택 설정이다. 기본값 0은 순위와 관계없이 모든 checkable Result를 검증한다.
      if (resultRankLimit > 0 && event.rank !== null && event.rank > resultRankLimit) {
        event.resultSkipped = `건너뜀 (ResultRankLimit은 ${resultRankLimit}이나 선수의 순위는 ${event.rank})`;
        rankSkippedResultEvents.push(event);
      } else {
        rankEligibleResultEvents.push(event);
      }
    }

    const resultEvents = resultLimit > 0 ? rankEligibleResultEvents.slice(0, resultLimit) : rankEligibleResultEvents;
    const resultEventsToSkip = resultLimit > 0 ? rankEligibleResultEvents.slice(resultLimit) : [];
    for (const event of resultEvents) {
      // 가능하면 href 기반 Result 크롤링을 사용하고, 아니면 프로필 row 컨트롤을 클릭한다.
      // 두 경로 모두 같은 Result 스캐너를 공유한다.
      event.resultPage = event.resultUrl
        ? await crawlResultByUrl(context, player, event, timeout, authWaitMs, resultPageLimit)
        : await crawlResultByClick(context, player, event, timeout, authWaitMs, resultPageLimit);
    }
    for (const event of resultEventsToSkip) {
      event.resultSkipped = `건너뜀 (ResultLimit ${resultLimit} 초과)`;
    }
    if (rankSkippedResultEvents.length) {
      warnings.push(`선수 순위 제한(${resultRankLimit})으로 인해 결과 확인 ${rankSkippedResultEvents.length}건이 건너뛰어졌습니다.`);
    }
    if (unavailableResultEvents.length) {
      if (disabledResultMode === "fail") {
        warnings.push(`Result 버튼/링크가 비활성화된 ${unavailableResultEvents.length}건을 결함으로 기록했습니다.`);
      } else if (disabledResultMode === "check") {
        const checkableDisabledCount = unavailableResultEvents.filter((event) => event.disabledResultUrl).length;
        warnings.push(`Result 버튼/링크가 비활성화된 ${unavailableResultEvents.length}건 중 URL이 있는 ${checkableDisabledCount}건은 직접 접근으로 검증합니다.`);
      } else {
        warnings.push(`Result 버튼/링크가 비활성화된 ${unavailableResultEvents.length}건은 아직 검증 가능한 페이지가 아니어서 Result 상세 페이지 검증만 건너뜁니다. 프로필 요약/탭 계산에는 포함합니다.`);
      }
    }

    if (profileComparisonEvents.some((event) => event.hasResultControl && !event.resultUrl)) {
      warnings.push("결과 확인 일부 컨트롤이 단순 버튼 형태입니다. 일부 행에 대해 클릭 네비게이션이 실행되었습니다.");
    }

    player.defects = buildDefects(player);
    player.status = playerStatus(player);
    return player;
  } catch (error) {
    return {
      name: url,
      url,
      standingsSources,
      summary: {},
      events: [],
      calculated: {},
      comparisons: [],
      standingsChecks: [],
      warnings,
      defects: [],
      status: "fail",
      error: error.message
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function flattenDefects(report) {
  return (report.players || []).flatMap((player) => player.defects?.length ? player.defects : buildDefects(player));
}

function flattenReviewNotes(report) {
  const notes = [];

  for (const player of report.players || []) {
    const playerBrands = Array.from(new Set((player.standingsSources || []).map(s => s.brand || "All"))).join(", ");

    for (const warning of player.warnings || []) {
      notes.push({
        brand: playerBrands,
        type: "Crawler warning",
        player: player.name,
        item: "warning",
        url: player.url,
        detail: warning
      });
    }

    for (const event of player.events || []) {
      if (event.resultPage?.status === "warn") {
        notes.push({
          brand: playerBrands,
          type: "Result page unavailable",
          player: player.name,
          item: event.eventName,
          url: event.resultPage.url || event.resultUrl || player.url,
          detail: event.resultPage.resultUnavailableReason || event.resultPage.error || "Result page is temporarily unavailable."
        });
      }
      if (!event.resultSkipped) continue;
      if (/profile-only|standings-only/i.test(event.resultSkipped)) continue;
      if (!/(result|ranklimit|resultlimit|비활|결과|검증)/i.test(event.resultSkipped)) continue;
      notes.push({
        brand: playerBrands,
        type: "Result skipped",
        player: player.name,
        item: event.eventName,
        url: event.resultUrl || event.disabledResultUrl || player.url,
        detail: event.resultSkipped
      });
    }
  }

  return notes;
}

// 리포트 헤더용 실행 요약을 만든다.
// 중단된 실행도 pending player 수를 보존해 부분 live crawl을 해석하기 쉽게 한다.
function summarize(report) {
  const players = report.players || [];
  const defects = flattenDefects(report);
  const reviewNotes = flattenReviewNotes(report);
  const events = players.flatMap((player) => player.events || []);
  const resultPages = events.filter((event) => event.resultPage);
  const tabChecks = players.flatMap((player) => player.tabChecks || []);
  const standingsCategories = new Set(players.flatMap((player) => (player.standingsSources || []).map((source) => source.category)));
  const runStatus = report.runStatus || "complete";
  const totalPlayers = report.totalPlayers || players.length;
  const completedPlayers = players.length;
  const pendingPlayers = Math.max(0, totalPlayers - completedPlayers);
  const warnPlayers = players.filter((player) => player.status === "warn").length;
  const failedPlayers = players.filter((player) => player.status === "fail").length;
  const passedPlayers = players.filter((player) => player.status === "pass").length;
  const status = defects.length || failedPlayers ? "fail" : (warnPlayers || runStatus !== "complete") ? "warn" : "pass";
  return {
    status,
    runStatus,
    interruptedReason: report.interruptedReason || "",
    totalPlayers,
    completedPlayers,
    pendingPlayers,
    checkedPlayers: completedPlayers,
    checkedStandingsCategories: standingsCategories.size,
    passedPlayers,
    warnedPlayers: warnPlayers,
    failedPlayers,
    crawledEvents: events.length,
    tabChecks: tabChecks.length,
    failedTabChecks: tabChecks.filter((check) => check.status === "fail").length,
    crawledResultPages: resultPages.length,
    failedResultPages: resultPages.filter((event) => event.resultPage.status !== "pass").length,
    defects: defects.length,
    reviewNotes: reviewNotes.length
  };
}

function summarizeStandingsSources(players) {
  const byCategory = new Map();
  for (const player of players || []) {
    for (const source of player.standingsSources || []) {
      if (!byCategory.has(source.category)) byCategory.set(source.category, []);
      byCategory.get(source.category).push({ player: player.name, url: player.url, rank: source.rank });
    }
  }
  return Array.from(byCategory.entries()).map(([category, entries]) => ({
    category,
    entries: entries.sort((a, b) => (a.rank || 999999) - (b.rank || 999999))
  }));
}

function formatResultFinding(event) {
  const result = event.resultPage;
  if (!result) {
    if (event.resultSkipped) return event.resultSkipped;
    if (event.resultUrl || event.hasResultControl) return "Pending Result check.";
    return "No Result control found.";
  }
  if (result.error) return result.error;
  if (result.foundRow) {
    return `Found No ${result.foundRow.no}, ${result.foundRow.player}, ${formatValue("Total Earnings", result.foundRow.earnings)}`;
  }
  return `Missing: ${(result.missing || []).join(", ")}`;
}

function formatKoreanResultFinding(event) {
  const result = event.resultPage;
  if (!result) {
    if (event.resultSkipped) return `건너뜀: ${event.resultSkipped}`;
    if (event.resultUrl || event.hasResultControl) return "Result 확인 대기";
    return "Result 버튼/링크 없음";
  }
  if (result.error) return result.error;
  if (result.foundRow) {
    return `일치 행 발견: No ${result.foundRow.no}, ${result.foundRow.player}, ${formatValue("Total Earnings", result.foundRow.earnings)}`;
  }
  return `누락: ${(result.missing || []).join(", ")}`;
}

function formatKoreanDefectType(type) {
  return {
    "Profile summary mismatch": "프로필 요약 불일치",
    "Profile badge count mismatch": "프로필 뱃지 개수 불일치",
    "Standings/profile summary mismatch": "스탠딩/프로필 요약 불일치",
    "Profile tab count mismatch": "프로필 탭 개수 불일치",
    "Result page mismatch": "Result 페이지 불일치",
    "Result page unavailable": "Result 페이지 일시 접근 불가",
    "Result search incomplete": "Result 탐색 미완료",
    "Crawler warning": "크롤러 경고",
    "Result skipped": "Result 검증 건너뜀",
    "Crawler error": "크롤러 오류"
  }[type] || type;
}

function koreanHtmlPath(htmlPath) {
  const parsed = path.parse(htmlPath);
  return path.join(parsed.dir, `${parsed.name}-ko${parsed.ext || ".html"}`);
}

// 프리미엄 인터랙티브 HTML 템플릿 렌더러 함수
// 영문/국문 리포트가 같은 HTML 템플릿을 공유한다.
// 데이터 모델은 같고, 라벨과 일부 문구만 isKo 플래그로 바꾼다.
function renderHtml(report, pastReports = []) {
  return renderDashboardTemplate(report, false, pastReports);
}

function renderKoreanHtml(report, pastReports = []) {
  return renderDashboardTemplate(report, true, pastReports);
}

// 프리미엄 인터랙티브 HTML 대시보드 템플릿
function renderDashboardTemplate(report, isKo, pastReports = []) {
  const summary = summarize(report);
  const defects = flattenDefects(report);
  const reviewNotes = flattenReviewNotes(report);
  const standingsSourceSummary = summarizeStandingsSources(report.players);

  const totalChecked = summary.checkedPlayers || 1;
  const passPercent = Math.round((summary.passedPlayers / totalChecked) * 100);
  const isStandingsOnly = report.mode === "standings-only";
  const isProfileOnly = report.mode === "profile-only";
  const resultSkippedByMode = isStandingsOnly || isProfileOnly;

  const t = {
    title: isKo ? "WSOP 선수 순위 크롤러 대시보드" : "WSOP Player Standings Dashboard",
    generated: isKo ? "생성 시간" : "Generated",
    source: isKo ? "대상 사이트" : "Source",
    runStatus: isKo ? "실행 상태" : "Run Status",
    category: isKo ? "Standings 카테고리" : "Standings Categories",
    playersChecked: isKo ? "확인한 선수" : "Players Checked",
    eventsCrawled: isKo ? "ALL 탭 이벤트 수집" : "ALL Events Crawled",
    tabChecks: isKo ? "프로필 탭 검증" : "Profile Tab Checks",
    resultPages: isKo ? "Result 페이지 확인" : "Result Pages Checked",
    defectCandidates: isKo ? "결함 후보" : "Defect Candidates",
    reviewNotesList: isKo ? "주의/건너뜀 목록" : "Warnings / Skipped Checks",
    validationRules: isKo ? "검증 규칙 및 기준" : "Validation Rules",
    ruleItem: isKo ? "항목" : "Item",
    ruleRule: isKo ? "규칙" : "Rule",
    coverage: isKo ? "Standings 수집 범위" : "Standings Coverage",
    defectList: isKo ? "결함 후보 목록" : "Defect Candidates List",
    playersDetail: isKo ? "선수별 검증 디렉토리" : "Players Detail",
    searchPlaceholder: isKo ? "선수 이름으로 검색..." : "Search players by name...",
    filterAll: isKo ? "전체" : "All",
    filterPass: isKo ? "통과" : "Pass",
    filterFail: isKo ? "실패" : "Fail",
    filterWarn: isKo ? "주의" : "Warn",
    noDefects: isKo ? "발견된 결함 후보가 없습니다." : "No defect candidates found.",
    noReviewNotes: isKo ? "표시할 주의/건너뜀 항목이 없습니다." : "No warnings or skipped checks found.",
    profileStat: isKo ? "프로필 표시값" : "Profile Stat",
    calculatedValue: isKo ? "ALL 탭 계산값" : "Calculated From ALL Tab",
    comparisonValue: isKo ? "비교값" : "Comparison Value",
    statusText: isKo ? "상태" : "Status",
    tabHeader: isKo ? "탭" : "Tab",
    selectedTabLabel: isKo ? "클릭한 탭 라벨" : "Selected Label",
    visibleRows: isKo ? "표시 row 수" : "Visible Rows",
    detailText: isKo ? "상세 정보" : "Detail",
    seriesEvent: isKo ? "시리즈 / 이벤트" : "Series / Event",
    dateText: isKo ? "일자" : "Date",
    rankText: isKo ? "순위" : "Rank",
    earningsText: isKo ? "상금" : "Earnings",
    resultUrlText: isKo ? "Result URL" : "Result URL",
    resultCheckText: isKo ? "Result 확인" : "Result Check",
    finalFindingText: isKo ? "최종 결과 확인 내용" : "Final Result Finding",
    backToSimple: isKo ? "기존 단순 리포트 보기" : "View Simple Report",
    searchEventsPlaceholder: isKo ? "이벤트명 검색..." : "Search events...",
    rulesData: isKo ? [
      ["Standings/Profile", "All-Time Earnings - Men/Women의 Earnings, All-Time Bracelets의 Bracelets, All-Time Rings의 Rings를 프로필 요약값과 비교합니다."],
      ["Standings 카테고리", `${STANDINGS_CATEGORIES.map((c) => c.label).join(", ")}에서 상위 선수를 수집합니다.`],
      ["Title", "프로필 요약값을 기준으로 Title 전용 탭의 표시 row 수를 비교합니다. ALL 탭 계산값은 참고값으로 남깁니다."],
      ["Bracelets Badge", "`badge_WSOPBracelet.webp` 뱃지의 표시 개수를 프로필 상단 Bracelets 값과 비교하고, 불일치하면 결함 후보로 리포트에 노출합니다."],
      ["Rings Badge", "`badge_WSOPRing.webp` 뱃지의 표시 개수를 프로필 상단 Rings 값과 비교하고, 불일치하면 결함 후보로 리포트에 노출합니다."],
      ["Final Tables", "프로필 요약값을 기준으로 Final Tables 전용 탭의 표시 row 수를 비교합니다. ALL 탭 계산값은 참고값으로 남깁니다."],
      ["Cashes", "Load more로 펼친 ALL 탭 row를 프로필 Cashes와 비교합니다. 프로필 Cashes까지 수집하지 못하면 수집 미완료 주의로 표시합니다."],
      ["Total Earnings", "프로필 Total Earnings와 ALL 탭 계산 합계가 다르면 환율/통화/원본값 차이 가능성이 있어 주의로 표시하고 실패 집계에서는 제외합니다."],
      ["Profile tabs", "Title, Bracelets, Rings, Final Tables 탭을 눌러 표시 row 수와 프로필 요약값을 비교합니다."],
      ["Result", "Result 페이지를 열어 최종 결과표에서 No, 선수명, 상금이 모두 정확히 맞는지 확인합니다."]
    ] : [
      ["Standings categories", `Collect top players from ${STANDINGS_CATEGORIES.map((c) => c.label).join(", ")}.`],
      ["Standings/Profile", "Compare All-Time Earnings - Men/Women Earnings, All-Time Bracelets Bracelets, and All-Time Rings Rings against the profile summary values."],
      ["Title", "Compare the Title profile tab visible row count against the profile summary value. Keep the ALL-tab calculated value as reference only."],
      ["Bracelets Badge", "Compare the displayed `badge_WSOPBracelet.webp` count with the profile Bracelets value, and report mismatches as defect candidates."],
      ["Rings Badge", "Compare the displayed `badge_WSOPRing.webp` count with the profile Rings value, and report mismatches as defect candidates."],
      ["Final Tables", "Compare the Final Tables profile tab visible row count against the profile summary value. Keep the ALL-tab calculated value as reference only."],
      ["Cashes", "Compare ALL-tab rows against profile Cashes. If collection stops before the profile Cashes count, mark it as an incomplete-collection warning."],
      ["Total Earnings", "If profile Total Earnings differs from the ALL-tab calculated total, mark it as Warn because currency/rate/source differences can occur, and exclude it from failure totals."],
      ["Profile tabs", "Click Title, Bracelets, Rings, and Final Tables tabs and compare visible row counts with profile stats."],
      ["Result", "Open Results and verify that No, Player, and Earnings all match exactly."]
    ]
  };

  const reportJson = JSON.stringify(report).replace(/</g, '\u003c').replace(/>/g, '\u003e');

  return `<!doctype html>
<html lang="${isKo ? "ko" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(t.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <!-- Chart.js CDN -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-main: #0d1117;
      --bg-card: #151b23;
      --bg-card-hover: #1f2733;
      --bg-input: #080b0f;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --border: #30363d;
      --primary: #d61f2c;
      --primary-rgb: 214, 31, 44;
      --primary-hover: #f7c948;
      --success: #2ea043;
      --success-bg: rgba(46, 160, 67, 0.14);
      --danger: #f85149;
      --danger-bg: rgba(248, 81, 73, 0.14);
      --warning: #d29922;
      --warning-bg: rgba(210, 153, 34, 0.14);
      --shadow: 0 18px 45px rgba(0, 0, 0, 0.24);
      --card-border: 1px solid #30363d;
      --glass-blur: none;
    }
    * { box-sizing: border-box; transition: background-color 0.2s, color 0.2s, border-color 0.2s, transform 0.2s; }
    body { margin: 0; font-family: 'Inter', sans-serif; background-color: var(--bg-main); color: var(--text-main); line-height: 1.5; padding-bottom: 60px; }

    header { background: linear-gradient(135deg, #080a0f 0%, #171b24 58%, #2b1016 100%); padding: 30px 40px; position: relative; overflow: hidden; border-bottom: var(--card-border); box-shadow: var(--shadow); }
    header::after { content: ''; position: absolute; inset: auto 0 0 0; height: 3px; background: linear-gradient(90deg, var(--primary), #f7c948); pointer-events: none; }

    .header-content { max-width: 1600px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 30px; flex-wrap: wrap; }
    .eyebrow { color: var(--primary-hover); font-weight: 800; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 4px; }
    .header-title h1 { margin: 0; font-family: 'Outfit', sans-serif; font-size: 32px; font-weight: 800; letter-spacing: 0; color: var(--text-main); }
    .header-title p { margin: 8px 0 0; color: var(--text-muted); font-size: 14px; }
    .header-actions { display: flex; align-items: center; gap: 15px; }

    .btn { background: var(--bg-card); border: var(--card-border); color: var(--text-main); padding: 10px 20px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; box-shadow: var(--shadow); text-decoration: none; }
    .btn:hover { border-color: var(--primary); transform: translateY(-1px); }
    .btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
    .btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }

    main { max-width: 1600px; margin: 30px auto; padding: 0 30px; }

    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 45px; }
    .kpi-card { background: var(--bg-card); border-radius: 8px; padding: 25px; border: var(--card-border); box-shadow: var(--shadow); cursor: pointer; position: relative; overflow: hidden; }
    .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -10px rgba(0,0,0,0.3); border-color: var(--primary); }
    .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--primary); opacity: 0; transition: opacity 0.2s; }
    .kpi-card:hover::before { opacity: 1; }
    .kpi-card .kpi-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
    .kpi-card .kpi-value { font-size: 32px; font-weight: 800; margin-top: 10px; font-family: 'Outfit', sans-serif; }

    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
    .status-badge.pass { background-color: var(--success-bg); color: var(--success); }
    .status-badge.fail { background-color: var(--danger-bg); color: var(--danger); }
    .status-badge.warn { background-color: var(--warning-bg); color: var(--warning); }
    .status-badge.pending { background-color: rgba(255,255,255,0.06); color: var(--text-muted); }
    .header-actions .status-badge { font-size: 14px; padding: 8px 20px; font-weight: 800; letter-spacing: 1px; }

    .visualizations-row { display: grid; grid-template-columns: 1fr 2fr; gap: 25px; margin-bottom: 45px; }
    @media (max-width: 1024px) {
      .visualizations-row { grid-template-columns: 1fr; }
    }
    .chart-panel { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); padding: 25px; display: flex; flex-direction: column; }
    .chart-panel h3 { font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 20px; color: var(--text-main); border-left: 4px solid var(--primary); padding-left: 10px; }
    .chart-wrapper { position: relative; flex: 1; min-height: 250px; display: flex; align-items: center; justify-content: center; }

    .radial-chart-fallback { position: relative; width: 140px; height: 140px; }
    .radial-chart-fallback svg { transform: rotate(-90deg); width: 140px; height: 140px; }
    .radial-chart-fallback circle { fill: none; stroke-width: 10; }
    .radial-chart-fallback circle.bg { stroke: var(--border); }
    .radial-chart-fallback circle.fg { stroke: var(--success); stroke-linecap: round; transition: stroke-dashoffset 0.8s ease-in-out; }
    .radial-chart-fallback .percentage { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 800; }

    .grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 25px; margin-bottom: 40px; }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }

    .panel { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); overflow: hidden; margin-bottom: 40px; }
    .panel h2 { margin: 0; padding: 18px 24px; border-bottom: 1px solid var(--border); font-size: 18px; font-family: 'Outfit', sans-serif; }
    .panel-body { padding: 18px 20px; }
    .summary-line { display: flex; gap: 12px; flex-wrap: wrap; color: var(--text-muted); font-size: 14px; }
    .summary-line span { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 999px; padding: 7px 11px; }
    .bar { height: 14px; border-radius: 999px; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border); display: flex; margin-top: 18px; }
    .bar-pass { background: var(--success); }
    .bar-fail { background: var(--danger); }
    .bar-skip { background: var(--warning); }
    .note { border-left: 4px solid var(--primary-hover); background: var(--warning-bg); padding: 12px 14px; border-radius: 8px; color: var(--text-main); }

    h2 { font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 700; margin: 40px 0 20px; display: flex; align-items: center; gap: 10px; }
    h2 svg { fill: var(--primary); width: 24px; height: 24px; }

    .table-container { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; margin-top: 15px; }
    th { background: rgba(0, 0, 0, 0.2); color: var(--text-main); font-weight: 600; padding: 14px 18px; border-bottom: 1px solid var(--border); font-family: 'Outfit', sans-serif; }
    td { padding: 14px 18px; border-bottom: 1px solid var(--border); color: var(--text-main); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background-color: rgba(255, 255, 255, 0.015); }

    .clickable-row { cursor: pointer; }
    .clickable-row:hover { background-color: rgba(var(--primary-rgb), 0.05) !important; }

    .search-filter-bar { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
    .search-box { position: relative; flex: 1; min-width: 300px; }
    .search-box input { width: 100%; background: var(--bg-card); border: var(--card-border); color: var(--text-main); padding: 12px 20px 12px 45px; border-radius: 8px; font-size: 14px; box-shadow: var(--shadow); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    .search-box input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.2); }
    .search-box svg { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; fill: var(--text-muted); }

    .filter-controls { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }
    .filter-group { display: flex; gap: 6px; background: var(--bg-card); border: var(--card-border); padding: 4px; border-radius: 8px; box-shadow: var(--shadow); }
    .filter-btn { background: transparent; border: none; color: var(--text-muted); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .filter-btn:hover { color: var(--text-main); }
    .filter-btn.active { background: var(--primary); color: white; }

    .select-dropdown { background: var(--bg-card); border: var(--card-border); color: var(--text-main); padding: 10px 20px; border-radius: 8px; outline: none; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: var(--shadow); }
    .select-dropdown:focus { border-color: var(--primary); }

    .player-card { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; position: relative; }
    .player-card.pulse-glow { animation: pulseGlow 1.5s ease-in-out infinite alternate; border-color: var(--primary); }
    @keyframes pulseGlow {
      0% { box-shadow: 0 0 10px rgba(var(--primary-rgb), 0.1), var(--shadow); }
      100% { box-shadow: 0 0 25px rgba(var(--primary-rgb), 0.4), var(--shadow); }
    }

    .player-header { padding: 22px 28px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
    .player-header:hover { background-color: rgba(255,255,255,0.01); }

    .player-info-left { display: flex; align-items: center; gap: 15px; }
    .player-info-left h3 { margin: 0; font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 700; }
    .player-meta-info { font-size: 12px; color: var(--text-muted); margin-top: 6px; display: flex; gap: 16px; flex-wrap: wrap; }
    .player-meta-info span { display: inline-flex; align-items: center; gap: 6px; }

    .player-header-right { display: flex; align-items: center; gap: 15px; }
    .arrow-icon { width: 22px; height: 22px; fill: var(--text-muted); transition: transform 0.3s ease-out; }

    /* Smooth height accordion grid trick */
    .accordion-content { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
    .accordion-content.open { grid-template-rows: 1fr; }
    .accordion-inner { overflow: hidden; }
    .player-body-wrapper { padding: 0 28px 28px; border-top: 1px solid var(--border); margin-top: 0; }

    .grid-2col { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 25px; margin-bottom: 30px; }
    @media (max-width: 768px) {
      .grid-2col { grid-template-columns: 1fr; }
    }

    .defects-summary-box { background: var(--danger-bg); border: 1px solid rgba(248, 81, 73, 0.3); border-radius: 8px; padding: 18px; margin-bottom: 25px; color: var(--text-main); }
    .defects-summary-box h4 { margin: 0 0 10px; font-weight: 700; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 8px; }
    .defects-summary-box ul { margin: 0; padding-left: 20px; font-size: 13px; }

    /* Nested Tabs Style */
    .sub-tabs-container { border-bottom: 1px solid var(--border); margin-bottom: 20px; display: flex; gap: 20px; position: relative; }
    .sub-tab-btn { background: transparent; border: none; color: var(--text-muted); padding: 12px 4px; cursor: pointer; font-size: 13px; font-weight: 600; position: relative; }
    .sub-tab-btn:hover { color: var(--text-main); }
    .sub-tab-btn.active { color: var(--primary); }
    .tab-active-bar { position: absolute; bottom: -1px; height: 2px; background: var(--primary); transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1); }

    .sub-tab-content { display: none; }
    .sub-tab-content.active { display: block; }

    .nowrap { white-space: nowrap; }
    a { color: var(--primary); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; color: var(--primary-hover); }

    mark.highlight { background: rgba(var(--primary-rgb), 0.3); color: inherit; padding: 0 2px; border-radius: 4px; }

    .scroll-top-btn { position: fixed; bottom: 30px; right: 30px; width: 45px; height: 45px; border-radius: 50%; background: var(--primary); color: white; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 5px 15px rgba(0,0,0,0.3); opacity: 0; transform: translateY(10px); transition: opacity 0.3s, transform 0.3s; z-index: 100; }
    .scroll-top-btn.visible { opacity: 1; transform: translateY(0); }
    .scroll-top-btn:hover { background: var(--primary-hover); }
    .scroll-top-btn svg { width: 20px; height: 20px; fill: white; }

    .pagination-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
    .mini-btn { background: var(--bg-input); border: var(--card-border); color: var(--text-main); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; }
    .mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Collapsible Group Styles */
    .group-card { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; }
    .group-header { padding: 18px 24px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(0, 0, 0, 0.15); transition: background-color 0.2s; }
    .group-header:hover { background-color: rgba(255, 255, 255, 0.02); }
    .group-header-left { display: flex; align-items: center; gap: 15px; }
    .item-count-badge { background: var(--bg-input); border: var(--card-border); color: var(--text-muted); font-size: 11px; padding: 3px 10px; border-radius: 99px; font-weight: 700; }
    .group-arrow-icon { width: 20px; height: 20px; fill: var(--text-muted); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
    .group-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
    .group-body.collapsed { grid-template-rows: 0fr; }
    .group-body-inner { overflow: hidden; }
  </style>
</head>
<body>
  <header>
    <div class="header-content">
      <div class="header-title">
        <div class="eyebrow">${isKo ? "WSOP 플레이어 standings 크롤러" : "WSOP PLAYER STANDINGS CRAWLER"}</div>
        <h1>${escapeHtml(t.title)}${isStandingsOnly ? `<span class="status-badge warn" style="margin-left: 12px; font-size: 14px; padding: 6px 14px; vertical-align: middle; font-family: 'Inter', sans-serif;">${isKo ? "순위 수집 전용" : "Standings Only"}</span>` : (isProfileOnly ? `<span class="status-badge warn" style="margin-left: 12px; font-size: 14px; padding: 6px 14px; vertical-align: middle; font-family: 'Inter', sans-serif;">${isKo ? "프로필 검증 전용" : "Profile Only"}</span>` : "")}</h1>
        <p>${escapeHtml(t.generated)}: ${escapeHtml(new Date().toLocaleString())} | ${escapeHtml(t.runStatus)}: <span class="status-badge ${summary.status}">${escapeHtml(isKo ? formatStatus(summary.status) : summary.status)}</span>${summary.interruptedReason ? ` (${escapeHtml(summary.interruptedReason)})` : ""} | ${escapeHtml(t.source)}: <a href="${escapeHtml(report.playersUrl || "")}">${escapeHtml(report.playersUrl || "")}</a></p>
      </div>
      <div class="header-actions" style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
        ${pastReports.length > 0 ? `
          <div class="history-selector-wrapper" style="display: flex; align-items: center; gap: 8px;">
            <label for="history-select" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">
              ${isKo ? "이전 리포트 기록:" : "Past Reports:"}
            </label>
            <select id="history-select" class="select-dropdown" onchange="if(this.value) window.location.href=this.value" style="margin: 0; padding: 6px 12px; font-size: 12px; height: auto;">
              <option value="">-- ${isKo ? "리포트 선택" : "Select Report"} --</option>
              ${pastReports.map(rep => `<option value="${escapeHtml(rep.fileName)}">${escapeHtml(rep.label)}</option>`).join("")}
            </select>
          </div>
        ` : ""}
        <span class="status-badge ${summary.status}">${escapeHtml(isKo ? formatStatus(summary.status) : summary.status)}</span>
      </div>
    </div>
  </header>

  <main>
    <!-- KPI Dashboard Grid -->
    <div class="dashboard-grid">
      <div class="kpi-card" onclick="filterByStatus('all')">
        <div class="kpi-label">${escapeHtml(t.category)}</div>
        <div class="kpi-value">${summary.checkedStandingsCategories}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('all')">
        <div class="kpi-label">${escapeHtml(t.playersChecked)}</div>
        <div class="kpi-value">${summary.completedPlayers}/${summary.totalPlayers}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('pass')">
        <div class="kpi-label">${isKo ? "통과한 선수" : "Passed Players"}</div>
        <div class="kpi-value" style="color: var(--success);">${summary.passedPlayers}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('warn')">
        <div class="kpi-label">${isKo ? "주의 선수" : "Warned Players"}</div>
        <div class="kpi-value" style="color: var(--warning);">${summary.warnedPlayers || 0}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('fail')">
        <div class="kpi-label">${escapeHtml(t.defectCandidates)}</div>
        <div class="kpi-value" style="color: ${defects.length ? "var(--danger)" : "inherit"};">${summary.defects}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('warn')">
        <div class="kpi-label">${isKo ? "경고/주의 항목" : "Warnings / Notes"}</div>
        <div class="kpi-value" style="color: ${reviewNotes.length ? "var(--warning)" : "inherit"};">${summary.reviewNotes}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('all')">
        <div class="kpi-label">${isKo ? "Result 검증 단계" : "Result Check Stage"}</div>
        <div class="kpi-value" style="font-size:22px;">${resultSkippedByMode ? (isKo ? "생략" : "Skipped") : (isKo ? "수행" : "Enabled")}</div>
      </div>
    </div>

    <!-- Visualizations Row -->
    <div class="visualizations-row">
      <div class="chart-panel">
        <h3>${isKo ? "데이터 무결성 통계" : "Data Integrity Status"}</h3>
        <div class="chart-wrapper">
          <canvas id="statusChart" style="display:none;"></canvas>
          <div class="radial-chart-fallback" id="radialFallback">
            <svg>
              <circle class="bg" cx="70" cy="70" r="60" />
              <circle class="fg" cx="70" cy="70" r="60" stroke-dasharray="377" stroke-dashoffset="${377 - (377 * passPercent / 100)}" />
            </svg>
            <div class="percentage">${passPercent}%</div>
          </div>
        </div>
      </div>
      <div class="chart-panel">
        <h3>${isKo ? "검출된 결함 카테고리 분포" : "Defect Categories Breakdown"}</h3>
        <div class="chart-wrapper">
          <canvas id="defectsChart" style="display:none;"></canvas>
          <div id="defectsFallback" style="text-align:center;color:var(--text-muted);font-size:14px;padding:20px;">
            ${defects.length ? `${defects.length}개의 정합성 오류 항목이 검출되었습니다.` : `데이터 무결성 검증을 통과했습니다.`}
          </div>
        </div>
      </div>
    </div>

    <!-- Execution Summary & Readme First -->
    <section class="grid">
      <div class="panel">
        <h2>${isKo ? "실행 요약" : "Execution Summary"}</h2>
        <div class="panel-body">
          <div class="summary-line">
            <span>${isKo ? "대상 사이트" : "Source"}: <a href="${escapeHtml(report.playersUrl || "")}" target="_blank" onclick="event.stopPropagation();">${escapeHtml(report.playersUrl || "")}</a></span>
            <span>${isKo ? "브랜드 필터" : "Brand Filter"}: <strong>${escapeHtml(report.brandFilter || (isKo ? "전체" : "All"))}</strong></span>
            <span>${isKo ? "확인한 선수" : "Players Checked"}: ${summary.completedPlayers}/${summary.totalPlayers}</span>
            <span>${isKo ? "생성 시간" : "Generated"}: ${escapeHtml(new Date().toLocaleString())}</span>
            <span>${isKo ? "수집 카테고리" : "Categories"}: ${summary.checkedStandingsCategories}</span>
            <span>${isKo ? "실행 모드" : "Mode"}: <strong>${escapeHtml(isStandingsOnly ? (isKo ? "Standings Only" : "Standings Only") : (isProfileOnly ? (isKo ? "Profile Only" : "Profile Only") : (isKo ? "Full Crawl" : "Full Crawl")))}</strong></span>
          </div>
          <div class="bar" aria-label="정합성 비율">
            <div class="bar-pass" style="width:${(summary.passedPlayers / (summary.checkedPlayers || 1)) * 100}%"></div>
            <div class="bar-fail" style="width:${(summary.failedPlayers / (summary.checkedPlayers || 1)) * 100}%"></div>
            <div class="bar-skip" style="width:${((summary.warnedPlayers || 0) / (summary.checkedPlayers || 1)) * 100}%"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>${isKo ? "먼저 볼 내용" : "Read Me First"}</h2>
        <div class="panel-body">
          <div class="note">
            ${isKo ? 
              (summary.defects > 0 ? "데이터 무결성 검증 결과 일부 결함 후보가 검출되었습니다. 아래 결함 후보 목록에서 상세 비교 데이터를 확인하세요." : "모든 수집 대상 플레이어의 데이터 정합성 검증을 완료했으며, 검출된 결함 후보가 없습니다.") : 
              (summary.defects > 0 ? "Some data integrity defects were detected. Please review the Defect Candidates List below." : "All checked players passed the data integrity validation. No defect candidates were found.")
            }
          </div>
        </div>
      </div>
    </section>

    <!-- Crawler Coverage & Guidelines -->
    <h2>
      <svg viewBox="0 0 24 24" style="fill: var(--primary); width: 24px; height: 24px;"><path d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2M13,16H11V18H13V16M13,6H11V14H13V6Z"/></svg>
      ${isKo ? "크롤러 수집 범위 및 검증 기준" : "Crawler Coverage & Validation Guidelines"}
    </h2>

    <!-- Standings Coverage Collapsible Card -->
    <div class="group-card" style="margin-bottom: 20px;">
      <div class="group-header" onclick="toggleGroupCollapse('metadata', 'coverage')">
        <div class="group-header-left">
          <span class="status-badge pass" style="background-color: rgba(var(--primary-rgb), 0.15); color: var(--primary);">${escapeHtml(t.coverage)}</span>
          <span class="item-count-badge">${summary.checkedStandingsCategories} ${isKo ? '개 카테고리' : 'Categories'}</span>
        </div>
        <svg class="group-arrow-icon" id="metadata-group-arrow-coverage" viewBox="0 0 24 24" style="transform: rotate(0deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
      </div>
      <div class="group-body collapsed" id="metadata-group-body-coverage">
        <div class="group-body-inner">
          <div class="table-container" style="border-top: 1px solid var(--border);">
            ${standingsSourceSummary.length ? `<table>
              <thead>
                <tr><th style="width:280px;">Category</th><th>Players</th></tr>
              </thead>
              <tbody>
                ${standingsSourceSummary.map((item) => `<tr>
                  <td><strong>${escapeHtml(item.category)}</strong></td>
                  <td>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;">
                      ${item.entries.map((entry) => `<span class="status-badge" style="background:var(--bg-input);padding:5px 10px;"><span style="color:var(--primary);font-weight:700;margin-right:4px;">#${escapeHtml(entry.rank ?? "-")}</span> <a href="${escapeHtml(entry.url)}" target="_blank" onclick="event.stopPropagation();">${escapeHtml(entry.player)}</a></span>`).join("")}
                    </div>
                  </td>
                </tr>`).join("")}
              </tbody>
            </table>` : `<div style="padding: 20px; text-align: center; color: var(--text-muted);">${escapeHtml(t.noDefects)}</div>`}
          </div>
        </div>
      </div>
    </div>

    <!-- Validation Rules Collapsible Card -->
    <div class="group-card" style="margin-bottom: 40px;">
      <div class="group-header" onclick="toggleGroupCollapse('metadata', 'rules')">
        <div class="group-header-left">
          <span class="status-badge pass" style="background-color: rgba(var(--primary-rgb), 0.15); color: var(--primary);">${escapeHtml(t.validationRules)}</span>
          <span class="item-count-badge">${t.rulesData.length} ${isKo ? '개 규칙' : 'Rules'}</span>
        </div>
        <svg class="group-arrow-icon" id="metadata-group-arrow-rules" viewBox="0 0 24 24" style="transform: rotate(180deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
      </div>
      <div class="group-body" id="metadata-group-body-rules">
        <div class="group-body-inner">
          <div class="table-container" style="border-top: 1px solid var(--border);">
            <table>
              <thead>
                <tr><th class="nowrap" style="width:200px;">${escapeHtml(t.ruleItem)}</th><th>${escapeHtml(t.ruleRule)}</th></tr>
              </thead>
              <tbody>
                ${t.rulesData.map(([item, rule]) => `<tr><td class="nowrap"><strong>${escapeHtml(item)}</strong></td><td>${escapeHtml(rule)}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Defect Inspector List -->
    <h2>
      <svg viewBox="0 0 24 24"><path d="M12,2L1,21H23M12,6L19.8,20H4.2M11,10V14H13V10M11,16V18H13V16"/></svg>
      ${escapeHtml(t.defectList)}
    </h2>
    <div id="defects-grouped-container"></div>

    <!-- Warnings / Skipped Inspector List -->
    <h2>
      <svg viewBox="0 0 24 24"><path d="M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z"/></svg>
      ${escapeHtml(t.reviewNotesList)}
    </h2>
    <div id="warnings-grouped-container"></div>

    <!-- Players Detail Section -->
    <div class="search-filter-bar" id="player-directory">
      <h2>
        <svg viewBox="0 0 24 24"><path d="M16,13C15.71,13 15.38,13 15.03,13.05C16.19,13.89 17,15 17,16.5V19H23V16.5C23,14.28 19.33,13 16,13M8,13C4.67,13 1,14.28 1,16.5V19H15V16.5C15,14.28 11.33,13 8,13M8,11A3,3 0 0,0 11,8A3,3 0 0,0 8,5A3,3 0 0,0 5,8A3,3 0 0,0 8,11M16,11A3,3 0 0,0 19,8A3,3 0 0,0 16,5A3,3 0 0,0 13,8A3,3 0 0,0 16,11Z"/></svg>
        ${escapeHtml(t.playersDetail)}
      </h2>
      <div class="search-box">
        <svg viewBox="0 0 24 24"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>
        <input type="text" id="search-input" placeholder="${escapeHtml(t.searchPlaceholder)}">
      </div>
      <div class="filter-controls">
        <div class="filter-group">
          <button class="filter-btn active" data-filter="all" onclick="filterByStatus('all')">${escapeHtml(t.filterAll)}</button>
          <button class="filter-btn" data-filter="pass" onclick="filterByStatus('pass')">${escapeHtml(t.filterPass)}</button>
          <button class="filter-btn" data-filter="warn" onclick="filterByStatus('warn')">${escapeHtml(t.filterWarn)}</button>
          <button class="filter-btn" data-filter="fail" onclick="filterByStatus('fail')">${escapeHtml(t.filterFail)}</button>
        </div>
        <select class="select-dropdown" id="category-filter" onchange="filterByCategory(this.value)">
          <option value="all">${isKo ? "모든 카테고리" : "All Categories"}</option>
          <!-- Categories filled dynamically -->
        </select>
        <select class="select-dropdown" id="sort-select" onchange="sortPlayers(this.value)">
          <option value="name-asc">${isKo ? "이름순 (A-Z)" : "Name (A-Z)"}</option>
          <option value="name-desc">${isKo ? "이름 역순 (Z-A)" : "Name (Z-A)"}</option>
          <option value="cashes-desc">${isKo ? "이벤트 다수참가순" : "Most Cashed Events"}</option>
          <option value="earnings-desc">${isKo ? "총상금 높은순" : "Highest Earnings"}</option>
          <option value="status-desc">${isKo ? "정합성 상태순" : "Verify Status"}</option>
        </select>
      </div>
    </div>

    <!-- Dynamic Player List Container -->
    <div id="players-list"></div>
  </main>

  <button class="scroll-top-btn" id="scroll-to-top" onclick="window.scrollTo({top:0, behavior:'smooth'})">
    <svg viewBox="0 0 24 24"><path d="M7.41,18.41L6,17L12,11L18,17L16.59,18.41L12,13.83L7.41,18.41M7.41,12.41L6,11L12,5L18,11L16.59,12.41L12,7.83L7.41,12.41Z"/></svg>
  </button>

  <script>
    // Embedded JSON data with safe string escape
    const reportData = ${reportJson};
    const isKo = ${isKo};

    // Labels configuration
    const labels = {
      profileStat: "${escapeHtml(t.profileStat)}",
      calculatedValue: "${escapeHtml(t.calculatedValue)}",
      comparisonValue: "${escapeHtml(t.comparisonValue)}",
      statusText: "${escapeHtml(t.statusText)}",
      tabHeader: "${escapeHtml(t.tabHeader)}",
      selectedTabLabel: "${escapeHtml(t.selectedTabLabel)}",
      visibleRows: "${escapeHtml(t.visibleRows)}",
      seriesEvent: "${escapeHtml(t.seriesEvent)}",
      dateText: "${escapeHtml(t.dateText)}",
      rankText: "${escapeHtml(t.rankText)}",
      earningsText: "${escapeHtml(t.earningsText)}",
      resultUrlText: "${escapeHtml(t.resultUrlText)}",
      resultCheckText: "${escapeHtml(t.resultCheckText)}",
      finalFindingText: "${escapeHtml(t.finalFindingText)}",
      noDefects: "${escapeHtml(t.noDefects)}",
      noReviewNotes: "${escapeHtml(t.noReviewNotes)}",
      searchEventsPlaceholder: "${escapeHtml(t.searchEventsPlaceholder)}"
    };

    const state = {
      players: reportData.players || [],
      searchQuery: '',
      statusFilter: 'all',
      categoryFilter: 'all',
      sortBy: 'name-asc'
    };

    // Sub-tab active index caching
    const activeSubTabs = {};
    // Event lists page caching
    const eventPages = {};
    // Event lists search query caching
    const eventSearchQuery = {};

    // Chart.js instance caches
    let statusChartInstance = null;
    let defectsChartInstance = null;

    // Scroll to top button visibility
    const scrollTopBtn = document.getElementById('scroll-to-top');
    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) scrollTopBtn.classList.add('visible');
      else scrollTopBtn.classList.remove('visible');
    });

    // Helper functions
    function formatValue(label, val) {
      if (val === null || val === undefined) return "-";
      if (label.toLowerCase().includes("earnings") || label.toLowerCase().includes("상금")) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
      }
      return val;
    }

    function formatStatus(status) {
      if (!isKo) return status;
      return { pass: "통과", fail: "실패", warn: "주의", pending: "대기" }[status] || status;
    }

    function formatKoreanDefectType(type) {
      if (!isKo) return type;
      return {
        "Profile summary mismatch": "프로필 요약 불일치",
        "Profile badge count mismatch": "프로필 뱃지 개수 불일치",
        "Standings/profile summary mismatch": "스탠딩/프로필 요약 불일치",
        "Profile tab count mismatch": "프로필 탭 개수 불일치",
        "Result page mismatch": "Result 페이지 불일치",
        "Result page unavailable": "Result 페이지 일시 접근 불가",
        "Result search incomplete": "Result 탐색 미완료",
        "Crawler warning": "크롤러 경고",
        "Result skipped": "Result 검증 건너뜀",
        "Crawler error": "크롤러 오류"
      }[type] || type;
    }

    function localizeWarning(warning) {
      if (!isKo) return warning;
      return warning
        .replace(/Total Earnings calculated from ALL tab/g, "ALL 탭에서 계산한 총상금")
        .replace(/is different from profile summary/g, "이 프로필 요약값과 다릅니다")
        .replace(/calculated/g, "계산값")
        .replace(/profile summary/g, "프로필 요약")
        .replace(/Crawl error:/g, "크롤링 오류:")
        .replace(/No result pages check because disabledResultMode is/g, "Result 검증 비활성화 설정 상태:")
        .replace(/Result buttons\\/links are disabled/g, "Result 버튼 또는 링크가 비활성화됨");
    }

    function formatLabel(label) {
      if (!isKo) return label;
      return {
        "titles": "Title",
        "bracelets": "Bracelets",
        "rings": "Rings",
        "finalTables": "Final Tables",
        "cashes": "Cashes",
        "totalEarnings": "Total Earnings",
        "Title": "Title",
        "Bracelets": "Bracelets",
        "Rings": "Rings",
        "Final Tables": "Final Tables"
      }[label] || label;
    }

    function formatKoreanResultFinding(event) {
      const result = event.resultPage;
      if (!result) {
        if (event.resultSkipped) return "건너뜀: " + event.resultSkipped;
        if (event.resultUrl || event.hasResultControl) return "Result 확인 대기";
        return "Result 버튼/링크 없음";
      }
      if (result.error) return result.error;
      if (result.foundRow) {
        return "일치 행 발견: No " + result.foundRow.no + ", " + result.foundRow.player + ", " + formatValue("Total Earnings", result.foundRow.earnings);
      }
      return "누락: " + (result.missing || []).join(", ");
    }

    function formatResultFinding(event) {
      const result = event.resultPage;
      if (!result) {
        if (event.resultSkipped) return event.resultSkipped;
        if (event.resultUrl || event.hasResultControl) return "Awaiting results";
        return "No result control";
      }
      if (result.error) return result.error;
      if (result.foundRow) {
        return "Match found: No " + result.foundRow.no + ", " + result.foundRow.player + ", " + formatValue("Total Earnings", result.foundRow.earnings);
      }
      return "Missing: " + (result.missing || []).join(", ");
    }

    function escapeHtml(str) {
      if (typeof str !== 'string') return str;
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function highlightText(text, search) {
      if (!search.trim()) return escapeHtml(text);
      const regex = new RegExp(\`(\${search.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&')})\`, 'gi');
      return escapeHtml(text).replace(regex, '<mark class="highlight">$1</mark>');
    }

    // Dynamic sorting & filtering logic
    function getFilteredAndSortedPlayers() {
      return state.players
        .filter(player => {
          const matchesSearch = player.name.toLowerCase().includes(state.searchQuery.toLowerCase());
          const matchesStatus = state.statusFilter === 'all' || player.status === state.statusFilter;

          let matchesCategory = true;
          if (state.categoryFilter !== 'all') {
            matchesCategory = (player.standingsSources || []).some(src => src.category === state.categoryFilter);
          }

          return matchesSearch && matchesStatus && matchesCategory;
        })
        .sort((a, b) => {
          if (state.sortBy === 'name-asc') return a.name.localeCompare(b.name);
          if (state.sortBy === 'name-desc') return b.name.localeCompare(a.name);

          if (state.sortBy === 'cashes-desc') {
            const aCashes = a.events?.length || 0;
            const bCashes = b.events?.length || 0;
            return bCashes - aCashes;
          }
          if (state.sortBy === 'earnings-desc') {
            const aEarnings = a.summary?.totalEarnings || 0;
            const bEarnings = b.summary?.totalEarnings || 0;
            return bEarnings - aEarnings;
          }
          if (state.sortBy === 'status-desc') {
            const order = { fail: 3, warn: 2, pass: 1 };
            const aOrder = order[a.status] || 0;
            const bOrder = order[b.status] || 0;
            return bOrder - aOrder;
          }
          return 0;
        });
    }

    // Rendering functions
    function populateStaticTables() {
      // 1. Categories filter dropdown list
      const catSelect = document.getElementById('category-filter');
      const categories = [...new Set(state.players.flatMap(p => (p.standingsSources || []).map(src => src.category)))];
      categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        catSelect.appendChild(opt);
      });

      // 2. Defects Grouped Accordion
      const defectsContainer = document.getElementById('defects-grouped-container');
      const defectsList = state.players.flatMap(p => (p.defects || []).map(d => ({ ...d, player: p.name })));

      if (defectsList.length) {
        // Group by type
        const groupedDefects = {};
        defectsList.forEach(row => {
          const type = row.type || "Other";
          if (!groupedDefects[type]) groupedDefects[type] = [];
          groupedDefects[type].push(row);
        });

        let html = '';
        Object.entries(groupedDefects).forEach(([type, rows]) => {
          const typeKey = type.replace(/[^a-zA-Z0-9]/g, '-');
          const localizedType = formatKoreanDefectType(type);

          html += \`
            <div class="group-card">
              <div class="group-header" onclick="toggleGroupCollapse('defects', '\${typeKey}')">
                <div class="group-header-left">
                  <span class="status-badge fail">\${escapeHtml(localizedType)}</span>
                  <span class="item-count-badge">\${rows.length} \${isKo ? '건' : 'items'}</span>
                </div>
                <svg class="group-arrow-icon" id="defects-group-arrow-\${typeKey}" viewBox="0 0 24 24" style="transform: rotate(0deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
              </div>
              <div class="group-body collapsed" id="defects-group-body-\${typeKey}">
                <div class="group-body-inner">
                  <div class="table-container" style="border-top: 1px solid var(--border);">
                    <table>
                      <thead>
                        <tr><th>Player</th><th>Item</th><th>Expected</th><th>Actual</th><th>Detail</th></tr>
                      </thead>
                      <tbody>
                        \${rows.map(row => \`
                          <tr class="clickable-row" onclick="inspectPlayer('\${escapeHtml(row.player)}')">
                            <td class="nowrap"><strong>\${escapeHtml(row.player)}</strong></td>
                            <td>\${escapeHtml(formatLabel(row.item))}</td>
                            <td><code>\${escapeHtml(row.expected)}</code></td>
                            <td><code>\${escapeHtml(row.actual)}</code></td>
                            <td style="max-width:350px; font-size:11px; color:var(--text-muted); word-break:break-all;">\${escapeHtml(row.detail || "")}</td>
                          </tr>
                        \`).join("")}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          \`;
        });
        defectsContainer.innerHTML = html;
      } else {
        defectsContainer.innerHTML = \`<div class="panel" style="padding: 20px; text-align: center; color: var(--text-muted);">\${labels.noDefects}</div>\`;
      }

      // 3. Warnings Grouped Accordion
      const warningsContainer = document.getElementById('warnings-grouped-container');
      const warningsList = [];
      state.players.forEach(p => {
        (p.warnings || []).forEach(w => {
          warningsList.push({ type: "Crawler warning", player: p.name, item: "warning", url: p.url, detail: w });
        });
        (p.events || []).forEach(ev => {
          if (ev.resultPage?.status === "warn") {
            warningsList.push({
              type: "Result page unavailable",
              player: p.name,
              item: ev.eventName,
              url: ev.resultPage.url || ev.resultUrl || p.url,
              detail: ev.resultPage.resultUnavailableReason || ev.resultPage.error || "Result page is temporarily unavailable."
            });
          }
          if (ev.resultSkipped && /(result|ranklimit|resultlimit|비활|결과|검증)/i.test(ev.resultSkipped)) {
            if (!/profile-only|standings-only/i.test(ev.resultSkipped)) {
              warningsList.push({ type: "Result skipped", player: p.name, item: ev.eventName, url: ev.resultUrl || ev.disabledResultUrl || p.url, detail: ev.resultSkipped });
            }
          }
        });
      });

      if (warningsList.length) {
        // Group by type
        const groupedWarnings = {};
        warningsList.forEach(row => {
          const type = row.type || "Other";
          if (!groupedWarnings[type]) groupedWarnings[type] = [];
          groupedWarnings[type].push(row);
        });

        let html = '';
        Object.entries(groupedWarnings).forEach(([type, rows]) => {
          const typeKey = type.replace(/[^a-zA-Z0-9]/g, '-');
          const localizedType = formatKoreanDefectType(type);

          html += \`
            <div class="group-card">
              <div class="group-header" onclick="toggleGroupCollapse('warnings', '\${typeKey}')">
                <div class="group-header-left">
                  <span class="status-badge warn">\${escapeHtml(localizedType)}</span>
                  <span class="item-count-badge">\${rows.length} \${isKo ? '건' : 'items'}</span>
                </div>
                <svg class="group-arrow-icon" id="warnings-group-arrow-\${typeKey}" viewBox="0 0 24 24" style="transform: rotate(0deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
              </div>
              <div class="group-body collapsed" id="warnings-group-body-\${typeKey}">
                <div class="group-body-inner">
                  <div class="table-container" style="border-top: 1px solid var(--border);">
                    <table>
                      <thead>
                        <tr><th>Player</th><th>Item</th><th>Detail</th></tr>
                      </thead>
                      <tbody>
                        \${rows.map(row => \`
                          <tr class="clickable-row" onclick="inspectPlayer('\${escapeHtml(row.player)}')">
                            <td class="nowrap"><strong>\${escapeHtml(row.player)}</strong></td>
                            <td>\${row.url ? \`<a href="\${escapeHtml(row.url)}" target="_blank" onclick="event.stopPropagation();">\${escapeHtml(formatLabel(row.item))}</a>\` : escapeHtml(formatLabel(row.item))}</td>
                            <td style="max-width:600px; font-size:12px; color:var(--text-muted); word-break:break-word;">\${escapeHtml(localizeWarning(row.detail || ""))}</td>
                          </tr>
                        \`).join("")}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          \`;
        });
        warningsContainer.innerHTML = html;
      } else {
        warningsContainer.innerHTML = \`<div class="panel" style="padding: 20px; text-align: center; color: var(--text-muted);">\${labels.noReviewNotes}</div>\`;
      }
    }

    // Toggle grouped accordion view
    function toggleGroupCollapse(type, groupKey) {
      const body = document.getElementById(\`\${type}-group-body-\${groupKey}\`);
      const icon = document.getElementById(\`\${type}-group-arrow-\${groupKey}\`);
      if (!body || !icon) return;

      const isCollapsed = body.classList.toggle('collapsed');
      if (isCollapsed) {
        icon.style.transform = 'rotate(0deg)';
      } else {
        icon.style.transform = 'rotate(180deg)';
      }
    }

    // Toggle player accordion view
    function toggleAccordion(playerName) {
      const card = document.querySelector(\`.player-card[data-name="\${playerName}"]\`);
      if (!card) return;
      const content = card.querySelector('.accordion-content');
      const icon = card.querySelector('.arrow-icon');

      const isOpen = content.classList.contains('open');
      if (isOpen) {
        content.classList.remove('open');
        icon.style.transform = 'rotate(0deg)';
      } else {
        content.classList.add('open');
        icon.style.transform = 'rotate(180deg)';

        // Active line animation initialization on first expand
        const activeTab = activeSubTabs[playerName] || 'summary';
        setTimeout(() => switchSubTab(playerName, activeTab), 10);
      }
    }

    // Switch nested player profile sub-tabs
    function switchSubTab(playerName, tabName) {
      activeSubTabs[playerName] = tabName;
      const card = document.querySelector(\`.player-card[data-name="\${playerName}"]\`);
      if (!card) return;

      card.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
      card.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));

      const targetBtn = card.querySelector(\`.sub-tab-btn[data-tab="\${tabName}"]\`);
      const targetContent = card.querySelector(\`.sub-tab-content[data-tab="\${tabName}"]\`);

      if (targetBtn) targetBtn.classList.add('active');
      if (targetContent) targetContent.classList.add('active');

      // Update underline bar position
      const bar = card.querySelector('.tab-active-bar');
      if (bar && targetBtn) {
        bar.style.left = targetBtn.offsetLeft + 'px';
        bar.style.width = targetBtn.offsetWidth + 'px';
      }

      // Render event rows immediately when the Events tab becomes active.
      if (tabName === 'events') {
        if (!eventPages[playerName]) eventPages[playerName] = 1;
        renderPlayerEvents(playerName);
      }
    }

    // Event listing pagination and search rendering inside player details
    function renderPlayerEvents(playerName) {
      const card = document.querySelector(\`.player-card[data-name="\${playerName}"]\`);
      if (!card) return;
      const tbody = card.querySelector('.events-tbody');
      const pageInfo = card.querySelector('.events-page-info');
      const prevBtn = card.querySelector('.events-prev-btn');
      const nextBtn = card.querySelector('.events-next-btn');

      const player = state.players.find(p => p.name === playerName);
      if (!player) return;

      const events = player.events || [];
      const searchQuery = (eventSearchQuery[playerName] || '').toLowerCase();
      const filteredEvents = events.filter(e => e.eventName.toLowerCase().includes(searchQuery));

      const page = eventPages[playerName] || 1;
      const pageSize = 10;
      const totalPages = Math.ceil(filteredEvents.length / pageSize) || 1;
      const startIndex = (page - 1) * pageSize;
      const pagedEvents = filteredEvents.slice(startIndex, startIndex + pageSize);

      if (pagedEvents.length === 0) {
        tbody.innerHTML = \`<tr><td colspan="7" style="text-align:center;color:var(--text-muted); font-size:12px;">\${isKo ? "일치하는 참가 이벤트가 없습니다." : "No events matched."}</td></tr>\`;
      } else {
        tbody.innerHTML = pagedEvents.map(event => {
          const resStatus = event.resultPage ? event.resultPage.status : "pending";
          const resText = event.resultPage ? formatStatus(event.resultPage.status) : "-";
          const resultDetail = isKo ? formatKoreanResultFinding(event) : formatResultFinding(event);
          const link = event.resultPage?.url ? event.resultPage.url : event.resultUrl;
          return \`
            <tr>
              <td><strong>\${escapeHtml(event.eventName)}</strong></td>
              <td class="nowrap">\${escapeHtml(event.date || "-")}</td>
              <td class="nowrap">\${escapeHtml(event.rankText || event.rank || "-")}</td>
              <td class="nowrap">\${escapeHtml(formatValue("totalEarnings", event.earnings))}</td>
              <td>\${link ? \`<a href="\${escapeHtml(link)}" target="_blank" onclick="event.stopPropagation();">Link</a>\` : "-"}</td>
              <td><span class="status-badge \${resStatus}">\${escapeHtml(resText)}</span></td>
              <td style="font-size:12px;color:var(--text-muted);max-width:320px;word-break:break-all;">\${escapeHtml(resultDetail)}</td>
            </tr>
          \`;
        }).join("");
      }

      if (pageInfo) pageInfo.textContent = \`\${page} / \${totalPages} (\${filteredEvents.length})\`;
      if (prevBtn) prevBtn.disabled = page === 1;
      if (nextBtn) nextBtn.disabled = page === totalPages;
    }

    function changeEventPage(playerName, direction) {
      let page = eventPages[playerName] || 1;
      page += direction;
      eventPages[playerName] = page;
      renderPlayerEvents(playerName);
    }

    function searchEvents(playerName, query) {
      eventSearchQuery[playerName] = query;
      eventPages[playerName] = 1; // Reset to page 1
      renderPlayerEvents(playerName);
    }

    // Build single player card UI
    function buildPlayerCard(player) {
      const hasWarning = player.warnings && player.warnings.length > 0;
      const statusText = formatStatus(player.status);
      const isExpanded = activeSubTabs[player.name] ? 'open' : '';
      const totalEvents = player.events?.length ?? 0;

      return \`
        <div class="player-card" data-status="\${player.status}" data-name="\${escapeHtml(player.name)}">
          <div class="player-header" onclick="toggleAccordion('\${escapeHtml(player.name)}')">
            <div class="player-info-left">
              <h3>\${highlightText(player.name, state.searchQuery)}</h3>
              <div class="player-meta-info">
                <span>🔗 <a href="\${escapeHtml(player.url)}" onclick="event.stopPropagation();" target="_blank">\${escapeHtml(player.url)}</a></span>
                <span>🏆 Cashed Events: <strong>\${totalEvents}</strong></span>
                <span>Cashes (Profile): <strong>\${player.summary?.cashes ?? "-"}</strong></span>
                <span>Load More: <strong>\${player.expansion?.loadMoreClicks ?? 0}</strong></span>
              </div>
            </div>
            <div class="player-header-right">
              <span class="status-badge \${player.status}">\${escapeHtml(statusText)}</span>
              <svg class="arrow-icon" viewBox="0 0 24 24"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
            </div>
          </div>

          <div class="accordion-content">
            <div class="accordion-inner">
              <div class="player-body-wrapper">
                \${player.error ? \`<div class="defects-summary-box"><h4>Crawl Error</h4><p>\${escapeHtml(player.error)}</p></div>\` : ""}
                \${hasWarning ? \`
                  <div class="defects-summary-box" style="background:var(--warning-bg);border-color:rgba(245,158,11,0.3);color:var(--text-main);">
                    <h4>Warnings</h4>
                    <ul>
                      \${player.warnings.map(w => \`<li>\${escapeHtml(localizeWarning(w))}</li>\`).join("")}
                    </ul>
                  </div>
                \` : ""}

                ${report.mode === 'standings-only' ? `
                  <div style="padding: 25px 20px; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.015); border-radius: 8px; border: 1px dashed var(--border); font-size: 13px; margin-top: 10px;">
                    ${isKo 
                      ? "⚡ <strong>Standings Only 수집</strong>: 이 선수는 순위 목록에서 수집되었으며, 상세 프로필 분석 및 Result 검증 단계를 거치지 않았습니다." 
                      : "⚡ <strong>Standings Only Mode</strong>: This player was collected directly from the standings list. Detailed profile analysis and Results verification were skipped."}
                  </div>
                ` : `
                  <!-- Tab Headers -->
                  <div class="sub-tabs-container">
                    <button class="sub-tab-btn" data-tab="summary" onclick="switchSubTab('\${escapeHtml(player.name)}', 'summary')">\${isKo ? "1. 요약 메트릭 검증" : "1. Summary Checks"}</button>
                    <button class="sub-tab-btn" data-tab="tabs" onclick="switchSubTab('\${escapeHtml(player.name)}', 'tabs')">\${isKo ? "2. 프로필 탭 검증" : "2. Profile Tab Integrity"}</button>
                    ${report.mode !== 'profile-only' ? `
                      <button class="sub-tab-btn" data-tab="events" onclick="switchSubTab('\${escapeHtml(player.name)}', 'events')">\${isKo ? "3. 참가 이벤트 결과 검증" : "3. Result Verification"}</button>
                    ` : ''}
                    <div class="tab-active-bar"></div>
                  </div>

                  <!-- Sub-tab Content: Summary Metrics -->
                  <div class="sub-tab-content" data-tab="summary">
                    <h4 style="margin:0 0 12px;font-family:'Outfit',sans-serif;">Summary Metrics Check</h4>
                    <table style="width:100%;">
                      <thead>
                        <tr><th>Stat</th><th>\${labels.profileStat}</th><th>\${labels.comparisonValue}</th><th>\${labels.statusText}</th></tr>
                      </thead>
                      <tbody>
                        \${(player.comparisons || []).map(item => \`
                          <tr>
                            <td><strong>\${escapeHtml(formatLabel(item.label))}</strong></td>
                            <td>\${escapeHtml(formatValue(item.label, item.top))}</td>
                            <td>\${escapeHtml(formatValue(item.label, item.calculated))}\${item.sourceLabel ? \`<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">\${escapeHtml(item.sourceLabel)}</div>\` : ""}</td>
                            <td><span class="status-badge \${item.status}">\${escapeHtml(formatStatus(item.status))}</span></td>
                          </tr>
                        \`).join("")}
                      </tbody>
                    </table>
                  </div>

                  <!-- Sub-tab Content: Profile Tab Integrity -->
                  <div class="sub-tab-content" data-tab="tabs">
                    <h4 style="margin:0 0 12px;font-family:'Outfit',sans-serif;">Profile Tabs Integrity</h4>
                    <table style="width:100%;">
                      <thead>
                        <tr><th>\${labels.tabHeader}</th><th>\${labels.selectedTabLabel}</th><th>\${labels.profileStat}</th><th>\${labels.visibleRows}</th><th>\${labels.statusText}</th></tr>
                      </thead>
                      <tbody>
                        \${(player.tabChecks || []).map(item => \`
                          <tr>
                            <td><strong>\${escapeHtml(formatLabel(item.label))}\${isKo ? " 탭" : ""}</strong></td>
                            <td><code>\${escapeHtml(item.selectedTab || "-")}</code></td>
                            <td>\${escapeHtml(formatValue(item.label, item.expected))}</td>
                            <td>\${escapeHtml(formatValue(item.label, item.actual))}</td>
                            <td><span class="status-badge \${item.status}">\${escapeHtml(formatStatus(item.status))}</span></td>
                          </tr>
                        \`).join("")}
                      </tbody>
                    </table>
                  </div>

                  <!-- Sub-tab Content: Events results list -->
                  ${report.mode !== 'profile-only' ? `
                    <div class="sub-tab-content" data-tab="events">
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                        <h4 style="margin:0; font-family:'Outfit',sans-serif;">Cashed Events Results Matching</h4>
                        <div class="search-box" style="min-width:200px; flex:0 1 250px;">
                          <svg viewBox="0 0 24 24"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>
                          <input type="text" class="events-search-input" placeholder="\${labels.searchEventsPlaceholder}" oninput="searchEvents('\${escapeHtml(player.name)}', this.value)">
                        </div>
                      </div>

                      <div class="table-container">
                        <table>
                          <thead>
                            <tr>
                              <th>\${labels.seriesEvent}</th>
                              <th>\${labels.dateText}</th>
                              <th>\${labels.rankText}</th>
                              <th>\${labels.earningsText}</th>
                              <th>\${labels.resultUrlText}</th>
                              <th>\${labels.resultCheckText}</th>
                              <th>\${labels.finalFindingText}</th>
                            </tr>
                          </thead>
                          <tbody class="events-tbody">
                            <!-- Filled dynamically -->
                          </tbody>
                        </table>
                      </div>

                      <div class="pagination-bar">
                        <button class="mini-btn events-prev-btn" onclick="changeEventPage('\${escapeHtml(player.name)}', -1)">◀ Prev</button>
                        <span class="events-page-info">1 / 1 (0)</span>
                        <button class="mini-btn events-next-btn" onclick="changeEventPage('\${escapeHtml(player.name)}', 1)">Next ▶</button>
                      </div>
                    </div>
                  ` : `
                    <div style="padding: 25px 20px; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.015); border-radius: 8px; border: 1px dashed var(--border); font-size: 13px; margin-top: 15px;">
                      \${isKo
                        ? "ℹ️ <strong>Profile Only 모드</strong>: 프로필 요약 및 탭 검증은 수행되었으나, 대회 결과(Result) 상세 검증 단계는 의도적으로 생략되었습니다."
                        : "ℹ️ <strong>Profile Only Mode</strong>: Profile summary and tab validation were performed, and tournament result (Result) detail checks were intentionally skipped."}
                    </div>
                  `}
                `}

              </div>
            </div>
          </div>
        </div>
      \`;
    }

    function renderPlayerList() {
      const container = document.getElementById('players-list');
      const filtered = getFilteredAndSortedPlayers();

      if (filtered.length === 0) {
        container.innerHTML = \`<div style="text-align:center;padding:50px;color:var(--text-muted);background:var(--bg-card);border-radius:20px;border:var(--card-border);">\${isKo ? "조건에 부합하는 선수가 없습니다." : "No players matched your criteria."}</div>\`;
        return;
      }

      container.innerHTML = filtered.map(buildPlayerCard).join("");

      // Trigger lazy pagination rendering for events inside expanded cards
      filtered.forEach(p => {
        const card = document.querySelector(\`.player-card[data-name="\${p.name}"]\`);
        const content = card.querySelector('.accordion-content');
        if (content.classList.contains('open') || activeSubTabs[p.name]) {
          renderPlayerEvents(p.name);
          switchSubTab(p.name, activeSubTabs[p.name] || 'summary');
        }
      });
    }

    // Filter control callback triggers
    function filterByStatus(status) {
      state.statusFilter = status;

      // Update UI active button
      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === status) btn.classList.add('active');
        else btn.classList.remove('active');
      });

      renderPlayerList();

      // Auto-scroll to directory if KPI was clicked
      document.getElementById('player-directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function filterByCategory(category) {
      state.categoryFilter = category;
      renderPlayerList();
    }

    function sortPlayers(sortBy) {
      state.sortBy = sortBy;
      renderPlayerList();
    }

    // Search text field input listener
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderPlayerList();
    });

    // Inspector Click to Scroll & Expand player card
    function inspectPlayer(playerName) {
      // Clear filters
      searchInput.value = '';
      state.searchQuery = '';
      state.statusFilter = 'all';
      state.categoryFilter = 'all';

      // Update Filter buttons & selectors
      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === 'all') btn.classList.add('active');
        else btn.classList.remove('active');
      });
      document.getElementById('category-filter').value = 'all';

      renderPlayerList();

      // Find player card element
      setTimeout(() => {
        const card = document.querySelector(\`.player-card[data-name="\${playerName}"]\`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });

          const content = card.querySelector('.accordion-content');
          const icon = card.querySelector('.arrow-icon');

          if (!content.classList.contains('open')) {
            content.classList.add('open');
            icon.style.transform = 'rotate(180deg)';
            renderPlayerEvents(playerName);
            switchSubTab(playerName, activeSubTabs[playerName] || 'summary');
          }

          card.classList.remove('pulse-glow');
          void card.offsetWidth; // Reflow reset
          card.classList.add('pulse-glow');
          setTimeout(() => card.classList.remove('pulse-glow'), 2500);
        }
      }, 100);
    }

    // Initialize Chart.js
    function initCharts() {
      // Chart.js requires loaded context
      if (typeof Chart === 'undefined') {
        console.warn("Chart.js was not loaded. Falling back to SVG graphs.");
        showFallbackCharts();
        return;
      }

      // Destroy old chart instances if they exist
      if (statusChartInstance) {
        statusChartInstance.destroy();
        statusChartInstance = null;
      }
      if (defectsChartInstance) {
        defectsChartInstance.destroy();
        defectsChartInstance = null;
      }

      try {
        const ctx1 = document.getElementById('statusChart');
        const ctx2 = document.getElementById('defectsChart');

        // Dynamically read computed theme colors
        const style = getComputedStyle(document.documentElement);
        const textMutedColor = style.getPropertyValue('--text-muted').trim() || '#94a3b8';
        const borderGridColor = style.getPropertyValue('--border').trim() || 'rgba(255, 255, 255, 0.08)';

        // 1. Data Integrity Doughnut Chart
        const integrityData = {
          passed: ${summary.passedPlayers},
          warned: ${summary.warnedPlayers || 0},
          failed: ${summary.failedPlayers}
        };

        const integrityLabels = isKo ? ['통과', '주의', '실패'] : ['Passed', 'Warned', 'Failed'];

        statusChartInstance = new Chart(ctx1, {
          type: 'doughnut',
          data: {
            labels: integrityLabels,
            datasets: [{
              data: [integrityData.passed, integrityData.warned, integrityData.failed],
              backgroundColor: [
                style.getPropertyValue('--success').trim() || '#10b981',
                style.getPropertyValue('--warning').trim() || '#f59e0b',
                style.getPropertyValue('--danger').trim() || '#ef4444'
              ],
              borderWidth: 2,
              borderColor: style.getPropertyValue('--bg-card').trim() || '#151b23'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: textMutedColor,
                  font: { family: 'Outfit', size: 12 }
                }
              }
            },
            cutout: '65%'
          }
        });

        // 2. Defect Categories Horizontal Bar Chart
        const defectTypes = {};
        state.players.flatMap(p => p.defects || []).forEach(d => {
          const type = d.type;
          defectTypes[type] = (defectTypes[type] || 0) + 1;
        });

        const barLabels = Object.keys(defectTypes).map(t => formatKoreanDefectType(t));
        const barData = Object.values(defectTypes);

        if (barData.length === 0) {
          ctx2.style.display = 'none';
          document.getElementById('defectsFallback').style.display = 'block';
          document.getElementById('defectsFallback').innerHTML = \`<strong style="color:var(--success);">\${isKo ? "정합성 결함이 발견되지 않았습니다." : "No integrity defects found."}</strong>\`;
        } else {
          ctx2.style.display = 'block';
          document.getElementById('defectsFallback').style.display = 'none';

          defectsChartInstance = new Chart(ctx2, {
            type: 'bar',
            data: {
              labels: barLabels,
              datasets: [{
                label: isKo ? '검출 건수' : 'Count',
                data: barData,
                backgroundColor: 'rgba(214, 31, 44, 0.72)',
                borderColor: '#d61f2c',
                borderWidth: 1.5,
                borderRadius: 6
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              scales: {
                x: {
                  grid: { color: borderGridColor },
                  ticks: { color: textMutedColor, precision: 0 }
                },
                y: {
                  grid: { display: false },
                  ticks: {
                    color: textMutedColor,
                    font: { family: 'Inter', size: 11 }
                  }
                }
              }
            }
          });
        }

        // 성공적으로 Chart.js 렌더링 완료 시 캔버스 보이기 및 폴백 숨김
        ctx1.style.display = 'block';
        document.getElementById('radialFallback').style.display = 'none';
      } catch (error) {
        console.error("Failed to initialize Chart.js charts, using fallback:", error);
        showFallbackCharts();
      }
    }

    function showFallbackCharts() {
      document.getElementById('statusChart').style.display = 'none';
      document.getElementById('defectsChart').style.display = 'none';
      document.getElementById('radialFallback').style.display = 'block';
      document.getElementById('defectsFallback').style.display = 'block';
    }

    // 브라우저의 새로고침 시 자동 스크롤 복원 동작 차단
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    // App Initialization bootstrap
    window.addEventListener('DOMContentLoaded', () => {
      populateStaticTables();
      renderPlayerList();
      initCharts();

      // Set active item in history dropdown
      const currentFileName = window.location.pathname.split('/').pop();
      const historySelect = document.getElementById('history-select');
      if (historySelect && currentFileName) {
        for (let i = 0; i < historySelect.options.length; i++) {
          if (historySelect.options[i].value === currentFileName) {
            historySelect.selectedIndex = i;
            break;
          }
        }
      }
    });
  </script>
</body>
</html>
`;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeCsv(filePath, rows) {
  const headers = ["brand", "type", "player", "item", "expected", "actual", "url", "detail"];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [headers, ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].map((line) => Array.isArray(line) ? line.join(",") : line).join("\n") + "\n", "utf8");
}

// 모든 선수 크롤링이 끝나거나 실행이 중단된 뒤 최종 리포트 객체를 만든다.
// 디버깅과 재개 판단을 위해 pending player 정보를 보존한다.
function buildCrawlerReport({ startedAt, finishedAt, playersUrl, playerEntries, players, runStatus, interruptedReason = "", brandFilter = null, brandOptions = null, mode = "crawler" }) {
  const completedPlayers = [];
  const pendingPlayers = [];

  for (let index = 0; index < playerEntries.length; index += 1) {
    const player = players[index];
    if (player) {
      completedPlayers.push(player);
    } else {
      const entry = playerEntries[index];
      pendingPlayers.push({
        index,
        url: entry.url,
        standingsSources: entry.standingsSources
      });
    }
  }

  const report = {
    mode,
    runStatus,
    interruptedReason,
    startedAt,
    finishedAt,
    playersUrl,
    brandFilter,
    brandOptions,
    standingsCategories: STANDINGS_CATEGORIES.map((category) => category.label),
    totalPlayers: playerEntries.length,
    completedPlayers: completedPlayers.length,
    pendingPlayers,
    players: completedPlayers
  };
  report.summary = summarize(report);
  return report;
}

function standingOnlyPlayerFromEntry(entry) {
  const firstSource = (entry.standingsSources || []).find((source) => source?.name) || {};
  return {
    name: firstSource.name || playerNameFromUrl(entry.url) || entry.url,
    url: entry.url,
    standingsSources: entry.standingsSources || [],
    summary: {},
    events: [],
    calculated: {},
    comparisons: [],
    tabChecks: [],
    warnings: [],
    defects: [],
    status: "pass"
  };
}

function buildStandingsOnlyReport({ startedAt, finishedAt, playersUrl, playerEntries, brandFilter = null, brandOptions = null }) {
  const players = playerEntries.map(standingOnlyPlayerFromEntry);
  const report = buildCrawlerReport({
    startedAt,
    finishedAt,
    playersUrl,
    playerEntries,
    players,
    runStatus: "complete",
    brandFilter,
    brandOptions
  });

  report.mode = "standings-only";
  report.summary.mode = "standings-only";
  return report;
}

function getPastHtmlReports(htmlReportPath, isKo = false) {
  try {
    const dir = path.dirname(htmlReportPath);
    if (!fs.existsSync(dir)) return [];
    
    const files = fs.readdirSync(dir);
    const reportFiles = files.filter(f => {
      if (isKo) {
        return f.endsWith("-report-ko.html");
      } else {
        return f.endsWith("-report.html") && !f.endsWith("-report-ko.html");
      }
    });

    reportFiles.sort((a, b) => b.localeCompare(a));

    return reportFiles.map(file => {
      const match = file.match(/(\d{8})-(\d{6})/);
      let dateLabel = file;
      if (match) {
        const dateStr = match[1];
        const timeStr = match[2];
        dateLabel = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)} ${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
      }
      return {
        fileName: file,
        label: dateLabel
      };
    });
  } catch (err) {
    console.error("Error reading past HTML reports:", err);
    return [];
  }
}

function writeReportArtifacts(args, report) {
  writeJson(args.out, report);
  fs.mkdirSync(path.dirname(args.html), { recursive: true });

  const pastEnglishReports = getPastHtmlReports(args.html, false);
  const pastKoreanReports = getPastHtmlReports(args.html, true);

  fs.writeFileSync(args.html, renderHtml(report, pastEnglishReports), "utf8");
  const koreanHtml = koreanHtmlPath(args.html);
  fs.writeFileSync(koreanHtml, renderKoreanHtml(report, pastKoreanReports), "utf8");
  writeCsv(args.defects, flattenDefects(report));

  return koreanHtml;
}

// 데이터 모델과 pagination edge case를 빠르게 확인하는 로컬 안전망.
// 브라우저를 띄우지 않으므로 크롤러 로직 변경 후 항상 실행하기 좋다.
function runSelfTest() {
  const parsedArgs = parseArgs(["--result-rank-limit", "50", "--concurrency", "5", "--disabled-result-mode", "fail"]);
  if (parsedArgs.resultRankLimit !== 50) {
    throw new Error("Result rank limit argument parsing failed");
  }
  if (parsedArgs.concurrency !== 5) {
    throw new Error("Concurrency argument parsing failed");
  }
  const manualPlayerArgs = parseArgs(["--player-url", "https://www.wsop.com/players/tony-ren-lin/"]);
  if (!/automation\/output\/wsop-player-crawler-tony-ren-lin-\d{8}-\d{6}-\d{3}-report\.html$/.test(manualPlayerArgs.html.replace(/\\/g, "/"))) {
    throw new Error("Manual player URL runs should use timestamped output report paths by default");
  }
  const manualPlayerCustomHtmlArgs = parseArgs(["--player-url", "https://www.wsop.com/players/tony-ren-lin/", "--html", "automation/output/custom.html"]);
  if (manualPlayerCustomHtmlArgs.html !== "automation/output/custom.html" || manualPlayerCustomHtmlArgs.out === DEFAULT_OUT_PATH) {
    throw new Error("Explicit manual player output paths should be preserved while unspecified paths are timestamped");
  }
  if (normalizeDisabledResultMode(parsedArgs.disabledResultMode) !== "fail") {
    throw new Error("Disabled Result mode argument parsing failed");
  }
  if (resultPageInspectionLimit(0) !== Number.MAX_SAFE_INTEGER || !shouldInspectEveryResultPage(0)) {
    throw new Error("Result page limit 0 should inspect every page");
  }
  if (resultPageInspectionLimit(50) !== 50 || shouldInspectEveryResultPage(50)) {
    throw new Error("Positive result page limit should cap inspected pages");
  }
  if (effectiveResultPageInspectionLimit(5, 537) < 23 || effectiveResultPageInspectionLimit(5, null) !== 5) {
    throw new Error("Result page limit should expand when needed to cover the target rank");
  }
  if (resultSearchStartPageForRank(501) !== 9 || resultSearchStartPageForRank(28) !== null) {
    throw new Error("Result search start page calculation failed");
  }
  if (!shouldUseDirectResultRankJump(537, 0) || !shouldUseDirectResultRankJump(1006, 10) || !shouldUseDirectResultRankJump(1006, 0) || shouldUseDirectResultRankJump(28, 10)) {
    throw new Error("Result direct rank jump gating failed");
  }
  if (resultPageNumberForRank(50) !== null || resultPageNumberForRank(51) !== 2 || resultPageNumberForRank(100) !== 2 || resultPageNumberForRangeStart(400) !== 8 || resultPageNumberForRangeStart(401) !== 9) {
    throw new Error("Result page number calculation failed");
  }
  if (!resultRangeResolvesTargetRank({ min: 400, max: 449 }, 420) || !resultRangeResolvesTargetRank({ min: 450, max: 499 }, 420) || resultRangeResolvesTargetRank({ min: 350, max: 399 }, 420)) {
    throw new Error("Result target rank early-stop calculation failed");
  }
  if (resultRangeResolvesTargetRank({ min: 301, max: 350 }, 353) || !resultRangeResolvesTargetRank({ min: 351, max: 400 }, 353)) {
    throw new Error("Deep result rank range resolution failed");
  }
  if (resultRowsResolveTargetRank([{ no: 1 }, { no: 928 }], 353) || resultRowsResolveTargetRank([{ no: 351 }, { no: 352 }, { no: 353 }], 353) || !resultRowsResolveTargetRank([{ no: 351 }, { no: 352 }, { no: 353 }, { no: 354 }], 353)) {
    throw new Error("Sparse result rows should not stop deep-rank pagination early");
  }
  if (resultRowsResolveTargetRank([{ no: 1 }, { no: 100 }], 100) || resultRowsResolveTargetRank([{ no: 100 }, { no: 100 }], 100)) {
    throw new Error("Tied target ranks should continue across result pages");
  }
  if (resultPagesCoverTargetRank([{ rows: [{ no: 1 }, { no: 100 }] }], 100) || !resultPagesCoverTargetRank([{ rows: [{ no: 1 }, { no: 100 }] }, { rows: [{ no: 101 }] }], 100)) {
    throw new Error("Result coverage should require seeing beyond a sparse or tied target rank");
  }
  if (resultPagesCoverTargetRank([{ resultPageNumber: 20, rows: [{ no: 952 }, { no: 1001 }] }, { resultPageNumber: 46, rows: [{ no: 2255 }, { no: 2304 }] }], 1077)) {
    throw new Error("Result coverage should not cross unsearched target rank gaps");
  }
  if (cachedPagesCoverEvent([{ rows: [{ no: 1 }, { no: 100 }] }], { rank: 100 }) || cachedPagesCoverEvent([{ rows: [{ no: 100 }, { no: 100 }] }], { rank: 100 })) {
    throw new Error("Cached pages ending on tied target rank should not be treated as covering the event");
  }
  if (cachedPagesCoverEvent([{ rows: [{ no: 638 }, { no: 692 }] }], { rank: 597 }) || cachedPagesCoverEvent([{ rows: [{ no: 719 }, { no: 781 }] }], { rank: 61 })) {
    throw new Error("Cached pages after the target rank should not be treated as covering the event");
  }
  if (!cachedPagesCoverEvent([{ rows: [{ no: 595 }, { no: 597 }, { no: 598 }] }], { rank: 597 })) {
    throw new Error("Cached pages spanning beyond the target rank should cover the event");
  }
  if (!cachedPagesCoverEvent([{ rows: [{ no: 501 }, { no: 550 }] }, { rows: [{ no: 551 }, { no: 600 }] }], { rank: 537 })) {
    throw new Error("Cached pages that progress beyond a missing target rank should cover the event");
  }
  const rankGap = targetRankGap({ min: 371, max: 434 }, { min: 500, max: 558 }, 458);
  if (!rankGap || rankGap.start !== 435 || rankGap.end !== 499 || targetRankGap({ min: 371, max: 434 }, { min: 500, max: 558 }, 600)) {
    throw new Error("Target rank gap detection failed");
  }
  if (!resultPlayerNameMatches("Александр Басин Russia", "SBasinАлександр Басин")) {
    throw new Error("Unicode player name matching failed");
  }
  if (!resultPlayerNameMatches("Christian Frimodt Denmark", "ButijustknowChristian Frimodt")) {
    throw new Error("Screen-name-prefixed player name matching failed");
  }
  if (resultPlayerMatches("William Wolf Mexico", { name: "William Foxen", standingsSources: [] })) {
    throw new Error("Result player matching should not match players by first name only");
  }
  if (!resultPlayerMatches("Александр Басин Russia", { name: "SBasinАлександр Басин", standingsSources: [{ name: "Александр Басин" }] })) {
    throw new Error("Standings real-name alias matching failed");
  }
  const textFallbackRow = findResultRowInBodyText("Final Result No Player Country Earnings 52 Александр Басин Russia $876,595 53 Other Player Germany $1,000", { name: "SBasinАлександр Басин", standingsSources: [{ name: "Александр Басин" }] }, 52, 876595);
  if (!textFallbackRow || textFallbackRow.no !== 52) {
    throw new Error("Final result text fallback matching failed");
  }
  const textFallbackMoneyMismatchRow = findResultRowInBodyText("Final Result No Player Country Earnings 52 Александр Басин Russia $875,000 53 Other Player Germany $1,000", { name: "SBasinАлександр Басин", standingsSources: [{ name: "Александр Басин" }] }, 52, 876595);
  if (!textFallbackMoneyMismatchRow || textFallbackMoneyMismatchRow.no !== 52 || textFallbackMoneyMismatchRow.earnings !== 875000) {
    throw new Error("Final result text fallback should preserve the found row for an earnings mismatch failure");
  }
  const wrongWilliamFallbackRow = findResultRowInBodyText("Final Result No Player Country Earnings 111 William Wolf Mexico $7,005", { name: "William Foxen", standingsSources: [] }, null, 836);
  if (wrongWilliamFallbackRow) {
    throw new Error("Final result text fallback should not match a different player with the same first name");
  }
  const audFallbackRow = findResultRowInBodyText("5 Kahle Burns New Zealand A$201,994 6 Benny Spindler Germany A$146,205 7 Mikel Habb Australia A$107,730 8 Russell Thomas United States A$82,721 9 Antonio Esfandiari United States A$65,408 10 Jordan Westmorland Australia A$65,408", { name: "Antonio Esfandiari", standingsSources: [] }, 9, 65408);
  if (!audFallbackRow || audFallbackRow.no !== 9 || audFallbackRow.earnings !== 65408) {
    throw new Error("Final result text fallback should read the earnings beside the matched player");
  }
  const vndFallbackRow = findResultRowInBodyText("Final Result No Player Country Earnings 7 Punnat Punsri Thailand ₫1,564,687,416", { name: "Punnat Punsri", standingsSources: [] }, 7, 1564687416);
  if (!vndFallbackRow || vndFallbackRow.no !== 7 || vndFallbackRow.earnings !== 1564687416) {
    throw new Error("Final result text fallback should read the Vietnamese Dong earnings or match it numeric-only");
  }
  const ranklessNearbyFallbackRow = findResultRowInBodyText(
    "Final Result No Player Country Earnings Alpha Row Daniel Rezaei Austria $307 Beta Row Other Player Germany $1,000",
    { name: "Daniel Rezaei", standingsSources: [] },
    589,
    254
  );
  if (ranklessNearbyFallbackRow) {
    throw new Error("Final result text fallback should not invent a target rank when nearby text has no rank token");
  }
  const resultEarningsMismatchChecks = {
    hasFinalResultRows: true,
    directPageClicked: false,
    rankMatches: true,
    playerMatches: true,
    earningsMatches: false
  };
  if (resultMissingChecks(resultEarningsMismatchChecks).join(",") !== "earningsMatches") {
    throw new Error("Result earnings mismatch should be a failure");
  }

  if (cleanPlayerName("Kristen FoxenKristen Foxen", "https://www.wsop.com/players/kristen-foxen/") !== "Kristen Foxen") {
    throw new Error("Repeated player name cleanup failed");
  }
  if (cleanPlayerName("BUPPIEMaurice Hawkins", "https://www.wsop.com/players/maurice-hawkins/") !== "Maurice Hawkins") {
    throw new Error("Badge-prefixed player name cleanup failed");
  }
  if (canonicalPlayerName("SBasinАлександр Басин", [{ name: "Александр Басин" }]) !== "Александр Басин") {
    throw new Error("Standings real-name canonicalization failed");
  }

  const summary = parseSummary("Title 2 Bracelets 1 Rings 1 Final Tables 3 Cashes 4 Total Earnings $165,000");
  const zeroProfileWarning = profileDataUnavailableWarningPlayer({
    name: "Legacy Profile",
    url: "https://www.wsop.com/players/profile/?playerid=1",
    summary: parseSummary("Title 0 Bracelets 0 Rings 0 Final Tables 0 Cashes 0 Total Earnings $0"),
    bodyText: "Legacy profile body"
  });
  if (zeroProfileWarning.status !== "warn" || zeroProfileWarning.comparisons.length || !isZeroProfileSummary(zeroProfileWarning.summary)) {
    throw new Error("Zero summary with zero collected events should be treated as unavailable profile data");
  }
  const events = [
    normalizeEvent({ rowIndex: 0, text: "WSOP Bracelet #1 $100,000 Result", cells: ["WSOP Bracelet", "#1", "$100,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/1", hasResultControl: true }),
    normalizeEvent({ rowIndex: 1, text: "WSOP Circuit Ring #1 $50,000 Result", cells: ["WSOP Circuit Ring", "#1", "$50,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/2", hasResultControl: true }),
    normalizeEvent({ rowIndex: 2, text: "WSOP #9 $10,000 Result", cells: ["WSOP", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/3", hasResultControl: true }),
    normalizeEvent({ rowIndex: 3, text: "WSOP #10 $5,000 Result", cells: ["WSOP", "#10", "$5,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/4", hasResultControl: true })
  ];
  const unavailableResultEvent = normalizeEvent({
    rowIndex: 4,
    text: "WSOP Paradise #22 $58,300 Result",
    cells: ["WSOP Paradise", "#22 / 287", "$58,300", "Result"],
    headers: ["Event", "Rank", "Earnings", "Result"],
    resultUrl: null,
    hasResultControl: false,
    resultUnavailable: true,
    resultUnavailableReason: "Result disabled"
  });
  if (!unavailableResultEvent.resultUnavailable || unavailableResultEvent.resultUrl || unavailableResultEvent.hasResultControl) {
    throw new Error("Disabled Result control should be preserved as unavailable, not checkable");
  }
  if (classifyAward("WSOP ONLINEWSOP OnlineWSOPC Series: $5K High Roller") !== "ring") {
    throw new Error("Concatenated WSOPC event labels should be classified as rings");
  }
  if (classifyAward("WSOP CIRCUITWSOP Circuit - National Championship2015 WSOP National Championship - No-Limit Hold'em") !== "bracelet") {
    throw new Error("WSOP National Championship titles should be classified as bracelets even when the series label mentions Circuit");
  }
  const skippedBraceletWin = normalizeEvent({
    rowIndex: 5,
    text: "WSOP Bracelet #1 $12,345 Result",
    cells: ["WSOP Bracelet", "#1", "$12,345", "Result"],
    headers: ["Event", "Rank", "Earnings", "Result"],
    resultUrl: null,
    hasResultControl: false,
    resultUnavailable: true,
    resultUnavailableReason: "Result disabled"
  });
  if (!eventContributesToProfileTab(skippedBraceletWin, "titles") || !eventContributesToProfileTab(skippedBraceletWin, "bracelets") || !eventContributesToProfileTab(skippedBraceletWin, "finalTables") || eventContributesToProfileTab(skippedBraceletWin, "rings")) {
    throw new Error("Skipped Result event tab contribution classification failed");
  }
  const skippedAdjustment = calculateFromEvents([skippedBraceletWin]);
  if (skippedAdjustment.titles !== 1 || skippedAdjustment.bracelets !== 1 || skippedAdjustment.rings !== 0 || skippedAdjustment.finalTables !== 1 || skippedAdjustment.cashes !== 1 || skippedAdjustment.totalEarnings !== 12345) {
    throw new Error("Skipped winning event summary adjustment failed");
  }
  const disabledIncludedSummary = parseSummary("Title 1 Bracelets 1 Rings 0 Final Tables 1 Cashes 1 Total Earnings $12,345");
  const disabledIncludedComparisons = compareSummary(disabledIncludedSummary, calculateFromEvents([skippedBraceletWin]));
  if (disabledIncludedComparisons.some((item) => item.status !== "pass")) {
    throw new Error("Disabled Result rows should remain in profile summary comparisons");
  }
  const calculated = calculateFromEvents(events);
  const comparisons = compareSummary(summary, calculated);
  if (comparisons.some((item) => item.status !== "pass")) {
    throw new Error(`Self-test comparison failed: ${JSON.stringify(comparisons)}`);
  }
  const overflowSplit = splitEventsByExpectedCashes(events, parseSummary("Title 1 Bracelets 1 Rings 0 Final Tables 2 Cashes 2 Total Earnings $150,000"));
  if (overflowSplit.comparisonEvents.length !== 2 || overflowSplit.overflowEvents.length !== 2 || calculateFromEvents(overflowSplit.comparisonEvents).cashes !== 2) {
    throw new Error("Events beyond profile Cashes should be excluded from comparison totals");
  }
  const exactExpectedSplit = comparisonEventsForSummary([events[0], events[0]], parseSummary("Title 2 Bracelets 2 Rings 0 Final Tables 2 Cashes 2 Total Earnings $200,000"));
  if (exactExpectedSplit.comparisonEvents.length !== 2 || exactExpectedSplit.strategy !== "raw") {
    throw new Error("Collected rows that already match profile Cashes should not be deduplicated");
  }
  const duplicateBeforeLegitimateWinA = normalizeEvent({ rowIndex: 10, text: "Duplicate FT #9 $10,000 Result", cells: ["Duplicate FT", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/dup-a", hasResultControl: true });
  duplicateBeforeLegitimateWinA.date = "Jan 01 2024";
  const duplicateBeforeLegitimateWinB = normalizeEvent({ rowIndex: 11, text: "Duplicate FT #9 $10,000 Result", cells: ["Duplicate FT", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: null, hasResultControl: true });
  duplicateBeforeLegitimateWinB.date = "Jan 01 2024";
  const dedupPreferredSplit = comparisonEventsForSummary([duplicateBeforeLegitimateWinA, duplicateBeforeLegitimateWinB, skippedBraceletWin], parseSummary("Title 1 Bracelets 1 Rings 0 Final Tables 2 Cashes 2 Total Earnings $22,345"));
  const dedupPreferredCalculated = calculateFromEvents(dedupPreferredSplit.comparisonEvents);
  if (dedupPreferredSplit.strategy !== "deduped" || dedupPreferredCalculated.titles !== 1 || dedupPreferredCalculated.finalTables !== 2 || dedupPreferredCalculated.cashes !== 2) {
    throw new Error("Summary comparison should deduplicate only when it improves profile count matching");
  }
  const hybridSummaryCalculated = calculateSummaryFromEvents([events[0], duplicateBeforeLegitimateWinA, duplicateBeforeLegitimateWinB], parseSummary("Title 1 Bracelets 1 Rings 0 Final Tables 2 Cashes 3 Total Earnings $122,345"));
  if (hybridSummaryCalculated.cashes !== 3 || hybridSummaryCalculated.finalTables !== 2) {
    throw new Error("Summary count metrics should use deduped counts without reducing Cashes");
  }
  const tonyLikeBaseEvents = [
    normalizeEvent({ rowIndex: 20, text: "FT A #2 $10,000 Result", cells: ["FT A", "#2", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-a", hasResultControl: true }),
    normalizeEvent({ rowIndex: 21, text: "FT B #3 $10,001 Result", cells: ["FT B", "#3", "$10,001"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-b", hasResultControl: true }),
    normalizeEvent({ rowIndex: 22, text: "FT C #4 $10,002 Result", cells: ["FT C", "#4", "$10,002"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-c", hasResultControl: true }),
    normalizeEvent({ rowIndex: 23, text: "FT D #5 $10,003 Result", cells: ["FT D", "#5", "$10,003"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-d", hasResultControl: true }),
    normalizeEvent({ rowIndex: 24, text: "FT E #6 $10,004 Result", cells: ["FT E", "#6", "$10,004"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-e", hasResultControl: true }),
    normalizeEvent({ rowIndex: 25, text: "FT F #7 $10,005 Result", cells: ["FT F", "#7", "$10,005"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-f", hasResultControl: true }),
    normalizeEvent({ rowIndex: 26, text: "FT G #8 $10,006 Result", cells: ["FT G", "#8", "$10,006"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/ft-g", hasResultControl: true }),
    normalizeEvent({ rowIndex: 27, text: "Duplicate Pair One #2 $110,000 Result", cells: ["Duplicate Pair One", "#2", "$110,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: null, hasResultControl: false, resultUnavailable: true }),
    normalizeEvent({ rowIndex: 28, text: "Duplicate Pair One #2 $110,000 Result", cells: ["Duplicate Pair One", "#2", "$110,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/dup-one", hasResultControl: true }),
    normalizeEvent({ rowIndex: 29, text: "Duplicate Pair Two #2 $654,419 Result", cells: ["Duplicate Pair Two", "#2", "$654,419"], headers: ["Event", "Rank", "Earnings"], resultUrl: null, hasResultControl: false, resultUnavailable: true }),
    normalizeEvent({ rowIndex: 30, text: "Duplicate Pair Two #2 $654,419 Result", cells: ["Duplicate Pair Two", "#2", "$654,419"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/dup-two", hasResultControl: true })
  ];
  tonyLikeBaseEvents.forEach((event, index) => {
    event.date = `Jan ${String(index + 1).padStart(2, "0")} 2025`;
  });
  tonyLikeBaseEvents[7].date = "Dec 19 2024";
  tonyLikeBaseEvents[8].date = "Dec 19 2024";
  tonyLikeBaseEvents[9].date = "Dec 15 2024";
  tonyLikeBaseEvents[10].date = "Dec 15 2024";
  const tonyLikeFillers = Array.from({ length: 72 }, (_, index) => {
    const event = normalizeEvent({ rowIndex: 100 + index, text: `Filler Event ${index} #10 $100 Result`, cells: [`Filler Event ${index}`, "#10", "$100"], headers: ["Event", "Rank", "Earnings"], resultUrl: `https://example.test/filler-${index}`, hasResultControl: true });
    event.date = `Feb ${String((index % 28) + 1).padStart(2, "0")} 2025`;
    return event;
  });
  const tonyLikeLateFinalTable = normalizeEvent({ rowIndex: 200, text: "Late FT #9 $30,895 Result", cells: ["Late FT", "#9", "$30,895"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/late-ft", hasResultControl: true });
  tonyLikeLateFinalTable.date = "Mar 01 2025";
  const tonyLikeComparisonEvents = [...tonyLikeBaseEvents, ...tonyLikeFillers];
  const tonyLikeAllEvents = [...tonyLikeComparisonEvents, tonyLikeLateFinalTable];
  const tonyLikeCalculated = calculateSummaryFromEvents(tonyLikeComparisonEvents, parseSummary("Title 0 Bracelets 0 Rings 0 Final Tables 10 Cashes 83 Total Earnings $0"), tonyLikeAllEvents);
  if (tonyLikeCalculated.cashes !== 83 || tonyLikeCalculated.finalTables !== 10) {
    throw new Error("Summary count metrics should consider full deduped ALL rows when duplicates push a legitimate count row outside the Cashes slice");
  }
  const originalFinalTableEvent = normalizeEvent({ rowIndex: 4, text: "Original label #9 $10,000 Result", cells: ["Original label", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/original", hasResultControl: true });
  originalFinalTableEvent.date = "Jan 01 2024";
  const duplicateEvent = normalizeEvent({ rowIndex: 5, text: "Alternate label #9 $10,000 Result", cells: ["Alternate label", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: null, hasResultControl: true });
  duplicateEvent.date = "Jan 01 2024";
  const pauliusLikeEvents = [events[0], events[1], originalFinalTableEvent, duplicateEvent, events[3], skippedBraceletWin];
  const deduped = deduplicateComparisonEvents(pauliusLikeEvents);
  const dedupedSplit = splitEventsByExpectedCashes(deduped.uniqueEvents, parseSummary("Title 1 Bracelets 1 Rings 0 Final Tables 3 Cashes 5 Total Earnings $177,345"));
  const dedupedCalculated = calculateFromEvents(dedupedSplit.comparisonEvents);
  if (deduped.duplicateEvents.length !== 1 || dedupedCalculated.titles !== 3 || dedupedCalculated.finalTables !== 4 || dedupedCalculated.cashes !== 5) {
    throw new Error("Duplicate event rows should be removed before applying profile Cashes overflow");
  }
  const sameDateRankPrizeA = normalizeEvent({ rowIndex: 10, text: "Distinct Event A #9 $10,000 Result", cells: ["Distinct Event A", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/a", hasResultControl: true });
  sameDateRankPrizeA.date = "Jan 01 2024";
  const sameDateRankPrizeB = normalizeEvent({ rowIndex: 11, text: "Distinct Event B #9 $10,000 Result", cells: ["Distinct Event B", "#9", "$10,000"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/b", hasResultControl: true });
  sameDateRankPrizeB.date = "Jan 01 2024";
  const distinctSamePrizeEvents = deduplicateComparisonEvents([sameDateRankPrizeA, sameDateRankPrizeB]);
  if (distinctSamePrizeEvents.uniqueEvents.length !== 2 || distinctSamePrizeEvents.duplicateEvents.length !== 0) {
    throw new Error("Distinct events with the same date, rank, and earnings should not be deduplicated");
  }
  const firstVisibleWindow = [
    normalizeEvent({ rowIndex: 1, text: "Window A #1 $100 Result", cells: ["Window A", "#1", "$100"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/window-a", hasResultControl: true }),
    normalizeEvent({ rowIndex: 2, text: "Window B #2 $200 Result", cells: ["Window B", "#2", "$200"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/window-b", hasResultControl: true })
  ];
  const secondVisibleWindow = [
    normalizeEvent({ rowIndex: 1, text: "Window C #3 $300 Result", cells: ["Window C", "#3", "$300"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/window-c", hasResultControl: true }),
    normalizeEvent({ rowIndex: 2, text: "Window D #4 $400 Result", cells: ["Window D", "#4", "$400"], headers: ["Event", "Rank", "Earnings"], resultUrl: "https://example.test/window-d", hasResultControl: true })
  ];
  const windowMerge = mergeVisibleEventRows(firstVisibleWindow, secondVisibleWindow);
  if (windowMerge.events.length !== 4 || windowMerge.added !== 2) {
    throw new Error("Visible event windows should be accumulated when Load More replaces rows");
  }
  const earningsComparison = compareSummary({ totalEarnings: 100 }, { totalEarnings: 200 }).find((item) => item.key === "totalEarnings");
  if (earningsComparison?.status !== "warn" || buildDefects({ name: "Sample", url: "https://example.test/player", comparisons: [earningsComparison] }).length) {
    throw new Error("Total Earnings mismatch should warn without creating a failure defect");
  }
  const titleTabBackedComparison = reconcileSummaryComparisons(
    compareSummary({ titles: 13 }, { titles: 12 }),
    [{ key: "titles", label: "Title", expected: 13, actual: 13, selectedTab: "TITLES", status: "pass" }],
    {}
  ).find((item) => item.key === "titles");
  if (titleTabBackedComparison?.status !== "pass" || titleTabBackedComparison.source !== "profile-tab" || titleTabBackedComparison.allCalculated !== 12) {
    throw new Error("Title summary comparison should prefer the profile tab count over ALL-tab false positives");
  }
  const failedTabShouldNotOverrideAllComparison = reconcileSummaryComparisons(
    compareSummary({ finalTables: 5 }, { finalTables: 5 }),
    [{ key: "finalTables", label: "Final Tables", expected: 5, actual: 0, selectedTab: "FINAL TABLES", status: "fail" }],
    {}
  ).find((item) => item.key === "finalTables");
  if (failedTabShouldNotOverrideAllComparison?.status !== "pass" || failedTabShouldNotOverrideAllComparison.source !== "all-tab" || failedTabShouldNotOverrideAllComparison.calculated !== 5) {
    throw new Error("Failed profile tab counts should not overwrite matching ALL-tab summary calculations");
  }
  const incompleteCashesComparison = reconcileSummaryComparisons(
    compareSummary({ cashes: 248 }, { cashes: 247 }),
    [],
    { expectedCashes: 248, reachedExpectedCashes: false, finalEventCount: 247 }
  ).find((item) => item.key === "cashes");
  if (incompleteCashesComparison?.status !== "warn" || buildDefects({ name: "Incomplete Cashes", url: "https://example.test/cashes", comparisons: [incompleteCashesComparison], tabChecks: [], events: [] }).length) {
    throw new Error("Incomplete ALL-tab Cashes collection should warn without creating a failure defect");
  }
  const braceletBadgeMismatch = compareSummary({ bracelets: 3 }, { bracelets: 3 }, { bracelets: 2, rings: 0 }).find((item) => item.key === "bracelets");
  if (braceletBadgeMismatch?.status !== "fail" || !buildDefects({ name: "Bracelet Mismatch", url: "https://example.test/bracelet", comparisons: [braceletBadgeMismatch], tabChecks: [], events: [] }).length) {
    throw new Error("Bracelet badge mismatch should fail against the profile summary value");
  }
  const standingsEarningsSource = buildStandingMetricSource("All-Time Earnings - Men", "1 Alex Kulev Bulgaria $12,361,923");
  if (standingsEarningsSource.metricValue !== 12361923 || standingsEarningsSource.metricKey !== "totalEarnings") {
    throw new Error("All-Time Earnings standings row should extract Total Earnings");
  }
  const standingsBraceletsSource = {
    category: "All-Time Bracelets",
    rank: 1,
    name: "Phil Hellmuth",
    rowText: "1 Phil Hellmuth United States 17",
    brand: "WSOP",
    sourceUrl: "https://example.test/standings",
    ...buildStandingMetricSource("All-Time Bracelets", "1 Phil Hellmuth United States 17")
  };
  const standingsChecks = compareStandingsSourcesToSummary([standingsBraceletsSource], { bracelets: 16 });
  const standingsDefect = buildDefects({ name: "Phil Hellmuth", url: "https://example.test/player", standingsSources: [standingsBraceletsSource], standingsChecks, comparisons: [], tabChecks: [], events: [] })[0];
  if (standingsChecks[0]?.status !== "fail" || standingsDefect?.type !== "Standings/profile summary mismatch") {
    throw new Error("Standings/profile metric mismatches should create a failure defect");
  }
  const warningOnlyPlayer = { name: "Warn Sample", url: "https://example.test/warn", comparisons: [earningsComparison], tabChecks: [], events: [], defects: [] };
  warningOnlyPlayer.status = playerStatus(warningOnlyPlayer);
  if (warningOnlyPlayer.status !== "warn") {
    throw new Error("Total Earnings mismatch should set player status to warn");
  }
  const incompleteSummaryPlayer = {
    name: "Incomplete Summary Sample",
    url: "https://example.test/incomplete",
    comparisons: [{ key: "cashes", label: "Cashes", top: 10, calculated: 8, status: "fail" }],
    tabChecks: [],
    events: [{}, {}, {}, {}, {}, {}, {}, {}],
    expansion: { expectedCashes: 10, reachedExpectedCashes: false, finalEventCount: 8, loadMoreClicks: 2, stoppedReason: "load-more-not-found" },
    defects: []
  };
  const incompleteDefect = buildDefects(incompleteSummaryPlayer)[0];
  if (!incompleteDefect?.detail.includes("ALL tab collection incomplete")) {
    throw new Error("Incomplete ALL collection context should be included in profile summary mismatch details");
  }
  const crawlerWarningOnlyPlayer = {
    name: "Crawler Warning Sample",
    url: "https://example.test/crawler-warning",
    comparisons: [],
    tabChecks: [],
    events: [{ eventName: "Skipped Result Sample", resultSkipped: "Result detail check skipped", resultUrl: "https://example.test/result" }],
    warnings: ["Result button disabled"],
    defects: []
  };
  crawlerWarningOnlyPlayer.status = playerStatus(crawlerWarningOnlyPlayer);
  if (crawlerWarningOnlyPlayer.status !== "warn" || buildDefects(crawlerWarningOnlyPlayer).length) {
    throw new Error("Crawler warnings should warn without creating a failure defect");
  }
  const reviewNotes = flattenReviewNotes({ players: [crawlerWarningOnlyPlayer] });
  if (reviewNotes.length !== 2 || !reviewNotes.some((note) => note.type === "Result skipped")) {
    throw new Error("Crawler warnings and skipped Results should be listed as review notes without becoming defects");
  }
  const resultUnavailablePlayer = {
    name: "Unavailable Result",
    url: "https://example.test/player",
    standingsSources: [],
    comparisons: [],
    tabChecks: [],
    events: [{
      eventName: "503 Result",
      resultUrl: "https://example.test/result",
      resultPage: {
        url: "https://example.test/result",
        status: "warn",
        resultUnavailable: true,
        resultUnavailableReason: "Result page temporarily unavailable (HTTP 503).",
        checks: { resultPageAvailable: false },
        missing: ["resultPageAvailable"]
      }
    }],
    warnings: [],
    defects: []
  };
  resultUnavailablePlayer.status = playerStatus(resultUnavailablePlayer);
  if (resultUnavailablePlayer.status !== "warn" || buildDefects(resultUnavailablePlayer).length) {
    throw new Error("Transient unavailable Result pages should warn without becoming mismatch defects");
  }
  if (!flattenReviewNotes({ players: [resultUnavailablePlayer] }).some((note) => note.type === "Result page unavailable")) {
    throw new Error("Transient unavailable Result pages should be listed as review notes");
  }
  if (!isTransientResultPageFailure("503 Service Temporarily Unavailable", "", null)) {
    throw new Error("503 Result page body should be detected as transient unavailable");
  }
  const tabChecks = PROFILE_TAB_CHECKS.map((check) => ({
    key: check.key,
    label: check.label,
    expected: summary[check.summaryKey],
    actual: summary[check.summaryKey],
    selectedTab: check.tabLabels[0],
    status: "pass",
    detail: "Self-test tab check."
  }));
  const sampleReport = { playersUrl: DEFAULT_PLAYERS_URL, players: [{ name: "Sample", url: "https://example.test/player", summary, events, expansion: {}, tabChecks, calculated, comparisons, defects: [], warnings: [], status: "pass" }] };
  const html = renderHtml(sampleReport);
  if (!html.includes("WSOP Player Standings Dashboard")) throw new Error("HTML render failed");
  if (!html.includes('comparisonValue: "Comparison Value"')) throw new Error("Summary comparison value label render failed");
  const koreanHtml = renderKoreanHtml(sampleReport);
  if (!koreanHtml.includes("WSOP 선수 순위 크롤러 대시보드")) throw new Error("Korean HTML render failed");
  const partialReport = buildCrawlerReport({
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    playersUrl: DEFAULT_PLAYERS_URL,
    playerEntries: [
      { url: "https://example.test/player-1", standingsSources: [] },
      { url: "https://example.test/player-2", standingsSources: [] }
    ],
    players: [sampleReport.players[0]],
    runStatus: "running"
  });
  if (partialReport.summary.completedPlayers !== 1 || partialReport.summary.pendingPlayers !== 1) {
    throw new Error("Partial report progress summary failed");
  }
  if (!renderHtml(partialReport).includes("1/2")) {
    throw new Error("Partial report HTML progress render failed");
  }
  const warningReport = buildCrawlerReport({
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    playersUrl: DEFAULT_PLAYERS_URL,
    playerEntries: [{ url: warningOnlyPlayer.url, standingsSources: [] }],
    players: [warningOnlyPlayer],
    runStatus: "complete"
  });
  if (warningReport.summary.status !== "warn" || warningReport.summary.warnedPlayers !== 1 || warningReport.summary.failedPlayers !== 0) {
    throw new Error("Warning-only report should have overall warn status");
  }
  console.log("Crawler self-test passed.");
}

// CLI 진입점.
// 옵션 파싱, Playwright 실행, standings 수집, 제한된 동시성의 선수 크롤링, 산출물 저장을 담당한다.
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  args.disabledResultMode = normalizeDisabledResultMode(args.disabledResultMode);

  const { chromium } = await import("playwright");
  const launchOptions = { headless: !args.headed };
  if (args.browserChannel) launchOptions.channel = args.browserChannel;

  const authWaitMs = args.authWaitMs ?? (args.headed ? 300000 : 0);
  let browser = null;
  let context = null;
  let stopRequested = false;
  let interruptedReason = "";
  let writeProgressReport = null;
  const handleStopSignal = (signal) => {
    if (stopRequested) {
      console.warn(`Second ${signal} received. Exiting immediately.`);
      process.exit(130);
    }
    stopRequested = true;
    interruptedReason = `Interrupted by ${signal}`;
    console.warn(`${interruptedReason}. No new players will start; writing partial report.`);
    if (writeProgressReport) writeProgressReport("interrupted");
  };

  try {
    if (args.userDataDir) {
      fs.mkdirSync(args.userDataDir, { recursive: true });
      context = await chromium.launchPersistentContext(args.userDataDir, launchOptions);
      browser = context.browser();
    } else {
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext();
    }
  } catch (error) {
    if (!args.browserChannel) {
      if (/Executable doesn't exist|Please run the following command|install/i.test(error.message)) {
        console.error("Playwright Chromium is not installed. Run the BAT/PowerShell wrapper, or run: node node_modules/playwright/cli.js install chromium");
      }
      throw error;
    }

    console.warn(`Could not launch browser channel "${args.browserChannel}": ${error.message}`);
    console.warn("Retrying with Playwright Chromium.");
    delete launchOptions.channel;

    if (args.userDataDir) {
      context = await chromium.launchPersistentContext(args.userDataDir, launchOptions);
      browser = context.browser();
    } else {
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext();
    }
  }

  try {
    const startedAt = new Date().toISOString();
    let playerEntries = args.playerUrls.map((url) => ({
      url,
      standingsSources: [{ category: "Manual player URL", rank: null, name: "", rowText: "", selected: false }]
    }));
    let brandOptions = null;
    if (!playerEntries.length) {
      const listPage = await context.newPage();
      try {
        brandOptions = await collectBrandOptions(listPage, args.playersUrl, authWaitMs);
        console.log(`  [크롤러] 브랜드 옵션 ${brandOptions.count}개 수집: ${brandOptions.options.join(", ") || "없음"}`);
      } catch (error) {
        brandOptions = {
          collectedAt: new Date().toISOString(),
          sourceUrl: args.playersUrl,
          count: 0,
          rawCount: 0,
          options: [],
          rawOptions: [],
          error: error.message
        };
        console.warn(`  [경고] 브랜드 옵션 목록 수집 실패: ${error.message}`);
      }
      playerEntries = await collectPlayerEntries(listPage, args.playersUrl, args.limit, authWaitMs, args.brand);
      await listPage.close().catch(() => {});
    }

    if (!playerEntries.length) throw new Error(`No player links found at ${args.playersUrl}`);

    if (args.standingsOnly) {
      const report = buildStandingsOnlyReport({
        startedAt,
        finishedAt: new Date().toISOString(),
        playersUrl: args.playersUrl,
        playerEntries,
        brandFilter: args.brand,
        brandOptions
      });
      const koreanHtml = writeReportArtifacts(args, report);

      console.log(`Standings-only JSON: ${args.out}`);
      console.log(`Standings-only HTML: ${args.html}`);
      console.log(`Standings-only Korean HTML: ${koreanHtml}`);
      console.log(`Standings-only players: ${report.players.length}`);
      console.log(`Overall: ${report.summary.status}`);
      process.exitCode = report.summary.status === "fail" ? 1 : 0;
      return;
    }

    const players = [];
    const requestedConcurrency = args.concurrency;
    const concurrency = normalizeConcurrency(requestedConcurrency);
    if (concurrency !== Math.floor(requestedConcurrency)) {
      console.warn(`  [경고] 동시성 ${requestedConcurrency}은 권장 상한 ${MAX_CONCURRENCY}을 초과하여 ${concurrency}으로 제한합니다.`);
    }
    const queue = playerEntries.map((entry, index) => ({ entry, index }));
    writeProgressReport = (runStatus = "running") => {
      const report = buildCrawlerReport({
        startedAt,
        finishedAt: new Date().toISOString(),
        playersUrl: args.playersUrl,
        playerEntries,
        players,
        runStatus,
        interruptedReason,
        brandFilter: args.brand,
        brandOptions,
        mode: args.profileOnly ? "profile-only" : "crawler"
      });
      const koreanHtml = writeReportArtifacts(args, report);
      return { report, koreanHtml };
    };
    process.on("SIGINT", handleStopSignal);
    process.on("SIGTERM", handleStopSignal);

    writeProgressReport("running");

    console.log(`[크롤러 시작] 총 ${playerEntries.length}명의 선수를 병렬 크롤링합니다. (동시성: ${concurrency})`);

    const worker = async () => {
      while (!stopRequested && queue.length > 0) {
        const { entry, index } = queue.shift();
        console.log(`  [크롤러] [${index + 1}/${playerEntries.length}] 크롤링 개시: ${entry.url}`);

        try {
          // 개별 크롤러 실행을 백오프 재시도로 안전하게 래핑
          const playerResult = await retryWithBackoff(async () => {
            const result = await crawlPlayer(
              context,
              entry.url,
              args.timeout,
              args.resultLimit,
              args.resultRankLimit,
              authWaitMs,
              args.maxLoadMore,
              args.resultPageLimit,
              args.disabledResultMode,
              args.profileOnly,
              entry.standingsSources
            );
            if (result.error) throw new Error(result.error);
            return result;
          }, 2, 2000);

          players[index] = playerResult;
          console.log(`  [크롤러] [${index + 1}/${playerEntries.length}] 크롤링 완료: ${entry.url} - 상태: ${playerResult.status}`);
          writeProgressReport(stopRequested ? "interrupted" : "running");
        } catch (error) {
          console.error(`  [오류] [${index + 1}/${playerEntries.length}] 크롤링 최종 실패: ${entry.url} - ${error.message}`);
          if (isBrowserClosedError(error)) {
            stopRequested = true;
            interruptedReason = "Browser closed before the crawler finished";
          }
          players[index] = {
            name: entry.url,
            url: entry.url,
            standingsSources: entry.standingsSources,
            summary: {},
            events: [],
            calculated: {},
            comparisons: [],
            warnings: [`Crawl error: ${error.message}`],
            defects: [],
            status: "fail",
            error: error.message
          };
          writeProgressReport(stopRequested ? "interrupted" : "running");
        }
      }
    };

    // 설정된 동시성 크기만큼 워커 구동
    const workerPromises = Array.from({ length: Math.min(concurrency, playerEntries.length) }, worker);
    await Promise.all(workerPromises);

    const { report, koreanHtml } = writeProgressReport(stopRequested ? "interrupted" : "complete");

    console.log(`Crawler JSON: ${args.out}`);
    console.log(`Crawler HTML: ${args.html}`);
    console.log(`Crawler Korean HTML: ${koreanHtml}`);
    console.log(`Defect CSV: ${args.defects}`);
    console.log(`Overall: ${report.summary.status}`);
    if (stopRequested) process.exitCode = 130;
    else if (report.summary.status !== "pass") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", handleStopSignal);
    process.removeListener("SIGTERM", handleStopSignal);
    if (context) await context.close().catch(() => {});
    else if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  if (isBrowserClosedError(error)) {
    console.error("The browser closed before the crawler finished. Keep the browser window open until the report is generated, and rerun the BAT file.");
    console.error("If this happens without closing the browser manually, rerun after the wrapper installs Playwright Chromium or pass --browser-channel none.");
  }
  console.error(error);
  process.exitCode = 1;
});
