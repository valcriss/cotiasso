/**
 * Analyseur OFX 1.x (SGML) et 2.x (XML) pour des relevés de comptes bancaires en euro.
 *
 * Écrit pour l'occasion plutôt qu'avec un analyseur XML : aucune entité, DTD ni ressource externe n'est jamais lue ou
 * résolue, par construction. Toute variante non prise en charge (cartes, placements, plusieurs comptes, autre devise,
 * fichier tronqué) est refusée explicitement, jamais acceptée avec un traitement partiel. Une ligne défectueuse est
 * signalée avec sa raison sans empêcher l'analyse des autres.
 */

export class OfxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfxError";
  }
}

export interface OfxLine {
  /** Rang de l'opération dans le fichier, à partir de 1. */
  index: number;
  /** Champs de l'opération tels que lus, sans réécriture (les valeurs sont conservées comme chaînes). */
  raw: Record<string, string>;
  fitId: string | null;
  /** Date d'opération (AAAA-MM-JJ), ou `null` si illisible. */
  date: string | null;
  /** Montant signé en chaîne décimale à deux décimales, ou `null` si illisible. */
  amount: string | null;
  label: string;
  reference: string | null;
  errors: string[];
}

export interface OfxStatement {
  format: "SGML" | "XML";
  account: { bankId: string | null; accountId: string | null; type: string | null };
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  ledgerBalance: { amount: string; date: string | null } | null;
  lines: OfxLine[];
}

interface Node {
  name: string;
  children: Node[];
  value: string | null;
}

/** Agrégats qui portent des enfants (les autres balises sont des feuilles avec une valeur). */
const REJECTED_AGGREGATES: Record<string, string> = {
  CCSTMTRS: "relevés de carte bancaire",
  CCSTMTTRNRS: "relevés de carte bancaire",
  CREDITCARDMSGSRSV1: "relevés de carte bancaire",
  INVSTMTRS: "comptes de placement",
  INVSTMTTRNRS: "comptes de placement",
  INVSTMTMSGSRSV1: "comptes de placement",
  SECLISTMSGSRSV1: "comptes de placement",
  LOANSTMTTRNRS: "prêts",
  BILLPAYMSGSRSV1: "paiements de factures",
};

const DECODERS = new Map<string, string>([
  ["1252", "windows-1252"],
  ["WINDOWS-1252", "windows-1252"],
  ["CP1252", "windows-1252"],
  ["8859-1", "iso-8859-1"],
  ["ISO-8859-1", "iso-8859-1"],
  ["UTF-8", "utf-8"],
  ["UTF8", "utf-8"],
  ["USASCII", "utf-8"],
  ["US-ASCII", "utf-8"],
  ["ASCII", "utf-8"],
]);

function decodeText(bytes: Buffer): { text: string; xml: boolean } {
  if (bytes.length === 0) throw new OfxError("Le fichier est vide.");
  // Les en-têtes sont en ASCII quel que soit l'encodage du corps : on les lit d'abord pour choisir le décodage.
  const head = bytes.subarray(0, 1024).toString("latin1");
  const xml = /^\s*(?:﻿|\xEF\xBB\xBF)?<\?xml/i.test(head);
  let label: string | undefined;
  if (xml) {
    label = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  } else {
    const charset = /^\s*CHARSET\s*:\s*(\S+)/im.exec(head)?.[1];
    const encoding = /^\s*ENCODING\s*:\s*(\S+)/im.exec(head)?.[1];
    label = charset && charset.toUpperCase() !== "NONE" ? charset : encoding;
  }
  const decoder = label ? DECODERS.get(label.toUpperCase()) : "utf-8";
  if (!decoder) throw new OfxError(`Encodage « ${label} » non pris en charge (UTF-8, Windows-1252 et ISO-8859-1 le sont).`);
  const text = new TextDecoder(decoder, { fatal: decoder === "utf-8" }).decode(bytes);
  return { text: text.replace(/^﻿/, ""), xml };
}

/** Construit l'arbre des balises, pour les deux variantes : une balise feuille se ferme implicitement en SGML. */
function buildTree(body: string): Node {
  const root: Node = { name: "#root", children: [], value: null };
  const stack: Node[] = [root];
  const token = /<(\/?)([A-Za-z][A-Za-z0-9._-]*)\s*\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(body)) !== null) {
    const top = stack[stack.length - 1]!;
    if (match[3] !== undefined) {
      const text = match[3].trim();
      if (text !== "") {
        if (top === root) throw new OfxError("Contenu inattendu en dehors des balises OFX.");
        top.value = (top.value ?? "") + text;
      }
      continue;
    }
    const closing = match[1] === "/";
    const name = match[2]!.toUpperCase();
    if (closing) {
      // Ferme jusqu'à la balise correspondante (les feuilles SGML ouvertes sont fermées au passage).
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at <= 0) throw new OfxError(`Balise fermante </${name}> sans balise ouvrante.`);
      stack.length = at;
      continue;
    }
    // Une feuille qui a déjà une valeur se ferme implicitement à l'ouverture de la balise suivante (SGML).
    while (stack.length > 1 && stack[stack.length - 1]!.value !== null) stack.pop();
    const node: Node = { name, children: [], value: null };
    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return root;
}

const find = (node: Node, name: string): Node | undefined => node.children.find((c) => c.name === name);
const text = (node: Node | undefined, name: string): string | null => {
  const value = node ? find(node, name)?.value : null;
  return value === undefined || value === null || value === "" ? null : value;
};

function walkRejected(node: Node): string | null {
  const rejected = REJECTED_AGGREGATES[node.name];
  if (rejected) return rejected;
  for (const child of node.children) {
    const found = walkRejected(child);
    if (found) return found;
  }
  return null;
}

