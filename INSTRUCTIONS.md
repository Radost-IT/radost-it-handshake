# INSTRUCTIONS.md — manual steps for the human

Everything in this file must be done by you, not by Claude Code: accounts, consoles, keys, and submission.
Steps are numbered **[I-x]** and referenced from `PROJECT.md`. Tick them as you go.

Last checked: 2 Oct 2026. Console menus change often; if a label differs, look for the closest equivalent.

## Golden rules

- Never paste secrets into chat, code, commits, issues, or screenshots in the video.
- Secrets go only into AWS SSM Parameter Store (step [I-10]).
- Use PayPal **sandbox** only. Never enter live PayPal credentials anywhere in this project.

---

## Today (before any code)

### [I-1] Register for the hackathon
- [x] Open https://paypalaihackathon.devpost.com and click **Join hackathon**.

### [I-2] Join the community and webinars
- [x] Join the PayPal Discord: https://discord.gg/sJ2G6DyvSK (the PayPal, Channel3, APIMatic, and AG Grid teams answer there).
- [ ] Questions to ask PayPal on Discord or in the webinar:
  1. Exact sandbox behavior for authorization honor period, reauthorization, and void.
  Check online
  2. Whether Payouts works in sandbox for new apps without extra enablement.
  Check online
  3. Whether we may redeploy the hosted demo during judging to fix an outage, given that the submission is frozen after the deadline.
  Not possible
  4. Whether the video may show the PayPal and Channel3 names and logos, since the rules ban third-party trademarks without permission.
  Yes, doable.
  5. Whether a hosted demo plus sandbox logins satisfies the README test-access rule, without publishing our own API keys.
  Yes
- [x] Write the answers into this file under the question.

### [I-3] PayPal developer app (sandbox)
- [x] Log in at https://developer.paypal.com with your PayPal account (create one if needed).
- [x] Make sure the dashboard toggle is set to **Sandbox**.
- [x] Go to **Apps & Credentials → Create App**, type **Merchant**, name it `radost-it-handshake`. Link it to a **US** sandbox Business account: card payments are not offered for apps on other sandbox countries.
- [x] Keep the page open: you will need the **Client ID** and **Secret** in step [I-10]. Do not save them in a text file.
- [x] In the app settings, make sure these features are enabled if listed: **Accept payments**, **Payouts**, **Transaction search**.
- [x] In the app settings, enable card payments (**Advanced Credit and Debit Card Payments**). Probes and integration tests authorize with a sandbox test card, so they need no browser login. Without it, PayPal answers `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`. Then run `pnpm probe:paypal-limits` and send Claude the output. Done 3 Oct 2026; results are in `CHALLENGES.md`.

### [I-4] Sandbox test accounts
- [x] Go to **Testing Tools → Sandbox Accounts**. PayPal creates one Business and one Personal account by default.
- [x] Create two more **Personal** accounts: one for demo buyers (judges will use it), one as the arena bounty recipient.
- [x] For each account, open **View/Edit account** and note the email and password in your password manager.
- [x] The default Business account is the merchant behind your app. Check that it has a sandbox balance, because Payouts are paid from it.
- [x] Later, the demo buyer login goes into the README for judges. These are sandbox-only credentials, so sharing them is fine.
- [x] Add the arena recipient account's email to `.env` as `ARENA_RECIPIENT_EMAIL`, copy `MAX_BOUNTY` and `DAILY_BOUNTY_BUDGET` from `.env.example`, then run `pnpm ssm:put prod`. Bounty policy refuses any other recipient.

### [I-5] Channel3 API key
- [x] Sign up at https://trychannel3.com/developers (no credit card).
- [ ] Create an API key in the dashboard; you get 20,000 free hackathon credits.
- [ ] If credits run low later, ask in the `#channel3` channel on the PayPal Discord for a top-up.

### [I-6] AWS account
- [x] Create an AWS account at https://aws.amazon.com, or use an existing one.
- [x] If new: choose the **Paid plan**. You still receive the free credits, but the Free plan closes the account when credits run out or after six months, which could take the app offline during judging.
- [x] Enable **MFA** on the root user, then stop using the root user.
- [x] Open **IAM Identity Center**, enable it, and create a user for yourself with the **AdministratorAccess** permission set on this account.
- [x] Use **eu-west-1** (Ireland) for everything. Check in the Bedrock console's model catalog that the Anthropic models you want are listed there.
- [x] Open **Billing → Budgets** and create a monthly cost budget with email alerts at $10, $25, and $50.

