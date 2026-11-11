# TinyAgent Design

Describe a page and an agent builds it as one HTML file, live. Sign in with your
radian.sh account and get 3 free designs.

TinyAgent Design shows what the [TinyAgent SDK](https://github.com/superuserkalo/tinyagent)
can do in a web page: the whole agent loop runs in your browser tab, each chat is a
durable TinyAgent session journaled in IndexedDB, and only the model call goes through
our server, which pays for it.

## How it works

```
browser tab                                        server (Vercel functions)
-----------                                        -------------------------
Session + Agent (tiny-agent-sdk/browser)
  journal  -> IndexedDB (lib/storage.ts, lib/client/idb.ts)
  tool     -> publish_design stores the page (lib/tools.ts)
  provider -> ChatCompletionsProvider  -- POST /api/model/v1/chat/completions -->  checks the radian.sh session
              (baseUrl /api/model/v1,         + x-tinyagent-grant                  and the prompt grant, forces
               no key in the page)                                                 model, instructions, tools and
                                                                                   max_tokens, streams Vercel AI
                                                                                   Gateway's SSE back unbuffered
send a prompt  -- POST /api/prompts -->  spends 1 of 3 free prompts (Cloudflare D1), returns a grant
pill           -- GET /api/me       -->  signed-in user and prompts left
preview        <iframe sandbox="allow-scripts" src="/preview-frame">  (opaque origin, its own CSP)
```

- **The agent** (`lib/agent.ts`): instructions for distinctive, polished single-file
  pages, and `createDesignAgent`. The model route sends these same instructions, so a
  page cannot replace them.
- **The tool** (`lib/tools.ts`): `publish_design({ title, html })`. Idempotent: it
  stores the page under the SDK's `executionId`, so a call that is run again after a
  reload overwrites the same version instead of adding one.
- **Durability**: every chat is a TinyAgent `Session` over an IndexedDB implementation
  of the SDK's four-method `Storage` (it passes the SDK's `checkStorage`). On load, a
  run that a reload cut short is resumed automatically. The run's prompt grant is
  stored with the chat, so a resume is not charged again.
- **Free prompts**: 3 per radian.sh account, counted on the server in Cloudflare D1.
  `POST /api/prompts` spends one and returns a grant (valid 20 minutes, at most 40
  model requests). The model route refuses requests without a live grant. Spending a
  prompt and creating its grant is one SQL statement (an `INSERT ... SELECT ... WHERE
  remaining > 0` plus a trigger that decrements), so it is atomic.
