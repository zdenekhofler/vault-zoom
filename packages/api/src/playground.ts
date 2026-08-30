import {
  MARKETS_V2,
  ROUTER_POOLS,
  ROUTED_POOLS,
  UNFUNDED_POOLS,
  marketRiskBand,
  reconcileCapitalFlows,
} from "@entry-vault/shared";
import type { CapitalFlowReconciliation } from "@entry-vault/shared";

const fmt = (n: number) =>
  "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export interface DepositRoute {
  marketId: string;
  asset: string;
  weightBps: number;
  weightPct: number;
  amountUsd: number;
  funding: "routed" | "collateral-only";
}

export interface DepositSimulation {
  depositUsd: number;
  sharesMinted: number;
  routes: DepositRoute[];
  /** Listed markets that this deposit does NOT fund. */
  unfunded: Array<{ marketId: string; asset: string; reason: string }>;
  coverage: {
    listedMarkets: number;
    fundedMarkets: number;
    routedWeightBps: number;
  };
  steps: string[];
  warnings: string[];
}

export function simulateDeposit(amountUsd: number): DepositSimulation {
  const amount = Math.max(0, Math.round(amountUsd));

  // Only routed pools carry weight; a collateral-only pool is 0 bps by
  // construction, so dividing by the routed total keeps the split at 100%.
  const totalW = ROUTED_POOLS.reduce((a, p) => a + p.weightBps, 0);

  const routes: DepositRoute[] = ROUTED_POOLS.map((p) => ({
    marketId: p.id,
    asset: p.asset,
    weightBps: p.weightBps,
    weightPct: totalW > 0 ? (p.weightBps * 100) / totalW : 0,
    amountUsd: totalW > 0 ? Math.round((amount * p.weightBps) / totalW) : 0,
    funding: p.funding,
  }));

  const unfunded = UNFUNDED_POOLS.map((p) => ({
    marketId: p.id,
    asset: p.asset,
    reason: p.note,
  }));

  const steps = [
    `You deposit ${fmt(amount)} into Entry Vault.`,
    `Vault mints ${fmt(amount)} evShare shares (1:1 at first deposit).`,
    `YieldRouter.routeDeposit() splits capital across ${routes.length} funded markets:`,
    ...routes.map(
      (r) => `  → ${fmt(r.amountUsd)} (${r.weightPct.toFixed(0)}%) into ${r.asset} IsolatedMarket`
    ),
    `Each market is isolated — a loss in one cannot reach the others.`,
    ...unfunded.map(
      (u) => `  ⚠ ${u.asset} (${u.marketId}) receives ${fmt(0)} — listed but not in the routing table.`
    ),
    `Idle balances in the funded markets are then allocated to external strategies (layer 2).`,
  ];

  const warnings = unfunded.map(
    (u) =>
      `${u.asset} is selectable in Check Position and listed in Markets, but no deposit routes supply to it. On-chain, IsolatedMarket.borrow() reverts with InsufficientLiquidity when totalSupply is 0.`
  );

  return {
    depositUsd: amount,
    sharesMinted: amount,
    routes,
    unfunded,
    coverage: {
      listedMarkets: MARKETS_V2.length,
      fundedMarkets: routes.length,
      routedWeightBps: totalW,
    },
    steps,
    warnings,
  };
}

export function capitalFlow(): CapitalFlowReconciliation {
  return reconcileCapitalFlows();
}

export type BorrowStatus = "healthy" | "borrow-limit" | "liquidatable";

export interface BorrowHealthResult {
  marketId: string;
  asset: string;
  collateralUsd: number;
  debtUsd: number;
  maxBorrowUsd: number;
  liquidationAtUsd: number;
  canBorrow: boolean;
  liquidatable: boolean;
  healthFactor: number;
  status: BorrowStatus;
  /**
   * The no-man's-land between the collateral factor and the liquidation
   * threshold: too indebted to borrow more, not indebted enough to liquidate.
   */
  band: {
    lowUsd: number;
    highUsd: number;
    widthUsd: number;
    widthPp: number;
    /** True when current debt sits inside the band. */
    inBand: boolean;
    /** 0–1 position across the band; null when outside it. */
    positionPct: number | null;
    /** Debt repayment needed to borrow again. Zero when below the CF line. */
    repayToBorrowUsd: number;
    /** Debt headroom before liquidation. Negative when already liquidatable. */
    headroomToLiquidationUsd: number;
    /** Collateral drawdown that would push this debt to the liquidation line. */
    drawdownToLiquidationPct: number | null;
  };
  liquidity: {
    funding: "routed" | "collateral-only";
    routedWeightBps: number;
    /** Whether a real borrow could execute on-chain, ignoring health. */
    borrowable: boolean;
    note: string;
  };
  plainEnglish: string;
  steps: string[];
}

