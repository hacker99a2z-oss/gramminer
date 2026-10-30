CREATE TABLE public.players (
  tg_id bigint PRIMARY KEY,
  first_name text NOT NULL DEFAULT 'Miner',
  username text,
  photo_url text,
  coins bigint NOT NULL DEFAULT 0,
  balance_milli bigint NOT NULL DEFAULT 0,
  referred_by bigint,
  referral_claimed boolean NOT NULL DEFAULT false,
  owns_miner2 boolean NOT NULL DEFAULT false,
  last_bonus_date date,
  last_ad_at timestamptz,
  last_ad_session_id text,
  donated_coins bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX players_referred_by_idx ON public.players(referred_by);
CREATE INDEX players_donated_idx ON public.players(donated_coins DESC);

CREATE TABLE public.miners (
  tg_id bigint NOT NULL REFERENCES public.players(tg_id) ON DELETE CASCADE,
  miner_id int NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tg_id, miner_id)
);

CREATE TABLE public.ad_sessions (
  tg_id bigint PRIMARY KEY,
  session_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  phase text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz
);

CREATE TABLE public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_id bigint NOT NULL,
  amount_milli bigint NOT NULL,
  nano text NOT NULL,
  address text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  batch_id uuid,
  proof_posted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX withdrawals_tg_idx ON public.withdrawals(tg_id, created_at DESC);
CREATE INDEX withdrawals_status_idx ON public.withdrawals(status, created_at);

CREATE TABLE public.payout_batches (
  id uuid PRIMARY KEY,
  seqno int NOT NULL,
  ids uuid[] NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sending'
);

CREATE TABLE public.locks (
  id text PRIMARY KEY,
  until timestamptz NOT NULL
);

GRANT ALL ON public.players, public.miners, public.ad_sessions, public.withdrawals, public.payout_batches, public.locks TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.miners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locks ENABLE ROW LEVEL SECURITY;

-- Miner catalogue lives in one SQL function so prices can't drift
CREATE OR REPLACE FUNCTION public.miner_rule(_id int, OUT cost bigint, OUT minutes int, OUT reward_milli bigint)
LANGUAGE sql IMMUTABLE AS $$
  SELECT c, m, r FROM (VALUES (1,500::bigint,5,5::bigint),(2,1100,10,10),(3,2000,15,20),(4,5000,20,50),(5,10000,30,100)) v(i,c,m,r) WHERE i = _id
$$;

CREATE OR REPLACE FUNCTION public.gm_claim_bonus(_tg bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE players SET coins = coins + 100, last_bonus_date = (now() AT TIME ZONE 'utc')::date
  WHERE tg_id = _tg AND (last_bonus_date IS NULL OR last_bonus_date < (now() AT TIME ZONE 'utc')::date);
  IF NOT FOUND THEN RAISE EXCEPTION 'Daily bonus already claimed today'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gm_buy_miner(_tg bigint, _miner int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM miner_rule(_miner);
  IF r.cost IS NULL THEN RAISE EXCEPTION 'Unknown miner'; END IF;
  IF EXISTS (SELECT 1 FROM miners WHERE tg_id = _tg AND miner_id = _miner) THEN RAISE EXCEPTION 'You already own this miner'; END IF;
  UPDATE players SET coins = coins - r.cost, owns_miner2 = owns_miner2 OR _miner = 2
  WHERE tg_id = _tg AND coins >= r.cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not enough coins'; END IF;
  INSERT INTO miners(tg_id, miner_id, started_at) VALUES (_tg, _miner, now());
END $$;

CREATE OR REPLACE FUNCTION public.gm_claim_miner(_tg bigint, _miner int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM miner_rule(_miner);
  UPDATE miners SET started_at = now()
  WHERE tg_id = _tg AND miner_id = _miner AND started_at + make_interval(mins => r.minutes) <= now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Mining is not finished yet'; END IF;
  UPDATE players SET balance_milli = balance_milli + r.reward_milli WHERE tg_id = _tg;
END $$;

CREATE OR REPLACE FUNCTION public.gm_donate(_tg bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE players SET coins = coins - 100, donated_coins = donated_coins + 100 WHERE tg_id = _tg AND coins >= 100;
  IF NOT FOUND THEN RAISE EXCEPTION 'You need 100 coins to donate'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gm_claim_referral(_tg bigint, _friend bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM players WHERE tg_id = _friend AND referred_by = _tg FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral not found'; END IF;
  IF f.referral_claimed THEN RAISE EXCEPTION 'Already claimed'; END IF;
  IF NOT f.owns_miner2 THEN RAISE EXCEPTION 'NOT_ELIGIBLE'; END IF;
  UPDATE players SET referral_claimed = true WHERE tg_id = _friend;
  UPDATE players SET coins = coins + 100 WHERE tg_id = _tg;
END $$;

CREATE OR REPLACE FUNCTION public.gm_request_withdraw(_tg bigint, _milli bigint, _nano text, _address text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wid uuid;
BEGIN
  IF _milli < 100 THEN RAISE EXCEPTION 'Minimum withdraw is $0.10'; END IF;
  UPDATE players SET balance_milli = balance_milli - _milli WHERE tg_id = _tg AND balance_milli >= _milli;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not enough balance'; END IF;
  INSERT INTO withdrawals(tg_id, amount_milli, nano, address) VALUES (_tg, _milli, _nano, _address) RETURNING id INTO wid;
  RETURN wid;
END $$;

-- AdsGram reward: 100 coins, 3-minute cooldown, idempotent per session
CREATE OR REPLACE FUNCTION public.gm_ad_reward(_tg bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; p record;
BEGIN
  SELECT * INTO s FROM ad_sessions WHERE tg_id = _tg FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_session'; END IF;
  IF s.status = 'verified' THEN RETURN 'already'; END IF;
  IF s.status <> 'pending' OR s.expires_at <= now() THEN RETURN 'expired'; END IF;
  SELECT * INTO p FROM players WHERE tg_id = _tg FOR UPDATE;
  IF p.last_ad_session_id = s.session_id THEN
    UPDATE ad_sessions SET status='verified', verified_at=now() WHERE tg_id=_tg; RETURN 'already';
  END IF;
  IF p.last_ad_at IS NOT NULL AND p.last_ad_at + interval '3 minutes' > now() THEN RETURN 'cooldown'; END IF;
  UPDATE players SET coins = coins + 100, last_ad_at = now(), last_ad_session_id = s.session_id WHERE tg_id = _tg;
  UPDATE ad_sessions SET status='verified', verified_at=now() WHERE tg_id=_tg;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION public.gm_claim_bonus(bigint), public.gm_buy_miner(bigint,int), public.gm_claim_miner(bigint,int), public.gm_donate(bigint), public.gm_claim_referral(bigint,bigint), public.gm_request_withdraw(bigint,bigint,text,text), public.gm_ad_reward(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_claim_bonus(bigint), public.gm_buy_miner(bigint,int), public.gm_claim_miner(bigint,int), public.gm_donate(bigint), public.gm_claim_referral(bigint,bigint), public.gm_request_withdraw(bigint,bigint,text,text), public.gm_ad_reward(bigint) TO service_role;