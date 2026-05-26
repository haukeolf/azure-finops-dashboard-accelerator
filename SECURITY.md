# Security

Do not commit customer data, tenant IDs, subscription IDs, credentials, access tokens, API keys, or internal-only information to this repository.

For production use:

- Use Entra ID authentication.
- Keep credentials server-side only.
- Never call Azure management APIs directly from a public browser client.
- Apply least-privilege RBAC for billing, subscription, Advisor, Monitor, Activity Log, and Resource Graph access.
- Classify and protect cost and usage data according to the customer's data protection policy.

