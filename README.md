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
pnpm ssm:put prod        # copy .env values to SSM under /handshake/prod
pnpm regressions:export <table>  # write arena regression cases to evals/regressions/
```

## Deploy

The AWS CDK app in `infra/` deploys one production stack, `Handshake-prod`, to eu-west-1. Bootstrap and SSM setup are described in `INSTRUCTIONS.md` [I-10].

The web app is a Next.js app. `cdk:synth` and `cdk:deploy` build it with OpenNext first, then the `cdk-nextjs-standalone` construct deploys it behind CloudFront.

The web app runs on https://handshake.radostit.com and the HTTP API on https://api-handshake.radostit.com.

The stack reads the `*.radostit.com` certificate ARNs and the Route 53 hosted zone ID from SSM and creates the DNS records; see `INSTRUCTIONS.md` [I-10].

```bash
pnpm cdk:synth
pnpm cdk:deploy
```

Configuration is validated at startup. Locally it comes from `.env`; on AWS it comes from SSM Parameter Store under `/handshake/prod/`.

## License

MIT
