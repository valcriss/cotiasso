import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "./release-notes.js";

const SAMPLE = `# Notes de version

Introduction ignorée.

## Non publié

### Nouveautés

- Première *nouveauté* avec un [lien](https://exemple.test).
- Deuxième, sur deux
  lignes.

## 1.2.0 — 2026-11-10

- Puce sans rubrique.

## 1.10.0

- Autre.
`;

describe("parseReleaseNotes", () => {
  it("découpe versions, rubriques et puces, sans la mise en forme Markdown", () => {
    const releases = parseReleaseNotes(SAMPLE, "développement");
    expect(releases.map((r) => r.heading)).toEqual(["Non publié", "1.2.0 — 2026-11-10", "1.10.0"]);
    expect(releases[0]!.groups).toEqual([
      { title: "Nouveautés", items: ["Première nouveauté avec un lien.", "Deuxième, sur deux lignes."] },
    ]);
    expect(releases[1]!.groups).toEqual([{ title: null, items: ["Puce sans rubrique."] }]);
  });

  it("repère la version déployée sans confondre 1.2.0 avec 1.2.01 ni 1.10.0 avec 1.1", () => {
    expect(parseReleaseNotes(SAMPLE, "1.2.0").map((r) => r.current)).toEqual([false, true, false]);
    expect(parseReleaseNotes(SAMPLE, "v1.10.0").map((r) => r.current)).toEqual([false, false, true]);
    expect(parseReleaseNotes(SAMPLE, "1.1").some((r) => r.current)).toBe(false);
    expect(parseReleaseNotes(SAMPLE, "développement").some((r) => r.current)).toBe(false);
  });

  it("ne produit rien pour un fichier sans section", () => {
    expect(parseReleaseNotes("# Titre\n\nTexte.\n", "1.0.0")).toEqual([]);
  });

  it("lit le vrai CHANGELOG.md du dépôt (le format reste celui que l'application attend)", async () => {
    const text = await readFile(fileURLToPath(new URL("../../../../CHANGELOG.md", import.meta.url)), "utf8");
    const releases = parseReleaseNotes(text, "développement");
    expect(releases.length).toBeGreaterThan(0);
    // La première section est « Non publié » tant qu'une version n'est pas publiée, puis le numéro de la dernière version.
    expect(releases[0]!.heading).toMatch(/^(Non publié|\d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2})$/);
    // Chaque section a au moins une puce, et le fichier en compte bien plus.
    for (const release of releases) expect(release.groups.flatMap((g) => g.items).length, release.heading).toBeGreaterThan(0);
    expect(releases.flatMap((r) => r.groups.flatMap((g) => g.items)).length).toBeGreaterThan(3);
    // La version déployée est repérée dans le titre de sa section.
    const latest = releases.find((r) => /^\d+\.\d+\.\d+ — /.test(r.heading));
    if (latest) {
      const version = latest.heading.split(" — ")[0]!;
      expect(parseReleaseNotes(text, version).filter((r) => r.current)).toHaveLength(1);
    }
  });
});
