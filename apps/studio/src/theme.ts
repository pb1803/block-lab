export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "blocklab-studio-theme";

export interface ThemeRoot {
  readonly dataset: { theme?: string };
  readonly style: { colorScheme: string };
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ThemeControllerOptions {
  readonly root: ThemeRoot;
  readonly storage?: ThemeStorage | null;
  readonly matchMedia?: (query: string) => MediaQueryList;
}

export interface ThemeController {
  readonly getMode: () => ThemeMode;
  readonly setMode: (mode: ThemeMode) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly destroy: () => void;
}

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === "light" || value === "dark" || value === "system";

export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createThemeController(
  options: ThemeControllerOptions,
): ThemeController {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const media = options.matchMedia?.("(prefers-color-scheme: dark)");
  const listeners = new Set<() => void>();
  let mode: ThemeMode = "system";
  let destroyed = false;

  if (storage !== null && storage !== undefined) {
    try {
      const stored = storage.getItem(THEME_STORAGE_KEY);
      if (isThemeMode(stored)) {
        mode = stored;
      } else if (stored !== null) {
        storage.removeItem(THEME_STORAGE_KEY);
      }
    } catch {
      mode = "system";
    }
  }

  const apply = (): void => {
    const resolved = resolveTheme(mode, media?.matches ?? false);
    options.root.dataset.theme = resolved;
    options.root.style.colorScheme = resolved;
    for (const listener of listeners) listener();
  };

  const onSystemChange = (): void => {
    if (mode === "system") apply();
  };
  media?.addEventListener("change", onSystemChange);
  apply();

  return {
    getMode: () => mode,
    setMode(nextMode): void {
      if (!isThemeMode(nextMode)) return;
      mode = nextMode;
      if (storage !== null && storage !== undefined) {
        try {
          storage.setItem(THEME_STORAGE_KEY, mode);
        } catch {
          // Theme selection remains available when browser storage is blocked.
        }
      }
      apply();
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      media?.removeEventListener("change", onSystemChange);
      listeners.clear();
    },
  };
}
