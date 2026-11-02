import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ProjectCommitments } from './project-commitments';

const project = { id: 'p1', code: 'FESTIVAL', name: 'Festival', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null };
const commitment = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  projectId: 'p1',
  label: 'Devis traiteur',
  amount: '300.00',
  committedOn: '2026-02-01',
  accountId: 'a6',
  accountNumber: '606',
  accountLabel: 'Achats',
  note: '',
  state: 'OPEN',
  engaged: true,
  settledEntry: null,
  cancelReason: null,
  ...over,
});
const settledEntry = { id: 'e1', number: 12, date: '2026-03-01', label: 'Facture', journalCode: 'OD', status: 'POSTED' };

describe('ProjectCommitments', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ProjectCommitments>>;
  let root: HTMLElement;
  let ui: DialogTester;
  let changes: number;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], listed: unknown[], status = 'ACTIVE') => {
    await TestBed.configureTestingModule({
      imports: [ProjectCommitments],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectCommitments);
    fixture.componentRef.setInput('project', { ...project, status });
    changes = 0;
    fixture.componentInstance.changed.subscribe(() => changes++);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/projects/p1/commitments').flush(listed);
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
  const buttons = () => Array.from(root.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim());
  const WRITER = ['projects:view', 'budgets:update', 'entries:view'];

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('explique ce qu’est un engagement et quoi faire en premier', async () => {
    await create(WRITER, []);
    expect(root.textContent).toContain('promise mais pas encore payée');
    expect(root.textContent).toContain('Ce n\'est pas de la comptabilité');
    expect(root.textContent).toContain('Aucun engagement. Enregistrez-en un quand vous acceptez un devis');
    expect(buttons().some((b) => b.includes('Enregistrer un engagement'))).toBe(true);
  });

  it('en lecture seule, liste les engagements sans aucune action', async () => {
    await create(['projects:view'], [commitment()]);
    expect(root.textContent).toContain('Devis traiteur');
    expect(root.textContent).toContain('300,00');
    expect(root.textContent).toContain('Compte 606 — Achats');
    expect(buttons().filter((b) => b)).toEqual([]);
  });

  it('dit l’état de chaque engagement et ne propose que les actions possibles', async () => {
    await create(WRITER, [
      commitment({ id: 'open', label: 'Ouvert' }),
      commitment({ id: 'settled', label: 'Soldé', state: 'SETTLED', engaged: false, settledEntry }),
      commitment({ id: 'reopened', label: 'Rouvert', state: 'REOPENED', settledEntry: { ...settledEntry, status: 'REVERSED' } }),
      commitment({ id: 'cancelled', label: 'Annulé', state: 'CANCELLED', engaged: false, cancelReason: 'Devis refusé' }),
    ]);
    const text = root.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Écriture OD n° 12 du 2026-03-01');
    expect(text).toContain("L'écriture qui le soldait a été annulée : il compte de nouveau comme promis.");
    expect(text).toContain('Devis refusé');
    // Modifier : seulement l'ouvert. Solder et annuler : ouvert et rouvert. Aucune action sur le soldé ni sur l'annulé.
    expect(buttons().filter((b) => b.startsWith('Modifier') || b.startsWith('Solder') || b.startsWith('Annuler'))).toEqual([
      'Modifier Ouvert',
      'Solder Ouvert',
      'Annuler Ouvert',
      'Solder Rouvert',
      'Annuler Rouvert',
    ]);
  });

  it('sans entries:view, ne propose pas de solder (le solde lie une écriture comptable)', async () => {
    await create(['projects:view', 'budgets:update'], [commitment()]);
    expect(buttons()).toContain('Modifier Devis traiteur');
    expect(buttons().some((b) => b.startsWith('Solder'))).toBe(false);
  });

  it('ne propose pas d’engagement sur un projet archivé', async () => {
    await create(WRITER, [], 'ARCHIVED');
    expect(buttons().some((b) => b.includes('Enregistrer un engagement'))).toBe(false);
  });

  it('enregistre un engagement : montant à la française envoyé en décimales exactes, bandeau et suivi rechargé', async () => {
    await create(WRITER, []);
    await click('Enregistrer un engagement');
    expect(ui.title).toBe('Enregistrer un engagement');
    expect(ui.text).toContain("Il n'écrit rien dans la comptabilité");
    controller.expectOne('/api/accounts').flush([
      { id: 'a6', number: '606', label: 'Achats', active: true, reportLine: null },
      { id: 'a7', number: '706', label: 'Prestations', active: true, reportLine: null },
    ]);
    await settle();

    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    expect(ui.text).toContain('Dites en quelques mots ce qui est promis');

    await ui.type('input[formcontrolname="label"]', 'Devis traiteur');
    await ui.type('input[formcontrolname="amount"]', '300,5');
    expect(await ui.options('mat-select[formcontrolname="accountId"]')).toEqual(['Aucun', '606 — Achats']);
    await ui.choose('mat-select[formcontrolname="accountId"]', '606');
    await ui.submit();
    const request = controller.expectOne('/api/projects/p1/commitments');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ label: 'Devis traiteur', amount: '300.50', accountId: 'a6' });
    request.flush(commitment({ amount: '300.50' }), { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/projects/p1/commitments').flush([commitment({ amount: '300.50' })]);
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Engagement « Devis traiteur » enregistré.');
    expect(changes).toBe(1);
    expect(root.textContent).toContain('300,50');
  });

  it('garde la boîte ouverte avec le message du serveur', async () => {
    await create(WRITER, []);
    await click('Enregistrer un engagement');
    controller.expectOne('/api/accounts').flush([]);
    await settle();
    await ui.type('input[formcontrolname="label"]', 'Devis');
    await ui.type('input[formcontrolname="amount"]', '10');
    await ui.submit();
    controller.expectOne('/api/projects/p1/commitments').flush({ message: 'Ce projet est archivé.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('archivé');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="label"]').value).toBe('Devis');
  });

  it('solde un engagement avec l’écriture de la facture, en expliquant ce qui va changer', async () => {
    await create(WRITER, [commitment()]);
    await click('Solder Devis traiteur');
    expect(ui.title).toBe("Solder l'engagement");
    expect(ui.text).toContain('ne comptera plus comme promis');
    expect(ui.text).toContain("l'engagement redeviendra promis");
    controller.expectOne('/api/commitments/c1/entry-candidates').flush([
      { id: 'e1', number: 12, date: '2026-03-01', label: 'Facture traiteur', journalCode: 'OD', projectAmount: '280.00' },
    ]);
    await settle();

    await ui.submit();
    expect(ui.error).toContain("Choisissez l'écriture");
    await ui.choose('mat-select[formcontrolname="entryId"]', 'Facture traiteur');
    await ui.submit();
    const request = controller.expectOne('/api/commitments/c1/settle');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ entryId: 'e1' });
    request.flush(commitment({ state: 'SETTLED', engaged: false, settledEntry }));
    await settle();
    controller.expectOne('/api/projects/p1/commitments').flush([commitment({ state: 'SETTLED', engaged: false, settledEntry })]);
    await settle();
    expect(ui.snackbar).toContain('soldé : la dépense réelle le remplace dans le suivi');
    expect(changes).toBe(1);
    expect(root.textContent!.replace(/\s+/g, ' ')).toContain('Écriture OD n° 12');
  });

  it('dit quoi faire quand aucune écriture ne peut solder l’engagement, et grise la validation', async () => {
    await create(WRITER, [commitment()]);
    await click('Solder Devis traiteur');
    controller.expectOne('/api/commitments/c1/entry-candidates').flush([]);
    await settle();
    expect(ui.text).toContain("Aucune écriture comptabilisée ne porte de dépense affectée à ce projet");
    expect(ui.text).toContain('en l\'affectant à ce projet');
    expect(ui.button("Solder l'engagement").disabled).toBe(true);
  });

  it('annule un engagement seulement avec un motif', async () => {
    await create(WRITER, [commitment()]);
    await click('Annuler Devis traiteur');
    expect(ui.title).toBe("Annuler l'engagement");
    expect(ui.text).toContain('rien n\'est effacé');
    await ui.submit();
    expect(ui.error).toContain('Indiquez pourquoi');
    controller.expectNone('/api/commitments/c1/cancel');
    await ui.type('textarea[formcontrolname="reason"]', 'Devis refusé');
    await ui.submit();
    const request = controller.expectOne('/api/commitments/c1/cancel');
    expect(request.request.body).toEqual({ reason: 'Devis refusé' });
    request.flush(commitment({ state: 'CANCELLED', engaged: false, cancelReason: 'Devis refusé' }));
    await settle();
    controller.expectOne('/api/projects/p1/commitments').flush([commitment({ state: 'CANCELLED', engaged: false, cancelReason: 'Devis refusé' })]);
    await settle();
    expect(ui.snackbar).toContain('annulé');
    expect(root.textContent).toContain('Devis refusé');
    expect(changes).toBe(1);
  });

  it('modifie un engagement ouvert en reprenant ses valeurs', async () => {
    await create(WRITER, [commitment()]);
    await click('Modifier Devis traiteur');
    controller.expectOne('/api/accounts').flush([{ id: 'a6', number: '606', label: 'Achats', active: true, reportLine: null }]);
    await settle();
    expect(ui.title).toBe("Modifier l'engagement");
    expect(ui.field<HTMLInputElement>('input[formcontrolname="label"]').value).toBe('Devis traiteur');
    expect(ui.field<HTMLInputElement>('input[formcontrolname="amount"]').value).toBe('300,00');
    await ui.type('input[formcontrolname="amount"]', '320');
    await ui.submit();
    const request = controller.expectOne('/api/commitments/c1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toMatchObject({ amount: '320.00', accountId: 'a6', committedOn: '2026-02-01' });
    request.flush(commitment({ amount: '320.00' }));
    await settle();
    controller.expectOne('/api/projects/p1/commitments').flush([commitment({ amount: '320.00' })]);
    await settle();
    expect(ui.isOpen).toBe(false);
  });
});
