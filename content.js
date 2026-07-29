const REAL_INPUT_SELECTORS = [
  'textarea[id="prompt-textarea"]',          // ChatGPT
  'div[contenteditable="true"]',              // Claude, Gemini, Rich Text Editors
  'textarea[placeholder*="Grok"]',            // Grok.com
  'textarea[placeholder*="Ask"]',             // General fallback
  'textarea[placeholder*="type"]',            // Standard fallback
  'textarea[placeholder*="message"]'          // Standard fallback
];

let activeLockInterval = null;
let isBypassing = false; // Prevent the focus listener from redirecting during programmatical submission

// Listen for diagnostic log relays forwarded from the background and offscreen threads
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'relayLog') {
    if (window === window.top) {
      console.log(request.message);
    }
  }
});

// Locates the native chat input field
function getRealInput() {
  for (const selector of REAL_INPUT_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      
      // Verify the element is visible, rendered, and has physical dimensions
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

// Locates the outer container or capsule of the input area based on the platform
function getOverlayContainer(realInput) {
  if (!realInput) return null;

  const hostname = window.location.hostname;

  // 1. ChatGPT-Specific Layout Engine:
  // Targets strictly the inner, text-entering grey box instead of the outer white capsule
  if (hostname.includes('chatgpt.com')) {
    console.log("[MindShield] ChatGPT-specific text container targeted.");
    return realInput.parentElement;
  }

  // 2. Gemini-Specific Layout Engine:
  // Target strictly the .single-line-format container as discovered in DOM inspection
  if (hostname.includes('gemini.google.com')) {
    console.log("[MindShield] Gemini-specific text container targeted.");
    return realInput.closest('.single-line-format') || 
           realInput.closest('.text-input-field') || 
           realInput.closest('[class*="simplified-input-area"]') || 
           realInput.closest('rich-textarea') || 
           realInput.parentElement;
  }

  // 3. Grok-Specific Layout Engine (grok.com & x.com/grok):
  // Target strictly the chat-input element to keep the surrounding model selector and attachments visible
  if (hostname.includes('grok.com') || hostname.includes('x.com')) {
    console.log("[MindShield] Grok-specific text container targeted.");
    return realInput.closest('[data-testid="chat-input"]') || realInput.parentElement;
  }

  // 4. Adaptive LCA Layout Engine (Claude):
  // Climbs the DOM tree with a strict depth limit to locate the outermost capsule
  const realBtn = document.querySelector('button[data-testid="send-button"]') || 
                  document.querySelector('button[aria-label*="Send"]') ||
                  document.querySelector('button[class*="send"]') ||
                  document.querySelector('button[data-testid*="submit"]') ||
                  document.querySelector('g-icon-button[icon="send"]');

  let el = realInput.parentElement;
  let depth = 0;
  
  // Cap climbing depth at 5 levels. Prevents the climber from escaping the input zone and reaching <main>
  while (el && el !== document.body && depth < 5) {
    const buttons = Array.from(el.querySelectorAll('button')).filter(btn => {
      return btn.id !== 'mindshield-fake-btn' && !btn.closest('#mindshield-wrapper');
    });
    
    if (buttons.length > 0) {
      return el;
    }
    el = el.parentElement;
    depth++;
  }

  return realInput.parentElement;
}

// Bypasses React's virtual DOM bindings to force-inject text into its state
function setReactInputValue(inputElement, text) {
  if (!inputElement) return;
  
  if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeValueSetter.call(inputElement, text);
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (inputElement.getAttribute('contenteditable') !== null) {
    inputElement.innerText = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Builds the visual overlay over the native prompt area
function injectOverlay() {
  const isGrok = window.location.hostname.includes('grok.com') || window.location.hostname.includes('x.com');

  // Safe path guard for Twitter (x.com) to prevent overlaying your normal tweet compose boxes
  if (window.location.hostname.includes('x.com')) {
    if (!window.location.pathname.includes('/grok')) {
      return; 
    }
  }

  const realInput = getRealInput();
  if (!realInput) return;

  if (document.getElementById('mindshield-wrapper')) return;

  // Resolve the true outermost capsule wrapper using our platform-aware algorithm
  const container = getOverlayContainer(realInput);
  if (!container) return;

  container.style.position = 'relative';

  // Redirect focus from the hidden real input back onto our visible fake input
  // This defeats any focus-stealing scripts on Grok, ChatGPT, or Claude
  realInput.addEventListener('focus', (e) => {
    if (isBypassing) return;
    const fakeInput = document.getElementById('mindshield-fake-input');
    if (fakeInput && !fakeInput.disabled) {
      e.preventDefault();
      fakeInput.focus();
    }
  }, true);

  // Dynamic border-radius query to automatically match the target platform's native capsule roundness
  const computedStyle = window.getComputedStyle(container);
  const inheritedBorderRadius = computedStyle.borderRadius || '12px';

  const wrapper = document.createElement('div');
  wrapper.id = 'mindshield-wrapper';
  Object.assign(wrapper.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: '#171717',
    zIndex: '9999',
    borderRadius: inheritedBorderRadius, // Pixel-perfect inheritance
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    boxSizing: 'border-box',
    border: '1px solid #444',
    fontFamily: 'system-ui, sans-serif',
    transition: 'border-color 0.3s'
  });

  const fakeInput = document.createElement('textarea');
  fakeInput.id = 'mindshield-fake-input';
  fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
  Object.assign(fakeInput.style, {
    width: '100%',
    height: '100%',
    maxHeight: '120px',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#ECECF1',
    fontSize: '15px',
    resize: 'none',
    fontFamily: 'inherit',
    paddingTop: '8px',
    boxSizing: 'border-box'
  });

  const fakeBtn = document.createElement('button');
  fakeBtn.id = 'mindshield-fake-btn';
  fakeBtn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 2L11 13M22 2L15 22L11 13M11 13L2 9L22 2" stroke="#ECECF1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  Object.assign(fakeBtn.style, {
    background: '#202123',
    border: '1px solid #4e4f50',
    borderRadius: '8px',
    padding: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '8px',
    transition: 'background 0.2s'
  });

  fakeBtn.onmouseover = () => fakeBtn.style.background = '#343541';
  fakeBtn.onmouseout = () => fakeBtn.style.background = '#202123';

  wrapper.appendChild(fakeInput);
  wrapper.appendChild(fakeBtn);
  container.appendChild(wrapper);

  // On Grok, we hide our custom fake button to keep their native model changing dropdown & paperclip visible
  if (isGrok) {
    fakeBtn.style.display = 'none';
    
    // Bind click interceptor directly to Grok's real send button
    const realBtn = document.querySelector('button[aria-label="Grok something"]') || // FIX: Twitter Grok send button identifier
                    document.querySelector('button[class*="rounded-"]') || 
                    document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button[class*="send"]') ||
                    document.querySelector('[data-testid="grokSendButton"]') || // grok.com identifier
                    document.querySelector('[data-testid="grokSend"]'); // Secondary Twitter Grok identifier
                    
    if (realBtn) {
      realBtn.addEventListener('click', (e) => {
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
      processPrompt(fakeInput);
    }
  });

  // Check initial download/install state once overlay renders
  chrome.storage.local.get(['mindshield_download_status', 'mindshield_download_progress', 'mindshield_download_file', 'mindshield_download_error'], (result) => {
    if (result.mindshield_download_status === 'downloading') {
      updateOverlayDownloadState('downloading', result.mindshield_download_progress || 0, result.mindshield_download_file);
    } else if (result.mindshield_download_status === 'failed') {
      updateOverlayDownloadState('failed', 0, result.mindshield_download_error);
    }
  });
}

// Process the input prompt
function processPrompt(fakeInput) {
  const text = fakeInput.value.trim();
  
  // If the text area is completely empty, do nothing
  if (text.length === 0) return;

  // If the prompt is short (1 or 2 characters, like "??"), bypass AI checks and submit immediately
  if (text.length < 3) {
    console.log("[MindShield] Short prompt bypass submitted:", text);
    releaseAndSubmit(text);
    return;
  }

  console.log("[MindShield] Processing prompt from overlay:", text);

  // Instantly disable inputs and show a "Checking" visual state on the overlay
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');
  if (fakeBtn && wrapper) {
    fakeInput.disabled = true;
    fakeBtn.disabled = true;
    fakeInput.placeholder = "🧠 Checking your prompt with local AI... Please wait.";
    wrapper.style.borderColor = '#10a37f'; // Teal checking border
  }

  // Immediate Regex Guard to block basic arithmetic expressions (e.g. "1+1", "5 * 10", "12/3") instantly
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

  let hasResponded = false;

  const safetyTimeout = setTimeout(() => {
    if (!hasResponded) {
      hasResponded = true;
      console.warn("[MindShield] Background timeout reached. Submitting fail-safe.");
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
          console.log("[MindShield] Lazy query blocked.");
          const cooldownTime = Date.now() + (5 * 1000);
          
          chrome.storage.local.set({ 
            mindshield_lock_until: cooldownTime,
            mindshield_lock_text: text
          }, () => {
            activateLockoutState(cooldownTime, text);
          });
        } else {
          console.log("[MindShield] Prompt approved. Submitting.");
          releaseAndSubmit(text);
        }
      } else {
        console.warn("[MindShield] Analysis failed or timed out. Bypassing.", response?.error);
        releaseAndSubmit(text);
      }
    });
  } catch (err) {
    if (!hasResponded) {
      hasResponded = true;
      clearTimeout(safetyTimeout);
      console.warn("[MindShield] Exception caught. Submitting bypass:", err.message);
      releaseAndSubmit(text);
    }
  }
}

