import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [ProjectsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectsPage);
    root = fixture.nativeElement as HTMLElement;
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
  const type = (selector: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  afterEach(() => controller.verify());

  it('liste les projets, le projet permanent en premier et signalé', async () => {
    await create(['projects:view']);
    const rows = Array.from(root.querySelectorAll('tbody tr')).map((r) => r.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('FONCT');
    expect(rows[0]).toContain('Permanent');
    expect(rows[1]).toContain('Actif');
    expect(rows[1]).toContain('2026-06-01 → 2026-06-30');
    expect(root.textContent).not.toContain('Nouveau projet');
  });

  it('montre la synthèse annuelle et globale d’un projet', async () => {
    await create(['projects:view']);
    await click('Ouvrir Festival');
    controller.expectOne('/api/projects/p1/summary').flush(summary);
    await settle();
    const text = root.textContent!;
    expect(text).toContain('Synthèse de Festival');
    expect(text).toContain('Été 2026');
    expect(text).toContain('500,00');
    expect(text).toContain('-60,00');
    expect(text).toContain('Total (tous exercices)');
    expect(text).toContain('440,00');
  });

  it('indique quand rien n’a été ventilé sur le projet', async () => {
    await create(['projects:view']);
    await click('Ouvrir Festival');
    controller.expectOne('/api/projects/p1/summary').flush({ total: { charges: '0.00', produits: '0.00', result: '0.00' }, years: [] });
    await settle();
    expect(root.textContent).toContain("Aucune charge ni aucun produit n'a encore été ventilé");
  });

  it('crée un projet avec son code et rouvre sa synthèse', async () => {
    await create(['projects:view', 'projects:update']);
    await click('Nouveau projet');
    type('input[formcontrolname="code"]', 'ATELIERS');
    type('input[formcontrolname="name"]', 'Ateliers');
    await settle();
    await click('Enregistrer');

    const request = controller.expectOne('/api/projects');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ code: 'ATELIERS', name: 'Ateliers', status: 'PREPARATION', startDate: null });
    request.flush(project({ id: 'p2', code: 'ATELIERS', name: 'Ateliers' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/projects').flush([permanent, project(), project({ id: 'p2', code: 'ATELIERS', name: 'Ateliers' })]);
    await settle();
    controller.expectOne('/api/projects/p2/summary').flush({ total: { charges: '0.00', produits: '0.00', result: '0.00' }, years: [] });
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Projet ATELIERS créé');
  });

  it('affiche le refus du serveur, par exemple un code déjà pris', async () => {
    await create(['projects:view', 'projects:update']);
    await click('Nouveau projet');
    type('input[formcontrolname="code"]', 'FESTIVAL');
    type('input[formcontrolname="name"]', 'Doublon');
    await settle();
    await click('Enregistrer');
    controller
      .expectOne('/api/projects')
      .flush({ message: 'Le code de projet « FESTIVAL » existe déjà.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('existe déjà');
  });

  it('ne propose pas de changer l’état du projet permanent', async () => {
    await create(['projects:view', 'projects:update']);
    await click('Ouvrir Fonctionnement');
    controller.expectOne('/api/projects/p0/summary').flush({ total: { charges: '0.00', produits: '0.00', result: '0.00' }, years: [] });
    await settle();
    await click('Modifier');
    expect(root.querySelector('mat-select[formcontrolname="status"]')!.classList.contains('mat-mdc-select-disabled')).toBe(true);
    await click('Enregistrer');
    const patch = controller.expectOne('/api/projects/p0');
    expect(patch.request.body.status).toBeUndefined();
    patch.flush(permanent);
    await settle();
    controller.expectOne('/api/projects').flush([permanent]);
    await settle();
    controller.expectOne('/api/projects/p0/summary').flush({ total: { charges: '0.00', produits: '0.00', result: '0.00' }, years: [] });
    await settle();
  });
});
