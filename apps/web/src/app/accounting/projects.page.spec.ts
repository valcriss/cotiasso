import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { mockAuth } from '../testing/auth-mock';
import { ProjectsPage } from './projects.page';

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  code: 'FESTIVAL',
  name: 'Festival',
  description: 'Été 2026',
  status: 'ACTIVE',
  permanent: false,
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  managerId: null,
  ...overrides,
});
const permanent = project({ id: 'p0', code: 'FONCT', name: "Fonctionnement de l'association", permanent: true, startDate: null, endDate: null });
const empty = { total: { charges: '0.00', produits: '0.00', result: '0.00' }, years: [] };
const summary = {
  total: { charges: '60.00', produits: '500.00', result: '440.00' },
  years: [
    { fiscalYearId: 'y1', label: '2026', charges: '60.00', produits: '0.00', result: '-60.00' },
    { fiscalYearId: 'y2', label: '2027', charges: '0.00', produits: '500.00', result: '500.00' },
  ],
};

describe('ProjectsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ProjectsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Ouvrir un projet charge aussi son budget et ses participants (panneaux voisins de la synthèse). */
  const flushPanels = async (projectId: string) => {
    await settle();
    controller.expectOne(`/api/projects/${projectId}/budgets`).flush([]);
    controller.expectOne(`/api/projects/${projectId}/participants`).flush([]);
    controller.expectOne(`/api/projects/${projectId}/commitments`).flush([]);
    controller.expectOne(`/api/projects/${projectId}/budget-report`).flush({
      project: { id: projectId, code: 'X', name: 'X' },
      scope: { kind: 'GLOBAL', fiscalYear: null },
      fiscalYears: [],
      budget: null,
      formula: '',
      charges: { rows: [], total: { budget: null, engaged: '0.00', actual: '0.00', remaining: null } },
      products: { rows: [], total: { budget: null, engaged: null, actual: '0.00', remaining: null } },
      warnings: [],
    });
    await settle();
  };
  const create = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [ProjectsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/projects').flush([permanent, project()]);
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('présente la page : titre, phrase d’explication et projets, le permanent en premier', async () => {
    await create(['projects:view']);
    expect(root.querySelector('h1')!.textContent).toContain('Projets');
    expect(root.querySelector('.description')!.textContent).toContain('ce qu\'elle coûte');
    const rows = Array.from(root.querySelectorAll('tbody tr')).map((r) => r.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('FONCT');
    expect(rows[0]).toContain('Permanent');
    expect(rows[1]).toContain('2026-06-01 → 2026-06-30');
    expect(root.textContent).not.toContain('Nouveau projet');
  });

  it('montre la synthèse annuelle et globale d’un projet', async () => {
    await create(['projects:view']);
    await click('Ouvrir Festival');
    controller.expectOne('/api/projects/p1/summary').flush(summary);
    await flushPanels('p1');
    await settle();
    const text = root.textContent!;
    expect(text).toContain('Synthèse de Festival');
    expect(text).toContain('Été 2026');
    expect(text).toContain('-60,00');
    expect(text).toContain('Total (tous exercices)');
    expect(text).toContain('440,00');
  });

  it('indique quand rien n’a été ventilé sur le projet', async () => {
    await create(['projects:view']);
    await click('Ouvrir Festival');
    controller.expectOne('/api/projects/p1/summary').flush(empty);
    await flushPanels('p1');
    await settle();
    expect(root.textContent).toContain("Aucune charge ni aucun produit n'a encore été ventilé");
  });

  it('crée un projet dans une boîte de dialogue, confirme par un bandeau et ouvre sa synthèse', async () => {
    await create(['projects:view', 'projects:update']);
    expect(ui.isOpen).toBe(false);
    await click('Nouveau projet');
    expect(ui.isOpen).toBe(true);
    expect(ui.title).toBe('Nouveau projet');
    expect(ui.text).toContain('Un projet regroupe les dépenses');

    await ui.type('input[formcontrolname="code"]', 'ATELIERS');
    await ui.type('input[formcontrolname="name"]', 'Ateliers');
    await ui.submit();

    const request = controller.expectOne('/api/projects');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ code: 'ATELIERS', name: 'Ateliers', status: 'PREPARATION', startDate: null });
    request.flush(project({ id: 'p2', code: 'ATELIERS', name: 'Ateliers' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/projects').flush([permanent, project(), project({ id: 'p2', code: 'ATELIERS', name: 'Ateliers' })]);
    await settle();
    controller.expectOne('/api/projects/p2/summary').flush(empty);
    await flushPanels('p2');
    await settle();

    // La boîte est fermée, un bandeau confirme, rien de vert n'est resté dans la page.
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Projet ATELIERS créé.');
    expect(root.querySelector('.success')).toBeNull();
  });

  it('garde la boîte ouverte et la saisie quand le serveur refuse, avec un message clair', async () => {
    await create(['projects:view', 'projects:update']);
    await click('Nouveau projet');
    await ui.type('input[formcontrolname="code"]', 'FESTIVAL');
    await ui.type('input[formcontrolname="name"]', 'Doublon');
    await ui.submit();
    controller
      .expectOne('/api/projects')
      .flush({ message: 'Le code de projet « FESTIVAL » existe déjà.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('existe déjà');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="name"]').value).toBe('Doublon');
    expect(ui.button('Enregistrer').disabled).toBe(false);
  });

  it('explique ce qui manque au lieu d’envoyer un formulaire incomplet', async () => {
    await create(['projects:view', 'projects:update']);
    await click('Nouveau projet');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    expect(ui.text).toContain('Donnez un code court au projet');
    expect(ui.text).toContain('Donnez un nom au projet');
  });

  it('demande confirmation avant d’abandonner une saisie, et ferme sans question si rien n’a été saisi', async () => {
    await create(['projects:view', 'projects:update']);

    await click('Nouveau projet');
    await ui.click('Annuler');
    expect(ui.isOpen).toBe(false);

    await click('Nouveau projet');
    await ui.type('input[formcontrolname="name"]', 'À moitié saisi');
    await ui.click('Annuler');
    expect(ui.title).toBe('Abandonner les modifications ?');
    // On continue la saisie : le formulaire est toujours là, rien n'est perdu.
    await ui.click('Continuer la saisie');
    expect(ui.title).toBe('Nouveau projet');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="name"]').value).toBe('À moitié saisi');

    await ui.click('Annuler');
    await ui.click('Abandonner');
    expect(ui.isOpen).toBe(false);
    controller.expectNone('/api/projects');
  });

  it('modifie un projet existant : le code n’est plus proposé et le projet permanent reste actif', async () => {
    await create(['projects:view', 'projects:update']);
    await click('Ouvrir Fonctionnement');
    controller.expectOne('/api/projects/p0/summary').flush(empty);
    await flushPanels('p0');
    await settle();
    await click('Modifier');
    expect(ui.title).toBe('Modifier le projet FONCT');
    expect(ui.dialog!.querySelector('input[formcontrolname="code"]')).toBeNull();
    expect(ui.text).toContain('Le projet permanent reste toujours actif');

    await ui.type('input[formcontrolname="name"]', 'Fonctionnement général');
    await ui.submit();
    const patch = controller.expectOne('/api/projects/p0');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body.status).toBeUndefined();
    expect(patch.request.body.name).toBe('Fonctionnement général');
    patch.flush({ ...permanent, name: 'Fonctionnement général' });
    await settle();
    controller.expectOne('/api/projects').flush([{ ...permanent, name: 'Fonctionnement général' }]);
    await settle();
    controller.expectOne('/api/projects/p0/summary').flush(empty);
    await flushPanels('p0');
    await settle();
    expect(ui.snackbar).toContain('Projet FONCT enregistré.');
  });
});
