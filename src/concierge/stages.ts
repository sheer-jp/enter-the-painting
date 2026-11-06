// おすすめを別の画面（C2）で見せる 3 段（docs/ENTRANCE.md 3.5）。DOM を持たない純関数
// talk（会話）→ read（読ませる）→ thinking（考えている）→ sink（会話画面が沈む）→ present（C2）
// present から「会話に戻る」で back（会話は残る）。back から「おすすめをもう一度見る」で present。「もう一度、話す」でどこからでも talk
export type Stage = 'talk' | 'read' | 'thinking' | 'sink' | 'present' | 'back';
export type StageEvent = 'recommend' | 'tick' | 'close' | 'reopen' | 'again';

export const STAGE_MS = { read: 1600, thinking: 1400, thinkingRules: 1000, sink: 500 } as const;
export const FAST_MS = 100;   // テスト用（window.__ETP_FAST）：各段を 100ms に

// その段に留まる時間（ms）。時間で進まない段は 0
export function stageMs(stage: Stage, o: { rules: boolean; fast?: boolean }): number {
  const ms = stage === 'read' ? STAGE_MS.read
    : stage === 'thinking' ? (o.rules ? STAGE_MS.thinkingRules : STAGE_MS.thinking)
    : stage === 'sink' ? STAGE_MS.sink : 0;
  return ms && o.fast ? FAST_MS : ms;
}

// 遷移。決まっていない組み合わせは今の段のまま
export function nextStage(stage: Stage, ev: StageEvent): Stage {
  if (ev === 'again') return 'talk';
  if (ev === 'recommend' && (stage === 'talk' || stage === 'back')) return 'read';
  if (ev === 'tick') return stage === 'read' ? 'thinking' : stage === 'thinking' ? 'sink' : stage === 'sink' ? 'present' : stage;
  if (ev === 'close' && stage === 'present') return 'back';
  if (ev === 'reopen' && stage === 'back') return 'present';
  return stage;
}

// おすすめが決まってから C2 が立ち上がるまでの予定（各段の始まりの時刻）
export function presentSchedule(o: { rules: boolean; fast?: boolean }): { stage: Stage; at: number }[] {
  const out: { stage: Stage; at: number }[] = [];
  let s = nextStage('talk', 'recommend'), at = 0;
  while (s !== 'present') { out.push({ stage: s, at }); at += stageMs(s, o); s = nextStage(s, 'tick'); }
  out.push({ stage: s, at });
  return out;
}
