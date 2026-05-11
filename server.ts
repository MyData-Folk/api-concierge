import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import Fuse from "fuse.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

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
  } else {
    console.error(`❌ Fichier de base de données introuvable : ${JSON_PATH}`);
  }
} catch (err) {
  console.error("❌ ERREUR lors du chargement de la base de données:", err);
}

const hotelFuse = new Fuse(hotelDb, {
  keys: ["nom", "adresse"],
  threshold: 0.3,
  includeScore: true
});


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
  const { hotel_name, hotel_address, website_url } = req.body;

  try {
    // 1. GÉOCODAGE (Nominatim)
    const geoResponse = await axios.get(`https://nominatim.openstreetmap.org/search`, {
      params: { q: hotel_address, format: "json", addressdetails: 1, limit: 1 },
      headers: { "User-Agent": "ParisLocal-Onboarding-Agent" }
    });

    if (!geoResponse.data.length) {
      return res.status(404).json({ error: "Adresse introuvable" });
    }

    const loc = geoResponse.data[0];
    const details = loc.address;
    const coords = {
      lat: parseFloat(loc.lat),
      lng: parseFloat(loc.lon),
      address: loc.display_name,
      suburb: details.suburb || details.neighbourhood || "Quartier Inconnu",
      district: details.city_district || "Paris"
    };

    // 2. COLLECTE PARALLÈLE
    // 2. COLLECTE OSM (Requête groupée)
    const overpassCategories = [
      { id: "transport", radius: 600, tags: 'node["railway"~"subway|station"]' },
      { id: "tourism", radius: 1000, tags: 'node["tourism"~"museum|attraction"]' },
      { id: "shop", radius: 500, tags: 'node["shop"~"bakery|supermarket"]' },
      { id: "health", radius: 500, tags: 'node["amenity"~"pharmacy"]' }
    ];

    const osmQuery = `[out:json];(` + 
      overpassCategories.map(c => `${c.tags}(around:${c.radius},${coords.lat},${coords.lng});`).join("") + 
      `);out;`;

    const osmPromise = (async () => {
      try {
        console.log(`[OSM] Exécution de la requête groupée...`);
        const osmRes = await axios.post("https://overpass.openstreetmap.fr/api/interpreter", 
          `data=${encodeURIComponent(osmQuery)}`, 
          {
            timeout: 25000,
            headers: { 
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "ParisLocal-Expert-System/1.0"
            }
          }
        );
        
        const elements = osmRes.data.elements || [];
        console.log(`[OSM] ${elements.length} POI trouvés.`);

        if (!elements.length) return null;

        return elements.map((el: any) => {
          // Identifier la catégorie d'origine
          let category = "other";
          if (el.tags.railway || el.tags.station) category = "transport";
          else if (el.tags.tourism) category = "tourism";
          else if (el.tags.shop) category = "shop";
          else if (el.tags.amenity === "pharmacy") category = "health";

          return {
            id: String(el.id),
            name: el.tags.name || el.tags.operator || `${category} sans nom`,
            category,
            distance_m: Math.round(calculateDistance(coords.lat, coords.lng, el.lat, el.lon)),
            lat: el.lat,
            lng: el.lon,
            source: "OSM"
          };
        });
      } catch (e: any) {
        console.warn(`[OSM] Échec de la requête groupée:`, e.message);
        return null;
      }
    })();

    const wikiQuery = (async () => {
      try {
        const term = coords.district.replace(/ /g, "_") + (coords.district.includes("Paris") ? "" : "_de_Paris");
        console.log(`[WIKI] Recherche perspective: ${term}`);
        const wikiRes = await axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${term}`, {
          timeout: 5000,
          headers: {
            "User-Agent": "ParisLocal-Expert-System/1.0 (contact@hotelmanager.fr)"
          }
        });
        return {
          title: wikiRes.data.title,
          summary: wikiRes.data.extract,
          url: wikiRes.data.content_urls.desktop.page
        };
      } catch (e: any) {
        console.warn(`[WIKI] Erreur:`, e.message);
        return null;
      }
    })();

    const [osmPois, wiki] = await Promise.all([
      osmPromise,
      wikiQuery
    ]);

    // Assemblage final
    let allPois = osmPois || [];
    if (!allPois.length) {
      console.log("[OSM] Aucun POI trouvé à proximité.");
    }
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

    res.json({
      hotel_name,
      coords,
      pois: uniquePois,
      wiki,
      status: "Draft",
      website_url: website_url || null
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Échec du pipeline" });
  }
});

// VITE MIDDLEWARE
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Serveur ParisLocal actif sur http://localhost:${PORT}`);
  });
}

startServer();
