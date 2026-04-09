'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';
import type { PoolStatus } from '@/types/database';
import { NotificationBell } from '@/components/NotificationBell';

interface Tab {
  label: string;
  href: string;
  statuses: PoolStatus[];
  commissionerOnly?: boolean;
}

function getTabs(poolId: string): Tab[] {
  return [
    {
      label: 'Dashboard',
      href: `/pool/${poolId}`,
      statuses: ['setup','async_bidding','live_auction','locked','tournament_active','completed'],
    },
    {
      label: 'Field',
      href: `/pool/${poolId}/field`,
      statuses: ['setup','async_bidding','live_auction','locked','tournament_active','completed'],
    },
    {
      label: 'Async Bidding',
      href: `/pool/${poolId}/auction/async`,
      statuses: ['async_bidding','live_auction'],
    },
    {
      label: 'Async Results',
      href: `/pool/${poolId}/auction/results`,
      statuses: ['live_auction','locked','tournament_active','completed'],
    },
    {
      label: 'Live Auction',
      href: `/pool/${poolId}/auction/live`,
      statuses: ['live_auction','locked','tournament_active','completed'],
    },
    {
      label: 'Leaderboard',
      href: `/pool/${poolId}/leaderboard`,
      statuses: ['tournament_active','completed'],
    },
    {
      label: 'Standings',
      href: `/pool/${poolId}/standings`,
      statuses: ['tournament_active','completed'],
    },
    {
      label: 'My Portfolio',
      href: `/pool/${poolId}/portfolio`,
      statuses: ['locked','tournament_active','completed'],
    },
    {
      label: 'Payouts',
      href: `/pool/${poolId}/payouts`,
      statuses: ['completed'],
    },
    {
      label: 'Admin',
      href: `/pool/${poolId}/admin`,
      statuses: ['setup','async_bidding','live_auction','locked','tournament_active','completed'],
      commissionerOnly: true,
    },
  ];
}

interface PoolNavProps {
  poolId: string;
  status: PoolStatus;
  isCommissioner: boolean;
  poolName: string;
  totalPot: number;
}

export function PoolNav({ poolId, status, isCommissioner, poolName, totalPot }: PoolNavProps) {
  const pathname = usePathname();
  const tabs = getTabs(poolId).filter(
    (tab) =>
      tab.statuses.includes(status) &&
      (!tab.commissionerOnly || isCommissioner)
  );

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0,
  }).format(totalPot);

  return (
    <div className="bg-masters-green text-white shadow-md">
      {/* Pool header */}
      <div className="max-w-7xl mx-auto px-4 pt-4 pb-0 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-semibold text-masters-gold leading-tight">
            {poolName}
          </h1>
          <p className="text-masters-cream/70 text-xs mt-0.5">
            Total Pot: <span className="font-mono text-masters-gold font-medium">{formatted}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <NotificationBell variant="light" />
          <Link href="/" className="text-masters-cream/60 hover:text-masters-cream text-sm transition-colors">
            ← All Pools
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <nav className="max-w-7xl mx-auto px-4 flex overflow-x-auto gap-0.5 mt-2 scrollbar-none">
        {tabs.map((tab) => {
          const isActive =
            tab.href === `/pool/${poolId}`
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'whitespace-nowrap px-4 py-2.5 text-sm font-medium rounded-t transition-colors',
                isActive
                  ? 'bg-masters-cream text-masters-green'
                  : 'text-masters-cream/70 hover:text-masters-cream hover:bg-masters-green-light/30'
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
