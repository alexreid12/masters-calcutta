'use client';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | boolean)[]) {
  return twMerge(clsx(inputs));
}

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin h-5 w-5', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  setup:             'bg-gray-100 text-gray-600',
  async_bidding:     'bg-blue-100 text-blue-700',
  live_auction:      'bg-masters-gold/20 text-yellow-800',
  locked:            'bg-orange-100 text-orange-700',
  tournament_active: 'bg-masters-green/20 text-masters-green-dark',
  completed:         'bg-purple-100 text-purple-700',
};

const STATUS_LABELS: Record<string, string> = {
  setup:             'Setup',
  async_bidding:     'Async Bidding',
  live_auction:      'Live Auction',
  locked:            'Locked',
  tournament_active: 'In Progress',
  completed:         'Completed',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold', STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600')}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── ScoreDisplay ──────────────────────────────────────────────────────────────
export function ScoreDisplay({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400 font-mono">-</span>;
  if (score === 0) return <span className="text-gray-600 font-mono font-medium">E</span>;
  if (score < 0) return <span className="text-red-600 font-mono font-medium">{score}</span>;
  return <span className="text-gray-800 font-mono font-medium">+{score}</span>;
}

// ── Money ─────────────────────────────────────────────────────────────────────
export function Money({ amount, className }: { amount: number; className?: string }) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
  return <span className={cn('font-mono', className)}>{formatted}</span>;
}

// ── GolferStatusBadge ─────────────────────────────────────────────────────────
export function GolferStatusBadge({ status }: { status: string }) {
  if (status === 'active') return null;
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ml-1',
      status === 'withdrawn' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
    )}>
      {status === 'withdrawn' ? 'WD' : 'MC'}
    </span>
  );
}
