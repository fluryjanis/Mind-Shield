const REAL_INPUT_SELECTORS = [
  'rich-textarea div[contenteditable="true"]', // Gemini specific
  'textarea[id="prompt-textarea"]',          // ChatGPT
  'div[contenteditable="true"]',              // Claude, Gemini, X.com, Rich Text Editors
  'textarea[placeholder*="Grok"]',            // Grok.com
  'textarea[placeholder*="Ask"]',             // General fallback
  'textarea[placeholder*="type"]',            // Standard fallback
  'textarea[placeholder*="message"]'          // Standard fallback
];

// Expanded to catch both native <button> and X.com's React Native <div role="button">
const SEND_BUTTON_SELECTORS = [
  // Standard AI Platform Buttons
  'button[data-testid="send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[data-testid*="send"]',
  'button[data-testid*="submit"]',
  'g-icon-button[icon="send"]',
  
  // Standalone Grok.com
  'button[data-testid="grokSendButton"]',
  'button[data-testid="grokSend"]',

  // X.com (Twitter) Grok & UI Selectors
  '[data-testid="grok-send-button"]',
  '[data-testid="grokSendButton"]',
  '[data-testid="grokSend"]',
  '[data-testid*="grok-send"]',
  '[data-testid*="grokSend"]',
  'button[aria-label="Grok something"]',
  'div[role="button"][aria-label="Grok something"]',
  'div[role="button"][aria-label*="Grok"]',
  'div[role="button"][aria-label*="Send"]',
  'div[role="button"][aria-label*="send"]',
  'div[role="button"][data-testid*="grok"]',
  'div[role="button"][data-testid*="send"]',
  'div[role="button"][data-testid*="submit"]',
  '[aria-label="Grok something"]',
  '[aria-label*="Ask Grok"]'
];

let activeLockInterval = null;
let isBypassing = false; // Flag to allow programmatical release without recursive interception

// Listen for diagnostic log relays forwarded from background/offscreen
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'relayLog' && window === window.top) {
    console.log(request.message);
  }
});

// Helper to locate the active native chat input element
function getRealInput() {
  for (const selector of REAL_INPUT_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (
        rect.width > 10 && 
        rect.height > 10 && 
        window.getComputedStyle(el).display !== 'none' &&
        window.getComputedStyle(el).visibility !== 'hidden'
      ) {
        return el;
      }
    }
  }
  return null;
}

// Reads the text currently written inside the native prompt field
function getPromptText() {
  const realInput = getRealInput();
  if (!realInput) return '';

  if (realInput.tagName === 'TEXTAREA' || realInput.tagName === 'INPUT') {
    return realInput.value.trim();
  } else if (realInput.getAttribute('contenteditable') !== null) {
    return (realInput.innerText || realInput.textContent || '').trim();
  }
  return '';
}

// Checks if a given click/pointer target is or is inside a recognized Send button
function findSendButton(target) {
  if (!target || typeof target.closest !== 'function') return null;
  for (const selector of SEND_BUTTON_SELECTORS) {
    const btn = target.closest(selector);
    if (btn) {
      return btn;
    }
  }
  return null;
}

