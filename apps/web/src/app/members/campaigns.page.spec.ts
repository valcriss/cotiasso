import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { CampaignsPage } from './campaigns.page';

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
});