// Copies approved text to hidden state, submits, and cleans fake text area
function releaseAndSubmit(text) {
  const realInput = getRealInput();
  if (!realInput) return;

  isBypassing = true; // Prevent the focus listener from redirecting during programmatical submission
  realInput.focus();
  setReactInputValue(realInput, text);

  // Restore the fake input and button states back to normal so the next prompt can be typed
  const fakeInput = document.getElementById('mindshield-fake-input');
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');

  if (fakeInput && fakeBtn && wrapper) {
    fakeInput.disabled = false;
    fakeBtn.disabled = false;
    fakeInput.value = '';
    fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
    wrapper.style.borderColor = '#444';
  }

  setTimeout(() => {
    const container = getOverlayContainer(realInput);
    const buttons = container ? Array.from(container.querySelectorAll('button')) : [];
    
    // Filter out our custom button using Javascript checks so it can never be targeted
    const nativeButtons = buttons.filter(btn => {
      return btn.id !== 'mindshield-fake-btn' && !btn.closest('#mindshield-wrapper');
    });
    
    let realBtn = nativeButtons[nativeButtons.length - 1];

    // String fallbacks if the DOM layout is empty or if we are using the isolated ChatGPT/Gemini containers
    if (!realBtn) {
      realBtn = document.querySelector('button[aria-label="Grok something"]') || // FIX: Target X.com's stable accessibility label
                document.querySelector('button[data-testid="send-button"]') || 
                document.querySelector('button[aria-label*="Send"]') ||
                document.querySelector('button[class*="send"]') ||
                document.querySelector('button[data-testid*="submit"]') ||
                document.querySelector('[data-testid="grokSendButton"]') || // grok.com send button
                document.querySelector('[data-testid="grokSend"]') || // Twitter's Grok send button
                document.querySelector('g-icon-button[icon="send"]'); // Gemini send button icon wrapper
    }

    const form = realInput.closest('form');

    if (realBtn && !realBtn.disabled) {
      console.log("[MindShield] Clicking submit button:", realBtn);
      realBtn.click();
    } else if (form) {
      console.log("[MindShield] Submit button disabled or missing. Requesting form submit.");
      form.requestSubmit();
    } else if (realBtn) {
      // Secondary 50ms fallback retry if React is slow to toggle the disabled attribute
      console.log("[MindShield] Button found but temporarily disabled. Retrying...");
      setTimeout(() => {
        realBtn.click();
      }, 50);
    } else {
      console.log("[MindShield] Dispatching keydown submission fallback.");
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      });
      realInput.dispatchEvent(enterEvent);
    }
    
    isBypassing = false; // Reset bypass state after trigger completes
  }, 100);
}

