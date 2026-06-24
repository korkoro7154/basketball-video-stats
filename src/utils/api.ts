import type { ExportData } from '../types';

export interface ServerGame {
  filename: string;
  title: string;
  date: string;
  opponent: string;
  mode: string;
  eventCount: number;
  playerCount: number;
  updatedAt: string;
  error?: boolean;
}

export async function fetchGames(): Promise<ServerGame[]> {
  return [];
}

export async function loadGame(_filename: string): Promise<ExportData> {
  throw new Error('オフラインモードではサーバーデータは利用できません。');
}

export async function saveGame(
  _data: ExportData,
  _filename?: string
): Promise<{ success: boolean; filename: string; message: string }> {
  throw new Error('オフラインモードではサーバーデータは利用できません。');
}

export async function deleteGame(_filename: string): Promise<{ success: boolean; message: string }> {
  throw new Error('オフラインモードではサーバーデータは利用できません。');
}
