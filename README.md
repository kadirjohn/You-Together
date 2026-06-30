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

1. Sitede, "Oda Oluştur"a tıklayın
2. Oda adı, PIN ve görünen adını girin
3. Oluşan linki arkadaşlarınla paylaşın
4. Arkadaşlarınız linke tıklasın, PIN ve ad girsin
5. Admin YouTube linki ekledikten sonra video izlemeye başlalayabilirsiniz