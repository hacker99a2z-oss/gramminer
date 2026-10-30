import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Gift, Lock, Play, Timer, Zap } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon, GameShell, SectionTitle } from "@/components/GameShell";
import { buyMiner, claimBonus, claimMiner } from "@/lib/game.functions";
import { errMsg, useGame, useGameClock } from "@/lib/game";
import { useRewardedAd } from "@/lib/use-ad";
import { MINERS, minerReadyAt, usd, type MinerRule } from "@/lib/rules";
import { haptic } from "@/lib/telegram";
import minerImg from "@/assets/miner.png";

export const Route = createFileRoute("/")({ component: Home });

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function BonusCard() {
  const game = useGame();
  const claim = (claimBonus);
  const ad = useRewardedAd();
  const [busy, setBusy] = useState(false);
  const bonus = game.state?.bonusAvailable ?? false;

  const onClick = async () => {
    if (!game.initData) { toast.error("Open the app inside Telegram"); return; }
    setBusy(true);
    try {
      if (bonus) {
        game.setState(await claim({ data: { initData: game.initData } }));
        toast.success("+100 coins claimed!");
      } else {
        await ad.play();
        toast.success("+100 coins for watching the ad!");
      }
      haptic("success");
    } catch (e) {
      haptic("error");
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const waiting = !bonus && ad.left > 0;
  return (
    <section className="card-gm card-gold-edge relative mb-5 overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <CoinIcon className="coin-spin h-14 w-14 shrink-0" />
        <div>
          <p className="font-display text-base font-bold leading-snug">Click on below button to claim 100 coins.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            If you need more coins then <span className="font-bold text-primary">watch ads = 100 coins</span>.
          </p>
        </div>
      </div>
      <button className="btn-gold shine relative mt-4 w-full" disabled={busy || ad.loading || waiting || !game.state} onClick={onClick}>
        {bonus ? (
          <><Gift className="h-5 w-5" /> Claim Bonus (100)</>
        ) : waiting ? (
          <><Timer className="h-5 w-5" /> Next ad in {ad.timer}</>
        ) : busy || ad.loading ? (
          "Loading ad…"
        ) : (
          <><Play className="h-5 w-5" /> Watch Ad = 100 coins</>
        )}
      </button>
    </section>
  );
}

function MinerCard({ rule, wide }: { rule: MinerRule; wide?: boolean }) {
  const game = useGame();
  const now = useGameClock();
  const buy = (buyMiner);
  const claim = (claimMiner);
  const [busy, setBusy] = useState(false);
  const owned = game.state?.miners.find((m) => m.id === rule.id);
  const readyAt = owned ? minerReadyAt(owned.startedAt, rule.id) : 0;
  const left = owned ? readyAt - now : 0;
  const total = rule.minutes * 60_000;
  const pct = owned ? Math.min(100, ((total - Math.max(0, left)) / total) * 100) : 0;
  const ready = owned && left <= 0;
  const canAfford = (game.state?.coins ?? 0) >= rule.cost;

  const act = async () => {
    if (!game.initData) { toast.error("Open the app inside Telegram"); return; }
    setBusy(true);
    try {
      if (!owned) {
        game.setState(await buy({ data: { initData: game.initData, minerId: rule.id } }));
        toast.success(`Miner #${rule.id} is now mining!`);
      } else {
        game.setState(await claim({ data: { initData: game.initData, minerId: rule.id } }));
        toast.success(`${usd(rule.rewardMilli)} added to your withdraw balance`);
      }
      haptic("success");
    } catch (e) {
      haptic("error");
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card-gm relative flex overflow-hidden p-3 ${wide ? "col-span-2 flex-row items-center gap-3" : "flex-col"} ${owned ? "card-gold-edge" : ""}`}>
      <span className="absolute left-2 top-2 rounded-full bg-secondary px-2 py-0.5 font-display text-[10px] font-bold text-primary">#{rule.id}</span>
      <img
        src={minerImg}
        alt={`Miner ${rule.id}`}
        loading="lazy"
        width={816}
        height={816}
        className={`${wide ? "h-24 w-24" : "mx-auto h-20 w-20"} object-contain ${owned && !ready ? "mining-pulse" : ""} ${owned ? "" : "opacity-60 grayscale"}`}
      />
      <div className={wide ? "flex-1" : "mt-1"}>
        <div className="space-y-1 text-[11px]">
          <Row label="Price" value={<span className="flex items-center gap-1"><CoinIcon className="h-3.5 w-3.5" />{rule.cost.toLocaleString()}</span>} />
          <Row label="Time" value={`${rule.minutes} min`} />
          <Row label="Earn" value={<span className="text-success">{usd(rule.rewardMilli)}</span>} />
        </div>
        {owned && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="bg-gold-gradient h-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        <button
          className={`${ready || !owned ? "btn-gold" : "btn-ghost-gm"} mt-2 w-full !py-2 text-xs`}
          disabled={busy || !game.state || (owned && !ready) || (!owned && !canAfford)}
          onClick={act}
        >
          {!owned ? (
            canAfford ? <><Zap className="h-4 w-4" /> Buy</> : <><Lock className="h-3.5 w-3.5" /> Buy</>
          ) : ready ? (
            `Claim ${usd(rule.rewardMilli)}`
          ) : (
            <><Timer className="h-3.5 w-3.5" /> {fmt(left)}</>
          )}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function Home() {
  return (
    <GameShell>
      <BonusCard />
      <SectionTitle kicker="Mining farm" title="Your Miner" />
      <div className="grid grid-cols-2 gap-3">
        {MINERS.map((m) => (
          <MinerCard key={m.id} rule={m} wide={m.id === 5} />
        ))}
      </div>
    </GameShell>
  );
}
