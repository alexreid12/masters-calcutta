'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Spinner } from '@/components/ui';
import Link from 'next/link';

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
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Post-creation invite state (for private pools)
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
          is_private: isPrivate,
          join_password: isPrivate && password.trim() ? password.trim() : null,
        })
        .select('id, invite_code')
        .single();
      if (error) throw error;

      // Ensure commissioner is added as a member (trigger handles it, this is belt-and-suspenders)
      await supabase
        .from('pool_members')
        .insert({ pool_id: data.id, user_id: user.id })
        .then(() => {}); // ignore conflict errors

      if (isPrivate) {
        // Show the invite link before navigating away
        setCreatedPoolId(data.id);
        setInviteCode(data.invite_code);
      } else {
        router.push(`/pool/${data.id}/admin`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create pool');
    } finally {
      setLoading(false);
    }
  }

  function copyInviteLink() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Post-creation invite screen for private pools ─────────────────────────
  if (inviteCode && createdPoolId) {
    const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${inviteCode}`;
    return (
      <div className="min-h-screen bg-masters-cream flex items-start justify-center px-4 py-12">
        <div className="card w-full max-w-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-masters-green" />
            <p className="text-sm font-medium text-masters-green">Pool created!</p>
          </div>
          <h1 className="font-display text-2xl text-masters-green mb-1">{name}</h1>
          <p className="text-sm text-gray-500 mb-6">
            Your pool is <strong>private</strong>. Share the invite link below with participants.
          </p>

          <div className="bg-masters-green/5 border border-masters-green/20 rounded-xl p-4 mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Invite Link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 font-mono text-gray-700 break-all">
                {inviteUrl}
              </code>
              <button
                onClick={copyInviteLink}
                className="btn-primary shrink-0 text-sm py-2 px-3"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Invite code: <span className="font-mono font-semibold text-masters-green">{inviteCode}</span>
              {password && ' · Password protected'}
            </p>
          </div>

          <Link href={`/pool/${createdPoolId}/admin`} className="btn-primary block text-center">
            Go to Admin →
          </Link>
        </div>
      </div>
    );
  }

  // ── Create Pool form ───────────────────────────────────────────────────────
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

          {/* Privacy toggle */}
          <div className="pt-1 border-t border-masters-cream-dark">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-gray-700">Private Pool</p>
                <p className="text-xs text-gray-400">Hidden from the home page; invite-only access</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPrivate((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  isPrivate ? 'bg-masters-green' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    isPrivate ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {isPrivate && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="Leave blank for invite-link-only access"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Anyone with the invite link will also need this password to join.
                </p>
              </div>
            )}
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
