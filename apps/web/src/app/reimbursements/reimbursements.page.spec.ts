import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ReimbursementsPage } from './reimbursements.page';

const row = (overrides: object = {}) => ({
  id: 'r1',
  number: 12,
  status: 'IN_CIRCUIT',
  amount: '42.50',
  expenseDate: '2026-03-10',
  reason: 'Peinture pour l’atelier',
  requesterName: 'Léa Test',
  awaitingLabel: 'Accord du président',
  submittedAt: '2026-03-11T10:00:00.000Z',
  ...overrides,
});

const detail = (overrides: object = {}) => ({
  ...row(),
  projectId: null,
  projectName: null,
  requesterUserId: 'u-lea',
  version: 2,
  createdAt: '2026-03-11T09:00:00.000Z',
  closedAt: null,
  documentCount: 1,
  lastMessage: null,
  paid: null,
  instance: {
    status: 'RUNNING',
    round: 1,
    versionNumber: 1,
    steps: [
      { nodeId: 'president', label: 'Accord du président', type: 'APPROVAL', state: 'CURRENT' },
      { nodeId: 'treasurer', label: 'Remboursement', type: 'PROCESSING', state: 'PENDING' },
    ],
    decisions: [],
  },
  can: { edit: false, submit: false, cancel: false, delete: false, decide: false, process: false, stepType: null },
  ...overrides,
});

const open = { enabled: true, canRequest: true, reason: null };

