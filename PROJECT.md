# PROJECT.md — Handshake by Radost IT

Plan for the PayPal AI Hackathon entry, from empty repo to submitted project and a production app kept online through judging.
Tick boxes as steps are completed. Manual (human) steps are in `INSTRUCTIONS.md` and referenced here as **[I-x]**.

## Key dates (2026)

| Date | Event |
|---|---|
| Oct 1 | Submissions open |
| Nov 8 | Our feature freeze |
| Nov 12, 2:00 pm PT | Submission deadline; the submission (including the repo) is frozen after this |
| Nov 13 – Dec 15, 8:00 am PT | Judging; the app must stay free and unrestricted for judges |
| ~Dec 21 | Winners announced; keep the app online until then |

## Prize targets

- Best Use of Agentic Commerce, or a Grand Prize
- Sponsor prizes: Channel3 (one award), APIMatic (three awards; we use its Context Plugin), and AG Grid (five awards; we use AG Grid Community and AG Charts Community). Select all three on Devpost.
- AG Grid judges look at visual polish (theming, layout) and technical use. Their page favors AG Studio, but it is only a 45-day trial and would expire before judging ends, so we use the free Community editions only.
- A project can win at most one Grand or Honorable Mention prize plus one Sponsor prize.

## Judging criteria

Stage one is pass/fail: reasonable fit with the theme and proper use of the PayPal APIs. Stage two scores five equally weighted criteria:

| Criterion | What judges ask | Where we answer it |
|---|---|---|
| Technological Implementation | Thorough, skilled, non-trivial use of PayPal and AI | Escrow via authorize/capture/void/reauthorize, Payouts, webhooks; README API mapping table |
| Design | A complete, coherent product, not a proof of concept | Look and feel section; Phase 5 screens and states |
| Potential Impact | A credible, specific case for a real problem and a real audience | The named target audience (Phase 0), shown in the first 20 seconds of the video |
| Innovation/Idea | Creative, novel, different from existing concepts | Arena mode: exploits become paid bounties and regression tests |
| Presentation | Video shows it working end to end; problem, audience, and why it matters are clear | Demo video outline below |

## Rules that shape the build

- Judges must be able to use a working build free of charge and without restriction until judging ends. Cost guards must never lock judges out.
- The README must give everything needed to test. The hosted URL is the test path, so judges need only sandbox logins, never our API keys.
- After the deadline the submission cannot change. Tag the submitted commit and stop pushing to `main`.
- The video must not show third-party trademarks or copyrighted material without permission.
- All materials in English.

## Product

### Deal mode

1. The user gives the buyer agent a goal, a budget, and a mandate (max price, blocked categories, human-approval threshold).
2. The buyer agent searches Channel3, shows product cards, and opens negotiations with seller agents.
3. Seller agents are simulated merchants seeded from Channel3 products, each with a private floor price and a persona.
4. Negotiation streams live to the UI, capped at a configurable number of turns.
5. On agreement, both agents sign a deal contract: item, price, delivery deadline, and checkable acceptance criteria.
6. The human approves, and the buyer approves the PayPal order in the sandbox checkout.
7. The payment is authorized, not captured. This is the escrow.
8. The seller submits delivery evidence.
9. The verifier agent checks each acceptance criterion and proposes capture, void, or escalate.
10. The policy engine checks the proposal; the settlement engine captures or voids through PayPal.
11. Authorizations nearing expiry are reauthorized automatically.

### Arena mode

1. A visitor picks a deal template and plays the malicious seller: listing text, messages, and evidence.
2. The agents run the deal; the arena judge agent decides whether the exploit succeeded.
3. Success means a sandbox bounty via PayPal Payouts, a leaderboard entry, and a new regression case in `evals/regressions/`.
4. Failure means the defense score goes up, and the blocked action and reason are shown.

### Attack catalog (initial)

Prompt injection in a listing, fake urgency, price bait-and-switch after agreement, swapped-item evidence, partial delivery claimed as complete, impersonating the platform, currency confusion, and split-payment tricks.

### Arena gamification

The goal is to make visitors try a second and a third time. Every attempt makes the agents harder to fool, so play feeds the product. The arena must suit any age, so the UI calls players **challengers** and a successful attack a **loophole found**. Code and docs keep the technical terms (attack, breach).

