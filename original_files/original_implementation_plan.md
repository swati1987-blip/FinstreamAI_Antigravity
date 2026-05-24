# Implementation Plan — FinStream AI Rebranding & Schema Migration

This plan details the design and technical changes to transition **FinStream AI** into a premium, state-of-the-art financial ledger with a high-end Midnight Blue & Gold aesthetic, a custom transaction schema, and a public landing page.

---

## User Review Required

> [!IMPORTANT]
> **Database Table Migration**
> We are introducing a new, dedicated `transactions` table with strictly validated fields matching your exact columns. We will write a Supabase migration file `supabase/migrations/20260520000000_create_transactions.sql` and update the TypeScript types in `src/integrations/supabase/types.ts` to ensure full end-to-end type safety.
> 
> **Routing and Navigation Updates**
> To support a public pre-authentication landing page, we will make `/` the public landing page. The private dashboard will be moved to `/dashboard` (under the protected `_authenticated` layout). Unauthenticated visitors will see the landing page; authenticated users will be seamlessly redirected to `/dashboard`.

---

## Proposed Changes

We will group our modifications into three logical layers:

1. **Design System & Aesthetics** (CSS & Branding theme)
2. **Database & Schema Configuration** (Supabase Table and TypeScript Types)
3. **Routing & Views** (Landing Page, Auth Redirection, Dashboard, Transactions list, and reports)

---

### 1. Design System & Aesthetics

We will update th
<truncated 4141 bytes>
 `vendor`, `amount`, `main_category`, `company_entity`, `expense_category`).
* Filter transactions strictly by the `main_category` tabs (Business/Personal) and subgroup business spend by `company_entity` (KS, TI, CPM, AAS) using custom tabs and filter pills.
* Redesign the edit/update side sheet to bind input controls to the new fields.

#### [MODIFY] [reports.tsx](file:///e:/Recordings%20IIT%20Roorkee/Cohort%20A/New%20folder/finstream-ai-swats-main/src/routes/_authenticated/reports.tsx)
* Update references to query `transactions` and aggregate statistics based on the `main_category` and `company_entity`.

#### [MODIFY] [dashboard-sidebar.tsx](file:///e:/Recordings%20IIT%20Roorkee/Cohort%20A/New%20folder/finstream-ai-swats-main/src/components/dashboard-sidebar.tsx)
* Update the "Dashboard" link navigation destination from `/` to `/dashboard`.
* Ensure perfect gold highlights for the active state to enhance premium contrast.

#### [MODIFY] [login.tsx](file:///e:/Recordings%20IIT%20Roorkee/Cohort%20A/New%20folder/finstream-ai-swats-main/src/routes/login.tsx) & [signup.tsx](file:///e:/Recordings%20IIT%20Roorkee/Cohort%20A/New%20folder/finstream-ai-swats-main/src/routes/signup.tsx)
* Redirect users to `/dashboard` upon successful login/registration.

---

## Verification Plan

### Automated Verification
* Run type checks (`npx tsc --noEmit`) to verify there are no TypeScript errors.
* Validate that Vite starts successfully and compiles routes without warning.

### Manual Verification
* Access `/` (landing page) in the browser, review the layout, and confirm the features descriptions and aesthetics.
* Verify clicking "Get Started" takes you to `/login`.
* Log in, verify the auto-redirect to `/dashboard`.
* Verify that transaction logging, editing, deleting, and visual reporting works perfectly with the new fields.
