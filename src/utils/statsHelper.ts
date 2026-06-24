import type { StatsEvent, Player, StatType, Quarter } from '../types';

// 秒を「分:秒」形式に変換する（例: 75秒 -> 01:15）
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const minStr = mins.toString().padStart(2, '0');
  const secStr = secs.toString().padStart(2, '0');
  return `${minStr}:${secStr}`;
}

// 各スタッツタイプの得点計算
export function getPoints(type: StatType): number {
  switch (type) {
    case '3P_MADE': return 3;
    case '2P_MADE': return 2;
    case 'FT_MADE': return 1;
    default: return 0;
  }
}

// スタッツタイプの日本語表記
export function getStatLabel(type: StatType): string {
  switch (type) {
    case '3P_MADE': return '3P成功';
    case '3P_MISS': return '3P失敗';
    case '2P_MADE': return '2P成功';
    case '2P_MISS': return '2P失敗';
    case 'FT_MADE': return 'FT成功';
    case 'FT_MISS': return 'FT失敗';
    case 'AST': return 'アシスト';
    case 'OREB': return 'オフェンスリバウンド';
    case 'DREB': return 'ディフェンスリバウンド';
    case 'STL': return 'スティール';
    case 'BLK': return 'ブロック';
    case 'TO': return 'ターンオーバー';
    case 'PF': return 'ファウル';
    case 'TIMEOUT': return 'タイムアウト';
    case 'SUB_IN': return '交代イン';
    case 'SUB_OUT': return '交代アウト';
    case 'PRACTICE_TAG': return '練習タグ';
    default: return '';
  }
}

// 各選手の出場秒数を計算するロジック
export function calculatePlayingTimes(
  events: StatsEvent[],
  startingPlayersMap: Record<Quarter, string[]>,
  players: Player[],
  quarterDurations: Record<Quarter, number>
): Record<string, number> {
  const playingTimes: Record<string, number> = {};
  
  // 初期値 0
  players.forEach(p => {
    playingTimes[p.id] = 0;
  });

  const quarters: Quarter[] = ['1Q', '2Q', '3Q', '4Q', 'OT'];

  quarters.forEach(q => {
    // このクオーターの自チームの交代イベントを時間順に取得
    const qEvents = events
      .filter(e => e.quarter === q && e.team === 'home' && (e.type === 'SUB_IN' || e.type === 'SUB_OUT'))
      .sort((a, b) => a.timestamp - b.timestamp);

    const onCourt = new Set<string>(startingPlayersMap[q] || []);
    let lastTime = 0;
    
    // クオーターの動画総時間。まだ読み込まれていない、または0なら、クオーター内の最後のイベント時刻を仮の終了時刻とする
    let qDuration = quarterDurations[q];
    if (qDuration <= 0) {
      const qAllEvents = events.filter(e => e.quarter === q);
      qDuration = qAllEvents.length > 0 ? Math.max(...qAllEvents.map(e => e.timestamp)) : 0;
    }

    qEvents.forEach(e => {
      const t = e.timestamp;
      const elapsed = Math.max(0, t - lastTime);

      // 現在コートに出ている選手全員に出場時間を加算
      onCourt.forEach(playerId => {
        if (playingTimes[playerId] !== undefined) {
          playingTimes[playerId] += elapsed;
        }
      });

      // 交代の適用
      if (e.playerId) {
        if (e.type === 'SUB_IN') {
          onCourt.add(e.playerId);
        } else if (e.type === 'SUB_OUT') {
          onCourt.delete(e.playerId);
        }
      }

      lastTime = t;
    });

    // クオーターの最後まで出場し続けた選手に加算
    if (qDuration > lastTime) {
      const elapsed = qDuration - lastTime;
      onCourt.forEach(playerId => {
        if (playingTimes[playerId] !== undefined) {
          playingTimes[playerId] += elapsed;
        }
      });
    }
  });

  return playingTimes;
}

