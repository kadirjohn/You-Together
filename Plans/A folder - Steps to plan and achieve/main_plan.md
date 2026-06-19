# You Together — İlk Sürüm Geliştirme Planı

Sen bu projeyi sıfırdan geliştirecek bir yazılım AI ajanısın. Bu dokümanı proje spesifikasyonu, teknik plan, mimari rehber ve adım adım yapılacaklar listesi olarak kullan.

Projenin adı **You Together**.

Bu proje, kullanıcıların aynı YouTube videosunu aynı odada birlikte izleyebildiği, video durumunun kullanıcılar arasında senkronize edildiği, chat yapılabilen, self-hosted çalışacak bir web uygulamasıdır.

Proje ilk sürümde basit, hızlı, güvenilir ve kurulumu kolay olmalıdır. Ama mimari ileride büyüyebilecek şekilde temiz kurulmalıdır.

---

# 1. Projenin ana fikri

You Together, “YouTube watch party” mantığında çalışan bir web uygulamasıdır.

Kullanıcılar uygulamaya girer. Eğer aktif odalar varsa, bu odaları kartlar hâlinde görür. Eğer hiç oda yoksa ekranda şu mesaj görünür:

> Beraber izleyebileceğin bir YouTube odası henüz bulunmuyor.

Kullanıcı yeni oda oluşturabilir veya var olan odaya katılabilir.

Her oda PIN ile korunur. Kullanıcı oda kartına veya paylaşılmış oda linkine tıkladığında PIN girerek odaya katılır.

Uygulamada klasik kullanıcı hesabı, kayıt, giriş, şifre, profil sistemi yoktur. Her şey geçicidir. Kullanıcı odaya girerken yalnızca görünen adını ve PIN’i kullanır.

Odayı ilk oluşturan kişi ana admin olur.

Odada maksimum 10 kişi olabilir.

Oda içerisinde YouTube videosu embed olarak gösterilir. YouTube oynatıcı, YouTube IFrame Player API üzerinden kontrol edilir.

Odada sağ tarafta chat paneli bulunur. Kullanıcılar mesajlaşabilir.

Odanın temel amacı şudur:

Bir kullanıcı videoyu oynatır, durdurur veya ileri/geri sararsa, diğer kullanıcıların ekranında da bu değişiklik senkronize olur.

Bu proje için kontrol modeli **Model B** olacaktır:

* Her kullanıcı play yapabilir.
* Her kullanıcı pause yapabilir.
bir kulalnıcı pause yaptığında video durdurulur, yeniden play yapılırsa admin'in en son nerede kaldıysa tüm kullanıcılar ona switch'lenir, kullanocıların sadece play pause hakkı var eğer kullanıcılar farklı saniyeye giderse bu synclenmez, kendisi görür sadece, eğer süreyi el ile değiştirirse, o halde bir buton çıkar
"Beraber izlemeye devam et"
* Video değiştirme yetkisi yalnızca adminlerde olur.
* Admin verme/alma yetkisi ana adminde olur.
* İlk odayı oluşturan kişi ana admin olur.
* Ana admin isterse başka kullanıcıya admin yetkisi verebilir.
* Admin olan kullanıcılar yeni YouTube linki yapıştırarak odadaki videoyu değiştirebilir.

Oda linki paylaşılabilir olmalıdır. Oda oluşturulduğunda kullanıcıya paylaşılabilir bir link verilmelidir. Linke tıklayan kullanıcı direkt ilgili oda sayfasına gider fakat PIN girmeden içeri alınmaz.

---

# 2. Görsel tasarım dili

Arayüz teması:

* Dark theme
* Glowing red accent
* YouTube hissiyatı taşıyan kırmızı/siyah tonlar
* Hafif modern, eğlenceli, cartoonish dokunuşlar
* Fazla kurumsal değil
* glow ve shadow efektleri olabilir tuşlarda
* Ana vurgu rengi kırmızı
* Arka plan çok koyu siyah
* Kartlar açık pastel renkte
* Butonlarda kırmızı glow
* Oda kartlarında hover efekti
* Video alanı büyük, merkezde ve odak noktası olmalı
* Chat sağ tarafta ayrı panel olarak görünmeli
* Mobilde chat video altına düşebilir

Uygulama hissi:

* Basit
* Samimi
* Eğlenceli
* Anlaşılır
* Hızlı
* Teknik olmayan kullanıcı için kolay

---

# 3. Kullanılacak teknoloji stack’i

Frontend:

* React
* Vite
* TypeScript
* Tailwind CSS
* Zustand veya React Context
* Socket.IO Client
* YouTube IFrame Player API

Backend:

* Node.js
* TypeScript
* Fastify
* Socket.IO
* Redis
* Zod validation
* nanoid veya crypto random ID üretimi

Database / state:

* İlk sürüm için kalıcı klasik database kullanılmayacak.
* Redis kullanılacak.
* Odalar, kullanıcılar, room state, chat mesajları Redis’te geçici tutulacak.
* Odalara TTL verilecek.
* Oda boş kalırsa veya belirli süre aktif olmazsa silinecek.

Deployment:

* Docker
* Docker Compose
* App container
* Redis container
* İsteğe bağlı Caddy veya Nginx reverse proxy
* Self-hosted kuruluma uygun `.env.example`, `docker-compose.yml`, `Dockerfile` hazırlanacak.

---

# 4. Proje mimarisi

Uygulama iki ana parçadan oluşur:

1. Frontend client
2. Backend realtime server

Frontend, kullanıcı arayüzünü ve YouTube player’ı yönetir.

Backend ise oda state’ini, kullanıcı listesini, PIN kontrolünü, realtime event dağıtımını, chat mesajlarını ve sync bilgisini yönetir.

Backend, video oynatmaz. Backend yalnızca “oda zamanı” bilgisini ve olayları yönetir.

YouTube videosu her client’ın kendi tarayıcısında YouTube embed player üzerinden oynar.

---

# 5. Sync yaklaşımının ana prensibi

Senkronizasyon için tek bir kullanıcının tarayıcısına tamamen güvenilmemelidir.

Backend tarafında her oda için bir playback state tutulmalıdır.

Playback state şuna benzer:

```ts
type PlaybackStatus = "idle" | "playing" | "paused" | "buffering";

type RoomPlaybackState = {
  videoId: string | null;
  status: PlaybackStatus;
  baseTime: number;
  baseServerTime: number;
  version: number;
  updatedBy: string | null;
};
```

Burada:

