const REAL_INPUT_SELECTORS = [
  'rich-textarea div[contenteditable="true"]', // Gemini specific
  'textarea[id="prompt-textarea"]',          // ChatGPT
  'div[contenteditable="true"]',              // Claude, Gemini, Rich Text Editors
  'textarea[placeholder*="Grok"]',            // Grok.com
  'textarea[placeholder*="Ask"]',             // General fallback
  'textarea[placeholder*="type"]',            // Standard fallback
  'textarea[placeholder*="message"]'          // Standard fallback
];

let cachedRealInput = null;
let cachedContainer = null;
let containerResizeObserver = null;
let activeLockInterval = null;
let activeSyncInterval = null;
let initialFocusLockInterval = null;
let syncDebounceTimer = null;
let mutationThrottleTimer = null;
let lastSyncedText = '';
let isBypassing = false;

// Global Capturing Focus Shield: Intercepts React/Claude/Gemini autofocus whenever native input renders
document.addEventListener('focusin', (e) => {
  if (isBypassing) return;
  const fakeInput = document.getElementById('mindshield-fake-input');
  if (!fakeInput || fakeInput.disabled || document.activeElement === fakeInput) return;

  const realInput = getRealInput();
  if (realInput && (e.target === realInput || realInput.contains(e.target))) {
    e.preventDefault();
    e.stopImmediatePropagation();
    fakeInput.focus();
  }
}, true);

// Listen for diagnostic log relays forwarded from background/offscreen
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'relayLog') {
    if (window === window.top) {
      console.log(request.message);
    }
  }
});

// Holds focus aggressively during the initial page loading & framework mounting phase
function startInitialFocusLock(durationMs = 5000) {
  if (initialFocusLockInterval) clearInterval(initialFocusLockInterval);
  const startTime = Date.now();

  initialFocusLockInterval = setInterval(() => {
    if (Date.now() - startTime > durationMs || isBypassing) {
      clearInterval(initialFocusLockInterval);
      initialFocusLockInterval = null;
      return;
    }

    const fakeInput = document.getElementById('mindshield-fake-input');
    if (fakeInput && !fakeInput.disabled) {
      const active = document.activeElement;
      const realInput = getRealInput();

      if (!active || active === document.body || active === realInput || (realInput && realInput.contains(active))) {
        fakeInput.focus();
      }
    }
  }, 100);
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

  // 3. Ambiguous Questions (Send to local AI for zero-shot scrutiny)
  const generalQuestionPattern = /^(what|why|how|when|where|who|whom|whose|which|can|could|would|should|will|shall|may|might|must|is|are|am|was|were|isn't|aren't|wasn't|weren't|do|does|did|don't|doesn't|didn't|has|have|had|haven't|hasn't|hadn't)\b/i;
  if (cleaned.includes('?') || generalQuestionPattern.test(cleaned)) {
    return 'THINKING_SCRUTINIZE';
  }

  return 'GENERAL_PASS';
}

function focusFakeInput(fakeInput) {
  if (!fakeInput || fakeInput.disabled || isBypassing) return;
  fakeInput.focus();
}

// Locates the native chat input field with caching
function getRealInput(forceRefresh = false) {
  if (!forceRefresh && cachedRealInput && cachedRealInput.isConnected) {
    return cachedRealInput;
  }

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
        cachedRealInput = el;
        return el;
      }
    }
  }
  return null;
}

// Locates the outer capsule of the input area based on the platform
function getOverlayContainer(realInput) {
  if (!realInput) return null;
  if (cachedContainer && cachedContainer.isConnected) {
    return cachedContainer;
  }

  const hostname = window.location.hostname;
  let container = null;

  if (hostname.includes('gemini.google.com')) {
    container = realInput.closest('.single-line-format') || 
                realInput.closest('rich-textarea') || 
                realInput.parentElement;
  } else if (hostname.includes('claude.ai')) {
    container = realInput.closest('.relative.font-large') || 
                realInput.closest('[class*="font-large"]') || 
                realInput.parentElement;
  } else if (hostname.includes('chatgpt.com')) {
    container = realInput.parentElement;
  } else if (hostname.includes('grok.com') || hostname.includes('x.com')) {
    container = realInput.closest('[data-testid="chat-input"]') || realInput.parentElement;
  } else {
    let el = realInput.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 5) {
      const buttons = Array.from(el.querySelectorAll('button')).filter(btn => {
        return btn.id !== 'mindshield-fake-btn' && !btn.closest('#mindshield-wrapper');
      });
      if (buttons.length > 0) {
        container = el;
        break;
      }
      el = el.parentElement;
      depth++;
    }
    if (!container) container = realInput.parentElement;
  }

  cachedContainer = container;
  return container;
}

