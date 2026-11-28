import './page';
import { getCatalog } from '../content/catalog';
import { orderedLocations } from '../content/locations';
import type { HeroDefinition, ItemUnlock } from '../content/schemas';
import { statBonus } from '../content/statText';

/** Heroes, weapons, perks, boosts and locations come straight from content/, so help never lags behind. */

interface AtlasFrame { frame: { x: number; y: number; w: number; h: number } }
interface Atlas { frames: Record<string, AtlasFrame>; meta: { size: { w: number; h: number } } }

const ATLAS_URL = '/assets/atlas/sprites';
const ICON_SCALE = 2;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A sprite cut out of the atlas with CSS, enlarged without blur. */
function icon(atlas: Atlas | null, key: string): string {
  const item = atlas?.frames[key];
  if (!atlas || !item) return '';
  const { x, y, w, h } = item.frame;
  const { w: width, h: height } = atlas.meta.size;
  return `<span class="help-icon" style="width:${w * ICON_SCALE}px;height:${h * ICON_SCALE}px;`
    + `background-size:${width * ICON_SCALE}px ${height * ICON_SCALE}px;`
    + `background-position:-${x * ICON_SCALE}px -${y * ICON_SCALE}px"></span>`;
}

function unlockText(unlock: ItemUnlock | HeroDefinition['unlock']): string {
  const { locations } = getCatalog();
  switch (unlock.type) {
    case 'default': return 'доступно сразу';
    case 'emeralds': return `за ${unlock.emeralds} изумрудов (вкладка «За изумруды»)`;
    case 'runs': return `после ${unlock.count} забегов`;
    case 'achievements': return `после ${unlock.count} достижений`;
    case 'bossKilled': return `после победы над боссом: ${locations[unlock.location]?.name ?? unlock.location}`;
    case 'milestone': return `продержаться ${clock(unlock.atSecond)}: ${locations[unlock.location]?.name ?? unlock.location}`;
  }
}

function card(picture: string, title: string, lines: string[]): string {
  return `<li class="help-card">${picture}<div><strong>${escapeHtml(title)}</strong>${
    lines.map((line) => `<small>${escapeHtml(line)}</small>`).join('')}</div></li>`;
}

function render(atlas: Atlas | null): void {
  const catalog = getCatalog();
  const { weapons, passives, heroes, boosts } = catalog;
  const set = (id: string, html: string): void => { document.getElementById(id)!.innerHTML = html; };

  set('help-heroes', Object.values(heroes).map((hero) => card(icon(atlas, hero.sprite), hero.name, [
    hero.description,
    `Начинает с: ${weapons[hero.startingWeapon]?.name ?? hero.startingWeapon}`,
    `Как открыть: ${unlockText(hero.unlock)}`,
  ])).join(''));

  const guns = Object.values(weapons);
  const evolutionLines = (id: string): string[] => weapons[id]!.evolutions.map(({ passive, into }) =>
    `Эволюция: + перк «${passives[passive]?.name ?? passive}» → ${weapons[into]?.name ?? into}`);
  set('help-weapons', guns.filter((weapon) => !weapon.heavy && !weapon.evolved).map((weapon) =>
    card(icon(atlas, weapon.sprite), weapon.name, [
      weapon.description, `Как открыть: ${unlockText(weapon.unlock)}`, ...evolutionLines(weapon.id),
    ])).join(''));
  set('help-heavy', guns.filter((weapon) => weapon.heavy).map((weapon) =>
    card(icon(atlas, weapon.sprite), weapon.name, [
      weapon.description, `Как открыть: ${unlockText(weapon.unlock)}`,
      `В карточках с ${weapon.minHeroLevel} уровня героя; нужен слот тяжёлого оружия (улучшение «Лафет»)`,
    ])).join(''));
  set('help-evolutions', guns.filter((weapon) => weapon.evolved).map((weapon) => {
    const from = guns.find((base) => base.evolutions.some((path) => path.into === weapon.id));
    const path = from?.evolutions.find((item) => item.into === weapon.id);
    return card(icon(atlas, weapon.sprite), weapon.name, [
      weapon.description,
      from && path ? `${from.name} последнего уровня + перк «${passives[path.passive]?.name ?? path.passive}»` : '',
    ].filter(Boolean));
  }).join(''));

  set('help-perks', Object.values(passives).map((perk) => card(icon(atlas, perk.sprite), perk.name, [
    perk.description,
    `${statBonus(perk.stat, perk.perLevel, perk.mod)} за уровень, уровней: ${perk.maxLevel}`,
    `Как открыть: ${unlockText(perk.unlock)}`,
  ])).join(''));

  set('help-boosts', Object.values(boosts).sort((a, b) => a.emeralds - b.emeralds).map((boost) =>
    card(icon(atlas, boost.sprite), `${boost.name} · ${boost.emeralds} изумр.`, [
      boost.description,
      [...boost.effects.map((effect) => statBonus(effect.stat, effect.value, effect.mod)),
        ...(boost.rewardBonus ? [`+${Math.round(boost.rewardBonus * 100)}% к награде крышками`] : [])].join(', '),
    ])).join(''));

  set('help-locations', orderedLocations(catalog).map((location) => {
    const boss = catalog.enemies[location.boss.enemy];
    return card('', location.name, [
      location.description,
      `Награда ×${location.rewardMultiplier} · босс в ${clock(location.boss.atSecond)}: ${boss?.name ?? ''}`,
      `Как открыть: ${location.unlock.type === 'default' ? 'доступна сразу' : unlockText(location.unlock)}`,
    ]);
  }).join(''));
}

async function loadAtlas(): Promise<Atlas | null> {
  try {
    const response = await fetch(`${ATLAS_URL}.json`);
    return response.ok ? await response.json() as Atlas : null;
  } catch {
    return null;
  }
}

render(null);
void loadAtlas().then((atlas) => { if (atlas) render(atlas); });
