// GLM Sniper - Content Script
// Targeted for bigmodel.cn/glm-coding pricing page

(function () {
  'use strict';

  let isRunning = false;
  let config = null;
  let checksCount = 0;

  // ============================================================
  // Page-specific constants (bigmodel.cn/glm-coding)
  // ============================================================

  // Sold-out text variants (the page uses 磬 not 罄)
  const SOLD_OUT_TEXTS = ['暂时售磬', '暂时售罄', '售磬', '售罄', '已售完', '缺货'];

  // Buy button text when available
  const BUY_TEXTS = ['订阅', '立即订阅', '购买', '立即购买', '开通', '立即开通', '抢购'];

  // Plan names on the page
  const PLAN_NAMES = ['Lite', 'Pro', 'Max'];

  // ============================================================
  // Core scanning logic
  // ============================================================

  function scanPage() {
    checksCount++;
    updateStats();

    // Strategy: find all plan cards, check each for sold-out status
    const plans = findPlanCards();

    if (plans.length === 0) {
      log(`第${checksCount}次扫描: 未找到套餐卡片，确认你在 glm-coding 页面`, 'warn');
      showOverlay('monitoring', `未找到套餐卡片 (第${checksCount}次)`);
      return false;
    }

    let foundAvailable = false;

    for (const plan of plans) {
      const isSoldOut = checkSoldOut(plan.element);
      const status = isSoldOut ? '售磬' : '可购买!';
      log(`第${checksCount}次扫描: ${plan.name} - ${status}`, isSoldOut ? 'info' : 'success');

      if (!isSoldOut) {
        foundAvailable = true;
        highlightElement(plan.element);
        showOverlay('found', `发现可购买套餐: ${plan.name}!`);
        notifyBackground({ text: `${plan.name} 套餐可购买!`, planName: plan.name });
        return true;
      }
    }

    if (!foundAvailable) {
      const restockInfo = findRestockTime();
      const extra = restockInfo ? ` (${restockInfo})` : '';
      showOverlay('monitoring', `全部售磬${extra} - 第${checksCount}次扫描`);
    }

    return false;
  }

  function findPlanCards() {
    const plans = [];

    // Method 1: Find elements that contain plan names (Lite/Pro/Max)
    // Look for heading-like elements with these names
    for (const name of PLAN_NAMES) {
      // Try various selectors for plan name headings
      const candidates = document.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="plan"], [class*="card"] > div:first-child');
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (text === name || text.startsWith(name)) {
          // Find the parent card container
          const card = findCardContainer(el);
          if (card && !plans.some(p => p.element === card)) {
            plans.push({ name, element: card, heading: el });
          }
        }
      }
    }

    // Method 2: If method 1 found nothing, try broader search
    if (plans.length === 0) {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        if (text.length > 5 && text.length < 500) {
          for (const name of PLAN_NAMES) {
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

    log(`找到 ${plans.length} 个套餐卡片: ${plans.map(p => p.name).join(', ')}`, 'info');
    return plans;
  }

  function findCardContainer(el) {
    // Walk up the DOM to find a reasonable card container
    let node = el;
    for (let i = 0; i < 10; i++) {
      if (!node.parentElement) break;
      node = node.parentElement;

      // Check if this looks like a card container
      const style = window.getComputedStyle(node);
      const cls = node.className || '';

      // Heuristics for card container
      const isCard =
        cls.match(/card|plan|package|item|pricing/i) ||
        (style.borderRadius && parseInt(style.borderRadius) > 4) ||
        (style.boxShadow && style.boxShadow !== 'none') ||
        (node.children.length >= 2 && node.children.length <= 20);

      // Don't go too high (stop at main content area)
      const tooHigh =
        cls.match(/container|main|content|wrapper|page|body|app/i) ||
        node.children.length > 20;

      if (tooHigh && i > 2) return node.children.length <= 20 ? node : el.parentElement;
      if (isCard && i >= 1) return node;
    }
    return el.parentElement || el;
  }

  function checkSoldOut(cardElement) {
    const text = (cardElement.textContent || '').trim();

    // Check text content for sold-out keywords
    for (const kw of SOLD_OUT_TEXTS) {
      if (text.includes(kw)) return true;
    }

    // Check for disabled buttons
    const buttons = cardElement.querySelectorAll('button, [role="button"], a');
    for (const btn of buttons) {
      if (btn.disabled || btn.classList.contains('disabled') || btn.hasAttribute('disabled')) {
        const btnText = (btn.textContent || '').trim();
        if (BUY_TEXTS.some(t => btnText.includes(t))) return true;
      }
    }

    return false;
  }

  function findRestockTime() {
    // Look for restock time info like "04月17日 10:00 补货"
    const match = document.body.textContent.match(/(\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})\s*补货/);
    return match ? `${match[1]} 补货` : null;
  }

  function findBuyButton(cardElement) {
    // Look in the card for a clickable buy button
    const selectors = ['button', '[role="button"]', 'a'];

    for (const sel of selectors) {
      const buttons = cardElement.querySelectorAll(sel);
      for (const btn of buttons) {
        const btnText = (btn.textContent || '').trim();
        // Must contain a buy-related keyword
        if (BUY_TEXTS.some(t => btnText.includes(t))) {
          // Must NOT be disabled or sold out
          if (!btn.disabled && !btn.classList.contains('disabled') && !SOLD_OUT_TEXTS.some(t => btnText.includes(t))) {
            return btn;
          }
        }
      }
    }

    // Fallback: any non-disabled button in the card
    const allBtns = cardElement.querySelectorAll('button:not([disabled]), [role="button"]:not(.disabled)');
    for (const btn of allBtns) {
      const btnText = (btn.textContent || '').trim();
      if (!SOLD_OUT_TEXTS.some(t => btnText.includes(t)) && btnText.length < 20 && btnText.length > 0) {
        return btn;
      }
    }

    return null;
  }

  function attemptPurchase(cardElement) {
    log('尝试自动点击购买按钮...', 'info');

    const buyBtn = findBuyButton(cardElement);
    if (buyBtn) {
      log(`找到购买按钮: "${buyBtn.textContent.trim()}"`, 'success');

      buyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

      setTimeout(() => {
        // Simulate realistic mouse event sequence
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

        log('已点击购买按钮!', 'success');
        showOverlay('success', '已点击购买按钮! 请确认支付!');

        chrome.runtime.sendMessage({
          type: 'PURCHASE_ATTEMPTED',
          data: { success: true, buttonText: buyBtn.textContent.trim() },
        });
      }, 200);
    } else {
      log('未找到可点击的购买按钮，请手动操作!', 'error');
      showOverlay('error', '找到可购买套餐但按钮定位失败，请手动点击!');

      chrome.runtime.sendMessage({
        type: 'PURCHASE_ATTEMPTED',
        data: { success: false, reason: 'button_not_found' },
      });
    }
  }

  // ============================================================
  // Auto-refresh page strategy
  // ============================================================

  function refreshPage() {
    // For 10:00 restock: hard refresh to get fresh page state
    window.location.reload();
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
      max-width: 400px;
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
    el.style.transition = 'outline 0.3s';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  // Message handlers from background
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'CHECK_NOW':
        if (!isRunning) {
          isRunning = true;
          showOverlay('monitoring', '启动监控...');
        }
        const found = scanPage();
        // If not found and using page-refresh strategy, reload
        if (!found && config && config.refreshPage) {
          setTimeout(refreshPage, (config.refreshInterval || 3) * 1000);
        }
        sendResponse({ ok: true, found });
        break;

      case 'AUTO_BUY':
        // Re-scan and attempt purchase on any available plan
        const plans = findPlanCards();
        for (const plan of plans) {
          if (!checkSoldOut(plan.element)) {
            attemptPurchase(plan.element);
            break;
          }
        }
        sendResponse({ ok: true });
        break;

      case 'STOP':
        isRunning = false;
        checksCount = 0;
        removeOverlay();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: true });
    }
    return true;
  });

  // ============================================================
  // MutationObserver - detect dynamic page changes (SPA)
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

  observer.observe(document.body, { childList: true, subtree: true });

  // ============================================================
  // Auto-start if previously enabled
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
