# You Together 🎬

YouTube videolarını arkadaşlarınla aynı anda izle. Self-hosted watch party uygulaması.

## Özellikler

- 📺 YouTube video embed ile watch party
- 🔒 PIN korumalı odalar
- 👥 Maksimum 10 kişi
- 💬 Real-time chat
- ⏯️ Senkronize play/pause/seek
- 👑 Admin/owner rol sistemi
- 🎨 Dark red glowing tema
- 🐳 Docker Compose ile kolay kurulum

## Hızlı Başlangıç

### Gereksinimler

- Node.js 22+
- Redis (veya Docker)
- npm

### Geliştirme

```bash
# Repo'yu klonla
git clone <repo-url>
cd you-together

# Redis başlat (Docker ile)
docker compose -f docker-compose.dev.yml up -d

# Backend
cd server
cp ../.env.example .env
npm install
npm run dev

# Frontend (yeni terminal)
cd client
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

### Docker ile Production

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
| `PORT` | Sunucu portu | `3000` |
| `REDIS_URL` | Redis bağlantı URL'i | `redis://localhost:6379` |
| `PUBLIC_BASE_URL` | Uygulama URL'i | `http://localhost:3000` |
| `ROOM_MAX_USERS` | Oda başına max kullanıcı | `10` |
| `ROOM_ACTIVE_TTL_SECONDS` | Aktif oda TTL | `10800` (3 saat) |
| `ROOM_EMPTY_TTL_SECONDS` | Boş oda TTL | `300` (5 dakika) |
| `CHAT_MAX_MESSAGES` | Maksimum chat mesajı | `100` |
| `PIN_MIN_LENGTH` | Minimum PIN uzunluğu | `4` |
| `PIN_MAX_LENGTH` | Maksimum PIN uzunluğu | `12` |

## Kullanım

1. Siteyi aç, "Oda Oluştur"a tıkla
2. Oda adı, PIN ve görünen adını gir
3. Oluşan linki arkadaşlarınla paylaş
4. Arkadaşların linke tıklasın, PIN ve ad girsin
5. Admin YouTube linki yapıştırsın
6. Beraber izleyin! 🍿

## Lisans

MIT
