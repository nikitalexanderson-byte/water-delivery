import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ''), ...process.env };
  return {
    publicDir: fileURLToPath(new URL('../../packages/route-map/static/', import.meta.url)),
    server: {
      host: env.WEB_HOST || '127.0.0.1',
      port: Number(env.WEB_PORT || 5173),
      proxy: { '/api': env.API_ORIGIN || 'http://127.0.0.1:' + (env.API_PORT || 8080) },
    },
  };
});
