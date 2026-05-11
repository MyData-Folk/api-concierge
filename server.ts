import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import Fuse from "fuse.js";
import fs from "fs";
import cors from "cors";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// ── Supabase Setup ──────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Métriques (In-Memory)
let metrics = {
  onboardings_count: 0,
  last_extraction: null as string | null,
  api_hits: 0,
  errors: 0
};

app.use(cors());
app.use(express.json());

// Charger la base de données des hôtels
const JSON_PATH = path.join(process.cwd(), "src/data/les_hotels_classes_en_ile-de-france.json");
let hotelDb: any[] = [];
try {
  if (fs.existsSync(JSON_PATH)) {
    const raw = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
    hotelDb = raw.map((h: any) => ({
      nom: h.fields?.nom_commercial || "Sans Nom",
      adresse: h.fields?.adresse || "",
      commune: h.fields?.commune || "",
      site_internet: h.fields?.site_internet,
      coords: h.fields?.geo ? { lat: h.fields.geo[0], lng: h.fields.geo[1] } : null
    }));
    console.log(`✅ Base Hotels: ${hotelDb.length} chargés.`);
  }
} catch (e) { console.error("⚠️ Base Hotels non trouvée."); }

const hotelFuse = new Fuse(hotelDb, { keys: ["nom", "adresse"], threshold: 0.3 });

// ── CONFIGURATION SCRAPING ──────────────────────────────────
let scrapingSettings = {
  osm_radius: { tourism: 1200, transport: 800, shop: 600, health: 600 },
  wiki_search_mode: "metro",
  enable_website_scraping: true,
  categories: ["tourism", "transport", "shop", "health"],
  custom_sources: [] as any[]
};

const cat_mapping: Record<string, string> = {
  tourism: 'tourism',
  transport: 'transport',
  shop: 'shop',
  health: 'health'
};

app.get("/api/metrics", (req, res) => res.json({ ...metrics, status: "Active", uptime: process.uptime() }));
app.get("/api/settings", (req, res) => res.json(scrapingSettings));
app.post("/api/settings", (req, res) => {
  scrapingSettings = { ...scrapingSettings, ...req.body };
  res.json({ success: true });
});

// Helper Distance
function getDist(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// SCRAPER SITE AMÉLIORÉ
async function scrapeSite(url: string) {
  if (!url) return null;
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const res = await axios.get(target, { 
      timeout: 8000, 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
      } 
    });
    
    const $ = cheerio.load(res.data);
    const title = $("title").text() || $('meta[property="og:title"]').attr("content");
    const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content");
    const h1 = $("h1").first().text();

    return { 
      title: title?.trim(), 
      description: description?.trim(),
      h1: h1?.trim(),
      scraped_at: new Date().toISOString() 
    };
  } catch (e: any) { 
    console.warn(`[Scraping] Échec pour ${url}: ${e.message}`);
    return null; 
  }
}

// Endpoint pour télécharger les exports
app.get("/api/download/:filename", (req, res) => {
  const filePath = path.join(process.cwd(), "exports", req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send("Fichier non trouvé");
  }
});

