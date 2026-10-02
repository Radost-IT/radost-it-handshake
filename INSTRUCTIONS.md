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
- [ ] Join the PayPal Discord: https://discord.gg/sJ2G6DyvSK (the PayPal, Channel3, APIMatic, and AG Grid teams answer there).
- [ ] Register for the webinars: Oct 6 (Start building with PayPal), Oct 7 (APIMatic Context Plugins), Oct 13 (Start building with PayPal, repeat).
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
- [ ] Log in at https://developer.paypal.com with your PayPal account (create one if needed).
- [ ] Make sure the dashboard toggle is set to **Sandbox**.
- [ ] Go to **Apps & Credentials → Create App**, type **Merchant**, name it `radost-it-handshake`.
- [ ] Keep the page open: you will need the **Client ID** and **Secret** in step [I-10]. Do not save them in a text file.
- [ ] In the app settings, make sure these features are enabled if listed: **Accept payments**, **Payouts**, **Transaction search**.

### [I-4] Sandbox test accounts
- [ ] Go to **Testing Tools → Sandbox Accounts**. PayPal creates one Business and one Personal account by default.
- [ ] Create two more **Personal** accounts: one for demo buyers (judges will use it), one as the arena bounty recipient.
- [ ] For each account, open **View/Edit account** and note the email and password in your password manager.
- [ ] The default Business account is the merchant behind your app. Check that it has a sandbox balance, because Payouts are paid from it.
- [ ] Later, the demo buyer login goes into the README for judges. These are sandbox-only credentials, so sharing them is fine.

### [I-5] Channel3 API key
- [ ] Sign up at https://trychannel3.com/developers (no credit card).
- [ ] Create an API key in the dashboard; you get 20,000 free hackathon credits.
- [ ] If credits run low later, ask in the `#channel3` channel on the PayPal Discord for a top-up.

### [I-6] AWS account
- [x] Create an AWS account at https://aws.amazon.com, or use an existing one.
- [x] If new: choose the **Paid plan**. You still receive the free credits, but the Free plan closes the account when credits run out or after six months, which could take the demo offline during judging.
- [x] Enable **MFA** on the root user, then stop using the root user.
- [x] Open **IAM Identity Center**, enable it, and create a user for yourself with the **AdministratorAccess** permission set on this account.
- [x] Use **eu-west-1** (Ireland) for everything. Check in the Bedrock console's model catalog that the Anthropic models you want are listed there.
- [x] Open **Billing → Budgets** and create a monthly cost budget with email alerts at $10, $25, and $50.

### [I-7] Tools on your computer
- [x] Node.js LTS (20 or newer): https://nodejs.org
- [x] pnpm: `npm install -g pnpm`
- [x] AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- [ ] Create a least-privilege IAM user for the terminal. Do this in the console, logged in as your Identity Center admin:
  1. **IAM → Policies → Create policy → JSON**. Paste `infra/iam/cdk-execution-policy.json` and name it `HandshakeCdkExecution`.
  2. Create another policy from `infra/iam/developer-policy.json` and name it `HandshakeDeveloper`.
  3. **IAM → Users → Create user** `handshake-dev`, with no console access. Attach `HandshakeDeveloper`.
  4. Open the user, go to **Security credentials → Create access key**, and choose **Command Line Interface**.
- [ ] Add the key to a local profile and check it:
  ```bash
  aws configure --profile handshake    # paste the key and secret, region eu-west-1, output json
  aws sts get-caller-identity --profile handshake    # should print your account ID and the handshake-dev user
  ```
- [ ] Delete the access key after judging ends.
- [x] Docker is **not** required.

### [I-8] Bedrock access to Anthropic models
- [ ] In the AWS console, open **Amazon Bedrock** in your region. The old Model access page is retired; models are enabled on first use.
- [ ] Open the **Playground**, select an Anthropic Claude model, and send a test prompt. If asked, fill in the one-time **use case form** (required once per account for Anthropic models).
- [ ] Find the **inference profile IDs** for one fast model and one stronger model (newer Anthropic models are invoked through inference profiles):
  ```bash
  aws bedrock list-inference-profiles --region eu-west-1 --profile handshake \
    --query "inferenceProfileSummaries[].inferenceProfileId"
  ```
- [ ] Note the two IDs for step [I-10].

### [I-9] GitHub, Claude Code, and APIMatic
- [x] Create a GitHub repo named `radost-it-handshake`. Keeping it private until submission is fine; it must be public by the deadline.
- [x] Add an **MIT** license when creating the repo (GitHub shows it in the About section).
- [x] Clone the repo and copy `CLAUDE.md`, `PROJECT.md`, and `INSTRUCTIONS.md` into its root. Commit them.
- [x] Install Claude Code: https://docs.claude.com/en/docs/claude-code/overview
- [ ] Install the **APIMatic Context Plugin for PayPal** in Claude Code by following APIMatic's resource page, linked from https://paypalaihackathon.devpost.com/details/apimatic. No extra APIMatic credentials are needed for PayPal.
- [x] Start Claude Code in the repo and ask it to begin **Phase 1** of `PROJECT.md`.

---

## During Phase 1

### [I-10] Store configuration in SSM and bootstrap CDK
Run these in your terminal. `read -rs` keeps secrets out of your shell history and off the screen.

