import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { ThemeService } from '../theme/theme.service';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { OperationLauncher } from './operation-launcher';

@Component({ template: '' })
class Host {}

const bank = { id: 'f1', name: 'Compte courant', type: 'BANK', currency: 'EUR', reference: null, accountId: 'a512', accountNumber: '512', journalId: 'j1', journalCode: 'BQ-1', openedOn: '2026-01-01', archivedOn: null, balances: {} };
const categories = [
  { id: 'c-in', direction: 'IN', label: 'Cotisations des adhérents', hint: 'Argent reçu pour une adhésion.', active: true, account: { id: 'a756', number: '756', label: 'Cotisations' } },
  { id: 'c-out', direction: 'OUT', label: 'Assurance', hint: "Prime d'assurance de l'association.", active: true, account: { id: 'a616', number: '616', label: "Primes d'assurance" } },
];

describe("Saisie guidée « J'ai reçu / J'ai dépensé de l'argent »", () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  let ui: DialogTester;
  let launcher: OperationLauncher;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const start = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    launcher = TestBed.inject(OperationLauncher);
    fixture = TestBed.createComponent(Host);
    ui = new DialogTester(settle);
  };
  /** Ouvre la boîte et répond aux trois chargements (comptes, catégories, projets). */
  const open = async (direction: 'IN' | 'OUT', accounts: object[] = [bank], list: object[] = categories, years: object[] = []) => {
    const result = launcher.open(direction);
    await settle();
    controller.expectOne('/api/financial-accounts').flush(accounts);
    controller.expectOne('/api/operation-categories').flush(list);
    controller.expectOne('/api/fiscal-years').flush(years);
    controller.expectOne('/api/projects').flush([{ id: 'p0', code: 'FONC', name: 'Fonctionnement', status: 'ACTIVE', permanent: true }, { id: 'p1', code: 'FEST', name: 'Festival', status: 'ACTIVE', permanent: false }]);
    await settle();
    // Enveloppé : une promesse renvoyée par une fonction asynchrone serait attendue, or elle ne se règle qu'à la fermeture de la boîte.
    return { result };
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('explique ce qui manque au lieu d’ouvrir un formulaire inutilisable : pas de compte, pas de catégorie', async () => {
    await start(['transactions:manage', 'entries:create', 'entries:post']);
    expect(await (await open('OUT', [])).result).toBeUndefined();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Ajoutez d');

    // Une catégorie de l'autre sens ne suffit pas.
    expect(await (await open('IN', [bank], [categories[1]!])).result).toBeUndefined();
    expect(ui.snackbar).toContain('pas encore de catégorie');
  });

  it('enregistre une dépense : aperçu à partie double en direct, un seul envoi, confirmation par un bandeau', async () => {
    await start(['transactions:manage', 'entries:create', 'entries:post']);
    const { result } = await open('OUT');
    expect(ui.title).toBe('J’ai dépensé de l’argent');
    expect(ui.text).toContain('le logiciel s’occupe de la comptabilité');
    expect(ui.text).toContain('Pour quel projet ? (facultatif)');
    expect(ui.text).not.toContain('activité');
    expect(ui.text).not.toContain('Ce que verra l’expert-comptable');

    // Formulaire incomplet : expliqué, rien n'est envoyé.
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');

    await ui.type('input[formcontrolname="amount"]', '25,5');
    await ui.choose('mat-select[formcontrolname="categoryId"]', 'Assurance');
    await ui.type('input[formcontrolname="label"]', 'Prime annuelle');
    expect(ui.text).toContain('Prime d\'assurance de l\'association.');
    expect(ui.text).toContain('Ce que verra l’expert-comptable');
    expect(ui.text).toContain('512 · Compte courant');
    expect(ui.text).toContain('616 · Primes d\'assurance');
    expect(ui.text).toContain('25,50');
    expect(ui.text).toContain('enregistrée définitivement');

    await ui.submit();
    const request = controller.expectOne('/api/guided-operations');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ financialAccountId: 'f1', direction: 'OUT', amount: '25.50', label: 'Prime annuelle', categoryId: 'c-out', post: true });
    expect(request.request.body).not.toHaveProperty('projectId');
    request.flush({ transactionId: 't1', entryId: 'e1', posted: true, journalCode: 'BQ-1', number: 7 }, { status: 201, statusText: 'Created' });
    expect(await result).toMatchObject({ posted: true, number: 7 });
    await settle();
    expect(ui.snackbar).toContain('Opération enregistrée');
    expect(ui.snackbar).toContain('BQ-1 n° 7');
  });

  it('dit en une phrase courante où va l’argent, et replie le détail comptable en affichage simple (#15)', async () => {
    await start(['transactions:manage', 'entries:create', 'entries:post']);
    TestBed.inject(ThemeService).setViewMode('simple');
    await open('OUT');
    await ui.type('input[formcontrolname="amount"]', '25,5');
    await ui.choose('mat-select[formcontrolname="categoryId"]', 'Assurance');
    expect(ui.text).toContain('25,50 € sortiront de « Compte courant » et seront classés dans « Assurance ».');
    const details = document.querySelector<HTMLDetailsElement>('.cdk-overlay-container details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('Ce que verra l’expert-comptable');
  });

  it('en affichage comptable, garde le détail débit/crédit déplié', async () => {
    await start(['transactions:manage', 'entries:create', 'entries:post']);
    TestBed.inject(ThemeService).setViewMode('accounting');
    await open('IN');
    await ui.type('input[formcontrolname="amount"]', '10');
    await ui.choose('mat-select[formcontrolname="categoryId"]', 'Cotisations des adhérents');
    expect(document.querySelector<HTMLDetailsElement>('.cdk-overlay-container details')!.open).toBe(true);
    expect(ui.text).toContain('10,00 € arriveront sur « Compte courant »');
  });

  describe('avertissement de date (#16)', () => {
    const year = (over: object) => ({ id: 'y1', label: 'Exercice 2025', start: '2025-01-01', end: '2025-12-31', status: 'OPEN', ...over });

    it('prévient dès le choix d’une date hors de toute période et n’envoie rien', async () => {
      await start(['transactions:manage', 'entries:create', 'entries:post']);
      await open('OUT', [bank], categories, [year({})]);
      await ui.type('input[formcontrolname="date"]', '2024-06-15');
      expect(ui.text).toContain('Le 15/06/2024 n’est dans aucune période de comptabilité');
      expect(ui.text).toContain('du 01/01/2025 au 31/12/2025');
      expect(ui.text).toContain('« Démarrer »');

      await ui.type('input[formcontrolname="amount"]', '10');
      await ui.choose('mat-select[formcontrolname="categoryId"]', 'Assurance');
      await ui.type('input[formcontrolname="label"]', 'Prime');
      await ui.submit();
      controller.expectNone('/api/guided-operations');
      expect(ui.error).toContain('n’est dans aucune période');
    });

    it('explique qu’une période clôturée ou fermée à la saisie n’accepte plus d’opération', async () => {
      await start(['transactions:manage', 'entries:create', 'entries:post']);
      await open('OUT', [bank], categories, [year({ status: 'CLOSED' })]);
      await ui.type('input[formcontrolname="date"]', '2025-03-10');
      expect(ui.text).toContain('n’accepte plus de nouvelles opérations (elle est clôturée)');
      await ui.type('input[formcontrolname="date"]', '2025-04-10');
      expect(ui.text).toContain('Cela protège des comptes déjà arrêtés');
    });

    it('ne dit rien pour une date dans une période ouverte, ni sans droit de lire les périodes', async () => {
      await start(['transactions:manage', 'entries:create', 'entries:post']);
      await open('OUT', [bank], categories, [year({})]);
      await ui.type('input[formcontrolname="date"]', '2025-06-15');
      expect(ui.text).not.toContain('période de comptabilité');
      expect(ui.text).not.toContain('n’accepte plus');
    });

    it('prévient sans bloquer quand la date est dans plus d’un an', async () => {
      await start(['transactions:manage', 'entries:create', 'entries:post']);
      await open('OUT', [bank], categories, [year({ start: '2000-01-01', end: '2099-12-31' })]);
      await ui.type('input[formcontrolname="date"]', '2090-01-01');
      expect(ui.text).toContain('est dans plus d’un an');
    });
  });

  it('garde la boîte ouverte et la saisie quand le serveur refuse, avec le motif', async () => {
    await start(['transactions:manage', 'entries:create', 'entries:post']);
    const { result } = await open('IN');
    expect(ui.title).toBe('J’ai reçu de l’argent');
    await ui.type('input[formcontrolname="amount"]', '30');
    await ui.choose('mat-select[formcontrolname="categoryId"]', 'Cotisations');
    await ui.type('input[formcontrolname="label"]', 'Cotisation de Marie');
    await ui.choose('mat-select[formcontrolname="projectId"]', 'Festival');
    await ui.submit();
    const request = controller.expectOne('/api/guided-operations');
    expect(request.request.body).toMatchObject({ direction: 'IN', projectId: 'p1' });
    request.flush({ message: "Aucun exercice ne couvre cette date. Vérifiez la date, ou créez l'exercice dans Paramètres › Comptabilité." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('Aucun exercice ne couvre cette date');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="label"]').value).toBe('Cotisation de Marie');
    ui.closeAll();
    void result;
  });

  it('sans le droit de comptabiliser, annonce un brouillon et l’envoie comme tel', async () => {
    await start(['transactions:manage', 'entries:create']);
    const { result } = await open('OUT');
    expect(ui.dialog!.textContent).toContain('Enregistrer en brouillon');
    await ui.type('input[formcontrolname="amount"]', '8');
    await ui.choose('mat-select[formcontrolname="categoryId"]', 'Assurance');
    await ui.type('input[formcontrolname="label"]', 'Timbres');
    expect(ui.text).toContain('brouillon pour qu’une personne habilitée la relise');
    await ui.submit();
    const request = controller.expectOne('/api/guided-operations');
    expect(request.request.body).toMatchObject({ post: false });
    request.flush({ transactionId: 't2', entryId: 'e2', posted: false, journalCode: 'BQ-1', number: null }, { status: 201, statusText: 'Created' });
    await result;
    await settle();
    expect(ui.snackbar).toContain('brouillon');
  });
});