// Triage prompt intent: 'INSTANT_LOCKOUT', 'KNOWLEDGE_PASS', 'THINKING_SCRUTINIZE', or 'GENERAL_PASS'
function evaluatePromptIntent(text) {
  const cleaned = text.trim();
  if (!cleaned) return 'GENERAL_PASS';

  // 1. Instant Factual Knowledge / Reference (Always Bypass AI Lockout)
  const factualKnowledgePatterns = [
    /^(what is the capital of|where is|when was|when did|who is|who was|who invented|who wrote)\b/i,
    /^(what is the definition of|what does\s+[a-zA-Z0-9_-]+\s+mean|define\b)/i,
    /^(what is the syntax for|how to declare|how to install|how to import|how to run|how to write a loop in)\b/i,
    /^(atomic number of|boiling point of|distance between|population of|formula for)\b/i,
    /^(translate\b|what is the spanish|what is the french|what is the german|what is the word for)\b/i
  ];

  for (const pattern of factualKnowledgePatterns) {
    if (pattern.test(cleaned)) {
      return 'KNOWLEDGE_PASS';
    }
  }

  // 2. Direct Cognitive Outsourcing (INSTANT LOCKOUT)
  const instantLockoutPatterns = [
    /^(should i|what should i do|what would you do|if you were me|how would you handle|help me decide|which one is better for me|is it better to)\b/i,
    /^(solve this|solve the following|solve this riddle|solve this puzzle|solve the math)\b/i,
    /^(is\s+[a-zA-Z0-9_ -]+\s+better\s+(than|the)\s+[a-zA-Z0-9_ -]+)\b/i,
    /^(what is your opinion on|what should my opinion be|who is right|who is wrong|in my situation)\b/i,
    /^(give me arguments for|write a conclusion for|analyze my situation|make a choice for me)\b/i,
    /^(why should i|how can i convince|what decision should i make|what do you think i should do)\b/i
  ];

  for (const pattern of instantLockoutPatterns) {
    if (pattern.test(cleaned)) {
      return 'INSTANT_LOCKOUT';
    }
  }

  // 3. Ambiguous Questions (Send to local AI model for zero-shot scrutiny)
  const generalQuestionPattern = /^(what|why|how|when|where|who|whom|whose|which|can|could|would|should|will|shall|may|might|must|is|are|am|was|were|isn't|aren't|wasn't|weren't|do|does|did|don't|doesn't|didn't|has|have|had|haven't|hasn't|hadn't)\b/i;
  if (cleaned.includes('?') || generalQuestionPattern.test(cleaned)) {
    return 'THINKING_SCRUTINIZE';
  }

  return 'GENERAL_PASS';
}

// ---------------------------------------------------------------------------
// Toast Notification Engine
// ---------------------------------------------------------------------------

function getOrCreateToast() {
  let toast = document.getElementById('mindshield-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mindshield-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '96px',
      left: '50%',
      transform: 'translateX(-50%) translateY(20px)',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
      padding: '10px 20px',
      borderRadius: '16px',
      backgroundColor: '#18181b',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 14px rgba(255, 255, 255, 0.05)',
      color: '#f4f4f5',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      transition: 'opacity 0.25s ease, transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease'
    });
    document.body.appendChild(toast);
  }
  return toast;
}

function showToast(type, message) {
  const toast = getOrCreateToast();
  toast.innerHTML = message;

  if (type === 'evaluating') {
    toast.style.borderColor = '#10a37f';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(16, 163, 127, 0.35)';
  } else if (type === 'locked') {
    toast.style.borderColor = '#ef4444';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(239, 68, 68, 0.4)';
  } else if (type === 'success') {
    toast.style.borderColor = '#22c55e';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(34, 197, 94, 0.35)';
  }

  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
}

function hideToast() {
  const toast = document.getElementById('mindshield-toast');
  if (toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }
}

// ---------------------------------------------------------------------------
// Lockout / Cooldown Engine
// ---------------------------------------------------------------------------

function triggerLockout(durationMs = 5000, reason = 'Critical thinking outsourcing detected.') {
  const lockUntil = Date.now() + durationMs;
  chrome.storage.local.set({ mindshield_lock_until: lockUntil });

  function updateTimer() {
    const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(activeLockInterval);
      activeLockInterval = null;
      chrome.storage.local.remove(['mindshield_lock_until']);

      showToast('success', `<span>✅</span> <strong>Unlocked.</strong> Submitting your prompt...`);
      setTimeout(() => {
        hideToast();
        passThroughSubmit();
      }, 800);
      return;
    }

    showToast(
      'locked',
      `<span>🧠</span> <div><strong>MindShield Lock:</strong> ${reason} <span style="color:#f87171; margin-left:6px; font-weight:700;">${remaining}s remaining</span></div>`
    );
  }

  if (activeLockInterval) clearInterval(activeLockInterval);
  updateTimer();
  activeLockInterval = setInterval(updateTimer, 1000);
}

// ---------------------------------------------------------------------------
// Submission Interception & Pass-Through
// ---------------------------------------------------------------------------

function passThroughSubmit() {
  const realInput = getRealInput();
  if (!realInput) return;

  isBypassing = true;

  // 1. Locate platform-specific native submit button (button or div[role="button"])
  let sendBtn = null;
  for (const selector of SEND_BUTTON_SELECTORS) {
    const btn = document.querySelector(selector);
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
      sendBtn = btn;
      break;
    }
  }

  const form = realInput.closest('form');

  if (sendBtn) {
    // Dispatch full pointer and mouse event chain to trigger React Native for Web (X.com)
    sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    sendBtn.click();
  } else if (form) {
    form.requestSubmit();
  } else {
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    realInput.dispatchEvent(enterEvent);
  }

  setTimeout(() => {
    isBypassing = false;
  }, 250);
}

