import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ClosingPanel } from './closing-panel';
import type { ClosingReportInfo, FiscalYearInfo } from './admin-api.service';

const year: FiscalYearInfo = { id: 'y1', label: '2026', start: '2026-01-01', end: '2026-12-31', status: 'OPEN' };
const accounts = [
  { id: 'a1', number: '120', label: 'Report à nouveau excédentaire', active: true, reportLine: null },
  { id: 'a2', number: '606', label: 'Achats', active: true, reportLine: null },
];
const report = (overrides: Partial<ClosingReportInfo> = {}): ClosingReportInfo => ({
  fiscalYearId: 'y1',
  status: 'OPEN',
  checks: [],
  canStart: true,
  canClose: false,
  preview: { accountCount: 2, result: { kind: 'SURPLUS', amount: '181.00' } },
  ...overrides,
});

describe('ClosingPanel', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ClosingPanel>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (initial: ClosingReportInfo) => {
    await TestBed.configureTestingModule({
      imports: [ClosingPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ClosingPanel);
    fixture.componentRef.setInput('year', year);
    fixture.componentRef.setInput('accounts', accounts);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/fiscal-years/y1/closing').flush(initial);
    await settle();
  };
  const button = (label: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLButtonElement | undefined;

  afterEach(() => controller.verify());

  it('affiche les points bloquants et empêche de fermer à la saisie', async () => {
    await create(
      report({
        canStart: false,
        checks: [
          { code: 'DRAFTS_REMAIN', level: 'BLOCKING', message: '2 brouillon(s) à comptabiliser ou supprimer.' },
          { code: 'UNCLASSIFIED_ACCOUNTS', level: 'WARNING', message: "1 compte(s) utilisé(s) n'ont pas de rubrique de rapport." },
        ],
      }),
    );
    expect(root.textContent).toContain('2 brouillon(s)');
    expect(root.textContent).toContain('Bloquant');
    expect(root.textContent).toContain('Avertissement');
    expect(root.textContent).toContain('Excédent de 181,00');
    expect(button('Fermer à la saisie')!.disabled).toBe(true);
  });

  it('ferme à la saisie quand rien ne bloque', async () => {
    await create(report());
    expect(root.textContent).toContain('Aucun point bloquant');
    button('Fermer à la saisie')!.click();
    await settle();
    const request = controller.expectOne('/api/fiscal-years/y1/closing/start');
    expect(request.request.method).toBe('POST');
    request.flush(report({ status: 'CLOSING', canStart: false, canClose: true }));
    await settle();
    expect(root.textContent).toContain('Exercice fermé à la saisie');
    expect(button('Clôturer définitivement')).toBeTruthy();
    expect(button('Annuler la fermeture')).toBeTruthy();
  });

  it('exige le compte de résultat et la confirmation avant de clôturer, puis envoie le bon corps', async () => {
    await create(report({ status: 'CLOSING', canStart: false, canClose: true }));
    expect(button('Clôturer définitivement')!.disabled).toBe(true);

    const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.click();
    await settle();
    // Compte d'excédent encore non choisi.
    expect(button('Clôturer définitivement')!.disabled).toBe(true);

    const panel = fixture.componentInstance as unknown as { form: { patchValue(v: object): void } };
    panel.form.patchValue({ surplusAccountId: 'a1' });
    await settle();
    expect(button('Clôturer définitivement')!.disabled).toBe(false);
    // Un compte de charge n'est pas proposé pour porter le résultat.
    expect(root.textContent).not.toContain('606 — Achats');

    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    const close = controller.expectOne('/api/fiscal-years/y1/closing/close');
    expect(close.request.body).toEqual({ surplusAccountId: 'a1', deficitAccountId: null });
    close.flush({ openingEntryId: 'e1' });
    await settle();
    controller.expectOne('/api/fiscal-years/y1/closing').flush(report({ status: 'CLOSED', canStart: false, preview: null }));
    await settle();
    expect(root.textContent).toContain('Exercice clôturé');
  });

  it("annule la fermeture et affiche le refus du serveur s'il y en a un", async () => {
    await create(report({ status: 'CLOSING', canStart: false, canClose: true }));
    button('Annuler la fermeture')!.click();
    await settle();
    controller
      .expectOne('/api/fiscal-years/y1/closing/cancel')
      .flush({ message: "L'état de l'exercice a changé entre-temps. Actualisez." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('a changé entre-temps');
  });

  it('un exercice clôturé ne propose plus aucune action', async () => {
    await create(report({ status: 'CLOSED', canStart: false, preview: null }));
    expect(root.textContent).toContain('Cet exercice est clôturé');
    expect(button('Fermer à la saisie')).toBeUndefined();
    expect(button('Clôturer définitivement')).toBeUndefined();
  });
});
