# Egomorph Core – technical summary

This file summarizes the current architecture. The detailed canonical reference is `doku.md`.

Egomorph Core has three generative profiles: a local browser LLM (`full`), an OpenAI-compatible API (`api`), and the official Codex CLI through the local gateway (`codex`). Chat orchestration lives in `app.js`, profiles and gateway dispatch in `resourceProfile.js`, and local text generation in `chatModel.js`.

`agentResponse.js` displays every turn immediately as a live flow and separates a short safe reasoning summary from the final answer. Codex and streaming APIs update both areas token by token. A skill step appears only for an actual runtime access and distinguishes `running`, `N sources used`, `completed without sources`, and `technical failure`. Private chain-of-thought and internal model-home files, names, paths, or raw contents are not displayed.

The active model makes the research decision semantically without keyword rules. It may emit a structured `internet.research` call with its own query; after execution, a second model turn receives the validated source context. A model request blocked by enablement, profile, entrypoint, or network permission state is visibly reported as `not started`.

`skillSystem.js` manages skills from individual JSON manifests. The internet manifest at `skills/internet/manifest.json` defines its ID, name, version, entrypoint, API/Codex profiles, network/credential permissions, and dynamically rendered setup fields. Installation, enablement, profile assignments, permissions, configuration, and last-run data stay in the browser and are managed under `Settings -> Skills`.

Conversations are isolated in `egoConversationThreads`. In Codex mode each thread ID is forwarded as `egomorph.sessionId`. Memory and approved file context live under `<project folder>/EgomorphCore/model-home`; the bridge restricts reads and writes to documented file types and paths.

The UI uses the abstract `egomorph-core.svg` wordmark. Its CSS animation moves only the logo. Character, classification, feedback-training, and rule-based reply modules are absent.

```bash
./egomorph codex login
./egomorph dashboard
npm test -- --runInBand
npm run pwa:validate
```
