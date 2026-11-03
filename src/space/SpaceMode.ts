// VR 空間モード（S1〜S5）。実装は次の段階。今はコンパイルを通す骨組み
import * as THREE from 'three';
import type { StoryCtx } from '../story/StoryMode';
import type { Fluid } from '../fluid/Fluid';

export class SpaceMode {
  constructor(private ctx: StoryCtx & { renderer: THREE.WebGLRenderer; fluid: Fluid }, private session: XRSession | null) {}
  async start(): Promise<'again' | 'exit'> {
    throw new Error('空間モードは未実装');
  }
}
