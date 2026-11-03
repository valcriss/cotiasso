import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { DocumentDetail } from '../admin/admin-api.service';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { Dialogs } from '../ui/dialogs.service';
import { DocumentCategoryDialog, type DocumentCategoryDialogData } from './document-category-dialog';

const document = { id: 'd1', title: 'Facture du traiteur', category: 'devis', versions: [], links: [] } as unknown as DocumentDetail;
const categories = [
  { key: 'devis', label: 'Devis' },
  { key: 'facture', label: 'Facture' },
  { key: 'autre', label: 'Autre justificatif' },
];

describe('DocumentCategoryDialog', () => {
  let controller: HttpTestingController;
  let ui: DialogTester;
  let result: Promise<DocumentDetail | undefined>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    TestBed.tick();
    await new Promise<void>((resolve) => setTimeout(resolve));
  };
  const open = async () => {
    result = TestBed.inject(Dialogs).open<DocumentDetail, DocumentCategoryDialogData>(DocumentCategoryDialog, {
      size: 'sm',
      data: { document, categories },
    });
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), NO_MATERIAL_ANIMATIONS] });
    controller = TestBed.inject(HttpTestingController);
    ui = new DialogTester(settle);
  });
  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('propose la catégorie actuelle et ne laisse pas valider tant qu’elle n’a pas changé', async () => {
    await open();
    expect(ui.title).toBe('Changer la catégorie');
    expect(ui.button('Enregistrer').disabled).toBe(true);
  });

  it('enregistre la nouvelle catégorie en validant, puis ferme la boîte avec le document mis à jour', async () => {
    await open();
    await ui.choose('mat-select', 'Facture');
    expect(ui.button('Enregistrer').disabled).toBe(false);

    // Un vrai appui sur le bouton d'envoi : c'est lui qui doit déclencher l'enregistrement.
    await ui.click('Enregistrer');
    const request = controller.expectOne('/api/documents/d1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ category: 'facture' });
    request.flush({ ...document, category: 'facture' });
    await settle();

    expect(await result).toMatchObject({ id: 'd1', category: 'facture' });
    expect(ui.isOpen).toBe(false);
  });

  it('garde la boîte ouverte et explique quoi faire quand le serveur refuse', async () => {
    await open();
    await ui.choose('mat-select', 'Autre justificatif');
    await ui.click('Enregistrer');
    controller.expectOne('/api/documents/d1').flush({ message: 'Ce document est archivé.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('archivé');
  });
});
