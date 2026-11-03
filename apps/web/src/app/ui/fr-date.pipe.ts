import { Pipe, PipeTransform } from '@angular/core';
import { formatDate, formatDateLong } from './dates';

/** `2026-11-02` → `02/11/2026` (`'long'` : `2 novembre 2026`). Pur et sans fuseau : voir `dates.ts`. */
@Pipe({ name: 'frDate' })
export class FrDatePipe implements PipeTransform {
  transform(value: string | null | undefined, style: 'short' | 'long' = 'short'): string {
    return style === 'long' ? formatDateLong(value) : formatDate(value);
  }
}
