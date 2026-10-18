/// <reference types="vite/client" />

/**
 * Typed frontend environment. Vite inlines `VITE_*` at build time, so anything
 * declared here ships to the browser — never put a secret in this interface.
 * See `.env.example`.
 */
interface ImportMetaEnv {
  /** Base URL of the API, e.g. `http://localhost:4000`. Empty = same origin. */
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}