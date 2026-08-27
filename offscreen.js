import * as TransformersModule from './transformers/transformers.js';

const pipeline = TransformersModule.pipeline || self.pipeline || self.transformers?.pipeline;
const env = TransformersModule.env || self.env || self.transformers?.env;

function relayLog(message) {
  console.log(message);
  try {
    chrome.runtime.sendMessage({ action: 'relayLog', message: "[Offscreen] " + message });
  } catch (e) {}
}

let classifierPromise = null;

async function getClassifier() {
  if (!pipeline) {
    throw new Error("Transformers library failed to expose the 'pipeline' function.");
  }

  if (!classifierPromise) {
    relayLog("Loading 28MB classification model into RAM...");
    try {
      classifierPromise = pipeline(
        'zero-shot-classification', 
        'Xenova/distilbert-base-uncased-mnli',
        { device: 'wasm' }
      );
      await classifierPromise;
      relayLog("Model ready in RAM.");
    } catch (err) {
      relayLog("Failed to load model: " + err.message);
      classifierPromise = null;
      throw err;
    }
  }
  return classifierPromise;
}

getClassifier().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  relayLog("Received prompt for evaluation: " + message.prompt);

  getClassifier()
    .then(async (classifier) => {
      // 3-Tier Multi-Intent Labels
      const candidateLabels = [
        "solving a logic puzzle, riddle, math problem, or test question",
        "asking for personal advice, social reply drafting, subjective decision, or action steps",
        "asking for a factual explanation, concept breakdown, critique, or learning inquiry"
      ];

      const results = await classifier(
        message.prompt, 
        candidateLabels, 
        { hypothesis_template: "The user is asking for {}." }
      );

      relayLog("Raw classification results: " + JSON.stringify(results));
      
      const topLabel = results.labels[0];
      const topScore = results.scores[0];

      let tier = 'PASS';
      if (topLabel === candidateLabels[0] && topScore > 0.40) {
        tier = 'FLAGGED';
      } else if (topLabel === candidateLabels[1] && topScore > 0.38) {
        tier = 'WARNING';
      }

      relayLog(`Classification Tier: ${tier} [Top: "${topLabel}" (${(topScore * 100).toFixed(1)}%)]`);
      sendResponse({ success: true, tier });
    })
    .catch(err => {
      relayLog("Evaluation error: " + err.message);
      sendResponse({ success: false, error: err.message });
    });

  return true;
});

try {
  chrome.runtime.sendMessage({ action: 'offscreenReady' });
} catch (e) {}