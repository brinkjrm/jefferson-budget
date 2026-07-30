# Jefferson Budget Architecture

## Runtime flow

`ProjectProvider` is the application's source of truth. It loads each Supabase collection once, composes the legacy tables into a single project model, and publishes shared metrics and action items.

```text
Supabase tables
      ↓
projectRepository
      ↓
ProjectProvider
      ↓
Project model + metrics + actions
      ↓
Overview / Budget / Schedule / Bids / Selections / Plans / Draws / AI
```

The existing tables remain usable during the migration. Optional project-core tables are detected automatically, so the deployed application works before and after the database migration.

## Key files

- `src/lib/projectRepository.js`: table mapping, reads, and standard entity mutations.
- `src/context/ProjectContext.jsx`: shared state, refreshes, mutations, capabilities, and project events.
- `src/domain/project.js`: pure project composition, metrics, and action-center rules.
- `src/components/ExecutiveDashboard.jsx`: project-level overview built from the shared model.
- `supabase/migrations/20260730020000_project_core.sql`: multi-project core, buildings, areas, links, events, and legacy-row backfill.

## Migration behavior

The project-core migration is additive:

1. Creates `projects`, `project_buildings`, `project_areas`, `project_events`, and `project_links`.
2. Adds nullable `project_id` foreign keys to existing project data tables.
3. Associates existing Jefferson data with the initial project.
4. Adds reusable schedule metadata for trade, task type, and plan references.
5. Preserves the current personal-app RLS model.

It does not delete or rename existing records or tables.

## Adding a new feature

1. Add its collection to `COLLECTION_SPECS`.
2. Compose it into `createProjectModel` under the appropriate domain.
3. Derive dashboard or AI-facing facts through pure functions in `src/domain`.
4. Use `useProject` or `useProjectCollection` from screens instead of loading a separate copy.
5. Route normal entity mutations through `createEntity`, `updateEntity`, or `removeEntity` so project state and the event log remain synchronized.