// Main evaluation interceptor triggered on Enter key or Send button click
function interceptSubmission(e) {
  if (isBypassing) return;

  // Check if currently under an active lockout
  if (activeLockInterval) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Pulse the toast to remind user
    const toast = getOrCreateToast();
    toast.style.transform = 'translateX(-50%) scale(1.05)';
    setTimeout(() => { toast.style.transform = 'translateX(-50%) scale(1)'; }, 150);
    return;
  }

  const text = getPromptText();
  if (text.length === 0) return;

  // Tiny queries pass without friction
  if (text.length < 3) {
    return;
  }

  // Elementary math guard: block basic arithmetic calculations immediately
  const simpleMathRegex = /^[\d\s+\-*/()=]+$/;
  const hasLetters = /[a-zA-Z]/.test(text);
  if (simpleMathRegex.test(text) && !hasLetters && text.length < 15) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    console.log("[MindShield] Simple math detected via regex. Initiating lockout.");
    triggerLockout(5000, 'Simple arithmetic detected.');
    return;
  }

  const intent = evaluatePromptIntent(text);

  // 1. Instant Lockout for obvious reasoning/decision outsourcing
  if (intent === 'INSTANT_LOCKOUT') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    console.log("[MindShield] Direct cognitive outsourcing detected. Initiating lockout.");
    triggerLockout(5000, 'Decision or reasoning outsourcing detected.');
    return;
  }

  // 2. Factual knowledge or statements pass through immediately with 0ms delay
  if (intent === 'KNOWLEDGE_PASS' || intent === 'GENERAL_PASS') {
    console.log("[MindShield] Factual / Reference query. Allowing native submission.");
    return; // Let the browser/platform submit naturally
  }

  // 3. Ambiguous questions evaluated by local AI model
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  console.log("[MindShield] Ambiguous query. Scrutinizing with local AI:", text);
  showToast('evaluating', `<span>🧠</span> <span>Checking with local AI...</span>`);

  let hasResponded = false;
  const safetyTimeout = setTimeout(() => {
    if (!hasResponded) {
      hasResponded = true;
      hideToast();
      passThroughSubmit();
    }
  }, 4500);

  try {
    chrome.runtime.sendMessage({ action: 'analyzePrompt', prompt: text }, (response) => {
      if (hasResponded) return;
      hasResponded = true;
      clearTimeout(safetyTimeout);

      if (response && response.success) {
        if (response.isLazy) {
          console.log("[MindShield] Cognitive outsourcing flagged by AI. Lockout started.");
          triggerLockout(5000, 'Critical thinking outsourcing detected.');
        } else {
          hideToast();
          passThroughSubmit();
        }
      } else {
        hideToast();
        passThroughSubmit();
      }
    });
  } catch (err) {
    if (!hasResponded) {
      hasResponded = true;
      clearTimeout(safetyTimeout);
      hideToast();
      passThroughSubmit();
    }
  }
}

// ---------------------------------------------------------------------------
// Document-Level Event Listeners (Capturing Phase)
// ---------------------------------------------------------------------------

// 1. Intercept Enter key submissions (without Shift)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    const realInput = getRealInput();
    if (realInput && (e.target === realInput || realInput.contains(e.target))) {
      interceptSubmission(e);
    }
  }
}, true);

// 2. Intercept Pointerdown / Mousedown on Send buttons (Catches X.com before it consumes the event)
const handleSendButtonTrigger = (e) => {
  const btn = findSendButton(e.target);
  if (btn) {
    interceptSubmission(e);
  }
};

document.addEventListener('pointerdown', handleSendButtonTrigger, true);
document.addEventListener('mousedown', handleSendButtonTrigger, true);
document.addEventListener('click', handleSendButtonTrigger, true);

// Check if a lockout was already in progress upon loading
chrome.storage.local.get(['mindshield_lock_until'], (result) => {
  if (result.mindshield_lock_until && result.mindshield_lock_until > Date.now()) {
    const remainingMs = result.mindshield_lock_until - Date.now();
    triggerLockout(remainingMs, 'Active lockout continuing.');
  }
});