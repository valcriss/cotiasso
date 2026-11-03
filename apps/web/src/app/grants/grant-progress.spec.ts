import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GrantProgress, type ProgressAction } from './grant-progress';

const grant = (over: Record<string, unknown> = {}) =>
  ({ id: 'g1', title: 'Aide 2026', status: 'GRANTED', grantedAmount: '3000.00', allocations: [{ projectId: 'p1' }], funder: { name: 'Mairie' }, ...over }) as never;
const finance = (over: Record<string, unknown> = {}) =>
  ({ grantId: 'g1', granted: '3000.00', received: '3000.00', remaining: '0.00', spent: '3000.00', residual: '0.00', schedule: [], payments: [], ...over }) as never;

describe('GrantProgress (#22)', () => {
  const render = async (inputs: Record<string, unknown>, canManage = true) => {
    await TestBed.configureTestingModule({ imports: [GrantProgress] }).compileComponents();
    const fixture = TestBed.createComponent(GrantProgress);
    fixture.componentRef.setInput('canManage', canManage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    const emitted: ProgressAction[] = [];
    fixture.componentInstance.act.subscribe((a) => emitted.push(a));
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const states = Array.from(root.querySelectorAll('li')).map((li) => `${li.querySelector('span')!.textContent}:${li.className}`);
    return { root, states, emitted, text: root.textContent!.replace(/\s+/g, ' ') };
  };

  it('une demande sans projet financé invite à les choisir ; avec projets, à enregistrer la réponse du financeur', async () => {
    const first = await render({ grant: grant({ status: 'REQUESTED', allocations: [] }) });
    expect(first.states).toEqual(['Demandée:current', 'Accordée:todo', 'Argent reçu:todo', 'Dépenses justifiées:todo', 'Clôturée:todo']);
    expect(first.text).toContain('Dites d’abord quels projets');
    (first.root.querySelector('button') as HTMLButtonElement).click();
    expect(first.emitted).toEqual(['allocate']);

    TestBed.resetTestingModule();
    const second = await render({ grant: grant({ status: 'UNDER_REVIEW' }) });
    expect(second.text).toContain('Le financeur a répondu ? Enregistrez sa décision.');
    (second.root.querySelector('button') as HTMLButtonElement).click();
    expect(second.emitted).toEqual(['decide']);
  });

  it('une subvention accordée dit ce qui reste à recevoir, puis à justifier, puis propose de clôturer', async () => {
    const waiting = await render({ grant: grant(), finance: finance({ received: '1000.00', remaining: '2000.00', spent: '0.00', residual: '1000.00' }) });
    expect(waiting.states).toEqual(['Demandée:done', 'Accordée:done', 'Argent reçu:current', 'Dépenses justifiées:todo', 'Clôturée:todo']);
    expect(waiting.text).toContain('2 000,00 € restent à recevoir');
    expect(waiting.root.querySelector('button')).toBeNull();

    TestBed.resetTestingModule();
    const justifying = await render({ grant: grant(), finance: finance({ spent: '2600.00', residual: '400.00' }) });
    expect(justifying.states[3]).toBe('Dépenses justifiées:current');
    expect(justifying.text).toContain('400,00 € reçus ne sont pas encore justifiés');

    TestBed.resetTestingModule();
    const ready = await render({ grant: grant(), finance: finance() });
    expect(ready.states).toEqual(['Demandée:done', 'Accordée:done', 'Argent reçu:done', 'Dépenses justifiées:done', 'Clôturée:current']);
    expect(ready.text).toContain('vous pouvez clôturer la subvention');
    (ready.root.querySelector('button') as HTMLButtonElement).click();
    expect(ready.emitted).toEqual(['close']);
  });

  it('sans le droit de gérer, le texte reste mais le bouton disparaît ; sans suivi chargé ou d’une autre subvention, la frise se limite au dossier', async () => {
    const readOnly = await render({ grant: grant({ status: 'UNDER_REVIEW' }) }, false);
    expect(readOnly.text).toContain('Enregistrez sa décision');
    expect(readOnly.root.querySelector('button')).toBeNull();

    TestBed.resetTestingModule();
    const foreign = await render({ grant: grant(), finance: finance({ grantId: 'autre' }) });
    expect(foreign.states[1]).toBe('Accordée:current');
    expect(foreign.text).toContain('suivez les versements reçus');
  });

  it('une subvention clôturée est entièrement faite ; refusée ou abandonnée, pas de frise (la page garde sa phrase d’explication)', async () => {
    const closed = await render({ grant: grant({ status: 'CLOSED' }), finance: finance() });
    expect(closed.states.every((s) => s.endsWith(':done'))).toBe(true);
    TestBed.resetTestingModule();
    const refused = await render({ grant: grant({ status: 'REFUSED' }) });
    expect(refused.root.querySelector('ol')).toBeNull();
  });
});
