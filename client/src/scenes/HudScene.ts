import * as Phaser from 'phaser';
import { ATLAS } from '../assets';
import { playSfx } from '../sound';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { keepAwake } from '../platform/wakeLock';
import { settings, updateSettings } from '../settings';
import { PausePanel } from '../ui/PausePanel';
import { Tooltip } from '../ui/Tooltip';
import { layoutOf, onLayoutChange } from '../ui/layout';
import { COLORS, textStyle } from '../ui/theme';
import { RunScene } from './RunScene';
import type { LoadoutItem } from './RunScene';

interface Slot {
  x: number;
  y: number;
  locked: boolean;
  item: LoadoutItem | undefined;
  icon: Phaser.GameObjects.Image;
  level: Phaser.GameObjects.Text;
}

const SLOT_SIZE = 20;

export class HudScene extends Phaser.Scene {
  private run!: RunScene;
  private hpBar!: Phaser.GameObjects.Graphics;
  private xpBar!: Phaser.GameObjects.Graphics;
  private stats!: Phaser.GameObjects.Text;
  private level!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private fps!: Phaser.GameObjects.Text;
  private caps!: Phaser.GameObjects.Text;
  private bossName!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private warning!: Phaser.GameObjects.Text;
  private pausePanel!: PausePanel;
  private buffIcons: Phaser.GameObjects.Image[] = [];
  private buffBars!: Phaser.GameObjects.Graphics;
  private weaponSlots: Slot[] = [];
  private heavySlots: Slot[] = [];
  private passiveSlots: Slot[] = [];
  private tooltip!: Tooltip;
  private toast!: Phaser.GameObjects.Text;
  private autopilot: Phaser.GameObjects.Text | null = null;
  private emeraldIcon!: Phaser.GameObjects.Image;
  private emeralds!: Phaser.GameObjects.Text;
  private barWidth = 132;
  private buffY = 40;
  private bossLine = { x: 0, y: 0, width: 0 };
  private refreshAt = 0;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.run = this.scene.get('Run') as RunScene;
    const { cx, width, height, portrait } = layoutOf(this);
    const top = portrait ? 38 : 26;
    this.barWidth = portrait ? 96 : 132;
    this.buffY = portrait ? 56 : 40;
    this.bossLine = portrait
      ? { x: 20, y: height - 66, width: width - 40 } : { x: 177, y: height - 22, width: 170 };
    const right = this.barWidth + 34;
    this.add.rectangle(cx, top / 2, width, top, COLORS.panel, 0.82);
    this.add.rectangle(cx, top, width, 1, COLORS.panelBorder, 0.7);
    this.add.text(6, 4, 'HP', textStyle(8, COLORS.dim));
    this.add.text(6, 15, 'XP', textStyle(8, COLORS.dim));
    this.hpBar = this.add.graphics();
    this.xpBar = this.add.graphics();
    this.level = this.add.text(right, 4, '', textStyle(8, COLORS.bright));
    this.timer = this.add.text(cx, top + 5, '', textStyle(16, COLORS.bright)).setOrigin(0.5, 0);
    this.stats = this.add.text(portrait ? 6 : right, portrait ? 27 : 15, '', textStyle(8, COLORS.text));
    this.fps = this.add.text(6, height - (portrait ? 92 : 48), '', textStyle(8, COLORS.dim));
    const money = portrait ? { x: right + 4, y: 19 } : { x: 350, y: 13 };
    this.add.image(money.x, money.y, ATLAS, 'ui/cap');
    this.emeraldIcon = this.add.image(money.x + 54, money.y, ATLAS, 'ui/emerald');
    this.emeralds = this.add.text(money.x + 64, money.y - 4, '', textStyle(8, '#9bff6e'));
    this.caps = this.add.text(money.x + 10, money.y - 4, '0', textStyle(8, COLORS.warn));
    this.bossName = this.add.text(this.bossLine.x + this.bossLine.width / 2, this.bossLine.y - 10, '', textStyle(8, COLORS.danger)).setOrigin(0.5);
    this.bossBar = this.add.graphics();
    this.buffIcons = [];
    this.buffBars = this.add.graphics();
    const { slots, maxSlots } = this.run;
    const gunsY = height - (portrait ? 38 : 14);
    this.weaponSlots = this.addSlots(maxSlots.weapons, 4, gunsY, slots.weapons);
    this.heavySlots = this.addSlots(slots.heavy, 8 + maxSlots.weapons * SLOT_SIZE, gunsY, slots.heavy, COLORS.evolution);
    this.passiveSlots = this.addSlots(maxSlots.passives,
      portrait ? 4 : width - 4 - maxSlots.passives * SLOT_SIZE, height - 14, slots.passives);
    this.tooltip = new Tooltip(this);
    this.refreshAt = 0;
    this.warning = this.add.text(cx, portrait ? 130 : 90, '', textStyle(16, COLORS.danger, {
      backgroundColor: '#1a0806', padding: { x: 8, y: 6 }, align: 'center', wordWrap: { width: width - 24 },
    })).setOrigin(0.5).setDepth(80).setVisible(false);

