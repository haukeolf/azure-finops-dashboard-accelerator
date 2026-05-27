import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateDashboardSnapshot } from "../../shared/src/schema.mjs";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const sampleRoot = join(repoRoot, "data/sample");
const outputPath = join(repoRoot, "data/snapshots/dashboard-snapshot.json");

const ALL_TENANTS = "all";

async function readJson(name) {
  return JSON.parse(await readFile(join(sampleRoot, name), "utf8"));
}

// Match Python's round() (round-half-to-even), returning an integer.
function pyRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function groupBy(items, keySelector) {
  const groups = new Map();
  for (const item of items) {
    const key = keySelector(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
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

const MONTH_LABELS = ["Jun 25", "Jul 25", "Aug 25", "Sep 25", "Oct 25", "Nov 25", "Dec 25", "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26*"];
const TREND_SERIES = {
  Compute: [820000, 845000, 870000, 905000, 925000, 940000, 985000, 1020000, 1080000, 1150000, 1210000, 1330000],
  Storage: [310000, 318000, 326000, 332000, 345000, 358000, 372000, 380000, 395000, 410000, 422000, 442000],
  Network: [185000, 192000, 188000, 196000, 205000, 215000, 224000, 232000, 244000, 255000, 268000, 281000],
  Database: [240000, 250000, 260000, 268000, 275000, 282000, 290000, 298000, 310000, 322000, 335000, 358000],
  "AI & Analytics": [55000, 68000, 85000, 102000, 124000, 155000, 192000, 240000, 305000, 395000, 510000, 680000],
  Security: [125000, 128000, 130000, 132000, 135000, 138000, 142000, 145000, 148000, 152000, 156000, 162000],
  Containers: [105000, 110000, 118000, 124000, 132000, 138000, 146000, 154000, 163000, 172000, 184000, 200000],
  Other: [88000, 91000, 92000, 90000, 93000, 95000, 98000, 100000, 102000, 105000, 107000, 110000]
};

const CLUSTER_DESCRIPTIONS = {
  Compute: "Virtual Machines, VM Scale Sets, App Service, Functions, Batch, Dedicated Host",
  Storage: "Blob, ADLS, Files, Backup, Recovery Services, NetApp Files",
  Network: "Bandwidth, VPN, ExpressRoute, Load Balancer, App Gateway, Front Door, Firewall",
  Database: "Azure SQL, Cosmos DB, PostgreSQL, MySQL, Redis, Synapse SQL pools",
  "AI & Analytics": "Azure OpenAI, Azure ML, Cognitive Services, Synapse Spark, Databricks, Fabric",
  Security: "Defender for Cloud, Sentinel, Key Vault, Entra premium SKUs",
  Containers: "AKS, Container Apps, Container Registry, Container Instances",
  Other: "Logic Apps, API Management, IoT, Marketplace, Support, untagged"
};

function clusterCurrentCosts(rows) {
  const totals = {};
  for (const row of rows) {
    if (row.period !== "current") continue;
    const cluster = mapCluster(row.serviceName, row.meterCategory);
    totals[cluster] = (totals[cluster] || 0) + row.effectiveCost;
  }
  return totals;
}

function subscriptionToTenant(allRows) {
  const mapping = {};
  for (const row of allRows) mapping[row.subscriptionName] = row.tenantName;
  return mapping;
}

function subscriptionToCluster(currentRows) {
  const best = {};
  for (const [sub, rows] of groupBy(currentRows, (row) => row.subscriptionName)) {
    const top = rows.reduce((a, b) => (b.effectiveCost > a.effectiveCost ? b : a));
    best[sub] = mapCluster(top.serviceName, top.meterCategory);
  }
  return best;
}

function serviceToSubscription(currentRows) {
  const mapping = {};
  for (const row of currentRows) {
    if (!(row.serviceName in mapping)) mapping[row.serviceName] = { subscription: row.subscriptionName, owner: row.owner };
  }
  return mapping;
}

function buildCommercialChanges(costRows) {
  const changes = [];
  for (const [service, rows] of groupBy(costRows, (row) => row.serviceName)) {
    const current = sum(rows.filter((row) => row.period === "current"), (row) => row.effectiveCost);
    const previous = sum(rows.filter((row) => row.period === "previous"), (row) => row.effectiveCost);
    const sample = rows[0];
    const delta = current - previous;
    changes.push({
      service,
      cluster: mapCluster(sample.serviceName, sample.meterCategory),
      delta,
      deltaPercent: previous === 0 ? 0 : (delta / previous) * 100,
      currentCost: current,
      previousCost: previous,
      driver: sample.driver
    });
  }
  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function buildClusters(costRows, currentCost) {
  const currentRows = costRows.filter((row) => row.period === "current");
  const previousRows = costRows.filter((row) => row.period === "previous");
  const currentByCluster = groupBy(currentRows, (row) => mapCluster(row.serviceName, row.meterCategory));
  const previousByCluster = groupBy(previousRows, (row) => mapCluster(row.serviceName, row.meterCategory));
  const clusters = [];
  for (const [name, rows] of currentByCluster) {
    const cost = sum(rows, (row) => row.effectiveCost);
    const previous = sum(previousByCluster.get(name) || [], (row) => row.effectiveCost);
    clusters.push({
      name,
      cost,
      previousCost: previous,
      deltaMonth: cost - previous,
      sharePercent: currentCost === 0 ? 0 : (cost / currentCost) * 100
    });
  }
  return clusters.sort((a, b) => b.cost - a.cost);
}

function buildSubscriptions(costRows) {
  const currentRows = costRows.filter((row) => row.period === "current");
  const previousBySub = groupBy(costRows.filter((row) => row.period === "previous"), (row) => row.subscriptionName);
  const subscriptions = [];
  for (const [name, rows] of groupBy(currentRows, (row) => row.subscriptionName)) {
    const current = sum(rows, (row) => row.effectiveCost);
    const previous = sum(previousBySub.get(name) || [], (row) => row.effectiveCost);
    const factors = [0.72, 0.75, 0.78, 0.8, 0.83, 0.86, 0.9, 0.93, 0.96, 1.0, current ? previous / current : 1, 1];
    const spark = factors.map((factor) => pyRound(current * factor));
    const avg6 = spark.slice(-7, -1).reduce((a, b) => a + b, 0) / 6;
    const status = current > avg6 * 1.15 ? "alert" : current < avg6 * 0.92 ? "win" : "watch";
    subscriptions.push({
      name,
      tenant: rows[0].tenantName,
      owner: rows[0].owner,
      costCenter: rows[0].costCenter,
      currentCost: current,
      averageSixMonths: avg6,
      deltaVsAverage: current - avg6,
      spark,
      status
    });
  }
  return subscriptions.sort((a, b) => b.currentCost - a.currentCost);
}

function buildClusterDetails(costRows, trendSeries) {
  const currentRows = costRows.filter((row) => row.period === "current");
  const trendByCluster = Object.fromEntries(trendSeries.map((series) => [series.name, series.values]));
  const details = {};
  for (const cluster of Object.keys(TREND_SERIES)) {
    const rows = currentRows.filter((row) => mapCluster(row.serviceName, row.meterCategory) === cluster);
    const meters = [];
    const resources = [];
    for (const row of rows.slice(0, 6)) {
      const deltaPct = 100 * ((row.effectiveCost / Math.max(row.listCost ?? row.effectiveCost, 1)) - 0.85);
      meters.push({
        meter: row.serviceName,
        quantity: row.quantity,
        unit: row.unitOfMeasure,
        cost: row.effectiveCost,
        deltaPercent: deltaPct
      });
      resources.push({
        id: row.resourceId,
        subscription: row.subscriptionName,
        region: "westeurope",
        mtdCost: row.effectiveCost,
        deltaPercent: deltaPct,
        pricing: row.pricingModel,
        tags: `owner=${row.owner},costCenter=${row.costCenter}`,
        cause: row.driver
      });
    }
    details[cluster] = {
      description: CLUSTER_DESCRIPTIONS[cluster],
      trend: trendByCluster[cluster] ?? TREND_SERIES[cluster],
      meters,
      resources
    };
  }
  return details;
}

function scaleTrend(tenantCosts, allCosts, isAll) {
  return Object.entries(TREND_SERIES).map(([cluster, values]) => {
    let factor;
    if (isAll) {
      factor = 1.0;
    } else {
      const denom = allCosts[cluster] || 0;
      factor = denom ? (tenantCosts[cluster] || 0) / denom : 0.0;
    }
    return { name: cluster, values: values.map((value) => pyRound(value * factor)) };
  });
}

function totalsAt(series, index) {
  return series.reduce((total, item) => total + item.values.at(index), 0);
}

function deltaBlock(label, current, previous) {
  const delta = current - previous;
  return {
    label,
    current,
    previous,
    delta,
    deltaPercent: previous === 0 ? 0 : (delta / previous) * 100
  };
}

function buildForecast(share) {
  const labels = Array.from({ length: 45 }, (_, i) => `Day ${i + 1}`);
  const actual = [];
  for (let i = 0; i < 31; i += 1) actual.push(pyRound((150000 + i * 1200 + (i % 7) * 1800) * share));
  for (let i = 0; i < 14; i += 1) actual.push(null);
  const forecast = Array(30).fill(null);
  const lower = Array(30).fill(null);
  const upper = Array(30).fill(null);
  for (let i = 0; i < 15; i += 1) {
    const mid = (186000 + i * 1100) * share;
    const width = 0.02 + 0.004 * i;
    forecast.push(pyRound(mid));
    lower.push(pyRound(mid * (1 - width)));
    upper.push(pyRound(mid * (1 + width)));
  }
  return { labels, actual, forecast, lower, upper };
}

function buildAnomalySummary(anomalies, subCluster, clusters) {
  let labels = clusters.map((cluster) => cluster.name).slice(0, 5);
  if (labels.length === 0) labels = ["Compute", "Storage", "Network", "Database", "AI & Analytics"];
  const index = {};
  labels.forEach((label, i) => { index[label] = i; });
  const high = Array(labels.length).fill(0);
  const medium = Array(labels.length).fill(0);
  const win = Array(labels.length).fill(0);
  const buckets = { high, medium, win };
  for (const anomaly of anomalies) {
    const cluster = subCluster[anomaly.scope];
    if (!(cluster in index)) continue;
    const bucket = buckets[anomaly.severity];
    if (bucket) bucket[index[cluster]] += 1;
  }
  return { labels, high, medium, win };
}

function buildView(tenantId, label, focusRows, allFocusRows, reservations, advisor, monitor, activity, shared) {
  const isAll = tenantId === ALL_TENANTS;
  const currentRows = focusRows.filter((row) => row.period === "current");
  const previousRows = focusRows.filter((row) => row.period === "previous");
  const currentCost = sum(currentRows, (row) => row.effectiveCost);
  const previousCost = sum(previousRows, (row) => row.effectiveCost);

  const allCurrentCost = sum(allFocusRows.filter((row) => row.period === "current"), (row) => row.effectiveCost);
  const share = isAll ? 1.0 : (allCurrentCost ? currentCost / allCurrentCost : 0.0);

  const trendSeries = scaleTrend(clusterCurrentCosts(focusRows), clusterCurrentCosts(allFocusRows), isAll);
  const quarterRollup = {
    previous: Object.fromEntries(trendSeries.map((item) => [item.name, item.values.slice(6, 9).reduce((a, b) => a + b, 0)])),
    current: Object.fromEntries(trendSeries.map((item) => [item.name, item.values.slice(9, 12).reduce((a, b) => a + b, 0)]))
  };

  const commercialChanges = buildCommercialChanges(focusRows);
  const clusters = buildClusters(focusRows, currentCost);
  const subscriptions = buildSubscriptions(focusRows);
  const subCluster = subscriptionToCluster(currentRows);
  const serviceSub = serviceToSubscription(currentRows);
  const subTenant = subscriptionToTenant(allFocusRows);

  const recTenant = (item) => item.tenant || subTenant[item.subscriptionName] || "sample-prod";

  const recommendations = advisor
    .filter((item) => isAll || recTenant(item) === tenantId)
    .map((item) => ({
      title: item.title,
      scope: item.subscriptionName,
      tenant: recTenant(item),
      owner: item.owner,
      cluster: item.cluster,
      source: item.source,
      effort: item.effort,
      annualSavings: item.annualSavings
    }))
    .sort((a, b) => b.annualSavings - a.annualSavings);

  const monitorBySub = Object.fromEntries(monitor.map((item) => [item.subscriptionName, item]));
  const anomalies = activity
    .filter((item) => isAll || subTenant[item.subscriptionName] === tenantId)
    .map((item) => ({
      title: item.title,
      severity: item.severity,
      scope: item.subscriptionName,
      owner: (subscriptions.find((sub) => sub.name === item.subscriptionName) || {}).owner || "Unknown",
      delta: 0,
      rootCauseCandidate: item.rootCauseCandidate,
      relatedMetric: (monitorBySub[item.subscriptionName] || {}).metricName || "n/a",
      recommendation: (recommendations.find((rec) => rec.scope === item.subscriptionName) || {}).title || "Review with workload owner"
    }));

  // Wins are derived from the largest realized cost reductions in this view.
  const negativeChanges = commercialChanges.filter((change) => change.delta < 0);
  if (negativeChanges.length > 0) {
    const win = negativeChanges[0];
    const mapped = serviceSub[win.service] || {};
    anomalies.push({
      title: `${win.service} cost decreased`,
      severity: "win",
      scope: mapped.subscription || win.cluster,
      owner: mapped.owner || "Workload owner",
      delta: win.delta,
      rootCauseCandidate: win.driver,
      relatedMetric: "cost",
      recommendation: "Roll out the optimization pattern to comparable workloads."
    });
  }

  const mapMover = (change) => {
    const mapped = serviceSub[change.service] || {};
    return {
      subscription: mapped.subscription || change.service.replace(/ /g, "-").toLowerCase(),
      owner: mapped.owner || "Workload owner",
      delta: change.delta,
      deltaPercent: change.deltaPercent,
      driver: change.driver
    };
  };
  const moversUp = commercialChanges.filter((change) => change.delta > 0).map(mapMover).slice(0, 5);
  const moversDown = negativeChanges.map(mapMover).slice(0, 5);

  const quarterCurrent = Object.values(quarterRollup.current).reduce((a, b) => a + b, 0);
  const quarterPrevious = Object.values(quarterRollup.previous).reduce((a, b) => a + b, 0);
  const yearCurrent = totalsAt(trendSeries, -1);
  const yearPrevious = totalsAt(trendSeries, 0);

  const summary = {
    currentCost,
    previousCost,
    deltaMonth: currentCost - previousCost,
    deltaQuarterPercent: isAll ? shared.deltaQuarterPercent : (quarterPrevious === 0 ? 0 : ((quarterCurrent - quarterPrevious) / quarterPrevious) * 100),
    commitmentCoveragePercent: reservations.coverage.reservationCoveragePercent,
    annualSavingsPotential: sum(recommendations, (item) => item.annualSavings),
    compare: {
      month: deltaBlock("vs previous month", currentCost, previousCost),
      quarter: deltaBlock("vs previous quarter", quarterCurrent, quarterPrevious),
      year: deltaBlock("vs same month last year", yearCurrent, yearPrevious)
    }
  };

  return {
    period: { id: `sample-current-${tenantId}`, label },
    summary,
    commercialChanges,
    serviceClusters: clusters,
    subscriptions,
    commitments: shared.commitments,
    anomalies,
    recommendations,
    trend: {
      labels: MONTH_LABELS,
      series: trendSeries,
      anomalies: [
        { index: 8, label: "Feb: ingestion spike" },
        { index: 10, label: "Apr: AI rollout" },
        { index: 11, label: "May: network over-provisioning" }
      ]
    },
    waterfall: [
      { label: "Previous month", value: previousCost, type: "total" },
      ...commercialChanges.map((change) => ({ label: change.service, value: change.delta, type: change.delta >= 0 ? "up" : "down" })),
      { label: "Current month", value: currentCost, type: "total" }
    ],
    quarterRollup,
    unitPriceIndex: shared.unitPriceIndex,
    clusterDetails: buildClusterDetails(focusRows, trendSeries),
    moversUp,
    moversDown,
    anomalySummary: buildAnomalySummary(anomalies, subCluster, clusters),
    forecast: buildForecast(share),
    dataSources: shared.dataSources,
    glossary: shared.glossary,
    dataQuality: {
      costRows: focusRows.length,
      advisorRecommendations: recommendations.length,
      monitorFindings: monitor.length,
      activityLogFindings: activity.filter((item) => isAll || subTenant[item.subscriptionName] === tenantId).length,
      notes: [
        "Sample data is synthetic.",
        "Commitments, unit-price index, data sources and glossary are billing-account scoped and shared across tenant views.",
        "Production ingestion should use customer-owned storage, RBAC, and secret management."
      ]
    }
  };
}

function buildSnapshot({ focusRows, reservations, advisorRecommendations, monitorFindings, activityLogFindings }) {
  const shared = {
    deltaQuarterPercent: 7.3,
    commitments: {
      ...reservations,
      savings12m: [78000, 82000, 86000, 92000, 98000, 106000, 114000, 122000, 131000, 140000, 149000, 158000],
      commitmentMix: [
        { name: "VM Reservations", hourly: 28800 },
        { name: "SQL Reservations", hourly: 4200 },
        { name: "Savings Plan Compute", hourly: 32400 },
        { name: "App Service Reservations", hourly: 3600 }
      ],
      purchaseRecommendations: [
        ...(reservations.recommendations || []),
        { title: "Downsize ExpressRoute circuit after utilization review", scope: "sample-networking", upfront: 0, annualSavings: 170000, roi: "High" },
        { title: "Commit Azure OpenAI PTU for stable GPT-4o usage", scope: "sample-ai-foundry", upfront: 0, annualSavings: 96000, roi: "High" }
      ]
    },
    unitPriceIndex: {
      labels: MONTH_LABELS,
      series: [
        { name: "vCPU-hour", values: [101, 100, 100, 99, 98, 99, 99, 100, 99, 98, 97, 96] },
        { name: "GB-month", values: [102, 101, 100, 100, 99, 99, 99, 100, 99, 99, 98, 98] },
        { name: "GB-egress", values: [100, 100, 101, 101, 101, 102, 101, 100, 101, 102, 103, 104] }
      ]
    },
    dataSources: {
      datasets: [
        { dataset: "Cost and usage (FOCUS 1.0)", scope: "Billing account", frequency: "Daily / MTD", schema: "FOCUS" },
        { dataset: "ActualCost export", scope: "Billing account", frequency: "Daily", schema: "Azure native" },
        { dataset: "AmortizedCost export", scope: "Billing account", frequency: "Daily", schema: "Azure native" },
        { dataset: "Reservation / Savings Plan APIs", scope: "Billing / benefit scope", frequency: "Daily", schema: "Azure APIs" },
        { dataset: "Advisor / Monitor / Activity Log", scope: "Subscription", frequency: "Daily", schema: "Azure APIs" }
      ],
      fields: [
        { field: "EffectiveCost / CostInBillingCurrency", usedFor: "Cost trend, commercial changes, rankings" },
        { field: "ListCost", usedFor: "Savings versus PayG" },
        { field: "ServiceName / MeterCategory", usedFor: "Cluster mapping" },
        { field: "ResourceId / ResourceGroup", usedFor: "Workload drilldown and root cause" },
        { field: "PricingModel / BenefitId", usedFor: "Commitment attribution" },
        { field: "TenantId / Tags / RBAC mapping", usedFor: "Tenant switching, owner and cost-center accountability" }
      ],
      architecture: "[Cost exports + Azure APIs] -> [Customer-owned storage/lakehouse] -> [Processing jobs] -> [Dashboard snapshot/API] -> [Web dashboard]"
    },
    glossary: {
      clusters: Object.keys(TREND_SERIES).map((name) => ({ cluster: name, includes: CLUSTER_DESCRIPTIONS[name] })),
      methodology: [
        "Tenant views are pre-aggregated per Azure AD tenant; the 'all' view is the billing-account roll-up.",
        "Anomalies: rolling 28-day median per subscription x service, z-score over 7-day window.",
        "High severity: absolute delta above threshold and z-score >= 3.",
        "Win: sustained cost decrease with attributable optimization action.",
        "Actual cost is invoice-oriented; amortized/effective cost is preferred for trend reporting.",
        "FOCUS provides normalized EffectiveCost, BilledCost, ContractedCost, and ListCost fields."
      ]
    }
  };

  const tenantIds = [...new Set(focusRows.map((row) => row.tenantName))].sort();
  const tenants = [{ id: ALL_TENANTS, label: "All tenants" }, ...tenantIds.map((tenant) => ({ id: tenant, label: tenant }))];

  const views = {};
  for (const tenant of tenants) {
    const tenantId = tenant.id;
    const rows = tenantId === ALL_TENANTS ? focusRows : focusRows.filter((row) => row.tenantName === tenantId);
    const label = `Synthetic May 2026 · ${tenant.label.toLowerCase()}`;
    views[tenantId] = buildView(tenantId, label, rows, focusRows, reservations, advisorRecommendations, monitorFindings, activityLogFindings, shared);
  }

  return {
    schemaVersion: "0.3.0",
    generatedAt: new Date().toISOString(),
    tenants,
    defaultTenant: ALL_TENANTS,
    views
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
