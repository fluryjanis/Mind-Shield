#  MindShield

**MindShield** is a lightweight behavioral intervention tool designed to help you build mindful habits around conversational AI. Created and developed by **Janis Flury** (aka **Frog1230**).

---

##  What It Is

MindShield is a privacy-first browser extension that counters cognitive offloading, breaks AI dependency, and protects your cognitive independence. By introducing a brief 5-second friction point when lazy shortcuts are submitted, MindShield encourages active problem-solving and ensures you use AI as a productive partner rather than a cognitive crutch.

### How It Works:
1. **Write Your Prompt:** Type naturally into your favorite AI tool.
2. **Local Evaluation:** When submitted, MindShield’s on-device AI quickly analyzes the structure and complexity of your query.
3. **The reflextion time triggered by "brain drain" prompt:** 
   * **Lazy Shortcuts:** If your prompt is flagged as a simple query, the input locks for a brief 5-second countdown to encourage independent thought. When it reaches zero, it automatically submits—no re-typing required.
   * **Instant Approval:** Complex prompts, step-by-step educational requests, debugging, and factual research bypass the timer and are submitted instantly.

### Key Features:
* **Multi-Platform Support:** Works seamlessly across ChatGPT, Claude, Google Gemini, and Grok (grok.com & x.com).
* **100% Local AI Processing:** Uses a private, on-device machine learning model (`DistilBERT-MNLI`) compiled natively via WebAssembly. Your prompts are evaluated entirely in your browser and never sent to external servers.
* **Lag-Free Performance:** Uses browser idle-scheduling APIs (`requestIdleCallback`) so background checks never interfere with typing performance.

---

##  Why It Exists

We often default to asking AI for simple answers we could easily compute, recall, or decide ourselves. Over-relying on conversational AI for trivial tasks leads to subtle cognitive offloading. MindShield acts as an intellectual speed bump, helping you pause, reflect, and maintain your critical thinking skills without disrupting your productive workflows.

---

##  Download Link

* **Download on itch.io:** [frog1230.itch.io/mind-shield](https://frog1230.itch.io/mind-shield)

### Chrome / Unpacked Installation:
1. Download the extension ZIP file and extract it to a folder.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Toggle **Developer mode** to **ON** in the top right corner.
4. Click **Load unpacked** in the top left and select your extracted folder.

---

##  GitHub

* **Source Code:** [fluryjanis/Mind-Shield](https://github.com/fluryjanis/Mind-Shield)
* **Developer Portfolio:** [Frog1230 Portfolio](https://fluryjanis.github.io/frog1230.github.io/)

---

##  Changelog

### Version 1.0.0 (Initial Release)
* Multi-platform support for ChatGPT, Claude, Gemini, and Grok.
* Integrated local `DistilBERT-MNLI` WebAssembly model for offline prompt classification.
* Added 5-second friction timer for lazy shortcut detection.
* Implemented lag-free `requestIdleCallback` background evaluation.

---

##  Privacy Policy & Disclaimer

* **Privacy First:** MindShield does **not** collect, store, or transmit your prompts, browsing history, or personal information.
* **Disclaimer:** Provided "as is" without warranty of any kind. The developer is not liable for any issues that may arise from use.
