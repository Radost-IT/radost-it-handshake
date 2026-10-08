# Challenges

Problems we hit while building Handshake, and what we did about them. Add an entry when it happens, while the details are fresh. The "Challenges we ran into" answer in `docs/submission.md` is written from this file.

Each entry says what we expected, what happened, and how we solved it. Quote exact error messages. Newest entries go at the bottom.

## Claude 5.5 models listed on Bedrock but not usable

*2 Oct 2026 · Bedrock*

Bedrock lists the Claude Sonnet 5.5 and Opus 5.5 EU inference profiles in eu-west-1, so we picked them. The probe script failed with `AccessDeniedException: ... is not available for this account`. We moved to Claude Sonnet 4.6 and Opus 4.6. We also ruled out Claude Haiku 4.5, because it is only guaranteed until 15 Oct 2026 and judging runs until December.

Opus 4.6 then failed with `not authorized to perform the required AWS Marketplace actions`. The first call to a model subscribes the account in AWS Marketplace, and our least-privilege deploy user may not do that. One test prompt in the Bedrock playground, sent as the admin, fixed it.

## Next.js 16 on AWS without Amplify or SST

*2 Oct 2026 · Web hosting*

We wanted the web app in the same CDK stack as the API. The `cdk-nextjs-standalone` construct does this, but it defaults to OpenNext 3, which does not support Next.js 16.3. We pinned `@opennextjs/aws` to 4.1.6.

Two more details kept `cdk synth` fast and offline. The construct runs a full Next.js build on every synth, including in tests, so the root scripts now run `open-next build` once and the stack uses `skipBuild`. Its domain helper looks up the Route 53 zone at synth time, so we create the DNS records ourselves from a zone ID stored in SSM.

## The permissions boundary blocked the web deploy and froze the rollback

*2 Oct 2026 · IAM and CloudFormation*

Every role the stack creates must carry a permissions boundary, so a deploy can never give a Lambda more access than we allow. The first boundary did not let the Next.js deployment rewrite the server bundle in the CDK assets bucket, so the production deploy failed.

The rollback then failed as well and left the stack in `UPDATE_ROLLBACK_FAILED`. To roll back, CloudFormation tried to remove the boundary from each role, and our execution policy forbids exactly that. We widened the boundary to cover the assets bucket and finished the rollback from CloudShell as the admin with `continue-update-rollback`, skipping the affected roles.

## Deleting the stack failed on resources we did not create directly

*2 Oct 2026 · IAM and CloudFormation*

The Next.js construct adds a DynamoDB table with auto scaling and an SQS queue with a Lambda event source mapping for page revalidation. Deleting the stack failed on `application-autoscaling`, `lambda:GetEventSourceMapping`, and `iam:DetachRolePolicy`, which our narrow execution policy did not allow. We added those actions. Detaching a policy only removes access, so it does not need the boundary condition.

## Guessing secrets from key names was unsafe

*2 Oct 2026 · Configuration*

The script that copies `.env` to SSM first decided which keys were secrets by name endings such as `_SECRET` or `_KEY`. A new secret with a different name would have been stored as a plain `String` parameter. Each key in `packages/config` is now marked `secret` explicitly, and only those keys become `SecureString`.

## One failed PayPal token request could break a warm Lambda

*2 Oct 2026 · PayPal SDK*

We expected the PayPal Server SDK to fetch a new OAuth token after a failed one. Reading its auth adapter showed that it stores the token request as a shared promise. If that promise rejects once, every later call on the same client re-throws the same error. Our client lives outside the Lambda handler, so one PayPal blip would break every request until the container is recycled.

We now pass our own `oAuthTokenProvider`. On failure it keeps the error and returns an expired token. That call fails with the SDK's `OAuth token is expired. A valid token is needed to make API calls.`, which we replace with the original token error. The next call fetches a fresh token. A unit test covers the failure and the recovery.

## The sandbox app could not take card payments

*2 Oct 2026 · PayPal sandbox*

To measure authorization limits without a browser login, the probe pays with a PayPal sandbox test card. Creating the order failed with `422 PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING: Payee account is not setup to be able to process card payments`. Card payments are a separate feature of the sandbox app. The probe now stops and says to enable card payments in the PayPal app settings, and the limits stay unmeasured until the feature is on.

The first sandbox app sat on a non-US Business account, and its settings did not offer card payments. A new app on a new US sandbox Business account did. With cards on, the probe failed again: `422 ORDER_ALREADY_AUTHORIZED: Order already authorized.If 'intent=AUTHORIZE' only one authorization per order is allowed.` A card order with intent AUTHORIZE is authorized when it is created, with status `COMPLETED`. The probe now reads the authorization from the order instead of calling authorize. Buyer-approved PayPal orders still need the authorize call.

Measured on 3 Oct 2026:

