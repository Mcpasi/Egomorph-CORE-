# Egomorph Core – Projektdokumentation

## Ueberblick

Egomorph Core ist eine installierbare, Gateway-first Browser-App fuer agentische KI-Arbeit. Die fruehere Figur sowie regelbasierte und klassifizierende Interaktionspfade wurden entfernt. Das Produkt konzentriert sich jetzt auf generative Modelle, getrennte Unterhaltungen, Skills, Memory, sicheren Datei-Kontext und den Writer-Agenten.

## Profile

| Profil | Antwortquelle | Lokaler Bedarf |
| --- | --- | --- |
| Lokal (`full`) | Generatives Transformers.js-Modell im Browser | modellabhaengig |
| API (`api`) | OpenAI-kompatibler Endpunkt | nahezu 0 MB |
| Codex (`codex`) | Offizielle Codex-CLI ueber das lokale Gateway | nahezu 0 MB im Browser |

Alte gespeicherte Profilwerte werden beim Laden auf `codex` migriert. Ohne konfiguriertes oder geladenes Modell erzeugt die App keine Ersatzantwort aus Regeln.

## Start

```bash
npm install
./egomorph codex login
./egomorph dashboard
```

Alternativ startet `./egomorph gateway` den lokalen Dienst ohne Browser. Standardadresse ist `http://localhost:8787/`.

## Chat und Unterhaltungen

Das Promptfeld ist mehrzeilig. Enter sendet, Shift+Enter erzeugt eine neue Zeile. Eine laufende Antwort kann gestoppt werden. Unterhaltungen werden versioniert unter `egoConversationThreads` gespeichert; der aktive Verlauf wird fuer kompatible Komponenten nach `egoConversation` gespiegelt.

Im Codex-Profil wird die stabile lokale Thread-ID als `egomorph.sessionId` gesendet. Das Leeren oder Loeschen eines Threads setzt nur die zugehoerige Codex-Session zurueck. Modell und Denkstufe werden direkt unter dem Promptfeld ausgewaehlt; Modelle kommen dynamisch aus `/v1/models`.

Jeder Turn erscheint sofort als agentischer Live-Ablauf. `1. Denkantwort` beginnt mit `Anfrage wird analysiert ...`, wechselt beim Modellaufruf in den Formulierungszustand und wird bei Streaming-Backends waehrend der Generierung tokenweise durch die kurze ergebnisorientierte Begruendungszusammenfassung ersetzt. `2. Skill-Zugriff` erscheint unmittelbar beim echten Laufzeitzugriff. Der Status unterscheidet `Zugriff laeuft`, `N Quellen verwendet`, `Zugriff abgeschlossen, keine Quellen gefunden` und `Zugriff technisch fehlgeschlagen`. Als Quellenzahl gilt nur die Ergebnismenge, die erfolgreich aufbereitet und an das Modell uebergeben wurde. Ein leerer Suchlauf gilt nicht als technischer Fehler. Unter `--- Finale Antwort ---` waechst die Antwort bei Codex und Streaming-faehigen OpenAI-kompatiblen APIs live; nicht streamende APIs und lokale Modelle zeigen bis zum Abschluss einen sichtbaren Arbeitsstatus.

Die Skill-Auswahl ist ein generativer Agentenloop und verwendet keinerlei Keyword- oder Regex-Erkennung. Das aktive Modell bewertet die gesamte Anfrage semantisch. Wenn externe, aktuelle oder zu verifizierende Informationen fuer eine verlaessliche Antwort noetig sind, gibt es statt der finalen Antwort genau einen strukturierten `<egomorph_skill_request>` fuer `internet.research` mit einer selbst formulierten Suchanfrage aus. Die App fuehrt diesen Aufruf nur bei installiertem, aktiviertem, profilfreigegebenem und berechtigtem Skill aus. Danach erhaelt dasselbe Modell den geprueften Recherchekontext und formuliert in einem zweiten Turn die finale Antwort. Entscheidet das Modell gegen Recherche, bleibt es bei einem Modellturn, selbst wenn der Nutzertext Woerter wie `Suche` enthaelt.

Ist der Skill nicht verfuegbar, wird dies dem Modell vor seiner Entscheidung mitgeteilt. Fordert es ihn dennoch an, zeigt der Live-Schritt `Nicht gestartet - Skill, Profil oder Netzwerkrecht ist deaktiviert`. Ungueltige oder unbekannte Skill-Aufrufe werden nie ausgefuehrt; die Orchestrierung fordert stattdessen eine finale Antwort ohne Tool und ohne erfundene Quellen an.

Die Denkantwort ist keine offengelegte private Chain-of-Thought. Modelle ohne das strukturierte Antwortformat erhalten eine sichere neutrale Zusammenfassung, ihre eigentliche Antwort bleibt vollstaendig erhalten. Abgeschlossene Denk-, Skill- und Antwortfelder werden zusammen in Version 2 der Unterhaltung gespeichert; ein beim Neuladen veralteter `laeuft`-Status wird nie als weiterhin aktiv dargestellt. Alte Verlaeufe werden weiterhin gelesen.

## Skills, Memory und Dateien