* `videoId`: aktif YouTube videosu
* `status`: odanın oynatma durumu
* `baseTime`: son bilinen video zamanı, saniye cinsinden
* `baseServerTime`: bu bilginin server’da kaydedildiği timestamp
* `version`: state değiştikçe artan sayı
* `updatedBy`: son state’i değiştiren kullanıcı

Eğer oda paused ise gerçek video zamanı:

```ts
currentRoomTime = baseTime;
```

Eğer oda playing ise gerçek video zamanı:

```ts
currentRoomTime = baseTime + ((serverNow - baseServerTime) / 1000);
```

Bu sayede server, oda “playing” durumundayken her saniye Redis’e yazmak zorunda kalmaz. Teorik oda zamanı hesaplanabilir.

---

# 6. YouTube Player kontrolü

Frontend’de YouTube IFrame Player API kullanılacak.

Client aşağıdaki YouTube kontrollerine ihtiyaç duyar:

* Video yükleme
* Video oynatma
* Video durdurma
* Belirli saniyeye gitme
* Mevcut saniyeyi okuma
* Player state değişimini yakalama
* Buffering durumunu algılama
* Video hazır olduğunda server’a haber verme

Kullanılacak temel player işlemleri:

```ts
player.getCurrentTime()
player.seekTo(seconds, true)
player.playVideo()
player.pauseVideo()
player.getPlayerState()
player.getVideoLoadedFraction()
```

YouTube state değişimleri frontend’de dinlenmelidir.

Önemli state’ler:

```ts
-1: unstarted
0: ended
1: playing
2: paused
3: buffering
5: video cued
```

Frontend kendi player’ında play/pause/seek olaylarını tespit eder. Fakat event loop yaratmamak için dikkat edilmelidir.

Örneğin server’dan gelen bir sync komutu nedeniyle `seekTo()` yapılınca, client bunu tekrar “kullanıcı seek yaptı” diye server’a göndermemelidir.

Bu yüzden client tarafında flag kullanılmalıdır:

```ts
let applyingRemoteUpdate = false;
```

Remote update uygulanırken local event’ler server’a gönderilmemelidir.

---

# 7. Kontrol modeli

Bu projede Model B kullanılacak.

Kurallar:

* Odayı oluşturan kullanıcı `owner` olur.
* Owner aynı zamanda admin olur.
* Owner başka kullanıcılara admin verebilir.
* Adminler video değiştirebilir.
* Her kullanıcı play/pause yapabilir.
* Her kullanıcı chat mesajı gönderebilir.
* Owner odadan çıkarsa, sistem owner rolünü başka admin’e devredebilir.
* Eğer başka admin yoksa odadaki en eski kullanıcı owner yapılabilir.
* Oda tamamen boşalırsa oda hemen veya kısa TTL sonrası silinebilir.

Roller:

```ts
type RoomRole = "owner" | "admin" | "member";
```

Yetkiler:

```ts
owner:
  - video değiştirebilir
  - play/pause/seek yapabilir
  - chat yapabilir
  - admin verebilir
  - admin alabilir
  - oda bilgilerini değiştirebilir

admin:
  - video değiştirebilir
  - play/pause/seek yapabilir
  - chat yapabilir

member:
  - play/pause/seek yapabilir
  - chat yapabilir
```

---

# 8. Room sistemi

Oda oluşturma ekranında kullanıcıdan şunlar alınır:

* Oda adı
* PIN
* Kullanıcı görünen adı
* İlk YouTube linki opsiyonel olabilir

Oda oluşturulduğunda backend şunları yapar:

1. Oda ID üretir.
2. PIN hash’lenir.
3. Oda Redis’e yazılır.
4. Odayı oluşturan kullanıcı owner/admin olarak eklenir.
5. Kullanıcı Socket.IO room’una alınır.
6. Client’a oda state’i, kullanıcı bilgisi ve paylaşılabilir link gönderilir.

Oda ID tahmin edilebilir olmamalıdır.

Örnek ID:

```txt
room_9kXaP2mQ
```

PIN basit olabilir ama minimum 4, tercihen 6 haneli önerilir.

Oda linki şu yapıda olabilir:

```txt
https://domain.com/room/room_9kXaP2mQ
```

Linke tıklayan kullanıcı direkt room sayfasına gider ama önce PIN modalı görür.

---

# 9. Ana sayfa davranışı

Ana sayfa route’u:

```txt
/
```

Ana sayfada:

* Uygulama logosu
* “You Together” başlığı
* Kısa açıklama
* “Oda Oluştur” butonu
* Aktif odalar listesi
* Oda yoksa boş durum mesajı

Boş durum mesajı aynen şu olmalı:

```txt
Beraber izleyebileceğin bir YouTube odası henüz bulunmuyor.
```

Oda kartlarında:

* Oda adı
* Kişi sayısı
* Maksimum kişi sayısı: 10
* Aktif video varsa YouTube thumbnail
* Oda oluşturulma zamanı veya “şu anda izleniyor”
* “Katıl” butonu

Oda kartına tıklanınca PIN modalı açılır.

---

# 10. Oda sayfası davranışı

Room route’u:

```txt
/room/:roomId
```

Sayfa ilk açıldığında:

* Eğer kullanıcı bu odaya katılmamışsa PIN ekranı göster.
* Kullanıcıdan görünen ad ve PIN iste.
* PIN doğruysa socket ile odaya katıl.
* PIN yanlışsa hata göster.
* Oda doluysa hata göster.
* Oda yoksa “Bu oda bulunamadı veya süresi dolmuş.” göster.

Oda sayfası layout:

Sol / ana alan:

* Üstte oda adı
* Altında admin video input alanı
* Video player
* Sync status göstergesi
* Alt kısımda kullanıcı listesi veya kompakt kullanıcı rozetleri

Sağ panel:

* Chat
* Online kullanıcılar
* Admin badge’leri
* Owner badge’i

Admin video input alanı:

Sadece owner/admin görür.

Placeholder:

```txt
YouTube linki yapıştırın
```

Buton:

```txt
Videoyu değiştir
```

Video değişince tüm kullanıcıların player’ında yeni video açılır ve zaman 0’dan başlar.

---

# 11. Chat sistemi

Chat kalıcı olmak zorunda değil.

Redis’te oda başına son 50 veya 100 mesaj tutulabilir.

Mesaj yapısı:

```ts
type ChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  role: RoomRole;
  text: string;
  createdAt: number;
};
```

Kurallar:

* Boş mesaj gönderilemez.
* Maksimum mesaj uzunluğu 500 karakter.
* Basit rate limit olmalı.
* HTML escape edilmeli.
* Link otomatik clickable yapılabilir ama MVP’de şart değil.
* Sistem mesajları olabilir.

