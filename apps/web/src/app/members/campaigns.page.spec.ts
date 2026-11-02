import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { CampaignsPage } from './campaigns.page';

const allocation = (overrides: Record<string, unknown> = {}) => ({
  id: 'al1',
  transactionId: 'tx1',
  transactionDate: '2025-11-12',
  accountName: 'Banque',
  amount: '10.00',
  kind: 'PAYMENT',
  note: null,
  cancelled: false,
  cancelReason: null,
  ...overrides,
});

const tariff = { id: 't1', label: 'Plein tarif', amount: '30.00', categoryId: null, categoryName: null, membershipCount: 1 };
const campaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Adhésions 2025-2026',
  startsOn: '2025-09-29',
  endsOn: '2026-09-28',
  effectiveMode: 'PAYMENT',
  tariffs: [tariff, { id: 't2', label: 'Gratuit', amount: '0.00', categoryId: null, categoryName: null, membershipCount: 0 }],
  membershipCount: 1,
  locked: true,
  ...overrides,
});
const membership = (overrides: Record<string, unknown> = {}) => ({
  id: 'ms1',
  campaignId: 'c1',
  campaignName: 'Adhésions 2025-2026',
  memberId: 'm1',
  memberName: 'Dupont Marie',
  tariffId: 't1',
  tariffLabel: 'Plein tarif',
  expectedAmount: '30.00',
  exemptionReason: null,
  status: 'PENDING',
  effectiveOn: null,
  effectiveOrigin: null,
  cancelReason: null,
  paid: '0.00',
  balance: '30.00',
  overpaid: false,
  version: 1,
  ...overrides,
});

