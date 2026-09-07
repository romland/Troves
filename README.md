# Troves
<img src="static/troves512.webp" align="right" width="40%" alt="Troves Logo" />

Inventory management (for at home). There are many like it, but this one is mine.

My use-cases were:  
`Do I have that, where the heck is it?` and  
`What does it do and why did I buy it?` [1]

I am no fan of data-entry, so adding new products/items should be as automated as 
possible (using any device). Most of the effort of making this app went into creating
a pleasant and fast work-flow. To achieve this, Troves optionally uses various tools 
like object classification, OCR, background removal, and language models under the hood.

[1]: There's also a primal satisfaction in simply admiring my stuff; swimming through a hoard of tools, books, and components like Scrooge McDuck. This is the digital equivalent: inspect and appreciate your sh*t without having to drag 20 boxes out of the attic.

_This readme is very much a work in progress; it's currently not organized or complete at all._
_Also: Quite a few of the more recent bits are written by an LLM acting as a sales person, which is very cringe. I will deal with it._

### How to use
To add a product, grab your phone and take a picture, scan the QR-code on the container
to place it in and that's it.  

But wait... there's more.

If feeling particularly ambitious on a day, you can also:
- take a picture of an invoice/receipt (Troves will use image classification/OCR/LLM to get the juicy bits)
- add additional photos (using camera or just paste in links)
- scan QR-codes containing URLs to relevant documents
- paste in a list of attributes (weight/color/size/etc)
- **Fuzzy Search Toggles:** Unhappy with search results? The AI stems words (e.g., "Jeans" -> "Jean") which is great for finding electronics or tools but sometimes too broad for clothes. You can toggle "Fuzzy Word Search" off per-inventory in Settings for strict text matching.
- **Position Persistence:** The reader automatically saves your exact scroll position, PDF page, or EPUB location across sessions. You won't spend half your day scrolling back to where you left off.
- **Complete AI Transparency:** Troves offers full transparency over what is being sent to external APIs. In the `/activity` dashboard, you can view the exact JSON prompts sent to the Vision model, the raw JSON responses, execution times, and token usage limits.
- **Multiple Categories:** Need an item to exist in two categories? Give it multiple photos and assign a different category to each photo. The engine resolves categories at the photo level.
- **Changing Categories:** Changing the category of an item is awkward at the moment; go into the image lightbox, use the "..." menu and change the category of the item there (historically it comes from the fact that it's the *photo* that is categorized, not the item).
- **Just Paste Anything:** The global PasteHandler instantly detects images in your clipboard (uploading them to the current item), raw URLs (fetching the webpage/PDF), and text blocks (creating local Markdown notes analyzed by LLMs). Hit `Ctrl+V` anywhere!
- Fire-and-Forget Outbox Workflow: Never wait for a progress bar. Tapping 'Save' pushes the item to an offline-tolerant IndexedDB queue and resets the UI for next scan. A background worker handles the upload, meaning you can rapidly scan items in a deep garage or basement and the app will flawlessly sync whenever your Wi-Fi reconnects.
- **Knowledge Base / Second Brain:** Troves isn't just for physical objects. Because it downloads, parses, and indexes linked articles, EPUBs, and PDFs, it doubles as a localized knowledge base for your topics and projects. The bookmark feature and making it searchable is the knowledge base version of "where is it" (entity knows how often I've gone: where did I read that...).
- never run into a dead link again, all pages you link to are downloaded and stored locally on your disk
- **Video Archiving:** If you paste a link to YouTube, Twitter, Reddit, TikTok or any other media site, Troves uses `yt-dlp` in the background to physically download the video and archive it forever alongside your item!
- **Nudge the Vision Model:** Does it sometimes guess wrong? Look for the ✨ Sparkle icon next to the title in the item details or scan preview. Click it to provide a hint (e.g. "It's an IKEA MITTZON desk") to dramatically improve classification accuracy!
- **Scraper Limits:** Troves attempts to fetch and summarize documents linked in text automatically, but restricts depth to one level to prevent infinite spidering. Use `httrack` or similar tools for full website archival.
- **Empty Category Cleanup:** If you delete or move the last item out of a category, Troves will automatically vaporize the category and its associated taxonomy rules. This facilitates easy cleanup if you import an item into the wrong trove.
- **System Diagnostics:** Includes a self-diagnostic area in the Admin dashboard (`/settings/admin`) that pings host dependencies, Docker microservices, and API configurations to flag setup errors.
- add tags, amount, description, etc (but then you are obviously _very_ ambitious as it might require typing)

