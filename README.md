# FluxTrap

Partage de fichiers P2P chiffré via WebRTC — 100% statique, sans serveur ni hébergement tiers.

## Fonctionnement

1. Déposez un fichier sur la zone de drop
2. Un code à 8 caractères et un QR code sont générés instantanément
3. Le destinataire scanne le QR ou entre le code pour télécharger directement

Le transfert s'effectue en pair-à-pair (WebRTC) avec PeerJS. Aucune donnée ne transite par un serveur. Le fichier est chiffré via AES-256-GCM.

## Déploiement

Ce dossier `public/` est conçu pour GitHub Pages.

1. Pusher sur GitHub
2. Dans Settings > Pages, choisir `public/` comme dossier racine

Ou en local :

```bash
npx serve public/
```

## Stack

- WebRTC via [PeerJS](https://peerjs.com/)
- QR codes via [qrcodejs](https://github.com/davidshimjs/qrcodejs)
- Chiffrement AES-256-GCM intégré
- Stockage localStorage pour l'historique des envois
- Pas de dépendances npm — tout est statique

## Compatibilité

- Chrome / Firefox / Safari / Edge (desktop & mobile)
- Fichiers jusqu'à 500 Mo
- Connexion via serveur de signaling public `0.peerjs.com`

## Licence

MIT
