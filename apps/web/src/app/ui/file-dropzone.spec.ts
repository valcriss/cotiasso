import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FileDropzone } from './file-dropzone';

@Component({
  imports: [FileDropzone],
  template: `<app-file-dropzone inputId="f" accept=".ofx,.qfx" formats="OFX, QFX" [disabled]="disabled()" (picked)="files.push($event)" />`,
})
class Host {
  readonly files: File[] = [];
  readonly disabled = signal(false);
}

describe('FileDropzone', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  let root: HTMLElement;
  const zone = () => root.querySelector<HTMLElement>('.zone')!;
  const dropEvent = (file: File) => {
    const event = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    return event;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    root = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('annonce les formats acceptés et reste utilisable au clavier', () => {
    expect(root.textContent).toContain('Glissez le fichier ici');
    expect(root.textContent).toContain('Formats acceptés : OFX, QFX');
    expect(zone().getAttribute('role')).toBe('button');
    expect(zone().tabIndex).toBe(0);
    expect(root.querySelector('input[type="file"]')!.id).toBe('f');
  });

  it('accepte un fichier déposé dans la zone', async () => {
    const file = new File(['x'], 'releve.OFX');
    zone().dispatchEvent(dropEvent(file));
    await fixture.whenStable();
    expect(fixture.componentInstance.files).toEqual([file]);
  });

  it('accepte un fichier choisi par le sélecteur', async () => {
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'releve.qfx');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.files).toEqual([file]);
  });

  it('refuse un format non accepté avec une phrase claire, sans rien envoyer', async () => {
    zone().dispatchEvent(dropEvent(new File(['x'], 'photo.png')));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.files).toEqual([]);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('« photo.png » n’est pas un format accepté (OFX, QFX)');
  });

  it('ignore les dépôts quand elle est désactivée', async () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    zone().dispatchEvent(dropEvent(new File(['x'], 'releve.ofx')));
    await fixture.whenStable();
    expect(fixture.componentInstance.files).toEqual([]);
  });
});
