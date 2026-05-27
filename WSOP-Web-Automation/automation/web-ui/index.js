document.addEventListener('DOMContentLoaded', () => {
  let phases = [];
  let selectedPhase = null;
  let isRunning = false;

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

  const crawlerOpts = {
    limit: { chk: document.getElementById('opt-limit-check'), input: document.getElementById('opt-limit-input'), arg: 'limit' },
    auth: { chk: document.getElementById('opt-auth-check'), input: document.getElementById('opt-auth-input'), arg: 'auth-wait-ms' },
    concurrency: { chk: document.getElementById('opt-concurrency-check'), input: document.getElementById('opt-concurrency-input'), arg: 'concurrency' },
    reslimit: { chk: document.getElementById('opt-reslimit-check'), input: document.getElementById('opt-reslimit-input'), arg: 'result-limit' },
  };

  const pwOpts = {
    grep: { chk: document.getElementById('opt-grep-check'), input: document.getElementById('opt-grep-input'), arg: 'grep' },
    timeout: { chk: document.getElementById('opt-timeout-check'), input: document.getElementById('opt-timeout-input'), arg: 'timeout' },
    repeat: { chk: document.getElementById('opt-repeat-check'), input: document.getElementById('opt-repeat-input'), arg: 'repeat-each' },
    retries: { chk: document.getElementById('opt-retries-check'), input: document.getElementById('opt-retries-input'), arg: 'retries' },
  };

  setupCheckboxToggles(crawlerOpts);
  setupCheckboxToggles(pwOpts);

  envSelect.addEventListener('change', () => {
    customEnvUrlContainer.classList.toggle('hidden', envSelect.value !== 'Custom');
  });

  initSse();
  loadPhases();

  function loadPhases() {
    fetch('/api/phases')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load phases registry');
        return res.json();
      })
      .then((data) => {
        phases = data.phases || [];
        renderPhaseCards();
        checkRunningStatus();
      })
      .catch((err) => {
        appendSystemLog(`Phase 설정을 불러오지 못했습니다: ${err.message}`, 'text-error');
      });
  }

  function setupAccordion(toggleEl, contentEl, defaultCollapsed = false) {
    if (!toggleEl || !contentEl) return;

    const icon = toggleEl.querySelector('.accordion-icon');
    const text = toggleEl.querySelector('.toggle-text');

    const applyState = (collapsed) => {
      contentEl.classList.toggle('collapsed', collapsed);
      if (icon) {
        icon.classList.toggle('collapsed', collapsed);
        icon.textContent = '▾';
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
        <span class="accordion-icon collapsed">▾</span>
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

    const allPhase = {
      id: 'all',
      name: 'All Implemented Phases',
      nameKo: '준비 완료 Phase 전체 실행',
      reportSuite: 'all',
      testDir: 'All active test directories',
      implemented: true,
      shortSummaryKo: 'ready 상태의 모든 Phase를 순차적으로 실행합니다.',
      descriptionKo: '현재 구현되어 ready 상태인 모든 Playwright Phase를 순차적으로 실행합니다. 전체 점검이 필요할 때 사용합니다.',
      stepsKo: [
        'ready 상태의 Phase 목록 확인',
        'Phase 1 Smoke 실행',
        'Phase 2 Functional Flow 실행',
        'Phase 3 Player Presentation 실행',
        '각 Phase별 리포트 생성 확인',
      ],
    };
    appendPhaseCard(allPhase, allContent);

    phases.forEach((phase) => {
      if (phase.id === 'crawler') {
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

    crawlerOptionsPanel.classList.toggle('hidden', phase.id !== 'crawler' && phase.id !== 'phase3');
    pwOptionsPanel.classList.toggle('hidden', phase.id === 'crawler' || phase.id === 'all');

    btnRun.disabled = !phase.implemented || isRunning;

    if (!phase.implemented || phase.id === 'all') {
      btnReportKo.disabled = true;
      btnReportEn.disabled = true;
      btnReportPw.disabled = true;
    } else if (phase.id === 'crawler') {
      btnReportKo.disabled = false;
      btnReportEn.disabled = false;
      btnReportPw.disabled = true;
    } else {
      btnReportKo.disabled = false;
      btnReportEn.disabled = false;
      btnReportPw.disabled = false;
    }
  }

  function renderPhaseSteps(steps) {
    detailSteps.innerHTML = '';

    if (!steps.length) {
      const item = document.createElement('li');
      item.textContent = '아직 세부 검증 스텝이 등록되지 않았습니다.';
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
      item.textContent = '합격 검수 기준 정보가 등록되지 않았습니다.';
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
      item.chk.addEventListener('change', () => {
        item.input.disabled = !item.chk.checked;
      });
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

          const allPhase = {
            id: 'all',
            name: 'All Implemented Phases',
            nameKo: '준비 완료 Phase 전체 실행',
            reportSuite: 'all',
            testDir: 'All active test directories',
            implemented: true,
            shortSummaryKo: 'ready 상태의 모든 Phase를 순차적으로 실행합니다.',
            descriptionKo: '현재 구현되어 ready 상태인 모든 Playwright Phase를 순차적으로 실행합니다. 전체 점검이 필요할 때 사용합니다.',
            stepsKo: [
              'ready 상태의 Phase 목록 확인',
              'Phase 1 Smoke 실행',
              'Phase 2 Functional Flow 실행',
              'Phase 3 Player Presentation 실행',
              '각 Phase별 리포트 생성 확인',
            ],
          };

          const phaseToSelect = data.phaseId === 'all' ? allPhase : phases.find(p => p.id === data.phaseId);
          if (phaseToSelect) {
            selectPhase(phaseToSelect);
          }
          appendSystemLog(`[SYSTEM] 이전 테스트(${data.phaseId})가 백그라운드에서 여전히 실행 중입니다.`, 'text-system');
        }
      })
      .catch((err) => {
        console.error('Failed to restore running status:', err);
      });
  }

  function updatePhaseCardStatus(phaseId, status) {
    const card = document.querySelector(`.phase-card[data-id="${phaseId}"]`);
    if (!card) return;

    card.classList.remove('running', 'success', 'failed');
    if (status === 'running' || status === 'success' || status === 'failed') {
      card.classList.add(status);
    }

    const badge = card.querySelector('.phase-badge');
    if (badge) {
      badge.classList.remove('ready', 'planned', 'running', 'success', 'failed');
      
      let badgeClass = status;
      let badgeText = '준비됨';

      if (status === 'ready') {
        badgeClass = 'ready';
        badgeText = '준비됨';
      } else if (status === 'running') {
        badgeClass = 'running';
        badgeText = '진행중';
      } else if (status === 'success') {
        badgeClass = 'success';
        badgeText = '통과';
      } else if (status === 'failed') {
        badgeClass = 'failed';
        badgeText = '실패';
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

    // Reset all implemented phase cards to ready status
    phases.forEach(p => {
      if (p.implemented) {
        updatePhaseCardStatus(p.id, 'ready');
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

    if (selectedPhase.id === 'crawler' || selectedPhase.id === 'phase3') {
      Object.values(crawlerOpts).forEach((opt) => {
        if (opt.chk.checked) customArgs[opt.arg] = opt.input.value.trim();
      });
    }
    if (selectedPhase.id !== 'crawler' && selectedPhase.id !== 'all') {
      Object.values(pwOpts).forEach((opt) => {
        if (opt.chk.checked) customArgs[opt.arg] = opt.input.value.trim();
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

  function triggerOpenReport(reportMode) {
    if (!selectedPhase) return;

    fetch('/api/open-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: selectedPhase.reportSuite, mode: reportMode }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Report API request failed');
        return res.json();
      })
      .catch((err) => {
        appendSystemLog(`리포트 열기 실패: ${err.message}`, 'text-error');
      });
  }

  btnReportKo.addEventListener('click', () => triggerOpenReport('ko'));
  btnReportEn.addEventListener('click', () => triggerOpenReport('en'));
  btnReportPw.addEventListener('click', () => triggerOpenReport('playwright'));

  btnClearLog.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    appendSystemLog('Console 화면을 비웠습니다.', 'text-muted');
  });

  btnCopyLog.addEventListener('click', () => {
    navigator.clipboard.writeText(consoleOutput.innerText)
      .then(() => appendSystemLog('Console 로그를 클립보드에 복사했습니다.', 'text-muted'))
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
