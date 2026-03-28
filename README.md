# Shopify Tools

Mağazaya özel mini araç seti. Genişletilebilir yapı — her yeni özellik sol sidebar'a yeni bir menü öğesi olarak eklenir.

## Özellikler

### ₺ Fiyat Yuvarlama
- Ürün fiyatı ve karşılaştırma fiyatını tam sayıya yukarı yuvarlar (₺2.374 → ₺2.400)
- Etiket filtresi (opsiyonel)
- Durum filtresi: Aktif / Arşiv / Taslak / Tümü
- Önizleme tablosu ile değişiklikleri görmek mümkün
- Toplu güncelleme, rate-limit korumalı

## Kurulum

```bash
npm install
cp .env.example .env.local   # kendi değerlerini ekle
```

## Geliştirme (local)

Shopify credentials gerektirir:

```env
SHOPIFY_STORE_DOMAIN=my-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxx
```

```bash
npm run dev   # netlify dev üzerinden çalışır (port 8888)
```

## Deploy – Netlify

1. Bu repo'yu GitHub'a push edin
2. Netlify'da yeni site oluşturun → GitHub repoyu bağlayın
3. **Site settings → Environment variables** kısmına şunları ekleyin:

| Key | Value |
|-----|-------|
| `SHOPIFY_STORE_DOMAIN` | `my-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | `shpat_xxxx` |
| `SHOPIFY_CLIENT_ID` | opsiyonel |
| `SHOPIFY_CLIENT_SECRET` | opsiyonel |

4. Deploy alın — `netlify.toml` otomatik olarak yapılandırılmıştır.

## Shopify Access Token Nasıl Alınır?

1. Shopify Admin → **Settings → Apps and sales channels → Develop apps**
2. **Create an app** — isim verin
3. **Configure Admin API scopes** altında şunları seçin:
   - `read_products`
   - `write_products`
4. **Install app** → **Admin API access token** kısmından token'ı kopyalayın

## Proje Yapısı

```
├── netlify/
│   └── functions/
│       ├── get-products.ts   ← Shopify'dan ürün çeker
│       └── round-prices.ts   ← Fiyatları yuvarlar ve günceller
├── src/
│   ├── pages/
│   │   └── PriceRounder.tsx  ← Ana araç sayfası
│   ├── components/
│   │   └── Toast.tsx
│   ├── App.tsx               ← Layout + sidebar
│   ├── main.tsx
│   └── index.css             ← Design system
├── netlify.toml
└── .env.example
```
