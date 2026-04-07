# NextFlow

**NextFlow** is a visual **LLM and media workflow builder** for teams and individuals who want to chain prompts, uploads, image/video transforms, and AI steps **without writing glue code**. You compose a directed graph on a canvas; the app validates connections, runs nodes in topological order, and persists workflows and execution history per user.

Built with **Next.js**, **React Flow (@xyflow/react)**, **Clerk**, **Neon + Prisma**, **Trigger.dev**, **Google Gemini**, and **Transloadit**.

---

## The problem it solves

Building “LLM + file + crop + frame extract + another LLM” pipelines usually means juggling scripts, ad-hoc APIs, timeouts on serverless, and brittle inline media processing. NextFlow addresses that by:

| Pain | How NextFlow helps |
|------|---------------------|
| Hard to visualize multi-step AI + media flows | **Canvas workflow** with typed ports (text, image, video, number) and cycle detection at run time |
| Long-running or CPU-heavy work on Vercel | **Heavy work runs on Trigger.dev workers** (FFmpeg, Gemini); Next.js only orchestrates via `tasks.trigger` + polling |
| Need durable URLs for uploads and model inputs | **Transloadit** for browser uploads and task outputs; **Gemini vision** uses fetched `inlineData`, not raw URLs in prompts |
| Losing work between sessions | **Postgres persistence** of graphs + **debounced autosave**; optional **export/import JSON** |
| Who ran what, and what failed | **Workflow run history** with per-node status, timing, and error snapshots |

---

## Features

### Canvas and editing

- **Drag-and-drop style workflow graph** with **React Flow** and a **purple accent** for edges (`WORKFLOW_EDGE_COLOR`).
- **Typed connections** — outputs must match inputs where enforced (e.g. text vs image vs video); invalid wiring is rejected at connection time.
- **Undo / redo** and keyboard shortcuts (e.g. **Cmd/Ctrl+Z**, **Cmd/Ctrl+Shift+Z**); delete nodes or selected edges with **Delete / Backspace**.
- **Export workflow** to JSON and **import** from JSON for backups or sharing.
- **Cycle safety** — the executor detects cycles in the graph and errors clearly instead of infinite loops.

### Node types

| Node | Purpose |
|------|---------|
| **Text** | Static or editable text input; passed through the graph as text. |
| **Upload image / Upload video** | Client uploads via **`POST /api/transloadit/upload`**; resulting HTTPS URLs flow to downstream nodes. |
| **Run any LLM** | Calls **Google Gemini** (configurable model); supports **vision** when image URLs are wired in — images are **downloaded and sent as `inlineData`**, not as plain text URLs. Text + number inputs supported where applicable. |
| **Crop image** | **FFmpeg**-based crop in a Trigger task; output URL via Transloadit. |
| **Extract frame** | **FFmpeg** frame grab from video; supports timestamps as seconds or **percentage** (e.g. `50%`); output URL via Transloadit. |

### Execution

- **`POST /api/execute`** walks the DAG in **topological levels**, resolves upstream outputs, and runs **each node as a Trigger.dev task** (`passthrough-text-node`, `passthrough-media-url`, `run-gemini-llm`, `crop-image-ffmpeg`, `extract-frame-ffmpeg`).
- Supports **full workflow**, **partial**, or **single-node** scopes (validated with **Zod**).
- **No inline Gemini or FFmpeg inside Next.js route handlers** — keeps serverless fast and timeouts predictable; **`TRIGGER_SECRET_KEY`** must be set on the app host.

### Persistence and history

- Workflows stored in **PostgreSQL** (**Prisma** models: `Workflow`, `WorkflowRun`) with **user scoping** via **Clerk** `userId`.
- **Autosave** debounces graph changes to **`/api/workflows`** so the canvas is not lost on refresh.
- **Workflow History** panel lists runs with status, duration, and **per-node details** (inputs/outputs/errors).

### Authentication

- **Clerk** for sign-in/sign-up and **`UserButton`** in the app; API routes use **`auth()`** to restrict workflow and run data to the signed-in user.

---

## Integrations (overview)