export function checkBorrowHealth(
  marketId: string,
  collateralUsd: number,
  debtUsd: number
): BorrowHealthResult {
  const market = MARKETS_V2.find((m) => m.id === marketId) ?? MARKETS_V2[0];
  const risk = marketRiskBand(market);
  const pool = ROUTER_POOLS.find((p) => p.id === market.id);

  const col = Math.max(0, collateralUsd);
  const debt = Math.max(0, debtUsd);

  const maxBorrow = col * market.collateralFactor;
  const liqLine = col * market.liquidationThreshold;

  const canBorrow = debt <= maxBorrow || debt === 0;
  const liquidatable = debt > liqLine && debt > 0;
  const healthFactor = debt > 0 ? liqLine / debt : 999;

  let status: BorrowStatus = "healthy";
  if (liquidatable) status = "liquidatable";
  else if (!canBorrow) status = "borrow-limit";

  const bandWidth = Math.max(0, liqLine - maxBorrow);
  const inBand = debt > maxBorrow && debt <= liqLine && debt > 0;

  const band = {
    lowUsd: Math.round(maxBorrow),
    highUsd: Math.round(liqLine),
    widthUsd: Math.round(bandWidth),
    widthPp: risk.bufferPp,
    inBand,
    positionPct: inBand && bandWidth > 0 ? Math.round(((debt - maxBorrow) / bandWidth) * 100) / 100 : null,
    repayToBorrowUsd: debt > maxBorrow ? Math.round(debt - maxBorrow) : 0,
    headroomToLiquidationUsd: Math.round(liqLine - debt),
    drawdownToLiquidationPct:
      debt > 0 && liqLine > 0 && col > 0
        ? Math.round((1 - debt / liqLine) * 10_000) / 100
        : null,
  };

  const borrowable = (pool?.weightBps ?? 0) > 0;
  const liquidity = {
    funding: (pool?.funding ?? "collateral-only") as "routed" | "collateral-only",
    routedWeightBps: pool?.weightBps ?? 0,
    borrowable,
    note: borrowable
      ? `Funded by deposit routing at ${((pool?.weightBps ?? 0) / 100).toFixed(0)}% of every deposit.`
      : "No deposit routes supply here — this check is ratio-only; a real borrow would revert with InsufficientLiquidity.",
  };

  const verdict = liquidatable
    ? `⚠ Debt is past the ${(market.liquidationThreshold * 100).toFixed(0)}% liquidation line — eligible for liquidation.`
    : inBand
      ? `▲ In the buffer band — above the ${(market.collateralFactor * 100).toFixed(0)}% borrow limit but below the ${(market.liquidationThreshold * 100).toFixed(0)}% liquidation line. Cannot borrow more; not liquidatable.`
      : canBorrow
        ? "✓ Position is healthy — within borrow limits."
        : "✗ Debt exceeds collateral factor — cannot borrow more.";

  const steps = [
    `Market: ${market.asset} (${market.id}) — isolated pool`,
    `Your collateral: ${fmt(col)} · Debt: ${fmt(debt)}`,
    `Max borrow at ${(market.collateralFactor * 100).toFixed(0)}% collateral factor: ${fmt(maxBorrow)}`,
    `Liquidation line at ${(market.liquidationThreshold * 100).toFixed(0)}% threshold: ${fmt(liqLine)}`,
    `Buffer band: ${fmt(maxBorrow)} → ${fmt(liqLine)} (${risk.bufferPp.toFixed(0)}pp of collateral, ${fmt(bandWidth)} wide)`,
    verdict,
  ];

  if (!borrowable) steps.push(`Liquidity: ${liquidity.note}`);

  return {
    marketId: market.id,
    asset: market.asset,
    collateralUsd: col,
    debtUsd: debt,
    maxBorrowUsd: Math.round(maxBorrow),
    liquidationAtUsd: Math.round(liqLine),
    canBorrow,
    liquidatable,
    healthFactor: Math.round(healthFactor * 100) / 100,
    status,
    band,
    liquidity,
    plainEnglish: verdict,
    steps,
  };
}
