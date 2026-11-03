import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Zone de dépôt de fichier : on glisse le fichier dessus ou on clique pour le choisir (le champ `input[type=file]` reste
 * dans la page, masqué, pour les lecteurs d'écran et les tests). Un fichier d'un type non accepté est refusé ici avec une
 * phrase claire ; le serveur contrôle de toute façon le contenu.
 *
 * <app-file-dropzone inputId="ofx-file" accept=".ofx,.qfx" formats="OFX, QFX" [disabled]="busy()" (picked)="analyse($event)" />
 */
@Component({
  selector: 'app-file-dropzone',
  imports: [MatButtonModule, MatIconModule],
  styles: `
    :host {
      display: block;
    }
    .zone {
      align-items: center;
      background: var(--app-surface-muted);
      border: 2px dashed var(--app-field-border);
      border-radius: 8px;
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 28px 20px;
      text-align: center;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .zone:hover,
    .zone.over {
      background: var(--app-surface);
      border-color: var(--mat-sys-primary);
    }
    .zone:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
    .zone.disabled {
      cursor: default;
      opacity: 0.6;
      pointer-events: none;
    }
    .zone mat-icon {
      color: var(--mat-sys-primary);
      font-size: 40px;
      height: 40px;
      width: 40px;
    }
    .title {
      font: var(--mat-sys-title-small);
    }
    .title u {
      color: var(--mat-sys-primary);
    }
    .chosen {
      align-items: center;
      color: var(--app-success);
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 6px;
    }
    .chosen mat-icon {
      color: inherit;
      font-size: 20px;
      height: 20px;
      width: 20px;
    }
    .error {
      color: var(--mat-sys-error);
      margin: 8px 0 0;
    }
    input {
      display: none;
    }
  `,
  template: `
    <div
      class="zone"
      role="button"
      tabindex="0"
      [class.over]="over()"
      [class.disabled]="disabled()"
      [attr.aria-disabled]="disabled()"
      [attr.aria-label]="label()"
      (click)="choose()"
      (keydown.enter)="choose()"
      (keydown.space)="$event.preventDefault(); choose()"
      (dragover)="dragOver($event)"
      (dragleave)="over.set(false)"
      (drop)="drop($event)"
    >
      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">upload_file</mat-icon>
      <span class="title">Glissez le fichier ici ou <u>choisissez-le sur votre ordinateur</u></span>
      @if (fileName(); as name) {
        <span class="chosen"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">check_circle</mat-icon> {{ name }}</span>
      } @else if (formats()) {
        <span class="muted">Formats acceptés : {{ formats() }}</span>
      }
    </div>
    <input #file type="file" [id]="inputId()" [attr.accept]="accept() || null" [disabled]="disabled()" (change)="changed($event)" [attr.aria-label]="label()" />
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
})
export class FileDropzone {
  /** Identifiant du champ de fichier masqué (pour une étiquette ou un test). */
  readonly inputId = input<string>('');
  /** Valeur de l'attribut `accept` : extensions (« .pdf,.png ») ou types MIME. */
  readonly accept = input<string>('');
  /** Formats en clair, pour la personne (« PDF, PNG »). */
  readonly formats = input<string>('');
  readonly label = input<string>('Choisir un fichier');
  readonly disabled = input<boolean>(false);
  /** Nom du fichier déjà choisi, affiché dans la zone. */
  readonly fileName = input<string>('');
  readonly picked = output<File>();

  protected readonly over = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('file');
  private readonly extensions = computed(() =>
    this.accept()
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.startsWith('.')),
  );

  protected choose(): void {
    if (!this.disabled()) this.field().nativeElement.click();
  }

  protected changed(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.take(file);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.disabled()) this.over.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && !this.disabled()) this.take(file);
  }

  private take(file: File): void {
    const allowed = this.extensions();
    const extension = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
    if (allowed.length > 0 && !allowed.includes(extension)) {
      this.error.set(
        `« ${file.name} » n’est pas un format accepté${this.formats() ? ` (${this.formats()})` : ''}. Choisissez un autre fichier.`,
      );
      return;
    }
    this.error.set(null);
    this.picked.emit(file);
  }
}