Scoring, XP, ranks and badges are pure functions in `packages/arena`, unit tested and computed on the server. They never decide money. The bounty amount comes from the deterministic score and goes through policy and settlement like any other payout, to the arena recipient sandbox account ([I-12]).

**Mechanics**

- **Handle, no account.** A visitor picks a handle and gets a random session token in an HTTP-only cookie. No email, no login. The handle passes a length, charset and blocklist check.
- **XP.** Every attempt earns XP: 10 for a held attempt, 100 for a loophole, plus a bonus for severity and novelty. Near-duplicates of a known loophole earn the held amount only.
- **Ranks** from XP: Newcomer, Explorer, Investigator, Puzzle Solver, Codebreaker, Master Tester. The rank shows next to the handle and on the leaderboard.
- **Badges**, unlocked from thresholds and computed from the challenger's stats on every read, so changing a threshold needs no migration:

| Badge | Unlocked when |
|---|---|
| Eureka | First loophole found |
| Trailblazer | First challenger ever to find a loophole in a category |
| Map Maker | Tried all eight attack categories |
| Wordsmith | Found a loophole through listing or message text |
| Sharp Eye | Found a loophole through delivery evidence |
| Never Give Up | Ten held attempts in a row |
| Shield Builder | Your loophole became a regression test that now holds |
| Daily Regular | Played the daily challenge on five different days |

- **Open bounties.** Each attack category shows whether anyone has found a loophole in it yet. Untouched categories pay a higher sandbox bounty, which points players at the least tested defenses.
- **Daily challenge.** One deal template a day, chosen by a pure function of the date (`pickDailyChallenge(date, templates)`), so it needs no scheduler. It has its own leaderboard.
- **Defense counter.** A live, global counter: "Agents held 412 of 430 attempts". It is the same number as the defense win rate chart, so play and the product story stay one number.
- **Hall of fame.** Each regression case in `evals/regressions/` credits the handle that found it. The case page shows the original attempt, the fix, and the rerun that now holds.
- **Share image.** Every loophole and badge gets a share image from `next/og` (built into Next.js, no new dependency) and an Open Graph link to the attempt replay.

**Code layout**

```
packages/arena/src
  catalog.ts          attack categories and deal templates
  scoring.ts          severity, novelty, bounty tier (scoreAttempt)
  progression.ts      xpForAttempt, rankForXp, progress to next rank
  badges.ts           badge definitions, unlockedBadges(stats), newlyUnlocked(before, after)
  daily-challenge.ts  pickDailyChallenge(date, templates)
  handle.ts           validateHandle (length, charset, blocklist)
packages/core/src/policy.ts       adds checkBountyProposal: amount cap, daily bounty budget, sandbox recipient only
packages/store                    ChallengerRepository, LeaderboardRepository, ArenaStatsRepository (DynamoDB and in-memory)
services/api                      arena handlers listed below
services/workflows                ArenaRun task handlers
apps/web/app/arena                /arena, /arena/leaderboard, /arena/hall-of-fame, /arena/me,
                                  /arena/attempts/[id] with opengraph-image.tsx
```

**Flow of one attempt**

1. `POST /arena/attempts` checks the session cookie, input limits and per-IP rate limit, stores the attempt and starts the `ArenaRun` state machine.
2. `ArenaRun` runs the deal with the challenger's text as the seller, then the arena judge agent returns a structured verdict.
3. `recordArenaResult` scores the attempt and writes everything in one DynamoDB `TransactWriteItems`: attempt result, challenger stats (with an optimistic `version` check), the leaderboard entry (delete old score item, put new), the daily leaderboard entry, category stats, and global and daily stats.
4. For a loophole, `ArenaRun` builds a bounty proposal. Policy checks it, settlement pays it through Payouts, and the regression generator writes the case.
5. The WebSocket pushes `arena.result` (verdict, policy reason), `challenger.progress` (XP gained, rank change, new badges) and `arena.stats` (defense counter) to connected clients.

