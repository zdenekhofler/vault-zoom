/** Entry Vault — shared domain types (v0.4 internal QA) */

export const PROTOCOL = {
  name: "Entry Vault",
  version: "0.4.0-internal",
  stage: "internal-qa" as const,
  auditSprint: "2026-08",
  launchTarget: "2026-Q4",
  chains: ["ethereum", "arbitrum"] as const,
};

export type ChainId = (typeof PROTOCOL.chains)[number];

export interface MarketConfig {
  id: string;
  asset: string;
  collateralFactor: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  reserveFactor: number;
  maxUtilization: number;
}

/**
 * How a market receives supply capital.
 * - "routed"          — YieldRouter sends it a slice of every deposit.
 * - "collateral-only" — listed and borrow-checkable, but no deposit ever funds it.
 */
export type PoolFunding = "routed" | "collateral-only";

export interface RouterPool {
  id: string;
  asset: string;
  weightBps: number;
  funding: PoolFunding;
  note: string;
}

export interface StrategyAllocation {
  id: string;
  name: string;
  weightBps: number;
  baseApyBps: number;
  riskTier: "low" | "medium" | "high";
}

export interface SimulationScenario {
  id: string;
  label: string;
  durationDays: number;
  ethDrawdownPct: number;
  depositGrowthPct: number;
  borrowDemandMultiplier: number;
}

export interface SimulationSnapshot {
  day: number;
  tvlUsd: number;
  utilization: number;
  supplyApyBps: number;
  borrowApyBps: number;
  liquidations: number;
  badDebtUsd: number;
  routerYieldBps: number;
}

export interface SimulationReport {
  model: "v2";
  scenario: SimulationScenario;
  markets: MarketConfig[];
  strategies: StrategyAllocation[];
  snapshots: SimulationSnapshot[];
  summary: {
    avgUtilization: number;
    peakBadDebtUsd: number;
    totalLiquidations: number;
    netApyBps: number;
    solvencyRatio: number;
    passedStress: boolean;
  };
  generatedAt: string;
}

export interface VaultStatus {
  version: string;
  stage: string;
  chain: ChainId;
  markets: number;
  tvlUsd: number;
  utilization: number;
  supplyApyBps: number;
  borrowApyBps: number;
  paused: boolean;
  routerStrategies: number;
  lastSimulation: string | null;
}

export const MARKETS_V2: MarketConfig[] = [
  {
    id: "eth-core",
    asset: "WETH",
    collateralFactor: 0.82,
    liquidationThreshold: 0.86,
    liquidationBonus: 0.05,
    reserveFactor: 0.12,
    maxUtilization: 0.92,
  },
  {
    id: "usdc-stable",
    asset: "USDC",
    collateralFactor: 0.9,
    liquidationThreshold: 0.93,
    liquidationBonus: 0.04,
    reserveFactor: 0.1,
    maxUtilization: 0.88,
  },
  {
    id: "wbtc-satellite",
    asset: "WBTC",
    collateralFactor: 0.75,
    liquidationThreshold: 0.8,
    liquidationBonus: 0.07,
    reserveFactor: 0.15,
    maxUtilization: 0.85,
  },
];

export const STRATEGIES_V2: StrategyAllocation[] = [
  { id: "aave-core", name: "Aave v3 Core", weightBps: 3500, baseApyBps: 420, riskTier: "low" },
  { id: "curve-stables", name: "Curve stables", weightBps: 2500, baseApyBps: 510, riskTier: "low" },
  { id: "uniswap-eth", name: "Uniswap v3 ETH/USDC", weightBps: 2000, baseApyBps: 680, riskTier: "medium" },
  { id: "arb-yield", name: "Arbitrum native yield", weightBps: 1500, baseApyBps: 740, riskTier: "medium" },
  { id: "reserve", name: "Idle reserve", weightBps: 500, baseApyBps: 0, riskTier: "low" },
];

/**
 * Deposit-routing table — the *internal* capital-flow model.
 *
 * Every entry in MARKETS_V2 appears here exactly once, so the routing table can
 * never silently omit a listed market again. A market that is intentionally not
 * funded by deposits carries weightBps 0 and funding "collateral-only" rather
 * than being absent.
 */
