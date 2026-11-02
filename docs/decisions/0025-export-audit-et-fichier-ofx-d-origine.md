# ADR 0025 — Export du journal d'audit et conservation du fichier OFX d'origine

Statut : retenu (2 novembre 2026), décisions prises à la réalisation sur la base de la feuille de route (éléments 3.6 et 2.6) ; **à relire**. Applique les [ADR 0021](0021-etat-de-tresorerie-et-exports-surs.md) (exports sûrs) et [0015](0015-import-ofx.md) (import OFX), et le lot documents (cadrage §18).

## Export du journal d'audit (3.6)

1. **Route** `GET /audit/csv` sous `audit:view`, avec les mêmes filtres que la liste (action, type d'objet, objet, acteur, période). L'écran d'audit propose « Exporter (CSV) » et exporte **les critères réellement recherchés**, pas ceux saisis sans avoir lancé la recherche.
2. **Contenu** : dans l'ordre **chronologique** (du plus ancien au plus récent), avec pour chaque événement son numéro, sa date (UTC), l'acteur (nom et email), l'action (code stable), l'objet, la justification, les détails (JSON) et **son empreinte et celle du précédent**. Le fichier peut ainsi être comparé au journal par la vérification d'intégrité, et conservé hors de l'application. En-tête : date d'export, filtres, nombre d'événements, et la mention que **c'est une copie de contrôle, pas un archivage à valeur probante** (cadrage §11.2).
3. **Sûr** : CSV côté serveur sans dépendance, texte neutralisé contre l'injection de formules, pièce jointe, `no-store`, `nosniff` (ADR 0021). Les événements antérieurs à la chaîne sont exportés avec des empreintes vides.
4. **Limite** : **20 000 événements** au plus ; au-delà, **refus 422** avec un message qui invite à restreindre la période ou les filtres, jamais de troncature silencieuse.
5. **Tracé** : l'export est lui-même consigné (`report.exported`, `kind: audit`, nombre d'événements et filtres, **sans contenu**), après coup : il ne se contient pas, l'export suivant le contient.

## Conservation du fichier OFX d'origine (2.6)

1. **Quand** : à l'**analyse** d'un import, avant la création du lot. Le fichier est conservé comme **document** (catégorie « Relevé », titre « Relevé OFX — compte — nom du fichier »), **relié à l'import** par un lien de type `import` (nouveau type d'objet liable). Si la conservation échoue, l'analyse échoue : rien n'est gardé à moitié. Si le lot ne peut pas être créé, le document est archivé.
2. **Restreint par défaut.** Un relevé porte des identifiants de compte et des soldes : le document est **restreint** (`documents.restricted:view`), donc invisible (404) pour les autres rôles, y compris ceux qui lisent les documents ; son téléchargement est audité. Il est déposé « au nom » de la personne qui importe, par l'application (même si elle n'a pas le droit de lire les restreints). Les personnes limitées à un projet ne le voient jamais (aucun lien de projet, ADR 0024 tranche 4.5).
3. **Annulation.** Annuler une analyse **archive** son document (rien n'a été importé, ce n'est plus une preuve) ; il reste lisible en base, pas dans la liste par défaut. Un import confirmé garde son document.
4. **Type de fichier réservé au système.** `ofx` n'est **pas** ajouté à la liste blanche du dépôt ordinaire (`ALLOWED_EXTENSIONS` inchangé, un dépôt manuel d'un `.ofx` reste refusé en 415) : `detectFileType(…, { system: true })` l'accepte seulement pour ce dépôt interne, avec les mêmes contrôles (contenu **et** extension : `OFXHEADER` ou balise `<OFX>`, aucun octet nul, encodage libre car l'OFX 1.x est souvent en Windows-1252). Servi comme `application/x-ofx`, toujours en pièce jointe avec `nosniff` et `Content-Security-Policy: sandbox`.
5. **Nom.** Le nom du fichier est nettoyé comme tout nom ; l'extension `.ofx` est ajoutée si l'original n'en a pas (le contenu n'est jamais modifié). L'empreinte du document est celle de l'import.
6. **Web.** Le panneau d'import écrit que le fichier est conservé, et propose son téléchargement à qui peut lire les documents **et** les documents restreints.

## Hors de ce lot

- Plusieurs analyses du même fichier créent chacune leur document (celles annulées sont archivées) ; pas de dédoublonnage par empreinte, pour que chaque import ait sa propre preuve.
- Export du journal en d'autres formats, ou en continu vers un stockage externe : non fait.
- Dépôt de documents liés aux **transactions importées** (le lien est porté par l'import, pas par chaque transaction).