### [I-7] Tools on your computer
- [x] Node.js LTS (20 or newer): https://nodejs.org
- [x] pnpm: `npm install -g pnpm`
- [x] AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- [x] Create a least-privilege IAM user for the terminal. Do this in the console, logged in as your Identity Center admin:
  1. **IAM → Policies → Create policy → JSON**. Paste `infra/iam/cdk-execution-policy.json` and name it `HandshakeCdkExecution`.
  2. Create another policy from `infra/iam/developer-policy.json` and name it `HandshakeDeveloper`.
  3. **IAM → Users → Create user** `handshake-dev`, with no console access. Attach `HandshakeDeveloper`.
  4. Open the user, go to **Security credentials → Create access key**, and choose **Command Line Interface**.
- [x] Add the key to a local profile and check it:
  ```bash
  aws configure --profile handshake    # paste the key and secret, region eu-west-1, output json
  aws sts get-caller-identity --profile handshake    # should print your account ID and the handshake-dev user
  ```
- [ ] Delete the access key after judging ends.
- [x] Docker is **not** required.

### [I-8] Bedrock access to Anthropic models
- [x] In the AWS console, open **Amazon Bedrock** in your region. The old Model access page is retired; models are enabled on first use.
- [x] Open the **Playground**, select an Anthropic Claude model, and send a test prompt. If asked, fill in the one-time **use case form** (required once per account for Anthropic models).
- [x] Use these EU inference profile IDs. Both support the Converse API from eu-west-1 and keep data in EU Regions. Claude Sonnet 5.5 and Opus 5.5 are listed but return `AccessDeniedException: ... is not available for this account` (probe, 2 Oct 2026), so we use the 4.6 models:
  - Fast model: `eu.anthropic.claude-sonnet-4-6` (Claude Sonnet 4.6).
  - Smart model: `eu.anthropic.claude-opus-4-6-v1` (Claude Opus 4.6).
  - Check the end-of-life date on each Bedrock model card. It must be after Dec 21, 2026.
  - Do not pick Claude Haiku 4.5: Anthropic only commits to it until Oct 15, 2026, before judging ends.
- [x] Confirm both IDs are listed for your account:
  ```bash
  aws bedrock list-inference-profiles --region eu-west-1 --profile handshake \
    --query "inferenceProfileSummaries[?contains(inferenceProfileId, '4-6')].inferenceProfileId"
  ```
- [x] In the Playground, logged in as your Identity Center admin, send one test prompt to **Claude Opus 4.6**. The first call subscribes the account in AWS Marketplace; `handshake-dev` is not allowed to do that. Until then the probe fails with `not authorized to perform the required AWS Marketplace actions`. Claude Sonnet 4.6 already works.
- [x] Set `BEDROCK_MODEL_FAST` and `BEDROCK_MODEL_SMART` in `.env` to the IDs above, then run `AWS_PROFILE=handshake pnpm probe:bedrock` and `AWS_PROFILE=handshake AWS_REGION=eu-west-1 pnpm ssm:put prod`.

### [I-9] GitHub, Claude Code, and APIMatic
- [x] Create a GitHub repo named `radost-it-handshake`. Keeping it private until submission is fine; it must be public by the deadline.
- [x] Add an **MIT** license when creating the repo (GitHub shows it in the About section).
- [x] Clone the repo and copy `CLAUDE.md`, `PROJECT.md`, and `INSTRUCTIONS.md` into its root. Commit them.
- [x] Install Claude Code: https://docs.claude.com/en/docs/claude-code/overview
- [x] Install the **APIMatic Context Plugin for PayPal** in Claude Code by following APIMatic's resource page, linked from https://paypalaihackathon.devpost.com/details/apimatic. No extra APIMatic credentials are needed for PayPal.
- [x] Start Claude Code in the repo and ask it to begin **Phase 1** of `PROJECT.md`.

---

## During Phase 1

### [I-10] Store configuration in SSM and bootstrap CDK
Fill in `.env`, then copy it to SSM in one step. The script checks every value that is set, skips empty keys (for example `CHANNEL3_API_KEY` while the account is pending), and stores the keys marked `secret` in `packages/config/src/keys.ts` (`PAYPAL_CLIENT_SECRET`, `CHANNEL3_API_KEY`) as `SecureString`. Certificate ARNs go to `/handshake/certificates/…`, outside the stage. It prints parameter names, never values:

```bash
AWS_PROFILE=handshake AWS_REGION=eu-west-1 pnpm ssm:put prod
```

To set parameters by hand instead, run these in your terminal. `read -rs` keeps secrets out of your shell history and off the screen.

