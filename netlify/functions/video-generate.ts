import type { Handler } from '@netlify/functions'
import https from 'https'

const FAL_KEY = process.env.FAL_KEY || ''
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_KEY = process.env.GEMINI_API_KEY || ''
const OPENAI_KEY = process.env.OPENAI_API_KEY || ''

// ═══════════ HTTP Helper ═══════════
function httpsRequest(options: https.RequestOptions, payload?: string): Promise<{ status: number; body: string; headers?: Record<string, string | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ status: res.statusCode, body: '', headers: { location: res.headers.location as string } })
        res.resume()
        return
      }
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode || 500, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(55000, () => { req.destroy(); reject(new Error('Request timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// ═══════════ PROMPT STRUCTURE TEMPLATE ═══════════
// Every prompt MUST follow this structure for consistency
const PROMPT_STRUCTURE = `
PROMPT FORMATI — BU YAPIYA KESINLIKLE UY:
Urettigin prompt su 7 bolumu SIRASIYLA icermeli (basliklari YAZMA, sadece icerigi yaz, tek paragraf halinde akici bir prompt olsun):

1. FORMAT & SURE: "Dikey 9:16, X saniye." ile basla
2. HOOK KARESI (ilk 0.5 saniye): Videonun ilk karesinde ne gorulecek? Bu kare scroll'u durdurmali. Spesifik ol — hangi gorsel ogeyle aciliyor?
3. SAHNE & ORTAM: Nerede geciyor? Isik kurulumu nasil? Renk sicakligi, golge yonu, ortam detaylari
4. URUN DETAYI: Giysi/urunun rengi, kumasi, kesimi, deseni, ozel detaylari (dugme, fermuar, islemeler). Kumas isikla nasil etkilesiyor?
5. HAREKET KOREOGRAFISI: Kim/ne hareket ediyor? Kamera hareketi (dolly, pan, tracking, handheld)? Kumas fizigi (dalganma, parlama, dokunma)?
6. RENK GRADING & MOOD: Sicak/soguk tonlar, kontrast, lifted blacks, Instagram filtresi hissi — spesifik tarif et
7. SON KARE: Video nasil bitiyor? Son karede ne gorulecek?

ONEMLI KURALLAR:
- TURKCE yaz, Ingilizce kelime KULLANMA
- Tek paragraf, akici, sinematik dilde yaz
- Teknik sinema terimleri kullanabilirsin ama Turkce acikla
- Prompt 80-150 kelime arasi olmali — ne cok kisa ne cok uzun
- SADECE prompt metnini yaz, baslik/aciklama/numara YAZMA`

// ═══════════ Video Ad Modes — Higgsfield-Quality Presets ═══════════
interface ModePrompts {
  base: string
  kling?: string
  veo?: string
  sora?: string
  minimax?: string
}

const VIDEO_MODE_PROMPTS: Record<string, ModePrompts> = {
  'simple-ugc': {
    base: `Sen kadin giyim e-ticaret icin Meta Andromeda uyumlu UGC tarzi video reklam yonetmenisin.
SIMPLE UGC modu: Otantik, telefon cekimi havasi, dogal ve samimi.

ZORUNLU OGELER:
- Elde tutulan telefon kamerasi — hafif dogal titreme (stabilize DEGIL)
- Dogal ic mekan/dis mekan isigi (pencere isigi, golden hour — studio DEGIL)
- Gunluk poz: kiyafeti duzeltme, aynaya bakma, hizli don, selfie acisi
- Gercek ortam: yatak odasi, soyunma kabini, kafe, sokak
- HOOK: Ilk 0.5 saniyede urun aninda gorulmeli — yavas giris YOK
- Sicak renk grading, hafif lifted blacks, Instagram UGC estetigi
- Kumas hareketi dogal olmali — her harekette kumas tepki vermeli
- Son kare: ozguvenli bir an (gulums, kameraya bakis, begenme ifadesi)`,
    kling: `Kling icin: Tek net hareket odakli prompt yaz. "Manken aynada kravatini duzeltiyor, hizla donerek etegin ucusunu gosteriyor" gibi. Basit fiziksel aksiyonlar. Karmasik kamera hareketi KULLANMA.`,
    veo: `Veo icin: Sahneyi sinematik ama UGC dokusunda tarif et. "Telefon kamerasi", "dogal ortam isigi", "hafif elde tutulan titreme" ifadelerini kullan. Ortam detaylarini tarif et — odanin icindekiler, isik kaynaklari.`,
    sora: `Sora icin: Kumas fizigine ve dogal harekete odaklan. Kisi tarifi YAPMA — "manken" de, fiziksel ozellik BELIRTME. Sadece giysi, kumas, isik ve ortam tarif et.`,
    minimax: `MiniMax icin: Kisa ve net prompt yaz. Ana aksiyonu ve ortami tarif et. MiniMax prompt optimizer'i kullanacak, cok detaya girme.`,
  },

  'clean-minimal': {
    base: `Sen kadin giyim e-ticaret icin minimalist urun video yonetmenisin.
CLEAN MINIMAL modu: Beyaz/notr arka plan, urun odakli, modern ve temiz.

ZORUNLU OGELER:
- Saf beyaz veya yumusak krem cyclorama arka plan
- Tek dramatik golge, net yonlu isik (softbox veya pencere)
- Yavas, kontrol hareket: nazik donus, hafif yuzme, kumas sallantisi
- Negatif alan vurgusu — urun karenin %60-70'ini kaplamali
- Urune keskin fokus, arka plan yumusak
- HOOK: Ilk 0.5 saniyede urun zaten karede, aninda gorsel netlik
- High-key aydinlatma, desature palet
- Kumas detayi: isikla etkilesimi, dokunun gorsel hissi
- Son kare: urun tam merkezde, mukemmel kompozisyon`,
    kling: `Kling icin: Minimal hareket anahtar kelimeleri kullan. "Yavas donus", "nazik suzulme", "ince kumas sallantisi". Temiz cikis icin "beyaz studio arka plan, tek golge" belirt.`,
    veo: `Veo icin: "Sonsuz beyaz cyclorama", "sag ustten softbox isik", "urun karede ortalanmis" gibi studio detaylari ver. Golge yonu ve yogunlugu hakkinda spesifik ol.`,
    sora: `Sora icin: Urunun fiziksel hareketini tarif et. "Giysi gorunmez platformda yavasca donuyor, kumas havay hafifce yakalyor" gibi. Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Beyaz arka plan, urun yavasca donuyor, temiz studio isigi" gibi kisa ve oз prompt yaz.`,
  },

  'luxury': {
    base: `Sen luks moda e-ticaret icin sinematik video yonetmenisin.
LUXURY modu: Dramatik, sinematik, aspirasyonel, premium his.

ZORUNLU OGELER:
- Zengin dramatik aydinlatma: Rembrandt, kelebek veya rim isik
- Karanlik, ruh halini yansitan arka plan, urun uzerinde secici aydinlatma
- Agir cekim kumas hareketi: ipek akisi, kasmir dokusu, saten parlamasi
- Dolly-in veya yavas push kamera hareketi urune dogru
- Alan derinligi: jilet gibi ince fokus urun detaylarinda
- Altin/sicak vurgular, derin golge kontrasti
- HOOK: Ilk 0.5 saniyede isik suzmesiyle dramatik reveal
- Premium malzeme hissi: parlaklk, isiltii, doku derinligi
- Son kare: urunun en luks acisindan yakin cekim, isik yansimasi
- Renk grading: derin siyahlar, sicak altinsi vurgular, sinematik kontrast`,
    kling: `Kling icin: Dramatik isik anahtar kelimeleri vurgula: "sinematik rim isik", "chiaroscuro", "karanlik luks studio". "Agir cekim", "dramatik reveal" kullan.`,
    veo: `Veo icin: Tam sinematik kurulumu tarif et: "45 dereceden Arri tarzi key light", "golge tarafinda negatif fill", "yavas dolly push". Veo sinematik dilde cok basarili.`,
    sora: `Sora icin: Malzeme fizigine odaklan: "ipek agir cekimde duserken isigi yakaliyor", "kumas gerginligi ve birakilis". Kisi tarifi YAPMA, sadece urun ve isik.`,
    minimax: `MiniMax icin: "Karanlik studio, dramatik isik, urun agir cekimde gosteriliyor" gibi net luks atmosfer tarifi yaz.`,
  },

  'product-story': {
    base: `Sen moda e-ticaret icin urun hikayesi anlatan video yonetmenisin.
PRODUCT STORY modu: Duz urunden giyilmis haline gecis, mini hikaye arki.

ZORUNLU OGELER:
- Acilis: urun guzelce katlanmis veya duz yayilmis (flat-lay)
- Gecis: eller alip aciyor/kaldiriyor, kumas aciliyor
- Reveal: urun havada tutulus, giyilmis veya stilize edilmis hali
- Duygusal an: ozguven ani, kumasa dokunma, begenme
- Kamera hikayeyi takip eder: ustten baslar, goz hizasina gelir
- Sicak, editorial renk grading
- HOOK: Ilk 0.5 saniyede guzel flat-lay kompozisyonu
- Dokunsal odak: parmaklar kumasa dokunuyor, dugmelere, detaylara
- Son kare: urunun en etkileyici hali — giyilmis veya stilize
- Kumas fizigi: acilirken, kalkarken dogal hareket etmeli`,
    kling: `Kling icin: Hikayeyi basit ve aksiyon bazli tut. "Eller mermer yüzeyde giysiyi aciyor, kameraya kaldiriyor, kumas akiyor" gibi. Net sirali aksiyonlar.`,
    veo: `Veo icin: Tek kesintisiz cekim olarak tarif et. "Kamera flat-lay uzerinde ustten baslar, eller kadraja girip giysiyi kaldirirken yavasca egilir" gibi.`,
    sora: `Sora icin: Her gecisin fizigine odaklan. "Ince kumas yercekimine karsi yukseliyor, eller yukari yonlendiriyor, malzeme arka isikta parlıyor". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Flat-lay'den giyilmis hale gecis, eller giysiyi aciyor ve kaldiriyor" gibi net hikaye anlat.`,
  },

  'cozy-morning': {
    base: `Sen moda e-ticaret icin sicak yasam tarzi videosu yonetmenisin.
COZY MORNING modu: Sicak, samimi, yumusak, yasam tarzi odakli.

ZORUNLU OGELER:
- Altin sabah isigi ince perdelerden suziluyor
- Sicak renk sicakligi (2700K hissi), yumusak golgeler
- Samimi ortam: yatak, pencere koltugu, kahvalti kosesi, banyo aynasi
- Nazik yavas hareketler: gerinme, giysiyi sarma, kahve tutma
- Bokeh ogeleri: odak disi bitkiler, kupalar, yatak ortuleri
- Yumusak fokus, urun anlarinda keskinlesme
- HOOK: Ilk 0.5 saniyede sicak isik ve rahat ortam hemen mood kurar
- Hygge estetigi: konfor, sicaklik, kendine bakim ani
- Son kare: huzurlu, rahat bir an — kahve icme, pencereye bakma
- Renk grading: cok sicak tonlar, yumusak kontrastlar, kremsi vurgular`,
    kling: `Kling icin: Sicak atmosferik anahtar kelimeler kullan. "Perdelerden yumusak sabah gunesi", "orgu kazakta nazik gerinme", "sicak bokeh arka plan". Hareketler yavas ve nazik.`,
    veo: `Veo icin: Tam sahneyi boya: "15 dereceden keten perdeler arasından altin saat isigi, isik huzmesinde toz zerreleri goruluyor, yumusak triko icinde manken kameraya donuyor". Veo atmosferik tariflere iyi yanit verir.`,
    sora: `Sora icin: Konforun fizigini tarif et: "kumas omuzlarda gevek dusuyor, arka planda kupadan buhar yukseliyor, perde hafif esintide sallaniyor". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Sicak sabah isigi, rahat ortam, giysi dogal hareketiyle gosteriliyor" gibi atmosfer odakli kisa prompt yaz.`,
  },

  'elegant-minimal': {
    base: `Sen sofistike moda e-ticaret icin rafine video yonetmenisin.
ELEGANT MINIMAL modu: Alti cizilmemis luks, rafine hareket, sofistike.

ZORUNLU OGELER:
- Notr tonlu arka plan: sicak gri, yumusak bej, mat tas rengi
- Tek zarif jest: kumasa el, omuz donusu, zarifice adim
- Mimari negatif alan, bilingli asimetrik kompozisyon
- Yumusak yonlu isik, nazik gradyan gecisi
- Yavas, amaicli kamera kaymasi (statik degil, yogun degil)
- Soluk, desature palet, urunden tek ince renk aksan
- HOOK: Ilk 0.5 saniyede carpici kompozisyon, aninda gorsel sofistikasyon
- Editorial moda dergisi kalitesi
- Son kare: mukemmel kompozisyonda zarafet — tek donmus an
- Renk grading: mat, desature, ince sicaklik, dusuik kontrast`,
    kling: `Kling icin: Rafine hareket anahtar kelimeleri kullan. "Yavas omuz donusu", "kumas uzerinde zarif el hareketi", "kameranin saga nazik kaymasi". Minimum aksiyon, maksimum zarafet.`,
    veo: `Veo icin: Moda filmi gibi tarif et: "Simetrik kompozisyon manken 15 derece donerken bozuluyor, notr keten arka planda yumusak fill light nazik gradyan olusturuyor". Veo sinematik referanslara yanit verir.`,
    sora: `Sora icin: Tek rafine harekete odaklan: "omuz donerken kumas gerginligi, dagilan yumusak kivrimlarda yan isik dans ediyor". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Notr arka plan, zarif tek hareket, editorial kalite" gibi minimal ama sofistike prompt yaz.`,
  },

  'showcase-spin': {
    base: `Sen moda e-ticaret icin urun vitrin videosu yonetmenisin.
SHOWCASE SPIN modu: Duizgun 360 derece urun donusu.

ZORUNLU OGELER:
- Duizgun, surekli 360 derece donus gorunmez donme tablasi uzerinde
- Studio aydinlatma: 3 nokta kurulum — yumusak key, fill ve rim isik
- Temiz arka plan (beyaz, gradyan veya minimal baglam)
- Donus sirasinda kumas hareketi: dogal akis, sertlik yok
- Urun karenin %70-80'ini kapliyor
- HOOK: Ilk 0.5 saniyede urun zaten donuyor, aninda gorsel ilgi
- Tam donus icin 3-5 saniye
- Donus boyunca keskin fokus
- Son kare: baslangic pozisyonuna donmus, kusursuz donus
- Kumas fizigi: merkezkaç kuvvetiyle hafif havalanma, eteklerde dalga`,
    kling: `Kling icin: "Duizgun surekli 360 donus, studio isigi, beyaz arka plan". Kling donusleri basit promptlarla iyi yapar.`,
    veo: `Veo icin: Donme mekanigini tarif et: "Gorunmez donen platform uzerinde urun tam 360 derece donusu tamamliyor. Yumusak golgeli uc noktali isik kurulumu".`,
    sora: `Sora icin: Donus sirasinda kumas fizigine odaklan: "giysi duizgunce donuyor, kumas etegi merkezkac hareketiyle hafifce kalkiyor, her acida isigi yakalıyor". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Beyaz studio, urun 360 derece donuyor, temiz isik" gibi basit donus prompt'u yaz.`,
  },

  'model-walk': {
    base: `Sen moda e-ticaret icin model yuruyusu videosu yonetmenisin.
MODEL WALK modu: Ozguvenli podyum veya sokak tarzi yuruyus.

ZORUNLU OGELER:
- Ozguvenli editorial yuruyus: kararli adimlar, hafif kalca sallantisi
- Dinamik kamera: mankeni takip eden tracking shot veya kameraya dogru yuruyus
- Kumas hareketi: her adimda dogal akis, etek sallantisi
- Sehirsel veya minimal arka plan: temiz sokak, beton duvar, studio koridor
- Moda editorial renk grading: hafif desature, kontrastli
- HOOK: Ilk 0.5 saniyede manken zaten hareket halinde, aninda dinamizm
- Tam kiyafeti hareketli gosterme
- Son kare: mankenin en ozguvenli ani — durup kameraya bakis veya yuruyuse devam
- Kumas fizigi: adim gecikmesiyle kumas tepki veriyor`,
    kling: `Kling icin: "Manken ozguvenle kameraya dogru yuruyор, editorial moda stili, tracking cekim". Aksiyon odakli tut. Kling net hareket yonu istiyor.`,
    veo: `Veo icin: Cekim kurulumunu tarif et: "Bel hizasinda steadicam tracking cekim, manken gri beton arka planda kameraya dogru yuruyоr, dogal yan isik derinlik yaratyor".`,
    sora: `Sora icin: Yuruyus fizigini tarif et: "ozguvenli yuruyus, dogal kol hareketi, kumas her adimda hafif gecikmeyle tepki veriyor". Kisi tarifi YAPMA — sadece hareket ve kumas.`,
    minimax: `MiniMax icin: "Manken ozguvenle yuruyоr, kumas hareket ediyor, editorial cekim" gibi net aksiyon prompt'u yaz.`,
  },

  'lifestyle-scene': {
    base: `Sen moda e-ticaret icin yasam tarzi sahnesi yonetmenisin.
LIFESTYLE SCENE modu: Aspirasyonel gercek dunya ortami.

ZORUNLU OGELER:
- Guzel gercek dunya lokasyonu: kafe terasi, sahil yuruyusu, cati kati, bahce
- Dogal altin saat veya sihirli saat isigi
- Dogal, poze edilmemis his: gulme, baska tarafa bakma, mekanda hareket etme
- Ortam baglami: kahve fincani, kitap, mimari, doga
- Sinematik sag alan derinligi
- HOOK: Ilk 0.5 saniyede aspirasyonel ortam kuruluyor, urun goruluyor
- Duygusal baglanti: izleyici orada olmak istemeli
- Son kare: aspirasyonel yasamdan bir kesit — mutlu, rahat, ozgur
- Renk grading: sicak golden hour tonlari, yumusak kontrast`,
    kling: `Kling icin: Tek lokasyonda tek net aksiyonla sahneyi basit tut. "Kafe terasinda manken, golden hour, sacini tutup gulumsuyor" gibi.`,
    veo: `Veo icin: Tam sahne tarifi: "Akdeniz kafe terasinda altin saat isigi, mermer masada manken, dogal gulum semeyle kameraya donuyor, sicak dize isiklari bokeh arka plan".`,
    sora: `Sora icin: Atmosferik fizik tarif et: "ruzgar kumasi ve saclari hafifce hareket ettiriyor, sicak gunes isigi tente arasındam lens flare yaratyor, on planda kahve buheri". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Kafe terasi, golden hour, manken dogal sekilde hareket ediyor" gibi ortam odakli prompt yaz.`,
  },

  'detail-zoom': {
    base: `Sen moda e-ticaret icin urun detay videosu yonetmenisin.
DETAIL ZOOM modu: Makro yakin cekim — kumas, dikiis, detay.

ZORUNLU OGELER:
- Makro/yakin cekim: urun genelinden detaya zoom
- Asiri sag alan derinligi (f/1.4 hissi)
- Doku vurgusu: kumas orgusu, iplik sayisi, dugme detayi, fermuar
- Yavas, duizgun dolly-in veya rack focus gecisi
- Yonlu yan isik doku boyutsalligini ortaya cikarir
- HOOK: Ilk 0.5 saniyede hareket zaten baslamis, gozu iceri ceker
- Dokunsal kalite: izleyici malzemeyi "hissedebilmeli"
- Son kare: en etkileyici detayin makro gorunumu — doku, isiltii, iplik
- Renk grading: notr, net, detay odakli — renkleri bozma`,
    kling: `Kling icin: "Kumas detayina yavas zoom, makro yakin cekim, sag alan derinligi, yan isik". Tek detay alanina odaklan.`,
    veo: `Veo icin: "Orta cekimden asiri yakin cekime duizgun dolly push, rack focus doku derinligini ortaya cikariyor, yan isik kumas orgusu uzerinde boyutsal golgeler yaratiyor".`,
    sora: `Sora icin: "Kamera yavasca kumas yuzeyine ilerliyor, bireysel iplikler gorunur hale geliyor, isik doku uzerinde surerek mikro golgeler yaratiyor". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Kumas detayina yakin cekim, doku ve isik vurgusu" gibi detay odakli kisa prompt yaz.`,
  },

  'before-after-reveal': {
    base: `Sen moda e-ticaret icin donusum videosu yonetmenisin.
BEFORE-AFTER REVEAL modu: Duz urun giyilmis/stilize hale donusuyor.

ZORUNLU OGELER:
- Acilis: guzelce stilize edilmis flat-lay temiz yuzey uzerinde
- Dramatik gecis: acilma, kalkma, sihirli reveal veya donusum
- Final: urun giyilmis/stilize, ozguvenli durusum
- Gecis aninda wow faktoru
- Temiz, parlak aydinlatma boyunca
- HOOK: Ilk 0.5 saniyede ilgi cekici flat-lay kompozisyonu
- Donusum merak ve tatmin yaratir
- Son kare: urunun en etkileyici giyilmis/stilize hali
- Kumas fizigi: kalkarken, acilirken dogal fizik kurallarini takip eder`,
    kling: `Kling icin: "Urun flat-lay olarak basliyor, eller alip aciyor, giyilmis hale geciyor". Donusumu basit ve fiziksel tut.`,
    veo: `Veo icin: "Beyaz mermer uzerinde stilize flat-lay'in ustten cekimi, eller kadraja girip giysiyi kaldirirken kamera yavasca egilir, goz hizasında giyilmis urune sorunsuz gecis".`,
    sora: `Sora icin: "Kumas yercekimine meydan okuyor, duz yuzeyden yukseliyor, aciliyor ve giyilmis pozisyona sariliyor, her kivrim dogal drapaj fizigini takip ediyor". Kisi tarifi YAPMA.`,
    minimax: `MiniMax icin: "Flat-lay'den giyilmis hale sihirli gecis, reveal efekti" gibi donusum odakli prompt yaz.`,
  },
}

// ═══════════ Fashion-Specific Negative Prompts ═══════════
const FASHION_NEGATIVE_PROMPTS: Record<string, string> = {
  default: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, unnatural fabric movement, stiff cloth, distorted body proportions, ugly, disfigured, low resolution, grainy, oversaturated, robotic movement, frozen pose',
  luxury: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, cheap fabric look, plastic texture, flat lighting, harsh shadows, amateur composition, oversaturated colors, fast movement, shaky camera',
  ugc: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, overly polished, too perfect, studio lighting, artificial pose, stiff movement, robotic',
  minimal: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, cluttered background, busy composition, harsh colors, distracting elements, multiple subjects',
}

function getNegativePrompt(mode: string): string {
  if (mode === 'luxury') return FASHION_NEGATIVE_PROMPTS.luxury
  if (mode === 'simple-ugc') return FASHION_NEGATIVE_PROMPTS.ugc
  if (['clean-minimal', 'elegant-minimal'].includes(mode)) return FASHION_NEGATIVE_PROMPTS.minimal
  return FASHION_NEGATIVE_PROMPTS.default
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ═══════════ GENERATE PROMPT (Claude Opus 4) ═══════════
    if (action === 'generate_prompt') {
      if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY eksik')

      const { imageUrl, imageUrls, videoMode, videoModel, productTitle, productDescription } = body
      const allImageUrls: string[] = imageUrls || (imageUrl ? [imageUrl] : [])
      if (allImageUrls.length === 0) throw new Error('imageUrl veya imageUrls gerekli')

      const modeConfig = VIDEO_MODE_PROMPTS[videoMode]
      if (!modeConfig) throw new Error(`Gecersiz video modu: ${videoMode}`)

      // Build model-specific system prompt
      let systemPrompt = modeConfig.base

      // Add model-specific guidance
      const modelFamily = getModelFamily(videoModel || 'kling-video-v3-pro')
      const modelExtra = modeConfig[modelFamily as keyof ModePrompts]
      if (modelExtra && typeof modelExtra === 'string') {
        systemPrompt += '\n\n' + modelExtra
      }

      // Add prompt structure template
      systemPrompt += '\n\n' + PROMPT_STRUCTURE

      // Add Meta Andromeda compliance
      systemPrompt += `\n\nMeta Andromeda Gereksinimleri:
- Dikey 9:16 format
- 2-5 saniye sure
- Ilk 0.5 saniye gorsel olarak carpici olmali (scroll durdurucu)
- Urun acikca gorunmeli ve cekimin yildizi olmali
- Hareket dogal olmali, yapay veya robotik DEGIL
- Video icinde yazi, logo veya kaplama YOK
- Konusma/seslendirme varsa TURKCE olmali`

      // For Sora: text-to-video mode — must avoid moderation triggers
      if (modelFamily === 'sora') {
        systemPrompt += `\n\nSORA OZEL KURALLAR:
- Text-to-video modu kullaniliyor, gorsel referansi YOK
- Giysi/urunun rengini, kumasini, kesimini, desenini CОOK DETAYLI tarif et
- "Manken" veya "kisi" kelimesini kullan — fiziksel ozellik BELIRTME (yas, vucud, ten, sac YAZMA)
- Sahne ve ortam detaylarini vurgula, kisi tarifinden kacin
- Sora'nin moderasyonu siki — kisi gorunum tarifi ENGELLENECEK`
      }

      // Build image blocks for all selected images
      const imageBlocks: any[] = []
      for (const imgUrl of allImageUrls) {
        if (imgUrl.startsWith('data:')) {
          const match = imgUrl.match(/^data:(image\/\w+);base64,(.+)$/)
          if (match) {
            imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
          }
        } else {
          imageBlocks.push({ type: 'image', source: { type: 'url', url: imgUrl } })
        }
      }

      const multiImageNote = allImageUrls.length > 1
        ? `\n\n${allImageUrls.length} GORSEL GONDERILDI. Tum gorselleri analiz ederek urunun her acisindan rengini, kumasini, kesimini, ozel detaylarini tam olarak anla. Prompt'ta tum bu detaylari kullanarak tutarli bir video tarifi olustur.`
        : ''

      const userContent = `Urun: ${productTitle || 'Kadin giyim urun'}
${productDescription ? `Aciklama: ${productDescription}` : ''}
Hedef: Kadin giyim e-ticaret, Meta/Instagram Reels reklam
Format: Dikey 9:16, 2-5 saniye${multiImageNote}

Bu urun gorsellerini dikkatlice analiz et:
1. GIYSI: Turu, rengi (spesifik ton), kumasi/dokusu, deseni
2. DETAYLAR: Kesim, dugmeler, fermuarlar, suslemeler, islemeler
3. KUMAS DAVRANISI: Isikla etkilesimi, dokusu, nasil duser/hareket eder
4. EN IYI ACI: Urunun en carpici ozelligi hangisi?

Simdi yukardaki PROMPT FORMATI'na uygun, 80-150 kelime arasi, tek paragraf halinde, tamamen TURKCE bir video prompt'u yaz. SADECE prompt metnini yaz.`

      const payload = JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: userContent },
            ...imageBlocks,
          ],
        }],
      })

      const result = await httpsRequest({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, payload)

      if (result.status !== 200) {
        console.error(`[video] Claude error: ${result.body.substring(0, 300)}`)
        throw new Error(`Claude API error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      const data = JSON.parse(result.body)
      const prompt = data.content?.[0]?.text || ''
      const usage = data.usage || {}

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          prompt,
          negativePrompt: getNegativePrompt(videoMode),
          usage: {
            model: 'claude-opus-4-20250514',
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
          },
        }),
      }
    }

    // ═══════════ FAL VIDEO SUBMIT (Kling / MiniMax) ═══════════
    if (action === 'fal_video_submit') {
      if (!FAL_KEY) throw new Error('FAL_KEY eksik')

      const { model, payload: userPayload } = body
      if (!model) throw new Error('model gerekli')

      const FAL_VIDEO_MODELS: Record<string, string> = {
        'kling-video-v3-pro': '/fal-ai/kling-video/v3/pro/image-to-video',
        'minimax-hailuo': '/fal-ai/minimax/video-01/image-to-video',
      }

      const modelPath = FAL_VIDEO_MODELS[model]
      if (!modelPath) throw new Error(`Gecersiz video model: ${model}`)

      const falPayload = JSON.stringify(userPayload)
      console.log(`[video] fal_video_submit model=${model} path=${modelPath}`)

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: modelPath,
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(falPayload),
        },
      }, falPayload)

      console.log(`[video] fal_video_submit response: ${result.status}`)
      if (!result.body || result.body.trim() === '') {
        throw new Error('FAL bos yanit dondu')
      }

      const falData = JSON.parse(result.body)
      if (result.status >= 400) {
        throw new Error(`FAL error (${result.status}): ${falData.detail || falData.message || JSON.stringify(falData).substring(0, 200)}`)
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, request_id: falData.request_id }),
      }
    }

    // ═══════════ FAL VIDEO STATUS / RESULT ═══════════
    if (action === 'fal_video_status') {
      if (!FAL_KEY) throw new Error('FAL_KEY eksik')
      if (!body.path) throw new Error('path gerekli')

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: body.path,
        method: 'GET',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
        },
      })

      if (!result.body || result.body.trim() === '') {
        throw new Error('FAL bos yanit dondu')
      }
      return {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json' },
        body: result.body,
      }
    }

    // ═══════════ GOOGLE VEO — predictLongRunning ═══════════
    if (action === 'veo_generate') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')

      const { prompt, imageUrl, veoModel, aspectRatio } = body

      let imageObj: any = null
      if (imageUrl) {
        try {
          let imageData: { mimeType: string; data: string } | null = null
          if (imageUrl.startsWith('data:')) {
            const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/)
            if (match) imageData = { mimeType: match[1], data: match[2] }
          } else {
            const imgRes = await fetch(imageUrl)
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer()
              imageData = {
                mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
                data: Buffer.from(buffer).toString('base64'),
              }
            }
          }
          if (imageData) {
            imageObj = { bytesBase64Encoded: imageData.data, mimeType: imageData.mimeType }
          }
        } catch (e) {
          console.warn(`[video] Image fetch failed for Veo: ${(e as Error).message}`)
        }
      }

      const model = veoModel || 'veo-2.0-generate-001'
      const instance: any = { prompt: prompt || '' }
      if (imageObj) instance.image = imageObj

      const veoRequestBody: any = { instances: [instance] }
      if (aspectRatio) {
        veoRequestBody.parameters = { aspectRatio: aspectRatio }
      }

      const veoPayload = JSON.stringify(veoRequestBody)
      const veoPath = `/v1beta/models/${model}:predictLongRunning?key=${GEMINI_KEY}`

      console.log(`[video] Veo predictLongRunning, model=${model}, aspectRatio=${aspectRatio || 'default'}`)

      const result = await httpsRequest({
        hostname: 'generativelanguage.googleapis.com',
        path: veoPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(veoPayload),
        },
      }, veoPayload)

      if (result.status !== 200) {
        console.error(`[video] Veo error: ${result.body.substring(0, 500)}`)
        throw new Error(`Veo API error (${result.status}): ${result.body.substring(0, 300)}`)
      }

      const veoData = JSON.parse(result.body)

      if (veoData.name) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, operationName: veoData.name }),
        }
      }

      throw new Error('Veo operation name alinamadi: ' + JSON.stringify(veoData).substring(0, 300))
    }

    // ═══════════ VEO POLL ═══════════
    if (action === 'veo_poll') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')
      const { operationName } = body
      if (!operationName) throw new Error('operationName gerekli')

      const pollPath = `/v1beta/${operationName}?key=${GEMINI_KEY}`

      const result = await httpsRequest({
        hostname: 'generativelanguage.googleapis.com',
        path: pollPath,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (result.status !== 200) {
        throw new Error(`Veo poll error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      const opData = JSON.parse(result.body)

      if (opData.done) {
        const response = opData.response || {}
        const genResponse = response.generateVideoResponse || {}

        if (genResponse.raiMediaFilteredCount && genResponse.raiMediaFilteredCount > 0) {
          const reasons = genResponse.raiMediaFilteredReasons || []
          const reasonText = reasons.join('; ').substring(0, 200)
          throw new Error(`Video guvenlik filtresi: ${reasonText || 'Icerik politikasi nedeniyle video olusturulamadi. Farkli bir gorsel veya prompt deneyin.'}`)
        }

        const samples = genResponse.generatedSamples || []
        if (samples.length > 0) {
          const videoUri = samples[0].video?.uri
          if (videoUri) {
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ success: true, done: true, videoUri }),
            }
          }
        }
        throw new Error('Veo tamamlandi ama video URI bulunamadi: ' + JSON.stringify(response).substring(0, 300))
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, done: false, metadata: opData.metadata || {} }),
      }
    }

    // ═══════════ VEO PROXY ═══════════
    if (action === 'veo_proxy') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')
      const { videoUri } = body
      if (!videoUri) throw new Error('videoUri gerekli')

      const secureUri = videoUri.includes('?') ? `${videoUri}&key=${GEMINI_KEY}` : `${videoUri}?key=${GEMINI_KEY}`
      const url = new URL(secureUri)

      const videoData = await new Promise<{ status: number; buffer: Buffer; contentType: string }>((resolve, reject) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location as string)
            const req2 = https.request({
              hostname: redirectUrl.hostname,
              path: redirectUrl.pathname + redirectUrl.search,
              method: 'GET',
            }, (res2) => {
              const chunks: Buffer[] = []
              res2.on('data', (chunk: Buffer) => chunks.push(chunk))
              res2.on('end', () => resolve({
                status: res2.statusCode || 500,
                buffer: Buffer.concat(chunks),
                contentType: (res2.headers['content-type'] || 'video/mp4') as string,
              }))
            })
            req2.on('error', reject)
            req2.setTimeout(55000, () => { req2.destroy(); reject(new Error('Redirect timeout')) })
            req2.end()
            res.resume()
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({
            status: res.statusCode || 500,
            buffer: Buffer.concat(chunks),
            contentType: (res.headers['content-type'] || 'video/mp4') as string,
          }))
        })
        req.on('error', reject)
        req.setTimeout(55000, () => { req.destroy(); reject(new Error('Veo proxy timeout')) })
        req.end()
      })

      if (videoData.status !== 200 || videoData.buffer.length < 1000) {
        throw new Error(`Veo video indirilemedi (status: ${videoData.status}, size: ${videoData.buffer.length})`)
      }

      const base64 = videoData.buffer.toString('base64')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          videoUrl: `data:${videoData.contentType};base64,${base64}`,
        }),
      }
    }

    // ═══════════ SORA — Submit Video ═══════════
    if (action === 'sora_submit') {
      if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY eksik')

      const { prompt, imageUrl, soraModel, size, seconds } = body

      const soraPayload: any = {
        model: soraModel || 'sora-2',
        prompt: prompt || '',
      }
      if (size) soraPayload.size = size
      if (seconds) soraPayload.seconds = String(seconds)

      // Sora input_reference rejects images with human faces.
      // Fashion images always contain people, so text-to-video by default.
      if (imageUrl && body.forceImageRef) {
        try {
          let dataUrl: string | null = null
          if (imageUrl.startsWith('data:')) {
            dataUrl = imageUrl
          } else {
            const imgRes = await fetch(imageUrl)
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer()
              const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
              dataUrl = `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`
            }
          }
          if (dataUrl) {
            soraPayload.input_reference = { image_url: dataUrl }
          }
        } catch (e) {
          console.warn(`[video] Sora image input failed: ${(e as Error).message}`)
        }
      }

      const payload = JSON.stringify(soraPayload)
      console.log(`[video] sora_submit model=${soraModel || 'sora-2'}, mode=text-to-video, size=${size}, seconds=${seconds}`)

      const result = await httpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/videos',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, payload)

      if (result.status !== 200 && result.status !== 201 && result.status !== 202) {
        console.error(`[video] Sora error: ${result.body.substring(0, 300)}`)
        throw new Error(`Sora API error (${result.status}): ${result.body.substring(0, 300)}`)
      }

      const soraData = JSON.parse(result.body)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, id: soraData.id, status: soraData.status }),
      }
    }

    // ═══════════ SORA — Poll Status ═══════════
    if (action === 'sora_poll') {
      if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY eksik')
      const { videoId } = body
      if (!videoId) throw new Error('videoId gerekli')

      const result = await httpsRequest({
        hostname: 'api.openai.com',
        path: `/v1/videos/${videoId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
      })

      if (result.status !== 200) {
        throw new Error(`Sora poll error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      const soraData = JSON.parse(result.body)
      console.log(`[video] Sora poll status=${soraData.status}, keys=${Object.keys(soraData).join(',')}`)

      if (soraData.status === 'completed') {
        console.log(`[video] Sora completed, full response: ${JSON.stringify(soraData).substring(0, 500)}`)

        let videoUrl = soraData.output?.url
          || soraData.url
          || soraData.video?.url
          || soraData.result?.url
          || soraData.output_video?.url
          || soraData.downloads?.url
          || null

        if (!videoUrl && Array.isArray(soraData.output)) {
          videoUrl = soraData.output[0]?.url || soraData.output[0]?.video?.url || null
        }

        // Try /content endpoint for redirect URL
        if (!videoUrl) {
          try {
            console.log(`[video] Sora: trying /content for redirect URL`)
            const contentResult = await httpsRequest({
              hostname: 'api.openai.com',
              path: `/v1/videos/${videoId}/content`,
              method: 'GET',
              headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
            })
            console.log(`[video] Sora /content status=${contentResult.status}, hasLocation=${!!contentResult.headers?.location}`)

            if (contentResult.headers?.location) {
              videoUrl = contentResult.headers.location
            } else if (contentResult.status === 200 && contentResult.body) {
              try {
                const cd = JSON.parse(contentResult.body)
                videoUrl = cd.url || cd.download_url || null
              } catch { /* not JSON */ }
            }
          } catch (e) {
            console.warn(`[video] Sora /content failed: ${(e as Error).message}`)
          }
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, done: true, videoUrl }),
        }
      }

      if (soraData.status === 'failed') {
        throw new Error('Sora video uretimi basarisiz: ' + (soraData.error?.message || 'Bilinmeyen hata'))
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, done: false, status: soraData.status }),
      }
    }

    // ═══════════ SORA — Download Video Content ═══════════
    if (action === 'sora_download') {
      if (!OPENAI_KEY) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'OPENAI_API_KEY eksik' }) }
      }
      const { videoId } = body
      if (!videoId) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'videoId gerekli' }) }
      }

      console.log(`[video] sora_download videoId=${videoId}`)

      try {
        const videoData = await new Promise<{ status: number; buffer: Buffer; location?: string; contentType?: string }>((resolve, reject) => {
          const req = https.request({
            hostname: 'api.openai.com',
            path: `/v1/videos/${videoId}/content`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
          }, (res) => {
            console.log(`[video] sora_download /content status=${res.statusCode}, location=${res.headers.location || 'none'}`)

            // ANY redirect — capture location
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              resolve({ status: res.statusCode, buffer: Buffer.alloc(0), location: res.headers.location as string })
              res.resume()
              return
            }
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => resolve({
              status: res.statusCode || 500,
              buffer: Buffer.concat(chunks),
              contentType: (res.headers['content-type'] || '') as string,
            }))
          })
          req.on('error', reject)
          req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')) })
          req.end()
        })

        // Got redirect URL — this is the video
        if (videoData.location) {
          console.log(`[video] sora_download got redirect: ${videoData.location.substring(0, 100)}`)
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, videoUrl: videoData.location }),
          }
        }

        // Got 200 with binary data — return as base64 (if small enough)
        if (videoData.status === 200 && videoData.buffer.length > 1000) {
          // Check if it's JSON first
          const textPreview = videoData.buffer.toString('utf-8').substring(0, 50)
          if (textPreview.trim().startsWith('{')) {
            try {
              const jsonData = JSON.parse(videoData.buffer.toString('utf-8'))
              const url = jsonData.url || jsonData.download_url || jsonData.video_url || null
              if (url) {
                return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, videoUrl: url }) }
              }
            } catch { /* not json */ }
          }

          // Binary video — only if under 5MB (Netlify response limit)
          if (videoData.buffer.length < 5 * 1024 * 1024) {
            const base64 = videoData.buffer.toString('base64')
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ success: true, videoUrl: `data:${videoData.contentType || 'video/mp4'};base64,${base64}` }),
            }
          }

          // Too large for base64 — this shouldn't happen with 302 flow
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: `Video cok buyuk (${Math.round(videoData.buffer.length / 1024 / 1024)}MB)` }) }
        }

        // Any other status — return as retriable
        const bodyStr = videoData.buffer.toString('utf-8').substring(0, 200)
        console.log(`[video] sora_download non-success: status=${videoData.status}, body=${bodyStr}`)
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: `Sora content status ${videoData.status}` }),
        }

      } catch (e: any) {
        console.error(`[video] sora_download error: ${e.message}`)
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: e.message }),
        }
      }
    }

    // ═══════════ DOWNLOAD PROXY ═══════════
    if (action === 'download_proxy') {
      const { videoUrl } = body
      if (!videoUrl) throw new Error('videoUrl gerekli')

      if (videoUrl.startsWith('data:')) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, videoUrl }),
        }
      }

      const url = new URL(videoUrl)
      const videoData = await new Promise<{ status: number; buffer: Buffer; contentType: string }>((resolve, reject) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { 'User-Agent': 'ShopifyTools/1.0' },
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const rUrl = new URL(res.headers.location as string)
            const req2 = https.request({
              hostname: rUrl.hostname,
              path: rUrl.pathname + rUrl.search,
              method: 'GET',
            }, (res2) => {
              const chunks: Buffer[] = []
              res2.on('data', (chunk: Buffer) => chunks.push(chunk))
              res2.on('end', () => resolve({
                status: res2.statusCode || 500,
                buffer: Buffer.concat(chunks),
                contentType: (res2.headers['content-type'] || 'video/mp4') as string,
              }))
            })
            req2.on('error', reject)
            req2.setTimeout(55000, () => { req2.destroy(); reject(new Error('Redirect timeout')) })
            req2.end()
            res.resume()
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({
            status: res.statusCode || 500,
            buffer: Buffer.concat(chunks),
            contentType: (res.headers['content-type'] || 'video/mp4') as string,
          }))
        })
        req.on('error', reject)
        req.setTimeout(55000, () => { req.destroy(); reject(new Error('Download proxy timeout')) })
        req.end()
      })

      if (videoData.status !== 200 || videoData.buffer.length < 100) {
        throw new Error(`Video indirilemedi (status: ${videoData.status})`)
      }

      const base64 = videoData.buffer.toString('base64')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          videoUrl: `data:${videoData.contentType};base64,${base64}`,
        }),
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Gecersiz action: ${action}` }) }

  } catch (err: any) {
    console.error(`[video] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}

function getModelFamily(videoModel: string): string {
  if (videoModel.includes('kling')) return 'kling'
  if (videoModel.includes('veo')) return 'veo'
  if (videoModel.includes('sora')) return 'sora'
  if (videoModel.includes('minimax') || videoModel.includes('hailuo')) return 'minimax'
  return 'kling'
}
