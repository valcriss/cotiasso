import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import type { ProgressAccount, ProgressYear } from '../admin/admin-api.service';
import { ProgressPage } from './progress.page';

const account = (overrides: Partial<ProgressAccount> = {}): ProgressAccount => ({
  financialAccountId: 'fa-1',
  name: 'Banque',
  total: 40,
  qualified: 30,
  drafted: 20,
  posted: 10,
  reconciled: 0,
  percent: 25,
  opening: { state: 'TO_PREPARE', amount: '1000.00' },
  statementUntil: null,
  reconciledUntil: null,
  blockedDrafts: 0,
  ...overrides,
});

const year = (overrides: Partial<ProgressYear> = {}): ProgressYear => ({
  fiscalYear: { id: 'y1', label: '2025', start: '2025-01-01', end: '2025-12-31', status: 'OPEN' },
  accounts: [account()],
  totals: { total: 40, qualified: 30, drafted: 20, posted: 10, reconciled: 0, percent: 25 },
  documents: { postedEntries: 10, withoutDocument: 4 },
  anomalies: [
    { code: 'MISSING_DOCUMENTS', level: 'INFO', financialAccountId: null, financialAccountName: null, count: 4, fix: 'DOCUMENTS', message: '4 écritures comptabilisées sur 10 n’ont aucune pièce jointe.' },
    { code: 'NOT_QUALIFIED', level: 'TODO', financialAccountId: 'fa-1', financialAccountName: 'Banque', count: 10, fix: 'TRANSACTIONS', message: '10 mouvements n’ont pas encore de compte de contrepartie.' },
    {
      code: 'BLOCKED_DRAFT',
      level: 'BLOCKING',
      financialAccountId: 'fa-1',
      financialAccountName: 'Banque',
      count: 1,
      fix: 'ENTRY',
      message: '1 brouillon ne peut pas être comptabilisé en l’état.',
      details: [{ entryId: 'e-9', date: '2025-03-07', label: 'Fournitures', messages: ['La ligne de banque ne correspond plus.'] }],
    },
    { code: 'NO_STATEMENT', level: 'TODO', financialAccountId: 'fa-1', financialAccountName: 'Banque', count: 1, fix: 'RECONCILIATION', message: 'Aucun solde de relevé à la fin de l’exercice.' },
  ],
  complete: false,
  draftAnalysisLimited: false,
  ...overrides,
});

describe('ProgressPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<ProgressPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (response: object | 'error', permissions: string[] = ['entries:view', 'financial-accounts:view', 'documents:view']) => {
    await TestBed.configureTestingModule({
      imports: [ProgressPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProgressPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    const request = controller.expectOne('/api/recovery-progress');
    if (response === 'error') request.flush({ message: 'Accès refusé.' }, { status: 403, statusText: 'Forbidden' });
    else request.flush(response);
    await settle();
  };
  const report = (years: ProgressYear[]) => ({ generatedAt: '2026-11-02T10:00:00Z', years });

  afterEach(() => controller.verify());

  it("montre l'avancement global et par compte, avec des mots simples", async () => {
    await create(report([year()]));
    const text = root.textContent!;
    expect(text).toContain('Exercice 2025');
    expect(text).toContain('25 %');
    expect(text).toContain('10 mouvement(s) comptabilisé(s) sur 40');
    const cells = Array.from(root.querySelectorAll('tbody tr td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells[0]).toBe('40');
    expect(cells[1]).toBe('30 / 40');
    expect(cells[2]).toBe('20 / 40');
    expect(cells[3]).toContain('10 / 40');
    expect(cells[5]).toBe('À expliquer (1 000,00 €)');
    expect(text).toContain('Aucun relevé saisi');
    expect(root.querySelector('progress')!.getAttribute('max')).toBe('40');
    expect(root.textContent).toContain("Ce tableau ne modifie rien");
  });

  it('range les points à régler du plus bloquant au plus informatif, avec le niveau en toutes lettres', async () => {
    await create(report([year()]));
    // L'icône Material ajoute son nom au texte : on vérifie la fin du libellé.
    const levels = Array.from(root.querySelectorAll('.anomalies > li > .level')).map((el) => el.textContent!.trim());
    const expected = ['Bloquant', 'À faire', 'À faire', 'Pour information'];
    expect(levels).toHaveLength(expected.length);
    levels.forEach((text, index) => expect(text.endsWith(expected[index]!), `${text} ≠ ${expected[index]}`).toBe(true));
  });

  it('offre un lien vers chaque écran qui règle le problème, et vers chaque brouillon bloqué', async () => {
    await create(report([year()]));
    const links = Array.from(root.querySelectorAll('a')).map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toContainEqual(['Voir les mouvements', '/comptes']);
    expect(links).toContainEqual(['Rapprocher', '/comptes/fa-1/rapprochement']);
    expect(links).toContainEqual(['Ouvrir les documents', '/documents']);
    expect(links).toContainEqual(['Fournitures', '/comptabilite/ecritures/e-9']);
    expect(root.textContent).toContain('La ligne de banque ne correspond plus.');
  });

  it("n'affiche pas un lien vers un écran auquel la personne n'a pas droit", async () => {
    await create(report([year()]), ['entries:view']);
    const labels = Array.from(root.querySelectorAll('a')).map((a) => a.textContent!.trim());
    expect(labels).not.toContain('Voir les mouvements');
    expect(labels).not.toContain('Rapprocher');
    expect(labels).not.toContain('Ouvrir les documents');
  });

  it('félicite un exercice entièrement repris, sans aucune alerte', async () => {
    await create(report([year({ anomalies: [], complete: true, totals: { total: 40, qualified: 40, drafted: 40, posted: 40, reconciled: 40, percent: 100 } })]));
    expect(root.querySelector('[role="status"]')!.textContent).toContain('entièrement repris');
    expect(root.querySelector('.anomalies')).toBeNull();
  });

  it("dit quoi faire en premier quand il n'y a aucun exercice", async () => {
    await create(report([]));
    expect(root.textContent).toContain('Aucun exercice');
    expect(root.querySelector('a[href="/comptes"]')).not.toBeNull();
  });

  it("explique l'état vide d'un exercice sans compte ou sans mouvement", async () => {
    await create(report([year({ accounts: [], anomalies: [], totals: { total: 0, qualified: 0, drafted: 0, posted: 0, reconciled: 0, percent: null } })]));
    expect(root.textContent).toContain("Aucun compte bancaire ou caisse n'existe");
    expect(root.querySelector('progress')).toBeNull();
  });

  it("n'affiche ni barre ni pourcentage quand un exercice n'a aucun mouvement", async () => {
    await create(report([year({ accounts: [account({ total: 0, qualified: 0, drafted: 0, posted: 0, percent: null })], anomalies: [], totals: { total: 0, qualified: 0, drafted: 0, posted: 0, reconciled: 0, percent: null } })]));
    expect(root.querySelector('progress')).toBeNull();
    expect(root.textContent).toContain("Aucun mouvement n'est enregistré");
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('signale quand l’analyse des brouillons a été limitée', async () => {
    await create(report([year({ draftAnalysisLimited: true })]));
    expect(root.textContent).toContain('seuls les premiers ont été examinés');
  });

  it("affiche le refus du serveur", async () => {
    await create('error');
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Accès refusé');
  });
});