- An authorization is valid for 696 hours (29 days).
- Reauthorizing right away fails with `REAUTHORIZATION_TOO_SOON`. We keep the 72-hour honor period from the PayPal docs; the probe cannot wait three days.
- Capture and void replay PayPal's first answer when the `PayPal-Request-Id` repeats.
- A second capture with a new request ID fails with `AUTHORIZATION_ALREADY_CAPTURED`; voiding after capture fails with `PREVIOUSLY_CAPTURED`.
- A second void fails with `PREVIOUSLY_VOIDED`; capturing after void fails with `AUTHORIZATION_VOIDED`.

## Cookie consent log has no DNS record

*3 Oct 2026 · Web*

We expected to reuse the cookie bar from radost-it-forge, which posts each consent to `https://stats.radostit.com/cookies/new`. That host does not resolve: `dig +short stats.radostit.com` prints nothing and `curl` ends with code `000`. Forge catches the error and drops it, so the failure was invisible there.

Handshake sets only functional cookies and Seven uses none, so the notice needs no consent record. The bar stores the acknowledgment in the browser and sends nothing.

## The PayPal Server SDK has no Payouts

*3 Oct 2026 · PayPal SDK*

We expected to pay arena bounties through the PayPal Server SDK, like the escrow calls. Version 2.5.0 has controllers for orders, payments, vault, subscriptions and transaction search, but none for Payouts. We call `POST /v1/payments/payouts` through the SDK's authenticated request builder instead, the same way we verify webhooks. The call keeps the shared OAuth token, retries and typed errors, and sends a `PayPal-Request-Id` like every other money call. The sandbox probe paid 1.00 USD and returned batch status `PENDING`.

## Submitting an arena attempt returned 500

*3 Oct 2026 · IAM*

We expected `POST /arena/attempts` to start the ArenaRun state machine, because CDK granted the API role `states:StartExecution`. The API answered `{"message":"Internal Server Error"}`. Every Handshake role carries the `HandshakeWorkloadBoundary` permissions boundary, and AWS allows only actions that both the role policy and the boundary allow. The boundary listed the Step Functions task callbacks but not `StartExecution`, so the call was denied at run time even though the deploy succeeded.

The boundary now allows `states:StartExecution` on `Handshake-*` state machines. An infra test compares every action the stack grants with the boundary and fails when one is missing, so the next gap shows up in `pnpm test` instead of in production. The developer policy also gained read access to the `Handshake-*` log groups and to ArenaRun executions, so failures like this can be read from the terminal.

## The ESM Lambda bundles could not load the PayPal SDK

*3 Oct 2026 · Lambda bundling*

We expected the first ArenaRun execution to reach the model calls. The Lambda failed while loading with `Error: Dynamic require of "util" is not supported`. The functions are bundled as ES modules, and the PayPal Server SDK pulls in CommonJS packages that call `require` for Node built-ins such as `util`, `http` and `zlib`. An ES module has no `require`, so esbuild's fallback throws. The deal workflows and the PayPal webhook bundles had the same calls; no real deal had reached them yet.

Every function now uses one bundling setting whose banner defines `require` with `createRequire(import.meta.url)`. A local esbuild bundle of the SDK threw the same error without the banner and loaded with it.

## Arena stats and leaderboard returned 500

*3 Oct 2026 · IAM*

We expected the new `GET /arena/stats` and `GET /arena/leaderboard` routes to work after the deploy, since their store functions passed the unit tests. Both answered `{"message":"Internal Server Error"}` and the arena pages showed "The arena is not answering. Try again soon". The Lambda log said `is not authorized to perform: dynamodb:BatchGetItem on resource: arn:aws:dynamodb:eu-west-1:...:table/Handshake-prod-Table... because no identity-based policy allows the dynamodb:BatchGetItem action`, and the same for `dynamodb:Query`. The unit tests use a fake DynamoDB client, so they never see IAM. The arena API role had only `GetItem`, `PutItem` and `UpdateItem`.

The role now also has `BatchGetItem` and `Query`, which the boundary already allowed. An infra test checks the arena API role's actions, so a missing read grant fails `pnpm test`.

## Route 53 renamed the SES DKIM records

*3 Oct 2026 · Email and DNS*

SES gives three DKIM tokens for the domain, and each needs a CNAME record named `<token>._domainkey.handshake.radostit.com`. We first used the CDK `CnameRecord` construct with the record name from the SES identity. That name is a deploy-time token, and the construct cannot see that it already ends with the zone name, so it appends the zone name again. The records would have been named `<token>._domainkey.handshake.radostit.com.handshake.radostit.com` and DKIM would never verify.

We switched to the low-level `CfnRecordSet`, which takes the name as given. A stack test now checks that the three DKIM records are in the zone.

The same day we moved arena email to ZeptoMail, the service radost-it-forge already uses, so the SES identity and these records were removed before they were ever deployed.

