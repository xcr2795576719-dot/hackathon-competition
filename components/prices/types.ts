export type Model = { id: string; name: string; brand: string; variant: string; tier: number; launch_price?: number };
export type Price = { jd: number; captured_at: string; source: string };
export type Point = { date: string; price: number };
export type Sample = { model_id: string; price: number; grade: string; title?: string; captured_at?: string; link?: string };
