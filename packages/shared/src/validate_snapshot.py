from pathlib import Path
import json
import sys

sys.path.append(str(Path(__file__).resolve().parent))
from schema import validate_dashboard_snapshot


if len(sys.argv) != 2:
    print("Usage: python3 validate_snapshot.py <snapshot.json>", file=sys.stderr)
    sys.exit(1)

path = Path(sys.argv[1])
snapshot = json.loads(path.read_text(encoding="utf-8"))
validate_dashboard_snapshot(snapshot)
print(f"Snapshot is valid: {path}")

