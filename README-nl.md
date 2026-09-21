# 📦 Troves
<img src="static/troves512.webp" align="right" width="40%" alt="Troves Logo" />

Voorraadbeheer (voor thuis). Er zijn er een hoop van, maar deze is van mij.

Mijn belangrijkste use-cases zijn:

1. `Heb ik dat nog? En waar ligt het in vredesnaam?`
2. `Wat doet dit ding en waarom heb ik het ooit gekocht?`

Daarnaast is er natuurlijk dat oergevoel van voldoening als je gewoon je spullen bewondert; als Dagobert Duck zwemmen door een berg gereedschap, boeken en componenten. Dit is de digitale variant: je zooi inspecteren en waarderen zonder dat je 20 dozen van zolder hoeft te slepen.

Ik heb een absolute bloedhekel aan data-entry. Het aanmaken van een inventaris en het toevoegen van nieuwe items moet zo geautomatiseerd mogelijk zijn. De meeste moeite in Troves zit in het creëren van een soepele, wrijvingsloze workflow, zodat je het daadwerkelijk *gebruikt*. Onder de motorkap gebruikt het tools zoals objectclassificatie, OCR, achtergrondverwijdering, kleurextractie, vision-, audio- en taalmodellen om het zware werk te doen, maar de interface zit je totaal niet in de weg.

Maak gewoon een foto of plak een URL, en laat het systeem de boel organiseren.

