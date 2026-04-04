'use client';

import { useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { NotificationBell } from '@/components/NotificationBell';

interface TopNavProps {
  displayName: string;
  isCommissioner: boolean;
}

export function TopNav({ displayName, isCommissioner }: TopNavProps) {
  const supabaseRef = useRef(createClient());

  async function handleSignOut() {
    await supabaseRef.current.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Signed in as{' '}
          <span className="font-semibold text-gray-700">{displayName}</span>
          {isCommissioner && (
            <span className="ml-1 text-masters-green font-semibold">(Commissioner)</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <NotificationBell variant="dark" />
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
