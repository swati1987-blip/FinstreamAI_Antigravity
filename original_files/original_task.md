# Task Checklist — Redesign & Schema Migration

- `[x]` Setup & Database Schema
  - `[x]` Create Supabase SQL migration for `transactions` table
  - `[x]` Update `src/integrations/supabase/types.ts` to include `transactions`
- `[x]` Premium Aesthetics
  - `[x]` Redesign `src/styles.css` with a high-end Midnight Navy & Metallic Gold palette
- `[x]` Routing & Landing Page
  - `[x]` Create `src/routes/index.tsx` (Public premium landing page with "Get Started" gold button)
  - `[x]` Delete old protected `src/routes/_authenticated/index.tsx`
  - `[x]` Create new protected `src/routes/_authenticated/dashboard.tsx`
- `[ ]` Components & Views Refactoring
  - `[ ]` Refactor `src/components/dashboard-sidebar.tsx` to link to `/dashboard` with gold active states
  - `[ ]` Update `src/routes/login.tsx` & `src/routes/signup.tsx` to redirect to `/dashboard`
  - `[ ]` Update `src/routes/_authenticated/transactions.tsx` with the new schema and filters
  - `[ ]` Update `src/routes/_authenticated/reports.tsx` for aggregating custom transactions
  - `[ ]` Update `src/components/master-upload.tsx` to write statements to the `transactions` table
- `[ ]` Verification
  - `[ ]` Run TypeScript checks and verify no errors
  - `[ ]` Confirm development server loads and serves pages correctly
