<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Gram Miner is a Telegram Mini App: every server function verifies Telegram initData (Ed25519 signature, bot id from the Telegram connector) — there is no Supabase Auth; the client never decides balances.
- All balance changes run in SECURITY DEFINER `gm_*` SQL functions callable only by service_role, so checks and updates are atomic; tables have RLS on with no client policies.
- Shared numbers live in `src/lib/rules.ts` (tested in `rules.test.ts`) and must match `public.miner_rule` and the `gm_*` functions.
- AdsGram rewards are granted only by the server callback `/api/public/adsgram/reward`; TON payouts batch through toncenter REST (no TonClient) and post proof to the Telegram channel after on-chain confirmation.
