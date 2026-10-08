# Handshake by Radost IT

Escrow settlement for AI shopping agents, on PayPal.

Teams building shopping agents have a trust problem: their users will not let the agent pay, because one fake listing or injected message could cost them money. Handshake lets the agent pay safely. The agent negotiates, the money is held as a PayPal authorization, and it is captured only when the delivery matches the signed contract. The language model never moves money: agents propose, and tested code captures or voids the authorization.

Agent builders integrate it through the Deal API or the MCP server. Pricing is a basis-point fee per settled deal; voided deals pay nothing.

## Who uses it

- **Companies building shopping agents**, such as an assistant app with a "buy it for me" feature. Their agent opens a deal with the user's goal and limits (maximum price, the amount above which the user must approve, blocked categories) through `POST /v1/deals` or the MCP server, and shows the user the deal link.
- **Their users.** They never give an agent their card. They approve the price when it is above their limit, pay with PayPal, and the money stays on hold until delivery is proven. If the verifier is not sure, they decide.
- **Merchants.** They apply at `/merchants` with their business and their PayPal business account. Once approved, their seller agents negotiate within a floor price, and their systems report deliveries with their own API key. During the sandbox beta, captured payments settle to Handshake's PayPal sandbox account, and merchant settings are read-only.

Market figures and our TAM, SAM and SOM estimate are in `docs/market.md`.

The Red Team Lab at `/arena` is the public security record: invited researchers attack the agents, and every breach pays a sandbox bounty and becomes a regression test.

Built for the PayPal AI Hackathon.

## Local development

Requires Node.js 22.12 or newer and pnpm.

```bash
pnpm install
cp .env.example .env     # then fill in your own sandbox keys
pnpm typecheck
pnpm lint
pnpm test                # unit tests, no credentials needed
pnpm test:integration    # real PayPal sandbox and Channel3 calls
pnpm dev                 # web app on localhost
pnpm probe:paypal        # get a PayPal sandbox token (never printed)
pnpm probe:channel3      # one Channel3 product search
pnpm probe:bedrock       # one Converse call per configured model
pnpm probe:paypal-limits # authorize, capture, void and reauthorize a sandbox card payment
pnpm probe:paypal-payout # pay a 1.00 USD sandbox bounty to the arena recipient
pnpm ssm:put prod        # copy .env values to SSM under /handshake/prod
pnpm regressions:export <table>  # write arena regression cases to evals/regressions/
pnpm arena:access <table> [approve|reject <email>]  # list or decide requests to join the arena
pnpm api-keys:create <table> <name> [account-email]  # issue a sandbox Deal API key, optionally to an account; shown once
pnpm api-keys:revoke <table> <developer-id|account-email> <last-characters>  # delete a key so it stops working at once
pnpm accounts:judges <table> <email-domain>  # create or reset 5 approved judge accounts with fixed sign-in codes; shown once
pnpm mcp                 # MCP server over stdio; needs HANDSHAKE_API_KEY
pnpm seed:sellers <table> [query ...]  # seller agents from Channel3 products
pnpm seed:template-sellers <table>  # the arena's fixed sellers as seller records; no Channel3 key needed
pnpm merchants:demo <table> <payout-email> <judge-domain>  # give the judge accounts the demo merchant and a key each
pnpm demo:reset <stage> <developer-id>  # delete the demo key's deals that hold no money, reset its daily limit, re-seed sellers
pnpm eval                # agent evals in evals/scenarios against Bedrock; writes evals/report.json
```

## Deal API

Base URL: `https://api-handshake.radostit.com/v1`. Send `authorization: Bearer <key>` and, with a body, `content-type: application/json`; other bodies are ignored. Create a sandbox key with `pnpm api-keys:create`. The console calls the same routes with the session access token of a signed-in, approved account instead of a key.

| Route | What it does |
| --- | --- |
| `POST /deals` | Opens a deal from a goal, a buyer mandate and an optional `sellerId`. Returns the deal and a `buyerUrl` where the buyer approves the PayPal checkout. A signed-in session also gets a one-time `accessToken`, inside the `buyerUrl`, to share the deal with the buyer; an API key never gets one. |
| `GET /deals` | Lists the deals opened with your key, newest first. |
| `GET /deals/{dealId}` | The deal with its events, negotiation, evidence, PayPal calls (with `debug_id`) and webhooks. |
| `POST /deals/{dealId}/evidence` | Delivery evidence. The verifier checks it against the signed contract, then policy decides to capture or void. |
| `POST /deals/{dealId}/purchase-approval` | `{ "approved": true }` for a price above the mandate's approval threshold. |
| `POST /deals/{dealId}/human-decision` | A settlement proposal for an escalated deal. Policy still checks it. |

