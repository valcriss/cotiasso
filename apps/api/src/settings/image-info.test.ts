import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readImageInfo } from "./image-info.js";

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, deflateSync(Buffer.alloc(4))]);
}

/** JPEG minimal : SOI, un bloc APP0 de 16 octets, puis le début de trame (SOF0) avec les dimensions. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

const svg = (body: string, attributes = 'viewBox="0 0 200 100"') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`);

describe("readImageInfo", () => {
  it("lit les dimensions d'un PNG et d'un JPEG d'après leur contenu", () => {
    expect(readImageInfo(png(120, 80))).toEqual({ mimeType: "image/png", width: 120, height: 80 });
    expect(readImageInfo(jpeg(300, 200))).toEqual({ mimeType: "image/jpeg", width: 300, height: 200 });
  });

  it("refuse ce qui n'est pas une image", () => {
    expect(readImageInfo(Buffer.from("%PDF-1.7 ..."))).toBeNull();
    expect(readImageInfo(Buffer.from("<html><body>bonjour</body></html>"))).toBeNull();
    expect(readImageInfo(Buffer.alloc(0))).toBeNull();
    expect(readImageInfo(png(1, 1).subarray(0, 20))).toBeNull();
  });

  it("accepte un SVG qui ne contient que du dessin et lit sa taille dans le viewBox", () => {
    const logo = svg('<title>Club</title><defs><linearGradient id="a"><stop offset="0" stop-color="#005cbb"/></linearGradient></defs><rect width="200" height="100" fill="url(#a)"/><text x="10" y="50">Club</text>');
    expect(readImageInfo(logo)).toEqual({ mimeType: "image/svg+xml", width: 200, height: 100 });
    expect(readImageInfo(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- exporté -->\n${logo.toString()}`))?.mimeType).toBe("image/svg+xml");
    expect(readImageInfo(svg('<circle r="5"/>', 'width="64px" height="32"'))).toEqual({ mimeType: "image/svg+xml", width: 64, height: 32 });
    expect(readImageInfo(svg('<style>.a{fill:#005cbb}</style><path class="a" d="M0 0h10"/><use href="#a"/>'))).not.toBeNull();
  });

  it.each([
    ["un script", '<script>alert(1)</script>'],
    ["un objet étranger", '<foreignObject><div>x</div></foreignObject>'],
    ["une image externe", '<image href="https://exemple.invalid/x.png"/>'],
    ["un lien", '<a href="https://exemple.invalid"><rect width="1" height="1"/></a>'],
    ["une animation", '<rect width="1" height="1"><animate attributeName="href" to="javascript:alert(1)"/></rect>'],
    ["un gestionnaire d'événement", '<rect width="1" height="1" onload="alert(1)"/>'],
    ["un href vers une adresse", '<use href="https://exemple.invalid/x.svg#a"/>'],
    ["un href en javascript", '<use xlink:href="javascript:alert(1)"/>'],
    ["une ressource distante en style", '<rect style="fill:url(https://exemple.invalid/x)" width="1" height="1"/>'],
    ["un import CSS", '<style>@import "https://exemple.invalid/x.css";</style>'],
    ["des données embarquées", '<rect fill="url(data:image/png;base64,AAAA)" width="1" height="1"/>'],
  ])("refuse un SVG avec %s", (_label, body) => {
    expect(readImageInfo(svg(body))).toBeNull();
  });

  it("refuse un SVG avec DOCTYPE, entités ou balise mal formée, ou sans dimensions", () => {
    expect(readImageInfo(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>'))).toBeNull();
    expect(readImageInfo(Buffer.from('<svg viewBox="0 0 1 1"><rect width="1" height="1" </svg>'))).toBeNull();
    expect(readImageInfo(Buffer.from('<svg viewBox="0 0 1 1"><rect/></svg><svg viewBox="0 0 1 1"/>'))).toBeNull();
    expect(readImageInfo(svg('<rect width="1" height="1"/>', ""))).toBeNull();
    expect(readImageInfo(svg('<rect width="1" height="1"/>', 'viewBox="0 0 0 0"'))).toBeNull();
  });
});
