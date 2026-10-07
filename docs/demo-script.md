# Pitch video script

Target length: 2:50, under the 3-minute limit. A pitch first, a demo second: the problem, who it is for, how big it is, then the real app. Record against https://handshake.radostit.com with sandbox accounts only, generic products, no vendor logos, and music that is free for commercial use without credit.

The cut is built by `scripts/handshake-pitch-video.sh` in app-store-promo-maker: title cards for the pitch beats, then sped-up recordings of the hosted app with one caption per beat. Market figures and sources are in `docs/market.md`; every number on screen names its source.

## 1. Problem (0:00 to 0:15)

Card: "Shopping agents can find and bargain. Nobody lets them pay."
Second line: "55% of shoppers won't let AI agents buy for them. Riskified, Q1 2026."

Voice: "You built a shopping agent. It finds products and bargains well. But your users won't let it pay: one fake listing or one injected message, and their money is gone."

## 2. Market (0:15 to 0:30)

Card with three numbers:
- "Up to $1T of US retail run by AI agents by 2030." McKinsey, 2025.
- "$190B to $385B of US e-commerce bought by agents." Morgan Stanley, 2025.
- "$1B to $3.9B a year in escrow fees in the US alone." Our estimate: 0.5% to 1% of that.

Voice: "By 2030, agents will run up to a trillion dollars of US retail. Every one of those purchases needs a way to pay that the buyer trusts."

## 3. Solution and users (0:30 to 0:45)

Card: "Handshake: escrow for AI shopping agents, on PayPal." Three columns:
- "Agent builders: one API call or MCP tool."
- "Their users: approve, pay, money held until delivery."
- "Merchants: a seller agent, paid on proven delivery."

Voice: "Handshake is escrow for agents, on PayPal. The agent agrees a deal, PayPal holds the money as an authorization, and code captures it only when delivery matches the signed contract. The model never moves money. It can only propose."

## 4. A real deal (0:45 to 1:45)

Recordings, sped up where the app waits:
1. Judge signs in; opens a deal for a hiking day pack with seller `arena-backpack`, budget 60.00, ask above 50.00.
2. Buyer and seller agents bargain live on Amazon Bedrock and sign a contract.
3. 57.00 is above 50.00, so the buyer approves the price, then pays in the PayPal sandbox checkout. The timeline shows "Funds held".
4. "Report the delivery", "Send the matching item". The verifier checks every condition and the payment is captured, or the buyer releases it if the verifier is unsure.
5. The console: each PayPal call with its `PayPal-Request-Id` and `debug_id`, and the verified webhooks.

## 5. Merchants (1:45 to 2:10)

1. `/merchants` signed out: "Sell to AI shopping agents", apply, get a key, sell.
2. A new business fills in the application: name, website, PayPal business account, what it sells. The page says "Your request is waiting".
3. Signed in as a judge: the demo merchant's settings, read-only. Business, PayPal business account, the API key ending, five seller agents with list and floor prices.

Voice: "Merchants apply with their PayPal business account. Once approved, their seller agents negotiate within a floor price, and their systems report deliveries with their own key."

## 6. Trust you can check (2:10 to 2:35)

1. Red Team Lab: a platform-impersonation attack. "The agents held", with the policy check that refused it.
2. `/evals`: every breach becomes a regression scenario; the defense rate per attack type.

## 7. Close (2:35 to 2:50)

Card: "Agents propose. Policy checks. PayPal moves money." Below it: "0.5% to 1% per settled deal. Voided deals pay nothing." and handshake.radostit.com.

## Recording checklist

- Deploy, then run `pnpm merchants:demo` ([I-29]) so the judge accounts show the demo merchant.
- Use judge-1 for the deal and merchant settings, and a fresh email you can read for the merchant application.
- Run `pnpm demo:reset` first if the judge's deal list is crowded.
