"""Keep the install-time prompt default aligned with the author's source file."""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
path = root / "plugin.json"
manifest = json.loads(path.read_text("utf-8"))
prompt = (root / "prompts/default.txt").read_text("utf-8").strip()
field = next(field for field in manifest["config"] if field["key"] == "prompt")
if "--check" in sys.argv:
    if field["default"] != prompt:
        raise SystemExit("Default prompt differs; run python scripts/sync-prompt.py")
else:
    field["default"] = prompt
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
print("Default prompt is synchronized")
