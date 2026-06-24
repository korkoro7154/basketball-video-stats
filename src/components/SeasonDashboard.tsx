import { useEffect, useState } from 'react';
import { fetchGames, loadGame } from '../utils/api';
import type { ExportData, Player } from '../types';
import { calculateTeamStats } from '../utils/statsHelper';
import { Trophy, AlertCircle, RefreshCw, BarChart2, FileJson, ArrowUpDown } from 'lucide-react';

interface SeasonDashboardProps {
  isOffline?: boolean;
}

interface AggregatedPlayerStats {
  key: string; // "team_number_name"
  name: string;
  number: string;
  team: 'home' | 'away';
  gp: number; // Games played
  pts: number;
  ast: number;
  oreb: number;
  dreb: number;
  reb: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
}

interface SeasonShot {
  id: string;
  type: '2P_MADE' | '2P_MISS' | '3P_MADE' | '3P_MISS';
  team: 'home' | 'away';
  playerKey: string;
  location: { x: number; y: number };
}

interface GameResult {
  filename: string;
  title: string;
  date: string;
  opponent: string;
  teamScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'D';
}

type SortField = 'gp' | 'pts' | 'ast' | 'reb' | 'stl' | 'blk' | 'to' | 'pf' | 'fgPercent' | 'tpPercent' | 'ftPercent';

