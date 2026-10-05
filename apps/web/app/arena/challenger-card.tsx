import type { Challenger } from './api';

export interface BadgeInfo {
  id: string;
  name: string;
  howToEarn: string;
}

interface ChallengerCardProps {
  challenger: Challenger;
  badges: BadgeInfo[];
}

export function ChallengerCard({ challenger, badges }: ChallengerCardProps) {
  const { rank } = challenger;
  return (
    <aside className="border-line bg-surface/70 rounded-card flex flex-col gap-6 border p-6">
      <div>
        <p className="text-muted text-xs font-semibold tracking-widest uppercase">Researcher</p>
        <p className="mt-1 text-xl font-semibold">{challenger.handle}</p>
        <p className="text-accent text-sm font-semibold">{rank.rank}</p>
      </div>
      <div>
        <div className="flex justify-between text-sm">
          <span className="font-mono font-semibold">{challenger.xp} XP</span>
          <span className="text-muted">
            {rank.next ? `${rank.next.xpToGo} XP to ${rank.next.rank}` : 'Top rank'}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Progress to the next rank"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(rank.fraction * 100)}
          className="bg-line mt-2 h-2 overflow-hidden rounded-full"
        >
          <div className="bg-heat h-full" style={{ width: `${rank.fraction * 100}%` }} />
        </div>
        <p className="text-muted mt-2 text-xs">Held streak: {challenger.currentHeldStreak}</p>
      </div>
      <div>
        <p className="text-muted text-xs font-semibold tracking-widest uppercase">Badges</p>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {badges.map((badge) => {
            const isUnlocked = challenger.badges.includes(badge.id);
            return (
              <li
                key={badge.id}
                title={badge.howToEarn}
                className={`rounded-lg border px-2 py-2 text-xs ${
                  isUnlocked ? 'border-accent text-ink' : 'border-line text-muted opacity-60'
                }`}
              >
                <span className="block font-semibold">{badge.name}</span>
                <span className="block">{badge.howToEarn}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
