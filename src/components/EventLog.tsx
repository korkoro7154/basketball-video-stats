import { useState } from 'react';
import type { StatsEvent, Player, Quarter } from '../types';
import { formatTime, getStatLabel } from '../utils/statsHelper';
import { Trash2, MessageSquare, ArrowUpDown, Play, RefreshCw, Clock } from 'lucide-react';

interface EventLogProps {
  events: StatsEvent[];
  players: Player[];
  onRemoveEvent: (id: string) => void;
  onUpdateEventNotes: (id: string, notes: string) => void;
  onJumpToTime: (time: number, quarter?: Quarter) => void;
  // 新規追加
  appMode: 'game' | 'practice';
}

export const EventLog: React.FC<EventLogProps> = ({
  events,
  players,
  onRemoveEvent,
  onUpdateEventNotes,
  onJumpToTime,
  appMode
}) => {
  const [sortOrder, setSortOrder] = useState<'time-asc' | 'time-desc' | 'created-desc'>('created-desc');
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState('');

  // 検索・フィルタリング用の状態
  const [filterSearch, setFilterSearch] = useState('');
  const [filterQuarter, setFilterQuarter] = useState<string>('all');
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [filterStatType, setFilterStatType] = useState<string>('all');

  // プレイヤー情報
  const getPlayerInfo = (playerId: string | null, team: 'home' | 'away') => {
    if (!playerId) {
      return team === 'home' ? { number: '-', name: 'チーム全体' } : { number: '', name: '相手チーム全体' };
    }
    const p = players.find(player => player.id === playerId);
    return p ? { number: p.number, name: p.name } : { number: '?', name: '不明な選手' };
  };

  // フィルターされたイベント
  const getFilteredEvents = () => {
    return events.filter(e => {
      // 1. クオーターフィルター
      if (appMode === 'game' && filterQuarter !== 'all' && e.quarter !== filterQuarter) {
        return false;
      }

      // 2. チームフィルター
      if (appMode === 'game' && filterTeam !== 'all' && e.team !== filterTeam) {
        return false;
      }

      // 3. スタッツ種類フィルター
      if (filterStatType !== 'all') {
        if (filterStatType === 'score') {
          if (!['3P_MADE', '3P_MISS', '2P_MADE', '2P_MISS', 'FT_MADE', 'FT_MISS'].includes(e.type)) return false;
        } else if (filterStatType === 'ast') {
          if (e.type !== 'AST') return false;
        } else if (filterStatType === 'reb') {
          if (!['OREB', 'DREB'].includes(e.type)) return false;
        } else if (filterStatType === 'to') {
          if (e.type !== 'TO') return false;
        } else if (filterStatType === 'stl_blk') {
          if (!['STL', 'BLK'].includes(e.type)) return false;
        } else if (filterStatType === 'pf') {
          if (e.type !== 'PF') return false;
        } else if (filterStatType === 'sub') {
          if (!['SUB_IN', 'SUB_OUT'].includes(e.type)) return false;
        } else if (filterStatType === 'timeout') {
          if (e.type !== 'TIMEOUT') return false;
        } else if (filterStatType === 'practice') {
          if (e.type !== 'PRACTICE_TAG') return false;
        }
      }

      // 4. キーワード検索
      if (filterSearch.trim() !== '') {
        const query = filterSearch.toLowerCase().trim();
        const player = getPlayerInfo(e.playerId, e.team);
        const playerName = player.name.toLowerCase();
        const playerNum = player.number.toLowerCase();
        const notes = (e.notes || '').toLowerCase();
        const statLabel = getStatLabel(e.type).toLowerCase();
        const practiceTag = (e.practiceTag || '').toLowerCase();

        // 選手名、背番号、スタッツ名、メモ、練習タグ名、および「自チーム」「相手チーム」で検索
        const teamText = e.team === 'home' ? '自チーム' : '相手チーム';
        if (
          !playerName.includes(query) &&
          !playerNum.includes(query) &&
          !notes.includes(query) &&
          !statLabel.includes(query) &&
          !practiceTag.includes(query) &&
          !teamText.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  };

  // ソートされたイベント
  const getSortedEvents = (filteredEvents: StatsEvent[]) => {
    const eventsCopy = [...filteredEvents];
    if (sortOrder === 'time-asc') {
      return eventsCopy.sort((a, b) => a.timestamp - b.timestamp);
    } else if (sortOrder === 'time-desc') {
      return eventsCopy.sort((a, b) => b.timestamp - a.timestamp);
    } else {
      return eventsCopy.reverse();
    }
  };

  const startEditingNotes = (event: StatsEvent) => {
    setEditingNotesId(event.id);
    setNoteValue(event.notes || '');
  };

  const saveNotes = (id: string) => {
    onUpdateEventNotes(id, noteValue.trim());
    setEditingNotesId(null);
  };

  // 交代イベントのログテキスト作成
  const renderSubstitutionText = (event: StatsEvent) => {
    const playerIn = getPlayerInfo(event.playerId, event.team);
    // 交代アウトされた選手情報をメモやNotes、またはイベント内から解決する
    // 今回の実装では、交代イベントをSUB_IN(選手ID)とSUB_OUT(選手ID)のペアで同時に登録しているか、または「#○ OUT -> #○ IN」という文字列を生成して紐付けている
    // 実装を簡単にするために、交代イベントに notes として「交代アウトした選手名」を自動保存させておくと綺麗に表示できる。
    // メモが 「#○ OUT -> #○ IN」のような交代テキストであればそれを表示
    if (event.notes && event.notes.includes('OUT →')) {
      return event.notes;
    }
    return `選手交代: ${playerIn.name}`;
  };

  const filteredEvents = getFilteredEvents();
  const sortedEvents = getSortedEvents(filteredEvents);

  return (
    <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* ヘッダーとソート */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>
            履歴ログ {filteredEvents.length !== events.length ? `(${filteredEvents.length}/${events.length}件)` : `(${events.length}件)`}
          </h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ArrowUpDown size={14} style={{ color: '#888' }} />
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as any)}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--glass-border)',
              color: '#ccc',
              fontSize: '0.75rem',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="created-desc">追加順（新しい順）</option>
            <option value="time-asc">タイムライン（昇順）</option>
            <option value="time-desc">タイムライン（降順）</option>
          </select>
        </div>
      </div>

      {/* 検索・フィルターバー */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '10px',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--glass-border)'
      }}>
        {/* 検索キーワード入力 */}
        <input
          type="text"
          placeholder="選手名・背番号・メモで検索..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          style={{
            flex: '1 1 150px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--glass-border)',
            color: '#fff',
            fontSize: '0.8rem',
            padding: '6px 10px',
            borderRadius: '4px',
            outline: 'none'
          }}
        />

        {/* クオーターフィルター (試合モードのみ) */}
        {appMode === 'game' && (
          <select
            value={filterQuarter}
            onChange={(e) => setFilterQuarter(e.target.value)}
            style={{
              flex: '1 1 80px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--glass-border)',
              color: '#ccc',
              fontSize: '0.8rem',
              padding: '6px',
              borderRadius: '4px',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="all">全クオーター</option>
            <option value="1Q">1Q</option>
            <option value="2Q">2Q</option>
            <option value="3Q">3Q</option>
            <option value="4Q">4Q</option>
            <option value="OT">OT</option>
          </select>
        )}

        {/* チームフィルター (試合モードのみ) */}
        {appMode === 'game' && (
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            style={{
              flex: '1 1 80px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--glass-border)',
              color: '#ccc',
              fontSize: '0.8rem',
              padding: '6px',
              borderRadius: '4px',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="all">全チーム</option>
            <option value="home">自チーム</option>
            <option value="away">相手チーム</option>
          </select>
        )}

        {/* スタッツ種類フィルター */}
        <select
          value={filterStatType}
          onChange={(e) => setFilterStatType(e.target.value)}
          style={{
            flex: '1 1 110px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--glass-border)',
            color: '#ccc',
            fontSize: '0.8rem',
            padding: '6px',
            borderRadius: '4px',
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          <option value="all">全スタッツ</option>
          {appMode === 'game' ? (
            <>
              <option value="score">得点/シュート</option>
              <option value="ast">アシスト</option>
              <option value="reb">リバウンド</option>
              <option value="to">ターンオーバー</option>
              <option value="stl_blk">スティール/ブロック</option>
              <option value="pf">ファウル</option>
              <option value="sub">選手交代</option>
              <option value="timeout">タイムアウト</option>
            </>
          ) : (
            <option value="practice">練習タグイベント</option>
          )}
        </select>
      </div>

      {/* 履歴リスト */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '650px', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
        {sortedEvents.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: '40px 0', fontSize: '0.9rem' }}>
            ログデータはありません。
          </div>
        ) : (
          sortedEvents.map(event => {
            const player = getPlayerInfo(event.playerId, event.team);
            const isSubEvent = event.type === 'SUB_IN' || event.type === 'SUB_OUT';
            
            return (
              <div
                key={event.id}
                onClick={() => onJumpToTime(event.timestamp, event.quarter)}
                style={{
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 107, 0, 0.04)';
                  e.currentTarget.style.borderColor = 'rgba(255, 107, 0, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)';
                  e.currentTarget.style.borderColor = 'var(--glass-border)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* 再生ジャンプボタン */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onJumpToTime(event.timestamp, event.quarter); }}
                      className="btn"
                      style={{
                        padding: '3px 8px',
                        background: 'rgba(255, 107, 0, 0.1)',
                        color: 'var(--accent-color)',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        border: '1px solid rgba(255, 107, 0, 0.2)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                      title="このプレイを再生"
                    >
                      <Play size={10} fill="var(--accent-color)" /> {formatTime(event.timestamp)}
                    </button>

                    {/* クオーター/練習バッジ */}
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: appMode === 'practice' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 107, 0, 0.1)',
                      color: appMode === 'practice' ? 'var(--color-info)' : 'var(--accent-color)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: appMode === 'practice' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 107, 0, 0.2)'
                    }}>
                      {appMode === 'practice' ? '練習' : event.quarter}
                    </span>

                    {/* 試合時計の残り時間 */}
                    {appMode !== 'practice' && event.gameTime !== undefined && (
                      <span style={{ fontSize: '0.75rem', color: '#bbb', display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--glass-border)' }} title="残り試合時間">
                        <Clock size={10} style={{ color: 'var(--accent-color)' }} />
                        {formatTime(event.gameTime)}
                      </span>
                    )}

                    {/* チーム表示 (試合モードのみ) */}
                    {appMode === 'game' && (
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: event.team === 'home' ? 'var(--accent-color)' : 'var(--color-danger)'
                      }}>
                        {event.team === 'home' ? '自' : '相手'}
                      </span>
                    )}

                    {/* 選手番号と名前 (交代とタイムアウト以外) */}
                    {appMode === 'game' && event.type !== 'TIMEOUT' && !isSubEvent && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                        {player.number ? `#${player.number} ` : ''}{player.name}
                      </span>
                    )}
                    
                    {/* 交代表示 */}
                    {appMode === 'game' && isSubEvent && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <RefreshCw size={12} style={{ color: 'var(--accent-color)' }} /> {renderSubstitutionText(event)}
                      </span>
                    )}

                    {/* タイムアウト表示 */}
                    {appMode === 'game' && event.type === 'TIMEOUT' && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ffeb3b' }}>
                        タイムアウト
                      </span>
                    )}

                    {/* 練習タグ名 */}
                    {appMode === 'practice' && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-color)' }}>
                        {event.practiceTag}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {/* スタッツアクションバッジ (試合モードかつ交代以外) */}
                    {appMode === 'game' && !isSubEvent && (
                      <span className={`badge-stat badge-${event.type}`}>
                        {getStatLabel(event.type)}
                      </span>
                    )}

                    {/* 削除ボタン */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveEvent(event.id); }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#666',
                        cursor: 'pointer',
                        padding: '2px'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-danger)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
                      title="削除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* ログ二行目: メモ欄 */}
                <div style={{ paddingLeft: '2px' }}>
                  {editingNotesId === event.id ? (
                    <div style={{ display: 'flex', gap: '6px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={noteValue}
                        onChange={(e) => setNoteValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveNotes(event.id)}
                        className="input-field"
                        style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem' }}
                        placeholder="メモを入力..."
                        autoFocus
                      />
                      <button
                        onClick={() => saveNotes(event.id)}
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                      >
                        保存
                      </button>
                    </div>
                  ) : (
                    // 交代イベントの自動生成テキストと競合しないよう、メモ表示を微調整
                    // 交代イベントで、かつメモが自動生成テキストのみの場合はプレースホルダーを表示
                    <div
                      onClick={(e) => { e.stopPropagation(); startEditingNotes(event); }}
                      style={{
                        fontSize: '0.8rem',
                        color: (event.notes && !event.notes.includes('OUT →')) ? '#bbb' : '#555',
                        fontStyle: (event.notes && !event.notes.includes('OUT →')) ? 'normal' : 'italic',
                        cursor: 'pointer',
                        padding: '4px',
                        background: 'rgba(0,0,0,0.1)',
                        borderRadius: '3px',
                        minHeight: '22px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      {(event.notes && !event.notes.includes('OUT →')) 
                        ? event.notes 
                        : 'クリックしてメモを追加 (例: 左コーナー3P, パスカットなど)'}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
