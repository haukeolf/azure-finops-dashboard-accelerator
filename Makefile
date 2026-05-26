.PHONY: ingest validate api web check

ingest:
	python3 packages/pipeline/src/ingest.py

validate:
	python3 packages/shared/src/validate_snapshot.py data/snapshots/dashboard-snapshot.json

api:
	python3 apps/api/src/server.py

web:
	python3 apps/web/dev_server.py

check: ingest validate

