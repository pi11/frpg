import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Game version: client/package.json, raised with every commit (src/changelog.ts). */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** Public contact details of the game operator, set for the production build (docs/DEPLOY.md). */
function contacts(env: Record<string, string>): Plugin {
  const values: Record<string, string> = {
    CONTACT_EMAIL: env.VITE_CONTACT_EMAIL || '[почта не указана]',
    CONTACT_OPERATOR: env.VITE_OPERATOR || '[владелец игры не указан]',
    CONTACT_BACKUP_DAYS: env.VITE_BACKUP_DAYS || '14',
  };
  const escape = (text: string) => text
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return {
    name: 'contacts',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/%(CONTACT_[A-Z_]+)%/g,
        (match, key: string) => (key in values ? escape(values[key] ?? '') : match)),
    },
  };
}

/** Same clean addresses in dev and preview as nginx serves in production. */
const cleanUrls: Plugin = {
  name: 'clean-urls',
  configureServer: (server) => {
    server.middlewares.use((request, _response, next) => {
      const path = request.url?.split('?')[0];
      if (path && ['/privacy', '/delete-account', '/help', '/changelog'].includes(path)) request.url = `${path}.html`;
      next();
    });
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [contacts(loadEnv(mode, import.meta.dirname, 'VITE_')), cleanUrls],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: { input: ['index.html', 'privacy.html', 'delete-account.html', 'help.html', 'changelog.html'] },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
}));
