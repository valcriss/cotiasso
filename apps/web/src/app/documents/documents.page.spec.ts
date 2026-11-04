import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
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
  let ui: DialogTester;
  let harness: RouterTestingHarness;
  const fixture = { detectChanges: () => harness.fixture.detectChanges(), whenStable: () => harness.fixture.whenStable() };
  /** La page courante : la liste et le détail d'un document sont deux adresses, donc deux instances. */
  const root = () => harness.routeNativeElement as HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], items = [summary('d1'), summary('d2', { restricted: true, archivedAt: '2026-11-03T10:00:00.000Z' })]) => {
    await TestBed.configureTestingModule({
      imports: [DocumentsPage],
      providers: [
        provideRouter([
          { path: 'documents', component: DocumentsPage },
          { path: 'documents/:id', component: DocumentsPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(permissions),
        NO_MATERIAL_ANIMATIONS,
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/documents', DocumentsPage);
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
    controller.expectOne((req) => req.url === '/api/documents').flush({ items, total: items.length, pageSize: 50 });
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root().querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent?.includes(text));

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
    const text = root().textContent!;
    expect(text).toContain('Document d1');
    expect(text).toContain('Facture');
    expect(text).toContain('facture.pdf');
    expect(text).toContain('2,0 Ko');
    expect(text).toContain('(archivé)');
    expect(root().querySelectorAll('mat-icon[aria-label="Document restreint"]')).toHaveLength(1);
  });

  it("n'offre aucune action de dépôt sans la permission documents:create", async () => {
    await create(['documents:view']);
    expect(buttonWith('Déposer un document')).toBeUndefined();
  });

  it('indique quand aucun document ne correspond', async () => {
    await create(['documents:view'], []);
    expect(root().textContent).toContain('Aucun document ne correspond');
  });

  /** Ouvrir un document change d'adresse (`/documents/:id`) : la page de détail charge ses options et le document. */
  const openDetail = async (id: string, overrides: Record<string, unknown> = {}) => {
    buttonWith('Ouvrir')!.click();
    await settle();
    controller.expectOne('/api/documents/options').flush(options);
    controller.expectOne(`/api/documents/${id}`).flush(detail(id, overrides));
    await settle();
  };

  it('chaque document de la liste est un lien vers sa propre page, sans détail sous le tableau', async () => {
    await create(['documents:view']);
    const link = root().querySelector('a[aria-label="Ouvrir Document d1"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/documents/d1');
    expect(root().querySelector('section[aria-label="Détail du document"]')).toBeNull();
  });

  it('la page d’un document montre le document seul, avec un retour vers la liste', async () => {
    await create(['documents:view']);
    await openDetail('d1');
    expect(root().querySelector('h1')!.textContent).toContain('Document d1');
    expect(root().querySelector('table')).toBeNull();
    expect(root().querySelector('form.filters')).toBeNull();
    const back = root().querySelector('a.back-link') as HTMLAnchorElement;
    expect(back.textContent).toContain('Retour aux documents');
    expect(back.getAttribute('href')).toBe('/documents');
  });

  it('dit clairement qu’un document est introuvable et propose de revenir à la liste', async () => {
    await create(['documents:view']);
    await harness.navigateByUrl('/documents/inconnu', DocumentsPage);
    controller.expectOne('/api/documents/options').flush(options);
    controller.expectOne('/api/documents/inconnu').flush({ message: 'introuvable' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root().querySelector('[role="alert"]')!.textContent).toContain('introuvable');
    expect(root().querySelector('a.back-link')).toBeTruthy();
  });

  it('ouvre le détail avec les versions, les liens et un lien de téléchargement par version', async () => {
    await create(['documents:view']);
    await openDetail('d1');

    const panel = root().querySelector('section[aria-label="Détail du document"]')!;
    expect(panel.textContent).toContain('v2');
    expect(panel.textContent).toContain('Corrigée');
    expect(panel.textContent).toContain('Projet');
    expect(panel.textContent).toContain('p-42');
    // Le téléchargement de la dernière version est dans la barre d'outils de la page, celui des versions dans le panneau.
    const links = Array.from(root().querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/api/documents/d1/download');
    expect(links).toContain('/api/documents/d1/download?version=2');
    expect(links).toContain('/api/documents/d1/download?version=1');
    expect(panel.textContent).not.toContain('Ajouter une version');
  });

  it('propose « Voir le document » à gauche de « Télécharger » pour un PDF et l’ouvre dans la visionneuse sans rien enregistrer', async () => {
    const created = vi.fn(() => 'blob:visionneuse');
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    await create(['documents:view']);
    await openDetail('d1');

    // Les actions sont dans la barre d'outils de la page (le retour à la liste en premier).
    const actions = Array.from(root().querySelectorAll('app-page-header .actions > *')).map((e) => e.textContent!.trim());
    expect(actions[0]).toContain('Retour aux documents');
    expect(actions.slice(1)).toEqual(['visibilityVoir le document', 'Télécharger la dernière version']);

    buttonWith('Voir le document')!.click();
    await settle();
    const request = controller.expectOne('/api/documents/d1/download');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    await settle();

    expect(ui.title).toBe('Document d1');
    const frame = ui.field<HTMLIFrameElement>('iframe');
    expect(frame.getAttribute('src')).toBe('blob:visionneuse');
    expect(created).toHaveBeenCalledTimes(1);
    expect((created.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/pdf');
    await ui.click('Fermer');
    await settle();
    expect(revoked).toHaveBeenCalledWith('blob:visionneuse');
  });

  it('ouvre la version choisie dans la visionneuse', async () => {
    Object.assign(URL, { createObjectURL: () => 'blob:v1', revokeObjectURL: () => undefined });
    await create(['documents:view']);
    await openDetail('d1');
    root().querySelector<HTMLButtonElement>('button[aria-label="Voir la version 1"]')!.click();
    await settle();
    controller.expectOne('/api/documents/d1/download?version=1').flush(new Blob(['%PDF-1.7']));
    await settle();
    expect(ui.dialog!.querySelector('iframe')).not.toBeNull();
  });

  it("n'affiche pas « Voir le document » pour un fichier qui n'est pas un PDF", async () => {
    await create(['documents:view'], [summary('d1', { latest: { number: 1, originalName: 'photo.png', mimeType: 'image/png', size: 10, uploadedAt: '2026-11-01T10:00:00.000Z' } })]);
    await openDetail('d1', {
      latest: { number: 1, originalName: 'photo.png', mimeType: 'image/png', size: 10, uploadedAt: '2026-11-01T10:00:00.000Z' },
      versions: [{ number: 1, originalName: 'photo.png', mimeType: 'image/png', size: 10, sha256: 'a'.repeat(64), comment: null, uploadedAt: '2026-11-01T10:00:00.000Z', uploadedBy: 'u1' }],
    });
    expect(buttonWith('Voir')).toBeUndefined();
    expect(root().textContent).toContain('Télécharger la dernière version');
  });

  it("explique quand le document ne peut pas s'ouvrir et garde le téléchargement", async () => {
    await create(['documents:view']);
    await openDetail('d1');
    buttonWith('Voir le document')!.click();
    await settle();
    controller.expectOne('/api/documents/d1/download').flush(new Blob(), { status: 404, statusText: 'Not Found' });
    await settle();
    expect(ui.error).toContain('n’a pas pu être ouvert');
    expect(ui.dialog!.querySelector('iframe')).toBeNull();
    expect(Array.from(ui.dialog!.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('/api/documents/d1/download');
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
    // Le document déposé s'ouvre sur sa propre page.
    controller.expectOne('/api/documents/options').flush(options);
    controller.expectOne('/api/documents/d9').flush(detail('d9'));
    await settle();
    expect(root().querySelector('h1')!.textContent).toContain('Document d9');
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

  it('archive un document ouvert', async () => {
    await create(['documents:view', 'documents:create']);
    await openDetail('d1');

    buttonWith('Archiver')!.click();
    await settle();
    controller.expectOne('/api/documents/d1/archive').flush(detail('d1', { archivedAt: '2026-11-04T10:00:00.000Z' }));
    await settle();
    expect(root().textContent).toContain('Archivé');
    expect(buttonWith('Réactiver')).toBeDefined();
  });

  it('lie un document à un objet et refuse un identifiant vide', async () => {
    await create(['documents:view', 'documents:create']);
    await openDetail('d1');

    buttonWith('Lier')!.click();
    await settle();
    controller.expectNone('/api/documents/d1/links');
    expect(root().querySelector('[role="alert"]')!.textContent).toContain("identifiant de l'objet");

    const id = root().querySelector<HTMLInputElement>('input[formcontrolname="objectId"]')!;
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