**Note:** You do not need expensive subscriptions (OR ANY AT ALL) to run Troves. The free tiers for Google Gemini (15 requests/min) and Groq are generous and completely sufficient for a normal household. I have not paid a single cent during my use nor during development. Groq is utilized free analysis like in `summarizeWebpageExtract`, `extractInvoiceDataGroq`, and reverse image search parsing.

### Voice Search
I use Groq's Whisper 3 for TTS in the search field. It is ridiculously good when given context, actually. With ease we handle "USB to TTL", "ESP32 Development board", "Resistors 10k" or "I2C OLED display module" in search. It feels _very_ natural.

You can also ask where something is. Try saying: **"Find my grey jeans"** or **"Where is the USB to TTL converter?"**. Your intent will be parsed, located in your database, and audibly speak the location back to you.

### Here's a text about taxonomy that will be incorporated naturally in this README one day:
We’re building a self-organizing inventory app. The basic idea is that you take a photo of any object—from a book to a winter coat to a spark plug—and the app automatically figures out what it is, what details matter, and how to file it away.

Because it has to handle a bit of everything, we can't pre-program it with rigid spreadsheet columns like "Brand" or "Shoe Size." Instead, the system creates its own structure on the fly. Doing this brings up two practical hurdles:

**Keeping the language consistent**  
Image-recognition tools are naturally a bit messy with words. If you feed the system photos of three different t-shirts, it might label one with "short sleeves," another with "arm style," and a third with "sleeve length." You can't build a useful search tool out of that. To fix this, the first time the app sees a new category, it locks in a specific set of labels and forces the software to reuse those exact terms for all future items in that group. It turns messy, fluid text into a clean, predictable database.

**Spotting duplicates from photos**  
The other challenge is figuring out if you’ve just photographed an item you already logged. Since we don't rely on barcodes, we have to use the photos themselves. If you take a picture of a jacket on your bed today, the lighting and folds will look completely different than when you first logged it hanging in a closet months ago. The system might pull the color "Navy" today instead of "Dark Blue," or it might miss a pocket. To handle this, the app mathematically cross-references the visual details and the text to figure out if it's the exact same item, ensuring it doesn't log a duplicate or confuse two completely different blue shirts.

Ultimately, we're just using modern vision and language models to handle the tedious work of standardizing and deduplicating data. It figures out how much detail is actually needed; like knowing when an item is just a "hammer" versus a "16oz fiberglass handle". Just snap a picture and let this organize it (okay, I also spammed QR-codes on a whole heap of boxes and trays, so maybe _two_ snaps, although the QR-reader does not require a tap, per se).

### Privacy & Data Ownership
**All your data is completely yours and sits securely on your own device.** Your entire database runs from a single, portable SQLite file, and all photos/documents are saved directly into your local upload folder. There is no cloud telemetry, no forced accounts, and no vendor lock-in.

### Install
__I only have a Debian based installer, for now__  
```bash
mkdir troves && cd troves && curl -fsSL https://raw.githubusercontent.com/romland/troves/main/bin/setup-host.sh -o setup.sh && bash setup.sh
```

### Screenshot(s)
I've been waiting couple of years to actually show a screenshot because I never really did anything
about the visuals ... But, let's get the ball rolling in 2026, the first screenshot:

<img src="./.github/screenshots/001.png" align="center" width="80%" alt="List of items" />


...and only mere days after that, a second and a third one! (whoop!):

<div>
  <img src="./.github/screenshots/002.webp" align="left" width="40%" alt="Add new item" />
  <img src="./.github/screenshots/003.webp" width="40%" alt="Search result" />
</div>


