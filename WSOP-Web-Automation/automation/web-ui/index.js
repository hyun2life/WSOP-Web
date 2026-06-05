document.addEventListener('DOMContentLoaded', () => {
  let phases = [];
  let selectedPhase = null;
  let isRunning = false;

  const defaultBrandOptions = [
    'WSOP',
    'GGPoker',
    'WPT',
    'PGT (Poker Go Tour)',
    'Irish Poker Open',
    'WSOP PARADISE',
    'WSOP EUROPE',
    'WSOP ASIA',
    'WSOP ONLINE',
    'WSOP CIRCUIT',
    'GGMASTERS',
    'GGMILLION$',
    'GGMILLIONS',
    'WPT PRIME',
    'TRITON',
    'PGT',
    'Irish Poker Tour',
  ];

  const phaseCopy = {
    phase1: {
      nameKo: '공개 페이지 기본 점검',
      shortSummaryKo: '주요 공개 페이지 로딩, 핵심 문구, 내비게이션, 콘솔 오류를 빠르게 확인합니다.',
      descriptionKo: '배포 후 공개 페이지가 정상 접근되는지 확인하는 smoke 검증입니다.',
      stepsKo: ['주요 공개 페이지 접근', '핵심 콘텐츠 확인', '내부 링크 샘플 확인', '콘솔 오류 수집', '리포트 생성'],
      passCriteriaKo: ['주요 페이지가 정상 응답해야 합니다.', '핵심 UI와 문구가 렌더링되어야 합니다.', '치명적인 콘솔 오류가 없어야 합니다.'],
    },
    phase2: {
      nameKo: '공개 기능 흐름 점검',
      shortSummaryKo: 'Schedule, Search, Standings, News 등 사용자 흐름을 확인합니다.',
      descriptionKo: '사용자가 공개 사이트에서 주요 정보를 탐색하는 흐름이 정상 동작하는지 검증합니다.',
      stepsKo: ['Tournament Schedule 흐름 확인', 'Player Search 흐름 확인', 'Player Standings 확인', 'News 상세 진입 확인', '리포트 생성'],
      passCriteriaKo: ['주요 링크와 상세 페이지 이동이 정상이어야 합니다.', '검색 결과 목록 UI가 깨지지 않아야 합니다.'],
    },
    phase3: {
      nameKo: '플레이어 표현 및 프로필 UI',
      shortSummaryKo: 'standings 대상 선수의 이름, 국기, 이미지, 프로필 링크, 특수 배지를 확인합니다.',
      descriptionKo: 'DB/API 통합값보다 공개 화면의 선수 표현과 연결 상태를 검증합니다.',
      stepsKo: ['standings-only 대상 수집', '선수 카드 표현 확인', '검색 프로필 연결 확인', 'HOF/POY 특수 프로필 확인', '리포트 생성'],
      passCriteriaKo: ['선수 이름과 프로필 링크가 정상이어야 합니다.', '국기/이미지/배지가 깨지지 않아야 합니다.'],
    },
    phase4: {
      nameKo: '검색 필터 및 정렬 회귀 점검',
      shortSummaryKo: '검색어, 필터, 정렬, 페이지 이동 UI를 확인합니다.',
      descriptionKo: 'Player Search와 Standings 목록에서 탐색 기능이 안정적으로 동작하는지 검증합니다.',
      stepsKo: ['검색어 입력 확인', '결과 없음/특수 검색 확인', '카테고리 전환 확인', '정렬/더보기 확인', '리포트 생성'],
      passCriteriaKo: ['검색 결과와 빈 상태가 정상 표시되어야 합니다.', '필터/정렬 조작 중 UI가 깨지지 않아야 합니다.'],
    },
    phase5: {
      nameKo: 'Result 상세 무결성 점검',
      shortSummaryKo: 'Result 상세 페이지 진입과 선수/순위/상금 표시를 확인합니다.',
      descriptionKo: '프로필 이벤트와 Result 상세 페이지 간 기본 연결 상태를 검증합니다.',
      stepsKo: ['프로필 이벤트 수집', 'Result 링크 진입', '최종 결과 표 확인', '불일치 후보 수집', '리포트 생성'],
      passCriteriaKo: ['Result 상세 페이지 접근이 가능해야 합니다.', '선수/순위/상금 정보 확인이 가능해야 합니다.'],
    },
    phase6: {
      nameKo: '데이터 API 정합성 점검',
      shortSummaryKo: '공개 UI와 기준 데이터의 정합성을 확인합니다.',
      descriptionKo: '수집 데이터와 fixture/API 기준값을 비교하는 정합성 검증입니다.',
      stepsKo: ['기준 데이터 준비', '공개 UI 데이터 수집', '값 비교', '불일치 후보 정리', '리포트 생성'],
      passCriteriaKo: ['필수 데이터가 누락되지 않아야 합니다.', '허용 범위를 벗어난 불일치는 리포트에 표시되어야 합니다.'],
    },
    phase7: {
      nameKo: '성능 및 안정성 점검',
      shortSummaryKo: '주요 흐름의 반복 실행 안정성과 지연을 확인합니다.',
      descriptionKo: '반복 실행 중 flaky 현상과 주요 성능 지표를 점검합니다.',
      stepsKo: ['주요 흐름 반복 실행', '지연 및 실패 수집', '경고 항목 정리', '리포트 생성'],
      passCriteriaKo: ['반복 실행 중 필수 흐름이 안정적으로 완료되어야 합니다.'],
    },
    phase8: {
      nameKo: '시각 회귀 점검',
      shortSummaryKo: '스크린샷 기준으로 주요 화면 레이아웃 변화를 확인합니다.',
      descriptionKo: 'baseline 대비 화면 깨짐이나 레이아웃 변화가 있는지 검증합니다.',
      stepsKo: ['주요 화면 캡처', 'baseline 비교', '변경 영역 확인', '리포트 생성'],
      passCriteriaKo: ['허용 범위를 벗어난 시각 차이가 없어야 합니다.'],
    },
    phase9: {
      nameKo: '전체 회귀 검증',
      shortSummaryKo: '릴리즈 전 주요 Phase를 묶어 최종 회귀 범위를 검증합니다.',
      descriptionKo: '릴리즈 게이트 기준으로 필수 검증을 순차 실행합니다.',
      stepsKo: ['회귀 suite 선택', '필수 Phase 실행', '경고/실패 집계', '릴리즈 게이트 결과 생성'],
      passCriteriaKo: ['필수 검증이 통과해야 하며, 실패 사유가 리포트에 남아야 합니다.'],
    },
    crawler: {
      nameKo: '플레이어 스탠딩 크롤러',
      shortSummaryKo: 'Live/Stage standings 대상 선수를 수집하고 프로필 또는 Result 검증 리포트를 생성합니다.',
      descriptionKo: '브랜드 필터, standings-only, profile-only, full 모드를 선택해 선수 데이터를 수집합니다.',
      stepsKo: ['브랜드와 환경 선택', '실제 화면 브랜드 옵션 수집', 'standings 대상 수집', '선택 모드에 따라 프로필 또는 Result 검증', 'JSON/HTML/CSV 산출물 생성'],
      passCriteriaKo: ['실제 화면의 브랜드 옵션 목록이 JSON에 저장되어야 합니다.', '지정한 조건의 대상 선수가 수집되어야 합니다.', '선택한 모드에 맞는 리포트가 생성되어야 합니다.'],
    },
    'tournament-crawler': {
      nameKo: '토너먼트 크롤러',
      shortSummaryKo: '과거 대회 목록과 일정을 수집하고 헤더 및 개별 이벤트 데이터 정합성을 검증합니다.',
      descriptionKo: '특정 연도의 과거 대회 목록에서 이미지, 브랜드, 시리즈명 등을 수집하고 헤더 정합성 및 개별 결과(Payout)와의 교차 데이터 정합성을 검증합니다.',
      stepsKo: ['과거 대회 목록 페이지 수집', '상세 대회 헤더 데이터와 카드 정보 1:1 비교 검증', 'Case A: 결과 있음 상세 데이터 추출 및 Payout 페이지와 교차 정합성 대조', 'Case B: 결과 없음 상세 일정 데이터 포맷 누락 여부 검사', '토너먼트 크롤러 JSON, HTML, CSV 산출물 생성'],
      passCriteriaKo: ['토너먼트 크롤러 배치 파일 실행이 정상 완료되어야 합니다.', '상세 결과(Payout) 페이지의 데이터(우승자, 참가자, 상금)와 이벤트 리스트의 데이터가 완전히 일치해야 합니다.'],
    },
  };
  const phaseListContainer = document.getElementById('phase-list-container');
  const detailId = document.getElementById('detail-id');
  const detailName = document.getElementById('detail-name');
  const detailReport = document.getElementById('detail-report');
  const detailDir = document.getElementById('detail-dir');
  const detailDesc = document.getElementById('detail-desc');
  const detailSteps = document.getElementById('detail-steps');
  const detailCriteria = document.getElementById('detail-criteria');

  const modeSelect = document.getElementById('mode-select');
  const envSelect = document.getElementById('env-select');
  const customEnvUrlContainer = document.getElementById('custom-env-url-container');
  const customEnvUrl = document.getElementById('custom-env-url');
  const crawlerOptionsPanel = document.getElementById('crawler-options');
  const pwOptionsPanel = document.getElementById('pw-options');
  const brandListContainer = document.getElementById('opt-brand-list-container');
  const customBrandContainer = document.getElementById('custom-brand-container');
  const customBrandInput = document.getElementById('custom-brand-input');
  const profileBrandSelect = document.getElementById('opt-profile-brand-select');
  const customProfileBrandContainer = document.getElementById('custom-profile-brand-container');
  const customProfileBrandInput = document.getElementById('custom-profile-brand-input');

  const btnRun = document.getElementById('btn-run');
  const btnKill = document.getElementById('btn-kill');
  const btnShutdown = document.getElementById('btn-shutdown');
  const btnReportKo = document.getElementById('btn-report-ko');
  const btnReportEn = document.getElementById('btn-report-en');
  const btnReportPw = document.getElementById('btn-report-pw');
  const btnClearLog = document.getElementById('btn-clear-log');
  const btnCopyLog = document.getElementById('btn-copy-log');
  const consoleOutput = document.getElementById('console-output');
  const statusIndicator = document.getElementById('status-indicator');
  const reportPickerModal = document.getElementById('report-picker-modal');
  const reportPickerBackdrop = document.getElementById('report-picker-backdrop');
  const reportPickerSelect = document.getElementById('report-picker-select');
  const reportPickerSubtitle = document.getElementById('report-picker-subtitle');
  const btnReportOpenSelected = document.getElementById('btn-report-open-selected');
  const btnReportPickerCancel = document.getElementById('btn-report-picker-cancel');

  let pendingReportSelection = null;

  const crawlerOpts = {
    year: { chk: document.getElementById('opt-year-check'), arg: 'year' },
    season: { chk: document.getElementById('opt-season-check'), arg: 'season' },
    profileBrand: { chk: document.getElementById('opt-profile-brand-check'), arg: 'profile-brand' },
    profileSeason: { chk: document.getElementById('opt-profile-season-check'), input: document.getElementById('opt-profile-season-input'), arg: 'profile-season' },
    limit: { chk: document.getElementById('opt-limit-check'), input: document.getElementById('opt-limit-input'), arg: 'limit' },
    auth: { chk: document.getElementById('opt-auth-check'), input: document.getElementById('opt-auth-input'), arg: 'auth-wait-ms' },
    concurrency: { chk: document.getElementById('opt-concurrency-check'), input: document.getElementById('opt-concurrency-input'), arg: 'concurrency' },
    reslimit: { chk: document.getElementById('opt-reslimit-check'), input: document.getElementById('opt-reslimit-input'), arg: 'result-limit' },
    brand: { chk: document.getElementById('opt-brand-check'), arg: 'brand' },
    standingsOnly: { chk: document.getElementById('opt-standingsonly-check'), input: document.getElementById('opt-standingsonly-input'), arg: 'standings-only' },
    profileOnly: { chk: document.getElementById('opt-profileonly-check'), input: document.getElementById('opt-profileonly-input'), arg: 'profile-only' },
  };

  const pwOpts = {
    grep: { chk: document.getElementById('opt-grep-check'), input: document.getElementById('opt-grep-input'), arg: 'grep' },
    timeout: { chk: document.getElementById('opt-timeout-check'), input: document.getElementById('opt-timeout-input'), arg: 'timeout' },
    repeat: { chk: document.getElementById('opt-repeat-check'), input: document.getElementById('opt-repeat-input'), arg: 'repeat-each' },
    retries: { chk: document.getElementById('opt-retries-check'), input: document.getElementById('opt-retries-input'), arg: 'retries' },
  };

  initializeYearOptions();
  initializeStandingsSeasonOptions();
  renderBrandOptions(defaultBrandOptions, { sourceLabel: '기본 브랜드 목록' });
  setupCheckboxToggles(crawlerOpts);
  setupCheckboxToggles(pwOpts);
  setupExclusiveCrawlerModes();
  syncProfileBrandControls();

  function initializeStandingsSeasonOptions() {
    const seasonContainer = document.getElementById('opt-season-list-container');
    if (!seasonContainer) return;
    seasonContainer.innerHTML = '';
    const currentYear = new Date().getFullYear();

    for (let y = currentYear; y >= 1970; y--) {
      const item = createSeasonCheckbox(String(y), String(y), y === 2026);
      seasonContainer.appendChild(item);
    }

    seasonContainer.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.name === 'opt-season') {
        syncStandingsSeasonControls();
      }
    });

    syncStandingsSeasonControls();
  }

  function createSeasonCheckbox(value, label, checked) {
    const div = document.createElement('div');
    div.className = 'season-checkbox-item';
    div.innerHTML = `
      <label class="custom-checkbox">
        <input type="checkbox" name="opt-season" value="${escapeHtml(value)}" ${checked ? 'checked' : ''}>
        <span class="checkmark"></span>${escapeHtml(label)}
      </label>
    `;
    return div;
  }

  function syncStandingsSeasonControls() {
    const seasonEnabled = Boolean(crawlerOpts.season?.chk?.checked);
    document.querySelectorAll('input[name="opt-season"]').forEach((chk) => {
      chk.disabled = !seasonEnabled;
    });
  }

  function initializeYearOptions() {
    const yearContainer = document.getElementById('opt-year-list-container');
    if (!yearContainer) return;
    yearContainer.innerHTML = '';
    const currentYear = new Date().getFullYear();
    const allItem = createYearCheckbox('ALL', 'ALL (전체)', true);
    yearContainer.appendChild(allItem);

    for (let y = currentYear; y >= 1970; y--) {
      const item = createYearCheckbox(String(y), String(y), false);
      yearContainer.appendChild(item);
    }

    yearContainer.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.name === 'opt-year') {
        if (target.value === 'ALL') {
          if (target.checked) {
            document.querySelectorAll('input[name="opt-year"]').forEach(chk => {
              if (chk.value !== 'ALL') chk.checked = false;
            });
          }
        } else {
          if (target.checked) {
            const allChk = yearContainer.querySelector('input[name="opt-year"][value="ALL"]');
            if (allChk) allChk.checked = false;
          }
        }
        syncYearControls();
      }
    });

    syncYearControls();
  }

  function createYearCheckbox(value, label, checked) {
    const div = document.createElement('div');
    div.className = 'year-checkbox-item';
    div.innerHTML = `
      <label class="custom-checkbox">
        <input type="checkbox" name="opt-year" value="${escapeHtml(value)}" ${checked ? 'checked' : ''}>
        <span class="checkmark"></span>${escapeHtml(label)}
      </label>
    `;
    return div;
  }

  function syncYearControls() {
    const yearEnabled = Boolean(crawlerOpts.year?.chk?.checked);
    const allChk = document.querySelector('input[name="opt-year"][value="ALL"]');
    const isAllChecked = allChk && allChk.checked;

    document.querySelectorAll('input[name="opt-year"]').forEach((chk) => {
      if (!yearEnabled) {
        chk.disabled = true;
      } else {
        if (isAllChecked && chk.value !== 'ALL') {
          chk.disabled = true;
        } else {
          chk.disabled = false;
        }
      }
    });
  }

  envSelect.addEventListener('change', () => {
    customEnvUrlContainer.classList.toggle('hidden', envSelect.value !== 'Custom');
  });

  initSse();
  loadPhases();
  loadBrandOptions();

  function withReadablePhaseCopy(phase) {
    const copy = phaseCopy[phase.id];
    return copy ? { ...phase, ...copy } : phase;
  }

  function createAllPhase() {
    return {
      id: 'all',
      name: 'All Implemented Phases',
      nameKo: '전체 실행',
      reportSuite: 'all',
      testDir: 'All active test directories',
      implemented: true,
      shortSummaryKo: '구현 완료된 Phase를 순서대로 실행합니다.',
      descriptionKo: '현재 ready 상태의 모든 구현 Phase를 순차 실행합니다. 전체 점검이 필요할 때 사용합니다.',
      stepsKo: ['ready Phase 목록 확인', 'Phase 1 Smoke 실행', 'Phase 2 Functional 실행', 'Phase 3 Player Presentation 실행', '각 Phase 리포트 확인'],
      passCriteriaKo: ['구현 완료된 Phase가 순서대로 실행되어야 합니다.', '각 Phase 결과가 리포트에 남아야 합니다.'],
    };
  }

  function loadPhases() {
    fetch('/api/phases')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load phases registry');
        return res.json();
      })
      .then((data) => {
        phases = (data.phases || []).map(withReadablePhaseCopy);
        renderPhaseCards();
        checkRunningStatus();
      })
      .catch((err) => {
        appendSystemLog(`Phase 설정을 불러오지 못했습니다: ${err.message}`, 'text-error');
      });
  }

  function loadBrandOptions() {
    fetch('/api/brand-options')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load brand options');
        return res.json();
      })
      .then((data) => {
        const options = Array.isArray(data.options) && data.options.length ? data.options : defaultBrandOptions;
        renderBrandOptions(options, data);
      })
      .catch((err) => {
        appendSystemLog(`브랜드 옵션 목록을 불러오지 못했습니다. 기본 목록을 사용합니다: ${err.message}`, 'text-muted');
        renderBrandOptions(defaultBrandOptions, { sourceLabel: '기본 브랜드 목록' });
      });
  }

  function renderBrandOptions(options, meta = {}) {
    if (!brandListContainer) return;

    const selected = new Set(Array.from(document.querySelectorAll('input[name="opt-brand"]:checked')).map((input) => input.value));
    const brandEnabled = Boolean(crawlerOpts.brand?.chk?.checked);
    const uniqueOptions = uniqueLabels(options).filter((brand) => brand.toLowerCase() !== 'custom');
    const sourceLabel = meta.sourceLabel || (meta.source === 'latest-crawler-json' ? '최근 크롤러 JSON' : '기본 브랜드 목록');

    brandListContainer.innerHTML = [
      `<div class="brand-options-meta" style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.75rem; padding-bottom: 4px;">브랜드 옵션: ${escapeHtml(`${uniqueOptions.length}개`)} · ${escapeHtml(sourceLabel)}</div>`,
      ...uniqueOptions.map((brand) => `
        <div class="brand-checkbox-item">
          <label class="custom-checkbox">
            <input type="checkbox" name="opt-brand" value="${escapeHtml(brand)}" ${brandEnabled ? '' : 'disabled'} ${selected.has(brand) ? 'checked' : ''}>
            <span class="checkmark"></span>${escapeHtml(brand)}
          </label>
        </div>
      `),
      `<div class="brand-checkbox-item">
        <label class="custom-checkbox">
          <input type="checkbox" name="opt-brand" value="Custom" id="opt-brand-custom-chk" ${brandEnabled ? '' : 'disabled'} ${selected.has('Custom') ? 'checked' : ''}>
          <span class="checkmark"></span>Custom...
        </label>
      </div>`,
    ].join('');

    bindCustomBrandToggle();
    syncBrandControls();
  }

  function uniqueLabels(values) {
    const seen = new Set();
    const result = [];
    (values || []).forEach((value) => {
      const label = String(value || '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(label);
    });
    return result;
  }

  function bindCustomBrandToggle() {
    const customBrandChk = document.getElementById('opt-brand-custom-chk');
    if (customBrandChk && customBrandContainer) {
      customBrandChk.addEventListener('change', syncBrandControls);
    }

    const profileBrandChk = document.getElementById('opt-profile-brand-check');
    if (profileBrandChk) {
      profileBrandChk.addEventListener('change', syncProfileBrandControls);
    }
    if (profileBrandSelect) {
      profileBrandSelect.addEventListener('change', syncProfileBrandControls);
    }
  }

  function syncBrandControls() {
    const brandEnabled = Boolean(crawlerOpts.brand?.chk?.checked);
    document.querySelectorAll('input[name="opt-brand"]').forEach((chk) => {
      chk.disabled = !brandEnabled;
    });

    const customBrandChk = document.getElementById('opt-brand-custom-chk');
    const showCustom = brandEnabled && Boolean(customBrandChk?.checked);
    if (customBrandContainer) customBrandContainer.classList.toggle('hidden', !showCustom);
    if (customBrandInput) customBrandInput.disabled = !showCustom;
  }

  function syncProfileBrandControls() {
    const profileBrandChk = document.getElementById('opt-profile-brand-check');
    const enabled = Boolean(profileBrandChk && profileBrandChk.checked);
    if (profileBrandSelect) profileBrandSelect.disabled = !enabled;

    const showCustom = enabled && Boolean(profileBrandSelect && profileBrandSelect.value === 'Custom');
    if (customProfileBrandContainer) customProfileBrandContainer.classList.toggle('hidden', !showCustom);
    if (customProfileBrandInput) customProfileBrandInput.disabled = !showCustom;
  }

  function setupAccordion(toggleEl, contentEl, defaultCollapsed = false) {
    if (!toggleEl || !contentEl) return;

    const icon = toggleEl.querySelector('.accordion-icon');
    const text = toggleEl.querySelector('.toggle-text');

    const applyState = (collapsed) => {
      contentEl.classList.toggle('collapsed', collapsed);
      if (icon) {
        icon.classList.toggle('collapsed', collapsed);
        icon.textContent = collapsed ? '▸' : '▾';
      }
      if (text) text.textContent = collapsed ? '펼치기' : '접기';
    };

    applyState(defaultCollapsed);

    toggleEl.addEventListener('click', (event) => {
      event.stopPropagation();
      applyState(!contentEl.classList.contains('collapsed'));
    });
  }

  function renderPhaseCards() {
    phaseListContainer.innerHTML = '';

    const allGroup = createPhaseGroup('전체 실행', 'all-group-toggle');
    const phaseGroup = createPhaseGroup('Playwright 검증 Phase', 'phase-group-toggle');
    const crawlerGroup = createPhaseGroup('데이터 크롤러', 'crawler-group-toggle');

    const allContent = allGroup.querySelector('.phase-group-content');
    const phaseContent = phaseGroup.querySelector('.phase-group-content');
    const crawlerContent = crawlerGroup.querySelector('.phase-group-content');

    const activeList = createListContainer();
    phaseContent.appendChild(activeList);

    const plannedSubHeader = document.createElement('div');
    plannedSubHeader.className = 'sub-group-header';
    plannedSubHeader.innerHTML = `
      <span>준비 중인 Phase</span>
      <button class="accordion-toggle" id="planned-toggle" type="button">
        <span class="accordion-icon collapsed">▸</span>
        <span class="toggle-text">펼치기</span>
      </button>
    `;
    phaseContent.appendChild(plannedSubHeader);

    const plannedContent = document.createElement('div');
    plannedContent.className = 'accordion-content collapsed';
    plannedContent.id = 'planned-accordion-content';
    phaseContent.appendChild(plannedContent);

    const crawlerList = createListContainer();
    crawlerContent.appendChild(crawlerList);

    const allPhase = createAllPhase();
    appendPhaseCard(allPhase, allContent);

    phases.forEach((phase) => {
      if (phase.id === 'crawler' || phase.id === 'tournament-crawler') {
        appendPhaseCard(phase, crawlerList);
      } else if (phase.implemented) {
        appendPhaseCard(phase, activeList);
      } else {
        appendPhaseCard(phase, plannedContent);
      }
    });

    phaseListContainer.appendChild(allGroup);
    phaseListContainer.appendChild(phaseGroup);
    phaseListContainer.appendChild(crawlerGroup);

    setupAccordion(allGroup.querySelector('#all-group-toggle'), allContent, false);
    setupAccordion(phaseGroup.querySelector('#phase-group-toggle'), phaseContent, false);
    setupAccordion(crawlerGroup.querySelector('#crawler-group-toggle'), crawlerContent, false);
    setupAccordion(phaseGroup.querySelector('#planned-toggle'), plannedContent, true);

    selectPhase(allPhase);
  }

  function createPhaseGroup(title, toggleId) {
    const group = document.createElement('div');
    group.className = 'phase-group';

    const header = document.createElement('div');
    header.className = 'phase-group-header';
    header.innerHTML = `
      <span>${title}</span>
      <button class="accordion-toggle" id="${toggleId}" type="button">
        <span class="accordion-icon">▾</span>
        <span class="toggle-text">접기</span>
      </button>
    `;
    group.appendChild(header);

    const content = document.createElement('div');
    content.className = 'phase-group-content';
    group.appendChild(content);

    return group;
  }

  function createListContainer() {
    const list = document.createElement('div');
    list.className = 'phase-group-list';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    return list;
  }

  function appendPhaseCard(phase, parentContainer) {
    const card = document.createElement('div');
    const statusText = phase.implemented ? 'ready' : 'planned';
    const statusKo = phase.implemented ? '준비됨' : '예정';

    card.className = 'phase-card';
    card.dataset.id = phase.id;
    card.innerHTML = `
      <div class="phase-header">
        <span class="phase-id">${escapeHtml(phase.id)}</span>
        <span class="phase-badge ${statusText}">${statusKo}</span>
      </div>
      <div class="phase-name">${escapeHtml(displayName(phase))}</div>
      <div class="phase-summary">${escapeHtml(phase.shortSummaryKo || phase.descriptionKo || phase.description || '')}</div>
      ${phase.stepsKo?.length ? `<div class="phase-step-count">${phase.stepsKo.length}개 검증 스텝</div>` : ''}
    `;

    card.addEventListener('click', () => selectPhase(phase));
    parentContainer.appendChild(card);
  }

  function selectPhase(phase) {
    selectedPhase = phase;

    document.querySelectorAll('.phase-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.id === phase.id);
    });

    detailId.textContent = phase.id;
    detailName.textContent = displayName(phase);
    detailReport.textContent = phase.reportSuite || '-';
    detailDir.textContent = phase.testDir || '-';
    detailDesc.textContent = phase.descriptionKo || phase.description || '-';
    renderPhaseSteps(phase.stepsKo || []);
    renderPhaseCriteria(phase.passCriteriaKo || []);

    crawlerOptionsPanel.classList.toggle('hidden', phase.id !== 'crawler' && phase.id !== 'phase3' && phase.id !== 'tournament-crawler');
    pwOptionsPanel.classList.toggle('hidden', phase.id === 'crawler' || phase.id === 'tournament-crawler' || phase.id === 'all');

    const isTournament = phase.id === 'tournament-crawler';
    const optionsGrid = crawlerOptionsPanel.querySelector('.options-grid');
    if (optionsGrid) {
      optionsGrid.classList.toggle('mode-tournament', isTournament);
      optionsGrid.classList.toggle('mode-player', !isTournament);
    }

    updateLabelsAndTooltips(isTournament);

    const soChk = document.getElementById('opt-standingsonly-check');
    const poChk = document.getElementById('opt-profileonly-check');
    if (soChk) {
      if (phase.id === 'phase3') {
        if (!soChk.disabled) {
          soChk.dataset.prevChecked = soChk.checked ? 'true' : 'false';
        }
        soChk.checked = true;
        soChk.disabled = true;
      } else {
        if (soChk.disabled && soChk.dataset.prevChecked) {
          soChk.checked = soChk.dataset.prevChecked === 'true';
        }
        delete soChk.dataset.prevChecked;
        soChk.disabled = false;
      }
    }
    if (poChk) {
      if (phase.id === 'phase3') {
        poChk.dataset.prevChecked = poChk.checked ? 'true' : 'false';
        poChk.checked = false;
        poChk.disabled = true;
      } else {
        if (poChk.disabled && poChk.dataset.prevChecked) {
          poChk.checked = poChk.dataset.prevChecked === 'true';
        }
        delete poChk.dataset.prevChecked;
        poChk.disabled = false;
      }
    }

    btnRun.disabled = !phase.implemented || isRunning;

    if (!phase.implemented || phase.id === 'all') {
      btnReportKo.disabled = true;
      btnReportEn.disabled = true;
      btnReportPw.disabled = true;
    } else if (phase.id === 'crawler' || phase.id === 'tournament-crawler') {
      btnReportKo.disabled = false;
      btnReportEn.disabled = false;
      btnReportPw.disabled = true;
    } else {
      btnReportKo.disabled = false;
      btnReportEn.disabled = false;
      btnReportPw.disabled = false;
    }

    function updateLabelsAndTooltips(isTournament) {
      const limitLabel = crawlerOpts.limit.chk.parentNode;
      const concurrencyLabel = crawlerOpts.concurrency.chk.parentNode;
      const resultLimitLabel = crawlerOpts.reslimit.chk.parentNode;
      if (!limitLabel || !concurrencyLabel || !resultLimitLabel) return;

      const limitHelp = limitLabel.querySelector('.help-icon');
      const concurrencyHelp = concurrencyLabel.querySelector('.help-icon');
      const resultLimitHelp = resultLimitLabel.querySelector('.help-icon');

      if (isTournament) {
        replaceLabelText(limitLabel, 'Limit Tournaments');
        if (limitHelp) limitHelp.setAttribute('data-tooltip', '수집할 토너먼트(대회) 수를 제한합니다. 빠른 확인에는 2~3개를 권장합니다.');

        replaceLabelText(concurrencyLabel, 'Concurrency');
        if (concurrencyHelp) concurrencyHelp.setAttribute('data-tooltip', '동시에 처리할 토너먼트(대회) 수입니다. 값이 높을수록 빠르지만 브라우저와 메모리 사용량이 늘어납니다.');

        replaceLabelText(resultLimitLabel, 'Limit Events');
        if (resultLimitHelp) resultLimitHelp.setAttribute('data-tooltip', '대회별로 수집할 이벤트 수를 제한합니다. 체크하지 않거나 0이면 가능한 전체 이벤트를 확인합니다.');
      } else {
        replaceLabelText(limitLabel, 'Limit Players');
        if (limitHelp) limitHelp.setAttribute('data-tooltip', '카테고리별로 수집할 선수 수를 제한합니다. 빠른 확인에는 5~10명을 권장합니다.');

        replaceLabelText(concurrencyLabel, 'Concurrency');
        if (concurrencyHelp) concurrencyHelp.setAttribute('data-tooltip', '동시에 처리할 선수 수입니다. 값이 높을수록 빠르지만 브라우저와 메모리 사용량이 늘어납니다.');

        replaceLabelText(resultLimitLabel, 'Result Limit');
        if (resultLimitHelp) resultLimitHelp.setAttribute('data-tooltip', '선수별로 검증할 Result 상세 페이지 수입니다. 0이면 가능한 전체 Result를 확인합니다.');
      }
    }

    function replaceLabelText(labelEl, newText) {
      for (let node of labelEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
          node.textContent = ' ' + newText + ' ';
          break;
        }
      }
    }
  }

  function renderPhaseSteps(steps) {
    detailSteps.innerHTML = '';

    if (!steps.length) {
      const item = document.createElement('li');
      item.textContent = '아직 검증 스텝이 등록되지 않았습니다.';
      detailSteps.appendChild(item);
      return;
    }

    steps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      detailSteps.appendChild(item);
    });
  }

  function renderPhaseCriteria(criteria) {
    detailCriteria.innerHTML = '';

    if (!criteria.length) {
      const item = document.createElement('li');
      item.textContent = '합격 기준이 등록되지 않았습니다.';
      detailCriteria.appendChild(item);
      return;
    }

    criteria.forEach((criterion) => {
      const item = document.createElement('li');
      item.textContent = criterion;
      detailCriteria.appendChild(item);
    });
  }

  function setupCheckboxToggles(optGroup) {
    Object.values(optGroup).forEach((item) => {
      if (!item.chk) return;
      item.chk.addEventListener('change', () => {
        if (item.arg === 'brand') {
          syncBrandControls();
        } else if (item.arg === 'year') {
          syncYearControls();
        } else if (item.arg === 'season') {
          syncStandingsSeasonControls();
        } else if (item.input) {
          item.input.disabled = !item.chk.checked;
        }
      });
    });
  }

  function setupExclusiveCrawlerModes() {
    const standingsOnly = crawlerOpts.standingsOnly?.chk;
    const profileOnly = crawlerOpts.profileOnly?.chk;
    if (!standingsOnly || !profileOnly) return;

    standingsOnly.addEventListener('change', () => {
      if (standingsOnly.checked) profileOnly.checked = false;
    });

    profileOnly.addEventListener('change', () => {
      if (profileOnly.checked) standingsOnly.checked = false;
    });
  }

  function initSse() {
    const sse = new EventSource('/api/logs');

    sse.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'log' && message.text) {
          appendConsoleLog(message.text);
        }

        if (message.type === 'status') {
          updateExecutionStatus(message.status);
        }

        if (message.type === 'phase-status' && message.phaseId) {
          updatePhaseCardStatus(message.phaseId, message.status);
        }

        if (message.type === 'phase-statuses' && message.phaseStatuses) {
          updateAllPhaseStatuses(message.phaseStatuses);
        }
      } catch (err) {
        console.error('SSE message parsing error:', err);
      }
    };

    sse.onerror = (err) => {
      console.error('SSE connection lost. Reconnecting...', err);
      appendSystemLog('SSE 연결이 끊겼습니다. 백그라운드에서 재연결을 시도합니다.', 'text-muted');
    };
  }

  function checkRunningStatus() {
    fetch('/api/status')
      .then((res) => {
        if (!res.ok) throw new Error('Status check failed');
        return res.json();
      })
      .then((data) => {
        if (data.phaseStatuses) {
          updateAllPhaseStatuses(data.phaseStatuses);
        }

        if (data.isRunning && data.phaseId) {
          updateExecutionStatus('running');
          const phaseToSelect = data.phaseId === 'all' ? createAllPhase() : phases.find((p) => p.id === data.phaseId);
          if (phaseToSelect) {
            selectPhase(phaseToSelect);
          }
          appendSystemLog(`이전 테스트(${data.phaseId})가 백그라운드에서 여전히 실행 중입니다.`, 'text-system');
        }
      })
      .catch((err) => {
        console.error('Failed to restore running status:', err);
      });
  }

  function updatePhaseCardStatus(phaseId, status) {
    const card = document.querySelector(`.phase-card[data-id="${phaseId}"]`);
    if (!card) return;

    card.classList.remove('running', 'success', 'failed', 'warning');
    if (status === 'running' || status === 'success' || status === 'failed' || status === 'warning') {
      card.classList.add(status);
    }

    const badge = card.querySelector('.phase-badge');
    if (badge) {
      badge.classList.remove('ready', 'planned', 'running', 'success', 'failed', 'warning');

      let badgeClass = status;
      let badgeText = '준비됨';

      if (status === 'ready') {
        badgeClass = 'ready';
        badgeText = '준비됨';
      } else if (status === 'running') {
        badgeClass = 'running';
        badgeText = '진행 중';
      } else if (status === 'success') {
        badgeClass = 'success';
        badgeText = '통과';
      } else if (status === 'failed') {
        badgeClass = 'failed';
        badgeText = '실패';
      } else if (status === 'warning') {
        badgeClass = 'warning';
        badgeText = '주의';
      } else if (status === 'planned') {
        badgeClass = 'planned';
        badgeText = '예정';
      }

      badge.className = `phase-badge ${badgeClass}`;
      badge.textContent = badgeText;
    }
  }

  function updateAllPhaseStatuses(statuses) {
    Object.entries(statuses).forEach(([phaseId, status]) => {
      updatePhaseCardStatus(phaseId, status);
    });
  }

  function appendConsoleLog(text) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (index === lines.length - 1 && line === '') return;

      const div = document.createElement('div');
      div.className = 'console-line';

      if (line.includes('[SERVER_ERROR]') || line.includes('[ERROR]') || line.includes('fail')) {
        div.classList.add('text-error');
      } else if (line.includes('[SERVER]') || line.includes('Starting')) {
        div.classList.add('text-system');
      } else if (line.includes('[SYSTEM]') || line.startsWith('===')) {
        div.classList.add('text-muted');
      } else if (line.includes('Opening') || line.includes('report:')) {
        div.classList.add('text-info');
      }

      div.textContent = line;
      consoleOutput.appendChild(div);
    });

    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function appendSystemLog(text, className = '') {
    const div = document.createElement('div');
    div.className = `console-line ${className}`;
    div.textContent = `[SYSTEM] ${text}`;
    consoleOutput.appendChild(div);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function updateExecutionStatus(status) {
    statusIndicator.className = `status-indicator ${status}`;

    let label = 'Ready';
    if (status === 'running') {
      label = 'Running';
      isRunning = true;
      btnRun.classList.add('hidden');
      btnKill.classList.remove('hidden');
    } else {
      if (status === 'success') label = 'Success';
      if (status === 'failed') label = 'Failed';
      if (status === 'warning') label = 'Warning';
      isRunning = false;
      btnRun.classList.remove('hidden');
      btnKill.classList.add('hidden');
      if (selectedPhase) {
        btnRun.disabled = !selectedPhase.implemented;
      }
    }

    statusIndicator.innerHTML = `<span class="status-dot"></span>${label}`;
  }

  btnRun.addEventListener('click', () => {
    if (!selectedPhase || isRunning) return;

    phases.forEach((phase) => {
      if (phase.implemented) {
        updatePhaseCardStatus(phase.id, 'ready');
      }
    });
    updatePhaseCardStatus('crawler', 'ready');

    const mode = modeSelect.value;
    const customArgs = {};
    let baseUrl = '';

    if (envSelect.value === 'Live') {
      baseUrl = 'https://www.wsop.com';
    } else if (envSelect.value === 'Stage') {
      baseUrl = 'https://wsop-stage.ggnweb.com';
    } else if (envSelect.value === 'Custom') {
      baseUrl = customEnvUrl.value.trim();
    }

    if (selectedPhase.id === 'crawler' || selectedPhase.id === 'phase3' || selectedPhase.id === 'tournament-crawler') {
      Object.values(crawlerOpts).forEach((opt) => {
        if (!opt.chk || !opt.chk.checked) return;
        if (selectedPhase.id === 'phase3' && opt.arg === 'profile-only') return;

        const argName = selectedPhase.id === 'tournament-crawler' && opt.arg === 'result-limit'
          ? 'event-limit'
          : opt.arg;

        if (argName === 'brand') {
          const selectedBrands = [];
          const brandChks = document.querySelectorAll('input[name="opt-brand"]:checked');
          brandChks.forEach((chk) => {
            if (chk.value === 'Custom') {
              const customInput = document.getElementById('custom-brand-input');
              if (customInput && customInput.value.trim()) {
                selectedBrands.push(customInput.value.trim());
              }
            } else {
              selectedBrands.push(chk.value);
            }
          });
          customArgs[argName] = selectedBrands.join('|');
        } else if (argName === 'profile-brand') {
          const selectVal = profileBrandSelect ? profileBrandSelect.value : 'WSOP';
          if (selectVal === 'Custom') {
            customArgs[argName] = customProfileBrandInput ? customProfileBrandInput.value.trim() : '';
          } else {
            customArgs[argName] = selectVal;
          }
        } else if (argName === 'year') {
          const selectedYears = [];
          const yearChks = document.querySelectorAll('input[name="opt-year"]:checked');
          yearChks.forEach((chk) => {
            selectedYears.push(chk.value);
          });
          customArgs[argName] = selectedYears.join('|');
        } else if (argName === 'season') {
          const selectedSeasons = [];
          const seasonChks = document.querySelectorAll('input[name="opt-season"]:checked');
          seasonChks.forEach((chk) => {
            selectedSeasons.push(chk.value);
          });
          customArgs[argName] = selectedSeasons.join('|');
        } else if (argName === 'standings-only' || argName === 'profile-only') {
          customArgs[argName] = true;
        } else if (opt.input) {
          customArgs[argName] = opt.input.value.trim();
        }
      });
    }

    if (selectedPhase.id !== 'crawler' && selectedPhase.id !== 'all') {
      Object.values(pwOpts).forEach((opt) => {
        if (opt.chk && opt.chk.checked && opt.input) customArgs[opt.arg] = opt.input.value.trim();
      });
    }

    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseId: selectedPhase.id, mode, customArgs, baseUrl }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('API request failed');
        return res.json();
      })
      .catch((err) => {
        appendSystemLog(`테스트 실행 요청 실패: ${err.message}`, 'text-error');
      });
  });

  btnKill.addEventListener('click', () => {
    fetch('/api/kill', { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error('API request failed');
        return res.json();
      })
      .catch((err) => {
        appendSystemLog(`중단 요청 실패: ${err.message}`, 'text-error');
      });
  });

  async function triggerOpenReport(reportMode) {
    if (!selectedPhase) return;
    const suite = selectedPhase.reportSuite || selectedPhase.id;

    try {
      const listRes = await fetch(`/api/report-list?suite=${encodeURIComponent(suite)}&mode=${encodeURIComponent(reportMode)}`);
      if (!listRes.ok) throw new Error('Report list API request failed');
      const data = await listRes.json();
      const reports = Array.isArray(data.reports) ? data.reports : [];

      if (reports.length === 0) {
        appendSystemLog(`${suite}에 대한 ${reportMode} 리포트를 찾지 못했습니다.`, 'text-error');
        return;
      }

      showReportPicker({ suite, mode: reportMode, reports });
    } catch (err) {
      appendSystemLog(`리포트 목록 요청 실패: ${err.message}`, 'text-error');
    }
  }

  async function openReport(suite, mode, reportPath) {
    const payload = { suite, mode };
    if (reportPath) {
      payload.reportPath = reportPath;
    }

    const res = await fetch('/api/open-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('Report API request failed');
    }
  }

  function showReportPicker({ suite, mode, reports }) {
    if (!reportPickerModal || !reportPickerSelect) {
      openReport(suite, mode, reports[0].path).catch((err) => {
        appendSystemLog(`리포트 열기 실패: ${err.message}`, 'text-error');
      });
      return;
    }

    pendingReportSelection = { suite, mode, reports };
    reportPickerSelect.innerHTML = '';

    reports.forEach((report, index) => {
      const option = document.createElement('option');
      option.value = report.path;
      const ts = formatReportTimestamp(report.modifiedAt);
      option.textContent = `${String(index + 1).padStart(2, '0')}. ${report.displayName}${ts ? ` (${ts})` : ''}`;
      reportPickerSelect.appendChild(option);
    });

    const modeLabel = mode === 'ko' ? 'KO' : mode === 'en' ? 'EN' : 'PW';
    if (reportPickerSubtitle) {
      reportPickerSubtitle.textContent = `${suite} / ${modeLabel} 리포트 목록 (${reports.length})`;
    }

    reportPickerModal.classList.remove('hidden');
    reportPickerSelect.focus();
  }

  function closeReportPicker() {
    if (!reportPickerModal) return;
    reportPickerModal.classList.add('hidden');
    pendingReportSelection = null;
  }

  function formatReportTimestamp(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }

  btnReportKo.addEventListener('click', () => triggerOpenReport('ko'));
  btnReportEn.addEventListener('click', () => triggerOpenReport('en'));
  btnReportPw.addEventListener('click', () => triggerOpenReport('playwright'));

  if (btnReportPickerCancel) {
    btnReportPickerCancel.addEventListener('click', closeReportPicker);
  }

  if (reportPickerBackdrop) {
    reportPickerBackdrop.addEventListener('click', closeReportPicker);
  }

  if (btnReportOpenSelected) {
    btnReportOpenSelected.addEventListener('click', async () => {
      if (!pendingReportSelection || !reportPickerSelect) return;

      const selectedPath = reportPickerSelect.value;
      if (!selectedPath) return;

      try {
        await openReport(pendingReportSelection.suite, pendingReportSelection.mode, selectedPath);
        closeReportPicker();
      } catch (err) {
        appendSystemLog(`리포트 열기 실패: ${err.message}`, 'text-error');
      }
    });
  }

  btnClearLog.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    appendSystemLog('콘솔 화면을 비웠습니다.', 'text-muted');
  });

  btnCopyLog.addEventListener('click', () => {
    navigator.clipboard.writeText(consoleOutput.innerText)
      .then(() => appendSystemLog('콘솔 로그를 클립보드에 복사했습니다.', 'text-muted'))
      .catch((err) => console.error('Copy failed:', err));
  });

  btnShutdown.addEventListener('click', () => {
    if (!confirm('대시보드 서버를 종료할까요?\n종료 후에는 Run.bat을 다시 실행해야 합니다.')) {
      return;
    }

    appendSystemLog('대시보드 서버 종료 요청 중...', 'text-system');
    fetch('/api/shutdown', { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error('Shutdown request failed');
        return res.json();
      })
      .then(() => {
        appendSystemLog('서버가 정상 종료되었습니다. 브라우저 창을 닫아주세요.', 'text-muted');
        alert('대시보드 서버가 종료되었습니다. 브라우저 창을 닫아주세요.');
        btnRun.disabled = true;
        btnKill.disabled = true;
        btnShutdown.disabled = true;
        document.body.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background-color:#060913; color:#9CA3AF; font-family:sans-serif; gap:15px;">
            <h1 style="color:#EF4444; margin-bottom:5px; font-size:2.5rem; font-weight:700;">Dashboard Stopped</h1>
            <p style="font-size:1.1rem;">WSOP Web 대시보드 서버가 안전하게 종료되었습니다.</p>
            <p style="font-size:0.85rem; color:#4B5563; margin-top:10px;">브라우저 창을 닫아도 됩니다. 다시 실행하려면 Run.bat을 더블클릭하세요.</p>
          </div>
        `;
      })
      .catch((err) => {
        appendSystemLog(`종료 요청 실패: ${err.message}`, 'text-error');
      });
  });

  function displayName(phase) {
    return phase.nameKo || phase.name || phase.id;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
});
