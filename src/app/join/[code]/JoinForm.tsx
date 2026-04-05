'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';

interface JoinFormProps {
  poolId: string;
  poolName: string;
  poolYear: number;
  commissionerName: string;
}

export function JoinForm({ poolId, poolName, poolYear, commissionerName }: JoinFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: poolId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to join');
      } else {
        router.push(`/pool/${poolId}`);
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-masters-green flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-1 bg-masters-gold rounded mx-auto mb-4" />
          <h1 className="font-display text-3xl text-masters-gold">Masters Calcutta</h1>
          <p className="text-masters-cream/70 text-sm mt-1">You&apos;ve been invited to join a pool</p>
        </div>

        {/* Card */}
        <div className="bg-masters-cream rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-masters-cream-dark">
            <h2 className="font-display text-xl text-masters-green font-semibold">{poolName}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {poolYear} · Organized by {commissionerName}
            </p>
          </div>

          <form onSubmit={handleJoin} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pool Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Enter the password to join"
                required
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">Ask the commissioner if you don&apos;t have it.</p>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && <Spinner className="text-white w-4 h-4" />}
              Join Pool
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
