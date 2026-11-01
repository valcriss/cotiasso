import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NAVIGATION, SETTINGS_ITEM } from './navigation';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatTooltipModule],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly associationName = 'cotiasso';
  protected readonly navigation = NAVIGATION;
  protected readonly settings = SETTINGS_ITEM;
  protected readonly collapsed = signal(false);

  protected toggle(): void {
    this.collapsed.update((value) => !value);
  }
}
