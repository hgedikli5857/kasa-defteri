# Kasa Defteri — Kurulum Rehberi

Gelir, gider, banka hesapları, cariler, vadeler ve nakit akışını tek yerden yöneten, telefona yüklenebilen web uygulaması (PWA).

- **Giriş:** Google hesabı (Firebase Authentication)
- **Veri:** Firebase Firestore. Tüm cihazlarda anlık senkron, internet yokken de çalışır.
- **Yedek:** Google Drive'daki `Kasa Defteri Yedek/kasa-defteri-veri.json` dosyası (otomatik)
- **Yayın:** GitHub Pages → `https://hgedikli5857.github.io/kasa-defteri/`

Toplam süre: **yaklaşık 30 dakika**. Hepsi ücretsiz.

---

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html` | Uygulamanın sayfası |
| `app.js` | Uygulamanın tüm mantığı |
| `styles.css` | Görünüm |
| `firebase-config.js` | **Senin dolduracağın** Firebase ayarları |
| `firestore.rules` | Veritabanı güvenlik kuralları (Firebase'e yapıştırılacak) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Telefona yüklenebilme ve internetsiz çalışma |

> `firebase-config.js` doldurulmadan açarsan uygulama **deneme modunda** çalışır: örnek verilerle dener, kayıtları yalnızca o cihazda tutar.

---

## ADIM 1 — Firebase projesi (≈15 dk)

### 1.1 Projeyi oluştur
1. **console.firebase.google.com** adresine Google hesabınla gir.
2. **Proje oluştur** → ad: `kasa-defteri` → Devam.
3. Google Analytics: **kapalı** bırak → **Proje oluştur**.

### 1.2 Web uygulamasını ekle ve ayarları al
1. Proje ana sayfasında **`</>`** (Web) simgesine tıkla.
2. Uygulama takma adı: `Kasa Defteri`. "Firebase Hosting" kutusunu **işaretleme** → **Uygulamayı kaydet**.
3. Ekranda `const firebaseConfig = { ... }` görünecek. İçindeki 6 değeri kopyala.
4. `firebase-config.js` dosyasını aç ve aynı alanlara yapıştır:
   ```js
   export const firebaseConfig = {
     apiKey: "AIza....",
     authDomain: "kasa-defteri-xxxx.firebaseapp.com",
     projectId: "kasa-defteri-xxxx",
     storageBucket: "kasa-defteri-xxxx.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcd..."
   };
   ```
   > Bu değerler gizli değildir. Herkes görebilir; verini **Firestore kuralları** korur (Adım 1.4).

### 1.3 Google ile girişi aç
1. Sol menü → **Derleme (Build) → Authentication** → **Başlayın**.
2. **Oturum açma yöntemi** sekmesi → **Google** → **Etkinleştir**.
3. "Proje destek e-postası" olarak kendi Gmail adresini seç → **Kaydet**.
4. **Ayarlar** sekmesi → **Yetkili alan adları** → **Alan adı ekle** → `hgedikli5857.github.io` → **Ekle**.

### 1.4 Veritabanını oluştur ve kilitle
1. Sol menü → **Derleme → Firestore Database** → **Veritabanı oluştur**.
2. Konum: **eur3 (Europe)** veya **europe-west** seç (Türkiye'ye en yakın).
3. **Üretim modunda başlat** → **Oluştur**.
4. Üstteki **Kurallar** sekmesine geç. Oradaki her şeyi sil, `firestore.rules` dosyasının **tamamını** yapıştır → **Yayınla**.

> ⚠️ Bu adımı atlama. Kurallar herkesin yalnızca kendi verisini görmesini sağlar.

### 1.5 Google Drive yedeğini aç
1. **console.cloud.google.com** → üstte proje olarak `kasa-defteri-xxxx` seçili olsun (Firebase projesiyle aynıdır).
2. **API'ler ve Hizmetler → Kitaplık** → "**Google Drive API**" ara → **Etkinleştir**.
3. **API'ler ve Hizmetler → OAuth izin ekranı** (yeni arayüzde **Google Auth Platform**):
   - **Kitle (Audience)** bölümünde yayın durumu **"Test ediliyor"** ise **Uygulamayı yayınla** de. Ya da **Test kullanıcıları**na kendi Gmail adresini ekle.
   - Uygulama yalnızca kendi oluşturduğu Drive dosyalarına eriştiği (`drive.file`) için Google doğrulaması gerekmez.

---

## ADIM 2 — GitHub'a yükle (≈10 dk)

### Yol A: Tarayıcıdan yükleme (en kolayı)
1. **github.com/new** → Repository name: `kasa-defteri` → **Public** → **Create repository**.
2. Açılan sayfada **"uploading an existing file"** bağlantısına tıkla.
3. Bu klasördeki **tüm dosyaları ve `icons` klasörünü** sürükle-bırak yap. (`firebase-config.js` doldurulmuş olmalı.)
4. **Commit changes**.

### Yol B: Claude'a yükletme
Repoyu oluşturduktan sonra Claude'un GitHub uygulamasına bu repoya erişim ver: GitHub → **Settings → Applications → Installed GitHub Apps → Claude → Configure → Repository access** → `kasa-defteri` ekle → Save. Sonra Claude'a "yükle" demen yeterli.

---

## ADIM 3 — GitHub Pages'te yayınla (≈2 dk)

1. Repo sayfasında **Settings → Pages**.
2. **Source:** `Deploy from a branch` → Branch: **`main`**, klasör: **`/ (root)`** → **Save**.
3. 1–2 dakika bekle. Adres: **https://hgedikli5857.github.io/kasa-defteri/**

---

## İlk açılış ve kontrol listesi

1. Adresi aç → **Google ile giriş yap** → hesabını seç. Drive izni istendiğinde **izin ver**.
2. Boş defter ekranı gelir. Seçenekler:
   - **Yedek dosyasından yükle:** Claude'daki Kasa Defteri'nin verilerini taşımak için. Önce Drive'ındaki **Kasa Defteri** klasöründen `kasa-defteri-veri.json` dosyasını indir, sonra bunu seç.
   - **Örnek verilerle dene** ya da **İlk hesabını ekle.**
3. Başlıkta şunları gör:
   - **"Canlı senkron"** etiketi
   - Bir değişiklik yaptıktan 5 saniye sonra **"Drive · saat"** etiketi
4. **Telefona yükle:** Android'de Chrome ile adresi aç → menü (⋮) → **Uygulamayı yükle** veya **Ana ekrana ekle**. Uygulama içinde **Yükle** düğmesi de çıkar.

---

## Banka ekstresi içe aktarma

Banka hareketlerini tek tek yazmak yerine:
1. İnternet/mobil bankacılıktan **Hesap hareketleri → İndir** ile **PDF, Excel ya da CSV** al. Şifreli e-ekstre PDF'lerinde şifre sorulur (kaydedilmez). Taranmış/fotoğraf PDF'ler okunamaz.
2. Kasa Defteri → **İşlemler → ⇣ Ekstre içe aktar** → hesabı seç → dosyayı seç.
3. Uygulama tarih, açıklama ve tutar sütunlarını kendisi bulur; bulamazsa "Sütun eşleştirme"den bir kez seç (o banka için hatırlanır).
4. Listede kategorileri kontrol et → **N işlemi ekle**.

- **Kredi kartı:** Kart ekstresini *kredi kartı* türündeki hesaba yükle; harcamalar otomatik gider olarak çevrilir, karta yapılan ödemeler gelir sayılmaz (bankadan karta transfer olarak gir).
- Daha önce eklenen hareketler **"zaten eklendi"** olarak işaretlenir, tekrar eklenmez.
- Dosyada bakiye sütunu varsa, uygulamadaki bakiye bankayla karşılaştırılır; istersen açılış bakiyesi düzeltilerek eşitlenir.
- Bir satırın kategorisini değiştirince benzer açıklamalı satırlar da değişir; uygulama sonraki ekstrelerde bunu hatırlar.

## Kredi kartı özeti
Kart hesabını düzenle (veya ekstre içe aktarırken) şu dört alanı bankanın uygulamasından bakarak doldur: **Toplam limit**, **Kullanılabilir limit**, **Dönem içi harcamalar**, **Hesap kesim günü**.
Özet ve Hesaplar ekranında banka uygulamasındaki gibi görünür: kullanılabilir limit, dönem içi harcamalar, toplam borç, önceki dönem/taksit farkı ve dönem tarihleri. Sonra eklediğin harcamalar iki rakama da otomatik yansır; kesim gününde dönem harcaması sıfırlanır.

## Döviz, altın ve gümüş hesapları
Hesap eklerken **Para / varlık cinsi** seç: TL, USD, EUR, GBP, CHF, SAR; gram altın (24 ayar), 22 ayar bilezik, 18/14 ayar (gr); çeyrek, yarım, tam, cumhuriyet, ata, reşat, gremse (adet); gümüş (gr).
- Bakiye kendi biriminde tutulur, TL karşılığı canlı kurla (Truncgil Finans, alış fiyatı) hesaplanır. Başlıktaki **Kurlar** düğmesinden kuyumcu fiyatını elle girebilirsin.
- Altın/döviz alımı: TL hesabından altın hesabına **Transfer** yap; "Giriş miktarı"nı (ör. 2 gr) yaz, birim fiyat gösterilir.
- Döviz/altın hesabına gelir-gider girerken o günkü kur işleme kaydedilir; raporlar TL karşılığıyla hesaplanır.

## Kategoriler ve alt kategoriler
**Raporlar → Kategoriler** (ya da işlem formundaki "Kategorileri düzenle"): kategori ekle, adını değiştir (eski işlemler de güncellenir), sil; alt kategori ekle (ör. Faturalar → Elektrik). İşlem formunda "＋ Yeni kategori…" ile anında da eklenebilir.

## Harcama analizi (Özet)
Bu ay / geçen ay / son 3 ay için giderler kategoriye göre gruplanır. En yüksek kalem kırmızı, sonrakiler turuncu-amber gösterilir; önceki döneme göre artış/azalış, gelir-gider dengesi, yeni harcama kalemleri ve en çok harcanan yerler için uyarılar üretilir.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Bu adres Firebase'de yetkili değil" | Adım 1.3/4: `hgedikli5857.github.io` yetkili alan adlarına eklenmeli |
| "Google ile giriş Firebase'de açık değil" | Adım 1.3/2: Google sağlayıcısını etkinleştir |
| "Bu işlem için yetkin yok" | Adım 1.4/4: Kurallar yayınlanmamış veya eksik yapıştırılmış |
| Drive etiketi "izin gerekli" | Normal. Google Drive iznini güvenlik için 1 saatte bir yeniletiyor. Etikete dokun → **Drive iznini yenile ve kaydet** |
| Drive "erişim reddedildi" | Adım 1.5/2: Google Drive API etkin değil |
| Değişiklik yaptım ama telefonda eski sürüm açılıyor | `sw.js` içindeki `VERSION` değerini artır (`kd-v2`), dosyayı yeniden yükle, uygulamayı iki kez kapat-aç |
| Sayfa beyaz kalıyor | Tarayıcıda sayfayı yenile; olmazsa `firebase-config.js` içinde tırnak/virgül hatası olabilir |

---

## Güvenlik notları
- Verin Firestore'da `users/<senin-kimliğin>/...` altında durur. Kurallar başka kimsenin okumasına izin vermez.
- Drive izni `drive.file` kapsamındadır: uygulama Drive'ındaki **diğer dosyaları göremez**, sadece kendi oluşturduğu yedek dosyasına erişir.
- Firebase'in ücretsiz planı (günlük 50.000 okuma / 20.000 yazma) kişisel kullanım için fazlasıyla yeterli.