// Injects text safely into React/Angular/Lit state
function setReactInputValue(inputElement, text) {
  if (!inputElement) return;
  
  if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (nativeValueSetter) {
      nativeValueSetter.call(inputElement, text);
    } else {
      inputElement.value = text;
    }
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (inputElement.getAttribute('contenteditable') !== null) {
    const isGemini = window.location.hostname.includes('gemini.google.com');
    if (isGemini) {
      if (text.length === 0) {
        inputElement.innerHTML = '<p><br></p>';
      } else {
        inputElement.innerHTML = `<p>${text.replace(/\n/g, '<br>')}</p>`;
      }
    } else {
      inputElement.innerText = text;
    }
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Background sync to trigger host capsule auto-expansion
function syncTextToNativeInput() {
  if (isBypassing) return;
  const fakeInput = document.getElementById('mindshield-fake-input');
  const realInput = getRealInput();
  if (!fakeInput || !realInput) return;

  const currentText = fakeInput.value;
  if (currentText !== lastSyncedText) {
    lastSyncedText = currentText;
    setReactInputValue(realInput, currentText);
  }
}

// Positions the floating body overlay over the target container
function updateOverlayPosition() {
  const wrapper = document.getElementById('mindshield-wrapper');
  const realInput = getRealInput();
  if (!wrapper || !realInput) return;

  const container = getOverlayContainer(realInput);
  if (!container) return;

  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    wrapper.style.display = 'none';
    return;
  }

  wrapper.style.display = 'flex';
  wrapper.style.top = `${rect.top}px`;
  wrapper.style.left = `${rect.left}px`;
  wrapper.style.width = `${rect.width}px`;
  wrapper.style.height = `${rect.height}px`;
}

// Builds the visual portal overlay attached directly to document.body
function injectOverlay() {
  const isClaude = window.location.hostname.includes('claude.ai');
  const isGemini = window.location.hostname.includes('gemini.google.com');
  const isGrok = window.location.hostname.includes('grok.com') || window.location.hostname.includes('x.com');

  if (window.location.hostname.includes('x.com')) {
    if (!window.location.pathname.includes('/grok')) return; 
  }

  const realInput = getRealInput(true);
  if (!realInput) return;

  const existingWrapper = document.getElementById('mindshield-wrapper');
  if (existingWrapper && existingWrapper.isConnected) {
    updateOverlayPosition();
    return;
  }

  const container = getOverlayContainer(realInput);
  if (!container) return;

  realInput.setAttribute('tabindex', '-1');

  const computedStyle = window.getComputedStyle(container);
  const nativeRadius = parseInt(computedStyle.borderRadius, 10);
  const roundedBorderRadius = isGemini 
    ? '16px' 
    : (isClaude ? '18px' : ((!isNaN(nativeRadius) && nativeRadius > 16) ? computedStyle.borderRadius : '26px'));

  const wrapper = document.createElement('div');
  wrapper.id = 'mindshield-wrapper';
  Object.assign(wrapper.style, {
    position: 'fixed',
    zIndex: '2147483647',
    backgroundColor: isGemini ? 'transparent' : ((isClaude) ? '#1f1f23' : '#171719'),
    borderRadius: roundedBorderRadius,
    display: 'flex',
    alignItems: 'center',
    padding: isGemini ? '0' : (isClaude ? '4px 6px' : '6px 10px'),
    boxSizing: 'border-box',
    border: isGemini ? 'none' : '1px solid rgba(255, 255, 255, 0.12)',
    boxShadow: isGemini ? 'none' : '0 4px 20px rgba(0, 0, 0, 0.25)',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    cursor: 'text',
    overflow: 'hidden'
  });

  const innerBox = document.createElement('div');
  innerBox.id = 'mindshield-inner-box';
  Object.assign(innerBox.style, {
    flex: '1',
    width: '100%',
    height: '100%',
    backgroundColor: isGemini ? '#26272b' : '#2b2b30',
    borderRadius: isGemini ? '16px' : (isClaude ? '12px' : '20px'),
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    padding: isGemini ? '2px 14px' : '4px 12px',
    boxSizing: 'border-box',
    overflow: 'hidden'
  });

  const fakeInput = document.createElement('textarea');
  fakeInput.id = 'mindshield-fake-input';
  fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
  fakeInput.setAttribute('tabindex', '0');
  
  Object.assign(fakeInput.style, {
    width: '100%',
    height: '100%',
    minHeight: '24px',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#F3F3F5',
    caretColor: '#FFFFFF',
    fontSize: '15px',
    lineHeight: isGemini ? '24px' : '20px',
    resize: 'none',
    fontFamily: 'inherit',
    paddingTop: isGemini ? '8px' : '4px',
    paddingBottom: isGemini ? '4px' : '4px',
    boxSizing: 'border-box',
    scrollbarWidth: 'none',
    cursor: 'text'
  });

  // Intercept image/file pastes and forward them directly to the native input
  fakeInput.addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const hasFiles = clipboardData.files && clipboardData.files.length > 0;
    let hasImageItem = false;
    if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        if (clipboardData.items[i].type.startsWith('image/') || clipboardData.items[i].kind === 'file') {
          hasImageItem = true;
          break;
        }
      }
    }

    if (hasFiles || hasImageItem) {
      const real = getRealInput();
      if (real) {
        isBypassing = true;
        try {
          const dt = new DataTransfer();
          for (let i = 0; i < clipboardData.files.length; i++) {
            dt.items.add(clipboardData.files[i]);
          }
          const text = clipboardData.getData('text/plain');
          if (text) {
            dt.setData('text/plain', text);
          }

          const pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });

          real.dispatchEvent(pasteEvt);
          console.log("[MindShield] Image/File clipboard paste successfully forwarded to native prompt area.");
        } catch (err) {
          console.warn("[MindShield] Failed to forward image paste event:", err);
        } finally {
          setTimeout(() => { isBypassing = false; }, 120);
        }
      }
    }
  });

  // Forward drag-and-drop file operations to native prompt area
  wrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    const real = getRealInput();
    if (real) {
      const dragEvt = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: e.dataTransfer
      });
      real.dispatchEvent(dragEvt);
    }
  });

  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    const real = getRealInput();
    if (real) {
      const dropEvt = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: e.dataTransfer
      });
      real.dispatchEvent(dropEvt);
      console.log("[MindShield] Dropped file/image forwarded to native prompt area.");
    }
  });

  const handleFocusClick = (e) => {
    if (e.target.id !== 'mindshield-fake-btn' && !e.target.closest('#mindshield-fake-btn')) {
      focusFakeInput(fakeInput);
    }
  };

  wrapper.addEventListener('click', handleFocusClick);
  innerBox.addEventListener('click', handleFocusClick);

  const prefilledText = (realInput.value || realInput.innerText || '').trim();
  if (prefilledText.length > 0) {
    fakeInput.value = prefilledText;
    lastSyncedText = prefilledText;
  }

  const fakeBtn = document.createElement('button');
  fakeBtn.id = 'mindshield-fake-btn';
  fakeBtn.setAttribute('tabindex', '0');
  fakeBtn.setAttribute('title', 'Send message');
  fakeBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 19V5M12 5L5 12M12 5L19 12" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  Object.assign(fakeBtn.style, {
    width: '34px',
    height: '34px',
    minWidth: '34px',
    minHeight: '34px',
    background: '#38383e',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '8px',
    transition: 'all 0.2s ease',
    alignSelf: 'flex-end',
    marginBottom: '2px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)'
  });

  fakeBtn.onmouseover = () => fakeBtn.style.background = '#50505a';
  fakeBtn.onmouseout = () => fakeBtn.style.background = '#38383e';

  innerBox.appendChild(fakeInput);
  wrapper.appendChild(innerBox);
  wrapper.appendChild(fakeBtn);

  document.body.appendChild(wrapper);
  updateOverlayPosition();

  if (containerResizeObserver) containerResizeObserver.disconnect();
  containerResizeObserver = new ResizeObserver(() => updateOverlayPosition());
  containerResizeObserver.observe(container);

  // Focus immediately upon mounting and lock focus during framework initialization
  focusFakeInput(fakeInput);
  startInitialFocusLock(5000);

  if (activeSyncInterval) clearInterval(activeSyncInterval);
  activeSyncInterval = setInterval(syncTextToNativeInput, 500);

  fakeInput.addEventListener('input', () => {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(syncTextToNativeInput, 300);
  });

  if (isClaude || isGemini || isGrok) {
    fakeBtn.style.display = 'none';

    const nativeSendBtn = document.querySelector('button[aria-label*="Send"]') ||
                          document.querySelector('button[aria-label*="send"]') ||
                          document.querySelector('button[data-testid*="send"]') ||
                          document.querySelector('g-icon-button[icon="send"]') ||
                          document.querySelector('button[aria-label="Grok something"]') ||
                          document.querySelector('[data-testid="grokSendButton"]') ||
                          document.querySelector('[data-testid="grokSend"]');

    if (nativeSendBtn) {
      nativeSendBtn.addEventListener('click', (e) => {
        if (isBypassing) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        processPrompt(fakeInput);
      }, true);
    }
  }

  fakeBtn.addEventListener('click', () => processPrompt(fakeInput));
  
  fakeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      clearTimeout(syncDebounceTimer);
      processPrompt(fakeInput);
    }
  });

  chrome.storage.local.get(['mindshield_download_status', 'mindshield_download_progress', 'mindshield_download_file', 'mindshield_download_error'], (result) => {
    if (result.mindshield_download_status === 'downloading') {
      updateOverlayDownloadState('downloading', result.mindshield_download_progress || 0, result.mindshield_download_file);
    } else if (result.mindshield_download_status === 'failed') {
      updateOverlayDownloadState('failed', 0, result.mindshield_download_error);
    }
  });
}

