# TinyAgent Design

Describe a page and an agent builds it as one HTML file, live. Sign in with your
radian.sh account and get a free design (the number is a server setting).

TinyAgent Design shows what the [TinyAgent SDK](https://github.com/superuserkalo/tinyagent)
can do in a web page: the whole agent loop runs in your browser tab, each chat is a
durable TinyAgent session journaled on the server with your account (so it follows you
to every device), and only the model call goes through our server, which pays for it.

## How it works

```
browser tab                                        server (Vercel functions)
-----------                                        -------------------------
Session + Agent (tiny-agent-sdk/browser)
  journal  -> ServerStorage  -- /api/chats/:id/records -->  D1: fenced append, paged load
  tool     -> publish_design  -- PUT /api/designs/:executionId -->  D1 (idempotent)
  lease    -- POST /api/chats/:id/lease -->  one tab runs a chat; others watch
  provider -> ChatCompletionsProvider  -- POST /api/model/v1/chat/completions -->  checks the radian.sh session
              (baseUrl /api/model/v1,         + x-tinyagent-grant                  and the prompt grant, forces
               no key in the page)                                                 model, instructions, tools and
                                                                                   max_tokens, streams Vercel AI
                                                                                   Gateway's SSE back unbuffered
send a prompt  -- POST /api/prompts -->  spends a free prompt (Cloudflare D1), returns a grant
pill           -- GET /api/me       -->  signed-in user and prompts left
preview        <iframe sandbox="allow-scripts" src="/preview-frame">  (opaque origin, its own CSP)
```

- **The agent** (`lib/agent.ts`): instructions for distinctive, polished single-file
  pages, and `createDesignAgent`. The model route sends these same instructions, so a
  page cannot replace them.
- **The tool** (`lib/tools.ts`): `publish_design({ title, html })`. Idempotent: it
  stores the page under the SDK's `executionId`, so a call that is run again after a
  reload overwrites the same version instead of adding one.
- **Chats on the server**: every chat is a TinyAgent `Session` over `ServerStorage`
  (`lib/client/server-storage.ts`), the SDK's four-method `Storage` on top of
  authenticated API routes backed by D1 (`lib/server/sessions.ts`). Every route checks
  the radian.sh session and that the chat belongs to that user. An append is one SQL
  statement that writes record `expected + 1` only if the journal holds exactly
  `expected` records and no other tab holds the chat's lease, so two devices can never
  both write a step: the loser gets the SDK's `FencedError`. Records over 450 KB (a
  prompt with five images) are stored in parts. It passes the SDK's `checkStorage`.
- **One runner, many watchers**: a tab takes the chat's lease (20 s, renewed every 7 s)
  before it runs a prompt. Another tab or device that opens the chat follows the
  journal by polling and shows "running on another device" with the composer locked;
  it never resumes a run another tab holds. A reloaded tab keeps its lease owner id in
  `sessionStorage`, so it resumes its own interrupted run at once; elsewhere a run
  continues only after the lease lapses.
- **Resume**: finished steps are never redone (the SDK journals them; see
  `tests/sdk-resume.test.ts`). Only the interrupted step runs again: its partial text
  stays visible, marked as cut off, a "resumed" line marks the point, and the timer keeps
  counting from the run's start. The run's prompt grant is kept with the chat, so a
  resume is not charged again.
- **Images**: up to five per prompt (paperclip, paste or drop), downscaled in the browser
  to at most 1568 px and about 260 KB, sent as the SDK's image parts. Each model request
  drops the HTML of earlier versions and, past a budget, older images, so long chats stay
  under Vercel's 4.5 MB request limit (`lib/request-budget.ts`).
- **Free prompts**: `FREE_PROMPTS` per radian.sh account (default 1), counted on the
  server in Cloudflare D1. Accounts that already have a count keep it.
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
  credential ever reaches the browser. The model route accepts only the exact request
  shape the SDK sends (`lib/server/request-shape.ts`): text and image parts, this site's
  tool, no routing or cost fields; everything else is refused.

## Files

