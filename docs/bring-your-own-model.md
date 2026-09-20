## Bring Your Own Model

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
* `QNA` (Ask Troves, used when answering questions *without* photo context)


* **Vision (`AI_VISION_[TASK]_...`):**
* `MULTISCAN` (Counting and bounding-box extraction for bulk collections)
* `CLASSIFY` (Standard single-item analysis)
* `GUESS` (Refining items based on user hints)
* `QNA` (Ask Troves, used when answering questions *with* photo context)


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