// Window resize & scroll positioning
window.addEventListener('scroll', updateOverlayPosition, { capture: true, passive: true });
window.addEventListener('resize', updateOverlayPosition, { passive: true });

// Process prompt inputs
function processPrompt(fakeInput) {
  const text = fakeInput.value.trim();
  if (text.length === 0) return;

  if (text.length < 3) {
    releaseAndSubmit(text);
    return;
  }

  // Elementary math guard: block basic calculations immediately
  const simpleMathRegex = /^[\d\s+\-*/()=]+$/;
  const hasLetters = /[a-zA-Z]/.test(text);
  if (simpleMathRegex.test(text) && !hasLetters && text.length < 15) {
    console.log("[MindShield] Simple math detected via regex. Initiating lockout.");
    const cooldownTime = Date.now() + (5 * 1000);
    chrome.storage.local.set({ 
      mindshield_lock_until: cooldownTime,
      mindshield_lock_text: text 
    }, () => {
      activateLockoutState(cooldownTime, text);
    });
    return;
  }

  const intent = evaluatePromptIntent(text);

  // 1. Direct Instant Lockout for obvious reasoning/decision outsourcing
  if (intent === 'INSTANT_LOCKOUT') {
    console.log("[MindShield] Direct cognitive outsourcing detected. Initiating lockout.");
    const cooldownTime = Date.now() + (5 * 1000);
    chrome.storage.local.set({ 
      mindshield_lock_until: cooldownTime,
      mindshield_lock_text: text 
    }, () => {
      activateLockoutState(cooldownTime, text);
    });
    return;
  }

  // 2. Knowledge or general non-questions pass through instantly
  if (intent === 'KNOWLEDGE_PASS' || intent === 'GENERAL_PASS') {
    console.log("[MindShield] Factual / Reference query. Submitting without delay.");
    releaseAndSubmit(text);
    return;
  }

  // 3. Ambiguous questions evaluated by local AI in offscreen RAM
  console.log("[MindShield] Ambiguous query. Scrutinizing with local AI:", text);

  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');
  const innerBox = document.getElementById('mindshield-inner-box');

  if (wrapper) {
    fakeInput.disabled = true;
    if (fakeBtn) fakeBtn.disabled = true;
    fakeInput.placeholder = "🧠 Checking if you're outsourcing critical thinking... Please wait.";
    wrapper.style.borderColor = '#10a37f';
    wrapper.style.boxShadow = '0 0 14px rgba(16, 163, 127, 0.35)';
    if (innerBox) {
      innerBox.style.borderColor = 'rgba(16, 163, 127, 0.4)';
    }
  }

  let hasResponded = false;

  const safetyTimeout = setTimeout(() => {
    if (!hasResponded) {
      hasResponded = true;
      releaseAndSubmit(text);
    }
  }, 4500);

  try {
    chrome.runtime.sendMessage({ action: 'analyzePrompt', prompt: text }, (response) => {
      if (hasResponded) return;
      hasResponded = true;
      clearTimeout(safetyTimeout);

      if (response && response.success) {
        if (response.isLazy) {
          console.log("[MindShield] Cognitive outsourcing flagged. Lockout started.");
          const cooldownTime = Date.now() + (5 * 1000);
          chrome.storage.local.set({ 
            mindshield_lock_until: cooldownTime,
            mindshield_lock_text: text 
          }, () => {
            activateLockoutState(cooldownTime, text);
          });
        } else {
          releaseAndSubmit(text);
        }
      } else {
        releaseAndSubmit(text);
      }
    });
  } catch (err) {
    if (!hasResponded) {
      hasResponded = true;
      clearTimeout(safetyTimeout);
      releaseAndSubmit(text);
    }
  }
}

