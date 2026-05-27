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

ALL_TENANTS = "all"


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


MONTH_LABELS = ["Jun 25", "Jul 25", "Aug 25", "Sep 25", "Oct 25", "Nov 25", "Dec 25", "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26*"]
TREND_SERIES = {
    "Compute": [820000, 845000, 870000, 905000, 925000, 940000, 985000, 1020000, 1080000, 1150000, 1210000, 1330000],
    "Storage": [310000, 318000, 326000, 332000, 345000, 358000, 372000, 380000, 395000, 410000, 422000, 442000],
    "Network": [185000, 192000, 188000, 196000, 205000, 215000, 224000, 232000, 244000, 255000, 268000, 281000],
    "Database": [240000, 250000, 260000, 268000, 275000, 282000, 290000, 298000, 310000, 322000, 335000, 358000],
    "AI & Analytics": [55000, 68000, 85000, 102000, 124000, 155000, 192000, 240000, 305000, 395000, 510000, 680000],
    "Security": [125000, 128000, 130000, 132000, 135000, 138000, 142000, 145000, 148000, 152000, 156000, 162000],
    "Containers": [105000, 110000, 118000, 124000, 132000, 138000, 146000, 154000, 163000, 172000, 184000, 200000],
    "Other": [88000, 91000, 92000, 90000, 93000, 95000, 98000, 100000, 102000, 105000, 107000, 110000],
}

CLUSTER_DESCRIPTIONS = {
    "Compute": "Virtual Machines, VM Scale Sets, App Service, Functions, Batch, Dedicated Host",
    "Storage": "Blob, ADLS, Files, Backup, Recovery Services, NetApp Files",
    "Network": "Bandwidth, VPN, ExpressRoute, Load Balancer, App Gateway, Front Door, Firewall",
    "Database": "Azure SQL, Cosmos DB, PostgreSQL, MySQL, Redis, Synapse SQL pools",
    "AI & Analytics": "Azure OpenAI, Azure ML, Cognitive Services, Synapse Spark, Databricks, Fabric",
    "Security": "Defender for Cloud, Sentinel, Key Vault, Entra premium SKUs",
    "Containers": "AKS, Container Apps, Container Registry, Container Instances",
    "Other": "Logic Apps, API Management, IoT, Marketplace, Support, untagged",
}


def cluster_current_costs(rows):
    """Sum current effective cost per cluster for the given rows."""
    totals = defaultdict(float)
    for row in rows:
        if row["period"] == "current":
            totals[map_cluster(row["serviceName"], row["meterCategory"])] += row["effectiveCost"]
    return totals


def subscription_to_tenant(all_rows):
    return {row["subscriptionName"]: row["tenantName"] for row in all_rows}


def subscription_to_cluster(current_rows):
    """Map each subscription to the cluster of its highest-cost current row."""
    best = {}
    for sub, rows in group_by(current_rows, lambda row: row["subscriptionName"]).items():
        top = max(rows, key=lambda row: row["effectiveCost"])
        best[sub] = map_cluster(top["serviceName"], top["meterCategory"])
    return best


def service_to_subscription(current_rows):
    mapping = {}
    for row in current_rows:
        mapping.setdefault(row["serviceName"], {"subscription": row["subscriptionName"], "owner": row["owner"]})
    return mapping


def build_commercial_changes(cost_rows):
    changes = []
    for service, rows in group_by(cost_rows, lambda row: row["serviceName"]).items():
        current = rows_sum([row for row in rows if row["period"] == "current"], "effectiveCost")
        previous = rows_sum([row for row in rows if row["period"] == "previous"], "effectiveCost")
        sample = rows[0]
        delta = current - previous
        changes.append({
            "service": service,
            "cluster": map_cluster(sample["serviceName"], sample["meterCategory"]),
            "delta": delta,
            "deltaPercent": 0 if previous == 0 else (delta / previous) * 100,
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
            "previousCost": previous,
            "deltaMonth": cost - previous,
            "sharePercent": 0 if current_cost == 0 else (cost / current_cost) * 100,
        })
    return sorted(clusters, key=lambda item: item["cost"], reverse=True)


