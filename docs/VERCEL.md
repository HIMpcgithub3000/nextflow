# Deploy NextFlow to Vercel (Prisma · Neon · Trigger.dev · Transloadit)

## 1. Prerequisites

- GitHub repo connected (e.g. `HIMpcgithub3000/nextflow`).
- Accounts: [Vercel](https://vercel.com), [Neon](https://neon.tech), [Clerk](https://clerk.com), [Trigger.dev](https://cloud.trigger.dev), [Transloadit](https://transloadit.com), Google AI Studio (Gemini key).

## 2. Neon (PostgreSQL)

1. Create a project in [Neon Console](https://console.neon.tech).
2. Copy the **pooled** connection string (recommended for serverless — includes `-pooler` in the host).
3. Append `?sslmode=require` if not already present.

Apply migrations **once** against production (from your machine, with prod URL):

```bash
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

Or use Neon’s SQL editor after generating SQL from migrations — `prisma migrate deploy` is the standard approach.

## 3. Vercel project

1. [Vercel Dashboard](https://vercel.com) → **Add New…** → **Project** → import the GitHub repo.
2. **Framework Preset:** Next.js (auto).
3. **Build Command:** default (`npm run build` — runs `prisma generate && next build`).
4. **Install Command:** default (`npm install` — runs `postinstall` → `prisma generate`).

### Environment variables (Settings → Environment Variables)

Add for **Production** (and Preview if you want PR previews to work):

| Name | Notes |
|------|--------|
| `DATABASE_URL` | Neon pooled Postgres URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk |
| `CLERK_SECRET_KEY` | Clerk |
| `TRIGGER_SECRET_KEY` | Trigger.dev **Production** secret (starts with `tr_prod_…` or your project’s prod key — not `tr_dev_` for production) |
| `TRIGGER_PROJECT_ID` or `TRIGGER_PROJECT_REF` | Same as local, e.g. `proj_xxx` |
| `GEMINI_API_KEY` | Optional on Vercel if you **only** run LLM on Trigger workers — but safe to set if you use it anywhere in Next.js |
| `TRANSLOADIT_AUTH_KEY` | Transloadit |
| `TRANSLOADIT_AUTH_SECRET` | Transloadit |

**Trigger.dev:** LLM/crop/frame run on **Trigger workers**. Sync secrets to Trigger after code changes:

```bash
npm run trigger:deploy
```

Ensure `trigger.config.ts` `syncEnvVars` includes `GEMINI_API_KEY`, Transloadit keys, etc., so **production** workers have the same secrets as in your local `.env` used at deploy time.

## 4. Clerk

1. Clerk Dashboard → **Domains** (or **Paths**): add your Vercel URL, e.g. `https://your-app.vercel.app`.
2. Add the same under **Allowed redirect URLs** / **Authorized parties** as required by Clerk for your version.

## 5. After first deploy

1. Open the Vercel URL → `/workflow` → sign in → confirm DB workflows load (needs `DATABASE_URL` + migrations applied).
2. Run a small workflow → confirms Trigger + Gemini (on worker) + Transloadit as configured.

## 6. Optional: Vercel + Neon integration

In Vercel → **Storage** / **Integrations**, you can connect **Neon** so `DATABASE_URL` is injected automatically. You still run `prisma migrate deploy` when you add migrations.

## Troubleshooting

| Issue | Check |
|--------|--------|
| Build fails “Prisma Client not generated” | `postinstall` / `build` runs `prisma generate`; ensure `prisma/schema.prisma` is in the repo. |
| Prisma errors at runtime | `DATABASE_URL` correct; Neon project running; IP allowlist (Neon usually allows all). |
| `POST /api/execute` fails | `TRIGGER_SECRET_KEY` matches **production** Trigger project; workers deployed (`trigger:deploy`). |
| Transloadit upload fails | Keys in Vercel; Transloadit template/billing OK. |
