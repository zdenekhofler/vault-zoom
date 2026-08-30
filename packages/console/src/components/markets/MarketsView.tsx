import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { fmtApy, fmtPct, fmtBpsWeight } from "../../lib/format";
import clsx from "clsx";

export function MarketsView() {
  const { data, isLoading, error } = useQuery({ queryKey: ["markets"], queryFn: api.markets });
  const flow = useQuery({ queryKey: ["capital-flow"], queryFn: api.capitalFlow });

  if (isLoading) return <p className="dim">Loading markets…</p>;
  if (error) return <div className="result bad">{String(error)}</div>;
  if (!data) return null;

  const bandFor = (id: string) => data.riskBands?.find((b) => b.id === id);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>Isolated markets</h2>
          <p>
            Live from <code>/v1/markets</code> — borrow checker + simulator config. “Buffer” is the
            gap between collateral factor and liquidation threshold: debt in that range can neither
            grow nor be liquidated.
          </p>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Market</th>
              <th>Coll. factor</th>
              <th>Liq. threshold</th>
              <th>Buffer</th>
              <th>Liq. bonus</th>
              <th>Max util</th>
              <th>Deposit routing</th>
            </tr>
          </thead>
          <tbody>
            {data.markets.map((m) => {
              const b = bandFor(m.id);
              const routed = (b?.routedWeightBps ?? 0) > 0;
              return (
                <tr key={m.id}>
                  <td>
                    <strong>{m.asset}</strong>
                    <span className="dim">{m.id}</span>
                  </td>
                  <td>{fmtPct(m.collateralFactor)}</td>
                  <td>{fmtPct(m.liquidationThreshold)}</td>
                  <td>
                    {b ? `${b.bufferPp.toFixed(0)}pp` : "—"}
                    {b && (
                      <span className="dim">−{b.drawdownToLiquidationPct.toFixed(1)}% to liq.</span>
                    )}
                  </td>
                  <td>{fmtPct(m.liquidationBonus)}</td>
                  <td>{fmtPct(m.maxUtilization)}</td>
                  <td>
                    <span className={clsx("tag", routed ? "tag--routed" : "tag--unfunded")}>
                      {routed ? fmtBpsWeight(b!.routedWeightBps) : "unfunded"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {flow.data && (
        <div className="panel">
          <div className="panel-head">
            <h2>Capital flow — reconciliation</h2>
            <p>{flow.data.relationship}</p>
          </div>

          {flow.data.models.map((m) => (
            <div key={m.layer} className="flow-model">
              <h3>{m.label}</h3>
              <p className="flow-answers">
                {m.answers} · shown in <em>{m.surface}</em> · source{" "}
                <span className="flow-src">{m.source}</span> · {fmtBpsWeight(m.totalWeightBps)} total
              </p>
              {m.legs.map((leg) => (
                <div key={leg.id} className={clsx("split-row", !leg.active && "split-row--unfunded")}>
                  <span>{leg.label}</span>
                  <div className="split-track">
                    <div
                      className={clsx("split-fill", !leg.active && "split-fill--empty")}
                      style={{ width: `${leg.weightBps / 100}%` }}
                    />
                  </div>
                  <em className="dim-inline">
                    {leg.active ? fmtBpsWeight(leg.weightBps) : "not routed"}
                  </em>
                </div>
              ))}
            </div>
          ))}

          <h4 className="subhead">Consistency checks</h4>
          {flow.data.checks.map((c) => (
            <div key={c.id} className="check-row">
              <span className={clsx("check-badge", c.ok ? "check-badge--ok" : "check-badge--fail")}>
                {c.ok ? "pass" : "gap"}
              </span>
              <div>
                {c.label}
                <span className="check-detail">{c.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Yield router strategies</h2>
          <p>
            Layer 2 — external venues for idle liquidity. These weights allocate capital already
            sitting in the isolated markets; they are not a second split of the deposit itself.
          </p>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Weight</th>
              <th>Base APY</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {data.router.strategies.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <span className="dim">{s.id}</span>
                </td>
                <td>{fmtBpsWeight(s.weightBps)}</td>
                <td>{fmtApy(s.baseApyBps)}</td>
                <td>
                  <span className={clsx("risk", `risk--${s.riskTier}`)}>{s.riskTier}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
