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

Jeder Turn erscheint sofort als agentischer Live-Ablauf. `1. Denkantwort` beginnt mit `Anfrage wird analysiert ...`, wechselt beim Modellaufruf in den Formulierungszustand und wird bei Streaming-Backends waehrend der Generierung tokenweise durch die kurze ergebnisorientierte Begruendungszusammenfassung ersetzt. `2. Skill-Zugriff` erscheint unmittelbar beim echten Laufzeitzugriff. Mehrere Zugriffe stehen als getrennte Zeilen in Laufreihenfolge untereinander; auch wiederholte Aufrufe desselben Skills werden nicht zusammengelegt. Der Status unterscheidet laufend, blockiert, technisch fehlgeschlagen, gelesene/geschriebene Datei sowie die Quellenstaende der Recherche. Als Quellenzahl gilt nur die Ergebnismenge, die erfolgreich aufbereitet und an das Modell uebergeben wurde. Der finale Modellschritt erhaelt diese exakte Zahl als Provenienzvorgabe; bei null uebergebenen Quellen darf er keine Quellenangaben oder belegenden URLs erzeugen und keine Quellen aus aelteren Turns uebernehmen. Ein leerer Suchlauf gilt nicht als technischer Fehler. Unter `--- Finale Antwort ---` waechst die Antwort bei Codex und Streaming-faehigen OpenAI-kompatiblen APIs live; nicht streamende APIs und lokale Modelle zeigen bis zum Abschluss einen sichtbaren Arbeitsstatus.

Codex kann zusaetzlich eine eigene Webrecherche als App-Server-Item ausfuehren. Der Gateway reicht deren autoritative `item/started`- und `item/completed`-Ereignisse als separaten Eintrag `Codex-Webrecherche` an Punkt 2 weiter. Dieser Zugriff wird nicht mit `internet.research` vermischt und zeigt keine erfundene Trefferzahl, da das Codex-Ereignis selbst keine Quellenanzahl enthaelt.

Die Skill-Auswahl ist ein generativer Agentenloop und verwendet keinerlei Keyword- oder Regex-Erkennung. Das aktive Modell bewertet die gesamte Anfrage semantisch und darf pro Modellschritt genau einen strukturierten `<egomorph_skill_request>` ausgeben. Die App fuehrt ihn nur bei installiertem, aktiviertem, profilfreigegebenem und fuer die konkrete Operation berechtigtem Skill aus. Danach erhaelt dasselbe Modell den geprueften Kontext und kann entweder den naechsten notwendigen Skill-Zugriff anfordern oder die finale Antwort formulieren. Der Loop ist auf sechs Zugriffe pro Nutzerturn begrenzt. Entscheidet das Modell gegen einen Skill, bleibt es bei einem Modellturn.

Ist der Skill nicht verfuegbar, wird dies dem Modell vor seiner Entscheidung mitgeteilt. Fordert es ihn dennoch an, zeigt der Live-Schritt `Nicht gestartet - Skill, Profil oder Netzwerkrecht ist deaktiviert`. Ungueltige oder unbekannte Skill-Aufrufe werden nie ausgefuehrt; die Orchestrierung fordert stattdessen eine finale Antwort ohne Tool und ohne erfundene Quellen an.

Die Denkantwort ist keine offengelegte private Chain-of-Thought. Modelle ohne das strukturierte Antwortformat erhalten eine sichere neutrale Zusammenfassung, ihre eigentliche Antwort bleibt vollstaendig erhalten. Abgeschlossene Denk-, Skill- und Antwortfelder werden zusammen in Version 2 der Unterhaltung gespeichert; ein beim Neuladen veralteter `laeuft`-Status wird nie als weiterhin aktiv dargestellt. Alte Verlaeufe werden weiterhin gelesen.

## Skills, Memory und Dateien

Das allgemeine Skill-System liest fuer jeden bekannten Skill ein eigenes JSON-Manifest. Ein Manifest mit `schemaVersion: 1` definiert mindestens `id`, `name`, `version`, `entrypoint`, `permissions` und `profiles`; optionale `setup`-Felder erzeugen die Einrichtung im UI. Einstiegsskripte installierter Skills werden aus `entrypoint` geladen; Deinstallation sperrt die Ausfuehrung sofort, auch wenn ein bereits geladenes Browserskript bis zum Neuladen im Speicher bleibt. Der persistente Zustand liegt gesammelt unter `egoSkillStatesV1` im Browser.

