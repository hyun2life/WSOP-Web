export function normalizeText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKD') // Unicode whitespace and character normalize
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ''); // 완화된 구두점 제거
}

export function normalizePlayerName(value: string | null | undefined): string {
  if (!value) return '';
  const text = normalizeText(value);
  // suffix (e.g. jr, sr, iii) 및 불필요한 중간 수식 무시 완화
  return text
    .replace(/\b(jr|sr|iii|ii|iv)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.round(value);

  const cleanString = String(value)
    .replace(/[$,\s]/g, '')
    .trim();

  const parsed = parseFloat(cleanString);
  return isNaN(parsed) ? null : Math.round(parsed);
}

export function normalizeInteger(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.floor(value);

  // # 7 또는 7th, 1555th, rank 12 등에서 숫자만 추출하기 위한 정규식 처리
  const rawText = String(value).replace(/,/g, '').trim();
  const match = rawText.match(/-?\d+/);
  if (!match) return null;

  const parsed = parseInt(match[0], 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * TODO: 향후 필요 시 date-fns 또는 dayjs를 결합해 타임존 및 로케일별 날짜 포맷팅(예: "Jun 08, 2024" vs "2024-06-08")을 엄격하게 처리하도록 확장 가능.
 * 현재 단계에서는 공백과 영문 대소문자, 반점(,)을 무시하고 문자열 포함 관계나 완전 일치를 판단할 수 있는 수준으로 단순화함.
 */
export function normalizeDateText(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeUrlPath(value: string | null | undefined): string {
  if (!value) return '';
  let path = String(value).trim().toLowerCase();

  try {
    // 절대 URL인 경우 pathname 추출
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const url = new URL(path);
      path = url.pathname;
    }
  } catch {
    // URL 파싱 실패 시 원본 문자열 사용
  }

  // trailing slash 제거 및 중복 슬래시 제거
  return path
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/^\//, '');
}