- **Accounts**: the same Hanko project as radian.sh. Signing in is an email code (or
  the account's password) in a modal; new emails get a radian.sh account. The server
  validates the `hanko` session cookie with Hanko on every request that spends
  something.
- **Security**: generated pages run only in `<iframe sandbox="allow-scripts">` without
  `allow-same-origin`, loaded from `/preview-frame` (its own CSP: inline scripts and
  styles, no network except Google Fonts). The app has a nonce-based CSP; `'unsafe-eval'`
  is allowed for scripts because the SDK's Ajv compiles tool schemas to functions.
  `/api` routes check `Origin`, `/api/prompts` is rate limited per user, and no
  credential ever reaches the browser.

## Files

| Path | What it holds |
| --- | --- |
| `lib/agent.ts` | The instructions and the agent |
| `lib/tools.ts` | `publish_design` |
| `lib/storage.ts` | The SDK `Storage` over a small backend interface |
| `lib/transcript.ts` | The chat, rebuilt from the journal |
| `lib/client/runtime.ts` | Sessions in the tab: send, resume, stop, live events |
| `lib/client/idb.ts` | IndexedDB: journal, designs, chats |
| `lib/client/hanko.ts` | radian.sh sign-in (adapted from radian.sh) |
| `lib/client/scripted.ts` | Development only: the scripted model |
| `lib/server/model-route.ts` | The metered model proxy |
| `lib/server/quota.ts`, `lib/server/store.ts` | Free prompts and grants (D1 or memory) |
| `migrations/0001_init.sql` | The D1 schema |
| `app/preview-frame/route.ts` | The sandboxed document a design runs in |
| `proxy.ts` | The CSP |
| `vendor/tiny-agent-sdk` | The SDK's built output (`npm run sync-sdk`) |

## Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_HANKO_API_URL` | all | radian.sh's Hanko API, `https://auth.radian.sh` |
| `HANKO_SERVER_API_URL` | optional | Validate sessions against another Hanko API (tests only) |
| `AI_GATEWAY_MODEL` | optional | Default `anthropic/claude-haiku-5.5` |
| `AI_GATEWAY_API_KEY` | optional | Leave unset on Vercel to use the project's OIDC token |
| `VERCEL_OIDC_TOKEN` | local | Written by `vercel env pull`; on Vercel it comes with each request |
| `CLOUDFLARE_ACCOUNT_ID` | production | Cloudflare account that holds the D1 database |
| `CLOUDFLARE_D1_DATABASE_ID` | production | The D1 database's id |
| `CLOUDFLARE_D1_TOKEN` | production | API token with only Account → D1 → Edit |
| `APP_ORIGINS` | optional | Extra origins allowed to call `/api`, comma separated |

Without the three `CLOUDFLARE_*` variables, `next dev` keeps prompt counts in memory
(it says so in the log); a production deployment answers 503 instead of giving prompts
away.

## Local development

Node 22.18 or later.

```sh
npm install
cp .env.example .env.local      # NEXT_PUBLIC_HANKO_API_URL is enough to start
npm run dev                     # http://localhost:3000
npm test                        # quota (memory and the real SQL on node:sqlite), model route, storage
npm run typecheck && npm run build
```

Real model calls need a gateway credential: `vercel link` then `vercel env pull
.env.local` (writes `VERCEL_OIDC_TOKEN`), or set `AI_GATEWAY_API_KEY`. Signing in from
`http://localhost:3000` needs that origin allowed in the Hanko project.

**Scripted mode** (development only): `http://localhost:3000/?scripted=1` runs a
scripted model through the real UI, with no sign-in and no gateway. Add `&slowtool=1`
to make `publish_design` wait four seconds after storing the page, then reload the tab
in that window to watch the run resume and the design stay stored once. The browser
console has `__tinyagent.checkStorage()` (runs the SDK's `checkStorage` on IndexedDB).

**The SDK** is vendored, because it is not on npm yet. After rebuilding it:

```sh
(cd ~/tinyagent/tinyagents/typescript && npm run build)
npm run sync-sdk                # copies dist/, package.json and LICENSE into vendor/tiny-agent-sdk
npm install
```

## Deploy (Vercel)

1. Create a Vercel project from this repository and link it (`vercel link`). Framework
   Next.js, Node 22 or later.
2. **Cloudflare D1.** Create the database in the EU jurisdiction (or with location hint
   `weur`) and apply the schema:
   ```sh
   npx wrangler d1 create tinyagent-design --jurisdiction eu      # or: --location weur
   npx wrangler d1 execute tinyagent-design --remote --file migrations/0001_init.sql
   ```
   Create an API token (Cloudflare dashboard → My Profile → API Tokens → Custom token)
   with only **Account → D1 → Edit** for this account. Set `CLOUDFLARE_ACCOUNT_ID`,
   `CLOUDFLARE_D1_DATABASE_ID` and `CLOUDFLARE_D1_TOKEN` in the Vercel project
   (Production and Preview).
3. Set `NEXT_PUBLIC_HANKO_API_URL=https://auth.radian.sh`.
4. **Hanko**: allow the site's origins in the radian.sh Hanko project (Settings →
   CORS / allowed origins): `https://tinyagent.radian.sh`, and `http://localhost:3000`
   for local sign-in, plus any preview domains you want to sign in on.
5. **AI Gateway**: nothing to set. Deployed functions authenticate with the project's
   OIDC token. Make sure the team has AI Gateway credits. Optionally set
   `AI_GATEWAY_MODEL`.
6. Add the domain `tinyagent.radian.sh` to the project and deploy.

## License

MIT, Copyright (c) 2026 Radian Labs. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The vendored TinyAgent SDK is MIT
licensed (`vendor/tiny-agent-sdk/LICENSE`).
