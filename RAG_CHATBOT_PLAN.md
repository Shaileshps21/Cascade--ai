# RAG Chatbot — Build Plan

> A Claude/Gemini-style chat application with retrieval-augmented generation over the user's own documents. Multi-provider, bring-your-own-API-key, streaming, with citations back to source passages.
>
> Status: **plan only — nothing built yet.** Written 2026-07-23.

---

## 0. Decisions locked in

Confirmed 2026-07-23:

| Decision | Choice |
|---|---|
| **Codebase** | **Separate repo** from LifeSaver — a fresh `rag-chat/` project. LifeSaver's code is used as a source to lift from (`secrets.js`, `Llm.js`, `sseManager.js`, `useSSE.js`, auth), but the two projects stay independent: own deps, own deploy, own roadmap. |
| **Vector store** | **Postgres + pgvector** — vectors, metadata and full-text in one database, so hybrid retrieval is a single SQL query. |
| **Chat providers** | **All four: Anthropic, Gemini, Groq, OpenAI.** Gemini and Groq lift from `Llm.js`; Anthropic and OpenAI are new adapters on the same interface. |

Lifted code is **copied, not imported** — a change in LifeSaver's `Llm.js` does not propagate here, and vice versa. That's the trade being made for independence; it's the right one given the two products have unrelated roadmaps.

---

## 1. What we're building

A chat app in the shape of claude.ai / gemini.google.com, plus a knowledge layer:

- **Chat**: threaded conversations, streaming token-by-token responses, markdown + code rendering, message editing/regeneration, conversation history in a sidebar.
- **Projects**: Claude-style persistent workspaces — each with its own document set, custom instructions, and the conversations scoped to it. See §5.5.
- **Documents**: upload PDF / DOCX / TXT / MD / CSV. Parsed, chunked, embedded, indexed.
- **Images**: paste or upload an image and ask about it. Text inside images is extracted so it becomes *searchable*, not just viewable — a photographed receipt, a screenshot of an error, a scanned page. See §3.5.
- **Audio**: upload a recording (meeting, lecture, voice note). Transcribed, then indexed like any other document, so it's searchable and citable with timestamps. See §3.5.
- **Web**: pull in live context — paste a URL to ingest it, or let the model search the web when your documents don't have the answer. See §3.6.
- **Retrieval across all of it**: one question searches documents, image text, transcripts and (optionally) the web together.
- **Citations**: every claim traceable to a numbered chip that opens the exact passage — a page in a PDF, a region of an image, a timestamp in audio, or a URL.
- **Multi-provider**: pick the model (Claude / Gemini / Groq / OpenAI), supply your own API key, encrypted at rest.
- **Dark, alive interface**: dark canvas with a cursor-reactive glow and a slow ambient gradient. See §10.

### Scope boundaries (v1 explicitly *excludes*)
Image *generation*, text-to-speech output, agentic tool-use loops, team/shared workspaces, mobile apps, fine-tuning. All are viable v2 items; none belong in the first build.

> Note on what moved: images and audio are now **in** scope (they were listed as excluded in the first draft). They are not cosmetic additions — each introduces a new provider capability requirement, covered in §3.5.

---

## 2. Architecture

```
┌──────────────────── Browser (React + Vite, dark + motion layer) ─────────────────┐
│  Projects rail  │  Chat pane (SSE stream)  │  Sources panel (page/region/time)   │
│                 │  Composer: doc · image · audio · link · model picker           │
└────────┬──────────────────────────────────────────────────────┬──────────────────┘
         │ SSE / REST                                            │ multipart
┌────────▼──────────────────────────────────────────────────────▼──────────────────┐
│                          Node + Express API server                                │
│                                                                                   │
│  /api/chat/stream ──► Retrieval Orchestrator                                      │
│        │                 1. rewrite query (history-aware)                         │
│        │                 2. embed query                                           │
│        │                 3. hybrid search: vector + keyword  [+ web, if enabled]  │
│        │                 4. rerank → top-N passages                               │
│        │                 5. build prompt: cached prefix + project instructions    │
│        │                    + passages + any native-vision attachments            │
│        │                 6. stream completion, map [n] → chunk + locator          │
│        │                                                                          │
│  /api/sources ──► Ingestion (background jobs — OCR/transcription are slow)        │
│        │            document ─► parse ──┐                                         │
│        │            image ────► OCR ────┤                                         │
│        │            audio ────► transcribe ─► normalize ─► chunk ─► embed ─► upsert│
│        │            url ──────► fetch ──┘                                         │
│        │                                                                          │
│  /api/projects ──► knowledge · custom instructions · scoped conversations         │
│                                                                                   │
│  Provider registry + capability matrix (§4.4)                                     │
│  Chat client (4 providers) · Embeddings · Transcription · OCR · Web search        │
│  Secrets (AES-256-GCM envelope)   Auth middleware (Firebase ID token)             │
└──────┬─────────────────────┬──────────────────┬───────────────────┬───────────────┘
       │                     │                  │                   │
┌──────▼───────────────┐ ┌───▼──────────┐ ┌─────▼──────┐ ┌──────────▼────────┐
│ Postgres + pgvector  │ │ Object store │ │ Redis      │ │ External providers │
│ vectors + metadata   │ │ files/images │ │ job queue  │ │ LLM · ASR · search │
│ + full-text (hybrid) │ │ + audio      │ │            │ │                    │
└──────────────────────┘ └──────────────┘ └────────────┘ └────────────────────┘
```

