import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
type ThemeStyle = "classic" | "neon";

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
  themeStyle: ThemeStyle;
  toggleThemeStyle: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
      return "dark"; // Default to premium dark theme
    }
    return "dark";
  });

  const [themeStyle, setThemeStyle] = useState<ThemeStyle>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("themeStyle");
      if (saved === "classic" || saved === "neon") return saved;
      return "classic"; // Default to prestigious classic theme style
    }
    return "classic";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (themeStyle === "neon") {
      root.classList.add("neon-cyber");
    } else {
      root.classList.remove("neon-cyber");
    }
    localStorage.setItem("themeStyle", themeStyle);
  }, [themeStyle]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const toggleThemeStyle = () => {
    setThemeStyle((prev) => (prev === "classic" ? "neon" : "classic"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themeStyle, toggleThemeStyle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
