# Egomorph Core – technische Kurzreferenz

Diese Datei fasst die aktuelle Architektur zusammen. Die ausfuehrliche und verbindliche Dokumentation steht in `doku.md`.

Egomorph Core besitzt drei generative Profile: lokales Browser-LLM (`full`), OpenAI-kompatible API (`api`) und die offizielle Codex-CLI ueber das lokale Gateway (`codex`). Die Chatsteuerung liegt in `app.js`, Profile und Gateway-Dispatch in `resourceProfile.js`, lokale Textgenerierung in `chatModel.js`.

`agentResponse.js` stellt jeden Turn sofort als Live-Ablauf dar und trennt eine kurze sichere Denkantwort von der finalen Antwort. Codex und Streaming-APIs aktualisieren beide Bereiche tokenweise. Ein Skill-Schritt erscheint nur bei einem echten Laufzeitzugriff und unterscheidet `laeuft`, `N Quellen verwendet`, `abgeschlossen ohne Quellen` und `technisch fehlgeschlagen`. Private Chain-of-Thought sowie interne Modell-Home-Dateien, Namen, Pfade und Rohinhalte werden nicht angezeigt.

Die Rechercheentscheidung trifft das aktive Modell semantisch ohne Keyword-Regeln. Es kann einen strukturierten `internet.research`-Aufruf mit eigener Query erzeugen; nach der Ausfuehrung folgt ein zweiter Modellturn mit geprueftem Quellenkontext. Ein wegen Aktivierung, Profil, Einstiegspunkt oder Netzwerkrecht blockierter Modellaufruf wird sichtbar als `nicht gestartet` gemeldet.

Skills werden in `skillSystem.js` anhand eigener JSON-Manifeste verwaltet. Das Internet-Manifest unter `skills/internet/manifest.json` definiert ID, Name, Version, Einstiegspunkt, API-/Codex-Profile, Netzwerk-/Zugangsdatenrechte und die dynamisch gerenderten Einrichtungsfelder. Installation, Aktivierung, Profilfreigaben, Rechte, Konfiguration und letzte Ausfuehrung bleiben lokal im Browser und werden unter `Einstellungen -> Skills` verwaltet.

Unterhaltungen werden getrennt in `egoConversationThreads` gespeichert. Im Codex-Profil wird jede Thread-ID als `egomorph.sessionId` weitergereicht. Memory und freigegebener Datei-Kontext liegen unter `<Projektordner>/EgomorphCore/model-home`; die Bridge beschraenkt Lesen und Schreiben auf die dokumentierten Dateitypen und Pfade.

Das UI nutzt die abstrakte Wortmarke `egomorph-core.svg`. Die CSS-Animation bewegt nur das Logo. Es existieren keine Figuren-, Klassifikations-, Feedbacktrainings- oder regelbasierten Antwortmodule.

```bash
./egomorph codex login
./egomorph dashboard
npm test -- --runInBand
npm run pwa:validate
```
