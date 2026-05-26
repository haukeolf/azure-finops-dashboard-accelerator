# Architecture

The accelerator separates the dashboard experience from customer-specific data ingestion and deployment.

```text
FOCUS / Azure Cost Management exports
Reservations / Savings Plans APIs
Advisor / Monitor / Activity Log / Resource Graph
        ↓
Customer-owned storage or lakehouse
        ↓
Data processing jobs
        ↓
Dashboard snapshot JSON or secured API
        ↓
Web dashboard
```

## Draft components

- Web: static dashboard that renders a dashboard snapshot.
- API: Node HTTP API that serves the generated snapshot.
- Pipeline: sample ingestion that transforms synthetic source files into the dashboard snapshot.
- Shared: schema validation for the dashboard snapshot.

## Production principle

The browser must never hold Azure management credentials. Live Azure API calls should happen in server-side jobs or APIs using managed identity and least-privilege RBAC.

