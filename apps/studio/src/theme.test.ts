import { afterEach, describe, expect, it } from "vitest";
import {
  createThemeController,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemeRoot,
  type ThemeStorage,
} from "./theme.js";

class MemoryStorage implements ThemeStorage {
  public readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

class TestMediaQuery extends EventTarget {
  public constructor(public matches: boolean) {
    super();
  }

  public setMatches(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

function root(): ThemeRoot {
  return { dataset: {}, style: { colorScheme: "" } };
}

function controllerOptions(
  rootElement: ThemeRoot,
  storage: ThemeStorage | null,
  media: TestMediaQuery,
) {
  return {
    root: rootElement,
    storage,
    matchMedia: () => media as unknown as MediaQueryList,
  };
}

const controllers: Array<{ destroy: () => void }> = [];

function createController(
  target: ThemeRoot,
  storage: ThemeStorage | null,
  media: TestMediaQuery,
) {
  const controller = createThemeController(
    controllerOptions(target, storage, media),
  );
  controllers.push(controller);
  return controller;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
});

describe("Studio theme controller", () => {
  it("initializes from a valid stored preference", () => {
    const target = root();
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, "dark");

    const theme = createController(target, storage, new TestMediaQuery(false));

    expect(theme.getMode()).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
    expect(target.style.colorScheme).toBe("dark");
  });

  it("switches immediately and persists the selected preference", () => {
    const target = root();
    const storage = new MemoryStorage();
    const theme = createController(target, storage, new TestMediaQuery(false));

    theme.setMode("dark");

    expect(theme.getMode()).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("follows system preference changes only while system mode is selected", () => {
    const target = root();
    const media = new TestMediaQuery(false);
    const theme = createController(target, new MemoryStorage(), media);

    expect(theme.getMode()).toBe("system");
    expect(target.dataset.theme).toBe("light");
    media.setMatches(true);
    expect(target.dataset.theme).toBe("dark");

    theme.setMode("light");
    media.setMatches(false);
    expect(target.dataset.theme).toBe("light");
  });

  it("falls back to system and clears an invalid stored preference", () => {
    const target = root();
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, "ultraviolet");
    const theme = createController(target, storage, new TestMediaQuery(true));

    expect(theme.getMode()).toBe("system");
    expect(target.dataset.theme).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("uses the system theme when storage is unavailable", () => {
    const target = root();
    const theme = createController(target, null, new TestMediaQuery(true));

    expect(theme.getMode()).toBe("system");
    expect(target.dataset.theme).toBe("dark");
  });

  it("notifies subscribers and unsubscribes them cleanly", () => {
    const target = root();
    const theme = createController(
      target,
      new MemoryStorage(),
      new TestMediaQuery(false),
    );
    let changes = 0;
    const unsubscribe = theme.subscribe(() => {
      changes += 1;
    });

    theme.setMode("dark");
    unsubscribe();
    theme.setMode("light");

    expect(changes).toBe(1);
  });

  it.each([
    ["light", false, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ] as const)(
    "resolves %s mode with system preference %s",
    (mode: ThemeMode, prefersDark, expected) => {
      expect(resolveTheme(mode, prefersDark)).toBe(expected);
    },
  );
});
