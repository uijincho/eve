#!/usr/bin/env python3
"""Westbrook University Student Organization Finance: a fictional demo portal.

Runs inside the E2B sandbox on localhost only. Nothing is filed and no money moves.
Eve's lab uploads this file, starts it, and reads submitted requests from PORTAL_RECORDS.
"""
import hmac
import json
import os
import random
import threading
from bulk import import_bundle, MAX_BYTES
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORTAL_PORT", "8080"))
RECORDS_PATH = os.environ.get("PORTAL_RECORDS", os.path.join(ROOT, "requests.json"))
EVENTS_PATH = os.environ.get("PORTAL_EVENTS", os.path.join(ROOT, "events.json"))
USERNAME = os.environ.get("PORTAL_USERNAME", "eve.calhacks")
PASSWORD = os.environ.get("PORTAL_PASSWORD", "")
CONFIG = {
    "strictSsn": os.environ.get("PORTAL_STRICT_SSN") == "1",
    "timeoutSeconds": int(os.environ.get("PORTAL_TIMEOUT_SECONDS", "900")),
}
NINE_DIGITS = re.compile(r"^\d{9}$")
records = []
events = []
imports = {}
write_lock = threading.RLock()
IMPORTS_PATH = os.path.join(ROOT, "imports.json")
AUTH_PATH = os.path.join(ROOT, "authorization.json")

def save_imports():
    with open(IMPORTS_PATH, "w", encoding="utf-8") as handle:
        json.dump(imports, handle)



def is_foreign(draft):
    return draft.get("country") != "United States"


def validate(draft):
    """Server-side copy of the form rules, as a real portal would enforce them."""
    if CONFIG["strictSsn"] and not NINE_DIGITS.match(draft.get("tinDigits", "")):
        return "A 9-digit Social Security Number is required for every payee."
    if is_foreign(draft) and not draft.get("taxForm"):
        return "Non-US payees require Form W-8BEN attached."
    if not draft.get("supportingDocument"):
        return "Attach a supporting document."
    return None


def save_records():
    with open(RECORDS_PATH, "w", encoding="utf-8") as handle:
        json.dump(records, handle, indent=2)


def record_event(kind, detail):
    events.append({"type": kind, "detail": str(detail)[:300], "at": datetime.now(timezone.utc).isoformat()})
    with open(EVENTS_PATH, "w", encoding="utf-8") as handle:
        json.dump(events[-200:], handle)


class Handler(BaseHTTPRequestHandler):
    server_version = "WestbrookFinance/1.0"

    def log_message(self, format, *args):  # noqa: A002 - signature fixed by BaseHTTPRequestHandler
        return

    def send_json(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 1_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            return {}

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/", "/index.html"):
            with open(os.path.join(ROOT, "index.html"), "rb") as handle:
                data = handle.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif self.path == "/api/config":
            self.send_json(200, CONFIG)
        elif self.path == "/api/requests":
            self.send_json(200, records)
        else:
            self.send_json(404, {"ok": False, "message": "Not found."})

    def do_POST(self):
        if self.path == "/api/bulk-import":
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= MAX_BYTES:
                self.send_json(413, {"ok": False, "message": "Upload a ZIP no larger than 30 MB."})
                return
            try:
                imported = import_bundle(self.rfile.read(length), CONFIG["strictSsn"])
                with write_lock:
                    prior = imports.get(imported["batchId"])
                    if prior and prior["manifestHash"] != imported["manifestHash"]:
                        raise ValueError("This batch ID already has different contents. Regenerate the batch in Eve.")
                    imports[imported["batchId"]] = imported
                    save_imports()
                record_event("imported", "%s: %d payments" % (imported["batchId"], imported["manifest"]["totals"]["count"]))
                self.send_json(200, {"ok": True, **imported})
            except ValueError as error:
                record_event("error", str(error))
                self.send_json(422, {"ok": False, "message": str(error)})
            return
        body = self.read_json()
        if self.path == "/api/bulk-submit":
            with write_lock:
                imported = imports.get(body.get("batchId"))
                if not imported:
                    self.send_json(422, {"ok": False, "message": "Upload and validate the bundle first."})
                    return
                existing = next((r for r in records if r.get("batchId") == imported["batchId"]), None)
                if existing:
                    self.send_json(200, {"ok": True, "confirmation": existing["confirmation"]})
                    return
                try:
                    with open(AUTH_PATH, encoding="utf-8") as handle:
                        authorization = json.load(handle)
                except (OSError, ValueError):
                    authorization = {}
                if authorization.get("batchId") != imported["batchId"] or authorization.get("manifestHash") != imported["manifestHash"]:
                    self.send_json(403, {"ok": False, "message": "Waiting for Eve to verify this import against the controller's release."})
                    return
                confirmation = "WB-26-%05d" % random.randint(0, 99999)
                records.append({**imported, "confirmation": confirmation, "receivedAt": datetime.now(timezone.utc).isoformat()})
                save_records()
                record_event("submitted", confirmation)
                self.send_json(200, {"ok": True, "confirmation": confirmation})
            return
        if self.path == "/api/login":
            ok = bool(PASSWORD) and body.get("username") == USERNAME and hmac.compare_digest(
                str(body.get("password", "")), PASSWORD
            )
            record_event("login", "Signed in" if ok else "Rejected the username or password")
            self.send_json(200 if ok else 401, {"ok": ok})
        elif self.path == "/api/event":
            if body.get("type") in ("page", "error"):
                record_event(body["type"], body.get("detail", ""))
            self.send_json(200, {"ok": True})
        elif self.path == "/api/submit":
            draft = body.get("draft") or {}
            problem = validate(draft)
            if problem:
                record_event("error", problem)
                self.send_json(422, {"ok": False, "message": problem})
                return
            confirmation = "WB-26-%05d" % random.randint(0, 99999)
            stored = {k: v for k, v in draft.items() if k != "tinDigits"}
            stored["tinLast4"] = draft.get("tinDigits", "")[-4:]
            stored["confirmation"] = confirmation
            stored["receivedAt"] = datetime.now(timezone.utc).isoformat()
            records.append(stored)
            save_records()
            record_event("submitted", confirmation)
            self.send_json(200, {"ok": True, "confirmation": confirmation})
        else:
            self.send_json(404, {"ok": False, "message": "Not found."})


if __name__ == "__main__":
    if os.path.exists(RECORDS_PATH):
        with open(RECORDS_PATH, encoding="utf-8") as handle:
            records = json.load(handle)
    if os.path.exists(IMPORTS_PATH):
        with open(IMPORTS_PATH, encoding="utf-8") as handle:
            imports = json.load(handle)
    save_records()
    record_event("started", "strict SSN" if CONFIG["strictSsn"] else "standard")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
