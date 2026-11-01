import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BrandingService, DEFAULT_BRANDING } from './branding.service';
import { MIN_TEXT_CONTRAST, contrastRatio } from './contrast';

describe('BrandingService', () => {
  let service: BrandingService;
  let http: HttpTestingController;

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(BrandingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("applique le nom et les couleurs de l'association à l'interface", async () => {
    const loading = service.load();
    http.expectOne('/api/branding').flush({ appName: 'Mon Asso', sidebarBackground: '#0b2a55', sidebarText: '#ffffff' });
    await loading;

    expect(service.branding().appName).toBe('Mon Asso');
    expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg')).toBe('#0b2a55');
    expect(document.documentElement.style.getPropertyValue('--app-sidebar-text')).toBe('#ffffff');
    expect(document.title).toBe('Mon Asso');
  });

  it('garde les valeurs par défaut quand le serveur ne répond pas', async () => {
    const loading = service.load();
    http.expectOne('/api/branding').error(new ProgressEvent('error'));
    await loading;
    expect(service.branding()).toEqual(DEFAULT_BRANDING);
    expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg')).toBe(DEFAULT_BRANDING.sidebarBackground);
  });
});

describe('contrastRatio', () => {
  it('reproduit les valeurs WCAG de référence', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepte les couleurs par défaut et refuse un couple illisible', () => {
    expect(contrastRatio(DEFAULT_BRANDING.sidebarText, DEFAULT_BRANDING.sidebarBackground)!).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#f4f4f4', '#ffffff')!).toBeLessThan(MIN_TEXT_CONTRAST);
  });

  it("renvoie null pour une couleur invalide", () => {
    expect(contrastRatio('rouge', '#ffffff')).toBeNull();
    expect(contrastRatio('#fff', '#ffffff')).toBeNull();
  });
});