**Read endpoints:** `POST /arena/challengers` (create handle, set cookie), `GET /arena/challengers/me`, `GET /arena/leaderboard?scope=all|daily`, `GET /arena/categories`, `GET /arena/stats`, `GET /arena/hall-of-fame`, `GET /arena/attempts/{id}`.

## Look and feel

Design is one of five equal criteria, and judges see the app before they read code. The bar is the same as radost-it-forge: dark first, one strong accent, ambient light, motion with a purpose. Every effect must show something true about the deal (money held, money moved, attack blocked), never decoration alone.

**Design tokens** (`apps/web/app/globals.css`, Tailwind v4 `@theme`):

- Dark first, light mode supported. Near-black background, slightly blue-grey cards, 7% white borders, large radius.
- One accent for actions (teal), and one "heat" gradient (pink to orange) used once per screen for the hero element. Arena screens swap to the heat gradient as their accent, so the visitor feels the switch to challenger mode.
- Semantic state colors, each paired with an icon and a label so color is never the only signal: escrow held (amber), settled (green), refused or voided (red), escalated (violet).
- Two ambient radial gradients fixed behind the page (the "aura"), frosted-glass navbar on scroll.
- Fonts via `next/font/google`: Outfit for text and headings, a monospaced font for money, IDs and `debug_id` values. Money always uses tabular figures.
- AG Grid and AG Charts read the same tokens through their theming API, so tables and charts look native in both modes.

**Motion:** `motion` (`motion/react`) for entrances, layout changes and state transitions. CSS transforms and opacity only. Respect `prefers-reduced-motion` everywhere. One confetti library (`canvas-confetti`, small, ISC license) for breaches and settled deals only.

**Signature moments.** Each one maps to a step in the demo video.

| Screen | Moment | Driven by |
|---|---|---|
| Landing | Hero replays the latest real settled deal: two agent avatars trade offers, the price converges, a handshake, the escrow lock closes and opens | Latest `SETTLED` deal from the API, not hardcoded data |
| Landing | Live counters roll up: money in escrow now, deals settled, attacks blocked | API aggregates |
| Deal room | Negotiation as a split chat with a price track that converges toward agreement (AG Charts line) | WebSocket messages |
| Deal room | Contract card fills in field by field, then both signatures stamp in | `AGREED` event |
| Escrow timeline | Vertical state-machine stepper. The vault locks on authorize, opens on capture, and the coin returns to the buyer on void. A countdown ring shows time to authorization expiry; it refills on reauthorization | Deal events |
| Verification | Acceptance criteria tick one by one with evidence thumbnails and a confidence bar per criterion | Verifier output |
| Arena | Result reveal: a shield slams down with the blocked action and policy reason, or a "breach" banner with confetti, the bounty receipt and XP gained | Arena judge result |
| Leaderboard | Top-3 podium above the AG Grid table, rank badges, the live defense counter | Leaderboard and score data |

Budget: no screen ships more than one ambient animation, and the Lighthouse performance score on the landing page stays at 90 or above.

## Architecture (AWS serverless)

| Concern | Choice |
|---|---|
| Frontend | Next.js App Router + Tailwind, AG Grid Community (tables), AG Charts Community (charts). Built with OpenNext and deployed by the `cdk-nextjs-standalone` construct: CloudFront, S3 for static assets, Lambda for server rendering |
| REST API | API Gateway HTTP API + Lambda (Node 20+, TypeScript) |
| Live updates | API Gateway WebSocket API |
| Deal lifecycle | Step Functions Standard, `waitForTaskToken` for human approval and evidence |
| Events | EventBridge custom bus, fed by PayPal webhooks |
| Timers | EventBridge Scheduler (reauthorization, negotiation timeouts) |
| Data | DynamoDB single table, on-demand |
| Config and secrets | SSM Parameter Store (SecureString for secrets) |
| AI | Amazon Bedrock (Converse API, tool use, JSON output) |
| Infrastructure | AWS CDK (TypeScript) |
| Hosting outside AWS | None |

Cost guards: API Gateway throttling, Lambda reserved concurrency on public endpoints, per-IP and daily LLM token budgets stored in DynamoDB, AWS Budgets alarms.

### Repository layout

