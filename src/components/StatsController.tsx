import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Player, StatType } from '../types';
import { getStatLabel, formatTime } from '../utils/statsHelper';
import { Shield, ShieldAlert, Award, Keyboard, Plus, Trash2, Clock, X, Play, Pause, Minus, Settings, Mic, MicOff } from 'lucide-react';

interface StatsControllerProps {
  players: Player[];
  selectedPlayerId: string | null;
  onSelectPlayer: (id: string | null) => void;
  activeTeam: 'home' | 'away';
  setActiveTeam: (team: 'home' | 'away') => void;
  onRecordStat: (type: StatType, team: 'home' | 'away', playerId: string | null, location?: { x: number; y: number }) => void;
  
  appMode: 'game' | 'practice' | 'live';
  scoutingMode: boolean;
  onCourtPlayerIds: string[]; // 現在コートに出場している選手ID(自チームのみ)
  startingPlayerIds: string[]; // クオーター開始時の選手ID(自チームのみ)
  onUpdateStartingPlayers: (ids: string[]) => void;
  onRecordSubstitution: (outPlayerId: string, inPlayerId: string) => void;
  
  practiceTags: string[];
  onAddPracticeTag: (tag: string) => void;
  onRemovePracticeTag: (tag: string) => void;
  onRecordPracticeEvent: (tagName: string) => void;

  // ゲームクロック（タイマー）用 Props
  liveTime: number;
  liveTimerActive: boolean;
  onToggleTimer: () => void;
  onAdjustTimer: (amount: number) => void;
  isLarge?: boolean;
}

