# Pitch video script

The rules ask for a video under 3 minutes; judges need not watch past that. The cut runs about 2:30. It is a pitch first and a demo second: the problem, how big it is, who it is for, then the real app. Every recording is of https://handshake.radostit.com with sandbox accounts only, generic products and no vendor logos. The music is free for commercial use without credit.

The cut is built by `scripts/handshake-pitch-video.sh` in app-store-promo-maker: logo and text cards for the pitch, then sped-up recordings of the hosted app with one caption per beat. Amazon Polly (generative engine, voice Matthew) reads the voice-over; the music plays quietly under it. Market figures and their sources are in `docs/market.md`, and every number on screen names its source.

Times below are approximate, because each card stays up until its line is read.

## 1. Intro (0:00)

Card: the Handshake logo, "Escrow for AI shopping agents, on PayPal.", "Agents propose · Policy checks · PayPal moves money".

Voice: "Handshake. Escrow for AI shopping agents, on PayPal."

## 2. Problem (0:05)

Card: "Shopping agents can find and bargain. Nobody lets them pay." Then "55% of US and UK shoppers won't let AI agents buy for them, afraid of fake listings and fraud." Source: Riskified, Agentic Commerce Pulse, Q1 2026.

Voice: "Shopping agents can already find products and bargain. But fifty-five percent of shoppers won't let an AI agent pay for them. One fake listing, and the money is gone."

## 3. Market (0:17)

Card, "The market by 2030":
- Up to $1T of US retail run with AI agents. McKinsey, Oct 2025.
- $190B to $385B of US e-commerce bought by agents. Morgan Stanley, Dec 2025.
- TAM $15B to $50B a year in escrow fees worldwide. Our estimate: 0.5% to 1% of McKinsey's $3T to $5T global.
- SAM $1B to $3.9B a year in escrow fees in the US. Our estimate: 0.5% to 1% of the US agent spend above.

Voice: "By twenty thirty, up to a trillion dollars of US retail will run through AI agents. At a small escrow fee, that is fifteen to fifty billion dollars a year, worldwide."

## 4. Who uses it (0:29)

Card: "Handshake: escrow for AI shopping agents, on PayPal." Three columns:
- Agent builders: add a checkout to any shopping agent with one API call or an MCP tool.
- Shoppers: approve the price and pay with PayPal; the money is held until delivery.
- Merchants: run a seller agent with a floor price; get paid on proven delivery.

Voice: "Agent builders add a checkout with one API call, or an MCP tool. Shoppers approve the price and pay with PayPal. Merchants get paid once delivery is proven."

## 5. A real deal (0:40 to 1:48)

Recordings as judge-1, sped up where the app waits:
1. Sign in with the fixed code; open a deal for a hiking day pack with seller `arena-backpack`, budget 60.00, ask above 50.00.
   Voice: "Here is a real deal. A judge asks for a hiking backpack, with a sixty dollar budget."
2. Buyer and seller agents bargain live on Amazon Bedrock and sign a contract.
   Voice: "A buyer agent and a seller agent bargain live on Amazon Bedrock, and agree on fifty-seven dollars."
3. 57.00 is above 50.00, so the buyer approves the price.
   Voice: "That's above the limit, so the buyer approves it."
4. PayPal sandbox checkout; the timeline shows "Funds held".
   Voice: "PayPal authorizes the payment. The money is held, not captured."
5. The seller reports the delivery; the verifier checks each condition and hands one it is unsure about to the buyer.
   Voice: "The seller reports the delivery. A verifier agent checks it against the signed contract. When it's unsure, it hands the decision to the buyer."
6. The buyer releases the payment and PayPal captures 57.00.
   Voice: "The buyer releases it, and PayPal captures fifty-seven dollars."
7. The deal's PayPal calls with their `debug_id`, then the console with each `PayPal-Request-Id` and the verified webhooks.
   Voice: "Every PayPal call and webhook is on record, with its request ID and debug ID."

## 6. Merchants (1:48 to 2:02)

1. `/merchants` signed out: "Sell to AI shopping agents", apply, get a key, sell.
2. Signed in as judge-1: the demo merchant's read-only settings. Business, PayPal business account, the API key ending, five seller agents with list and floor prices.

Voice: "Merchants apply with their PayPal business account. Once approved, they get their own API key, and seller agents that never go below a floor price."

The application by a new business, ending at "Your request is waiting", is not in the cut yet. It needs an email that is not approved and whose code we can read.

## 7. Trust you can check (2:02 to 2:27)

1. Red Team Lab: a platform-impersonation attack against live agents.
   Voice: "In the Red Team Lab, you play the dishonest seller, and attack live agents."
2. "The agents held", with the policy check that refused the move; then `/evals`, where every breach becomes a regression scenario.
   Voice: "The agents held. The model can only propose. Policy code decides, and PayPal moves the money. Every breach becomes a regression test."

## 8. Close (2:27)

Card: the Handshake logo, "Agents propose. Policy checks. PayPal moves money.", "0.5% to 1% per settled deal. Voided deals pay nothing.", and handshake.radostit.com.

Voice: "Handshake. Try it at handshake dot radost I T dot com."

## Rebuilding

- Recordings are Playwright scripts against the hosted app; the merchant scenes need judge-1's code in `JUDGE_CODE`, typed into a field that the recording masks.
- Run `AWS_PROFILE=handshake bash scripts/handshake-pitch-video.sh` in app-store-promo-maker. The profile needs `polly:SynthesizeSpeech` ([I-14]). Voice lines are cached by text, so only changed lines are synthesized again.
- Run `pnpm demo:reset` first if the judge's deal list is crowded.
