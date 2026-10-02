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
```

Configuration is validated at startup. Locally it comes from `.env`; on AWS it comes from SSM Parameter Store under `/handshake/<stage>/`.

## License

MIT
