import { useState } from 'react';
import type { Player } from '../types';
import { UserPlus, Trash2, Users, Edit2, Check, X, Shield, ShieldAlert } from 'lucide-react';

interface PlayerManagerProps {
  players: Player[];
  onAddPlayer: (name: string, number: string, team: 'home' | 'away') => void;
  onRemovePlayer: (id: string) => void;
  onUpdatePlayer: (id: string, name: string, number: string) => void;
  onResetPlayers: () => void;
  scoutingMode: boolean; // スカウティングモードの有無
  onScoutingModeChange: (scouting: boolean) => void;
  appMode: 'game' | 'live' | 'practice';
}

export const PlayerManager: React.FC<PlayerManagerProps> = ({
  players,
  onAddPlayer,
  onRemovePlayer,
  onUpdatePlayer,
  onResetPlayers,
  scoutingMode,
  onScoutingModeChange,
  appMode
}) => {
  const [activeTab, setActiveTab] = useState<'home' | 'away'>('home');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerNumber, setNewPlayerNumber] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNumber, setEditNumber] = useState('');
  const [error, setError] = useState('');

  // 現在表示対象のチームに属する選手リスト
  const filteredPlayers = players.filter(p => p.team === activeTab);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) {
      setError('選手名を入力してください');
      return;
    }
    if (!newPlayerNumber.trim()) {
      setError('背番号を入力してください');
      return;
    }
    
    // 同じチーム内での背番号重複チェック
    const isDuplicate = players.some(p => p.team === activeTab && p.number === newPlayerNumber.trim());
    if (isDuplicate) {
      setError(`${activeTab === 'home' ? '自' : '相手'}チーム内で背番号 ${newPlayerNumber} は既に登録されています`);
      return;
    }

    onAddPlayer(newPlayerName.trim(), newPlayerNumber.trim(), activeTab);
    setNewPlayerName('');
    setNewPlayerNumber('');
    setError('');
  };

  const startEdit = (player: Player) => {
    setEditingId(player.id);
    setEditName(player.name);
    setEditNumber(player.number);
  };

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editNumber.trim()) return;
    
    // 自分以外の同じチーム内での重複チェック
    const isDuplicate = players.some(p => p.id !== id && p.team === activeTab && p.number === editNumber.trim());
    if (isDuplicate) {
      setError(`背番号 ${editNumber} は既に別の選手が使用しています`);
      return;
    }

    onUpdatePlayer(id, editName.trim(), editNumber.trim());
    setEditingId(null);
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError('');
  };

  return (
    <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* タイトルとタブ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={20} style={{ color: 'var(--accent-color)' }} />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>選手登録・管理</h2>
          </div>
          
          <button
            onClick={onResetPlayers}
            style={{
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '6px',
              color: '#f87171',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.15s'
            }}
            title="選手名簿を初期のデフォルトメンバーにリセットします"
          >
            <Trash2 size={12} /> 名簿リセット
          </button>
        </div>

        {/* Home/Awayタブ切り替え (練習モード以外で常に表示) */}
        {appMode !== 'practice' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px' }}>
            <button
              onClick={() => {
                setActiveTab('home');
                setError('');
              }}
              style={{
                border: 'none',
                background: activeTab === 'home' ? 'var(--bg-tertiary)' : 'transparent',
                color: activeTab === 'home' ? 'var(--accent-color)' : '#999',
                fontSize: '0.8rem',
                padding: '6px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}
            >
              <Shield size={12} /> 自チーム
            </button>
            <button
              onClick={() => {
                setActiveTab('away');
                setError('');
              }}
              style={{
                border: 'none',
                background: activeTab === 'away' ? 'var(--bg-tertiary)' : 'transparent',
                color: activeTab === 'away' ? 'var(--color-danger)' : '#999',
                fontSize: '0.8rem',
                padding: '6px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}
            >
              <ShieldAlert size={12} /> 相手チーム
            </button>
          </div>
        )}
      </div>

      {!scoutingMode && activeTab === 'away' ? (
        <div style={{
          padding: '24px 16px',
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.01)',
          border: '1px dashed var(--glass-border)',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          marginTop: '8px'
        }}>
          <p style={{ fontSize: '0.8rem', color: '#aaa', margin: 0, lineHeight: 1.5 }}>
            相手スカウティングモードが無効です。<br />
            相手チームの選手を個別に登録してスタッツを記録するには、モードを有効にしてください。
          </p>
          <button
            type="button"
            onClick={() => onScoutingModeChange(true)}
            className="btn"
            style={{
              fontSize: '0.75rem',
              padding: '6px 12px',
              background: 'var(--color-danger)',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)'
            }}
          >
            スカウティングモードを有効にする
          </button>
        </div>
      ) : (
        <>
          {/* 新規選手フォーム */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px' }}>
              <input
                type="text"
                placeholder="背番号"
                value={newPlayerNumber}
                onChange={(e) => setNewPlayerNumber(e.target.value)}
                className="input-field"
                maxLength={3}
                style={{ textAlign: 'center' }}
              />
              <input
                type="text"
                placeholder={activeTab === 'home' ? "選手名（例: 山田 太郎）" : "相手選手名（例: スミス）"}
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                className="input-field"
              />
            </div>
            
            {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{error}</p>}

            <button
              type="submit"
              className="btn"
              style={{
                width: '100%',
                background: activeTab === 'home' ? 'var(--accent-color)' : 'rgba(239, 68, 68, 0.2)',
                border: activeTab === 'home' ? 'none' : '1px solid rgba(239, 68, 68, 0.4)',
                color: '#fff',
                boxShadow: activeTab === 'home' ? '0 4px 14px var(--accent-glow)' : 'none'
              }}
            >
              <UserPlus size={16} /> {activeTab === 'home' ? '自チーム' : '相手チーム'}に選手を追加
            </button>
          </form>

          {/* 選手一覧リスト */}
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '280px', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
            {filteredPlayers.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#666', fontSize: '0.9rem', padding: '20px 0' }}>
                {activeTab === 'home' ? '登録された選手はいません' : '相手選手が未登録です（スカウティング用）'}
              </p>
            ) : (
              filteredPlayers.map(player => (
                <div
                  key={player.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: editingId === player.id ? 'rgba(255, 107, 0, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    borderColor: editingId === player.id 
                      ? 'var(--accent-color)' 
                      : (activeTab === 'home' ? 'var(--glass-border)' : 'rgba(239,68,68,0.1)'),
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  {editingId === player.id ? (
                    <div style={{ display: 'flex', gap: '6px', width: '100%', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={editNumber}
                        onChange={(e) => setEditNumber(e.target.value)}
                        className="input-field"
                        style={{ width: '50px', textAlign: 'center', padding: '4px' }}
                        maxLength={3}
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="input-field"
                        style={{ flex: 1, padding: '4px' }}
                      />
                      <button onClick={() => saveEdit(player.id)} className="btn btn-icon" style={{ width: '28px', height: '28px', background: 'rgba(16, 185, 129, 0.2)', color: 'var(--color-success)' }}>
                        <Check size={14} />
                      </button>
                      <button onClick={cancelEdit} className="btn btn-icon" style={{ width: '28px', height: '28px', background: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-danger)' }}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #1e2230, #12141c)',
                          border: '1px solid',
                          borderColor: activeTab === 'home' ? 'var(--accent-color)' : 'var(--color-danger)',
                          color: activeTab === 'home' ? 'var(--accent-color)' : 'var(--color-danger)',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.9rem'
                        }}>
                          {player.number}
                        </div>
                        <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>{player.name}</span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => startEdit(player)}
                          className="btn btn-icon"
                          style={{ width: '28px', height: '28px', color: '#aaa', border: 'none', background: 'transparent' }}
                          title="編集"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => onRemovePlayer(player.id)}
                          className="btn btn-icon"
                          style={{ width: '28px', height: '28px', color: '#ff6b6b', border: 'none', background: 'transparent' }}
                          title="削除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
