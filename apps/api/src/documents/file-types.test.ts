import { describe, expect, it } from "vitest";
import { detectFileType, extensionOf, sanitizeFilename } from "./file-types.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

const PDF = text("%PDF-1.7\n%âãÏÓ");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 20, 0);

describe("detectFileType", () => {
  it("accepte un fichier dont la signature correspond à l'extension", () => {
    expect(detectFileType(PDF, "facture.pdf")).toEqual({ extension: "pdf", mimeType: "application/pdf" });
    expect(detectFileType(PNG, "logo.PNG")?.mimeType).toBe("image/png");
    expect(detectFileType(JPEG, "photo.jpeg")?.mimeType).toBe("image/jpeg");
    expect(detectFileType(JPEG, "photo.jpg")?.mimeType).toBe("image/jpeg");
    expect(detectFileType(ZIP, "budget.xlsx")?.mimeType).toContain("spreadsheetml");
    expect(detectFileType(ZIP, "pv.odt")?.mimeType).toContain("opendocument.text");
    expect(detectFileType(text("date;montant\n01/01;12,50\n"), "export.csv")?.mimeType).toContain("text/csv");
    expect(detectFileType(text("Compte rendu — réunion du bureau"), "notes.txt")?.mimeType).toContain("text/plain");
  });

  it("refuse un contenu qui contredit l'extension (fichier déguisé)", () => {
    expect(detectFileType(PNG, "facture.pdf")).toBeNull();
    expect(detectFileType(PDF, "image.png")).toBeNull();
    expect(detectFileType(text("MZ\u0090\u0000"), "document.pdf")).toBeNull();
    expect(detectFileType(JPEG, "budget.xlsx")).toBeNull();
  });

  it("refuse les formats actifs et exécutables, quelle que soit leur signature", () => {
    for (const name of ["page.html", "image.svg", "script.js", "programme.exe", "macro.docm", "archive.zip", "lien.lnk", "x.php", "x.bat", "sans-extension"]) {
      expect(detectFileType(text("<html><script>alert(1)</script>"), name)).toBeNull();
    }
    expect(detectFileType(ZIP, "archive.zip")).toBeNull();
  });

  it("refuse un fichier vide, binaire déclaré en texte, ou texte non UTF-8", () => {
    expect(detectFileType(new Uint8Array(), "vide.txt")).toBeNull();
    expect(detectFileType(bytes(0x41, 0x00, 0x42), "binaire.csv")).toBeNull();
    expect(detectFileType(bytes(0xff, 0xfe, 0x41, 0x00), "latin.txt")).toBeNull();
    expect(detectFileType(bytes(0xe9, 0x74, 0xe9), "latin1.txt")).toBeNull();
  });

  it("tolère un caractère multi-octets coupé à la fin de l'échantillon", () => {
    const full = text("é".repeat(10));
    expect(detectFileType(full.slice(0, full.length - 1), "accents.txt")).not.toBeNull();
  });
});

describe("extensionOf", () => {
  it("lit la dernière extension, en minuscules", () => {
    expect(extensionOf("archive.TAR.GZ")).toBe("gz");
    expect(extensionOf("Facture.PDF")).toBe("pdf");
    expect(extensionOf("sans-extension")).toBe("");
    expect(extensionOf(".bashrc")).toBe("");
  });
});

describe("sanitizeFilename", () => {
  it("retire tout chemin et conserve un nom lisible", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\marie\\facture 2026.pdf")).toBe("facture 2026.pdf");
    expect(sanitizeFilename("Reçu de cotisation (n°12).pdf")).toBe("Reçu de cotisation (n_12).pdf");
  });

  it("supprime les caractères de contrôle et les séparateurs dangereux", () => {
    expect(sanitizeFilename("a\u0000b\u001fc\r\n.pdf")).toBe("abc.pdf");
    expect(sanitizeFilename('rapport";filename=x.exe')).toBe("rapport_filename_x.exe");
    expect(sanitizeFilename("<script>.pdf")).toBe("_script_.pdf");
  });

  it("ne produit jamais un nom caché ou vide", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename("...")).toBe("document");
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename("///")).toBe("document");
  });

  it("borne la longueur en conservant l'extension", () => {
    const name = sanitizeFilename(`${"a".repeat(300)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});