describe('ReimbursementsPage', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ReimbursementsPage>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], data: { status?: object; mine?: object[]; toDecide?: object[]; all?: object[] } = {}, query = '') => {
    await TestBed.configureTestingModule({
      imports: [ReimbursementsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(permissions),
        NO_MATERIAL_ANIMATIONS,
        ...(query ? [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ onglet: query }) } } }] : []),
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReimbursementsPage);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/reimbursements/status').flush(data.status ?? open);
    if (permissions.includes('reimbursements:create')) controller.expectOne('/api/reimbursements/mine').flush(data.mine ?? []);
    controller.expectOne('/api/reimbursements/to-decide').flush(data.toDecide ?? []);
    if (permissions.includes('reimbursements:view')) controller.expectOne('/api/reimbursements').flush(data.all ?? []);
    await settle();
  };
  const click = async (label: string) => {
    const found = Array.from(root.querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label));
    expect(found, label).toBeTruthy();
    found!.click();
    await settle();
  };

  afterEach(() => {
    ui?.closeAll();
    controller?.verify();
  });

  it('dit quoi faire en premier quand on n’a encore fait aucune demande', async () => {
    await create(['reimbursements:create']);
    expect(root.querySelector('.help, .page-text')!.textContent).toContain('Vous avez avancé de l’argent');
    expect(root.textContent).toContain('Vous n’avez pas encore fait de demande');
    expect(root.textContent).toContain('Nouvelle demande');
  });

  it('montre l’avancement de mes demandes en mots courants', async () => {
    await create(['reimbursements:create'], { mine: [row(), row({ id: 'r2', number: 13, status: 'RETURNED', awaitingLabel: null }), row({ id: 'r3', number: 14, status: 'PAID', awaitingLabel: null })] });
    const text = root.textContent!;
    expect(text).toContain('En attente : Accord du président');
    expect(text).toContain('À corriger');
    expect(text).toContain('Remboursée');
    expect(text).toContain('42,50 €');
  });

  it('masque le bouton et explique pourquoi quand les demandes ne sont pas ouvertes', async () => {
    await create(['reimbursements:create'], { status: { enabled: false, canRequest: false, reason: 'Les demandes de remboursement ne sont pas encore ouvertes : un administrateur doit d’abord mettre un circuit de validation en vigueur.' } });
    expect(root.textContent).not.toContain('Nouvelle demande');
    expect(root.querySelector('.alert')!.textContent).toContain('circuit de validation');
  });

  it('dépose une demande : crée le brouillon, joint le justificatif, puis la dépose', async () => {
    await create(['reimbursements:create']);
    await click('Nouvelle demande');
    controller.expectOne('/api/reimbursements/projects').flush([{ id: 'p1', name: 'Festival' }]);
    await settle();
    expect(ui.title).toBe('Nouvelle demande de remboursement');

    // Sans justificatif, rien n’est envoyé et le message dit quoi faire.
    await ui.type('input[formcontrolname="amount"]', '42,50');
    await ui.type('textarea[formcontrolname="reason"]', 'Peinture pour l’atelier');
    await ui.submit();
    expect(ui.error).toContain('justificatif');
    controller.expectNone('/api/reimbursements');

    const input = ui.field('input#receipt-file');
    const file = new File(['%PDF-1.7'], 'ticket.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(ui.text).toContain('ticket.pdf');
    await ui.submit();

    const created = controller.expectOne('/api/reimbursements');
    expect(created.request.body).toMatchObject({ amount: '42.50', reason: 'Peinture pour l’atelier', projectId: null });
    created.flush(detail({ status: 'DRAFT', can: { edit: true, submit: true, cancel: false, delete: true, decide: false, process: false, stepType: null } }), { status: 201, statusText: 'Created' });
    await settle();
    const upload = controller.expectOne('/api/reimbursements/r1/documents');
    expect(upload.request.body).toBeInstanceOf(FormData);
    upload.flush({ id: 'd1' }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/reimbursements/r1/submit').flush(detail());
    await settle();
    // La liste se recharge après la fermeture de la boîte.
    controller.expectOne('/api/reimbursements/status').flush(open);
    controller.expectOne('/api/reimbursements/mine').flush([row()]);
    controller.expectOne('/api/reimbursements/to-decide').flush([]);
    await settle();
    expect(ui.snackbar).toContain('Votre demande est déposée');
    expect(root.textContent).toContain('Peinture pour l’atelier');
  });

  it('garde la saisie et dit quoi faire quand le dépôt est refusé', async () => {
    await create(['reimbursements:create']);
    await click('Nouvelle demande');
    controller.expectOne('/api/reimbursements/projects').flush([]);
    await settle();
    await ui.type('input[formcontrolname="amount"]', '10');
    await ui.type('textarea[formcontrolname="reason"]', 'Timbres');
    const input = ui.field('input#receipt-file');
    Object.defineProperty(input, 'files', { value: [new File(['%PDF-1.7'], 't.pdf')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    await ui.submit();
    controller.expectOne('/api/reimbursements').flush({ message: 'Votre compte n’est pas relié à une fiche de membre actif : demandez à un administrateur.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('fiche de membre');
    expect((ui.field('input[formcontrolname="amount"]') as HTMLInputElement).value).toBe('10');
  });

  it('donne son accord à une demande : ouvre la fiche, voit le justificatif et le schéma, confirme', async () => {
    await create(['reimbursements:create'], { toDecide: [row({ stepType: 'APPROVAL' })] }, 'a-traiter');
    expect(root.textContent).toContain('À traiter (1)');
    expect(root.textContent).toContain('Léa Test');
    await click('Ouvrir la demande n° 12');
    controller.expectOne('/api/reimbursements/r1').flush(detail({ can: { edit: false, submit: false, cancel: false, delete: false, decide: true, process: false, stepType: 'APPROVAL' } }));
    await settle();
    controller.expectOne('/api/reimbursements/r1/documents').flush([{ id: 'd1', title: 'Ticket de caisse', latest: { originalName: 'ticket.pdf', size: 100 } }]);
    await settle();
    expect(ui.title).toContain('n° 12');
    expect(ui.text).toContain('Peinture pour l’atelier');
    expect(ui.text).toContain('Ticket de caisse');
    // Le schéma dit où en est la demande, avec des mots.
    expect(ui.dialog!.querySelector('app-circuit-steps')!.textContent).toContain('en attente');
    const link = ui.dialog!.querySelector<HTMLAnchorElement>('a[href*="/documents/d1/download"]');
    expect(link?.getAttribute('href')).toBe('/api/reimbursements/r1/documents/d1/download');

    await ui.click('Donner mon accord');
    expect(ui.title).toContain('Donner votre accord');
    await ui.click('Donner mon accord');
    const decision = controller.expectOne('/api/reimbursements/r1/decision');
    expect(decision.request.body).toEqual({ type: 'APPROVE', message: null });
    decision.flush(detail({ awaitingLabel: 'Remboursement' }));
    await settle();
    expect(ui.snackbar).toContain('accord est enregistré');
  });

  it('exige un message pour renvoyer une demande pour correction', async () => {
    await create(['reimbursements:create'], { toDecide: [row({ stepType: 'APPROVAL' })] }, 'a-traiter');
    await click('Ouvrir la demande n° 12');
    controller.expectOne('/api/reimbursements/r1').flush(detail({ can: { edit: false, submit: false, cancel: false, delete: false, decide: true, process: false, stepType: 'APPROVAL' } }));
    await settle();
    controller.expectOne('/api/reimbursements/r1/documents').flush([]);
    await settle();
    await ui.click('Renvoyer pour correction');
    expect(ui.title).toContain('Renvoyer pour correction');
    await ui.submit();
    expect(ui.error).toContain('Vérifiez');
    controller.expectNone('/api/reimbursements/r1/decision');
    await ui.type('textarea[formcontrolname="message"]', 'Le ticket est illisible');
    await ui.submit();
    const decision = controller.expectOne('/api/reimbursements/r1/decision');
    expect(decision.request.body).toEqual({ type: 'RETURN', message: 'Le ticket est illisible' });
    decision.flush(detail({ status: 'RETURNED', awaitingLabel: null }));
    await settle();
    // La fiche recharge ses justificatifs après la décision.
    controller.expectOne('/api/reimbursements/r1/documents').flush([]);
    await settle();
    expect(ui.snackbar).toContain('renvoyée pour correction');
  });

  it('rembourse : propose d’enregistrer le paiement ou de rattacher un mouvement du relevé', async () => {
    await create(['reimbursements:create'], { toDecide: [row({ stepType: 'PROCESSING', awaitingLabel: 'Remboursement' })] }, 'a-traiter');
    expect(root.textContent).toContain('Rembourser');
    await click('Ouvrir la demande n° 12');
    const processing = detail({ awaitingLabel: 'Remboursement', can: { edit: false, submit: false, cancel: false, delete: false, decide: true, process: true, stepType: 'PROCESSING' } });
    controller.expectOne('/api/reimbursements/r1').flush(processing);
    await settle();
    controller.expectOne('/api/reimbursements/r1/documents').flush([]);
    await settle();
    await ui.click('Rembourser');
    controller.expectOne('/api/financial-accounts').flush([{ id: 'fa1', name: 'Banque', type: 'BANK', archivedOn: null }]);
    controller.expectOne('/api/operation-categories').flush([{ id: 'c1', direction: 'OUT', label: 'Assurance', active: true }, { id: 'c2', direction: 'IN', label: 'Dons', active: true }]);
    controller.expectOne('/api/reimbursements/r1/transaction-candidates').flush([]);
    await settle();
    expect(ui.title).toContain('Rembourser la demande n° 12');
    expect(ui.text).toContain('Vous remboursez Léa Test : 42,50 €');
    expect(await ui.options('mat-select[formcontrolname="categoryId"]')).toEqual(['Assurance']);
    await ui.submit();
    expect(ui.error).toContain('Vérifiez');
    controller.expectNone('/api/reimbursements/r1/process');
  });
});
