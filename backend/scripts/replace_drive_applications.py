"""
Replace application_details.csv in each cluster's Drive folder with the corrected file from
CORRECTED_APPLICATIONS_FOR_DRIVE (the October "Submitted" versions).

  python scripts/replace_drive_applications.py            dry run: shows what would change, writes nothing
  python scripts/replace_drive_applications.py --apply    backs up each Drive file, replaces it, then re-reads it to verify

Each file is updated in place (same Drive file, same link, version history kept in Drive).
The originals are saved first to CORRECTED_APPLICATIONS_FOR_DRIVE/_DRIVE_BACKUP_BEFORE/.
Uses the dashboard's service account key (it has edit rights on these files).
"""
import argparse
import io
import re
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

BACKEND = Path(__file__).resolve().parent.parent
SOURCE = BACKEND.parent / "CORRECTED_APPLICATIONS_FOR_DRIVE"
NAME = "application_details.csv"

ap = argparse.ArgumentParser()
ap.add_argument("--apply", action="store_true", help="really replace the files in Drive (default is a dry run)")
ap.add_argument("--key", default=str(BACKEND / "service-account.json"))
args = ap.parse_args()

creds = service_account.Credentials.from_service_account_file(args.key, scopes=["https://www.googleapis.com/auth/drive"])
drive = build("drive", "v3", credentials=creds, cache_discovery=False)


def download(file_id: str) -> bytes:
    buf = io.BytesIO()
    req = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue()


# _LIST.txt: "KJET-2026-xxxxxx  Name" followed by an indented folder link
entries = []
lines = (SOURCE / "_LIST.txt").read_text(encoding="utf-8").splitlines()
for i, line in enumerate(lines):
    m = re.match(r"^(KJET-\d{4}-\d+)\s+(.+)$", line)
    if m and i + 1 < len(lines):
        f = re.search(r"/folders/([\w-]+)", lines[i + 1])
        if f:
            entries.append((m.group(1), m.group(2), f.group(1)))

print(f"{'APPLY' if args.apply else 'DRY RUN'}: {len(entries)} clusters\n")
backup_dir = SOURCE / "_DRIVE_BACKUP_BEFORE"
problems = 0
for app, name, folder in entries:
    new = (SOURCE / f"{app}_application_details.csv").read_bytes()
    q = f"'{folder}' in parents and name = '{NAME}' and trashed = false"
    files = drive.files().list(q=q, fields="files(id,name,modifiedTime,capabilities(canEdit))", supportsAllDrives=True,
                               includeItemsFromAllDrives=True).execute()["files"]
    if len(files) != 1:
        print(f"SKIP  {app} {name}: found {len(files)} files called {NAME} in the folder (need exactly 1)")
        problems += 1
        continue
    f = files[0]
    old = download(f["id"])
    status_old = re.search(rb"^Status,([^\r\n]*)", old, re.M)
    status_new = re.search(rb"^Status,([^\r\n]*)", new, re.M)
    sub_new = re.search(rb"^Submitted At,([^\r\n]*)", new, re.M)
    label = (f"{app} {name[:38]:38} Drive: {status_old.group(1).decode() if status_old else '?'}"
             f" -> {status_new.group(1).decode() if status_new else '?'} {sub_new.group(1).decode() if sub_new else ''}")
    if old == new:
        print(f"SAME  {label} (already identical)")
        continue
    if not f["capabilities"]["canEdit"]:
        print(f"SKIP  {label}: no edit permission")
        problems += 1
        continue
    if not args.apply:
        print(f"WOULD {label}")
        continue
    backup_dir.mkdir(exist_ok=True)
    (backup_dir / f"{app}_application_details.csv").write_bytes(old)
    drive.files().update(fileId=f["id"], media_body=MediaIoBaseUpload(io.BytesIO(new), mimetype="text/csv", resumable=False),
                         supportsAllDrives=True).execute()
    ok = download(f["id"]) == new
    print(f"{'DONE ' if ok else 'FAIL '} {label}{'' if ok else ' (re-read does not match!)'}")
    problems += 0 if ok else 1

print(f"\n{'Finished' if args.apply else 'Dry run finished'}; {problems} problem(s).")
if not args.apply:
    print("Nothing was changed. Add --apply to replace the files.")
sys.exit(1 if problems else 0)