Sistem mesajları örnekleri:

```txt
Deniz odaya katıldı.
Mert videoyu duraklattı.
Ayşe yeni videoyu başlattı.
Deniz admin yapıldı.
```

---

# 12. Socket.IO event tasarımı

Backend ve frontend arasında net event sözleşmesi kurulmalıdır.

## Client → Server event’leri

```ts
"room:create"
"room:join"
"room:leave"
"room:list"
"chat:message"
"playback:play"
"playback:pause"
"playback:seek"
"video:change"
"admin:grant"
"admin:revoke"
"sync:request"
"client:player-ready"
"client:buffering"
"client:heartbeat"
```

## Server → Client event’leri

```ts
"room:created"
"room:joined"
"room:error"
"room:list:update"
"room:state"
"room:users:update"
"chat:message"
"chat:history"
"playback:state"
"video:changed"
"sync:command"
"admin:updated"
"user:joined"
"user:left"
"system:message"
```

---

# 13. Event detayları

## room:create

Client gönderir:

```ts
{
  roomName: string;
  pin: string;
  displayName: string;
  initialYoutubeUrl?: string;
}
```

Server döner:

```ts
{
  roomId: string;
  shareUrl: string;
  user: RoomUser;
  room: PublicRoomState;
}
```

Validasyon:

* Oda adı 3-60 karakter
* PIN 4-12 karakter
* Display name 2-24 karakter
* YouTube URL varsa geçerli olmalı

---

## room:join

Client gönderir:

```ts
{
  roomId: string;
  pin: string;
  displayName: string;
}
```

Server kontrol eder:

* Oda var mı?
* PIN doğru mu?
* Oda dolu mu?
* Aynı socket zaten odada mı?

Başarılıysa döner:

```ts
{
  room: PublicRoomState;
  user: RoomUser;
  users: RoomUser[];
  chatHistory: ChatMessage[];
  serverTime: number;
  syncTarget: {
    videoId: string | null;
    status: PlaybackStatus;
    targetTime: number;
    version: number;
  };
}
```

---

## video:change

Sadece admin/owner gönderebilir.

Client gönderir:

```ts
{
  roomId: string;
  youtubeUrl: string;
}
```

Server:

1. Kullanıcının admin olup olmadığını kontrol eder.
2. YouTube video ID çıkarır.
3. Oda playback state’ini sıfırlar.
4. `videoId` günceller.
5. `baseTime = 0`
6. `baseServerTime = now`
7. `status = "paused"` veya `"playing"` olarak ayarlanabilir.

MVP’de yeni video geldiğinde otomatik olarak paused başlayabilir. Daha iyi deneyim için admin tarafında video değişince admin play’e basar.

Server tüm odaya gönderir:

```ts
{
  videoId: string;
  changedBy: RoomUser;
  state: RoomPlaybackState;
}
```

---

## playback:play

Her kullanıcı gönderebilir.

Client gönderir:

```ts
{
  roomId: string;
  currentTime: number;
  clientEventId: string;
}
```

Server:

1. Kullanıcı odada mı kontrol eder.
2. currentTime makul mü kontrol eder.
3. Oda state’ini playing yapar.
4. `baseTime = currentTime`
5. `baseServerTime = now`
6. `version++`
7. Tüm odaya playback state yayınlar.

Server yayınlar:

```ts
{
  status: "playing";
  baseTime: number;
  baseServerTime: number;
  version: number;
  updatedBy: RoomUser;
}
```

---

## playback:pause

Her kullanıcı gönderebilir.

Client gönderir:

```ts
{
  roomId: string;
  currentTime: number;
  clientEventId: string;
}
```

Server:

1. Kullanıcı odada mı kontrol eder.
2. Oda state’ini paused yapar.
3. `baseTime = currentTime`
4. `baseServerTime = now`
5. `version++`
6. Tüm odaya yayınlar.

---

## playback:seek

Her kullanıcı gönderebilir.

Client gönderir:

```ts
{
  roomId: string;
  targetTime: number;
  shouldPlay: boolean;
  clientEventId: string;
}
```

Server:

1. Kullanıcı odada mı kontrol eder.
2. targetTime negatif değil mi kontrol eder.
3. Oda state’ini günceller.
4. Eğer shouldPlay true ise status playing olur.
5. Değilse mevcut status korunabilir veya paused yapılabilir.
6. `baseTime = targetTime`
7. `baseServerTime = now`
8. `version++`
9. Tüm odaya yayınlar.

---

## sync:request

Client, periyodik veya ihtiyaç anında server’dan güncel oda zamanını ister.

Client gönderir:

```ts
{
  roomId: string;
  localTime: number;
  playerState: string;
}
```

Server döner:

```ts
{
  videoId: string | null;
  status: PlaybackStatus;
  targetTime: number;
  serverTime: number;
  version: number;
}
```

---

## client:player-ready

Yeni katılan kullanıcı YouTube player hazır olduğunda gönderir.

Client gönderir:

```ts
{
  roomId: string;
}
```

Server o anda güncel target time hesaplar ve sadece o kullanıcıya sync command gönderir:

```ts
{
  type: "initial-sync";
  videoId: string;
  targetTime: number;
  status: PlaybackStatus;
  version: number;
}
```

Bu çok önemlidir. Kullanıcı sayfaya girdiğinde video player hemen hazır olmayabilir. İlk sync, player hazır olduktan sonra yapılmalıdır.

---

# 14. Sync algoritması

Frontend tarafında her client 2 saniyede bir drift kontrolü yapmalıdır.

Pseudo-code:

```ts
setInterval(() => {
  if (!playerReady) return;
  if (!roomState.videoId) return;
  if (applyingRemoteUpdate) return;

  const localTime = player.getCurrentTime();
  const expectedTime = computeExpectedRoomTime(roomState, estimatedServerOffset);
  const drift = localTime - expectedTime;

  if (Math.abs(drift) <= 2.5) {
    setSyncStatus("synced");
    return;
  }

  if (Math.abs(drift) > 2.5 && Math.abs(drift) <= 7) {
    setSyncStatus("slightly-behind-or-ahead");
    player.seekTo(expectedTime, true);
    return;
  }

  if (Math.abs(drift) > 7) {
    setSyncStatus("resyncing");
    player.seekTo(expectedTime, true);
    showToast("Oda zamanına senkronize edildin.");
  }
}, 2000);
```

Tolerans değerleri:

```ts
const SOFT_TOLERANCE_SECONDS = 1.5;
const HARD_TOLERANCE_SECONDS = 2.5;
const CRITICAL_TOLERANCE_SECONDS = 7;
```

