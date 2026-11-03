export interface ImageInfo {
  mimeType: "image/png" | "image/jpeg" | "image/svg+xml";
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Marqueurs JPEG « début de trame » qui portent les dimensions (hors tables de Huffman C4, JPG C8 et arithmétique CC). */
const isStartOfFrame = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

function pngInfo(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  // Le premier bloc doit être IHDR (largeur et hauteur sur 4 octets chacune).
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegInfo(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // octets de remplissage
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // marqueurs sans longueur
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) return null;
      return { mimeType: "image/jpeg", height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Éléments SVG acceptés : formes, textes, dégradés et découpes. Tout le reste (script, foreignObject, image, a, animate,
 * set, iframe…) est refusé : un SVG est un document actif, on n'en garde que le dessin.
 */
const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "use", "style",
]);

const SVG_TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const SVG_ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Une valeur ne peut renvoyer qu'à un élément du même fichier (#id) : jamais à une adresse, un script ou des données. */
function isSafeSvgValue(name: string, value: string): boolean {
  if (/javascript:|data:|vbscript:|expression\(/i.test(value)) return false;
  if (/url\(\s*(?!['"]?#)/i.test(value)) return false;
  return name === "href" || name === "xlink:href" ? /^#[\w.-]+$/.test(value) : true;
}

function parseLength(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

function svgInfo(bytes: Buffer): ImageInfo | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.includes("\0")) return null;
  text = text.replace(/^﻿/, "").replace(/^\s*<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!text.startsWith("<svg") || /<!(?:DOCTYPE|ENTITY|\[CDATA)/i.test(text) || /<\?/.test(text)) return null;

  let root: Record<string, string> | null = null;
  let depth = 0;
  let inStyle = false;
  let styleText = "";
  let position = 0;
  while (position < text.length) {
    const next = text.indexOf("<", position);
    const content = text.slice(position, next === -1 ? text.length : next);
    if (inStyle) styleText += content;
    if (next === -1) break;
    SVG_TAG.lastIndex = next;
    const tag = SVG_TAG.exec(text);
    if (!tag) return null;
    const [whole, closing, rawName, rawAttributes, selfClosing] = tag as unknown as [string, string, string, string, string];
    const name = rawName.toLowerCase();
    if (!SVG_ELEMENTS.has(name)) return null;

    if (closing) {
      depth -= 1;
      if (name === "style") inStyle = false;
      if (depth < 0 || (depth === 0 && name !== "svg")) return null;
    } else {
      if (depth === 0 && (root !== null || name !== "svg")) return null;
      const attributes: Record<string, string> = {};
      for (const match of rawAttributes.matchAll(SVG_ATTRIBUTE)) {
        const attribute = match[1]!.toLowerCase();
        const value = match[2] ?? match[3] ?? "";
        if (attribute.startsWith("on") || !isSafeSvgValue(attribute, value)) return null;
        attributes[attribute] = value;
      }
      if (depth === 0) root = attributes;
      if (!selfClosing) {
        depth += 1;
        if (name === "style") inStyle = true;
      }
    }
    position = next + whole.length;
  }
  if (depth !== 0 || !root || /@import|expression\(|javascript:|url\(\s*(?!['"]?#)/i.test(styleText)) return null;

  const box = root["viewbox"]?.trim().split(/[\s,]+/).map(Number);
  const width = box && box.length === 4 ? box[2]! : parseLength(root["width"]);
  const height = box && box.length === 4 ? box[3]! : parseLength(root["height"]);
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { mimeType: "image/svg+xml", width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** Type et dimensions d'une image PNG, JPEG ou SVG d'après son contenu (jamais son nom) ; null si ce n'en est pas une (ou si un SVG n'est pas sûr). */
export function readImageInfo(bytes: Buffer): ImageInfo | null {
  return pngInfo(bytes) ?? jpegInfo(bytes) ?? svgInfo(bytes);
}
