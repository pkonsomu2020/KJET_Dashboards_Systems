<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Application architecture
- Portfolio data lives in PostgreSQL and is served by the authenticated Express API in `backend/`; the frontend only formats and displays it. The seed source is `DASHBOARD SYSTEM/clusters_data.json`.
- Centralize aggregation and compliance rules in the backend services/schema (compliance is a generated column) and formatting and exports in `src/data/portfolio.ts`, so every view uses the same values.
- Use distinct TanStack content routes with one shared dashboard shell and profile drawer so navigation has real URLs and consistent controls.
- Define all visual roles and chart palettes in the global design tokens so both themes remain consistent and use solid colors.
