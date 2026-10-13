import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type ThemePreference = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

const STORAGE_KEY = "sc-theme"
const VALID_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"]

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && (VALID_PREFERENCES as readonly string[]).includes(stored)) {
      return stored as ThemePreference
    }
  } catch {
    /* storage unavailable (private mode, blocked) — fall through to system */
  }
  // System is the default for first-time users.
  return "system"
}

function resolvePreference(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark"
  }
  return "light"
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark")
  document.documentElement.style.colorScheme = resolved
}

interface ThemeContextValue {
  /** The user's selected preference. "system" is the default. */
  theme: ThemePreference
  /** The effective theme after resolving "system" against the OS. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    typeof window === "undefined" ? "system" : readStoredPreference(),
  )
  const [osDark, setOsDark] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  )

  // React to OS appearance changes while "system" is selected.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (event: MediaQueryListEvent) => setOsDark(event.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (theme === "system") return osDark ? "dark" : "light"
    return theme
  }, [theme, osDark])

  // Keep <html> in sync (covers the gap before CSS/JS hydration too).
  useEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    try {
      // Persist ONLY the non-sensitive theme preference. Never tokens/PII here.
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    applyResolvedTheme(resolvePreference(next))
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>")
  return ctx
}