[Er](https://youtu.be/5B0cxLwS8fo) zijn [misschien](https://youtu.be/8WpgqJUO7SQ) een [aantal](https://youtu.be/n4YAiE8Yv5Y) demo [video's](https://youtube.com/shorts/qyyXUC3TYlg?feature=share) geüpload [naar](https://youtube.com/shorts/U_juc8A-QqI?feature=share) [YouTube](https://youtube.com/shorts/JtorL9VRztQ?feature=share). Oh, en er staan er ook [wat hier](https://www.youtube.com/@friya/shorts). 

<table align="center">
  <tr>
    <td align="center" width="300">
        <a href="https://www.youtube.com/shorts/P1S-qs7-n8E">
          <img src="./.github/screenshots/033-component-drawer.webp" width="300" alt="Multi-scan CDs" />
        </a>
    </td>
  </tr>
  <tr>
    <td align="center" width="300">
        <i>
          <a href="https://www.youtube.com/shorts/P1S-qs7-n8E">
            This one is pretty fun for instance
          </a>
        </i>
    </td>
  </tr>
</table>


## 📸 De Basis Workflow
<table align="right">
  <tr>
    <td align="center" width="300">
        <i>
            <i>This demonstrates the <a href="./docs/extensions/04-examples.md">Spotify Extension</a> during bulk import of CDs</i>
        </i>
    </td>
  </tr>
  <tr>
    <td align="center" width="300">
        <img src="./.github/screenshots/gif-multi-scan-cds.gif" width="300" alt="Multi-scan CDs" />
    </td>
  </tr>
</table>

Om een product toe te voegen, pak je je telefoon, maak je een foto en scan je de QR-code op de bak waar je het in wilt leggen. Dat is alles.

Maar goed, als je in een ambitieuze bui bent, kun je ook:

* Een foto maken van een factuur of bonnetje (Troves haalt de sappigste details eruit).
* Extra foto's toevoegen of gewoon weblinks plakken.
* QR-codes scannen met URL's naar relevante documenten.
* Handmatig tags, aantallen en beschrijvingen typen (maar dan ben je wel *héél* ambitieus).
* **Plak Gewoon Alles:**  
Druk ergens op `Ctrl+V`. De globale PasteHandler herkent afbeeldingen op je klembord, ruwe URL's (haalt de webpagina op) en tekstblokken (maakt lokale Markdown-notities). Oh, en Key-Value Pairs en lijstjes (gewicht/kleur/maat) in allerlei varianten worden opgepikt en netjes gekoppeld als attributen.
* **Fire-and-Forget Outbox:**  
Wacht `nooit` meer op een laadbalkje. Zodra je op 'Opslaan' tikt, gaat het item naar een offline-tolerante IndexedDB wachtrij en reset de UI. Je kunt items scannen in een diepe kelder zonder bereik, en de app synchroniseert feilloos zodra je weer wifi hebt. ... Oké, oké, ik neem dat `nooit` een beetje terug, aangezien we bulk-scans soms even moeten verifiëren.

**Bulk Import & De Vergelijkingslens**  
Als bulk import de manier is waarop je een berg data in één keer Troves in pompt, dan is de Vergelijkingslens hoe je de realiteit toetst aan je database met behulp van set-wiskunde. *(Tip: Tel de fysieke items voordat je een multi-scan foto maakt. Het is een snelle sanity check om te zien of je foto scherp genoeg was voor het model om alles te pakken).*

* **Rommelmarkt Scan ($A \setminus B$)**  
Maak een foto van een bak met 40 cd's of boeken om te zien wat **✨ Nieuw voor jou** is en wat **✓ Al in je Trove** zit.
* **Kit Check ($B \setminus A$)**  
Gooi je spullen op tafel, filter de vergelijking op de tag `#camping-gear`, en maak een foto om precies te zien wat je bent vergeten in te pakken (een beetje een geforceerd voorbeeld, maar ach, waarom niet...).

## 🧠 Zelforganiserende Taxonomie

Omdat Troves van alles wat moet kunnen verwerken—van winterjassen en bougies tot whisky, trollbeads en ESP32-bordjes—kan het niet vooraf geprogrammeerd worden met stugge spreadsheet-kolommen zoals "Merk" of "Schoenmaat". In plaats daarvan bouwt, vernietigt (en updatet) het on-the-fly zijn eigen structuur met een Entity-Attribute-Value taxonomie. Er zit iets meer achter, maar dat is de kern.

**Taalgebruik consistent houden**  
Beeldherkenningstools maken er qua tekst nogal een zootje van. Als je het systeem foto's van drie verschillende t-shirts voert, krijgt de ene het label "korte mouwen", de andere "mouwstijl" en de derde "mouwlengte". Daar kun je geen fatsoenlijke zoekfunctie op bouwen. Om dit op te lossen: zodra de app voor het eerst een nieuwe categorie ziet, zet hij een specifieke set labels vast en dwingt hij de software om precies die termen te hergebruiken voor alle toekomstige items in die groep. Het verandert rommelige, willekeurige tekst in een strakke, voorspelbare database. Semi-gerelateerd: Lege categorieën verdampen vanzelf als je het laatste item eruit haalt, wat je database lekker schoon houdt.

**Dubbele items herkennen via foto's**  
Als je vandaag een foto van een jas op je bed maakt, is de belichting en zijn de kreukels compleet anders dan toen je hem maanden geleden gefotografeerd hebt, hangend in de kast. Om hiermee om te gaan, vergelijkt Troves de visuele details en de tekst om uit te rekenen of het exact hetzelfde item is. Zo voorkom je dat je een duplicaat logt of twee compleet verschillende blauwe overhemden door elkaar haalt.

### Ga er maar vanuit dat de classificatie faalt

Een kleine waarschuwing: ga er simpelweg vanuit dat de automatische classificatie je items verkeerd inschat.

Bij mij heeft hij het in zo'n 95% van de gevallen goed zonder dat ik ook maar één woord hoef te typen. Maar dat is precies de valkuil. Het werkt nét vaak genoeg om je compleet te verwennen, en daardoor ben je oprecht geïrriteerd als hij naar een dure logic analyzer kijkt en er zelfverzekerd het label "zwart plastic doosje" op plakt.

Data handmatig bijsturen is normaal. De hele workflow is eromheen gebouwd om een slechte gok vliegensvlug en zonder frictie te fixen, of het model de juiste richting op te duwen. Laat de scanner gewoon het domme, zware werk doen om het item in het systeem te krijgen. De exacte specs opzoeken, PDF's toevoegen en helemaal nerden op de details is juist best leuk om later te doen, gewoon vanaf de bank wanneer je er zin in hebt.

*Notitie:* Zit de classificatie ernaast? Zoek naar het ✨ Sparkle icoontje op... verschillende plekken. Klik erop om een hint te geven (bijv. "Het is een IKEA MITTZON bureau") en het model bij te sturen.

## 🗺️ Ruimtelijke Indeling vs. Semantische Tags

Bij het toewijzen van een locatie aan een item, geeft Troves je twee opties, afhankelijk van wat je opslaat.

**Optie A: Semantische Tags (Tekst/QR)**  
Je typt of scant een naam (bijv. "Garage Plank 2" of "Verhuisdoos A"). Als je later naar het item zoekt, laat de app je gewoon die tekst zien.
*Beste voor: Macro items. Jassen, cirkelzagen, dozen met boeken. Je hebt geen schatkaart nodig om een kettingzaag op een plank te vinden.*

**Optie B: Ruimtelijke Mapping (Visueel Raster)**  
Je maakt een overzichtsfoto van een open lade, Gridfinity-layout of wijnrek. Je definieert het raster in de UI. Daarna vraagt de app: "Tik aan waar het ligt."
*Beste voor: Micro items. Weerstanden, schroefjes, Lego onderdelen. Het bespaart je het lezen van piepkleine labeltjes op 40 identieke hardwarebakjes.*

**Diepe Raster Scan**  
Als je geen zin hebt om 60 keer te tikken, druk je op ✨ Deep Scan. Het Vision Model analyseert in één klap de complete lade, leest geprinte labels en identificeert de fysieke componenten in elk specifiek vakje. Troves opent daarna een "Triage"-scherm waar je door de resultaten stapt, de gok van het model verifieert en het accepteert in je inventaris.

**⚠️ Belangrijke waarschuwing m.b.t. medicatie**  
Gebruik de automatische indexering, ruimtelijke mapping of LLM-gebaseerde label-lezers alsjeblieft **NIET** voor het organiseren van medicijnen, drugs of gevaarlijke stoffen. Vision- en taalmodellen zijn enthousiaste, maar domme dienaren en kunnen doseringen en labels makkelijk verkeerd lezen. Menselijke controle is hier altijd absoluut vereist.

## 🗣️ Hardware-Aware Spraakzoeken

Het zoekveld ondersteunt spraakdictatie, verwerkt door een custom NLP-engine. Stel natuurlijke vragen om dingen te vinden ("Waar is mijn grijze spijkerbroek" of "Waar ligt de USB naar TTL converter?"), voorraad te checken ("Hoeveel BNCQ9 connectoren heb ik?"), of items te groeperen ("Lijst van mijn microcontrollers").

Standaard NLP-stemmers slopen meestal alfanumerieke modelnummers. De engine van Troves redt bewust tokens die cijfers bevatten, waardoor termen als `ESP32`, `LM317`, of `1k` het overleven. Het gebruikt ook bidirectionele eenheidsvertaling; dus als jij "10 microfarad" zegt, matcht dat perfect met de `10µF` in je database.

Je kunt de intent-parser testen zonder microfoon door je zoekopdracht te beginnen met `/v ` (bijv. `/v where are my 10k ohm resistors?`).

**Uitbreiden naar andere domeinen**  
Omdat de Voice Engine bouwt op woordenboeken en reguliere expressies in plaats van stugge database-schema's, is uitbreiden naar heel andere troves (zoals kleding of een wijnkelder) triviaal. Je voegt gewoon extra domeinspecifieke fonetiek toe aan de pre-processing maps in `VoiceEngine.ts` (bijv. `Cab Sauv` mappen naar `Cabernet Sauvignon` of `32x34` uitschrijven naar `waist 32 length 34` voor TTS) en definieert je eigen custom intent-triggers.

## 📚 De Kennisbank (Voorkom Link-Rot)

Troves is niet alleen voor fysieke zooi. Het verzamelt ook je digitale bestanden, handleidingen, datasheets en notities, zodat je daadwerkelijk onthoudt hoe je de dingen die je gekocht hebt moet gebruiken.

* **Offline Archieven**  
Loop nooit meer tegen een dode link aan. Als je linkt naar een webpagina, handleiding of specsheet, zal Troves deze downloaden, parsen, samenvatten en lokaal op je schijf archiveren. (Scrapen is beperkt tot 1 niveau diep om oneindig spideren te voorkomen).
* **Digitale Lezer & EPUB Sync**  
Gooi een EPUB of PDF in een item en Troves haalt de cover art eruit. De ingebouwde lezer onthoudt precies op welke pagina je was gebleven over verschillende sessies heen. Als je tekst in een EPUB markeert, synchroniseert die quote plus de context van het hoofdstuk naar het Notebook van je Trove.
* **Video Archivering**  
Plak een link naar YouTube, Twitter, Reddit of TikTok, en Troves gebruikt `yt-dlp` in de achtergrond om de video fysiek te downloaden en voor altijd te archiveren bij je item.

## 🔍 Echt goed zoeken naar items en documenten

Zoeken is bij de meeste lokale apps een nagedachte. Troves gebruikt SQLite Full Text Search (FTS) over de gehele database, wat veel verder gaat dan het matchen van een titel of een tag.

* **Diepe Document Indexering**  
Als je een PDF-handleiding, EPUB of webpagina aan een item hangt, parst en indexeert Troves de tekst. Je zoekt dus niet alleen door je fysieke inventaris; je zoekt direct in je documentatie.
* **Fuzzy Search Toggles**  
Search stemming is geweldig voor gereedschap, maar bloedirritant als je kleding zoekt en wordt overspoeld met false positives. Je kunt "Fuzzy Word Search" per Trove uitzetten voor strikte, exacte tekstmatches.
* **Ruimtelijke Context**  
Zoekresultaten geven exact de bak, geneste lade en (visueel) het rastervakje terug waar het item zich bevindt. Of bij documenten, de exacte locatie van de tekst in het boek.

## 🔌 Extensies & Modding
<img src="./.github/screenshots/034-prompt-generator.webp" align="right" width="300" alt="Plugin Prompt Generator" />

Modden is leuk. Je kunt eindeloos features en bloat toevoegen zonder consequenties.

Troves ondersteunt een drop-in, zero-config plugin architectuur. Wil je een Discord webhook pingen, fysieke labels printen naar een custom thermische printer, of componenten opzoeken via de Mouser API? Drop dan simpelweg een `.js` bestand in de `data/plugins/` map (of schrijf hem rechtstreeks in het Admin dashboard).

De Extension Engine regelt asynchrone routing, offline wachtrijen en veilige injectie van environment variabelen, en ondersteunt hot-reloading van plugins zonder de server te hoeven herstarten.

Geen zin om de documentatie te lezen? Het Admin dashboard heeft een ingebouwde prompt-generator. Typ in wat je wil dat de plugin doet, en Troves verpakt jouw idee samen met alle benodigde architectuur-context en API-regels in een massieve prompt. Plak het in je favoriete LLM en laat die de extensie voor je schrijven.

Bekijk de [Extensions Documentation](docs/extensions/01-architecture.md) om je eigen plugins te schrijven.

Of... gebruik gewoon een van de al beschikbare extensies: [Spotify](docs/extensions/99-more-examples/spotify-music-enhancer.js), [Google Books](docs/extensions/99-more-examples/google-books-enhancer.js), [Mouser](docs/extensions/99-more-examples/mouser-spec-downloader.js), [Vinted](docs/extensions/99-more-examples/vinted-detailed-search-scout.js), [etc](docs/extensions/99-more-examples/).

⚠️ VEILIGHEIDSWAARSCHUWING: Extensies draaien in de context van de core-server. Ze hebben onbeperkte toegang tot .env variabelen, de database en je lokale bestandssysteem. Installeer uitsluitend extensies die je zelf geverifieerd hebt of uit bronnen die je vertrouwt. Een kwaadaardige plugin installeren staat gelijk aan je server weggeven.

## 🔒 Privacy, Transparantie & BYOM (Bring Your Own Model)

**Helemaal Gratis (Als je dat wilt)**  
Je hebt geen dure abonnementen nodig om Troves te draaien. De gratis tiers voor Google Gemini (15 requests/min) en Groq zijn enorm genereus en compleet voldoende voor een normaal huishouden. Ik heb geen cent betaald tijdens mijn gebruik of de ontwikkeling.

**Bring Your Own Model & Granulaire Routing**  
Troves ondersteunt elke OpenAI-compatibele API (Ollama, LM Studio, vLLM) naast de native Groq en Gemini integraties. Je zit niet vast aan één model per modaliteit. Via `.env` overrides kun je specifieke cognitieve taken doorsturen: stuur de `AI_TEXT_PARSER` naar een gratis lokale Ollama instantie voor het verwerken van achtergrond-JSON, terwijl je `AI_TEXT_SUMMARY` naar Groq wijst voor razendsnelle samenvattingen van webpagina's.

**Meerdere Geïsoleerde Databases**  
Je wordt niet in één gigantische bak gegooid. Je kunt compleet gescheiden, geïsoleerde inventarissen draaien (bijv. eentje voor schoenen, eentje voor kleding en een hele strikte voor elektronica).

**De `NO_THIRD_PARTY_SERVICES` Flag**  
Ik heb er echt een hekel aan als ik me voor allerlei 3rd-party diensten moet registreren om software uit te proberen. Als je `NO_THIRD_PARTY_SERVICES = true` in je `.env` bestand zet, kun je de core app volledig offline gebruiken zonder API keys (al zul je bij het toevoegen van nieuwe items dan wel meer handmatig moeten intypen).

**Al je data is van jou en staat veilig op je eigen apparaat.**  
Je gehele database draait op een enkel, draagbaar SQLite bestand, en alle foto's/documenten worden direct opgeslagen in je lokale upload map. Er zijn geen tracking cookies, geen verplichte accounts, en geen vendor lock-in.

**Transparantie**  
Troves biedt volledige transparantie over wat er naar externe API's gestuurd wordt. In het `/activity` dashboard kun je precies zien welke data er naar het Vision model gaat, inclusief ruwe JSON responses, executietijden, en eventuele tokenlimieten.

**📡 De 'Feel-Good' Telemetrie**  
Ik heb een kleine ping aan de backend toegevoegd die contact opneemt met mijn persoonlijke server (via een CF proxy) wanneer Troves opstart of geïnstalleerd wordt. Dit is puur voor mijn eigen gemoedsrust; het is gewoon ongelooflijk motiverend om te weten dat er daadwerkelijk andere mensen zijn die je spul gebruiken. Wie ze ook mogen zijn.

Het stuurt de app versie en een versleuteld instance ID mee (om zeker te weten dat het niet 50 keer dezelfde Troves installatie is die herstart). Het stuurt absoluut geen IP-adres (jouw server-IP wordt genegeerd), inventarisdata, foto's, keys of wat dan ook.

*Verifieer het zelf: De code voor de ping zit in `src/lib/server/telemetry.ts`, zoek naar `pingTelemetry` om te zien hoe en waar het wordt aangeroepen.*

Maar goed, ik snap volkomen dat je wilt dat je self-hosted software helemaal zijn mond houdt. Als je je hiervoor wilt afmelden, zet je simpelweg `DISABLE_FEELGOOD_TELEMETRY="true"` in je `.env` bestand. Dan hoor je er niets meer van, no hard feelings!

## Een paar Screenshots

Dit had ik eigenlijk een paar jaar geleden al moeten doen, maar ik heb me nooit echt beziggehouden met de visuals. Maar goed, laten we in 2026 de bal eens aan het rollen brengen! De eerste screenshots:

<div>
    <img src="./.github/screenshots/000-create-trove.webp" width="19%" alt="" />
    <img src="./.github/screenshots/003-book-search.webp" width="19%" alt="" />
    <img src="./.github/screenshots/004-document-search.webp" width="19%" alt="" />
    <img src="./.github/screenshots/005-items-electronics.webp" width="19%" alt="" />
    <img src="./.github/screenshots/008-add-single.webp" width="19%" alt="" />
</div>

<div>
    <img src="./.github/screenshots/014-trove-settings.webp" width="19%" alt="" />
    <img src="./.github/screenshots/016-activity-model-use.webp" width="19%" alt="" />
    <img src="./.github/screenshots/018-spatially-mapped.webp" width="19%" alt="" />
    <img src="./.github/screenshots/020-advanced-search.webp" width="19%" alt="" />
    <img src="./.github/screenshots/025-garden.webp" width="19%" alt="" />
</div>

<i>More <a href="./docs/Screenshots.md">screenshots</a> here</i>

---

## 🛠️ Installatie & Setup

**Linux Installer**
```bash
mkdir troves && \
    cd troves && \
    curl -fsSL https://raw.githubusercontent.com/romland/troves/main/bin/setup-host.sh -o setup.sh && \
    bash setup.sh
```

**⚠️ Hardware Heads-Up (Geheugen & SBCs)**  
Als je van plan bent dit te draaien op een goedkopere Single Board Computer (zoals een Raspberry Pi): de microservice voor achtergrondverwijdering heeft RAM nodig. Het wil eigenlijk zo rond de 8GB om comfortabel te kunnen draaien. Als je Troves probeert op te spinnen op een 2GB of 4GB bordje, zal dat het systeem waarschijnlijk compleet op zijn knieën dwingen. Mocht je krap in je geheugen zitten, dan kun je de achtergrondverwijdering simpelweg uitschakelen in de app-instellingen.

**Host Dependencies (Optioneel)**  
Alle externe afhankelijkheden vallen netjes terug als een tool niet geïnstalleerd is.

* `poppler-utils` (haalt de eerste pagina van een PDF eruit als thumbnail)
* `ffmpeg` (haalt frames uit videobestanden)
* `yt-dlp` (downloadt gelinkte video's)

**Lokale LAN HTTPS**  
Mobiele browsers vereisen strikt HTTPS om de camera te mogen gebruiken of om de PWA op je startscherm te installeren. Waarom zou je al die moeite doen voor lokale certificaten in plaats van een Cloudflare Tunnel? Vanwege het "trombone-effect". Als je een externe tunnel gebruikt, stuurt het maken van een foto de afbeelding via je internetverbinding naar een ver datacenter, om het vervolgens weer terug te kaatsen naar de server die letterlijk anderhalve meter bij je vandaan staat. Cloudflare en co. leggen ook harde limieten op bij uploads, enz.

Draai het meegeleverde HTTPS setup script:

```bash
bash bin/setup-https.sh
```

Volg de instructies om het gegenereerde `rootCA.crt` op je telefoon te installeren, genereer de lokale `.pem` bestanden, en je verkeer blijft bloedsnel, onbeperkt en compleet offline.

## 💻 Development & Onder de Motorkap

**Stack** Svelte 5, PWA, Prisma, SQLite, Tailwind, TypeScript, LLMs + diverse ML modellen.

**Een opmerking over de terminologie**  
Hoewel de UI je top-level databases "Troves" noemt, noemt het onderliggende database-schema ze nog steeds "Inventories". Bovendien wordt de bulk-camerafunctie in de UI "Multi-Scan" genoemd, maar in de code heet het "Collections". Ik geef het maar even aan, want dat gaat ongetwijfeld voor verwarring zorgen als je in de repo gaat grasduinen.

### Dev Setup

```bash
# 1. Clone de repo
git clone https://github.com/romland/Troves.git
cd troves

# 2. Setup environment
cp .env.example .env
npm install

# 3. Setup database
npx prisma migrate dev --name init
npx prisma db seed

# 4. Draai de dev server
npm run dev

```

### De ARRRGH's (dev troubleshooting)

Dit is vooral voor mezelf.

**Canvas Module Error**  
Als je `Error: Cannot find module '../build/Release/canvas.node'` krijgt na een `npm install`:

```bash
cd node_modules/canvas
npx node-gyp rebuild
```

**Prisma Error**  
Als je je `node_modules` hebt weggegooid en Prisma breekt:

```bash
npx prisma generate
```

**yt-dlp Updaten**  
Mocht het archiveren van video's ineens niet meer werken, dan heeft YouTube waarschijnlijk iets aan hun player veranderd. Update yt-dlp handmatig met:

```bash
P="$(which yt-dlp)" && sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O "$P" && sudo chmod a+rx "$P"
```

## 📌 Mijn Persoonlijke Setup (TODO, dit nog verder uitwerken)

*Documenteren hoe ik dit van dag tot dag gebruik:*

* Welke thermische labelprinter ik gebruik.
* Op welke stellingkasten en hardwarebakjes ik vertrouw.
* Foto's van mijn fysieke opslagbakken.
* De Firefox QR-code generator extensie die ik gebruik voor current links.
* Welke velden ik daadwerkelijk de moeite neem om in te vullen vs. de velden die ik aan AI overlaat.

## 💡 Hacks & Pro-Tips

* **Zet hem op je Startscherm**  
Ik raad je ten zeerste aan om de "Zet op startscherm" (Add to Home Screen) knop op je telefoon te gebruiken. Het verbergen van de browser UI geeft je een berg aan verticale ruimte terug, en het maakt het geheel gewoon een stuk fijner in gebruik.
* **De Zwembadnoedel Hack ($2)**  
Wanneer je kleding scant, en dan vooral als je de achtergrondverwijdering gebruikt, zorgen slappe mouwen en doorstekende kledinghangers voor een lelijke uitsnede. Snijd een stevige schuimrubberen zwembadnoedel in de lengte open en schuif hem over de bovenste stang van een standaard houten kledinghanger. Je verbreedt hiermee direct het schouderprofiel.
* **iOS Safari Share Workaround**  
Apple ondersteunt de Web Share Target API voor PWA's niet. Om toch makkelijk dingen te delen naar Troves vanaf een iPhone, bouw je even een snelle iOS Shortcut (Opdracht) die URL's/Afbeeldingen accepteert, de input URL-codeert, en vervolgens `https://[jouw-troves-ip]/timeline?pasteText=[Encoded Input]` opent.
* **Systeemdiagnostiek**  
Mocht er iets kapot gaan, check dan `/settings/admin` om een zelfdiagnose te draaien op host tools, Docker microservices (RemBG, OCR) en API configuraties.
* **Categorieën op Foto-niveau**  
Moet een item in twee categorieën bestaan? Geef het dan meerdere foto's en wijs aan elke foto een andere categorie toe. De engine lost categorieën op het niveau van de foto op. (Dit betekent ook dat het veranderen van een categorie via het "..." menu in de afbeeldingen-lightbox moet gebeuren).
* **Snelle Notities**  
Hou de Notebook-knop lang ingedrukt (long-tap) om een snelle notitie toe te voegen zonder je huidige scherm te verlaten.
* **Tel de items**  
We weten allemaal dat generatieve modellen af en toe wat... enthousiast kunnen zijn. Als je grote multi-scans doet (tientallen items), is het tellen van de items vóórdat je ze scant een goede manier om er zeker van te zijn dat jij en het model op één lijn zitten. Het geeft je tijdens de triage meteen een idee of je wel een goeie foto had gemaakt.

## Een paar Video's
<div>
    <video src="https://github.com/user-attachments/assets/1ca11e70-2ff3-47e7-9614-9276dd2945dc" controls width="45%" alt="Single item import"></video>
    <!-- video src="https://github.com/user-attachments/assets/ab96641d-8dec-4621-a876-b13621dc85c8" controls width="45%" alt="Bulk import of CDs"></video -->
    <video src="https://github.com/user-attachments/assets/661ee52e-e49e-42ca-9d35-80476a92036e" controls width="45" alt="Spatial placement"></video>
</div>
