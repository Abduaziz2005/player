# 🎬 Media Player Pro v5.0 — Web Edition

## Ishga tushirish

### 1. Python paketlarini o'rnatish
```bash
pip install flask werkzeug
```
yoki
```bash
pip install -r requirements.txt
```

### 2. Dasturni ishga tushirish
```bash
python app.py
```

Dastur avtomatik ravishda:
- Server `http://localhost:5500` da ishga tushadi
- Google Chrome / brauzeringizda **avtomatik ochiladi**
- `uploads/`, `backups/`, `data/` papkalari avtomatik yaratiladi

## Papka strukturasi
```
media_player_web/
├── app.py              ← Backend (Flask server)
├── requirements.txt    ← Kerakli paketlar
├── data/
│   └── media.db        ← SQLite ma'lumotlar bazasi
├── uploads/            ← Media fayllar saqlanadigan joy
├── backups/            ← JSON zaxira fayllar
├── static/
│   ├── css/style.css   ← Dizayn
│   ├── js/app.js       ← Frontend logika
│   └── thumbs/         ← Kelajak uchun thumbnail
└── templates/
    └── index.html      ← Bosh sahifa
```

## Imkoniyatlar

### 🏠 Bosh sahifa
- Statistika kartalar (videolar, audio, sevimlilar, hajm)
- "Ko'rishni davom ettiring" bo'limi (progress bilan)
- Oxirgi qo'shilganlar

### 📚 Kutubxona
- Grid / List ko'rinish
- Qidirish (sarlavha, janr, tavsif bo'yicha)
- Filtr: tur, kategoriya, janr, yil
- Saralash: yangi, nomi, reyting, ko'rishlar, yil
- Sevimlilar filtri
- Sahifalash (pagination)

### 📤 Media Yuklash
- Drag & Drop yoki fayl tanlash
- Ko'p fayl bir vaqtda yuklash
- Progress bar
- Media ma'lumotlari: sarlavha, tavsif, tur, kategoriya, janr, yil, reyting

### 🎬 Video/Audio Player (brauzerda)
- HTML5 video/audio player
- Range request orqali seek (tezkor)
- Play/Pause, +/-10s, ovoz, tezlik (0.25x–3x)
- To'liq ekran (video)
- Ko'rish progressi saqlash
- Klaviatura tugmalari: `Space`, `←→`, `↑↓`, `M`, `F`, `Esc`

### 🎵 Pleylistlar
- Yangi pleylist yaratish
- Media qo'shish / olib tashlash
- Pleylist ko'rish

### 🕐 Ko'rish tarixi
- Barcha ko'rishlar tarixi
- Tozalash imkoniyati

### ⚙ Admin Panel
- **Media**: barcha medialar jadvali, toplu o'chirish, tahrirlash
- **Kategoriyalar**: qo'shish/o'chirish, rang tanlash
- **Sozlamalar**: standart ovoz, sahifadagi media soni
- **Backup**: JSON eksport/import

## To'xtatish
`Ctrl + C`