The deal routes also accept the deal's access token, so the buyer can act without your API key. The two approval routes refuse API keys: the agent that holds the key must not approve its own spending. For a deal opened with an API key, the person signs in to the key's account and decides on the deal page, so issue keys to an account with `pnpm api-keys:create <table> <name> <account-email>` when deals may need approval. Each key or account opens up to 25 deals a day.

The developer console at https://handshake.radostit.com/console does the same from a browser: sign in or paste a key, open a deal, and read each deal's PayPal calls (operation, HTTP status, `debug_id`, `PayPal-Request-Id`) and verified webhooks. The buyer follows a deal at `/deals/<id>`, which shows the escrow timeline and the approval buttons.

## MCP server

`packages/mcp` exposes the Deal API as MCP tools, so any MCP client can buy with escrow. It calls the Deal API with your key and holds no PayPal credentials.

| Tool | What it does |
| --- | --- |
| `open_deal` | Opens a deal and returns the `buyerUrl` for the person. |
| `list_deals` | Lists your deals. |
| `get_deal` | One deal with its contract, escrow hold and PayPal audit log. |
| `submit_delivery_evidence` | Plays the sandbox seller and reports delivery. |

There is no tool to approve a price, approve the checkout, or decide an escalation. Those stay with the person on the deal page, so a prompt-injected agent cannot release money through the MCP server.

To use it from Claude Desktop, add this to `claude_desktop_config.json` and restart the app:

```json
{
  "mcpServers": {
    "handshake": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/path/to/radost-it-handshake", "mcp"],
      "env": { "HANDSHAKE_API_KEY": "hs_sandbox_..." }
    }
  }
}
```

`--silent` matters: the server talks over stdout, and pnpm's banner would break the protocol. From Claude Code, run `claude mcp add handshake --env HANDSHAKE_API_KEY=hs_sandbox_... -- pnpm --silent --dir /path/to/radost-it-handshake mcp`.

## PayPal integration

All PayPal calls go to the sandbox and live in `packages/paypal`. Only `packages/settlement` calls the money operations, and only after `packages/core` policy approves the proposal.

| PayPal API | Operation | When Handshake calls it |
| --- | --- | --- |
| Orders v2 | Create order, `intent=AUTHORIZE` | The agents agree on a contract. The buyer approves the order in PayPal checkout. |
| Orders v2 | Get order | Confirms the buyer approved before authorizing. |
| Orders v2 | Authorize order | Places the hold. This is the escrow. |
| Payments v2 | Capture authorization | Policy accepts the verifier's capture proposal. |
| Payments v2 | Void authorization | Policy accepts a void, or the delivery deadline passes. |
| Payments v2 | Reauthorize authorization | A delivery timer runs past the honor period of the hold. |
| Payouts v1 | Create batch payout | A Red Team Lab breach pays a sandbox bounty. |
| Webhooks v1 | Verify webhook signature | Every webhook before it changes a deal: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`. |

Every mutating call sends a deterministic `PayPal-Request-Id` of the form `dealId:operation:attempt`, so a retried Lambda replays the first result instead of charging twice. Each call is stored in the deal's audit log with its operation, HTTP status, request ID and PayPal `debug_id`; the console and `GET /deals/{dealId}` show it. A deal becomes settled only after a capture is confirmed by the API response or a verified webhook.

The escrow timeline on `/deals/<id>` follows one deal through the state machine in `packages/core/src/deal.ts`:

```text
NEGOTIATING -> AGREED -> [AWAITING_HUMAN_APPROVAL] -> AUTHORIZING -> IN_ESCROW -> AWAITING_DELIVERY
  -> VERIFYING -> CAPTURING -> SETTLED     money captured
               -> VOIDING   -> REFUSED     hold voided, buyer pays nothing
               -> ESCALATED                a person decides, policy still checks
