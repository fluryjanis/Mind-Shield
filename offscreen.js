// Universal namespace import to support both ESM named exports and UMD browser bundles
import * as TransformersModule from './transformers/transformers.js';

// Fallback chain: attempts ESM namespace first, then global self, then global transformers namespace
const pipeline = TransformersModule.pipeline || self.pipeline || self.transformers?.pipeline;
const env = TransformersModule.env || self.env || self.transformers?.env;

function relayLog(message) {
  console.log(message);
  try {
    chrome.runtime.sendMessage({ action: 'relayLog', message: "[Offscreen] " + message });
  } catch (e) {}
}

// Helper to delegate storage updates to the service worker since storage is restricted in offscreen contexts
function setStorageDownloadStatus(status, progress = 0, file = '') {
  try {
    chrome.runtime.sendMessage({
      action: 'updateDownloadStatus',
      status: status,
      progress: progress,
      file: file
    });
  } catch (e) {
    console.warn("[Offscreen] Failed to send storage update message:", e.message);
  }
}

relayLog("Loading offscreen thread...");
relayLog("Verified WebAssembly path: " + env?.backends?.onnx?.wasm?.wasmPaths);

let classifierPromise = null;

async function getClassifier() {
  if (!pipeline) {
    throw new Error("Transformers library failed to expose the 'pipeline' function. Ensure your local bundle is copied correctly.");
  }

  if (!classifierPromise) {
    relayLog("Downloading and loading 28MB classification model...");
    try {
      classifierPromise = pipeline(
        'zero-shot-classification', 
        'Xenova/distilbert-base-uncased-mnli',
        {
          device: 'wasm',
          progress_callback: (progress) => {
            if (progress.status === 'progress') {
              const percent = Math.round(progress.loaded / progress.total * 100);
              const msg = `Model Download - ${progress.file}: ${percent}%`;
              relayLog(msg);
              
              setStorageDownloadStatus('downloading', percent, progress.file);
            }
          }
        }
      );
      await classifierPromise;
      relayLog("Model successfully loaded and ready in memory.");
      setStorageDownloadStatus('ready');
    } catch (err) {
      relayLog("Failed to load model: " + err.message);
      classifierPromise = null;
      setStorageDownloadStatus('failed', 0, err.message);
      throw err;
    }
  }
  return classifierPromise;
}

// Pre-load the classifier instantly on startup
getClassifier().catch(err => {
  relayLog("Pre-load failed during startup initialization: " + err.message);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  relayLog("Received prompt for evaluation: " + message.prompt);

  getClassifier()
    .then(async (classifier) => {
      relayLog("Running zero-shot classification on prompt...");
      
      // FIX: Robust three-category classification cleanly separates simple queries from factual lookup and logic tasks
      const results = await classifier(
        message.prompt, 
        [
          "simple query",
          "factual reference",
          "complex analysis"
        ], 
        {
          hypothesis_template: "This text is a {}"
        }
      );

      relayLog("Raw classification results: " + JSON.stringify(results));
      
      // Strict check: if the top-ranked category is "simple query", initiate the lockout
      const isLazy = results.labels[0] === "simple query";
      relayLog("Classification decision (isLazy): " + isLazy);
      
      sendResponse({ success: true, isLazy });
    })
    .catch(err => {
      relayLog("Evaluation pipeline crash: " + err.message);
      sendResponse({ success: false, error: err.message });
    });

  return true; // Keep response port alive for async response
});

// Broadcast handshake
try {
  chrome.runtime.sendMessage({ action: 'offscreenReady' }, (response) => {
    relayLog("Handshake registered with Service Worker.");
  });
} catch (e) {
  console.warn("[MindShield Offscreen] Handshake broadcast failed. Service worker may not be active yet.");
}

relayLog("Listener initialized.");