### Features
- Paste-parser for key-value-pairs
- QR-code reading (server and client)
- Optical Character Reading (OCR)
- Image classification (Blip, Vision Models like Gemini)
- LLM Summaries (Llama3, Groq)
- Invoice/receipt data extraction
- Download-and-store documents (link-rot no more). **EPUB books are supported** and can be read inside the browser using built-in reader. You can bookmark pages or highlight text inside EPUBs, which syncs the surrounding chapter text to Notebook. This makes the exact sections of books fully searchable via Full Text Search (alongside the physical items.
- **Token & Cost Tracking:** Troves tracks backend AI operations and token counts so you can monitor exactly how much it interacts with external APIs (visible in System Activity).
- Image processing (background removal, thumbnail, etc)
- Color extraction
- Collection (bulk/multi-scan) import of CDs, DVDs, books, whiskeys, what have you
- Multiple inventories (i.e. one for shoes, another for clothes, and yet another for electronics)
- Reminder to self: long-tap on notebook button to add a quick note without going to notebook
- Bring your own model
- ...and more

### Scanning collections
`Tip: count the items before scanning. Gives you an idea if you had a good enough picture`

*Side note: It did not take me more than an hour or two to scan 16 cardboard boxes full of books. The unpacking and packing the books back into the box was the time-consuming part.*


__this is so cringe -- I the human should rewrite this -- now here as reminder__ 
### Bulk Import & The Comparison Lens (Set Operations) *[ALPHA/TESTING]*

The **Entity-Attribute-Value (EAV) Taxonomy** automatically tailors schemas based on your troves' archetype. It intuitively knows that a t-shirt needs a "Garment Style" and "Fabric", while a drill requires a "Form Factor" and "Power Delivery". It enforces strict vocabulary to eliminate search friction.

When it comes to putting that data to work, you can rely on the **Comparison Lens**.
If bulk import is how you ingest a mountain of data into Troves in one go, the **Comparison Lens** is how you actually use that data out in the real world against physical shelves, crates, and stores without having to pick up items and scan barcodes one-by-one.

It performs set math between what your camera sees (**Set A**) and what your database holds (**Set B**).


### Spatial Mapping & The Deep Scan Grid
Troves doesn't just track *which* box an item is in; it tracks exactly *where* it is inside that box. If you use tackle boxes, Gridfinity, organizer drawers, or subdivided shelves, you can map their physical layouts directly onto a top-down photograph.

* **Mapping the Drawer:** When viewing a container, click "Edit Map" and use the "Warp Grid" tool. Just drag the four outer corners to match the edges of your drawer, specify the number of rows and columns, and Troves will project a grid over your compartments.
* **Deep Scan:** Instead of manually logging 60 different resistors or screws, tap **✨ Deep Scan Grid**. The Vision Model analyzes the entire drawer in one go, reading printed labels and identifying the physical components in each specific slot.
* **Triage & Save:** Troves then opens a triage screen where you can quickly step through the results. It zooms in on the active cell—complete with a minimap so you don't lose your bearings—allowing you to verify or edit the model's guess. Hit 'Accept' to log it to your inventory.
* **Finding Your Stuff:** Items mapped this way display a glowing outline on their thumbnails. Clicking the thumbnail opens a full-screen map of the container, highlighting exactly which slot to pull from. If you run a missing-items audit against the container, Troves will show you the photo with the exact empty slots glowing red.



#### Digital Books & Documentation
Create a virtual container named **"Digital Library"** and assign tech books, spec sheets, or EPUBs/PDFs there. When you drop an EPUB or PDF into an item, Troves automatically extracts the embedded cover art, `og:image`, or first page to use as the primary thumbnail. The item card gives you a direct **"Read"** button to view and study the document inside the browser.

#### Practical Examples & Workflows
- **Discovery / Flea Market Scan (What do I not own? / $A \setminus B$):** 
  - *Scenario:* You're at a record store or thrift shop looking at a crate of 40 CDs or John Sandford paperbacks. 
  - *Action:* Snap one photo of the shelf.
  - *Result:* The app cross-references your database and splits the items into **✨ New to You** (stuff you don't own yet) and **✓ In Your Trove** (stuff you already own, complete with its exact storage container).
- **Audit / Kit Check (What am I missing from my baseline? / $B \setminus A$):** 
  - *Scenario:* You're packing for a camping trip or checking your electronics workbench. 
  - *Action:* Scope the comparison to tag `#camping-gear` or container `A 001`, dump your gear on the table, and snap a photo. 
  - *Result:* The app flags what's **⚠️ Missing from List** and tells you where it was last logged.
- **Subset Scoping:** Instead of checking against your entire database every time, you can scope comparisons to specific subsets:
  - By Tag (e.g., `#canned-veggie`, `#ps2-games`)
  - By Location/Container (e.g., `Box A 001`)
- **Triage Actions:** When you spot something missing that you want to track, the **Add** menu lets you route it straight to **Collection**, your **Shopping List**, or **To-Do List** in the Notebook (for current Collection).

### Random note to refine in the future
**The Knowledge Base of Your Stuff:** We've blurred the lines between a strict inventory tracker and a personal knowledge base. By integrating an overarching Notebook and automatically downloading linked articles/manuals, Troves isn't just about *where* an item is, but capturing the ideas, projects, and context surrounding it.

### Info how I use Troves
- TODO: 
    - Which label printer
    - Which cabinets
    - Pictures of containers
    - Firefox QR-code generator for current link
    - I use it for electronics/components
    - Which fields I actually fill in
    - How I search for related links
    - **Note on Terminology:** While Troves is an *inventory management* system, the UI refers to the top-level databases as "Troves". The bulk camera feature is named "Multi-Scan", and the underlying database schema retains the name "Inventories" for structural stability. I mention this because there is bound to be confusion before all variables are renamed. Especially since there was a "collection" before (which is now multi-scan). Since then it's gotten even more confusing: collection nee inventory is now called a Trove, collection is not used in UI any more, but it refers to multi-scan in the code.

### Voice Search & NLP Engine
The search field supports voice dictation parsed by a custom NLP engine. You can ask natural questions like *"Where is my multimeter?"*, *"How many BNCQ9 connectors do I have?"*, or *"List my microcontrollers."* 

To make this actually work for hardware, electronics, and tools, the matching engine relies on a few specific mechanics under the hood:

* **Hardware-Aware Tokenization:** Standard NLP stemmers destroy alphanumeric model numbers. The engine explicitly rescues tokens containing digits, ensuring terms like `ESP32`, `LM317`, or `1k` survive the matching process.
* **Bidirectional Unit Translation:** Text-to-speech engines and database records disagree on formatting. The engine uses digit-anchored translations to bridge compound engineering units and shorthands (e.g., `10µF` ↔ `10 microfarad`, `2×4` ↔ `2 by 4`) so spoken queries perfectly match stored symbols.
* **Strict Intent Routing:** The engine parses conversational filler ("show me", "how many") into discrete intents (Locate, Stock, List). It scores matches against item titles, descriptions, categories, and AI-extracted physical traits, using a high-water mark filter to drop loose partial matches.
* **Text Debug Mode:** You can test the intent parser and see exactly how it tokenizes queries without a microphone by prefixing your search with `/v ` (e.g., `/v where are my 10k ohm resistors?`).

#### Extending to Other Domains (Apparel, Wine, etc.)
Because the Voice Engine relies on dictionaries and regular expressions rather than rigid database schemas, extending it to entirely different trove, like a wardrobe or a wine cellar—only requires expanding the pre-processing maps in `VoiceEngine.ts`.

* **Domain-Specific Phonetics:** You add new regex rules to `preprocessText` and `phoneticizeForTTS` to bridge domain shorthands. For clothes, `XL` expands to `extra large` and `32x34` (pants) to `waist 32 length 34`. For wine, `750ml` becomes `750 milliliter`, `Cab Sauv` maps to `Cabernet Sauvignon`, and notoriously difficult French varietals get phonetic spellings specifically for the TTS output.
* **Custom Intents:** While standard triggers ("Where is", "How many") work globally, you can add custom intent regexes to catch domain-specific phrasing, such as *"Which red wines do I have from 2015?"* or *"List all my size medium jackets."*
* **Zero Database Changes:** Because the NLP engine already dumps all dynamically generated attributes (like Vintage, Grape, Fabric, or Size) into the searchable `semanticTokens` pool, the underlying matching algorithm requires zero structural changes to accurately score these new domains.

#### Scanning Clothes
When taking pictures of clothes for your trove, especially if you use the background removal feature, the items will look significantly better if you:
1. Lay them flat on a contrasting surface (like a bedsheet or clean floor).
2. Smooth out major wrinkles.
3. Ensure decent ambient lighting to avoid harsh shadows.

And then you have **The Pool Noodle Hack ($2):** Slit a dense foam pool noodle or foam pipe insulation down the side and slide it over the top bar of a standard wooden hanger. It immediately widens the shoulder profile, preventing limp sleeves and hanger-pokes.

This takes only a couple of seconds per item and drastically improves the visual quality of the resulting cutouts.

# Third parties
I really dislike it when I have to register for some 3rd party services to try out some software,
therefore, that is all voluntary. Set the flag `NO_THIRD_PARTY_SERVICES` to `true` in `.env` 
and you can use it all -- but adding new products will be more work.

### About third party services and incurred costs
Goal is: No fixed cost / month -- only pay for use

# ARRRGH's
You may need to do this after `npm install` if you get `Error: Cannot find module '../build/Release/canvas.node'`:
```
$ cd node_modules/canvas
$ npx node-gyp rebuild
```

Prisma error? Deleted node_modules?
```
$ npx prisma generate
```

# Development

## Stack
SvelteKit 2, PWA, Prisma, SQLite, Tailwind CSS, TypeScript, LLMs + various ML models.


## Installing

### Get it:
```bash
npx degit romland/troves troves
```

### Fill in your details in .env
```bash
cp .env.example .env
```

### Run for development:
```bash
cd sveltekit-starter
npm install
npm run dev
```

### Database migration:
```bash
npx prisma migrate dev --name init
```

### Database seeding:
```bash
npx prisma db seed
```

### Build for production
```bash
npm run build
```

### Safari Share Target
Apple limitation: **iOS Safari does not support the Web Share Target API.**
Apple only allows PWAs to *send* shares out, not *receive* them natively via the share sheet.

### The Workaround: iOS Shortcuts

If you want to share things directly into Troves on an iPhone, the best workaround is to build a quick iOS Shortcut:
1. Open the **Shortcuts** app on your iPhone and create a new shortcut.
2. Tap the **(i)** icon at the bottom and turn on **Show in Share Sheet**.
3. Set it to accept **URLs, Text, and Images**.
4. Add an action to **URL Encode** the shortcut input.
5. Add an action to **Open URLs**, and construct the URL to point to your app's capture route with the encoded input attached as a query parameter (e.g., `[https://dev.providi.nl/timeline?pasteText=](https://dev.providi.nl/timeline?pasteText=)[Encoded Input]`).



### Host Dependencies (Optional)
All external dependencies are **100% optional**. Everything in Troves gracefully falls back if a tool isn't installed.

* **PDF Covers:** `sudo apt-get install poppler-utils` (provides `pdftoppm` to extract PDF first pages as thumbnails)
* **Video Thumbnails:** `sudo apt-get install ffmpeg` (extracts frame grabs from video files)
* **Video Archiving:** `yt-dlp` (downloads linked videos from YouTube, Twitter, etc. into local storage)

### Local LAN HTTPS & PWA (Mobile Access)
Mobile browsers strictly require **HTTPS** to use the Camera or install the app to your home screen. To access Troves securely from your phone over your local network:

> **Why go through this hassle instead of a Cloudflare Tunnel or external proxy?**
> Because of the "trombone effect." If you use an external tunnel, taking a photo of an item on your phone sends the image out over your internet connection to a remote datacenter, just to bounce it right back to the server sitting 5 feet away from you. It bottlenecks your fast LAN down to your internet upload speed. Furthermore, proxies like Cloudflare impose hard limits (like 100MB max uploads) and aggressive timeouts that will break large PDF uploads or bulk photo syncs. Local certs keep your traffic lightning-fast, restriction-free, and completely offline.

1. **Run the HTTPS Setup Script:**
   ```bash
   bash bin/setup-https.sh
   ```
   *(This installs `mkcert`, generates a Root CA, and hosts it temporarily on port `1025`)*
2. **Trust the CA on your Phone:**
   Open your phone's browser, navigate to `http://<YOUR_LAN_IP>:1025/rootCA.crt`, download it, and install/trust it in your device's security settings.
3. **Generate the Server Certificates:**
   Stop the script (`Ctrl+C`), then generate the application certificates in the root folder. **Replace the IP below with your server's actual LAN IP:**
   ```bash
   mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 192.168.x.x
   ```
4. **Restart the app:** (`docker restart troves-app`). 
   
The Express server will automatically detect the `.pem` files and boot securely on `https://<YOUR_LAN_IP>:3000`.

Check `/settings/admin` at any time to run a self-diagnosis on host tools, Docker microservices (RemBG, PaddleOCR, SingleFile), and API keys.

### Bring Your Own Model

Troves supports any OpenAI-compatible API (e.g., Ollama, LM Studio, vLLM, Together), alongside native Groq and Gemini integrations. Configuration is managed entirely in your `.env` file.

Set the `PROVIDER` to `openai`, `gemini`, or `groq`. If using a local model or a proxy, provide the `BASE_URL`. If left blank, it defaults to the official cloud endpoints.

**Granular Task Routing**
You are not restricted to one model per modality. You can map specific cognitive tasks to different models. For instance, you can use a fast cloud provider for summarizing webpages, but route backend JSON parsing to a local offline model to save costs.

If a specific task override is omitted, Troves automatically falls back to the base engine for that modality (`AI_TEXT_*`, `AI_VISION_*`, or `AI_AUDIO_*`).

**Available Task Overrides:**

* **Text (`AI_TEXT_[TASK]_...`):**
* `SUMMARY` (Summarizing parsed webpages and documents)
* `PARSER` (Structuring OCR data and reverse image search results)
* `TAXONOMY` (Generating new EAV schemas and categories)
* `QNA` (Ask Troves—used when answering questions *without* photo context)


* **Vision (`AI_VISION_[TASK]_...`):**
* `MULTISCAN` (Counting and bounding-box extraction for bulk collections)
* `CLASSIFY` (Standard single-item analysis)
* `GUESS` (Refining items based on user hints)
* `QNA` (Ask Troves—used when answering questions *with* photo context)


* **Audio (`AI_AUDIO_[TASK]_...`):**
* `DICTATION` (Voice search transcription)



**Example `.env` Configuration:**

```env
# --- 1. Base Engines ---
AI_VISION_PROVIDER="gemini"
AI_VISION_MODEL="gemini-3.1-flash-lite"
AI_VISION_API_KEY="your_key"

AI_TEXT_PROVIDER="gemini"
AI_TEXT_MODEL="gemini-3.1-flash-lite"
AI_TEXT_API_KEY="your_key"

AI_AUDIO_PROVIDER="groq"
AI_AUDIO_MODEL="whisper-large-v3-turbo"
AI_AUDIO_API_KEY="your_groq_key"

# --- 2. Specific Task Overrides ---

# Route long document summaries to Groq for speed
AI_TEXT_SUMMARY_PROVIDER="groq"
AI_TEXT_SUMMARY_MODEL="llama-3.3-70b-versatile"
AI_TEXT_SUMMARY_API_KEY="your_groq_key"

# Route backend JSON parsing to a local Ollama instance (no API key needed)
AI_TEXT_PARSER_PROVIDER="openai"
AI_TEXT_PARSER_MODEL="llama3"
AI_TEXT_PARSER_BASE_URL="http://localhost:11434/v1"

# Route visual Q&A to a heavier vision model
AI_VISION_QNA_PROVIDER="openai"
AI_VISION_QNA_MODEL="gpt-4o"
AI_VISION_QNA_API_KEY="your_openai_key"

```

# Latest yt-dlp
```
Do this
  P="$(which yt-dlp)" && sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O "$P" && sudo chmod a+rx "$P"

OR:
  which yt-dlp
      > make sure wget puts it here THAT_PATH
  sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O THAT_PATH/yt-dlp
  sudo chmod a+rx THAT_PATH/yt-dlp
```

# TODO / notes
- fetching interesting links (especially documentation/specs) for newly items should also be automatic

# TODO README:
- Screenshot(s), video(s)
- need to document that you can hold down "Notepad" button to add a new note without leaving current context