```bash
export AWS_PROFILE=handshake
export STAGE=prod
export REGION=eu-west-1

aws ssm put-parameter --name /handshake/$STAGE/paypal/client-id --type String --value "<client-id>" --overwrite
read -rs SECRET && aws ssm put-parameter --name /handshake/$STAGE/paypal/client-secret --type SecureString --value "$SECRET" --overwrite; unset SECRET
aws ssm put-parameter --name /handshake/$STAGE/paypal/base-url --type String --value "https://api-m.sandbox.paypal.com" --overwrite
read -rs SECRET && aws ssm put-parameter --name /handshake/$STAGE/channel3/api-key --type SecureString --value "$SECRET" --overwrite; unset SECRET
aws ssm put-parameter --name /handshake/$STAGE/bedrock/region --type String --value "$REGION" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/bedrock/model-fast --type String --value "eu.anthropic.claude-sonnet-4-6" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/bedrock/model-smart --type String --value "eu.anthropic.claude-opus-4-6-v1" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/limits/daily-token-budget --type String --value "2000000" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/limits/negotiation-max-turns --type String --value "8" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/paypal/honor-period-hours --type String --value "72" --overwrite
```

- [x] Bootstrap CDK once from **AWS CloudShell** in eu-west-1, logged in as your Identity Center admin. Bootstrap creates IAM roles, which `handshake-dev` is not allowed to do. Deployments then run through those roles, and CloudFormation is limited to `HandshakeCdkExecution`:
  ```bash
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  npx aws-cdk@latest bootstrap aws://$ACCOUNT/eu-west-1 \
    --toolkit-stack-name Handshake-CDKToolkit \
    --qualifier handshake \
    --cloudformation-execution-policies arn:aws:iam::$ACCOUNT:policy/HandshakeCdkExecution
  ```
  The custom stack name and qualifier keep the bootstrap stack, roles and asset bucket apart from any other CDK app in the account. The policies in `infra/iam/` expect the qualifier `handshake`.

- [x] Store the ARNs of the two `*.radostit.com` ACM certificates. Both must be **Issued**. CloudFront only accepts a certificate from us-east-1; the API custom domain needs one from eu-west-1. Both parameters live in eu-west-1 because the stack reads them there. Put them in `.env` as `CERTIFICATE_ARN_US_EAST_1` and `CERTIFICATE_ARN_EU_WEST_1` and run `pnpm ssm:put prod` again, or set them by hand:
  ```bash
  aws ssm put-parameter --region eu-west-1 --name /handshake/certificates/us-east-1 --type String --value "<us-east-1 certificate ARN>" --overwrite
  aws ssm put-parameter --region eu-west-1 --name /handshake/certificates/eu-west-1 --type String --value "<eu-west-1 certificate ARN>" --overwrite
  ```
- [x] Store the Route 53 hosted zone ID of `radostit.com`. CDK adds `handshake.radostit.com` (A and AAAA) and `api-handshake.radostit.com` (A) as alias records in that zone. Find the ID under **Route 53 → Hosted zones** (it starts with `Z`), or run:
  ```bash
  aws route53 list-hosted-zones-by-name --dns-name radostit.com --max-items 1 --query "HostedZones[0].Id" --output text
  ```
  Put the ID without the `/hostedzone/` prefix in `.env` as `HOSTED_ZONE_ID` and run `pnpm ssm:put prod` again, or set it by hand:
  ```bash
  aws ssm put-parameter --region eu-west-1 --name /handshake/dns/hosted-zone-id --type String --value "<hosted zone ID>" --overwrite
  ```
- [x] If the `HandshakeCdkExecution` policy was created before this step was added, replace its JSON with the current `infra/iam/cdk-execution-policy.json` (**IAM → Policies → HandshakeCdkExecution → Edit → JSON**). The new statements let CloudFormation change only the two Handshake records.
- [x] If you already added `handshake` or `api-handshake` records to the zone by hand, delete them before the next deploy. CloudFormation cannot create a record that already exists.
- [x] Add the workload permissions boundary before the next deploy. CloudFormation may now only create Handshake roles that carry this boundary, so no deploy can give a Lambda more access than the boundary lists. In the console, logged in as your Identity Center admin:
  1. **IAM → Policies → Create policy → JSON**. Paste `infra/iam/workload-boundary.json` and name it exactly `HandshakeWorkloadBoundary`.
  2. Open **IAM → Policies → HandshakeCdkExecution → Edit → JSON** and replace it with the current `infra/iam/cdk-execution-policy.json`.
  3. Deploy: `AWS_PROFILE=handshake pnpm cdk:deploy`. Every existing role gets the boundary in place; nothing is replaced.
  - When a later phase uses a new AWS service from a Lambda (Step Functions, EventBridge, WebSocket API), Claude Code updates `workload-boundary.json` and this step comes back: paste the new JSON into `HandshakeWorkloadBoundary` before deploying.
