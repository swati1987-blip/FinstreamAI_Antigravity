CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  amount NUMERIC NOT NULL DEFAULT 0,
  vendor TEXT NOT NULL DEFAULT 'Unknown',
  category TEXT NOT NULL DEFAULT 'Personal',
  raw_text TEXT
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view expenses" ON public.expenses FOR SELECT USING (true);
CREATE POLICY "Public can insert expenses" ON public.expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can delete expenses" ON public.expenses FOR DELETE USING (true);