İlk sürümde playback rate ile yumuşak hızlandırma/yavaşlatma yapılmasın. Sadece drift büyükse `seekTo` kullanılsın.

2-3 saniye fark kabul edilebilir.

---

# 15. Buffering ve yavaş internet yaklaşımı

Yeni katılan kullanıcı yavaş internete sahipse video hemen yüklenmeyebilir.

Bu durumda uygulanacak yaklaşım:

1. User odaya katılır.
2. Server oda bilgisini verir.
3. Client YouTube player’ı oluşturur.
4. Player hazır olana kadar “Video hazırlanıyor...” gösterilir.
5. Player ready olduktan sonra client `client:player-ready` gönderir.
6. Server o andaki gerçek target time’ı hesaplar.
7. Client bu zamana seek eder.
8. Eğer video buffering’e düşerse client bunu UI’da gösterir.
9. Buffering bitince client tekrar sync request yapar.
10. Eğer drift çok büyükse yeniden seek eder.

Yavaş interneti anlamak için şu sinyaller toplanabilir:

* YouTube player state `BUFFERING`
* `getVideoLoadedFraction()`
* Socket ping/latency
* Local time sürekli expected time’dan geride kalıyor mu?
* Son 30 saniyede kaç defa buffering oldu?

MVP’de karmaşık network ölçümü yapılmasın. Şunlar yeterli:

```ts
if playerState === BUFFERING:
  show "Bağlantın videoyu yüklemeye çalışıyor..."

if buffering ended:
  request sync from server
```

Eğer kullanıcı sürekli geride kalıyorsa:

```txt
Bağlantın biraz yavaş görünüyor. Seni oda zamanına yaklaştırıyoruz.
```

---

# 16. Remote update loop engelleme

Çok önemli problem:

Server’dan gelen play/pause/seek komutları client player’ında event üretir. Eğer client bu event’i tekrar server’a gönderirse sonsuz loop oluşur.

Bunu engellemek için:

```ts
let applyingRemoteUpdate = false;
let lastRemoteVersion = 0;
```

Remote state gelirken:

```ts
applyingRemoteUpdate = true;

try {
  applyRemotePlaybackState(state);
} finally {
  setTimeout(() => {
    applyingRemoteUpdate = false;
  }, 500);
}
```

Local player event handler:

```ts
function onPlayerStateChange(event) {
  if (applyingRemoteUpdate) return;

  if (event.data === YT.PlayerState.PLAYING) {
    emitPlaybackPlay();
  }

  if (event.data === YT.PlayerState.PAUSED) {
    emitPlaybackPause();
  }

  if (event.data === YT.PlayerState.BUFFERING) {
    emitBuffering();
  }
}
```

Ayrıca her playback event’ine `clientEventId` eklenmelidir.

Server aynı event’i gönderen client’a da yayınlayabilir ama client kendi event ID’sini tanıyorsa tekrar uygulamayabilir.

---

# 17. YouTube URL parsing

Backend veya shared utility, YouTube URL’den video ID çıkarmalıdır.

Desteklenecek formatlar:

```txt
https://www.youtube.com/watch?v=VIDEO_ID
https://youtu.be/VIDEO_ID
https://www.youtube.com/embed/VIDEO_ID
https://youtube.com/shorts/VIDEO_ID
```

Video ID 11 karakterli YouTube ID formatına yakın doğrulanmalıdır.

MVP için playlist desteklenmesin.

Eğer URL geçersizse kullanıcıya:

```txt
Geçerli bir YouTube linki gir.
```

Eğer video embed edilemiyorsa frontend YouTube error event’inde:

```txt
Bu video gömülü oynatmaya izin vermiyor. Başka bir video deneyin.
```

---

# 18. Redis veri modeli

Redis key önerileri:

```txt
room:{roomId}
room:{roomId}:users
room:{roomId}:chat
room:{roomId}:pin
socket:{socketId}
```

Room object:

```ts
type RoomRecord = {
  id: string;
  name: string;
  pinHash: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  ownerUserId: string;
  maxUsers: number;
  shareSlug: string;
  playback: RoomPlaybackState;
};
```

User object:

```ts
type RoomUser = {
  id: string;
  socketId: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: number;
  lastSeenAt: number;
};
```

Chat list:

```ts
ChatMessage[]
```

TTL:

* Oda aktifken TTL refresh edilebilir.
* Oda boşalınca 5 dakika TTL verilebilir.
* Oda aktif ama kullanılmıyorsa 3 saat sonra silinebilir.
* Chat oda ile birlikte silinir.

Önerilen süreler:

```ts
ROOM_ACTIVE_TTL_SECONDS = 3 * 60 * 60;
ROOM_EMPTY_TTL_SECONDS = 5 * 60;
CHAT_MAX_MESSAGES = 100;
```

---

# 19. Backend klasör yapısı

Önerilen yapı:

```txt
server/
  src/
    index.ts
    app.ts
    config.ts

    redis/
      client.ts
      keys.ts

    rooms/
      room.types.ts
      room.service.ts
      room.repository.ts
      room.validation.ts

    sockets/
      socket.server.ts
      socket.auth.ts
      socket.events.ts
      room.handlers.ts
      playback.handlers.ts
      chat.handlers.ts
      admin.handlers.ts

    youtube/
      youtube.utils.ts

    utils/
      ids.ts
      time.ts
      pin.ts
      rate-limit.ts
      errors.ts

    http/
      routes.ts
      health.route.ts
      rooms.route.ts
```

Backend hem HTTP route’ları hem Socket.IO event’lerini içerebilir.

HTTP route’ları:

```txt
GET /health
GET /api/rooms
GET /api/rooms/:roomId/public
```

Oda oluşturma ve katılma socket üzerinden yapılabilir. Alternatif olarak oda oluşturma HTTP ile yapılabilir ama MVP’de socket üzerinden tutarlı ilerlemek daha basit olur.

---

# 20. Frontend klasör yapısı

Önerilen yapı:

```txt
client/
  src/
    main.tsx
    App.tsx

    routes/
      HomePage.tsx
      RoomPage.tsx
      NotFoundPage.tsx

    components/
      layout/
        AppShell.tsx
        Header.tsx

      rooms/
        RoomCard.tsx
        CreateRoomModal.tsx
        JoinRoomModal.tsx
        EmptyRoomsState.tsx
        ShareRoomLink.tsx

      player/
        YouTubePlayer.tsx
        PlayerFrame.tsx
        SyncBadge.tsx
        VideoInputBar.tsx
        PlayerOverlay.tsx

      chat/
        ChatPanel.tsx
        ChatMessageItem.tsx
        ChatInput.tsx

      users/
        UserList.tsx
        UserBadge.tsx
        AdminControls.tsx

      ui/
        Button.tsx
        Input.tsx
        Modal.tsx
        Card.tsx
        Toast.tsx
        Badge.tsx

    hooks/
      useSocket.ts
      useRoom.ts
      useYouTubePlayer.ts
      usePlaybackSync.ts
      useServerTime.ts

    stores/
      room.store.ts
      socket.store.ts
      ui.store.ts

    lib/
      socket.ts
      youtube.ts
      time.ts
      validators.ts

    styles/
      globals.css
```

