'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { Spinner, Money } from '@/components/ui';
import { calculatePayouts } from '@/lib/payout-engine';
import type { PayoutRule, PayoutRuleType } from '@/types/database';

const RULE_TYPE_LABELS: Record<PayoutRuleType, string> = {
  position:    'Position',
  low_round:   'Low Round',
  high_round:  'High Round',
  low_amateur: 'Low Amateur',
};

const RULE_TYPE_COLORS: Record<PayoutRuleType, string> = {
  position:    'bg-masters-green/15 text-masters-green-dark',
  low_round:   'bg-blue-100 text-blue-700',
  high_round:  'bg-orange-100 text-orange-700',
  low_amateur: 'bg-purple-100 text-purple-700',
};

function RuleTypeBadge({ type }: { type: PayoutRuleType }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${RULE_TYPE_COLORS[type]}`}>
      {RULE_TYPE_LABELS[type]}
    </span>
  );
}

type EditableRule = PayoutRule & { _dirty?: boolean };

export default function AdminPayoutsPage({ params }: { params: { id: string } }) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const { user } = useAuth();

  const [rules, setRules] = useState<EditableRule[]>([]);
  const [pool, setPool] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function load() {
    const [poolRes, rulesRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase
        .from('payout_rules')
        .select('*')
        .eq('pool_id', params.id)
        .order('finish_position'),
    ]);
    if (poolRes.data) {
      setPool(poolRes.data);
      if (user && poolRes.data.commissioner_id === user.id) setAuthorized(true);
    }
    setRules(rulesRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  function updateRule(id: string, field: keyof PayoutRule, value: unknown) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, [field]: value, _dirty: true } : r
      )
    );
  }

  async function saveRules() {
    setSaving(true);
    setMessage(null);
    const dirty = rules.filter((r) => r._dirty);
    for (const rule of dirty) {
      await supabase
        .from('payout_rules')
        .update({
          payout_percentage: rule.payout_percentage,
          label: rule.label,
          is_active: rule.is_active,
        })
        .eq('id', rule.id);
    }
    await load();
    setMessage({ text: 'Rules saved.', ok: true });
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  }

  async function calculateAndSavePayouts() {
    setCalculating(true);
    setMessage(null);

    const [leaderRes, ownerRes, rulesRes, scoresRes, golfersRes] = await Promise.all([
      supabase.from('leaderboard').select('*').eq('pool_id', params.id),
      supabase.from('ownership').select('*').eq('pool_id', params.id),
      supabase.from('payout_rules').select('*').eq('pool_id', params.id).eq('is_active', true),
      supabase.from('scores').select('*').eq('pool_id', params.id),
      supabase.from('golfers').select('*').eq('pool_id', params.id),
    ]);

    if (!leaderRes.data || !ownerRes.data || !rulesRes.data) {
      setMessage({ text: 'Failed to load data.', ok: false });
      setCalculating(false);
      return;
    }

    const results = calculatePayouts({
      totalPot: pool.total_pot,
      leaderboard: leaderRes.data,
      rules: rulesRes.data,
      ownerships: ownerRes.data,
      scores: scoresRes.data ?? [],
      golfers: golfersRes.data ?? [],
    });

    await supabase.from('payouts').delete().eq('pool_id', params.id);

    if (results.length > 0) {
      const { error } = await supabase.from('payouts').insert(
        results.map((r) => ({
          pool_id: params.id,
          user_id: r.owner_id,
          golfer_id: r.golfer_id,
          finish_position: r.finish_position,
          payout_rule_id: r.payout_rule_id,
          rule_type: r.rule_type,
          payout_amount: r.payout_amount,
          net_profit: r.net_profit,
          purchase_price: r.purchase_price,
          award_score: r.award_score ?? null,
          award_round: r.award_round ?? null,
          award_label: r.award_label,
          applied_percentage: r.applied_percentage,
        }))
      );
      if (error) {
        setMessage({ text: `Error: ${error.message}`, ok: false });
      } else {
        setMessage({ text: `Calculated ${results.length} payouts.`, ok: true });
      }
    } else {
      setMessage({ text: 'No payouts — check leaderboard and ownership data.', ok: false });
    }

    setCalculating(false);
    setTimeout(() => setMessage(null), 6000);
  }

  // Section helpers
  const positionRules = rules.filter((r) => r.rule_type === 'position');
  const specialRules = rules.filter((r) => r.rule_type !== 'position');

  const totalActivePct = rules
    .filter((r) => r.is_active)
    .reduce((sum, r) => sum + Number(r.payout_percentage), 0);
  const pctOk = Math.abs(totalActivePct - 100) < 0.01;

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;
  if (!authorized) return <div className="card text-center py-12 text-gray-400">Commissioner access required.</div>;

  function RuleRow({ rule, showRound }: { rule: EditableRule; showRound?: boolean }) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-masters-cream-dark last:border-0">
        <input
          type="checkbox"
          checked={rule.is_active}
          onChange={(e) => updateRule(rule.id, 'is_active', e.target.checked)}
          className="w-4 h-4 accent-masters-green shrink-0"
        />
        <RuleTypeBadge type={rule.rule_type} />
        {showRound && rule.round_number !== null && (
          <span className="text-xs text-gray-400 font-mono shrink-0">R{rule.round_number}</span>
        )}
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={rule.label}
            onChange={(e) => updateRule(rule.id, 'label', e.target.value)}
            className="input text-sm py-1 w-full"
            placeholder="Label"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            min="0"
            max="100"
            step="0.25"
            value={rule.payout_percentage}
            onChange={(e) => updateRule(rule.id, 'payout_percentage', Number(e.target.value))}
            className="input text-right text-sm py-1 w-20"
          />
          <span className="text-gray-400 text-sm">%</span>
        </div>
        {pool && (
          <div className="w-20 text-right shrink-0">
            <Money
              amount={(Number(rule.payout_percentage) / 100) * pool.total_pot}
              className="text-xs text-masters-green"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl text-masters-green">Payout Rules</h2>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-mono font-semibold ${pctOk ? 'text-green-600' : 'text-red-500'}`}>
            {totalActivePct.toFixed(2)}% / 100%
            {!pctOk && <span className="ml-1 text-xs">({(totalActivePct - 100).toFixed(2)} off)</span>}
          </span>
          <button
            onClick={saveRules}
            disabled={saving || !rules.some((r) => r._dirty)}
            className="btn-primary flex items-center gap-2"
          >
            {saving && <Spinner className="text-white w-4 h-4" />}
            Save Rules
          </button>
        </div>
      </div>

      {/* Position Rules */}
      <div className="card">
        <h3 className="font-display text-lg text-masters-green mb-1">Tournament Finish</h3>
        <p className="text-xs text-gray-400 mb-3">
          Awarded to the owners of golfers finishing in the top positions. Ties combine and split evenly.
        </p>
        <div>
          {positionRules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-masters-cream-dark flex justify-end">
          <span className="text-xs text-gray-400">
            Subtotal:{' '}
            <span className="font-mono font-semibold text-gray-600">
              {positionRules.filter(r => r.is_active).reduce((s, r) => s + r.payout_percentage, 0).toFixed(2)}%
            </span>
          </span>
        </div>
      </div>

      {/* Special Awards */}
      <div className="card">
        <h3 className="font-display text-lg text-masters-green mb-1">Special Awards</h3>
        <p className="text-xs text-gray-400 mb-3">
          Low Round (daily best score), High Round (tournament&apos;s worst single round, made-cut only), Low Amateur.
          Ties split evenly.
        </p>
        <div>
          {specialRules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} showRound />
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-masters-cream-dark flex justify-end">
          <span className="text-xs text-gray-400">
            Subtotal:{' '}
            <span className="font-mono font-semibold text-gray-600">
              {specialRules.filter(r => r.is_active).reduce((s, r) => s + r.payout_percentage, 0).toFixed(2)}%
            </span>
          </span>
        </div>
      </div>

      {/* Calculate payouts */}
      <div className="card bg-masters-green/5 border-masters-green/20">
        <h3 className="font-display text-lg text-masters-green mb-2">Calculate Payouts</h3>
        <p className="text-sm text-gray-600 mb-1">
          Runs position payouts (with tie handling) and all active special awards against current scores + ownership.
          Overwrites any previously saved payouts.
        </p>
        {!pctOk && (
          <p className="text-xs text-red-500 mb-3">
            ⚠ Active rules don&apos;t sum to 100%. Adjust percentages before calculating.
          </p>
        )}
        <button
          onClick={calculateAndSavePayouts}
          disabled={calculating}
          className="btn-primary flex items-center gap-2"
        >
          {calculating && <Spinner className="text-white w-4 h-4" />}
          Calculate &amp; Save Payouts
        </button>
        {message && (
          <p className={`mt-3 text-sm font-medium ${message.ok ? 'text-masters-green' : 'text-red-500'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