```
apps/web                 Next.js app (App Router)
services/api             REST Lambda handlers
services/ws              WebSocket Lambda handlers
services/workflows       Step Functions task handlers
services/webhooks        PayPal webhook ingest and event handlers
packages/config          loads and validates config from SSM or process env
packages/core            domain model, deal state machine, policy engine, money (pure, no I/O)
packages/paypal          PayPal client wrapper (orders, authorizations, payouts, webhook verification)
packages/settlement      the only caller of PayPal money endpoints
packages/channel3        Channel3 client wrapper and cache
packages/agents          buyer, seller, verifier, arena judge; prompts; tool schemas
packages/arena           attack catalog, scoring, regression generator
packages/store           repository interfaces, DynamoDB and in-memory implementations
infra                    AWS CDK app
evals                    agent evals and regression cases
scripts                  seeding, probes, demo reset
docs                     architecture diagram, demo script, submission drafts
```

### Deal states

```
DRAFT → NEGOTIATING → AGREED → AWAITING_HUMAN_APPROVAL → AUTHORIZING → IN_ESCROW
                       AGREED → AUTHORIZING                (price below the approval threshold)
IN_ESCROW → AWAITING_DELIVERY → VERIFYING → CAPTURING → SETTLED
                                          → VOIDING   → REFUSED
                                          → ESCALATED → CAPTURING | VOIDING
AWAITING_DELIVERY → VOIDING     (delivery deadline passed)
CAPTURING → ESCALATED           (capture denied)
NEGOTIATING → ABANDONED        AWAITING_HUMAN_APPROVAL | AUTHORIZING → CANCELLED
```

Terminal states: `SETTLED`, `REFUSED`, `CANCELLED`, `ABANDONED`. Every transition writes an immutable deal event. Reauthorization is not a state: it writes an `AUTHORIZATION_RENEWED` event while the deal holds funds (`IN_ESCROW`, `AWAITING_DELIVERY`, `VERIFYING`, `ESCALATED`).

### DynamoDB keys

| Entity | PK | SK |
|---|---|---|
| Deal | `DEAL#<id>` | `META` |
| Deal event | `DEAL#<id>` | `EVT#<ts>#<seq>` |
| Negotiation message | `DEAL#<id>` | `MSG#<ts>#<seq>` |
| Deal access (buyer token) | `DEAL#<id>` | `ACCESS#<sha256(token)>` |
| Seller | `SELLER#<id>` | `META` (GSI1: `SELLERS` / `<id>`) |
| Arena attempt | `ATTEMPT#<id>` | `META` (GSI1: `CHALLENGER#<id>` / `ATTEMPT#<ts>#<id>`) |
| Challenger (handle, XP, stats, version) | `CHALLENGER#<id>` | `META` |
| Challenger session | `SESSION#<sha256(token)>` | `META` (TTL) |
| Handle reservation | `HANDLE#<lowercase handle>` | `META` |
| Leaderboard | `LEADERBOARD` | `SCORE#<padded>#<challengerId>` |
| Daily leaderboard | `DAILY#<yyyy-mm-dd>` | `SCORE#<padded>#<challengerId>` |
| Category stats (attempts, loopholes, first finder) | `CATEGORY#<category>` | `META` |
| Global stats (attempts, held) | `STATS` | `GLOBAL` |
| Daily stats (for the win rate chart) | `STATS` | `DAY#<yyyy-mm-dd>` |
| Hall of fame | `HALL_OF_FAME` | `CASE#<ts>#<attemptId>` |
| Bounty ledger (reserved or paid, per UTC day) | `BOUNTIES#<yyyy-mm-dd>` | `ATTEMPT#<attemptId>` |
| Channel3 cache | `C3#<queryHash>` | `RESULT` (TTL) |
| WebSocket connection | `WS#<connectionId>` | `META` (TTL) |
| Idempotency | `IDEMP#<key>` | `META` (TTL) |
| Token budget | `BUDGET#<yyyy-mm-dd>` | `TOKENS` |

The table gains one global secondary index, `GSI1` (`gsi1pk`, `gsi1sk`), for a challenger's attempt history and the list of seeded sellers. Everything else is a direct key lookup or a query on one partition. The session token is random and never stored in plain text; the public challenger ID is a separate random ID, so leaderboard keys reveal nothing that grants access. Badges are not stored; they are computed from the challenger's stats.

