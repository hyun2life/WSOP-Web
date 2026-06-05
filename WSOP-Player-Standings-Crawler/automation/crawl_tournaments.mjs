import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

// WSOP Tournament-Centric Crawler & Validator
//
// execution flow:
// 1. Visit past tournaments page for a specific year (e.g. /past-tournaments/2026/)
// 2. Select/click brand filter if specified
// 3. Crawl cards: Image, Brand, Series Name, Dates, Venue/Location, Country Flag
// 4. Navigate into detail page:
//    - Compare card metadata with detail visual header (.kv-contents) [Scenario 1]
//    - Classify event list by actual Result link presence:
//      Case A (with Results) or Case B (no Result links)
//    - Case A: Extract event row details + click Payout/Result link -> Cross-check Entries, Prize, Winner [Scenario 2]
//    - Case B: Extract schedule rows -> Validate formats of Buy-in, Chips, Clock, Late Reg. [Scenario 3]
// 5. Generate JSON, Korean HTML Dashboard, and Defects CSV

const DEFAULT_YEAR = "2026";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;
const DEFAULT_OUT_PATH = "automation/output/wsop-tournament-crawler-data.json";
const DEFAULT_HTML_PATH = "automation/output/wsop-tournament-crawler-report.html";
const DEFAULT_DEFECTS_PATH = "automation/output/wsop-tournament-crawler-defects.csv";
const DEFAULT_CSV_PATH = "automation/output/wsop-tournament-crawler-events.csv";
const RESULT_LINK_SELECTOR = "a[href*='/tournaments/result'], a[href*='/tournaments/results']";

// Helper utilities
function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
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

function formatValue(label, value) {
  if (value === null || value === undefined || value === "") return "-";
  if (/prize|buy-in|earnings/i.test(label)) {
    const num = Number(value);
    return Number.isFinite(num) ? `$${num.toLocaleString("en-US")}` : String(value);
  }
  return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
}

function formatStatus(status) {
  return {
    pass: "통과",
    fail: "실패",
    warn: "주의",
    minor: "경미",
    skipped: "제외"
  }[status] || status || "-";
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

const MONTH_INDEX = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

function utcDay(year, monthIndex, day) {
  return Math.floor(Date.UTC(year, monthIndex, day) / 86400000);
}

function parseMonthDay(value, fallbackYear, fallbackMonthIndex = null) {
  const text = normalizeText(value).replace(/\b\d{4}\b/g, " ");
  const monthMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  const monthIndex = monthMatch ? MONTH_INDEX[monthMatch[1].toLowerCase()] : fallbackMonthIndex;
  const dayMatches = [...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/gi)]
    .map(match => Number(match[1]))
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 31);
  const day = dayMatches[0];
  if (monthIndex === null || monthIndex === undefined || !day || !Number.isFinite(Number(fallbackYear))) return null;
  const year = Number(fallbackYear);
  return { year, monthIndex, day, dayNumber: utcDay(year, monthIndex, day) };
}

function parseTournamentDateRange(dateRange, fallbackYear) {
  return parseDateRange(dateRange, fallbackYear);
}

function parseDateRange(value, fallbackYear, fallbackMonthIndex = null) {
  const text = normalizeText(value);
  const yearMatches = text.match(/\b(20\d{2}|19\d{2})\b/g);
  const rangeYear = yearMatches ? Number(yearMatches[yearMatches.length - 1]) : Number(fallbackYear);
  if (!Number.isFinite(rangeYear)) return null;

  const parts = text.split(/\s*(?:~|-|–|—|\bto\b)\s*/i).map(part => normalizeText(part)).filter(Boolean);
  if (parts.length < 2) {
    const single = parseMonthDay(text, rangeYear, fallbackMonthIndex);
    return single ? { start: single, end: single } : null;
  }

  const start = parseMonthDay(parts[0], rangeYear, fallbackMonthIndex);
  const end = parseMonthDay(parts.slice(1).join(" - "), rangeYear, start?.monthIndex ?? fallbackMonthIndex);
  if (!start || !end) return null;

  let endDayNumber = end.dayNumber;
  let endYear = end.year;
  if (start.dayNumber > end.dayNumber) {
    endYear = end.year + 1;
    endDayNumber = utcDay(endYear, end.monthIndex, end.day);
  }

  return {
    start,
    end: { ...end, year: endYear, dayNumber: endDayNumber }
  };
}

function validateEventDateInTournamentRange(eventDate, tournamentDateRange, fallbackYear) {
  if (!eventDate) return { status: "fail", errors: ["Missing Date"], warnings: [] };

  const range = parseTournamentDateRange(tournamentDateRange, fallbackYear);
  if (!range) {
    return { status: "warn", errors: [], warnings: [`Tournament date range could not be parsed: ${tournamentDateRange || "-"}`] };
  }

  const eventRange = parseDateRange(eventDate, range.start.year, range.start.monthIndex);
  if (!eventRange) {
    return { status: "fail", errors: [`Event Date could not be parsed: ${eventDate}`], warnings: [] };
  }

  const tournamentCrossesYear = range.end.dayNumber > range.start.dayNumber && range.end.monthIndex < range.start.monthIndex;
  let eventStartDayNumber = eventRange.start.dayNumber;
  let eventEndDayNumber = eventRange.end.dayNumber;
  if (tournamentCrossesYear && eventEndDayNumber < range.start.dayNumber && eventRange.start.monthIndex <= range.end.monthIndex) {
    eventStartDayNumber = utcDay(eventRange.start.year + 1, eventRange.start.monthIndex, eventRange.start.day);
    eventEndDayNumber = utcDay(eventRange.end.year + 1, eventRange.end.monthIndex, eventRange.end.day);
  }

  const overlapsTournamentRange = eventStartDayNumber <= range.end.dayNumber && eventEndDayNumber >= range.start.dayNumber;
  if (overlapsTournamentRange) {
    return { status: "pass", errors: [], warnings: [] };
  }

  const daysBeforeRange = range.start.dayNumber - eventEndDayNumber;
  const daysAfterRange = eventStartDayNumber - range.end.dayNumber;
  if (daysBeforeRange === 1 || daysAfterRange === 1) {
    return {
      status: "warn",
      errors: [],
      warnings: [`Event Date is one day outside tournament range: ${eventDate} not within ${tournamentDateRange}`]
    };
  }

  return {
    status: "fail",
    errors: [`Event Date out of tournament range: ${eventDate} not within ${tournamentDateRange}`],
    warnings: []
  };
}

function isDashPlaceholder(value) {
  return /^[-–—]+$/.test(normalizeText(value));
}

