import ky from "ky";
import type {
  CapitalFlowReconciliation,
  MarketConfig,
  MarketRiskBand,
  RouterPool,
  SimulationReport,
  StrategyAllocation,
  VaultStatus,
} from "@entry-vault/shared";

const http = ky.create({ prefixUrl: location.origin });

export interface HealthResponse {
  ok: boolean;
  protocol: string;
  version: string;
  stage: string;
  deployment: string;
  uptime: number;
}

export interface VaultStatusResponse extends VaultStatus {
  dataSource: string;
  note: string;
}

export interface MarketsResponse {
  model: string;
  markets: MarketConfig[];
  riskBands: MarketRiskBand[];
  router: { strategies: StrategyAllocation[]; pools: RouterPool[] };
}

export interface ReviewResponse {
  stage: string;
  version: string;
  auditSprint: string;
  launchTarget: string;
  deploymentPolicy: string;
  contracts: { path: string; role: string }[];
  readingOrder: { file: string; reason: string }[];
  commands: string[];
}

export interface RoadmapResponse {
  activePhase: string;
  contractVersion: string;
  auditSprint: string;
  launchTarget: string;
  milestones: string[];
}

export interface DepositPlayResponse {
  depositUsd: number;
  sharesMinted: number;
  routes: {
    marketId: string;
    asset: string;
    weightBps: number;
    weightPct: number;
    amountUsd: number;
    funding: "routed" | "collateral-only";
  }[];
  unfunded: { marketId: string; asset: string; reason: string }[];
  coverage: { listedMarkets: number; fundedMarkets: number; routedWeightBps: number };
  steps: string[];
  warnings: string[];
}

export interface BorrowPlayResponse {
  marketId: string;
  asset: string;
  collateralUsd: number;
  debtUsd: number;
  maxBorrowUsd: number;
  liquidationAtUsd: number;
  canBorrow: boolean;
  liquidatable: boolean;
  healthFactor: number;
  status: "healthy" | "borrow-limit" | "liquidatable";
  band: {
    lowUsd: number;
    highUsd: number;
    widthUsd: number;
    widthPp: number;
    inBand: boolean;
    positionPct: number | null;
    repayToBorrowUsd: number;
    headroomToLiquidationUsd: number;
    drawdownToLiquidationPct: number | null;
  };
  liquidity: {
    funding: "routed" | "collateral-only";
    routedWeightBps: number;
    borrowable: boolean;
    note: string;
  };
  plainEnglish: string;
  steps: string[];
}

export const api = {
  health: () => http.get("health").json<HealthResponse>(),
  vaultStatus: () => http.get("v1/vault/status").json<VaultStatusResponse>(),
  markets: () => http.get("v1/markets").json<MarketsResponse>(),
  capitalFlow: () => http.get("v1/capital-flow").json<CapitalFlowReconciliation>(),
  review: () => http.get("v1/review").json<ReviewResponse>(),
  roadmap: () => http.get("v1/roadmap").json<RoadmapResponse>(),
  contracts: () => http.get("v1/contracts").json<{ contracts: { path: string; role: string }[] }>(),
  simulationLatest: () => http.get("v1/simulation/latest").json<SimulationReport>(),
  runSimulation: (body: { scenario?: string; ethDrawdownPct?: number; durationDays?: number }) =>
    http.post("v1/simulation/run", { json: body }).json<SimulationReport>(),
  playDeposit: (amountUsd: number) =>
    http.post("v1/play/deposit", { json: { amountUsd } }).json<DepositPlayResponse>(),
  playBorrow: (body: { marketId: string; collateralUsd: number; debtUsd: number }) =>
    http.post("v1/play/borrow", { json: body }).json<BorrowPlayResponse>(),
};