### SSM parameters (stage = `prod`)

```
/handshake/<stage>/paypal/client-id
/handshake/<stage>/paypal/client-secret         SecureString
/handshake/<stage>/paypal/base-url              https://api-m.sandbox.paypal.com
/handshake/<stage>/paypal/webhook-id
/handshake/<stage>/paypal/honor-period-hours    hours, 72 (PayPal docs; the probe confirms reauthorizing earlier fails)
/handshake/<stage>/channel3/api-key             SecureString
/handshake/<stage>/bedrock/region
/handshake/<stage>/bedrock/model-fast           inference profile or model ID
/handshake/<stage>/bedrock/model-smart          inference profile or model ID
/handshake/<stage>/limits/daily-token-budget
/handshake/<stage>/limits/negotiation-max-turns
/handshake/<stage>/limits/max-bounty              decimal string, e.g. 5.00
/handshake/<stage>/limits/daily-bounty-budget     decimal string
/handshake/<stage>/arena/recipient-email          arena recipient sandbox account
/handshake/<stage>/arena/deal-source              templates (default) or sellers
```

## Phase plan

Deploys are manual for now: the human runs `pnpm cdk:deploy`. Claude Code writes and synthesizes the stacks but does not deploy them.

### Phase 0 — Accounts and access (Oct 2–5)

- [x] Human completes **[I-1] to [I-9]**.
- [x] Decide the AWS region: `eu-west-1` (Ireland). Anthropic models there run through EU cross-region inference profiles (`eu.` prefix): `eu.anthropic.claude-sonnet-4-6` (fast) and `eu.anthropic.claude-opus-4-6-v1` (smart), see [I-8].
- [x] Confirm the name "Handshake by Radost IT" and the repo slug `radost-it-handshake`.
- [x] Name one specific target audience and the problem it has today. It drives the README, the video opening, and the Devpost text.
  - **Audience:** teams building AI shopping agents.
  - **Problem:** their users will not let the agent pay, because one fake listing or injected message could cost them money. Today the options are a card with no limits or a human in every step.
  - **Our answer:** escrow plus a policy check, so the agent can pay and the money moves only when the deal checks out. Their end users are the people protected.

### Phase 1 — Skeleton (Oct 3–9)

- [x] Human completes **[I-10]** (SSM parameters, CDK bootstrap).
- [x] pnpm monorepo with the layout above, TypeScript strict, ESLint, Vitest, Prettier.
- [x] `packages/config`: load from `.env` locally or from SSM by stage on AWS; keep `.env.example` in sync; zod validation; fail-fast errors naming missing keys only.
- [x] CDK app defines an empty `Handshake-prod` stack (`pnpm cdk:synth` passes): DynamoDB table, HTTP API with a health route, Next.js placeholder page on CloudFront. Keep generated resource names under the `Handshake-` prefix, because the policies in `infra/iam/` are scoped to it. In `cdk.json`, set `"toolkitStackName": "Handshake-CDKToolkit"` and the context key `"@aws-cdk/core:bootstrapQualifier": "handshake"` to match the bootstrap in [I-10].
- [x] Custom domains: the web app on `handshake.radostit.com` and the HTTP API on `api-handshake.radostit.com`. Names stay one level below `radostit.com` so the `*.radostit.com` certificates cover them. Certificate ARNs and the hosted zone ID come from SSM; CDK creates the Route 53 alias records ([I-10]).
- [x] Human deploys the stack manually with `pnpm cdk:deploy`.
- [x] `scripts/probes/paypal-auth.ts`: get a sandbox access token and print success or failure, never the token.
- [ ] `scripts/probes/channel3-search.ts`: one product search, printing titles and prices.
- [ ] `scripts/probes/bedrock-hello.ts`: one Converse call per configured model.
- [x] Logo from **[I-10b]** in the navbar, favicon and Open Graph image. Design tokens, fonts, aura background, glass navbar and an app shell with dark and light mode, as described in Look and feel. Every later screen builds on them, so polish is not left to Phase 5.

Done when the three probes pass against real services and `pnpm cdk:deploy` creates the stack.

### Phase 2 — Escrow core (Oct 10–18)

