export interface GeoCoordinates {
  lat: number;
  lng: number;
  address: string;
  suburb: string;
  district: string;
}

export interface POI {
  id: string;
  name: string;
  category: string;
  distance_m: number;
  lat: number;
  lng: number;
  source: string;
  description?: string;
}

export interface WikiInfo {
  title: string;
  summary: string;
  url: string;
}

export interface OnboardingResult {
  hotel_name: string;
  coords: GeoCoordinates;
  pois: POI[];
  wiki: WikiInfo | null;
  status: string;
  website_url?: string;
  phone?: string;
  stars?: string;
}

export interface HotelDBEntry {
  nom: string;
  adresse: string;
  commune: string;
  code_postal: number;
  site_internet?: string;
  telephone?: string;
  classement?: string;
  coords?: {
    lat: number;
    lng: number;
  };
}
