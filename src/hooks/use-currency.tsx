import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SUPPORTED_CURRENCIES } from "@/lib/expense-shared";
import { initializeLiveRates } from "@/lib/fx";

type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

interface CurrencyContextValue {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  ratesVersion: number;
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);
const STORAGE_KEY = "finstream:display-currency";

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>("INR");
  const [ratesVersion, setRatesVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_CURRENCIES as readonly string[]).includes(stored)) {
      setCurrencyState(stored as CurrencyCode);
    }

    // Initialize live exchange rates asynchronously in the background
    initializeLiveRates().then(() => {
      setRatesVersion((prev) => prev + 1);
    });
  }, []);

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, c);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, ratesVersion }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
