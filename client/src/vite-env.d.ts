/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for the Android build, e.g. https://game.example.com; empty on the web. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** client/package.json version, set by vite.config.ts. */
declare const __APP_VERSION__: string;
