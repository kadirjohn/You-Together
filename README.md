# You Together 🎬

YouTube videolarını başkalarıyla beraber aynı anda senkronize şekilde izleyebilmenizi sağlayan bir web sitesi.

## Özellikler

- YouTube video embed
- Oda oluşturma ve paylaşma
- Sohbet etme
- Videolar senkronize oynatılır ve video play/pause edildiğinde de karşı tarafa iletilir
- Admin/izleyici şeklinde farklı kullanıcı ayrımı
- Docker Compose ile self hosted olarak da kullanılabilir

## Hızlı Başlangıç

### Gereksinimler

- Node.js 22+
- Redis
- npm

### Geliştirme

```bash
# Repo'yu klonlayın
git clone <repo-url>
cd you-together

# Docker ile Redis'i başlatın
docker compose -f docker-compose.dev.yml up -d

# Backend
cd server
cp ../.env.example .env
npm install
npm run dev

# Frontend
cd client
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

### Docker ile kullanmak isterseniz

```bash
# .env dosyasını oluştur
cp .env.example .env

# Tüm servisleri başlat
docker compose up -d
```

Uygulama: http://localhost:3000

## Mimari

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| State | Zustand |
| Real-time | Socket.IO |
| Backend | Node.js + TypeScript + Fastify |
| Database | Redis |
| Deployment | Docker + Docker Compose |

## Environment Variables

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `NODE_ENV` | Çalışma modu | `development` |
| `PORT` | Sunucu portu | `3000` |
| `REDIS_URL` | Redis bağlantı URL'i | `redis://localhost:6379` |
| `PUBLIC_BASE_URL` | **Paylaşılan oda linkleri buradan üretilir** | `http://localhost:3000` |
| `CORS_ORIGINS` | İzin verilen frontend origin'leri (virgülle) | `http://localhost:5173` |
| `ROOM_MAX_USERS` | Oda başına max kullanıcı | `10` |
| `ROOM_ACTIVE_TTL_SECONDS` | Aktif oda TTL | `10800` (3 saat) |
| `ROOM_EMPTY_TTL_SECONDS` | Boş oda TTL | `300` (5 dakika) |
| `CHAT_MAX_MESSAGES` | Maksimum chat mesajı | `100` |
| `PIN_MIN_LENGTH` | Minimum PIN uzunluğu | `4` |
| `PIN_MAX_LENGTH` | Maksimum PIN uzunluğu | `12` |
| `YOUTUBE_API_KEY` | YouTube Data API v3 (opsiyonel) | _(boş — oEmbed fallback)_ |
| `WATCHLIST_MAX_VIDEOS` | Oda başına izlenen video üst sınırı | `50` |

## Üretim (Production) — you.kadirca.com

Proje Cloudflare proxy arkasında çalışacak şekilde hazırdır. TLS, Cloudflare'in
edge sertifikası tarafından sonlandırılır; origin sunucuda sertifika gerekmez.

### Adımlar

1. `.env` dosyasını üretim değerleriyle doldurun (mutlaka):

   ```env
   NODE_ENV=production
   PUBLIC_BASE_URL=https://you.kadirca.com
   CORS_ORIGINS=https://you.kadirca.com
   REDIS_URL=redis://redis:6379
   ```

   > `PUBLIC_BASE_URL` localhost kalırsa **paylaşılan oda linkleri bozulur**.

2. Sunucuya projeyi kopyalayın ve başlatın:

   ```bash
   docker compose up -d --build
   ```

3. Reverse proxy'nizi `https://you.kadirca.com` → `http://127.0.0.1:3001`
   olacak şekilde yönlendirin (host-side port, container içi 3000). **WebSocket
   upgrade** aktif olmalı (Socket.IO için). Host'un 3000 portu meşgulse compose
   dosyasındaki `127.0.0.1:3001:3000` eşlemesini başka bir boş porta değiştirin.

   **nginx örneği:**

   ```nginx
   server {
       listen 80;
       server_name you.kadirca.com;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           # WebSocket upgrade (Socket.IO)
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```

4. Cloudflare'de `you` kaydını (A/CNAME) sunucunuza yönlendirin ve **proxy (orange
   cloud)** açık olsun. SSL/TLS modu **Flexible** (origin'de sertifika yok) veya
   **Full (strict)** (Cloudflare Origin Certificate) olabilir.

### Doğrulama

```bash
# Konteynerler ayakta mı
docker compose ps

# Sağlık kontrolü (host-side port — compose dosyasındaki eşleme)
curl http://127.0.0.1:3001/api/health
```

## Kullanım

1. Sitede, "Oda Oluştur"a tıklayın
2. Oda adı, PIN ve görünen adını girin
3. Oluşan linki arkadaşlarınla paylaşın
4. Arkadaşlarınız linke tıklasın, PIN ve ad girsin
5. Admin YouTube linki ekledikten sonra video izlemeye başlalayabilirsiniz