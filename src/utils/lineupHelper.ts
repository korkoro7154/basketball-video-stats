import type { StatsEvent, Player, Quarter } from '../types';

export interface LineupStats {
  playerIds: string[]; // ソートされた選手ID (自チームのみ)
  duration: number; // 出場時間（秒）
  ptsFor: number; // オンコート中の自チーム得点
  ptsAgainst: number; // オンコート中の相手チーム得点
  plusMinus: number; // 得失点差
  ppm: number; // 1分あたりの得失点差 (+/- per minute)
  segments: {
    quarter: Quarter;
    start: number; // 開始秒数
    end: number; // 終了秒数
  }[];
}

export interface DuoChemistry {
  partnerId: string;
  partnerName: string;
  partnerNumber: string;
  duration: number; // 同時出場時間（秒）
  ptsFor: number;
  ptsAgainst: number;
  plusMinus: number;
  ppm: number;
}

/**
 * 交代イベントとクオーター別のスタート5から、オンコート5人のタイムラインセグメントを構築し、
 * 各ラインナップのスタッツを集計します。
 */
export const calculateLineupStats = (
  events: StatsEvent[],
  players: Player[],
  startingPlayers: Record<Quarter, string[]>,
  quarterDurations: Record<Quarter, number>,
  appMode: 'game' | 'practice' | 'live',
  livePeriodLength: number
): LineupStats[] => {
  const lineupMap = new Map<string, LineupStats>();

  const getQuarterLength = (q: Quarter) => {
    if (appMode === 'live') {
      return livePeriodLength;
    }
    // 試合・練習モードの場合、設定されたクオーター時間か、イベントの最大タイムスタンプの大きい方
    const qEvents = events.filter(e => e.quarter === q);
    const maxEventTime = qEvents.length > 0 ? Math.max(...qEvents.map(e => e.timestamp)) : 0;
    return Math.max(quarterDurations[q] || 0, maxEventTime);
  };

  const quarters: Quarter[] = ['1Q', '2Q', '3Q', '4Q', 'OT'];
  const homePlayerIdsSet = new Set(players.filter(p => p.team === 'home').map(p => p.id));

  quarters.forEach(q => {
    const qLength = getQuarterLength(q);
    const qEvents = events.filter(e => e.quarter === q).sort((a, b) => a.timestamp - b.timestamp);
    const starters = (startingPlayers[q] || []).filter(id => homePlayerIdsSet.has(id));

    // 交代イベントのタイムスタンプを重複排除してソート
    const subTimestamps = Array.from(
      new Set(
        qEvents
          .filter(e => e.team === 'home' && (e.type === 'SUB_IN' || e.type === 'SUB_OUT'))
          .map(e => e.timestamp)
      )
    ).sort((a, b) => a - b);

    // セグメント分割用のタイムラインポイント群 [0, t1, t2, ..., t_length]
    const timeline = [0, ...subTimestamps];
    if (timeline[timeline.length - 1] < qLength) {
      timeline.push(qLength);
    }

    // 各セグメントでのオンコートメンバーとスタッツの計算
    for (let i = 0; i < timeline.length - 1; i++) {
      const tStart = timeline[i];
      const tEnd = timeline[i + 1];
      const segDuration = tEnd - tStart;
      if (segDuration <= 0) continue;

      // tStart 時点（交代適用後）のオンコートメンバーを決定する
      const onCourt = new Set<string>(starters);
      const subsUpToStart = qEvents.filter(
        e => e.team === 'home' &&
             e.timestamp <= tStart &&
             (e.type === 'SUB_IN' || e.type === 'SUB_OUT')
      );

      subsUpToStart.forEach(e => {
        if (e.playerId && homePlayerIdsSet.has(e.playerId)) {
          if (e.type === 'SUB_IN') {
            onCourt.add(e.playerId);
          } else if (e.type === 'SUB_OUT') {
            onCourt.delete(e.playerId);
          }
        }
      });

      const activeOnCourtIds = Array.from(onCourt).sort();
      // 自チームのオンコートが存在しない場合は集計スキップ（基本的には5人）
      if (activeOnCourtIds.length === 0) continue;

      // この時間枠内のイベント（得失点）を集計
      // 最初のセグメントは [tStart, tEnd], 以降は (tStart, tEnd] で集計して重複を防ぐ
      const segEvents = qEvents.filter(e => {
        if (i === 0) {
          return e.timestamp >= tStart && e.timestamp <= tEnd;
        } else {
          return e.timestamp > tStart && e.timestamp <= tEnd;
        }
      });

      let ptsFor = 0;
      let ptsAgainst = 0;

      segEvents.forEach(e => {
        if (e.team === 'home') {
          if (e.type === '2P_MADE') ptsFor += 2;
          else if (e.type === '3P_MADE') ptsFor += 3;
          else if (e.type === 'FT_MADE') ptsFor += 1;
        } else if (e.team === 'away') {
          if (e.type === '2P_MADE') ptsAgainst += 2;
          else if (e.type === '3P_MADE') ptsAgainst += 3;
          else if (e.type === 'FT_MADE') ptsAgainst += 1;
        }
      });

      const key = activeOnCourtIds.join(',');
      const existing = lineupMap.get(key);

      if (existing) {
        existing.duration += segDuration;
        existing.ptsFor += ptsFor;
        existing.ptsAgainst += ptsAgainst;
        existing.plusMinus += (ptsFor - ptsAgainst);
        // 同じセグメントの結合はせず、履歴を追加
        existing.segments.push({ quarter: q, start: tStart, end: tEnd });
      } else {
        lineupMap.set(key, {
          playerIds: activeOnCourtIds,
          duration: segDuration,
          ptsFor,
          ptsAgainst,
          plusMinus: ptsFor - ptsAgainst,
          ppm: 0, // あとで一括計算
          segments: [{ quarter: q, start: tStart, end: tEnd }]
        });
      }
    }
  });

  const lineups = Array.from(lineupMap.values());
  lineups.forEach(l => {
    // PPM = (+/-) / (出場時間(分))
    l.ppm = l.duration > 0 ? (l.plusMinus / (l.duration / 60)) : 0;
  });

  return lineups;
};

/**
 * 指定した選手と他の各選手との同時出場時の相性（ケミストリー）を算出します。
 */
export const calculateDuoChemistry = (
  targetPlayerId: string,
  lineupStatsList: LineupStats[],
  players: Player[]
): DuoChemistry[] => {
  const duoMap = new Map<string, DuoChemistry>();
  const homePlayers = players.filter(p => p.team === 'home' && p.id !== targetPlayerId);

  // 初期値のセット
  homePlayers.forEach(p => {
    duoMap.set(p.id, {
      partnerId: p.id,
      partnerName: p.name,
      partnerNumber: p.number,
      duration: 0,
      ptsFor: 0,
      ptsAgainst: 0,
      plusMinus: 0,
      ppm: 0
    });
  });

  // 各ラインナップを走査して同時出場スタッツを加算
  lineupStatsList.forEach(lineup => {
    if (!lineup.playerIds.includes(targetPlayerId)) return;

    lineup.playerIds.forEach(pid => {
      if (pid === targetPlayerId) return;
      const duo = duoMap.get(pid);
      if (duo) {
        duo.duration += lineup.duration;
        duo.ptsFor += lineup.ptsFor;
        duo.ptsAgainst += lineup.ptsAgainst;
        duo.plusMinus += lineup.plusMinus;
      }
    });
  });

  const result = Array.from(duoMap.values());
  result.forEach(d => {
    d.ppm = d.duration > 0 ? (d.plusMinus / (d.duration / 60)) : 0;
  });

  return result;
};
