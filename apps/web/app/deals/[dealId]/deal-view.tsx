'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Panel } from '../../components/panel';
import { dealTopic, useLiveEvents } from '../../live-events';
import {
  API_KEY_STORAGE_KEY,
  DealApiError,
  fetchDealRecord,
  finalDealStates,
  messageOf,
  sendHumanDecision,
  sendPurchaseApproval,
  submitEvidence,
  type ContractTerms,
  type DealCredential,
  type DealRecord,
  type Evidence,
  type HumanDecision,
  type Money,
} from '../api';
import { sampleEvidence, type SampleDelivery } from './sample-evidence';
import { escrowSteps, paypalActivity, type StepStatus } from './timeline';

// Live events refetch at once; polling only covers a dropped WebSocket.
const POLL_INTERVAL_MS = 15_000;

type ViewState =
  | { kind: 'loading' }
  | { kind: 'no-token' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; record: DealRecord };

const stateLabels: Record<string, string> = {
  DRAFT: 'Draft',
  NEGOTIATING: 'Negotiating',
  AGREED: 'Agreed',
  AWAITING_HUMAN_APPROVAL: 'Waiting for your approval',
  AUTHORIZING: 'Waiting for PayPal checkout',
  IN_ESCROW: 'Funds held',
  AWAITING_DELIVERY: 'Waiting for delivery',
  VERIFYING: 'Checking delivery',
  ESCALATED: 'Needs your decision',
  CAPTURING: 'Capturing payment',
  VOIDING: 'Releasing the hold',
  SETTLED: 'Settled',
  REFUSED: 'Refused, no charge',
  CANCELLED: 'Cancelled',
  ABANDONED: 'No deal',
};

const stepDotStyles: Record<StepStatus, string> = {
  done: 'bg-settled border-settled',
  current: 'border-held animate-pulse',
  pending: 'border-line',
  stopped: 'border-refused bg-refused',
};

const stoppedStates = new Set(['REFUSED', 'CANCELLED', 'ABANDONED']);

/** Why a deal ended without settling, from the event that moved it there. */
function stopReason(record: DealRecord): string | undefined {
  if (!stoppedStates.has(record.deal.state)) return undefined;
  const stop = record.events.findLast(
    (event) => event.type === 'STATE_CHANGED' && event.to === record.deal.state,
  );
  return stop?.type === 'STATE_CHANGED' ? stop.reason : undefined;
}

const formatMoney = (money: Money) => `${money.value} ${money.currency}`;
const formatTime = (at: string) => new Date(at).toLocaleString();
const tokenStorageKey = (dealId: string) => `handshake-deal-token:${dealId}`;

/**
 * The buyer link carries the deal access token in the URL fragment, which
 * browsers never send to a server. The page keeps it for the tab and removes
 * it from the address bar so it does not end up in screenshots or history.
 */
function takeDealToken(dealId: string): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('token');
  try {
    if (fromLink) {
      sessionStorage.setItem(tokenStorageKey(dealId), fromLink);
      window.history.replaceState(null, '', window.location.pathname);
      return fromLink;
    }
    // A developer who comes from the console acts with their API key. Without
    // one, null makes the page act as the signed-in account.
    return (
      sessionStorage.getItem(tokenStorageKey(dealId)) ?? sessionStorage.getItem(API_KEY_STORAGE_KEY)
    );
  } catch {
    // Storage can be blocked. The token from the link still works for this visit.
    return fromLink;
  }
}

// Without a token the page tries the session, which fails for anyone but the deal's developer.
const isRefused = (error: unknown) =>
  error instanceof DealApiError && (error.status === 401 || error.status === 404);

