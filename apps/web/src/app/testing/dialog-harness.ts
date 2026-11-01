import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';

/** À fournir aux tests qui ouvrent des boîtes de dialogue : sans animation de sortie, la fermeture est immédiate. */
export const NO_MATERIAL_ANIMATIONS = { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } };

/**
 * Aides de test des boîtes de dialogue et des bandeaux : ils se rendent dans la couche de superposition (hors du composant
 * testé), qu'il faut donc interroger à part. `settle` vide les micro-tâches et rafraîchit la vue de la page testée.
 */
export class DialogTester {
  constructor(private readonly settle: () => Promise<void>) {}

  private get overlay(): HTMLElement {
    return TestBed.inject(OverlayContainer).getContainerElement();
  }

  /** Boîte de dialogue ouverte la plus récente (la confirmation d'abandon recouvre le formulaire), ou `null`. */
  get dialog(): HTMLElement | null {
    const all = Array.from(this.overlay.querySelectorAll<HTMLElement>('.mat-mdc-dialog-container'));
    return all[all.length - 1] ?? null;
  }

  get isOpen(): boolean {
    return this.dialog !== null;
  }

  get text(): string {
    return this.dialog?.textContent ?? '';
  }

  get title(): string {
    return this.dialog?.querySelector('[mat-dialog-title], .mat-mdc-dialog-title')?.textContent?.trim() ?? '';
  }

  /** Texte de l'alerte d'erreur affichée dans la boîte, ou `null`. */
  get error(): string | null {
    return this.dialog?.querySelector('[role="alert"]')?.textContent?.trim() ?? null;
  }

  /** Texte du bandeau temporaire (snackbar), ou `null`. */
  get snackbar(): string | null {
    return this.overlay.querySelector('.mat-mdc-snack-bar-container')?.textContent?.trim() ?? null;
  }

  field<T extends HTMLElement = HTMLInputElement>(selector: string): T {
    const element = this.dialog?.querySelector<T>(selector);
    if (!element) throw new Error(`Champ introuvable dans la boîte de dialogue : ${selector}`);
    return element;
  }

  async type(selector: string, value: string): Promise<void> {
    const input = this.field(selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await this.settle();
  }

  button(label: string): HTMLButtonElement {
    const found = Array.from(this.dialog?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    if (!found) throw new Error(`Bouton introuvable dans la boîte de dialogue : ${label}`);
    return found as HTMLButtonElement;
  }

  async click(label: string): Promise<void> {
    this.button(label).click();
    await this.settle();
  }

  /** Choisit une option dans une liste déroulante de la boîte : ouvre la liste puis clique l'option dont le texte contient `option`. */
  async choose(selectSelector: string, option: string): Promise<void> {
    this.field(selectSelector).querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await this.settle();
    const found = Array.from(this.overlay.querySelectorAll<HTMLElement>('.mat-mdc-option')).find((o) => o.textContent!.includes(option));
    if (!found) throw new Error(`Option introuvable : ${option}`);
    found.click();
    await this.settle();
  }

  /** Textes des options proposées par une liste déroulante de la boîte (la liste est ouverte puis refermée). */
  async options(selectSelector: string): Promise<string[]> {
    this.field(selectSelector).querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
    await this.settle();
    const texts = Array.from(this.overlay.querySelectorAll<HTMLElement>('.mat-mdc-option')).map((o) => o.textContent!.trim());
    this.overlay.querySelector<HTMLElement>('.cdk-overlay-transparent-backdrop')?.click();
    await this.settle();
    return texts;
  }

  /** Valide le formulaire de la boîte (comme un appui sur le bouton d'envoi). */
  async submit(): Promise<void> {
    this.dialog!.querySelector('form')!.dispatchEvent(new Event('submit'));
    await this.settle();
  }

  async pressEscape(): Promise<void> {
    this.dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await this.settle();
  }

  /** Ferme toutes les boîtes restées ouvertes entre deux tests. */
  closeAll(): void {
    this.overlay.querySelectorAll('.mat-mdc-dialog-container').forEach((node) => node.remove());
  }
}
