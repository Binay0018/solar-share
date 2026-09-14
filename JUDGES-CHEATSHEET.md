# ☀️ SolarShare — Judges 1-Page UI/UX Cheat Sheet (Hinglish)

> **One-liner:** Rooftop solar wale apni extra bijli pados mein bechte hain → Consumer DISCOM se **28% sasta**, Prosumer feed-in se **35% zyada** kamata hai. P2P + Blockchain + IoT.

---

## 🎯 App Flow (30 sec)

```
Open App (Hindi default) → DISCOM select → Prosumer YA Consumer tab → Form submit → Auto-match → Ledger mein trade dikhe
```

| Role | Tab | Form | Button | Result |
|------|-----|------|--------|--------|
| **Prosumer** (bijli bechta hai) | ☀️ मैं ऊर्जा उत्पादक | Sell Rooftop Solar Surplus | **Publish Solar Offer →** | Offer marketplace mein → match → ledger |
| **Consumer** (bijli khareedta hai) | ⚡ मुझे बिजली चाहिए | Request Clean Neighbourhood Power | **Submit Energy Request →** | Backend match karega → ledger mein settlement |

---

## 🔝 Top Bar — Keywords & Clicks

| UI Text | Matlab | Click = ? |
|---------|--------|-----------|
| **SolarShare ☀️ भारत** | Brand | Page reload |
| **डिस्कॉम ग्रिड** (dropdown) | State electricity board | Tariff + state update (8 DISCOMs) |
| **लाइव माइक्रो-ग्रिड (IST)** | Live data indicator | ❌ No click (green dot) |
| **English / हिंदी** | Language | Poori UI switch |
| **वेब3 वॉलेट जोड़ें** | MetaMask connect | Wallet address dikhe (optional) |

---

## 📊 Screen Sections — Important Keywords

| Section | Key Text (HI) | Kya dikhata hai |
|---------|---------------|-----------------|
| **Hero** | *अपनी छत की सौर ऊर्जा, पड़ोस में साझा करें* | Main tagline |
| **Badge** | *🇮🇳 पीएम सूर्य घर: मुफ्त बिजली योजना संगत* | PM Surya Ghar aligned |
| **KPI 1** | Surplus: *अतिरिक्त सौर ऊर्जा* / Demand: *वर्तमान बिजली मांग* | 4.20 kWh / 2.80 kWh |
| **KPI 2** | *आज का कुल सौर उत्पादन* | 22.4 kWh today |
| **KPI 3** | *स्थानीय समुदाय मूल्य* | Total community savings ₹ |
| **KPI 4** | *सक्रिय नेटवर्क गतिविधि* | X offers, Y settled trades |
| **Tariff** | Grid ₹7.50 → **P2P ₹5.20** → Feed-in ₹4.10 | Price comparison strip |
| **Chart** | *रूफटॉप जनरेशन प्रोफाइल* (24hr, peak 12:30 IST) | Solar curve |
| **Ledger** | *स्मार्ट ग्रिड लेजर* — *X यूनिट्स ट्रेड हुई* | Live blockchain trades |
| **Market** | *ऊर्जा बाज़ार* — Open / Matched / Settled | Active offers list |

---

## 🔘 All Buttons — Click = Kya Hoga

| Button | Action |
|--------|--------|
| **☀️ Prosumer tab** | Seller mode → Surplus KPI + Sell form |
| **⚡ Consumer tab** | Buyer mode → Demand KPI + Request form |
| **Publish Solar Offer →** | `POST /offers` → ✅ notice → marketplace update → auto-match |
| **Submit Energy Request →** | `POST /trades` → ✅ notice → match offer → ledger update |
| **Refresh ↻** | Latest offers + trades + ledger fetch |
| **Retry ↻** | Backend reconnect (if down) |
| **Dismiss ✕** | Notice band karo |
| **Connect Web3 Wallet** | MetaMask → `0x1234...5678` dikhe |

> **Auto-refresh:** Har **10 sec** data update. IoT simulator background mein meter readings bhejta hai.

---

## 📝 Form Fields (Demo Values)

**Prosumer:** Seller ID `solar-rooftop-blr-01` | Units `5.5` | Rate `₹5.25` → **Publish**  
**Consumer:** Buyer ID `household-indiranagar-04` | Units `4.0` | Max Rate `₹5.80` → **Submit**

---

## 🎤 2-Min Demo Script

1. App kholo → Hindi default → **English toggle** dikhao  
2. **BESCOM** select → Tariff strip: *"DISCOM ₹7.50, P2P ₹5.20 — dono side profit"*  
3. **Prosumer** → form bharo → **Publish Offer** → ✅ success  
4. **Consumer tab** switch → **Submit Request** → **Ledger** mein trade  
5. **Wallet connect** → PM Surya Ghar badge → Footer CEA/SERC  
6. *"IoT simulator background mein auto offers banata hai"*

---

## ⚡ Judges Q&A Quick Answers

| Sawal | Jawab |
|-------|-------|
| Login hai? | ❌ Nahi — open access, tab se role choose |
| Admin panel? | ❌ Nahi — single dashboard |
| Offer par click se buy? | ❌ Nahi — form se request, backend auto-match |
| Real-time? | REST polling 10s (WebSocket nahi) |
| Wallet mandatory? | ❌ Optional — cosmetic + future settlement |
| Backend chahiye? | ✅ MongoDB + backend port 3000 |

---

**SolarShare भारत** • P2P Solar Microgrid • CEA & SERC Aligned • Real-time refresh every 10s
