import type { Quarter } from '../types';
import { formatTime } from '../utils/statsHelper';
import { Play, Pause, RotateCcw, Plus, Minus, Shield, ShieldAlert } from 'lucide-react';

interface LiveTimerProps {
  liveTime: number;
  liveTimerActive: boolean;
  livePeriodLength: number;
  onToggleTimer: () => void;
  onAdjustTimer: (amount: number) => void;
  onResetTimer: () => void;
  onPeriodLengthChange: (length: number) => void;
  currentQuarter: Quarter;
  onQuarterChange: (q: Quarter) => void;
  
  // スコア連動表示用
  homeScore: number;
  awayScore: number;
  opponentName: string;
  isCompact?: boolean;
}

export const LiveTimer: React.FC<LiveTimerProps> = ({
  liveTime,
  liveTimerActive,
  livePeriodLength,
  onToggleTimer,
  onAdjustTimer,
  onResetTimer,
  onPeriodLengthChange,
  currentQuarter,
  onQuarterChange,
  homeScore,
  awayScore,
  opponentName,
  isCompact = false
}) => {
  const quarters: Quarter[] = ['1Q', '2Q', '3Q', '4Q', 'OT'];

  // クオーター規定時間の選択肢 (秒数)
  const lengthOptions = [
    { label: '10分 (公式)', value: 600 },
    { label: '8分 (中学公式)', value: 480 },
    { label: '5分', value: 300 },
    { label: '2分 (テスト用)', value: 120 }
  ];

  if (isCompact) {
    return (
      <div className="glass-card animate-slide-in" style={{ 
        padding: '8px 16px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '6px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* 上段: クオーター切り替えタブ ＆ 規定時間設定 */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          flexWrap: 'wrap',
          gap: '6px',
          borderBottom: '1px solid var(--glass-border)', 
          paddingBottom: '4px' 
        }}>
          {/* クオータータブ */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {quarters.map(q => (
              <button
                key={q}
                onClick={() => onQuarterChange(q)}
                className="btn"
                style={{
                  background: currentQuarter === q ? 'var(--accent-color)' : 'rgba(255,255,255,0.02)',
                  borderColor: currentQuarter === q ? 'var(--accent-color)' : 'var(--glass-border)',
                  color: currentQuarter === q ? '#fff' : '#aaa',
                  padding: '3px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  border: '1px solid'
                }}
              >
                {q}
              </button>
            ))}
          </div>

          {/* 規定時間設定 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.7rem', color: '#888' }}>時間:</span>
            <select
              value={livePeriodLength}
              onChange={(e) => onPeriodLengthChange(parseInt(e.target.value))}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--glass-border)',
                color: '#ccc',
                fontSize: '0.7rem',
                padding: '1px 4px',
                borderRadius: '4px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {lengthOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label.split(' ')[0]} {/* 短縮表示 */}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 中段: スコア ＆ コンパクトタイマー */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 2fr 1fr', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: '8px',
          padding: '0'
        }}>
          {/* 自チームスコア */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--accent-color)' }}>自チーム</span>
            <span className="score-home-glow" style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--accent-color)', lineHeight: 1, letterSpacing: '-1px' }}>{homeScore}</span>
          </div>

          {/* タイマー表示 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            <div
              style={{
                fontSize: '3.0rem',
                fontWeight: 800,
                fontFamily: 'monospace',
                color: liveTimerActive ? '#fff' : 'var(--accent-color)',
                textShadow: liveTimerActive ? '0 0 10px rgba(255,255,255,0.2)' : '0 0 10px var(--accent-glow)',
                lineHeight: 1,
                letterSpacing: '1px',
                transition: 'color 0.2s'
              }}
            >
              {formatTime(liveTime)}
            </div>
            {liveTime === 0 && (
              <div style={{ position: 'absolute', bottom: '-12px', color: 'var(--color-danger)', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.5px' }}>
                🔔 ブザー
              </div>
            )}
          </div>

          {/* 相手チームスコア */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-danger)', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {opponentName || '相手チーム'}
            </span>
            <span className="score-away-glow" style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--color-danger)', lineHeight: 1, letterSpacing: '-1px' }}>{awayScore}</span>
          </div>
        </div>

        {/* 下段: コントロールボタン ＆ 微調整 */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          gap: '12px',
          paddingTop: '2px',
          marginTop: '2px'
        }}>
          {/* スタート / 一時停止 ＆ リセット */}
          <div style={{ display: 'flex', gap: '4px', flex: 1.2 }}>
            <button
              onClick={onToggleTimer}
              className="btn"
              style={{
                flex: 1,
                background: liveTimerActive ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent-color)',
                borderColor: liveTimerActive ? 'var(--color-danger)' : 'var(--accent-color)',
                color: '#fff',
                fontSize: '0.8rem',
                fontWeight: 700,
                padding: '6px 10px',
                border: '1px solid',
                boxShadow: liveTimerActive ? 'none' : '0 2px 6px var(--accent-glow)',
                gap: '4px'
              }}
            >
              {liveTimerActive ? <Pause size={12} /> : <Play size={12} />}
              {liveTimerActive ? '一時停止' : 'スタート'}
            </button>

            <button
              onClick={onResetTimer}
              className="btn btn-secondary"
              style={{ padding: '6px 8px' }}
              title="既定時間にリセット"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          {/* 微調整 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1.8, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: '0.6rem', color: '#777', whiteSpace: 'nowrap', marginRight: '1px' }}>微調整:</span>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button onClick={() => onAdjustTimer(-10)} className="btn btn-secondary" style={{ padding: '3px 5px', fontSize: '0.6rem', minWidth: '28px' }}>
                -10s
              </button>
              <button onClick={() => onAdjustTimer(-1)} className="btn btn-secondary" style={{ padding: '3px 5px', fontSize: '0.6rem', minWidth: '22px' }}>
                -1s
              </button>
              <button onClick={() => onAdjustTimer(1)} className="btn btn-secondary" style={{ padding: '3px 5px', fontSize: '0.6rem', minWidth: '22px' }}>
                +1s
              </button>
              <button onClick={() => onAdjustTimer(10)} className="btn btn-secondary" style={{ padding: '3px 5px', fontSize: '0.6rem', minWidth: '28px' }}>
                +10s
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card animate-slide-in" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', justifyContent: 'center', minHeight: '420px' }}>
      
      {/* 上部クオーター切り替えタブ */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '14px', width: '100%', justifyContent: 'center' }}>
        {quarters.map(q => (
          <button
            key={q}
            onClick={() => onQuarterChange(q)}
            className="btn"
            style={{
              background: currentQuarter === q ? 'var(--accent-color)' : 'rgba(255,255,255,0.02)',
              borderColor: currentQuarter === q ? 'var(--accent-color)' : 'var(--glass-border)',
              color: currentQuarter === q ? '#fff' : '#aaa',
              padding: '6px 14px',
              fontSize: '0.8rem',
              fontWeight: 600,
              border: '1px solid'
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* スコアボード表示 (Home VS Away) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '48px', width: '100%', justifyContent: 'center', marginTop: '10px' }}>
        {/* 自チームスコア */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-color)' }}>
            <Shield size={16} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#aaa' }}>自チーム</span>
          </div>
          <span className="score-home-glow" style={{ fontSize: '4.5rem', fontWeight: 900, color: 'var(--accent-color)', lineHeight: 1, letterSpacing: '-2px' }}>{homeScore}</span>
        </div>

        <div className="vs-divider">
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#555', letterSpacing: '2px' }}>VS</span>
        </div>

        {/* 相手チームスコア */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-danger)' }}>
            <ShieldAlert size={16} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#aaa' }}>{opponentName || '相手チーム'}</span>
          </div>
          <span className="score-away-glow" style={{ fontSize: '4.5rem', fontWeight: 900, color: 'var(--color-danger)', lineHeight: 1, letterSpacing: '-2px' }}>{awayScore}</span>
        </div>
      </div>

      {/* 大型ゲームタイマー */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', marginTop: '16px', position: 'relative' }}>
        <span style={{ fontSize: '0.7rem', color: '#888', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}>
          {currentQuarter} GAME CLOCK
        </span>
        <div
          style={{
            fontSize: '5.5rem',
            fontWeight: 800,
            fontFamily: 'monospace',
            color: liveTimerActive ? '#fff' : 'var(--accent-color)',
            textShadow: liveTimerActive ? '0 0 20px rgba(255,255,255,0.2)' : '0 0 20px var(--accent-glow)',
            lineHeight: 1,
            letterSpacing: '1px',
            transition: 'color 0.2s'
          }}
        >
          {formatTime(liveTime)}
        </div>
        {liveTime === 0 && (
          <div style={{ position: 'absolute', bottom: '-20px', color: 'var(--color-danger)', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '1px' }}>
            🔔 クオーター終了 (ブザー)
          </div>
        )}
      </div>

      {/* タイマーコントロールボタン */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', width: '100%', maxWidth: '380px', marginTop: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          {/* スタート / 一時停止 */}
          <button
            onClick={onToggleTimer}
            className="btn"
            style={{
              flex: 1,
              background: liveTimerActive ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent-color)',
              borderColor: liveTimerActive ? 'var(--color-danger)' : 'var(--accent-color)',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 700,
              padding: '12px',
              border: '1px solid',
              boxShadow: liveTimerActive ? 'none' : '0 4px 14px var(--accent-glow)',
              gap: '8px'
            }}
          >
            {liveTimerActive ? (
              <>
                <Pause size={18} /> タイマー一時停止
              </>
            ) : (
              <>
                <Play size={18} /> タイマースタート
              </>
            )}
          </button>

          {/* リセット */}
          <button
            onClick={onResetTimer}
            className="btn btn-secondary"
            style={{ padding: '12px 16px' }}
            title="既定時間にリセット"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {/* 微調整用ボタン (±1秒、±10秒) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          <span style={{ fontSize: '0.75rem', color: '#777', textAlign: 'center' }}>時計の押し遅れ微調整：</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            <button onClick={() => onAdjustTimer(-10)} className="btn btn-secondary" style={{ padding: '6px', fontSize: '0.75rem', gap: '2px' }}>
              <Minus size={10} />10s
            </button>
            <button onClick={() => onAdjustTimer(-1)} className="btn btn-secondary" style={{ padding: '6px', fontSize: '0.75rem', gap: '2px' }}>
              <Minus size={10} />1s
            </button>
            <button onClick={() => onAdjustTimer(1)} className="btn btn-secondary" style={{ padding: '6px', fontSize: '0.75rem', gap: '2px' }}>
              <Plus size={10} />1s
            </button>
            <button onClick={() => onAdjustTimer(10)} className="btn btn-secondary" style={{ padding: '6px', fontSize: '0.75rem', gap: '2px' }}>
              <Plus size={10} />10s
            </button>
          </div>
        </div>
      </div>

      {/* 規定時間設定セレクター */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--glass-border)', paddingTop: '14px', width: '100%', justifyContent: 'center', marginTop: '6px' }}>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>クオーター規定時間:</span>
        <select
          value={livePeriodLength}
          onChange={(e) => onPeriodLengthChange(parseInt(e.target.value))}
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--glass-border)',
            color: '#ccc',
            fontSize: '0.8rem',
            padding: '4px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          {lengthOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 操作のヒント */}
      <p style={{ fontSize: '0.75rem', color: '#555', fontStyle: 'italic', marginTop: '6px' }}>
        ※ キーボードのスペースキーでもタイマーのスタート／ストップをトグル操作できます。
      </p>
    </div>
  );
};
