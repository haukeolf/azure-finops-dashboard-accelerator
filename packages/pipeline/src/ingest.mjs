import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateDashboardSnapshot } from "../../shared/src/schema.mjs";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const sampleRoot = join(repoRoot, "data/sample");
const outputPath = join(repoRoot, "data/snapshots/dashboard-snapshot.json");

async function readJson(name) {
  return JSON.parse(await readFile(join(sampleRoot, name), "utf8"));
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function groupBy(items, keySelector) {
  return items.reduce((groups, item) => {
    const key = keySelector(item);
    groups.set(key, [...(groups.get(key) || []), item]);
    return groups;
  }, new Map());
}

function mapCluster(serviceName, meterCategory) {
  const text = `${serviceName} ${meterCategory}`.toLowerCase();
  if (text.includes("virtual") || text.includes("compute") || text.includes("app service")) return "Compute";
  if (text.includes("storage") || text.includes("backup")) return "Storage";
  if (text.includes("bandwidth") || text.includes("network") || text.includes("expressroute")) return "Network";
  if (text.includes("sql") || text.includes("cosmos") || text.includes("database")) return "Database";
  if (text.includes("openai") || text.includes("machine learning") || text.includes("analytics")) return "AI & Analytics";
  if (text.includes("defender") || text.includes("sentinel") || text.includes("key vault")) return "Security";
  if (text.includes("kubernetes") || text.includes("container")) return "Containers";
  return "Other";
}

function buildCommercialChanges(costRows) {
  const byService = groupBy(costRows, (row) => row.serviceName);
  return [...byService.entries()].map(([service, rows]) => {
    const current = sum(rows.filter((row) => row.period === "current"), (row) => row.effectiveCost);
    const previous = sum(rows.filter((row) => row.period === "previous"), (row) => row.effectiveCost);
    const sample = rows[0];
    return {
      service,
      cluster: mapCluster(sample.serviceName, sample.meterCategory),
      delta: current - previous,
      currentCost: current,
      previousCost: previous,
      driver: sample.driver
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function buildClusters(costRows, currentCost) {
  const currentRows = costRows.filter((row) => row.period === "current");
  const previousRows = costRows.filter((row) => row.period === "previous");
  const currentByCluster = groupBy(currentRows, (row) => mapCluster(row.serviceName, row.meterCategory));
  const previousByCluster = groupBy(previousRows, (row) => mapCluster(row.serviceName, row.meterCategory));

  return [...currentByCluster.entries()].map(([name, rows]) => {
    const cost = sum(rows, (row) => row.effectiveCost);
    const previous = sum(previousByCluster.get(name) || [], (row) => row.effectiveCost);
    return {
      name,
      cost,
      deltaMonth: cost - previous,
      sharePercent: currentCost === 0 ? 0 : (cost / currentCost) * 100
    };
  }).sort((a, b) => b.cost - a.cost);
}

function buildSubscriptions(costRows) {
  const currentRows = costRows.filter((row) => row.period === "current");
  const bySubscription = groupBy(currentRows, (row) => row.subscriptionName);
  return [...bySubscription.entries()].map(([name, rows]) => ({
    name,
    tenant: rows[0].tenantName,
    owner: rows[0].owner,
    currentCost: sum(rows, (row) => row.effectiveCost),
    costCenter: rows[0].costCenter
  })).sort((a, b) => b.currentCost - a.currentCost);
}

function buildSnapshot({ focusRows, reservations, advisorRecommendations, monitorFindings, activityLogFindings }) {
  const currentRows = focusRows.filter((row) => row.period === "current");
  const previousRows = focusRows.filter((row) => row.period === "previous");
  const currentCost = sum(currentRows, (row) => row.effectiveCost);
  const previousCost = sum(previousRows, (row) => row.effectiveCost);
  const commercialChanges = buildCommercialChanges(focusRows);
  const recommendations = advisorRecommendations.map((item) => ({
    title: item.title,
    scope: item.subscriptionName,
    owner: item.owner,
    cluster: item.cluster,
    source: item.source,
    effort: item.effort,
    annualSavings: item.annualSavings
  })).sort((a, b) => b.annualSavings - a.annualSavings);

  const anomalies = activityLogFindings.map((item) => ({
    title: item.title,
    severity: item.severity,
    scope: item.subscriptionName,
    rootCauseCandidate: item.rootCauseCandidate,
    relatedMetric: monitorFindings.find((metric) => metric.subscriptionName === item.subscriptionName)?.metricName || "n/a"
  }));

  const annualSavingsPotential = sum(recommendations, (item) => item.annualSavings);
  const commitmentCoveragePercent = reservations.coverage.reservationCoveragePercent;

  return {
    schemaVersion: "0.1.0",
    generatedAt: new Date().toISOString(),
    period: {
      id: "sample-current",
      label: "Synthetic May 2026 sample"
    },
    summary: {
      currentCost,
      previousCost,
      deltaMonth: currentCost - previousCost,
      deltaQuarterPercent: 7.3,
      commitmentCoveragePercent,
      annualSavingsPotential
    },
    commercialChanges,
    serviceClusters: buildClusters(focusRows, currentCost),
    subscriptions: buildSubscriptions(focusRows),
    commitments: reservations,
    anomalies,
    recommendations,
    dataQuality: {
      costRows: focusRows.length,
      advisorRecommendations: advisorRecommendations.length,
      monitorFindings: monitorFindings.length,
      activityLogFindings: activityLogFindings.length,
      notes: [
        "Sample data is synthetic.",
        "Production ingestion should use customer-owned storage, RBAC, and secret management.",
        "Browser clients should consume snapshots or secured APIs, not Azure management credentials."
      ]
    }
  };
}

const focusRows = await readJson("focus-cost-export.sample.json");
const reservations = await readJson("reservation-savings-plan.sample.json");
const advisorRecommendations = await readJson("advisor-recommendations.sample.json");
const monitorFindings = await readJson("monitor-metrics.sample.json");
const activityLogFindings = await readJson("activity-log.sample.json");

const snapshot = buildSnapshot({
  focusRows,
  reservations,
  advisorRecommendations,
  monitorFindings,
  activityLogFindings
});

validateDashboardSnapshot(snapshot);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);