---

# 21. Frontend state yönetimi

Zustand kullanılabilir.

Room store:

```ts
type RoomStore = {
  room: PublicRoomState | null;
  currentUser: RoomUser | null;
  users: RoomUser[];
  chatMessages: ChatMessage[];
  playback: RoomPlaybackState | null;
  serverOffsetMs: number;
  syncStatus: SyncStatus;

  setRoom: ...
  setUsers: ...
  setPlayback: ...
  addChatMessage: ...
  setSyncStatus: ...
};
```

Socket tek instance olmalıdır.

Socket lifecycle:

* App açılınca socket bağlanır.
* Ana sayfada room list update dinlenir.
* Room sayfasında join event gönderilir.
* Room’dan çıkınca leave event gönderilir.
* Component unmount olunca listener cleanup yapılır.

---

# 22. Server time offset

Client ile server arasında küçük zaman farkları olabilir.

Client, server’dan gelen `serverTime` ile kendi `Date.now()` değerini karşılaştırarak offset hesaplar.

Basit hesap:

```ts
serverOffsetMs = serverTime - Date.now();
estimatedServerNow = Date.now() + serverOffsetMs;
```

Daha gelişmiş RTT yarılama yapılabilir ama MVP için basit offset yeterlidir.

Server her playback state yayınında `serverTime` gönderebilir.

---

# 23. UI detayları

## Ana renkler

Tailwind theme veya CSS variable:

```css
:root {
  --bg-main: #070707;
  --bg-panel: #111111;
  --bg-card: #171717;
  --red-main: #ff0033;
  --red-soft: #ff335f;
  --red-dark: #8a001d;
  --text-main: #f5f5f5;
  --text-muted: #a3a3a3;
}
```

Glowing button örneği:

```css
.glow-red {
  box-shadow:
    0 0 12px rgba(255, 0, 51, 0.45),
    0 0 32px rgba(255, 0, 51, 0.2);
}
```

## Ana sayfa

Hero metin:

```txt
You Together
YouTube videolarını arkadaşlarınla aynı anda izle.
```

Alt açıklama:

```txt
Oda oluştur, linki paylaş, PIN ile katıl ve beraber izlemeye başla.
```

Butonlar:

```txt
Oda Oluştur
Odaları Yenile
```

## Oda kartı

Kart alanları:

```txt
Oda adı
Aktif video thumbnail
Kişi sayısı: 3/10
Durum: İzleniyor / Bekliyor
Katıl
```

## Oda sayfası

Üst bar:

```txt
Room name
Share link button
Online users
```

Admin video bar:

```txt
[YouTube linki yapıştırın] [Videoyu değiştir]
```

Sync badge örnekleri:

```txt
Senkronize
2 sn geride
Yeniden senkronize ediliyor
Buffering
```

Chat input placeholder:

```txt
Mesaj yaz...
```

---

# 24. Paylaşılabilir oda linki

Oda oluşturulduktan sonra kullanıcıya share card göster.

Metin:

```txt
Odan hazır!
Bu linki arkadaşlarınla paylaş:
https://domain.com/room/{roomId}
```

Buton:

```txt
Linki kopyala
```

Kopyalama başarılı olursa:

```txt
Link kopyalandı.
```

PIN ayrıca gösterilebilir:

```txt
PIN: 123456
```

Ama güvenlik için PIN’i linkin içine koyma.

---

# 25. Rate limit ve güvenlik

MVP self-hosted küçük proje olsa da temel önlemler olmalı.

PIN brute force önlemi:

* Aynı socket/IP için 5 yanlış deneme sonrası 30 saniye bekleme.
* Oda PIN’i plaintext tutulmamalı.
* PIN hash’lenmeli.

Chat rate limit:

```txt
1 saniyede maksimum 3 mesaj
```

Playback event rate limit:

```txt
1 saniyede maksimum 5 playback event
```

Video change rate limit:

```txt
10 saniyede maksimum 3 video change
```

Input validation:

* Zod kullan.
* Tüm socket payload’larını validate et.
* Display name trim edilmeli.
* Oda adı trim edilmeli.
* Chat text escape edilmeli.
* Çok uzun payload kabul edilmemeli.

---

# 26. Oda doluluk kuralı

Maksimum 10 kişi.

Join sırasında:

```ts
if users.length >= 10:
  reject with "Bu oda dolu."
```

Kullanıcı bağlantısı koparsa:

* Hemen silinebilir.
* Daha iyi deneyim için 30 saniye reconnect süresi verilebilir.

MVP’de basit tut:

* Disconnect olduğunda kullanıcı odadan çıkarılır.
* Oda boşsa empty TTL başlatılır.

---

# 27. Disconnect davranışı

Socket disconnect olduğunda:

1. Kullanıcının hangi odada olduğu bulunur.
2. Kullanıcı odadan çıkarılır.
3. Kullanıcı listesi güncellenir.
4. Chat’e sistem mesajı düşülür.
5. Eğer çıkan kullanıcı owner ise ownership devri yapılır.
6. Oda boşsa oda TTL’i kısaltılır.

Owner devri:

```ts
if owner left:
  if any admin exists:
    oldest admin becomes owner
  else if any member exists:
    oldest member becomes owner
  else:
    room is empty
```

Yeni owner tüm odaya duyurulur.

---

# 28. Admin verme/alma

Owner kullanıcı listesinde her member/admin yanında küçük kontrol görebilir.

Aksiyonlar:

```txt
Admin yap
Adminliği al
```

Owner kendi owner rolünü kaybedemez.

Admin grant event:

```ts
{
  roomId: string;
  targetUserId: string;
}
```

Server:

* Request atan owner mı?
* Target user odada mı?
* Target zaten admin/owner mı?

Sonra güncelle.

---

# 29. Player event davranışı detayları

## Kullanıcı play’e basarsa

1. Frontend `getCurrentTime()` okur.
2. `playback:play` event gönderir.
3. Server oda state’ini playing yapar.
4. Server tüm kullanıcıya state gönderir.
5. Diğer client’lar expected time hesaplayıp play yapar.

