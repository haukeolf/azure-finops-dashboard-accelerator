export const requiredWrapperKeys = [
  "schemaVersion",
  "generatedAt",
  "tenants",
  "defaultTenant",
  "billingAccounts",
  "defaultBillingAccount",
  "periodOptions",
  "defaultPeriod",
  "views"
];

export const requiredViewKeys = [
  "period",
  "summary",
  "commercialChanges",
  "serviceClusters",
  "subscriptions",
  "commitments",
  "anomalies",
  "recommendations",
  "dataQuality",
  "trend",
  "waterfall",
  "quarterRollup",
  "unitPriceIndex",
  "clusterDetails",
  "moversUp",
  "moversDown",
  "anomalySummary",
  "forecast",
  "dataSources",
  "glossary"
];

const viewListKeys = [
  "commercialChanges",
  "serviceClusters",
  "subscriptions",
  "anomalies",
  "recommendations",
  "waterfall",
  "moversUp",
  "moversDown"
];

// Headline-card fields read by apps/web/src/app.mjs renderSummary().
const requiredSummaryKeys = [
  "currentCost",
  "currency",
  "monthTitle",
  "daysElapsed",
  "currentMonthForecast",
  "qtdTotal",
  "qtdLabel",
  "qtdDeltaPercent",
  "ytdTotal",
  "budget",
  "ytdVsBudgetPercent",
  "reservationCoveragePercent",
  "reservationTargetPercent",
  "reservationGapPts",
  "savingsPlanUtilizationPercent",
  "savingsPlanHourlyCommitment",
  "savingsPlanUtilizationMomPts",
  "openAnomalies",
  "compare"
];

const requiredOpenAnomaliesKeys = ["count", "high", "medium", "wins", "newThisWeek"];

export function validateView(view, tenantId) {
  const missing = requiredViewKeys.filter((key) => !(key in view));
  if (missing.length > 0) {
    throw new Error(`View '${tenantId}' is missing keys: ${missing.join(", ")}`);
  }

  for (const key of viewListKeys) {
    if (!Array.isArray(view[key])) {
      throw new Error(`View '${tenantId}': ${key} must be an array`);
    }
  }

  if (typeof view.clusterDetails !== "object" || Array.isArray(view.clusterDetails)) {
    throw new Error(`View '${tenantId}': clusterDetails must be an object`);
  }

  const summary = view.summary;
  if (typeof summary.currentCost !== "number") {
    throw new Error(`View '${tenantId}': summary.currentCost must be a number`);
  }
  const missingSummary = requiredSummaryKeys.filter((key) => !(key in summary));
  if (missingSummary.length > 0) {
    throw new Error(`View '${tenantId}': summary missing headline keys: ${missingSummary.join(", ")}`);
  }
  if (typeof summary.currency !== "string" || summary.currency.length === 0) {
    throw new Error(`View '${tenantId}': summary.currency must be a non-empty string`);
  }
  const openAnomalies = summary.openAnomalies;
  if (typeof openAnomalies !== "object" || openAnomalies === null || Array.isArray(openAnomalies)) {
    throw new Error(`View '${tenantId}': summary.openAnomalies must be an object`);
  }
  const missingAnom = requiredOpenAnomaliesKeys.filter((key) => !(key in openAnomalies));
  if (missingAnom.length > 0) {
    throw new Error(`View '${tenantId}': summary.openAnomalies missing keys: ${missingAnom.join(", ")}`);
  }

  if (!view.trend.labels || !view.trend.series) {
    throw new Error(`View '${tenantId}': trend must include labels and series`);
  }
  if (!view.forecast.lower || !view.forecast.upper) {
    throw new Error(`View '${tenantId}': forecast must include lower and upper confidence bounds`);
  }
  if (!view.glossary.clusters || view.glossary.clusters.length === 0) {
    throw new Error(`View '${tenantId}': glossary.clusters must not be empty`);
  }

  return true;
}

export function validateDashboardSnapshot(snapshot) {
  const missing = requiredWrapperKeys.filter((key) => !(key in snapshot));
  if (missing.length > 0) {
    throw new Error(`Snapshot is missing keys: ${missing.join(", ")}`);
  }

  if (!Array.isArray(snapshot.tenants) || snapshot.tenants.length === 0) {
    throw new Error("tenants must be a non-empty array");
  }
  if (typeof snapshot.views !== "object" || Array.isArray(snapshot.views) || Object.keys(snapshot.views).length === 0) {
    throw new Error("views must be a non-empty object");
  }

  if (!Array.isArray(snapshot.billingAccounts) || snapshot.billingAccounts.length === 0) {
    throw new Error("billingAccounts must be a non-empty array");
  }
  const billingIds = new Set(snapshot.billingAccounts.map((item) => item.id));
  if (!billingIds.has(snapshot.defaultBillingAccount)) {
    throw new Error("defaultBillingAccount must reference an entry in billingAccounts");
  }

  if (!Array.isArray(snapshot.periodOptions) || snapshot.periodOptions.length === 0) {
    throw new Error("periodOptions must be a non-empty array");
  }
  const periodIds = new Set(snapshot.periodOptions.map((item) => item.id));
  if (!periodIds.has(snapshot.defaultPeriod)) {
    throw new Error("defaultPeriod must reference an entry in periodOptions");
  }

  if (!(snapshot.defaultTenant in snapshot.views)) {
    throw new Error("defaultTenant must reference an existing view");
  }
  for (const tenant of snapshot.tenants) {
    if (!(tenant.id in snapshot.views)) {
      throw new Error(`Missing view for declared tenant '${tenant.id}'`);
    }
  }

  for (const [tenantId, view] of Object.entries(snapshot.views)) {
    validateView(view, tenantId);
  }

  return true;
}
