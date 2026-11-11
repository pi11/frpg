import type * as Phaser from 'phaser';
import { z } from 'zod';
import type { EnemyDefinition } from '../../content/schemas';

export const ChaserParamsSchema = z.object({ turnRate: z.number().positive() }).strict();

export class ChaserEnemyBehavior {
  readonly paramsSchema = ChaserParamsSchema;

  update(enemy: Phaser.Physics.Arcade.Sprite, hero: Phaser.Physics.Arcade.Sprite,
    definition: EnemyDefinition, deltaMs: number): void {
    const dx = hero.x - enemy.x;
    const dy = hero.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const params = definition.ai.params as z.infer<typeof ChaserParamsSchema>;
    const turn = Math.min(1, (deltaMs / 1000) * params.turnRate);
    const velocity = (enemy.body as Phaser.Physics.Arcade.Body).velocity;
    const desiredX = (dx / distance) * definition.stats.speed;
    const desiredY = (dy / distance) * definition.stats.speed;
    enemy.setVelocity(
      velocity.x + (desiredX - velocity.x) * turn,
      velocity.y + (desiredY - velocity.y) * turn,
    );
  }
}
