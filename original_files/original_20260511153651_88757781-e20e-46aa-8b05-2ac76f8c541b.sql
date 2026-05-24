-- Wipe existing data (no owner attached)
DELETE FROM public.expenses;

-- Add user_id and currency
ALTER TABLE public.expenses
  ADD COLUMN user_id UUID NOT NULL,
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR';

CREATE INDEX idx_expenses_user_id ON public.expenses(user_id);

-- Drop old public policies
DROP POLICY IF EXISTS "Public can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Public can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Public can delete expenses" ON public.expenses;

-- User-scoped policies
CREATE POLICY "Users can view own expenses"
  ON public.expenses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own expenses"
  ON public.expenses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own expenses"
  ON public.expenses FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own expenses"
  ON public.expenses FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);