## Kullanıcı pause’a basarsa

1. Frontend `getCurrentTime()` okur.
2. `playback:pause` gönderir.
3. Server paused state kaydeder.
4. Herkes pause olur.
5. Client’lar `seekTo(baseTime)` ile küçük farkı düzeltebilir.

## Kullanıcı seek yaparsa

YouTube IFrame API doğrudan “seek event” vermeyebilir. Bunu algılamak için frontend periodic local time ölçümü yapabilir.

Basit yaklaşım:

* Her 500 ms local time takip edilir.
* Eğer playing durumunda beklenenden çok ani sıçrama varsa seek sayılır.
* Ya da kullanıcı scrub yaptıktan sonra player state değişimlerinden tahmin edilir.

MVP için daha basit:

* Sadece play/pause event’leri doğrudan sync edilir.
* Periyodik drift kontrolü büyük fark görürse server’a `playback:seek` göndermek yerine `sync:request` yapar.

Ama proje gereksinimi “herkes seek yapabilsin” olduğu için şu yöntem uygulanmalı:

Client local time watcher:

```ts
let lastLocalTime = 0;
let lastCheck = Date.now();

setInterval(() => {
  if (!playerReady) return;
  if (applyingRemoteUpdate) return;

  const now = Date.now();
  const current = player.getCurrentTime();
  const elapsed = (now - lastCheck) / 1000;
  const expectedLocal = lastLocalTime + elapsed;

  const jump = Math.abs(current - expectedLocal);

  if (jump > 3 && playerIsPlayingOrPaused) {
    emitPlaybackSeek(current);
  }

  lastLocalTime = current;
  lastCheck = now;
}, 1000);
```

Bu mükemmel değildir ama MVP için yeterlidir.

Daha sonra özel player overlay veya custom controls eklenirse seek kontrolü daha net yapılabilir.

---

# 30. Initial sync akışı

Yeni kullanıcı odaya katıldığında en kritik akış budur.

Adımlar:

1. Kullanıcı `/room/:roomId` açar.
2. PIN + display name girer.
3. Client `room:join` gönderir.
4. Server PIN kontrol eder.
5. Server kullanıcıyı socket room’a alır.
6. Server kullanıcıya room state ve chat history gönderir.
7. Client YouTube player component’i mount eder.
8. Player hazır olduğunda `client:player-ready` gönderir.
9. Server o anki target time’ı hesaplar.
10. Server sadece bu client’a `sync:command` gönderir.
11. Client videoyu target time’a seek eder.
12. Eğer oda playing ise playVideo çağırır.
13. Tarayıcı autoplay engellerse overlay gösterir:

```txt
Beraber izlemeye başlamak için oynat'a bas.
```

---

# 31. Autoplay engeli

Bazı tarayıcılar kullanıcı etkileşimi olmadan autoplay’e izin vermeyebilir.

Buna uygun UI olmalı.

Eğer `playVideo()` başarısız olur veya player oynamazsa overlay göster:

```txt
Video hazır. Oda ile beraber izlemeye başlamak için tıkla.
```

Buton:

```txt
Oynat ve senkronize ol
```

Butona basınca:

1. sync request gönder
2. target time al
3. seekTo target
4. playVideo

---

# 32. Proje aşamaları

Projeyi aşağıdaki aşamalarla geliştir.

---

## Aşama 0 — Repo ve temel yapı

Amaç: Monorepo yapısını kur.

Yapılacaklar:

1. Root repo oluştur.
2. `client` ve `server` klasörlerini oluştur.
3. TypeScript ayarlarını yap.
4. ESLint/Prettier ayarla.
5. `.env.example` oluştur.
6. README başlangıcı yaz.
7. Git ignore ekle.

Önerilen root yapı:

```txt
you-together/
  client/
  server/
  docker-compose.yml
  docker-compose.dev.yml
  README.md
  .env.example
  .gitignore
```

---

## Aşama 1 — Backend temel kurulumu

Amaç: Fastify + Socket.IO + Redis bağlantısı.

Yapılacaklar:

1. Server package oluştur.
2. Fastify kur.
3. Socket.IO kur.
4. Redis client kur.
5. Config sistemi oluştur.
6. `/health` endpoint’i ekle.
7. Socket connection logla.
8. Redis bağlantı health check ekle.

Başarı kriteri:

* Server ayağa kalkıyor.
* `/health` OK dönüyor.
* Socket client bağlanabiliyor.
* Redis bağlantısı çalışıyor.

---

## Aşama 2 — Frontend temel kurulumu

Amaç: React app ve temel tasarım.

Yapılacaklar:

1. Vite React TypeScript projesi kur.
2. Tailwind kur.
3. Global dark red glowing theme ekle.
4. Router kur.
5. HomePage oluştur.
6. RoomPage oluştur.
7. Socket.IO client bağlantısı kur.
8. Basit layout oluştur.

Başarı kriteri:

* Ana sayfa açılıyor.
* Dark/red tema görünüyor.
* Socket backend’e bağlanıyor.
* Route geçişleri çalışıyor.

---

## Aşama 3 — Oda oluşturma

Amaç: Kullanıcı oda oluşturabilsin.

Yapılacaklar:

1. CreateRoomModal oluştur.
2. Oda adı, PIN, display name inputları ekle.
3. Backend `room:create` event handler yaz.
4. Oda ID üret.
5. PIN hashle.
6. Room record Redis’e yaz.
7. User record oluştur.
8. Socket’i room’a join et.
9. Client’a room created response dön.
10. Share URL oluştur.
11. Oda oluşturulunca RoomPage’e yönlendir.

Başarı kriteri:

* Kullanıcı oda oluşturabiliyor.
* Oda Redis’te görünüyor.
* Kullanıcı owner oluyor.
* Link kopyalanabiliyor.

---

## Aşama 4 — Oda listeleme

Amaç: Ana sayfada aktif odalar görünsün.

Yapılacaklar:

1. Backend public room list endpoint/event oluştur.
2. Redis’ten aktif odaları oku.
3. PIN bilgisini asla public dönme.
4. Frontend RoomCard component’i oluştur.
5. Eğer oda yoksa boş mesaj göster.
6. Oda varsa kartları göster.
7. Socket ile room list update yayınla.

Başarı kriteri:

* Oda yokken doğru boş mesaj görünüyor.
* Oda oluşturulunca ana sayfadaki liste güncelleniyor.
* Oda kartında kişi sayısı görünüyor.

---

## Aşama 5 — PIN ile odaya katılma

Amaç: Kullanıcı oda kartından veya linkten PIN ile katılabilsin.

