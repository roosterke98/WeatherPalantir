import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fejlesztéskor a /api hívásokat a Vite továbbítja az ASP.NET Core backendnek,
// buildeléskor a kimenet a backend wwwroot mappájába kerül, így azt az ASP.NET Core szolgálja ki.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5262', changeOrigin: true },
    },
  },
  build: {
    outDir: '../WeatherPalantir.Endpoint/wwwroot',
    emptyOutDir: true,
  },
});
