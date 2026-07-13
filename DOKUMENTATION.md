# Egomorph Core – technische Kurzreferenz

Diese Datei fasst die aktuelle Architektur zusammen. Die ausfuehrliche und verbindliche Dokumentation steht in `doku.md`.

Egomorph Core besitzt drei generative Profile: lokales Browser-LLM (`full`), OpenAI-kompatible API (`api`) und die offizielle Codex-CLI ueber das lokale Gateway (`codex`). Die Chatsteuerung liegt in `app.js`, Profile und Gateway-Dispatch in `resourceProfile.js`, lokale Textgenerierung in `chatModel.js`.

`agentResponse.js` stellt jeden Turn sofort als Live-Ablauf dar und trennt eine kurze sichere Denkantwort von der finalen Antwort. Codex und Streaming-APIs aktualisieren beide Bereiche tokenweise. Ein Skill-Schritt erscheint nur bei einem echten Laufzeitzugriff; mehrere Zugriffe werden unter Punkt 2 als getrennte, geordnete Zeilen angezeigt, auch bei derselben Skill-ID. Die Status unterscheiden unter anderem laufend, blockiert, technisch fehlgeschlagen, Datei gelesen/geschrieben und Recherchequellen. Die Quellenzahl stammt aus dem erfolgreich aufbereiteten Kontext des aktuellen Turns; bei null Quellen darf der finale Modellschritt keine Quellenangaben oder belegenden URLs ausgeben. Private Chain-of-Thought sowie interne Modell-Home-Dateien, Namen, Pfade und Rohinhalte werden nicht angezeigt.

Die Skill-Entscheidung trifft das aktive Modell semantisch ohne Keyword-Regeln. Pro Modellschritt kann es einen strukturierten Aufruf erzeugen; nach der Ausfuehrung darf es bis zum Limit von sechs Zugriffen einen weiteren Skill anfordern oder final antworten. Ein wegen Aktivierung, Profil, Einstiegspunkt oder Recht blockierter Modellaufruf wird sichtbar als `nicht gestartet` gemeldet.

Codex-eigene `webSearch`-Items werden anhand ihrer App-Server-Lebenszyklusereignisse als separater Laufzeitzugriff angezeigt. Sie werden weder verschluckt noch mit der Trefferzahl des Browser-Skills vermischt.

Skills werden in `skillSystem.js` anhand eigener JSON-Manifeste verwaltet. Das Internet-Manifest unter `skills/internet/manifest.json` definiert Recherche und Netzwerkrechte. `skills/extended-files/manifest.json` beschreibt den standardmaessig deaktivierten Skill `workspace.extended-files` mit getrennten Lese- und Schreibrechten fuer `.js`, `.css`, `.html` und `.py` im Modell-Home. `learning.egomorph` erscheint als **Learn with EgoMorph** und startet fuer API/Codex eine adaptive JavaScript-/TypeScript-Lernsitzung entlang der EgoMorph-Architektur. Er fragt bei unbekanntem Niveau zuerst danach und laesst Erklaerungen, Quiz, Aufgaben, Hinweise und Feedback jeweils vom Modell aus dem aktuellen Verlauf erzeugen; vorgefertigte Antworten liegen nicht im Skill. Traversal, geschuetzte Verzeichnisse und ausbrechende Symlinks bleiben blockiert. Installation, Aktivierung, Profilfreigaben, Rechte, Konfiguration und letzte Ausfuehrung bleiben lokal im Browser und werden unter `Einstellungen -> Skills` verwaltet.

Unterhaltungen werden getrennt in `egoConversationThreads` gespeichert. Im Codex-Profil wird jede Thread-ID als `egomorph.sessionId` weitergereicht. Memory und freigegebener Datei-Kontext liegen unter `<Projektordner>/EgomorphCore/model-home`; die Bridge beschraenkt Lesen und Schreiben auf die dokumentierten Dateitypen und Pfade.

Das UI nutzt die abstrakte Wortmarke `egomorph-core.svg`. Die CSS-Animation bewegt nur das Logo. Es existieren keine Figuren-, Klassifikations-, Feedbacktrainings- oder regelbasierten Antwortmodule.

```bash
./egomorph codex login
./egomorph dashboard
npm test -- --runInBand
npm run pwa:validate
```
