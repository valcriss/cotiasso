# 0033 — Logo de l'association

Statut : **Retenu** (3 novembre 2026). Complète l'[ADR 0012](0012-theme-apparence-et-accent.md) (apparence) et le cadrage §8.1 (« nom et logo de l'association en haut »).

## Contexte

Cotiasso est en marque blanche : chaque association doit pouvoir afficher son logo, et non celui du produit, dans le menu, sur la page de connexion, sur les reçus imprimés et (à venir, lot 5.3) dans les emails. La page de connexion étant vue avant toute authentification, le logo doit être servi publiquement, comme le reste de la marque blanche.

## Décision

- **Formats : PNG, JPEG et SVG**, reconnus d'après le contenu et jamais d'après le nom ou le type déclaré. 1 Mo au plus. Pour un PNG ou un JPEG : 32 à 2000 px de côté. Un SVG n'a pas de taille en pixels mais doit déclarer un `viewBox` (ou une largeur et une hauteur).
- **Un SVG est un document actif.** Il n'est accepté que s'il ne contient que du dessin : liste blanche d'éléments (formes, textes, dégradés, découpes, `use`, `style`), aucun gestionnaire `on…`, aucun `href` qui ne soit pas un `#id` du même fichier, aucune `url()` ou `@import` externe, ni DOCTYPE, entité, script, `foreignObject`, `image`, lien ou animation. Un SVG refusé reçoit un message qui dit quoi faire (réexporter en « dessin seul » ou envoyer un PNG). Cette exception à la liste blanche des documents ([lot 1.6](../../CLAUDE.md)) ne concerne que le logo : un dépôt de document SVG reste refusé.
- **Défense en profondeur** : le logo est servi par `GET /branding/logo` (public) avec `X-Content-Type-Options: nosniff` et `Content-Security-Policy: sandbox; default-src 'none'`, et affiché dans une balise `<img>` (qui n'exécute jamais de script).
- **Stockage en base** (`BrandLogo`, `bytea`, ajout seul par déclencheur SQL, clé = empreinte SHA-256) : la sauvegarde existante l'emporte sans dossier à sauvegarder en plus. Le logo en vigueur est désigné par la section de paramètres `logo` (`{ sha256 }`), versionnée et auditée comme tout paramètre ; **changer ou retirer le logo ne supprime jamais une image**. Cette section n'est pas modifiable par l'API générique des paramètres.
- **Routes** : `GET /branding` renvoie en plus `logoHash` (null sans logo) ; `PUT /branding/logo` (multipart) et `DELETE /branding/logo` exigent `settings.association:admin`. Audit `branding.logo.updated` et `branding.logo.removed` (sans contenu).
- **Cache** : l'adresse de l'image contient l'empreinte (`?v=<sha256>`) et l'image est servie avec un `ETag` ; remplacer le logo n'affiche donc jamais l'ancien.
- **Logo seul ou logo et nom** : la section `logo` porte aussi `showName` (vrai par défaut). Faux, le menu n'affiche que le logo (le nom devient son texte alternatif) ; sans logo, le nom s'affiche toujours. `PUT /branding/logo/display` `{ showName }` (`settings.association:admin`, effet immédiat, audit `branding.logo.display-changed`) ; `GET /branding` renvoie `logoShowsName`. Le choix survit au remplacement ou au retrait du logo. Il ne concerne que le menu : la page de connexion et le reçu gardent le nom de l'association en texte.
- **Le favicon reste celui de Cotiasso** pour toutes les associations (un favicon se charge avant tout script et doit rester lisible à 16 px).

## À faire (lot 5.3, emails)

Les clients mail bloquent souvent les images distantes et n'affichent généralement pas le SVG : le logo devra être **converti en PNG et intégré au message** (pièce jointe en ligne), avec le nom de l'association, une phrase qui précise que le lien sert à se connecter à Cotiasso et, en pied de page, le symbole de Cotiasso (« Propulsé par Cotiasso »).

## Limites connues

- Le logo n'est pas adapté au mode sombre : un logo sombre sur fond de menu sombre sera peu lisible. Choisir un logo à fond transparent et des couleurs de menu contrastées.
- Pas de recadrage ni de redimensionnement côté serveur : l'image est affichée telle quelle, contenue dans une zone de taille bornée.
