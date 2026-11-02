import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { GrantsPage } from './grants.page';

const today = new Date().toISOString().slice(0, 10);
const funder = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'Région',
  type: 'LOCAL_AUTHORITY',
  contactName: 'Mme Durand',
  email: 'culture@region.test',
  phone: '',
  note: '',
  archived: false,
  grantCount: 1,
  ...over,
});
const grant = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  funder: { id: 'f1', name: 'Région', type: 'LOCAL_AUTHORITY', archived: false },
  reference: 'RF-14',
  title: 'Aide au festival',
  status: 'REQUESTED',
  requestedAmount: '1000.00',
  grantedAmount: null,
  requestedOn: '2026-02-01',
  decidedOn: null,
  periodStart: null,
  periodEnd: null,
  conditions: '',
  note: '',
  reason: null,
  closedOn: null,
  residual: null,
  residualNote: null,
  allocations: [
    { projectId: 'p1', projectCode: 'ATELIERS', projectName: 'Ateliers', amount: '600.00' },
    { projectId: 'p2', projectCode: 'FESTIVAL', projectName: 'Festival', amount: '400.00' },
  ],
  allocatedTotal: '1000.00',
  received: '0.00',
  ...over,
});
const projects = [
  { id: 'p1', code: 'ATELIERS', name: 'Ateliers', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null },
  { id: 'p2', code: 'FESTIVAL', name: 'Festival', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null },
];

