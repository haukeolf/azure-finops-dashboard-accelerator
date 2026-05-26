# Deployment draft

Recommended MVP deployment:

1. Host the web app in Azure Static Web Apps.
2. Generate dashboard snapshots in a customer-owned storage account or lakehouse.
3. Serve snapshots via static files or a secured Azure Function API.
4. Use Entra ID authentication before production exposure.
5. Keep ingestion jobs server-side with managed identity.

This repository intentionally does not include customer-specific deployment parameters.