```bash
export AWS_PROFILE=handshake
export STAGE=demo
export REGION=eu-west-1

aws ssm put-parameter --name /handshake/$STAGE/paypal/client-id --type String --value "<client-id>" --overwrite
read -rs SECRET && aws ssm put-parameter --name /handshake/$STAGE/paypal/client-secret --type SecureString --value "$SECRET" --overwrite; unset SECRET
aws ssm put-parameter --name /handshake/$STAGE/paypal/base-url --type String --value "https://api-m.sandbox.paypal.com" --overwrite
read -rs SECRET && aws ssm put-parameter --name /handshake/$STAGE/channel3/api-key --type SecureString --value "$SECRET" --overwrite; unset SECRET
aws ssm put-parameter --name /handshake/$STAGE/bedrock/region --type String --value "$REGION" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/bedrock/model-fast --type String --value "<fast-inference-profile-id>" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/bedrock/model-smart --type String --value "<smart-inference-profile-id>" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/limits/daily-token-budget --type String --value "2000000" --overwrite
aws ssm put-parameter --name /handshake/$STAGE/limits/negotiation-max-turns --type String --value "8" --overwrite
```

- [ ] Bootstrap CDK once from **AWS CloudShell** in eu-west-1, logged in as your Identity Center admin. Bootstrap creates IAM roles, which `handshake-dev` is not allowed to do. Deployments then run through those roles, and CloudFormation is limited to `HandshakeCdkExecution`:
  ```bash
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  npx aws-cdk@latest bootstrap aws://$ACCOUNT/eu-west-1 \
    --toolkit-stack-name Handshake-CDKToolkit \
    --qualifier handshake \
    --cloudformation-execution-policies arn:aws:iam::$ACCOUNT:policy/HandshakeCdkExecution
  ```
  The custom stack name and qualifier keep the bootstrap stack, roles and asset bucket apart from any other CDK app in the account. The policies in `infra/iam/` expect the qualifier `handshake`.

- [ ] Store the ARNs of the two `*.radostit.com` ACM certificates. Both must be **Issued**. CloudFront only accepts a certificate from us-east-1; the API custom domain needs one from eu-west-1. Both parameters live in eu-west-1 because the stack reads them there:
  ```bash
  aws ssm put-parameter --region eu-west-1 --name /handshake/certificates/us-east-1 --type String --value "<us-east-1 certificate ARN>" --overwrite
  aws ssm put-parameter --region eu-west-1 --name /handshake/certificates/eu-west-1 --type String --value "<eu-west-1 certificate ARN>" --overwrite
  ```
- [ ] After the first deploy, add two CNAME records where `radostit.com` DNS is managed. The deploy prints the targets as `WebDnsTarget` and `ApiDnsTarget`:

  | Name | CNAME target |
  | --- | --- |
  | `handshake.radostit.com` | `WebDnsTarget` (a `*.cloudfront.net` name) |
  | `api-handshake.radostit.com` | `ApiDnsTarget` (a `d-*.execute-api.eu-west-1.amazonaws.com` name) |
- [ ] The webhook ID parameter is added in [I-11].

---

## During Phase 2

### [I-11] Register the PayPal webhook
After Claude Code's first deploy, the CDK output prints a `WebhookUrl`.

- [ ] In the PayPal developer dashboard (Sandbox), open your app → **Webhooks → Add Webhook**.
- [ ] Paste the `WebhookUrl`. Select these events if listed: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`.
- [ ] Copy the **Webhook ID** and store it:
  ```bash
  aws ssm put-parameter --name /handshake/$STAGE/paypal/webhook-id --type String --value "<webhook-id>" --overwrite
  ```

---

## During Phase 4

### [I-12] Check Payouts in sandbox
- [ ] When Claude Code runs the Payouts probe, log in to the arena recipient sandbox account at https://www.sandbox.paypal.com and confirm the payment arrived.
- [ ] If Payouts fails with a permissions error, check the app's features in the dashboard and ask on Discord.

---

## During Phase 5

### [I-13] Demo stage and judge accounts
- [ ] After the final deploy, open https://handshake.radostit.com in a private browser window and complete one deal and one arena attack using only the demo buyer sandbox login.
- [ ] Confirm the AWS Budgets alerts reach your email.

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
- [ ] Add the YouTube link, GitHub link, hosted demo URL, and list of tools used.
- [ ] Select the **AG Grid**, **Channel3**, and **APIMatic** sponsor prizes.
- [ ] Submit at least 24 hours before **Nov 12, 2:00 pm PT**. Drafts can be edited until the deadline; after it, nothing in the submission can change.
- [ ] Confirm Claude Code has pushed the `submission` tag on the submitted commit.

### [I-17] Sponsor forms
- [ ] Claim the APIMatic free subscription using the form linked on https://paypalaihackathon.devpost.com/details/apimatic (you used the Context Plugin).
- [ ] Open https://paypalaihackathon.devpost.com/details/aggrid and check for any AG Grid form or extra step. Do not activate the 45-day AG Studio or Enterprise trial; we use the free Community editions so nothing expires before judging ends.

---

## After submission (Nov 13 – Dec 21)

### [I-18] Keep the demo alive
- [ ] Do not push to `main` or edit the Devpost submission; the rules freeze both after the deadline.
- [ ] Do not change PayPal app credentials, delete sandbox accounts, or rotate the Channel3 key.
- [ ] The demo must stay free and unrestricted for judges until at least Dec 15, 8:00 am PT.
- [ ] Watch the health-check and budget alert emails; if something breaks, reproduce and fix it locally first.
- [ ] Check Channel3 credit usage weekly and ask for a top-up if needed.
- [ ] Keep AWS resources running until winners are announced (around Dec 21). Delete the stacks afterwards if you no longer need them.
