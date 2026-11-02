/** Catégories proposées (cadrage §18). Une clé inconnue est refusée. */
export const DOCUMENT_CATEGORIES = {
  convention: "Convention",
  devis: "Devis",
  facture: "Facture",
  releve: "Relevé",
  "compte-rendu": "Compte rendu",
  "proces-verbal": "Procès-verbal",
  autre: "Autre justificatif",
} as const;

export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;

export function isDocumentCategory(value: string): value is DocumentCategory {
  return Object.hasOwn(DOCUMENT_CATEGORIES, value);
}

/** Types d'objets auxquels un document peut être lié ; la liste s'étendra avec les modules concernés. */
export const LINKABLE_OBJECT_TYPES = ["member", "project", "grant", "transaction", "expense", "journal-entry", "import"] as const;

export type LinkableObjectType = (typeof LINKABLE_OBJECT_TYPES)[number];

export function isLinkableObjectType(value: string): value is LinkableObjectType {
  return (LINKABLE_OBJECT_TYPES as readonly string[]).includes(value);
}
