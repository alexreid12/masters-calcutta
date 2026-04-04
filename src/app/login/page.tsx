'use client';

import { Suspense, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/ui';

// Isolated because useSearchParams() requires a Suspense boundary in Next.js 14
function LoginForm() {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });
        if (error) throw error;
        // After register, switch to login mode and prompt
        setMode('login');
        setLoading(false);
        setError('');
        alert('Account created! Check your email to confirm, then sign in.');
        return;
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (!data.session) throw new Error('No session returned. Check your email confirmation.');
      }

      // Client-side navigation — cookies are already set in the browser by createBrowserClient
      router.push(next === '/login' ? '/' : next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-masters-cream w-full max-w-md rounded-xl shadow-xl p-8">
      {/* Mode toggle */}
      <div className="flex rounded-lg overflow-hidden border border-masters-green/30 mb-6">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(''); }}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              mode === m
                ? 'bg-masters-green text-white'
                : 'text-masters-green hover:bg-masters-green/10'
            }`}
          >
            {m === 'login' ? 'Sign In' : 'Register'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input"
              placeholder="Your name"
              required
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder="••••••••"
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading && <Spinner className="text-white" />}
          {mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-masters-green flex flex-col items-center justify-center px-4">
      <div className="text-center mb-8">
        <div className="w-12 h-1 bg-masters-gold rounded mx-auto mb-3" />
        <h1 className="font-display text-3xl text-masters-gold font-semibold">Masters Calcutta</h1>
        <p className="text-masters-cream/70 mt-1 text-sm">Auction-style fantasy golf</p>
      </div>

      <Suspense
        fallback={
          <div className="bg-masters-cream w-full max-w-md rounded-xl shadow-xl p-8 flex justify-center">
            <Spinner className="text-masters-green w-6 h-6" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
