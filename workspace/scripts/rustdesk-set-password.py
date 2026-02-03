import secrets
import re
from pathlib import Path

path = Path(r"C:\Users\Fsuels\AppData\Roaming\RustDesk\config\RustDesk.toml")
text = path.read_text(encoding="utf-8")
password = secrets.token_urlsafe(12)
text2 = re.sub(r"^password = '.*'$", f"password = '{password}'", text, flags=re.M)
if text2 == text:
    raise SystemExit("Could not find password line to replace")
path.write_text(text2, encoding="utf-8")
print(password)
