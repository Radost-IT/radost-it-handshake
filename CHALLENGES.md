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

To measure authorization limits without a browser login, the probe pays with a PayPal sandbox test card. Creating the order failed with `422 PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING: Payee account is not setup to be able to process card payments`. Card payments are a separate feature of the sandbox app. The probe now stops with a pointer to the manual step in `INSTRUCTIONS.md` [I-3], and the limits stay unmeasured until the feature is on.
