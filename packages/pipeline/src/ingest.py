from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_ROOT = REPO_ROOT / "data/sample"
OUTPUT_PATH = REPO_ROOT / "data/snapshots/dashboard-snapshot.json"

sys.path.append(str(REPO_ROOT / "packages/shared/src"))
from schema import validate_dashboard_snapshot


def read_json(name):
    return json.loads((SAMPLE_ROOT / name).read_text(encoding="utf-8"))


def rows_sum(rows, key):
    return sum(row.get(key, 0) for row in rows)


def group_by(rows, key_func):
    grouped = defaultdict(list)
    for row in rows:
        grouped[key_func(row)].append(row)
    return grouped


def map_cluster(service_name, meter_category):
    text = f"{service_name} {meter_category}".lower()
    if any(token in text for token in ["virtual", "compute", "app service"]):
        return "Compute"
    if any(token in text for token in ["storage", "backup"]):
        return "Storage"
    if any(token in text for token in ["bandwidth", "network", "expressroute"]):
        return "Network"
    if any(token in text for token in ["sql", "cosmos", "database"]):
        return "Database"
    if any(token in text for token in ["openai", "machine learning", "analytics"]):
        return "AI & Analytics"
    if any(token in text for token in ["defender", "sentinel", "key vault"]):
        return "Security"
    if any(token in text for token in ["kubernetes", "container"]):
        return "Containers"
    return "Other"


def build_commercial_changes(cost_rows):
    changes = []
    for service, rows in group_by(cost_rows, lambda row: row["serviceName"]).items():
        current = rows_sum([row for row in rows if row["period"] == "current"], "effectiveCost")
        previous = rows_sum([row for row in rows if row["period"] == "previous"], "effectiveCost")
        sample = rows[0]
        changes.append({
            "service": service,
            "cluster": map_cluster(sample["serviceName"], sample["meterCategory"]),
            "delta": current - previous,
            "currentCost": current,
            "previousCost": previous,
            "driver": sample["driver"],
        })
    return sorted(changes, key=lambda item: abs(item["delta"]), reverse=True)


def build_clusters(cost_rows, current_cost):
    current_rows = [row for row in cost_rows if row["period"] == "current"]
    previous_rows = [row for row in cost_rows if row["period"] == "previous"]
    current_by_cluster = group_by(current_rows, lambda row: map_cluster(row["serviceName"], row["meterCategory"]))
    previous_by_cluster = group_by(previous_rows, lambda row: map_cluster(row["serviceName"], row["meterCategory"]))

    clusters = []
    for name, rows in current_by_cluster.items():
        cost = rows_sum(rows, "effectiveCost")
        previous = rows_sum(previous_by_cluster.get(name, []), "effectiveCost")
        clusters.append({
            "name": name,
            "cost": cost,
            "deltaMonth": cost - previous,
            "sharePercent": 0 if current_cost == 0 else (cost / current_cost) * 100,
        })
    return sorted(clusters, key=lambda item: item["cost"], reverse=True)


def build_subscriptions(cost_rows):
    current_rows = [row for row in cost_rows if row["period"] == "current"]
    subscriptions = []
    for name, rows in group_by(current_rows, lambda row: row["subscriptionName"]).items():
        subscriptions.append({
            "name": name,
            "tenant": rows[0]["tenantName"],
            "owner": rows[0]["owner"],
            "currentCost": rows_sum(rows, "effectiveCost"),
            "costCenter": rows[0]["costCenter"],
        })
    return sorted(subscriptions, key=lambda item: item["currentCost"], reverse=True)


def build_snapshot(focus_rows, reservations, advisor_recommendations, monitor_findings, activity_log_findings):
    current_rows = [row for row in focus_rows if row["period"] == "current"]
    previous_rows = [row for row in focus_rows if row["period"] == "previous"]
    current_cost = rows_sum(current_rows, "effectiveCost")
    previous_cost = rows_sum(previous_rows, "effectiveCost")

    recommendations = sorted([
        {
            "title": item["title"],
            "scope": item["subscriptionName"],
            "owner": item["owner"],
            "cluster": item["cluster"],
            "source": item["source"],
            "effort": item["effort"],
            "annualSavings": item["annualSavings"],
        }
        for item in advisor_recommendations
    ], key=lambda item: item["annualSavings"], reverse=True)

    monitor_by_subscription = {item["subscriptionName"]: item for item in monitor_findings}
    anomalies = [
        {
            "title": item["title"],
            "severity": item["severity"],
            "scope": item["subscriptionName"],
            "rootCauseCandidate": item["rootCauseCandidate"],
            "relatedMetric": monitor_by_subscription.get(item["subscriptionName"], {}).get("metricName", "n/a"),
        }
        for item in activity_log_findings
    ]

    return {
        "schemaVersion": "0.1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "period": {
            "id": "sample-current",
            "label": "Synthetic May 2026 sample",
        },
        "summary": {
            "currentCost": current_cost,
            "previousCost": previous_cost,
            "deltaMonth": current_cost - previous_cost,
            "deltaQuarterPercent": 7.3,
            "commitmentCoveragePercent": reservations["coverage"]["reservationCoveragePercent"],
            "annualSavingsPotential": rows_sum(recommendations, "annualSavings"),
        },
        "commercialChanges": build_commercial_changes(focus_rows),
        "serviceClusters": build_clusters(focus_rows, current_cost),
        "subscriptions": build_subscriptions(focus_rows),
        "commitments": reservations,
        "anomalies": anomalies,
        "recommendations": recommendations,
        "dataQuality": {
            "costRows": len(focus_rows),
            "advisorRecommendations": len(advisor_recommendations),
            "monitorFindings": len(monitor_findings),
            "activityLogFindings": len(activity_log_findings),
            "notes": [
                "Sample data is synthetic.",
                "Production ingestion should use customer-owned storage, RBAC, and secret management.",
                "Browser clients should consume snapshots or secured APIs, not Azure management credentials.",
            ],
        },
    }


snapshot = build_snapshot(
    read_json("focus-cost-export.sample.json"),
    read_json("reservation-savings-plan.sample.json"),
    read_json("advisor-recommendations.sample.json"),
    read_json("monitor-metrics.sample.json"),
    read_json("activity-log.sample.json"),
)

validate_dashboard_snapshot(snapshot)
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {OUTPUT_PATH}")