// 各選手のスタッツ項目集計用インターフェース
export interface PlayerBoxScore {
  playerId: string;
  name: string;
  number: string;
  pts: number;      // 得点
  ast: number;      // アシスト
  oreb: number;     // オフェンスリバウンド
  dreb: number;     // ディフェンスリバウンド
  reb: number;      // 合計リバウンド
  stl: number;      // スティール
  blk: number;      // ブロック
  to: number;       // ターンオーバー
  pf: number;       // ファウル
  fgm: number;      // フィールドゴール成功数 (2P_MADE + 3P_MADE)
  fga: number;      // フィールドゴール試投数 (2P_MADE + 2P_MISS + 3P_MADE + 3P_MISS)
  fgPercent: number; // FG%
  tpm: number;      // 3P成功数 (3P_MADE)
  tpa: number;      // 3P試投数 (3P_MADE + 3P_MISS)
  tpPercent: number; // 3P%
  ftm: number;      // FT成功数 (FT_MADE)
  fta: number;      // FT試投数 (FT_MADE + FT_MISS)
  ftPercent: number; // FT%
  playingTime: number; // 出場秒数
  efgPercent: number; // eFG% (アドバンスド・スタッツ)
  tsPercent: number;  // TS% (アドバンスド・スタッツ)
  plusMinus: number;  // +/- (アドバンスド・スタッツ)
}

// ボックススコアの集計ロジック (引数にチームを指定できるようにし、自・他両チームに対応)
export function calculateBoxScore(
  events: StatsEvent[],
  players: Player[],
  team: 'home' | 'away',
  playingTimes: Record<string, number> = {}
): PlayerBoxScore[] {
  const teamPlayers = players.filter(p => p.team === team);
  const scoreMap = new Map<string, PlayerBoxScore>();
  
  teamPlayers.forEach(p => {
    scoreMap.set(p.id, {
      playerId: p.id,
      name: p.name,
      number: p.number,
      pts: 0, ast: 0, oreb: 0, dreb: 0, reb: 0, stl: 0, blk: 0, to: 0, pf: 0,
      fgm: 0, fga: 0, fgPercent: 0,
      tpm: 0, tpa: 0, tpPercent: 0,
      ftm: 0, fta: 0, ftPercent: 0,
      playingTime: playingTimes[p.id] || 0,
      efgPercent: 0,
      tsPercent: 0,
      plusMinus: 0
    });
  });

  // イベントを集計
  events.filter(e => e.team === team && e.playerId).forEach(e => {
    const stats = scoreMap.get(e.playerId!);
    if (!stats) return;

    switch (e.type) {
      case '3P_MADE':
        stats.pts += 3;
        stats.fgm += 1;
        stats.fga += 1;
        stats.tpm += 1;
        stats.tpa += 1;
        break;
      case '3P_MISS':
        stats.fga += 1;
        stats.tpa += 1;
        break;
      case '2P_MADE':
        stats.pts += 2;
        stats.fgm += 1;
        stats.fga += 1;
        break;
      case '2P_MISS':
        stats.fga += 1;
        break;
      case 'FT_MADE':
        stats.pts += 1;
        stats.ftm += 1;
        stats.fta += 1;
        break;
      case 'FT_MISS':
        stats.fta += 1;
        break;
      case 'AST':
        stats.ast += 1;
        break;
      case 'OREB':
        stats.oreb += 1;
        stats.reb += 1;
        break;
      case 'DREB':
        stats.dreb += 1;
        stats.reb += 1;
        break;
      case 'STL':
        stats.stl += 1;
        break;
      case 'BLK':
        stats.blk += 1;
        break;
      case 'TO':
        stats.to += 1;
        break;
      case 'PF':
        stats.pf += 1;
        break;
    }
  });

  // 成功率（％）およびアドバンスド・スタッツを計算
  const list = Array.from(scoreMap.values());
  list.forEach(s => {
    s.fgPercent = s.fga > 0 ? Math.round((s.fgm / s.fga) * 100) : 0;
    s.tpPercent = s.tpa > 0 ? Math.round((s.tpm / s.tpa) * 100) : 0;
    s.ftPercent = s.fta > 0 ? Math.round((s.ftm / s.fta) * 100) : 0;
    
    // eFG% = (FGM + 0.5 * 3PM) / FGA * 100
    s.efgPercent = s.fga > 0 ? ((s.fgm + 0.5 * s.tpm) / s.fga) * 100 : 0;
    
    // TS% = PTS / (2 * (FGA + 0.44 * FTA)) * 100
    const tsDenominator = 2 * (s.fga + 0.44 * s.fta);
    s.tsPercent = tsDenominator > 0 ? (s.pts / tsDenominator) * 100 : 0;
  });

  // 背番号順に並び替える
  return list.sort((a, b) => {
    const numA = parseInt(a.number) || 999;
    const numB = parseInt(b.number) || 999;
    return numA - numB;
  });
}