export function DealView({ dealId }: { dealId: string }) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  // Undefined until the page has looked for a token.
  const [credential, setCredential] = useState<DealCredential | undefined>(undefined);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    setCredential(takeDealToken(dealId));
  }, [dealId]);

  useLiveEvents([dealTopic(dealId)], () => {
    setRefreshes((count) => count + 1);
  });

  useEffect(() => {
    if (credential === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    const poll = () => {
      fetchDealRecord(dealId, credential)
        .then((record) => {
          if (!isActive) return;
          setState({ kind: 'ready', record });
          if (!finalDealStates.some((final) => final === record.deal.state)) {
            timer = setTimeout(poll, POLL_INTERVAL_MS);
          }
        })
        .catch((error: unknown) => {
          if (!isActive) return;
          setState(
            credential === null && isRefused(error)
              ? { kind: 'no-token' }
              : { kind: 'failed', message: messageOf(error) },
          );
        });
    };
    poll();
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [dealId, credential, refreshes]);

  if (state.kind === 'loading') return <p className="text-muted">Loading the deal...</p>;
  if (state.kind === 'no-token') {
    return (
      <p className="text-muted">
        Open this page from the buyer link you got when the deal was created, or sign in with the
        account that opened the deal.
      </p>
    );
  }
  if (state.kind === 'failed') return <p className="text-refused">{state.message}</p>;

  const { record } = state;
  const { deal } = record;
  const reason = stopReason(record);
  const refresh = () => {
    setRefreshes((count) => count + 1);
  };

  return (
    <article className="flex flex-col gap-8">
      <header>
        <p className="text-muted text-xs font-semibold tracking-widest uppercase">Deal {deal.id}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {record.brief?.goal ?? deal.contract?.terms.item.title ?? 'Deal'}
        </h1>
        <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
          <span className="font-semibold">{stateLabels[deal.state] ?? deal.state}</span>
          {deal.contract && (
            <span className="text-muted">Price {formatMoney(deal.contract.terms.price)}</span>
          )}
          <span className="text-muted">Budget {formatMoney(deal.mandate.maxPrice)}</span>
        </p>
        {reason && <p className="text-refused mt-2 text-sm">{reason}.</p>}
      </header>

      {credential !== undefined && (
        <NextAction record={record} credential={credential} onDone={refresh} />
      )}

      <Panel title="Escrow">
        <ol className="flex flex-col gap-4">
          {escrowSteps(deal.state, record.events).map((step) => (
            <li key={step.label} className="flex gap-3">
              <span
                className={`mt-1 size-3 shrink-0 rounded-full border-2 ${stepDotStyles[step.status]}`}
              />
              <div>
                <p
                  className={`text-sm font-semibold ${step.status === 'pending' ? 'text-muted' : ''}`}
                >
                  {step.label}
                </p>
                <p className="text-muted text-sm">
                  {step.detail}
                  {step.at && ` ${formatTime(step.at)}.`}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {deal.escrow && deal.state !== 'SETTLED' && deal.state !== 'REFUSED' && (
          <p className="text-muted mt-4 text-sm">
            {formatMoney(deal.escrow.amount)} held under authorization{' '}
            <span className="font-mono">{deal.escrow.authorizationId}</span> until{' '}
            {formatTime(deal.escrow.expiresAt)}.
          </p>
        )}
        {deal.capture && (
          <p className="text-muted mt-4 text-sm">
            Captured {formatMoney(deal.capture.amount)} as{' '}
            <span className="font-mono">{deal.capture.captureId}</span>.
          </p>
        )}
      </Panel>

      {record.negotiation && (
        <Panel title={`Negotiation with ${record.negotiation.sellerName}`}>
          <p className="text-sm">
            {record.negotiation.listing.title}, listed at{' '}
            {formatMoney(record.negotiation.listing.listPrice)}.{' '}
            {record.brief?.sellerId
              ? `Listed by seller ${record.brief.sellerId}.`
              : 'Found in the Channel3 product catalog.'}
          </p>
          <ol className="mt-4 flex flex-col gap-3">
            {record.negotiation.turns.map((turn, index) => (
              <li key={index} className="text-sm">
                <span className="font-semibold capitalize">{turn.party}</span>
                <span className="text-muted">
                  {' '}
                  {turn.move.action.toLowerCase().replace('_', ' ')}
                  {turn.move.price && ` at ${formatMoney(turn.move.price)}`}
                </span>
                <p className="mt-1 whitespace-pre-wrap">{turn.move.message}</p>
              </li>
            ))}
          </ol>
          {record.negotiation.outcome && (
            <p className="text-muted mt-4 text-sm">{record.negotiation.outcome}.</p>
          )}
        </Panel>
      )}

      {deal.contract && (
        <Panel title="Contract">
          <p className="text-sm">
            {deal.contract.terms.item.title} for {formatMoney(deal.contract.terms.price)}, delivered
            by {formatTime(deal.contract.terms.deliveryDeadline)}.
          </p>
          <ul className="mt-3 list-disc pl-5 text-sm">
            {deal.contract.terms.acceptanceCriteria.map((criterion) => (
              <li key={criterion.id}>{criterion.description}</li>
            ))}
          </ul>
          <p className="text-muted mt-3 text-sm">
            Signed by{' '}
            {deal.contract.signatures
              .map((signature) => `${signature.party} at ${formatTime(signature.signedAt)}`)
              .join(' and ')}
            .
          </p>
        </Panel>
      )}

      {record.evidence && (
        <Panel title="Delivery evidence">
          <p className="text-muted text-sm">
            Delivered {formatTime(record.evidence.deliveredAt)}, invoice total{' '}
            {formatMoney(record.evidence.invoiceTotal)}. The seller wrote:
          </p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{record.evidence.description}</p>
        </Panel>
      )}

      <PayPalLog record={record} />
    </article>
  );
}

function PayPalLog({ record }: { record: DealRecord }) {
  const activity = paypalActivity(record.paypalCalls, record.webhooks);
  return (
    <Panel title="PayPal activity">
      {activity.length === 0 ? (
        <p className="text-muted text-sm">No PayPal calls yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 font-mono text-xs">
          {activity.map((entry) =>
            entry.kind === 'call' ? (
              <li key={`call-${entry.at}-${entry.call.operation}`}>
                <span className="text-muted">{formatTime(entry.at)}</span> {entry.call.operation}{' '}
                <span className={entry.call.statusCode < 300 ? 'text-settled' : 'text-refused'}>
                  {entry.call.statusCode}
                </span>
                {entry.call.debugId && (
                  <span className="text-muted"> debug_id {entry.call.debugId}</span>
                )}
              </li>
            ) : (
              <li key={`webhook-${entry.webhook.eventId}`}>
                <span className="text-muted">{formatTime(entry.at)}</span> webhook{' '}
                {entry.webhook.eventType}
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}

interface NextActionProps {
  record: DealRecord;
  credential: DealCredential;
  onDone: () => void;
}

function NextAction({ record, credential, onDone }: NextActionProps) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { deal } = record;

  const send = (action: () => Promise<void>) => {
    setIsSending(true);
    setError(null);
    action()
      .then(onDone)
      .catch((caught: unknown) => {
        setError(messageOf(caught));
      })
      .finally(() => {
        setIsSending(false);
      });
  };

  const buttons = (() => {
    if (deal.state === 'AWAITING_HUMAN_APPROVAL' && deal.contract) {
      return (
        <ActionPanel
          title="Approve the price"
          text={`The agents agreed on ${formatMoney(deal.contract.terms.price)}, above your approval threshold of ${formatMoney(deal.mandate.humanApprovalThreshold)}.`}
        >
          <ActionButton
            label="Approve"
            disabled={isSending}
            onClick={() => {
              send(() => sendPurchaseApproval(deal.id, credential, true));
            }}
          />
          <ActionButton
            label="Decline"
            disabled={isSending}
            onClick={() => {
              send(() => sendPurchaseApproval(deal.id, credential, false));
            }}
          />
        </ActionPanel>
      );
    }
    if (deal.state === 'AUTHORIZING' && record.checkout) {
      return (
        <ActionPanel
          title="Approve the payment"
          text="Log in with a PayPal sandbox buyer account. PayPal holds the money; nothing is captured until delivery is verified."
        >
          <a
            href={record.checkout.approveUrl}
            className="bg-accent text-on-accent rounded-full px-4 py-2 text-sm font-semibold"
          >
            Pay with PayPal
          </a>
        </ActionPanel>
      );
    }
    if (deal.state === 'AWAITING_DELIVERY' && deal.contract) {
      const { terms } = deal.contract;
      const report = (delivery: SampleDelivery) => {
        send(() =>
          submitEvidence(
            deal.id,
            credential,
            sampleEvidence(terms, delivery, new Date().toISOString()),
          ),
        );
      };
      return (
        <ActionPanel
          title="Report the delivery"
          text="In a live deal the seller's system sends this. In the sandbox you play the seller. The verifier checks the evidence against the contract before any money moves."
        >
          <ActionButton
            label="Send the matching item"
            disabled={isSending}
            onClick={() => {
              report('matching');
            }}
          />
          <ActionButton
            label="Send a wrong item"
            disabled={isSending}
            onClick={() => {
              report('wrong-item');
            }}
          />
        </ActionPanel>
      );
    }
    if (deal.state === 'ESCALATED' && deal.contract && record.evidence) {
      const release = releaseDecision(deal.contract.terms, record.evidence);
      return (
        <ActionPanel
          title="Decide this deal"
          text="The verifier could not confirm delivery on its own. Release the payment only if you received what the contract says."
        >
          <ActionButton
            label="Release payment"
            disabled={isSending}
            onClick={() => {
              send(() => sendHumanDecision(deal.id, credential, release));
            }}
          />
          <ActionButton
            label="Refund"
            disabled={isSending}
            onClick={() => {
              send(() =>
                sendHumanDecision(deal.id, credential, {
                  action: 'VOID',
                  reason: 'The buyer refused the delivery',
                }),
              );
            }}
          />
        </ActionPanel>
      );
    }
    return null;
  })();

  if (!buttons) return null;
  return (
    <div>
      {buttons}
      {error && <p className="text-refused mt-2 text-sm">{error}</p>}
    </div>
  );
}

/** The buyer confirms every criterion. Policy still checks the amount and evidence. */
function releaseDecision(terms: ContractTerms, evidence: Evidence): HumanDecision {
  return {
    action: 'CAPTURE',
    amount: terms.price,
    evidence: { productId: evidence.productId, deliveredAt: evidence.deliveredAt },
    criteria: terms.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.id,
      met: true,
      confidence: 1,
      rationale: 'Confirmed by the buyer',
    })),
    reason: 'The buyer confirmed the delivery',
  };
}

function ActionPanel({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <section className="border-held/40 rounded-card border p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted mt-1 text-sm">{text}</p>
      <div className="mt-4 flex flex-wrap gap-3">{children}</div>
    </section>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="border-line hover:border-ink rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
    >
      {label}
    </button>
  );
}
