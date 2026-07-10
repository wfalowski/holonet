# Model pricing in settings — design

Date: 2026-07-10
Status: approved

## Goal

Let the user compare model costs by showing each model's price (USD per 1M
input tokens and USD per 1M output tokens) on the models list in Settings.
Prices are editable manually and can be refreshed from OpenRouter with one
button.

## Scope

- In scope: price columns on the models table, price fields in the add/edit
  model forms, a "Sync prices from OpenRouter" action, price columns in the
  Settings model list.
- Out of scope: showing prices in experiment model pickers, recomputing
  experiment result costs from these prices (`experiment_results.costUsd`
  already comes from OpenRouter per run), cached/reasoning-tier pricing.

## Data model

Extend `models` in `apps/server/src/db/schema.ts`:

```ts
inputCostPerMTok: doublePrecision("input_cost_per_mtok"),
outputCostPerMTok: doublePrecision("output_cost_per_mtok"),
```

- Unit: USD per 1,000,000 tokens (e.g. Claude Sonnet ≈ 3 / 15).
- Nullable: a model with unknown pricing simply shows no price.
- `double precision` (not `text` like `experiment_results.costUsd`) because
  these values are compared/sorted and edited as numbers; display rounding is
  a UI concern. Precision loss is irrelevant at this magnitude.
- New migration generated with `pnpm --filter server db:generate`
  (`drizzle-kit generate`), consistent with existing migrations in
  `apps/server/drizzle/`.

## Shared schemas (`packages/shared/src/schemas.ts`)

- `ModelInputSchema` and (via omit) `ModelUpdateSchema` gain:
  `inputCostPerMTok: z.number().nonnegative().nullish()` and the same for
  `outputCostPerMTok`. Absent/undefined and null both mean "no price".
- `ModelSchema` gains `inputCostPerMTok: z.number().nullable()` and
  `outputCostPerMTok: z.number().nullable()`.

## API (`apps/server/src/api/models.ts`)

- `POST /` and `PATCH /:id` read the new optional fields and persist them
  (null clears a price).
- `GET /` returns them on each model.
- New `POST /sync-pricing`:
  1. Fetch `https://openrouter.ai/api/v1/models` (public, no auth needed).
  2. Build a map of OpenRouter `id` → `pricing.prompt` / `pricing.completion`
     (strings, USD per single token).
  3. For each row in our `models` table whose `modelId` matches an OpenRouter
     id, set `inputCostPerMTok = Number(pricing.prompt) * 1_000_000` and
     `outputCostPerMTok = Number(pricing.completion) * 1_000_000`. Skip
     entries whose pricing fails to parse to a finite number.
  4. Respond `{ updated: string[], notFound: string[] }` (arrays of our
     `modelId`s). Models not found on OpenRouter are left untouched.
  - Errors from the OpenRouter fetch return a 502 with a message; nothing is
    partially written before the fetch succeeds.

## Web UI (`apps/web/src/views/SettingsView.tsx`)

- Models list: two new columns, "In $/1M" and "Out $/1M". Values formatted
  with up to 3 decimal places, trailing zeros dropped (3 → "3", 0.075 →
  "0.075"; values < 0.001 shown as-is); em dash (—) when null.
- Add form and edit form: two optional numeric inputs ("Input $/1M",
  "Output $/1M"). Empty input submits null.
- "Sync prices from OpenRouter" button near the list header. While running it
  is disabled; on completion show a transient status line like
  "Updated 4 models; 1 not on OpenRouter (my/custom-model)". On fetch failure
  show the error message. Follows the view's existing mutation/feedback
  patterns.

## Error handling

- Zod rejects negative or non-numeric prices at the API boundary.
- Sync endpoint never deletes existing prices for unmatched models.
- OpenRouter outage degrades to manual editing only.

## Testing

- Server: extend existing models API tests (or add alongside them) —
  create/update with prices, null-clearing, and a sync-pricing test with the
  OpenRouter fetch mocked (updated vs notFound vs unparsable pricing).
- Verification suite: `pnpm check`, `pnpm typecheck`, `pnpm test` at repo
  root.
