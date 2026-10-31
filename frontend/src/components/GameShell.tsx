import { Link } from "@tanstack/react-router";
import { HandHeart, Home, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useGame } from "@/lib/game";
import coin from "@/assets/coin.png";

const NAV = [
  { to: "/refer", label: "Refer", icon: Users },
  { to: "/", label: "Home", icon: Home },
  { to: "/donate", label: "Donate", icon: HandHeart },
  { to: "/withdraw", label: "Withdraw", icon: Wallet },
] as const;

export function CoinIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <img src={coin} alt="" className={className} width={816} height={816} />;
}

export function ProfileCard() {
  const { user, state } = useGame();
  return (
    <header className="card-gm card-gold-edge mb-4 flex items-center gap-3 p-3">
      {user.photoUrl ? (
        <img src={user.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/60" />
      ) : (
        <div className="bg-gold-gradient flex h-12 w-12 items-center justify-center rounded-full font-display text-lg font-bold text-primary-foreground">
          {user.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.username ? `@${user.username}` : "Gram Miner"}</p>
      </div>
      <div className="text-right">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Coins</p>
        <div className="flex items-center justify-end gap-1.5">
          <CoinIcon className="coin-spin h-5 w-5" />
          <span className="font-display text-lg font-bold text-gold-gradient">{(state?.coins ?? 0).toLocaleString()}</span>
        </div>
      </div>
    </header>
  );
}

export function GameShell({ children, profile = true }: { children: ReactNode; profile?: boolean }) {
  const { error, ready } = useGame();
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28 pt-4">
      {profile && <ProfileCard />}
      {ready && error && (
        <div className="card-gm mb-4 border-destructive/40 p-3 text-center text-sm text-muted-foreground">{error}</div>
      )}
      <main className="flex-1">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-3 pb-3">
        <div className="card-gm grid grid-cols-4 gap-1 p-1.5 backdrop-blur">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-bold text-muted-foreground transition-colors"
              activeProps={{ className: "bg-gold-gradient !text-primary-foreground shadow-lg" }}
              activeOptions={{ exact: true }}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary">{kicker}</p>
      <h2 className="font-display text-xl font-bold">{title}</h2>
    </div>
  );
}
