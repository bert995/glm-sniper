// GLM Sniper - Content Script
// Runs on chatglm.cn / open.bigmodel.cn / zhipuai.cn

(function () {
  'use strict';

  let isRunning = false;
  let checkTimer = null;
  let config = null;
  let checksCount = 0;

  // ============================================================
  // Selectors & Keywords - adapt these to the actual page structure
  // ============================================================
  const SELECTORS = {
    // Pricing cards / plan containers
    planCards: [
      '[class*="price"]',
      '[class*="plan"]',
      '[class*="package"]',
      '[class*="subscription"]',
      '[class*="套餐"]',
      '[class*="pricing"]',
      '[class*="card"]',
      '[class*="product"]',
      '[class*="item"]',
    ],
    // Buy / subscribe buttons
    buyButtons: [
      'button',
      'a[href*="buy"]',
      'a[href*="order"]',
      'a[href*="subscribe"]',
      'a[href*="purchase"]',
      '[class*="buy"]',
      '[class*="purchase"]',
      '[class*="subscribe"]',
      '[class*="order"]',
      '[role="button"]',
    ],
    // Sold out / unavailable indicators
    soldOutIndicators: [
      '[class*="sold-out"]',
      '[class*="disabled"]',
      '[class*="unavailable"]',
      '[class*="out-of-stock"]',
    ],
  };

  const TARGET_KEYWORDS = ['GLM-5.1', 'glm5.1', 'GLM5.1', 'glm-5.1', 'Coding', 'coding', '包月', '月度套餐', '月套餐'];
  const BUY_KEYWORDS = ['购买', '订阅', '立即购买', '开通', '抢购', '立即开通', '立即订阅', 'Subscribe', 'Buy', 'Purchase'];
  const SOLD_OUT_KEYWORDS = ['售罄', '已售完', '缺货', '暂无', '不可用', '已售罄', 'Sold out', 'Unavailable'];

  // ============================================================
  // Core scanning logic
  // ============================================================

  function scanPage() {
    checksCount++;
    updateStats();
    log(`Scanning page... (check #${checksCount})`);

    // Strategy 1: Look for elements containing target keywords
    const allElements = document.querySelectorAll('*');
    let targetContainer = null;
    let bestMatch = null;
    let bestScore = 0;

    for (const el of allElements) {
      if (el.children.length > 50) continue; // skip large containers
      const text = el.innerText || el.textContent || '';
      if (text.length > 2000) continue; // skip huge text blocks

      let score = 0;
      const lowerText = text.toLowerCase();

      // Check for GLM 5.1 related keywords
      for (const kw of TARGET_KEYWORDS) {
        if (lowerText.includes(kw.toLowerCase())) {
          score += 10;
        }
      }

      // Must have at least some match
      if (score === 0) continue;

      // Bonus for coding-related terms
      if (lowerText.includes('coding') || lowerText.includes('代码')) score += 5;
      if (lowerText.includes('包月') || lowerText.includes('月度')) score += 5;

      // Check if NOT sold out
      let isSoldOut = false;
      for (const kw of SOLD_OUT_KEYWORDS) {
        if (lowerText.includes(kw.toLowerCase())) {
          isSoldOut = true;
          break;
        }
      }

      // Check for disabled state
      if (el.closest('[disabled]') || el.closest('.disabled')) {
        isSoldOut = true;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { element: el, text: text.substring(0, 200), score, isSoldOut };
      }
    }

    if (bestMatch && bestScore >= 10) {
      if (bestMatch.isSoldOut) {
        log(`Found target but SOLD OUT: ${bestMatch.text.substring(0, 80)}`, 'warn');
        showOverlay('monitoring', `已找到目标但暂时售罄，继续监控中... (第${checksCount}次检查)`);
      } else {
        log(`TARGET AVAILABLE! Score: ${bestMatch.score}, Text: ${bestMatch.text.substring(0, 80)}`, 'success');
        showOverlay('found', '发现可购买的套餐!');
        notifyBackground(bestMatch);
        highlightElement(bestMatch.element);
        return true;
      }
    } else {
      log('Target not found on page, will retry...', 'info');
      showOverlay('monitoring', `监控中... (第${checksCount}次检查)`);
    }

    return false;
  }

  function findBuyButton(container) {
    // Look for buy button near the target container
    const searchArea = container || document;

    for (const selector of SELECTORS.buyButtons) {
      const buttons = searchArea.querySelectorAll(selector);
      for (const btn of buttons) {
        const btnText = (btn.innerText || btn.textContent || '').trim();
        for (const kw of BUY_KEYWORDS) {
          if (btnText.includes(kw)) {
            if (!btn.disabled && !btn.classList.contains('disabled')) {
              return btn;
            }
          }
        }
      }
    }

    // Expand search to parent containers
    if (container && container.parentElement) {
      return findBuyButton(container.parentElement);
    }

    return null;
  }

  function attemptPurchase(targetElement) {
    log('Attempting auto-purchase...', 'info');

    const buyBtn = findBuyButton(targetElement);
    if (buyBtn) {
      log(`Found buy button: "${buyBtn.innerText.trim()}"`, 'success');

      // Simulate human-like click
      buyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

      setTimeout(() => {
        // Dispatch mouse events in sequence
        const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
        for (const eventType of events) {
          const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
          });
          buyBtn.dispatchEvent(event);
        }

        log('Buy button clicked!', 'success');
        showOverlay('success', '已点击购买按钮! 请确认支付!');

        chrome.runtime.sendMessage({
          type: 'PURCHASE_ATTEMPTED',
          data: { success: true, buttonText: buyBtn.innerText.trim() },
        });
      }, 300);
    } else {
      log('Could not find buy button', 'error');
      showOverlay('error', '找到套餐但未找到购买按钮，请手动操作!');

      chrome.runtime.sendMessage({
        type: 'PURCHASE_ATTEMPTED',
        data: { success: false, reason: 'button_not_found' },
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
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer;
      transition: opacity 0.3s;
      max-width: 350px;
      line-height: 1.4;
    `;
    overlayEl.textContent = `🎯 GLM Sniper: ${text}`;
    overlayEl.onclick = () => { overlayEl.style.opacity = overlayEl.style.opacity === '0.2' ? '1' : '0.2'; };
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function highlightElement(el) {
    if (!el) return;
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '2px';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ============================================================
  // Communication
  // ============================================================

  function notifyBackground(match) {
    chrome.runtime.sendMessage({
      type: 'TARGET_FOUND',
      data: {
        text: match.text,
        score: match.score,
        url: window.location.href,
      },
    });
  }

  function log(text, level = 'info') {
    const prefix = {
      info: '📋',
      warn: '⚠️',
      error: '❌',
      success: '✅',
    };
    console.log(`${prefix[level] || '📋'} [GLM Sniper] ${text}`);
    chrome.runtime.sendMessage({ type: 'LOG', text, level }).catch(() => {});
  }

  async function updateStats() {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    if (stats) {
      stats.checksCount = checksCount;
      stats.lastCheck = Date.now();
      await chrome.storage.local.set({ sniperStats: stats });
    }
  }

  // ============================================================
  // Message handlers
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'CHECK_NOW':
        if (!isRunning) {
          isRunning = true;
          showOverlay('monitoring', '启动中...');
        }
        scanPage();
        sendResponse({ ok: true });
        break;

      case 'AUTO_BUY':
        // Find the target again and attempt purchase
        const result = scanPage();
        if (result) {
          // Target was found, attempt purchase
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const text = (el.innerText || '').toLowerCase();
            if (TARGET_KEYWORDS.some(kw => text.includes(kw.toLowerCase())) && text.length < 2000) {
              attemptPurchase(el);
              break;
            }
          }
        }
        sendResponse({ ok: true });
        break;

      case 'STOP':
        isRunning = false;
        checksCount = 0;
        if (checkTimer) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
        removeOverlay();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: true });
    }
    return true;
  });

  // ============================================================
  // Auto-start check on page load (if enabled)
  // ============================================================

  async function init() {
    const result = await chrome.storage.local.get('sniperConfig');
    config = result.sniperConfig;
    if (config && config.enabled) {
      isRunning = true;
      log('Auto-started (was previously enabled)', 'info');
      showOverlay('monitoring', '自动启动监控...');
      scanPage();
    }
  }

  // Also watch for dynamic page changes (SPA navigation)
  const observer = new MutationObserver(() => {
    if (isRunning && config && config.enabled) {
      // Debounce: only scan if last scan was > 1 second ago
      if (!observer._lastScan || Date.now() - observer._lastScan > 1000) {
        observer._lastScan = Date.now();
        scanPage();
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  init();
})();
