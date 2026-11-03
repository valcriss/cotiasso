import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { OperationLauncher } from './operation-launcher';

@Component({ template: '' })
class Host {}

const bank = { id: 'f1', name: 'Compte courant', type: 'BANK', currency: 'EUR', reference: null, accountId: 'a512', accountNumber: '512', journalId: 'j1', journalCode: 'BQ-1', openedOn: '2026-01-01', archivedOn: null, balances: {} };
const categories = [
  { id: 'c-in', direction: 'IN', label: 'Cotisations des adhérents', hint: 'Argent reçu pour une adhésion.', active: true, account: { id: 'a756', number: '756', label: 'Cotisations' } },
  { id: 'c-don', direction: 'IN', label: 'Dons', hint: 'Argent donné sans contrepartie.', active: true, account: { id: 'a754', number: '754', label: 'Dons et libéralités' } },
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
  const open = async (direction: 'IN' | 'OUT', accounts: object[] = [bank], list: object[] = categories) => {
    const result = launcher.open(direction);
    await settle();
    controller.expectOne('/api/financial-accounts').flush(accounts);
    controller.expectOne('/api/operation-categories').flush(list);
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
    expect(await (await open('IN', [bank], [categories[2]!])).result).toBeUndefined();
    expect(ui.snackbar).toContain('pas encore de catégorie');
  });

  it('enregistre une dépense : aperçu à partie double en direct, un seul envoi, confirmation par un bandeau', async () => {
    await start(['transactions:manage', 'entries:create', 'entries:post']);
    const { result } = await open('OUT');
    expect(ui.title).toBe('J’ai dépensé de l’argent');
    expect(ui.text).toContain('le logiciel s’occupe de la comptabilité');
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

  describe('fractionner le montant sur plusieurs catégories', () => {
    const MANAGE = ['transactions:manage', 'entries:create', 'entries:post'];
    const part = (n: number) => ({ category: `mat-select[aria-label="Catégorie de la part ${n}"]`, amount: `input[aria-label="Montant de la part ${n}"]` });

    it('ne propose de fractionner qu’une fois le montant connu', async () => {
      await start(MANAGE);
      await open('IN');
      expect(ui.button('Fractionner').disabled).toBe(true);
      expect(ui.text).toContain('Indiquez d’abord le montant');
      await ui.type('input[formcontrolname="amount"]', '20');
      expect(ui.button('Fractionner').disabled).toBe(false);
    });

    it('répartit 20 € en 10 € de cotisations et 10 € de dons : le reste se calcule, l’aperçu montre chaque ligne, un seul envoi', async () => {
      await start(MANAGE);
      const { result } = await open('IN');
      await ui.type('input[formcontrolname="amount"]', '20');
      await ui.type('input[formcontrolname="label"]', 'Cotisation et don de Marie');
      await ui.click('Fractionner');
      expect(ui.dialog!.querySelector('mat-select[formcontrolname="categoryId"]')).toBeNull();

      await ui.choose(part(1).category, 'Cotisations');
      await ui.type(part(1).amount, '10');
      // La dernière ligne reprend ce qui reste, sans que la personne ait à calculer.
      expect(ui.field<HTMLInputElement>(part(2).amount).value).toBe('10,00');
      await ui.choose(part(2).category, 'Dons');
      expect(ui.text).toContain('Tout le montant (20,00 €) est réparti');
      expect(ui.text).toContain('756 · Cotisations');
      expect(ui.text).toContain('754 · Dons et libéralités');

      await ui.submit();
      const request = controller.expectOne('/api/guided-operations');
      expect(request.request.body).toMatchObject({ direction: 'IN', amount: '20.00', splits: [{ categoryId: 'c-in', amount: '10.00' }, { categoryId: 'c-don', amount: '10.00' }] });
      expect(request.request.body).not.toHaveProperty('categoryId');
      request.flush({ transactionId: 't1', entryId: 'e1', posted: true, journalCode: 'BQ-1', number: 3 }, { status: 201, statusText: 'Created' });
      expect(await result).toMatchObject({ posted: true });
    });

    it('n’envoie rien tant que tout le montant n’est pas réparti, et dit ce qu’il reste', async () => {
      await start(MANAGE);
      await open('IN');
      await ui.type('input[formcontrolname="amount"]', '20');
      await ui.type('input[formcontrolname="label"]', 'Mixte');
      await ui.click('Fractionner');
      await ui.choose(part(1).category, 'Cotisations');
      await ui.type(part(1).amount, '10');
      await ui.choose(part(2).category, 'Dons');
      await ui.type(part(2).amount, '4,50');
      expect(ui.text).toContain('Reste à répartir : 5,50 €');
      await ui.submit();
      expect(ui.error).toContain('Le total des parts doit être égal au montant');
      controller.expectNone('/api/guided-operations');

      await ui.type(part(2).amount, '12');
      expect(ui.text).toContain('Trop réparti de 2,00 €');
    });

    it('permet de revenir à une seule catégorie, et de suivre un changement du montant', async () => {
      await start(MANAGE);
      await open('IN');
      await ui.type('input[formcontrolname="amount"]', '20');
      await ui.type('input[formcontrolname="label"]', 'Retour');
      await ui.click('Fractionner');
      await ui.choose(part(1).category, 'Cotisations');
      await ui.type(part(1).amount, '10');
      // Le montant total change : la dernière ligne non saisie reprend le nouveau reste.
      await ui.type('input[formcontrolname="amount"]', '30');
      expect(ui.field<HTMLInputElement>(part(2).amount).value).toBe('20,00');

      await ui.click('Une seule catégorie');
      expect(ui.dialog!.querySelector('mat-select[formcontrolname="categoryId"]')).not.toBeNull();
      await ui.choose('mat-select[formcontrolname="categoryId"]', 'Cotisations');
      await ui.submit();
      const request = controller.expectOne('/api/guided-operations');
      expect(request.request.body).toMatchObject({ amount: '30.00', categoryId: 'c-in' });
      expect(request.request.body).not.toHaveProperty('splits');
    });

    it('ne laisse pas choisir deux fois la même catégorie', async () => {
      await start(MANAGE);
      await open('IN');
      await ui.type('input[formcontrolname="amount"]', '20');
      await ui.click('Fractionner');
      await ui.choose(part(1).category, 'Cotisations');
      expect(await ui.options(part(2).category)).toEqual(['Dons']);
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
