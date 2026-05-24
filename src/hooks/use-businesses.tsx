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
    try {
      const { data, error } = await supabase
        .from("businesses")
        .select("*")
        .order("name", { ascending: true });
      
      if (error) throw error;

      const loaded = data as Business[];
      const standardNames = ["KS", "TI", "CPM", "AAS", "Swati", "Others"];
      
      // Check which standard entities are missing
      const missingNames = standardNames.filter(
        (name) => !loaded.some((b) => b.name.toUpperCase() === name.toUpperCase())
      );

      if (missingNames.length > 0) {
        console.log("Seeding missing standard corporate entities:", missingNames);
        const inserts = missingNames.map((name) => ({
          name,
          user_id: user.id
        }));
        
        const { data: seeded, error: seedError } = await supabase
          .from("businesses")
          .insert(inserts)
          .select();
        
        if (!seedError && seeded) {
          const combined = [...loaded, ...seeded].sort((a, b) => a.name.localeCompare(b.name));
          setBusinesses(combined);
          setLoading(false);
          return;
        }
      }

      setBusinesses(loaded);
    } catch (err) {
      console.error("Error loading/seeding businesses:", err);
    } finally {
      setLoading(false);
    }
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