export const SeasonDashboard: React.FC<SeasonDashboardProps> = ({ isOffline = false }) => {
  const [games, setGames] = useState<ExportData[]>([]);
  const [gameResults, setGameResults] = useState<GameResult[]>([]);
  const [playerStats, setPlayerStats] = useState<AggregatedPlayerStats[]>([]);
  const [allShots, setAllShots] = useState<SeasonShot[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Roster list for dropdown selection
  const [uniquePlayers, setUniquePlayers] = useState<{ key: string; label: string; team: 'home' | 'away'; number: string }[]>([]);
  const [selectedChartPlayerKey, setSelectedChartPlayerKey] = useState<string>('all-home');

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('pts');
  const [sortAsc, setSortAsc] = useState(false);

  // Load all game data
  const loadServerData = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch the list of games
      const list = await fetchGames();
      // Filter out practice mode files if they don't have standard stats
      const gameFiles = list.filter(g => g.mode === 'game' || g.mode === 'live');
      
      if (gameFiles.length === 0) {
        setGames([]);
        setGameResults([]);
        setPlayerStats([]);
        setAllShots([]);
        setUniquePlayers([]);
        setLoading(false);
        return;
      }

      // 2. Load all game details
      const details = await Promise.all(
        gameFiles.map(async (f) => {
          const data = await loadGame(f.filename);
          return { ...data, filename: f.filename } as ExportData & { filename: string };
        })
      );

      processGameData(details);
    } catch (err: any) {
      console.error(err);
      setError('サーバーからのデータ取得に失敗しました。サーバーが起動しているか確認してください。');
    } finally {
      setLoading(false);
    }
  };

  // Handle local file uploads (Offline version)
  const handleLocalFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setError('');
    
    const loadedDetails: ExportData[] = [];
    let processedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const text = event.target?.result as string;
          const parsed = JSON.parse(text);
          
          if (parsed.players && parsed.events) {
            loadedDetails.push({
              ...parsed,
              filename: file.name
            });
          }
        } catch (err) {
          console.error(`Failed to parse local file ${file.name}:`, err);
        }

        processedCount++;
        if (processedCount === files.length) {
          if (loadedDetails.length === 0) {
            setError('有効なスタッツデータを含むJSONファイルが読み込まれませんでした。');
            setLoading(false);
          } else {
            processGameData(loadedDetails);
            setLoading(false);
          }
        }
      };

      reader.readAsText(file);
    }
  };

  // Core Data Processing (Aggregating Stats)
  const processGameData = (details: ExportData[]) => {
    setGames(details);
    
    const results: GameResult[] = [];
    const statsMap: Record<string, AggregatedPlayerStats> = {};
    const shotsList: SeasonShot[] = [];
    const playerKeysAdded = new Set<string>();

    details.forEach((game) => {
      const fname = (game as any).filename || 'game.json';
      // 1. Calculate Team Scores
      const homeStats = calculateTeamStats(game.events, 'home');
      const awayStats = calculateTeamStats(game.events, 'away');
      
      const opponent = game.gameInfo?.opponent || '相手チーム';
      const teamScore = homeStats.pts;
      const oppScore = awayStats.pts;
      
      let result: 'W' | 'L' | 'D' = 'D';
      if (teamScore > oppScore) result = 'W';
      else if (teamScore < oppScore) result = 'L';

      results.push({
        filename: fname,
        title: game.gameInfo?.title || '未タイトル',
        date: game.gameInfo?.date || '日付未設定',
        opponent,
        teamScore,
        oppScore,
        result
      });

      // 2. Roster players map inside this game
      const rosterLookup: Record<string, Player> = {};
      game.players.forEach(p => {
        rosterLookup[p.id] = p;
      });

      // Register all players from this game in the global stats map
      game.players.forEach(p => {
        const playerKey = `${p.team}_#${p.number}_${p.name}`;
        playerKeysAdded.add(playerKey);
        
        if (!statsMap[playerKey]) {
          statsMap[playerKey] = {
            key: playerKey,
            name: p.name,
            number: p.number,
            team: p.team,
            gp: 0,
            pts: 0,
            ast: 0,
            oreb: 0,
            dreb: 0,
            reb: 0,
            stl: 0,
            blk: 0,
            to: 0,
            pf: 0,
            fgm: 0,
            fga: 0,
            tpm: 0,
            tpa: 0,
            ftm: 0,
            fta: 0
          };
        }
        
        // Count games played
        statsMap[playerKey].gp += 1;
      });

      // 3. Aggregate events
      game.events.forEach(e => {
        // Find player details for this event
        let playerKey = '';
        if (e.playerId && rosterLookup[e.playerId]) {
          const p = rosterLookup[e.playerId];
          playerKey = `${p.team}_#${p.number}_${p.name}`;
        }

        // Aggregate stats
        if (playerKey && statsMap[playerKey]) {
          const s = statsMap[playerKey];
          switch (e.type) {
            case '3P_MADE':
              s.pts += 3; s.tpm += 1; s.tpa += 1; s.fgm += 1; s.fga += 1;
              break;
            case '3P_MISS':
              s.tpa += 1; s.fga += 1;
              break;
            case '2P_MADE':
              s.pts += 2; s.fgm += 1; s.fga += 1;
              break;
            case '2P_MISS':
              s.fga += 1;
              break;
            case 'FT_MADE':
              s.pts += 1; s.ftm += 1; s.fta += 1;
              break;
            case 'FT_MISS':
              s.fta += 1;
              break;
            case 'AST':
              s.ast += 1;
              break;
            case 'OREB':
              s.oreb += 1; s.reb += 1;
              break;
            case 'DREB':
              s.dreb += 1; s.reb += 1;
              break;
            case 'STL':
              s.stl += 1;
              break;
            case 'BLK':
              s.blk += 1;
              break;
            case 'TO':
              s.to += 1;
              break;
            case 'PF':
              s.pf += 1;
              break;
          }
        }

        // Add to shots list if it is a shot with location
        if (e.location && ['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'].includes(e.type)) {
          let pKey = '';
          if (e.playerId && rosterLookup[e.playerId]) {
            const p = rosterLookup[e.playerId];
            pKey = `${p.team}_#${p.number}_${p.name}`;
          }
          
          shotsList.push({
            id: e.id,
            type: e.type as any,
            team: e.team,
            playerKey: pKey,
            location: e.location
          });
        }
      });
    });

    setGameResults(results);
    setAllShots(shotsList);

    // Convert stats map to array
    const statsArray = Object.values(statsMap);
    setPlayerStats(statsArray);

    // Create list of unique players for the dropdown
    const uniquePlayersList: { key: string; label: string; team: 'home' | 'away'; number: string }[] = [];
    statsArray.forEach(p => {
      uniquePlayersList.push({
        key: p.key,
        label: `#${p.number} ${p.name}`,
        team: p.team,
        number: p.number
      });
    });
    
    // Sort players by team and then by number (as number value)
    uniquePlayersList.sort((a, b) => {
      if (a.team !== b.team) {
        return a.team === 'home' ? -1 : 1;
      }
      return parseInt(a.number) - parseInt(b.number);
    });

    setUniquePlayers(uniquePlayersList);
  };

  useEffect(() => {
    if (!isOffline) {
      loadServerData();
    }
  }, [isOffline]);

  // Handle Sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Get sorting value helper
  const getSortVal = (p: AggregatedPlayerStats, field: SortField): number => {
    switch (field) {
      case 'gp': return p.gp;
      case 'pts': return p.pts / p.gp;
      case 'ast': return p.ast / p.gp;
      case 'reb': return p.reb / p.gp;
      case 'stl': return p.stl / p.gp;
      case 'blk': return p.blk / p.gp;
      case 'to': return p.to / p.gp;
      case 'pf': return p.pf / p.gp;
      case 'fgPercent': return p.fga > 0 ? (p.fgm / p.fga) * 100 : -1;
      case 'tpPercent': return p.tpa > 0 ? (p.tpm / p.tpa) * 100 : -1;
      case 'ftPercent': return p.fta > 0 ? (p.ftm / p.fta) * 100 : -1;
      default: return 0;
    }
  };

  const sortedPlayerStats = [...playerStats].sort((a, b) => {
    const valA = getSortVal(a, sortField);
    const valB = getSortVal(b, sortField);
    return sortAsc ? valA - valB : valB - valA;
  });

  // Filtered Shots for display
  const displayShots = allShots.filter(s => {
    if (selectedChartPlayerKey === 'all-home') return s.team === 'home';
    if (selectedChartPlayerKey === 'all-away') return s.team === 'away';
    return s.playerKey === selectedChartPlayerKey;
  });

  const shotsMade = displayShots.filter(s => s.type === '2P_MADE' || s.type === '3P_MADE').length;
  const shotsTotal = displayShots.length;
  const shotPercent = shotsTotal > 0 ? ((shotsMade / shotsTotal) * 100).toFixed(1) : '0.0';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '16px', width: '100%', boxSizing: 'border-box' }}>
      
      {/* 左側: 選手通算成績テーブル */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '400px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={22} style={{ color: 'var(--accent-color)' }} />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>シーズン通算スタッツ集計</h2>
            </div>
            {isOffline ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <FileJson size={14} /> JSONを複数選択
                  <input
                    type="file"
                    multiple
                    accept="application/json"
                    onChange={handleLocalFilesUpload}
                    style={{ display: 'none' }}
                  />
                </label>
                <span style={{ fontSize: '0.75rem', color: '#888' }}>
                  {games.length > 0 ? `集計中: ${games.length}試合` : 'ファイル未選択'}
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '0.75rem', color: '#888' }}>
                  集計対象: {games.length}試合
                </span>
                <button
                  onClick={loadServerData}
                  disabled={loading}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '4px',
                    color: '#ccc',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 再読み込み
                </button>
              </div>
            )}
          </div>

          {error && (
            <div style={{ display: 'flex', gap: '8px', color: 'var(--color-danger)', fontSize: '0.85rem', alignItems: 'flex-start', background: 'rgba(239,68,68,0.05)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.1)' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#888', gap: '8px' }}>
              <RefreshCw className="animate-spin" size={24} />
              <span>集計データを取得中...</span>
            </div>
          ) : games.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#666', gap: '12px', padding: '60px 0' }}>
              <BarChart2 size={48} style={{ opacity: 0.2 }} />
              <span style={{ fontSize: '0.9rem' }}>
                {isOffline 
                  ? '「JSONを複数選択」ボタンから、エクスポートした試合データ(.json)を複数選んで集計してください。' 
                  : 'サーバー上に保存されている試合データがありません。試合をサーバー保存してからご確認ください。'}
              </span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--glass-border)', color: '#aaa', fontWeight: 600 }}>
                    <th style={{ padding: '10px 8px' }}>選手</th>
                    <th style={{ padding: '10px 8px' }}>チーム</th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('gp')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>GP <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('pts')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>PPG <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('ast')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>APG <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('reb')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>RPG <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('stl')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>SPG <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('blk')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>BPG <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('fgPercent')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>FG% <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('tpPercent')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>3P% <ArrowUpDown size={10} /></div>
                    </th>
                    <th style={{ padding: '10px 8px', cursor: 'pointer' }} onClick={() => handleSort('ftPercent')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>FT% <ArrowUpDown size={10} /></div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayerStats.map(p => (
                    <tr 
                      key={p.key} 
                      style={{ 
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        background: selectedChartPlayerKey === p.key ? 'rgba(255, 107, 0, 0.08)' : 'transparent',
                        cursor: 'pointer'
                      }}
                      onClick={() => setSelectedChartPlayerKey(p.key)}
                    >
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>#{p.number} {p.name}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{ 
                          fontSize: '0.65rem', 
                          padding: '2px 6px', 
                          borderRadius: '4px', 
                          background: p.team === 'home' ? 'rgba(255, 107, 0, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: p.team === 'home' ? 'var(--accent-color)' : 'var(--color-danger)'
                        }}>
                          {p.team === 'home' ? '自チーム' : '相手'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{p.gp}</td>
                      <td style={{ padding: '10px 8px', fontWeight: 700, color: 'var(--accent-color)' }}>
                        {(p.pts / p.gp).toFixed(1)}
                      </td>
                      <td style={{ padding: '10px 8px' }}>{(p.ast / p.gp).toFixed(1)}</td>
                      <td style={{ padding: '10px 8px' }}>{(p.reb / p.gp).toFixed(1)}</td>
                      <td style={{ padding: '10px 8px' }}>{(p.stl / p.gp).toFixed(1)}</td>
                      <td style={{ padding: '10px 8px' }}>{(p.blk / p.gp).toFixed(1)}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {p.fga > 0 ? `${((p.fgm / p.fga) * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {p.tpa > 0 ? `${((p.tpm / p.tpa) * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {p.fta > 0 ? `${((p.ftm / p.fta) * 100).toFixed(0)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '10px', fontStyle: 'italic' }}>
            ※ PPG=平均得点, APG=平均アシスト, RPG=平均リバウンド, SPG=平均スチール, BPG=平均ブロック。<br />
            ※ 選手行をタップすると、右側のシュートチャートがその選手個人のデータに連動して切り替わります。
          </div>
        </div>
      </div>

      {/* 右側: 試合結果一覧 ＆ 総括シュートチャート */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* 試合結果推移 */}
        <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Trophy size={16} style={{ color: 'var(--accent-color)' }} /> 試合結果一覧
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
            {gameResults.length === 0 ? (
              <span style={{ fontSize: '0.75rem', color: '#666', textAlign: 'center', padding: '20px 0' }}>集計データはありません</span>
            ) : (
              gameResults.map((r, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(255,255,255,0.01)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '0.75rem'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                    <span style={{ fontWeight: 700, color: '#fff' }}>{r.title}</span>
                    <span style={{ color: '#888', fontSize: '0.65rem' }}>{r.date} vs {r.opponent}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 800, fontSize: '0.8rem' }}>{r.teamScore} - {r.oppScore}</span>
                    <span style={{
                      display: 'inline-block',
                      width: '18px',
                      height: '18px',
                      borderRadius: '4px',
                      background: r.result === 'W' ? 'rgba(74, 222, 128, 0.15)' : r.result === 'L' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.1)',
                      color: r.result === 'W' ? '#4ade80' : r.result === 'L' ? '#ef4444' : '#ccc',
                      textAlign: 'center',
                      lineHeight: '18px',
                      fontWeight: 800,
                      fontSize: '0.7rem'
                    }}>
                      {r.result}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* シーズンシュートチャート */}
        <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BarChart2 size={16} style={{ color: 'var(--accent-color)' }} /> シーズンシュート分布
          </h3>

          {/* 選手選択 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
            <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>チャート表示選手:</span>
            <select
              value={selectedChartPlayerKey}
              onChange={(e) => setSelectedChartPlayerKey(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--glass-border)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '0.75rem',
                outline: 'none',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <option value="all-home">自チーム全体 (Home Team)</option>
              <option value="all-away">相手チーム全体 (Away Team)</option>
              <hr />
              {uniquePlayers.map(p => (
                <option key={p.key} value={p.key}>
                  {p.team === 'home' ? '【自】' : '【相】'}{p.label}
                </option>
              ))}
            </select>
          </div>

          {/* チャート統計 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#ccc', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '4px' }}>
            <span>試投数: <strong>{shotsTotal}</strong></span>
            <span>成功率: <strong>{shotPercent}%</strong> ({shotsMade}成功)</span>
          </div>

          {/* コート描画 */}
          <div style={{ border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', background: '#fff', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '4px 0' }}>
            <svg viewBox="0 0 100 95" style={{ width: '100%', height: 'auto', display: 'block' }}>
              <rect x="0" y="0" width="100" height="95" fill="#fff" stroke="#333" strokeWidth="0.8" />
              <rect x="33.6" y="0" width="32.8" height="41.4" fill="none" stroke="#333" strokeWidth="0.8" />
              <path d="M 33.6 41.4 A 16.4 16.4 0 0 0 66.4 41.4" fill="none" stroke="#333" strokeWidth="0.8" />
              <path d="M 66.4 41.4 A 16.4 16.4 0 0 0 33.6 41.4" fill="none" stroke="#333" strokeWidth="0.8" strokeDasharray="1,1" />
              <path d="M 6 0 L 6 21.3 A 44 48.2 0 0 0 94 21.3 L 94 0" fill="none" stroke="#333" strokeWidth="0.8" />
              <path d="M 38 95 A 12 12 0 0 1 62 95" fill="none" stroke="#333" strokeWidth="0.8" />
              <line x1="44" y1="8.6" x2="56" y2="8.6" stroke="#333" strokeWidth="1.2" />
              <circle cx="50" cy="11.25" r="2.25" fill="none" stroke="#333" strokeWidth="1.2" />
              
              {/* プロット */}
              {displayShots.map(s => {
                const isMade = s.type === '2P_MADE' || s.type === '3P_MADE';
                return isMade ? (
                  <circle key={s.id} cx={s.location.x} cy={s.location.y} r="2.5" fill="#10b981" stroke="#fff" strokeWidth="0.4" />
                ) : (
                  <g key={s.id}>
                    <line x1={s.location.x - 2} y1={s.location.y - 2} x2={s.location.x + 2} y2={s.location.y + 2} stroke="#ef4444" strokeWidth="1.2" />
                    <line x1={s.location.x + 2} y1={s.location.y - 2} x2={s.location.x - 2} y2={s.location.y + 2} stroke="#ef4444" strokeWidth="1.2" />
                  </g>
                );
              })}
            </svg>
          </div>
          
          <div style={{ fontSize: '0.65rem', color: '#888', display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} /> 成功</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ color: '#ef4444', fontWeight: 800 }}>✕</span> 失敗</span>
          </div>

        </div>

      </div>
    </div>
  );
};