def build_subscriptions(cost_rows):
    current_rows = [row for row in cost_rows if row["period"] == "current"]
    previous_by_sub = group_by([row for row in cost_rows if row["period"] == "previous"], lambda row: row["subscriptionName"])
    subscriptions = []
    for name, rows in group_by(current_rows, lambda row: row["subscriptionName"]).items():
        current = rows_sum(rows, "effectiveCost")
        previous = rows_sum(previous_by_sub.get(name, []), "effectiveCost")
        spark = [round(current * factor) for factor in [0.72, 0.75, 0.78, 0.8, 0.83, 0.86, 0.9, 0.93, 0.96, 1.0, previous / current if current else 1, 1]]
        avg6 = sum(spark[-7:-1]) / 6
        status = "alert" if current > avg6 * 1.15 else "win" if current < avg6 * 0.92 else "watch"
        subscriptions.append({
            "name": name,
            "tenant": rows[0]["tenantName"],
            "owner": rows[0]["owner"],
            "costCenter": rows[0]["costCenter"],
            "currentCost": current,
            "averageSixMonths": avg6,
            "deltaVsAverage": current - avg6,
            "spark": spark,
            "status": status,
        })
    return sorted(subscriptions, key=lambda item: item["currentCost"], reverse=True)


def build_cluster_details(cost_rows, trend_series):
    current_rows = [row for row in cost_rows if row["period"] == "current"]
    trend_by_cluster = {series["name"]: series["values"] for series in trend_series}
    details = {}
    for cluster in TREND_SERIES:
        rows = [row for row in current_rows if map_cluster(row["serviceName"], row["meterCategory"]) == cluster]
        meters = []
        resources = []
        for row in rows[:6]:
            delta_pct = 100 * ((row["effectiveCost"] / max(row.get("listCost", row["effectiveCost"]), 1)) - 0.85)
            meters.append({
                "meter": row["serviceName"],
                "quantity": row["quantity"],
                "unit": row["unitOfMeasure"],
                "cost": row["effectiveCost"],
                "deltaPercent": delta_pct,
            })
            resources.append({
                "id": row["resourceId"],
                "subscription": row["subscriptionName"],
                "region": "westeurope",
                "mtdCost": row["effectiveCost"],
                "deltaPercent": delta_pct,
                "pricing": row["pricingModel"],
                "tags": f"owner={row['owner']},costCenter={row['costCenter']}",
                "cause": row["driver"],
            })
        details[cluster] = {
            "description": CLUSTER_DESCRIPTIONS[cluster],
            "trend": trend_by_cluster.get(cluster, TREND_SERIES[cluster]),
            "meters": meters,
            "resources": resources,
        }
    return details


def scale_trend(tenant_costs, all_costs, is_all):
    """Per-cluster trend scaled by the tenant's share of that cluster's current cost."""
    series = []
    for cluster, values in TREND_SERIES.items():
        if is_all:
            factor = 1.0
        else:
            denom = all_costs.get(cluster, 0)
            factor = (tenant_costs.get(cluster, 0) / denom) if denom else 0.0
        series.append({"name": cluster, "values": [round(value * factor) for value in values]})
    return series


def totals_at(series, index):
    return sum(item["values"][index] for item in series)


def delta_block(label, current, previous):
    delta = current - previous
    return {
        "label": label,
        "current": current,
        "previous": previous,
        "delta": delta,
        "deltaPercent": 0 if previous == 0 else (delta / previous) * 100,
    }


def build_forecast(share):
    labels = [f"Day {i}" for i in range(1, 46)]
    actual = [round((150000 + i * 1200 + (i % 7) * 1800) * share) for i in range(31)] + [None] * 14
    forecast = [None] * 30
    lower = [None] * 30
    upper = [None] * 30
    for i in range(15):
        mid = (186000 + i * 1100) * share
        width = 0.02 + 0.004 * i
        forecast.append(round(mid))
        lower.append(round(mid * (1 - width)))
        upper.append(round(mid * (1 + width)))
    return {"labels": labels, "actual": actual, "forecast": forecast, "lower": lower, "upper": upper}


