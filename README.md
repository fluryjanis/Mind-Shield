# 🛡️ MindShield

**Use AI without letting it do your thinking for you.**

MindShield is a lightweight browser extension that adds a brief reflection pause when you try to use AI for simple tasks you could potentially handle yourself.

It doesn't try to stop you from using AI. It helps you decide **when you actually need it**.

---

## 📥 Install MindShield

### 🌐 Chrome / Chromium

**[⬇️ Download MindShield v1.1.0 for Chrome](https://github.com/fluryjanis/Mind-Shield/releases/tag/v1.1.5#assets)**

Chrome and Chromium-based browsers currently require a manual installation.

1. Download the ZIP from the **v1.1.0 release**.
2. Extract the ZIP to a folder.
3. Open `chrome://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted MindShield folder.

### 🦊 Firefox

**[⬇️ Download MindShield v1.0.2 for Firefox](https://github.com/fluryjanis/Mind-Shield-Firefox/releases/tag/v1.1.5)**

---

## 🧠 What Is MindShield?

AI makes it incredibly easy to ask for an answer before you've had a chance to think about the problem yourself.

MindShield adds a small amount of friction to those moments.

Instead of blocking AI, it asks:

> **"Do you actually need AI for this?"**

Simple requests can trigger a short reflection pause.

More substantial requests — such as research, debugging, learning, or detailed problem-solving — can pass through normally.

**The goal isn't less AI. It's more intentional AI use.**

---

## ⚡ How It Works

### 1. Write your prompt

Use ChatGPT, Claude, Gemini, or Grok normally.

### 2. MindShield evaluates it

A machine-learning model running locally in your browser evaluates the structure of your prompt.

### 3. Decide whether you need AI

If the request looks like a simple shortcut, MindShield introduces a brief reflection period.

If it appears to be a more substantial task, it can be submitted immediately.

---

## 🎯 What MindShield Is Designed For

MindShield is particularly useful when you catch yourself asking AI to:

- Perform a simple calculation
- Answer something you could easily look up or remember
- Make a small decision for you
- Write something you could quickly formulate yourself
- Solve a problem before you've tried solving it

It is **not** designed to prevent legitimate AI use.

Use AI when it genuinely helps.

---

## 🌐 Supported AI Platforms

MindShield currently supports:

- **ChatGPT**
- **Claude**
- **Google Gemini**
- **Grok**

---

## 🔒 Privacy First

MindShield is designed around local processing.

Prompt evaluation happens **on your device** using an on-device machine-learning model compiled for WebAssembly.

Your prompts are not sent to an external classification server.

**No tracking.  
No analytics.  
No cloud prompt analysis.**

The project is open source, so you can inspect how it works yourself.

---

## ⚙️ Built for a Lightweight Experience

MindShield evaluates prompts in the background using browser scheduling APIs so that its classification work does not unnecessarily interfere with typing or normal browsing.

The local model is based on:

`DistilBERT-MNLI`

and runs through WebAssembly directly in the browser.

---

## 💡 Why MindShield Exists

AI is becoming extremely good at doing things for us.

That's useful.

But convenience can also make it easy to stop practicing skills that we still want to maintain ourselves.

MindShield is an experiment in a different approach:

**Don't remove AI. Add just enough friction to make using it a conscious choice.**

---

## 🧪 Project Status

MindShield is an experimental open-source project exploring behavioral interventions for AI use.

The classification system is not intended to perfectly determine whether someone "should" use AI.

It is simply a tool for introducing a moment of reflection when a prompt appears to be a simple shortcut.

---

## 📦 Source Code

- **[MindShield — Chrome](https://github.com/fluryjanis/Mind-Shield)**
- **[MindShield — Firefox](https://github.com/fluryjanis/Mind-Shield-Firefox)**
- **[Frog1230 Portfolio](https://fluryjanis.github.io/frog1230.github.io/)**

---

## 📜 Changelog

### v1.0.2

Latest release.

See the [Chrome release](https://github.com/fluryjanis/Mind-Shield/releases/tag/v1.1.5) and [Firefox release](https://github.com/fluryjanis/Mind-Shield-Firefox/releases/tag/v1.1.5) for the available downloads.

### v1.0.0

- Added support for ChatGPT, Claude, Gemini, and Grok.
- Added local `DistilBERT-MNLI` prompt classification.
- Added reflection timer for simple shortcut prompts.
- Added background evaluation using `requestIdleCallback`.
- Added local WebAssembly inference.

---

## 📜 Privacy & Disclaimer

MindShield does **not intentionally collect, store, or transmit your prompts, browsing history, or personal information**.

MindShield is provided **"as is"** without warranty of any kind. The developer is not responsible for issues or damages resulting from use of the software.