Yapılacaklar:

1. JoinRoomModal oluştur.
2. RoomPage’de join gate oluştur.
3. Backend `room:join` handler yaz.
4. PIN hash compare yap.
5. Oda doluluk kontrolü yap.
6. Kullanıcıyı room users listesine ekle.
7. Chat history dön.
8. Playback state dön.
9. User list update yayınla.

Başarı kriteri:

* Doğru PIN ile katılım oluyor.
* Yanlış PIN hata veriyor.
* Oda doluysa hata veriyor.
* Linkten gelen kullanıcı aynı PIN ekranını görüyor.

---

## Aşama 6 — YouTube player entegrasyonu

Amaç: Oda içinde YouTube embed player çalışsın.

Yapılacaklar:

1. YouTube IFrame API loader yaz.
2. YouTubePlayer component’i oluştur.
3. Player ready event yakala.
4. Player state change event yakala.
5. `getCurrentTime`, `seekTo`, `playVideo`, `pauseVideo` wrapper’ları yaz.
6. Video ID değişince player’ı güncelle.
7. YouTube error event’lerini yakala.
8. Embed edilemeyen video için hata göster.

Başarı kriteri:

* Video embed olarak açılıyor.
* Player hazır olunca client bunu biliyor.
* Video değiştirilebiliyor.
* Player state okunabiliyor.

---

## Aşama 7 — Admin video değiştirme

Amaç: Admin YouTube linki yapıştırınca video odadaki herkeste değişsin.

Yapılacaklar:

1. VideoInputBar component’i oluştur.
2. Sadece admin/owner görsün.
3. Backend `video:change` handler yaz.
4. Yetki kontrolü yap.
5. YouTube video ID parse et.
6. Oda playback state’i sıfırla.
7. Tüm odaya `video:changed` yayınla.
8. Client’lar yeni video ID ile player’ı güncellesin.

Başarı kriteri:

* Admin video değiştirebiliyor.
* Normal member video input görmüyor veya event reddediliyor.
* Video değişince herkesin ekranında değişiyor.

---

## Aşama 8 — Play/pause sync

Amaç: Bir kullanıcı play/pause yaptığında herkeste aynı olsun.

Yapılacaklar:

1. Client player state change yakalasın.
2. `applyingRemoteUpdate` flag ekle.
3. Local play olduğunda `playback:play` gönder.
4. Local pause olduğunda `playback:pause` gönder.
5. Server oda playback state’ini güncellesin.
6. Server tüm odaya playback state yayınlasın.
7. Client remote state’i uygulasın.
8. Remote update loop engellensin.

Başarı kriteri:

* Bir kullanıcı pause yapınca herkes pause olur.
* Bir kullanıcı play yapınca herkes play olur.
* Sonsuz event loop oluşmaz.
* 2 kullanıcı aynı anda tıklarsa son server version kazanır.

---

## Aşama 9 — Seek ve drift sync

Amaç: Video zamanı kayınca tekrar oda zamanına gelsin.

Yapılacaklar:

1. Client local time watcher yaz.
2. Ani sıçramaları seek olarak algıla.
3. `playback:seek` event gönder.
4. Server baseTime/baseServerTime güncellesin.
5. Periyodik drift kontrolü yaz.
6. 2 saniyede bir expected room time hesapla.
7. Drift > 2.5 saniye ise seekTo uygula.
8. Drift > 7 saniye ise toast göster.
9. SyncBadge component’i oluştur.

Başarı kriteri:

* Kullanıcı seek yapınca diğerleri yakın zamana gelir.
* Yeni katılan kullanıcı doğru zamana gelir.
* Küçük 1-2 saniyelik farklar sürekli rahatsız etmez.
* Büyük farklarda otomatik düzeltme yapılır.

---

## Aşama 10 — Initial sync

Amaç: Yeni katılan kullanıcı, video yüklenince güncel oda zamanından başlasın.

Yapılacaklar:

1. `client:player-ready` event’i gönder.
2. Server target time hesaplasın.
3. Server `sync:command` göndersin.
4. Client önce video hazır mı kontrol etsin.
5. Sonra seekTo targetTime yapsın.
6. Oda playing ise playVideo denesin.
7. Autoplay engellenirse overlay göster.
8. Kullanıcı overlay’e basınca tekrar sync olup oynatsın.

Başarı kriteri:

* Yeni kullanıcı video yüklendikten sonra güncel zamana gelir.
* Yavaş yüklenen client eski zamana takılı kalmaz.
* Autoplay engeli kullanıcı dostu şekilde çözülür.

---

## Aşama 11 — Chat

Amaç: Oda içi mesajlaşma.

Yapılacaklar:

1. ChatPanel oluştur.
2. ChatInput oluştur.
3. Message list oluştur.
4. Backend `chat:message` handler yaz.
5. Mesaj validate et.
6. Redis chat list’e ekle.
7. Son 100 mesajı tut.
8. Tüm odaya mesaj yayınla.
9. Join sırasında chat history gönder.

Başarı kriteri:

* Kullanıcılar mesaj yazabiliyor.
* Mesajlar real-time düşüyor.
* Yeni giren kullanıcı son mesajları görüyor.
* Boş/çok uzun mesaj engelleniyor.

---

## Aşama 12 — Kullanıcı listesi ve admin yönetimi

Amaç: Odadaki kullanıcılar, roller ve admin verme/alma çalışsın.

Yapılacaklar:

1. UserList component’i oluştur.
2. UserBadge component’i oluştur.
3. Owner/admin/member badge göster.
4. Owner için admin controls göster.
5. Backend `admin:grant` yaz.
6. Backend `admin:revoke` yaz.
7. Yetki kontrolü yap.
8. User list update yayınla.

Başarı kriteri:

* Owner başka kullanıcıyı admin yapabiliyor.
* Owner adminliği alabiliyor.
* Admin video değiştirebiliyor.
* Member video değiştiremiyor.

---

## Aşama 13 — Disconnect ve oda temizliği

Amaç: Kullanıcı çıkınca sistem düzgün güncellensin.

Yapılacaklar:

1. Socket disconnect handler yaz.
2. Kullanıcıyı odadan çıkar.
3. User list yayınla.
4. Sistem mesajı gönder.
5. Owner çıktıysa ownership transfer yap.
6. Oda boşsa TTL’i 5 dakikaya düşür.
7. Aktif odalar listesini güncelle.

Başarı kriteri:

* Kullanıcı sekmeyi kapatınca listeden düşüyor.
* Owner çıkarsa yeni owner atanıyor.
* Oda boşalınca bir süre sonra listeden kalkıyor.

---

