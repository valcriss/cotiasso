import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { BrandingService } from '../branding/branding.service';
import { mockAuth } from '../testing/auth-mock';
import { AssociationPage } from './association.page';

const identity = { name: 'Club des amis', address: '', postalCode: '', city: 'Paris', email: '', phone: '', rna: '', siren: '' };
const branding = { appName: 'cotiasso', sidebarBackground: '#eaf2fd', sidebarText: '#0b2a55', accentColor: '#005cbb' };

describe('AssociationPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<AssociationPage>>;
  const apply = vi.fn();

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[]) => {
    apply.mockClear();
    await TestBed.configureTestingModule({
      imports: [AssociationPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(permissions),
        { provide: BrandingService, useValue: { apply, branding: signal(branding) } },
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AssociationPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/settings/identity').flush({ section: 'identity', value: identity });
    controller.expectOne('/api/settings/branding').flush({ section: 'branding', value: branding });
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));
  const setInput = (selector: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  afterEach(() => controller.verify());

  it("charge l'identité et l'apparence actuelles", async () => {
    await create(['settings.association:view', 'settings.association:admin']);
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[matInput]')).map((i) => i.value);
    expect(inputs).toContain('Club des amis');
    expect(inputs).toContain('Paris');
    expect(root.querySelector('.preview')!.textContent).toContain('cotiasso');
  });

  it('est en lecture seule sans la permission d\'administration', async () => {
    await create(['settings.association:view']);
    expect(root.textContent).toContain('pas les modifier');
    expect(buttonWith('Enregistrer')).toBeUndefined();
    expect(root.querySelector<HTMLInputElement>('input[matInput]')!.disabled).toBe(true);
  });

  it("enregistre l'identité et le signale, sans rien refaire quand il n'y a pas de changement", async () => {
    await create(['settings.association:view', 'settings.association:admin']);
    setInput('input[matInput]', 'Nouveau nom');
    buttonWith("Enregistrer l'identité")!.click();
    await settle();

    const request = controller.expectOne('/api/settings/identity');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({ name: 'Nouveau nom', city: 'Paris' });
    request.flush({ changed: true, value: { ...identity, name: 'Nouveau nom' } });
    await settle();
    expect(root.textContent).toContain('Identité enregistrée.');
  });

  it("affiche les motifs de refus du serveur pour un champ invalide", async () => {
    await create(['settings.association:view', 'settings.association:admin']);
    buttonWith("Enregistrer l'identité")!.click();
    await settle();
    controller
      .expectOne('/api/settings/identity')
      .flush(
        { message: 'Paramètres invalides.', issues: [{ path: 'rna', message: 'Le RNA a la forme W suivi de 9 chiffres.' }] },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Le RNA a la forme W');
  });

  it("applique la nouvelle apparence à l'interface après enregistrement", async () => {
    await create(['settings.association:view', 'settings.association:admin']);
    buttonWith("Enregistrer l'apparence")!.click();
    await settle();
    const request = controller.expectOne('/api/settings/branding');
    const saved = { appName: 'Mon Asso', sidebarBackground: '#0b2a55', sidebarText: '#ffffff', accentColor: '#005cbb' };
    request.flush({ changed: true, value: saved });
    await settle();
    expect(apply).toHaveBeenCalledWith(saved);
    expect(root.textContent).toContain('Apparence enregistrée.');
  });

  it('bloque l\'enregistrement quand le contraste est illisible et le dit', async () => {
    await create(['settings.association:view', 'settings.association:admin']);
    const colors = root.querySelectorAll<HTMLInputElement>('input[type="color"]');
    colors[0]!.value = '#ffffff';
    colors[0]!.dispatchEvent(new Event('input'));
    colors[1]!.value = '#f4f4f4';
    colors[1]!.dispatchEvent(new Event('input'));
    await settle();

    expect(root.textContent).toContain('Contraste insuffisant');
    expect(buttonWith("Enregistrer l'apparence")!.disabled).toBe(true);
  });
});