One thing to read off this diagram: **every input kind converges before retrieval.** A PDF page, an OCR'd screenshot region, a transcript segment and a web page all become the same `chunk` row with a different locator. That is what keeps retrieval, reranking and citation rendering as *one* pipeline instead of four parallel ones — and it's the reason adding a fifth input kind later is cheap.

---

## 3. Six constraints that decide the design

These are the places RAG projects usually go wrong. Calling them out up front.

### 3.1 Embeddings are a *separate* provider from the chat model

**Anthropic has no embeddings API. Neither does Groq.** A "Claude-powered chatbot" still needs a second provider purely for vectors. This is not optional and it is not a footnote — it drives the key management design.

So the app has **two independent provider slots**:

| Slot | Who can fill it | Notes |
|---|---|---|
| **Chat model** | Anthropic, Google Gemini, Groq, OpenAI | User picks per-conversation. |
| **Embedding model** | Google, OpenAI, or Voyage AI (Anthropic's recommended embedding partner) | Should be **pinned per corpus** — see below. |

LifeSaver already models this correctly: `server/rag/embeddings.js` uses the server's own Gemini key for embeddings regardless of the user's chat-provider choice. We keep that pattern.

> ⚠️ **Embeddings are not interchangeable.** Vectors from model X cannot be compared to vectors from model Y. Changing the embedding model means **re-embedding the entire corpus**. Therefore: store `embedding_model` + `embedding_dim` on every collection, refuse to mix, and treat a model change as an explicit re-index migration.

**Decision needed at build time:** does the *server* pay for embeddings (simpler UX, we absorb the cost), or does the user's own key pay (cheaper for us, but they must supply an embedding-capable key even when chatting with Claude)? My default: **server-paid embeddings**, user-paid chat. Cheap enough to absorb, and it keeps onboarding to one key.

### 3.2 The existing vector store will not carry this

`server/rag/vectorStore.js` today pulls the 200 most recent Firestore docs and ranks cosine similarity in JavaScript. That is correct for a handful of task-history entries. It is wrong for document RAG, where one 40-page PDF becomes 200+ chunks on its own — the `.limit(200)` would silently truncate the corpus and the linear scan would blow up latency and Firestore read costs.

**This is the single largest new-build item.** **Decision: Postgres + pgvector** — chosen because hybrid (vector + BM25) retrieval in one SQL query meaningfully beats pure vector search on real documents, and it collapses vectors, metadata and full-text into one store with no vendor lock-in.

Implementation notes:
- HNSW index on the embedding column; GIN index on the `tsvector` column.
- Managed hosting via Supabase, Neon, or RDS — all ship pgvector. Neon's free tier is enough for development.
- The cost of this choice is that index tuning (`m`, `ef_construction`, `ef_search`) is on us. Defaults are fine below ~100K vectors; revisit above that.
- Firestore stays in the picture only for auth; it is **not** the vector store. LifeSaver's `vectorStore.js` is reference material for the cosine math, not a base to extend.

### 3.3 "Citations" means two different things — we want the app-level kind

- **Anthropic's native Citations feature** (`citations: {enabled: true}`) gives character- and page-level citations, but only when you pass a document **inline** in the request. It works beautifully for "chat with this one PDF" and is **incompatible with structured outputs**. It is a *bonus path*, used when the whole document fits in context.
- **App-level chunk attribution** is the actual RAG mechanism, and it's provider-agnostic: number each retrieved passage `[1]…[N]`, instruct the model to cite inline, then map each marker back to `{document_id, chunk_id, page, char_offset}` for the UI.

We build the app-level path as primary and layer native citations in as an enhancement for small documents on Claude.

### 3.4 Prompt caching helps less than you'd hope on RAG

Prompt caching is a **prefix match** — any byte change invalidates everything after it. Retrieved passages differ on every question and sit at the *end* of the prompt, so **the retrieved context does not cache**.

What *does* cache: the system prompt, tool definitions, and any fixed persona/instructions — placed first, with the breakpoint on the last stable block. Also note the minimum cacheable prefix is model-dependent (4096 tokens on Opus 4.8 / Haiku 4.5; 2048 on Sonnet 4.6/Fable 5; 1024 on Sonnet 4.5) — a short system prompt silently won't cache at all.

The exception worth building: **"chat with this document" mode**, where one large document *is* the stable prefix across a whole conversation. There, caching cuts cost dramatically. Gemini has its own explicit context-caching API for the same pattern.

### 3.5 "Read text from an image" is two different features, and audio needs a third provider

**Images.** There are two distinct paths and we need both, because they solve different problems:

| Path | How | Good for | Limits |
|---|---|---|---|
| **Native vision** — send the image to the model | Claude, Gemini and OpenAI all accept images directly and read text in them well | "What does this error screenshot say?", "Summarise this chart" — one-off questions about an image in the conversation | The image is **not searchable**. Ask again next week and nothing retrieves it. Costs image tokens on every turn it stays in context. |
| **OCR at ingestion** — extract text, then chunk/embed/index it | An OCR pass (or a vision model used *as* an OCR step) writes text into the normal pipeline | Scanned PDFs, photographed documents, screenshots you want to find later | Loses visual layout unless we keep bounding boxes. Adds an ingestion step that can fail. |

The design: **upload an image → run OCR into the index → also keep the original for native vision.** Then a question can retrieve the image by its text content *and* hand the actual image to the model for the visual detail. That combination is what makes "read the text from images and answer questions" work both in the moment and six months later.

This also solves the scanned-PDF hole flagged in §7 — a PDF with no extractable text routes to the OCR path instead of failing.

> ⚠️ **Not every model can see.** The Groq models in §4.2 are text-only. The model picker must disable image attachment (or warn and fall back to OCR text alone) when a text-only model is selected — see the capability matrix in §4.4.

**Audio is a bigger gap: no chat model takes raw audio through the standard messages API.** Claude cannot. This needs a **third provider slot**, alongside chat and embeddings:

- **Transcription**: OpenAI Whisper, Gemini (which does handle audio natively), or a dedicated service like Deepgram. Since OpenAI is already a confirmed provider, Whisper is the low-friction default.
- Once transcribed, audio is just a document: chunk the transcript, embed it, index it. **Keep word-level timestamps** — that's what makes a citation able to say "at 14:32" and seek the player to that point.
- Speaker diarisation ("who said what") is genuinely useful for meeting recordings and is a v1-not-MVP item.

So the provider slots are now: **chat** (user's choice of four) · **embeddings** (server-paid, one model, pinned per collection) · **transcription** (server-paid) · **OCR** (server-paid, or a vision model).

### 3.6 Web retrieval: native per-provider, or one app-level provider

Two mechanisms, and they behave differently:

- **Native server-side web search.** Anthropic ships a `web_search` server tool (and a `web_fetch` tool that retrieves URLs already in the conversation); Gemini has Search grounding; OpenAI has its own. These run on the provider's infrastructure, return provider-supplied citations, and are excellent — but each has a different API shape, and **Groq has none**.
- **App-level search.** One search API (Tavily, Brave, Exa, SerpAPI) called by our server, results injected as retrieved passages exactly like document chunks. Uniform across all four providers, uniform citation handling, one integration.

**Recommendation: app-level as the baseline, native as an enhancement.** App-level means web results flow through the same retrieval → rerank → cite pipeline as everything else, so a single answer can cite a PDF, a transcript and a web page with consistent chips. Native search is then an opt-in "deep research" mode on Claude and Gemini where the quality is worth the divergent code path.

**URL ingestion is separate and simpler**: paste a link → fetch → extract readable content (Mozilla Readability) → treat as a document. That belongs in the ingestion pipeline, not the search path.

> ⚠️ Web content is **untrusted input**. A fetched page can contain text engineered to look like instructions. Retrieved web content must be clearly delimited in the prompt and treated as data — never as instructions to follow. This is a real attack surface once the app browses on the user's behalf.

---

## 4. Models and pricing

### 4.1 Chat models — Anthropic (verified current)

| Model | Model ID | Context | Input $/1M | Output $/1M | Use for |
|---|---|---|---|---|---|
| Claude Opus 4.8 | `claude-opus-4-8` | 1M | $5.00 | $25.00 | Hardest reasoning, long documents |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $3.00 *(intro $2.00 through 2026-08-31)* | $15.00 *(intro $10.00)* | Default chat model |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1.00 | $5.00 | Query rewriting, title generation, cheap classification |

Notes that affect our code:
- Use `thinking: {type: "adaptive"}` for anything complex; `budget_tokens` is removed and returns 400.
- `temperature` / `top_p` / `top_k` are **removed** on Opus 4.8 and Sonnet 5 — steer with prompting only.
- Assistant-turn prefills return 400. Use `output_config.format` for structured output.
- Effort knob: `output_config: {effort: "low"|"medium"|"high"|"xhigh"|"max"}`. Default `high`; drop to `low` for the cheap sub-tasks.
- Cache reads cost ~0.1×; cache writes ~1.25× (5-min TTL) or 2× (1-hour TTL).

### 4.2 Chat models — other providers

Groq (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`) and Gemini (`gemini-2.5-pro` / `-flash` / `-flash-lite`) are already wired in LifeSaver's `server/config/Llm.js`, including per-model token ceilings, retry/backoff, cross-provider fallback and cost capture. That file is a direct lift.

> ⚠️ Groq's free-tier **tokens-per-minute** caps are far below the models' context windows, and RAG prompts are large (retrieved passages add thousands of tokens). Groq is a poor fit for the RAG path specifically; keep it available for the cheap sub-tasks. LifeSaver's own code comments already document 413 "request too large" failures from this exact cause.
>
> The model picker should reflect this: mark Groq models as "fast, small context" and warn (or auto-reduce retrieved-passage count) when one is selected for a document-grounded conversation. Silently 413-ing on the user's question is the worst outcome.

**All four providers are in scope.** `Llm.js` already covers Gemini and Groq; **Anthropic and OpenAI are new adapters** written against the same `generateText(prompt, opts) → EnrichedResult` interface, so downstream code stays provider-agnostic. Anthropic's adapter carries the extra rules in §4.1 (no `temperature`, adaptive thinking, `effort`); OpenAI's is a straightforward addition and doubles as an embedding option.

### 4.3 Embedding models

I am deliberately **not** hardcoding embedding model IDs or prices here. The repo's current `embedding-001` is already an outdated Gemini ID, which is exactly the failure mode to avoid. Candidates to evaluate — I'll pull exact IDs, dimensions and prices from each provider's live docs at build time:

- **Voyage AI** — Anthropic's recommended embedding partner; strongest quality for Claude-based RAG, and has domain-tuned variants (code, finance, law).
- **Google Gemini embeddings** — already integrated, server key already present, cheapest path to a working prototype.
- **OpenAI embeddings** — well-understood, good price/performance, widely benchmarked.

**Recommendation:** ship v1 on Gemini embeddings (zero new integration work, key already in `.env`), and benchmark Voyage against it on your actual documents before committing the corpus.

### 4.4 Provider capability matrix

Not every provider does everything, and the UI has to know that. This table drives the model picker: selecting a model **enables or disables** the attachment buttons rather than letting the user attach something that will fail at request time.

| Capability | Anthropic | Gemini | OpenAI | Groq |
|---|---|---|---|---|
| Text chat | ✅ | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ | ✅ |
| **Image input (vision)** | ✅ | ✅ | ✅ | ❌ *(models in §4.2)* |
| **Audio input** | ❌ | ✅ *(native)* | ❌ *(use Whisper separately)* | ❌ |
| **Embeddings** | ❌ | ✅ | ✅ | ❌ |
| **Transcription** | ❌ | ✅ | ✅ *(Whisper)* | ❌ |
| **Native web search** | ✅ | ✅ | ✅ | ❌ |
| Prompt caching | ✅ | ✅ *(explicit API)* | ✅ | — |
| Large context for RAG | ✅ 1M | ✅ 1M | ✅ | ⚠️ **TPM-capped** |

Exact model IDs, dimensions and prices for the non-Anthropic rows get pulled from live provider docs at build time — see §4.3 for why I'm not writing them down now.

**Two things this table forces into the design:**
1. A `capabilities` descriptor per model in the provider registry, read by the client. Hardcoding "Groq can't see images" into a React component is how this rots.
2. **Graceful degradation, not hard blocking.** Attach an image while on Groq and the app should still work — send the OCR'd text instead of the image and tell the user plainly: *"Groq can't view images; using extracted text only. Switch to Claude or Gemini to have it look at the picture."*

---

## 5. Feature list

### MVP — the thing that has to work end to end
1. Google sign-in (Firebase Auth, already built in LifeSaver).
2. BYO API key entry + validation, encrypted at rest.
3. Model picker driven by the capability matrix (§4.4).
4. New chat / thread list / rename / delete.
5. Streaming responses over SSE with a stop button.
6. Markdown rendering: headings, lists, tables, syntax-highlighted code with copy button.
7. Document upload (PDF, DOCX, TXT, MD) with live ingestion progress.
8. **Image upload** — native vision on capable models, OCR into the index on all of them.
9. RAG answers with numbered inline citations.
10. Sources panel — click a citation, see the passage and jump to its place in the source.
11. **Projects** — create a project, attach documents, set custom instructions, start chats inside it (§5.5).
12. Per-message token + cost display.
13. Dark theme with the cursor-reactive background (§10).

### v1 — makes it feel finished
14. **Audio upload** → transcription → indexed with timestamps; citations seek an inline player.
15. **Web search** as a retrieval source, blended into the same citation pipeline.
16. **URL ingestion** — paste a link, it becomes a document.
17. Hybrid retrieval (vector + keyword) with reranking.
18. History-aware query rewriting (so "what about the second one?" retrieves correctly).
19. Regenerate response, edit-and-resend, branch a conversation.
20. Conversation and project search.
21. Auto-generated conversation titles (cheap model).
22. "Chat with this document" mode using prompt caching / native citations.
23. Export conversation to Markdown or PDF.
24. Command palette (`Cmd/Ctrl+K`) and keyboard shortcuts.
25. Rate limiting and per-user usage quotas.

### v2 — later
Image generation, text-to-speech replies, speaker diarisation on transcripts, shared/team projects, MCP or custom tool calling, scheduled/recurring queries, side-by-side model comparison, a retrieval evaluation harness.

### 5.5 Projects — the Claude-style workspace

A project is a **persistent container** that bundles knowledge, instructions and conversations. It is the organising unit of the app, and it maps almost exactly onto the `collections` concept already in the data model — so this is a rename and an extension, not a new subsystem.

**A project owns:**

| | Detail |
|---|---|
| **Knowledge** | Its own set of documents, images, transcripts and saved URLs. Every conversation started inside the project retrieves from this set by default. |
| **Custom instructions** | A project-level system prompt — *"You are helping me write a thesis on X. Prefer formal tone. Always cite page numbers."* Prepended to every conversation in the project. |
| **Conversations** | All chats started in the project, listed within it rather than in the global sidebar. |
| **Default model** | A project can pin a preferred model, overridable per conversation. |
| **Embedding model** | Fixed at creation and immutable (§3.1). Changing it means a new project or an explicit re-index. |

**Operations:** create, rename, set/edit instructions, add/remove knowledge, list conversations, duplicate (config only, or config + knowledge), archive, delete (with an explicit warning that it takes the indexed vectors with it), and a knowledge-usage indicator showing how much of the project is being retrieved.

**Two deliberate differences from Claude's version:**
1. **Cross-project search** — a global "search everything" mode that retrieves across all projects, with results labelled by origin. Useful when you can't remember where you put something.
2. **Per-project retrieval tuning** — chunk size, top-K, and whether web search is allowed. A project of legal contracts and a project of code notes want different settings, and burying that in a global config is a mistake.

A chat started **outside** any project uses a personal default collection, so the app is usable without ever creating one. Projects should be a place to organise, not a wall to climb before the first message.

---

## 6. Data model

Assuming Postgres + pgvector (adapt names for Firestore if we go that way):

```
users(id, email, display_name, created_at)

api_keys(id, user_id, provider, ciphertext, key_hint, is_valid,
         last_validated_at, created_at)
    -- ciphertext = v1.<iv>.<tag>.<data>, AES-256-GCM. Never returned to client.

projects(id, user_id, name, description, custom_instructions,
         default_provider, default_model, embedding_model, embedding_dim,
         retrieval_config, allow_web_search, is_default, archived_at, created_at)
    -- embedding_model immutable after creation (§3.1)
    -- retrieval_config: per-project chunk size / top-K / rerank settings (§5.5)
    -- is_default: the implicit personal project for chats started outside one

sources(id, project_id, user_id, kind, title, mime_type, size_bytes,
        storage_path, origin_url, page_count, duration_seconds,
        status, error, created_at)
    -- kind: document | image | audio | web_page
    -- one table, not four: retrieval treats them identically and the UI
    --   only branches on `kind` for rendering. duration_seconds is audio-only,
    --   page_count document-only, origin_url web/URL-ingest only.
    -- status: uploading | parsing | transcribing | ocr | chunking |
    --         embedding | ready | failed

chunks(id, source_id, project_id, ordinal, text, token_count,
       page_number, char_start, char_end, section_heading,
       bbox, start_ms, end_ms,
       embedding vector(N), tsv tsvector)
    -- HNSW index on embedding; GIN index on tsv for hybrid search
    -- bbox: [x,y,w,h] of the OCR'd region, so an image citation can highlight
    --   the exact spot rather than the whole picture
    -- start_ms/end_ms: transcript timestamps, so an audio citation can seek

conversations(id, user_id, project_id, title, provider, model,
              system_prompt_override, created_at, updated_at)
    -- effective system prompt = project.custom_instructions + this override

messages(id, conversation_id, role, content, parent_message_id,
         input_tokens, output_tokens, cached_tokens, cost_usd,
         provider, model, created_at)
    -- parent_message_id enables branching

message_attachments(id, message_id, source_id, kind, storage_path,
                    sent_as, created_at)
    -- images/audio attached to a single turn rather than the project corpus
    -- sent_as: native_vision | ocr_text | transcript
    --   records what the model actually received, which matters when the
    --   user later asks "why didn't it see the picture?" (§4.4 degradation)

message_citations(id, message_id, marker_index, chunk_id, source_id,
                  quoted_text, locator)
    -- the [1]…[N] → source mapping the UI renders
    -- locator: rendering hint resolved from the chunk —
    --   {page: 4} | {bbox: [...]} | {t: 872} | {url: "..."}
```

**Isolation rule:** every retrieval query filters on `user_id` **and** `project_id` at the SQL layer, not in application code. This is enforced once, in the query builder, and covered by an explicit test — cross-user retrieval leakage is the one bug in this app that is genuinely dangerous (§9).

---

## 7. Ingestion pipeline

Four input kinds, one converging pipeline. Everything becomes text + a locator, then follows the identical path:

```
                     ┌─ PDF/DOCX/TXT/MD/CSV ─► parse ──────────────┐
                     │      └─ no text found? ─► OCR ──────────────┤
  upload ─► store ───┼─ image ─► OCR (+ keep original for vision) ─┼─► normalize
                     │                                             │      │
                     ├─ audio ─► transcribe (+ timestamps) ────────┤      ▼
                     └─ URL ──► fetch ─► Readability extract ──────┘   chunk
                                                                          │
                                              ready ◄─ upsert ◄─ embed ◄──┘
```

- **Parse (documents)**: `pdf-parse` or `unpdf` for PDF, `mammoth` for DOCX, plain read for TXT/MD, `papaparse` for CSV. Preserve page numbers and heading structure — citations depend on them.
- **OCR (images, and text-free PDFs)**: extract text **with bounding boxes**, so a citation can highlight the region rather than the whole image. Two options — Tesseract (free, self-hosted, weaker on messy input) or a vision model used as an OCR step (better quality on photos and handwriting, costs tokens). Recommendation: **vision-model OCR as the default** given three of four providers already support vision, with Tesseract as a no-cost fallback. The original image is always retained for native vision (§3.5).
- **Transcribe (audio)**: Whisper via OpenAI, or Gemini. **Keep word-level timestamps** — without them an audio citation can only say "somewhere in this 90-minute recording", which is useless. Chunk on natural pauses and speaker turns where available, not on a fixed token count.
- **Fetch (URLs)**: retrieve, strip nav/ads/boilerplate with Mozilla Readability, keep the canonical URL and fetch date. Respect `robots.txt`. Treat the result as untrusted data (§3.6).
- **Chunk**: recursive structure-aware splitting (headings → paragraphs → sentences). Target ~500–800 tokens with ~15% overlap. Never split a table or code block mid-way.
- **Embed**: batch requests (embedding APIs charge per token but rate-limit per request). Retry with backoff. Persist partial progress so a failure resumes rather than restarts.
- **Status streaming**: the client watches ingestion progress over the same SSE channel used for chat — LifeSaver's `sseManager.js` handles this already. With OCR and transcription in the mix the pipeline is now slow enough that per-stage progress isn't a nicety; a 40-minute recording needs a visible "transcribing… 60%".
- **Guards**: file size and duration caps, page cap, per-user storage quota, MIME sniffing (never trust the extension), and — now handled rather than merely flagged — the scanned-PDF case routes to OCR instead of indexing nothing.

**Do the slow work off the request thread.** Transcription and OCR take minutes, not milliseconds. Ingestion runs as a background job with a persisted state machine (the `status` column in §6), so a dropped connection or a server restart resumes rather than losing the upload. This is a change in shape from a simple document pipeline and is worth building correctly in Phase 2 rather than retrofitting.

---

## 8. Retrieval and answer generation

Per user turn:

1. **Query rewrite** — feed the last few turns to a cheap model (Haiku 4.5 at `effort: "low"`) to resolve pronouns and produce a standalone search query. Skip when the message is already self-contained.
2. **Hybrid search** — vector top-K (K≈40) ∪ BM25 top-K, scoped to the project, fused with Reciprocal Rank Fusion. Documents, image OCR text and transcripts are all in the same index, so one query covers all of them. If the project allows web search *and* local confidence is low, a web pass runs in parallel and joins the same candidate pool.
3. **Rerank** — cross-encoder or LLM-based rerank down to top-N (N≈6–8). This is the highest-leverage quality knob in the whole system.
4. **Assemble prompt**:
   - Stable prefix (cacheable): system prompt, citation instructions, project custom instructions.
   - Volatile suffix: numbered passages with source metadata, then conversation history, then the question.
   - Plus any **native-vision attachments** for this turn, if the selected model can see (§4.4). Images the user attached *this turn* go in as images; images retrieved from the corpus go in as their OCR text.
5. **Generate** with streaming. Instruct: *cite with `[n]` markers; if the passages don't answer the question, say so rather than guessing.*
6. **Post-process** — parse `[n]` markers, map to `chunk_id` + a kind-specific locator (page / bbox / timestamp / URL), persist to `message_citations`, ship to the UI as clickable chips.

**Grounding guard**: if the top reranked score is below a threshold, don't pretend. Either answer from general knowledge with an explicit "not found in your sources" banner, or run a web pass and say that's what happened. Silent hallucination over an empty retrieval is the failure mode users never forgive.

**Mixed-source answers need visible provenance.** Once an answer can draw on a PDF, a screenshot, a recording and a live web page at once, "where did this come from?" stops being obvious. Each citation chip carries its kind as an icon, and the sources panel groups by kind — so a user can tell at a glance that a claim came from the web rather than from their own vetted documents. That distinction matters more than it sounds.

---

## 9. Security and API-key handling

Lift `server/config/secrets.js` verbatim — it's already the right design:

- AES-256-GCM envelope encryption, format `v1.<iv>.<authTag>.<ciphertext>`, version-tagged so an algorithm change is a migration rather than a break.
- Key material from `SECRETS_KEY` (32 bytes hex/base64), falling back to HKDF-SHA256 over `FIREBASE_PRIVATE_KEY` so encryption is on by default rather than an opt-in nobody enables.
- Plaintext keys **never** leave the server, never appear in logs, never go to the client. The UI shows only a hint like `sk-ant-…4f2a`.

Additional requirements:
- Validate a key on save with a minimal probe call before storing it.
- Per-user row-level isolation on every query — a user must never retrieve another user's chunks. This is the one bug in a RAG app that is genuinely dangerous.
- Rate limits per user and per IP; upload size and MIME validation.
- Never put secrets in prompts or message history — they'd be persisted and replayed.

**New attack surface introduced by web and file ingestion:**
- **Untrusted retrieved content.** Web pages, PDFs and images can contain text crafted to read as instructions. All retrieved passages go into the prompt inside explicit delimiters, labelled as data. The system prompt states that retrieved content is reference material and never a source of instructions.
- **SSRF on URL ingestion.** A user-supplied URL must not be able to make our server fetch `169.254.169.254`, `localhost`, or anything on the private network. Resolve the hostname and reject private/link-local ranges *before* fetching, and again after redirects.
- **Malicious uploads.** Sniff MIME from content rather than trusting the extension; cap size, page count and audio duration; never execute or shell out with user-supplied filenames.

---

## 10. Interface and motion design

Dark by default, with a background that reacts to the cursor — alive without being distracting.

### 10.1 The look

- **Dark canvas**, near-black rather than pure black (`#0A0A0B`–`#111113`), with elevation carried by subtle surface lightening rather than heavy borders.
- **Ambient gradient**: two or three large, slow-drifting radial gradient blobs in low-saturation accent colours, heavily blurred, animating over 20–40 second cycles. Barely perceptible frame to frame; clearly alive if you look away and back.
- **Cursor glow**: a soft radial highlight that follows the pointer, brightening the surface beneath it. This is the "antigravity" effect — the page feels lit by the cursor rather than uniformly lit.
- **Optional particle field**: a sparse field of points that drift, subtly repelled by the pointer. Best kept as a toggle, not a default — it is the piece most likely to feel gimmicky in a tool people use for hours.

### 10.2 How to build it (and how *not* to)

**The cursor glow should be CSS, not canvas.** A `mousemove` handler writes two CSS custom properties, and a `radial-gradient` reads them:

```js
// throttled to rAF — one write per frame, never per event
el.style.setProperty('--mx', `${x}px`);
el.style.setProperty('--my', `${y}px`);
```
```css
.glow-layer {
  background: radial-gradient(600px circle at var(--mx) var(--my),
              rgba(120,140,255,0.10), transparent 70%);
}
```

This is close to free — the compositor does the work, there is no JS running per frame, and it cannot janks the chat stream. Reaching for a full canvas/WebGL particle system for a background glow is the classic overbuild here, and it competes for main-thread time with token streaming and markdown re-rendering, which is exactly where jank is most visible.

The ambient gradient is pure CSS keyframe animation on `transform` and `opacity` — GPU-composited, no layout, no paint.

Only the optional particle field justifies a `<canvas>`. If it ships: cap the point count, drive it with `requestAnimationFrame`, and **pause it entirely when the tab is hidden** (`visibilitychange`) so it doesn't drain battery in a background tab.

### 10.3 Non-negotiables

| Rule | Why |
|---|---|
| Respect `prefers-reduced-motion` | Motion sensitivity is real. Reduced motion → static gradient, no cursor glow, no particles. Not a smaller animation; none. |
| `pointer-events: none` on every decorative layer | Otherwise the effect eats clicks and text selection. This is the single most common bug in cursor-effect implementations. |
| Effects sit **behind** content, never over it | A glow on top of text hurts contrast and readability. |
| Text contrast meets WCAG AA against the *darkest* point of the gradient | The background moves; the contrast floor must hold everywhere it goes. |
| Disable on touch devices | There is no cursor. The `mousemove` listener is pure overhead. |
| A settings toggle to turn it all off | Some people will hate it. Cheap to offer, and it doubles as the escape hatch on low-end hardware. |
| Never animate `width`/`height`/`top`/`left` | Layout thrash. `transform` and `opacity` only. |

### 10.4 Layout

Three panes, familiar from Claude and Gemini so nobody needs to learn it:

- **Left rail**: projects list → conversations within the selected project. Collapsible.
- **Centre**: the conversation. Streaming messages, attachment tray (document / image / audio / link), model picker in the composer showing live capability state (§4.4).
- **Right panel**: sources for the current answer — collapsed by default, opens when a citation chip is clicked, and renders per source kind: PDF page preview, image with the OCR region highlighted, transcript with a seek-to-timestamp player, or a web page card.

---

## 11. What we reuse vs. what's new

| Component | Source | Effort |
|---|---|---|
| API-key encryption at rest | `server/config/secrets.js` | **Copy as-is** |
| Multi-provider LLM client, retries, fallback, cost capture | `server/config/Llm.js` | **Copy**, add Anthropic + OpenAI providers |
| SSE streaming manager | `server/rag/sseManager.js` | **Copy**, extend for token deltas |
| Client SSE hook | `client/src/hooks/useSSE.js` | **Copy** |
| Firebase auth + middleware | `server/middleware/auth.js`, `client/src/context/AuthContext.jsx` | **Copy** |
| Cosine similarity helper | `server/rag/embeddings.js` | **Copy** the math, replace the model ID |
| API-key setup UI | `client/src/components/ApiKeySetup.jsx` | **Adapt** |
| Vector store | `server/rag/vectorStore.js` | **Rewrite** — Firestore scan → pgvector |
| Document parsing + chunking | — | **New** |
| **Image OCR + bounding boxes** | — | **New** |
| **Audio transcription + timestamps** | — | **New** |
| **Web search + URL ingestion** | — | **New** |
| Hybrid retrieval + reranking | — | **New** |
| Citation extraction and mapping (multi-kind locators) | — | **New** |
| **Projects: knowledge, instructions, scoping** | — | **New** |
| Chat UI (threads, streaming, markdown, sources panel) | — | **New** |
| **Dark theme + cursor-reactive motion layer** | — | **New** |
| Conversation persistence + branching | — | **New** |

Originally ~40/60 lifted-to-new. With multimodal, web and projects added, it's closer to **25% lifted, 75% new** — the scope grew, the reusable base didn't. The lifted quarter is still the fiddly security and provider-plumbing work, which remains the part most worth not rewriting.

---

## 12. Stack and dependencies

**Server** (Node 18+, Express, ESM — same as LifeSaver)
```
@anthropic-ai/sdk        Claude          (new adapter)
@google/generative-ai    Gemini chat + embeddings  (lift from Llm.js)
groq-sdk                 Groq            (lift from Llm.js)
openai                   OpenAI chat + embeddings  (new adapter)
pg + pgvector            vector + metadata store
pdf-parse / unpdf        PDF text extraction
mammoth                  DOCX
papaparse                CSV
sharp                    image normalize/resize before OCR and vision
tesseract.js             OCR fallback (vision-model OCR is the default — §7)
fluent-ffmpeg            audio transcode/segment before transcription
@mozilla/readability     URL content extraction
+ jsdom
undici                   URL fetch with SSRF-safe DNS checks
multer                   uploads
bullmq + redis           background ingestion jobs (OCR/transcription are slow — §7)
firebase-admin           auth (already present)
express-rate-limit       throttling
zod                      request validation
```
> Token counting: use each provider's own `count_tokens` endpoint. **Do not use `tiktoken` for Claude** — it's OpenAI's tokenizer and undercounts Claude by 15–20%.

**Client** (React 18 + Vite + Tailwind — same as LifeSaver)
```
react-markdown + remark-gfm    markdown
shiki or highlight.js          code highlighting
katex                          math (optional)
react-router-dom               routing (already present)
firebase                       auth (already present)
react-dropzone                 uploads (documents, images, audio)
react-pdf                      PDF page preview in the sources panel
wavesurfer.js                  audio player with seek-to-citation
cmdk                           command palette
framer-motion                  panel/message transitions (NOT the background — §10.2)
```
> The background motion layer is **hand-written CSS + one rAF-throttled listener**, not a library. See §10.2 for why.

**Infra**
```
Postgres 15+ with pgvector   (Supabase / Neon / RDS)
Redis                        (job queue)
Object storage               (Firebase Storage or S3) — raw files, images, audio
Render / Fly.io / Railway    server hosting (render.yaml already exists as a template)
```

---

## 13. Build order

| Phase | Deliverable | Depends on |
|---|---|---|
| **0. Foundations** | New `rag-chat/` repo scaffolded, Postgres + pgvector up, auth working, keys encrypted, all four provider adapters behind one capability-aware interface, `/health` green | — (unblocked) |
| **1. Plain chat + shell** | Streaming chat, model picker, threads, markdown, **dark theme and motion layer**. No RAG yet. | 0 |
| **2. Projects** | Create/rename/archive, custom instructions, conversations scoped to a project | 1 |
| **3. Document ingestion** | Upload → parse → chunk → embed → index, background jobs, live progress | 0 |
| **4. Retrieval** | Vector search wired into chat; answers grounded in project knowledge | 1, 2, 3 |
| **5. Citations** | Numbered markers → clickable chips → sources panel with passage highlight | 4 |
| **6. Images** | Native vision on capable models + OCR into the index with bounding boxes; image citations highlight the region | 3, 5 |
| **7. Audio** | Transcription with timestamps, indexed; citations seek an inline player | 3, 5 |
| **8. Web** | URL ingestion + web search as a retrieval source, same citation pipeline | 4, 5 |
| **9. Quality** | Hybrid search, reranking, query rewriting, grounding guard | 4 |
| **10. Polish** | Regenerate/edit/branch, cost display, export, command palette, cross-project search | 5, 9 |
| **11. Hardening** | Rate limits, isolation tests, SSRF guards, error states, retrieval eval set | all |

Each phase is independently demoable. **Phase 1 alone is a usable multi-provider chat app with the finished look** — worth reaching early, because it's the fastest way to find out whether the interface feels right before there's much built on top of it.

Phases 6, 7 and 8 are deliberately parallel and independent: each adds one input kind to a pipeline that already works. If time gets tight, they can ship in any order or be deferred without blocking anything else.

---

## 14. Open items

**Resolved** — separate repo, pgvector, all four providers. See §0.

**Answered by the latest round:** dark theme with cursor-reactive motion (§10), images with OCR (§3.5), audio (§3.5), web retrieval (§3.6), and Projects (§5.5) are all in. Scanned PDFs now route to OCR rather than failing.

**Needed before Phase 0 finishes** (none of these block starting the scaffold):
1. **API keys for development** — Anthropic and OpenAI at minimum; Gemini and Groq keys already exist in LifeSaver's `.env`. OpenAI now does double duty: chat *and* Whisper transcription.
2. **A Postgres connection string**, or approval to spin up a free Neon/Supabase instance. Plus Redis for the job queue (Upstash free tier is fine).
3. **Who pays for embeddings, OCR and transcription** — server-paid (my recommendation) or charged to the user's key. This matters more now than it did: transcription is priced per minute of audio and is the one cost that can run away on a large upload.
4. **Rough scale** — hundreds of documents, or hundreds of thousands? Changes index tuning, not architecture.
5. **Caps** — max file size, max audio duration, per-user storage quota. I'll propose defaults (100 MB / 2 hours / 5 GB) unless you have numbers in mind.

**Nice to know:**
6. Any accent colour preference for the ambient gradient, or shall I pick something and show you?
7. Personal tool, or something other people will use? Determines how much of §9 (isolation, rate limits, SSRF guards, quotas) matters on day one versus later.

---

## 15. Known risks

| Risk | Mitigation |
|---|---|
| Retrieval quality disappoints; answers miss obvious facts | Reranking is the biggest lever. Build a small eval set of question→expected-passage pairs in Phase 4 and measure, don't eyeball. |
| Embedding model change forces full re-index | Pin the model per project from day one; treat a change as an explicit migration. |
| Groq TPM limits reject RAG-sized prompts | Route RAG through Claude/Gemini; keep Groq for cheap sub-tasks. Already documented in LifeSaver's own code. |
| Prompt-caching savings don't materialize | Expected on the RAG path (§3.4). Only promise caching benefits for the single-document mode. |
| Cross-user data leak via retrieval | Enforce `user_id` + `project_id` at the query layer, not the application layer. Explicit test. |
| Cost surprise on large corpora | Ingestion cost is one-time and predictable; show an estimate before embedding. Per-query cost is dominated by retrieved-context tokens — cap N. |
| **Transcription cost runs away** | Priced per minute. Show a cost estimate before transcribing, enforce a duration cap, and make long uploads an explicit confirm rather than a silent charge. |
| **OCR quality is poor on messy input** | Photos, handwriting and low-res scans degrade badly. Surface an extraction-confidence signal and let the user see the OCR text before it's indexed, rather than silently indexing garbage that then poisons retrieval. |
| **Prompt injection via web or document content** | Retrieved content is delimited and labelled as data; the system prompt states it is never a source of instructions (§3.6, §9). Realistically this mitigates rather than eliminates — worth revisiting if the app ever gains write-capable tools. |
| **Background motion hurts performance during streaming** | CSS-only glow, no per-frame JS, `prefers-reduced-motion` respected, tab-hidden pause, and a settings toggle (§10.3). Measure frame timing while streaming before shipping. |
| **The multimodal scope balloons the build** | Phases 6–8 are independent and deferrable by design (§13). The app is fully useful after Phase 5. |

---

## Appendix — provider gotchas worth remembering

- **No embeddings from Anthropic or Groq.** Always a second provider.
- **No audio input on Anthropic.** Transcribe first; there is no way around this.
- **No vision on the Groq models in §4.2.** Degrade to OCR text, don't hard-block.
- **Claude:** no `temperature`, no `budget_tokens`, no assistant prefill on current models. Adaptive thinking + `effort` instead.
- **Claude native citations** are incompatible with structured outputs (`output_config.format`) — 400.
- **Claude web search / web fetch** are server-side tools with dated type strings that change between model generations — read the current value at build time rather than from memory.
- **Streaming is mandatory** above ~16K `max_tokens`, or the SDK hits an HTTP timeout.
- **Don't use `tiktoken` for Claude token counts** — it's OpenAI's tokenizer and undercounts by 15–20%. Use the `count_tokens` endpoint.
- **Prompt cache is model-scoped** — switching models mid-conversation invalidates it entirely.
- **Images cost tokens every turn they stay in context.** A pasted screenshot that lingers in a 40-turn conversation is billed 40 times. Drop images out of history after the turn that used them, keeping the OCR text.
- **Vector dimensions differ per embedding model** — the pgvector column type is fixed at `vector(N)`. Changing models means a new table or a migration, not a config edit.