## Aşama 14 — Polish ve hata durumları

Amaç: Kullanıcı deneyimini toparla.

Yapılacaklar:

1. Toast sistemi ekle.
2. Loading state’leri ekle.
3. Error state’leri ekle.
4. Empty room state’i güzelleştir.
5. Oda bulunamadı ekranı ekle.
6. Oda dolu ekranı ekle.
7. Yanlış PIN mesajı ekle.
8. Video embed error mesajı ekle.
9. Mobile responsive düzenle.
10. Chat scroll davranışını düzelt.
11. Copy link butonu ekle.

Başarı kriteri:

* Uygulama teknik hata gibi görünmüyor.
* Kullanıcı ne olduğunu anlıyor.
* Mobilde temel kullanım mümkün.

---

## Aşama 15 — Docker ve self-hosted kurulum

Amaç: Proje tek komutla çalıştırılabilir olsun.

Yapılacaklar:

1. Server Dockerfile yaz.
2. Client build’i server ile servis edilebilir hâle getir veya ayrı container yap.
3. Redis container ekle.
4. docker-compose.yml yaz.
5. `.env.example` yaz.
6. Healthcheck ekle.
7. README’ye kurulum adımları yaz.

Basit deployment hedefi:

```bash
docker compose up -d
```

README’de yer alacaklar:

```txt
1. Repo clone
2. .env dosyasını oluştur
3. docker compose up -d
4. Uygulamayı aç
```

---

# 33. Önerilen environment variables

```env
NODE_ENV=production
PORT=3000
REDIS_URL=redis://redis:6379
PUBLIC_BASE_URL=http://localhost:3000
ROOM_MAX_USERS=10
ROOM_ACTIVE_TTL_SECONDS=10800
ROOM_EMPTY_TTL_SECONDS=300
CHAT_MAX_MESSAGES=100
PIN_MIN_LENGTH=4
PIN_MAX_LENGTH=12
```

Frontend için:

```env
VITE_SOCKET_URL=http://localhost:3000
```

Prod’da aynı domain kullanılacaksa ayrıca gerek olmayabilir.

---

# 34. Test planı

Minimum test senaryoları:

## Room tests

* Oda oluşturulabiliyor.
* PIN yanlışsa katılım reddediliyor.
* PIN doğruysa katılım başarılı.
* Oda doluyken 11. kullanıcı alınmıyor.
* Oda boşalınca TTL başlıyor.

## Playback tests

* Play event herkese gidiyor.
* Pause event herkese gidiyor.
* Seek event herkese gidiyor.
* State version artıyor.
* Yeni kullanıcı doğru target time alıyor.
* Remote update loop oluşmuyor.

## Permission tests

* Member video değiştiremiyor.
* Admin video değiştirebiliyor.
* Owner admin verebiliyor.
* Admin owner yetkisi kullanamıyor.

## Chat tests

* Mesaj gönderiliyor.
* Boş mesaj reddediliyor.
* Çok uzun mesaj reddediliyor.
* Join sırasında chat history geliyor.

## UI tests

* Oda yokken boş mesaj çıkıyor.
* Oda kartları görünüyor.
* PIN modal çalışıyor.
* Share link kopyalanıyor.
* Embed error gösteriliyor.

---

# 35. İlk sürümde bilinçli olarak yapılmayacaklar

Bu özellikleri ilk sürüme ekleme:

* Kullanıcı hesabı
* Şifreli üyelik sistemi
* Profil fotoğrafı
* Kalıcı oda geçmişi
* Kalıcı chat geçmişi
* YouTube arama
* Playlist sistemi
* Queue sistemi
* Voice chat
* Video chat
* Moderasyon paneli
* Çoklu backend node scaling
* PostgreSQL
* MongoDB
* OAuth
* Google login
* Public discovery gelişmiş filtreleri

Bunlar sonraki sürüme bırakılabilir.

---

# 36. Son hedef

İlk sürüm tamamlandığında kullanıcı şunu yapabilmeli:

1. Siteye girer.
2. Oda yoksa boş mesajı görür.
3. Oda oluşturur.
4. Oda adı, PIN ve kendi adını girer.
5. Oda linkini kopyalar.
6. Arkadaşına linki yollar.
7. Arkadaşı linke tıklar.
8. PIN ve ad girer.
9. Odaya katılır.
10. Admin YouTube linki yapıştırır.
11. Video herkesin ekranında açılır.
12. Herhangi biri play/pause/seek yaptığında diğerlerinde de olur.
13. 2-3 saniyelik küçük farklar tolere edilir.
14. Büyük farklarda client otomatik oda zamanına döner.
15. Sağ tarafta chat yapılır.
16. Owner başka kullanıcıyı admin yapabilir.
17. Adminler yeni video linki girebilir.
18. Oda boşalınca sistem otomatik temizlenir.
19. Proje Docker Compose ile self-hosted çalışır.

---

# 37. Genel geliştirme ilkeleri

Kod yazarken şu ilkelere uy:

* TypeScript strict kullan.
* Payload validation yap.
* Socket event isimlerini merkezi dosyada tut.
* Backend room logic’i component içine değil service katmanına koy.
* Frontend player logic’i ayrı hook içinde tut.
* UI component’lerini tekrar kullanılabilir yap.
* Redis key üretimini merkezi helper ile yap.
* PIN’i plaintext saklama.
* Room public response içinde PIN hash gösterme.
* Socket listener cleanup yap.
* Event loop engellemek için `applyingRemoteUpdate` kullan.
* Gereksiz overengineering yapma.
* MVP dışı özellik ekleme.
* Kodun çalışır, okunabilir ve self-hosted olmasına öncelik ver.

---

# 38. Nihai kısa özet

You Together; React, TypeScript, Node.js, Fastify, Socket.IO ve Redis ile geliştirilecek, self-hosted çalışacak, YouTube embed üzerinden watch party deneyimi sunan bir web uygulamasıdır.

Kullanıcı hesabı yoktur. Odalar geçicidir. PIN ile girilir. Oda linki paylaşılabilir. Maksimum 10 kişi vardır. Herkes play/pause/seek yapabilir. Adminler video değiştirebilir. Owner admin yönetebilir. Chat vardır. Sync server’daki playback state üzerinden yapılır. Client’lar 2 saniyede bir drift kontrolü yapar ve gerekirse YouTube player’ı oda zamanına çeker.

Tema dark, glowing red ve YouTube hissiyatında olacaktır.

İlk hedef, küçük kullanıcı kitlesi için temiz çalışan, kolay kurulabilir, Docker Compose ile ayağa kalkabilen MVP geliştirmektir.