| Service | Role in NextFlow |
|---------|-------------------|
| **Clerk** | Authentication; user identity for DB rows and API authorization. |
| **Neon** (or any Postgres) | Primary database for workflows and run records; **Prisma** as ORM; **`@prisma/adapter-neon`** for serverless-friendly access. |
| **Trigger.dev** | Background workers for **all node executions**; cloud image built with **FFmpeg** via `trigger.config.ts`; **`syncEnvVars`** can push Gemini + Transloadit secrets on deploy. |
| **Google Gemini** | LLM + vision in `run-gemini-llm` task (`GEMINI_API_KEY`, optional `GEMINI_MODEL`, optional vision size cap). |
| **Transloadit** | Assembly uploads from the browser and from tasks; **`TRANSLOADIT_AUTH_KEY`** / **`TRANSLOADIT_AUTH_SECRET`**; upload route validates with **Zod** (size/MIME). |

Detailed env and troubleshooting: **`docs/TRIGGER_ENV.md`**, **`docs/TRANSLOADIT.md`**, **`docs/VERCEL.md`**.

---

## Architecture (short)

```text
Browser (React Flow + Zustand)
    │  upload files → POST /api/transloadit/upload
    │  save graph   → POST /api/workflows
    │  run flow     → POST /api/execute
    ▼
Next.js API (Clerk + Prisma)
    │  trigger + poll Trigger.dev runs
    ▼
Trigger.dev workers (FFmpeg + Gemini + Transloadit)
```

- **Vision:** Image URLs must be **public HTTPS** (e.g. Transloadit) so the worker can fetch them for Gemini **`inlineData`**.
- **Local dev:** `npm run trigger:dev` runs tasks on your machine; install **FFmpeg** or set **`FFMPEG_PATH`** if needed (`docs/TRIGGER_ENV.md`).
- **Cloud:** `npm run trigger:deploy` publishes tasks and syncs env; app still needs **`TRIGGER_SECRET_KEY`** on Vercel.

---

## Tech stack

- **Framework:** Next.js 16, React 19, TypeScript  
- **UI:** Tailwind CSS 4, Lucide icons  
- **State:** Zustand (canvas + undo)  
- **Workflow graph:** `@xyflow/react`  
- **Validation:** Zod  
- **Media:** `ffmpeg-static` (local fallback); Trigger **Docker** layer for cloud FFmpeg  

---

## Quick start

```bash
cp .env.example .env.local
```

Fill at minimum (see `.env.example` and docs):

- **`DATABASE_URL`** — Postgres (Neon recommended for serverless)
- **Clerk** — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- **`GEMINI_API_KEY`** — Google AI Studio
- **Trigger** — `TRIGGER_PROJECT_ID` or `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`
- **Transloadit** — `TRANSLOADIT_AUTH_KEY`, `TRANSLOADIT_AUTH_SECRET`

Then:

```bash
npm install
npx prisma migrate dev
npm run dev
```

- App: **[http://localhost:3000/workflow](http://localhost:3000/workflow)** (home redirects).
- Local Trigger worker: **`npm run trigger:dev`** — requires Trigger + Gemini env; see **`docs/TRIGGER_ENV.md`**.

For **crop / extract-frame** locally, ensure **FFmpeg** is on `PATH` or set **`FFMPEG_PATH`**. **Percentage** seeks on extract-frame derive duration from **ffmpeg** stderr (cloud-friendly).

---

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |
| `npm run trigger:dev` | Local Trigger.dev worker |
| `npm run trigger:deploy` | Deploy Trigger tasks + sync env (see `trigger.config.ts`) |
| `npm run prisma:generate` | Regenerate Prisma Client |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:studio` | Prisma Studio |

---

## Deploy to production (outline)

1. Push the repo to GitHub and import in **[Vercel](https://vercel.com/new)**.
2. Set environment variables — full checklist in **`docs/VERCEL.md`** (Clerk, `DATABASE_URL`, `TRIGGER_SECRET_KEY`, Transloadit, etc.).
3. Run migrations: `DATABASE_URL="…" npx prisma migrate deploy`.
4. Deploy Trigger workers: **`npm run trigger:deploy`** so cloud tasks match `src/trigger/tasks.ts` and production has **`GEMINI_API_KEY`** (and Transloadit) on the Trigger project.
5. Use a **production** Trigger secret on Vercel, not the dev key.

Prefer Neon’s **pooled** connection string for serverless.

---

## Documentation in this repo

| Doc | Topic |
|-----|--------|
| `docs/TRIGGER_ENV.md` | Gemini on Trigger, FFmpeg, `syncEnvVars`, API ↔ Trigger |
| `docs/TRANSLOADIT.md` | Upload auth errors, assembly setup |
| `docs/VERCEL.md` | Vercel env checklist |

---

## License

ISC (see `package.json`).
