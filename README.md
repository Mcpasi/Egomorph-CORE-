# Egomorph Core

Eine lokale, installierbare und agentische Browser-App mit lokalem LLM, OpenAI-kompatibler API und offizieller Codex-CLI-Anbindung.

## Schnellstart

```bash
npm install
./egomorph codex login
./egomorph dashboard
```

Das Dashboard laeuft standardmaessig unter `http://localhost:8787/`.

## Funktionen

- drei generative Profile: lokales Browser-LLM, externe API und Codex
- mehrere getrennte lokale Unterhaltungen
- abbrechbare Codex-Antworten mit persistentem App Server
- dynamischer Codex-Modellkatalog und Denkstufen
- live gegliederte Agentenantworten mit sicherer Denkzusammenfassung, sichtbarem Skill-Zugriffsstatus und tokenweise wachsender finaler Antwort
- manifestbasiertes Skill-System mit Installation, Profilen, Rechteverwaltung und Laufhistorie
- Internet-Skill mit Google- und Fallback-Providern
- persistentes Memory und kontrollierter Markdown-Dateikontext
- integrierter Writer-Agent
- PWA-Installation und Offline-App-Shell
- abstraktes, animiertes Egomorph-Core-Logo

Alte regelbasierte Interaktionspfade und die fruehere Figur sind nicht mehr Bestandteil der Anwendung. Antworten werden ausschliesslich von einem generativen Backend erzeugt.

## Profile

| Profil | Verwendung |
| --- | --- |
| Lokal | Ein `text-generation`-Modell laeuft mit Transformers.js im Browser. |
| API | Verbindet OpenAI, OpenRouter, Ollama, LM Studio oder einen kompatiblen Endpunkt. |
| Codex | Verwendet die offizielle Codex-CLI ueber das lokale Egomorph-Core-Gateway. |

## Codex und Sicherheit

```bash
./egomorph codex login
./egomorph codex login --device-auth
./egomorph gateway
```

Egomorph Core liest keine ChatGPT-Cookies, Access-Tokens oder `auth.json`. Das Gateway bindet standardmaessig an `127.0.0.1:8787`. Abweichende Browser-Origins muessen explizit mit `CODEX_BRIDGE_ALLOWED_ORIGINS` freigeschaltet werden.

Das Modell-Home ist `<Projektordner>/EgomorphCore/model-home`. Codex darf dort erlaubte Markdown-Dateien bearbeiten, bleibt aber auf diesen Arbeitsbereich begrenzt. `memory.md` ist fuer Memory reserviert; private Inhalte dieses Ordners gehoeren nicht in Releases.

Antworten zeigen keine private Chain-of-Thought. Analyse und Modellarbeit werden sofort sichtbar, die Denkantwort ist eine kurze ergebnisorientierte Zusammenfassung. Ein Skill erscheint nur bei einem echten Laufzeitzugriff. Die Anzeige unterscheidet einen technischen Fehler von einem abgeschlossenen Zugriff ohne Treffer und nennt bei Erfolg die Zahl der wirklich verwendeten Quellen. Codex und Streaming-faehige APIs aktualisieren Denk- und finale Antwort tokenweise. Interne Modell-Home-Dateien, Namen, Pfade und Rohinhalte werden nicht ausgegeben.

Ob Recherche erforderlich ist, entscheidet das aktive Modell semantisch und ohne Keyword-Regeln. Bei Bedarf erzeugt es einen strukturierten Skill-Aufruf mit eigener Suchanfrage; die App fuehrt den freigegebenen Internet-Skill aus und gibt die Quellen fuer einen zweiten finalen Modellschritt zurueck. Ein Wort wie `Suche` startet allein keinen Skill. Blockierte Modellaufrufe werden im Live-Schritt sichtbar.

## Skills

Jeder Skill besitzt ein eigenes JSON-Manifest. Es beschreibt ID, Name, Version, Einstiegspunkt, erlaubte Profile, benoetigte Rechte und Einrichtungsfelder; installierte Einstiegsskripte werden daraus geladen. Unter `Einstellungen -> Skills` lassen sich Skills installieren/deinstallieren, aktivieren, pro Profil freigeben, konfigurieren und ihre Rechte erteilen oder entziehen. Dort wird auch die letzte Ausfuehrung angezeigt. Der eingebaute Internet-Skill liegt unter `skills/internet/manifest.json`; sein Netzwerkrecht ist fuer die Ausfuehrung erforderlich, Google-Zugangsdaten sind ein separates optionales Recht.

## Entwicklung

```bash
npm test -- --runInBand
npm run build:safetyfilter
npm run pwa:validate
```

Die ausfuehrliche Referenz steht in [doku.md](doku.md). Lizenz: MIT.
