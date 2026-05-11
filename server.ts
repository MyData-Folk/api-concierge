import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import Fuse from "fuse.js";
import fs from "fs";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// ── Supabase Setup ──────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Métriques (In-Memory avec Persistance Temporelle en Log)
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
} catch (e) { console.error("Base Hotels non trouvée."); }

const hotelFuse = new Fuse(hotelDb, { keys: ["nom", "adresse"], threshold: 0.3 });

// ── CONFIGURATION SCRAPING ──────────────────────────────────
let scrapingSettings = {
  osm_radius: { tourism: 1200, transport: 800, shop: 600, health: 600 },
  wiki_search_mode: "metro",
  enable_website_scraping: true,
  categories: ["tourism", "transport", "shop", "health"],
  custom_sources: [] as any[]
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

// SCRAPER SITE
async function scrapeSite(url: string) {
  if (!url) return null;
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const res = await axios.get(target, { timeout: 5000 });
    const title = res.data.match(/<title>(.*?)<\/title>/i)?.[1];
    const desc = res.data.match(/<meta name="description" content="(.*?)"/i)?.[1];
    return { title, description: desc };
  } catch { return null; }
}

// API ONBOARDING (PIPELINE COMPLET)
app.post("/api/onboard", async (req, res) => {
  const { hotel_name, hotel_address, website_url, custom_settings } = req.body;
  const set = custom_settings || scrapingSettings;

  try {
    // 1. GEOCODAGE
    const geo = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(hotel_address)}&format=json&addressdetails=1&limit=1`, {
      headers: { "User-Agent": "ParisLocal-App" }
    });
    
    if (!geo.data[0]) throw new Error("Adresse non trouvée");
    const loc = geo.data[0];
    const coords = {
      lat: parseFloat(loc.lat),
      lng: parseFloat(loc.lon),
      suburb: loc.address.suburb || loc.address.neighbourhood || loc.address.city_district || "Paris"
    };

    // 2. OSM SCRAPING
    const sources = [
      ...set.categories.map((c: string) => ({
        id: c,
        radius: set.osm_radius[c] || 500,
        tags: c === "transport" ? 'node["railway"~"subway|station"]' :
              c === "tourism" ? 'node["tourism"~"museum|attraction"]' :
              c === "shop" ? 'node["shop"~"bakery|supermarket"]' : 'node["amenity"~"pharmacy"]'
      })),
      ...(set.custom_sources || [])
    ];

    const pois: any[] = [];
    for (const s of sources) {
      try {
        const query = `[out:json];(${s.tags}(around:${s.radius},${coords.lat},${coords.lng}););out;`;
        // Fallback servers
        let osmRes;
        try {
          osmRes = await axios.post("https://overpass-api.de/api/interpreter", `data=${encodeURIComponent(query)}`, { timeout: 10000 });
        } catch {
          osmRes = await axios.post("https://overpass.openstreetmap.fr/api/interpreter", `data=${encodeURIComponent(query)}`, { timeout: 10000 });
        }
        
        const elements = osmRes.data.elements || [];
        elements.forEach((el: any) => {
          pois.push({
            id: el.id,
            name: el.tags.name || el.tags.operator || s.id,
            category: s.id,
            distance: getDist(coords.lat, coords.lng, el.lat, el.lon),
            lat: el.lat, lng: el.lon
          });
        });
      } catch (e) { console.error(`Err OSM ${s.id}`); }
    }

    // 3. WIKI & SITE
    let wikiTerm = coords.suburb;
    if (set.wiki_search_mode === "metro") {
      const metro = pois.find(p => p.category === "transport");
      if (metro) wikiTerm = metro.name.replace(/métro|station/gi, "").trim();
    }
    
    const [wikiRes, siteData] = await Promise.all([
      axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTerm.replace(/ /g, "_"))}`).catch(() => null),
      scrapeSite(website_url)
    ]);

    const result = {
      hotel_name,
      coords,
      pois: pois.sort((a,b) => a.distance - b.distance).slice(0, 50),
      wiki: wikiRes ? { title: wikiRes.data.title, summary: wikiRes.data.extract } : null,
      site_official: siteData,
      website_url,
      timestamp: new Date().toISOString()
    };

    // 4. PERSISTANCE & EXPORT JSON
    metrics.onboardings_count++;
    metrics.api_hits += result.pois.length;
    metrics.last_extraction = hotel_name;

    // Sauvegarde locale (Le fameux export JSON demandé)
    const exportDir = path.join(process.cwd(), "exports");
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);
    const fileName = `export_${hotel_name.replace(/\s+/g, '_')}_${Date.now()}.json`;
    fs.writeFileSync(path.join(exportDir, fileName), JSON.stringify(result, null, 2));

    if (supabase) {
      await supabase.from("hotels_data").upsert({ hotel_name, data: result, updated_at: new Date().toISOString() });
    }

    res.json({ ...result, export_file: fileName });

  } catch (error: any) {
    metrics.errors++;
    res.status(500).json({ error: error.message });
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