## The verifier wrote longer rationales than its schema allowed

*5 Oct 2026 · Bedrock evals*

The verifier's `criterion_verdict` tool asks for a rationale of one or two sentences, and the zod schema capped it at 500 characters. The tool's JSON schema sent to Bedrock carried the same `maxLength`, so we expected the model to stay under it. In an eval run it did not, and one scenario failed the whole run with `LlmOutputError: criterion_verdict output is invalid: ✖ Too big: expected string to have <=500 characters → at rationale`.

The decision is in `met` and `confidence`, not in the explanation, so the verifier now shortens a long rationale to 500 characters instead of rejecting the verdict. The eval runner also records a scenario that throws as a failed result, so one bad reply no longer stops the other scenarios.

The same run showed that the verifier gives text-only evidence a confidence of 0.75, below the 0.8 threshold, because it cannot see the photo the seller describes. Honest deliveries with text evidence therefore go to a person instead of being captured. The report at `/evals` shows this as the one failing baseline scenario.

## Honest text evidence escalated, and long negotiation messages failed a turn

*6 Oct 2026 · Bedrock evals*

Two baseline scenarios still failed. In `09-good-evidence` we expected a capture, because the seller's description states both facts the contract asks for. The verifier kept escalating with `ESCALATE: Not sure whether these are met: capacity, lid`. Its rationale said the photo "is not provided for independent verification", so it scored 0.75 against the 0.8 threshold. Evidence in Handshake is always text, so every honest delivery would have gone to a person.

The verifier prompt now says that photos and independent measurements are never available, and gives a confidence scale: 0.9 or more when the description states the exact fact, about 0.5 when it only hints at it, 0.2 or less when it does not address it. Scenario 09 now captures. The injected and vague evidence scenarios (14 and 15) now escalate instead of voiding. No money moves in either case, so both still pass.

In `03-no-overlap` a seller turn failed with `negotiation_move output is invalid: ✖ Too big: expected string to have <=600 characters → at message`. We fixed it the same way as the long rationales: the negotiator shortens a long message to 600 characters, and both agents share one `shortenText` helper. All 15 scenarios pass.

## Catalog deals failed while the Channel3 key was pending

*7 Oct 2026 · Channel3, Deal API*

We expected the Channel3 API key before the demo. It has not arrived, so `/handshake/prod/channel3/api-key` was never set. Every deal opened without a seller ID ended as "No deal" within four seconds. The DealAgents logs showed `ConfigError: Invalid configuration: CHANNEL3_API_KEY is missing`, and the deal page showed no reason at all. Deals with a seller ID could not help either, because the only seller records came from Channel3 products.

`pnpm seed:template-sellers <table>` now saves the five arena sellers (`arena-backpack` and the others) as seller records. Deals that name one of them negotiate without Channel3. When the key is missing, the agents end a catalog deal with "Product search is not available right now. Open the deal again with a seller ID, such as arena-backpack", and the deal page shows why a deal stopped.

## The verifier doubted honest claims about condition

*7 Oct 2026 · Bedrock, verifier*

On the live site, a delivery that stated every acceptance criterion in the contract's own words went to the buyer instead of being captured, with `ESCALATE: Not sure whether these are met: c4`. Criterion c4 was "The backpack is in new, unused condition". We expected a capture, because the evidence states the fact exactly. Run eight times, the same contract and evidence captured once. The rationales gave two reasons that do not fit Handshake: "this is solely the seller's own claim with no independent verification" (confidence 0.5), and "the statement reads almost like a verbatim echo of the criterion itself" (0.7 to 0.75, below the 0.8 threshold).

The verifier prompt now says that every statement in the evidence is a seller's claim by design, including condition claims, and that wording copied from the contract still states the fact. New eval scenario `16-restated-criteria` holds that exact case. It captured six runs out of six after the change. The injected, vague and unmet evidence scenarios (13 to 15) still void or escalate, and all 16 scenarios pass.

## AG Grid styles and sizing silently did nothing

*7 Oct 2026 · Web, AG Grid Community*

We expected `cellClass: 'font-mono'` to style the deal and audit grids, and `autoSizeStrategy` to fit the evals grid. Neither did. AG Grid 33 and later split features into modules, and our grids registered only `ClientSideRowModelModule`. The browser console showed `AG Grid: error #200` with `moduleName=ColumnAutoSize`, while missing `CellStyleModule` dropped every `cellClass` without a visible error. A second surprise: a column's own `cellClass` replaces the class that `type: 'rightAligned'` adds, so numbers moved to the left.

Each grid now registers `CellStyleModule`, plus `ColumnAutoSizeModule`, `RowAutoHeightModule` or `PaginationModule` where it uses them. Right-aligned columns that set `cellClass` add `text-right` themselves.
