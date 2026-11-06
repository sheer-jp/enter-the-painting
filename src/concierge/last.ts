// 直前のおすすめ（sessionStorage）。受付が書き、受付の ?retry=<id> で読む。作品ページは鍵を共有するだけ（中身は読まない）
export const LAST_REC_KEY = 'etp.lastRec';
export interface LastRec { recommend: string; alt: string | null; reason: { ja: string; en: string } | null; matched_moods: string[] }
