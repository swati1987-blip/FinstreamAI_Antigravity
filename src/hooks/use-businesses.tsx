import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface Business {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
}

export function useBusinesses() {
  const { user } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("businesses")
      .select("*")
      .order("name", { ascending: true });
    setBusinesses((data ?? []) as Business[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const addBusiness = async (name: string): Promise<Business | null> => {
    if (!user || !name.trim()) return null;
    const { data, error } = await supabase
      .from("businesses")
      .insert({ name: name.trim(), user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    const created = data as Business;
    setBusinesses((b) => [...b, created].sort((a, c) => a.name.localeCompare(c.name)));
    return created;
  };

  return { businesses, loading, reload: load, addBusiness };
}
