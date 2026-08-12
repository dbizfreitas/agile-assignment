import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro";
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={theme === "dark"}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
