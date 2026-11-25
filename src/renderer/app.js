'use strict';

let state = null;
let editingAccountId = null;
let dragSrcId = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);

const ICONS = {
  volOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  volOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5L8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/><path d="M13.5 6l-3 12"/></svg>',
  broom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
};

// ---------- 主题切换（浅色 / 深色，自动同步窗口标题栏配色） ----------
function applyTheme(theme) {
  const isDark = theme === 'dark';
  const next = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('gb_theme', next);
  } catch (_) {}

  const btn = $('btnTheme');
  if (btn) {
    btn.querySelector('.icon-theme-moon').classList.toggle('hidden', isDark);
    btn.querySelector('.icon-theme-sun').classList.toggle('hidden', !isDark);
    btn.title = isDark ? '切换到 Chrome 浅色主题' : '切换到 Chrome 深色主题';
  }
  if (window.shellApi && window.shellApi.setTheme) {
    window.shellApi.setTheme(next);
  }
}

(function initTheme() {
  let saved = 'light';
  try {
    saved = localStorage.getItem('gb_theme') || 'light';
  } catch (_) {}
  applyTheme(saved);
})();

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindDragReorder(el, accId) {
  el.draggable = true;
  el.addEventListener('dragstart', () => {
    dragSrcId = accId;
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dragSrcId && dragSrcId !== accId) el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    if (!dragSrcId || dragSrcId === accId) return;
    const ids = state.accounts.map((a) => a.id).filter((x) => x !== dragSrcId);
    const targetIdx = ids.indexOf(accId);
    ids.splice(targetIdx, 0, dragSrcId);
    dragSrcId = null;
    window.shellApi.reorderAccounts(ids);
  });
}

