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
pnpm mcp                 # MCP server over stdio; needs HANDSHAKE_API_KEY
pnpm seed:sellers <table> [query ...]  # seller agents from Channel3 products
pnpm eval                # agent evals in evals/scenarios against Bedrock
```

## Deal API

Base URL: `https://api-handshake.radostit.com/v1`. Send `authorization: Bearer <key>`; create a sandbox key with `pnpm api-keys:create`.

| Route | What it does |
| --- | --- |
| `POST /deals` | Opens a deal from a goal, a buyer mandate and an optional `sellerId`. Returns the deal, a one-time `accessToken` and a `buyerUrl` where the buyer approves the PayPal checkout. |
| `GET /deals` | Lists the deals opened with your key, newest first. |
| `GET /deals/{dealId}` | The deal with its events, negotiation, evidence, PayPal calls (with `debug_id`) and webhooks. |
| `POST /deals/{dealId}/evidence` | Delivery evidence. The verifier checks it against the signed contract, then policy decides to capture or void. |
| `POST /deals/{dealId}/purchase-approval` | `{ "approved": true }` for a price above the mandate's approval threshold. |
| `POST /deals/{dealId}/human-decision` | A settlement proposal for an escalated deal. Policy still checks it. |

The deal routes also accept the deal's access token, so the buyer can act without your API key. Each key opens up to 25 deals a day.

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

## Red Team Lab

Invited researchers play a dishonest seller and try to trick the agents at `/arena`. Each attack runs through the `ArenaRun` state machine; the attempt page at `/arena/attempts/<id>` listens on the WebSocket at wss://ws-handshake.radostit.com and reloads when the judge decides. It also polls every 10 seconds in case a push is lost. The arena page updates its defense counter from the same socket. The leaderboard is at `/arena/leaderboard`.

The arena is open to invited players only, because every attack spends Bedrock tokens. A visitor signs in with a code sent to their email and asks to join with a short reason. Approve or reject requests with `pnpm arena:access`.

The arena pages call the deployed API at https://api-handshake.radostit.com, which accepts browser calls only from the hosted site. They do not work from `pnpm dev`.

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
