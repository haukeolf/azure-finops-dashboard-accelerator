REQUIRED_WRAPPER_KEYS = [
    "schemaVersion",
    "generatedAt",
    "tenants",
    "defaultTenant",
    "billingAccounts",
    "defaultBillingAccount",
    "periodOptions",
    "defaultPeriod",
    "views",
]

REQUIRED_VIEW_KEYS = [
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
    "glossary",
]

VIEW_LIST_KEYS = [
    "commercialChanges",
    "serviceClusters",
    "subscriptions",
    "anomalies",
    "recommendations",
    "waterfall",
    "moversUp",
    "moversDown",
]

# Headline-card fields read by apps/web/src/app.mjs renderSummary().
REQUIRED_SUMMARY_KEYS = [
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
    "compare",
]

REQUIRED_OPEN_ANOMALIES_KEYS = ["count", "high", "medium", "wins", "newThisWeek"]


def validate_view(view, tenant_id):
    missing = [key for key in REQUIRED_VIEW_KEYS if key not in view]
    if missing:
        raise ValueError(f"View '{tenant_id}' is missing keys: {', '.join(missing)}")

    for key in VIEW_LIST_KEYS:
        if not isinstance(view[key], list):
            raise ValueError(f"View '{tenant_id}': {key} must be an array")

    if not isinstance(view["clusterDetails"], dict):
        raise ValueError(f"View '{tenant_id}': clusterDetails must be an object")

    summary = view["summary"]
    if not isinstance(summary.get("currentCost"), (int, float)):
        raise ValueError(f"View '{tenant_id}': summary.currentCost must be a number")
    missing_summary = [key for key in REQUIRED_SUMMARY_KEYS if key not in summary]
    if missing_summary:
        raise ValueError(f"View '{tenant_id}': summary missing headline keys: {', '.join(missing_summary)}")
    if not isinstance(summary["currency"], str) or not summary["currency"]:
        raise ValueError(f"View '{tenant_id}': summary.currency must be a non-empty string")
    open_anomalies = summary["openAnomalies"]
    if not isinstance(open_anomalies, dict):
        raise ValueError(f"View '{tenant_id}': summary.openAnomalies must be an object")
    missing_anom = [key for key in REQUIRED_OPEN_ANOMALIES_KEYS if key not in open_anomalies]
    if missing_anom:
        raise ValueError(f"View '{tenant_id}': summary.openAnomalies missing keys: {', '.join(missing_anom)}")

    if not view["trend"].get("labels") or not view["trend"].get("series"):
        raise ValueError(f"View '{tenant_id}': trend must include labels and series")
    if not view["forecast"].get("lower") or not view["forecast"].get("upper"):
        raise ValueError(f"View '{tenant_id}': forecast must include lower and upper confidence bounds")
    if not view["glossary"].get("clusters"):
        raise ValueError(f"View '{tenant_id}': glossary.clusters must not be empty")

    return True


def validate_dashboard_snapshot(snapshot):
    missing = [key for key in REQUIRED_WRAPPER_KEYS if key not in snapshot]
    if missing:
        raise ValueError(f"Snapshot is missing keys: {', '.join(missing)}")

    if not isinstance(snapshot["tenants"], list) or not snapshot["tenants"]:
        raise ValueError("tenants must be a non-empty array")
    if not isinstance(snapshot["views"], dict) or not snapshot["views"]:
        raise ValueError("views must be a non-empty object")

    if not isinstance(snapshot["billingAccounts"], list) or not snapshot["billingAccounts"]:
        raise ValueError("billingAccounts must be a non-empty array")
    billing_ids = {item.get("id") for item in snapshot["billingAccounts"]}
    if snapshot["defaultBillingAccount"] not in billing_ids:
        raise ValueError("defaultBillingAccount must reference an entry in billingAccounts")

    if not isinstance(snapshot["periodOptions"], list) or not snapshot["periodOptions"]:
        raise ValueError("periodOptions must be a non-empty array")
    period_ids = {item.get("id") for item in snapshot["periodOptions"]}
    if snapshot["defaultPeriod"] not in period_ids:
        raise ValueError("defaultPeriod must reference an entry in periodOptions")

    tenant_ids = {tenant.get("id") for tenant in snapshot["tenants"]}
    if snapshot["defaultTenant"] not in snapshot["views"]:
        raise ValueError("defaultTenant must reference an existing view")
    for tenant_id in tenant_ids:
        if tenant_id not in snapshot["views"]:
            raise ValueError(f"Missing view for declared tenant '{tenant_id}'")

    for tenant_id, view in snapshot["views"].items():
        validate_view(view, tenant_id)

    return True
