import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { MfaEnrollPage, groupSecret, recoveryCodesText } from './mfa-enroll.page';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAAA') } }));

const start = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/cotiasso:m%40asso.fr?secret=JBSWY3DP' };
const me = {
  user: { id: '1', email: 'm@asso.fr', displayName: 'M', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' },
  permissions: ['projects:view'],
  mfa: { state: 'OK', enabled: true, required: true },
  csrfToken: 'csrf-1',
  expiresAt: '2026-11-02T00:00:00.000Z',
};
const codes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV'];

describe('helpers', () => {
  it('groupe la clé par blocs de 4 caractères', () => {
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });

  it('met les codes de secours en forme pour la copie et le téléchargement', () => {
    const text = recoveryCodesText(codes);
    expect(text).toContain('ABCDE-FGHJK');
    expect(text).toContain('ne sert qu\'une seule fois');
  });
});

describe('MfaEnrollPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<MfaEnrollPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  /** Attend l'apparition d'un élément (import dynamique de qrcode, plus lent sur une machine chargée). */
  const until = async (selector: string) => {
    for (let attempt = 0; attempt < 50 && !root.querySelector(selector); attempt++) await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MfaEnrollPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MfaEnrollPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => controller.verify());

  const loadStart = async () => {
    controller.expectOne('/api/auth/mfa/enroll/start').flush(start);
    await settle();
    await until('form input');
  };
  const submitCode = async (code: string) => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = code;
    input.dispatchEvent(new Event('input'));
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };

  it('affiche le QR code et la clé de saisie manuelle', async () => {
    await loadStart();
    await until('img.qr');
    // Le simulacre de qrcode n'est pas toujours appliqué à l'import dynamique en CI : on vérifie l'image, pas son contenu.
    expect(root.querySelector('img.qr')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(root.querySelector('.secret code')!.textContent).toContain('JBSW Y3DP');
  });

  it('signale une erreur de préparation', async () => {
    controller
      .expectOne('/api/auth/mfa/enroll/start')
      .flush({ message: "L'authentification à deux facteurs est déjà activée." }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('déjà activée');
  });

  it("refuse un code mal formé sans appeler le serveur", async () => {
    await loadStart();
    await submitCode('12ab');
    controller.expectNone('/api/auth/mfa/enroll/confirm');
    expect(root.textContent).toContain('Le code comporte 6 chiffres.');
  });

  it("active le second facteur puis montre les codes de secours une seule fois", async () => {
    await loadStart();
    await submitCode('123 456');
    const request = controller.expectOne('/api/auth/mfa/enroll/confirm');
    expect(request.request.body).toEqual({ code: '123456' });
    request.flush({ recoveryCodes: codes });
    await settle();
    controller.expectOne('/api/auth/me').flush(me);
    await settle();

    const listed = Array.from(root.querySelectorAll('ul.codes li')).map((li) => li.textContent?.trim());
    expect(listed).toEqual(codes);
    expect(root.textContent).toContain('ne seront plus affichés');
    expect(root.querySelector('form')).toBeNull();
  });

  it('affiche le refus du serveur pour un mauvais code', async () => {
    await loadStart();
    await submitCode('000000');
    controller
      .expectOne('/api/auth/mfa/enroll/confirm')
      .flush({ message: 'Code invalide ou expiré.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Code invalide ou expiré.');
  });

  it("termine en ouvrant la zone authentifiée", async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await loadStart();
    await submitCode('123456');
    controller.expectOne('/api/auth/mfa/enroll/confirm').flush({ recoveryCodes: codes });
    await settle();
    controller.expectOne('/api/auth/me').flush(me);
    await settle();

    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('conservé'))!.click();
    await settle();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
