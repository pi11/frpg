import * as Phaser from 'phaser';
import { finishRun, type RunSummary } from '../api/game';
import { ATLAS } from '../assets';
import { getCatalog } from '../content/catalog';
import { runReward } from '../economy';
import { playSfx, stopMusic } from '../sound';
import { damageRows, evolutionHint, nextGoal, recordLines, type RunBuild } from '../systems/runReport';
import { layoutOf, onLayoutChange } from '../ui/layout';
import { COLORS, textStyle } from '../ui/theme';

export interface ResultData {
  reason: 'death' | 'survived' | 'quit';
  seconds: number;
  kills: number;
  level: number;
  seed: number;
  runId: string;
  bossKilled: boolean;
  locationId: string;
  /** Extra share of earned caps from one-run boosts (the server applies the same). */
  rewardBonus?: number;
  /** HP taken from enemies per weapon id ('' = everything else); shown only, never sent. */
  damage?: [string, number][];
  build?: RunBuild;
  /** A contract run: its name and whether the objective fell here (the server checks it again). */
  contract?: { id: string; name: string; done: boolean };
  summary: RunSummary;
}

const ROW_HEIGHT = 18;
const ICON_STEP = 23;
const REWARD_LINES = 5;

export class ResultScene extends Phaser.Scene {
  private result!: ResultData;
  private rewardLabel!: Phaser.GameObjects.Text;
  private actionLabel!: Phaser.GameObjects.Text;
  private leaveLabel!: Phaser.GameObjects.Text;
  private recordLabel!: Phaser.GameObjects.Text;
  private goalLabel!: Phaser.GameObjects.Text;
  private settled = false;
  private sending = false;

  constructor() {
    super('Result');
  }

  init(data: ResultData): void {
    this.result = data;
    this.settled = false;
    this.sending = false;
  }

