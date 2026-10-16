import "@testing-library/jest-dom/vitest";

// Inject Vite-like import.meta.env for test environment
// This prevents "Cannot read properties of undefined (reading 'config')" errors
// when api.ts / useDrive.ts read import.meta.env['VITE_API_URL']
Object.defineProperty(globalThis, 'import', {
  value: {
    meta: {
      env: {
        VITE_API_URL: 'http://localhost:4000',
        MODE: 'test',
        DEV: false,
        PROD: false,
        SSR: false,
      },
    },
  },
  writable: true,
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