def build_anomaly_summary(anomalies, sub_cluster, clusters):
    labels = [cluster["name"] for cluster in clusters][:5]
    if not labels:
        labels = ["Compute", "Storage", "Network", "Database", "AI & Analytics"]
    index = {label: i for i, label in enumerate(labels)}
    high = [0] * len(labels)
    medium = [0] * len(labels)
    win = [0] * len(labels)
    buckets = {"high": high, "medium": medium, "win": win}
    for anomaly in anomalies:
        cluster = sub_cluster.get(anomaly["scope"])
        if cluster not in index:
            continue
        bucket = buckets.get(anomaly["severity"])
        if bucket is not None:
            bucket[index[cluster]] += 1
    return {"labels": labels, "high": high, "medium": medium, "win": win}


def build_view(tenant_id, label, focus_rows, all_focus_rows, reservations, advisor, monitor, activity, shared):
    is_all = tenant_id == ALL_TENANTS
    current_rows = [row for row in focus_rows if row["period"] == "current"]
    previous_rows = [row for row in focus_rows if row["period"] == "previous"]
    current_cost = rows_sum(current_rows, "effectiveCost")
    previous_cost = rows_sum(previous_rows, "effectiveCost")

    all_current_cost = rows_sum([row for row in all_focus_rows if row["period"] == "current"], "effectiveCost")
    share = 1.0 if is_all else (current_cost / all_current_cost if all_current_cost else 0.0)

    trend_series = scale_trend(cluster_current_costs(focus_rows), cluster_current_costs(all_focus_rows), is_all)
    quarter_rollup = {
        "previous": {item["name"]: sum(item["values"][6:9]) for item in trend_series},
        "current": {item["name"]: sum(item["values"][9:12]) for item in trend_series},
    }

    commercial_changes = build_commercial_changes(focus_rows)
    clusters = build_clusters(focus_rows, current_cost)
    subscriptions = build_subscriptions(focus_rows)
    current_subs = {sub["name"] for sub in subscriptions}
    sub_cluster = subscription_to_cluster(current_rows)
    service_sub = service_to_subscription(current_rows)

    sub_tenant = subscription_to_tenant(all_focus_rows)

    def rec_tenant(item):
        return item.get("tenant") or sub_tenant.get(item["subscriptionName"], "sample-prod")

    recommendations = sorted([
        {
            "title": item["title"],
            "scope": item["subscriptionName"],
            "tenant": rec_tenant(item),
            "owner": item["owner"],
            "cluster": item["cluster"],
            "source": item["source"],
            "effort": item["effort"],
            "annualSavings": item["annualSavings"],
        }
        for item in advisor
        if is_all or rec_tenant(item) == tenant_id
    ], key=lambda item: item["annualSavings"], reverse=True)

    monitor_by_subscription = {item["subscriptionName"]: item for item in monitor}
    anomalies = [
        {
            "title": item["title"],
            "severity": item["severity"],
            "scope": item["subscriptionName"],
            "owner": next((sub["owner"] for sub in subscriptions if sub["name"] == item["subscriptionName"]), "Unknown"),
            "delta": 0,
            "rootCauseCandidate": item["rootCauseCandidate"],
            "relatedMetric": monitor_by_subscription.get(item["subscriptionName"], {}).get("metricName", "n/a"),
            "recommendation": next((rec["title"] for rec in recommendations if rec["scope"] == item["subscriptionName"]), "Review with workload owner"),
        }
        for item in activity
        if is_all or sub_tenant.get(item["subscriptionName"]) == tenant_id
    ]

    # Wins are derived from the largest realized cost reductions in this view.
    negative_changes = [change for change in commercial_changes if change["delta"] < 0]
    if negative_changes:
        win = negative_changes[0]
        scope = service_sub.get(win["service"], {}).get("subscription", win["cluster"])
        owner = service_sub.get(win["service"], {}).get("owner", "Workload owner")
        anomalies.append({
            "title": f"{win['service']} cost decreased",
            "severity": "win",
            "scope": scope,
            "owner": owner,
            "delta": win["delta"],
            "rootCauseCandidate": win["driver"],
            "relatedMetric": "cost",
            "recommendation": "Roll out the optimization pattern to comparable workloads.",
        })

    movers_up = [
        {
            "subscription": service_sub.get(change["service"], {}).get("subscription", change["service"].replace(" ", "-").lower()),
            "owner": service_sub.get(change["service"], {}).get("owner", "Workload owner"),
            "delta": change["delta"],
            "deltaPercent": change["deltaPercent"],
            "driver": change["driver"],
        }
        for change in commercial_changes if change["delta"] > 0
    ][:5]
    movers_down = [
        {
            "subscription": service_sub.get(change["service"], {}).get("subscription", change["service"].replace(" ", "-").lower()),
            "owner": service_sub.get(change["service"], {}).get("owner", "Workload owner"),
            "delta": change["delta"],
            "deltaPercent": change["deltaPercent"],
            "driver": change["driver"],
        }
        for change in negative_changes
    ][:5]

    quarter_current = sum(quarter_rollup["current"].values())
    quarter_previous = sum(quarter_rollup["previous"].values())
    year_current = totals_at(trend_series, -1)
    year_previous = totals_at(trend_series, 0)

    summary = {
        "currentCost": current_cost,
        "previousCost": previous_cost,
        "deltaMonth": current_cost - previous_cost,
        "deltaQuarterPercent": shared["deltaQuarterPercent"] if is_all else (0 if quarter_previous == 0 else (quarter_current - quarter_previous) / quarter_previous * 100),
        "commitmentCoveragePercent": reservations["coverage"]["reservationCoveragePercent"],
        "annualSavingsPotential": rows_sum(recommendations, "annualSavings"),
        "compare": {
            "month": delta_block("vs previous month", current_cost, previous_cost),
            "quarter": delta_block("vs previous quarter", quarter_current, quarter_previous),
            "year": delta_block("vs same month last year", year_current, year_previous),
        },
    }

    return {
        "period": {"id": f"sample-current-{tenant_id}", "label": label},
        "summary": summary,
        "commercialChanges": commercial_changes,
        "serviceClusters": clusters,
        "subscriptions": subscriptions,
        "commitments": shared["commitments"],
        "anomalies": anomalies,
        "recommendations": recommendations,
        "trend": {
            "labels": MONTH_LABELS,
            "series": trend_series,
            "anomalies": [
                {"index": 8, "label": "Feb: ingestion spike"},
                {"index": 10, "label": "Apr: AI rollout"},
                {"index": 11, "label": "May: network over-provisioning"},
            ],
        },
        "waterfall": [
            {"label": "Previous month", "value": previous_cost, "type": "total"},
            *[{"label": change["service"], "value": change["delta"], "type": "up" if change["delta"] >= 0 else "down"} for change in commercial_changes],
            {"label": "Current month", "value": current_cost, "type": "total"},
        ],
        "quarterRollup": quarter_rollup,
        "unitPriceIndex": shared["unitPriceIndex"],
        "clusterDetails": build_cluster_details(focus_rows, trend_series),
        "moversUp": movers_up,
        "moversDown": movers_down,
        "anomalySummary": build_anomaly_summary(anomalies, sub_cluster, clusters),
        "forecast": build_forecast(share),
        "dataSources": shared["dataSources"],
        "glossary": shared["glossary"],
        "dataQuality": {
            "costRows": len(focus_rows),
            "advisorRecommendations": len(recommendations),
            "monitorFindings": len(monitor),
            "activityLogFindings": len([item for item in activity if is_all or sub_tenant.get(item["subscriptionName"]) == tenant_id]),
            "notes": [
                "Sample data is synthetic.",
                "Commitments, unit-price index, data sources and glossary are billing-account scoped and shared across tenant views.",
                "Production ingestion should use customer-owned storage, RBAC, and secret management.",
            ],
        },
    }


