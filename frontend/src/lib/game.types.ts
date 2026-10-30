export type Snapshot = {
  serverNow: number;
  coins: number;
  balanceMilli: number;
  bonusAvailable: boolean;
  nextAdAt: number | null;
  donatedCoins: number;
  miners: Array<{ id: number; startedAt: number }>;
  withdrawals: Array<{
    id: string;
    milli: number;
    ton: number;
    address: string;
    status: string;
    createdAt: number;
  }>;
};

export type LoadResult = {
  state: Snapshot;
  botUsername: string | null;
  proofUrl: string | null;
};

export type Leaderboard = {
  top: Array<{ id: number; name: string; photoUrl: string | null; coins: number }>;
  total: number;
};

export type Referrals = Array<{
  id: number;
  name: string;
  photoUrl: string | null;
  eligible: boolean;
  claimed: boolean;
}>;

export type ReferralClaim =
  | { ok: false; notEligible: true }
  | { ok: true; state: Snapshot };

export type AdStatus =
  | { verified: true; expired: false; state: Snapshot }
  | { verified: false; expired: boolean; state: null };