// API ONBOARDING (PIPELINE COMPLET)
app.post("/api/onboard", async (req, res) => {
  const { hotel_name, hotel_address, website_url, custom_settings } = req.body;
  const set = custom_settings || scrapingSettings;

  try {
    console.log(`🚀 Début onboarding pour: ${hotel_name}`);

    // 1. GEOCODAGE (Strict Headers)
    const geo = await axios.get(`https://nominatim.openstreetmap.org/search`, {
      params: { q: hotel_address, format: "json", addressdetails: 1, limit: 1 },
      headers: { 
        "User-Agent": "ParisLocal-Digital-Concierge/1.0 (contact: admin@hotelmanager.fr)",
        "Referer": "https://hotel.hotelmanager.fr"
      },
      timeout: 8000
    });
    
    if (!geo.data[0]) {
       metrics.errors++;
       console.error(`❌ Nominatim: Aucune adresse trouvée pour "${hotel_address}"`);
       return res.status(404).json({ error: "Adresse non trouvée" });
    }

    const loc = geo.data[0];
    const coords = {
      lat: parseFloat(loc.lat),
      lng: parseFloat(loc.lon),
      suburb: loc.address.suburb || loc.address.neighbourhood || loc.address.city_district || "Paris",
      postcode: loc.address.postcode || ""
    };

    console.log(`📍 Coordonnées: ${coords.lat}, ${coords.lng} (${coords.suburb}, ${coords.postcode})`);

    // 2. OSM SCRAPING (Fallback + Headers)
    const sources = [
      ...set.categories.map((c: string) => ({
        id: c,
        radius: set.osm_radius[cat_mapping[c] || c] || 500,
        tags: c === "transport" ? 'node["railway"~"subway|station"]' :
              c === "tourism" ? 'node["tourism"~"museum|attraction"]' :
              c === "shop" ? 'node["shop"~"bakery|supermarket"]' : 'node["amenity"~"pharmacy"]'
      })),
      ...(set.custom_sources || [])
    ];

    const pois: any[] = [];
    const osmHeaders = { "User-Agent": "ParisLocal-Digital-Concierge/1.0", "Content-Type": "application/x-www-form-urlencoded" };

    for (const s of sources) {
      try {
        const query = `[out:json][timeout:25];(${s.tags}(around:${s.radius},${coords.lat},${coords.lng}););out body;`;
        let osmRes;
        
        try {
          osmRes = await axios.post("https://overpass-api.de/api/interpreter", `data=${encodeURIComponent(query)}`, { timeout: 12000, headers: osmHeaders });
        } catch (e1: any) {
          osmRes = await axios.post("https://overpass.openstreetmap.fr/api/interpreter", `data=${encodeURIComponent(query)}`, { timeout: 12000, headers: osmHeaders });
        }
        
        const elements = osmRes.data.elements || [];
        elements.forEach((el: any) => {
          const t = el.tags || {};
          const addr = t["addr:full"] || `${t["addr:housenumber"] || ""} ${t["addr:street"] || ""}`.trim();
          pois.push({
            id: el.id,
            name: t.name || t.operator || s.id,
            category: s.id,
            distance_m: getDist(coords.lat, coords.lng, el.lat, el.lon),
            address: addr || "Adresse non renseignée",
            phone: t.phone || t["contact:phone"] || "N/A",
            lat: el.lat, lng: el.lon
          });
        });
      } catch (e) { console.error(`Err OSM ${s.id}`); }
    }

    console.log(`✅ ${pois.length} POIs trouvés.`);

    // 3. WIKIPEDIA
    let wikiTerm = coords.suburb;
    if (set.wiki_search_mode === "metro") {
      const metro = pois.find(p => p.category === "transport" && (p.name.toLowerCase().includes("métro") || p.name.toLowerCase().includes("station")));
      if (metro) wikiTerm = metro.name.replace(/métro|station/gi, "").trim();
    }
    
    let wikiData = null;
    try {
      const wikiRes = await axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTerm.replace(/ /g, "_"))}`, { timeout: 5000 });
      wikiData = { title: wikiRes.data.title, summary: wikiRes.data.extract, url: wikiRes.data.content_urls?.desktop?.page };
    } catch (e) {
      console.warn(`[Wiki] Échec pour ${wikiTerm}`);
    }

    const full_website_url = website_url ? (website_url.startsWith('http') ? website_url : `https://${website_url}`) : '';
    const [siteData] = await Promise.all([
      scrapeSite(full_website_url)
    ]);

    const result = {
      hotel_name,
      coords,
      pois: pois.sort((a,b) => a.distance_m - b.distance_m).slice(0, 50),
      wiki: wikiData,
      site_official: siteData,
      website_url: full_website_url,
      timestamp: new Date().toISOString()
    };

    // 4. PERSISTANCE & EXPORT
    metrics.onboardings_count++;
    metrics.api_hits += result.pois.length;
    metrics.last_extraction = hotel_name;

    try {
      const exportDir = path.join(process.cwd(), "exports");
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);
      const fileName = `export_${hotel_name.replace(/\s+/g, '_')}_${Date.now()}.json`;
      fs.writeFileSync(path.join(exportDir, fileName), JSON.stringify(result, null, 2));
      console.log(`💾 JSON Exporté: ${fileName}`);
      (result as any).export_file = fileName;
    } catch (e: any) { 
      console.error("❌ Erreur Export JSON:", e.message); 
    }

    if (supabase) {
      try {
        const { error } = await supabase.from("hotels_data").upsert({ 
          hotel_name, 
          data: result, 
          updated_at: new Date().toISOString() 
        });
        if (error) console.error("⚠️ Erreur Supabase Upsert:", error.message);
        else console.log(`✅ Supabase Sync: ${hotel_name}`);
      } catch (dbErr: any) {
        console.error("⚠️ Échec connexion Supabase:", dbErr.message);
      }
    }

    res.json(result);

  } catch (error: any) {
    metrics.errors++;
    console.error(`🛑 ERREUR CRITIQUE PIPELINE [${hotel_name}]:`, error.stack || error.message);
    res.status(500).json({ 
      error: "Erreur interne du pipeline", 
      details: error.message,
      step: "global" 
    });
  }
});

// SEARCH & CHAT
app.get("/api/hotels/search", (req, res) => {
  const q = req.query.q as string;
  res.json(hotelFuse.search(q || "").slice(0, 10).map(r => r.item));
});

app.post("/api/chat", async (req, res) => {
  const { message, hotelContext } = req.body;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.json({ reply: "Léon est déconnecté (Clé API manquante)." });

  try {
    const prompt = `Tu es Léon, concierge de ${hotelContext?.hotel_name}. Quartier: ${hotelContext?.coords?.suburb}. Lieux: ${(hotelContext?.pois || []).slice(0,5).map((p:any) => p.name).join(', ')}.`;
    const or = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "system", content: prompt }, { role: "user", content: message }]
    }, { headers: { "Authorization": `Bearer ${key}` } });
    res.json({ reply: or.data.choices[0].message.content });
  } catch { res.json({ reply: "Désolé, je rencontre un problème technique. 🛎️" }); }
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => res.sendFile(path.resolve("dist/index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`🚀 ParisLocal ON sur http://localhost:${PORT}`));
}
start();