// Releases approved text to native state and triggers submission
function releaseAndSubmit(text) {
  const realInput = getRealInput();
  if (!realInput) return;

  isBypassing = true;
  realInput.focus();
  setReactInputValue(realInput, text);
  lastSyncedText = '';

  const fakeInput = document.getElementById('mindshield-fake-input');
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');
  const innerBox = document.getElementById('mindshield-inner-box');

  if (fakeInput && wrapper) {
    fakeInput.disabled = false;
    if (fakeBtn) fakeBtn.disabled = false;
    fakeInput.value = '';
    fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
    wrapper.style.borderColor = 'rgba(255, 255, 255, 0.12)';
    wrapper.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.25)';
    if (innerBox) {
      innerBox.style.borderColor = 'rgba(255, 255, 255, 0.08)';
    }
  }

  setTimeout(() => {
    const container = getOverlayContainer(realInput);
    const buttons = container ? Array.from(container.querySelectorAll('button')) : [];
    
    const nativeButtons = buttons.filter(btn => {
      return btn.id !== 'mindshield-fake-btn' && !btn.closest('#mindshield-wrapper');
    });
    
    let realBtn = nativeButtons[nativeButtons.length - 1];

    if (!realBtn) {
      realBtn = document.querySelector('button[aria-label="Send Message"]') ||
                document.querySelector('button[aria-label*="Send"]') || 
                document.querySelector('button[aria-label*="send"]') || 
                document.querySelector('g-icon-button[icon="send"]') ||
                document.querySelector('button[aria-label="Grok something"]') || 
                document.querySelector('button[data-testid="send-button"]') || 
                document.querySelector('button[data-testid*="send"]') || 
                document.querySelector('button[class*="send"]') ||
                document.querySelector('button[data-testid*="submit"]') ||
                document.querySelector('[data-testid="grokSendButton"]') || 
                document.querySelector('[data-testid="grokSend"]');
    }

    const form = realInput.closest('form');

    if (realBtn && !realBtn.disabled) {
      realBtn.click();
    } else if (form) {
      form.requestSubmit();
    } else if (realBtn) {
      setTimeout(() => realBtn.click(), 50);
    } else {
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      });
      realInput.dispatchEvent(enterEvent);
    }
    
    // Automatically restore focus back to the fake input after submission completes
    setTimeout(() => {
      isBypassing = false;
      const currentFake = document.getElementById('mindshield-fake-input');
      if (currentFake && !currentFake.disabled) {
        focusFakeInput(currentFake);
      }
    }, 120);
  }, 100);
}

