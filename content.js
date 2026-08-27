const REAL_INPUT_SELECTORS = [
  'rich-textarea div[contenteditable="true"]', // Gemini specific
  'textarea[id="prompt-textarea"]',          // ChatGPT
  'div[contenteditable="true"]',              // Claude, Gemini, X.com, Rich Text Editors
  'textarea[placeholder*="Grok"]',            // Grok.com
  'textarea[placeholder*="Ask"]',             // General fallback
  'textarea[placeholder*="type"]',            // Standard fallback
  'textarea[placeholder*="message"]'          // Standard fallback
];

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[data-testid*="send"]',
  'button[data-testid*="submit"]',
  'g-icon-button[icon="send"]',
  'button[data-testid="grokSendButton"]',
  'button[data-testid="grokSend"]',
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
let warningDismissTimer = null;
let currentPath = window.location.pathname;
let isBypassing = false;

// Listen for diagnostic log relays forwarded from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'relayLog' && window === window.top) {
    console.log(request.message);
  }
});

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

function findSendButton(target) {
  if (!target || typeof target.closest !== 'function') return null;
  for (const selector of SEND_BUTTON_SELECTORS) {
    const btn = target.closest(selector);
    if (btn) return btn;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intent Triage Engine with Multi-Sentence & Unanchored Scanning
// ---------------------------------------------------------------------------

function evaluatePromptIntent(text) {
  const cleaned = text.trim();
  if (!cleaned) return 'PASS';

  // 1. Length Guard: 400+ characters automatically pass (code blocks, context dumps)
  if (cleaned.length > 400) {
    console.log("[MindShield] Large prompt (>400 chars). Bypassing AI evaluation.");
    return 'PASS';
  }

  // 2. Mental Math / Calculations (WARNING — Soft Reminder)
  const isRawArithmetic = /^[\d\s+\-*/()=%$.,]+$/.test(cleaned) && /[+\-*/%=]/.test(cleaned) && !/[a-zA-Z]/.test(cleaned);
  const mathWordPatterns = /\b(calculate|what is \d+[\s\S]*%|convert \d+[\s\S]*(to|in|fahrenheit|celsius|km|miles|usd|eur))\b/i;
  if (isRawArithmetic || mathWordPatterns.test(cleaned)) {
    return 'WARNING_MATH';
  }

  // 3. Direct Problem / Riddle / Homework Surrender (FLAGGED — Tier 3: 5s Lockout)
  const directSolvePatterns = [
    /\b(solve this (riddle|puzzle|problem|equation|homework|assignment))\b/i,
    /\b(find the solution to this (riddle|puzzle|problem))\b/i,
    /\b(give me the answer to this (problem|riddle|puzzle|exam))\b/i,
    /\b(do my homework for me|solve for x:)\b/i
  ];
  for (const pattern of directSolvePatterns) {
    if (pattern.test(cleaned)) return 'FLAGGED';
  }

  // 4. Collaborative Review & Feedback (PASS — Tier 1)
  const collaborativeReviewPatterns = [
    /\b(can you review|please review|review (this|my)|give me feedback on|critique my|second opinion on)\b/i,
    /\b(is my (argument|code|logic|reasoning|math) (sound|valid|correct)|does this make sense)\b/i,
    /\b(did i (do|write|calculate) this (right|correctly)|check my work|proofread my|double check my)\b/i
  ];
  for (const pattern of collaborativeReviewPatterns) {
    if (pattern.test(cleaned)) return 'PASS';
  }

  // 5. Analytical Explanations & Comparisons (PASS — Tier 1)
  const analyticalPatterns = [
    /\b(why (does|do|is|did|are|would)\b|explain (how|why|the mechanism|the concept of))\b/i,
    /\b(what are the (advantages|disadvantages|pros and cons|benefits|tradeoffs) of)\b/i,
    /\b(what is the difference between|compare and contrast|how does\s+[a-zA-Z0-9_-]+\s+differ from)\b/i
  ];
  for (const pattern of analyticalPatterns) {
    if (pattern.test(cleaned)) return 'PASS';
  }

  // 6. Factual Knowledge & Definitions (PASS — Tier 1)
  const factualKnowledgePatterns = [
    /\b(what is the capital of|where is|when was|when did|who is|who was|who invented|who wrote)\b/i,
    /\b(what is the definition of|what does\s+[a-zA-Z0-9_-]+\s+mean|define\b)/i,
    /\b(what is the syntax for|how to declare|how to install|how to import|how to run|how to write a loop in)\b/i,
    /\b(atomic number of|boiling point of|distance between|population of|formula for)\b/i,
    /\b(translate\b|what is the spanish|what is the french|what is the german|what is the word for)\b/i
  ];
  for (const pattern of factualKnowledgePatterns) {
    if (pattern.test(cleaned)) return 'PASS';
  }

  // 7. Social & Communication Offloading (WARNING — Tier 2)
  const socialOffloadPatterns = [
    /\b(what should i (respond|reply|say|text)|how should i (respond|reply|text|answer))\b/i,
    /\b(what is a good (comeback|reply|response)|how do i tell (him|her|them|my boss|my coworker))\b/i,
    /\b((draft|write) (a|my) (reply|response|text|message|email) (to|for))\b/i
  ];
  for (const pattern of socialOffloadPatterns) {
    if (pattern.test(cleaned)) return 'WARNING_COMMUNICATION';
  }

  // 8. Action Prescriptions & Diagnostic Surrender (WARNING — Tier 2)
  const actionPrescriptionPatterns = [
    /\b(tell me (exactly )?what to do|tell me my next steps|what are my next steps)\b/i,
    /\b(figure (this|it|out) (for me|what happened)|just tell me what i need to do)\b/i,
    /\b(what should my (course of action|next step|plan) be)\b/i
  ];
  for (const pattern of actionPrescriptionPatterns) {
    if (pattern.test(cleaned)) return 'WARNING_PRESCRIPTION';
  }

  // 9. Subjective Decisions & Personal Advice (WARNING — Tier 2)
  const subjectiveDecisionPatterns = [
    /\b(should i (choose|pick|buy|take|quit|stay|invest|switch)|which (one )?should i (choose|pick|buy|take))\b/i,
    /\b(what would you do (in my situation|if you were me)|if you were in my shoes)\b/i,
    /\b(help me decide|who is (in the )?right|who is wrong|what should my opinion be)\b/i
  ];
  for (const pattern of subjectiveDecisionPatterns) {
    if (pattern.test(cleaned)) return 'WARNING_DECISION';
  }

  // 10. Task Automation (WARNING — Tier 2)
  const taskAutomationPatterns = [
    /\b(convert this (list|table|csv|text) (in)?to (json|yaml|markdown|csv|table|an array))\b/i,
    /\b(extract all (emails|phone numbers|urls|links|dates) from)\b/i,
    /\b(format this (data|text|code|table) as|reformat this list)\b/i
  ];
  for (const pattern of taskAutomationPatterns) {
    if (pattern.test(cleaned)) return 'WARNING_AUTOMATION';
  }

  // 11. Conversational & Casual Statements (PASS — Tier 1)
  const conversationPatterns = [
    /\b(i (built|created|made|saw|think|feel|wrote)|just wanted to share|today i)\b/i,
    /\b(hello|hi|hey|good morning|good evening|knock knock|idk|thanks|thank you|ok|cool)\b/i
  ];
  for (const pattern of conversationPatterns) {
    if (pattern.test(cleaned)) return 'PASS';
  }

  // 12. Ambiguous Questions -> Delegate to Zero-Shot Local AI
  const generalQuestionPattern = /\b(what|why|how|when|where|who|whom|whose|which|can|could|would|should|will|shall|may|might|must|is|are|am|was|were|isn't|aren't|wasn't|weren't|do|does|did|don't|doesn't|didn't|has|have|had|haven't|hasn't|hadn't)\b/i;
  if (cleaned.includes('?') || generalQuestionPattern.test(cleaned)) {
    return 'SCRUTINIZE';
  }

  return 'PASS';
}

// ---------------------------------------------------------------------------
// Toast Notification Engine (Zero-innerHTML / Safe DOM Construction)
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

function showToast(type, titleText, detailText = '', timerText = '') {
  const toast = getOrCreateToast();
  toast.textContent = '';

  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '16px';

  const textWrap = document.createElement('div');
  textWrap.style.display = 'flex';
  textWrap.style.alignItems = 'center';
  textWrap.style.gap = '6px';

  const titleEl = document.createElement('strong');
  titleEl.textContent = titleText;
  textWrap.appendChild(titleEl);

  if (detailText) {
    const detailEl = document.createElement('span');
    detailEl.textContent = detailText;
    textWrap.appendChild(detailEl);
  }

  if (timerText) {
    const timerSpan = document.createElement('span');
    timerSpan.style.color = '#f87171';
    timerSpan.style.fontWeight = '700';
    timerSpan.style.marginLeft = '4px';
    timerSpan.textContent = timerText;
    textWrap.appendChild(timerSpan);
  }

  if (type === 'evaluating') {
    iconSpan.textContent = '🧠';
    toast.style.borderColor = '#10a37f';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(16, 163, 127, 0.35)';
  } else if (type === 'warning') {
    iconSpan.textContent = '⚠️';
    toast.style.borderColor = '#f59e0b';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(245, 158, 11, 0.35)';
  } else if (type === 'locked') {
    iconSpan.textContent = '🧠';
    toast.style.borderColor = '#ef4444';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(239, 68, 68, 0.4)';
  } else if (type === 'success') {
    iconSpan.textContent = '✅';
    toast.style.borderColor = '#22c55e';
    toast.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 16px rgba(34, 197, 94, 0.35)';
  }

  toast.appendChild(iconSpan);
  toast.appendChild(textWrap);

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
// Lockout & Warning Triggers (Tab-Scoped)
// ---------------------------------------------------------------------------

function triggerWarningToast(message, detail = 'Consider your own perspective first.') {
  showToast('warning', message, detail);
  if (warningDismissTimer) clearTimeout(warningDismissTimer);
  warningDismissTimer = setTimeout(() => {
    hideToast();
  }, 4000);
}

function triggerLockout(durationMs = 5000, reason = 'Problem-solving outsourcing detected.') {
  const lockUntil = Date.now() + durationMs;

  function updateTimer() {
    const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(activeLockInterval);
      activeLockInterval = null;

      showToast('success', 'Unlocked.', 'Submitting prompt...');
      setTimeout(() => {
        hideToast();
        passThroughSubmit();
      }, 700);
      return;
    }

    showToast('locked', 'MindShield Lock:', reason, `${remaining}s remaining`);
  }

  if (activeLockInterval) clearInterval(activeLockInterval);
  updateTimer();
  activeLockInterval = setInterval(updateTimer, 1000);
}

function teardownStateOnNavigation() {
  if (window.location.pathname !== currentPath) {
    currentPath = window.location.pathname;
    if (activeLockInterval) {
      clearInterval(activeLockInterval);
      activeLockInterval = null;
    }
    if (warningDismissTimer) {
      clearTimeout(warningDismissTimer);
      warningDismissTimer = null;
    }
    hideToast();
    isBypassing = false;
  }
}

// ---------------------------------------------------------------------------
// Submission Interception & Pass-Through
// ---------------------------------------------------------------------------

function passThroughSubmit() {
  const realInput = getRealInput();
  if (!realInput) return;

  isBypassing = true;

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

function interceptSubmission(e) {
  if (isBypassing) return;

  if (activeLockInterval) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const toast = getOrCreateToast();
    toast.style.transform = 'translateX(-50%) scale(1.05)';
    setTimeout(() => { toast.style.transform = 'translateX(-50%) scale(1)'; }, 150);
    return;
  }

  const text = getPromptText();
  if (text.length === 0 || text.length < 3) return;

  const intent = evaluatePromptIntent(text);

  // Tier 1: Immediate Pass (0ms delay)
  if (intent === 'PASS') {
    return;
  }

  // Tier 2: Warnings (Submits immediately while showing informative toast)
  if (intent === 'WARNING_MATH') {
    triggerWarningToast('Mental Math Reminder:', 'Consider calculating mentally before asking AI.');
    return;
  }

  if (intent === 'WARNING_COMMUNICATION') {
    triggerWarningToast('Communication Outsourcing:', 'Consider drafting your own reply first.');
    return;
  }

  if (intent === 'WARNING_PRESCRIPTION') {
    triggerWarningToast('Action Prescription:', 'Try diagnosing the root cause first.');
    return;
  }

  if (intent === 'WARNING_DECISION') {
    triggerWarningToast('Decision Outsourcing:', 'Consider your own judgment first.');
    return;
  }

  if (intent === 'WARNING_AUTOMATION') {
    triggerWarningToast('Task Automation:', 'Delegating formatting chore.');
    return;
  }

  // Tier 3: Direct Problem Solving (5s Lockout)
  if (intent === 'FLAGGED') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    triggerLockout(5000, 'Direct problem-solving outsourcing detected.');
    return;
  }

  // Tier 3 Ambiguous: Scrutinized by Local AI
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  showToast('evaluating', 'Thinking...', 'Checking prompt with local AI');

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
        if (response.tier === 'FLAGGED') {
          triggerLockout(5000, 'Problem-solving outsourcing detected.');
        } else if (response.tier === 'WARNING') {
          hideToast();
          triggerWarningToast('Notice:', 'AI used for subjective guidance.');
          passThroughSubmit();
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
// Document-Level Event Listeners
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    const realInput = getRealInput();
    if (realInput && (e.target === realInput || realInput.contains(e.target))) {
      interceptSubmission(e);
    }
  }
}, true);

const handleSendButtonTrigger = (e) => {
  const btn = findSendButton(e.target);
  if (btn) {
    interceptSubmission(e);
  }
};

document.addEventListener('pointerdown', handleSendButtonTrigger, true);
document.addEventListener('mousedown', handleSendButtonTrigger, true);
document.addEventListener('click', handleSendButtonTrigger, true);

window.addEventListener('popstate', teardownStateOnNavigation);
setInterval(teardownStateOnNavigation, 1000);