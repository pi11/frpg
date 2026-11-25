import { PointerSteering } from './systems/pointerSteering';

/** The HUD writes the touch stick and the mouse; Run reads them without coupling scene lifetimes. */
export const inputState = { x: 0, y: 0, mouse: new PointerSteering() };
