import { Sun, Moon, Sparkle } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

export function ThemeToggle() {
  const { theme, toggleTheme, themeStyle, toggleThemeStyle } = useTheme();

  return (
    <div className="flex items-center gap-1.5 p-1 rounded-full bg-card/60 backdrop-blur border border-border/50 shadow-sm">
      {/* Light/Dark Toggle */}
      <button
        onClick={toggleTheme}
        type="button"
        className="flex items-center justify-center w-7 h-7 rounded-full bg-transparent hover:bg-muted text-muted-foreground hover:text-primary cursor-pointer transition-all duration-200"
        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      >
        {theme === "dark" ? (
          <Sun className="w-3.5 h-3.5" />
        ) : (
          <Moon className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Divider */}
      <div className="w-[1px] h-4 bg-border/60" />

      {/* Cyber-Neon Mode Toggle */}
      <button
        onClick={toggleThemeStyle}
        type="button"
        className={`flex items-center justify-center w-7 h-7 rounded-full cursor-pointer transition-all duration-300 relative ${
          themeStyle === "neon"
            ? "bg-[rgba(0,242,254,0.12)] text-[var(--primary)] shadow-[0_0_8px_rgba(0,242,254,0.3)] border border-[rgba(0,242,254,0.25)]"
            : "bg-transparent text-muted-foreground hover:bg-muted hover:text-primary border border-transparent"
        }`}
        title={themeStyle === "neon" ? "Disable Cyber-Neon Mode" : "Enable Cyber-Neon Mode"}
      >
        {themeStyle === "neon" && (
          <span className="absolute -inset-0.5 rounded-full border border-[var(--primary)]/30 animate-pulse" />
        )}
        <Sparkle className={`w-3.5 h-3.5 ${themeStyle === "neon" ? "animate-pulse" : ""}`} />
      </button>
    </div>
  );
}
