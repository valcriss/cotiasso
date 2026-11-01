import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { AccountingPage, parseAccountCsv } from './accounting.page';

const year = { id: 'y1', label: 'Exercice 2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' };
const journal = { id: 'j1', code: 'OD', label: 'Opérations diverses', type: 'MISC', active: true };
const account = { id: 'a1', number: '512', label: 'Banque', active: true, reportLine: null };

describe('AccountingPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<AccountingPage>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const flushLists = async (accounts: object[] = [account]) => {
    controller.expectOne('/api/fiscal-years').flush([year]);
    controller.expectOne('/api/journals').flush([journal]);
    controller.expectOne('/api/accounts').flush(accounts);
    await settle();
  };
  const create = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [AccountingPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountingPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    await flushLists();
  };

  afterEach(() => controller.verify());

  it('affiche exercices, journaux et comptes en lecture seule sans le droit d’administrer', async () => {
    await create(['entries:view']);
    const text = root.textContent!;
    expect(text).toContain('Exercice 2026');
    expect(text).toContain('Opérations diverses');
    expect(text).toContain('Banque');
    expect(text).toContain('mais pas la modifier');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input[type="file"]')).toBeNull();
  });

  it('crée un exercice puis recharge les listes', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    const form = root.querySelectorAll('form')[0]!;
    const set = (name: string, value: string) => {
      const input = form.querySelector<HTMLInputElement>(`[formcontrolname="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('label', 'Exercice 2027');
    set('start', '2027-01-01');
    set('end', '2027-12-31');
    fixture.detectChanges();
    form.dispatchEvent(new Event('submit'));
    await settle();

    const request = controller.expectOne('/api/fiscal-years');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ label: 'Exercice 2027', start: '2027-01-01', end: '2027-12-31' });
    request.flush({ ...year, id: 'y2' }, { status: 201, statusText: 'Created' });
    await settle();
    await flushLists();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Exercice créé');
  });

  it('affiche le refus du serveur, par exemple un chevauchement', async () => {
    await create(['entries:view', 'settings.accounting:admin']);
    const form = root.querySelectorAll('form')[0]!;
    for (const [name, value] of [['label', 'X'], ['start', '2026-06-01'], ['end', '2027-06-01']] as const) {
      const input = form.querySelector<HTMLInputElement>(`[formcontrolname="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    form.dispatchEvent(new Event('submit'));
    await settle();
    controller
      .expectOne('/api/fiscal-years')
      .flush({ message: "Ces dates chevauchent l'exercice « Exercice 2026 »." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('chevauchent');
  });

  it('filtre le plan de comptes', async () => {
    await create(['entries:view']);
    controller.verify();
    const filterInput = root.querySelector<HTMLInputElement>('section[aria-labelledby="ac-title"] input')!;
    filterInput.value = 'zzz';
    filterInput.dispatchEvent(new Event('input'));
    await settle();
    expect(root.textContent).toContain('Aucun compte à afficher');
  });
});

describe('parseAccountCsv', () => {
  it('lit « numéro;libellé », ignore l’en-tête et les lignes vides', () => {
    const result = parseAccountCsv('Numéro;Libellé\r\n512;Banque\r\n\r\n"530";"Caisse"\r\n706\tPrestations');
    expect(result.errors).toEqual([]);
    expect(result.accounts).toEqual([
      { number: '512', label: 'Banque' },
      { number: '530', label: 'Caisse' },
      { number: '706', label: 'Prestations' },
    ]);
  });

  it('signale les numéros invalides et les libellés manquants avec leur numéro de ligne', () => {
    const result = parseAccountCsv('512;Banque\n12;Trop court\n530;\n9;X');
    expect(result.accounts).toEqual([{ number: '512', label: 'Banque' }]);
    expect(result.errors).toEqual([
      'Ligne 2 : numéro « 12 » invalide.',
      'Ligne 3 : libellé manquant.',
      'Ligne 4 : numéro « 9 » invalide.',
    ]);
  });

  it('conserve les libellés contenant un point-virgule après le premier séparateur', () => {
    expect(parseAccountCsv('601;Achats; matières').accounts).toEqual([{ number: '601', label: 'Achats; matières' }]);
  });
});
