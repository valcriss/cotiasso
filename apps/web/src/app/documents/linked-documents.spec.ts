import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { LinkedDocuments } from './linked-documents';

const options = {
  categories: [
    { key: 'facture', label: 'Facture' },
    { key: 'devis', label: 'Devis' },
  ],
  objectTypes: ['project', 'grant'],
  allowedExtensions: ['pdf', 'png'],
};
const document = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  title: 'Devis traiteur',
  category: 'devis',
  restricted: false,
  archivedAt: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-02T10:00:00.000Z',
  versionCount: 1,
  linkCount: 1,
  latest: { number: 1, originalName: 'devis.pdf', mimeType: 'application/pdf', size: 2048, uploadedAt: '2026-05-01T10:00:00.000Z' },
  ...over,
});

describe('LinkedDocuments', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<LinkedDocuments>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (items: unknown[], inputs: { type?: 'project' | 'grant'; canDeposit?: boolean } = {}) => {
    await TestBed.configureTestingModule({
      imports: [LinkedDocuments],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['documents:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LinkedDocuments);
    fixture.componentRef.setInput('objectType', inputs.type ?? 'project');
    fixture.componentRef.setInput('objectId', 'p1');
    fixture.componentRef.setInput('name', 'Festival');
    fixture.componentRef.setInput('canDeposit', inputs.canDeposit ?? false);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller
      .expectOne((r) => r.url === '/api/documents' && r.params.get('objectType') === (inputs.type ?? 'project') && r.params.get('objectId') === 'p1')
      .flush({ items, total: items.length, pageSize: 50 });
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
  };
  const text = () => root.textContent!.replace(/\s+/g, ' ');
  const buttons = () => Array.from(root.querySelectorAll('button')).map((b) => b.textContent!.replace(/\s+/g, ' ').trim());

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('demande seulement les documents liés à l’objet, et les liste avec fichier, catégorie et téléchargement', async () => {
    await create([document(), document({ id: 'd2', title: 'Facture', category: 'facture', versionCount: 3, latest: { number: 3, originalName: 'f.pdf', mimeType: 'application/pdf', size: 3 * 1024 * 1024, uploadedAt: '2026-05-03T10:00:00.000Z' } })]);
    const rows = Array.from(root.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim()));
    expect(rows[0]).toEqual(['Devis traiteur Devis', 'devis.pdf 2,0 Ko', '02/05/2026', 'Télécharger']);
    expect(rows[1]![0]).toBe('Facture Facture · 3 versions');
    expect(root.querySelector('a[aria-label="Télécharger Devis traiteur"]')!.getAttribute('href')).toBe('/api/documents/d1/download');
  });

  it('dit que le document est conservé tel quel, avec le bon objet dans la phrase', async () => {
    await create([document()]);
    expect(text()).toContain('de ce projet');
    expect(text()).toContain('ne se supprime pas');
    TestBed.resetTestingModule();
    await create([document()], { type: 'grant' });
    expect(text()).toContain('de cette subvention');
  });

  it('en lecture seule, ne propose aucun dépôt et le dit dans l’état vide', async () => {
    await create([]);
    expect(buttons().some((b) => b.includes('Déposer'))).toBe(false);
    expect(text()).toContain("Aucun document n'est disponible ici.");
  });

  it('dit quoi faire en premier quand rien n’est encore déposé et qu’on peut déposer', async () => {
    await create([], { canDeposit: true });
    expect(buttons().some((b) => b.includes('Déposer un document'))).toBe(true);
    expect(text()).toContain("Aucun document pour l'instant. Cliquez sur « Déposer un document »");
  });

  it('dépose un document lié à l’objet, sans proposer le caractère restreint', async () => {
    await create([], { canDeposit: true });
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes('Déposer un document'))!.click();
    await settle();
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
    expect(ui.title).toBe('Déposer un document');
    expect(ui.text).not.toContain('Document restreint');

    const input = ui.field<HTMLInputElement>('#upload-file');
    Object.defineProperty(input, 'files', { value: [new File(['%PDF-1.7 contenu'], 'devis_traiteur.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change'));
    await settle();
    await ui.submit();
    const request = controller.expectOne('/api/documents');
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('title')).toBe('devis traiteur');
    expect(JSON.parse(body.get('links') as string)).toEqual([{ objectType: 'project', objectId: 'p1' }]);
    expect(body.get('restricted')).toBeNull();
    request.flush({ document: { ...document(), title: 'devis traiteur', versions: [], links: [] }, duplicates: [] }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne((r) => r.url === '/api/documents' && r.params.get('objectId') === 'p1').flush({ items: [document({ title: 'devis traiteur' })], total: 1, pageSize: 50 });
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Document « devis traiteur » déposé.');
    expect(text()).toContain('devis traiteur');
  });

  it('affiche un message clair si le serveur refuse le dépôt, sans fermer la boîte', async () => {
    await create([], { canDeposit: true });
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes('Déposer un document'))!.click();
    await settle();
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
    const input = ui.field<HTMLInputElement>('#upload-file');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change'));
    await settle();
    await ui.submit();
    controller.expectOne('/api/documents').flush({ message: 'Vous ne pouvez lier un document qu\'à vos projets.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('vos projets');
  });

  it('affiche un message clair si le chargement échoue', async () => {
    await TestBed.configureTestingModule({
      imports: [LinkedDocuments],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(['documents:view']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LinkedDocuments);
    fixture.componentRef.setInput('objectType', 'project');
    fixture.componentRef.setInput('objectId', 'p1');
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne((r) => r.url === '/api/documents').flush({ message: 'Accès refusé.' }, { status: 403, statusText: 'Forbidden' });
    controller.expectOne('/api/documents/options').flush(options);
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('refusé');
  });
});