// Locks fake elements and displays active countdown
function activateLockoutState(lockUntil, autoSubmitText = '') {
  const fakeInput = document.getElementById('mindshield-fake-input');
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');
  const innerBox = document.getElementById('mindshield-inner-box');
  const realInput = getRealInput();

  if (!fakeInput || !wrapper) return;

  if (realInput) {
    setReactInputValue(realInput, '');
    lastSyncedText = '';
  }

  fakeInput.disabled = true;
  if (fakeBtn) fakeBtn.disabled = true;
  fakeInput.blur();
  wrapper.style.borderColor = '#ff4d4d';
  wrapper.style.boxShadow = '0 0 14px rgba(255, 77, 77, 0.35)';
  if (innerBox) {
    innerBox.style.borderColor = 'rgba(255, 77, 77, 0.5)';
  }

  function updateTimer() {
    const remaining = Math.max(0, Math.round((lockUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(activeLockInterval);
      
      fakeInput.disabled = false;
      if (fakeBtn) fakeBtn.disabled = false;
      fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
      wrapper.style.borderColor = 'rgba(255, 255, 255, 0.12)';
      wrapper.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.25)';
      if (innerBox) {
        innerBox.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      }
      focusFakeInput(fakeInput);
      
      chrome.storage.local.remove(['mindshield_lock_until', 'mindshield_lock_text']);

      if (autoSubmitText) {
        releaseAndSubmit(autoSubmitText);
      }
      return;
    }

    fakeInput.value = '';
    fakeInput.placeholder = `🧠 locked, brain drain warning. Active for: ${remaining}s`;
  }

  clearInterval(activeLockInterval);
  updateTimer();
  activeLockInterval = setInterval(updateTimer, 1000);
}

// Download status visuals
function updateOverlayDownloadState(status, progress, file) {
  const fakeInput = document.getElementById('mindshield-fake-input');
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');
  const innerBox = document.getElementById('mindshield-inner-box');

  if (!fakeInput || !wrapper) return;

  if (status === 'downloading') {
    fakeInput.disabled = true;
    if (fakeBtn) fakeBtn.disabled = true;
    fakeInput.value = '';
    fakeInput.placeholder = `🧠 Initializing local AI... [${progress}% completed] (File: ${file || 'weights'}). Please wait.`;
    wrapper.style.borderColor = '#e0a800';
    wrapper.style.boxShadow = '0 0 14px rgba(224, 168, 0, 0.35)';
    if (innerBox) innerBox.style.borderColor = 'rgba(224, 168, 0, 0.4)';
  } else if (status === 'failed') {
    fakeInput.disabled = true;
    if (fakeBtn) fakeBtn.disabled = true;
    fakeInput.value = '';
    fakeInput.placeholder = `❌ Local AI Setup Failed: ${file || 'Initialization error'}. Try reloading the extension.`;
    wrapper.style.borderColor = '#ff4d4d';
    wrapper.style.boxShadow = '0 0 14px rgba(255, 77, 77, 0.35)';
    if (innerBox) innerBox.style.borderColor = 'rgba(255, 77, 77, 0.5)';
  } else if (status === 'ready') {
    chrome.storage.local.get(['mindshield_lock_until'], (result) => {
      if (result.mindshield_lock_until && result.mindshield_lock_until > Date.now()) {
        return;
      }
      fakeInput.disabled = false;
      if (fakeBtn) fakeBtn.disabled = false;
      fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
      wrapper.style.borderColor = 'rgba(255, 255, 255, 0.12)';
      wrapper.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.25)';
      if (innerBox) innerBox.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      focusFakeInput(fakeInput);
    });
  }
}

