import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { Dialogs } from '../ui/dialogs.service';
import type { ClosingReportInfo, FiscalYearInfo } from './admin-api.service';
import { ClosingDialog } from './closing-dialog';

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

describe('ClosingDialog', () => {
  let controller: HttpTestingController;
  let ui: DialogTester;

  // Pas de fixture pour une boîte ouverte par le service : on rafraîchit les vues à la main.
  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    TestBed.inject(ApplicationRef).tick();
  };
  const open = async (initial: ClosingReportInfo) => {
    await TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), NO_MATERIAL_ANIMATIONS] }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    ui = new DialogTester(settle);
    const closed = TestBed.inject(Dialogs).open(ClosingDialog, { size: 'md', dismissible: true, data: { year, accounts } });
    await settle();
    controller.expectOne('/api/fiscal-years/y1/closing').flush(initial);
    await settle();
    // Objet enveloppe : renvoyer la promesse seule ferait attendre la fermeture de la boîte.
    return { closed };
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('explique la clôture, affiche les points bloquants et empêche de fermer la saisie', async () => {
    await open(
      report({
        canStart: false,
        checks: [
          { code: 'DRAFTS_REMAIN', level: 'BLOCKING', message: '2 brouillon(s) à comptabiliser ou supprimer.' },
          { code: 'UNCLASSIFIED_ACCOUNTS', level: 'WARNING', message: "1 compte(s) utilisé(s) n'ont pas de rubrique choisie." },
        ],
      }),
    );
    expect(ui.title).toBe("Clôture de l'exercice 2026");
    expect(ui.text).toContain("Clôturer, c'est arrêter les comptes de la période");
    expect(ui.text).toContain('2 brouillon(s)');
    expect(ui.text).toContain('À régler avant de continuer');
    expect(ui.text).toContain('Bon à savoir');
    expect(ui.text).toContain('excédent de 181,00');
    expect(ui.button('Fermer à la saisie').disabled).toBe(true);
  });

  it('ferme à la saisie quand rien ne bloque, et le confirme par un bandeau', async () => {
    await open(report());
    expect(ui.text).toContain('Rien ne bloque la clôture');
    await ui.click('Fermer à la saisie');
    const request = controller.expectOne('/api/fiscal-years/y1/closing/start');
    expect(request.request.method).toBe('POST');
    request.flush(report({ status: 'CLOSING', canStart: false, canClose: true }));
    await settle();
    expect(ui.snackbar).toContain('fermé à la saisie');
    expect(ui.button('Clôturer définitivement')).toBeTruthy();
    expect(ui.button('Annuler la fermeture')).toBeTruthy();
  });

  it('exige le compte de report et la confirmation avant de clôturer, puis envoie le bon corps', async () => {
    await open(report({ status: 'CLOSING', canStart: false, canClose: true }));
    expect(ui.button('Clôturer définitivement').disabled).toBe(true);

    ui.field<HTMLInputElement>('input[type="checkbox"]').click();
    await settle();
    expect(ui.button('Clôturer définitivement').disabled).toBe(true);

    // Un compte de charge n'est pas proposé pour porter le résultat : seul le compte de fonds propres l'est.
    expect(await ui.options('mat-select[formcontrolname="surplusAccountId"]')).toEqual(['120 — Report à nouveau excédentaire']);
    await ui.choose('mat-select[formcontrolname="surplusAccountId"]', '120');
    expect(ui.button('Clôturer définitivement').disabled).toBe(false);

    await ui.submit();
    const close = controller.expectOne('/api/fiscal-years/y1/closing/close');
    expect(close.request.body).toEqual({ surplusAccountId: 'a1', deficitAccountId: null });
    close.flush({ openingEntryId: 'e1' });
    await settle();
    controller.expectOne('/api/fiscal-years/y1/closing').flush(report({ status: 'CLOSED', canStart: false, preview: null }));
    await settle();
    expect(ui.text).toContain('Il ne peut plus être rouvert');
    expect(ui.snackbar).toContain('Exercice clôturé');
  });

  it('annule la fermeture, et affiche le refus du serveur dans la boîte', async () => {
    await open(report({ status: 'CLOSING', canStart: false, canClose: true }));
    await ui.click('Annuler la fermeture');
    controller
      .expectOne('/api/fiscal-years/y1/closing/cancel')
      .flush({ message: "L'état de l'exercice a changé entre-temps. Actualisez." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.error).toContain('a changé entre-temps');
    expect(ui.isOpen).toBe(true);
  });

  it('Échap ferme la boîte : il n’y a rien à perdre', async () => {
    const { closed } = await open(report());
    await ui.pressEscape();
    await closed;
    expect(ui.isOpen).toBe(false);
  });
});
