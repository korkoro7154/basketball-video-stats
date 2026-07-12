import React from 'react';
import type { Player, GameInfo } from '../types';
import { PlayerManager } from './PlayerManager';
import { Settings, X, Eye, EyeOff } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameInfo: GameInfo;
  onGameInfoChange: (info: GameInfo) => void;
  scoutingMode: boolean;
  onScoutingModeChange: (scouting: boolean) => void;
  players: Player[];
  onAddPlayer: (name: string, number: string, team: 'home' | 'away') => void;
  onRemovePlayer: (id: string) => void;
  onUpdatePlayer: (id: string, name: string, number: string) => void;
  onResetPlayers: () => void;
  appMode: 'game' | 'live' | 'practice';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  gameInfo,
  onGameInfoChange,
  scoutingMode,
  onScoutingModeChange,
  players,
  onAddPlayer,
  onRemovePlayer,
  onUpdatePlayer,
  onResetPlayers,
  appMode
}) => {
  if (!isOpen) return null;

  const handleInputChange = (field: keyof GameInfo, val: string) => {
    onGameInfoChange({
      ...gameInfo,
      [field]: val
    });
  };

  return (
    <div
      className="no-print"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px',
        boxSizing: 'border-box'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card animate-slide-in"
        style={{
          width: '840px',
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'rgba(18, 20, 28, 0.96)',
          border: '1px solid rgba(255, 107, 0, 0.3)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7), 0 0 40px rgba(255, 107, 0, 0.15)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          position: 'relative'
        }}
      >
        {/* 閉じるボタン */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'transparent',
            border: 'none',
            color: '#aaa',
            cursor: 'pointer',
            padding: '4px',
            transition: 'color 0.15s'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#aaa')}
        >
          <X size={20} />
        </button>

        {/* タイトル */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          <Settings size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>試合設定 ＆ 選手管理</h2>
        </div>

        {/* 二カラム構成 */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: '24px',
          alignItems: 'start'
        }}>
          {/* 左カラム: 試合詳細・スカウティング */}
          <div style={{
            flex: '1 1 300px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid var(--glass-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--accent-color)', margin: '0 0 4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                試合・練習の詳細
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', color: '#888', fontWeight: 600 }}>
                  {appMode === 'practice' ? '練習名' : '試合名・イベント名'}
                </label>
                <input
                  type="text"
                  value={gameInfo.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  className="input-field"
                  placeholder={appMode === 'practice' ? "例: 新チーム自主練習" : "例: インターハイ 1回戦"}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', color: '#888', fontWeight: 600 }}>日付</label>
                <input
                  type="date"
                  value={gameInfo.date}
                  onChange={(e) => handleInputChange('date', e.target.value)}
                  className="input-field"
                />
              </div>

              {appMode !== 'practice' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                  <label style={{ fontSize: '0.8rem', color: '#888', fontWeight: 600 }}>対戦相手</label>
                  <input
                    type="text"
                    value={gameInfo.opponent}
                    onChange={(e) => handleInputChange('opponent', e.target.value)}
                    className="input-field"
                    placeholder="相手チーム名"
                  />
                </div>
              )}
            </div>

            {/* スカウティングモード設定 (練習モード以外) */}
            {appMode !== 'practice' && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.01)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--accent-color)', margin: '0', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                  スカウティングモード
                </h3>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left', flex: 1, paddingRight: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {scoutingMode ? <Eye size={15} style={{ color: 'var(--color-danger)' }} /> : <EyeOff size={15} style={{ color: '#888' }} />}
                      個別記録モード
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#888', lineHeight: 1.4 }}>
                      ONにすると、相手チームの選手を個別に登録・スタッツ集計します。OFF時はチーム全体のスタッツとして簡略化されます。
                    </span>
                  </div>

                  <button
                    onClick={() => onScoutingModeChange(!scoutingMode)}
                    className="btn"
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.75rem',
                      background: scoutingMode ? 'var(--color-danger)' : 'var(--bg-tertiary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  >
                    {scoutingMode ? 'ON (有効)' : 'OFF (無効)'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右カラム: 選手管理 */}
          <div style={{
            flex: '1.2 1 360px',
            maxWidth: '100%'
          }}>
            <PlayerManager
              players={players}
              onAddPlayer={onAddPlayer}
              onRemovePlayer={onRemovePlayer}
              onUpdatePlayer={onUpdatePlayer}
              onResetPlayers={onResetPlayers}
              scoutingMode={scoutingMode}
              onScoutingModeChange={onScoutingModeChange}
              appMode={appMode}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