// チーム全体のスタッツ集計（自チームと相手チーム両方）
export interface TeamStats {
  pts: number;
  fgm: number; fga: number; fgPercent: number;
  tpm: number; tpa: number; tpPercent: number;
  ftm: number; fta: number; ftPercent: number;
  ast: number;
  oreb: number; dreb: number; reb: number;
  stl: number; blk: number; to: number; pf: number;
  timeout: number; // タイムアウト回数
  efgPercent: number;
  tsPercent: number;
}

export function calculateTeamStats(events: StatsEvent[], team: 'home' | 'away'): TeamStats {
  const stats: TeamStats = {
    pts: 0, fgm: 0, fga: 0, fgPercent: 0, tpm: 0, tpa: 0, tpPercent: 0,
    ftm: 0, fta: 0, ftPercent: 0, ast: 0, oreb: 0, dreb: 0, reb: 0, stl: 0, blk: 0, to: 0, pf: 0,
    timeout: 0, efgPercent: 0, tsPercent: 0
  };

  events.filter(e => e.team === team).forEach(e => {
    switch (e.type) {
      case '3P_MADE':
        stats.pts += 3;
        stats.fgm += 1;
        stats.fga += 1;
        stats.tpm += 1;
        stats.tpa += 1;
        break;
      case '3P_MISS':
        stats.fga += 1;
        stats.tpa += 1;
        break;
      case '2P_MADE':
        stats.pts += 2;
        stats.fgm += 1;
        stats.fga += 1;
        break;
      case '2P_MISS':
        stats.fga += 1;
        break;
      case 'FT_MADE':
        stats.pts += 1;
        stats.ftm += 1;
        stats.fta += 1;
        break;
      case 'FT_MISS':
        stats.fta += 1;
        break;
      case 'AST':
        stats.ast += 1;
        break;
      case 'OREB':
        stats.oreb += 1;
        stats.reb += 1;
        break;
      case 'DREB':
        stats.dreb += 1;
        stats.reb += 1;
        break;
      case 'STL':
        stats.stl += 1;
        break;
      case 'BLK':
        stats.blk += 1;
        break;
      case 'TO':
        stats.to += 1;
        break;
      case 'PF':
        stats.pf += 1;
        break;
      case 'TIMEOUT':
        stats.timeout += 1;
        break;
    }
  });

  stats.fgPercent = stats.fga > 0 ? Math.round((stats.fgm / stats.fga) * 100) : 0;
  stats.tpPercent = stats.tpa > 0 ? Math.round((stats.tpm / stats.tpa) * 100) : 0;
  stats.ftPercent = stats.fta > 0 ? Math.round((stats.ftm / stats.fta) * 100) : 0;

  stats.efgPercent = stats.fga > 0 ? ((stats.fgm + 0.5 * stats.tpm) / stats.fga) * 100 : 0;
  const tsDenominator = 2 * (stats.fga + 0.44 * stats.fta);
  stats.tsPercent = tsDenominator > 0 ? (stats.pts / tsDenominator) * 100 : 0;

  return stats;
}