/** Date OFX (AAAAMMJJ[HHMMSS[.XXX]][[±fuseau]]) → AAAA-MM-JJ ; `null` si absente ou invalide. */
export function parseOfxDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?)?(?:\[[^\]]*\])?$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/** Montant OFX (point ou virgule décimale, deux décimales au plus) → chaîne signée à deux décimales ; `null` sinon. */
export function parseOfxAmount(value: string | null): string | null {
  if (!value) return null;
  const match = /^([+-]?)(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  // Calcul en centimes entiers : jamais de flottant pour un montant.
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const sign = match[1] === "-" && cents > 0 ? "-" : "";
  return `${sign}${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function parseOfx(bytes: Buffer): OfxStatement {
  const { text: content, xml } = decodeText(bytes);
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(content)) {
    throw new OfxError("Le fichier contient une déclaration DOCTYPE, ENTITY ou CDATA, non prise en charge.");
  }
  const start = content.search(/<OFX\b/i);
  if (start < 0) throw new OfxError("Ce fichier n'est pas un fichier OFX (balise <OFX> absente).");
  if (!/<\/OFX\s*>/i.test(content)) throw new OfxError("Le fichier OFX est incomplet (balise </OFX> absente) : il semble tronqué.");

  const tree = buildTree(content.slice(start).replace(/<\/OFX\s*>[\s\S]*$/i, "</OFX>"));
  const ofx = find(tree, "OFX");
  if (!ofx) throw new OfxError("Ce fichier n'est pas un fichier OFX.");

  const rejected = walkRejected(ofx);
  if (rejected) throw new OfxError(`Ce fichier contient des ${rejected} : seuls les relevés de comptes bancaires sont pris en charge.`);

  const status = find(find(ofx, "SIGNONMSGSRSV1") ?? ofx, "SONRS");
  const signonCode = text(status ? find(status, "STATUS") : undefined, "CODE");
  if (signonCode !== null && signonCode !== "0") {
    throw new OfxError(`La banque signale une erreur (code ${signonCode}) : ${text(find(status!, "STATUS")!, "MESSAGE") ?? "relevé non fourni"}.`);
  }

  const bank = find(ofx, "BANKMSGSRSV1");
  if (!bank) throw new OfxError("Aucun relevé de compte bancaire dans ce fichier.");
  const responses = bank.children.filter((c) => c.name === "STMTTRNRS");
  if (responses.length === 0) throw new OfxError("Aucun relevé de compte bancaire dans ce fichier.");
  if (responses.length > 1) {
    throw new OfxError("Ce fichier contient plusieurs comptes : exportez un fichier par compte.");
  }
  const response = responses[0]!;
  const responseCode = text(find(response, "STATUS"), "CODE");
  if (responseCode !== null && responseCode !== "0") {
    throw new OfxError(`La banque signale une erreur de relevé (code ${responseCode}).`);
  }
  const statement = find(response, "STMTRS");
  if (!statement) throw new OfxError("Le relevé de compte est absent du fichier.");

  const currency = (text(statement, "CURDEF") ?? "").toUpperCase();
  if (currency === "") throw new OfxError("La devise du relevé n'est pas indiquée.");
  if (currency !== "EUR") throw new OfxError(`Devise « ${currency} » non prise en charge : seul l'euro l'est.`);

  const from = find(statement, "BANKACCTFROM");
  const list = find(statement, "BANKTRANLIST");
  const ledger = find(statement, "LEDGERBAL");
  const balanceAmount = ledger ? parseOfxAmount(text(ledger, "BALAMT")) : null;

  const lines: OfxLine[] = (list?.children ?? [])
    .filter((c) => c.name === "STMTTRN")
    .map((trn, position) => {
      const raw: Record<string, string> = {};
      for (const field of trn.children) if (field.value !== null) raw[field.name] = field.value;

      const errors: string[] = [];
      const fitId = text(trn, "FITID");
      if (!fitId) errors.push("Identifiant bancaire (FITID) absent : la ligne ne peut pas être importée sans risque de doublon.");
      const date = parseOfxDate(text(trn, "DTPOSTED") ?? text(trn, "DTUSER"));
      if (!date) errors.push("Date d'opération absente ou illisible.");
      const rawAmount = text(trn, "TRNAMT");
      const amount = parseOfxAmount(rawAmount);
      if (!amount) errors.push(rawAmount ? `Montant illisible ou à plus de deux décimales : « ${rawAmount} ».` : "Montant absent.");
      else if (Number(amount) === 0) errors.push("Montant nul.");

      const name = text(trn, "NAME") ?? text(trn, "PAYEE");
      const memo = text(trn, "MEMO");
      const parts = [name, memo].filter((p): p is string => !!p);
      const label = (parts.length === 2 && parts[0] === parts[1] ? parts[0]! : parts.join(" — ")).slice(0, 200);
      if (label === "") errors.push("Libellé absent.");

      return {
        index: position + 1,
        raw,
        fitId,
        date,
        amount,
        label,
        reference: text(trn, "CHECKNUM") ?? text(trn, "REFNUM"),
        errors,
      };
    });

  return {
    format: xml ? "XML" : "SGML",
    account: { bankId: text(from, "BANKID"), accountId: text(from, "ACCTID"), type: text(from, "ACCTTYPE") },
    currency,
    periodStart: parseOfxDate(text(list, "DTSTART")),
    periodEnd: parseOfxDate(text(list, "DTEND")),
    ledgerBalance: balanceAmount ? { amount: balanceAmount, date: parseOfxDate(text(ledger, "DTASOF")) } : null,
    lines,
  };
}