describe('GrantsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<GrantsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Monte la page ; `funders` est `undefined` quand l'utilisateur n'a pas le droit global (la liste n'est alors pas demandée). */
  const create = async (permissions: string[], grants: unknown[], funders?: unknown[]) => {
    await TestBed.configureTestingModule({
      imports: [GrantsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GrantsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/grants').flush(grants);
    await settle();
    if (funders !== undefined) {
      controller.expectOne('/api/funders').flush(funders);
      await settle();
    }
  };
  /** Recharge après une action : la liste, les financeurs puis, si une subvention est ouverte, son détail. */
  const reload = async (grants: unknown[], funders: unknown[] | undefined, detail?: unknown) => {
    await settle();
    controller.expectOne('/api/grants').flush(grants);
    await settle();
    if (funders !== undefined) {
      controller.expectOne('/api/funders').flush(funders);
      await settle();
    }
    if (detail) {
      controller.expectOne(`/api/grants/${(detail as { id: string }).id}`).flush(detail);
      await settle();
      if (['GRANTED', 'CLOSED'].includes((detail as { status: string }).status)) await flushFinance((detail as { id: string }).id);
    }
  };
  /** Une subvention accordée ou clôturée affiche son échéancier : le panneau charge sa vue financière. */
  const flushFinance = async (grantId = 'g1', over: Record<string, unknown> = {}) => {
    controller.expectOne(`/api/grants/${grantId}/expenses`).flush({
      grantId,
      granted: '1000.00',
      spent: '0.00',
      overGranted: false,
      overBy: null,
      expenses: [],
      warnings: [],
    });
    controller.expectOne((r) => r.url === `/api/grants/${grantId}/report`).flush({
      grant: { id: grantId, title: 'Aide au festival', funder: 'Région', reference: null, periodStart: null, periodEnd: null },
      period: { from: null, to: null },
      granted: '1000.00',
      groups: [],
      spent: '0.00',
      payments: [],
      received: '0.00',
      residual: '0.00',
      overGranted: false,
      coFinancingReasons: [],
      warnings: [],
    });
    controller.expectOne(`/api/grants/${grantId}/finance`).flush({
      grantId,
      granted: '1000.00',
      planned: '0.00',
      received: '0.00',
      remaining: '1000.00',
      unplanned: '1000.00',
      overReceived: false,
      spent: '0.00',
      residual: '0.00',
      schedule: [],
      payments: [],
      ...over,
    });
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
  const buttons = () => Array.from(root.querySelectorAll('button')).map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
  const has = (label: string) => buttons().some((b) => b.includes(label));
  const text = () => root.textContent!.replace(/\s+/g, ' ');
  const MANAGER = ['grants:view', 'grants:manage'];

  afterEach(() => {
    ui.closeAll();
    TestBed.inject(OverlayContainer).getContainerElement().innerHTML = '';
    controller.verify();
  });

  it('explique à quoi servent les subventions et quoi faire en premier quand il n’y en a pas', async () => {
    await create(MANAGER, [], []);
    expect(text()).toContain("rien n'est écrit dans la comptabilité");
    expect(text()).toContain("Ajoutez d'abord le financeur");
    expect(has('Demander une subvention')).toBe(true);
    expect(has('Nouveau financeur')).toBe(true);
  });

  it('en lecture seule, liste les subventions sans aucune action de modification', async () => {
    await create(['grants:view'], [grant()], [funder()]);
    expect(has('Demander une subvention')).toBe(false);
    expect(has('Nouveau financeur')).toBe(false);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    expect(has('Modifier')).toBe(false);
    expect(has("Enregistrer l'accord")).toBe(false);
  });

  it('pour un responsable limité à un projet, ne demande ni n’affiche la liste des financeurs', async () => {
    await create([], [grant()]);
    expect(text()).toContain('Aide au festival');
    expect(root.querySelector('[aria-label="Financeurs"]')).toBeNull();
    expect(has('Demander une subvention')).toBe(false);
  });

  it('montre objet, financeur, état, montants et projets de chaque subvention', async () => {
    await create(MANAGER, [grant(), grant({ id: 'g2', title: 'Soutien', reference: null, status: 'GRANTED', grantedAmount: '900.00', requestedAmount: '1200.00', received: '300.00', allocations: [] })], [funder()]);
    const rows = Array.from(root.querySelectorAll('section[aria-label="Subventions"] tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim()),
    );
    expect(rows[0]).toEqual(['Aide au festival Réf. RF-14', 'Région', 'Demandée', '1 000,00', '—', '—', 'ATELIERS, FESTIVAL', 'Ouvrir']);
    expect(rows[1]).toEqual(['Soutien', 'Région', 'Accordée', '1 200,00', '900,00', '300,00', '—', 'Ouvrir']);
  });

  it('filtre par état en rechargeant la liste', async () => {
    await create(MANAGER, [grant()], [funder()]);
    root.querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await settle();
    const options = Array.from(TestBed.inject(OverlayContainer).getContainerElement().querySelectorAll<HTMLElement>('.mat-mdc-option'));
    expect(options.map((o) => o.textContent!.trim())).toEqual(['Tous les états', 'Demandée', 'En instruction', 'Accordée', 'Refusée', 'Clôturée', 'Annulée']);
    options[3]!.click();
    await settle();
    controller.expectOne((r) => r.url === '/api/grants' && r.params.get('status') === 'GRANTED').flush([]);
    await settle();
    controller.expectOne('/api/funders').flush([funder()]);
    await settle();
    expect(text()).toContain('Aucune subvention dans cet état.');
  });

  it('propose seulement les actions possibles selon l’état', async () => {
    await create(MANAGER, [grant()], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    for (const label of ['Modifier', 'Projets financés', 'Passer en instruction', "Enregistrer l'accord", 'Enregistrer un refus', 'Annuler la demande']) {
      expect(has(label), label).toBe(true);
    }
    expect(has('Clôturer')).toBe(false);

    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant({ status: 'GRANTED', grantedAmount: '1000.00', decidedOn: '2026-03-15' }));
    await settle();
    await flushFinance();
    expect(has('Clôturer')).toBe(true);
    for (const label of ['Projets financés', 'Passer en instruction', "Enregistrer l'accord", 'Enregistrer un refus', 'Annuler la demande']) {
      expect(has(label), label).toBe(false);
    }
    expect(text()).toContain('ne changent plus');

    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant({ status: 'REFUSED', decidedOn: '2026-03-15', reason: 'Enveloppe épuisée' }));
    await settle();
    expect(has('Clôturer')).toBe(false);
    expect(text()).toContain('2026-03-15 — Enveloppe épuisée');
  });

  it('montre les documents d’une subvention à qui peut les lire, et pas aux autres', async () => {
    await create(['grants:view', 'documents:view'], [grant()], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    controller.expectOne((r) => r.url === '/api/documents' && r.params.get('objectType') === 'grant' && r.params.get('objectId') === 'g1').flush({ items: [], total: 0, pageSize: 50 });
    controller.expectOne('/api/documents/options').flush({ categories: [], objectTypes: [], allowedExtensions: [] });
    await settle();
    expect(root.querySelector('section[aria-label="Documents de Aide au festival"]')).toBeTruthy();
    // Sans documents:create, pas de dépôt.
    expect(has('Déposer un document')).toBe(false);
  });

  it('ne montre pas de panneau Documents sans le droit de lire les documents', async () => {
    await create(['grants:view'], [grant()], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    expect(root.querySelector('section[aria-label="Documents de Aide au festival"]')).toBeNull();
  });

  it('ajoute un financeur', async () => {
    await create(MANAGER, [], []);
    await click('Nouveau financeur');
    expect(ui.title).toBe('Nouveau financeur');
    expect(ui.text).toContain("l'organisme qui accorde une subvention");
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    await ui.type('input[formcontrolname="name"]', 'Mairie');
    await ui.choose('mat-select[formcontrolname="type"]', 'Collectivité');
    await ui.submit();
    const request = controller.expectOne('/api/funders');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ name: 'Mairie', type: 'LOCAL_AUTHORITY' });
    request.flush(funder({ name: 'Mairie' }), { status: 201, statusText: 'Created' });
    await reload([], [funder({ name: 'Mairie' })]);
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Financeur « Mairie » ajouté.');
    expect(text()).toContain('Mairie');
  });

  it('demande une subvention avec sa répartition, montants envoyés en décimales exactes', async () => {
    await create(MANAGER, [], [funder()]);
    await click('Demander une subvention');
    controller.expectOne('/api/funders').flush([funder(), funder({ id: 'f2', name: 'Ancien', archived: true })]);
    controller.expectOne('/api/projects').flush(projects);
    await settle();
    expect(ui.title).toBe('Demander une subvention');
    expect(await ui.options('mat-select[formcontrolname="funderId"]')).toEqual(['Région']);

    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    await ui.choose('mat-select[formcontrolname="funderId"]', 'Région');
    await ui.type('input[formcontrolname="title"]', 'Aide au festival');
    await ui.type('input[formcontrolname="requestedAmount"]', '1 000,5');
    await ui.click('Ajouter un projet');
    const line = () => ui.dialog!.querySelector<HTMLElement>('app-allocations-fields .line')!;
    line().querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await settle();
    Array.from(TestBed.inject(OverlayContainer).getContainerElement().querySelectorAll<HTMLElement>('.mat-mdc-option')).find((o) => o.textContent!.includes('ATELIERS'))!.click();
    await settle();
    const amount = line().querySelector<HTMLInputElement>('input[formcontrolname="amount"]')!;
    amount.value = '600';
    amount.dispatchEvent(new Event('input'));
    await settle();
    expect(ui.text).toContain('Total réparti : 600,00 €');

    await ui.submit();
    const request = controller.expectOne('/api/grants');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      funderId: 'f1',
      title: 'Aide au festival',
      requestedAmount: '1000.50',
      allocations: [{ projectId: 'p1', amount: '600.00' }],
    });
    request.flush(grant({ id: 'g9', title: 'Aide au festival' }), { status: 201, statusText: 'Created' });
    await reload([grant({ id: 'g9' })], [funder()], grant({ id: 'g9' }));
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Demande « Aide au festival » enregistrée.');
  });

  it('n’enregistre l’accord que lorsque la répartition totalise exactement le montant accordé', async () => {
    await create(MANAGER, [grant()], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    await click("Enregistrer l'accord");
    controller.expectOne('/api/projects').flush(projects);
    await settle();
    expect(ui.title).toBe("Enregistrer l'accord");
    expect(ui.text).toContain('chaque euro accordé doit être affecté à un projet');
    // Accord demandé par défaut : 1 000 €, parts 600 + 400 : complet.
    expect(ui.text).toContain('La répartition est complète.');
    expect(ui.button("Enregistrer l'accord").disabled).toBe(false);

    await ui.type('input[formcontrolname="grantedAmount"]', '900');
    expect(ui.text).toContain('La répartition dépasse de 100,00 €.');
    expect(ui.text).toContain("L'accord ne peut être enregistré que lorsque la répartition totalise exactement");
    expect(ui.button("Enregistrer l'accord").disabled).toBe(true);

    const second = Array.from(ui.dialog!.querySelectorAll<HTMLElement>('app-allocations-fields .line'))[1]!;
    const amount = second.querySelector<HTMLInputElement>('input[formcontrolname="amount"]')!;
    amount.value = '300';
    amount.dispatchEvent(new Event('input'));
    await settle();
    expect(ui.text).toContain('La répartition est complète.');
    expect(ui.button("Enregistrer l'accord").disabled).toBe(false);

    await ui.submit();
    const request = controller.expectOne('/api/grants/g1/grant');
    expect(request.request.body).toEqual({
      grantedAmount: '900.00',
      decidedOn: today,
      allocations: [
        { projectId: 'p1', amount: '600.00' },
        { projectId: 'p2', amount: '300.00' },
      ],
    });
    const granted = grant({ status: 'GRANTED', grantedAmount: '900.00', decidedOn: today, allocatedTotal: '900.00' });
    request.flush(granted);
    await reload([granted], [funder()], granted);
    expect(ui.snackbar).toContain('Accord enregistré : 900,00 €');
    expect(has('Clôturer')).toBe(true);
  });

  it('exige un motif pour un refus, puis l’enregistre', async () => {
    await create(MANAGER, [grant()], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    await click('Enregistrer un refus');
    expect(ui.title).toBe('Enregistrer le refus');
    await ui.submit();
    expect(ui.error).toContain('Indiquez le motif');
    controller.expectNone('/api/grants/g1/refuse');
    await ui.type('textarea[formcontrolname="reason"]', 'Enveloppe épuisée');
    await ui.submit();
    const request = controller.expectOne('/api/grants/g1/refuse');
    expect(request.request.body).toEqual({ decidedOn: today, reason: 'Enveloppe épuisée' });
    const refused = grant({ status: 'REFUSED', decidedOn: today, reason: 'Enveloppe épuisée' });
    request.flush(refused);
    await reload([refused], [funder()], refused);
    expect(ui.snackbar).toContain('Refus enregistré.');
  });

  it('clôture en demandant des précisions dès qu’il y a un reliquat, et dit qu’aucune écriture n’est créée', async () => {
    const granted = grant({ status: 'GRANTED', grantedAmount: '1000.00', decidedOn: '2026-03-15' });
    await create(MANAGER, [granted], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(granted);
    await settle();
    await flushFinance();
    await click('Clôturer');
    controller.expectOne('/api/grants/g1/finance').flush({
      grantId: 'g1',
      granted: '1000.00',
      planned: '0.00',
      received: '700.00',
      remaining: '300.00',
      unplanned: '1000.00',
      overReceived: false,
      spent: '550.00',
      residual: '150.00',
      schedule: [],
      payments: [],
    });
    await settle();
    expect(ui.text).toContain('Reliquat calculé : 700,00 € reçus − 550,00 € de dépenses affectées = 150,00 €');
    expect(ui.title).toBe('Clôturer la subvention');
    expect(ui.text).toContain("Aucune écriture n'est créée dans la comptabilité");
    expect(ui.text).toContain('« Reliquat » : la part de la subvention');
    expect(await ui.options('mat-select[formcontrolname="residual"]')).toEqual(['À rembourser au financeur', 'Conservé avec l’accord du financeur', 'Aucun reliquat']);

    await ui.choose('mat-select[formcontrolname="residual"]', 'À rembourser');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    expect(ui.text).toContain('Précisez en quelques mots ce qui est prévu pour le reliquat');
    controller.expectNone('/api/grants/g1/close');

    await ui.type('textarea[formcontrolname="note"]', '150 € à rembourser avant le 30/06');
    await ui.submit();
    const request = controller.expectOne('/api/grants/g1/close');
    expect(request.request.body).toEqual({ closedOn: today, residual: 'REFUND', note: '150 € à rembourser avant le 30/06' });
    const closed = grant({ status: 'CLOSED', grantedAmount: '1000.00', decidedOn: '2026-03-15', closedOn: today, residual: 'REFUND', residualNote: '150 € à rembourser avant le 30/06' });
    request.flush(closed);
    await reload([closed], [funder()], closed);
    expect(text()).toContain('À rembourser au financeur : 150 € à rembourser avant le 30/06');
  });

  it('garde la boîte ouverte avec le message du serveur', async () => {
    await create(MANAGER, [grant()], [funder()]);
    await click('Ouvrir Aide au festival');
    controller.expectOne('/api/grants/g1').flush(grant());
    await settle();
    await click('Annuler la demande');
    await ui.type('textarea[formcontrolname="reason"]', 'Abandon');
    await ui.submit();
    controller.expectOne('/api/grants/g1/cancel').flush({ message: 'Cette subvention est déjà décidée.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('déjà décidée');
  });

  it('archive un financeur seulement après confirmation, en disant les conséquences', async () => {
    await create(MANAGER, [], [funder()]);
    await click('Archiver Région');
    expect(ui.title).toBe('Archiver Région ?');
    expect(ui.text).toContain('ne pourra plus recevoir de nouvelle demande');
    expect(ui.text).toContain('ne se réactive pas');
    await ui.click('Annuler');
    controller.expectNone('/api/funders/f1/archive');
    await click('Archiver Région');
    await ui.click('Archiver');
    const request = controller.expectOne('/api/funders/f1/archive');
    request.flush(funder({ archived: true }));
    await reload([], [funder({ archived: true })]);
    expect(ui.snackbar).toContain('Financeur « Région » archivé.');
    expect(text()).toContain('Archivé');
    expect(has('Archiver Région')).toBe(false);
  });
});