describe('CampaignsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<CampaignsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], campaigns: object[] = [campaign()]) => {
    await TestBed.configureTestingModule({
      imports: [CampaignsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CampaignsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/campaigns').flush(campaigns);
    await settle();
    controller.expectOne('/api/member-categories').flush([]);
    await settle();
  };
  const button = (label: string) => {
    const found = Array.from(root.querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label));
    expect(found, label).toBeTruthy();
    return found!;
  };
  const click = async (label: string) => {
    button(label).click();
    await settle();
  };
  const openFirst = async (memberships: object[] = [membership()], c: object = campaign()) => {
    await click('Ouvrir la campagne Adhésions 2025-2026');
    controller.expectOne('/api/campaigns/c1/memberships').flush(memberships);
    await settle();
    return c;
  };
  const reloadAll = async (campaigns: object[], memberships: object[]) => {
    controller.expectOne('/api/campaigns').flush(campaigns);
    await settle();
    controller.expectOne('/api/campaigns/c1/memberships').flush(memberships);
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it("guide l'utilisateur quand il n'y a aucune campagne", async () => {
    await create(['members:view', 'members:manage'], []);
    expect(root.textContent).toContain('Aucune campagne');
    expect(root.textContent).toContain('Nouvelle campagne');
  });

  it("liste les campagnes avec leurs dates et le mode d'adhésion effective, sans actions en lecture seule", async () => {
    await create(['members:view']);
    const text = root.textContent!;
    expect(text).toContain('Du 2025-09-29 au 2026-09-28');
    expect(text).toContain("À l'encaissement");
    expect(text).not.toContain('Nouvelle campagne');
  });

  it("crée une campagne aux dates explicites avec le mode choisi", async () => {
    await create(['members:view', 'members:manage'], []);
    await click('Nouvelle campagne');
    expect(ui.title).toBe('Nouvelle campagne');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.type('input[formcontrolname="name"]', 'Adhésions 2026-2027');
    await ui.type('input[formcontrolname="startsOn"]', '2026-09-29');
    await ui.type('input[formcontrolname="endsOn"]', '2027-09-28');
    await ui.choose('mat-select[formcontrolname="effectiveMode"]', 'validation par le bureau');
    await ui.submit();
    const request = controller.expectOne('/api/campaigns');
    expect(request.request.body).toEqual({ name: 'Adhésions 2026-2027', startsOn: '2026-09-29', endsOn: '2027-09-28', effectiveMode: 'VALIDATION' });
    request.flush(campaign({ id: 'c2', name: 'Adhésions 2026-2027', tariffs: [], membershipCount: 0, locked: false }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/campaigns').flush([campaign({ id: 'c2', name: 'Adhésions 2026-2027', tariffs: [], membershipCount: 0, locked: false })]);
    await settle();
    controller.expectOne('/api/campaigns/c2/memberships').flush([]);
    await settle();
    expect(ui.snackbar).toContain('ajoutez-lui ses tarifs');
  });

  it("explique un chevauchement de campagne refusé par le serveur", async () => {
    await create(['members:view', 'members:manage'], []);
    await click('Nouvelle campagne');
    await ui.type('input[formcontrolname="name"]', 'Chevauche');
    await ui.type('input[formcontrolname="startsOn"]', '2026-01-01');
    await ui.type('input[formcontrolname="endsOn"]', '2026-12-31');
    await ui.submit();
    controller.expectOne('/api/campaigns').flush({ message: 'Cette campagne chevauche une autre campagne : les périodes ne se recouvrent pas.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.error).toContain('chevauche');
    expect(ui.isOpen).toBe(true);
  });

  it("affiche les tarifs, ne propose de retirer que ceux qui ne servent à personne, et ajoute un tarif", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst();
    const tariffs = root.querySelector('section[aria-label="Tarifs de Adhésions 2025-2026"]')!.textContent!;
    expect(tariffs).toContain('Plein tarif');
    expect(tariffs).toContain('30,00 €');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.getAttribute('aria-label') === 'Retirer le tarif Plein tarif')).toBe(false);
    expect(button('Retirer le tarif Gratuit')).toBeTruthy();

    await click('Ajouter un tarif');
    await ui.type('input[formcontrolname="label"]', 'Tarif réduit');
    await ui.type('input[formcontrolname="amount"]', '15,50');
    await ui.submit();
    const request = controller.expectOne('/api/campaigns/c1/tariffs');
    expect(request.request.body).toEqual({ label: 'Tarif réduit', amount: '15.50', categoryId: null });
    request.flush(campaign(), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/campaigns').flush([campaign()]);
    await settle();
    expect(ui.snackbar).toContain('Tarif ajouté');
  });

  it("inscrit un membre avec son tarif, et explique qu'un montant différent exige une raison", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst([]);
    await click('Nouvelle adhésion');
    controller.expectOne((r) => r.url === '/api/members').flush({ members: [{ id: 'm1', firstName: 'Marie', lastName: 'Dupont' }], next: null });
    await settle();
    expect(ui.title).toBe('Nouvelle adhésion');
    await ui.choose('mat-select[formcontrolname="memberId"]', 'Dupont Marie');
    await ui.type('input[formcontrolname="expectedAmount"]', '0');
    await ui.submit();
    const request = controller.expectOne('/api/campaigns/c1/memberships');
    expect(request.request.body).toEqual({ memberId: 'm1', tariffId: 't1', expectedAmount: '0.00' });
    request.flush({ message: 'Le montant diffère du tarif : indiquez la raison (exonération, remise…).' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.error).toContain('raison');

    await ui.type('input[formcontrolname="exemptionReason"]', 'Bénévole du bureau');
    await ui.submit();
    const second = controller.expectOne('/api/campaigns/c1/memberships');
    expect(second.request.body).toMatchObject({ exemptionReason: 'Bénévole du bureau' });
    second.flush(membership({ status: 'EFFECTIVE', expectedAmount: '0.00', effectiveOrigin: 'EXEMPTION', effectiveOn: '2026-01-10' }), { status: 201, statusText: 'Created' });
    await settle();
    await reloadAll([campaign()], [membership({ status: 'EFFECTIVE', expectedAmount: '0.00', effectiveOrigin: 'EXEMPTION', effectiveOn: '2026-01-10' })]);
    expect(ui.snackbar).toContain('Adhésion de Dupont Marie enregistrée');
  });

  it("n'affiche « Valider » que pour une adhésion en attente d'une campagne par validation, et valide", async () => {
    await create(['members:view', 'members:manage'], [campaign({ effectiveMode: 'VALIDATION' })]);
    await openFirst();
    await click("Valider l'adhésion de Dupont Marie");
    controller.expectOne('/api/memberships/ms1/validate').flush(membership({ status: 'EFFECTIVE', effectiveOrigin: 'VALIDATION', effectiveOn: '2026-01-10' }));
    await settle();
    await reloadAll([campaign({ effectiveMode: 'VALIDATION' })], [membership({ status: 'EFFECTIVE', effectiveOrigin: 'VALIDATION', effectiveOn: '2026-01-10' })]);
    expect(ui.snackbar).toContain('validée');
    expect(root.textContent).toContain('depuis le 2026-01-10 (validation)');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Valider'))).toBe(false);
  });

  it("annule une adhésion avec un motif obligatoire, en rassurant sur l'historique", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst();
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent!.includes('Valider'))).toBe(false);
    await click("Annuler l'adhésion de Dupont Marie");
    expect(ui.text).toContain("conservée dans l'historique");
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs');
    await ui.type('input[formcontrolname="reason"]', 'Démission');
    await ui.submit();
    const request = controller.expectOne('/api/memberships/ms1/cancel');
    expect(request.request.body).toEqual({ reason: 'Démission' });
    request.flush(membership({ status: 'CANCELLED', cancelReason: 'Démission' }));
    await settle();
    await reloadAll([campaign()], [membership({ status: 'CANCELLED', cancelReason: 'Démission' })]);
    expect(ui.snackbar).toContain('Adhésion annulée');
    expect(root.textContent).toContain('Démission');
  });

  it("affiche le payé, le reste dû et le trop-perçu de chaque adhésion", async () => {
    await create(['members:view']);
    await openFirst([membership({ paid: '10.00', balance: '20.00' }), membership({ id: 'ms2', memberName: 'Martin Paul', paid: '50.00', balance: '-20.00', overpaid: true, status: 'EFFECTIVE', effectiveOn: '2026-01-10', effectiveOrigin: 'PAYMENT' })]);
    const text = root.querySelector('section[aria-label="Adhésions de Adhésions 2025-2026"]')!.textContent!;
    expect(text).toContain('10,00 €');
    expect(text).toContain('20,00 €');
    expect(text).toContain('Trop-perçu 20,00 €');
  });

  it("liste les cotisations restant dues et propose leur export CSV", async () => {
    await create(['members:view']);
    await openFirst([membership()]);
    await click('Cotisations restant dues');
    controller.expectOne('/api/campaigns/c1/reminders').flush({
      campaignName: 'Adhésions 2025-2026',
      totalDue: '30.00',
      items: [{ membership: membership(), email: 'marie@asso.fr', phone: null }],
    });
    await settle();
    const text = root.querySelector('[aria-label="Cotisations restant dues"]')!.textContent!;
    expect(text).toContain('1 cotisation(s) restent à payer');
    expect(text).toContain('30,00 €');
    expect(text).toContain('marie@asso.fr');
    const link = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('Exporter la liste'))!;
    expect(link.getAttribute('href')).toBe('/api/campaigns/c1/reminders/csv');
  });

  it("dit quand toutes les cotisations sont réglées", async () => {
    await create(['members:view']);
    await openFirst([membership()]);
    await click('Cotisations restant dues');
    controller.expectOne('/api/campaigns/c1/reminders').flush({ campaignName: 'x', totalDue: '0.00', items: [] });
    await settle();
    expect(root.textContent).toContain('Toutes les cotisations de cette campagne sont réglées');
  });

  describe('rattacher un règlement et l’enregistrer dans les comptes d’un même geste (ADR 0028)', () => {
    const BOOKING = ['members:view', 'members:manage', 'transactions:manage', 'entries:create', 'entries:post'];
    const cotisations = { id: 'c-cot', direction: 'IN', label: 'Cotisations des adhérents', hint: '', active: true, usage: 'MEMBERSHIP', account: { id: 'a756', number: '756', label: 'Cotisations' } };
    /** Ouvre les règlements ; la boîte charge aussi les catégories quand la personne peut enregistrer dans les comptes. */
    const openPayments = async (permissions: string[], candidate: object, categories: object[] = [cotisations]) => {
      await create(permissions);
      await openFirst();
      await click('Règlements de Dupont Marie');
      controller.expectOne('/api/memberships/ms1/allocations').flush([]);
      await settle();
      controller.expectOne((r) => r.url === '/api/memberships/ms1/payment-candidates').flush([candidate]);
      if (permissions.includes('transactions:manage')) controller.expectOne('/api/operation-categories').flush(categories);
      await settle();
    };
    const candidate = (canBook: boolean) => ({ id: 'tx1', operationDate: '2025-11-12', label: 'Chèque de Marie', accountName: 'Banque', amount: '30.00', remaining: '30.00', canBook });
    const submitAllocation = async () => {
      await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
      ui.dialog!.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      const request = controller.expectOne('/api/memberships/ms1/allocations');
      expect(request.request.method).toBe('POST');
      request.flush({ allocation: allocation({ amount: '30.00' }), membership: membership({ status: 'EFFECTIVE', paid: '30.00', balance: '0.00', effectiveOrigin: 'PAYMENT', effectiveOn: '2025-11-12' }) });
      await settle();
    };
    const reloadAfter = async () => {
      controller.expectOne('/api/memberships/ms1/allocations').flush([allocation({ amount: '30.00' })]);
      await settle();
      controller.expectOne((r) => r.url === '/api/memberships/ms1/payment-candidates').flush([]);
      await settle();
    };

    it('propose la case quand le mouvement n’est pas encore dans les comptes, puis rattache et enregistre', async () => {
      await openPayments(BOOKING, candidate(true));
      await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
      expect(ui.text).toContain('L’enregistrer aussi dans les comptes (catégorie « Cotisations des adhérents »)');
      await submitAllocation();
      const book = controller.expectOne('/api/transactions/tx1/book');
      expect(book.request.body).toEqual({ categoryId: 'c-cot', post: true });
      book.flush({ transactionId: 'tx1', entryId: 'e1', posted: true, journalCode: 'BQ-1', number: 4 }, { status: 201, statusText: 'Created' });
      await settle();
      await reloadAfter();
      expect(ui.snackbar).toContain('Rattaché et enregistré dans les comptes');
    });

    it('rattache seulement quand la case est décochée', async () => {
      await openPayments(BOOKING, candidate(true));
      await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
      ui.field<HTMLInputElement>('mat-checkbox input').click();
      await settle();
      await submitAllocation();
      await reloadAfter();
      expect(ui.snackbar).toContain('l’adhésion est effective');
      expect(ui.snackbar).not.toContain('dans les comptes');
    });

    it('si l’enregistrement est refusé, le rattachement reste valable et la personne sait quoi faire', async () => {
      await openPayments(BOOKING, candidate(true));
      await submitAllocation();
      controller
        .expectOne('/api/transactions/tx1/book')
        .flush({ message: "L'exercice de ce mouvement est fermé à la saisie." }, { status: 409, statusText: 'Conflict' });
      await settle();
      await reloadAfter();
      expect(ui.snackbar).toContain('Rattaché, mais pas encore enregistré dans les comptes');
      expect(ui.snackbar).toContain("L'exercice de ce mouvement est fermé à la saisie.");
      expect(ui.snackbar).toContain('Classer et enregistrer');
      expect(ui.text).toContain('Reste dû : 0,00 €');
    });

    it('ne propose rien si le mouvement est déjà dans les comptes, si aucune catégorie n’est désignée ou sans le droit de saisie', async () => {
      await openPayments(BOOKING, candidate(false));
      await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
      expect(ui.dialog!.querySelector('mat-checkbox')).toBeNull();
      ui.closeAll();
      TestBed.resetTestingModule();
      await openPayments(BOOKING, candidate(true), [{ ...cotisations, usage: null }]);
      await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
      expect(ui.dialog!.querySelector('mat-checkbox')).toBeNull();
      ui.closeAll();
      TestBed.resetTestingModule();
      await openPayments(['members:view', 'members:manage'], candidate(true));
      await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
      expect(ui.dialog!.querySelector('mat-checkbox')).toBeNull();
    });
  });

  it("affecte une transaction à une adhésion : candidats, montant proposé, effet sur l'adhésion", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst();
    await click('Règlements de Dupont Marie');
    controller.expectOne('/api/memberships/ms1/allocations').flush([]);
    await settle();
    controller.expectOne((r) => r.url === '/api/memberships/ms1/payment-candidates').flush([
      { id: 'tx1', operationDate: '2025-11-12', label: 'Chèque de Marie', accountName: 'Banque', amount: '30.00', remaining: '30.00' },
    ]);
    await settle();
    expect(ui.title).toBe('Règlements de Dupont Marie');
    expect(ui.text).toContain('Attendu : 30,00 €');
    expect(ui.text).toContain('Aucun règlement affecté');
    await ui.choose('mat-select[formcontrolname="transactionId"]', 'Chèque de Marie');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').value).toBe('30,00');
    ui.dialog!.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    const request = controller.expectOne('/api/memberships/ms1/allocations');
    expect(request.request.body).toEqual({ transactionId: 'tx1', amount: '30.00', kind: 'PAYMENT' });
    request.flush({ allocation: allocation({ amount: '30.00' }), membership: membership({ status: 'EFFECTIVE', paid: '30.00', balance: '0.00', effectiveOrigin: 'PAYMENT', effectiveOn: '2025-11-12' }) });
    await settle();
    controller.expectOne('/api/memberships/ms1/allocations').flush([allocation({ amount: '30.00' })]);
    await settle();
    controller.expectOne((r) => r.url === '/api/memberships/ms1/payment-candidates').flush([]);
    await settle();
    expect(ui.snackbar).toContain("l’adhésion est effective");
    expect(ui.text).toContain('Reste dû : 0,00 €');
    expect(ui.text).toContain('Règlement de 30,00 €');
    ui.dialog!.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.textContent!.includes('Fermer') && b.click());
    await settle();
    await reloadAll([campaign()], [membership({ status: 'EFFECTIVE', paid: '30.00', balance: '0.00', effectiveOrigin: 'PAYMENT', effectiveOn: '2025-11-12' })]);
  });

  it("annule une affectation avec un motif, et montre le reçu simple dès qu'il y a un règlement", async () => {
    await create(['members:view', 'members:manage']);
    await openFirst([membership({ paid: '30.00', balance: '0.00', status: 'EFFECTIVE', effectiveOrigin: 'PAYMENT', effectiveOn: '2025-11-12' })]);
    await click('Règlements de Dupont Marie');
    controller.expectOne('/api/memberships/ms1/allocations').flush([allocation({ amount: '30.00' }), allocation({ id: 'al2', amount: '5.00', cancelled: true, cancelReason: 'Erreur' })]);
    await settle();
    controller.expectOne((r) => r.url === '/api/memberships/ms1/payment-candidates').flush([]);
    await settle();
    expect(ui.text).toContain('Voir le reçu simple');
    expect(ui.text).toContain('annulé : Erreur');
    ui.dialog!.querySelector<HTMLButtonElement>('button[aria-label^="Annuler l"]')!.click();
    await settle();
    expect(ui.title).toBe('Annuler cette affectation ?');
    await ui.click("Annuler l'affectation");
    expect(ui.error).toContain('3 caractères');
    await ui.type('input[formcontrolname="reason"]', 'Chèque rejeté');
    await ui.click("Annuler l'affectation");
    const request = controller.expectOne('/api/allocations/al1/cancel');
    expect(request.request.body).toEqual({ reason: 'Chèque rejeté' });
    request.flush(membership({ paid: '0.00', balance: '30.00' }));
    await settle();
    controller.expectOne('/api/memberships/ms1/allocations').flush([allocation({ cancelled: true, cancelReason: 'Chèque rejeté' })]);
    await settle();
    controller.expectOne((r) => r.url === '/api/memberships/ms1/payment-candidates').flush([]);
    await settle();
    expect(ui.snackbar).toContain('Affectation annulée');
  });
});