export const StatsController: React.FC<StatsControllerProps> = ({
  players,
  activeTeam,
  setActiveTeam,
  onRecordStat,
  appMode,
  scoutingMode,
  onCourtPlayerIds,
  startingPlayerIds,
  onUpdateStartingPlayers,
  onRecordSubstitution,
  practiceTags,
  onAddPracticeTag,
  onRemovePracticeTag,
  onRecordPracticeEvent,
  liveTime,
  liveTimerActive,
  onToggleTimer,
  onAdjustTimer,
  isLarge = false
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false);

  // --- 音声入力用ステート & ロジック ---
  const [isListening, setIsListening] = useState(false);
  const [speechFeedback, setSpeechFeedback] = useState<string>('');
  const [speechError, setSpeechError] = useState<string>('');
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'ja-JP';

    rec.onstart = () => {
      setIsListening(true);
      setSpeechFeedback('音声アシスタント起動中...（例：「7番 アシスト」「相手 ターンオーバー」）');
      setSpeechError('');
    };

    rec.onerror = (event: any) => {
      console.error('Speech error:', event.error);
      if (event.error === 'not-allowed') {
        setSpeechError('マイクの使用許可が必要です。');
      } else {
        setSpeechError(`エラー: ${event.error}`);
      }
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
    };

    rec.onresult = (event: any) => {
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript.trim().toLowerCase();
      console.log('Recognized speech:', transcript);
      setSpeechFeedback(`認識: 「${transcript}」`);
      processSpeechCommand(transcript);
    };

    setRecognitionInstance(rec);

    return () => {
      try {
        rec.abort();
      } catch (e) {}
    };
  }, []);

  const processSpeechCommand = (text: string) => {
    // 1. チームの判別
    let team: 'home' | 'away' = 'home';
    if (text.includes('相手') || text.includes('あいて') || text.includes('敵') || text.includes('アウェイ') || text.includes('他')) {
      team = 'away';
    }

    // 2. 選手の判別 (自チームのみ)
    let matchedPlayer: Player | null = null;
    if (team === 'home') {
      // 背番号の数字をマッチング (例: 「7番」「7」「07」)
      const numMatch = text.match(/(\d+)[\s　]*番?/);
      if (numMatch) {
        const numberStr = numMatch[1];
        const normalizedNum = parseInt(numberStr).toString();
        const p = players.find(x => x.team === 'home' && (x.number === numberStr || parseInt(x.number).toString() === normalizedNum));
        if (p) {
          matchedPlayer = p;
        }
      }

      // 名前部分一致の確認 (番号で見つからなかった場合)
      if (!matchedPlayer) {
        for (const p of players) {
          if (p.team === 'home' && p.name) {
            const shortName = p.name.split(' ')[0].toLowerCase();
            const fullName = p.name.replace(/\s+/g, '').toLowerCase();
            const cleanText = text.replace(/\s+/g, '').toLowerCase();
            if (cleanText.includes(fullName) || cleanText.includes(shortName)) {
              matchedPlayer = p;
              break;
            }
          }
        }
      }
    }

    // 3. アクション（スタッツ）の判別
    let actionType: StatType | null = null;
    const cleanText = text.replace(/\s+/g, '');

    // 得点・シュート
    if (cleanText.includes('3p成功') || cleanText.includes('スリー成功') || cleanText.includes('3p得点') || cleanText.includes('3点成功') || cleanText.includes('スリーポイント成功') || cleanText.includes('3ポイント成功') || cleanText.includes('スリーイン')) {
      actionType = '3P_MADE';
    } else if (cleanText.includes('3p失敗') || cleanText.includes('スリー失敗') || cleanText.includes('3pミス') || cleanText.includes('スリーミス') || cleanText.includes('3ポイント失敗')) {
      actionType = '3P_MISS';
    } else if (cleanText.includes('2p成功') || cleanText.includes('シュート成功') || cleanText.includes('2p得点') || cleanText.includes('2点成功') || cleanText.includes('2点イン') || cleanText.includes('シュートイン') || cleanText.includes('得点')) {
      actionType = '2P_MADE';
    } else if (cleanText.includes('2p失敗') || cleanText.includes('シュート失敗') || cleanText.includes('2pミス') || cleanText.includes('2点失敗')) {
      actionType = '2P_MISS';
    } else if (cleanText.includes('フリースロー成功') || cleanText.includes('ft成功') || cleanText.includes('1点成功') || cleanText.includes('フリースローイン')) {
      actionType = 'FT_MADE';
    } else if (cleanText.includes('フリースロー失敗') || cleanText.includes('ft失敗') || cleanText.includes('ftミス')) {
      actionType = 'FT_MISS';
    } 
    // アシスト
    else if (cleanText.includes('アシスト') || cleanText.includes('パス')) {
      actionType = 'AST';
    } 
    // リバウンド
    else if (cleanText.includes('オフェンスリバウンド') || cleanText.includes('オフェンスリバ') || cleanText.includes('oリバ') || cleanText.includes('攻リバ')) {
      actionType = 'OREB';
    } else if (cleanText.includes('ディフェンスリバウンド') || cleanText.includes('ディフェンスリバ') || cleanText.includes('dリバ') || cleanText.includes('防リバ') || cleanText.includes('リバウンド')) {
      actionType = cleanText.includes('オフェンス') ? 'OREB' : 'DREB';
    } 
    // その他スタッツ
    else if (cleanText.includes('スチール') || cleanText.includes('スティール') || cleanText.includes('カット') || cleanText.includes('パスカット') || cleanText.includes('奪った')) {
      actionType = 'STL';
    } else if (cleanText.includes('ブロック') || cleanText.includes('はたき') || cleanText.includes('シュートブロック')) {
      actionType = 'BLK';
    } else if (cleanText.includes('ターンオーバー') || cleanText.includes('ミス') || cleanText.includes('to') || cleanText.includes('ト')) {
      actionType = 'TO';
    } else if (cleanText.includes('ファウル') || cleanText.includes('ファール')) {
      actionType = 'PF';
    }

    if (actionType) {
      const playerId = matchedPlayer ? matchedPlayer.id : null;
      // Record stat directly
      onRecordStat(actionType, team, playerId);
      
      const targetName = team === 'away' ? '相手チーム全体' : (matchedPlayer ? `#${matchedPlayer.number} ${matchedPlayer.name}` : '自チーム全体');
      const actionLabel = getStatLabel(actionType);
      
      setSpeechFeedback(`【記録】${targetName} ➜ ${actionLabel}`);

      // Clear feedback after 4 seconds
      setTimeout(() => {
        setSpeechFeedback(prev => prev.startsWith('【記録】') ? '' : prev);
      }, 4000);
    } else {
      setSpeechFeedback(`一致するスタッツがありません: 「${text}」`);
    }
  };

  const toggleListening = () => {
    if (!recognitionInstance) {
      alert('音声認識がサポートされていません。Google Chrome、Safari等のマイク対応ブラウザを使用してください。');
      return;
    }
    if (isListening) {
      recognitionInstance.stop();
    } else {
      try {
        recognitionInstance.start();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const [showStart5Modal, setShowStart5Modal] = useState(false);
  const [tempStartingIds, setTempStartingIds] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');

  // --- 新ワークフロー用のステート ---
  const [pendingAction, setPendingAction] = useState<{
    type: StatType;
    team: 'home' | 'away';
    location?: { x: number; y: number };
  } | null>(null);

  const [reboundStepAction, setReboundStepAction] = useState<{
    shotTeam: 'home' | 'away';
    type: StatType;
  } | null>(null);

  const [showShotRangeModal, setShowShotRangeModal] = useState(false);
  const [subSelectStep, setSubSelectStep] = useState<'none' | 'select-out' | 'select-in'>('none');
  const [subOutPlayerId, setSubOutPlayerId] = useState<string | null>(null);

  // アクション開始のトリガー（ボタン押下またはショートカット）
  const handleTriggerAction = (type: StatType, team: 'home' | 'away') => {
    if (type === 'TIMEOUT') {
      onRecordStat('TIMEOUT', team, null);
      return;
    }

    // 相手チームでスカウティングモードがオフの場合は、ポップアップを挟まずに即座に記録
    if (team === 'away' && !scoutingMode) {
      onRecordStat(type, 'away', null);
      
      // シュート失敗（2P失敗、3P失敗）の場合は、続けてリバウンド登録画面へ
      const isMissedShot = ['2P_MISS', '3P_MISS'].includes(type);
      if (isMissedShot) {
        setReboundStepAction({
          shotTeam: 'away',
          type: type
        });
      }
      return;
    }

    const isShot = ['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS'].includes(type);
    setPendingAction({ type, team });

    if (isShot) {
      setShowShotRangeModal(true);
    } else {
      setShowShotRangeModal(false);
    }
  };

  const gameShortcuts: Record<string, { type: StatType | 'SUB'; label: string }> = {
    '1': { type: '2P_MADE', label: '2P成功' },
    '2': { type: '2P_MISS', label: '2P失敗' },
    '3': { type: '3P_MADE', label: '3P成功' },
    '4': { type: '3P_MISS', label: '3P失敗' },
    'q': { type: 'FT_MADE', label: 'FT成功' },
    'w': { type: 'FT_MISS', label: 'FT失敗' },
    'a': { type: 'AST', label: 'アシスト' },
    'r': { type: 'OREB', label: 'オフェンスリバウンド' },
    'd': { type: 'DREB', label: 'ディフェンスリバウンド' },
    's': { type: 'STL', label: 'スティール' },
    'b': { type: 'BLK', label: 'ブロック' },
    't': { type: 'TO', label: 'ターンオーバー' },
    'f': { type: 'PF', label: 'ファウル' },
    'x': { type: 'SUB', label: '選手交代' }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      
      // ポップアップが出ているときのEscキーによるキャンセル
      if (e.key === 'Escape') {
        setPendingAction(null);
        setReboundStepAction(null);
        setShowShotRangeModal(false);
        setSubSelectStep('none');
        setSubOutPlayerId(null);
        setShowStart5Modal(false);
        return;
      }

      if (key === ' ') return; // スペースは再生トグル用

      if (appMode === 'practice') {
        const num = parseInt(key);
        if (!isNaN(num) && num >= 1 && num <= practiceTags.length) {
          e.preventDefault();
          onRecordPracticeEvent(practiceTags[num - 1]);
        }
      } else {
        const shortcut = gameShortcuts[key];
        if (shortcut) {
          e.preventDefault();
          
          if (shortcut.type === 'SUB') {
            setSubSelectStep('select-out');
            setSubOutPlayerId(null);
          } else {
            handleTriggerAction(shortcut.type as StatType, activeTeam);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTeam, appMode, practiceTags, pendingAction]);

  const homePlayers = players.filter(p => p.team === 'home');
  const awayPlayers = players.filter(p => p.team === 'away');

  const statButtons: { type: StatType | 'SUB'; color: string; key: string; colorClass: string; icon: string }[] = [
    { type: '2P_MADE', color: 'var(--color-success)', key: '1', colorClass: 'stat-btn-success', icon: '✓' },
    { type: '2P_MISS', color: 'var(--color-danger)', key: '2', colorClass: 'stat-btn-danger', icon: '✗' },
    { type: '3P_MADE', color: 'var(--color-success)', key: '3', colorClass: 'stat-btn-success', icon: '✓' },
    { type: '3P_MISS', color: 'var(--color-danger)', key: '4', colorClass: 'stat-btn-danger', icon: '✗' },
    { type: 'FT_MADE', color: 'var(--color-success)', key: 'q', colorClass: 'stat-btn-success', icon: '✓' },
    { type: 'FT_MISS', color: 'var(--color-danger)', key: 'w', colorClass: 'stat-btn-danger', icon: '✗' },
    { type: 'AST', color: 'var(--color-info)', key: 'a', colorClass: 'stat-btn-info', icon: '→' },
    { type: 'OREB', color: 'var(--color-info)', key: 'r', colorClass: 'stat-btn-info', icon: '↑' },
    { type: 'DREB', color: 'var(--color-info)', key: 'd', colorClass: 'stat-btn-info', icon: '↑' },
    { type: 'STL', color: 'var(--color-purple)', key: 's', colorClass: 'stat-btn-purple', icon: '⚡' },
    { type: 'BLK', color: 'var(--color-purple)', key: 'b', colorClass: 'stat-btn-purple', icon: '🛡' },
    { type: 'TO', color: 'var(--color-danger)', key: 't', colorClass: 'stat-btn-danger', icon: '✗' },
    { type: 'PF', color: 'var(--color-danger)', key: 'f', colorClass: 'stat-btn-danger', icon: '!' },
    { type: 'SUB', color: 'var(--color-warning)', key: 'x', colorClass: 'stat-btn-warning', icon: '⇄' }
  ];

  const handleStart5Open = () => {
    const validHomePlayerIds = homePlayers.map(p => p.id);
    const filteredStarters = startingPlayerIds.filter(id => validHomePlayerIds.includes(id));
    setTempStartingIds(filteredStarters);
    setShowStart5Modal(true);
  };

  const handleToggleStarterSelection = (playerId: string) => {
    if (tempStartingIds.includes(playerId)) {
      setTempStartingIds(tempStartingIds.filter(id => id !== playerId));
    } else {
      if (tempStartingIds.length >= 5) {
        alert('スターティングメンバーは5名までです。');
        return;
      }
      setTempStartingIds([...tempStartingIds, playerId]);
    }
  };

  const handleSaveStartingPlayers = () => {
    onUpdateStartingPlayers(tempStartingIds);
    setShowStart5Modal(false);
  };

  // 通常スタッツアクションの選手選択
  const handleSelectPlayerForAction = (playerId: string | null) => {
    if (!pendingAction) return;
    onRecordStat(pendingAction.type, pendingAction.team, playerId, pendingAction.location);
    
    // シュート失敗（2P失敗、3P失敗）の場合は、続けてリバウンド登録画面へ
    const isMissedShot = ['2P_MISS', '3P_MISS'].includes(pendingAction.type);
    if (isMissedShot) {
      setReboundStepAction({
        shotTeam: pendingAction.team,
        type: pendingAction.type
      });
    }
    
    setPendingAction(null);
  };

  // リバウンドの登録
  const handleRecordRebound = (type: 'OREB' | 'DREB', team: 'home' | 'away', playerId: string | null) => {
    onRecordStat(type, team, playerId);
    setReboundStepAction(null);
  };

  // ポップアップ内でのコートクリック処理
  const handleCourtClickInPopup = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pendingAction) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 95;

    // 位置情報を追加して位置選択を終了し、選手選択ポップアップに移行する
    setPendingAction(prev => prev ? { ...prev, location: { x, y } } : null);
    setShowShotRangeModal(false);
  };

  // シュート位置を記録しない（スキップ）
  const handleSkipShotLocation = () => {
    setShowShotRangeModal(false);
  };

  // 交代OUT選手の決定
  const handleSelectOutPlayer = (playerId: string) => {
    setSubOutPlayerId(playerId);
    setSubSelectStep('select-in');
  };

  // 交代IN選手の決定（交代の確定）
  const handleSelectInPlayer = (playerId: string) => {
    if (!subOutPlayerId) return;
    onRecordSubstitution(subOutPlayerId, playerId);
    setSubSelectStep('none');
    setSubOutPlayerId(null);
  };

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagInput.trim()) return;
    onAddPracticeTag(newTagInput.trim());
    setNewTagInput('');
  };

  return (
    <div className="glass-card" style={{ 
      padding: isLarge ? '12px 16px' : '12px 14px', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: isLarge ? '10px' : '8px' 
    }}>
      
      {/* 試合モード時のミニゲームタイマー表示 */}
      {appMode === 'game' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            marginBottom: '2px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={14} style={{ color: 'var(--accent-color)' }} />
            <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>試合時計:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'monospace', color: liveTimerActive ? '#fff' : 'var(--accent-color)' }}>
              {formatTime(liveTime)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* スタート / ストップ */}
            <button
              onClick={onToggleTimer}
              className="btn"
              style={{
                width: '26px',
                height: '26px',
                padding: 0,
                borderRadius: '50%',
                background: liveTimerActive ? 'rgba(239, 68, 68, 0.2)' : 'var(--accent-color)',
                borderColor: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title={liveTimerActive ? '時計停止' : '時計再開'}
            >
              {liveTimerActive ? <Pause size={10} /> : <Play size={10} fill="#fff" />}
            </button>

            {/* 微調整 */}
            <button
              onClick={() => onAdjustTimer(-1)}
              className="btn btn-secondary"
              style={{ width: '26px', height: '26px', padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="1秒戻す"
            >
              <Minus size={8} />
            </button>
            <button
              onClick={() => onAdjustTimer(1)}
              className="btn btn-secondary"
              style={{ width: '26px', height: '26px', padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="1秒進む"
            >
              <Plus size={8} />
            </button>
          </div>
        </div>
      )}

      {/* ヘッダーとショートカット */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', paddingBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Award size={isLarge ? 20 : 16} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ fontSize: isLarge ? '1.2rem' : '1rem', fontWeight: 600 }}>
            {appMode === 'practice' ? '練習タグ記録' : 'スタッツ入力'}
          </h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {appMode !== 'practice' && (
            <button
              onClick={handleStart5Open}
              className="btn btn-secondary"
              style={{ 
                padding: isLarge ? '6px 12px' : '3px 6px', 
                fontSize: isLarge ? '0.85rem' : '0.7rem', 
                gap: '4px' 
              }}
            >
              <Settings size={isLarge ? 14 : 12} /> スタート5設定
            </button>
          )}
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className={`btn ${showShortcuts ? 'btn-primary' : 'btn-secondary'}`}
            style={{ 
              padding: isLarge ? '6px 12px' : '3px 6px', 
              fontSize: isLarge ? '0.85rem' : '0.7rem', 
              gap: '4px' 
            }}
          >
            <Keyboard size={isLarge ? 14 : 12} /> ショートカット
          </button>
        </div>
      </div>

      {/* 音声スタッツ入力アシスタント・コントロールパネル */}
      {recognitionInstance && appMode !== 'practice' && (
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            background: isListening ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            border: `1px solid ${isListening ? 'rgba(239, 68, 68, 0.25)' : 'var(--glass-border)'}`,
            borderRadius: 'var(--radius-sm)',
            marginTop: '6px',
            boxShadow: isListening ? '0 0 10px rgba(239, 68, 68, 0.25)' : 'none',
            transition: 'all var(--transition-fast)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
            {isListening ? (
              <Mic size={14} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
            ) : (
              <MicOff size={14} style={{ color: '#666', flexShrink: 0 }} />
            )}
            <span 
              style={{ 
                fontSize: '0.75rem', 
                color: isListening ? '#ff8888' : '#888',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1
              }}
              title={speechError || speechFeedback || '音声スタッツ入力はオフです'}
            >
              {speechError ? `⚠️ ${speechError}` : (isListening ? (speechFeedback || '音声聞き取り中...（例：「7番 アシスト」）') : '音声アシスタントは停止中')}
            </span>
            {(speechFeedback || speechError) && (
              <button 
                onClick={() => { setSpeechFeedback(''); setSpeechError(''); }}
                style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }}
              >
                <X size={10} />
              </button>
            )}
          </div>
          <button
            onClick={toggleListening}
            className={`btn ${isListening ? 'btn-danger' : 'btn-secondary'}`}
            style={{
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 700,
              borderRadius: '4px',
              cursor: 'pointer',
              flexShrink: 0,
              marginLeft: '8px'
            }}
          >
            {isListening ? '停止' : '有効化'}
          </button>
        </div>
      )}

      {/* ショートカットヘルプ */}
      {showShortcuts && (
        <div className="animate-slide-in" style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)', fontSize: '0.75rem', maxHeight: '130px', overflowY: 'auto' }}>
          <p style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--accent-color)' }}>
            {appMode === 'game' || appMode === 'live' ? 'キーボードショートカット一覧' : '練習タグ記録用ショートカット'}
          </p>
          {appMode === 'game' || appMode === 'live' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {Object.entries(gameShortcuts).map(([key, item]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 4px', background: 'rgba(255,255,255,0.02)', borderRadius: '2px' }}>
                  <span>{item.label}</span>
                  <kbd style={{ background: '#333', padding: '0px 4px', borderRadius: '2px', fontWeight: 'bold' }}>{key.toUpperCase()}</kbd>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <p style={{ color: '#aaa' }}>数字キーを押して練習タグを記録できます：</p>
              {practiceTags.map((tag, idx) => (
                <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 4px', background: 'rgba(255,255,255,0.02)' }}>
                  <span>{tag}</span>
                  <kbd style={{ background: '#333', padding: '0px 4px', borderRadius: '2px', fontWeight: 'bold' }}>{idx + 1}</kbd>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- 練習モード時のUI --- */}
      {appMode === 'practice' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <form onSubmit={handleAddTagSubmit} style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              placeholder="新しい練習タグ"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              className="input-field"
              style={{ flex: 1, fontSize: '0.8rem', padding: '6px 10px' }}
            />
            <button type="submit" className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '0.8rem' }}>
              <Plus size={14} /> 追加
            </button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 500 }}>タグを記録する（現在時間）：</span>
            {practiceTags.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#666', textAlign: 'center', padding: '6px 0' }}>タグがありません。</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '150px', overflowY: 'auto' }}>
                {practiceTags.map((tag, idx) => (
                  <div
                     key={tag}
                     style={{
                       display: 'flex',
                       alignItems: 'center',
                       background: 'rgba(255,255,255,0.02)',
                       border: '1px solid var(--glass-border)',
                       borderRadius: 'var(--radius-sm)',
                       padding: '2px 8px',
                       justifyContent: 'space-between'
                     }}
                  >
                    <button
                      onClick={() => onRecordPracticeEvent(tag)}
                      className="btn"
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        textAlign: 'left',
                        justifyContent: 'flex-start',
                        padding: '4px 0',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: 'var(--accent-color)'
                      }}
                    >
                      <span>{idx + 1}. {tag}</span>
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <kbd style={{ background: '#222', padding: '1px 4px', fontSize: '0.7rem', color: '#888', borderRadius: '2px' }}>{idx + 1}</kbd>
                      <button
                        onClick={() => onRemovePracticeTag(tag)}
                        style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* --- 試合モード ＆ ライブモードのスタッツ入力UI --- */
        <div style={{ display: 'flex', flexDirection: 'column', gap: isLarge ? '10px' : '8px' }}>
          
          {isLarge ? (
            // Live mode layout: Team select + timeouts in 1 row, scouting toggle below
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr', gap: '8px' }}>
                <button
                  onClick={() => {
                    setActiveTeam('home');
                  }}
                  className="btn"
                  style={{
                    background: activeTeam === 'home' ? 'rgba(255, 107, 0, 0.15)' : 'rgba(0,0,0,0.2)',
                    border: '1px solid',
                    borderColor: activeTeam === 'home' ? 'var(--accent-color)' : 'var(--glass-border)',
                    color: activeTeam === 'home' ? 'var(--accent-color)' : '#aaa',
                    gap: '6px',
                    padding: '10px 14px',
                    fontSize: '0.95rem',
                    fontWeight: 700
                  }}
                >
                  <Shield size={16} /> 自チーム
                </button>
                <button
                  onClick={() => {
                    setActiveTeam('away');
                  }}
                  className="btn"
                  style={{
                    background: activeTeam === 'away' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0,0,0,0.2)',
                    border: '1px solid',
                    borderColor: activeTeam === 'away' ? 'var(--color-danger)' : 'var(--glass-border)',
                    color: activeTeam === 'away' ? 'var(--color-danger)' : '#aaa',
                    gap: '6px',
                    padding: '10px 14px',
                    fontSize: '0.95rem',
                    fontWeight: 700
                  }}
                >
                  <ShieldAlert size={16} /> 相手チーム
                </button>
                <button
                  onClick={() => onRecordStat('TIMEOUT', 'home', null)}
                  className="btn btn-secondary"
                  style={{ 
                    padding: '10px 14px', 
                    fontSize: '0.95rem', 
                    gap: '6px' 
                  }}
                >
                  <Clock size={16} style={{ color: 'var(--accent-color)' }} /> 自TO
                </button>
                <button
                  onClick={() => onRecordStat('TIMEOUT', 'away', null)}
                  className="btn btn-secondary"
                  style={{ 
                    padding: '10px 14px', 
                    fontSize: '0.95rem', 
                    gap: '6px' 
                  }}
                >
                  <Clock size={16} style={{ color: 'var(--color-danger)' }} /> 相手TO
                </button>
              </div>
            </div>
          ) : (
            // Standard mode layout: separate rows
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  onClick={() => {
                    setActiveTeam('home');
                  }}
                  className="btn"
                  style={{
                    background: activeTeam === 'home' ? 'rgba(255, 107, 0, 0.15)' : 'rgba(0,0,0,0.2)',
                    border: '1px solid',
                    borderColor: activeTeam === 'home' ? 'var(--accent-color)' : 'var(--glass-border)',
                    color: activeTeam === 'home' ? 'var(--accent-color)' : '#aaa',
                    gap: '6px',
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                    fontWeight: 500
                  }}
                >
                  <Shield size={14} /> 自チーム
                </button>
                <button
                  onClick={() => {
                    setActiveTeam('away');
                  }}
                  className="btn"
                  style={{
                    background: activeTeam === 'away' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0,0,0,0.2)',
                    border: '1px solid',
                    borderColor: activeTeam === 'away' ? 'var(--color-danger)' : 'var(--glass-border)',
                    color: activeTeam === 'away' ? 'var(--color-danger)' : '#aaa',
                    gap: '6px',
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                    fontWeight: 500
                  }}
                >
                  <ShieldAlert size={14} /> 相手チーム
                </button>
              </div>
            </div>
          )}

          {/* アクション記録 */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: isLarge ? '8px' : '6px', 
            borderTop: '1px solid var(--glass-border)', 
            paddingTop: isLarge ? '8px' : '6px' 
          }}>
            
            {/* タイムアウト (Standard mode only) */}
            {!isLarge && (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
                <button
                  onClick={() => onRecordStat('TIMEOUT', 'home', null)}
                  className="btn btn-secondary"
                  style={{ 
                    flex: 1, 
                    padding: '6px 8px', 
                    fontSize: '0.75rem', 
                    gap: '6px' 
                  }}
                >
                  <Clock size={12} style={{ color: 'var(--accent-color)' }} /> 自チームTO
                </button>
                <button
                  onClick={() => onRecordStat('TIMEOUT', 'away', null)}
                  className="btn btn-secondary"
                  style={{ 
                    flex: 1, 
                    padding: '6px 8px', 
                    fontSize: '0.75rem', 
                    gap: '6px' 
                  }}
                >
                  <Clock size={12} style={{ color: 'var(--color-danger)' }} /> 相手チームTO
                </button>
              </div>
            )}

            {/* オンコート選手一覧 (横長表示) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px', textAlign: 'left' }}>
              <span style={{ fontSize: isLarge ? '0.85rem' : '0.75rem', color: '#aaa', fontWeight: 500 }}>
                🏃 コート上の選手:
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingBottom: '4px' }}>
                {onCourtPlayerIds.map(id => {
                  const player = players.find(p => p.id === id);
                  if (!player) return null;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'rgba(255, 107, 0, 0.08)',
                        border: '1px solid rgba(255, 107, 0, 0.2)',
                        padding: isLarge ? '4px 10px' : '3px 6px',
                        borderRadius: '20px',
                        fontSize: isLarge ? '0.8rem' : '0.7rem',
                        color: '#fff',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: 'var(--accent-color)',
                        color: '#fff',
                        fontSize: isLarge ? '0.7rem' : '0.55rem',
                        fontWeight: 800
                      }}>
                        {player.number}
                      </span>
                      <span style={{ fontWeight: 600 }}>{player.name}</span>
                    </div>
                  );
                })}
                {onCourtPlayerIds.length === 0 && (
                  <span style={{ fontSize: '0.75rem', color: '#777', fontStyle: 'italic' }}>選手が設定されていません。「設定」または「スタート5設定」から選択してください。</span>
                )}
              </div>
            </div>

            {/* スタッツ入力ボタン群 */}
            <span style={{ fontSize: isLarge ? '0.9rem' : '0.75rem', color: '#aaa', fontWeight: 500 }}>スタッツアクション記録：</span>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: isLarge ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)', 
              gap: '8px' 
            }}>
              {statButtons.map((btn) => {
                let displayLabel = btn.type === 'SUB' ? '選手交代' : getStatLabel(btn.type);
                if (btn.type === 'OREB') displayLabel = 'Oリバウンド';
                if (btn.type === 'DREB') displayLabel = 'Dリバウンド';
                if (btn.type === 'TO') displayLabel = 'TO';
                const isDisabledForAway = activeTeam === 'away' && 
                  !scoutingMode && 
                  btn.type !== 'SUB' &&
                  !['2P_MADE', '2P_MISS', '3P_MADE', '3P_MISS', 'FT_MADE', 'FT_MISS', 'PF', 'TO'].includes(btn.type);

                if (isDisabledForAway) return null;

                return (
                  <button
                    key={btn.type}
                    onClick={() => {
                      if (btn.type === 'SUB') {
                        setSubSelectStep('select-out');
                        setSubOutPlayerId(null);
                      } else {
                        handleTriggerAction(btn.type, activeTeam);
                      }
                    }}
                    className={`btn stat-btn ${btn.colorClass}`}
                    style={{
                      borderLeft: `4px solid ${btn.color}`,
                      justifyContent: 'space-between',
                      padding: isLarge ? '10px 14px' : '9px 12px',
                      borderRadius: 'var(--radius-sm)'
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: isLarge ? '0.95rem' : '0.82rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontSize: isLarge ? '0.85rem' : '0.75rem', opacity: 0.8 }}>{btn.icon}</span>
                      {displayLabel}
                    </span>
                    <span className="key-badge">
                      {btn.key.toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 🎯 シュート位置（レンジ）選択ポップアップ */}
      {/* ============================================================== */}
      {showShotRangeModal && pendingAction && createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-card animate-slide-in" style={{
            width: '360px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            border: '1px solid var(--accent-color)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-color)' }}>
                🎯 シュート位置を選択
              </span>
              <button
                onClick={() => {
                  setShowShotRangeModal(false);
                  setPendingAction(null);
                }}
                style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#ccc', textAlign: 'center' }}>
              <strong>{getStatLabel(pendingAction.type)}</strong>: コートのシュートした位置をクリックしてください。
            </p>

            <div style={{ 
              position: 'relative', 
              width: '100%', 
              background: 'rgba(0,0,0,0.5)', 
              borderRadius: 'var(--radius-sm)', 
              border: '1px solid var(--glass-border)',
              overflow: 'hidden'
            }}>
              <svg
                viewBox="0 0 100 95"
                onClick={handleCourtClickInPopup}
                style={{ width: '100%', height: 'auto', cursor: 'crosshair', display: 'block' }}
              >
                {/* コート背景 */}
                <rect x="0" y="0" width="100" height="95" fill="rgba(0, 0, 0, 0.3)" />
                
                {/* 外枠 */}
                <rect x="0" y="0" width="100" height="95" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                
                {/* ペイント（制限区域） */}
                <rect x="33.6" y="0" width="32.8" height="41.4" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                
                {/* フリースローサークル */}
                <path d="M 33.6 41.4 A 16.4 16.4 0 0 0 66.4 41.4" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <path d="M 66.4 41.4 A 16.4 16.4 0 0 0 33.6 41.4" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2,2" />
                
                {/* 3ポイントライン */}
                <path d="M 6 0 L 6 21.3 A 44 48.2 0 0 0 94 21.3 L 94 0" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                
                {/* センターサークル */}
                <path d="M 38 95 A 12 12 0 0 1 62 95" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                
                {/* バックボード & リング */}
                <line x1="44" y1="8.6" x2="56" y2="8.6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                <line x1="50" y1="8.6" x2="50" y2="10" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                <circle cx="50" cy="11.25" r="2.25" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />

                {/* ノーチャージセミサークル */}
                <path d="M 41.7 11.25 A 8.3 8.3 0 0 0 58.3 11.25" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
              </svg>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={handleSkipShotLocation}
                className="btn btn-secondary"
                style={{ flex: 1, padding: '10px', fontSize: '0.85rem', fontWeight: 600 }}
              >
                位置を記録しない (スキップ)
              </button>
              <button
                onClick={() => {
                  setShowShotRangeModal(false);
                  setPendingAction(null);
                }}
                className="btn btn-danger"
                style={{ padding: '10px 14px', fontSize: '0.85rem' }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ============================================================== */}
      {/* 選手選択ポップアップ (通常スタッツアクション用オーバーレイ) */}
      {/* ============================================================== */}
      {!showShotRangeModal && pendingAction && createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-card animate-slide-in" style={{
            width: '320px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            border: '1px solid var(--accent-color)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-color)' }}>
                【{pendingAction.team === 'home' ? '自チーム' : '相手チーム'}】選手を選択
              </span>
              <button
                onClick={() => setPendingAction(null)}
                style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#ccc', textAlign: 'center' }}>
              <strong>{getStatLabel(pendingAction.type)}</strong> を記録します。対象選手を選択してください：
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pendingAction.team === 'home' ? (
                <>
                  {/* 自チームオンコートの5選手 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {homePlayers.filter(p => onCourtPlayerIds.includes(p.id)).map(player => (
                      <button
                        key={player.id}
                        onClick={() => handleSelectPlayerForAction(player.id)}
                        className="btn btn-primary"
                        style={{
                          justifyContent: 'flex-start',
                          padding: '10px 14px',
                          fontSize: '0.85rem',
                          background: 'rgba(255, 107, 0, 0.1)',
                          border: '1px solid var(--accent-color)',
                          color: '#fff',
                          fontWeight: 700
                        }}
                      >
                        <span style={{ minWidth: '24px' }}>#{player.number}</span>
                        <span>{player.name}</span>
                      </button>
                    ))}
                  </div>

                  {/* 自チーム全体 */}
                  <button
                    onClick={() => handleSelectPlayerForAction(null)}
                    className="btn btn-secondary"
                    style={{ padding: '10px', fontSize: '0.85rem', fontWeight: 600 }}
                  >
                    自チーム全体（選手指定なし）
                  </button>
                </>
              ) : (
                <>
                  {/* 相手チーム選手（スカウティングONの時のみ） */}
                  {scoutingMode && awayPlayers.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                      {awayPlayers.map(player => (
                        <button
                          key={player.id}
                          onClick={() => handleSelectPlayerForAction(player.id)}
                          className="btn"
                          style={{
                            justifyContent: 'flex-start',
                            padding: '8px 12px',
                            fontSize: '0.85rem',
                            background: 'rgba(239, 68, 68, 0.05)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#fff'
                          }}
                        >
                          <span style={{ minWidth: '24px', color: 'var(--color-danger)' }}>#{player.number}</span>
                          <span>{player.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {/* 相手チーム全体 */}
                  <button
                    onClick={() => handleSelectPlayerForAction(null)}
                    className="btn btn-secondary"
                    style={{ padding: '10px', fontSize: '0.85rem', fontWeight: 600 }}
                  >
                    相手チーム全体
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => setPendingAction(null)}
              className="btn btn-danger"
              style={{ width: '100%', padding: '8px', fontSize: '0.8rem', marginTop: '4px' }}
            >
              キャンセル (Esc)
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ============================================================== */}
      {/* 選手交代 (SUB) ポップアップフロー */}
      {/* ============================================================== */}
      {subSelectStep !== 'none' && createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-card animate-slide-in" style={{
            width: '320px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            border: '1px solid var(--color-warning)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-warning)' }}>
                🔄 選手交代の記録
              </span>
              <button
                onClick={() => setSubSelectStep('none')}
                style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            {subSelectStep === 'select-out' ? (
              <>
                <p style={{ fontSize: '0.8rem', color: '#ccc', textAlign: 'center' }}>
                  まず、<strong>交代 OUT (下がる選手)</strong> を選択してください：
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {homePlayers.filter(p => onCourtPlayerIds.includes(p.id)).map(player => (
                    <button
                      key={player.id}
                      onClick={() => handleSelectOutPlayer(player.id)}
                      className="btn"
                      style={{
                        justifyContent: 'flex-start',
                        padding: '10px 14px',
                        fontSize: '0.85rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#fff',
                        fontWeight: 700
                      }}
                    >
                      <span style={{ minWidth: '24px', color: 'var(--color-danger)' }}>#{player.number}</span>
                      <span>{player.name}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.8rem', color: '#ccc', textAlign: 'center' }}>
                  次に、<strong>交代 IN (入る選手)</strong> を選択してください：
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                  {homePlayers.filter(p => !onCourtPlayerIds.includes(p.id)).map(player => (
                    <button
                      key={player.id}
                      onClick={() => handleSelectInPlayer(player.id)}
                      className="btn btn-primary"
                      style={{
                        justifyContent: 'flex-start',
                        padding: '10px 14px',
                        fontSize: '0.85rem',
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid var(--color-success)',
                        color: '#fff',
                        fontWeight: 700
                      }}
                    >
                      <span style={{ minWidth: '24px', color: 'var(--color-success)' }}>#{player.number}</span>
                      <span>{player.name}</span>
                    </button>
                  ))}
                  {homePlayers.filter(p => !onCourtPlayerIds.includes(p.id)).length === 0 && (
                    <p style={{ fontSize: '0.8rem', color: '#888', textAlign: 'center', padding: '10px' }}>
                      ベンチに選手が登録されていません。選手管理から追加してください。
                    </p>
                  )}
                </div>
              </>
            )}

            <button
              onClick={() => setSubSelectStep('none')}
              className="btn btn-danger"
              style={{ width: '100%', padding: '8px', fontSize: '0.8rem', marginTop: '4px' }}
            >
              キャンセル (Esc)
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ============================================================== */}
      {/* 🏀 リバウンド自動追加入力ポップアップ */}
      {/* ============================================================== */}
      {reboundStepAction && createPortal(
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100
        }}>
          <div className="glass-card animate-slide-in" style={{
            width: '360px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            textAlign: 'center',
            border: '1px solid var(--accent-color)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)'
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-color)', margin: 0 }}>
              🏀 リバウンドの登録
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#aaa', margin: '-8px 0 4px 0' }}>
              {reboundStepAction.shotTeam === 'home' ? '自チーム' : '相手チーム'}のシュート失敗に続くプレイ
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '340px', overflowY: 'auto', paddingRight: '2px' }}>
              {/* OREB Section (Offensive Rebound) */}
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 700, marginBottom: '6px', textAlign: 'left' }}>
                  オフェンス・リバウンド（シュート側）
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {reboundStepAction.shotTeam === 'home' ? (
                    // Home Offensive Rebounders (On Court)
                    <>
                      {homePlayers.filter(p => onCourtPlayerIds.includes(p.id)).map(player => (
                        <button
                          key={player.id}
                          onClick={() => handleRecordRebound('OREB', 'home', player.id)}
                          className="btn btn-primary"
                          style={{
                            justifyContent: 'flex-start',
                            padding: '8px 12px',
                            fontSize: '0.8rem',
                            background: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid var(--color-success)',
                            color: '#fff',
                            fontWeight: 700
                          }}
                        >
                          <span style={{ minWidth: '24px', color: 'var(--color-success)' }}>#{player.number}</span>
                          <span>{player.name}</span>
                        </button>
                      ))}
                      <button
                        onClick={() => handleRecordRebound('OREB', 'home', null)}
                        className="btn btn-secondary"
                        style={{ padding: '8px', fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        自チーム全体
                      </button>
                    </>
                  ) : (
                    // Away Offensive Rebounders
                    <>
                      {scoutingMode && awayPlayers.length > 0 ? (
                        awayPlayers.map(player => (
                          <button
                            key={player.id}
                            onClick={() => handleRecordRebound('OREB', 'away', player.id)}
                            className="btn"
                            style={{
                              justifyContent: 'flex-start',
                              padding: '8px 12px',
                              fontSize: '0.8rem',
                              background: 'rgba(16, 185, 129, 0.1)',
                              border: '1px solid var(--color-success)',
                              color: '#fff'
                            }}
                          >
                            <span style={{ minWidth: '24px', color: 'var(--color-success)' }}>#{player.number}</span>
                            <span>{player.name}</span>
                          </button>
                        ))
                      ) : null}
                      <button
                        onClick={() => handleRecordRebound('OREB', 'away', null)}
                        className="btn btn-secondary"
                        style={{ padding: '8px', fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        相手チーム全体
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* DREB Section (Defensive Rebound) */}
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-info)', fontWeight: 700, marginBottom: '6px', textAlign: 'left' }}>
                  ディフェンス・リバウンド（守備側）
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {reboundStepAction.shotTeam === 'home' ? (
                    // Away Defensive Rebounders
                    <>
                      {scoutingMode && awayPlayers.length > 0 ? (
                        awayPlayers.map(player => (
                          <button
                            key={player.id}
                            onClick={() => handleRecordRebound('DREB', 'away', player.id)}
                            className="btn"
                            style={{
                              justifyContent: 'flex-start',
                              padding: '8px 12px',
                              fontSize: '0.8rem',
                              background: 'rgba(59, 130, 246, 0.1)',
                              border: '1px solid var(--color-info)',
                              color: '#fff'
                            }}
                          >
                            <span style={{ minWidth: '24px', color: 'var(--color-info)' }}>#{player.number}</span>
                            <span>{player.name}</span>
                          </button>
                        ))
                      ) : null}
                      <button
                        onClick={() => handleRecordRebound('DREB', 'away', null)}
                        className="btn btn-secondary"
                        style={{ padding: '8px', fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        相手チーム全体
                      </button>
                    </>
                  ) : (
                    // Home Defensive Rebounders (On Court)
                    <>
                      {homePlayers.filter(p => onCourtPlayerIds.includes(p.id)).map(player => (
                        <button
                          key={player.id}
                          onClick={() => handleRecordRebound('DREB', 'home', player.id)}
                          className="btn btn-primary"
                          style={{
                            justifyContent: 'flex-start',
                            padding: '8px 12px',
                            fontSize: '0.8rem',
                            background: 'rgba(59, 130, 246, 0.1)',
                            border: '1px solid var(--color-info)',
                            color: '#fff',
                            fontWeight: 700
                          }}
                        >
                          <span style={{ minWidth: '24px', color: 'var(--color-info)' }}>#{player.number}</span>
                          <span>{player.name}</span>
                        </button>
                      ))}
                      <button
                        onClick={() => handleRecordRebound('DREB', 'home', null)}
                        className="btn btn-secondary"
                        style={{ padding: '8px', fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        自チーム全体
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* None (Skip) button */}
            <button
              onClick={() => setReboundStepAction(null)}
              className="btn btn-danger"
              style={{ width: '100%', padding: '10px', fontSize: '0.85rem', fontWeight: 600, marginTop: '8px' }}
            >
              リバウンドなし（スキップ）
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ============================================================== */}
      {/* ⚙️ スタート5選手の設定モーダル */}
      {/* ============================================================== */}
      {showStart5Modal && createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-card animate-slide-in" style={{
            width: '320px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            border: '1px solid rgba(255, 107, 0, 0.3)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 30px rgba(255, 107, 0, 0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-color)' }}>
                ⚙️ スタート5人の設定
              </span>
              <button
                onClick={() => setShowStart5Modal(false)}
                style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#ccc', textAlign: 'center' }}>
              クオーター開始時の<strong>スターティングメンバーを5名</strong>選択してください：
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
              {homePlayers.map(player => {
                const isSelected = tempStartingIds.includes(player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => handleToggleStarterSelection(player.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: isSelected ? 'rgba(255, 107, 0, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid',
                      borderColor: isSelected ? 'var(--accent-color)' : 'var(--glass-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: isSelected ? 700 : 500,
                      textAlign: 'left'
                    }}
                  >
                    <span>#{player.number} {player.name}</span>
                    <span style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '3px',
                      border: '1px solid',
                      borderColor: isSelected ? 'var(--accent-color)' : '#666',
                      background: isSelected ? 'var(--accent-color)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      color: '#fff'
                    }}>
                      {isSelected ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
              {homePlayers.length === 0 && (
                <p style={{ fontSize: '0.8rem', color: '#888', textAlign: 'center', padding: '10px' }}>
                  選手が登録されていません。選手管理から追加してください。
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => setShowStart5Modal(false)}
                className="btn btn-secondary"
                style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveStartingPlayers}
                className="btn btn-primary"
                style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}
                disabled={tempStartingIds.length !== 5}
              >
                設定保存 ({tempStartingIds.length}/5)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