// Immediate Mutation Engine: Instantly detects when React/Claude renders the prompt box
function initOverlayEngine() {
  injectOverlay();

  const observer = new MutationObserver(() => {
    const existing = document.getElementById('mindshield-wrapper');
    if (!existing || !existing.isConnected) {
      if (!mutationThrottleTimer) {
        mutationThrottleTimer = setTimeout(() => {
          injectOverlay();
          mutationThrottleTimer = null;
        }, 20);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  setInterval(injectOverlay, 1500);
}

// Initialization hooks
initOverlayEngine();

chrome.storage.local.get(['mindshield_lock_until'], (result) => {
  if (result.mindshield_lock_until && result.mindshield_lock_until > Date.now()) {
    setTimeout(() => {
      chrome.storage.local.get(['mindshield_lock_text'], (storageResult) => {
        activateLockoutState(result.mindshield_lock_until, storageResult.mindshield_lock_text || '');
      });
    }, 200);
  }
});

// Reactively update overlay during model download progress
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.mindshield_download_status || changes.mindshield_download_progress || changes.mindshield_download_error) {
      chrome.storage.local.get(['mindshield_download_status', 'mindshield_download_progress', 'mindshield_download_file', 'mindshield_download_error'], (result) => {
        updateOverlayDownloadState(
          result.mindshield_download_status,
          result.mindshield_download_progress || 0,
          result.mindshield_download_status === 'failed' ? result.mindshield_download_error : result.mindshield_download_file
        );
      });
    }
  }
});