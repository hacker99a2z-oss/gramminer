import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Crown, HandHeart, Heart } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon, GameShell, SectionTitle } from "@/components/GameShell";
import { donate, getLeaderboard } from "@/lib/game.functions";
import { errMsg, useGame } from "@/lib/game";
import { DONATE_COINS, LEADERBOARD_SIZE } from "@/lib/rules";
import { haptic } from "@/lib/telegram";

export const Route = createFileRoute("/donate")({
  head: () => ({
    meta: [
      { title: "Donate to the poor — Gram Miner" },
      { name: "description", content: "Give coins to support people in need and climb the Gram Miner top donors board." },
      { property: "og:title", content: "Donate to the poor — Gram Miner" },
      { property: "og:description", content: "Give 100 coins to support the poor and join the top 20 donors." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Donate,
});

const medal = ["bg-gold-gradient text-primary-foreground", "bg-muted-foreground/80 text-background", "bg-gold-deep text-primary-foreground"];

function Donate() {
  const game = useGame();
  const give = useServerFn(donate);
  const board = useServerFn(getLeaderboard);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["leaderboard"], queryFn: () => board() });
  const [busy, setBusy] = useState(false);

  const onGive = async () => {
    if (!game.initData) { toast.error("Open the app inside Telegram"); return; }
    setBusy(true);
    try {
      game.setState(await give({ data: { initData: game.initData } }));
      await qc.invalidateQueries({ queryKey: ["leaderboard"] });
      haptic("success");
      toast.success("Thank you for your kindness ❤️");
    } catch (e) {
      haptic("error");
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell>
      <section className="card-gm card-gold-edge relative mb-5 overflow-hidden p-5 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-16 mx-auto h-40 w-40 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-gradient shadow-lg">
          <HandHeart className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="relative mt-3 font-display text-xl font-bold">Help the Poor</h1>
        <p className="relative mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          A small gift can bring a big smile. Share your coins to support people in need — every coin counts.
        </p>
        <div className="relative mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Heart className="h-4 w-4 text-destructive" /> Community donated
          <CoinIcon className="h-4 w-4" />
          <span className="font-bold text-foreground">{(data?.total ?? 0).toLocaleString()}</span>
        </div>
        <button className="btn-gold shine relative mt-4 w-full text-sm" disabled={busy || (game.state?.coins ?? 0) < DONATE_COINS} onClick={onGive}>
          <Heart className="h-5 w-5" /> Give {DONATE_COINS} coins to support the poor
        </button>
        <p className="relative mt-2 text-xs text-muted-foreground">You have donated {(game.state?.donatedCoins ?? 0).toLocaleString()} coins</p>
      </section>

      <SectionTitle kicker={`Top ${LEADERBOARD_SIZE}`} title="Top Donors" />
      {!data?.top.length ? (
        <p className="card-gm p-5 text-center text-sm text-muted-foreground">Be the first kind heart on the board.</p>
      ) : (
        <ol className="space-y-2">
          {data.top.map((d, i) => (
            <li key={d.id} className={`card-gm flex items-center gap-3 p-3 ${d.id === game.user.id ? "card-gold-edge" : ""}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${medal[i] ?? "bg-secondary text-muted-foreground"}`}>
                {i === 0 ? <Crown className="h-4 w-4" /> : i + 1}
              </span>
              {d.photoUrl ? (
                <img src={d.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary font-bold">{d.name.charAt(0)}</div>
              )}
              <span className="flex-1 truncate font-semibold">{d.name}</span>
              <span className="flex items-center gap-1 font-display text-sm font-bold text-gold-gradient">
                <CoinIcon className="h-4 w-4" />
                {d.coins.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </GameShell>
  );
}
