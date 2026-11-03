import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { DateField } from './date-field';

@Component({
  imports: [ReactiveFormsModule, DateField],
  template: `<form [formGroup]="form"><app-date-field label="Date" formControlName="date" errorText="Indiquez la date." required /></form>`,
})
class Host {
  readonly form = new FormGroup({ date: new FormControl('2026-03-05', { nonNullable: true, validators: [Validators.required] }) });
}

describe('DateField', () => {
  let root: HTMLElement;
  let host: Host;
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const input = () => root.querySelector<HTMLInputElement>('input')!;
  const type = async (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host], providers: [NO_MATERIAL_ANIMATIONS] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    root = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('affiche la date au format français et propose un calendrier à droite', () => {
    expect(input().value).toBe('05/03/2026');
    expect(root.querySelector('mat-datepicker-toggle button')).not.toBeNull();
    expect(input().getAttribute('formcontrolname')).toBe('date');
  });

  it('garde une chaîne AAAA-MM-JJ dans le formulaire, saisie en français ou en ISO', async () => {
    await type('14/07/2026');
    expect(host.form.controls.date.value).toBe('2026-07-14');
    await type('2027-01-02');
    expect(host.form.controls.date.value).toBe('2027-01-02');
  });

  it('vide la valeur quand la saisie est effacée ou n’est pas une vraie date', async () => {
    await type('');
    expect(host.form.controls.date.value).toBe('');
    await type('31/02/2026');
    expect(host.form.controls.date.value).toBe('');
  });

  it('suit les changements venus du formulaire et son état désactivé', async () => {
    host.form.controls.date.setValue('2026-12-31');
    await fixture.whenStable();
    expect(input().value).toBe('31/12/2026');
    host.form.controls.date.disable();
    await fixture.whenStable();
    expect(input().disabled).toBe(true);
  });

  it('montre le message d’erreur seulement une fois le champ touché et invalide', async () => {
    host.form.controls.date.setValue('');
    fixture.detectChanges();
    expect(root.querySelector('mat-error')).toBeNull();
    host.form.markAllAsTouched();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('mat-error')?.textContent).toContain('Indiquez la date.');
  });
});
