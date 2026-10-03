# Handshake by Radost IT

AI agents negotiate and settle real-product deals through PayPal escrow. The language model never moves money: agents propose, and tested code captures or voids the PayPal authorization.

Work in progress for the PayPal AI Hackathon. See `PROJECT.md` for the plan.

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
pnpm seed:sellers <table> [query ...]  # seller agents from Channel3 products
pnpm eval                # agent evals in evals/scenarios against Bedrock
```

## Arena

Visitors play a dishonest seller and try to trick the agents at `/arena`. Each attack runs through the `ArenaRun` state machine; the attempt page at `/arena/attempts/<id>` listens on the WebSocket at wss://ws-handshake.radostit.com and reloads when the judge decides. It also polls every 10 seconds in case a push is lost. The arena page updates its defense counter from the same socket. The leaderboard is at `/arena/leaderboard`.

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
