# 📦 Troves
<img src="static/troves512.webp" align="right" width="40%" alt="Troves Logo" />

Inventory management (for at home). There are many like it, but this one is mine.

My primary use-cases are:

1. `Do I have that? Now, where the heck is it?`
2. `What does it do and why did I buy it?`

There is also that primal satisfaction in simply admiring your stuff; swimming through a hoard of tools, books, and components like Scrooge McDuck. This is a digital equivalent: inspect and appreciate your sh*t without having to drag 20 boxes out of the attic.

I absolutely hate data-entry. Creating an inventory and adding new items should be as automated as humanly possible. Most of the effort in Troves went into creating a pleasant, frictionless workflow so you actually use it. Under the hood, it uses tools like object classification, OCR, background removal, color extraction, vision, audio, and language models to do the heavy lifting, but the interface gets out of your way.

Just snap a picture, or paste in a URL and let the system organize it.

[There](https://youtu.be/5B0cxLwS8fo) might [be](https://youtu.be/8WpgqJUO7SQ) a [bunch](https://youtu.be/n4YAiE8Yv5Y) of [demo](https://youtube.com/shorts/qyyXUC3TYlg?feature=share) videos [uploaded](https://youtube.com/shorts/U_juc8A-QqI?feature=share) to [YouTube](https://youtube.com/shorts/JtorL9VRztQ?feature=share).

## 📸 The Core Workflow
<table align="right" width="30%">
  <tr>
    <td align="center">
        <i>
            <i>This demonstrates the <a href="./docs/extensions/04-examples.md">Spotify Extension</a> during bulk import of CDs</i>
        </i>
    </td>
  </tr>
  <tr>
    <td>
        <img src="./.github/screenshots/gif-multi-scan-cds.gif" width="100%" alt="Multi-scan CDs" />
    </td>
  </tr>
</table>

To add a product, grab your phone, take a picture, and scan the QR-code on the container you want to place it in. That's it.  

That said, if you're feeling ambitious, you can:
* Take a picture of an invoice or receipt (Troves will figure out the juicy bits).
* Add additional photos or just paste in web links.
* Scan QR-codes containing URLs to relevant documents.
* Manually type tags, amounts, and descriptions (but then you are *very* ambitious).
* **Just Paste Anything:** Hit `Ctrl+V` anywhere. The global PasteHandler detects images in your clipboard, raw URLs (fetching the webpage), text blocks (creating local Markdown notes), and even raw Key-Value Pair lists (weight/color/size), mapping them to attributes.
* **Fire-and-Forget Outbox:** Never wait for a progress bar. Tapping 'Save' pushes the item to an offline-tolerant IndexedDB queue and resets the UI. You can scan items in a deep basement with no signal, and the app will sync whenever your Wi-Fi reconnects.

**Bulk Import & The Comparison Lens**  
If bulk import is how you ingest a mountain of data into Troves, the Comparison Lens is how you audit reality against your database using set math. *(Tip: Count the physical items before snapping a multi-scan photo. It gives you a quick sanity check to know if your picture was clear enough for the model to catch everything).*

* **Flea Market Scan ($A \setminus B$):**  
Snap a photo of a crate of 40 CDs or books to see what is **✨ New to You** and what is already **✓ In Your Trove**.

* **Kit Check ($B \setminus A$):**  
Dump your stuff on a table, scope the comparison to the `#camping-gear` tag, and snap a photo to see exactly what you forgot to pack (a bit of a forced example, but ah, why not...).


## 🧠 Self-Organizing Taxonomy

Because Troves has to handle a bit of everything, from winter coats to spark plugs to whiskey to trollbeads to ESP32 boards, it can't be pre-programmed with rigid spreadsheet columns like "Brand" or "Shoe Size." Instead, it creates, destroys (and updates) its own structure on the fly using an Entity-Attribute-Value taxonomy. There's a bit more to it, but that is the idea.

**Keeping the language consistent:**  
Image-recognition tools are naturally messy. If you feed the system photos of three different t-shirts, it might label one with "short sleeves," another with "arm style," and a third with "sleeve length." You can't build a useful search tool out of that. To fix this, the first time the app sees a new category, it locks in a specific set of labels and forces the software to reuse those exact terms for all future items. It turns messy, fluid text into a clean, predictable database.

**Spotting duplicates from photos:**  
If you take a picture of a jacket on your bed today, the lighting and folds will look completely different than when you first logged it hanging in a closet months ago. To handle this, Troves cross-references the visual details and the text to figure out if it's the same item, ensuring it doesn't log a duplicate or confuse two completely different blue shirts.

*Note:* Does the vision model sometimes guess wrong? Look for the ✨ Sparkle icon next to the title. Click it to provide a hint (e.g. "It's an IKEA MITTZON desk") to nudge the classification. Empty categories vaporize if you move the last item out of them, keeping your database clean.


## 🗺️ Spatial Mapping vs. Semantic Tagging

When assigning a location to an item, Troves gives you a fork in the road depending on what you are storing.

**Option A: Semantic Tagging (Text/QR)**  
You type or scan a name (e.g., "Garage Shelf 2" or "Moving Box A"). When you search for the item later, the app just prints the text.
*Best for: Macro items. Coats, circular saws, book boxes. You don't need a treasure map to find a chainsaw on a shelf.*

**Option B: Spatial Mapping (Visual Grid)**  
You snap an overhead photo of an open drawer, Gridfinity layout, or wine rack. You define the grid in the UI. Then, the app asks, "Tap where it goes."
*Best for: Micro items. Resistors, screws, Lego parts. It bypasses the need to read tiny labels on 40 identical hardware trays.*

**Deep Scan Grid:**  
If you don't want to tap 60 times, hit ✨ Deep Scan. The Vision Model analyzes the entire drawer in one go, reading printed labels and identifying the physical components in each specific slot. Troves then opens a "Triage" screen where you step through the results, verify the model's guess, and accept it into your inventory.

**⚠️ Important Note on Medication:**  
Please do **NOT** use the automatic indexing, spatial mapping, or LLM-based label reading for organizing medication, drugs, or hazardous materials. Vision and Language models are eager servants and can easily misread dosages and labels. Rigorous human proof-reading is always required.


## 🗣️ Hardware-Aware Voice Search

The search field supports voice dictation parsed by a custom NLP engine. Ask natural questions to locate things ("Find my grey jeans" or "Where is the USB to TTL converter?"), check stock ("How many BNCQ9 connectors do I have?"), or group items ("List my microcontrollers").

Standard NLP stemmers usually destroy alphanumeric model numbers. Troves' engine explicitly rescues tokens containing digits, ensuring terms like `ESP32`, `LM317`, or `1k` survive. It also uses bidirectional unit translation, meaning if you say "10 microfarad", it perfectly matches the `10µF` stored in your database.

You can test the intent parser without a microphone by prefixing your search with `/v ` (e.g., `/v where are my 10k ohm resistors?`).

**Extending to Other Domains:**  
Because the Voice Engine relies on dictionaries and regular expressions rather than rigid database schemas, extending it to entirely different troves (like a wardrobe or wine cellar) is trivial. You just expand the pre-processing maps in `VoiceEngine.ts` to add domain-specific phonetics (e.g., mapping `Cab Sauv` to `Cabernet Sauvignon` or expanding `32x34` to `waist 32 length 34` for TTS) and custom intent triggers.


## 📚 The Knowledge Base (Link-Rot Prevention)

Troves isn't just for physical junk. It also hoards your digital files, manuals, datasheets, and notes, so you actually remember how to use the things you bought.

* **Offline Archives:**  
Never run into a dead link again. If you link to a webpage, manual, or spec sheet, Troves downloads, parses, summarizes, and archives it locally on your disk. (Scraping is restricted to 1-level depth to prevent infinite spidering).
* **Digital Reader & EPUB Sync:**  
Drop an EPUB or PDF into an item, and Troves extracts the cover art. The built-in reader saves your exact scroll position across sessions. Highlighting text inside an EPUB syncs that quote and the surrounding chapter context to the Trove's Notebook.
* **Video Archiving:**  
Paste a link to YouTube, Twitter, Reddit, or TikTok, and Troves uses `yt-dlp` in the background to physically download the video and archive it forever alongside your item.

## 🔍 Actually good searching for items and documents

Search in most local apps is an afterthought. Troves uses SQLite Full Text Search (FTS) across the entire database, going far beyond standard title and tag matching.

* **Deep Document Indexing:**  
If you attach a PDF manual, EPUB, or webpage to an item, Troves parses and indexes the text. You aren't just searching your physical inventory; you are searching your documentation.
* **Fuzzy Search Toggles:**  
Search stemming is great for tools, but infuriating when it floods an apparel search with false positives. You can toggle "Fuzzy Word Search" off per-trove for strict, exact-match queries.
* **Spatial Context:**  
Search results return the exact container, nested tray, and (visually) grid slot it currently occupies. Or in documents, the exact location of the text.

## 🔌 Extensions & Modding

Modding is fun. You get to feature-creep and add bloat without consequences.

Troves supports a drop-in, zero-config plugin architecture. If you want to ping a Discord webhook, print physical labels to a custom thermal printer, or look up components from the Mouser API, just drop a `.js` file into the `data/plugins/` directory (or write it directly in the Admin dashboard).

The Extension Engine handles asynchronous routing, offline queuing, and secure environment variable injection, and supports hot-reloading plugins without server restarts.

## 🔒 Privacy, Transparency & BYOM

**Completely Free (If you want it to be):**  
You do not need expensive subscriptions to run Troves. The free tiers for Google Gemini (15 requests/min) and Groq are generous and completely sufficient for a normal household. I have not paid a single cent during my use or development.

**Bring Your Own Model & Granular Routing:**  
Troves supports any OpenAI-compatible API (Ollama, LM Studio, vLLM) alongside native Groq and Gemini. You aren't restricted to a single model per modality. You can map specific cognitive tasks via `.env` overrides: route `AI_TEXT_PARSER` to a free local Ollama instance for background JSON structuring, while pointing `AI_TEXT_SUMMARY` to Groq for fast webpage summaries.

**Multiple Isolated Databases:**  
You aren't forced into one giant bucket. You can run completely separate, isolated inventories (e.g., one for shoes, another for clothes, and a strict one for electronics).

**The `NO_THIRD_PARTY_SERVICES` Flag:**  
I really dislike it when I have to register for 3rd-party services to try software. If you set `NO_THIRD_PARTY_SERVICES = true` in your `.env` file, you can use the core app entirely offline without any API keys (though adding new items will require more manual entry).

**Your data is completely yours and sits securely on your own device.**  
Your entire database runs from a single SQLite file, and all photos/documents are saved directly into your local upload folder. There is no cloud telemetry, no forced accounts, and no vendor lock-in.

**Transparency:**  
Troves offers full transparency over what is being sent to external APIs. In the `/activity` dashboard, you can view the exact data sent to the Vision model, its raw JSON responses, execution times, and possible token usage limits.


## Some Screenshots
It's a couple of years overdue because I never really did anything about the visuals. But, let's get the ball rolling in 2026! The first screenshots:

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

---

## 🛠️ Installation & Setup

**Linux Installer:**  
```bash
mkdir troves && \
    cd troves && \
    curl -fsSL https://raw.githubusercontent.com/romland/troves/main/bin/setup-host.sh -o setup.sh && \
    bash setup.sh

```

**Host Dependencies (Optional):**  
All external dependencies gracefully fall back if a tool isn't installed.

* `poppler-utils` (extracts PDF first pages as thumbnails)
* `ffmpeg` (extracts frame grabs from video files)
* `yt-dlp` (downloads linked videos)

**Local LAN HTTPS:**  
Mobile browsers strictly require HTTPS to use the Camera or install the PWA to your home screen. Why go through the hassle of local certs instead of a Cloudflare Tunnel? Because of the "trombone effect." If you use an external tunnel, taking a photo sends the image out over your internet connection to a remote datacenter, just to bounce it right back to the server sitting 5 feet away from you. Cloudflare/others also impose hard limits on uploads, etc.

Run the included HTTPS setup script:

```bash
bash bin/setup-https.sh
```
Follow the instructions to install the generated `rootCA.crt` on your phone, generate the local `.pem` files, and your traffic remains fast, unrestricted, and completely offline.


## 💻 Development & Under the Hood
**Stack:**  
SvelteKit 2, PWA, Prisma, SQLite, Tailwind CSS, TypeScript, LLMs + various ML models.

**A Note on Terminology:**  
While the UI refers to your top-level databases as "Troves", the underlying database schema still calls them "Inventories". Furthermore, the bulk camera feature is called "Multi-Scan" in the UI, but referred to as "Collections" in the code. I mention this because there is bound to be confusion if you start poking around the repo.

### Dev Setup
```bash
# 1. Clone the repo
npx degit romland/troves troves
cd troves/sveltekit-starter

# 2. Setup environment
cp .env.example .env
npm install

# 3. Setup database
npx prisma migrate dev --name init
npx prisma db seed

# 4. Run dev server
npm run dev
```

### The ARRRGH's (dev troubleshooting)
This is for myself.

**Canvas Module Error:**  
If you get `Error: Cannot find module '../build/Release/canvas.node'` after `npm install`:
```bash
cd node_modules/canvas
npx node-gyp rebuild
```

**Prisma Error:**  
If you deleted `node_modules` and Prisma breaks:
```bash
npx prisma generate
```

**Updating yt-dlp:**  
If video archiving stops working, YouTube likely changed their player. Manually update yt-dlp:
```bash
P="$(which yt-dlp)" && sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O "$P" && sudo chmod a+rx "$P"
```

## 📌 My Personal Setup (TODO, flesh this out)
*Document how I actually use this day-to-day:*
* Which thermal label printer I use.
* Which hardware cabinets and organizers I rely on.
* Pictures of my physical containers.
* The Firefox QR-code generator extension I use for current links.
* Which fields I actually bother filling in vs. leaving to the AI.


## 💡 Hacks & Pro-Tips

* **The Pool Noodle Hack ($2):**  
When scanning clothes, especially if you use the background removal feature, limp sleeves and hanger-pokes ruin the cutout. Slit a dense foam pool noodle down the side and slide it over the top bar of a standard wooden hanger. It immediately widens the shoulder profile.

* **iOS Safari Share Workaround:**  
Apple does not support the Web Share Target API for PWAs. To share things into Troves on an iPhone, build a quick iOS Shortcut that accepts URLs/Images, URL-encodes the input, and opens `https://[your-troves-ip]/timeline?pasteText=[Encoded Input]`.

* **System Diagnostics:**  
If something breaks, check `/settings/admin` to run a self-diagnosis on host tools, Docker microservices (RemBG, OCR), and API configurations.

* **Photo-Level Categories:**  
Need an item to exist in two categories? Give it multiple photos and assign a different category to each. The engine resolves categories at the photo level. (This also means changing a category requires opening the image lightbox and using the "..." menu there).

* **Quick Notes:**  
Long-tap the Notebook button to add a quick note without leaving your current context.

## Some Recordings
<div>
    <video src="https://github.com/user-attachments/assets/1ca11e70-2ff3-47e7-9614-9276dd2945dc" controls width="45%" alt="Single item import"></video>
    <!-- video src="https://github.com/user-attachments/assets/ab96641d-8dec-4621-a876-b13621dc85c8" controls width="45%" alt="Bulk import of CDs"></video -->
    <video src="https://github.com/user-attachments/assets/661ee52e-e49e-42ca-9d35-80476a92036e" controls width="45" alt="Spatial placement"></video>
</div>
