import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PasskeyService } from '../auth/passkey.service';
import { mockAuth } from '../testing/auth-mock';
import { PasskeysPanel } from './passkeys-panel';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  label: 'iPhone de Camille',
  createdAt: '2026-11-01T10:00:00.000Z',
  lastUsedAt: null,
  deviceType: 'multiDevice',
  backedUp: true,
  ...over,
});

describe('PasskeysPanel', () => {
  const render = async (state: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    const service = {
      supported: () => true,
      state: vi.fn(async () => state),
      register: vi.fn(async () => ({ passkey: item(), recoveryCodes: null as string[] | null })),
      rename: vi.fn(async () => {}),
      revoke: vi.fn(async () => {}),
      ...overrides,
    };
    await TestBed.configureTestingModule({
      imports: [PasskeysPanel],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth([]), { provide: PasskeyService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PasskeysPanel);
    const root = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await settle();
    const button = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));
    const type = (selector: string, value: string) => {
      const input = root.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    return { service, root, settle, button, type };
  };

  it('ne montre rien quand les clés d’accès sont désactivées et qu’il n’y en a aucune', async () => {
    const { root } = await render({ mode: 'DISABLED', usernameless: false, canRegister: false, items: [] });
    expect(root.querySelector('section')).toBeNull();
  });

  it('explique que les clés sont conservées mais inutilisées quand l’association les désactive', async () => {
    const { root, button } = await render({ mode: 'DISABLED', usernameless: false, canRegister: false, items: [item()] });
    expect(root.textContent).toContain('n’utilise pas les clés d’accès pour l’instant');
    expect(root.textContent).toContain('iPhone de Camille');
    expect(button('Ajouter')).toBeUndefined();
  });

  it('liste les clés avec leur nature et leur dernier usage, et propose un état vide utile', async () => {
    const { root } = await render({ mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [item(), item({ id: 'k2', label: 'Clé de sécurité', deviceType: 'singleDevice', lastUsedAt: '2026-11-05T10:00:00.000Z' })] });
    expect(root.textContent).toContain('Synchronisée avec votre compte');
    expect(root.textContent).toContain('Sur cet appareil seulement');
    expect(root.textContent).toContain('jamais utilisée');
    expect(root.textContent).toContain('utilisée le 05/11/2026');

    TestBed.resetTestingModule();
    const empty = await render({ mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [] });
    expect(empty.root.textContent).toContain('pas encore de clé d’accès');
  });

  it('demande le mot de passe avant d’ajouter, puis ajoute avec le nom choisi', async () => {
    const { service, root, settle, button, type } = await render({ mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [] });
    button('Ajouter une clé')!.click();
    await settle();
    expect(service.register).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('mot de passe actuel');

    type('input[type="password"]', 'une phrase de passe correcte');
    type('input[maxlength="60"]', ' Mon téléphone du local ');
    button('Ajouter une clé')!.click();
    await settle();
    expect(service.register).toHaveBeenCalledWith('Mon téléphone du local', 'une phrase de passe correcte');
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Clé d’accès ajoutée');
    expect(service.state).toHaveBeenCalledTimes(2);
  });

  it('montre les codes de secours une seule fois quand le serveur vient de les créer', async () => {
    const { root, settle, button, type } = await render(
      { mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [] },
      { register: vi.fn(async () => ({ passkey: item(), recoveryCodes: ['ABCDE-FGHJK', 'LMNPQ-RSTUV'] })) },
    );
    type('input[type="password"]', 'une phrase de passe correcte');
    button('Ajouter une clé')!.click();
    await settle();
    expect(root.textContent).toContain('ABCDE-FGHJK');
    expect(root.textContent).toContain('ne seront plus affichés');
  });

  it('traduit l’annulation par la personne sans jargon', async () => {
    const { root, settle, button, type } = await render(
      { mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [] },
      { register: vi.fn(async () => Promise.reject({ name: 'NotAllowedError' })) },
    );
    type('input[type="password"]', 'une phrase de passe correcte');
    button('Ajouter une clé')!.click();
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('annulée');
    expect(root.querySelector('[role="alert"]')!.textContent).not.toContain('NotAllowedError');
  });

  it('renomme une clé', async () => {
    const { service, root, settle, button, type } = await render({ mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [item()] });
    button('Renommer')!.click();
    await settle();
    type('.rename input', 'Téléphone du bureau');
    root.querySelector<HTMLFormElement>('.rename')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(service.rename).toHaveBeenCalledWith('k1', 'Téléphone du bureau');
  });

  it('exige le mot de passe pour retirer une clé, puis la retire', async () => {
    const { service, root, settle, button, type } = await render({ mode: 'SECOND_FACTOR', usernameless: false, canRegister: true, items: [item()] });
    button('Retirer')!.click();
    await settle();
    expect(service.revoke).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('mot de passe actuel');

    type('input[type="password"]', 'une phrase de passe correcte');
    button('Retirer')!.click();
    await settle();
    expect(service.revoke).toHaveBeenCalledWith('k1', 'une phrase de passe correcte');
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Clé d’accès retirée');
  });
});
