import { inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';

/**
 * Valeur d'un paramètre de l'adresse (`/projets/:id`), qui suit la navigation : `null` sur la page de liste. À appeler dans un
 * contexte d'injection (constructeur ou initialisation de champ).
 */
export function routeParam(name: string): Signal<string | null> {
  const route = inject(ActivatedRoute);
  return toSignal(route.paramMap.pipe(map((params) => params.get(name))), { initialValue: route.snapshot.paramMap.get(name) });
}
