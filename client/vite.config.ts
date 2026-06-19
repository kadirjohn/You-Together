import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ─── Allowed Hosts (Dev Server) ───────────────────────────────────
// Vite dev server sadece bu listedeki domain'lerden gelen istekleri
// kabul eder. Ngrok / Cloudflare Tunnel / kendi domain'iniz ile
// geliştirme yaparken ilgili domain'i buraya ekleyin.
//
// Pattern kuralları:
//   'example.com'  → tam eşleşme
//   '.example.com' → tüm subdomain'ler (www.example.com, app.example.com)
//   'localhost'    → yerel geliştirme (her zaman bulunmalı)
//
// Örnek: allowedHosts: ['.ngrok-free.dev', 'mysite.com', 'localhost']

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // tüm arayüzlerde dinle (ngrok/tunnel için gerekli)
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', 'localhost'],
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
});
