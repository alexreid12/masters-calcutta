'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Spinner } from '@/components/ui';

export default function NewPoolPage() {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const router = useRouter();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [asyncStart, setAsyncStart] = useState('');
  const [asyncDeadline, setAsyncDeadline] = useState('');
  const [liveStart, setLiveStart] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('pools')
        .insert({
          name,
          year,
          commissioner_id: user.id,
          async_bid_start: asyncStart || null,
          async_bid_deadline: asyncDeadline || null,
          live_auction_start: liveStart || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      router.push(`/pool/${data.id}/admin`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create pool');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-masters-cream flex items-start justify-center px-4 py-12">
      <div className="card w-full max-w-lg">
        <h1 className="font-display text-2xl text-masters-green mb-6">Create a Pool</h1>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pool Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="e.g. Smith Family Masters Pool"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="input"
              min={2020}
              max={2099}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Async Bidding Opens <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={asyncStart}
              onChange={(e) => setAsyncStart(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Async Bidding Deadline <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={asyncDeadline}
              onChange={(e) => setAsyncDeadline(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Live Auction Starts <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={liveStart}
              onChange={(e) => setLiveStart(e.target.value)}
              className="input"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading && <Spinner className="text-white" />}
              Create Pool
            </button>
            <button type="button" onClick={() => router.back()} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
