// GLM Sniper - Popup Script

const $ = (sel) => document.querySelector(sel);
let statsInterval = null;

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadStats();
  await loadLogs();
  setupListeners();
  startStatsPoller();
});

// ============================================================
// Config
// ============================================================

async function loadConfig() {
  const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (!config) return;

  $('#cfg-interval').value = config.refreshInterval || 3;
  $('#cfg-keywords').value = (config.targetKeywords || []).join(', ');
  $('#cfg-autobuy').checked = config.autoBuy || false;
  $('#cfg-randomdelay').checked = config.randomDelay !== false;
  $('#cfg-notify').checked = config.notifyDesktop !== false;
  $('#cfg-sound').checked = config.notifySound !== false;

  updateStatusUI(config.enabled);
}

async function saveConfig() {
  const config = {
    refreshInterval: parseInt($('#cfg-interval').value) || 3,
    targetKeywords: $('#cfg-keywords').value.split(',').map(s => s.trim()).filter(Boolean),
    autoBuy: $('#cfg-autobuy').checked,
    randomDelay: $('#cfg-randomdelay').checked,
    notifyDesktop: $('#cfg-notify').checked,
    notifySound: $('#cfg-sound').checked,
    delayRange: [500, 2000],
    maxRetries: 100,
  };

  // Preserve enabled state
  const current = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  config.enabled = current?.enabled || false;

  await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config });
  showToast('配置已保存');
}

// ============================================================
// Actions
// ============================================================

function setupListeners() {
  $('#btn-start').addEventListener('click', async () => {
    await saveConfig(); // save current form values first
    await chrome.runtime.sendMessage({ type: 'START_SNIPER' });
    updateStatusUI(true);
    showToast('抢购已启动!');
  });

  $('#btn-stop').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'STOP_SNIPER' });
    updateStatusUI(false);
    showToast('已停止');
  });

  $('#btn-save').addEventListener('click', saveConfig);

  $('#btn-clear-logs').addEventListener('click', async () => {
    await chrome.storage.local.set({ sniperLogs: [] });
    $('#logs').innerHTML = '<div class="log-entry log-info">日志已清空</div>';
  });
}

// ============================================================
// Status UI
// ============================================================

function updateStatusUI(isRunning) {
  const card = $('#status-card');
  const label = $('#status-label');
  const detail = $('#status-detail');
  const btnStart = $('#btn-start');
  const btnStop = $('#btn-stop');
  const statsSection = $('#stats-section');

  if (isRunning) {
    card.className = 'card status-running';
    label.textContent = '监控中';
    detail.textContent = '正在监控智谱套餐页面...';
    btnStart.disabled = true;
    btnStop.disabled = false;
    statsSection.style.display = 'block';
  } else {
    card.className = 'card status-idle';
    label.textContent = '未启动';
    detail.textContent = '点击「开始抢购」启动监控';
    btnStart.disabled = false;
    btnStop.disabled = true;
    statsSection.style.display = 'none';
  }
}

// ============================================================
// Stats
// ============================================================

async function loadStats() {
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  if (!stats) return;
  updateStatsDisplay(stats);
}

function updateStatsDisplay(stats) {
  if (!stats) return;
  $('#stat-checks').textContent = stats.checksCount || 0;

  if (stats.startTime) {
    const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    $('#stat-elapsed').textContent = m > 0 ? `${m}m${s}s` : `${s}s`;
  }

  $('#stat-found').textContent = stats.found ? '是' : '否';
}

function startStatsPoller() {
  statsInterval = setInterval(async () => {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' }).catch(() => null);
    if (stats) updateStatsDisplay(stats);
  }, 1000);
}

// ============================================================
// Logs
// ============================================================

async function loadLogs() {
  const result = await chrome.storage.local.get('sniperLogs');
  const logs = result.sniperLogs || [];
  const container = $('#logs');

  if (logs.length === 0) {
    container.innerHTML = '<div class="log-entry log-info">暂无日志</div>';
    return;
  }

  container.innerHTML = logs
    .slice(-50) // show last 50
    .map(log => {
      const time = new Date(log.time).toLocaleTimeString('zh-CN');
      return `<div class="log-entry log-${log.level}"><span class="log-time">${time}</span> ${escapeHtml(log.text)}</div>`;
    })
    .join('');

  container.scrollTop = container.scrollHeight;
}

// Refresh logs periodically
setInterval(loadLogs, 2000);

// ============================================================
// Utils
// ============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #334155;
    color: #f8fafc;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 9999;
    animation: fadeout 2s forwards;
  `;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}
