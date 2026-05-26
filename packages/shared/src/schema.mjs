export const requiredSnapshotKeys = [
  "schemaVersion",
  "generatedAt",
  "period",
  "summary",
  "commercialChanges",
  "serviceClusters",
  "subscriptions",
  "commitments",
  "anomalies",
  "recommendations",
  "dataQuality"
];

export function validateDashboardSnapshot(snapshot) {
  const missing = requiredSnapshotKeys.filter((key) => !(key in snapshot));
  if (missing.length > 0) {
    throw new Error(`Snapshot is missing keys: ${missing.join(", ")}`);
  }

  if (!Array.isArray(snapshot.commercialChanges)) {
    throw new Error("commercialChanges must be an array");
  }
  if (!Array.isArray(snapshot.serviceClusters)) {
    throw new Error("serviceClusters must be an array");
  }
  if (!Array.isArray(snapshot.recommendations)) {
    throw new Error("recommendations must be an array");
  }
  if (typeof snapshot.summary.currentCost !== "number") {
    throw new Error("summary.currentCost must be a number");
  }

  return true;
}

