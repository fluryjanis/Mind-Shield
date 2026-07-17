// Pre-configure the ONNX Runtime and Transformers.js environment before modules load.
self.env = {
  allowLocalModels: false, // Fetch weights dynamically (safe binary data, not executable)
  backends: {
    onnx: {
      wasm: {
        numThreads: 1, // FIX: Disable multi-threading to prevent worker spawning (resolves extension CSP/hang crashes)
        wasmPaths: chrome.runtime.getURL('transformers/')
      }
    }
  }
};
console.log("[MindShield Config] Global environment pre-configured with local WASM paths.");