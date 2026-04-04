export type PayoutRuleType = 'position' | 'low_round' | 'high_round' | 'low_amateur';

export type PoolStatus =
  | 'setup'
  | 'async_bidding'
  | 'live_auction'
  | 'locked'
  | 'tournament_active'
  | 'completed';

export type GolferStatus = 'active' | 'withdrawn' | 'missed_cut';
export type AuctionItemStatus = 'pending' | 'open' | 'going_once' | 'going_twice' | 'sold';
export type AcquiredVia = 'async_auction' | 'live_auction';

export interface Profile {
  id: string;
  display_name: string;
  email: string;
  is_commissioner: boolean;
  avatar_url: string | null;
  created_at: string;
}

export interface Pool {
  id: string;
  name: string;
  year: number;
  status: PoolStatus;
  async_bid_start: string | null;
  async_bid_deadline: string | null;
  live_auction_start: string | null;
  total_pot: number;
  commissioner_id: string;
  created_at: string;
}

export interface Golfer {
  id: string;
  pool_id: string;
  name: string;
  country: string | null;
  world_ranking: number | null;
  sportsdata_player_id: number | null;
  image_url: string | null;
  status: GolferStatus;
  is_amateur: boolean;
  created_at: string;
}

export interface AsyncBid {
  id: string;
  pool_id: string;
  golfer_id: string;
  user_id: string;
  amount: number;
  is_max_bid: boolean;
  created_at: string;
}

export interface LiveAuctionItem {
  id: string;
  pool_id: string;
  golfer_id: string;
  floor_price: number;
  current_bid: number;
  current_bidder_id: string | null;
  bid_count: number;
  status: AuctionItemStatus;
  opened_at: string | null;
  sold_at: string | null;
  // joined
  golfer?: Golfer;
  current_bidder?: Profile;
}

export interface Ownership {
  id: string;
  pool_id: string;
  golfer_id: string;
  user_id: string;
  purchase_price: number;
  acquired_via: AcquiredVia;
  created_at: string;
  // joined
  golfer?: Golfer;
  profile?: Profile;
}

export interface Score {
  id: string;
  pool_id: string;
  golfer_id: string;
  round: number;
  score_to_par: number | null;
  total_to_par: number | null;
  thru: number | null;
  position: number | null;
  position_display: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface PayoutRule {
  id: string;
  pool_id: string;
  finish_position: number;
  payout_percentage: number;
  label: string;
  is_active: boolean;
  rule_type: PayoutRuleType;
  round_number: number | null;
  created_at: string;
}

export interface Payout {
  id: string;
  pool_id: string;
  user_id: string;
  golfer_id: string;
  finish_position: number;
  payout_rule_id: string | null;
  rule_type: PayoutRuleType;
  payout_amount: number;
  net_profit: number;
  purchase_price: number | null;
  award_score: number | null;
  award_round: number | null;
  award_label: string | null;
  applied_percentage: number | null;
  created_at: string;
  // joined
  golfer?: Golfer;
  profile?: Profile;
  payout_rules?: Pick<PayoutRule, 'label' | 'rule_type' | 'round_number'>;
}

export interface Notification {
  id: string;
  pool_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface LeaderboardEntry {
  pool_id: string;
  golfer_id: string;
  name: string;
  country: string | null;
  golfer_status: GolferStatus;
  total_to_par: number | null;
  thru: number | null;
  position: number | null;
  position_display: string | null;
  round: number;
  updated_at: string;
  owner_id: string | null;
  owner_name: string | null;
  purchase_price: number | null;
}