// Locks fake elements and starts visual countdown
function activateLockoutState(lockUntil, autoSubmitText = '') {
  const fakeInput = document.getElementById('mindshield-fake-input');
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');

  if (!fakeInput || !fakeBtn || !wrapper) return;

  fakeInput.disabled = true;
  fakeBtn.disabled = true;
  wrapper.style.borderColor = '#ff4d4d';

  // Locks fake elements and starts visual countdown
  function updateTimer() {
    const remaining = Math.max(0, Math.round((lockUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(activeLockInterval);
      
      fakeInput.disabled = false;
      fakeBtn.disabled = false;
      fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
      wrapper.style.borderColor = '#444';
      fakeInput.focus();
      
      chrome.storage.local.remove(['mindshield_lock_until', 'mindshield_lock_text']);

      if (autoSubmitText) {
        console.log("[MindShield] Lockout expired. Releasing and submitting prompt:", autoSubmitText);
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

// Updates overlay inputs visually during background installation phase
function updateOverlayDownloadState(status, progress, file) {
  const fakeInput = document.getElementById('mindshield-fake-input');
  const fakeBtn = document.getElementById('mindshield-fake-btn');
  const wrapper = document.getElementById('mindshield-wrapper');

  if (!fakeInput || !fakeBtn || !wrapper) return;

  if (status === 'downloading') {
    fakeInput.disabled = true;
    fakeBtn.disabled = true;
    fakeInput.value = '';
    fakeInput.placeholder = `🧠 Initializing local AI... [${progress}% completed] (File: ${file || 'weights'}). Please wait.`;
    wrapper.style.borderColor = '#e0a800';
  } else if (status === 'failed') {
    fakeInput.disabled = true;
    fakeBtn.disabled = true;
    fakeInput.value = '';
    fakeInput.placeholder = `❌ Local AI Setup Failed: ${file || 'Initialization error'}. Try reloading the extension.`;
    wrapper.style.borderColor = '#ff4d4d';
  } else if (status === 'ready') {
    chrome.storage.local.get(['mindshield_lock_until'], (result) => {
      if (result.mindshield_lock_until && result.mindshield_lock_until > Date.now()) {
        return;
      }
      fakeInput.disabled = false;
      fakeBtn.disabled = false;
      fakeInput.placeholder = "Protecting your mind... Type your prompt here.";
      wrapper.style.borderColor = '#444';
    });
  }
}

// Wrap overlay injection checks inside requestIdleCallback and run once every 2 seconds.
// This ensures checks only execute when Chrome's main thread is resting, completely resolving forced reflows.
function initOverlayEngine() {
  if (window.requestIdleCallback) {
    requestIdleCallback(() => injectOverlay());
    setInterval(() => {
      requestIdleCallback(() => injectOverlay());
    }, 2000);
  } else {
    injectOverlay();
    setInterval(injectOverlay, 2000);
  }
}

// Check for active lockouts or download states upon load
chrome.storage.local.get(['mindshield_lock_until'], (result) => {
  initOverlayEngine();
  if (result.mindshield_lock_until && result.mindshield_lock_until > Date.now()) {
    setTimeout(() => {
      chrome.storage.local.get(['mindshield_lock_text'], (storageResult) => {
        activateLockoutState(result.mindshield_lock_until, storageResult.mindshield_lock_text || '');
      });
    }, 200);
  }
});

// Reactively listen to live model download progress updates
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

console.log("[MindShield] Overlay content script running.");