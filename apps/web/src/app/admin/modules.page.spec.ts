import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { ModulesPage } from './modules.page';

const modules = [
  { key: 'alpha', label: 'Alpha', description: 'Premier', status: 'ACTIVE', reason: null, requires: [], activatedAt: '2026-11-01T00:00:00.000Z' },
  { key: 'beta', label: 'Beta', description: 'Second', status: 'INACTIVE', reason: null, requires: ['alpha'], activatedAt: null },
  { key: 'gamma', label: 'Gamma', description: 'Non livré', status: 'UNAVAILABLE', reason: 'Non livré : sera activable une fois validé.', requires: [], activatedAt: null },
];

describe('ModulesPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<ModulesPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [ModulesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ModulesPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/modules').flush(modules);
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  afterEach(() => controller.verify());

  it("affiche l'état de chaque module et le motif d'indisponibilité", async () => {
    await create(['settings.association:view']);
    const text = root.textContent!;
    expect(text).toContain('Actif');
    expect(text).toContain('Inactif');
    expect(text).toContain('Indisponible');
    expect(text).toContain('Non livré : sera activable');
  });

  it("n'offre aucune action sans la permission d'administration comptable", async () => {
    await create(['settings.association:view']);
    expect(buttonWith('Activer')).toBeUndefined();
    expect(buttonWith('Désactiver')).toBeUndefined();
  });

  it("propose d'activer un module inactif et de désactiver un module actif, jamais un module indisponible", async () => {
    await create(['settings.association:view', 'settings.accounting:admin']);
    expect(root.querySelectorAll('button').length).toBe(2);

    buttonWith('Activer')!.click();
    await settle();
    controller.expectOne('/api/modules/beta/activate').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('/api/modules').flush(modules);
  });

  it('affiche le refus du serveur, par exemple un prérequis manquant', async () => {
    await create(['settings.association:view', 'settings.accounting:admin']);
    buttonWith('Activer')!.click();
    await settle();
    controller
      .expectOne('/api/modules/beta/activate')
      .flush({ message: "Prérequis à activer d'abord : Alpha." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Prérequis à activer');
  });
});
