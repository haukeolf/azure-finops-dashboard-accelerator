# Azure FinOps Dashboard Accelerator

Open-source reference implementation for a web-based Azure FinOps dashboard using FOCUS, Azure Cost Management exports, and optional Azure API enrichment.

This repository is intended as a generic accelerator. It is not customer-specific deliverable code, a managed service, or a production deployment commitment.

## What this draft contains

- `apps/web` — browser dashboard based on a dashboard snapshot JSON.
- `apps/api` — small Node API that serves the generated dashboard snapshot.
- `packages/pipeline` — first-pass ingestion/aggregation pipeline for sample FOCUS, reservation, Advisor, Monitor, and Activity Log data.
- `packages/shared` — shared dashboard schema and validation helpers.
- `data/sample` — synthetic sample data only.
- `data/snapshots` — generated dashboard snapshot consumed by the web app and API.
- `docs` — architecture, data sources, and deployment notes.
- `infra/bicep` — placeholder Bicep for future Azure Static Web Apps / Function / Storage deployment.

## What this is not

- Not an EnBW-specific implementation.
- Not a replacement for ISD, partner, or customer-owned production delivery.
- Not connected to live Azure billing data by default.
- Not a place for customer data, tenant IDs, secrets, or subscription IDs.
- Not a supported Microsoft product.

## Local quickstart

```bash
make check
make api
```

In another terminal:

```bash
make web
```

Open `http://127.0.0.1:5173`.

The web dashboard first tries `http://127.0.0.1:7071/api/dashboard`. If the API is not running, it falls back to `data/snapshots/dashboard-snapshot.json`.

The repository also contains `package.json` workspace metadata for a future Node/TypeScript version, but this first draft is runnable with Python 3 standard library only.

## Intended production shape

```text
Azure Cost Management / FOCUS exports
Azure Reservations / Savings Plans APIs
Azure Advisor / Monitor / Activity Log / Resource Graph
        ↓
Customer-owned storage or lakehouse
        ↓
Customer/ISD data processing
        ↓
Dashboard snapshot JSON or secured API
        ↓
Web dashboard
```

## License

Apache License 2.0. Final publication should still follow the applicable internal OSS, legal, security, and trademark approval process.
