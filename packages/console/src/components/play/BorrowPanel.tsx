import * as Select from "@radix-ui/react-select";
import { MARKETS_V2, ROUTER_POOLS } from "@entry-vault/shared";
import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { fmtUsd } from "../../lib/format";
import clsx from "clsx";

/** Where a debt level sits on the 0 → collateral scale, as a percentage. */
function pctOfCollateral(value: number, collateral: number) {
  if (collateral <= 0) return 0;
  return Math.max(0, Math.min(100, (value / collateral) * 100));
}

export function BorrowPanel() {
  const [marketId, setMarketId] = useState(MARKETS_V2[0].id);
  const [collateral, setCollateral] = useState(100_000);
  const [debt, setDebt] = useState(75_000);

  const borrow = useMutation({
    mutationFn: () => api.playBorrow({ marketId, collateralUsd: collateral, debtUsd: debt }),
  });

  const d = borrow.data;
  const statusClass =
    d?.status === "healthy" ? "ok" : d?.status === "liquidatable" ? "bad" : "warn";

  const market = MARKETS_V2.find((m) => m.id === marketId) ?? MARKETS_V2[0];
  const pool = ROUTER_POOLS.find((p) => p.id === market.id);
  const unfunded = (pool?.weightBps ?? 0) === 0;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Check borrow health</h2>
          <p>
            Isolated market rules — same math as <code>IsolatedMarket.sol</code>. Ratio check only:
            it does not consult market liquidity.
          </p>
        </div>
      </div>

      <label className="field">Market</label>
      <Select.Root value={marketId} onValueChange={setMarketId}>
        <Select.Trigger className="select-trigger">
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={16} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content">
            {MARKETS_V2.map((m) => {
              const p = ROUTER_POOLS.find((x) => x.id === m.id);
              return (
                <Select.Item key={m.id} value={m.id} className="select-item">
                  <Select.ItemText>
                    {m.asset} · {m.id}
                    {(p?.weightBps ?? 0) === 0 ? " · unfunded" : ""}
                  </Select.ItemText>
                </Select.Item>
              );
            })}
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      {unfunded && (
        <div className="hint hint--warn">
          {market.asset} receives no routed deposits. The ratio check below still runs, but an
          on-chain borrow would revert with <code>InsufficientLiquidity</code>.
        </div>
      )}

      <label className="field">Collateral (USD)</label>
      <input type="number" value={collateral} onChange={(e) => setCollateral(Number(e.target.value))} />

      <label className="field">Current debt (USD)</label>
      <input type="number" value={debt} onChange={(e) => setDebt(Number(e.target.value))} />

      <button className="btn btn-primary" type="button" disabled={borrow.isPending} onClick={() => borrow.mutate()}>
        {borrow.isPending ? <Loader2 className="spin" size={16} /> : null}
        Check Position
      </button>

      {d && (
        <>
          <div className="band">
            <div className="band-head">
              <span>Borrow band · {d.asset}</span>
              <span className="dim-inline">
                CF {(market.collateralFactor * 100).toFixed(0)}% → LT{" "}
                {(market.liquidationThreshold * 100).toFixed(0)}% ({d.band.widthPp.toFixed(0)}pp)
              </span>
            </div>

            <div className="band-track">
              <div
                className="band-zone band-zone--safe"
                style={{ width: `${pctOfCollateral(d.maxBorrowUsd, d.collateralUsd)}%` }}
              />
              <div
                className="band-zone band-zone--buffer"
                style={{
                  width: `${
                    pctOfCollateral(d.liquidationAtUsd, d.collateralUsd) -
                    pctOfCollateral(d.maxBorrowUsd, d.collateralUsd)
                  }%`,
                }}
              />
              <div className="band-zone band-zone--liq" />
              <div
                className="band-marker"
                style={{ left: `${pctOfCollateral(d.debtUsd, d.collateralUsd)}%` }}
                title={`Debt ${fmtUsd(d.debtUsd)}`}
              />
            </div>

            <div className="band-legend">
              <span className="band-key band-key--safe">
                Can borrow · ≤ {fmtUsd(d.band.lowUsd)}
              </span>
              <span className="band-key band-key--buffer">
                Buffer · {fmtUsd(d.band.lowUsd)} → {fmtUsd(d.band.highUsd)}
              </span>
              <span className="band-key band-key--liq">
                Liquidatable · &gt; {fmtUsd(d.band.highUsd)}
              </span>
            </div>
          </div>

          <div className={clsx("result", statusClass)}>
            <strong>{d.asset}</strong> · Health {d.healthFactor} · Status {d.status}
            <br />
            {d.plainEnglish}
            {d.band.inBand && (
              <>
                <br />
                <br />
                Band is {fmtUsd(d.band.widthUsd)} wide ({d.band.widthPp.toFixed(0)}pp of
                collateral). Repay {fmtUsd(d.band.repayToBorrowUsd)} to borrow again;{" "}
                {fmtUsd(d.band.headroomToLiquidationUsd)} of headroom before liquidation.
              </>
            )}
            {!d.band.inBand && d.band.drawdownToLiquidationPct !== null && !d.liquidatable && (
              <>
                <br />
                <br />
                A {d.band.drawdownToLiquidationPct.toFixed(1)}% collateral drawdown reaches the
                liquidation line.
              </>
            )}
            <br />
            <br />
            {d.steps.join(" · ")}
          </div>
        </>
      )}
    </div>
  );
}
