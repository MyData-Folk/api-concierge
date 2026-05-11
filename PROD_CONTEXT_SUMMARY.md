# ParisLocal - Production Deployment Context Summary

## 🚀 État Actuel
- **Frontend/Backend** : Déployés sur Coolify (Node.js/Vite).
- **Base de Données** : JSON local (`les_hotels_classes_en_ile-de-france.json`) contenant 2030 hôtels, chargée avec succès.
- **API Search** : Fonctionnelle (Fuse.js).
- **GitHub Repo** : `MyData-Folk/api-concierge` (Branche `main`).

## 🔑 Identifiants Configurés (.env)
- **OPENROUTER_API_KEY** : Utilisée pour Léon (Chatbot).
- **SUPABASE_URL** & **SERVICE_ROLE_KEY** : Pour la persistance des données hôtels.
- **Port** : 3000.

## 🛠️ Architecture de Scraping (en cours de fiabilisation)
1. **Géocodage** : Nominatim (OpenStreetMap).
2. **POI Extraction** : Overpass API (OSM). Catégories : Tourism, Transport, Shop, Health.
3. **Context Historique** : Wikipedia Rest API.

## ⚠️ Problèmes à résoudre dans la nouvelle session
1. **Métriques & Export** : Non visibles/actifs malgré le push. Causes probables :
   - Cache de build Coolify (nécessite un "Clear Cache & Deploy").
   - Mismatch entre le build `dist` et le serveur.
2. **Scraping Vide** :
   - Timeout possible de l'API Overpass en production.
   - Nécessité d'ajouter des retries ou un proxy pour les requêtes OSM.
3. **Simulation** : L'endpoint `/api/onboard` a été modifié pour générer un JSON dans `/exports`, mais le dossier doit être persistant dans Docker.

## 📂 Fichiers Clés à surveiller
- `server.ts` : Logique de l'API et du scraping.
- `src/App.tsx` : Dashboard Admin.
- `src/data/` : Base de données hôtels.
- `exports/` : Destination des simulations JSON.
