import { type AfterViewInit, ChangeDetectorRef, Component, DestroyRef, ElementRef, Injectable, booleanAttribute, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, FormControl, NgControl, ReactiveFormsModule } from '@angular/forms';
import { ErrorStateMatcher, MAT_DATE_FORMATS, MAT_DATE_LOCALE, NativeDateAdapter, DateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

const pad = (value: number) => String(value).padStart(2, '0');

/** Date locale (jamais de décalage de fuseau) à partir de `AAAA-MM-JJ`, ou `null` si le texte n'est pas une date réelle. */
function fromIso(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? validDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export const toIso = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Adaptateur français : affichage `jj/mm/aaaa`, saisie `jj/mm/aaaa` ou `aaaa-mm-jj`, semaine qui commence le lundi. */
@Injectable()
export class FrenchDateAdapter extends NativeDateAdapter {
  constructor() {
    super();
    this.setLocale('fr-FR');
  }

  override parse(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const text = value.trim();
    const iso = fromIso(text);
    if (iso) return iso;
    const french = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(text);
    const date = french ? validDate(Number(french[3]), Number(french[2]), Number(french[1])) : null;
    return date ?? this.invalid();
  }

  override format(date: Date, displayFormat: unknown): string {
    if (displayFormat === 'input') return this.isValid(date) ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : '';
    return super.format(date, displayFormat as object);
  }

  override getFirstDayOfWeek(): number {
    return 1;
  }
}

const FRENCH_FORMATS = {
  parse: { dateInput: 'input' },
  display: {
    dateInput: 'input',
    monthYearLabel: { year: 'numeric', month: 'short' },
    dateA11yLabel: { year: 'numeric', month: 'long', day: 'numeric' },
    monthYearA11yLabel: { year: 'numeric', month: 'long' },
  },
};

/** Le champ est en erreur dès que le contrôle du formulaire qui le porte l'est, une fois touché. */
class OuterErrorMatcher extends ErrorStateMatcher {
  constructor(private readonly outer: () => { invalid: boolean; touched: boolean } | null) {
    super();
  }
  override isErrorState(): boolean {
    const control = this.outer();
    return !!control && control.invalid && control.touched;
  }
}

/**
 * Champ de date avec calendrier (icône à droite). La valeur du formulaire reste une chaîne `AAAA-MM-JJ` (vide quand il n'y a
 * pas de date) : à utiliser à la place de `<mat-form-field><input matInput type="date">`.
 *
 * <app-date-field label="Du" formControlName="from" hint="Facultatif" errorText="Indiquez le début." required />
 *
 * `errorText` s'affiche quand le contrôle du formulaire est invalide et touché.
 */
@Component({
  selector: 'app-date-field',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule],
  providers: [
    { provide: DateAdapter, useClass: FrenchDateAdapter },
    { provide: MAT_DATE_LOCALE, useValue: 'fr-FR' },
    { provide: MAT_DATE_FORMATS, useValue: FRENCH_FORMATS },
  ],
  styles: `
    :host {
      display: block;
    }
    mat-form-field {
      width: 100%;
    }
  `,
  template: `
    <mat-form-field appearance="outline">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        [formControl]="inner"
        [matDatepicker]="picker"
        [required]="required()"
        [errorStateMatcher]="matcher"
        [attr.formcontrolname]="name"
        placeholder="jj/mm/aaaa"
        autocomplete="off"
        (blur)="touched()"
      />
      <mat-datepicker-toggle matIconSuffix [for]="picker" />
      <mat-datepicker #picker />
      @if (hint()) {
        <mat-hint>{{ hint() }}</mat-hint>
      }
      @if (errorText()) {
        <mat-error>{{ errorText() }}</mat-error>
      }
    </mat-form-field>
  `,
})
export class DateField implements ControlValueAccessor, AfterViewInit {
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroyed = inject(DestroyRef);
  private readonly control = inject(NgControl, { self: true, optional: true });
  /** Nom du contrôle, recopié sur le champ de saisie pour que les tests et les lecteurs d'écran le retrouvent. */
  protected readonly name = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.getAttribute('formcontrolname');

  readonly label = input.required<string>();
  readonly hint = input<string>('');
  readonly errorText = input<string>('');
  readonly required = input(false, { transform: booleanAttribute });

  protected readonly inner = new FormControl<Date | null>(null);
  protected readonly matcher = new OuterErrorMatcher(() => this.control?.control ?? null);
  private readonly disabled = signal(false);
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    if (this.control) this.control.valueAccessor = this;
    this.inner.valueChanges.subscribe((date) => this.onChange(date ? toIso(date) : ''));
    effect(() => (this.disabled() ? this.inner.disable({ emitEvent: false }) : this.inner.enable({ emitEvent: false })));
  }

  /** Le champ est « OnPush » : il se remet à jour quand le formulaire touche ou revalide son contrôle (ex. clic sur Enregistrer). */
  ngAfterViewInit(): void {
    this.control?.control?.events.pipe(takeUntilDestroyed(this.destroyed)).subscribe(() => this.changes.markForCheck());
  }

  writeValue(value: string | null): void {
    this.inner.setValue(fromIso(value), { emitEvent: false });
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected touched(): void {
    this.onTouched();
  }
}
