import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { DocumentsPage } from './documents.page';

const options = {
  categories: [
    { key: 'facture', label: 'Facture' },
    { key: 'devis', label: 'Devis' },
  ],
  objectTypes: ['project', 'member'],
  allowedExtensions: ['pdf', 'png'],
};

const summary = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Document ${id}`,
  category: 'facture',
  restricted: false,
  archivedAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  versionCount: 1,
  linkCount: 0,
  latest: { number: 1, originalName: 'facture.pdf', mimeType: 'application/pdf', size: 2048, uploadedAt: '2026-11-01T10:00:00.000Z' },
  ...overrides,
});

const detail = (id: string, overrides: Record<string, unknown> = {}) => ({
  ...summary(id),
  versions: [
    { number: 2, originalName: 'facture-v2.pdf', mimeType: 'application/pdf', size: 3000, sha256: 'b'.repeat(64), comment: 'Corrigée', uploadedAt: '2026-11-02T10:00:00.000Z', uploadedBy: 'u1' },
    { number: 1, originalName: 'facture.pdf', mimeType: 'application/pdf', size: 2048, sha256: 'a'.repeat(64), comment: null, uploadedAt: '2026-11-01T10:00:00.000Z', uploadedBy: 'u1' },
  ],
  links: [{ id: 'l1', objectType: 'project', objectId: 'p-42', createdAt: '2026-11-01T10:00:00.000Z' }],
  versionCount: 2,
  linkCount: 1,
  ...overrides,
});

describe('DocumentsPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let ui: DialogTester;
  let fixture: ReturnType<typeof TestBed.createComponent<DocumentsPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], items = [summary('d1'), summary('d2', { restricted: true, archivedAt: '2026-11-03T10:00:00.000Z' })]) => {
    await TestBed.configureTestingModule({
      imports: [DocumentsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DocumentsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
    controller.expectOne((req) => req.url === '/api/documents').flush({ items, total: items.length, pageSize: 50 });
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });
  const pick = async (file: File) => {
    const input = ui.field<HTMLInputElement>('#upload-file');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle();
  };

  it('liste les documents avec leur catégorie, leur dernier fichier, et signale restreints et archivés', async () => {
    await create(['documents:view']);
    const text = root.textContent!;
    expect(text).toContain('Document d1');
    expect(text).toContain('Facture');
    expect(text).toContain('facture.pdf');
    expect(text).toContain('2,0 Ko');
    expect(text).toContain('(archivé)');
    expect(root.querySelectorAll('mat-icon[aria-label="Document restreint"]')).toHaveLength(1);
  });

  it("n'offre aucune action de dépôt sans la permission documents:create", async () => {
    await create(['documents:view']);
    expect(buttonWith('Déposer un document')).toBeUndefined();
  });

  it('indique quand aucun document ne correspond', async () => {
    await create(['documents:view'], []);
    expect(root.textContent).toContain('Aucun document ne correspond');
  });

  it('ouvre le détail avec les versions, les liens et un lien de téléchargement par version', async () => {
    await create(['documents:view']);
    buttonWith('Ouvrir')!.click();
    await settle();
    controller.expectOne('/api/documents/d1').flush(detail('d1'));
    await settle();

    const panel = root.querySelector('section[aria-label="Détail du document"]')!;
    expect(panel.textContent).toContain('v2');
    expect(panel.textContent).toContain('Corrigée');
    expect(panel.textContent).toContain('Projet');
    expect(panel.textContent).toContain('p-42');
    const links = Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/api/documents/d1/download');
    expect(links).toContain('/api/documents/d1/download?version=2');
    expect(links).toContain('/api/documents/d1/download?version=1');
    expect(panel.textContent).not.toContain('Ajouter une version');
  });

  it("dépose un document avec fichier, titre et catégorie, puis signale un doublon éventuel", async () => {
    await create(['documents:view', 'documents:create']);
    buttonWith('Déposer un document')!.click();
    await settle();

    await pick(new File(['%PDF-1.7 contenu'], 'facture_edf.pdf', { type: 'application/pdf' }));
    expect(ui.field<HTMLInputElement>('input[formcontrolname="title"]').value).toBe('facture edf');

    await ui.submit();
    const request = controller.expectOne('/api/documents');
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('title')).toBe('facture edf');
    expect(body.get('category')).toBe('facture');
    expect((body.get('file') as File).name).toBe('facture_edf.pdf');
    expect(body.has('restricted')).toBe(false);

    request.flush({ document: detail('d9'), duplicates: [{ documentId: 'd1', title: 'Document d1' }] });
    await settle();
    controller.expectOne((req) => req.url === '/api/documents').flush({ items: [summary('d9')], total: 1, pageSize: 50 });
    await settle();
    expect(ui.snackbar).toContain('identique à un document déjà déposé');
    expect(ui.isOpen).toBe(false);
  });

  it("réclame un fichier avant d'envoyer quoi que ce soit", async () => {
    await create(['documents:view', 'documents:create']);
    buttonWith('Déposer un document')!.click();
    await settle();
    await ui.submit();
    controller.expectNone('/api/documents');
    expect(ui.error).toContain('Choisissez un fichier');
  });

  it("ne propose la case « restreint » qu'avec la permission documents.restricted:view", async () => {
    await create(['documents:view', 'documents:create']);
    buttonWith('Déposer un document')!.click();
    await settle();
    expect(ui.text).not.toContain('Document restreint (visible');
  });

  it('affiche le refus du serveur, par exemple un contenu qui ne correspond pas à l’extension', async () => {
    await create(['documents:view', 'documents:create']);
    buttonWith('Déposer un document')!.click();
    await settle();
    await pick(new File(['<html>'], 'faux.pdf'));
    await ui.submit();
    controller
      .expectOne('/api/documents')
      .flush({ message: 'Type de fichier non autorisé, ou contenu qui ne correspond pas à l\'extension.' }, { status: 415, statusText: 'Unsupported Media Type' });
    await settle();
    expect(ui.error).toContain('Type de fichier non autorisé');
  });

  it('archive un document ouvert et recharge la liste', async () => {
    await create(['documents:view', 'documents:create']);
    buttonWith('Ouvrir')!.click();
    await settle();
    controller.expectOne('/api/documents/d1').flush(detail('d1'));
    await settle();

    buttonWith('Archiver')!.click();
    await settle();
    controller.expectOne('/api/documents/d1/archive').flush(detail('d1', { archivedAt: '2026-11-04T10:00:00.000Z' }));
    await settle();
    controller.expectOne((req) => req.url === '/api/documents').flush({ items: [], total: 0, pageSize: 50 });
    await settle();
    expect(root.textContent).toContain('Archivé');
    expect(buttonWith('Réactiver')).toBeDefined();
  });

  it('lie un document à un objet et refuse un identifiant vide', async () => {
    await create(['documents:view', 'documents:create']);
    buttonWith('Ouvrir')!.click();
    await settle();
    controller.expectOne('/api/documents/d1').flush(detail('d1'));
    await settle();

    buttonWith('Lier')!.click();
    await settle();
    controller.expectNone('/api/documents/d1/links');
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("identifiant de l'objet");

    const id = root.querySelector<HTMLInputElement>('input[formcontrolname="objectId"]')!;
    id.value = 'm-7';
    id.dispatchEvent(new Event('input'));
    buttonWith('Lier')!.click();
    await settle();
    const request = controller.expectOne('/api/documents/d1/links');
    expect(request.request.body).toEqual({ objectType: 'project', objectId: 'm-7' });
    request.flush(detail('d1'));
    await settle();
  });
});