// CSVエクスポート用の文字列作成 (クオーターと練習タグに対応)
export function generateCSV(events: StatsEvent[], players: Player[]): string {
  const headers = ['クオーター', '動画時間', 'ゲーム残り時間', 'チーム', '背番号', '選手名', 'スタッツ内容', '練習タグ', 'メモ'];
  const playerMap = new Map<string, Player>(players.map(p => [p.id, p]));

  const rows = events.map(e => {
    const timestampStr = formatTime(e.timestamp);
    const gameTimeStr = e.gameTime !== undefined ? formatTime(e.gameTime) : '';
    const teamStr = e.team === 'home' ? '自チーム' : '相手チーム';
    let playerNum = '';
    let playerName = 'チーム全体';

    const p = e.playerId ? playerMap.get(e.playerId) : null;
    if (p) {
      playerNum = `#${p.number}`;
      playerName = p.name;
    } else if (e.team === 'away' && !e.playerId) {
      playerName = '相手チーム全体';
    }

    const statName = getStatLabel(e.type);
    const practiceTagName = e.practiceTag || '';
    const notes = e.notes || '';

    return [
      `"${e.quarter}"`,
      `"${timestampStr}"`,
      `"${gameTimeStr}"`,
      `"${teamStr}"`,
      `"${playerNum}"`,
      `"${playerName}"`,
      `"${statName}"`,
      `"${practiceTagName.replace(/"/g, '""')}"`,
      `"${notes.replace(/"/g, '""')}"`
    ];
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ボックススコアCSVエクスポート用の文字列作成 (自チーム/相手チームをまとめたもの)
export function generateFullBoxScoreCSV(
  homeStats: PlayerBoxScore[],
  homeTeamStats: TeamStats,
  awayStats: PlayerBoxScore[],
  awayTeamStats: TeamStats,
  scoutingMode: boolean,
  homePlusMinusTotal: number
): string {
  const headers = [
    '背番号', '選手名', '出場時間', '得点', 'eFG%', 'TS%', '+/-', 
    'アシスト', '合計リバウンド', 'オフェンスリバウンド', 'ディフェンスリバウンド', 
    'スティール', 'ブロック', 'ターンオーバー', 'ファウル', 
    'FG成功', 'FG試投', 'FG%', '3P成功', '3P試投', '3P%', 'FT成功', 'FT試投', 'FT%'
  ];

  const formatRow = (s: PlayerBoxScore, isHome: boolean) => {
    const minStr = formatTime(s.playingTime);
    const efgStr = s.fga > 0 ? `${s.efgPercent.toFixed(1)}%` : '-';
    const tsStr = (s.fga + s.fta) > 0 ? `${s.tsPercent.toFixed(1)}%` : '-';
    const pmStr = isHome ? (s.plusMinus > 0 ? `+${s.plusMinus}` : `${s.plusMinus}`) : '-';
    
    return [
      `"#${s.number}"`,
      `"${s.name}"`,
      isHome ? `"${minStr}"` : '"-"',
      s.pts,
      `"${efgStr}"`,
      `"${tsStr}"`,
      `"${pmStr}"`,
      s.ast,
      s.reb,
      s.oreb,
      s.dreb,
      s.stl,
      s.blk,
      s.to,
      s.pf,
      s.fgm,
      s.fga,
      `"${s.fgPercent}%"`,
      s.tpm,
      s.tpa,
      `"${s.tpPercent}%"`,
      s.ftm,
      s.fta,
      `"${s.ftPercent}%"`
    ].join(',');
  };

  const formatTotalRow = (t: TeamStats, label: string, isHome: boolean) => {
    const efgStr = t.fga > 0 ? `${t.efgPercent.toFixed(1)}%` : '-';
    const tsStr = (t.fga + t.fta) > 0 ? `${t.tsPercent.toFixed(1)}%` : '-';
    const pmStr = isHome ? (homePlusMinusTotal > 0 ? `+${homePlusMinusTotal}` : `${homePlusMinusTotal}`) : '-';

    return [
      '"-"',
      `"${label} 合計"`,
      '"-"',
      t.pts,
      `"${efgStr}"`,
      `"${tsStr}"`,
      `"${pmStr}"`,
      t.ast,
      t.reb,
      t.oreb,
      t.dreb,
      t.stl,
      t.blk,
      t.to,
      t.pf,
      t.fgm,
      t.fga,
      `"${t.fgPercent}%"`,
      t.tpm,
      t.tpa,
      `"${t.tpPercent}%"`,
      t.ftm,
      t.fta,
      `"${t.ftPercent}%"`
    ].join(',');
  };

  const homeLines = [
    '自チーム個人成績',
    headers.join(','),
    ...homeStats.map(s => formatRow(s, true)),
    formatTotalRow(homeTeamStats, '自チーム', true)
  ];

  const awayLines = [
    '相手チーム成績',
    headers.join(','),
    ...(scoutingMode ? awayStats.map(s => formatRow(s, false)) : []),
    formatTotalRow(awayTeamStats, '相手チーム', false)
  ];

  return [...homeLines, '', '', ...awayLines].join('\n');
}
