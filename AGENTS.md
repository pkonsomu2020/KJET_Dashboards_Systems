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
- Keep the uploaded portfolio as source-controlled JSON with no server dependency because this is a read-only, zero-setup portfolio explorer.
- Centralize aggregation, financial compliance, filtering, and exports in the portfolio data module so every dashboard view uses the same source values and rules.
- Use distinct TanStack content routes with one shared dashboard shell and profile drawer so navigation has real URLs and consistent controls.
- Define all visual roles and chart palettes in the global design tokens so both themes remain consistent and use solid colors.
