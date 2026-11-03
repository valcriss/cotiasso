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
  const setLogoHash = vi.fn();
  const setLogoShowsName = vi.fn();
  const logoUrl = signal<string | null>(null);

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[]) => {
    apply.mockClear();
    setLogoHash.mockClear();
    setLogoShowsName.mockClear();
    logoUrl.set(null);
    await TestBed.configureTestingModule({
      imports: [AssociationPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        mockAuth(permissions),
        { provide: BrandingService, useValue: { apply, setLogoHash, setLogoShowsName, logoUrl, branding: signal(branding) } },
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

  describe('logo', () => {
    const choose = async (file: File) => {
      const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle();
    };

    it("explique qu'il n'y a pas de logo et propose de l'ajouter", async () => {
      await create(['settings.association:view', 'settings.association:admin']);
      expect(root.textContent).toContain('Aucun logo pour l');
      expect(buttonWith('Ajouter un logo')).toBeDefined();
      expect(buttonWith('Retirer le logo')).toBeUndefined();
      expect(root.querySelector('input[type="file"]')!.getAttribute('accept')).toContain('.svg');
    });

    it('envoie le fichier choisi, puis affiche le nouveau logo sans recharger la page', async () => {
      await create(['settings.association:view', 'settings.association:admin']);
      await choose(new File(['x'], 'logo.png', { type: 'image/png' }));
      const request = controller.expectOne('/api/branding/logo');
      expect(request.request.method).toBe('PUT');
      expect((request.request.body as FormData).get('file')).toBeInstanceOf(File);
      request.flush({ logoHash: 'a'.repeat(64) });
      await settle();
      expect(setLogoHash).toHaveBeenCalledWith('a'.repeat(64));
      expect(root.textContent).toContain('Logo enregistré.');
    });

    it("affiche le refus du serveur avec ce qu'il faut faire", async () => {
      await create(['settings.association:view', 'settings.association:admin']);
      await choose(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }));
      controller.expectOne('/api/branding/logo').flush({ message: 'Ce fichier n’est pas un logo utilisable. Choisissez une image PNG, JPEG ou SVG.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(root.querySelector('[role="alert"]')!.textContent).toContain('Choisissez une image PNG, JPEG ou SVG');
      expect(setLogoHash).not.toHaveBeenCalled();
    });

    it('retire le logo existant', async () => {
      await create(['settings.association:view', 'settings.association:admin']);
      logoUrl.set('/api/branding/logo?v=abc');
      fixture.detectChanges();
      expect(buttonWith('Remplacer le logo')).toBeDefined();
      buttonWith('Retirer le logo')!.click();
      await settle();
      const request = controller.expectOne('/api/branding/logo');
      expect(request.request.method).toBe('DELETE');
      request.flush(null);
      await settle();
      expect(setLogoHash).toHaveBeenCalledWith(null);
      expect(root.textContent).toContain('Logo retiré.');
    });

    it("ne propose le choix logo seul ou logo et nom que s'il y a un logo", async () => {
      await create(['settings.association:view', 'settings.association:admin']);
      expect(root.querySelector('mat-radio-group')).toBeNull();
      logoUrl.set('/api/branding/logo?v=abc');
      fixture.detectChanges();
      const labels = Array.from(root.querySelectorAll('mat-radio-button')).map((r) => r.textContent?.trim());
      expect(labels).toEqual(["Logo et nom de l'association", 'Logo seul']);
      expect(root.textContent).toContain('contient déjà le nom');
    });

    it("enregistre le choix « Logo seul » tout de suite et l'applique au menu", async () => {
      await create(['settings.association:view', 'settings.association:admin']);
      logoUrl.set('/api/branding/logo?v=abc');
      fixture.detectChanges();
      root.querySelectorAll<HTMLInputElement>('mat-radio-button input[type="radio"]')[1]!.click();
      await settle();
      const request = controller.expectOne('/api/branding/logo/display');
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ showName: false });
      request.flush(null);
      await settle();
      expect(setLogoShowsName).toHaveBeenCalledWith(false);
      expect(root.textContent).toContain('Le menu affiche le logo seul.');
    });

    it("n'offre ni ajout ni retrait en lecture seule", async () => {
      await create(['settings.association:view']);
      expect(root.querySelector('input[type="file"]')).toBeNull();
      expect(buttonWith('Ajouter un logo')).toBeUndefined();
    });
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
