# KJET API — Local Setup

## 1. Install PostgreSQL 17 (Windows)

Download and run the installer manually (winget download is too large for automation):

**Option A — Official installer (recommended)**
1. Go to: https://www.postgresql.org/download/windows/
2. Download PostgreSQL 17 installer
3. Run the installer
4. Set superuser password when prompted (remember it)
5. Keep default port: **5432**
6. Complete installation

**Option B — winget (run this yourself in a terminal)**
```
winget install PostgreSQL.PostgreSQL.17
```

After install, add PostgreSQL to your PATH:
```
$env:PATH += ";C:\Program Files\PostgreSQL\17\bin"
```

---

## 2. Install Redis for Windows

Redis doesn't have an official Windows build. Use Memurai (Redis-compatible, free for dev):

1. Go to: https://www.memurai.com/get-memurai
2. Download and install
3. It starts automatically as a Windows service on port 6379

**Or use Windows Subsystem for Linux (WSL2):**
```
wsl --install
# then inside WSL:
sudo apt-get install redis-server
sudo service redis-server start
```

---

## 3. Create the database and user

Open a terminal and run:
```
psql -U postgres
```

Then in the psql shell:
```sql
CREATE USER kjet_user WITH PASSWORD 'kjet_pass';
CREATE DATABASE kjet OWNER kjet_user;
GRANT ALL PRIVILEGES ON DATABASE kjet TO kjet_user;
\q
```

---

## 4. Configure environment

```
cd backend
# create backend/.env (never commit it) with these variables:
#   PORT, NODE_ENV, PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD,
#   REDIS_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, CORS_ORIGINS,
#   ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD,
#   GOOGLE_SERVICE_ACCOUNT_PATH (optional, for Drive),
#   CACHE_TTL_PORTFOLIO / CACHE_TTL_CLUSTER_LIST / CACHE_TTL_CLUSTER_DETAIL (optional)
```

In `.env`, set your actual PGPASSWORD, BETTER_AUTH_SECRET (required, 32+ chars) and ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD (the account used to sign in; email must be `<username lowercased>@kjet.local`):
```
BETTER_AUTH_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

---

## 5. Install dependencies

```
cd backend
npm install
```

---

## 6. Run migration + seed

```
node scripts/migrate.js    # creates all 19 tables
node scripts/seed.js       # loads 85 clusters from 'DASHBOARD SYSTEM/clusters_data.json'
```

---

## 7. Start the API server

```
npm run dev
```

Server starts at: http://localhost:4000

---

## 8. Run smoke tests

With the server running, open another terminal:
```
node tests/smoke.test.js
```

All 15 smoke tests should pass.

---

## VPS migration checklist (later)

When you move to a VPS:
1. Set `NODE_ENV=production` in `.env`
2. Use a strong random `BETTER_AUTH_SECRET`
3. Set `CORS_ORIGINS` to your actual frontend domain
4. Run PostgreSQL with a proper password (not `kjet_pass`)
5. Use a process manager: `npm install -g pm2 && pm2 start src/index.js`
6. Put Nginx in front as a reverse proxy on port 80/443
7. Enable SSL (Let's Encrypt — free)
