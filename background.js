let offscreenCreated = false;
let offscreenReadyPromise = null;
let resolveOffscreenReady = null;

function initOffscreenReadyPromise() {
  offscreenReadyPromise = new Promise((resolve) => {
    resolveOffscreenReady = resolve;
  });
}

initOffscreenReadyPromise();

// Broadcasts log events to any open ChatGPT, Claude, Gemini, or Grok tab consoles
function relayLog(message) {
  console.log(message);
  chrome.tabs.query({ url: [
    "https://chatgpt.com/*", 
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://x.com/*",
    "https://grok.com/*"
  ] }, (tabs) => {
    if (tabs) {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { action: 'relayLog', message: message }).catch(() => {});
      }
    }
  });
}

// Trigger model pre-load instantly on installation/update
chrome.runtime.onInstalled.addListener((details) => {
  relayLog("[Background] Extension installed/updated. Pre-loading local AI...");
  chrome.storage.local.set({ 
    mindshield_download_status: 'downloading', 
    mindshield_download_progress: 0,
    mindshield_download_file: 'initializing'
  });
  
  createOffscreen().catch(err => {
    relayLog("[Background Error] Failed to pre-load on install: " + err.message);
  });
});

async function createOffscreen() {
  if (offscreenCreated) {
    return offscreenReadyPromise;
  }

  relayLog("[Background] Attempting to create offscreen context...");
  try {
    // Force-close any orphan/zombie offscreen document if it exists to prevent duplication errors
    await chrome.offscreen.closeDocument().catch(() => {});

    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['DOM_PARSER'],
      justification: 'Run WebAssembly and local ONNX/Transformers model execution'
    });
    offscreenCreated = true;
    relayLog("[Background] Offscreen context successfully created. Awaiting handshake...");
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("already exists")) {
      relayLog("[Background] Offscreen document is already open.");
      offscreenCreated = true;
      if (resolveOffscreenReady) resolveOffscreenReady();
    } else {
      relayLog("[Background Error] Creating offscreen context: " + err.message);
      throw err;
    }
  }

  return offscreenReadyPromise;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'relayLog') {
    relayLog(request.message);
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'updateDownloadStatus') {
    chrome.storage.local.set({
      mindshield_download_status: request.status,
      mindshield_download_progress: request.progress,
      mindshield_download_file: request.file || ''
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("[Background Error] Failed to write storage:", chrome.runtime.lastError.message);
      }
    });
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'offscreenReady') {
    relayLog("[Background] Offscreen handshake received. Channel is ready.");
    if (resolveOffscreenReady) {
      resolveOffscreenReady();
    }
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'analyzePrompt') {
    relayLog("[Background] Received analyze request for prompt: " + request.prompt);
    createOffscreen()
      .then(() => {
        relayLog("[Background] Forwarding request to verified offscreen channel...");
        chrome.runtime.sendMessage({
          target: 'offscreen',
          prompt: request.prompt
        }, (response) => {
          const lastErr = chrome.runtime.lastError;
          
          // Force-close the offscreen document immediately after evaluation completes to release memory/threads
          chrome.offscreen.closeDocument().catch(() => {});
          offscreenCreated = false;
          initOffscreenReadyPromise();

          if (lastErr) {
            relayLog("[Background Error] Message to offscreen failed: " + lastErr.message);
            sendResponse({ success: false, error: lastErr.message });
          } else {
            relayLog("[Background] Received classification response.");
            sendResponse(response);
          }
        });
      })
      .catch(err => {
        relayLog("[Background Error] Failed in pipeline: " + err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep port open for async response
  }
});

relayLog("[Background] Service worker initialized.");