export const ROUTER_POOLS: RouterPool[] = [
  {
    id: "eth-core",
    asset: "WETH",
    weightBps: 6000,
    funding: "routed",
    note: "Primary supply destination — 60% of every deposit.",
  },
  {
    id: "usdc-stable",
    asset: "USDC",
    weightBps: 4000,
    funding: "routed",
    note: "Stable leg of the split — 40% of every deposit.",
  },
  {
    id: "wbtc-satellite",
    asset: "WBTC",
    weightBps: 0,
    funding: "collateral-only",
    note: "Listed and borrow-checkable, but receives no routed supply. Borrows against it would revert on-chain with InsufficientLiquidity.",
  },
];

export const ROUTED_POOLS = ROUTER_POOLS.filter((p) => p.funding === "routed");
export const UNFUNDED_POOLS = ROUTER_POOLS.filter((p) => p.funding !== "routed");

export const SCENARIOS: Record<string, SimulationScenario> = {
  baseline: {
    id: "baseline",
    label: "Baseline Q3 2026",
    durationDays: 90,
    ethDrawdownPct: 18,
    depositGrowthPct: 12,
    borrowDemandMultiplier: 1.0,
  },
  stress: {
    id: "stress",
    label: "ETH -40% stress",
    durationDays: 30,
    ethDrawdownPct: 40,
    depositGrowthPct: -8,
    borrowDemandMultiplier: 1.35,
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Capital-flow reconciliation
 *
 * The console previously rendered two *different* weighted splits, both labelled
 * "router", with no statement of how they relate:
 *
 *   1. Try It → deposit flow   used ROUTER_POOLS   (WETH/USDC, by asset)
 *   2. Markets → router table  used STRATEGIES_V2  (Aave/Curve/Uni/Arb/idle)
 *
 * They are not competing views of one split — they are two sequential layers.
 * This module states that relationship in one place so the UI can stop guessing.
 * ──────────────────────────────────────────────────────────────────────────── */

export type CapitalFlowLayer = "internal-markets" | "external-strategies";

export interface CapitalFlowLeg {
  id: string;
  label: string;
  sublabel: string;
  weightBps: number;
  active: boolean;
}

export interface CapitalFlowModel {
  layer: CapitalFlowLayer;
  order: 1 | 2;
  label: string;
  answers: string;
  surface: string;
  source: string;
  totalWeightBps: number;
  legs: CapitalFlowLeg[];
}

export interface CapitalFlowReconciliation {
  models: CapitalFlowModel[];
  relationship: string;
  coverage: {
    listedMarkets: number;
    routedMarkets: number;
    unfundedMarkets: Array<{ id: string; asset: string; reason: string }>;
  };
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
}

export function reconcileCapitalFlows(): CapitalFlowReconciliation {
  const internalTotal = ROUTER_POOLS.reduce((a, p) => a + p.weightBps, 0);
  const externalTotal = STRATEGIES_V2.reduce((a, s) => a + s.weightBps, 0);

  const models: CapitalFlowModel[] = [
    {
      layer: "internal-markets",
      order: 1,
      label: "Layer 1 — deposit routing across isolated markets",
      answers: "Which isolated market does my deposited capital land in?",
      surface: "Try It → Simulate a deposit",
      source: "ROUTER_POOLS",
      totalWeightBps: internalTotal,
      legs: ROUTER_POOLS.map((p) => ({
        id: p.id,
        label: p.asset,
        sublabel: p.funding === "routed" ? p.id : `${p.id} · unfunded`,
        weightBps: p.weightBps,
        active: p.funding === "routed",
      })),
    },
    {
      layer: "external-strategies",
      order: 2,
      label: "Layer 2 — idle liquidity allocated to external yield venues",
      answers: "Where does supplied-but-unborrowed capital earn yield?",
      surface: "Markets → Yield router strategies",
      source: "STRATEGIES_V2",
      totalWeightBps: externalTotal,
      legs: STRATEGIES_V2.map((s) => ({
        id: s.id,
        label: s.name,
        sublabel: `${s.riskTier} risk · ${(s.baseApyBps / 100).toFixed(2)}% base`,
        weightBps: s.weightBps,
        active: s.weightBps > 0,
      })),
    },
  ];

  const unfundedMarkets = MARKETS_V2.filter(
    (m) => !ROUTED_POOLS.some((p) => p.id === m.id)
  ).map((m) => ({
    id: m.id,
    asset: m.asset,
    reason:
      ROUTER_POOLS.find((p) => p.id === m.id)?.note ??
      "Market is listed in MARKETS_V2 but absent from the routing table.",
  }));

  const checks = [
    {
      id: "internal-weights",
      label: "Deposit routing weights sum to 100%",
      ok: internalTotal === 10_000,
      detail: `ROUTER_POOLS totals ${internalTotal} bps across ${ROUTER_POOLS.length} markets.`,
    },
    {
      id: "external-weights",
      label: "Strategy weights sum to 100%",
      ok: externalTotal === 10_000,
      detail: `STRATEGIES_V2 totals ${externalTotal} bps across ${STRATEGIES_V2.length} venues.`,
    },
    {
      id: "market-coverage",
      label: "Every listed market appears in the routing table",
      ok: MARKETS_V2.every((m) => ROUTER_POOLS.some((p) => p.id === m.id)),
      detail: `${MARKETS_V2.length} markets listed · ${ROUTER_POOLS.length} routing entries.`,
    },
    {
      id: "market-funding",
      label: "Every listed market receives routed supply",
      ok: unfundedMarkets.length === 0,
      detail:
        unfundedMarkets.length === 0
          ? "All listed markets are funded by deposit routing."
          : `${unfundedMarkets
              .map((m) => m.asset)
              .join(", ")} listed and borrow-checkable but funded by no deposit.`,
    },
  ];

  return {
    models,
    relationship:
      "Sequential, not competing. A deposit is split by ROUTER_POOLS into isolated markets (layer 1); whatever is not borrowed out of those markets is then allocated by STRATEGIES_V2 to external venues (layer 2). Layer 1 decides isolation and risk exposure; layer 2 decides yield on idle balances. Both sum to 10,000 bps independently, which is why they look like the same chart and are not.",
    coverage: {
      listedMarkets: MARKETS_V2.length,
      routedMarkets: ROUTED_POOLS.length,
      unfundedMarkets,
    },
    checks,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Risk-band derivation
 *
 * Between collateralFactor and liquidationThreshold sits a band in which a
 * position can neither borrow more nor be liquidated. Check Position depends on
 * it, the Markets table never showed it, so it is derived here once.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MarketRiskBand {
  id: string;
  asset: string;
  collateralFactor: number;
  liquidationThreshold: number;
  /** Width of the no-man's-land, in percentage points of collateral value. */
  bufferPp: number;
  /** Price drawdown that moves a max-borrowed position to the liquidation line. */
  drawdownToLiquidationPct: number;
  liquidationBonus: number;
  reserveFactor: number;
  maxUtilization: number;
  funding: PoolFunding;
  routedWeightBps: number;
}

export function marketRiskBand(m: MarketConfig): MarketRiskBand {
  const pool = ROUTER_POOLS.find((p) => p.id === m.id);
  return {
    id: m.id,
    asset: m.asset,
    collateralFactor: m.collateralFactor,
    liquidationThreshold: m.liquidationThreshold,
    bufferPp: Math.round((m.liquidationThreshold - m.collateralFactor) * 10_000) / 100,
    drawdownToLiquidationPct:
      Math.round((1 - m.collateralFactor / m.liquidationThreshold) * 10_000) / 100,
    liquidationBonus: m.liquidationBonus,
    reserveFactor: m.reserveFactor,
    maxUtilization: m.maxUtilization,
    funding: pool?.funding ?? "collateral-only",
    routedWeightBps: pool?.weightBps ?? 0,
  };
}

export const MARKET_RISK_BANDS: MarketRiskBand[] = MARKETS_V2.map(marketRiskBand);