    this.pausePanel = new PausePanel(this, {
      resume: () => this.togglePause(),
      leave: () => this.run.abandon(),
    });

    const pauseButton = this.add.text(width - 28, 6, 'II', textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 5, y: 4 },
    })).setInteractive({ useHandCursor: true });
    pauseButton.on('pointerdown', () => this.togglePause());
    this.toast = this.add.text(cx, portrait ? 92 : 66, '', textStyle(8, '#9bff6e', {
      backgroundColor: '#08120b', padding: { x: 8, y: 6 }, align: 'center', wordWrap: { width: width - 24 },
    })).setOrigin(0.5).setDepth(85).setVisible(false);
    this.autopilot = null;
    if (this.run.autopilotOwned) {
      this.autopilot = this.add.text(width - 6, top + 6, '', textStyle(8, COLORS.dim, {
        backgroundColor: '#08120b', padding: { x: 5, y: 4 },
      })).setOrigin(1, 0).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.toggleAutopilot());
      this.showAutopilot();
      this.input.keyboard?.on('keydown-I', (event: KeyboardEvent) => {
        if (!event.repeat) this.toggleAutopilot();
      });
    }
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!over.length && this.scene.isActive('Run')) this.run.heroPress(pointer.x, pointer.y);
    });
    const onPause = (event: KeyboardEvent): void => {
      if (!event.repeat) this.togglePause();
    };
    this.input.keyboard?.on('keydown-P', onPause).on('keydown-ESC', onPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-I').off('keydown-P', onPause).off('keydown-ESC', onPause);
    });
    // Turning the phone rebuilds the HUD; a paused run stays paused.
    onLayoutChange(this, () => this.scene.restart());
    if (this.scene.isPaused('Run') && !this.scene.isActive('LevelUp') && !this.scene.isActive('Chest')) {
      this.pausePanel.show();
    }
    new VirtualJoystick(this, () => this.scene.isActive('Run'));
  }

  update(time: number): void {
    if (time < this.refreshAt) return;
    this.refreshAt = time + 100;
    const view = this.run.view;
    const hp = Math.max(0, Math.min(1, view.hp / view.maxHp));
    const xp = Math.max(0, Math.min(1, view.xp / view.nextXp));
    this.hpBar.clear().fillStyle(COLORS.barBack).fillRect(26, 5, this.barWidth, 6)
      .fillStyle(COLORS.hp).fillRect(26, 5, Math.round(this.barWidth * hp), 6);
    this.xpBar.clear().fillStyle(COLORS.barBack).fillRect(26, 16, this.barWidth, 6)
      .fillStyle(COLORS.xp).fillRect(26, 16, Math.round(this.barWidth * xp), 6);
    const minutes = Math.floor(view.seconds / 60).toString().padStart(2, '0');
    const seconds = (view.seconds % 60).toString().padStart(2, '0');
    this.timer.setText(`${minutes}:${seconds}`);
    this.level.setText(`${Math.ceil(view.hp)}/${Math.round(view.maxHp)}  УР.${view.level}`);
    this.stats.setText(`ВОЛНА ${view.wave}  УБИТО ${view.kills}${view.revives ? '  ♥' : ''}`);
    this.caps.setText(String(view.caps));
    this.emeralds.setText(String(view.emeralds));
    this.emeraldIcon.setVisible(view.emeralds > 0);
    this.emeralds.setVisible(view.emeralds > 0);
    this.toast.setText(view.toast).setVisible(Boolean(view.toast));
    this.buffBars.clear();
    while (this.buffIcons.length < view.buffs.length) {
      this.buffIcons.push(this.add.image(16 + this.buffIcons.length * 22, this.buffY, ATLAS, 'ui/cap'));
    }
    this.buffIcons.forEach((icon, index) => {
      const buff = view.buffs[index];
      icon.setVisible(Boolean(buff));
      if (!buff) return;
      icon.setFrame(buff.sprite);
      this.buffBars.fillStyle(COLORS.barBack).fillRect(8 + index * 22, this.buffY + 10, 16, 2)
        .fillStyle(COLORS.xp).fillRect(8 + index * 22, this.buffY + 10, Math.round(16 * buff.fraction), 2);
    });
    const { weapons, heavy, passives } = this.run.loadout();
    this.fillSlots(this.weaponSlots, weapons);
    this.fillSlots(this.heavySlots, heavy);
    this.fillSlots(this.passiveSlots, passives);
    this.updateTooltip();
    this.bossBar.clear();
    if (view.boss) {
      this.bossName.setText(view.boss.name.toUpperCase()).setVisible(true);
      const { x, y, width } = this.bossLine;
      this.bossBar.fillStyle(COLORS.barBack).fillRect(x, y, width, 6)
        .fillStyle(COLORS.hp).fillRect(x, y, Math.round(width * view.boss.fraction), 6)
        .lineStyle(1, COLORS.panelBorder).strokeRect(x - 0.5, y - 0.5, width + 1, 7);
    } else {
      this.bossName.setVisible(false);
    }
    this.warning.setText(view.warning).setVisible(Boolean(view.warning)
      && (view.warning === 'ПОБЕДА!' || Math.floor(time / 250) % 2 === 0));
    if (import.meta.env.DEV) {
      this.fps.setText(`FPS ${Math.round(this.game.loop.actualFps)} ВРАГОВ ${view.enemyCount} ПУЛЬ ${view.projectileCount} SEED ${view.seed}`);
    }
  }

  /** A row of empty slots at the bottom edge: weapons on the left, perks on the right. */
  private addSlots(count: number, left: number, y: number, open: number, border: number = COLORS.panelBorder): Slot[] {
    return Array.from({ length: count }, (_, index) => {
      const x = left + index * SLOT_SIZE + SLOT_SIZE / 2;
      this.add.rectangle(x, y, SLOT_SIZE - 2, SLOT_SIZE - 2, COLORS.panel, 0.6)
        .setStrokeStyle(1, border, 0.6);
      const locked = index >= open;
      const icon = this.add.image(x, y, ATLAS, locked ? 'ui/lock' : 'ui/cap')
        .setVisible(locked).setAlpha(locked ? 0.35 : 1);
      const level = this.add.text(x + 10, y + 10, '', textStyle(8, COLORS.bright, {
        stroke: '#08120b', strokeThickness: 3,
      })).setOrigin(1, 1);
      return { x, y, locked, item: undefined, icon, level };
    });
  }

  private fillSlots(slots: Slot[], items: LoadoutItem[]): void {
    slots.forEach((slot, index) => {
      const { icon, level } = slot;
      const item = items[index];
      slot.item = item;
      if (slot.locked) return;
      icon.setVisible(Boolean(item));
      level.setVisible(Boolean(item));
      if (!item) return;
      const maxed = item.level >= item.max;
      icon.setFrame(item.sprite);
      level.setText(maxed ? '*' : String(item.level)).setColor(maxed ? COLORS.warn : COLORS.bright);
    });
  }

  /** Mouse only: slots are not interactive, so a press on them still steers the hero. */
  private updateTooltip(): void {
    const pointer = this.input.activePointer;
    if (pointer.wasTouch || this.scene.isActive('LevelUp') || this.scene.isActive('Chest')) {
      this.tooltip.hide();
      return;
    }
    const over = (x: number, y: number): boolean =>
      Math.abs(pointer.x - x) <= SLOT_SIZE / 2 && Math.abs(pointer.y - y) <= SLOT_SIZE / 2;
    const slot = [...this.weaponSlots, ...this.heavySlots, ...this.passiveSlots]
      .find((candidate) => over(candidate.x, candidate.y));
    if (slot) {
      const heavy = this.heavySlots.includes(slot);
      const kind = this.passiveSlots.includes(slot) ? 'перка' : heavy ? 'тяжёлого оружия' : 'оружия';
      if (slot.item) this.tooltip.show(slot, slot.item.name, slot.item.details);
      else if (slot.locked) {
        this.tooltip.show(slot, 'Слот закрыт',
          ['Докупается за изумруды в убежище, вкладка «Улучшения».']);
      } else this.tooltip.show(slot, `Слот ${kind}`, ['Пусто. Выбирается при новом уровне.']);
      return;
    }
    const index = this.run.view.buffs.findIndex((_, position) => over(16 + position * 22, this.buffY));
    const buff = this.run.view.buffs[index];
    if (buff) this.tooltip.show({ x: 16 + index * 22, y: this.buffY + 4 }, buff.name, [buff.text]);
    else this.tooltip.hide();
  }

  get autopilotOn(): boolean {
    return this.run.autopilotOn;
  }

  private toggleAutopilot(): void {
    if (!this.scene.isActive('Run')) return;
    updateSettings({ autopilot: !settings().autopilot });
    playSfx('sfx/ui_click');
    void keepAwake(settings().autopilot);
    this.showAutopilot();
  }

  private showAutopilot(): void {
    const on = settings().autopilot;
    this.autopilot?.setText(`[I] ИИ ${on ? 'ВКЛ' : 'ВЫКЛ'}`).setColor(on ? '#9bff6e' : COLORS.dim);
  }

  togglePause(): void {
    if (this.scene.isActive('LevelUp') || this.scene.isActive('Chest')) return;
    playSfx('sfx/ui_click');
    if (this.scene.isPaused('Run')) {
      this.scene.resume('Run');
      this.pausePanel.hide();
    } else {
      this.pause();
    }
  }

  /** Pauses the run with the panel shown (back button, app sent to background). */
  pause(): void {
    if (this.scene.isActive('LevelUp') || this.scene.isActive('Chest')) return;
    if (!this.scene.isActive('Run')) return;
    this.run.notePause();
    this.scene.pause('Run');
    this.pausePanel.show();
  }
}