Unter `Einstellungen -> Skills` zeigt jede Skill-Karte Installations- und Aktivierungsstatus, Version, letzte Ausfuehrung, Rechte, erlaubte Profile und manifestdefinierte Einrichtung. Rechte und Profile koennen einzeln erteilt oder entzogen werden. Ein Skill laeuft nur, wenn er installiert und aktiviert ist, das aktuelle Profil freigegeben wurde und alle als erforderlich markierten Rechte vorliegen. Felder mit einem optionalen Recht werden bei entzogener Freigabe nicht an den Skill weitergereicht.

Der Internet-Skill wird durch `skills/internet/manifest.json` beschrieben und ist fuer `api` und `codex` freigegeben. Er benoetigt Netzwerkzugriff und kann Google Programmable Search oder die vorhandenen Fallback-Provider verwenden. Das optionale Recht fuer lokale Zugangsdaten kontrolliert, ob Google-Key und Search Engine ID an den Skill gelangen. Bestehende Internet-Skill-Einstellungen werden einmalig in den neuen Manifestzustand migriert. Zugangsdaten bleiben im Browser und duerfen nicht hardcodiert werden.

Der Skill `workspace.extended-files` besitzt das eigene Manifest `skills/extended-files/manifest.json` und den Einstiegspunkt `skills/extendedFileSkill.js`. Er ist eingebaut, aber standardmaessig deaktiviert; auch seine getrennten Rechte `readCode` und `writeCode` sind anfangs entzogen. Nach ausdruecklicher Nutzerfreigabe darf er `.js`, `.css`, `.html` und `.py` ausschliesslich im Modell-Home lesen beziehungsweise schreiben. Der Gateway-Endpunkt `/egomorph/extended-files` akzeptiert nur diese Erweiterungen und den Skill-Header. Traversal, `.env*`, `.git`, `node_modules` und aus dem Modell-Home fuehrende Symlinks werden abgewiesen.

`learning.egomorph` wird als **Learn with EgoMorph** im Skill-Katalog angezeigt und ist fuer `api` und `codex` ohne zusaetzliche Rechte eingebaut. Bei einer passenden Lernanfrage fuehrt das Modell einen echten strukturierten Skill-Aufruf aus; Punkt 2 zeigt diesen Zugriff, bevor der finale Tutor-Schritt entsteht. Der Einstiegspunkt enthaelt keine Lektionen oder Musterantworten, sondern begrenzte Tutor-Regeln: Ist im sichtbaren Verlauf noch kein Niveau genannt, fragt das Modell zuerst danach. Anschliessend erzeugt es Erklaerungen, JavaScript-/TypeScript-Beispiele, Quizfragen, Debugging- und Implementierungsaufgaben sowie abgestufte Hinweise jeweils neu aus Verlauf, Ziel und gezeigtem Verstaendnis. Vollstaendige Loesungen folgen erst nach einem Versuch oder auf ausdruecklichen Wunsch.

Der Lernpfad verbindet Sprachgrundlagen mit den tatsaechlichen Architekturgrenzen von EgoMorph: Browser und Node-Gateway, manifestbasierte Registry, generativer Agentenloop, offizielle Codex-Anmeldung, `memory.md`, Rechte/Profile und PWA-App-Shell. Der Tutor-Skill besitzt selbst keinen Datei- oder Netzwerkzugriff. Fuer exakte Codeanalyse oder Aenderungen muss das Modell einen weiteren freigegebenen Skill anfordern; insbesondere darf die Auth-Bridge niemals durch Cookie-, Token- oder `auth.json`-Uebernahme erklaert werden.

Das dedizierte Modell-Home lautet:

```text
<Projektordner>/EgomorphCore/model-home
```

`memory.md` ist fuer persistente Nutzerinformationen reserviert. Der Browser kann Markdown-Dateien ueber `MD hochladen` an das Gateway senden; ihre relativen Pfade werden erst mit dem naechsten frei formulierten Prompt als expliziter Kontext weitergereicht. Ohne erweiterten Datei-Skill erlaubt die Bridge nur gepruefte `.json`, `.md` und `.txt` als Lesekontext und allgemeines Speichern nur als Markdown. Die erweiterten Codeformate sind ausschliesslich ueber den aktivierten und passend berechtigten Skill zugaenglich.

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
skills/extendedFileSkill.js Browser-Client fuer freigegebene Code-Dateien
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
