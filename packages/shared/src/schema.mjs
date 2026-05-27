export const requiredWrapperKeys = [
  "schemaVersion",
  "generatedAt",
  "tenants",
  "defaultTenant",
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
  if (typeof view.summary.currentCost !== "number") {
    throw new Error(`View '${tenantId}': summary.currentCost must be a number`);
  }
  if (!("compare" in view.summary)) {
    throw new Error(`View '${tenantId}': summary.compare must be present for the Compare control`);
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
