import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, Wallet } from "lucide-react";
import { toast } from "sonner";
import { GameShell, SectionTitle } from "@/components/GameShell";
import { requestWithdraw } from "@/lib/game.functions";
import { errMsg, useGame } from "@/lib/game";
import { MIN_WITHDRAW_MILLI, usd } from "@/lib/rules";
import { getWallet, shortAddr, useWalletAddress } from "@/lib/wallet";
import { haptic } from "@/lib/telegram";

export const Route = createFileRoute("/withdraw")({
  head: () => ({
    meta: [
      { title: "Withdraw — Gram Miner" },
      { name: "description", content: "Withdraw your Gram Miner earnings automatically to your Tonkeeper wallet." },
      { property: "og:title", content: "Withdraw — Gram Miner" },
      { property: "og:description", content: "Automatic withdrawals to Tonkeeper." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Withdraw,
});

const statusLabel: Record<string, string> = { sending: "pending" };

const statusStyle: Record<string, string> = {
  sent: "bg-success/15 text-success",
  pending: "bg-accent text-accent-foreground",
  sending: "bg-accent text-accent-foreground",
  failed: "bg-destructive/20 text-destructive",
};

function Withdraw() {
  const game = useGame();
  const send = useServerFn(requestWithdraw);
  const address = useWalletAddress();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const balance = game.state?.balanceMilli ?? 0;
  const pct = Math.min(100, (balance / MIN_WITHDRAW_MILLI) * 100);
  const history = game.state?.withdrawals ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!game.initData) { toast.error("Open the app inside Telegram"); return; }
    if (!address) { toast.error("Connect your Tonkeeper wallet first"); return; }
    const milli = Math.round(Number(amount) * 1000);
    if (!Number.isFinite(milli) || milli < MIN_WITHDRAW_MILLI) { toast.error(`Minimum withdraw is ${usd(MIN_WITHDRAW_MILLI)}`); return; }
    if (milli > balance) { toast.error("Not enough balance"); return; }
    setBusy(true);
    try {
      game.setState(await send({ data: { initData: game.initData, milli, address } }));
      setAmount("");
      haptic("success");
      toast.success("Withdrawal requested — it will be sent automatically");
    } catch (err) {
      haptic("error");
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell>
      <section className="card-gm card-gold-edge mb-4 p-5 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">Withdrawal balance</p>
        <p className="mt-1 font-display text-4xl font-bold text-gold-gradient">${(balance / 1000).toFixed(3)}</p>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-gold-gradient h-full" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          Progress to minimum: {usd(balance)} / {usd(MIN_WITHDRAW_MILLI)}
        </p>
      </section>

      <form onSubmit={submit} className="card-gm mb-4 space-y-3 p-4">
        <div className="flex items-center gap-2 rounded-xl bg-secondary p-3">
          <Wallet className="h-5 w-5 text-primary" />
          <span className="flex-1 text-sm font-semibold">{address ? `Tonkeeper: ${shortAddr(address)}` : "Tonkeeper not connected"}</span>
          <button
            type="button"
            className="btn-gold !px-3 !py-1.5 text-xs"
            onClick={async () => {
              const ui = await getWallet();
              if (ui.connected) await ui.disconnect();
              else await ui.openModal();
            }}
          >
            {address ? "Disconnect" : "Connect"}
          </button>
        </div>
        <input
          className="w-full rounded-xl border border-input bg-background px-3 py-3 font-semibold outline-none focus:border-ring"
          placeholder={`Amount in $ (min ${usd(MIN_WITHDRAW_MILLI)})`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        />
        <button className="btn-gold shine w-full" disabled={busy || balance < MIN_WITHDRAW_MILLI || !address}>
          {busy ? "Sending…" : "Withdraw"}
        </button>
      </form>

      {game.proofUrl && (
        <a href={game.proofUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost-gm mb-4 w-full text-sm">
          Payments' proof <ExternalLink className="h-4 w-4" />
        </a>
      )}

      <SectionTitle kicker="Your payouts" title="History" />
      {!history.length ? (
        <p className="card-gm p-5 text-center text-sm text-muted-foreground">No withdrawals yet</p>
      ) : (
        <div className="space-y-2">
          {history.map((w) => (
            <div key={w.id} className="card-gm flex items-center justify-between gap-3 p-3">
              <div>
                <p className="font-display text-sm font-bold">{usd(w.milli)} <span className="text-xs font-normal text-muted-foreground">· {w.ton.toFixed(4)} TON</span></p>
                <p className="text-xs text-muted-foreground">Tonkeeper · {shortAddr(w.address)} · {new Date(w.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${statusStyle[w.status] ?? "bg-secondary"}`}>{statusLabel[w.status] ?? w.status}</span>
                {w.status === "sent" && w.proofMessageUrl && (
                  <a
                    href={w.proofMessageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost-gm !px-3 !py-1 text-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> View
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GameShell>
  );
}