def build_snapshot(focus_rows, reservations, advisor_recommendations, monitor_findings, activity_log_findings):
    shared = {
        "deltaQuarterPercent": 7.3,
        "commitments": {
            **reservations,
            "savings12m": [78000, 82000, 86000, 92000, 98000, 106000, 114000, 122000, 131000, 140000, 149000, 158000],
            "commitmentMix": [
                {"name": "VM Reservations", "hourly": 28800},
                {"name": "SQL Reservations", "hourly": 4200},
                {"name": "Savings Plan Compute", "hourly": 32400},
                {"name": "App Service Reservations", "hourly": 3600},
            ],
            "purchaseRecommendations": reservations.get("recommendations", []) + [
                {"title": "Downsize ExpressRoute circuit after utilization review", "scope": "sample-networking", "upfront": 0, "annualSavings": 170000, "roi": "High"},
                {"title": "Commit Azure OpenAI PTU for stable GPT-4o usage", "scope": "sample-ai-foundry", "upfront": 0, "annualSavings": 96000, "roi": "High"},
            ],
        },
        "unitPriceIndex": {
            "labels": MONTH_LABELS,
            "series": [
                {"name": "vCPU-hour", "values": [101, 100, 100, 99, 98, 99, 99, 100, 99, 98, 97, 96]},
                {"name": "GB-month", "values": [102, 101, 100, 100, 99, 99, 99, 100, 99, 99, 98, 98]},
                {"name": "GB-egress", "values": [100, 100, 101, 101, 101, 102, 101, 100, 101, 102, 103, 104]},
            ],
        },
        "dataSources": {
            "datasets": [
                {"dataset": "Cost and usage (FOCUS 1.0)", "scope": "Billing account", "frequency": "Daily / MTD", "schema": "FOCUS"},
                {"dataset": "ActualCost export", "scope": "Billing account", "frequency": "Daily", "schema": "Azure native"},
                {"dataset": "AmortizedCost export", "scope": "Billing account", "frequency": "Daily", "schema": "Azure native"},
                {"dataset": "Reservation / Savings Plan APIs", "scope": "Billing / benefit scope", "frequency": "Daily", "schema": "Azure APIs"},
                {"dataset": "Advisor / Monitor / Activity Log", "scope": "Subscription", "frequency": "Daily", "schema": "Azure APIs"},
            ],
            "fields": [
                {"field": "EffectiveCost / CostInBillingCurrency", "usedFor": "Cost trend, commercial changes, rankings"},
                {"field": "ListCost", "usedFor": "Savings versus PayG"},
                {"field": "ServiceName / MeterCategory", "usedFor": "Cluster mapping"},
                {"field": "ResourceId / ResourceGroup", "usedFor": "Workload drilldown and root cause"},
                {"field": "PricingModel / BenefitId", "usedFor": "Commitment attribution"},
                {"field": "TenantId / Tags / RBAC mapping", "usedFor": "Tenant switching, owner and cost-center accountability"},
            ],
            "architecture": "[Cost exports + Azure APIs] -> [Customer-owned storage/lakehouse] -> [Processing jobs] -> [Dashboard snapshot/API] -> [Web dashboard]",
        },
        "glossary": {
            "clusters": [{"cluster": name, "includes": CLUSTER_DESCRIPTIONS[name]} for name in TREND_SERIES],
            "methodology": [
                "Tenant views are pre-aggregated per Azure AD tenant; the 'all' view is the billing-account roll-up.",
                "Anomalies: rolling 28-day median per subscription x service, z-score over 7-day window.",
                "High severity: absolute delta above threshold and z-score >= 3.",
                "Win: sustained cost decrease with attributable optimization action.",
                "Actual cost is invoice-oriented; amortized/effective cost is preferred for trend reporting.",
                "FOCUS provides normalized EffectiveCost, BilledCost, ContractedCost, and ListCost fields.",
            ],
        },
    }

    tenant_ids = sorted({row["tenantName"] for row in focus_rows})
    tenants = [{"id": ALL_TENANTS, "label": "All tenants"}]
    tenants += [{"id": tenant, "label": tenant} for tenant in tenant_ids]

    views = {}
    for tenant in tenants:
        tenant_id = tenant["id"]
        rows = focus_rows if tenant_id == ALL_TENANTS else [row for row in focus_rows if row["tenantName"] == tenant_id]
        label = f"Synthetic May 2026 · {tenant['label'].lower()}"
        views[tenant_id] = build_view(tenant_id, label, rows, focus_rows, reservations, advisor_recommendations, monitor_findings, activity_log_findings, shared)

    return {
        "schemaVersion": "0.3.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "tenants": tenants,
        "defaultTenant": ALL_TENANTS,
        "views": views,
    }


snapshot = build_snapshot(
    read_json("focus-cost-export.sample.json"),
    read_json("reservation-savings-plan.sample.json"),
    read_json("advisor-recommendations.sample.json"),
    read_json("monitor-metrics.sample.json"),
    read_json("activity-log.sample.json"),
)

def jsonable(value):
    """Render integral floats as ints so output matches the Node pipeline byte-for-byte."""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [jsonable(item) for item in value]
    return value


validate_dashboard_snapshot(snapshot)
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(json.dumps(jsonable(snapshot), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Wrote {OUTPUT_PATH}")