function isOnlineScheduleEvent(event) {
  return /online|flight\s+[a-z]/i.test(`${event.eventName || ""} ${event.lateRegText || ""}`);
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

// Argument Parser
function parseArgs(argv) {
  const args = {
    year: DEFAULT_YEAR,
    brand: null,
    concurrency: DEFAULT_CONCURRENCY,
    headed: false,
    out: DEFAULT_OUT_PATH,
    html: DEFAULT_HTML_PATH,
    defects: DEFAULT_DEFECTS_PATH,
    csv: DEFAULT_CSV_PATH,
    outputPathOverrides: { out: false, html: false, defects: false, csv: false },
    selfTest: false,
    limit: 0,
    eventLimit: 0,
    resultLimit: 0,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--year") args.year = argv[++i];
    else if (arg === "--brand") args.brand = argv[++i];
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--event-limit") {
      args.eventLimit = Number(argv[++i]);
      args.resultLimit = args.eventLimit;
    }
    else if (arg === "--result-limit") {
      args.resultLimit = Number(argv[++i]);
      args.eventLimit = args.resultLimit;
    }
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--self-test") args.selfTest = true;
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
    else if (arg === "--csv") {
      args.csv = argv[++i];
      args.outputPathOverrides.csv = true;
    }
  }

  // Auto timestamp overrides
  if (!args.selfTest) {
    const stamp = formatRunTimestamp();
    const brandSuffix = args.brand ? `-${args.brand.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
    const yearTag = args.year.toLowerCase().replace(/[^a-z0-9-]/g, "_");
    const tag = `wsop-tournament-crawler-${yearTag}${brandSuffix}-${stamp}`;
    if (!args.outputPathOverrides.out) args.out = `automation/output/${tag}-data.json`;
    if (!args.outputPathOverrides.html) args.html = `automation/output/${tag}-report.html`;
    if (!args.outputPathOverrides.defects) args.defects = `automation/output/${tag}-defects.csv`;
    if (!args.outputPathOverrides.csv) args.csv = `automation/output/${tag}-events.csv`;
  }

  return args;
}

// -------------------------------------------------------------
// Core Verification Logics
// -------------------------------------------------------------

function verifyHeader(card, headerLines) {
  // Compare card values vs detail header lines
  const errors = [];

  const cardBrandNorm = normalizeComparable(card.brand);
  const cardSeriesNorm = normalizeComparable(card.seriesName);
  const cardDatesNorm = normalizeComparable(card.dateRange);
  const cardLocationNorm = normalizeComparable(card.location);
  const cardCountryNorm = normalizeComparable(card.country);

  const headBrandNorm = headerLines[0] ? normalizeComparable(headerLines[0]) : "";
  const headSeriesNorm = headerLines[1] ? normalizeComparable(headerLines[1]) : "";
  const headDatesNorm = headerLines[2] ? normalizeComparable(headerLines[2]) : "";
  const headLocationNorm = headerLines[3] ? normalizeComparable(headerLines[3]) : "";
  const headCountryNorm = headerLines[4] ? normalizeComparable(headerLines[4]) : "";

  if (cardBrandNorm && headBrandNorm && !headBrandNorm.includes(cardBrandNorm) && !cardBrandNorm.includes(headBrandNorm)) {
    errors.push(`Brand mismatch: card="${card.brand}", header="${headerLines[0] ?? ""}"`);
  }
  if (cardSeriesNorm && headSeriesNorm && !headSeriesNorm.includes(cardSeriesNorm) && !cardSeriesNorm.includes(headSeriesNorm)) {
    errors.push(`Series Name mismatch: card="${card.seriesName}", header="${headerLines[1] ?? ""}"`);
  }
  if (cardDatesNorm && headDatesNorm && !headDatesNorm.includes(cardDatesNorm) && !cardDatesNorm.includes(headDatesNorm)) {
    errors.push(`Dates mismatch: card="${card.dateRange}", header="${headerLines[2] ?? ""}"`);
  }
  if (cardLocationNorm && headLocationNorm && !headLocationNorm.includes(cardLocationNorm) && !cardLocationNorm.includes(headLocationNorm)) {
    errors.push(`Location mismatch: card="${card.location}", header="${headerLines[3] ?? ""}"`);
  }
  if (cardCountryNorm && headCountryNorm && !headCountryNorm.includes(cardCountryNorm) && !cardCountryNorm.includes(headCountryNorm)) {
    errors.push(`Country mismatch: card="${card.country}", header="${headerLines[4] ?? ""}"`);
  }

  return {
    status: errors.length > 0 ? "fail" : "pass",
    errors
  };
}

function validationStatus(errors, warnings) {
  if (errors.length > 0) return "fail";
  if (warnings.length > 0) return "warn";
  return "pass";
}

function classifyTournamentEventMode(hasResultLink) {
  return hasResultLink ? "Case A (Results)" : "Case B (Schedule)";
}

function validateCaseBEvent(event, tournament = {}) {
  // Validate fields for schedule: Date, Event, Buy-in, Chips, Clock, Late Reg
  const errors = [];
  const warnings = [];
  const dateCheck = validateEventDateInTournamentRange(event.date, tournament.dateRange, tournament.year);
  errors.push(...dateCheck.errors);
  warnings.push(...dateCheck.warnings);
  if (!event.eventName) errors.push("Missing Event Name");
  if (event.buyIn === null || event.buyIn === undefined) errors.push("Invalid or missing Buy-in");

  const onlineEvent = isOnlineScheduleEvent(event);
  if (event.chips === null || event.chips === undefined || event.chips <= 0) {
    if (onlineEvent && isDashPlaceholder(event.chipsText)) {
      warnings.push(`Online/Flight event has no Chips value: ${event.chipsText || "-"}`);
    } else {
      errors.push(`Invalid Chips: ${event.chipsText}`);
    }
  }
  if (event.clock === null || event.clock === undefined || event.clock <= 0) {
    if (onlineEvent && isDashPlaceholder(event.clockText)) {
      warnings.push(`Online/Flight event has no Clock value: ${event.clockText || "-"}`);
    } else {
      errors.push(`Invalid Clock: ${event.clockText}`);
    }
  }

  return {
    status: validationStatus(errors, warnings),
    errors,
    warnings
  };
}

function validateCaseAEvent(event, tournament = {}) {
  // Validate fields for results list: Date, Event, Buy-in, Entries, ITM, Prize, Winner
  const errors = [];
  const warnings = [];
  const dateCheck = validateEventDateInTournamentRange(event.date, tournament.dateRange, tournament.year);
  errors.push(...dateCheck.errors);
  warnings.push(...dateCheck.warnings);
  if (!event.eventName) errors.push("Missing Event Name");
  if (event.buyIn === null || event.buyIn === undefined) errors.push("Invalid or missing Buy-in");
  if (event.entries === null || event.entries === undefined || event.entries <= 0) errors.push(`Invalid Entries count: ${event.entriesText}`);
  if (event.itm === null || event.itm === undefined || event.itm <= 0) errors.push(`Invalid ITM: ${event.itmText}`);
  if (event.prize === null || event.prize === undefined || event.prize <= 0) errors.push(`Invalid Prize Pool: ${event.prizeText}`);
  if (!event.winner) errors.push("Missing Winner name");
  if (!event.payoutUrl) errors.push("Missing Payout/Results Link");

  return {
    status: validationStatus(errors, warnings),
    errors,
    warnings
  };
}

function verifyPayoutDetails(event, payoutDetails) {
  const errors = [];

  if (payoutDetails.entries !== null && event.entries !== null && payoutDetails.entries !== event.entries) {
    errors.push(`Entries mismatch: list=${event.entries}, payoutDetail=${payoutDetails.entries}`);
  }
  if (payoutDetails.prize !== null && event.prize !== null && payoutDetails.prize !== event.prize) {
    errors.push(`Prize Pool mismatch: list=${event.prize}, payoutDetail=${payoutDetails.prize}`);
  }
  if (payoutDetails.winner && event.winner) {
    const listWinnerNorm = normalizeComparable(event.winner);
    const detailWinnerNorm = normalizeComparable(payoutDetails.winner);
    if (!detailWinnerNorm.includes(listWinnerNorm) && !listWinnerNorm.includes(detailWinnerNorm)) {
      errors.push(`Winner mismatch: list="${event.winner}", payoutDetail="${payoutDetails.winner}"`);
    }
  }
  if (payoutDetails.tableWinner && event.winner) {
    const listWinnerNorm = normalizeComparable(event.winner);
    const tableWinnerNorm = normalizeComparable(payoutDetails.tableWinner);
    if (!tableWinnerNorm.includes(listWinnerNorm) && !listWinnerNorm.includes(tableWinnerNorm)) {
      errors.push(`Table 1st Place Player mismatch: list="${event.winner}", tablePlayer="${payoutDetails.tableWinner}"`);
    }
  }

  return {
    status: errors.length > 0 ? "fail" : "pass",
    errors
  };
}

// -------------------------------------------------------------
// Report Generation Helpers
// -------------------------------------------------------------

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function writeCsv(filePath, defects) {
  const headers = ["type", "tournament", "event", "item", "expected", "actual", "url", "detail"];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const rows = defects.map(d => [
    d.type,
    d.tournament,
    d.event || "-",
    d.item || "-",
    d.expected || "-",
    d.actual || "-",
    d.url || "-",
    d.detail || "-"
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => csvEscape(cell)).join(","))
  ].join("\n") + "\n";

  fs.writeFileSync(filePath, csvContent, "utf8");
}

function writeEventsCsv(filePath, report) {
  const headers = [
    "runStatus",
    "year",
    "brand",
    "tournament",
    "tournamentStatus",
    "mode",
    "tournamentUrl",
    "dateRange",
    "location",
    "country",
    "headerStatus",
    "eventName",
    "eventStatus",
    "eventDate",
    "buyInText",
    "buyIn",
    "entries",
    "itm",
    "prize",
    "winner",
    "chips",
    "clock",
    "lateReg",
    "payoutUrl",
    "crossCheckStatus",
    "errors",
    "warnings",
    "crossCheckErrors"
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const summary = report.summary || {};
  const rows = [];
  for (const tournament of report.tournaments || []) {
    const base = {
      runStatus: summary.runStatus || "-",
      year: summary.year || "-",
      brand: tournament.brand || summary.brand || "-",
      tournament: tournament.seriesName || "-",
      tournamentStatus: tournament.status || "-",
      mode: tournament.mode || "-",
      tournamentUrl: tournament.url || "-",
      dateRange: tournament.dateRange || "-",
      location: tournament.location || "-",
      country: tournament.country || tournament.countryDisplay || "-",
      headerStatus: tournament.headerCheck?.status || "-"
    };
    const events = tournament.events && tournament.events.length > 0 ? tournament.events : [null];
    for (const event of events) {
      rows.push([
        base.runStatus,
        base.year,
        base.brand,
        base.tournament,
        base.tournamentStatus,
        base.mode,
        base.tournamentUrl,
        base.dateRange,
        base.location,
        base.country,
        base.headerStatus,
        event?.eventName || "-",
        event?.status || "-",
        event?.date || "-",
        event?.buyInText || "-",
        event?.buyIn ?? "-",
        event?.entries ?? "-",
        event?.itm ?? "-",
        event?.prize ?? "-",
        event?.winner || "-",
        event?.chips ?? "-",
        event?.clock ?? "-",
        event?.lateRegText || "-",
        event?.payoutUrl || "-",
        event?.crossCheck?.status || "-",
        (event?.errors || []).join(" | "),
        (event?.warnings || []).join(" | "),
        (event?.crossCheck?.errors || []).join(" | ")
      ]);
    }
  }

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => csvEscape(cell)).join(","))
  ].join("\n") + "\n";

  fs.writeFileSync(filePath, csvContent, "utf8");
}

function getPastHtmlReports(htmlReportPath, isKo = false) {
  try {
    const dir = path.dirname(htmlReportPath);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir);
    const reportFiles = files.filter(f => {
      if (!f.startsWith("wsop-tournament-crawler-")) return false;
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

function koreanHtmlPath(htmlPath) {
  const parsed = path.parse(htmlPath);
  return path.join(parsed.dir, `${parsed.name}-ko${parsed.ext || ".html"}`);
}

function eventsCsvPath(outPath) {
  const parsed = path.parse(outPath || DEFAULT_OUT_PATH);
  const baseName = parsed.name.endsWith("-data") ? parsed.name.slice(0, -5) : parsed.name;
  return path.join(parsed.dir || path.dirname(DEFAULT_CSV_PATH), `${baseName}-events.csv`);
}

function writeReportArtifacts(args, report) {
  if (!args.csv) args.csv = eventsCsvPath(args.out);
  writeJson(args.out, report);
  fs.mkdirSync(path.dirname(args.html), { recursive: true });

  const pastEnglishReports = getPastHtmlReports(args.html, false);
  const pastKoreanReports = getPastHtmlReports(args.html, true);

  fs.writeFileSync(args.html, renderHtml(report, pastEnglishReports), "utf8");
  const koreanHtml = koreanHtmlPath(args.html);
  fs.writeFileSync(koreanHtml, renderKoreanHtml(report, pastKoreanReports), "utf8");

  const allDefects = [];
  (report.tournaments || []).forEach(t => {
    t.defects.forEach(d => {
      allDefects.push({ ...d, tournament: t.seriesName, url: t.url });
    });
  });
  writeCsv(args.defects, allDefects);
  writeEventsCsv(args.csv, report);

  return koreanHtml;
}

function buildTournamentReport({
  args,
  startedAt,
  finishedAt,
  targetCards,
  tournamentsResult,
  passedCount,
  failedCount,
  totalDefectsCount,
  runStatus = "complete",
  interruptedReason = ""
}) {
  const totalTournaments = targetCards.length;
  const completedTournaments = tournamentsResult.length;
  const warnedTournaments = tournamentsResult.filter(t => t?.status === "warn").length;
  return {
    summary: {
      year: args.year,
      brand: args.brand,
      eventLimit: args.eventLimit,
      resultLimit: args.resultLimit,
      sourceUrl: "https://www.wsop.com/",
      startedAt,
      finishedAt,
      runStatus,
      interruptedReason,
      totalTournaments,
      completedTournaments,
      pendingTournaments: Math.max(0, totalTournaments - completedTournaments),
      passedTournaments: passedCount,
      warnedTournaments,
      failedTournaments: failedCount,
      totalDefects: totalDefectsCount
    },
    tournaments: tournamentsResult.filter(Boolean)
  };
}

function renderHtml(report, pastReports = []) {
  return renderDashboardTemplate(report, false, pastReports);
}

function renderKoreanHtml(report, pastReports = []) {
  return renderDashboardTemplate(report, true, pastReports);
}

function renderDashboardTemplate(report, isKo, pastReports = []) {
  const summary = report.summary;
  const eventLimit = summary.eventLimit ?? summary.resultLimit ?? 0;
  const runStatus = summary.runStatus || "complete";
  const warnedTournaments = summary.warnedTournaments ?? (report.tournaments || []).filter(t => t.status === "warn").length;
  const reportStatus = summary.failedTournaments > 0 ? "fail" : (warnedTournaments > 0 || runStatus !== "complete" ? "warn" : "pass");
  const completedTournaments = summary.completedTournaments ?? (report.tournaments || []).length;
  const totalTournaments = summary.totalTournaments ?? completedTournaments;
  const tList = report.tournaments || [];

  const allDefects = [];
  tList.forEach(t => {
    (t.defects || []).forEach(d => {
      allDefects.push({ ...d, tournamentName: t.seriesName, url: t.url, brand: t.brand });
    });
  });

  const totalChecked = tList.length || 1;
  const passPercent = Math.round((summary.passedTournaments / totalChecked) * 100);

  const t = {
    title: isKo ? "WSOP 토너먼트 크롤러 대시보드" : "WSOP Tournament Crawler Dashboard",
    generated: isKo ? "생성 시간" : "Generated",
    source: isKo ? "대상 사이트" : "Source",
    runStatus: isKo ? "실행 상태" : "Run Status",
    tournamentsChecked: isKo ? "확인한 대회" : "Tournaments Checked",
    eventsCrawled: isKo ? "이벤트 수집" : "Events Crawled",
    defectCandidates: isKo ? "결함 후보" : "Defect Candidates",
    validationRules: isKo ? "검증 규칙 및 기준" : "Validation Rules",
    ruleItem: isKo ? "항목" : "Item",
    ruleRule: isKo ? "규칙" : "Rule",
    defectList: isKo ? "결함 후보 목록" : "Defect Candidates List",
    tournamentsDetail: isKo ? "대회별 검증 디렉토리" : "Tournaments Detail",
    searchPlaceholder: isKo ? "대회 이름으로 검색..." : "Search tournaments by name...",
    filterAll: isKo ? "전체" : "All",
    filterPass: isKo ? "통과" : "Pass",
    filterFail: isKo ? "실패" : "Fail",
    filterWarn: isKo ? "주의" : "Warn",
    noDefects: isKo ? "발견된 결함 후보가 없습니다." : "No defect candidates found.",
    statusText: isKo ? "상태" : "Status",
    detailText: isKo ? "상세 정보" : "Detail",
    seriesEvent: isKo ? "이벤트명" : "Event",
    dateText: isKo ? "일자" : "Date",
    rankText: isKo ? "순위" : "Rank",
    earningsText: isKo ? "상금" : "Earnings",
    resultUrlText: isKo ? "Result URL" : "Result URL",
    resultCheckText: isKo ? "교차 검증" : "Cross Check",
    finalFindingText: isKo ? "최종 확인 내용" : "Final Finding",
    searchEventsPlaceholder: isKo ? "이벤트명 검색..." : "Search events...",
    rulesData: isKo ? [
      ["시나리오 1: 헤더 검증", "과거 대회 목록 카드 정보(브랜드, 시리즈명, 시간, 장소, 국가)와 대회 상세 페이지 상단 비주얼 영역(.kv-contents)의 데이터를 1:1로 비교합니다. 불일치 시 Fail 판정합니다."],
      ["시나리오 2: Case A (Result 있음)", "이벤트 테이블 안에 Result/Payout 링크가 존재하면 Case A로 분류합니다. Date, Event, Buy-in, Entries, ITM, Prize, Winner 데이터를 수집하고, 이벤트 Date가 대회 기간 안에 포함되는지 검증합니다. Payout 페이지로 이동하여 실제 총참가자 수(Entries), 총상금(Prize Pool), 우승자(Winner)와 1:1 대조 교차 검증을 수행합니다."],
      ["시나리오 3: Case B (Result 없음)", "이벤트 테이블 안에 Result/Payout 링크가 없으면 Case B로 분류합니다. 이벤트의 Date, Event, Buy-in, Chips, Clock, Late Reg. 정보를 수집하며, 이벤트 Date가 대회 기간 안에 포함되는지와 필수 필드 포맷을 검증합니다. 일반 오프라인 일정은 Chips/Clock이 양수여야 하며, Online/Flight 이벤트에서 Chips/Clock이 '-'인 경우는 Fail이 아닌 Warn으로 처리합니다."]
    ] : [
      ["Scenario 1: Header Check", "Compares listing card data (Brand, Series Name, Dates, Venue, Country) with detail page visual header layout (.kv-contents) 1:1. Reports defects on mismatch."],
      ["Scenario 2: Case A (Result exists)", "Classifies the event table as Case A when a Result/Payout link exists. Collects Event, Date, Buy-in, Entries, ITM, Prize, Winner, and validates that each event Date falls within the tournament date range. Navigates to the detailed Results/Payout page and cross-checks Entries, Prize Pool, and Winner with collected rows."],
      ["Scenario 3: Case B (No Result)", "Classifies the event table as Case B when no Result/Payout link exists. Collects Event, Date, Buy-in, Chips, Clock, Late Reg, and validates that each event Date falls within the tournament date range. Offline schedule rows require positive Chips/Clock values; Online/Flight rows with '-' Chips/Clock are reported as Warn instead of Fail."]
    ]
  };

  const reportJson = JSON.stringify(report).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  return `<!doctype html>
<html lang="${isKo ? "ko" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(t.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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
    .status-badge.skipped { background-color: rgba(148, 163, 184, 0.08); color: var(--text-muted); }
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
    .radial-chart-fallback circle.fg { stroke: var(--success); stroke-linecap: round; }
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
    .arrow-icon { width: 22px; height: 22px; fill: var(--text-muted); transition: transform 0.3s ease-out; pointer-events: none; }

    .accordion-content { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
    .accordion-content.open { grid-template-rows: 1fr; }
    .accordion-inner { overflow: hidden; }
    .player-body-wrapper { padding: 0 28px 28px; border-top: 1px solid var(--border); margin-top: 0; }

    .grid-2col { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 25px; margin-bottom: 30px; }

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
    .scroll-top-btn svg { width: 20px; height: 20px; fill: white; }

    .pagination-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
    .mini-btn { background: var(--bg-input); border: var(--card-border); color: var(--text-main); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; }
    .mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .group-card { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; }
    .group-header { padding: 18px 24px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(0, 0, 0, 0.15); }
    .group-header:hover { background-color: rgba(255, 255, 255, 0.02); }
    .group-header-left { display: flex; align-items: center; gap: 15px; }
    .item-count-badge { background: var(--bg-input); border: var(--card-border); color: var(--text-muted); font-size: 11px; padding: 3px 10px; border-radius: 99px; font-weight: 700; }
    .group-arrow-icon { width: 20px; height: 20px; fill: var(--text-muted); transition: transform 0.3s; }
    .group-body, .nested-group-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.3s; }
    .group-body.collapsed, .nested-group-body.collapsed { grid-template-rows: 0fr; }
    .group-body-inner { overflow: hidden; }

    .brand-badge { background-color: #312e81; color: #c7d2fe; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 9999px; display: inline-block; }
  </style>
</head>
<body>
  <header>
    <div class="header-content">
      <div class="header-title">
        <div class="eyebrow">${isKo ? "WSOP 토너먼트 크롤러" : "WSOP TOURNAMENT CRAWLER"}</div>
        <h1>${escapeHtml(t.title)}</h1>
        <p>${escapeHtml(t.generated)}: ${escapeHtml(new Date().toLocaleString())} | ${escapeHtml(t.source)}: <a href="${escapeHtml(summary.sourceUrl || 'https://www.wsop.com/')}" target="_blank" style="color: var(--primary); text-decoration: underline;">${escapeHtml(summary.sourceUrl || 'https://www.wsop.com/')}</a> | ${escapeHtml(t.runStatus)}: <span class="status-badge ${reportStatus}">${escapeHtml(runStatus)}${summary.interruptedReason ? ` (${escapeHtml(summary.interruptedReason)})` : ""}</span></p>
      </div>
      <div class="header-actions">
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
        <span class="status-badge ${reportStatus}">${escapeHtml(runStatus)}</span>
      </div>
    </div>
  </header>

  <main>
    <div class="dashboard-grid">
      <div class="kpi-card" onclick="filterByStatus('all')">
        <div class="kpi-label">${escapeHtml(t.tournamentsChecked)}</div>
        <div class="kpi-value">${completedTournaments}/${totalTournaments}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('pass')">
        <div class="kpi-label">${isKo ? "통과한 대회" : "Passed"}</div>
        <div class="kpi-value" style="color: var(--success);">${summary.passedTournaments}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('warn')">
        <div class="kpi-label">${isKo ? "주의 대회" : "Warned"}</div>
        <div class="kpi-value" style="color: var(--warning);">${warnedTournaments}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('fail')">
        <div class="kpi-label">${isKo ? "실패한 대회" : "Failed"}</div>
        <div class="kpi-value" style="color: var(--danger);">${summary.failedTournaments}</div>
      </div>
      <div class="kpi-card" onclick="filterByStatus('fail')">
        <div class="kpi-label">${escapeHtml(t.defectCandidates)}</div>
        <div class="kpi-value" style="color: ${summary.totalDefects > 0 ? "var(--danger)" : "inherit"};">${summary.totalDefects}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${isKo ? "실행 연도" : "Target Year"}</div>
        <div class="kpi-value" style="font-size:16px; word-break:break-all; white-space:normal; line-height:1.3;">${escapeHtml(summary.year.replace(/[|_]/g, ', '))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${isKo ? "이벤트 검증 제한" : "Event Limit"}</div>
        <div class="kpi-value" style="font-size:22px;">${eventLimit > 0 ? eventLimit : (isKo ? "무제한" : "Unlimited")}</div>
      </div>
    </div>

    <div class="visualizations-row">
      <div class="chart-panel">
        <h3>${isKo ? "무결성 통계" : "Data Integrity Status"}</h3>
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
            ${allDefects.length > 0 ? `${allDefects.length}개의 정합성 결함이 존재합니다.` : "데이터 무결성 검증을 통과했습니다."}
          </div>
        </div>
      </div>
    </div>

    <section class="grid">
      <div class="panel">
        <h2>${isKo ? "실행 요약" : "Execution Summary"}</h2>
        <div class="panel-body">
          <div class="summary-line">
            <span>${isKo ? "대상 연도" : "Year"}: <strong>${escapeHtml(summary.year)}</strong></span>
            <span>${isKo ? "브랜드 필터" : "Brand Filter"}: <strong>${escapeHtml(summary.brand || (isKo ? "전체" : "All"))}</strong></span>
            <span>${isKo ? "확인한 대회" : "Checked"}: ${completedTournaments}/${totalTournaments}</span>
            <span>${isKo ? "이벤트 제한" : "Event Limit"}: <strong>${eventLimit > 0 ? eventLimit : (isKo ? "무제한" : "Unlimited")}</strong></span>
            <span>${isKo ? "생성 시간" : "Generated"}: ${escapeHtml(new Date().toLocaleString())}</span>
          </div>
          <div class="bar" aria-label="정합성 비율">
            <div class="bar-pass" style="width:${(summary.passedTournaments / (summary.totalTournaments || 1)) * 100}%"></div>
            <div class="bar-fail" style="width:${(summary.failedTournaments / (summary.totalTournaments || 1)) * 100}%"></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <h2>${isKo ? "먼저 볼 내용" : "Read Me First"}</h2>
        <div class="panel-body">
          <div class="note">
            ${isKo ?
      (summary.totalDefects > 0 ? "검사 결과 정합성 오류가 검출되었습니다. 아래 결함 후보 목록에서 원인을 확인하십시오." : (warnedTournaments > 0 ? "실패 결함은 없지만 주의 항목이 있습니다. 날짜 범위 검증 불가 또는 경계일 차이 같은 검토 항목을 대회별 결과에서 확인하십시오." : "모든 대회 및 일정 데이터의 정합성 검증이 완료되었으며, 검출된 결함이 없습니다.")) :
      (summary.totalDefects > 0 ? "Some data integrity defects were detected. Please check the Defect Candidates List below." : (warnedTournaments > 0 ? "No blocking defects were found, but warning items need review in the tournament detail cards." : "All checked tournaments passed verification. No defects found."))
    }
          </div>
        </div>
      </div>
    </section>

    <h2>
      <svg viewBox="0 0 24 24"><path d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2M13,16H11V18H13V16M13,6H11V14H13V6Z"/></svg>
      ${escapeHtml(t.validationRules)}
    </h2>
    <div class="group-card">
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

    <h2>
      <svg viewBox="0 0 24 24"><path d="M12,2L1,21H23M12,6L19.8,20H4.2M11,10V14H13V10M11,16V18H13V16"/></svg>
      ${escapeHtml(t.defectList)}
    </h2>
    <div class="filter-controls" style="margin-bottom: 16px;">
      <select class="select-dropdown" id="defect-category-filter" onchange="filterByDefectCategory(this.value)">
        <option value="all">${isKo ? "모든 결함 카테고리" : "All Defect Categories"}</option>
      </select>
    </div>
    <div id="defects-grouped-container"></div>

    <div class="search-filter-bar" id="tournament-directory">
      <h2>
        <svg viewBox="0 0 24 24"><path d="M16,13C15.71,13 15.38,13 15.03,13.05C16.19,13.89 17,15 17,16.5V19H23V16.5C23,14.28 19.33,13 16,13M8,13C4.67,13 1,14.28 1,16.5V19H15V16.5C15,14.28 11.33,13 8,13M8,11A3,3 0 0,0 11,8A3,3 0 0,0 8,5A3,3 0 0,0 5,8A3,3 0 0,0 8,11M16,11A3,3 0 0,0 19,8A3,3 0 0,0 16,5A3,3 0 0,0 13,8A3,3 0 0,0 16,11Z"/></svg>
        ${escapeHtml(t.tournamentsDetail)}
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
        <select class="select-dropdown" id="brand-filter" onchange="filterByBrand(this.value)">
          <option value="all">${isKo ? "모든 브랜드" : "All Brands"}</option>
        </select>
        <select class="select-dropdown" id="mode-filter" onchange="filterByMode(this.value)">
          <option value="all">${isKo ? "모든 모드" : "All Modes"}</option>
          <option value="Case A">Case A (Results)</option>
          <option value="Case B">Case B (Schedule)</option>
        </select>
        <select class="select-dropdown" id="sort-select" onchange="sortTournaments(this.value)">
          <option value="name-asc">${isKo ? "이름순 (A-Z)" : "Name (A-Z)"}</option>
          <option value="name-desc">${isKo ? "이름 역순 (Z-A)" : "Name (Z-A)"}</option>
          <option value="events-desc">${isKo ? "이벤트 많은순" : "Most Events"}</option>
          <option value="defects-desc">${isKo ? "결함 많은순" : "Most Defects"}</option>
          <option value="status-desc">${isKo ? "검증 상태순" : "Verify Status"}</option>
        </select>
      </div>
    </div>

    <div id="tournaments-list"></div>
  </main>

  <button class="scroll-top-btn" id="scroll-to-top" onclick="window.scrollTo({top:0, behavior:'smooth'})">
    <svg viewBox="0 0 24 24"><path d="M7.41,18.41L6,17L12,11L18,17L16.59,18.41L12,13.83L7.41,18.41M7.41,12.41L6,11L12,5L18,11L16.59,12.41L12,7.83L7.41,12.41Z"/></svg>
  </button>

  <script>
    const reportData = ${reportJson};
    const isKo = ${isKo};

    const labels = {
      statusText: "${escapeHtml(t.statusText)}",
      detailText: "${escapeHtml(t.detailText)}",
      seriesEvent: "${escapeHtml(t.seriesEvent)}",
      dateText: "${escapeHtml(t.dateText)}",
      earningsText: "${escapeHtml(t.earningsText)}",
      resultUrlText: "${escapeHtml(t.resultUrlText)}",
      resultCheckText: "${escapeHtml(t.resultCheckText)}",
      finalFindingText: "${escapeHtml(t.finalFindingText)}",
      noDefects: "${escapeHtml(t.noDefects)}",
      searchEventsPlaceholder: "${escapeHtml(t.searchEventsPlaceholder)}"
    };

    const state = {
      tournaments: (reportData.tournaments || []).map((tournament, index) => ({
        ...tournament,
        reportKey: 'tournament-' + index
      })),
      searchQuery: '',
      statusFilter: 'all',
      brandFilter: 'all',
      modeFilter: 'all',
      defectCategoryFilter: 'all',
      sortBy: 'name-asc'
    };

    const eventPages = {};
    const eventSearchQuery = {};
    const activeSubTabs = {};
    let statusChartInstance = null;
    let defectsChartInstance = null;

    const allDefects = [];
    state.tournaments.forEach(t => {
      (t.defects || []).forEach(d => {
        allDefects.push({ ...d, tournament: t.seriesName });
      });
    });

    const scrollTopBtn = document.getElementById('scroll-to-top');
    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) scrollTopBtn.classList.add('visible');
      else scrollTopBtn.classList.remove('visible');
    });

    function formatValue(label, val) {
      if (val === null || val === undefined || val === '') return "-";
      if (label.toLowerCase().includes("prize") || label.toLowerCase().includes("buy-in") || label.toLowerCase().includes("earnings")) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
      }
      return typeof val === "number" ? val.toLocaleString("en-US") : val;
    }

    function formatStatus(status) {
      if (!isKo) return status;
      return { pass: "통과", fail: "실패", warn: "주의", minor: "경미", skipped: "제외", pending: "대기" }[status] || status;
    }

    function formatKoreanDefectType(type) {
      if (!isKo) return type;
      return {
        "Header mismatch": "헤더 정보 불일치",
        "Event metadata invalid": "이벤트 메타데이터 오류",
        "Cross check mismatch": "교차 검증 불일치",
        "Payout page unavailable": "교차 검증 페이지 접근 불가",
        "Schedule data invalid": "일정 데이터 오류",
        "Tournament page unavailable": "대회 페이지 접근 불가"
      }[type] || type;
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

    function getFilteredAndSortedTournaments() {
      return state.tournaments
        .filter(t => {
          const matchesSearch = t.seriesName.toLowerCase().includes(state.searchQuery.toLowerCase()) || (t.location || '').toLowerCase().includes(state.searchQuery.toLowerCase());
          const matchesStatus = state.statusFilter === 'all' || t.status === state.statusFilter;
          const matchesBrand = state.brandFilter === 'all' || String(t.brand || '').toLowerCase() === state.brandFilter.toLowerCase();
          const matchesMode = state.modeFilter === 'all' || String(t.mode || '').toLowerCase().includes(state.modeFilter.toLowerCase());

          return matchesSearch && matchesStatus && matchesBrand && matchesMode;
        })
        .sort((a, b) => {
          if (state.sortBy === 'name-asc') return a.seriesName.localeCompare(b.seriesName);
          if (state.sortBy === 'name-desc') return b.seriesName.localeCompare(a.seriesName);

          if (state.sortBy === 'events-desc') {
            return (b.events?.length || 0) - (a.events?.length || 0);
          }
          if (state.sortBy === 'defects-desc') {
            return (b.defects?.length || 0) - (a.defects?.length || 0);
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

    function populateStaticTables() {
      const brandSelect = document.getElementById('brand-filter');
      const brands = [...new Set(state.tournaments.map(t => String(t.brand || '').trim()))].filter(Boolean).sort();
      brands.forEach(brand => {
        const opt = document.createElement('option');
        opt.value = brand;
        opt.textContent = brand;
        brandSelect.appendChild(opt);
      });

      const defectCategorySelect = document.getElementById('defect-category-filter');
      const defectCategories = [...new Set(allDefects.map(d => String(d.type || 'Unknown Defect')))].filter(Boolean).sort();
      defectCategories.forEach(category => {
        const opt = document.createElement('option');
        opt.value = category;
        opt.textContent = isKo ? formatKoreanDefectType(category) : category;
        defectCategorySelect.appendChild(opt);
      });

      renderInspectorLists();
    }

    function renderInspectorLists() {
      const filtered = getFilteredAndSortedTournaments();
      const defectsContainer = document.getElementById('defects-grouped-container');
      
      let defectsList = filtered.flatMap(t => (t.defects || []).map(d => ({ ...d, tournament: t.seriesName, tournamentKey: t.reportKey })));
      if (state.defectCategoryFilter !== 'all') {
        defectsList = defectsList.filter(d => String(d.type || 'Unknown Defect') === state.defectCategoryFilter);
      }

      if (defectsList.length) {
        const grouped = {};
        const groupLabels = {};
        defectsList.forEach(row => {
          const categoryKey = row.type || "Unknown Defect";
          if (!grouped[categoryKey]) grouped[categoryKey] = {};
          const tKey = row.tournamentKey || row.tournament || "Unknown Tournament";
          if (!grouped[categoryKey][tKey]) grouped[categoryKey][tKey] = {};
          groupLabels[tKey] = row.tournament || "Unknown Tournament";
          const eKey = row.event || (isKo ? "대회 공통 메타데이터" : "Tournament Metadata");
          if (!grouped[categoryKey][tKey][eKey]) grouped[categoryKey][tKey][eKey] = [];
          grouped[categoryKey][tKey][eKey].push(row);
        });

        let html = '';
        let cIndex = 0;
        Object.entries(grouped).forEach(([categoryName, tournamentsObj]) => {
          const categoryKey = 'c-' + cIndex;
          cIndex++;
          const categoryRowsCount = Object.values(tournamentsObj).reduce((categorySum, eventsObj) => {
            return categorySum + Object.values(eventsObj).reduce((sum, arr) => sum + arr.length, 0);
          }, 0);

          let tournamentsHtml = '';
          let tIndex = 0;
          Object.entries(tournamentsObj).forEach(([tournamentKey, eventsObj]) => {
            const tournamentName = groupLabels[tournamentKey] || tournamentKey;
            const typeKey = categoryKey + '-t-' + tIndex;
            tIndex++;
            const totalRowsCount = Object.values(eventsObj).reduce((sum, arr) => sum + arr.length, 0);

            let eventsHtml = '';
            let eIndex = 0;
            Object.entries(eventsObj).forEach(([eventName, rows]) => {
              const eventKey = 'e-' + eIndex;
              eIndex++;
              eventsHtml += \`
              <div class="nested-group-card" style="margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-bottom: 10px;">
                <div class="nested-group-header" onclick="toggleNestedGroupCollapse('defects', '\${typeKey}', '\${eventKey}')" style="padding: 10px 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.03);">
                  <div style="font-size: 13px; font-weight: 600; color: var(--primary-hover); display: flex; align-items: center; gap: 8px;">
                    <span style="border-left: 3px solid var(--primary); padding-left: 8px;">\${escapeHtml(eventName)}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="item-count-badge" style="font-size: 10px; padding: 2px 8px;">\${rows.length} \${isKo ? '건' : 'items'}</span>
                    <svg class="group-arrow-icon" id="defects-nested-arrow-\${typeKey}-\${eventKey}" viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: var(--text-muted); transition: transform 0.3s; transform: rotate(0deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
                  </div>
                </div>
                <div class="nested-group-body collapsed" id="defects-nested-body-\${typeKey}-\${eventKey}">
                  <div class="group-body-inner">
                    <div class="table-container" style="border-top: 1px solid var(--border); border-radius: 0;">
                      <table>
                        <thead>
                          <tr>
                            <th class="nowrap" style="width: 150px;">\${isKo ? '결함 유형' : 'Defect Type'}</th>
                            <th>Item</th>
                            <th>Expected</th>
                            <th>Actual</th>
                            <th>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          \${rows.map(row => \`
                            <tr class="clickable-row" onclick="inspectTournament('\${escapeHtml(row.tournamentKey)}')">
                              <td class="nowrap"><span class="status-badge fail" style="font-size:10px; padding:2px 6px;">\${escapeHtml(isKo ? formatKoreanDefectType(row.type) : row.type)}</span></td>
                              <td>\${escapeHtml(row.item)}</td>
                              <td><code>\${escapeHtml(row.expected)}</code></td>
                              <td><code class="text-danger">\${escapeHtml(row.actual)}</code></td>
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

            tournamentsHtml += \`
            <div class="group-card">
              <div class="group-header" onclick="toggleGroupCollapse('defects', '\${typeKey}')">
                <div class="group-header-left">
                  <span class="status-badge fail" style="background-color: var(--danger-bg); color: var(--danger);">\${escapeHtml(tournamentName)}</span>
                  <span class="item-count-badge">\${totalRowsCount} \${isKo ? '건' : 'items'}</span>
                </div>
                <svg class="group-arrow-icon" id="defects-group-arrow-\${typeKey}" viewBox="0 0 24 24" style="transform: rotate(0deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
              </div>
              <div class="group-body collapsed" id="defects-group-body-\${typeKey}">
                <div class="group-body-inner" style="padding: 10px 20px 20px 20px;">
                  \${eventsHtml}
                </div>
              </div>
            </div>
          \`;
          });

          html += \`
            <div class="group-card">
              <div class="group-header" onclick="toggleGroupCollapse('defectCategory', '\${categoryKey}')">
                <div class="group-header-left">
                  <span class="status-badge fail" style="background-color: var(--danger-bg); color: var(--danger);">\${escapeHtml(isKo ? formatKoreanDefectType(categoryName) : categoryName)}</span>
                  <span class="item-count-badge">\${Object.keys(tournamentsObj).length} \${isKo ? '개 대회' : 'tournaments'}</span>
                  <span class="item-count-badge">\${categoryRowsCount} \${isKo ? '건' : 'items'}</span>
                </div>
                <svg class="group-arrow-icon" id="defectCategory-group-arrow-\${categoryKey}" viewBox="0 0 24 24" style="transform: rotate(0deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
              </div>
              <div class="group-body collapsed" id="defectCategory-group-body-\${categoryKey}">
                <div class="group-body-inner" style="padding: 10px 20px 20px 20px;">
                  \${tournamentsHtml}
                </div>
              </div>
            </div>
          \`;
        });
        defectsContainer.innerHTML = \`
          <div class="group-card">
            <div class="group-header" onclick="toggleGroupCollapse('defectsRoot', 'all')">
              <div class="group-header-left">
                <span class="status-badge fail" style="background-color: var(--danger-bg); color: var(--danger);">\${escapeHtml(isKo ? "결함 후보 목록" : "Defect Candidates List")}</span>
                <span class="item-count-badge">\${Object.keys(grouped).length} \${isKo ? '개 카테고리' : 'categories'}</span>
                <span class="item-count-badge">\${defectsList.length} \${isKo ? '건' : 'items'}</span>
              </div>
              <svg class="group-arrow-icon" id="defectsRoot-group-arrow-all" viewBox="0 0 24 24" style="transform: rotate(180deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
            </div>
            <div class="group-body" id="defectsRoot-group-body-all">
              <div class="group-body-inner" style="padding: 10px 0 0 0;">
                \${html}
              </div>
            </div>
          </div>
        \`;
      } else {
        defectsContainer.innerHTML = \`
          <div class="group-card">
            <div class="group-header" onclick="toggleGroupCollapse('defectsRoot', 'all')">
              <div class="group-header-left">
                <span class="status-badge pass">\${escapeHtml(isKo ? "결함 후보 목록" : "Defect Candidates List")}</span>
                <span class="item-count-badge">0 \${isKo ? '건' : 'items'}</span>
              </div>
              <svg class="group-arrow-icon" id="defectsRoot-group-arrow-all" viewBox="0 0 24 24" style="transform: rotate(180deg);"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
            </div>
            <div class="group-body" id="defectsRoot-group-body-all">
              <div class="group-body-inner">
                <div class="panel" style="padding: 20px; text-align: center; color: var(--text-muted);">\${labels.noDefects}</div>
              </div>
            </div>
          </div>
        \`;
      }
    }

    function toggleGroupCollapse(type, groupKey) {
      const body = document.getElementById(\`\${type}-group-body-\${groupKey}\`);
      const icon = document.getElementById(\`\${type}-group-arrow-\${groupKey}\`);
      if (!body || !icon) return;

      const isCollapsed = body.classList.toggle('collapsed');
      icon.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
    }

    function toggleNestedGroupCollapse(type, parentKey, eventKey) {
      const body = document.getElementById(\`\${type}-nested-body-\${parentKey}-\${eventKey}\`);
      const icon = document.getElementById(\`\${type}-nested-arrow-\${parentKey}-\${eventKey}\`);
      if (!body || !icon) return;

      const isCollapsed = body.classList.toggle('collapsed');
      icon.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
    }

    function toggleAccordion(tournamentKey) {
      const card = document.querySelector(\`.player-card[data-key="\${tournamentKey}"]\`);
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
        
        // 서브 탭 초기화 연동
        const activeTab = activeSubTabs[tournamentKey] || 'summary';
        setTimeout(() => switchSubTab(tournamentKey, activeTab), 10);
      }
    }

    function switchSubTab(tournamentKey, tabName) {
      activeSubTabs[tournamentKey] = tabName;
      const card = document.querySelector(\`.player-card[data-key="\${tournamentKey}"]\`);
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

      if (tabName === 'events') {
        if (!eventPages[tournamentKey]) eventPages[tournamentKey] = 1;
        renderTournamentEvents(tournamentKey);
      }
    }

    function renderTournamentEvents(tKey) {
      const card = document.querySelector(\`.player-card[data-key="\${tKey}"]\`);
      if (!card) return;
      const tbody = card.querySelector('.events-tbody');
      const pageInfo = card.querySelector('.events-page-info');
      const prevBtn = card.querySelector('.events-prev-btn');
      const nextBtn = card.querySelector('.events-next-btn');

      const tObj = state.tournaments.find(t => t.reportKey === tKey);
      if (!tObj) return;

      const events = tObj.events || [];
      const searchQuery = (eventSearchQuery[tKey] || '').toLowerCase();
      const filtered = events.filter(e => e.eventName.toLowerCase().includes(searchQuery));

      const page = eventPages[tKey] || 1;
      const pageSize = 10;
      const totalPages = Math.ceil(filtered.length / pageSize) || 1;
      const startIndex = (page - 1) * pageSize;
      const paged = filtered.slice(startIndex, startIndex + pageSize);

      const isCaseA = tObj.mode === "Case A (Results)";

      if (paged.length === 0) {
        tbody.innerHTML = \`<tr><td colspan="10" style="text-align:center;color:var(--text-muted); font-size:12px;">\${isKo ? "수집된 이벤트가 없습니다." : "No events found."}</td></tr>\`;
      } else {
        tbody.innerHTML = paged.map(event => {
          const evStatus = event.status || "pass";
          const errorsDetail = (event.errors || []).join(", ");
          const warningsDetail = (event.warnings || []).join(", ");
          
          if (isCaseA) {
            const crossStatus = event.crossCheck ? event.crossCheck.status : "pending";
            const crossErrors = event.crossCheck && event.crossCheck.status === "fail" ? event.crossCheck.errors.join(", ") : "";
            
            return \`
              <tr>
                <td><strong>\${escapeHtml(event.eventName)}</strong></td>
                <td class="nowrap">\${escapeHtml(event.date || "-")}</td>
                <td class="nowrap">\${escapeHtml(event.buyInText || "-")}</td>
                <td class="nowrap">\${escapeHtml(formatValue("entries", event.entries))}</td>
                <td class="nowrap">\${escapeHtml(event.itmText || "-")}</td>
                <td class="nowrap">\${escapeHtml(formatValue("prize", event.prize))}</td>
                <td>\${escapeHtml(event.winner || "-")}</td>
                <td>
                  <span class="status-badge \${crossStatus}">\${escapeHtml(formatStatus(crossStatus))}</span>
                  \${crossErrors ? \`<div class="error-detail" style="color:var(--danger); font-size:10px; margin-top:2px;">\${escapeHtml(crossErrors)}</div>\` : ""}
                </td>
                <td>
                  <span class="status-badge \${evStatus}">\${escapeHtml(formatStatus(evStatus))}</span>
                  \${errorsDetail ? \`<div class="error-detail" style="color:var(--danger); font-size:10px; margin-top:2px;">\${escapeHtml(errorsDetail)}</div>\` : ""}
                  \${warningsDetail ? \`<div class="warning-detail" style="color:var(--warning); font-size:10px; margin-top:2px;">\${escapeHtml(warningsDetail)}</div>\` : ""}
                </td>
              </tr>
            \`;
          } else {
            return \`
              <tr>
                <td><strong>\${escapeHtml(event.eventName)}</strong></td>
                <td class="nowrap">\${escapeHtml(event.date || "-")}</td>
                <td class="nowrap">\${escapeHtml(event.buyInText || "-")}</td>
                <td class="nowrap">\${escapeHtml(event.chipsText || "-")}</td>
                <td class="nowrap">\${escapeHtml(event.clockText || "-")}</td>
                <td class="nowrap">\${escapeHtml(event.lateRegText || "-")}</td>
                <td>
                  <span class="status-badge \${evStatus}">\${escapeHtml(formatStatus(evStatus))}</span>
                  \${errorsDetail ? \`<div class="error-detail" style="color:var(--danger); font-size:10px; margin-top:2px;">\${escapeHtml(errorsDetail)}</div>\` : ""}
                  \${warningsDetail ? \`<div class="warning-detail" style="color:var(--warning); font-size:10px; margin-top:2px;">\${escapeHtml(warningsDetail)}</div>\` : ""}
                </td>
              </tr>
            \`;
          }
        }).join("");
      }

      if (pageInfo) pageInfo.textContent = \`\${page} / \${totalPages} (\${filtered.length})\`;
      if (prevBtn) prevBtn.disabled = page === 1;
      if (nextBtn) nextBtn.disabled = page === totalPages;
    }

    function changeEventPage(tKey, direction) {
      let page = eventPages[tKey] || 1;
      const total = Math.ceil((state.tournaments.find(t => t.reportKey === tKey)?.events || []).length / 10) || 1;
      page = Math.max(1, Math.min(total, page + direction));
      eventPages[tKey] = page;
      renderTournamentEvents(tKey);
    }

    function searchEvents(tKey, query) {
      eventSearchQuery[tKey] = query;
      eventPages[tKey] = 1;
      renderTournamentEvents(tKey);
    }

    function buildTournamentCard(tObj) {
      const tKey = tObj.reportKey;
      const hasDefects = tObj.defects && tObj.defects.length > 0;
      const statusText = formatStatus(tObj.status);
      const totalEvents = tObj.events?.length || 0;
      const headerStatus = tObj.headerCheck?.status || "pass";
      const headerErrText = tObj.headerCheck?.errors?.length > 0 ? \` (\${tObj.headerCheck.errors.length}건)\` : "";

      const isCaseA = tObj.mode === "Case A (Results)";

      return \`
        <div class="player-card" data-status="\${tObj.status}" data-key="\${escapeHtml(tKey)}" data-name="\${escapeHtml(tObj.seriesName)}">
          <div class="player-header" onclick="toggleAccordion('\${escapeHtml(tKey)}')">
            <div class="player-info-left">
              <h3>\${highlightText(tObj.seriesName, state.searchQuery)} <span class="brand-badge" style="background:#1e3a8a; margin-left:8px;">\${escapeHtml(tObj.brand)}</span></h3>
              <div class="player-meta-info">
                <span>📅 \${escapeHtml(tObj.dateRange || "-")}</span>
                <span>📍 \${escapeHtml(tObj.location || "-")}</span>
                <span>🌍 \${escapeHtml(tObj.countryDisplay || "-")}</span>
                <span>이벤트: <strong>\${totalEvents}개</strong></span>
                <span>분류: <strong>\${escapeHtml(tObj.mode || "Case B")}</strong></span>
                \${tObj.year ? \`<span>수집연도: <strong>\${escapeHtml(tObj.year)}</strong></span>\` : ""}
              </div>
            </div>
            <div class="player-header-right">
              <span class="status-badge \${tObj.status}">\${escapeHtml(statusText)}</span>
              <svg class="arrow-icon" viewBox="0 0 24 24"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
            </div>
          </div>

          <div class="accordion-content">
            <div class="accordion-inner">
              <div class="player-body-wrapper" style="padding-top:20px;">
                <div class="sub-tabs-container">
                  <button class="sub-tab-btn" data-tab="summary" onclick="switchSubTab('\${escapeHtml(tKey)}', 'summary')">\${isKo ? "1. 요약 메트릭 검증" : "1. Summary Checks"}</button>
                  <button class="sub-tab-btn" data-tab="events" onclick="switchSubTab('\${escapeHtml(tKey)}', 'events')">\${isKo ? "2. 개별 이벤트 검증" : "2. Event Verification"}</button>
                  <div class="tab-active-bar"></div>
                </div>

                <!-- Sub-tab Content: Summary Metrics -->
                <div class="sub-tab-content" data-tab="summary">
                  \${hasDefects ? \`
                    <div class="defects-summary-box">
                      <h4>Defect Candidate List</h4>
                      <ul>
                        \${tObj.defects.map(d => \`<li><strong>[\${escapeHtml(isKo ? formatKoreanDefectType(d.type) : d.type)}]</strong> \${escapeHtml(d.item)}: Expected [\${escapeHtml(d.expected)}] but got [\${escapeHtml(d.actual)}]. \${escapeHtml(d.detail || "")}</li>\`).join("")}
                      </ul>
                    </div>
                  \` : ""}

                  <div style="margin-bottom: 20px;">
                    <h4 style="margin:0 0 10px; font-family:'Outfit',sans-serif;">Visual Header Validation (목록-상세 헤더 검증)</h4>
                    <div style="background:rgba(255,255,255,0.01); border:1px solid var(--border); border-radius:8px; padding:15px; display:flex; justify-content:space-between; align-items:center;">
                      <div>
                        <span>검증 상태: </span>
                        <span class="status-badge \${headerStatus}">\${escapeHtml(formatStatus(headerStatus))}\${headerErrText}</span>
                      </div>
                      <div>
                        <a href="\${escapeHtml(tObj.url)}" target="_blank">대회 상세 페이지 이동 ↗</a>
                      </div>
                    </div>
                    \${tObj.headerCheck?.errors?.length > 0 ? \`
                      <div style="margin-top:10px; color:var(--danger); font-size:12px; background:rgba(248,81,73,0.05); padding:10px; border-radius:6px; border-left:3px solid var(--danger);">
                        \${tObj.headerCheck.errors.map(err => \`<div>• \${escapeHtml(err)}</div>\`).join("")}
                      </div>
                    \` : ""}
                  </div>
                </div>

                <!-- Sub-tab Content: Events List -->
                <div class="sub-tab-content" data-tab="events">
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
                      <h4 style="margin:0; font-family:'Outfit',sans-serif;">Events List Verification (개별 이벤트 검증)</h4>
                      <div class="search-box" style="min-width:200px; flex:0 1 250px; margin:0;">
                        <svg viewBox="0 0 24 24"><path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/></svg>
                        <input type="text" class="events-search-input" placeholder="\${labels.searchEventsPlaceholder}" oninput="searchEvents('\${escapeHtml(tKey)}', this.value)" style="padding-top:8px; padding-bottom:8px;">
                      </div>
                    </div>

                    <div class="table-container">
                      <table>
                        <thead>
                          <tr>
                            \${isCaseA ? \`
                              <th>\${labels.seriesEvent}</th>
                              <th>\${labels.dateText}</th>
                              <th>Buy-in</th>
                              <th>Entries</th>
                              <th>ITM</th>
                              <th>Prize</th>
                              <th>Winner</th>
                              <th>\${labels.resultCheckText}</th>
                              <th>\${labels.statusText}</th>
                            \` : \`
                              <th>\${labels.seriesEvent}</th>
                              <th>\${labels.dateText}</th>
                              <th>Buy-in</th>
                              <th>Chips</th>
                              <th>Clock</th>
                              <th>Late Reg.</th>
                              <th>\${labels.statusText}</th>
                            \`}
                          </tr>
                        </thead>
                        <tbody class="events-tbody">
                          <!-- Filled dynamically -->
                        </tbody>
                      </table>
                    </div>

                    <div class="pagination-bar">
                      <button class="mini-btn events-prev-btn" onclick="changeEventPage('\${escapeHtml(tKey)}', -1)">◀ Prev</button>
                      <span class="events-page-info">1 / 1 (0)</span>
                      <button class="mini-btn events-next-btn" onclick="changeEventPage('\${escapeHtml(tKey)}', 1)">Next ▶</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    function renderTournamentsList() {
      const container = document.getElementById('tournaments-list');
      const filtered = getFilteredAndSortedTournaments();

      if (filtered.length === 0) {
        container.innerHTML = \`<div style="text-align:center;padding:50px;color:var(--text-muted);background:var(--bg-card);border-radius:20px;border:var(--card-border);">\${isKo ? "조건에 부합하는 대회가 없습니다." : "No tournaments matched your criteria."}</div>\`;
        return;
      }

      container.innerHTML = filtered.map(buildTournamentCard).join("");

      filtered.forEach(t => {
        const card = document.querySelector(\`.player-card[data-key="\${t.reportKey}"]\`);
        const content = card?.querySelector('.accordion-content');
        if (content && content.classList.contains('open')) {
          renderTournamentEvents(t.reportKey);
          switchSubTab(t.reportKey, activeSubTabs[t.reportKey] || 'summary');
        }
      });
    }

    function renderFilteredViews() {
      renderInspectorLists();
      renderTournamentsList();
    }

    function filterByStatus(status) {
      state.statusFilter = status;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === status) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      renderFilteredViews();
      document.getElementById('tournament-directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function filterByBrand(brand) {
      state.brandFilter = brand;
      renderFilteredViews();
    }

    function filterByMode(mode) {
      state.modeFilter = mode;
      renderFilteredViews();
    }

    function filterByDefectCategory(category) {
      state.defectCategoryFilter = category;
      renderInspectorLists();
    }

    function sortTournaments(sortBy) {
      state.sortBy = sortBy;
      renderFilteredViews();
    }

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderFilteredViews();
    });

    function inspectTournament(tKey) {
      searchInput.value = '';
      state.searchQuery = '';
      state.statusFilter = 'all';
      state.brandFilter = 'all';
      state.modeFilter = 'all';
      state.defectCategoryFilter = 'all';

      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === 'all') btn.classList.add('active');
        else btn.classList.remove('active');
      });
      document.getElementById('brand-filter').value = 'all';
      document.getElementById('mode-filter').value = 'all';
      document.getElementById('defect-category-filter').value = 'all';

      renderFilteredViews();

      setTimeout(() => {
        const card = document.querySelector(\`.player-card[data-key="\${tKey}"]\`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });

          const content = card.querySelector('.accordion-content');
          const icon = card.querySelector('.arrow-icon');

          if (!content.classList.contains('open')) {
            content.classList.add('open');
            icon.style.transform = 'rotate(180deg)';
            renderTournamentEvents(tKey);
          }

          card.classList.remove('pulse-glow');
          void card.offsetWidth;
          card.classList.add('pulse-glow');
          setTimeout(() => card.classList.remove('pulse-glow'), 2500);
        }
      }, 100);
    }

    function initCharts() {
      if (typeof Chart === 'undefined') {
        showFallbackCharts();
        return;
      }

      if (statusChartInstance) statusChartInstance.destroy();
      if (defectsChartInstance) defectsChartInstance.destroy();

      try {
        const ctx1 = document.getElementById('statusChart');
        const ctx2 = document.getElementById('defectsChart');

        const style = getComputedStyle(document.documentElement);
        const textMuted = style.getPropertyValue('--text-muted').trim() || '#94a3b8';
        const borderGrid = style.getPropertyValue('--border').trim() || 'rgba(255, 255, 255, 0.08)';

        const integrityData = {
          passed: ${summary.passedTournaments},
          warned: ${warnedTournaments},
          failed: ${summary.failedTournaments}
        };

        statusChartInstance = new Chart(ctx1, {
          type: 'doughnut',
          data: {
            labels: isKo ? ['통과', '주의', '실패'] : ['Passed', 'Warned', 'Failed'],
            datasets: [{
              data: [integrityData.passed, integrityData.warned, integrityData.failed],
              backgroundColor: [
                style.getPropertyValue('--success').trim() || '#2ea043',
                style.getPropertyValue('--warning').trim() || '#d29922',
                style.getPropertyValue('--danger').trim() || '#f85149'
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
                labels: { color: textMuted, font: { family: 'Outfit', size: 12 } }
              }
            },
            cutout: '65%'
          }
        });

        const defectsCount = {};
        allDefects.forEach(d => {
          const type = isKo ? formatKoreanDefectType(d.type) : d.type;
          defectsCount[type] = (defectsCount[type] || 0) + 1;
        });

        const barLabels = Object.keys(defectsCount);
        const barData = Object.values(defectsCount);

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
                label: isKo ? '건수' : 'Count',
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
              plugins: { legend: { display: false } },
              scales: {
                x: {
                  grid: { color: borderGrid },
                  ticks: { color: textMuted, precision: 0 }
                },
                y: {
                  grid: { display: false },
                  ticks: { color: textMuted, font: { family: 'Inter', size: 11 } }
                }
              }
            }
          });
        }

        ctx1.style.display = 'block';
        document.getElementById('radialFallback').style.display = 'none';
      } catch (e) {
        console.error("Failed to render Chart.js, fallback to SVG:", e);
        showFallbackCharts();
      }
    }

    function showFallbackCharts() {
      document.getElementById('statusChart').style.display = 'none';
      document.getElementById('defectsChart').style.display = 'none';
      document.getElementById('radialFallback').style.display = 'block';
      document.getElementById('defectsFallback').style.display = 'block';
    }

    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    window.addEventListener('DOMContentLoaded', () => {
      populateStaticTables();
      renderTournamentsList();
      initCharts();

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
</html>`;
}


// -------------------------------------------------------------
// Offline Self-Test Routine
// -------------------------------------------------------------

function runSelfTest() {
  console.log("=== Running Offline Self-Test ===");
  const testReport = {
    summary: {
      year: "2026",
      brand: "MOCK_BRAND",
      eventLimit: 0,
      resultLimit: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      runStatus: "complete",
      totalTournaments: 5,
      completedTournaments: 5,
      pendingTournaments: 0,
      passedTournaments: 1,
      warnedTournaments: 1,
      failedTournaments: 3,
      totalDefects: 3
    },
    tournaments: [
      {
        brand: "CIRCUIT",
        seriesName: "Mock Circuit Planet Hollywood",
        dateRange: "Oct 24 - Nov 04, 2026",
        location: "Planet Hollywood, Las Vegas",
        country: "USA",
        countryDisplay: "USA",
        url: "https://www.wsop.com/tournaments/mock-circuit-planet-hollywood/",
        status: "pass",
        mode: "Case A (Results)",
        headerCheck: { status: "pass", errors: [] },
        events: [
          {
            eventName: "Event #1: $400 No-Limit Hold'em",
            date: "Oct 24",
            buyIn: 400,
            entries: 250,
            itm: 30,
            prize: 100000,
            winner: "John Doe",
            payoutUrl: "/tournaments/result/mock-1/",
            status: "pass",
            errors: [],
            crossCheck: { status: "pass", errors: [] }
          }
        ],
        defects: []
      },
      {
        brand: "CIRCUIT",
        seriesName: "Mock Circuit Paris",
        dateRange: "Nov 10 - Nov 20, 2026",
        location: "Paris Casino",
        country: "France",
        countryDisplay: "France",
        url: "https://www.wsop.com/tournaments/mock-circuit-paris/",
        status: "fail", // Header Mismatch
        mode: "Case A (Results)",
        headerCheck: {
          status: "fail",
          errors: ["Brand mismatch: card=\"CIRCUIT\", header=\"EUROPE\""]
        },
        events: [],
        defects: [
          {
            type: "Header mismatch",
            event: "Header Check",
            item: "Brand",
            expected: "CIRCUIT",
            actual: "EUROPE",
            detail: "Header brand mismatch"
          }
        ]
      },
      {
        brand: "BRACELETS",
        seriesName: "Mock WSOP Online",
        dateRange: "Dec 01 - Dec 10, 2026",
        location: "WSOP.com Online",
        country: "Unknown Country",
        countryDisplay: "Unknown Country",
        url: "https://www.wsop.com/tournaments/mock-wsop-online/",
        status: "fail", // Event Error
        mode: "Case B (Schedule)",
        headerCheck: { status: "pass", errors: [] },
        events: [
          {
            eventName: "Event #2: $1000 NLH",
            date: "Dec 01",
            buyIn: 1000,
            chipsText: "0",
            chips: 0,
            clockText: "30",
            clock: 30,
            lateRegText: "Level 8",
            status: "fail",
            errors: ["Invalid Chips: 0"]
          }
        ],
        defects: [
          {
            type: "Schedule data invalid",
            event: "Event #2: $1000 NLH",
            item: "Chips",
            expected: "> 0",
            actual: "0",
            detail: "Chips count cannot be zero in schedule"
          }
        ]
      },
      {
        brand: "CIRCUIT",
        seriesName: "Mock Circuit Paris",
        dateRange: "Dec 01 - Dec 12, 2026",
        location: "Paris Casino Duplicate",
        country: "France",
        countryDisplay: "France",
        url: "https://www.wsop.com/tournaments/mock-circuit-paris-duplicate/",
        status: "fail",
        mode: "Case A (Results)",
        headerCheck: { status: "pass", errors: [] },
        events: [
          {
            eventName: "Event #9: Duplicate Name Check",
            date: "Dec 02",
            buyIn: 600,
            entries: 0,
            entriesText: "0",
            itm: 10,
            itmText: "10",
            prize: 50000,
            prizeText: "$50,000",
            winner: "Jane Doe",
            payoutUrl: "/tournaments/result/mock-duplicate/",
            status: "fail",
            errors: ["Invalid Entries count: 0"],
            crossCheck: { status: "pass", errors: [] }
          }
        ],
        defects: [
          {
            type: "Event metadata invalid",
            event: "Event #9: Duplicate Name Check",
            item: "Entries",
            expected: "> 0",
            actual: "0",
            detail: "Duplicate tournament name should still open the correct accordion card"
          }
        ]
      },
      {
        brand: "CLUBGG",
        seriesName: "Mock ClubGG Qualifiers",
        dateRange: "ClubGG Qualifiers",
        location: "Online",
        country: "USA",
        countryDisplay: "USA",
        url: "https://www.wsop.com/tournaments/mock-clubgg-qualifiers/",
        status: "warn",
        mode: "Case B (Schedule)",
        headerCheck: { status: "pass", errors: [] },
        events: [
          {
            eventName: "Qualifier Event",
            date: "Dec 01",
            buyIn: 0,
            buyInText: "$0",
            chipsText: "30,000",
            chips: 30000,
            clockText: "30",
            clock: 30,
            lateRegText: "Level 6",
            status: "warn",
            errors: [],
            warnings: ["Tournament date range could not be parsed: ClubGG Qualifiers"]
          }
        ],
        defects: []
      }
    ]
  };

  // Test Verifiers
  const headerTest1 = verifyHeader(
    { brand: "CIRCUIT", seriesName: "WSOP-C", dateRange: "Oct 24", location: "Las Vegas", country: "USA" },
    ["CIRCUIT", "WSOP-C", "Oct 24", "Las Vegas", "USA"]
  );
  if (headerTest1.status !== "pass") throw new Error("Self-test: verifyHeader failed on perfect match");

  const headerTest2 = verifyHeader(
    { brand: "CIRCUIT", seriesName: "WSOP-C", dateRange: "Oct 24", location: "Las Vegas", country: "USA" },
    ["EUROPE", "WSOP-C", "Oct 24", "Las Vegas", "USA"]
  );
  if (headerTest2.status !== "fail" || headerTest2.errors.length !== 1) {
    throw new Error("Self-test: verifyHeader failed to report brand mismatch");
  }

  if (classifyTournamentEventMode(true) !== "Case A (Results)") {
    throw new Error("Self-test: Result link should classify as Case A");
  }
  if (classifyTournamentEventMode(false) !== "Case B (Schedule)") {
    throw new Error("Self-test: missing Result link should classify as Case B");
  }

  const scheduleTest1 = validateCaseBEvent({
    date: "Oct 24",
    eventName: "Event #1",
    buyIn: 400,
    chips: 30000,
    chipsText: "30,000",
    clock: 30,
    clockText: "30"
  }, { dateRange: "Oct 24 - Nov 04, 2026", year: "2026" });
  if (scheduleTest1.status !== "pass") throw new Error("Self-test: validateCaseBEvent failed on normal schedule");

  const overlappingEventRangeTest = validateEventDateInTournamentRange(
    "Jan 05 12:00 PM ~ Jan 06 12:00 PM",
    "Jan 06 2025 - Jan 20 2025",
    "2025"
  );
  if (overlappingEventRangeTest.status !== "pass") {
    throw new Error("Self-test: event date range overlapping tournament start should pass");
  }

  const oneDayBoundaryDateTest = validateEventDateInTournamentRange(
    "Feb 19 02:00 PM ~ Feb 19 02:00 PM",
    "Feb 20 2025 - Mar 03 2025",
    "2025"
  );
  if (oneDayBoundaryDateTest.status !== "warn") {
    throw new Error("Self-test: one-day date boundary drift should warn");
  }

  const scheduleTest2 = validateCaseBEvent({
    date: "Oct 24",
    eventName: "Event #1",
    buyIn: 400,
    chips: 0,
    chipsText: "0",
    clock: 30,
    clockText: "30"
  }, { dateRange: "Oct 24 - Nov 04, 2026", year: "2026" });
  if (scheduleTest2.status !== "fail") throw new Error("Self-test: validateCaseBEvent failed to catch 0 chips");

  const onlineScheduleTest = validateCaseBEvent({
    date: "Oct 25",
    eventName: "Event #10: €250 No-Limit Hold'em PMU.fr (Online) - Flight A",
    buyIn: 250,
    chips: null,
    chipsText: "-",
    clock: null,
    clockText: "-"
  }, { dateRange: "Oct 24 - Nov 04, 2026", year: "2026" });
  if (onlineScheduleTest.status !== "warn" || onlineScheduleTest.warnings.length !== 2) {
    throw new Error("Self-test: online/flight schedule dash Chips/Clock should warn");
  }

  const outOfRangeScheduleTest = validateCaseBEvent({
    date: "Nov 21",
    eventName: "Event #99",
    buyIn: 400,
    chips: 30000,
    chipsText: "30,000",
    clock: 30,
    clockText: "30"
  }, { dateRange: "Oct 24 - Nov 04, 2026", year: "2026" });
  if (outOfRangeScheduleTest.status !== "fail") {
    throw new Error("Self-test: schedule event date outside tournament range should fail");
  }

  const resultTest1 = validateCaseAEvent({
    date: "Oct 24",
    eventName: "Event #1",
    buyIn: 550,
    entries: 138,
    entriesText: "138",
    itm: 15,
    itmText: "15",
    prize: 44850,
    prizeText: "€44,850",
    winner: "Daniel Dodet",
    payoutUrl: "/tournaments/result/99489/"
  }, { dateRange: "Oct 24 - Nov 04, 2026", year: "2026" });
  if (resultTest1.status !== "pass") throw new Error("Self-test: validateCaseAEvent failed on normal results");

  const outOfRangeResultTest = validateCaseAEvent({
    date: "Nov 21",
    eventName: "Event #1",
    buyIn: 550,
    entries: 138,
    entriesText: "138",
    itm: 15,
    itmText: "15",
    prize: 44850,
    prizeText: "€44,850",
    winner: "Daniel Dodet",
    payoutUrl: "/tournaments/result/99489/"
  }, { dateRange: "Oct 24 - Nov 04, 2026", year: "2026" });
  if (outOfRangeResultTest.status !== "fail") {
    throw new Error("Self-test: result event date outside tournament range should fail");
  }

  const crossTest1 = verifyPayoutDetails(
    { entries: 138, prize: 44850, winner: "Daniel Dodet" },
    { entries: 138, prize: 44850, winner: "Daniel Dodet", tableWinner: "Daniel Dodet" }
  );
  if (crossTest1.status !== "pass") throw new Error("Self-test: verifyPayoutDetails failed on correct match");

  const crossTest2 = verifyPayoutDetails(
    { entries: 138, prize: 44850, winner: "Daniel Dodet" },
    { entries: 130, prize: 44850, winner: "Daniel Dodet", tableWinner: "Daniel Dodet" }
  );
  if (crossTest2.status !== "fail") throw new Error("Self-test: verifyPayoutDetails failed to catch entries mismatch");

  // Output test assets
  const mockOut = "automation/output/wsop-tournament-crawler-self-test-data.json";
  const mockHtml = "automation/output/wsop-tournament-crawler-self-test-report.html";
  const mockCsv = "automation/output/wsop-tournament-crawler-self-test-defects.csv";
  const mockEventsCsv = "automation/output/wsop-tournament-crawler-self-test-events.csv";

  const mockArgs = { out: mockOut, html: mockHtml, defects: mockCsv, csv: mockEventsCsv };
  const mockKoHtml = writeReportArtifacts(mockArgs, testReport);

  console.log(`Self-Test reports successfully written to:`);
  console.log(` - JSON: ${mockOut}`);
  console.log(` - HTML: ${mockHtml}`);
  console.log(` - Events CSV:  ${mockEventsCsv}`);
  console.log(` - Defects CSV: ${mockCsv}`);
  console.log("=== Self-Test Completed Successfully ===");
}

// -------------------------------------------------------------
// Live Crawling Main Routine
// -------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`WSOP Tournament-Centric Crawler & Validator

Usage:
  node automation/crawl_tournaments.mjs [options]

Options:
  --year <year>         Past tournaments year page. Default: 2026
  --brand <name>        Filter by brand, e.g. CIRCUIT or BRACELETS. Default: null
  --concurrency <n>     Max parallel detail page checks. Default: 3
  --limit <n>           Max tournaments to crawl from the list. 0 means unlimited. Default: 0
  --event-limit <n>     Max events to collect per tournament. 0 means unlimited. Default: 0
  --result-limit <n>    Alias of --event-limit for dashboard/backward compatibility.
  --headed              Run Playwright browser with UI visible. Default: false
  --self-test           Run offline validation logic self-tests.
  --out <path>          JSON report path.
  --html <path>         Korean HTML dashboard path.
  --csv <path>          Flattened tournament/event CSV report path.
  --defects <path>      Defects list CSV path.
`);
    return;
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const startedAt = new Date().toISOString();
  console.log(`[시작] 토너먼트 크롤러 기동 (연도: ${args.year}, 브랜드 필터: ${args.brand || "전체"}, 동시성: ${args.concurrency}, 대회 제한: ${args.limit || "무제한"}, 이벤트 제한: ${args.eventLimit || "무제한"})`);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  const collectedCards = [];
  const uniqueUrls = new Set();

  const currentYear = new Date().getFullYear();
  const isAll = args.year.toUpperCase() === "ALL" || args.year.toUpperCase().split(/[|_]/).includes("ALL");
  const targetYears = isAll
    ? Array.from({ length: currentYear - 1970 + 1 }, (_, i) => String(currentYear - i))
    : args.year.split(/[|_]/).map(y => y.trim()).filter(Boolean);

  console.log(`[1/4] 수집 대상 연도 목록: ${targetYears.join(", ")}`);

  for (const y of targetYears) {
    const listUrl = `https://www.wsop.com/past-tournaments/${y}/`;
    console.log(`과거 대회 목록 페이지 진입 시도 (${y}): ${listUrl}`);

    try {
      await retryWithBackoff(async () => {
        await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3000);
      });
    } catch (e) {
      console.warn(`[경고] 연도 페이지 ${y} 로딩 실패 (스킵): ${e.message}`);
      continue;
    }

    // Apply UI brand filter tab if requested
    if (args.brand) {
      const brandUpper = args.brand.toUpperCase();
      console.log(`브랜드 필터 선택 시도: "${brandUpper}"`);
      const tabSelector = `.tab:has-text("${brandUpper}"), button.tab:has-text("${brandUpper}")`;
      const tabLocator = page.locator(tabSelector).first();

      if (await tabLocator.isVisible()) {
        await tabLocator.click();
        console.log(`필터 탭 클릭 성공. 2초 대기...`);
        await page.waitForTimeout(2000);
      } else {
        console.warn(`[경고] 브랜드 필터 탭 "${brandUpper}" 요소를 화면에서 발견하지 못했습니다. 메모리 상에서 매칭하여 필터링하겠습니다.`);
      }
    }

    // Crawl tournament card items
    console.log(`${y}년도 대회 목록 데이터 수집 중...`);
    const cardElements = await page.locator("a[href*='/tournaments/']").all();
    console.log(`${y}년도 전체 링크 발견 개수: ${cardElements.length}개`);

    for (const card of cardElements) {
      const href = await card.getAttribute("href");
      if (!href) continue;
      const url = href.startsWith("http") ? href : `https://www.wsop.com${href}`;
      if (uniqueUrls.has(url)) continue;
      uniqueUrls.add(url);

      const text = await card.innerText();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 3) continue; // Not a valid tournament card

      const brand = lines[0] || "";
      const seriesName = lines[1] || "";
      const dateRange = lines[2] || "";
      const location = lines[3] || "";
      const country = lines[4] || "";

      // Brand filtering in memory
      if (args.brand && !normalizeComparable(brand).includes(normalizeComparable(args.brand)) && !normalizeComparable(seriesName).includes(normalizeComparable(args.brand))) {
        continue;
      }

      const img = card.locator("img").first();
      const imgSrc = await img.isVisible() ? await img.getAttribute("src") : "";

      collectedCards.push({
        url,
        brand,
        seriesName,
        dateRange,
        location,
        country,
        imgSrc,
        countryDisplay: country || "Unknown Country",
        year: y
      });
    }
  }

  const targetCards = (args.limit && args.limit > 0) ? collectedCards.slice(0, args.limit) : collectedCards;
  console.log(`필터링 적용 후 수집 완료된 대상 대회 수: ${targetCards.length}개 (전체: ${collectedCards.length}개)`);

  const tournamentsResult = [];
  let passedCount = 0;
  let failedCount = 0;
  let totalDefectsCount = 0;
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
    console.warn(`${interruptedReason}. No new tournaments will start; writing partial report.`);
    if (writeProgressReport) writeProgressReport("interrupted");
  };

  writeProgressReport = (runStatus = "running") => {
    const report = buildTournamentReport({
      args,
      startedAt,
      finishedAt: new Date().toISOString(),
      targetCards,
      tournamentsResult,
      passedCount,
      failedCount,
      totalDefectsCount,
      runStatus,
      interruptedReason
    });
    const koreanHtml = writeReportArtifacts(args, report);
    return { report, koreanHtml };
  };

  process.on("SIGINT", handleStopSignal);
  process.on("SIGTERM", handleStopSignal);
  writeProgressReport("running");

  // Process details with concurrency limit
  console.log(`[4/4] 개별 대회 상세 페이지 검증 시작 (동시성: ${args.concurrency})...`);

  const chunk = async (card, index) => {
    console.log(`  [대회 ${index + 1}/${targetCards.length}] 진입 중: ${card.seriesName}`);
    const detPage = await context.newPage();
    const defects = [];
    let status = "pass";
    let mode = "Unknown";
    let headerCheck = { status: "pass", errors: [] };
    const events = [];

    try {
      await retryWithBackoff(async () => {
        await detPage.goto(card.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await detPage.waitForTimeout(3000);
      });

      // 1. Verify Header [Scenario 1]
      const kvElement = detPage.locator(".kv-contents").first();
      let headerLines = [];
      if (await kvElement.isVisible()) {
        const text = await kvElement.innerText();
        headerLines = text.split("\n").map(l => l.trim()).filter(Boolean);
      } else {
        // Fallback banner checking
        const h1Text = await detPage.locator("h1").first().innerText().catch(() => "");
        headerLines = [card.brand, h1Text, card.dateRange, card.location, card.country];
      }

      headerCheck = verifyHeader(card, headerLines);
      if (headerCheck.status === "fail") {
        status = "fail";
        headerCheck.errors.forEach(err => {
          defects.push({
            type: "Header mismatch",
            event: "Header Check",
            item: "Header integrity",
            expected: "Card matching header values",
            actual: err,
            detail: `Card detail compared to visual header layout: ${err}`
          });
        });
      }

      // 2. Classify event table type by actual Result link presence
      const eventTable = detPage.locator("table").first();
      if (await eventTable.isVisible()) {
        const resultLinkCount = await eventTable.locator(RESULT_LINK_SELECTOR).count();
        const isCaseA = resultLinkCount > 0;

        if (isCaseA) {
          mode = classifyTournamentEventMode(true);
          // Gather rows
          const rows = await eventTable.locator("tbody tr, tr").all();
          // The first row is headers if 'tbody' was not strictly defined, skip index 0 if header matches
          const startIndex = rows.length > 0 && (await rows[0].locator("th").count()) > 0 ? 1 : 0;

          let crossCheckCount = 0;
          for (let rIdx = startIndex; rIdx < rows.length; rIdx++) {
            const cells = await rows[rIdx].locator("td").allInnerTexts();
            if (cells.length < 5) continue; // Invalid row
            if (args.eventLimit > 0 && events.length >= args.eventLimit) break;

            // Mapping Case A: Date | Event | Buy-in | Entries | ITM | Prize | Winner | Payout
            const rawDate = cells[0] || "";
            const rawEvent = cells[1] || "";
            const rawBuyIn = cells[2] || "";
            const rawEntries = cells[3] || "";
            const rawItm = cells[4] || "";
            const rawPrize = cells[5] || "";
            const rawWinner = cells[6] || "";

            const payoutLink = rows[rIdx].locator(RESULT_LINK_SELECTOR).first();
            const payoutHref = (await payoutLink.count()) > 0 ? await payoutLink.getAttribute("href") : "";

            const eventObj = {
              eventName: normalizeText(rawEvent),
              date: normalizeText(rawDate),
              buyInText: normalizeText(rawBuyIn),
              buyIn: parseMoney(rawBuyIn),
              entriesText: normalizeText(rawEntries),
              entries: parseNumber(rawEntries),
              itmText: normalizeText(rawItm),
              itm: parseNumber(rawItm),
              prizeText: normalizeText(rawPrize),
              prize: parseMoney(rawPrize),
              winner: normalizeText(rawWinner),
              payoutUrl: payoutHref ? (payoutHref.startsWith("http") ? payoutHref : `https://www.wsop.com${payoutHref}`) : "",
              status: "pass",
              errors: [],
              warnings: [],
              crossCheck: null
            };

            // Validate fields [Scenario 2]
            const eventVal = validateCaseAEvent(eventObj, card);
            if (eventVal.status === "fail") {
              eventObj.status = "fail";
              status = "fail";
              eventObj.errors = eventVal.errors;
              eventObj.warnings = eventVal.warnings;
              eventVal.errors.forEach(err => {
                defects.push({
                  type: "Event metadata invalid",
                  event: eventObj.eventName,
                  item: "Format integrity",
                  expected: "Correctly parsed column formats",
                  actual: err,
                  detail: `Event list metadata validation failed: ${err}`
                });
              });
            } else if (eventVal.status === "warn") {
              eventObj.status = "warn";
              if (status === "pass") status = "warn";
              eventObj.warnings = eventVal.warnings;
            }

            // Cross check detail results page if payout url exists
            if (eventObj.payoutUrl) {
              if (args.eventLimit > 0 && crossCheckCount >= args.eventLimit) {
                eventObj.crossCheck = { status: "skipped", errors: [] };
                events.push(eventObj);
                continue;
              }
              crossCheckCount++;

              const crossPage = await context.newPage();
              try {
                await retryWithBackoff(async () => {
                  await crossPage.goto(eventObj.payoutUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
                  await crossPage.waitForTimeout(2000);
                });

                // Parse entries, prize, winner from .list-detail
                const listDetail = crossPage.locator("div.list-detail").first();
                const payoutData = { entries: null, prize: null, winner: "", tableWinner: "" };

                if (await listDetail.isVisible()) {
                  const detailText = await listDetail.innerText();
                  const dLines = detailText.split("\n").map(l => l.trim()).filter(Boolean);

                  for (let d = 0; d < dLines.length; d++) {
                    if (dLines[d] === "Entries" && dLines[d + 1]) {
                      payoutData.entries = parseNumber(dLines[d + 1]);
                    }
                    if (dLines[d] === "Prize" && dLines[d + 1]) {
                      payoutData.prize = parseMoney(dLines[d + 1]);
                    }
                    if (dLines[d] === "Winner" && dLines[d + 1]) {
                      payoutData.winner = normalizeText(dLines[d + 1]);
                    }
                  }
                }

                // Verify 1st place in result table
                const resTable = crossPage.locator("table").first();
                if (await resTable.isVisible()) {
                  const rows = await resTable.locator("tbody tr, tr").all();
                  for (const row of rows) {
                    const cells = await row.locator("th, td").allInnerTexts();
                    if (cells.length >= 2 && cells[0].trim() === "1") {
                      payoutData.tableWinner = normalizeText(cells[1]); // 2nd column is Player name
                      break;
                    }
                  }
                }

                const crossCheckResult = verifyPayoutDetails(eventObj, payoutData);
                eventObj.crossCheck = crossCheckResult;
                if (crossCheckResult.status === "fail") {
                  eventObj.status = "fail";
                  status = "fail";
                  crossCheckResult.errors.forEach(err => {
                    defects.push({
                      type: "Cross check mismatch",
                      event: eventObj.eventName,
                      item: "Payout page comparison",
                      expected: "Values matching payout detail page",
                      actual: err,
                      detail: `Payout page cross-check failed: ${err}`
                    });
                  });
                }
              } catch (crossErr) {
                console.error(`    [에러] 교차 검증 페이지 진입 실패: ${eventObj.payoutUrl} - ${crossErr.message}`);
                eventObj.crossCheck = { status: "fail", errors: [`Page load failed: ${crossErr.message}`] };
                eventObj.status = "fail";
                status = "fail";
                defects.push({
                  type: "Payout page unavailable",
                  event: eventObj.eventName,
                  item: "Results cross check link",
                  expected: "Results payout page is accessible",
                  actual: crossErr.message,
                  detail: `Payout results page load failure: ${eventObj.payoutUrl}`
                });
              } finally {
                await crossPage.close();
              }
            }

            events.push(eventObj);
          }
        } else {
          mode = classifyTournamentEventMode(false);
          const rows = await eventTable.locator("tbody tr, tr").all();
          const startIndex = rows.length > 0 && (await rows[0].locator("th").count()) > 0 ? 1 : 0;

          for (let rIdx = startIndex; rIdx < rows.length; rIdx++) {
            const cells = await rows[rIdx].locator("td").allInnerTexts();
            if (cells.length < 5) continue;
            if (args.eventLimit > 0 && events.length >= args.eventLimit) break;

            // Mapping Case B: Date | Event | Buy-in | Chips | Clock(min) | Late Reg
            const rawDate = cells[0] || "";
            const rawEvent = cells[1] || "";
            const rawBuyIn = cells[2] || "";
            const rawChips = cells[3] || "";
            const rawClock = cells[4] || "";
            const rawLateReg = cells[5] || "";

            const eventObj = {
              eventName: normalizeText(rawEvent),
              date: normalizeText(rawDate),
              buyInText: normalizeText(rawBuyIn),
              buyIn: parseMoney(rawBuyIn),
              chipsText: normalizeText(rawChips),
              chips: parseNumber(rawChips),
              clockText: normalizeText(rawClock),
              clock: parseNumber(rawClock),
              lateRegText: normalizeText(rawLateReg),
              status: "pass",
              errors: [],
              warnings: []
            };

            // Validate fields [Scenario 3]
            const eventVal = validateCaseBEvent(eventObj, card);
            if (eventVal.status === "fail") {
              eventObj.status = "fail";
              status = "fail";
              eventObj.errors = eventVal.errors;
              eventObj.warnings = eventVal.warnings;
              eventVal.errors.forEach(err => {
                defects.push({
                  type: "Schedule data invalid",
                  event: eventObj.eventName,
                  item: "Format integrity",
                  expected: "Correctly parsed column formats",
                  actual: err,
                  detail: `Schedule column validation failed: ${err}`
                });
              });
            } else if (eventVal.status === "warn") {
              eventObj.status = "warn";
              if (status === "pass") status = "warn";
              eventObj.warnings = eventVal.warnings;
            }

            events.push(eventObj);
          }
        }
      } else {
        console.warn(`    [경고] 대회 상세 페이지 내에 테이블(table)이 존재하지 않습니다.`);
        status = "warn";
      }

    } catch (detErr) {
      console.error(`    [에러] 대회 상세 크롤링 에러: ${card.seriesName} - ${detErr.message}`);
      status = "fail";
      defects.push({
        type: "Tournament page unavailable",
        event: "Page Check",
        item: "Detail page link",
        expected: "Tournament detail page is accessible",
        actual: detErr.message,
        detail: `Detail page load failure: ${card.url}`
      });
    } finally {
      await detPage.close();
    }

    if (status === "pass") passedCount++;
    else if (status === "fail") failedCount++;
    totalDefectsCount += defects.length;

    tournamentsResult.push({
      ...card,
      status,
      mode,
      headerCheck,
      events,
      defects
    });

    if (writeProgressReport) writeProgressReport(stopRequested ? "interrupted" : "running");
  };

  // Perform parallel checks based on concurrency
  const workers = [];
  for (let i = 0; i < targetCards.length; i++) {
    if (stopRequested) break;
    workers.push(chunk(targetCards[i], i));
    if (workers.length >= args.concurrency || i === targetCards.length - 1) {
      await Promise.all(workers);
      workers.length = 0; // reset
    }
  }

  await browser.close();
  process.removeListener("SIGINT", handleStopSignal);
  process.removeListener("SIGTERM", handleStopSignal);

  // Write outputs
  const { koreanHtml } = writeProgressReport(stopRequested ? "interrupted" : "complete");
  console.log(`[완료] JSON 데이터 저장 완료: ${args.out}`);
  console.log(`[완료] 영문 HTML 리포트 저장 완료: ${args.html}`);
  console.log(`[완료] 국문 HTML 리포트 저장 완료: ${koreanHtml}`);
  console.log(`[완료] 이벤트 CSV 저장 완료: ${args.csv}`);
  console.log(`[완료] 결함 CSV 저장 완료: ${args.defects}`);

  console.log(`\n=== 검증 최종 요약 ===`);
  console.log(`- 전체 대상 대회: ${targetCards.length}`);
  console.log(`- 통과(Pass): ${passedCount}`);
  console.log(`- 실패(Fail): ${failedCount}`);
  console.log(`- 결함 수: ${totalDefectsCount}`);
  if (stopRequested) process.exitCode = 130;
}

main().catch(err => {
  console.error("Fatal crawler error:", err);
  process.exit(1);
});
