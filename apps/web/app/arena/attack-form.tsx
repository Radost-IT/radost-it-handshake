'use client';

import type { AttackCategory, AttackChannel } from '@handshake/arena';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS } from '../components/form-styles';
import { messageOf, submitAttempt, type ArenaDeal, type ArenaStats } from './api';
import { categoryLabels, channelLabels } from './labels';

interface AttackFormProps {
  deals: ArenaDeal[];
  dailyDealId: string;
  stats: ArenaStats;
  categories: readonly AttackCategory[];
  maxAttackLength: number;
}

const channels: AttackChannel[] = ['listing', 'message', 'evidence'];

export function AttackForm({
  deals,
  dailyDealId,
  stats,
  categories,
  maxAttackLength,
}: AttackFormProps) {
  const router = useRouter();
  const [isDailyChallenge, setIsDailyChallenge] = useState(false);
  const [chosenDealId, setChosenDealId] = useState(dailyDealId);
  const [category, setCategory] = useState<AttackCategory | null>(null);
  const [channel, setChannel] = useState<AttackChannel | null>(null);
  const [attackText, setAttackText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const dealId = isDailyChallenge ? dailyDealId : chosenDealId;
  const deal = deals.find((candidate) => candidate.id === dealId);
  const loopholesByCategory = new Map(
    stats.categories.map((entry) => [entry.category, entry.loopholes]),
  );

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!category || !channel) {
      setError('Pick an attack type and where to put it');
      return;
    }
    setIsSending(true);
    setError(null);
    submitAttempt({
      category,
      channel,
      attackText,
      dailyChallenge: isDailyChallenge,
      dealId: isDailyChallenge ? null : chosenDealId,
    })
      .then(({ attemptId }) => {
        router.push(`/arena/attempts/${attemptId}`);
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <Step number={1} title="Pick a deal">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDailyChallenge}
            onChange={(event) => {
              setIsDailyChallenge(event.target.checked);
            }}
            className="accent-(--accent)"
          />
          Test today&apos;s daily target. It has its own leaderboard.
        </label>
        <select
          value={dealId}
          disabled={isDailyChallenge}
          onChange={(event) => {
            setChosenDealId(event.target.value);
          }}
          aria-label="Deal"
          className={`${FORM_INPUT_CLASS} disabled:opacity-60`}
        >
          {deals.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.listing.title}
              {candidate.id === dailyDealId ? ' (daily)' : ''}
            </option>
          ))}
        </select>
        {deal && <DealDetails deal={deal} />}
      </Step>

      <Step number={2} title="Pick an attack">
        <div className="grid gap-2 sm:grid-cols-2">
          {categories.map((option) => {
            const loopholes = loopholesByCategory.get(option) ?? 0;
            return (
              <Choice
                key={option}
                name="category"
                isChecked={category === option}
                onChoose={() => {
                  setCategory(option);
                }}
                title={categoryLabels[option].name}
                hint={categoryLabels[option].hint}
                note={loopholes === 0 ? 'No breach yet' : `${loopholes} breached`}
              />
            );
          })}
        </div>
      </Step>

      <Step number={3} title="Pick where it goes">
        <div className="grid gap-2 sm:grid-cols-3">
          {channels.map((option) => (
            <Choice
              key={option}
              name="channel"
              isChecked={channel === option}
              onChoose={() => {
                setChannel(option);
              }}
              title={channelLabels[option].name}
              hint={channelLabels[option].hint}
            />
          ))}
        </div>
      </Step>

      <Step number={4} title="Write your attack">
        <textarea
          value={attackText}
          onChange={(event) => {
            setAttackText(event.target.value);
          }}
          required
          maxLength={maxAttackLength}
          rows={7}
          aria-label="Attack text"
          placeholder="Write what the seller says, lists or shows."
          className={FORM_INPUT_CLASS}
        />
        <p className="text-muted self-end font-mono text-xs">
          {attackText.length} / {maxAttackLength}
        </p>
      </Step>

      {error && <p className="text-refused text-sm">{error}</p>}
      <button
        type="submit"
        disabled={isSending}
        className="bg-heat text-on-accent self-start rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isSending ? 'Starting...' : 'Launch attack'}
      </button>
    </form>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-lg font-semibold">
        <span className="text-heat font-mono">{number}.</span> {title}
      </legend>
      {children}
    </fieldset>
  );
}

interface ChoiceProps {
  name: string;
  isChecked: boolean;
  onChoose: () => void;
  title: string;
  hint: string;
  note?: string;
}

function Choice({ name, isChecked, onChoose, title, hint, note }: ChoiceProps) {
  return (
    <label
      className={`has-focus-visible:outline-accent flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-sm transition-colors has-focus-visible:outline-2 ${
        isChecked ? 'border-accent bg-canvas' : 'border-line hover:border-muted'
      }`}
    >
      <input type="radio" name={name} checked={isChecked} onChange={onChoose} className="sr-only" />
      <span className="font-semibold">{title}</span>
      <span className="text-muted">{hint}</span>
      {note && <span className="text-accent text-xs">{note}</span>}
    </label>
  );
}

function DealDetails({ deal }: { deal: ArenaDeal }) {
  const { listing, seller } = deal;
  return (
    <div className="border-line bg-canvas/60 rounded-lg border p-4 text-sm">
      <p className="flex flex-wrap justify-between gap-2">
        <span className="font-semibold">{listing.title}</span>
        <span className="font-mono">
          {listing.listPrice.value} {listing.listPrice.currency}
        </span>
      </p>
      <p className="text-muted mt-1">{listing.description}</p>
      <p className="mt-3">
        <span className="font-semibold">You act as {seller.name}.</span>{' '}
        <span className="text-muted">{seller.persona}</span>
      </p>
      <p className="mt-2">
        <span className="font-semibold">The buyer wants:</span>{' '}
        <span className="text-muted">{deal.buyerGoal}</span>
      </p>
      <p className="mt-2 font-semibold">The contract checks:</p>
      <ul className="text-muted mt-1 list-disc pl-5">
        {deal.acceptanceCriteria.map((criterion) => (
          <li key={criterion.id}>{criterion.description}</li>
        ))}
        <li>Delivery within {deal.deliveryDays} days</li>
      </ul>
    </div>
  );
}
