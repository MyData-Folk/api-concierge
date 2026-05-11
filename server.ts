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

if (!supabase) {
  console.warn("⚠️ Supabase non configuré. La persistance des données sera désactivée.");
}

app.use(cors({
  origin: [
    "https://hotel.hotelmanager.fr",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Charger la base de données des hôtels
const JSON_PATH = path.join(process.cwd(), "src/data/les_hotels_classes_en_ile-de-france.json");

let hotelDb: any[] = [];
try {
  if (fs.existsSync(JSON_PATH)) {
    const hotelDbRaw = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
    hotelDb = hotelDbRaw.map((h: any) => ({
      nom: h.fields?.nom_commercial || "Hôtel sans nom",
      adresse: h.fields?.adresse || "Adresse inconnue",
      commune: h.fields?.commune || "",
      code_postal: h.fields?.code_postal || "",
      site_internet: h.fields?.site_internet?.startsWith("www") ? `http://${h.fields.site_internet}` : h.fields?.site_internet,
      telephone: h.fields?.telephone || "",
      classement: h.fields?.classement || "",
      coords: h.fields?.geo ? { lat: h.fields.geo[0], lng: h.fields.geo[1] } : null
    }));
    console.log(`✅ Base de données chargée : ${hotelDb.length} établissements.`);
  }
} catch (err) {
  console.error("❌ ERREUR lors du chargement de la base de données:", err);
}

const hotelFuse = new Fuse(hotelDb, {
  keys: ["nom", "adresse"],
  threshold: 0.3,
  includeScore: true
});

// Métriques simples pour le dashboard
let metrics = {
  onboardings_count: 0,
  last_extraction: null as string | null,
  api_hits: 0,
  errors: 0
};

app.get("/api/metrics", (req, res) => {
  res.json({
    ...metrics,
    db_size: hotelDb.length,
    status: "Production Ready",
    uptime: Math.floor(process.uptime())
  });
});

// ── Récupérer les données d'un hôtel déjà onboardé ───────────
app.get("/api/hotel-data", async (req, res) => {
  const { name } = req.query;
  if (!name || !supabase) return res.status(404).json({ error: "Hôtel non trouvé" });

  try {
    const { data, error } = await supabase
      .from("hotels_data")
      .select("data")
      .eq("hotel_name", name)
      .single();

    if (error || !data) return res.status(404).json({ error: "Hôtel non onboardé" });
    
    const exportPath = path.join(process.cwd(), "exports");
    if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath);
    
    const fileName = `sim_data_${(name as string).replace(/\s+/g, '_')}_${Date.now()}.json`;
    const fullExportPath = path.join(exportPath, fileName);
    
    fs.writeFileSync(fullExportPath, JSON.stringify(data.data, null, 2));

    metrics.onboardings_count++;
    metrics.last_extraction = name as string;
    metrics.api_hits += (data.data.pois?.length || 0);

    res.json({ ...data.data, simulation_file: fileName });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Configuration du Système Expert (Nouveau) ────────────────
let scrapingSettings = {
  osm_radius: { tourism: 1000, transport: 600, shop: 500, health: 500 },
  wiki_search_mode: "metro", // "suburb", "district", ou "metro"
  enable_website_scraping: true,
  categories: ["tourism", "transport", "shop", "health"],
  custom_sources: [] as { name: string, tags: string, radius: number }[]
};

app.get("/api/settings", (req, res) => res.json(scrapingSettings));
app.post("/api/settings", (req, res) => {
  scrapingSettings = { ...scrapingSettings, ...req.body };
  res.json({ success: true, settings: scrapingSettings });
});

// Helper pour scraper le site officiel
async function scrapeWebsite(url: string) {
  if (!url || !scrapingSettings.enable_website_scraping) return null;
  try {
    const formattedUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await axios.get(formattedUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
    const html = response.data;
    
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const descMatch = html.match(/<meta name="description" content="(.*?)"/i) || html.match(/<meta property="og:description" content="(.*?)"/i);
    
    return {
      title: titleMatch ? titleMatch[1] : null,
      description: descMatch ? descMatch[1] : null,
      scraped_at: new Date().toISOString()
    };
  } catch (e: any) {
    console.warn(`[Scraper] Échec pour ${url}:`, e.message);
    return null;
  }
}

// --- LOGIQUE METIER (MIME DU PIPELINE PYTHON) ---

// Formule Haversine pour la distance
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// API Recherche dans la base locale
app.get("/api/hotels/search", (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.json([]);
  const results = hotelFuse.search(q).slice(0, 10).map(r => r.item);
  res.json(results);
});

// API d'Onboarding
app.post("/api/onboard", async (req, res) => {
  const { hotel_name, hotel_address, website_url, custom_settings } = req.body;
  const settings = custom_settings || scrapingSettings;

  try {
    // 1. GÉOCODAGE (Nominatim)
    const geoResponse = await axios.get(`https://nominatim.openstreetmap.org/search`, {
      params: { q: hotel_address, format: "json", addressdetails: 1, limit: 1 },
      headers: { "User-Agent": "ParisLocal-Onboarding-Agent" }
    });

    if (!geoResponse.data.length) {
      metrics.errors++;
      return res.status(404).json({ error: "Adresse introuvable" });
    }

    const loc = geoResponse.data[0];
    const details = loc.address;
    const coords = {
      lat: parseFloat(loc.lat),
      lng: parseFloat(loc.lon),
      address: loc.display_name,
      suburb: details.suburb || details.neighbourhood || details.quarter || details.city_district || "Quartier Inconnu",
      district: details.city_district || "Paris"
    };

    console.log(`📍 Géocodage réussi pour ${hotel_name}: ${coords.lat}, ${coords.lng} (${coords.suburb})`);

    // 2. COLLECTE OSM
    const categories = settings.categories || ["tourism", "transport", "shop", "health"];
    const allSources = [
      ...categories.map(cat => ({
        id: cat,
        radius: (settings.osm_radius && settings.osm_radius[cat as keyof typeof settings.osm_radius]) || 500,
        tags: cat === "transport" ? 'node["railway"~"subway|station"]' :
              cat === "tourism" ? 'node["tourism"~"museum|attraction"]' :
              cat === "shop" ? 'node["shop"~"bakery|supermarket"]' :
              cat === "health" ? 'node["amenity"~"pharmacy"]' : ""
      })),
      ...(settings.custom_sources || [])
    ].filter(s => s.tags);

    const overpassQueries = allSources.map(async (src) => {
      try {
        const query = `[out:json];(${src.tags}(around:${src.radius},${coords.lat},${coords.lng}););out;`;
        const osmRes = await axios.post("https://overpass.openstreetmap.fr/api/interpreter", `data=${encodeURIComponent(query)}`, { 
          timeout: 15000,
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        
        return (osmRes.data.elements || []).map((el: any) => ({
          id: String(el.id),
          name: el.tags.name || el.tags.operator || `${src.id} sans nom`,
          category: src.id,
          distance_m: Math.round(calculateDistance(coords.lat, coords.lng, el.lat, el.lon)),
          lat: el.lat,
          lng: el.lon,
          source: "OSM"
        }));
      } catch (e: any) {
        console.error(`[OSM] Erreur source ${src.id}:`, e.message);
        return [];
      }
    });

    const poisResults = await Promise.all(overpassQueries);
    const allPois = poisResults.flat();

    // 3. WIKIPEDIA (Basé sur la station de métro si mode metro)
    const wikiQuery = (async () => {
      try {
        let term = "";
        
        if (settings.wiki_search_mode === "metro") {
          const metro = allPois.find(p => p.category === "transport" && (p.name.toLowerCase().includes("métro") || p.name.toLowerCase().includes("station")));
          if (metro) {
            term = metro.name.replace(/métro|station/gi, "").trim().replace(/ /g, "_");
            console.log(`[WIKI] Recherche basée sur le métro: ${term}`);
          }
        }

        if (!term) {
          term = coords.suburb.replace(/ /g, "_");
          if (term === "Quartier_Inconnu" || term === "Paris") {
             term = coords.district.replace(/ /g, "_") + (coords.district.includes("Paris") ? "" : "_de_Paris");
          }
        }
        
        const wikiRes = await axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${term}`);
        return {
          title: wikiRes.data.title,
          summary: wikiRes.data.extract,
          url: wikiRes.data.content_urls.desktop.page,
          source: term
        };
      } catch (e) {
        try {
          const fallbackTerm = coords.district.replace(/ /g, "_") + (coords.district.includes("Paris") ? "" : "_de_Paris");
          const wikiRes = await axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${fallbackTerm}`);
          return {
            title: wikiRes.data.title,
            summary: wikiRes.data.extract,
            url: wikiRes.data.content_urls.desktop.page,
            source: fallbackTerm
          };
        } catch (e2) {
          return null;
        }
      }
    })();

    // 4. SITE OFFICIEL
    const websiteScraping = scrapeWebsite(website_url);

    const [wiki, siteData] = await Promise.all([
      wikiQuery,
      websiteScraping
    ]);

    // DÉDOUBLONNAGE
    const fuse = new Fuse(allPois, { keys: ["name"], threshold: 0.2 });
    const uniquePois: any[] = [];
    const seen = new Set();

    allPois.sort((a, b) => a.distance_m - b.distance_m).forEach(poi => {
      const results = fuse.search(poi.name);
      const isDuplicate = results.some(r => seen.has(r.item.id) && r.item.id !== poi.id);
      if (!isDuplicate) {
        uniquePois.push(poi);
        seen.add(poi.id);
      }
    });

    const result = {
      hotel_name,
      coords,
      pois: uniquePois,
      wiki,
      site_official: siteData,
      status: "Active",
      website_url: website_url || null
    };

    // MÀJ Métriques
    metrics.onboardings_count++;
    metrics.last_extraction = hotel_name;
    metrics.api_hits += uniquePois.length;

    // ── Sauvegarde dans Supabase ──
    if (supabase) {
      try {
        await supabase.from("hotels_data").upsert({
          hotel_name: hotel_name,
          data: result,
          updated_at: new Date().toISOString()
        }, { onConflict: 'hotel_name' });
      } catch (dbError) {
        console.error("❌ Erreur Supabase :", dbError);
      }
    }

    res.json(result);

  } catch (error) {
    metrics.errors++;
    console.error(error);
    res.status(500).json({ error: "Échec du pipeline" });
  }
});

// ── API Chat avec Léon ──────────────────────────
app.post("/api/chat", async (req, res) => {
  const { message, history = [], hotelContext } = req.body;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  try {
    const hotelName  = hotelContext?.hotel_name  ?? "notre hôtel";
    const suburb     = hotelContext?.coords?.suburb  ?? "ce quartier";
    const wikiSummary = hotelContext?.wiki?.summary ?? "";
    const poisSample = (hotelContext?.pois ?? []).slice(0, 5).map((p: any) => p.name).join(", ");

    const systemPrompt = `Tu es Léon, concierge à ${hotelName}. Quartier: ${suburb}. ${wikiSummary.slice(0, 200)}. Proche: ${poisSample}.`;

    const chatHistory = history.slice(-6).map((m: any) => ({
      role: m.role === "leon" ? "assistant" : "user",
      content: m.content,
    }));

    if (OPENROUTER_API_KEY) {
      const orRes = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...chatHistory, { role: "user", content: message }],
      }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` } });
      res.json({ reply: orRes.data?.choices?.[0]?.message?.content });
    } else {
      res.json({ reply: "Léon est en pause café. ☕" });
    }
  } catch (e) {
    res.status(500).json({ reply: "Erreur de connexion. 🛎️" });
  }
});

// VITE MIDDLEWARE
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Serveur actif sur http://localhost:${PORT}`));
}
startServer();
