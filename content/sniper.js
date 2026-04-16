// GLM Sniper - Content Script
// Targeted for bigmodel.cn/glm-coding pricing page

(function () {
  'use strict';

  let isRunning = false;
  let config = null;
  let checksCount = 0;
  let countdownTimer = null;
  let rapidFireTimer = null;

  // ============================================================
  // Page-specific constants (bigmodel.cn/glm-coding)
  // ============================================================

  const SOLD_OUT_TEXTS = ['暂时售磬', '暂时售罄', '售磬', '售罄', '已售完', '缺货'];
  const BUY_TEXTS = ['订阅', '立即订阅', '购买', '立即购买', '开通', '立即开通', '抢购'];

  // Only target Lite and Pro (user confirmed)
  const TARGET_PLANS = ['Lite', 'Pro'];
  // All plan names for detection
  const ALL_PLAN_NAMES = ['Lite', 'Pro', 'Max'];

  // ============================================================
  // Restock countdown & rapid-fire refresh
  // ============================================================

  function parseRestockTime() {
    // Match "04月17日 10:00 补货" pattern
    const text = document.body.textContent || '';
    const match = text.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*补货/);
    if (!match) return null;

    const now = new Date();
    const month = parseInt(match[1]) - 1; // 0-indexed
    const day = parseInt(match[2]);
    const hour = parseInt(match[3]);
    const minute = parseInt(match[4]);

    const restock = new Date(now.getFullYear(), month, day, hour, minute, 0, 0);
    // Handle year rollover
    if (restock < now && (now - restock) > 86400000 * 30) {
      restock.setFullYear(restock.getFullYear() + 1);
    }
    return restock;
  }

  function startCountdown() {
    if (countdownTimer) return;

    const restockTime = parseRestockTime();
    if (!restockTime) return;

    log(`检测到补货时间: ${restockTime.toLocaleString('zh-CN')}`, 'info');

    countdownTimer = setInterval(() => {
      const now = Date.now();
      const diff = restockTime.getTime() - now;

      if (diff <= 0) {
        // Restock time reached! Enter rapid-fire mode
        clearInterval(countdownTimer);
        countdownTimer = null;
        enterRapidFire();
        return;
      }

      const sec = Math.floor(diff / 1000);
      const min = Math.floor(sec / 60);
      const hrs = Math.floor(min / 60);

      // Show countdown
      if (sec <= 120) {
        showOverlay('found', `距补货还有 ${sec}秒 - 准备就绪!`);
      } else if (min <= 60) {
        showOverlay('monitoring', `距补货还有 ${min}分${sec % 60}秒 (第${checksCount}次扫描)`);
      } else {
        showOverlay('monitoring', `距补货还有 ${hrs}时${min % 60}分 (第${checksCount}次扫描)`);
      }

      // 30 seconds before restock: start rapid scanning (every 1s)
      if (diff <= 30000 && !rapidFireTimer) {
        log('距补货不到30秒，进入快速扫描模式!', 'success');
        enterRapidFire();
      }

      // 5 seconds before restock: hard refresh to get freshest page state
      if (diff <= 5000 && diff > 4000) {
        log('距补货5秒，刷新页面获取最新状态!', 'info');
        window.location.reload();
      }
    }, 1000);
  }

  function enterRapidFire() {
    if (rapidFireTimer) return;
    log('进入极速扫描模式 - 每500ms扫描一次', 'success');

    rapidFireTimer = setInterval(() => {
      const found = scanPage();
      if (found) {
        clearInterval(rapidFireTimer);
        rapidFireTimer = null;
      }
    }, 500);

    // Also do hard refresh every 3 seconds if nothing found
    let refreshCount = 0;
    const refreshInterval = setInterval(() => {
      refreshCount++;
      if (refreshCount > 20 || !isRunning) {
        clearInterval(refreshInterval);
        return;
      }
      // Only refresh if still not found after scanning
      const plans = findPlanCards();
      const anyAvailable = plans.some(p => TARGET_PLANS.includes(p.name) && !checkSoldOut(p.element));
      if (!anyAvailable) {
        log(`极速模式: 第${refreshCount}次刷新页面`, 'info');
        window.location.reload();
      }
    }, 3000);
  }

  // ============================================================
  // Core scanning logic
  // ============================================================

  function scanPage() {
    checksCount++;
    updateStats();

    const plans = findPlanCards();

    if (plans.length === 0) {
      log(`第${checksCount}次扫描: 未找到套餐卡片，确认在 glm-coding 页面`, 'warn');
      showOverlay('monitoring', `未找到套餐卡片 (第${checksCount}次)`);
      return false;
    }

    // Only check Lite and Pro
    const targetPlans = plans.filter(p => TARGET_PLANS.includes(p.name));

    for (const plan of targetPlans) {
      const isSoldOut = checkSoldOut(plan.element);
      const status = isSoldOut ? '售磬' : '可购买!';
      log(`第${checksCount}次: ${plan.name} - ${status}`, isSoldOut ? 'info' : 'success');

      if (!isSoldOut) {
        highlightElement(plan.element);
        showOverlay('found', `发现可购买套餐: ${plan.name}! 🔥`);
        notifyBackground({ text: `${plan.name} 套餐可购买!`, planName: plan.name });
        return true;
      }
    }

    // All sold out - start countdown if not already
    if (isRunning && !countdownTimer) {
      startCountdown();
    }

    const restockInfo = findRestockTime();
    const extra = restockInfo ? ` (${restockInfo})` : '';
    // Don't override countdown overlay
    if (!countdownTimer) {
      showOverlay('monitoring', `Lite & Pro 售磬${extra} - 第${checksCount}次`);
    }

    return false;
  }

  function findPlanCards() {
    const plans = [];

    for (const name of ALL_PLAN_NAMES) {
      const candidates = document.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="plan"], [class*="card"] > div:first-child, span, p, div');
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        // Match exact plan name or plan name at start, but not long strings
        if ((text === name || (text.startsWith(name) && text.length < 30)) && text.length <= 30) {
          const card = findCardContainer(el);
          if (card && !plans.some(p => p.element === card)) {
            plans.push({ name, element: card, heading: el });
          }
        }
      }
    }

    // Fallback: broader search
    if (plans.length === 0) {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        if (text.length > 5 && text.length < 500) {
          for (const name of ALL_PLAN_NAMES) {
            if (text.includes(name) && text.includes('¥') && text.includes('/月')) {
              const card = findCardContainer(el);
              if (card && !plans.some(p => p.element === card)) {
                plans.push({ name, element: card, heading: el });
              }
            }
          }
        }
      }
    }

    return plans;
  }

  function findCardContainer(el) {
    let node = el;
    for (let i = 0; i < 10; i++) {
      if (!node.parentElement) break;
      node = node.parentElement;

      const style = window.getComputedStyle(node);
      const cls = (typeof node.className === 'string' ? node.className : '') || '';

      const isCard =
        cls.match(/card|plan|package|item|pricing/i) ||
        (style.borderRadius && parseInt(style.borderRadius) > 4) ||
        (style.boxShadow && style.boxShadow !== 'none') ||
        (node.children.length >= 2 && node.children.length <= 20);

      const tooHigh =
        cls.match(/container|main|content|wrapper|page|body|app|layout|root/i) ||
        node.children.length > 20;

      if (tooHigh && i > 2) return node.children.length <= 20 ? node : el.parentElement;
      if (isCard && i >= 1) return node;
    }
    return el.parentElement || el;
  }

  function checkSoldOut(cardElement) {
    const text = (cardElement.textContent || '').trim();

    for (const kw of SOLD_OUT_TEXTS) {
      if (text.includes(kw)) return true;
    }

    // Check for disabled buttons within the card
    const buttons = cardElement.querySelectorAll('button, [role="button"], a');
    for (const btn of buttons) {
      if (btn.disabled || btn.classList.contains('disabled') || btn.hasAttribute('disabled')) {
        const btnText = (btn.textContent || '').trim();
        if (BUY_TEXTS.some(t => btnText.includes(t))) return true;
      }
    }

    // If there's NO buy button at all, it might be sold out (button replaced with text)
    let hasBuyButton = false;
    for (const btn of buttons) {
      const btnText = (btn.textContent || '').trim();
      if (BUY_TEXTS.some(t => btnText.includes(t)) && !btn.disabled) {
        hasBuyButton = true;
      }
    }

    // If the card has pricing info but no active buy button and no sold-out text,
    // it's ambiguous - treat as sold out to be safe
    if (!hasBuyButton && text.includes('¥') && buttons.length === 0) {
      return true;
    }

    return false;
  }

  function findRestockTime() {
    const match = document.body.textContent.match(/(\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})\s*补货/);
    return match ? `${match[1]} 补货` : null;
  }

  function findBuyButton(cardElement) {
    const selectors = ['button', '[role="button"]', 'a'];

    for (const sel of selectors) {
      const buttons = cardElement.querySelectorAll(sel);
      for (const btn of buttons) {
        const btnText = (btn.textContent || '').trim();
        if (BUY_TEXTS.some(t => btnText.includes(t))) {
          if (!btn.disabled && !btn.classList.contains('disabled') && !SOLD_OUT_TEXTS.some(t => btnText.includes(t))) {
            return btn;
          }
        }
      }
    }

    // Fallback: any non-disabled button that's not sold-out
    const allBtns = cardElement.querySelectorAll('button:not([disabled]), [role="button"]:not(.disabled)');
    for (const btn of allBtns) {
      const btnText = (btn.textContent || '').trim();
      if (!SOLD_OUT_TEXTS.some(t => btnText.includes(t)) && btnText.length > 0 && btnText.length < 20) {
        return btn;
      }
    }

    return null;
  }

  function attemptPurchase(cardElement, planName) {
    log(`尝试自动购买 ${planName}...`, 'info');

    const buyBtn = findBuyButton(cardElement);
    if (buyBtn) {
      log(`找到购买按钮: "${buyBtn.textContent.trim()}"`, 'success');

      buyBtn.scrollIntoView({ behavior: 'instant', block: 'center' });

      // No delay - click immediately for speed
      const rect = buyBtn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      };

      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        buyBtn.dispatchEvent(new PointerEvent(type, eventOptions));
      });

      log(`已点击 ${planName} 购买按钮!`, 'success');
      showOverlay('success', `已点击 ${planName} 购买按钮! 请确认支付!`);

      chrome.runtime.sendMessage({
        type: 'PURCHASE_ATTEMPTED',
        data: { success: true, buttonText: buyBtn.textContent.trim(), planName },
      });
    } else {
      log(`未找到 ${planName} 的购买按钮，请手动操作!`, 'error');
      showOverlay('error', `找到 ${planName} 可购买但按钮定位失败，请手动点击!`);

      chrome.runtime.sendMessage({
        type: 'PURCHASE_ATTEMPTED',
        data: { success: false, reason: 'button_not_found', planName },
      });
    }
  }

  // ============================================================
  // UI Overlay
  // ============================================================

  let overlayEl = null;

  function showOverlay(status, text) {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'glm-sniper-overlay';
      document.body.appendChild(overlayEl);
    }

    const colors = {
      monitoring: '#1a73e8',
      found: '#f59e0b',
      success: '#10b981',
      error: '#ef4444',
    };

    overlayEl.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 2147483647;
      background: ${colors[status] || colors.monitoring};
      color: white;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer;
      max-width: 420px;
      line-height: 1.5;
    `;
    overlayEl.textContent = `🎯 ${text}`;
    overlayEl.onclick = () => {
      overlayEl.style.opacity = overlayEl.style.opacity === '0.2' ? '1' : '0.2';
    };
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function highlightElement(el) {
    if (!el) return;
    el.style.outline = '3px solid #22c55e';
    el.style.outlineOffset = '4px';
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  // ============================================================
  // Communication
  // ============================================================

  function notifyBackground(data) {
    chrome.runtime.sendMessage({
      type: 'TARGET_FOUND',
      data: { ...data, url: window.location.href },
    });
  }

  function log(text, level = 'info') {
    const prefix = { info: '📋', warn: '⚠️', error: '❌', success: '✅' };
    console.log(`${prefix[level] || '📋'} [GLM Sniper] ${text}`);
    chrome.runtime.sendMessage({ type: 'LOG', text, level }).catch(() => {});
  }

  async function updateStats() {
    try {
      const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      if (stats) {
        stats.checksCount = checksCount;
        stats.lastCheck = Date.now();
        await chrome.storage.local.set({ sniperStats: stats });
      }
    } catch {}
  }

  // ============================================================
  // Message handlers
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'CHECK_NOW':
        if (!isRunning) {
          isRunning = true;
          showOverlay('monitoring', '启动监控...');
        }
        scanPage();
        sendResponse({ ok: true });
        break;

      case 'AUTO_BUY':
        // Find first available Lite or Pro and buy
        const plans = findPlanCards().filter(p => TARGET_PLANS.includes(p.name));
        for (const plan of plans) {
          if (!checkSoldOut(plan.element)) {
            attemptPurchase(plan.element, plan.name);
            break;
          }
        }
        sendResponse({ ok: true });
        break;

      case 'STOP':
        isRunning = false;
        checksCount = 0;
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        if (rapidFireTimer) { clearInterval(rapidFireTimer); rapidFireTimer = null; }
        removeOverlay();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: true });
    }
    return true;
  });

  // ============================================================
  // MutationObserver for SPA changes
  // ============================================================

  let lastScanTime = 0;

  const observer = new MutationObserver(() => {
    if (!isRunning || !config?.enabled) return;
    const now = Date.now();
    if (now - lastScanTime > 2000) {
      lastScanTime = now;
      scanPage();
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Init
  // ============================================================

  async function init() {
    const result = await chrome.storage.local.get('sniperConfig');
    config = result.sniperConfig;
    if (config?.enabled) {
      isRunning = true;
      log('自动恢复监控 (上次开启状态)', 'info');
      showOverlay('monitoring', '自动恢复监控...');
      scanPage();
    }
  }

  init();
})();