  create(): void {
    stopMusic();
    this.cameras.main.setBackgroundColor('#08120b');
    const { cx, cy, width, height, portrait } = layoutOf(this);
    this.add.rectangle(cx, cy, width - 16, height - 16, COLORS.panel, 1).setStrokeStyle(1, COLORS.panelBorder);
    // Landscape: the run and the reward on the left, the build on the right. Portrait: one column.
    const left = portrait ? cx : 124;
    const column = portrait ? width - 36 : 204;
    const contract = this.result.contract;
    const title = contract ? (contract.done ? 'ЦЕЛЬ ВЗЯТА!' : 'ЦЕЛЬ УПУЩЕНА')
      : this.result.bossKilled ? 'ПОБЕДА!' : { death: 'ЗАБЕГ ОКОНЧЕН', survived: 'ВЫЖИЛ!', quit: 'ВОЗВРАЩЕНИЕ' }[this.result.reason];
    const failed = contract ? !contract.done : this.result.reason === 'death';
    this.add.text(left, portrait ? 30 : 32, title, textStyle(16, failed ? COLORS.danger : COLORS.bright)).setOrigin(0.5);
    const minutes = Math.floor(this.result.seconds / 60).toString().padStart(2, '0');
    const seconds = (this.result.seconds % 60).toString().padStart(2, '0');
    const stats = this.add.text(left, portrait ? 48 : 52,
      `ВРЕМЯ ${minutes}:${seconds}   УР.${this.result.level}\nУБИТО ${this.result.kills}   КРЫШЕК ${this.result.summary.picked_caps}`,
      textStyle(8, COLORS.text, { align: 'center' })).setOrigin(0.5, 0);
    const seed = this.add.text(left, stats.y + stats.height + 4, `SEED ${this.result.seed}`, textStyle(8, COLORS.dim))
      .setOrigin(0.5, 0);
    this.recordLabel = this.add.text(left, seed.y + 16, '',
      textStyle(8, COLORS.warn, { align: 'center', wordWrap: { width: column } })).setOrigin(0.5, 0);

    let y = portrait ? this.recordLabel.y + 30 : 24;
    const x0 = portrait ? 18 : 254;
    const span = portrait ? width - 36 : 210;
    if (!portrait) this.add.rectangle(246, cy, 1, height - 40, COLORS.panelBorder, 0.5);
    y = this.drawDamage(x0, y, span);
    y = this.drawBuild(x0, y, span);
    this.goalLabel = this.add.text(x0, y + 4, '', textStyle(8, COLORS.bright, { wordWrap: { width: span } }));

    const rewardY = portrait ? height - 150 : 124;
    this.add.image(left, rewardY, ATLAS, 'ui/cap').setScale(2);
    this.rewardLabel = this.add.text(left, rewardY + 16, '', textStyle(8, COLORS.bright, {
      align: 'center', wordWrap: { width: column }, maxLines: REWARD_LINES,
    })).setOrigin(0.5, 0);
    this.actionLabel = this.add.text(left, height - (portrait ? 56 : 44), '', textStyle(8, COLORS.bright, {
      backgroundColor: '#1d3322', padding: { x: 12, y: 7 },
    })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.actionLabel.on('pointerdown', () => this.onAction());
    this.input.keyboard?.on('keydown-SPACE', () => this.onAction());
    this.leaveLabel = this.add.text(left, height - (portrait ? 28 : 20), 'ВЕРНУТЬСЯ БЕЗ НАГРАДЫ', textStyle(8, COLORS.dim))
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.sending) this.scene.start('Hub'); });
    onLayoutChange(this, () => this.scene.restart(this.result));
    void this.settle();
  }

  /** Top three weapons by damage really dealt, with bars; nothing when no enemy was hit. */
  private drawDamage(x: number, y: number, span: number): number {
    const rows = damageRows(this.result.damage ?? [], getCatalog());
    if (!rows.length) return y;
    this.add.text(x, y, 'УРОН', textStyle(8, COLORS.dim));
    y += 14;
    for (const row of rows) {
      if (row.sprite) this.add.image(x + 8, y + 4, ATLAS, row.sprite);
      const percent = `${Math.round(row.share * 100)}%`;
      this.add.text(x + span, y - 2, percent, textStyle(8, COLORS.bright)).setOrigin(1, 0);
      this.add.text(x + 20, y - 2, this.fit(row.name, span - 20 - percent.length * 8 - 8),
        textStyle(8, row.id ? COLORS.text : COLORS.dim));
      this.add.rectangle(x + 20, y + 10, span - 20, 3, COLORS.barBack).setOrigin(0, 0.5);
      this.add.rectangle(x + 20, y + 10, Math.max(1, (span - 20) * row.share), 3, row.id ? COLORS.xp : 0x5f9a63)
        .setOrigin(0, 0.5);
      y += ROW_HEIGHT;
    }
    return y + 2;
  }

  /** Icons of the weapons and perks held at the end with levels, the evolution by name, and a near miss. */
  private drawBuild(x: number, y: number, span: number): number {
    const build = this.result.build;
    if (!build || (!build.weapons.length && !build.passives.length)) return y;
    const { weapons, passives } = getCatalog();
    this.add.text(x, y, 'СБОРКА', textStyle(8, COLORS.dim));
    y += 18;
    // Weapons, a gap, then perks, in one flow that wraps.
    const perRow = Math.max(1, Math.floor(span / ICON_STEP));
    const items = [
      ...build.weapons.map(([id, level]) => ({ sprite: weapons[id]?.sprite, level,
        max: weapons[id]?.levels.length ?? 1, gold: Boolean(weapons[id]?.evolved) })),
      ...(build.weapons.length && build.passives.length ? [null] : []),
      ...build.passives.map(([id, level]) => ({ sprite: passives[id]?.sprite, level,
        max: passives[id]?.maxLevel ?? 1, gold: false })),
    ];
    items.forEach((item, index) => {
      if (!item) return;
      const ix = x + 8 + (index % perRow) * ICON_STEP;
      const iy = y + Math.floor(index / perRow) * ICON_STEP;
      if (item.sprite) this.add.image(ix, iy, ATLAS, item.sprite);
      const maxed = item.level >= item.max;
      this.add.text(ix + 10, iy + 9, maxed ? '*' : String(item.level),
        textStyle(8, item.gold || maxed ? COLORS.warn : COLORS.dim, { stroke: '#08120b', strokeThickness: 3 }))
        .setOrigin(1, 1);
    });
    y += Math.ceil(items.length / perRow) * ICON_STEP;
    const evolved = build.weapons.map(([id]) => weapons[id]).filter((weapon) => weapon?.evolved);
    const lines = [
      ...(evolved.length ? [{ text: `Эволюция: ${evolved.map((weapon) => weapon!.name).join(', ')}`, color: COLORS.warn }] : []),
      ...[evolutionHint(build, getCatalog())].filter((text): text is string => Boolean(text))
        .map((text) => ({ text, color: COLORS.dim })),
    ];
    y -= 6;
    for (const line of lines) {
      const label = this.add.text(x, y, line.text, textStyle(8, line.color, { wordWrap: { width: span } }));
      y += label.height + 4;
    }
    return y + 2;
  }

  /** Cuts a name with … so it never runs into the percent. */
  private fit(text: string, pixels: number): string {
    const chars = Math.max(3, Math.floor(pixels / 8));
    return text.length <= chars ? text : `${text.slice(0, chars - 1)}…`;
  }

  private onAction(): void {
    playSfx('sfx/ui_click');
    if (this.settled) this.scene.start('Hub');
    else void this.settle();
  }

  private async settle(): Promise<void> {
    if (this.sending || this.settled) return;
    this.sending = true;
    const summary = this.result.summary;
    const catalog = getCatalog();
    const { cx, portrait } = layoutOf(this);
    const estimate = runReward(catalog.balance.reward, {
      duration: summary.duration_seconds,
      kills: Object.values(summary.kills_by_type).reduce((sum, value) => sum + value, 0),
      wave: summary.wave_reached, bossKilled: summary.boss_killed, pickedCaps: summary.picked_caps,
      multiplier: (catalog.locations[this.result.locationId]?.rewardMultiplier ?? 1) * (1 + (this.result.rewardBonus ?? 0)),
    });
    this.rewardLabel.setText(`Сервер считает награду… (≈ ${estimate} крышек)`);
    this.actionLabel.setText('ПОДОЖДИТЕ…');
    try {
      const response = await finishRun(this.result.runId, summary);
      if (!this.scene.isActive()) return;
      this.settled = true;
      this.leaveLabel.setVisible(false);
      const earned = response.achievements;
      const note = response.flags.length
        ? '\nСервер скорректировал сводку забега, награда урезана.' : '';
      this.rewardLabel.setText(
        `Награда: +${response.reward_caps} крышек${
          response.reward_emeralds ? `, +${response.reward_emeralds} изумрудов` : ''
        }\nВсего: ${response.profile.caps} крышек, ${response.profile.emeralds} изумрудов${note}${
          earned.length ? `\nДостижений: ${earned.length}, награда в убежище` : ''}`,
      );
      this.recordLabel.setText(response.contract
        ? `${this.result.contract?.name ?? 'Контракт'}: ${response.contract.done
          ? `цель выполнена, +${response.contract.bonus_caps} крышек` : 'цель не выполнена, бонуса нет'}`
        : recordLines(response.record).join('\n'));
      const goal = nextGoal(response.profile, catalog);
      this.goalLabel.setText(goal ? `ДАЛЬШЕ: ${goal}` : '');
      this.actionLabel.setText('В УБЕЖИЩЕ');
      playSfx('sfx/reward');
      if (response.reward_emeralds) this.burst(portrait ? cx : 124, this.rewardLabel.y - 18, Math.min(10, response.reward_emeralds));
      this.showAchievements(response.achievements);
    } catch (error) {
      if (!this.scene.isActive()) return;
      const message = error instanceof Error ? error.message : 'Не удалось связаться с сервером.';
      this.rewardLabel.setText(`Награда не получена: ${message}`);
      this.actionLabel.setText('ПОВТОРИТЬ');
      playSfx('sfx/ui_error');
    } finally {
      this.sending = false;
    }
  }

  /** Each new achievement slides up at the bottom edge in turn (the leave link is gone by then), with a flash and a spray of emeralds. */
  private showAchievements(ids: readonly string[]): void {
    const { achievements } = getCatalog();
    const { cx, width, height } = layoutOf(this);
    const cardWidth = Math.min(width - 24, 300);
    ids.forEach((id, index) => {
      const item = achievements[id];
      const delay = 500 + index * 1900;
      const y = height - 20;
      const away = height + 40;
      const card = this.add.container(cx, away).setDepth(10);
      const ray = this.add.image(0, 0, ATLAS, 'fx/ray').setScale(1.6).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      const box = this.add.rectangle(0, 0, cardWidth, 34, 0x1d2a12, 0.96).setStrokeStyle(2, 0xffd84a);
      const icon = this.add.image(-cardWidth / 2 + 20, 0, ATLAS, 'ui/emerald').setScale(2);
      const head = this.add.text(-cardWidth / 2 + 38, -12, 'ДОСТИЖЕНИЕ!', textStyle(8, COLORS.warn));
      const name = this.add.text(-cardWidth / 2 + 38, 0, item?.name ?? id, textStyle(8, COLORS.bright, {
        wordWrap: { width: cardWidth - 92 } }));
      const prize = this.add.text(cardWidth / 2 - 22, 0, item ? `+${item.emeralds}` : '', textStyle(8, COLORS.bright))
        .setOrigin(1, 0.5);
      const gem = this.add.image(cardWidth / 2 - 13, 0, ATLAS, 'ui/emerald').setVisible(Boolean(item));
      const shine = this.add.rectangle(-cardWidth / 2, 0, 10, 32, 0xffffff, 0.35).setAngle(18)
        .setBlendMode(Phaser.BlendModes.ADD);
      card.add([ray, box, icon, head, name, prize, gem, shine]);
      this.tweens.chain({ targets: card, tweens: [
        { y, delay, duration: 380, ease: 'Back.easeOut', onStart: () => playSfx('sfx/emerald') },
        { scale: 1.06, duration: 120, yoyo: true, onComplete: () => this.burst(cx - cardWidth / 2 + 20, y, 8) },
        { y, duration: 1100 },
        { y: away, alpha: 0, duration: 260, ease: 'Quad.easeIn', onComplete: () => card.destroy() },
      ] });
      this.tweens.add({ targets: ray, alpha: { from: 0, to: 0.7 }, angle: 90, delay: delay + 300,
        duration: 700, yoyo: true });
      this.tweens.add({ targets: shine, x: cardWidth / 2, delay: delay + 380, duration: 520, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: icon, angle: { from: -12, to: 12 }, delay, duration: 160, yoyo: true, repeat: 3 });
    });
  }

  /** A spray of emeralds that fall and fade. */
  private burst(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (index / Math.max(1, count - 1) - 0.5) * 2.4;
      const speed = 34 + (index % 3) * 14;
      const gem = this.add.image(x, y, ATLAS, 'ui/emerald').setDepth(11).setScale(1.4);
      this.tweens.add({
        targets: gem, x: x + Math.cos(angle) * speed, y: y + Math.sin(angle) * speed + 26,
        angle: (index % 2 ? 1 : -1) * 180, alpha: 0, scale: 0.6, duration: 700 + index * 25, ease: 'Quad.easeOut',
        onComplete: () => gem.destroy(),
      });
    }
  }
}