- [x] `packages/core`: money helpers, deal contract schema, deal state machine, policy engine; full unit tests.
- [x] `packages/paypal`: create order (`intent=AUTHORIZE`), authorize, capture, void, reauthorize, get order; idempotency keys; typed errors with `debug_id`. Use the APIMatic Context Plugin for every SDK call.
- [x] Probe and document real sandbox authorization limits (honor period, reauthorization window, void and capture behavior). Put the values in SSM, not code. Results are in `CHALLENGES.md`.
- [x] `packages/settlement`: executes approved proposals only.
- [x] Step Functions `DealLifecycle` covering authorize → wait for evidence → capture or void, plus the reauthorization timer.
- [x] Webhook endpoint `POST /webhooks/paypal`: verify the signature with PayPal's API, deduplicate by event ID, publish to EventBridge. The stack prints a `WebhookUrl` output (`https://<api domain>/webhooks/paypal`) for [I-11], and a stack test fails if the output is missing.
- [ ] Human completes **[I-11]** (webhook registration) after the first deploy that includes the webhook endpoint.
- [ ] Integration test: a full sandbox deal with a scripted (non-AI) buyer and seller reaches `SETTLED`; another reaches `REFUSED`.

Done when both integration paths pass against the sandbox, triggered through the deployed API.

### Phase 3 — Agents (Oct 19–26)

- [x] `LlmProvider` interface with a Bedrock implementation (Converse, tool use, JSON output, token accounting).
- [x] Buyer agent with Channel3 search and product detail tools; results cached in DynamoDB.
- [x] `scripts/seed-sellers.ts`: create seller agents from Channel3 products with floor prices and personas.
- [x] Seller agent with persona and floor price; negotiation loop with a turn cap.
- [x] Deal contract generation and signing; human approval step.
  - Signatures from `packages/core/contract` are plain digests that anyone can compute. Create them only on the server after checking who the party is, never accept one from a client or seller agent, or switch to an HMAC with a server-held key.
- [x] Deal API: the buyer's price approval and a person's escalation decision resume the lifecycle (`purchase-approval` and `human-decision` waits).
  - Access is a per-deal token sent as `Authorization: Bearer <token>`. Whatever starts a deal must create the token, return it once, and store its hash with `grantDealAccess`.
- [x] Verifier agent: deterministic checks first (price, currency, product ID, deadline), then per-criterion LLM checks; low confidence escalates.
- [x] Untrusted-data wrapping for all third-party text in prompts.
- [ ] WebSocket streaming of negotiation messages and state changes.
- [x] `evals/`: at least 15 scripted scenarios (honest deals, hard bargains, bad evidence) with expected outcomes.

Done when an AI-driven deal completes end to end in the deployed app and evals pass.

### Phase 4 — Arena (Oct 27–Nov 2)

- [ ] Attack builder UI and API, with input length limits, a basic abuse filter, and per-IP rate limiting.
- [x] Arena judge agent and scoring (severity × novelty, near-duplicates score less).
- [ ] Sandbox Payouts for successful exploits, to sandbox personal accounts only; human verifies **[I-12]**.
- [x] Regression generator: a successful attack becomes a JSON case in `evals/regressions/` and in DynamoDB.
- [ ] Leaderboard (AG Grid) and defense win rate over time and attacks by category (AG Charts).
- [ ] Arena attack history in AG Grid: result, blocked action and reason, link to the regression case.
- [x] `packages/arena`: `progression.ts`, `badges.ts`, `daily-challenge.ts`, `handle.ts`, with unit tests for every rank and badge boundary.
- [x] `checkBountyProposal` in `packages/core/policy` with tests; `limits/max-bounty` and `limits/daily-bounty-budget` in SSM and `.env.example`.
- [x] CDK: add `GSI1` to the table and the `ArenaRun` state machine.
- [x] `packages/store`: challenger, leaderboard and arena stats repositories; `recordArenaResult` as one transaction, with a test that a concurrent update retries on a version conflict.
- [x] Handles and sessions: `POST /arena/challengers`, `GET /arena/challengers/me`, hashed session tokens, handle reservation.
- [ ] WebSocket events `arena.result`, `challenger.progress`, `arena.stats`.
- [ ] Arena UI: challenger card with rank progress, badge grid (locked badges show how to earn them), open bounties per category, daily challenge, defense counter, rank-up and badge toasts.
- [ ] Hall of fame: regression case pages credit the challenger and show attempt, fix, and the rerun that holds.
- [ ] Share images for loopholes and badges with `next/og`.
- [ ] UI copy check: every arena screen uses "challenger" and "loophole found", suitable for any age.
- [ ] Run every catalog attack ourselves, fix what breaks, keep at least one realistic success for the demo story.

