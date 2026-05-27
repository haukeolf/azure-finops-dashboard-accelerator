REQUIRED_WRAPPER_KEYS = [
    "schemaVersion",
    "generatedAt",
    "tenants",
    "defaultTenant",
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


def validate_view(view, tenant_id):
    missing = [key for key in REQUIRED_VIEW_KEYS if key not in view]
    if missing:
        raise ValueError(f"View '{tenant_id}' is missing keys: {', '.join(missing)}")

    for key in VIEW_LIST_KEYS:
        if not isinstance(view[key], list):
            raise ValueError(f"View '{tenant_id}': {key} must be an array")

    if not isinstance(view["clusterDetails"], dict):
        raise ValueError(f"View '{tenant_id}': clusterDetails must be an object")
    if not isinstance(view["summary"].get("currentCost"), (int, float)):
        raise ValueError(f"View '{tenant_id}': summary.currentCost must be a number")
    if "compare" not in view["summary"]:
        raise ValueError(f"View '{tenant_id}': summary.compare must be present for the Compare control")
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

    tenant_ids = {tenant.get("id") for tenant in snapshot["tenants"]}
    if snapshot["defaultTenant"] not in snapshot["views"]:
        raise ValueError("defaultTenant must reference an existing view")
    for tenant_id in tenant_ids:
        if tenant_id not in snapshot["views"]:
            raise ValueError(f"Missing view for declared tenant '{tenant_id}'")

    for tenant_id, view in snapshot["views"].items():
        validate_view(view, tenant_id)

    return True