function renderTabs(accounts, activeId) {
  const tabList = $('tabList');
  tabList.innerHTML = '';

  for (const acc of accounts) {
    const tab = document.createElement('div');
    const isActive = acc.id === activeId;
    tab.className = `chrome-tab${isActive ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(isActive));
    tab.dataset.id = acc.id;
    tab.title = acc.note ? `${acc.name} · ${acc.note}` : acc.name;

    const dotCls = acc.crashed ? 'crashed' : (acc.running ? 'running' : '');
    const actionBtnHtml = acc.running
      ? `<button class="tab-icon-btn btn-tab-power" title="停止并释放内存">${ICONS.close}</button>`
      : `<button class="tab-icon-btn btn-tab-power" title="启动此账号">${ICONS.play}</button>`;

    const muteBtnHtml = acc.running || acc.muted
      ? `<button class="tab-icon-btn btn-tab-mute${acc.muted ? ' muted' : ''}" title="${acc.muted ? '取消静音' : '静音此账号'}">${acc.muted ? ICONS.volOff : ICONS.volOn}</button>`
      : '';

    tab.innerHTML = `
      <span class="tab-dot ${dotCls}"></span>
      <span class="tab-title">${escapeHtml(acc.name)}</span>
      ${muteBtnHtml}
      ${actionBtnHtml}
    `;

    tab.addEventListener('click', async (e) => {
      if (e.target.closest('.tab-icon-btn')) return;
      const res = await window.shellApi.selectAccount(acc.id);
      if (res && !res.ok && res.error) showToast(res.error);
    });

    tab.addEventListener('dblclick', async (e) => {
      if (e.target.closest('.tab-icon-btn')) return;
      await window.shellApi.selectAccount(acc.id);
      if (state.settings.gridMode > 1) {
        await window.shellApi.setGridMode(1);
      }
    });

    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, acc);
    });

    const muteBtn = tab.querySelector('.btn-tab-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.shellApi.toggleAccountMute(acc.id);
      });
    }

    tab.querySelector('.btn-tab-power').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (acc.running) {
        await window.shellApi.stopAccount(acc.id);
      } else {
        const res = await window.shellApi.startAccount(acc.id);
        if (res && !res.ok && res.error) showToast(res.error);
      }
    });

    bindDragReorder(tab, acc.id);
    tabList.appendChild(tab);
  }
}

function renderSidebarList(accounts, activeId) {
  const list = $('accountList');
  list.innerHTML = '';

  accounts.forEach((acc, index) => {
    const item = document.createElement('div');
    item.className = `account-item${acc.id === activeId ? ' active' : ''}`;
    item.dataset.id = acc.id;

    const dotCls = acc.crashed ? 'crashed' : (acc.running ? 'running' : '');
    const fpsHtml = acc.running
      ? (acc.bgFps > 0
        ? `<span class="fps-tag">${acc.bgFps}fps</span>`
        : '<span class="fps-tag fg">60fps</span>')
      : '<span>未启动</span>';

    item.innerHTML = `
      <div class="acc-avatar">
        <span>${index + 1}</span>
        <span class="status-dot ${dotCls}"></span>
      </div>
      <div class="acc-info">
        <div class="acc-name">${escapeHtml(acc.name)}</div>
        <div class="acc-meta">
          ${fpsHtml}
          ${acc.note ? `<span>${escapeHtml(acc.note)}</span>` : ''}
        </div>
      </div>
      <div class="acc-btns">
        <button class="mini-btn btn-acc-mute${acc.muted ? ' muted' : ''}" title="${acc.muted ? '取消静音' : '静音此号'}">${acc.muted ? ICONS.volOff : ICONS.volOn}</button>
        <button class="mini-btn btn-acc-power" title="${acc.running ? '停止并释放内存' : '启动'}">${acc.running ? ICONS.stop : ICONS.play}</button>
        <button class="mini-btn btn-acc-more" title="更多操作">${ICONS.more}</button>
      </div>
    `;

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.mini-btn')) return;
      const res = await window.shellApi.selectAccount(acc.id);
      if (res && !res.ok && res.error) showToast(res.error);
    });

    item.addEventListener('dblclick', async (e) => {
      if (e.target.closest('.mini-btn')) return;
      await window.shellApi.selectAccount(acc.id);
      if (state.settings.gridMode > 1) {
        await window.shellApi.setGridMode(1);
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, acc);
    });

    item.querySelector('.btn-acc-mute').addEventListener('click', (e) => {
      e.stopPropagation();
      window.shellApi.toggleAccountMute(acc.id);
    });

    item.querySelector('.btn-acc-power').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (acc.running) {
        await window.shellApi.stopAccount(acc.id);
      } else {
        const res = await window.shellApi.startAccount(acc.id);
        if (res && !res.ok && res.error) showToast(res.error);
      }
    });

    item.querySelector('.btn-acc-more').addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      openCtxMenu(rect.left, rect.bottom + 4, acc);
    });

    bindDragReorder(item, acc.id);
    list.appendChild(item);
  });
}

function render() {
  if (!state) return;
  const { accounts, activeId, settings, onlineCount, visibleSlots } = state;

  // 侧边栏折叠与宽度同步
  const sidebar = $('sidebar');
  const sidebarOpen = settings.sidebarWidth > 0;
  sidebar.classList.toggle('collapsed', !sidebarOpen);
  if (sidebarOpen) {
    sidebar.style.width = `${settings.sidebarWidth}px`;
  }
  $('btnToggleSidebar').classList.toggle('active-state', sidebarOpen);

  // 数量统计
  $('onlineBadge').textContent = `${onlineCount}/${settings.maxConcurrent}`;
  $('sidebarCount').textContent = String(accounts.length);

  // 地址栏 (Omnibox) 同步
  const activeAcc = accounts.find((a) => a.id === activeId);
  const omniboxDot = $('omniboxStatusDot');
  omniboxDot.className = 'omnibox-dot';
  if (activeAcc) {
    if (activeAcc.crashed) omniboxDot.classList.add('crashed');
    else if (activeAcc.running) omniboxDot.classList.add('running');
  }

  $('activeTitle').textContent = activeAcc
    ? `${activeAcc.name}${activeAcc.running ? '' : '（未启动）'}`
    : '未选择账号';

  const urlInput = $('omniboxUrl');
  if (document.activeElement !== urlInput) {
    urlInput.value = activeAcc ? (activeAcc.url || '') : '';
  }

  const fpsBadge = $('omniboxFps');
  if (activeAcc && activeAcc.running) {
    const isBg = activeAcc.bgFps > 0;
    fpsBadge.textContent = isBg ? `${activeAcc.bgFps} FPS` : '60 FPS';
    fpsBadge.classList.toggle('bg', isBg);
    fpsBadge.classList.remove('hidden');
  } else {
    fpsBadge.classList.add('hidden');
  }

  // 宫格切换高亮
  document.querySelectorAll('#gridSwitcher button').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.grid) === Number(settings.gridMode));
  });

  // 全局静音按钮
  const muteBtn = $('btnGlobalMute');
  const isMuted = !!settings.globalMuted;
  muteBtn.classList.toggle('active-warn', isMuted);
  muteBtn.title = isMuted ? '已全局静音（点击恢复声音）' : '全局一键静音';
  muteBtn.querySelector('.icon-vol-on').classList.toggle('hidden', isMuted);
  muteBtn.querySelector('.icon-vol-off').classList.toggle('hidden', !isMuted);

  // 空状态提示
  $('emptyStage').classList.toggle('hidden', onlineCount > 0);

  // 多宫格焦点高亮框
  const hl = $('slotHighlights');
  hl.innerHTML = '';
  if (settings.gridMode > 1 && visibleSlots.length > 0) {
    for (const s of visibleSlots) {
      if (!s.active) continue;
      const box = document.createElement('div');
      box.className = 'slot-border';
      box.style.left = `${s.x - 2}px`;
      box.style.top = `${s.y - 2}px`;
      box.style.width = `${s.width + 4}px`;
      box.style.height = `${s.height + 4}px`;
      hl.appendChild(box);
    }
  }

  renderTabs(accounts, activeId);
  renderSidebarList(accounts, activeId);
}

// ---------- 右键 / 更多菜单 ----------
function closeCtxMenu() {
  const menu = $('ctxMenu');
  if (!menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    if (!isAnyModalOpen()) window.shellApi.setOverlayOpen(false);
  }
}

function openCtxMenu(x, y, acc) {
  const menu = $('ctxMenu');
  window.shellApi.setOverlayOpen(true);
  const items = [
    { icon: ICONS.reload, label: acc.running ? '刷新此账号' : '启动此账号', fn: () => window.shellApi.reloadAccount(acc.id) },
    { icon: ICONS.edit, label: '编辑名称 / 备注 / 网址', fn: () => openAccountModal(acc) },
    { icon: acc.running ? ICONS.stop : ICONS.play, label: acc.running ? '停止（释放内存）' : '启动', fn: () => acc.running ? window.shellApi.stopAccount(acc.id) : window.shellApi.startAccount(acc.id) },
    { icon: ICONS.code, label: '打开开发者调试 (DevTools)', fn: () => window.shellApi.openDevTools(acc.id) },
    { sep: true },
    {
      icon: ICONS.broom,
      label: '清除登录数据（重新扫码）',
      danger: true,
      fn: async () => {
        if (confirm(`确定清除「${acc.name}」的 Cookie 和缓存吗？清除后需要重新扫码登录。`)) {
          await window.shellApi.clearAccountData(acc.id);
          showToast('已清除该账号登录数据');
        }
      },
    },
    {
      icon: ICONS.trash,
      label: '删除账号',
      danger: true,
      fn: async () => {
        if (confirm(`确定删除「${acc.name}」吗？该账号的登录数据也会一并清除。`)) {
          await window.shellApi.deleteAccount(acc.id);
          showToast('账号已删除');
        }
      },
    },
  ];

  menu.innerHTML = '';
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = `ctx-item${it.danger ? ' danger' : ''}`;
    row.innerHTML = `${it.icon}<span>${escapeHtml(it.label)}</span>`;
    row.addEventListener('click', () => {
      closeCtxMenu();
      it.fn();
    });
    menu.appendChild(row);
  }

  menu.classList.remove('hidden');
  const maxX = window.innerWidth - menu.offsetWidth - 8;
  const maxY = window.innerHeight - menu.offsetHeight - 8;
  menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctxMenu') && !e.target.closest('.btn-acc-more')) {
    closeCtxMenu();
  }
});

// ---------- 弹窗控制 ----------
function isAnyModalOpen() {
  return !$('accountModal').classList.contains('hidden') || !$('settingsModal').classList.contains('hidden');
}

function openAccountModal(acc = null) {
  editingAccountId = acc ? acc.id : null;
  $('accountModalTitle').textContent = acc ? '编辑账号' : '添加账号';
  $('inputAccName').value = acc ? acc.name : `账号 ${(state?.accounts.length || 0) + 1}`;
  $('inputAccNote').value = acc ? (acc.note || '') : '';
  $('inputAccUrl').value = acc ? acc.url : (state?.settings.defaultUrl || '');
  $('accountModal').classList.remove('hidden');
  window.shellApi.setOverlayOpen(true);
  $('inputAccName').focus();
}

function closeAccountModal() {
  $('accountModal').classList.add('hidden');
  if (!isAnyModalOpen()) window.shellApi.setOverlayOpen(false);
}

function openSettingsModal() {
  if (!state) return;
  const s = state.settings;
  $('selectBgFps').value = String(s.bgFps ?? 10);
  $('chkFocusAudio').checked = !!s.focusAudioOnly;
  $('chkCloseToTray').checked = !!s.closeToTray;
  $('inputBossKey').value = s.bossKey || 'Alt+Q';
  $('inputMaxConcurrent').value = String(s.maxConcurrent || 10);
  $('inputDefaultUrl').value = s.defaultUrl || '';
  $('txtDataDir').textContent = state.dataDir || '';
  $('settingsModal').classList.remove('hidden');
  window.shellApi.setOverlayOpen(true);
}

function closeSettingsModal() {
  $('settingsModal').classList.add('hidden');
  if (!isAnyModalOpen()) window.shellApi.setOverlayOpen(false);
}

// ---------- 事件绑定 ----------
$('btnAdd').addEventListener('click', () => openAccountModal(null));
$('btnAddSidebar').addEventListener('click', () => openAccountModal(null));
$('btnEmptyAdd').addEventListener('click', () => openAccountModal(null));

async function handleStartAll() {
  const res = await window.shellApi.startAllAccounts();
  if (res && !res.ok && res.error) showToast(res.error);
}
$('btnStartAll').addEventListener('click', handleStartAll);
$('btnEmptyStartAll').addEventListener('click', handleStartAll);

$('btnOmniboxAcc').addEventListener('click', () => {
  const activeAcc = state?.accounts.find((a) => a.id === state.activeId);
  if (activeAcc) openAccountModal(activeAcc);
  else openAccountModal(null);
});

$('btnDataDir').addEventListener('click', () => window.shellApi.openDataDir());
$('btnQuit').addEventListener('click', () => {
  if (confirm('确定退出并下线全部账号吗？')) window.shellApi.quitApp();
});

$('btnToggleSidebar').addEventListener('click', () => {
  const next = state && state.settings.sidebarWidth > 0 ? 0 : 210;
  window.shellApi.setSidebarWidth(next);
});

$('btnReload').addEventListener('click', () => window.shellApi.reloadAccount());
$('btnDevTools').addEventListener('click', () => window.shellApi.openDevTools());
$('btnGlobalMute').addEventListener('click', () => window.shellApi.toggleGlobalMute());
$('btnHideTray').addEventListener('click', () => window.shellApi.hideToTray());
$('btnSettings').addEventListener('click', () => openSettingsModal());

$('btnTheme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

// 标签栏支持鼠标滚轮横向滚动
$('tabList').addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > 0) {
    e.preventDefault();
    $('tabList').scrollLeft += e.deltaY;
  }
}, { passive: false });

// Chrome 地址栏按 Enter 直接更新当前账号网址并跳转
$('omniboxUrl').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const activeAcc = state?.accounts.find((a) => a.id === state.activeId);
  if (!activeAcc) return;
  let url = e.currentTarget.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  e.currentTarget.blur();
  await window.shellApi.updateAccount({ id: activeAcc.id, url });
  if (!activeAcc.running) {
    await window.shellApi.startAccount(activeAcc.id);
  }
  showToast('已更新网址并跳转');
});

$('omniboxUrl').addEventListener('focus', (e) => {
  e.currentTarget.select();
});

document.querySelectorAll('#gridSwitcher button').forEach((btn) => {
  btn.addEventListener('click', () => window.shellApi.setGridMode(Number(btn.dataset.grid)));
});

$('btnCancelAcc').addEventListener('click', closeAccountModal);
$('btnCloseAccX').addEventListener('click', closeAccountModal);
$('btnSaveAcc').addEventListener('click', async () => {
  const payload = {
    name: $('inputAccName').value.trim(),
    note: $('inputAccNote').value.trim(),
    url: $('inputAccUrl').value.trim(),
  };
  closeAccountModal();
  if (editingAccountId) {
    await window.shellApi.updateAccount({ id: editingAccountId, ...payload });
    showToast('账号已更新');
  } else {
    const res = await window.shellApi.addAccount({ ...payload, autoStart: true });
    if (res && !res.ok && res.error) showToast(res.error);
  }
});

$('btnCancelSettings').addEventListener('click', closeSettingsModal);
$('btnCloseSettingsX').addEventListener('click', closeSettingsModal);
$('btnSaveSettings').addEventListener('click', async () => {
  const patch = {
    bgFps: Number($('selectBgFps').value),
    focusAudioOnly: $('chkFocusAudio').checked,
    closeToTray: $('chkCloseToTray').checked,
    bossKey: $('inputBossKey').value.trim() || 'Alt+Q',
    maxConcurrent: Math.max(1, Math.min(30, Number($('inputMaxConcurrent').value) || 10)),
    defaultUrl: $('inputDefaultUrl').value.trim(),
  };
  closeSettingsModal();
  await window.shellApi.updateSettings(patch);
  showToast('设置已保存');
});

$('accountModal').addEventListener('click', (e) => {
  if (e.target === $('accountModal')) closeAccountModal();
});
$('settingsModal').addEventListener('click', (e) => {
  if (e.target === $('settingsModal')) closeSettingsModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCtxMenu();
    closeAccountModal();
    closeSettingsModal();
  }
});

// 初始化
window.shellApi.onStateChange((next) => {
  state = next;
  render();
});

window.shellApi.getState().then((init) => {
  state = init;
  render();
});
