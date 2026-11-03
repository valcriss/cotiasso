import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Onglets d'une page (`<nav class="tabs">`) : sur grand écran ils restent des onglets ; sur petit écran (feuille `app-ui.scss`)
 * seule la rubrique courante est visible, avec un bouton « Rubrique : … » qui déplie la liste. Pas de défilement horizontal,
 * pas de rangées d'onglets qui mangent l'écran. Le bouton est ajouté ici pour ne rien dupliquer dans les pages.
 */
@Directive({ selector: 'nav.tabs[appTabsMenu]' })
export class TabsMenu {
  private readonly nav = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const nav = this.nav;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tabs-toggle';
    button.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'tabs-toggle-label';
    const icon = document.createElement('span');
    icon.className = 'material-icons-outlined tabs-toggle-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'expand_more';
    button.append(label, icon);
    nav.prepend(button);

    const setOpen = (open: boolean) => {
      nav.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
      icon.textContent = open ? 'expand_less' : 'expand_more';
    };
    const refresh = () => {
      const active = nav.querySelector<HTMLElement>('a.active span');
      const name = (active?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const text = name ? `Rubrique : ${name}` : 'Choisir une rubrique';
      // Ne réécrit que si le texte change : la réécriture est observée, sans cette garde la boucle ne s'arrêterait jamais.
      if (label.textContent !== text) label.textContent = text;
    };

    const onClick = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.tabs-toggle')) {
        setOpen(!nav.classList.contains('open'));
      } else if (event.target instanceof Element && event.target.closest('a')) {
        setOpen(false);
      }
    };
    nav.addEventListener('click', onClick);
    refresh();
    // Les liens sont rendus après la directive : on relit la rubrique courante une fois la page affichée.
    afterNextRender(refresh);
    // Seuls les changements de classe (rubrique active) comptent ; le bouton lui-même n'est pas observé.
    const observer =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
        if (records.some((record) => record.target instanceof Element && record.target.closest('a'))) refresh();
      });
    observer?.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });

    inject(DestroyRef).onDestroy(() => {
      nav.removeEventListener('click', onClick);
      observer?.disconnect();
    });
  }
}
