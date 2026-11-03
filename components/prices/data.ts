import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Model, Price, Point, Sample } from './types';

// Read the files on each request so data imports become visible without rebuilding.
async function readData<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), 'data', name), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
export async function readCatalog(): Promise<Model[]> { return readData<Model[]>('models.json', []); }
export async function readPrices() {
  const [current, history, used] = await Promise.all([
    readData<Record<string, Price>>('prices_current.json', {}),
    readData<Record<string, Point[]>>('prices_history.json', {}),
    readData<Sample[]>('used_samples.json', []),
  ]);
  return { current, history, used };
}
export const demoModel: Model = { id:'iphone-13-128g', brand:'Apple', name:'iPhone 13', variant:'128G', tier:1 };
export const demoHistory: Point[] = Array.from({length:30}, (_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,price:i===20?4880:Math.round((5200-i*200/29)/10)*10}));
export const demoSamples: Sample[] = ['99新','95新','9成新','8成新','大修'].flatMap((grade,i)=>[0,1,2].map((n)=>({model_id:demoModel.id,grade,price:4100-i*350+n*70})));
