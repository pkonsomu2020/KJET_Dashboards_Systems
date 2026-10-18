# KJET Co-Investment Portfolio Dashboard

Dashboard for the Kenya Jobs and Economic Transformation (KJET) Cohort 1: 85 micro and small enterprise clusters applying for co-investment matching grants. Implemented by MSEA.

This project is connected to [Lovable](https://lovable.dev). Changes pushed to `main` sync back into the editor.

## Architecture

- **Frontend** (`src/`): TanStack Start, React 19, Tailwind 4, shadcn/ui, Recharts.
- **Backend** (`backend/`): Express API with PostgreSQL, Redis cache, better-auth sessions and optional Google Drive sync. See [backend/SETUP.md](backend/SETUP.md) and [backend/DRIVE_SETUP.md](backend/DRIVE_SETUP.md).
- All data endpoints require a signed-in session.

## Development

```sh
# backend (needs PostgreSQL, optional Redis, and backend/.env)
cd backend && npm i && node scripts/migrate.js && node scripts/seed.js && npm run dev

# frontend
npm i && npm run dev
```
