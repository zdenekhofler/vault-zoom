import assert from "node:assert/strict";
import test from "node:test";
import { runSimulation } from "../engine/simulator.js";
import {
  MARKETS_V2,
  MARKET_RISK_BANDS,
  PROTOCOL,
  ROUTED_POOLS,
  ROUTER_POOLS,
  STRATEGIES_V2,
  reconcileCapitalFlows,
} from "@entry-vault/shared";

test("PROTOCOL metadata is consistent", () => {
  assert.equal(PROTOCOL.version, "0.4.0-internal");
  assert.equal(PROTOCOL.stage, "internal-qa");
  assert.ok(PROTOCOL.chains.includes("ethereum"));
});

test("market configs have valid parameters", () => {
  for (const m of MARKETS_V2) {
    assert.ok(m.collateralFactor < m.liquidationThreshold);
    assert.ok(m.liquidationThreshold <= 1);
    assert.ok(m.maxUtilization <= 1);
  }
});

test("strategy weights sum to 10000 bps", () => {
  const total = STRATEGIES_V2.reduce((a, s) => a + s.weightBps, 0);
  assert.equal(total, 10_000);
});

test("baseline simulation passes stress gate", () => {
  const report = runSimulation({ scenarioId: "baseline", seed: 42 });
  assert.equal(report.model, "v2");
  assert.ok(report.summary.solvencyRatio > 0.97);
  assert.equal(report.summary.passedStress, true);
  assert.equal(report.snapshots.length, 90);
});

test("stress scenario produces higher liquidation pressure", () => {
  const baseline = runSimulation({ scenarioId: "baseline", seed: 42 });
  const stress = runSimulation({ scenarioId: "stress", seed: 7 });
  assert.ok(stress.summary.totalLiquidations >= baseline.summary.totalLiquidations);
});

test("every listed market appears in the routing table", () => {
  for (const m of MARKETS_V2) {
    assert.ok(
      ROUTER_POOLS.some((p) => p.id === m.id),
      `${m.asset} (${m.id}) is listed but missing from ROUTER_POOLS`
    );
  }
});

test("routed weights sum to 10000 bps", () => {
  const total = ROUTED_POOLS.reduce((a, p) => a + p.weightBps, 0);
  assert.equal(total, 10_000);
});

test("collateral-only pools carry zero weight", () => {
  for (const p of ROUTER_POOLS) {
    if (p.funding === "collateral-only") assert.equal(p.weightBps, 0);
    else assert.ok(p.weightBps > 0);
  }
});

test("capital-flow reconciliation reports the WBTC routing gap", () => {
  const rec = reconcileCapitalFlows();
  assert.equal(rec.models.length, 2);
  assert.equal(rec.coverage.listedMarkets, 3);
  assert.equal(rec.coverage.routedMarkets, 2);
  assert.deepEqual(
    rec.coverage.unfundedMarkets.map((m) => m.asset),
    ["WBTC"]
  );

  const byId = Object.fromEntries(rec.checks.map((c) => [c.id, c.ok]));
  assert.equal(byId["internal-weights"], true);
  assert.equal(byId["external-weights"], true);
  assert.equal(byId["market-coverage"], true);
  // Known, now-explicit gap rather than a silent omission.
  assert.equal(byId["market-funding"], false);
});

test("risk bands derive the CF→LT buffer per market", () => {
  const byAsset = Object.fromEntries(MARKET_RISK_BANDS.map((b) => [b.asset, b]));
  assert.equal(byAsset.WETH.bufferPp, 4);
  assert.equal(byAsset.USDC.bufferPp, 3);
  assert.equal(byAsset.WBTC.bufferPp, 5);
  // WBTC is the widest buffer and the only unfunded market.
  assert.equal(byAsset.WBTC.funding, "collateral-only");
  assert.equal(byAsset.WBTC.routedWeightBps, 0);
});