- [x] The webhook ID parameter is added in [I-11].

### [I-10b] Create the logo
- [x] Generate the logo with an image model, using the Forge logo as a style reference and the prompt below.
- [x] Check the spelling of "HANDSHAKE" and "BY RADOST IT" letter by letter; image models often misspell text.
- [x] Save the file as `apps/web/public/logo.png` (1024×1024), then tell Claude Code.

### [I-10c] Register the site in Seven
The web app loads the Seven script with `data-domain-id="handshake.radostit.com"`. Seven rejects page views from domains it does not know.
- [x] In Seven by Radost IT, add the domain `handshake.radostit.com` with an active subscription, so it is in the edge KeyValueStore.
- [x] After the next deploy, open https://handshake.radostit.com and check that a visit appears in Seven. The script records nothing on `localhost`, because it needs HTTPS and a matching host.

### [I-10d] Turn on the contact and newsletter forms
The web forms post to the shared Radost IT contact Lambda with the website key `handshake.radostit.com`. The web server signs a spam challenge with its own secret.
- [x] Generate the secret into `.env`: `echo "FORM_SIGNING_SECRET=$(openssl rand -hex 32)" >> .env`.
- [x] Copy it to SSM: `AWS_PROFILE=handshake AWS_REGION=eu-west-1 pnpm ssm:put prod`.
- [x] In `radostit-app-lambdas`, commit and deploy the contact Lambda with `handshake.radostit.com` in `lambdas/contact/src/constants/websites.ts`. The Lambda rejects unknown website keys.
- [x] Deploy Handshake: `AWS_PROFILE=handshake pnpm cdk:deploy`.
- [x] Send a test message from https://handshake.radostit.com/contact and subscribe from the footer.

---

## During Phase 2

### [I-11] Register the PayPal webhook
The webhook endpoint is built in Phase 2. After the first deploy that includes it, the CDK output prints a `WebhookUrl`, which will be `https://api-handshake.radostit.com/webhooks/paypal`. The Phase 1 stack has no webhook yet, so its output only shows `ApiUrl`, `WebUrl` and `TableName`.

