# CLAUDE.md

Instructions for Claude Code working on **Handshake by Radost IT**.
Product spec and phase plan: `PROJECT.md`. Manual setup done by the human: `INSTRUCTIONS.md`.
Read all three before the first task of a session.

## The product in one paragraph

AI agents negotiate and settle real-product deals through PayPal escrow. A buyer agent finds products via Channel3, negotiates with seller agents, and on agreement the money is authorized (not captured) with PayPal Orders `intent=AUTHORIZE`. A verifier agent checks delivery evidence against the signed deal contract, and deterministic code captures or voids the payment. In Arena mode, visitors play malicious sellers and try to trick the agents; successful exploits earn sandbox bounties via PayPal Payouts and become regression tests.

## Non-negotiable rules

1. **LLMs never move money.** Agents return structured proposals. Only `packages/settlement` calls PayPal money endpoints, and only after `packages/core/policy` approves the proposal against the deal contract and buyer mandate.
2. **PayPal sandbox only.** The PayPal base URL comes from config. Never add live endpoints or live credentials anywhere, including tests and docs.
3. **Never read `.env` contents.** Local configuration lives in a `.env` file that holds real keys. Never open, print, grep, diff, or otherwise read `.env` or any `.env.*` file except `.env.example`, and never paste its values into prompts, logs, tests, or commits. `.env` stays in `.gitignore`.
   - **`.env.example`** is committed and lists every key with an empty or dummy value and a short comment. When you add or rename a config key, update `.env.example` in the same commit, and tell the human to add the real value to their `.env`.
   - Configuration is read once by `packages/config`: locally from `.env`, on AWS from SSM Parameter Store under `/handshake/<stage>/…`. Lambdas receive only the parameter *path* and stage as environment variables, never secret values.
   - Validate the whole config with zod at startup and fail fast with a clear message naming the missing key, never its value.
4. **Free for judges.** Do not add dependencies on paid services or trials that expire before Dec 21, 2026. Allowed external services: PayPal sandbox, Channel3, Amazon Bedrock, AWS serverless services.
5. **Never mark a deal settled** without a confirmed capture (API response or signature-verified webhook).
6. **Never invent APIs.** Before writing PayPal SDK code, query the APIMatic Context Plugin (`endpoint_search`, `model_search`). For Channel3 and Bedrock, check the official docs. If behavior is uncertain (timing limits, sandbox quirks), write a probe script in `scripts/probes/`, run it, and report the result.

## Code quality: no AI slop

Write code a senior engineer would be happy to sign. Judges will read it.

**Readable without comments**
- Names explain intent: `captureAuthorizedPayment`, not `handlePayment2` or `processData`.
- Small functions with one job, early returns, no deep nesting, no boolean flag parameters that switch behavior.
- Prefer plain functions and data over classes and patterns. No factories, managers, or abstract base classes unless there are at least two real implementations today.

**Comments**
- Comment *why*, never *what*. If code needs a comment to explain what it does, rename or restructure it instead.
- No banner comments, no section dividers, no emojis, no comments restating the line below, no commented-out code.
- JSDoc only on exported functions whose contract is not obvious from the types.

**Honest code**
- No placeholders, stubs, `TODO` leftovers, or fake success paths. If something is not implemented, throw a typed `NotImplementedError` and say so in your reply.
- No mocks or hardcoded data in production code paths. Seed data lives only in `scripts/`.
- Do not swallow errors. Catch only where you can handle or translate the error; otherwise let it propagate.
- No speculative features, options, or config flags nobody asked for.

**Lean code**
- No dead code, unused exports, unused dependencies, or duplicate helpers. Search before adding a helper.
- Add a dependency only when it removes meaningful code; state why in the commit message.
- Keep diffs focused. Do not reformat or rename unrelated code.

**Performance (serverless)**
- Create SDK clients and load config outside the Lambda handler and reuse them across invocations.
- Keep bundles small: import only the AWS SDK v3 clients you use; bundle with esbuild.
- Run independent I/O in parallel (`Promise.all`); batch DynamoDB reads and writes; never query in a loop.
- Cache Channel3 results in DynamoDB with TTL. Cap LLM tokens per call, per deal, and per day.

**Human-readable output**
- UI copy, README, logs, and commit messages use short, plain sentences. Avoid filler and hype words such as "seamless", "robust", "leverage", "cutting-edge", "revolutionary", "delve", and "empower".
- Logs are structured JSON with a short message and context fields. Redact tokens, emails, and secrets. Log PayPal `debug_id` on errors.
- Commit messages follow Conventional Commits and say what changed and why in one or two lines.

## Technical conventions

- TypeScript `strict`, ESM, Node 20+ on Lambda. No `any`; use `unknown` plus zod at every boundary (HTTP, WebSocket, webhooks, LLM output, Channel3 data, config).
- Money is a decimal string in PayPal format, handled only through `packages/core/money`. Never use floats for money.
- Every mutating PayPal call sends a deterministic `PayPal-Request-Id` (`dealId:operation:attempt`).
- Domain logic in `packages/core` is pure (no I/O) and fully unit tested. State changes go through the deal state machine, never by setting fields directly.
- Third-party text (Channel3 data, seller messages, evidence) is untrusted. Wrap and label it in prompts as data, never as instructions.
- Bedrock model IDs and inference profile IDs come from config. Never hardcode them.
- Tables use AG Grid Community and charts use AG Charts Community. Never import Enterprise modules or AG Studio: their licenses are trials that expire before judging ends.
- pnpm workspaces; Vitest for tests; AWS CDK (TypeScript) for infrastructure.

## Commands

```bash
pnpm install
pnpm dev                 # local app; reads config from .env
pnpm typecheck
pnpm lint
pnpm test                # unit tests
pnpm test:integration    # real PayPal sandbox and Channel3 calls
pnpm eval                # agent evals in evals/scenarios against Bedrock; reads .env
pnpm probe:paypal       # also probe:paypal-limits, probe:channel3, probe:bedrock; read .env
pnpm ssm:put <stage>     # copy .env values to SSM; secrets as SecureString
pnpm seed:sellers <table> [query ...]  # seller agents from Channel3 products; reads .env
pnpm regressions:export <table>  # write hall of fame cases to evals/regressions/
pnpm demo:reset
pnpm cdk:synth
pnpm cdk:deploy
```

If you add or change a command, update this list and the README in the same commit.

## How to work

1. Restate the task in one or two sentences and list the files you expect to touch.
2. Make the smallest change that fully solves the task, with tests.
3. Run `pnpm typecheck && pnpm lint && pnpm test`; run `pnpm eval` when prompts or policy change. Report the results honestly, including failures.
4. Tick the matching item in `PROJECT.md` when a step is done.
5. Commit and push each finished task. One task, one commit. The message is short, plain, and human readable: say what changed and why (Conventional Commits format).
6. If a rule here blocks progress or seems wrong, stop and ask. Do not work around it silently.
7. When you need the human to do something outside the code (accounts, keys, console clicks), add or update a step in `INSTRUCTIONS.md` and tell them.
8. When something does not work as documented or expected (a failed deploy, a sandbox quirk, a model or API limit), add an entry to `CHALLENGES.md` in the same commit as the fix. Say what we expected, what happened, and how we solved it, with the exact error message.
