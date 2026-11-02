import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { StartPage } from './start.page';
import { endOfTwelveMonths, yearLabel } from './start-dialogs';

const setup = (done: Partial<Record<'fiscalYear' | 'categories' | 'financialAccount', boolean>> = {}) => ({
  setup: { fiscalYear: false, accounts: false, financialAccount: false, categories: false, ...done },
  cash: null,
  month: null,
  todo: [],
});

describe('Aides de la période', () => {
  it('calcule le dernier jour d’une période de 12 mois, y compris à cheval sur deux années et en année bissextile', () => {
    expect(endOfTwelveMonths('2026-01-01')).toBe('2026-12-31');
    expect(endOfTwelveMonths('2026-09-01')).toBe('2027-08-31');
    expect(endOfTwelveMonths('2027-03-01')).toBe('2028-02-29');
    expect(endOfTwelveMonths('pas une date')).toBe('');
  });

  it('nomme l’exercice d’après ses années', () => {
    expect(yearLabel('2026-01-01', '2026-12-31')).toBe('Exercice 2026');
    expect(yearLabel('2026-09-01', '2027-08-31')).toBe('Exercice 2026-2027');
  });
});

describe('StartPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<StartPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const loads = async (overview: object, accounts: object[] = []) => {
    controller.expectOne('/api/overview').flush(overview);
    controller.expectOne('/api/financial-accounts').flush(accounts);
    await settle();
  };
  const create = async (overview: object, accounts: object[] = []) => {
    await TestBed.configureTestingModule({
      imports: [StartPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['settings.accounting:admin']), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StartPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    await loads(overview, accounts);
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes(label));
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('déroule trois étapes dans l’ordre : une étape ne se débloque qu’une fois la précédente faite', async () => {
    await create(setup());
    expect(root.querySelector('h1')!.textContent).toContain('Démarrer');
    expect(root.querySelectorAll('ol.steps li').length).toBe(3);
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('ol.steps button'));
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true]);
    expect(root.textContent).toContain('Terminez d’abord l’étape précédente');
    expect(root.textContent).not.toContain('Tout est prêt');
  });

  it('crée la période en douze mois par défaut, puis recharge et débloque l’étape suivante', async () => {
    await create(setup());
    await click('Définir la période');
    expect(ui.title).toBe('La période de votre comptabilité');
    expect(ui.text).toContain('exercice');
    await ui.type('input[formcontrolname="start"]', '2026-09-01');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="end"]').value).toBe('2027-08-31');
    await ui.submit();
    const request = controller.expectOne('/api/fiscal-years');
    expect(request.request.body).toEqual({ label: 'Exercice 2026-2027', start: '2026-09-01', end: '2027-08-31' });
    request.flush({ id: 'y1', label: 'Exercice 2026-2027', start: '2026-09-01', end: '2027-08-31', status: 'OPEN' }, { status: 201, statusText: 'Created' });
    await settle();
    await loads(setup({ fiscalYear: true }));
    expect(ui.snackbar).toContain('Période enregistrée');
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('ol.steps button'));
    // L'étape faite n'a plus de bouton ; la suivante est ouverte, la dernière reste verrouillée.
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
  });

  it('installe les catégories seulement après confirmation, en disant que rien n’est écrasé', async () => {
    await create(setup({ fiscalYear: true }));
    await click('Installer les catégories');
    expect(ui.title).toContain('Installer les catégories de départ');
    expect(ui.text).toContain('Rien n’est écrasé');
    await ui.click('Installer');
    const request = controller.expectOne('/api/starter-template');
    expect(request.request.method).toBe('POST');
    request.flush({ accountsCreated: 23, categoriesCreated: 16 });
    await settle();
    await loads(setup({ fiscalYear: true, categories: true }));
    expect(ui.snackbar).toContain('16 catégorie(s)');
  });

  it('ajoute le compte bancaire en réutilisant le compte 512 libre du plan, sans le demander à la personne', async () => {
    await create(setup({ fiscalYear: true, categories: true }));
    await click('Ajouter mon compte');
    expect(ui.title).toBe('Ajouter un compte bancaire ou une caisse');
    await ui.type('input[formcontrolname="name"]', 'Compte courant');
    await ui.type('input[formcontrolname="openingBalance"]', '1250,00');
    await ui.submit();
    controller.expectOne('/api/accounts').flush([
      { id: 'a512', number: '512', label: 'Banque', active: true, reportLine: null },
      { id: 'a530', number: '530', label: 'Caisse', active: true, reportLine: null },
    ]);
    await settle();
    const request = controller.expectOne('/api/financial-accounts');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ name: 'Compte courant', type: 'BANK', accountId: 'a512', openingBalance: '1250.00' });
    request.flush({ id: 'f1', name: 'Compte courant', type: 'BANK', accountId: 'a512', accountNumber: '512', journalCode: 'BQ-1', balances: {} }, { status: 201, statusText: 'Created' });
    await settle();
    await loads(setup({ fiscalYear: true, categories: true, financialAccount: true }), [{ id: 'f1', accountId: 'a512', name: 'Compte courant' }]);
    expect(root.textContent).toContain('Tout est prêt');
    expect(root.querySelector('a[href="/vue-d-ensemble"]')).not.toBeNull();
  });

  it('pour un deuxième compte bancaire, crée le compte du plan suivant (5121) au lieu de réutiliser le 512 déjà pris', async () => {
    await create(setup({ fiscalYear: true, categories: true, financialAccount: true }), [{ id: 'f1', accountId: 'a512', name: 'Compte courant' }]);
    await click('Ajouter un autre compte');
    await ui.type('input[formcontrolname="name"]', 'Livret');
    await ui.submit();
    controller.expectOne('/api/accounts').flush([{ id: 'a512', number: '512', label: 'Banque', active: true, reportLine: null }]);
    await settle();
    const created = controller.expectOne('/api/accounts');
    expect(created.request.method).toBe('POST');
    expect(created.request.body).toEqual({ number: '5121', label: 'Banque — Livret' });
    created.flush({ id: 'a5121', number: '5121', label: 'Banque — Livret', active: true, reportLine: null }, { status: 201, statusText: 'Created' });
    await settle();
    expect(controller.expectOne('/api/financial-accounts').request.body).toMatchObject({ accountId: 'a5121', type: 'BANK' });
  });
});