| Path | What it holds |
| --- | --- |
| `lib/agent.ts` | The operating rules and the agent |
| `lib/design/brief.ts` | The design brief and the self-review before each publish |
| `lib/tools.ts` | `publish_design` |
| `lib/storage.ts` | An in-memory SDK `Storage`, for the tests |
| `lib/transcript.ts` | The chat, rebuilt from the journal |
| `lib/client/runtime.ts` | Sessions in the tab: send, resume, stop, live events |
| `lib/client/server-storage.ts` | The SDK `Storage` over this site's API |
| `lib/client/images.ts` | Downscaling attached images |
| `lib/client/hanko.ts` | radian.sh sign-in (adapted from radian.sh) |
| `lib/client/scripted.ts` | Development only: the scripted model |
| `lib/server/model-route.ts` | The metered model proxy |
| `lib/server/request-shape.ts`, `lib/server/images.ts` | What the model route accepts |
| `lib/server/quota.ts`, `lib/server/store.ts` | Free prompts and grants |
| `lib/server/sessions.ts` | Chats, journal, designs and leases in D1 |
| `lib/server/db.ts` | D1 in production, a local SQLite file in development |
| `migrations/` | The D1 schema (`0001_init.sql`, `0002_sessions.sql`) |
| `app/preview-frame/route.ts` | The sandboxed document a design runs in |
| `proxy.ts` | The CSP |
| `vendor/tiny-agent-sdk` | The SDK's built output (`npm run sync-sdk`) |

## Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_HANKO_API_URL` | all | radian.sh's Hanko API, `https://auth.radian.sh` |
| `HANKO_SERVER_API_URL` | optional | Validate sessions against another Hanko API (tests only) |
| `AI_GATEWAY_MODEL` | optional | Default `anthropic/claude-sonnet-5.5`; the composer shows it |
| `FREE_PROMPTS` | optional | Free prompts a new account gets. Default 1 |
| `AI_GATEWAY_API_KEY` | optional | Leave unset on Vercel to use the project's OIDC token |
| `VERCEL_OIDC_TOKEN` | local | Written by `vercel env pull`; on Vercel it comes with each request |
| `CLOUDFLARE_ACCOUNT_ID` | production | Cloudflare account that holds the D1 database |
| `CLOUDFLARE_D1_DATABASE_ID` | production | The D1 database's id |
| `CLOUDFLARE_D1_TOKEN` | production | API token with only Account → D1 → Edit |
| `APP_ORIGINS` | optional | Extra origins allowed to call `/api`, comma separated |
| `TINYAGENT_DEV_DB` | development | `d1` makes `next dev` use the configured D1 instead of the local SQLite file |

`next dev` uses a local SQLite file (in the OS temp directory) with the same migrations
and SQL as D1, so development never writes to the production database. A production
deployment without the three `CLOUDFLARE_*` variables answers 503 instead of giving
prompts away.

## Local development

Node 22.18 or later.

```sh
npm install
cp .env.example .env.local      # NEXT_PUBLIC_HANKO_API_URL is enough to start
npm run dev                     # http://localhost:3000
npm test                        # quota, sessions, model route, images, storage (the D1 SQL on node:sqlite)
npm run typecheck && npm run build
```

Real model calls need a gateway credential: `vercel link` then `vercel env pull
.env.local` (writes `VERCEL_OIDC_TOKEN`), or set `AI_GATEWAY_API_KEY`. Signing in from
`http://localhost:3000` needs that origin allowed in the Hanko project.

**Development users**: in `next dev` only, `?as=alice` acts as a local user named alice
without signing in (the server honours the header only in development).

**Scripted mode** (development only): `http://localhost:3000/?scripted=1&as=alice` runs
a scripted model through the real UI, with no gateway. Add `&slowtool=1` to slow it
down (each model turn and `publish_design` wait four seconds), then reload the tab
mid-run to watch it resume, or open the same chat in a second browser profile to watch
it from "another device". The console has `__tinyagent.checkStorage()`, which runs the
SDK's `checkStorage` on the server-backed storage (use a separate `?as=` user: it
leaves two chats behind).

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
   npx wrangler d1 execute tinyagent-design --remote --file migrations/0002_sessions.sql
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

MIT, Copyright (c) 2026 Radian Labs. See [LICENSE](LICENSE). The vendored TinyAgent
SDK is MIT licensed (`vendor/tiny-agent-sdk/LICENSE`).
