import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'agentflow-example-root',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/') req.url = '/examples/basic-flow/webview.html';
          next();
        });
      }
    }
  ],
  appType: 'mpa',
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false
  }
});
