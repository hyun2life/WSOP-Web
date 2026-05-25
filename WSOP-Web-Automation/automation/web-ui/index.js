document.addEventListener('DOMContentLoaded', () => {
  let phases = [];
  let selectedPhase = null;
  let isRunning = false;

  // DOM Elements
  const phaseListContainer = document.getElementById('phase-list-container');
  const detailId = document.getElementById('detail-id');
  const detailName = document.getElementById('detail-name');
  const detailReport = document.getElementById('detail-report');
  const detailDir = document.getElementById('detail-dir');
  const detailDesc = document.getElementById('detail-desc');

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

  // Checkbox & Inputs Elements mapping
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

  // Bind checkbox toggle states
  setupCheckboxToggles(crawlerOpts);
  setupCheckboxToggles(pwOpts);

  // Target environment custom URL selector toggle
  envSelect.addEventListener('change', () => {
    if (envSelect.value === 'Custom') {
      customEnvUrlContainer.classList.remove('hidden');
    } else {
      customEnvUrlContainer.classList.add('hidden');
    }
  });

  // Initialize SSE (Server-Sent Events) for real-time console streaming
  initSse();

  // 1. Fetch available phases config from backend
  fetch('/api/phases')
    .then(res => {
      if (!res.ok) throw new Error('Failed to load phases registry');
      return res.json();
    })
    .then(data => {
      phases = data.phases || [];
      renderPhaseCards();
    })
    .catch(err => {
      appendSystemLog(`[ERROR] 페이즈 설정을 불러오지 못했습니다: ${err.message}`, 'text-error');
    });

  // 1. Helper function for toggleable accordion binding
  function setupAccordion(toggleEl, contentEl, defaultCollapsed = false) {
    const icon = toggleEl.querySelector('.accordion-icon');
    const text = toggleEl.querySelector('.toggle-text');

    if (defaultCollapsed) {
      contentEl.classList.add('collapsed');
      if (icon) {
        icon.classList.add('collapsed');
        icon.textContent = '▼';
      }
      if (text) text.textContent = '펼치기';
    } else {
      contentEl.classList.remove('collapsed');
      if (icon) {
        icon.classList.remove('collapsed');
        icon.textContent = '▲';
      }
      if (text) text.textContent = '접기';
    }

    toggleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = contentEl.classList.contains('collapsed');
      if (isCollapsed) {
        contentEl.classList.remove('collapsed');
        if (icon) {
          icon.classList.remove('collapsed');
          icon.textContent = '▲';
        }
        if (text) text.textContent = '접기';
      } else {
        contentEl.classList.add('collapsed');
        if (icon) {
          icon.classList.add('collapsed');
          icon.textContent = '▼';
        }
        if (text) text.textContent = '펼치기';
      }
    });
  }

  // Render Sidebar Cards with Hierarchical (Nested) Accordion
  function renderPhaseCards() {
    phaseListContainer.innerHTML = '';

    // 1. Create All Group (전체 점검)
    const allGroup = document.createElement('div');
    allGroup.className = 'phase-group';
    
    const allHeader = document.createElement('div');
    allHeader.className = 'phase-group-header';
    allHeader.innerHTML = `
      <span>전체 점검 (All)</span>
      <button class="accordion-toggle" id="all-group-toggle" type="button">
        <span class="accordion-icon">▲</span>
        <span class="toggle-text">접기</span>
      </button>
    `;
    allGroup.appendChild(allHeader);

    const allContent = document.createElement('div');
    allContent.className = 'phase-group-content';
    allGroup.appendChild(allContent);

    // 2. Create Playwright Phase Group (Playwright 검증)
    const phaseGroup = document.createElement('div');
    phaseGroup.className = 'phase-group';

    const phaseHeader = document.createElement('div');
    phaseHeader.className = 'phase-group-header';
    phaseHeader.innerHTML = `
      <span>Playwright 검증 (Phases)</span>
      <button class="accordion-toggle" id="phase-group-toggle" type="button">
        <span class="accordion-icon">▲</span>
        <span class="toggle-text">접기</span>
      </button>
    `;
    phaseGroup.appendChild(phaseHeader);

    const phaseContent = document.createElement('div');
    phaseContent.className = 'phase-group-content';
    phaseGroup.appendChild(phaseContent);

    const activeList = document.createElement('div');
    activeList.className = 'phase-group-list';
    activeList.style.display = 'flex';
    activeList.style.flexDirection = 'column';
    activeList.style.gap = '8px';
    phaseContent.appendChild(activeList);

    // Subgroup Accordion for Inactive (Planned) Phases inside Phase Group
    const plannedSubHeader = document.createElement('div');
    plannedSubHeader.className = 'sub-group-header';
    plannedSubHeader.innerHTML = `
      <span>준비 중인 단계</span>
      <button class="accordion-toggle" id="planned-toggle" type="button">
        <span class="accordion-icon collapsed">▼</span>
        <span class="toggle-text">펼치기</span>
      </button>
    `;
    phaseContent.appendChild(plannedSubHeader);

    const plannedContent = document.createElement('div');
    plannedContent.className = 'accordion-content collapsed';
    plannedContent.id = 'planned-accordion-content';
    phaseContent.appendChild(plannedContent);

    // 3. Create Crawler Group (데이터 크롤러)
    const crawlerGroup = document.createElement('div');
    crawlerGroup.className = 'phase-group';

    const crawlerHeader = document.createElement('div');
    crawlerHeader.className = 'phase-group-header';
    crawlerHeader.innerHTML = `
      <span>데이터 크롤러 (Crawler)</span>
      <button class="accordion-toggle" id="crawler-group-toggle" type="button">
        <span class="accordion-icon">▲</span>
        <span class="toggle-text">접기</span>
      </button>
    `;
    crawlerGroup.appendChild(crawlerHeader);

    const crawlerContent = document.createElement('div');
    crawlerContent.className = 'phase-group-content';
    crawlerGroup.appendChild(crawlerContent);

    const crawlerList = document.createElement('div');
    crawlerList.className = 'phase-group-list';
    crawlerList.style.display = 'flex';
    crawlerList.style.flexDirection = 'column';
    crawlerList.style.gap = '8px';
    crawlerContent.appendChild(crawlerList);

    // Add virtual 'all' phase card in Group 1
    const allPhase = {
      id: 'all',
      name: 'All Implemented Phases',
      reportSuite: 'all',
      testDir: 'All active test directories',
      description: 'ready 상태의 모든 단계를 순차적으로 실행합니다. 전체 점검이 필요할 때 사용합니다.',
      implemented: true
    };
    appendPhaseCard(allPhase, allContent);

    // Distribute phases
    phases.forEach(phase => {
      if (phase.id === 'crawler') {
        // Group 3
        appendPhaseCard(phase, crawlerList);
      } else {
        // Group 2 (Phases 1-9)
        if (phase.implemented) {
          appendPhaseCard(phase, activeList);
        } else {
          appendPhaseCard(phase, plannedContent);
        }
      }
    });

    phaseListContainer.appendChild(allGroup);
    phaseListContainer.appendChild(phaseGroup);
    phaseListContainer.appendChild(crawlerGroup);

    // Setup Accordions using the helper function
    const allGroupToggle = allGroup.querySelector('#all-group-toggle');
    setupAccordion(allGroupToggle, allContent, false); // 기본 펼침

    const phaseGroupToggle = phaseGroup.querySelector('#phase-group-toggle');
    setupAccordion(phaseGroupToggle, phaseContent, false); // 기본 펼침

    const crawlerGroupToggle = crawlerGroup.querySelector('#crawler-group-toggle');
    setupAccordion(crawlerGroupToggle, crawlerContent, false); // 기본 펼침

    const plannedToggle = phaseGroup.querySelector('#planned-toggle');
    setupAccordion(plannedToggle, plannedContent, true); // 기본 접힘

    // Default select first item (all)
    selectPhase(allPhase);
  }

  function appendPhaseCard(phase, parentContainer) {
    const card = document.createElement('div');
    card.className = 'phase-card';
    card.dataset.id = phase.id;

    const statusText = phase.implemented ? 'ready' : 'planned';
    card.innerHTML = `
      <div class="phase-header">
        <span class="phase-id">${phase.id}</span>
        <span class="phase-badge ${statusText}">${statusText}</span>
      </div>
      <div class="phase-name">${phase.name}</div>
    `;

    card.addEventListener('click', () => selectPhase(phase));
    parentContainer.appendChild(card);
  }

  // Handle phase card selection
  function selectPhase(phase) {
    selectedPhase = phase;

    // Highlight card
    document.querySelectorAll('.phase-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === phase.id);
    });

    // Populate Details Card
    detailId.textContent = phase.id;
    detailName.textContent = phase.name;
    detailReport.textContent = phase.reportSuite;
    detailDir.textContent = phase.testDir;
    detailDesc.textContent = phase.description;

    // Adjust Options Panels Visibility based on phase ID
    if (phase.id === 'crawler') {
      crawlerOptionsPanel.classList.remove('hidden');
      pwOptionsPanel.classList.add('hidden');
    } else if (phase.id === 'all') {
      crawlerOptionsPanel.classList.add('hidden');
      pwOptionsPanel.classList.add('hidden');
    } else {
      crawlerOptionsPanel.classList.add('hidden');
      pwOptionsPanel.classList.remove('hidden');
    }

    // Adjust run button
    btnRun.disabled = !phase.implemented || isRunning;

    // Adjust Report Buttons permissions
    if (!phase.implemented || phase.id === 'all') {
      btnReportKo.disabled = true;
      btnReportEn.disabled = true;
      btnReportPw.disabled = true;
    } else if (phase.id === 'crawler') {
      btnReportKo.disabled = false;
      btnReportEn.disabled = false;
      btnReportPw.disabled = true; // Crawler does not have a playwright trace report
    } else {
      btnReportKo.disabled = false;
      btnReportEn.disabled = false;
      btnReportPw.disabled = false;
    }
  }

  // Setup options checkbox interactive inputs
  function setupCheckboxToggles(optGroup) {
    Object.values(optGroup).forEach(item => {
      item.chk.addEventListener('change', () => {
        item.input.disabled = !item.chk.checked;
      });
    });
  }

  // 2. Initialize SSE connection
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
      } catch (err) {
        console.error('SSE Message parsing error:', err);
      }
    };

    sse.onerror = (err) => {
      console.error('SSE connection lost. Reconnecting...', err);
      appendSystemLog('SSE connection disconnected. Reconnecting in background...', 'text-muted');
    };
  }

  // Append dynamic text to Virtual Terminal Log
  function appendConsoleLog(text) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (index === lines.length - 1 && line === '') return;

      const div = document.createElement('div');
      div.className = 'console-line';

      // Advanced Log coloring based on level/prefix text
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

    // Smooth Auto Scroll to Bottom
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function appendSystemLog(text, className = '') {
    const div = document.createElement('div');
    div.className = `console-line ${className}`;
    div.textContent = `[SYSTEM] ${text}`;
    consoleOutput.appendChild(div);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  // Sync state indicators
  function updateExecutionStatus(status) {
    statusIndicator.className = `status-indicator ${status}`;

    // Status dot color mapping
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

  // 3. Execution Control Buttons
  btnRun.addEventListener('click', () => {
    if (!selectedPhase || isRunning) return;

    const mode = modeSelect.value;
    const customArgs = {};

    // Get Target Environment URL
    let baseUrl = '';
    const envVal = envSelect.value;
    if (envVal === 'Live') {
      baseUrl = 'https://www.wsop.com';
    } else if (envVal === 'Stage') {
      baseUrl = 'https://wsop-stage.ggnweb.com';
    } else if (envVal === 'Custom') {
      baseUrl = customEnvUrl.value.trim();
    }

    // Collect custom arguments
    if (selectedPhase.id === 'crawler') {
      Object.values(crawlerOpts).forEach(opt => {
        if (opt.chk.checked) {
          customArgs[opt.arg] = opt.input.value.trim();
        }
      });
    } else if (selectedPhase.id !== 'all') {
      Object.values(pwOpts).forEach(opt => {
        if (opt.chk.checked) {
          customArgs[opt.arg] = opt.input.value.trim();
        }
      });
    }

    // Call run API
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseId: selectedPhase.id, mode, customArgs, baseUrl })
    })
      .then(res => {
        if (!res.ok) throw new Error('API request failed');
        return res.json();
      })
      .catch(err => {
        appendSystemLog(`[ERROR] 테스트 실행 요청 실패: ${err.message}`, 'text-error');
      });
  });

  btnKill.addEventListener('click', () => {
    fetch('/api/kill', { method: 'POST' })
      .then(res => {
        if (!res.ok) throw new Error('API request failed');
        return res.json();
      })
      .catch(err => {
        appendSystemLog(`[ERROR] 중단 요청 실패: ${err.message}`, 'text-error');
      });
  });

  // 4. Report Operations API
  function triggerOpenReport(reportMode) {
    if (!selectedPhase) return;

    fetch('/api/open-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: selectedPhase.reportSuite, mode: reportMode })
    })
      .then(res => {
        if (!res.ok) throw new Error('Report API request failed');
        return res.json();
      })
      .catch(err => {
        appendSystemLog(`[ERROR] 리포트 열기 실패: ${err.message}`, 'text-error');
      });
  }

  btnReportKo.addEventListener('click', () => triggerOpenReport('ko'));
  btnReportEn.addEventListener('click', () => triggerOpenReport('en'));
  btnReportPw.addEventListener('click', () => triggerOpenReport('playwright'));

  // 5. Console Utility Actions
  btnClearLog.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    appendSystemLog('Console screen cleared.', 'text-muted');
  });

  btnCopyLog.addEventListener('click', () => {
    const text = consoleOutput.innerText;
    navigator.clipboard.writeText(text)
      .then(() => {
        appendSystemLog('Console logs copied to clipboard.', 'text-muted');
      })
      .catch(err => {
        console.error('Copy failed:', err);
      });
  });

  // 6. Server Shutdown Action
  btnShutdown.addEventListener('click', () => {
    if (confirm('대시보드 서버를 종료하시겠습니까?\n종료 후에는 대시보드를 다시 켤 때까지 실행할 수 없습니다.')) {
      appendSystemLog('대시보드 서버 종료 요청 중...', 'text-system');
      fetch('/api/shutdown', { method: 'POST' })
        .then(res => {
          if (!res.ok) throw new Error('Shutdown request failed');
          return res.json();
        })
        .then(data => {
          appendSystemLog('서버가 성공적으로 종료되었습니다. 이 브라우저 창을 닫아주세요.', 'text-muted');
          alert('대시보드 서버가 종료되었습니다. 이 브라우저 탭을 닫아주세요.');
          btnRun.disabled = true;
          btnKill.disabled = true;
          btnShutdown.disabled = true;
          document.body.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #060913; color: #9CA3AF; font-family: sans-serif; gap: 15px;">
              <h1 style="color: #EF4444; margin-bottom: 5px; font-size: 2.5rem; font-weight: 700; letter-spacing: -1px;">Dashboard Stopped</h1>
              <p style="font-size: 1.1rem;">웹 러너 대시보드 서버가 안전하게 완전히 종료되었습니다.</p>
              <p style="font-size: 0.85rem; color: #4B5563; margin-top: 10px;">이 브라우저 탭을 안전하게 닫으셔도 됩니다. 다시 구동하려면 Run.bat을 더블클릭하세요.</p>
            </div>
          `;
        })
        .catch(err => {
          appendSystemLog(`[ERROR] 종료 요청 실패: ${err.message}`, 'text-error');
        });
    }
  });
});
