/**
 * Affichage mobile des tableaux : sur petit écran, chaque ligne devient une carte et chaque cellule
 * affiche le nom de sa colonne devant sa valeur (feuille `app-ui.scss`, `content: attr(data-label)`).
 * Les libellés sont lus dans l'en-tête du tableau, pour ne rien répéter dans les modèles de page.
 */

/** Texte d'un en-tête, sans le texte réservé aux lecteurs d'écran ni les aides « ? ». */
function headerText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('.sr-only, mat-icon, app-help-hint, button').forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Libellés de colonnes d'un tableau (dernière ligne d'en-tête), en tenant compte des cellules fusionnées. */
function columnLabels(table: HTMLTableElement): string[] {
  const rows = table.tHead?.rows;
  if (!rows || rows.length === 0) {
    return [];
  }
  const labels: string[] = [];
  for (const cell of Array.from(rows[rows.length - 1].cells)) {
    const label = headerText(cell);
    for (let i = 0; i < Math.max(1, cell.colSpan); i++) {
      labels.push(label);
    }
  }
  return labels;
}

/** Pose `data-label` sur les cellules du corps et du pied d'un tableau. Idempotent. */
export function labelTable(table: HTMLTableElement): void {
  const labels = columnLabels(table);
  if (labels.length === 0) {
    return;
  }
  const sections = Array.from(table.tBodies).concat(table.tFoot ? [table.tFoot] : []);
  for (const section of sections) {
    for (const row of Array.from(section.rows)) {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        const span = Math.max(1, cell.colSpan);
        const label = span === 1 ? (labels[column] ?? '') : '';
        // Un en-tête de ligne (<th scope="row">) sert de titre à la carte : pas de libellé devant.
        const wanted = cell.tagName === 'TH' ? '' : label;
        if (wanted) {
          if (cell.getAttribute('data-label') !== wanted) {
            cell.setAttribute('data-label', wanted);
          }
        } else if (cell.hasAttribute('data-label')) {
          cell.removeAttribute('data-label');
        }
        column += span;
      }
    }
  }
}

/** Observe le document : tout tableau `.table` ajouté ou modifié reçoit ses libellés. Renvoie l'arrêt de l'observation. */
export function watchTableLabels(root: Document = document): () => void {
  if (typeof MutationObserver === 'undefined') {
    return () => undefined;
  }
  const pending = new Set<HTMLTableElement>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const tables = Array.from(pending);
    pending.clear();
    for (const table of tables) {
      if (table.isConnected) {
        labelTable(table);
      }
    }
  };
  const queue = (node: Node | null) => {
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    const table = element?.closest('table.table, table.stack-table') ?? null;
    if (table) {
      pending.add(table as HTMLTableElement);
    } else if (element) {
      element.querySelectorAll('table.table, table.stack-table').forEach((found) => pending.add(found as HTMLTableElement));
    }
    if (pending.size > 0 && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => queue(node));
        queue(mutation.target);
      } else {
        queue(mutation.target);
      }
    }
  });
  observer.observe(root.body, { childList: true, subtree: true, characterData: true });
  queue(root.body);
  return () => observer.disconnect();
}
