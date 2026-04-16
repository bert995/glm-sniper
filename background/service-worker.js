// GLM Sniper - Background Service Worker

const DEFAULT_CONFIG = {
  enabled: false,
  refreshInterval: 3,        // seconds between checks
  targetKeywords: ['GLM-5.1', 'glm5.1', 'Coding', 'coding', '包月', '月度'],
  autoBuy: false,             // auto-click buy button
  notifySound: true,
  notifyDesktop: true,
  maxRetries: 100,
  randomDelay: true,          // add random delay to avoid detection
  delayRange: [500, 2000],    // ms
};

// Load config from storage
async function getConfig() {
  const result = await chrome.storage.local.get('sniperConfig');
  return { ...DEFAULT_CONFIG, ...result.sniperConfig };
}

// Save config
async function saveConfig(config) {
  await chrome.storage.local.set({ sniperConfig: config });
}

// Initialize default config on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('sniperConfig');
  if (!existing.sniperConfig) {
    await saveConfig(DEFAULT_CONFIG);
  }
  // Initialize stats
  const stats = await chrome.storage.local.get('sniperStats');
  if (!stats.sniperStats) {
    await chrome.storage.local.set({
      sniperStats: {
        checksCount: 0,
        startTime: null,
        lastCheck: null,
        found: false,
        purchased: false,
      }
    });
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_CONFIG':
      return await getConfig();

    case 'SAVE_CONFIG':
      await saveConfig(message.config);
      return { success: true };

    case 'START_SNIPER':
      await startSniper();
      return { success: true };

    case 'STOP_SNIPER':
      await stopSniper();
      return { success: true };

    case 'GET_STATS':
      const stats = await chrome.storage.local.get('sniperStats');
      return stats.sniperStats;

    case 'TARGET_FOUND':
      await onTargetFound(message.data, sender.tab);
      return { success: true };

    case 'PURCHASE_ATTEMPTED':
      await onPurchaseAttempted(message.data);
      return { success: true };

    case 'LOG':
      await addLog(message.text, message.level);
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

async function startSniper() {
  const config = await getConfig();
  config.enabled = true;
  await saveConfig(config);
  await chrome.storage.local.set({
    sniperStats: {
      checksCount: 0,
      startTime: Date.now(),
      lastCheck: null,
      found: false,
      purchased: false,
    }
  });
  await addLog('Sniper started', 'info');

  // Set up alarm for periodic refresh
  chrome.alarms.create('sniper-refresh', {
    periodInMinutes: Math.max(config.refreshInterval / 60, 0.08) // min 5 seconds
  });

  // Immediately trigger first check
  broadcastToContentScripts({ type: 'CHECK_NOW' });
}

async function stopSniper() {
  const config = await getConfig();
  config.enabled = false;
  await saveConfig(config);
  chrome.alarms.clear('sniper-refresh');
  await addLog('Sniper stopped', 'info');
  broadcastToContentScripts({ type: 'STOP' });
}

// Alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sniper-refresh') {
    const config = await getConfig();
    if (!config.enabled) {
      chrome.alarms.clear('sniper-refresh');
      return;
    }
    broadcastToContentScripts({ type: 'CHECK_NOW' });
  }
});

async function onTargetFound(data, tab) {
  await addLog(`Found target: ${data.text}`, 'success');

  const config = await getConfig();

  // Desktop notification
  if (config.notifyDesktop) {
    chrome.notifications.create('target-found', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'GLM Sniper - 发现目标!',
      message: `找到 GLM5.1 Coding 包月套餐!\n${data.text}`,
      priority: 2,
      requireInteraction: true,
    });
  }

  // Update stats
  const stats = (await chrome.storage.local.get('sniperStats')).sniperStats;
  stats.found = true;
  stats.foundTime = Date.now();
  await chrome.storage.local.set({ sniperStats: stats });

  // Auto buy if enabled
  if (config.autoBuy) {
    let delay = 0;
    if (config.randomDelay) {
      const [min, max] = config.delayRange;
      delay = Math.floor(Math.random() * (max - min) + min);
    }
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { type: 'AUTO_BUY', delay: 0 });
    }, delay);
  }
}

async function onPurchaseAttempted(data) {
  await addLog(`Purchase attempted: ${data.success ? 'SUCCESS' : 'FAILED'}`, data.success ? 'success' : 'error');

  const stats = (await chrome.storage.local.get('sniperStats')).sniperStats;
  stats.purchased = data.success;
  stats.purchaseTime = Date.now();
  await chrome.storage.local.set({ sniperStats: stats });

  if (data.success) {
    chrome.notifications.create('purchase-success', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'GLM Sniper - 抢购成功!',
      message: '已成功点击购买按钮，请确认支付!',
      priority: 2,
      requireInteraction: true,
    });
    // Stop sniper after successful purchase
    await stopSniper();
  }
}

function broadcastToContentScripts(message) {
  chrome.tabs.query({
    url: [
      'https://chatglm.cn/*',
      'https://open.bigmodel.cn/*',
      'https://*.zhipuai.cn/*'
    ]
  }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

// Log system
async function addLog(text, level = 'info') {
  const result = await chrome.storage.local.get('sniperLogs');
  const logs = result.sniperLogs || [];
  logs.push({
    time: new Date().toISOString(),
    text,
    level,
  });
  // Keep last 200 logs
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  await chrome.storage.local.set({ sniperLogs: logs });
}
