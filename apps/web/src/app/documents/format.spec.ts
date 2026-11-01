import { formatSize, objectTypeLabel, titleFromFilename } from './format';

describe('format', () => {
  it('formate les tailles en o, Ko et Mo avec la virgule française', () => {
    expect(formatSize(512)).toBe('512 o');
    expect(formatSize(1536)).toBe('1,5 Ko');
    expect(formatSize(5 * 1024 * 1024)).toBe('5,0 Mo');
  });

  it("traduit les types d'objets et laisse les inconnus tels quels", () => {
    expect(objectTypeLabel('project')).toBe('Projet');
    expect(objectTypeLabel('journal-entry')).toBe('Écriture');
    expect(objectTypeLabel('autre')).toBe('autre');
  });

  it('propose un titre à partir du nom de fichier', () => {
    expect(titleFromFilename('facture_edf_2026.pdf')).toBe('facture edf 2026');
    expect(titleFromFilename('archive.tar.gz')).toBe('archive.tar');
    expect(titleFromFilename('.pdf')).toBe('.pdf');
  });
});
