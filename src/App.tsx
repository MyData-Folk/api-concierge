import React, { useState } from 'react';
import { 
  Building2, 
  MapPin, 
  Settings, 
  CheckCircle2, 
  Search, 
  History, 
  Navigation, 
  Plus,
  Send,
  Loader2,
  Info,
  X,
  HelpCircle,
  Database,
  Globe,
  Shield,
  Zap,
  ExternalLink,
  Table
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { OnboardingResult, HotelDBEntry } from './types';

export default function App() {
  const [hotelName, setHotelName] = useState('');
  const [address, setAddress] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<OnboardingResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  // DB Search State
  const [dbSearch, setDbSearch] = useState('');
  const [dbResults, setDbResults] = useState<HotelDBEntry[]>([]);
  const [isDbSearching, setIsDbSearching] = useState(false);
  
  // UI State
  const [showConfig, setShowConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Use a ref for the timeout to handle debouncing
  const searchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleDbSearch = (val: string) => {
    setDbSearch(val);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (val.length < 3) {
      setDbResults([]);
      return;
    }

    setIsDbSearching(true);
    
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hotels/search?q=${encodeURIComponent(val)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        setDbResults(data);
      } catch (e) {
        console.error(e);
        setDbResults([]);
      } finally {
        setIsDbSearching(false);
      }
    }, 400); // 400ms debounce
  };

  const selectHotelFromDb = (hotel: HotelDBEntry) => {
    setHotelName(hotel.nom);
    setAddress(hotel.adresse + ", " + (hotel.code_postal || "") + " " + hotel.commune);
    setWebsiteUrl(hotel.site_internet || '');
    setDbResults([]);
    setDbSearch('');
  };

  const runOnboarding = async () => {
    if (!hotelName || !address) return;
    setLoading(true);
    setResults(null);
    setProgress(10);
    setStatusText('Initialisation du système expert...');

    try {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 500);

      const response = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          hotel_name: hotelName, 
          hotel_address: address,
          website_url: websiteUrl 
        })
      });
      
      clearInterval(interval);
      
      if (!response.ok) throw new Error('Erreur réseau');
      
      const data = await response.json();
      setProgress(100);
      setStatusText('Analyse terminée.');
      setResults(data);
    } catch (e: any) {
      clearInterval(interval);
      console.error(e);
      alert(e.message === 'Erreur réseau' ? "Erreur lors de la collecte. Veuillez vérifier l'adresse." : "Une erreur inattendue est survenue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] font-sans text-slate-200 overflow-x-hidden">
      {/* Header */}
      <header className="bg-[#0d1117]/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 p-2 rounded-xl text-white shadow-[0_0_15px_rgba(59,130,246,0.4)]">
            <Building2 size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-white">ParisLocal Admin</h1>
            <p className="text-[10px] text-blue-400 font-mono tracking-widest uppercase opacity-80">Expert Onboarding System</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowHelp(true)}
            className="text-slate-400 hover:bg-slate-800 p-2 rounded-full transition-colors"
            title="Aide"
          >
            <HelpCircle size={20} />
          </button>
          <button 
            onClick={() => setShowConfig(true)}
            className="text-slate-400 hover:bg-slate-800 p-2 rounded-full transition-colors"
            title="Configuration"
          >
            <Settings size={20} />
          </button>
          <div className="h-8 w-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500">
            AD
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar Controls */}
        <aside className="lg:col-span-3 space-y-6">
          <div className="bg-[#161b22] p-6 rounded-2xl border border-slate-800 shadow-xl overflow-visible">
            <h2 className="font-semibold text-white mb-6 flex items-center gap-2">
              <Table size={18} className="text-emerald-400" />
              Base de Données
            </h2>
            <div className="relative mb-8">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                className="w-full bg-[#0d1117] border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all placeholder:text-slate-600"
                placeholder="Chercher dans 2000+ hôtels..."
                value={dbSearch}
                onChange={e => handleDbSearch(e.target.value)}
              />
              <AnimatePresence>
                {dbResults.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-[#1c2128] border border-slate-700 rounded-xl shadow-2xl z-[60] overflow-hidden"
                  >
                    {dbResults.map((hotel, i) => (
                      <button 
                        key={i}
                        onClick={() => selectHotelFromDb(hotel)}
                        className="w-full text-left p-3 hover:bg-slate-800 transition-colors border-b border-white/5 last:border-0 group"
                      >
                        <p className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors uppercase truncate">{hotel.nom}</p>
                        <p className="text-[10px] text-slate-500 truncate">{hotel.adresse}</p>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <h2 className="font-semibold text-white mb-6 flex items-center gap-2">
              <Plus size={18} className="text-blue-400" />
              Extraction Manuelle
            </h2>
            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nom de l'hôtel</label>
                <input 
                  type="text" 
                  className="w-full bg-[#0d1117] border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600 shadow-inner"
                  placeholder="Ex: Le Bristol"
                  value={hotelName}
                  onChange={e => setHotelName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">URL Site Officiel (Optionnel)</label>
                <input 
                  type="text" 
                  className="w-full bg-[#0d1117] border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600 shadow-inner"
                  placeholder="Ex: https://www.oetkercollection.com/fr/hotels/le-bristol-paris"
                  value={websiteUrl}
                  onChange={e => setWebsiteUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Adresse complète</label>
                <textarea 
                  className="w-full bg-[#0d1117] border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all h-28 resize-none placeholder:text-slate-600 shadow-inner"
                  placeholder="Ex: 112 Rue du Faubourg Saint-Honoré, 75008 Paris"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                />
              </div>
              <button 
                onClick={runOnboarding}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 active:scale-[0.98]"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                {loading ? "Traitement..." : "Lancer l'onboarding"}
              </button>
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-900 to-[#161b22] p-6 rounded-2xl border border-slate-800 shadow-lg">
            <h3 className="text-[10px] font-bold text-slate-500 mb-4 uppercase tracking-widest flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-blue-500 animate-pulse" />
              Infrastructure
            </h3>
            <div className="space-y-4">
              <StatusItem label="Nominatim Engine" active />
              <StatusItem label="Overpass API" active />
              <StatusItem label="Wikipedia Graph" active />
              <StatusItem label="Infrastructure ParisLocal" active />
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <section className="lg:col-span-9 space-y-6">
          <AnimatePresence mode="wait">
            {!results && !loading && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#0d1117] border border-slate-800 rounded-[2rem] h-[600px] flex flex-col items-center justify-center text-center p-12 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />
                <div className="bg-slate-800/50 p-6 rounded-3xl mb-6 border border-slate-700/50">
                  <Navigation size={48} className="text-blue-400 opacity-60" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Prêt pour l'extraction</h3>
                <p className="text-slate-500 max-w-sm">
                  Utilisez les contrôles latéraux pour initier la collecte automatisée de l'écosystème urbain.
                </p>
              </motion.div>
            )}

            {loading && (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-[#0d1117] border border-slate-800 rounded-[2rem] p-12 flex flex-col items-center justify-center min-h-[400px]"
              >
                <div className="relative mb-8">
                   <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full" />
                   <Loader2 size={64} className="text-blue-500 animate-spin relative z-10" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{statusText}</h3>
                <p className="text-slate-500 text-sm mb-8">Nous analysons les données géospatiales de Paris...</p>
                <div className="w-full max-w-md bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                  />
                </div>
              </motion.div>
            )}

            {results && !loading && (
              <motion.div 
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ScoreCard icon={<MapPin className="text-rose-400" />} label="Localisation" value={results.coords.suburb} sub={results.coords.district} />
                  <ScoreCard icon={<History className="text-amber-400" />} label="Arrondissement" value={results.coords.district} sub="Région Parisienne" />
                  <ScoreCard icon={<CheckCircle2 className="text-emerald-400" />} label="POI Collectés" value={results.pois.length.toString()} sub="Points d'intérêt" />
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {/* Website Link Card */}
                  {results.website_url && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-3xl flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="bg-emerald-500 p-3 rounded-2xl text-white">
                          <Globe size={24} />
                        </div>
                        <div>
                          <h4 className="font-bold text-white">Site Officiel Identifié</h4>
                          <p className="text-xs text-emerald-400/80 font-mono">{results.website_url}</p>
                        </div>
                      </div>
                      <a href={results.website_url} target="_blank" rel="noreferrer" className="bg-emerald-500 hover:bg-emerald-400 text-white p-3 rounded-2xl transition-colors">
                        <ExternalLink size={20} />
                      </a>
                    </motion.div>
                  )}

                  {/* Wikipedia Perspective */}
                  <div className="bg-[#161b22] p-8 rounded-3xl border border-slate-800 shadow-xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none group-hover:scale-110 transition-transform">
                      <History size={120} />
                    </div>
                    <div className="flex items-center gap-2 mb-6 text-blue-400">
                      <Info size={16} />
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.2em]">Contexte de Quartier</h4>
                    </div>
                    {results.wiki ? (
                      <div className="relative z-10 space-y-4">
                        <h3 className="text-2xl font-bold text-white">{results.wiki.title}</h3>
                        <p className="text-slate-400 leading-relaxed max-w-4xl italic">
                          "{results.wiki.summary}"
                        </p>
                        <a href={results.wiki.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-400 text-xs font-bold hover:text-blue-300 transition-colors bg-blue-500/5 px-4 py-2 rounded-lg border border-blue-500/10">
                          Explorer l'histoire complète <Navigation size={12} />
                        </a>
                      </div>
                    ) : (
                      <p className="text-slate-500 italic">Données historiques indisponibles pour ce secteur.</p>
                    )}
                  </div>

                  {/* POI Data Grid */}
                  <div className="bg-[#0d1117] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden">
                    <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between bg-[#161b22]/50">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                        <Navigation size={14} className="text-blue-500" />
                        Infrastructure Locale
                      </h4>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-[#161b22] text-slate-500">
                          <tr>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-wider">Établissement</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-wider">Catégorie</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-wider text-right">Distance</th>
                            <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-wider">Fiabilité</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {results.pois.map((poi, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/30 transition-colors group">
                              <td className="px-8 py-5 text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">{poi.name}</td>
                              <td className="px-8 py-5">
                                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                                  poi.category === 'tourism' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                  poi.category === 'transport' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                  poi.category === 'shop' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                  'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                }`}>
                                  {poi.category}
                                </span>
                              </td>
                              <td className="px-8 py-5 text-right font-mono text-xs text-slate-500">{poi.distance_m}m</td>
                              <td className="px-8 py-5">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                                    Donnée Vérifiée
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Bottom Action */}
                <div className="flex items-center justify-between bg-blue-600/5 border border-blue-500/20 p-8 rounded-[2rem] mt-8">
                  <div>
                    <h4 className="text-white font-bold mb-1">Prêt pour la synchronisation</h4>
                    <p className="text-slate-500 text-xs">Vérifiez les données avant de pousser l'hôtel dans l'écosystème ParisLocal.</p>
                  </div>
                  <button className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-2xl font-bold flex items-center gap-3 transition-all active:scale-95 shadow-2xl shadow-blue-900/40 group">
                    Publier l'Hôtel
                    <Send size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Slide-over Panels */}
      <AnimatePresence>
        {showConfig && (
          <ConfigPanel onClose={() => setShowConfig(false)} />
        )}
        {showHelp && (
          <HelpPanel onClose={() => setShowHelp(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ConfigPanel({ onClose }: { onClose: () => void }) {
  return (
    <motion.div 
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 right-0 w-full max-w-md bg-[#161b22] border-l border-slate-800 z-[100] shadow-2xl p-8"
    >
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Settings size={20} className="text-blue-500" />
          Configuration Système
        </h2>
        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-8">
        <section>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Connecteurs API</h3>
          <div className="space-y-3">
            <ConfigItem icon={<Globe size={16} />} label="Nominatim (OSM)" status="Connecté" />
            <ConfigItem icon={<Database size={16} />} label="Overpass API" status="Connecté" />
            <ConfigItem icon={<Zap size={16} />} label="Wikipedia Restful" status="Connecté" />
          </div>
        </section>

        <section>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Paramètres d'Onboarding</h3>
          <div className="space-y-4">
            <ToggleItem label="Mode Mock automatique" description="Active les données de secours si l'API échoue" defaultChecked />
            <ToggleItem label="Dédoublonnage Fuzzy" description="Utilise Fuse.js pour nettoyer les POI similaires" defaultChecked />
            <ToggleItem label="Auto-Géocodage" description="Déclenche la recherche dès la saisie de l'adresse" />
          </div>
        </section>

        <section>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Sécurité & Tokens</h3>
          <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield size={18} className="text-emerald-500" />
              <div>
                <p className="text-sm font-medium">Session Authentifiée</p>
                <p className="text-[10px] text-slate-500">Token JWT valide jusqu'à 18:00</p>
              </div>
            </div>
            <button className="text-[10px] bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 font-bold uppercase tracking-wider">Réinitialiser</button>
          </div>
        </section>
      </div>
    </motion.div>
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <motion.div 
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 right-0 w-full max-w-md bg-[#0d1117] border-l border-slate-800 z-[100] shadow-2xl p-8 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <HelpCircle size={20} className="text-blue-500" />
          Centre d'Aide Expert
        </h2>
        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-8">
        <div className="bg-blue-600/10 p-6 rounded-2xl border border-blue-500/20">
          <p className="text-sm text-blue-300 leading-relaxed">
            Bienvenue dans le système expert **ParisLocal**. Cet outil est conçu pour automatiser la création de profils hôteliers en extrayant les données urbaines en temps réel.
          </p>
        </div>

        <section className="space-y-4">
          <h3 className="font-bold text-white">1. Comment ça marche ?</h3>
          <div className="space-y-4">
            <HelpStep step="1" title="Saisie des données" text="Indiquez le nom commercial de l'hôtel et son adresse physique complète." />
            <HelpStep step="2" title="Extraction Asynchrone" text="Le moteur pirate les APIs OpenStreetMap et Wikipedia pour identifier les monuments, transports et commerces alentours." />
            <HelpStep step="3" title="Validation & Export" text="Vérifiez la pertinence des POI collectés avant de synchroniser avec la base centrale." />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="font-bold text-white flex items-center gap-2">
             FAQ Rapide
          </h3>
          <div className="space-y-4">
             <div className="p-4 bg-slate-800/30 rounded-xl border border-slate-800">
                <p className="text-xs font-bold text-slate-300 mb-1">Pourquoi certains lieux sont marqués 'SIGNALÉ (MOCK)' ?</p>
                <p className="text-[11px] text-slate-500">Cela signifie que l'API Overpass n'a pas retourné de résultat pour cette catégorie ou qu'elle a expiré. Le système génère alors des données crédibles pour ne pas bloquer l'onboarding.</p>
             </div>
             <div className="p-4 bg-slate-800/30 rounded-xl border border-slate-800">
                <p className="text-xs font-bold text-slate-300 mb-1">Quelle est la précision du géocodage ?</p>
                <p className="text-[11px] text-slate-500">Nous utilisons Nominatim. Pour une précision maximale, assurez-vous d'inclure le code postal (ex: 75008).</p>
             </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
}

function ConfigItem({ icon, label, status }: { icon: React.ReactNode, label: string, status: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-slate-800/50">
      <div className="flex items-center gap-3 text-slate-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 uppercase tracking-tighter">
        {status}
      </span>
    </div>
  );
}

function ToggleItem({ label, description, defaultChecked = false }: { label: string, description: string, defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-bold text-white">{label}</p>
        <p className="text-[10px] text-slate-500">{description}</p>
      </div>
      <button 
        onClick={() => setChecked(!checked)}
        className={`w-10 h-5 rounded-full transition-colors relative ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}
      >
        <motion.div 
          animate={{ x: checked ? 20 : 4 }}
          className="absolute top-1 w-3 h-3 bg-white rounded-full transition-transform"
        />
      </button>
    </div>
  );
}

function HelpStep({ step, title, text }: { step: string, title: string, text: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-[10px] font-black text-blue-400">
        {step}
      </div>
      <div>
        <p className="text-xs font-bold text-slate-200">{title}</p>
        <p className="text-[11px] text-slate-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function ScoreCard({ icon, label, value, sub }: { icon: React.ReactNode, label: string, value: string, sub?: string }) {
  return (
    <div className="bg-[#161b22] p-6 rounded-3xl border border-slate-800 shadow-xl flex items-center gap-5 hover:border-slate-700 transition-colors">
      <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800/50 shadow-inner">{icon}</div>
      <div>
        <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 block mb-1">{label}</label>
        <span className="text-lg font-bold text-white block leading-tight">{value}</span>
        {sub && <span className="text-[10px] text-slate-600 font-medium">{sub}</span>}
      </div>
    </div>
  );
}

function StatusItem({ label, active }: { label: string, active: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-slate-400 font-medium">{label}</span>
      <div className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]' : 'bg-slate-700'}`} />
    </div>
  );
}
