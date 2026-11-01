import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ActionBar } from './action-bar';
import { Dialogs } from './dialogs.service';
import { FormDialog } from './form-dialog';
import { Notifier } from './notifier.service';
import { PageHeader } from './page-header';

@Component({
  imports: [PageHeader, ActionBar],
  template: `
    <app-page-header title="Projets" icon="folder_open" description="Une phrase d'explication.">
      <button type="button">Nouveau projet</button>
    </app-page-header>
    <app-page-header title="Sans action" />
    <app-action-bar description="Aide de la section" label="Actions des exercices">
      <button type="button">Nouvel exercice</button>
    </app-action-bar>
  `,
})
class Host {}

@Component({
  imports: [FormsModule, FormDialog],
  template: `
    <form (ngSubmit)="save()" novalidate>
      <app-form-dialog title="Formulaire d'essai" description="Aide du formulaire" [dirty]="dirty()" [busy]="busy()" [error]="error()" [details]="details()" submitLabel="Valider">
        <input name="x" />
      </app-form-dialog>
    </form>
  `,
})
class SampleDialog {
  static dirty = signal(false);
  static busy = signal(false);
  protected readonly dirty = SampleDialog.dirty;
  protected readonly busy = SampleDialog.busy;
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  private readonly reference = inject<MatDialogRef<SampleDialog, string>>(MatDialogRef);
  protected save(): void {
    this.reference.close('ok');
  }
}

describe('PageHeader et ActionBar', () => {
  it('affichent titre, icône, phrase, actions et masquent une zone d’actions vide', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const headers = root.querySelectorAll('app-page-header');
    expect(headers[0]!.querySelector('h1')!.textContent).toContain('Projets');
    expect(headers[0]!.querySelector('.description')!.textContent).toBe("Une phrase d'explication.");
    expect(headers[0]!.querySelector('mat-icon')!.textContent).toContain('folder_open');
    expect(headers[0]!.querySelector('.actions button')!.textContent).toBe('Nouveau projet');
    expect(headers[0]!.querySelector('.actions')!.getAttribute('aria-label')).toBe('Actions de la page Projets');
    expect(headers[1]!.querySelector('.description')).toBeNull();
    expect(headers[1]!.querySelector('mat-icon')).toBeNull();

    const bar = root.querySelector('app-action-bar')!;
    expect(bar.querySelector('.help')!.textContent).toBe('Aide de la section');
    expect(bar.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Actions des exercices');
  });
});

describe('FormDialog et Dialogs', () => {
  let dialogs: Dialogs;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
  };

  beforeEach(async () => {
    SampleDialog.dirty.set(false);
    SampleDialog.busy.set(false);
    await TestBed.configureTestingModule({ providers: [NO_MATERIAL_ANIMATIONS] }).compileComponents();
    dialogs = TestBed.inject(Dialogs);
    ui = new DialogTester(settle);
  });

  afterEach(() => ui.closeAll());

  const open = async () => {
    const result = dialogs.open<string>(SampleDialog, { size: 'sm' });
    await settle();
    return result;
  };

  it('s’ouvre avec son titre, son aide et la largeur demandée, focus dans la boîte', async () => {
    void open();
    await settle();
    expect(ui.title).toBe("Formulaire d'essai");
    expect(ui.text).toContain('Aide du formulaire');
    expect(document.querySelector('.app-dialog-sm')).toBeTruthy();
    expect(ui.dialog!.contains(document.activeElement)).toBe(true);
  });

  it('se ferme avec le résultat transmis par la page appelante', async () => {
    const result = open();
    await settle();
    await ui.submit();
    expect(await result).toBe('ok');
    expect(ui.isOpen).toBe(false);
  });

  it('Échap et le clic à côté ferment sans question quand rien n’a été saisi', async () => {
    const result = open();
    await settle();
    await ui.pressEscape();
    expect(await result).toBeUndefined();
    expect(ui.isOpen).toBe(false);

    const second = open();
    await settle();
    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    await settle();
    expect(await second).toBeUndefined();
  });

  it('Échap sur un formulaire modifié demande confirmation et garde la saisie si on continue', async () => {
    SampleDialog.dirty.set(true);
    const result = open();
    await settle();
    await ui.pressEscape();
    expect(ui.title).toBe('Abandonner les modifications ?');
    expect(ui.text).toContain("n'a pas été enregistré");
    await ui.click('Continuer la saisie');
    expect(ui.title).toBe("Formulaire d'essai");

    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    await settle();
    expect(ui.title).toBe('Abandonner les modifications ?');
    await ui.click('Abandonner');
    expect(await result).toBeUndefined();
    expect(ui.isOpen).toBe(false);
  });

  it('ne se ferme pas pendant un envoi et grise les boutons en annonçant l’attente', async () => {
    SampleDialog.busy.set(true);
    void open();
    await settle();
    await ui.pressEscape();
    expect(ui.isOpen).toBe(true);
    expect(ui.button('Annuler').disabled).toBe(true);
    expect(ui.text).toContain('Enregistrement…');
  });

  it('une confirmation renvoie le choix de l’utilisateur et met en garde les actions destructrices', async () => {
    const yes = dialogs.confirm({ title: 'Clôturer ?', message: 'Ce sera définitif.', confirmLabel: 'Clôturer', danger: true });
    await settle();
    expect(ui.title).toBe('Clôturer ?');
    expect(ui.button('Clôturer').classList.contains('danger')).toBe(true);
    await ui.click('Clôturer');
    expect(await yes).toBe(true);

    const no = dialogs.confirm({ title: 'Supprimer ?', message: 'Irréversible.' });
    await settle();
    await ui.click('Annuler');
    expect(await no).toBe(false);
  });
});

describe('Notifier', () => {
  it('affiche un bandeau temporaire avec un bouton pour le fermer', async () => {
    await TestBed.configureTestingModule({ providers: [NO_MATERIAL_ANIMATIONS] }).compileComponents();
    const ui = new DialogTester(async () => undefined);
    TestBed.inject(Notifier).success('Projet FESTIVAL créé.');
    await new Promise<void>((resolve) => setTimeout(resolve));
    expect(ui.snackbar).toContain('Projet FESTIVAL créé.');
    expect(ui.snackbar).toContain('Fermer');
  });
});
