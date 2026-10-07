# Handshake by Radost IT

Escrow settlement for AI shopping agents, on PayPal.

Teams building shopping agents have a trust problem: their users will not let the agent pay, because one fake listing or injected message could cost them money. Handshake lets the agent pay safely. The agent negotiates, the money is held as a PayPal authorization, and it is captured only when the delivery matches the signed contract. The language model never moves money: agents propose, and tested code captures or voids the authorization.

Agent builders integrate it through the Deal API or the MCP server. Pricing is a basis-point fee per settled deal; voided deals pay nothing.

The Red Team Lab at `/arena` is the public security record: invited researchers attack the agents, and every breach pays a sandbox bounty and becomes a regression test.

Built for the PayPal AI Hackathon. See `PROJECT.md` for the plan.

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
pnpm api-keys:create <table> <name>  # issue a sandbox Deal API key; shown once
pnpm accounts:judges <table> <email-domain>  # create or reset 5 approved judge accounts with fixed sign-in codes; shown once
pnpm mcp                 # MCP server over stdio; needs HANDSHAKE_API_KEY
pnpm seed:sellers <table> [query ...]  # seller agents from Channel3 products
pnpm seed:template-sellers <table>  # the arena's fixed sellers as seller records; no Channel3 key needed
pnpm demo:reset <stage> <developer-id>  # delete the demo key's deals that hold no money, reset its daily limit, re-seed sellers
pnpm eval                # agent evals in evals/scenarios against Bedrock; writes evals/report.json
```

## Deal API

Base URL: `https://api-handshake.radostit.com/v1`. Send `authorization: Bearer <key>` and, with a body, `content-type: application/json`; other bodies are ignored. Create a sandbox key with `pnpm api-keys:create`. The console calls the same routes with the session access token of a signed-in, approved account instead of a key.

| Route | What it does |
| --- | --- |
| `POST /deals` | Opens a deal from a goal, a buyer mandate and an optional `sellerId`. Returns the deal, a one-time `accessToken` and a `buyerUrl` where the buyer approves the PayPal checkout. |
| `GET /deals` | Lists the deals opened with your key, newest first. |
| `GET /deals/{dealId}` | The deal with its events, negotiation, evidence, PayPal calls (with `debug_id`) and webhooks. |
| `POST /deals/{dealId}/evidence` | Delivery evidence. The verifier checks it against the signed contract, then policy decides to capture or void. |
| `POST /deals/{dealId}/purchase-approval` | `{ "approved": true }` for a price above the mandate's approval threshold. |
| `POST /deals/{dealId}/human-decision` | A settlement proposal for an escalated deal. Policy still checks it. |

The deal routes also accept the deal's access token, so the buyer can act without your API key. The two approval routes refuse API keys: the agent that holds the key must not approve its own spending, so only the person, with the deal's access token or a signed-in session, decides there. Each key or account opens up to 25 deals a day.

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
- The operator creates five judge accounts with `pnpm accounts:judges`. They are approved from the start and have a fixed code, so no email is sent to them.

Everyone signs in at `/sign-in` with an email and a six-digit code; there are no passwords. Emailed codes work once, expire after 10 minutes and lock after five wrong tries. Each email may check 20 codes a day and each network 30 an hour, which keeps guessing a judge's fixed code hopeless. Sign-in emails stop for the day after 300. Signing in returns two tokens, the same way radost-it-forge does it. An access token signs each API call and lasts one hour. A refresh token lasts 30 days and is swapped for a new pair at `POST /arena/session/refresh` whenever the access token runs out. A refresh token that was already swapped ends the whole session, because only a stolen copy would come back. Signing out deletes the session on the API, so neither token works afterwards. The API stores only hashes of the tokens.

The lab pages call the deployed API at https://api-handshake.radostit.com, which accepts browser calls only from the hosted site. They do not work from `pnpm dev`.

## Evals

`pnpm eval` runs every scenario in `evals/scenarios/` against the real agents on Bedrock and writes `evals/report.json`. Scenarios that replay a Red Team Lab attack name its category in an `attack` field; the others are baseline deals that must still close and pay. The `/evals` page is built from the committed report and shows the defense rate per attack category in AG Charts and every scenario in AG Grid. Commit the new report after each run, then redeploy.

## Deploy

The AWS CDK app in `infra/` deploys one production stack, `Handshake-prod`, to eu-west-1. Bootstrap and SSM setup are described in `INSTRUCTIONS.md` [I-10].

The web app is a Next.js app. `cdk:synth` and `cdk:deploy` build it with OpenNext first, then the `cdk-nextjs-standalone` construct deploys it behind CloudFront.

The web app runs on https://handshake.radostit.com, the HTTP API on https://api-handshake.radostit.com and the WebSocket API on wss://ws-handshake.radostit.com.

The stack reads the `*.radostit.com` certificate ARNs and the Route 53 hosted zone ID from SSM and creates the DNS records; see `INSTRUCTIONS.md` [I-10].

```bash
pnpm cdk:synth
pnpm cdk:deploy
```

Configuration is validated at startup. Locally it comes from `.env`; on AWS it comes from SSM Parameter Store under `/handshake/prod/`.

## License

MIT
