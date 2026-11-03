import { TestBed } from '@angular/core/testing';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { Dialogs } from '../ui/dialogs.service';
import type { MailOutcome } from './admin-api.service';
import { LinkDialog, type LinkDialogData } from './link-dialog';

describe('LinkDialog', () => {
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    TestBed.tick();
    await new Promise<void>((resolve) => setTimeout(resolve));
  };
  const open = async (mail?: MailOutcome) => {
    void TestBed.inject(Dialogs).open<boolean, LinkDialogData>(LinkDialog, {
      size: 'md',
      dismissible: true,
      data: { title: "Lien d'invitation pour Camille", url: 'https://compta.asso.fr/reinitialisation#token=t', expiresAt: '06/11/2026 14:00:00', mail },
    });
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [NO_MATERIAL_ANIMATIONS] });
    ui = new DialogTester(settle);
  });
  afterEach(() => ui.closeAll());

  it("sans envoi d'email configuré, demande de transmettre le lien soi-même", async () => {
    await open({ status: 'NOT_CONFIGURED' });
    expect(ui.text).toContain('Transmettez ce lien à la personne concernée');
    expect(ui.text).not.toContain('Un email contenant ce lien');
    expect(ui.button("J'ai transmis le lien")).toBeDefined();
    expect(ui.field<HTMLInputElement>('input[readonly]').value).toContain('#token=t');
  });

  it("quand l'email est parti, le dit, garde le lien en secours et propose seulement de fermer", async () => {
    await open({ status: 'SENT', to: 'camille@exemple.fr' });
    expect(ui.text).toContain('Un email contenant ce lien a été envoyé à camille@exemple.fr');
    expect(ui.text).toContain('Si l\'email n\'arrive pas');
    expect(ui.text).toContain('ne sera plus affiché');
    expect(ui.button('Fermer')).toBeDefined();
    expect(ui.field<HTMLInputElement>('input[readonly]').value).toContain('#token=t');
  });

  it("quand l'email a échoué, l'annonce comme une alerte, dit que le compte est créé et demande de transmettre le lien", async () => {
    await open({ status: 'FAILED', to: 'camille@exemple.fr' });
    expect(ui.error).toContain("L'email n'a pas pu être envoyé à camille@exemple.fr");
    expect(ui.error).toContain('Le compte est bien créé');
    expect(ui.button("J'ai transmis le lien")).toBeDefined();
  });

  it("garde l'ancien texte quand l'API ne précise rien", async () => {
    await open(undefined);
    expect(ui.text).toContain('Transmettez ce lien à la personne concernée');
  });
});
