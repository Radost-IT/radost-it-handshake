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
```

## Deploy

The AWS CDK app in `infra/` deploys one stack per stage (`Handshake-dev`, `Handshake-demo`) to eu-west-1. Bootstrap and SSM setup are described in `INSTRUCTIONS.md` [I-10].

The web app is a Next.js app. `cdk:synth` and `cdk:deploy` build it with OpenNext first, then the `cdk-nextjs-standalone` construct deploys it behind CloudFront.

| Stage | Web app | HTTP API |
| --- | --- | --- |
| demo | https://handshake.radostit.com | https://api-handshake.radostit.com |
| dev | https://dev-handshake.radostit.com | https://api-dev-handshake.radostit.com |

The stack reads the `*.radostit.com` certificate ARNs from SSM. DNS records are added by hand; see `INSTRUCTIONS.md` [I-10].

```bash
pnpm cdk:synth --context stage=dev
pnpm cdk:deploy --context stage=dev
```

Configuration is validated at startup. Locally it comes from `.env`; on AWS it comes from SSM Parameter Store under `/handshake/<stage>/`.

## License

MIT