Done when a successful attack produces a payout and a regression case, and the patched system then blocks it.

### Phase 5 — Product polish (Nov 3–8)

- [ ] Screens: landing, deal room, escrow timeline, evidence and verification, arena, leaderboard, audit log.
- [ ] Signature moments from Look and feel, each driven by real deal or arena data. Reduced-motion fallbacks checked.
- [ ] Landing page Lighthouse performance at 90 or above on mobile.
- [ ] Audit log and active escrow holds (amount, time to expiry, reauthorization status) in AG Grid, with sorting, filtering, and quick search.
- [ ] AG Grid and AG Charts themed to match the app in dark and light mode, keyboard navigable, loaded only on the screens that use them. Community modules only, imported one by one.
- [ ] Clear states for loading, errors, budget exhausted, and escalation.
- [ ] Dark and light themes; keyboard navigation; color is never the only signal.
- [ ] Cost guards in place and tested: throttling, reserved concurrency, token budgets, Budgets alarms.
- [ ] Cost guards never block judges: daily token budget sized for judging traffic, an alarm at 80% of it, and a separate judge allowance unlocked by an access code printed in the README. Per-IP limits must allow several judges behind one IP.
- [ ] `pnpm demo:reset` restores a known-good demo state.
- [ ] Human deploys the final build manually and completes **[I-13]**.
- [ ] **Feature freeze Nov 8.** Only bug fixes after this.

### Phase 6 — Submission (Nov 9–12)

- [ ] README: problem, audience, try-it-in-2-minutes (hosted URL, sandbox logins, judge access code), local run, architecture diagram, PayPal API mapping table, Channel3 usage, APIMatic usage, AG Grid and AG Charts usage, Bedrock usage, limitations.
- [ ] README states that the hosted URL is the supported test path, and that a local run needs your own Channel3 key, PayPal sandbox app, and AWS account. No real keys in the repo.
- [ ] MIT `LICENSE` at the repo root; repository public.
- [ ] `docs/demo-script.md` finalized; human records the video **[I-14]**.
- [ ] Devpost text drafted in `docs/submission.md`.
- [ ] Human submits **[I-15] to [I-17]**, with at least 24 hours of buffer.
- [ ] Tag the submitted commit as `submission` and push the tag before the deadline.

### Phase 7 — Keep alive (Nov 13 – Dec 21)

- [ ] Daily health check (scheduled Lambda pinging the main flows, alerting via SNS email), running at least until Dec 15, 8:00 am PT.
- [ ] No pushes to `main` after the deadline; the repo is part of the frozen submission.
- [ ] No deploys unless the app is down, and only if PayPal confirmed on Discord that restoring the hosted app is allowed ([I-2]). Fixes are tested locally first, on a branch.
- [ ] Human follows **[I-18]**.

### Optional — Continuous integration

- [ ] GitHub Actions: typecheck, lint, unit tests on every push. Only if time allows after Phase 6; not needed for the submission.

## Demo video outline (under 3 minutes)

Use unbranded or generic products in recorded deals, draw the architecture slide with text and shapes only (no vendor logos), and use no copyrighted music.

| Time | Content |
|---|---|
| 0:00–0:20 | Problem and audience: "You built a shopping agent. Your users won't let it pay." Show why: one injected listing is enough |
| 0:20–1:15 | Deal mode: Channel3 search, live negotiation, contract, PayPal authorization, evidence, capture |
| 1:15–1:45 | Arena: injection attack blocked, with the policy reason on screen |
| 1:45–2:20 | Arena: an exploit succeeds, the bounty is paid, it becomes a regression test, and the rerun is blocked |
| 2:20–2:50 | Architecture in one slide; who it is for; closing line |