Das allgemeine Skill-System liest fuer jeden bekannten Skill ein eigenes JSON-Manifest. Ein Manifest mit `schemaVersion: 1` definiert mindestens `id`, `name`, `version`, `entrypoint`, `permissions` und `profiles`; optionale `setup`-Felder erzeugen die Einrichtung im UI. Einstiegsskripte installierter Skills werden aus `entrypoint` geladen; Deinstallation sperrt die Ausfuehrung sofort, auch wenn ein bereits geladenes Browserskript bis zum Neuladen im Speicher bleibt. Der persistente Zustand liegt gesammelt unter `egoSkillStatesV1` im Browser.

Unter `Einstellungen -> Skills` zeigt jede Skill-Karte Installations- und Aktivierungsstatus, Version, letzte Ausfuehrung, Rechte, erlaubte Profile und manifestdefinierte Einrichtung. Rechte und Profile koennen einzeln erteilt oder entzogen werden. Ein Skill laeuft nur, wenn er installiert und aktiviert ist, das aktuelle Profil freigegeben wurde und alle als erforderlich markierten Rechte vorliegen. Felder mit einem optionalen Recht werden bei entzogener Freigabe nicht an den Skill weitergereicht.

Der Internet-Skill wird durch `skills/internet/manifest.json` beschrieben und ist fuer `api` und `codex` freigegeben. Er benoetigt Netzwerkzugriff und kann Google Programmable Search oder die vorhandenen Fallback-Provider verwenden. Das optionale Recht fuer lokale Zugangsdaten kontrolliert, ob Google-Key und Search Engine ID an den Skill gelangen. Bestehende Internet-Skill-Einstellungen werden einmalig in den neuen Manifestzustand migriert. Zugangsdaten bleiben im Browser und duerfen nicht hardcodiert werden.

Das dedizierte Modell-Home lautet:

```text
<Projektordner>/EgomorphCore/model-home
```

`memory.md` ist fuer persistente Nutzerinformationen reserviert. Der Browser kann Markdown-Dateien ueber `MD hochladen` an das Gateway senden; ihre relativen Pfade werden erst mit dem naechsten frei formulierten Prompt als expliziter Kontext weitergereicht. Die Bridge erlaubt nur gepruefte `.json`, `.md` und `.txt` als Lesekontext. Ausdrueckliches Speichern ist auf Markdown im Modell-Home begrenzt.

Interne Modell-Home-Dateien, ihre Namen, Pfade und Rohinhalte duerfen nicht Bestandteil der angezeigten Agentenschritte sein. `agentResponse.js` entfernt bekannte interne Referenzen vor Anzeige und Speicherung; die Backend-Prompts verbieten darueber hinaus die Ausgabe interner Datei-, Prompt-, Tool- und Geheimnisdaten. Der App-Server-Client uebernimmt nur `agentMessage`-Text und keine Datei- oder Tool-Events.

## Gateway-Endpunkte

- `GET /health`
- `GET /gateway/status`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /codex/status`
- `GET /codex/sessions`
- `POST /codex/session/reset`
- `POST /egomorph/context`
- `GET|POST /egomorph/memory`
- `GET|POST /egomorph/files`

Das Gateway bindet standardmaessig nur an `127.0.0.1`. Nicht ohne vorgeschaltete Authentifizierung oeffentlich exponieren. Entfernte Origins muessen explizit mit `CODEX_BRIDGE_ALLOWED_ORIGINS` freigeschaltet werden.

## PWA und Logo

Die Marke besteht aus `egomorph-core.svg` und den daraus erzeugten PWA-Icons. Die dezente CSS-Bewegung in `style.css` animiert nur das abstrakte Logo. Der Service Worker cached die App-Shell, aber keine Gateway-API-Antworten.

Nach App-Shell-Aenderungen muss `CACHE_NAME` in `sw.js` erhoeht werden. Icons koennen reproduzierbar neu erzeugt werden:

```bash
node scripts/generate-core-icons.js
```

## Wichtige Dateien

```text
index.html                 UI und Einstellungen
app.js                     Chat-, Thread-, Upload- und PWA-Steuerung
agentResponse.js           Antwortschritte und Schutz interner Dateiverweise
resourceProfile.js         Profile, API/Codex, Skills und Kontext
skillSystem.js             Manifest-Registry, Rechte und Laufhistorie
skills/*/manifest.json     Metadaten, Profile, Rechte und Einrichtung je Skill
chatModel.js               Lokales generatives Modell
conversationStore.js       Persistente Unterhaltungen
Writer.js                  Writer-Agent
scripts/codex-bridge.js    Gateway und Codex App Server
EgomorphCore/model-home/   Erlaubter Codex-Arbeitsbereich
translations/              Deutsch, Englisch, Franzoesisch
sw.js                      Service Worker
tests/                     Jest-Tests
```

## Verifikation

```bash
npm test -- --runInBand
npm run build:safetyfilter
npm run pwa:validate
node -c egomorph
node -c agentResponse.js
node -c app.js
node -c resourceProfile.js
node -c skillSystem.js
node -c conversationStore.js
node -c chatModel.js
node -c Writer.js
node -c scripts/egomorph.js
node -c scripts/egomorph-gateway.js
node -c scripts/codex-app-server-client.js
node -c scripts/codex-bridge.js
node -c sw.js
node -c loader.js
```
