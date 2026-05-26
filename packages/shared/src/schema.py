REQUIRED_SNAPSHOT_KEYS = [
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
    "dataQuality",
]


def validate_dashboard_snapshot(snapshot):
    missing = [key for key in REQUIRED_SNAPSHOT_KEYS if key not in snapshot]
    if missing:
        raise ValueError(f"Snapshot is missing keys: {', '.join(missing)}")

    if not isinstance(snapshot["commercialChanges"], list):
        raise ValueError("commercialChanges must be an array")
    if not isinstance(snapshot["serviceClusters"], list):
        raise ValueError("serviceClusters must be an array")
    if not isinstance(snapshot["recommendations"], list):
        raise ValueError("recommendations must be an array")
    if not isinstance(snapshot["summary"].get("currentCost"), (int, float)):
        raise ValueError("summary.currentCost must be a number")

    return True

