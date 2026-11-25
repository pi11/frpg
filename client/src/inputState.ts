import { PointerSteering } from './systems/pointerSteering';

/** The HUD writes the touch stick and the mouse; Run reads them without coupling scene lifetimes. */
/** Knocks on the shelter door in a row, carried into the next run. */
export const shelterState = { knocks: 0 };

export const inputState = { x: 0, y: 0, mouse: new PointerSteering() };