```

## How it fits agent payment protocols

Handshake does not replace these protocols. It adds the step none of them define: hold the money, check the delivery against the contract, then capture or void.

| | What it defines | Where Handshake fits |
| --- | --- | --- |
| [AP2](https://ap2-protocol.org/) (Google) | Verifiable mandates: a Checkout Mandate for what the user allows and the final cart, and a Payment Mandate for the budget and the exact amount. | The buyer mandate (max price, approval threshold, blocked categories) plays the role of the open mandates. The signed deal contract plays the role of the closed Checkout Mandate. Policy refuses any capture outside both. |
| [ACP](https://developers.openai.com/commerce) (OpenAI) | Agentic checkout between an agent and a merchant, and delegated payment tokens limited by `max_amount` and `expires_at`. | The authorization is the same idea with PayPal: a hold capped at the contract price that expires. Handshake adds verification before capture, which ACP leaves to the merchant. |
| [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) | Tools that let an agent call PayPal: orders (`create_order`, `get_order`, `pay_order`), invoices, subscriptions, disputes and shipment tracking. | The toolkit pays in one step. Handshake exposes escrow tools instead, through the Deal API and the MCP server, and keeps the release decision out of the model. |

## Red Team Lab

Invited researchers act as a dishonest seller and try to make the agents release money they should not at `/arena`. A breach earns a sandbox bounty and becomes a regression test. Each challenger has 40 attempts a day, and arena runs may use half of the day's token budget, so the other half stays for Deal API deals. The model judge is asked only when policy approved a step that would hold or capture the buyer's money; otherwise the attempt counts as held, so a judge talked into a verdict cannot pay a bounty. Each attack runs through the `ArenaRun` state machine; the attempt page at `/arena/attempts/<id>` listens on the WebSocket at wss://ws-handshake.radostit.com and reloads when the judge decides. It also polls every 10 seconds in case a push is lost. The arena page updates its defense counter from the same socket. The leaderboard is at `/arena/leaderboard`.

## Accounts

The console and the lab are open to approved accounts only, because every deal and attack spends Bedrock tokens. There is no open sign-up:

- A visitor goes to `/request-access`, confirms their email with a one-time code, and says what they want to do. Approve or reject requests with `pnpm arena:access`; the visitor gets an email either way.
- A merchant applies at `/merchants` with a business name, website, PayPal business email and what they sell. The application is an access request, so the same `pnpm arena:access` approves it. An approved account sees its merchant settings, API keys and seller agents there, read-only during the beta.
- The operator creates five judge accounts with `pnpm accounts:judges`. They are approved from the start and have a fixed code, so no email is sent to them. `pnpm merchants:demo` gives them the demo merchant, with the five arena seller agents and a key each.

Everyone signs in at `/sign-in` with an email and a six-digit code; there are no passwords. Emailed codes work once, expire after 10 minutes and lock after five wrong tries. Each email may check 20 codes a day and each network 30 an hour, which keeps guessing a judge's fixed code hopeless. Each email gets up to 5 codes an hour and 10 a day, each network 20 an hour and 40 a day, and sign-in emails stop for the day after 300. Signing in returns two tokens, the same way radost-it-forge does it. An access token signs each API call and lasts one hour. A refresh token lasts 30 days and is swapped for a new pair at `POST /arena/session/refresh` whenever the access token runs out. A refresh token that was already swapped ends the whole session, because only a stolen copy would come back. Signing out deletes the session on the API, so neither token works afterwards. The API stores only hashes of the tokens.

The lab pages call the deployed API at https://api-handshake.radostit.com, which accepts browser calls only from the hosted site. They do not work from `pnpm dev`.

## Architecture

| Concern | Choice |
| --- | --- |
| Web app | Next.js App Router and Tailwind, AG Grid Community and AG Charts Community. Built with OpenNext and served from CloudFront, S3 and a server Lambda |
| HTTP API | API Gateway HTTP API and Lambda (Node.js 22, TypeScript) |
| Live updates | API Gateway WebSocket API, fed by a DynamoDB stream |
| Deal lifecycle | Step Functions Standard, with `waitForTaskToken` for human approval and delivery evidence |
| PayPal events | Signature-verified webhooks published to an EventBridge bus |
| Data | One DynamoDB table, on demand |
| Configuration and secrets | SSM Parameter Store, secrets as `SecureString` |
| Agents | Amazon Bedrock, Converse API with tool use |
| Email | ZeptoMail, for sign-in codes and access emails |
| Infrastructure | AWS CDK (TypeScript), one stack |

```text
apps/web             Next.js app
services/api         HTTP and WebSocket Lambda handlers
services/workflows   Step Functions task handlers
services/webhooks    PayPal webhook ingest
packages/config      loads and validates config from .env or SSM
packages/core        deal state machine, policy engine, money (pure, no I/O)
packages/paypal      PayPal client: orders, authorizations, payouts, webhook verification
packages/settlement  the only caller of PayPal money endpoints
packages/agents      buyer, seller, contract, verifier and arena judge agents
packages/arena       attack catalog, scoring, ranks, badges, regression cases
packages/channel3    Channel3 client and cache
packages/store       DynamoDB repositories
packages/mail        ZeptoMail emails
packages/mcp         MCP server over the Deal API
infra                AWS CDK app and IAM policies
evals                agent eval scenarios and the committed report
scripts              probes, seeding, accounts, demo reset
```

## Security

- The language model never moves money. Agents return proposals, policy in `packages/core` checks them against the contract and the mandate, and only `packages/settlement` calls PayPal.
- PayPal runs in sandbox only. Config validation refuses any other base URL, and the webhook endpoint refuses certificate URLs outside the sandbox before it asks PayPal to verify a signature.
- Every Bedrock call passes a daily token budget stored in DynamoDB, and only approved accounts and API keys can start one. One developer or challenger may use at most a fifth of the day's tokens, and the arena at most half. Each key or account opens up to 25 deals a day, and each researcher runs up to 40 attacks a day.
- API Gateway throttles the whole API, and the routes anyone can call (health, sign-in, public arena reads, webhooks) have their own smaller limits.
- CloudFront adds a secret header to each request it sends the web server. The forms refuse requests without it, so a direct caller of the server's function URL cannot fake its IP address.
- Third-party text (listings, seller messages, evidence) goes into prompts wrapped and labeled as untrusted data.
- Every Lambda role carries the permissions boundary in `infra/iam/workload-boundary.json`.

To report a security problem, use the contact form at https://handshake.radostit.com/contact rather than a public issue.

## Evals

`pnpm eval` runs every scenario in `evals/scenarios/` against the real agents on Bedrock and writes `evals/report.json`. Scenarios that replay a Red Team Lab attack name its category in an `attack` field; the others are baseline deals that must still close and pay. The `/evals` page is built from the committed report and shows the defense rate per attack category in AG Charts and every scenario in AG Grid. Commit the new report after each run, then redeploy.

## Deploy

The AWS CDK app in `infra/` deploys one production stack, `Handshake-prod`, to eu-west-1. The web app runs on https://handshake.radostit.com, the HTTP API on https://api-handshake.radostit.com and the WebSocket API on wss://ws-handshake.radostit.com. `cdk:synth` and `cdk:deploy` build the web app with OpenNext first.

Configuration is validated at startup. Locally it comes from `.env`; on AWS it comes from SSM Parameter Store under `/handshake/prod/`. Lambdas get only the parameter path, never secret values.

To deploy your own copy:

1. **PayPal sandbox.** Create a Merchant app linked to a US sandbox business account. Enable Payouts and Advanced Credit and Debit Card Payments; the probes and integration tests pay with a sandbox test card. Create two sandbox personal accounts: a demo buyer and the arena bounty recipient.
2. **Bedrock.** In eu-west-1, open the Bedrock playground once as an admin and send a prompt to each model in `.env.example`. The first call subscribes the account in AWS Marketplace.
3. **IAM.** Create the policies in `infra/iam/` by hand: `HandshakeCdkExecution` from `cdk-execution-policy.json`, `HandshakeDeveloper` from `developer-policy.json` (attach it to the CLI user you deploy with), and `HandshakeWorkloadBoundary` from `workload-boundary.json`. CloudFormation may create only roles that carry the boundary.
4. **Bootstrap** CDK once as an admin, with its own qualifier so it stays apart from other CDK apps in the account:
   ```bash
   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   npx aws-cdk@latest bootstrap aws://$ACCOUNT/eu-west-1 \
     --toolkit-stack-name Handshake-CDKToolkit --qualifier handshake \
     --cloudformation-execution-policies arn:aws:iam::$ACCOUNT:policy/HandshakeCdkExecution
   ```
5. **Configuration.** Copy `.env.example` to `.env` and fill it in: the PayPal app, the bounty recipient email, two issued ACM certificates for the domain (one in us-east-1 for CloudFront, one in eu-west-1 for the APIs), the Route 53 hosted zone ID, a ZeptoMail Send Mail token for a verified sender domain, and `FORM_SIGNING_SECRET` and `ORIGIN_VERIFY_SECRET`, each from `openssl rand -hex 32`. Then run `pnpm ssm:put prod`. It prints parameter names, never values.
6. **Deploy** with `pnpm cdk:deploy`.
7. **Webhook.** In the PayPal app, add a webhook for the `WebhookUrl` output with the `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.*`, `PAYMENT.CAPTURE.*` and `PAYMENT.PAYOUTS*` events. Put its ID in `.env` as `PAYPAL_WEBHOOK_ID`, run `pnpm ssm:put prod` and deploy again.
8. **Accounts.** Seed the arena sellers with `pnpm seed:template-sellers <table>`, then create accounts with `pnpm accounts:judges`, `pnpm api-keys:create` and `pnpm arena:access`.

The PayPal dashboard's webhook simulator sends events that PayPal's verification API cannot verify, so the endpoint answers them with 401. Real sandbox events are verified.

## License

MIT
