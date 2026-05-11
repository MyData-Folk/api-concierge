# Utiliser une image Node légère
FROM node:20-slim

# Créer le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le reste du code
COPY . .

# Créer les dossiers nécessaires avec permissions
RUN mkdir -p exports src/data && chmod -R 777 exports src/data

# Construire le frontend Admin (Vite)
RUN npm run build

# Exposer le port du serveur
EXPOSE 3000

# Définir les variables par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Lancer le serveur avec tsx
CMD ["npx", "tsx", "server.ts"]
