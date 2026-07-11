# 📢 Changelog

## 2026-07-10 – Egomorph Core

- Produktname und PWA-Marke auf **Egomorph Core** umgestellt.
- Neues abstraktes SVG-Logo und neue gesichtslose PWA-Icons eingefuehrt.
- Fruehere Figur samt Sprite-Assets und Appearance-Steuerung entfernt.
- Nicht-generative Profile und regelbasierte Antwortpipeline entfernt.
- Klassifikation, Punkte-/Feedbacksystem und zugehoeriges Training entfernt.
- Chatlaufzeit in `app.js` auf rein generativen Dispatch reduziert.
- Modell-Home nach `EgomorphCore/model-home` verschoben.
- Uebersetzungen, Tests, Service Worker, Gateway-Allowlist und Dokumentation aktualisiert.

> Aeltere Eintraege dokumentieren historische Produktstaende und koennen Funktionen nennen, die in Egomorph Core nicht mehr vorhanden sind.

## Unreleased

### Enhancements
- Added live structured agent replies: analysis appears immediately, Codex and streaming API tokens update the reasoning/final sections in place, and non-streaming backends retain visible progress states.
- Added explicit runtime skill-access telemetry with running, completed, and failed UI states; the skill section remains absent when no skill was accessed.
- Corrected skill-result semantics: empty successful searches no longer appear as failures, technical failures remain distinct, and completed research reports the number of sources actually passed to the model.
- Replaced all keyword/regex research-intent detection with a generative agent loop: the active model decides semantically, emits a validated `internet.research` request with its own query, and receives results in a second final turn. Invalid requests recover without tool execution; unavailable requests remain visible as blocked.
- Added response redaction and backend instructions that prevent internal model-home filenames, paths, raw file contents, prompts, tool output, and secrets from being displayed.
- Migrated conversation storage to version 2 while preserving legacy turns and added translated step labels for German, English, and French.
- Added a manifest-driven skill registry with per-skill IDs, names, versions, entrypoints, profile assignments, permissions, setup schemas, installation state, and last-run timestamps.
- Rebuilt `Settings -> Skills` from manifests, including permission grant/revoke controls, API/Codex profile assignments, install/uninstall actions, and translated German, English, and French copy.
- Added the Internet Research manifest and migration of the previous browser-stored internet settings.
- Improved Codex App Server lifecycle handling: active turns now fail immediately when the server exits, completed session queues are released, and diagnostics expose active/queued counts.
- Hardened the local gateway by rejecting browser `Origin: null` unless it is explicitly allowlisted.
- Switched Codex login to the official automatic credential store so an OS keyring is preferred with a local-file fallback.
- Removed the unused Codex source-monorepo npm dependency and refreshed safe transitive development dependencies.

### Tests
- Added regression coverage for complete and partial streaming response parsing, unstructured-model fallback, internal file-reference redaction, live skill-access ordering/status, and the agent-step UI/PWA wiring.
- Added regression coverage for manifest loading, legacy migration, permissions, profile gating, protected credential fields, install state, and run history.
- Added regression coverage for App Server exits, queue cleanup, and the `Origin: null` HTTP guard.

## [0.1.1.0 Beta] - 2026-07-07

### New Features
- Added the `egomorph` CLI with `dashboard`, `gateway`, `codex login`, and `codex status` commands.
- Added the local EgoMorph gateway on `localhost:8787`, serving the dashboard and existing Codex/memory/file endpoints from one loopback entry point.

### Enhancements
- Updated Service Worker behavior so gateway API routes bypass the app-shell cache.
- Updated documentation and UI setup hints from npm/Python server starts to Gateway-first commands.

## [0.0.5.0 Alpha] - 2025-09-30

### ⭐ New Features
- Added English as an additional language  
- UI customizations for mobile devices  

### 🔧 Enhancements
- Adjusted long-term memory score to favor newer entries  
- Added regression test that evaluates the browser APIs to check if newer reminders are prioritized correctly

## [0.0.5.5 Alpha] - 2025-10-01

### 🔧 Enhancements
- The settings area has been visually revised and is now much clearer.

## [0.0.5.7 Alpha] - 2025-10-02

### 🐞 Fixes

- Identifiers have been added to the headings, hints, and controls of the settings window, and the translation tables have been expanded so that English and German labels are rendered correctly when switching languages.

- The language update routine and shared helpers have been enhanced to locate the new settings text, long-term save buttons, and display of saved names using persistent data.

- Updated personality customizations and intelligent response context to retrieve translation-aware strings with language-specific fallbacks.

## [0.0.6.0 Alpha] - 2025-10-03

### ⭐ New Features

Emotion Point System 🎮
- Create positive messages, green bubbles, collect points.

- Negative news creates red bubbles, losing points.

## [0.0.6.1 Alpha] - 2025-10-04

### 🔧 Enhancements

- Better recall: The system now recognizes topics even if only parts of a word or phrase match. This makes it easier to find suitable content.

- More stable emotion recognition: Incorrect inputs or strange characters no longer confuse the system. Emotions are recognized more reliably, without crashes.

- More security for the future: Additional testing ensures that these improvements will be retained in future releases.



## [0.0.6.7 Alpha] - 2025-10-08

### 🔧 Enhancements

- Minor stability improvements. 

- Small improvements to the emotion model 

## [0.0.7.0 Alpha] - 2026-02-02

### ⭐ New Features

- A loading screen has been added.
- A thinking mode has been added. You can now observe Egomorph thinking

### 🐞Fixes

- A critical bug has been fixed that caused parts of the code to not execute.


## [0.0.7.2 Alpha-Test build] 2026-02-04

**This version was only available for a limited time; it served only as a test build.**

### ⭐ New Features

- French added

## [0.0.7.3 Alpha]

### 🐞fixes

- Errors in the French language have been corrected
- A bug that prevented the feedback system from being accessed has been fixed
- A memory leak in the model has been fixed.

**This is where the beta phase begins**

## [0.1.0.0 Beta] 2026-05-02

### ⭐ New Feature

- EgoMorph Writer A new editor, it can correct your spelling mistakes, continue writing, available in Full and API mode. 

- In full mode, a security filter now takes effect. 

### 🐞 Fixes

- Bugs in English and French have been fixe

## [0.1.0.5 Beta] 2026-05-04

### ⭐ New Feature

- Morphy Added, it runs while you type. For more Information, see [animation/Lizens.md](animation/Lizens.md)  
- If you need help setting up the modes, you can now simply ask for help with "/helpmorphy-api" or "/helpmorphy-full, morphy".
