import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Copy, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon, GameShell, SectionTitle } from "@/components/GameShell";
import { claimReferral, getReferrals } from "@/lib/game.functions";
import { errMsg, useGame } from "@/lib/game";
import { REFERRAL_REWARD_COINS } from "@/lib/rules";
import { haptic, tgApp } from "@/lib/telegram";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/refer")({
  head: () => ({
    meta: [
      { title: "Invite friends — Gram Miner" },
      { name: "description", content: "Share your Gram Miner link and earn 100 coins for every friend who buys Miner #2." },
      { property: "og:title", content: "Invite friends — Gram Miner" },
      { property: "og:description", content: "Earn 100 coins for each friend who buys Miner #2." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Refer,
});

function Refer() {
  const game = useGame();
  const list = useServerFn(getReferrals);
  const claim = useServerFn(claimReferral);
  const qc = useQueryClient();
  const [popup, setPopup] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data: refs } = useQuery({
    queryKey: ["referrals", game.user.id],
    queryFn: () => list({ data: { initData: game.initData! } }),
    enabled: !!game.initData,
  });

  const link = `https://t.me/playersfordestiny_bot?startapp=ref_${game.user.id ?? "guest"}`;
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("⛏ Join me on Gram Miner — mine coins and earn!")}`;
    const app = tgApp();
    if (app?.openTelegramLink) app.openTelegramLink(url);
    else window.open(url, "_blank");
  };
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied");
  };

  const onClaim = async (friendId: number) => {
    if (!game.initData) return;
    setBusyId(friendId);
    try {
      const r = await claim({ data: { initData: game.initData, friendId } });
      if (!r.ok) {
        haptic("error");
        setPopup(true);
        return;
      }
      game.setState(r.state);
      await qc.invalidateQueries({ queryKey: ["referrals"] });
      haptic("success");
      toast.success(`+${REFERRAL_REWARD_COINS} coins!`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <GameShell>
      <section className="card-gm card-gold-edge mb-5 overflow-hidden">
        <div className="bg-gold-gradient p-5 text-center text-primary-foreground">
          <Users className="mx-auto h-10 w-10" />
          <p className="mt-2 font-display text-2xl font-bold">Earn {REFERRAL_REWARD_COINS} coins</p>
          <p className="text-sm font-semibold">for every friend who buys Miner #2</p>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 rounded-xl bg-secondary p-3">
            <span className="flex-1 truncate text-sm font-semibold">{link}</span>
            <button onClick={copy} aria-label="Copy link" className="text-primary">
              <Copy className="h-5 w-5" />
            </button>
          </div>
          <button onClick={share} className="btn-gold w-full">
            <Send className="h-4 w-4" /> Share on Telegram
          </button>
        </div>
      </section>

      <SectionTitle kicker={`${refs?.length ?? 0} friends`} title="Your Referrals" />
      {!refs?.length ? (
        <p className="card-gm p-5 text-center text-sm text-muted-foreground">No referrals yet. Share your link to invite friends.</p>
      ) : (
        <ul className="space-y-2">
          {refs.map((r) => (
            <li key={r.id} className="card-gm flex items-center gap-3 p-3">
              {r.photoUrl ? (
                <img src={r.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary font-bold">{r.name.charAt(0)}</div>
              )}
              <span className="flex-1 truncate font-semibold">{r.name}</span>
              <span className="flex items-center gap-1 text-sm font-bold">
                <CoinIcon className="h-4 w-4" /> {REFERRAL_REWARD_COINS}
              </span>
              {r.claimed ? (
                <span className="btn-ghost-gm !px-3 !py-1.5 text-xs text-success"><Check className="h-4 w-4" /> Claimed</span>
              ) : (
                <button className="btn-gold !px-3 !py-1.5 text-xs" disabled={busyId === r.id} onClick={() => onClaim(r.id)}>
                  Claim
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={popup} onOpenChange={setPopup}>
        <AlertDialogContent className="card-gm max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Not yet!</AlertDialogTitle>
            <AlertDialogDescription>Your referral still not buy the 2nd miner.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="btn-gold">OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GameShell>
  );
}
