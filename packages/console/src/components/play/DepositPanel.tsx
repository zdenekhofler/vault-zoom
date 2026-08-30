import * as Slider from "@radix-ui/react-slider";
import { ROUTED_POOLS, STRATEGIES_V2, UNFUNDED_POOLS } from "@entry-vault/shared";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { fmtUsd } from "../../lib/format";
import { useVaultStore } from "../../store/vaultStore";

export function DepositPanel() {
  const [amount, setAmount] = useState(250_000);
  const setMetrics = useVaultStore((s) => s.setMetrics);
  const [glow, setGlow] = useState<string | null>(null);

  const deposit = useMutation({
    mutationFn: () => api.playDeposit(amount),
    onMutate: () => {
      ["vault", "router", "markets", "strategies"].forEach((id, i) =>
        setTimeout(() => setGlow(id), i * 400)
      );
      setTimeout(() => setGlow(null), 1800);
    },
    onSuccess: async () => {
      const [status, sim] = await Promise.all([api.vaultStatus(), api.simulationLatest()]);
      setMetrics(status, sim);
    },
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Simulate a deposit</h2>
          <p>
            <code>EntryVault.deposit()</code> → <code>YieldRouter.routeDeposit()</code> — layer 1
            splits by market, layer 2 allocates idle balances to strategies. See Markets → Capital
            flow for the full reconciliation.
          </p>
        </div>
      </div>

      <label className="field">Deposit amount (USD)</label>
      <Slider.Root
        className="slider-root"
        min={10_000}
        max={5_000_000}
        step={10_000}
        value={[amount]}
        onValueChange={([v]) => setAmount(v)}
      >
        <Slider.Track className="slider-track">
          <Slider.Range className="slider-range" />
        </Slider.Track>
        <Slider.Thumb className="slider-thumb" />
      </Slider.Root>
      <div className="val-display">{fmtUsd(amount)}</div>

      <div className="flow">
        {[
          { id: "vault", title: "Vault", sub: "mint shares" },
          { id: "router", title: "Router", sub: "split %" },
          {
            id: "markets",
            title: "Markets",
            sub: ROUTED_POOLS.map((p) => `${p.asset} ${p.weightBps / 100}%`).join(" · "),
          },
          {
            id: "strategies",
            title: "Strategies",
            sub: `${STRATEGIES_V2.length} venues · idle only`,
          },
        ].map((n, i, arr) => (
          <div key={n.id} className="flow-item">
            <motion.div
              className={`node ${glow === n.id ? "glow" : ""}`}
              animate={glow === n.id ? { scale: 1.04 } : { scale: 1 }}
            >
              <strong>{n.title}</strong>
              <span>{n.sub}</span>
            </motion.div>
            {i < arr.length - 1 && <ArrowRight className="arrow" size={18} />}
          </div>
        ))}
      </div>

      {UNFUNDED_POOLS.length > 0 && (
        <div className="hint hint--warn">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: ".35rem" }} />
          Routing gap — {UNFUNDED_POOLS.map((p) => p.asset).join(", ")}{" "}
          {UNFUNDED_POOLS.length === 1 ? "is" : "are"} listed in Markets and selectable in Check
          Position, but {UNFUNDED_POOLS.length === 1 ? "receives" : "receive"} 0% of every deposit.
        </div>
      )}

      {deposit.data && (
        <div className="splits">
          {deposit.data.routes.map((r) => (
            <div key={r.marketId} className="split-row">
              <span>{r.asset}</span>
              <div className="split-track">
                <div className="split-fill" style={{ width: `${r.weightPct}%` }} />
              </div>
              <em>{fmtUsd(r.amountUsd)}</em>
            </div>
          ))}
          {deposit.data.unfunded.map((u) => (
            <div key={u.marketId} className="split-row split-row--unfunded">
              <span>{u.asset}</span>
              <div className="split-track">
                <div className="split-fill split-fill--empty" style={{ width: "0%" }} />
              </div>
              <em className="dim-inline">not routed</em>
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-primary" type="button" disabled={deposit.isPending} onClick={() => deposit.mutate()}>
        {deposit.isPending ? <Loader2 className="spin" size={16} /> : null}
        Simulate Deposit
      </button>

      <div className="log">
        {(deposit.data?.steps ?? ["Adjust slider and click Simulate Deposit."]).map((s, i, arr) => (
          <p key={i} className={i === arr.length - 1 && deposit.data ? "new" : ""}>
            {s}
          </p>
        ))}
      </div>
    </div>
  );
}