- [x] In the PayPal developer dashboard (Sandbox), open your app → **Webhooks → Add Webhook**.
- [x] Paste the `WebhookUrl`. Select these events if listed: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`.
- [x] Copy the **Webhook ID** and store it:
  ```bash
  aws ssm put-parameter --name /handshake/$STAGE/paypal/webhook-id --type String --value "<webhook-id>" --overwrite
  ```
- [x] Deploy the webhook endpoint and the deal lifecycle. They publish to an EventBridge bus and resume Step Functions executions, which the boundary did not allow before:
  1. Open **IAM → Policies → HandshakeWorkloadBoundary → Edit → JSON** and replace it with the current `infra/iam/workload-boundary.json`.
  2. Add `PAYPAL_HONOR_PERIOD_HOURS=72` to `.env`, then run `pnpm ssm:put prod`. The webhook Lambda loads the whole config when it starts and fails with a `ConfigError` naming any missing key. `CHANNEL3_API_KEY` may stay empty until [I-5] is done; only Channel3 searches need it.
  3. Deploy: `AWS_PROFILE=handshake pnpm cdk:deploy`. The output `WebhookUrl` must match the URL you registered above.
  - The dashboard's webhook simulator sends events that PayPal's verification API cannot verify, so the endpoint answers them with 401. Real sandbox payments are verified; the endpoint logs `PayPal webhook published` for each one.

---

## During Phase 4

### [I-12] Check Payouts in sandbox
- [x] Claude Code ran `pnpm probe:paypal-payout` on 3 Oct 2026 (batch `ZSCGUYEYN43GS`, 1.00 USD). Log in to the arena recipient sandbox account at https://www.sandbox.paypal.com and confirm the payment arrived. You can run the probe again yourself; each run pays another 1.00 USD.
- [x] If Payouts fails with a permissions error, check the app's features in the dashboard and ask on Discord.

### [I-20] Let the arena API start ArenaRun
`POST /arena/attempts` starts the ArenaRun state machine. The workload boundary did not allow `states:StartExecution`, so the call failed with 500. In the console, logged in as your Identity Center admin:
- [x] Open **IAM → Policies → HandshakeWorkloadBoundary → Edit → JSON** and replace it with the current `infra/iam/workload-boundary.json`. No deploy is needed; the change applies within seconds.
- [x] Open **IAM → Policies → HandshakeDeveloper → Edit → JSON** and replace it with the current `infra/iam/developer-policy.json`. The `handshake` profile can then read the Lambda log groups and the ArenaRun executions.

### [I-19] Choose where arena deals come from
- [x] Add `ARENA_DEAL_SOURCE=templates` to `.env` and run `pnpm ssm:put prod`. Arena attempts then play one of the fixed deal templates. Without the key, the app also uses the templates.
- [ ] Once Channel3 works ([I-5]), run `pnpm seed:sellers <table>`, set `ARENA_DEAL_SOURCE=sellers`, and run `pnpm ssm:put prod` again. Arena attempts then play against the seeded sellers. Running Lambdas read the new value on their next cold start.

### [I-21] Try the arena pages
The arena pages call the deployed API, which accepts browser calls only from https://handshake.radostit.com. They do not work from `pnpm dev` on localhost.
- [ ] Run `pnpm cdk:deploy`. It ships the arena pages, the `GET /arena/deals`, `/arena/stats`, `/arena/leaderboard` and `/arena/challengers/me/attempts` routes, and the ArenaRun step that marks failed attempts.
- [ ] Open https://handshake.radostit.com/arena, pick a handle, and launch one attack. The attempt page should switch from running to a result within about a minute.
- [ ] Open https://handshake.radostit.com/arena/leaderboard and check that your handle is listed under All time.
---

## During Phase 5

### [I-13] Production check and judge accounts
- [ ] After the final deploy, open https://handshake.radostit.com in a private browser window and complete one deal and one arena attack using only the demo buyer sandbox login.
- [x] Confirm the AWS Budgets alerts reach your email.

---

## Submission (Nov 9–12)

### [I-14] Record the demo video
- [ ] Follow `docs/demo-script.md` (under 3 minutes).
- [ ] Record the real hosted app, not mockups. Hide the browser bookmarks bar and any personal tabs.
- [ ] Use no copyrighted music. Royalty-free tracks you are licensed to use, or no music, are fine.
- [ ] Show no third-party trademarks or copyrighted material: pick unbranded or generic products for the recorded deals, and use no vendor logos (AWS, Anthropic, and others) on the architecture slide. PayPal and Channel3 marks only if [I-2] question 4 says yes.
- [ ] Narrate in English, or add English subtitles.
- [ ] Upload to YouTube with visibility set to **Public**.

### [I-15] Make the repository ready
- [ ] Make the repo **public**.
- [ ] Check that the MIT license appears in the repo's About section.
- [ ] Check that the README shows the hosted URL, the demo sandbox buyer login, and the judge access code, and says the hosted URL is the supported test path.
- [ ] Search the repo for secrets: `git grep -nE "(secret|password|api[_-]?key)"` and review every hit.

### [I-16] Submit on Devpost
- [ ] Paste the text from `docs/submission.md`.
- [ ] Add the YouTube link, GitHub link, hosted app URL, and list of tools used.
- [ ] Select the **AG Grid**, **Channel3**, and **APIMatic** sponsor prizes.
- [ ] Submit at least 24 hours before **Nov 12, 2:00 pm PT**. Drafts can be edited until the deadline; after it, nothing in the submission can change.
- [ ] Confirm Claude Code has pushed the `submission` tag on the submitted commit.

### [I-17] Sponsor forms
- [ ] Claim the APIMatic free subscription using the form linked on https://paypalaihackathon.devpost.com/details/apimatic (you used the Context Plugin).
- [ ] Open https://paypalaihackathon.devpost.com/details/aggrid and check for any AG Grid form or extra step. Do not activate the 45-day AG Studio or Enterprise trial; we use the free Community editions so nothing expires before judging ends.

---

## After submission (Nov 13 – Dec 21)

### [I-18] Keep the app online
- [ ] Do not push to `main` or edit the Devpost submission; the rules freeze both after the deadline.
- [ ] Do not change PayPal app credentials, delete sandbox accounts, or rotate the Channel3 key.
- [ ] The app must stay free and unrestricted for judges until at least Dec 15, 8:00 am PT.
- [ ] Watch the health-check and budget alert emails; if something breaks, reproduce and fix it locally first.
- [ ] Check Channel3 credit usage weekly and ask for a top-up if needed.
- [ ] Keep AWS resources running until winners are announced (around Dec 21). Delete the stacks afterwards if you no longer need them.
