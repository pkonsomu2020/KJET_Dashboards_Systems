# Google Drive Integration Setup

## What this enables
- Every cluster profile drawer shows a live **Documents** tab listing all files in that
  cluster's Google Drive folder — fetched directly from Drive, not from the database.
- A background poller runs every **30 seconds**. When any file is added, renamed, or
  deleted in any of the 85 folders, the poller detects it and pushes an SSE event to
  every open browser tab within ~30 seconds.
- The affected cluster's Documents tab auto-refreshes — no page reload needed.

---

## Step 1 — Create a Google Cloud Project (if you don't have one)

1. Go to https://console.cloud.google.com/
2. Click **New Project** → name it `kjet-dashboard` → Create
3. Note the **Project ID**

---

## Step 2 — Enable the Google Drive API

1. In your project, go to **APIs & Services → Library**
2. Search for **Google Drive API** → Click it → Click **Enable**

---

## Step 3 — Create a Service Account

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**
3. Name: `kjet-drive-reader`
4. Role: **Viewer** (read-only is enough)
5. Click **Done**

---

## Step 4 — Download the Key File

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key → Create new key → JSON**
4. The JSON file downloads automatically
5. Rename it to `service-account.json`
6. Move it to:
   ```
   KJET_Dashboards_System/backend/service-account.json
   ```

---

## Step 5 — Share the Drive Folders with the Service Account

The service account has its own Google email (like
`kjet-drive-reader@kjet-dashboard.iam.gserviceaccount.com`).

**You must share each cluster's Drive folder with that email.**

For 85 clusters you have two options:

### Option A — Share the parent folder (recommended)
If all 85 cluster folders are inside one shared parent folder:
1. Right-click the parent folder in Drive
2. Share → paste the service account email
3. Set permission to **Viewer**
4. Done — all subfolders inherit access

### Option B — Share each folder individually
Not recommended for 85 folders, but works the same way.

---

## Step 6 — Restart the backend

```bash
cd backend
npm run dev
```

You should see:
```
[Drive] Connected — service account authenticated
[Drive] Changes poller started — checking every 30s
```

---

## How it works after setup

```
Admin uploads/renames a file in Google Drive
        ↓ (within 30 seconds)
Backend poller detects the change via Drive Changes API
        ↓ (instantly)
SSE push to all open browser tabs
        ↓ (instantly)
Affected cluster's Documents tab re-fetches from Drive
        ↓ (~1-2 seconds)
Dashboard shows updated file list
```

**Total latency: 30–35 seconds from Drive update to dashboard refresh.**

---

## Troubleshooting

| Error | Fix |
|---|---|
| `service-account.json not found` | Check path in `.env` → `GOOGLE_SERVICE_ACCOUNT_PATH` |
| `403 forbidden` | Share the Drive folder with the service account email |
| `Drive integration disabled` | File exists but is invalid — re-download from Google Cloud |
| Files not appearing | Make sure the folder is shared with the service account |
