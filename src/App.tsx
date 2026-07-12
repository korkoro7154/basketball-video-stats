import { useState, useRef, useEffect } from 'react';
import type { Player, StatsEvent, GameInfo, Quarter, QuarterVideo, ExportData, StatType } from './types';
import { VideoPlayer } from './components/VideoPlayer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatsController } from './components/StatsController';
import { EventLog } from './components/EventLog';
import { BoxScore } from './components/BoxScore';
import { GameFlowChart } from './components/GameFlowChart';
import { FileControls } from './components/FileControls';
import { LiveTimer } from './components/LiveTimer';
import { SettingsModal } from './components/SettingsModal';
import { TacticalBoard } from './components/TacticalBoard';
import { calculateTeamStats, getStatLabel, calculatePlayingTimes } from './utils/statsHelper';
import { Trophy, Sparkles, BookOpen, Activity, Save, Upload, Radio, RotateCcw, Settings, Presentation, BarChart2 } from 'lucide-react';
import { SeasonDashboard } from './components/SeasonDashboard';

// 初期自チーム選手
const INITIAL_HOME_PLAYERS: Player[] = [
  { id: 'h1', name: '宮城 リョータ', number: '7', team: 'home' },
  { id: 'h2', name: '流川 楓', number: '11', team: 'home' },
  { id: 'h3', name: '三井 寿', number: '14', team: 'home' },
  { id: 'h4', name: '桜木 花道', number: '10', team: 'home' },
  { id: 'h5', name: '赤木 剛憲', number: '4', team: 'home' },
  { id: 'h6', name: '木暮 公延', number: '5', team: 'home' },
  { id: 'h7', name: '安田 靖春', number: '6', team: 'home' }
];

// 初期相手チーム選手 (スカウティング用)
const INITIAL_AWAY_PLAYERS: Player[] = [
  { id: 'a1', name: '牧 紳一', number: '4', team: 'away' },
  { id: 'a2', name: '神 宗一郎', number: '6', team: 'away' },
  { id: 'a3', name: '清田 信長', number: '10', team: 'away' },
  { id: 'a4', name: '高砂 一馬', number: '5', team: 'away' },
  { id: 'a5', name: '武藤 正', number: '9', team: 'away' }
];

// 練習モード用初期タグ
const INITIAL_PRACTICE_TAGS = [
  'シュート練習',
  'オフェンス戦術',
  'ディフェンス戦術',
  'フットワーク',
  'フリースロー',
  'コーチ指導・メモ'
];

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'danger';
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const headerFileInputRef = useRef<HTMLInputElement>(null);
  const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';

  // モード ＆ 設定状態
  const [appMode, setAppMode] = useState<'game' | 'practice' | 'live' | 'tactical' | 'dashboard'>(() => {
    const saved = localStorage.getItem('courtvision_appMode');
    return (saved as 'game' | 'practice' | 'live' | 'tactical' | 'dashboard') || 'game';
  });
  const [scoutingMode, setScoutingMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('courtvision_scoutingMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [isSaveExportOpen, setIsSaveExportOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // 試合メタデータ情報
  const [gameInfo, setGameInfo] = useState<GameInfo>(() => {
    const saved = localStorage.getItem('courtvision_gameInfo');
    return saved ? JSON.parse(saved) : {
      title: '対 海南大付属高校 練習試合',
      date: new Date().toISOString().split('T')[0],
      opponent: '海南大付属高校'
    };
  });

  // クオーター別の動画ファイル情報（動画URLデータは意図的に保存せず、リロード時は空にします）
  const [quarterVideos, setQuarterVideos] = useState<Record<Quarter, QuarterVideo>>({
    '1Q': { videoUrl: null, videoName: '' },
    '2Q': { videoUrl: null, videoName: '' },
    '3Q': { videoUrl: null, videoName: '' },
    '4Q': { videoUrl: null, videoName: '' },
    'OT': { videoUrl: null, videoName: '' },
    'TOTAL': { videoUrl: null, videoName: '' }
  });

  // 現在表示・編集しているクオーター
  const [currentQuarter, setCurrentQuarter] = useState<Quarter>(() => {
    const saved = localStorage.getItem('courtvision_currentQuarter');
    return (saved as Quarter) || '1Q';
  });

  // 自チームのクオーター別スターティングメンバーIDリスト
  const [startingPlayers, setStartingPlayers] = useState<Record<Quarter, string[]>>(() => {
    const saved = localStorage.getItem('courtvision_startingPlayers');
    return saved ? JSON.parse(saved) : {
      '1Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
      '2Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
      '3Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
      '4Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
      'OT': ['h1', 'h2', 'h3', 'h4', 'h5'],
      'TOTAL': []
    };
  });

  // クオーター動画ごとの実総時間(出場時間計算用)
  const [quarterDurations, setQuarterDurations] = useState<Record<Quarter, number>>(() => {
    const saved = localStorage.getItem('courtvision_quarterDurations');
    return saved ? JSON.parse(saved) : {
      '1Q': 0, '2Q': 0, '3Q': 0, '4Q': 0, 'OT': 0, 'TOTAL': 0
    };
  });

  // --- ゲームタイマー（手動クロック）用の状態 ---
  const [liveTime, setLiveTime] = useState<number>(() => {
    const saved = localStorage.getItem('courtvision_liveTime');
    return saved ? parseInt(saved, 10) : 600;
  });
  const [liveTimerActive, setLiveTimerActive] = useState<boolean>(false); // カウントダウン中か
  const [livePeriodLength, setLivePeriodLength] = useState<number>(() => {
    const saved = localStorage.getItem('courtvision_livePeriodLength');
    return saved ? parseInt(saved, 10) : 600;
  });

  // 選手名簿
  const [players, setPlayers] = useState<Player[]>(() => {
    const saved = localStorage.getItem('courtvision_players');
    return saved ? JSON.parse(saved) : [...INITIAL_HOME_PLAYERS, ...INITIAL_AWAY_PLAYERS];
  });
  
  // 統計イベントリスト
  const [events, setEvents] = useState<StatsEvent[]>(() => {
    const saved = localStorage.getItem('courtvision_events');
    return saved ? JSON.parse(saved) : [];
  });
  
  // 選択中のアクティブプレイヤーID
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  
  // 入力対象チームトグル
  const [activeTeam, setActiveTeam] = useState<'home' | 'away'>('home');

  // 練習モード用カスタムタグ
  const [practiceTags, setPracticeTags] = useState<string[]>(() => {
    const saved = localStorage.getItem('courtvision_practiceTags');
    return saved ? JSON.parse(saved) : INITIAL_PRACTICE_TAGS;
  });

  // 再生タイム・ステート (試合・練習モードでの動画用)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // プレイリスト連続再生（オートハイライト）用の状態
  const [playlist, setPlaylist] = useState<StatsEvent[]>([]);
  const [currentPlayIndex, setCurrentPlayIndex] = useState<number>(-1);
  const [isPlaylistPlaying, setIsPlaylistPlaying] = useState<boolean>(false);
  const [pendingJumpTime, setPendingJumpTime] = useState<number | null>(null);

  // トースト状態
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: 'success' | 'info' | 'danger') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // ライブカウントダウンタイマーのインターバル処理
  useEffect(() => {
    let interval: any = null;
    
    if (liveTimerActive && liveTime > 0) {
      interval = setInterval(() => {
        setLiveTime(prev => {
          if (prev <= 1) {
            setLiveTimerActive(false); // タイマー停止
            addToast(`🔔 ${currentQuarter} が終了しました！ (ブザー)`, 'danger');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [liveTimerActive, liveTime, currentQuarter]);

  // 動画が一時停止したとき、自動的にタイマー（ゲームクロック）も一時停止させる（再生時は自動で動かさない）
  useEffect(() => {
    if (appMode === 'game' && !isPlaying && liveTimerActive) {
      setLiveTimerActive(false);
    }
  }, [isPlaying, appMode, liveTimerActive]);

  // ライブモード時、クオーター規定時間を各クオーターの最大時間として quarterDurations に自動同期
  useEffect(() => {
    if (appMode === 'live') {
      setQuarterDurations(prev => ({
        ...prev,
        [currentQuarter]: livePeriodLength
      }));
    }
  }, [appMode, currentQuarter, livePeriodLength]);

  // ページアンロード（リロード）時やコンポーネントアンマウント時に生成した動画Blob URLをすべて解放する（Safariのゾンビデコーダー対策）
  useEffect(() => {
    const cleanAllVideoUrls = () => {
      Object.values(quarterVideos).forEach(qv => {
        if (qv.videoUrl && qv.videoUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(qv.videoUrl);
          } catch (e) {
            console.error('Failed to revoke Blob URL:', e);
          }
        }
      });
    };

    window.addEventListener('beforeunload', cleanAllVideoUrls);
    return () => {
      window.removeEventListener('beforeunload', cleanAllVideoUrls);
      cleanAllVideoUrls();
    };
  }, [quarterVideos]);

  // 各状態が変化した時に localStorage に自動保存
  useEffect(() => {
    localStorage.setItem('courtvision_appMode', appMode);
    localStorage.setItem('courtvision_scoutingMode', JSON.stringify(scoutingMode));
    localStorage.setItem('courtvision_gameInfo', JSON.stringify(gameInfo));
    localStorage.setItem('courtvision_startingPlayers', JSON.stringify(startingPlayers));
    localStorage.setItem('courtvision_quarterDurations', JSON.stringify(quarterDurations));
    localStorage.setItem('courtvision_liveTime', liveTime.toString());
    localStorage.setItem('courtvision_livePeriodLength', livePeriodLength.toString());
    localStorage.setItem('courtvision_players', JSON.stringify(players));
    localStorage.setItem('courtvision_events', JSON.stringify(events));
    localStorage.setItem('courtvision_practiceTags', JSON.stringify(practiceTags));
    localStorage.setItem('courtvision_currentQuarter', currentQuarter);
  }, [
    appMode,
    scoutingMode,
    gameInfo,
    startingPlayers,
    quarterDurations,
    liveTime,
    livePeriodLength,
    players,
    events,
    practiceTags,
    currentQuarter
  ]);

  // 現在のクオーターに紐付く動画URL (試合・練習用)
  const activeVideoUrl = appMode === 'practice' 
    ? quarterVideos['1Q'].videoUrl 
    : currentQuarter === 'TOTAL'
      ? (quarterVideos['1Q']?.videoUrl || quarterVideos['2Q']?.videoUrl || quarterVideos['3Q']?.videoUrl || quarterVideos['4Q']?.videoUrl || quarterVideos['OT']?.videoUrl || null)
      : quarterVideos[currentQuarter]?.videoUrl;

  // 動画変更時
  const handleVideoUrlChange = (url: string | null, name: string) => {
    if (currentQuarter === 'TOTAL') {
      addToast('試合合計表示中は動画ファイルを読み込むことができません。クオーター（1Q〜OT）を選択して動画を読み込んでください。', 'danger');
      return;
    }
    const qKey = appMode === 'practice' ? '1Q' : currentQuarter;
    
    // 古い動画URLがあれば解放する
    const oldVideo = quarterVideos[qKey];
    if (oldVideo && oldVideo.videoUrl && oldVideo.videoUrl !== url && oldVideo.videoUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(oldVideo.videoUrl);
      } catch (e) {
        console.error('Failed to revoke old Blob URL:', e);
      }
    }
    
    setQuarterVideos(prev => ({
      ...prev,
      [qKey]: { videoUrl: url, videoName: name }
    }));

    if (appMode === 'practice') {
      addToast('練習動画を読み込みました', 'info');
      setGameInfo(prev => ({
        ...prev,
        title: name.replace(/\.[^/.]+$/, "")
      }));
    } else {
      addToast(`${currentQuarter}の動画ファイルを読み込みました`, 'info');
    }
  };

  // 再生時間・動画総時間のトラッキング変更ハンドラー
  const handleTimeUpdate = (time: number) => {
    setCurrentTime(time);
  };

  const handleDurationChange = (dur: number) => {
    setDuration(dur);
    if (appMode === 'game') {
      setQuarterDurations(prev => ({
        ...prev,
        [currentQuarter]: dur
      }));
    }
  };

  // クオーターの変更
  const handleQuarterChange = (q: Quarter) => {
    // 【Safari/メモリ対策】切り替え前のクオーターの動画Blob URLを明示的に解放し、クリアする
    const oldVideo = quarterVideos[currentQuarter];
    let isBlobReleased = false;
    if (oldVideo && oldVideo.videoUrl && oldVideo.videoUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(oldVideo.videoUrl);
      } catch (e) {
        console.error('Failed to revoke Blob URL on quarter change:', e);
      }
      
      setQuarterVideos(prev => ({
        ...prev,
        [currentQuarter]: { videoUrl: null, videoName: '' } // Blobの場合のみ消去
      }));
      isBlobReleased = true;
    }

    setCurrentQuarter(q);
    setSelectedPlayerId(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);

    // タイマーもそのクオーターに合わせてリセット
    setLiveTime(livePeriodLength);
    setLiveTimerActive(false);
    
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    
    if (isBlobReleased) {
      addToast(`${q} に切り替えました（以前の動画メモリは解放されました）`, 'info');
    } else {
      addToast(`${q} に切り替えました`, 'info');
    }
  };

  // ライブタイマー操作ハンドラー群
  const handleToggleLiveTimer = () => {
    setLiveTimerActive(prev => !prev);
  };

  const handleAdjustLiveTimer = (amount: number) => {
    setLiveTime(prev => {
      const nextTime = prev + amount;
      return Math.max(0, Math.min(livePeriodLength, nextTime));
    });
  };

  const handleResetLiveTimer = () => {
    setLiveTime(livePeriodLength);
    setLiveTimerActive(false);
    addToast('タイマーを規定時間にリセットしました', 'info');
  };

  const handlePeriodLengthChange = (length: number) => {
    setLivePeriodLength(length);
    setLiveTime(length);
    setLiveTimerActive(false);
    
    // 出場時間計算用の duration マップを更新
    setQuarterDurations(prev => ({
      ...prev,
      [currentQuarter]: length
    }));

    addToast(`規定時間を ${length / 60} 分に変更しました`, 'info');
  };

  // オンコート出場中選手(5人)の動的算出
  const getOnCourtPlayers = (): string[] => {
    const validHomePlayerIds = players.filter(p => p.team === 'home').map(p => p.id);
    const starters = (startingPlayers[currentQuarter] || []).filter(id => validHomePlayerIds.includes(id));
    
    // ライブモードの場合は経過時間を基準にする
    const checkTime = appMode === 'live' 
      ? (livePeriodLength - liveTime) 
      : currentTime;

    const subEvents = events
      .filter(e => e.quarter === currentQuarter && e.team === 'home' && e.timestamp <= checkTime && (e.type === 'SUB_IN' || e.type === 'SUB_OUT'))
      .sort((a, b) => a.timestamp - b.timestamp);

    const onCourt = new Set<string>(starters);
    subEvents.forEach(e => {
      if (e.playerId) {
        if (e.type === 'SUB_IN') {
          onCourt.add(e.playerId);
        } else if (e.type === 'SUB_OUT') {
          onCourt.delete(e.playerId);
        }
      }
    });

    return Array.from(onCourt);
  };

  const onCourtPlayerIds = getOnCourtPlayers();

  // 選手追加
  const handleAddPlayer = (name: string, number: string, team: 'home' | 'away') => {
    const newPlayer: Player = {
      id: 'player_' + Date.now().toString() + Math.random().toString(),
      name,
      number,
      team
    };
    setPlayers(prev => [...prev, newPlayer]);
    addToast(`${team === 'home' ? '自' : '相手'}チームに「#${number} ${name}」を追加しました`, 'success');
  };

  // 選手削除
  const handleRemovePlayer = (id: string) => {
    const player = players.find(p => p.id === id);
    if (!player) return;

    if (window.confirm(`「#${player.number} ${player.name}」を名簿から削除しますか？`)) {
      setPlayers(prev => prev.filter(p => p.id !== id));
      setEvents(prev => prev.map(e => e.playerId === id ? { ...e, playerId: null } : e));
      
      const updatedStarters = { ...startingPlayers };
      (Object.keys(updatedStarters) as Quarter[]).forEach(q => {
        updatedStarters[q] = updatedStarters[q].filter(sid => sid !== id);
      });
      setStartingPlayers(updatedStarters);

      if (selectedPlayerId === id) setSelectedPlayerId(null);
      addToast('選手を名簿から削除しました', 'danger');
    }
  };

  // 選手情報変更
  const handleUpdatePlayer = (id: string, name: string, number: string) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, name, number } : p));
    addToast('選手情報を更新しました', 'success');
  };

  // スタッツイベント記録
  const handleRecordStat = (type: StatType, team: 'home' | 'away', playerId: string | null, location?: { x: number; y: number }) => {
    // ライブモードの場合はタイマーのみでOK。試合モードの場合は動画があること
    if (appMode !== 'live' && !activeVideoUrl) {
      addToast('先に動画ファイルを読み込んでください', 'danger');
      return;
    }

    // ライブモード：経過時間をタイムスタンプにする。試合モード：動画時間をタイムスタンプにする
    const timestamp = appMode === 'live'
      ? (livePeriodLength - liveTime)
      : currentTime;

    const newEvent: StatsEvent = {
      id: 'event_' + Date.now().toString() + Math.random().toString(),
      timestamp,
      gameTime: liveTime, // クロック残り秒数も記録
      playerId,
      type,
      team,
      quarter: currentQuarter,
      location
    };

    setEvents(prev => [...prev, newEvent]);

    const label = getStatLabel(type);
    let message = '';
    const player = players.find(p => p.id === playerId);

    if (type === 'TIMEOUT') {
      message = `${team === 'home' ? '自チーム' : '相手チーム'} のタイムアウトを記録`;
    } else {
      if (team === 'home') {
        message = player 
          ? `#${player.number} ${player.name} の ${label} を記録`
          : `自チーム(全体) の ${label} を記録`;
      } else {
        message = player && scoutingMode
          ? `相手 #${player.number} ${player.name} の ${label} を記録`
          : `相手チーム の ${label} を記録`;
      }
    }

    let toastType: 'success' | 'info' | 'danger' = 'info';
    if (type.includes('MADE')) toastType = 'success';
    if (type.includes('MISS') || type === 'TO' || type === 'PF') toastType = 'danger';

    addToast(message, toastType);
  };

  // 選手交代の記録
  const handleRecordSubstitution = (outPlayerId: string, inPlayerId: string) => {
    // 試合モードなら動画が必要
    if (appMode !== 'live' && !activeVideoUrl) return;

    const outPlayer = players.find(p => p.id === outPlayerId);
    const inPlayer = players.find(p => p.id === inPlayerId);
    if (!outPlayer || !inPlayer) return;

    // 交代を記録するタイムスタンプの決定
    const timestamp = appMode === 'live'
      ? (livePeriodLength - liveTime)
      : currentTime;

    const subOutId = 'sub_out_' + Date.now().toString() + Math.random().toString();
    const subInId = 'sub_in_' + Date.now().toString() + Math.random().toString();

    const outEvent: StatsEvent = {
      id: subOutId,
      timestamp,
      gameTime: liveTime,
      playerId: outPlayerId,
      type: 'SUB_OUT',
      team: 'home',
      quarter: currentQuarter,
      notes: `交代 OUT → #${inPlayer.number} ${inPlayer.name.split(' ')[0]}`
    };

    const inEvent: StatsEvent = {
      id: subInId,
      timestamp,
      gameTime: liveTime,
      playerId: inPlayerId,
      type: 'SUB_IN',
      team: 'home',
      quarter: currentQuarter,
      notes: `交代 IN ← #${outPlayer.number} ${outPlayer.name.split(' ')[0]}`
    };

    setEvents(prev => [...prev, outEvent, inEvent]);
    setSelectedPlayerId(null);

    addToast(`交代記録: #${outPlayer.number} ${outPlayer.name.split(' ')[0]} OUT → #${inPlayer.number} ${inPlayer.name.split(' ')[0]} IN`, 'info');
  };

  // 練習用タグのイベント記録
  const handleRecordPracticeEvent = (tagName: string) => {
    if (!activeVideoUrl) {
      addToast('先に練習動画ファイルを読み込んでください', 'danger');
      return;
    }

    const newEvent: StatsEvent = {
      id: 'practice_' + Date.now().toString() + Math.random().toString(),
      timestamp: currentTime,
      playerId: null,
      type: 'PRACTICE_TAG',
      team: 'home',
      quarter: '1Q',
      practiceTag: tagName
    };

    setEvents(prev => [...prev, newEvent]);
    addToast(`練習タグ「${tagName}」を記録しました`, 'success');
  };

  // 練習タグ追加
  const handleAddPracticeTag = (tag: string) => {
    if (practiceTags.includes(tag)) return;
    setPracticeTags(prev => [...prev, tag]);
    addToast(`タグ「${tag}」を追加しました`, 'success');
  };

  // 練習タグ削除
  const handleRemovePracticeTag = (tag: string) => {
    setPracticeTags(prev => prev.filter(t => t !== tag));
    addToast(`タグ「${tag}」を削除しました`, 'danger');
  };

  // イベント削除
  const handleRemoveEvent = (id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    addToast('イベントを削除しました', 'danger');
  };

  // イベントメモ更新
  const handleUpdateEventNotes = (id: string, notes: string) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, notes } : e));
    addToast('メモを更新しました', 'success');
  };

  // タイムスタンプへジャンプ (5秒前)
  const handleJumpToTime = (time: number, quarter?: Quarter) => {
    // ライブモード時はジャンプはさせない (動画が無いため)
    if (appMode === 'live') return;

    if (quarter && quarter !== currentQuarter && appMode === 'game') {
      // クオーターが異なる場合は、切り替えを行ってからメタデータロード後にジャンプ
      setPendingJumpTime(time);
      setCurrentQuarter(quarter);
      addToast(`クオーターを切り替えます (${quarter})`, 'info');
      return;
    }

    if (videoRef.current) {
      const targetTime = Math.max(0, time - 5);
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => console.log(err));
    }
  };

  const handleStartPlaylist = (eventsToPlay: StatsEvent[]) => {
    if (eventsToPlay.length === 0) return;
    
    const validEvents = eventsToPlay.filter(e => e.timestamp > 0);
    if (validEvents.length === 0) {
      addToast('有効なタイムスタンプを持つイベントがありません', 'danger');
      return;
    }

    setPlaylist(validEvents);
    setCurrentPlayIndex(0);
    setIsPlaylistPlaying(true);

    const firstEvent = validEvents[0];
    if (firstEvent.quarter !== currentQuarter && appMode === 'game') {
      setPendingJumpTime(firstEvent.timestamp);
      setCurrentQuarter(firstEvent.quarter);
    } else {
      handleJumpToTime(firstEvent.timestamp);
    }
    addToast(`プレイリスト再生を開始します (1/${validEvents.length})`, 'success');
  };

  const handleStopPlaylist = () => {
    setIsPlaylistPlaying(false);
    setPlaylist([]);
    setCurrentPlayIndex(-1);
    setPendingJumpTime(null);
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    addToast('プレイリスト再生を停止しました', 'info');
  };

  // メタデータロード完了時にジャンプ
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (pendingJumpTime !== null) {
        const targetTime = Math.max(0, pendingJumpTime - 5);
        video.currentTime = targetTime;
        setCurrentTime(targetTime);
        video.play().then(() => {
          setIsPlaying(true);
        }).catch(err => console.log(err));
        setPendingJumpTime(null);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [pendingJumpTime]);

  // プレイリスト連続再生の自動遷移監視
  useEffect(() => {
    if (!isPlaylistPlaying || playlist.length === 0 || currentPlayIndex === -1) return;

    const currentEvent = playlist[currentPlayIndex];
    if (!currentEvent) return;

    // イベント発生時の3秒後に次のクリップへ移行する
    const endTime = currentEvent.timestamp + 3;

    if (currentTime >= endTime) {
      const nextIndex = currentPlayIndex + 1;
      if (nextIndex < playlist.length) {
        setCurrentPlayIndex(nextIndex);
        const nextEvent = playlist[nextIndex];
        
        if (nextEvent.quarter !== currentQuarter && appMode === 'game') {
          setPendingJumpTime(nextEvent.timestamp);
          setCurrentQuarter(nextEvent.quarter);
          addToast(`クオーターを切り替えます (${nextEvent.quarter})`, 'info');
        } else {
          handleJumpToTime(nextEvent.timestamp);
        }
        addToast(`次のクリップを再生します (${nextIndex + 1}/${playlist.length})`, 'info');
      } else {
        handleStopPlaylist();
        addToast('すべてのクリップの再生が完了しました', 'success');
      }
    }
  }, [currentTime, isPlaylistPlaying, playlist, currentPlayIndex, currentQuarter, appMode]);

  // JSON復元適用
  const handleImportData = (data: ExportData) => {
    const resetQuarterVideos = { ...data.quarterVideos };
    (Object.keys(resetQuarterVideos) as Quarter[]).forEach(q => {
      resetQuarterVideos[q] = {
        videoUrl: null,
        videoName: resetQuarterVideos[q].videoName
      };
    });

    setQuarterVideos(resetQuarterVideos);
    setAppMode(data.mode);
    setScoutingMode(data.scoutingMode);
    setGameInfo(data.gameInfo);
    setStartingPlayers(data.startingPlayers);
    setPlayers(data.players);
    setEvents(data.events);
    setPracticeTags(data.practiceTags.length > 0 ? data.practiceTags : INITIAL_PRACTICE_TAGS);
    
    // タイマー設定の初期化
    setLiveTime(600);
    setLivePeriodLength(600);
    setLiveTimerActive(false);

    setSelectedPlayerId(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setCurrentQuarter('1Q');

    addToast('データを復元しました。', 'success');
  };

  // 全データリセット (選手名簿は保持)
  const handleResetAllData = () => {
    if (window.confirm("これまでに記録したすべてのスタッツとゲーム情報を消去して初期状態に戻しますか？\n（※登録選手および読み込んでいる動画ファイルはクリアされません）")) {
      setEvents([]);
      setGameInfo({
        title: '対 海南大付属高校 練習試合',
        date: new Date().toISOString().split('T')[0],
        opponent: '海南大付属高校'
      });
      setStartingPlayers({
        '1Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
        '2Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
        '3Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
        '4Q': ['h1', 'h2', 'h3', 'h4', 'h5'],
        'OT': ['h1', 'h2', 'h3', 'h4', 'h5'],
        'TOTAL': []
      });
      setQuarterDurations({
        '1Q': 0, '2Q': 0, '3Q': 0, '4Q': 0, 'OT': 0, 'TOTAL': 0
      });
      setPracticeTags(INITIAL_PRACTICE_TAGS);
      setLiveTime(600);
      setLivePeriodLength(600);
      setLiveTimerActive(false);
      setSelectedPlayerId(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      setCurrentQuarter('1Q');
      
      // localStorageもクリアする (playersは除く)
      localStorage.removeItem('courtvision_appMode');
      localStorage.removeItem('courtvision_scoutingMode');
      localStorage.removeItem('courtvision_gameInfo');
      localStorage.removeItem('courtvision_startingPlayers');
      localStorage.removeItem('courtvision_quarterDurations');
      localStorage.removeItem('courtvision_liveTime');
      localStorage.removeItem('courtvision_livePeriodLength');
      localStorage.removeItem('courtvision_events');
      localStorage.removeItem('courtvision_practiceTags');
      localStorage.removeItem('courtvision_currentQuarter');
      
      addToast("スタッツとゲーム情報を初期化しました", "info");
    }
  };

  // 選手名簿の初期リセット
  const handleResetPlayers = () => {
    if (window.confirm("選手登録リストを初期のデフォルトメンバー（湘北高校ベース・相手チーム5名）にリセットしますか？\n（※登録済みのカスタム選手が消去されます）")) {
      const defaultPlayers = [...INITIAL_HOME_PLAYERS, ...INITIAL_AWAY_PLAYERS];
      setPlayers(defaultPlayers);
      localStorage.setItem('courtvision_players', JSON.stringify(defaultPlayers));
      addToast("選手登録を初期状態にリセットしました", "info");
    }
  };

  // ヘッダーインポート
  const handleHeaderImportClick = () => {
    headerFileInputRef.current?.click();
  };

  const handleHeaderImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        
        if (!parsed.players || !parsed.events) {
          alert('無効なファイル形式です。');
          return;
        }

        const importedData: ExportData = {
          version: parsed.version || '1.0',
          mode: parsed.mode || 'game',
          scoutingMode: parsed.scoutingMode !== undefined ? parsed.scoutingMode : false,
          gameInfo: parsed.gameInfo || {
            title: file.name.replace('.json', ''),
            date: new Date().toISOString().split('T')[0],
            opponent: ''
          },
          quarterVideos: parsed.quarterVideos || {
            '1Q': { videoUrl: null, videoName: '' },
            '2Q': { videoUrl: null, videoName: '' },
            '3Q': { videoUrl: null, videoName: '' },
            '4Q': { videoUrl: null, videoName: '' },
            'OT': { videoUrl: null, videoName: '' }
          },
          startingPlayers: parsed.startingPlayers || {
            '1Q': [], '2Q': [], '3Q': [], '4Q': [], 'OT': []
          },
          players: parsed.players.map((p: any) => ({
            ...p,
            team: p.team || 'home'
          })),
          events: parsed.events.map((ev: any) => ({
            ...ev,
            quarter: ev.quarter || '1Q',
            team: ev.team || 'home'
          })),
          practiceTags: parsed.practiceTags || []
        };

        if (parsed.version !== '2.0' && parsed.videoUrl) {
          importedData.quarterVideos['1Q'] = {
            videoUrl: parsed.videoUrl,
            videoName: parsed.videoName || 'ビデオ1'
          };
        }

        handleImportData(importedData);
        if (headerFileInputRef.current) headerFileInputRef.current.value = '';
      } catch (err) {
        alert('ファイルの解析に失敗しました。');
      }
    };
    reader.readAsText(file);
  };

  // 出場時間の計算
  const playingTimes = calculatePlayingTimes(
    events,
    startingPlayers,
    players,
    quarterDurations
  );

  // トータルスタッツ
  const homeStats = calculateTeamStats(events, 'home');
  const awayStats = calculateTeamStats(events, 'away');

  // キーボードショートカット制御 (再生トグル、タイマートグル等)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      // スペースキー：再生トグル
      if (e.key === ' ') {
        e.preventDefault();
        
        if (appMode === 'live') {
          handleToggleLiveTimer();
        } else {
          if (!videoRef.current || !activeVideoUrl) return;
          if (isPlaying) {
            videoRef.current.pause();
          } else {
            videoRef.current.play().catch(err => console.log(err));
          }
        }
      }

      // Enterキー：ゲームクロックタイマーのトグル、または動画の再生トグル
      if (e.key === 'Enter') {
        e.preventDefault();
        if (appMode === 'live') {
          handleToggleLiveTimer();
        } else {
          if (!videoRef.current || !activeVideoUrl) return;
          if (isPlaying) {
            videoRef.current.pause();
          } else {
            videoRef.current.play().catch(err => console.log(err));
          }
        }
      }

      // [ / ] キー：ゲームクロックの微調整、または動画シーク ( [ = 戻す, ] = 進む )
      if (e.key === ']') {
        e.preventDefault();
        if (appMode === 'live') {
          handleAdjustLiveTimer(1);
        } else {
          const step = e.shiftKey ? 5 : 1;
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + step);
            setCurrentTime(videoRef.current.currentTime);
          }
        }
      }
      if (e.key === '[') {
        e.preventDefault();
        if (appMode === 'live') {
          handleAdjustLiveTimer(-1);
        } else {
          const step = e.shiftKey ? 5 : 1;
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - step);
            setCurrentTime(videoRef.current.currentTime);
          }
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [isPlaying, activeVideoUrl, appMode, liveTimerActive]);

  return (
    <div className="app-container">
      {isFileProtocol && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.25)',
          border: '1px solid var(--color-danger)',
          color: 'var(--color-danger)',
          padding: '16px 24px',
          borderRadius: 'var(--radius-md)',
          margin: '20px auto 10px auto',
          maxWidth: '1200px',
          width: 'calc(100% - 40px)',
          textAlign: 'center',
          fontSize: '0.95rem',
          fontWeight: 'bold',
          lineHeight: '1.6',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)'
        }}>
          ⚠️ 【警告：動画が再生できない原因】現在、ファイル（index.html）をダブルクリック等で直接開いています。<br />
          Safariなどのブラウザのセキュリティ制限により、この起動方法では動画ファイル（ローカルの動画も含む）の読み込み・再生がブロックされます。<br />
          アプリを正常に動作させるには、ターミナルで起動中のアドレス（ <strong>http://localhost:5173</strong> ）をブラウザのURL欄に入力して開いてください。
        </div>
      )}
      {/* ヘッダーエリア */}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="logo">
            <Trophy className="logo-icon" size={24} />
            <span>CourtVision Stats</span>
          </div>

          {/* モード切替 */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <button
              onClick={() => {
                setAppMode('game');
                setSelectedPlayerId(null);
                setLiveTimerActive(false);
              }}
              style={{
                border: 'none',
                background: appMode === 'game' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Activity size={14} /> 試合モード
            </button>
            <button
              onClick={() => {
                setAppMode('live');
                setSelectedPlayerId(null);
                setLiveTime(livePeriodLength);
                setLiveTimerActive(false);
              }}
              style={{
                border: 'none',
                background: appMode === 'live' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Radio size={14} /> ライブモード
            </button>
            <button
              onClick={() => {
                setAppMode('practice');
                setSelectedPlayerId(null);
                setLiveTimerActive(false);
              }}
              style={{
                border: 'none',
                background: appMode === 'practice' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all var(--transition-fast)'
              }}
            >
              <BookOpen size={14} /> 練習モード
            </button>
            <button
              onClick={() => {
                setAppMode('tactical');
                setSelectedPlayerId(null);
                setLiveTimerActive(false);
              }}
              style={{
                border: 'none',
                background: appMode === 'tactical' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Presentation size={14} /> 作戦盤モード
            </button>
            <button
              onClick={() => {
                setAppMode('dashboard');
                setSelectedPlayerId(null);
                setLiveTimerActive(false);
              }}
              style={{
                border: 'none',
                background: appMode === 'dashboard' ? 'var(--accent-color)' : 'transparent',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all var(--transition-fast)'
              }}
            >
              <BarChart2 size={14} /> シーズン分析
            </button>
          </div>
        </div>

        {/* 試合名 ＆ 保存復元 ＆ スコア */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>


          {/* 保存・読込ボタン */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: '0.8rem', gap: '6px', cursor: 'pointer' }}
            >
              <Settings size={14} /> 設定
            </button>
            <button
              onClick={() => setIsSaveExportOpen(true)}
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '0.8rem', gap: '6px', cursor: 'pointer' }}
            >
              <Save size={14} /> 保存出力
            </button>
            <button
              onClick={handleHeaderImportClick}
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: '0.8rem', gap: '6px', cursor: 'pointer' }}
              title="データを復元"
            >
              <Upload size={14} /> 復元
            </button>
            <button
              onClick={handleResetAllData}
              style={{
                padding: '6px 14px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                background: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--color-danger)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '6px',
                fontWeight: 600,
                transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-danger)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.color = 'var(--color-danger)';
              }}
              title="すべての記録を消去して初期状態に戻します"
            >
              <RotateCcw size={14} /> 初期化
            </button>
            <input
              type="file"
              ref={headerFileInputRef}
              onChange={handleHeaderImportFileChange}
              accept="application/json"
              style={{ display: 'none' }}
            />
          </div>

        </div>
      </header>

      {/* メインレイアウト */}
      <main className="main-content">
        {appMode === 'dashboard' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <SeasonDashboard isOffline={true} />
          </div>
        ) : appMode === 'tactical' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <TacticalBoard players={players} />
          </div>
        ) : (
          <>
            {/* 左側: ビデオプレイヤー / 大型タイマー、グラフ、成績表 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {appMode === 'live' ? (
                /* ライブモード時：コンパクトになったタイマー ＋ 巨大な入力ボタン群 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <LiveTimer
                    liveTime={liveTime}
                    liveTimerActive={liveTimerActive}
                    livePeriodLength={livePeriodLength}
                    onToggleTimer={handleToggleLiveTimer}
                    onAdjustTimer={handleAdjustLiveTimer}
                    onResetTimer={handleResetLiveTimer}
                    onPeriodLengthChange={handlePeriodLengthChange}
                    currentQuarter={currentQuarter}
                    onQuarterChange={handleQuarterChange}
                    homeScore={homeStats.pts}
                    awayScore={awayStats.pts}
                    opponentName={gameInfo.opponent}
                    isCompact={true}
                  />
                  <StatsController
                    players={players}
                    selectedPlayerId={selectedPlayerId}
                    onSelectPlayer={setSelectedPlayerId}
                    activeTeam={activeTeam}
                    setActiveTeam={setActiveTeam}
                    onRecordStat={handleRecordStat}
                    appMode={appMode}
                    scoutingMode={scoutingMode}
                    onCourtPlayerIds={onCourtPlayerIds}
                    startingPlayerIds={(startingPlayers[currentQuarter] || []).filter(id => players.some(p => p.id === id && p.team === 'home'))}
                    onUpdateStartingPlayers={(ids) => setStartingPlayers(prev => ({ ...prev, [currentQuarter]: ids }))}
                    onRecordSubstitution={handleRecordSubstitution}
                    practiceTags={practiceTags}
                    onAddPracticeTag={handleAddPracticeTag}
                    onRemovePracticeTag={handleRemovePracticeTag}
                    onRecordPracticeEvent={handleRecordPracticeEvent}
                    liveTime={liveTime}
                    liveTimerActive={liveTimerActive}
                    onToggleTimer={handleToggleLiveTimer}
                    onAdjustTimer={handleAdjustLiveTimer}
                    isLarge={true}
                  />
                </div>
              ) : (
                /* 試合・練習モード時：ビデオプレイヤーを表示 */
                <ErrorBoundary>
                  <VideoPlayer
                    videoRef={videoRef}
                    videoUrl={activeVideoUrl}
                    onVideoUrlChange={handleVideoUrlChange}
                    events={events}
                    players={players}
                    currentTime={currentTime}
                    duration={duration}
                    onTimeUpdate={handleTimeUpdate}
                    onDurationChange={handleDurationChange}
                    isPlaying={isPlaying}
                    setIsPlaying={setIsPlaying}
                    appMode={appMode}
                    currentQuarter={currentQuarter}
                    onQuarterChange={handleQuarterChange}
                    quarterVideos={quarterVideos}
                    opponentName={gameInfo.opponent}
                  />
                </ErrorBoundary>
              )}

              {/* ビデオ未選択時の案内 (試合・練習モードのみ) */}
              {appMode !== 'live' && !activeVideoUrl && (
                <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
                    <Sparkles size={18} style={{ color: 'var(--accent-color)' }} />
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {appMode === 'game' ? '試合モードの使い方' : '練習モードの使い方'}
                    </h3>
                  </div>
                  
                  {appMode === 'game' ? (
                    <ul className="step-list">
                      <li className="step-list-item"><span className="step-badge">1</span><span>上のエリアでクオーター（例: <strong style={{ color: '#fff' }}>1Q</strong>）を選択し、その動画を読み込みます。各クオーターごとに別ファイルを指定できます。</span></li>
                      <li className="step-list-item"><span className="step-badge">2</span><span>右側の選手登録を行い、「スタート5設定」でクオーター開始時の出場選手5人を選びます。</span></li>
                      <li className="step-list-item"><span className="step-badge">3</span><span>動画を見ながら右下の入力ボタンまたはキーボードショートカットでスタッツを記録します。</span></li>
                      <li className="step-list-item"><span className="step-badge">4</span><span><strong style={{ color: '#fff' }}>右上のミニゲームクロック（タイマー）</strong>も活用し、実際の公式時間と合わせておけば、スタッツ履歴やCSVに公式残り秒数を自動で記録できます。</span></li>
                      <li className="step-list-item"><span className="step-badge">5</span><span>タイムラインや成績表の数値をクリックしてリプレイ再生が可能です。</span></li>
                    </ul>
                  ) : (
                    <ul className="step-list">
                      <li className="step-list-item"><span className="step-badge">1</span><span>上のエリアに、<strong style={{ color: '#fff' }}>練習や自主トレの動画ファイル</strong>を読み込みます。</span></li>
                      <li className="step-list-item"><span className="step-badge">2</span><span>右側の入力パネルから、分析したい練習メニューの<strong style={{ color: '#fff' }}>「練習タグ」</strong>を作成・配置します。</span></li>
                      <li className="step-list-item"><span className="step-badge">3</span><span>動画を再生し、該当する練習メニューが行われている秒数でタグボタンを押すか、<strong style={{ color: '#fff' }}>数字ショートカットキー（1〜9）</strong>を押してシーンを記録します。</span></li>
                      <li className="step-list-item"><span className="step-badge">4</span><span>記録後、下の<strong style={{ color: '#fff' }}>「練習メニュー別クリップ集計」</strong>パネルにタグ一覧とカウントが表示され、クリックするとその練習シーンだけの動画ジャンプ・連続振り返りができます。</span></li>
                    </ul>
                  )}
                </div>
              )}

              {/* 得点推移グラフ (試合・ライブモードでイベントがあるとき表示) */}
              {appMode !== 'practice' && events.length > 0 && (
                <GameFlowChart
                  events={events}
                  duration={appMode === 'live' ? livePeriodLength : duration}
                  onJumpToTime={handleJumpToTime}
                />
              )}

              {/* 成績表 (試合・ライブモード時はボックススコア、練習時はクリップ集計) */}
              {(appMode === 'live' || activeVideoUrl) && (
                <BoxScore
                  events={events}
                  players={players}
                  onJumpToTime={handleJumpToTime}
                  appMode={appMode === 'live' ? 'game' : appMode} // ライブモード時はゲーム用ボックススコアを表示
                  scoutingMode={scoutingMode}
                  playingTimes={playingTimes}
                  startingPlayers={startingPlayers}
                  quarterDurations={quarterDurations}
                  livePeriodLength={livePeriodLength}
                  isPlaylistPlaying={isPlaylistPlaying}
                  currentPlayIndex={currentPlayIndex}
                  playlist={playlist}
                  onStartPlaylist={handleStartPlaylist}
                  onStopPlaylist={handleStopPlaylist}
                />
              )}
            </div>

            {/* 右側: 各種入力・ログ・選手管理 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* スタッツ入力コントローラー (タイマー連動) ※ライブモード時は左側に巨大化して表示するため、右側は非表示 */}
              {appMode !== 'live' && (
                currentQuarter === 'TOTAL' ? (
                  <div style={{
                    padding: '28px 24px',
                    borderRadius: 'var(--radius-md)',
                    background: 'radial-gradient(circle at 50% 0%, rgba(255, 107, 0, 0.08) 0%, rgba(18, 20, 28, 0.7) 100%)',
                    border: '1px solid rgba(255, 107, 0, 0.2)',
                    backdropFilter: 'blur(12px)',
                    color: 'rgba(255, 255, 255, 0.75)',
                    textAlign: 'center',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 107, 0, 0.05) inset'
                  }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
                    <div style={{ fontWeight: '700', color: 'var(--accent-color)', fontSize: '1.1rem', marginBottom: '8px' }}>試合合計（全Q）を表示中</div>
                    <p style={{ margin: 0, fontSize: '13px', color: '#ccc' }}>
                      スタッツを記録または選手交代を行うには、上のクオーター選択タブから「1Q〜OT」のいずれかを選択してください。
                    </p>
                  </div>
                ) : (
                  <StatsController
                    players={players}
                    selectedPlayerId={selectedPlayerId}
                    onSelectPlayer={setSelectedPlayerId}
                    activeTeam={activeTeam}
                    setActiveTeam={setActiveTeam}
                    onRecordStat={handleRecordStat}
                    appMode={appMode}
                    scoutingMode={scoutingMode}
                    onCourtPlayerIds={onCourtPlayerIds}
                    startingPlayerIds={(startingPlayers[currentQuarter] || []).filter(id => players.some(p => p.id === id && p.team === 'home'))}
                    onUpdateStartingPlayers={(ids) => setStartingPlayers(prev => ({ ...prev, [currentQuarter]: ids }))}
                    onRecordSubstitution={handleRecordSubstitution}
                    practiceTags={practiceTags}
                    onAddPracticeTag={handleAddPracticeTag}
                    onRemovePracticeTag={handleRemovePracticeTag}
                    onRecordPracticeEvent={handleRecordPracticeEvent}
                    liveTime={liveTime}
                    liveTimerActive={liveTimerActive}
                    onToggleTimer={handleToggleLiveTimer}
                    onAdjustTimer={handleAdjustLiveTimer}
                  />
                )
              )}

              {/* 履歴リストログ */}
              <EventLog
                events={events}
                players={players}
                onRemoveEvent={handleRemoveEvent}
                onUpdateEventNotes={handleUpdateEventNotes}
                onJumpToTime={handleJumpToTime}
                appMode={appMode}
              />
            </div>
          </>
        )}
      </main>

      {/* 試合・練習情報 ＆ データ入出力設定モーダル */}
      <FileControls
        gameInfo={gameInfo}
        players={players}
        events={events}
        onImportData={handleImportData}
        onResetAllData={handleResetAllData}
        appMode={appMode === 'practice' ? 'practice' : 'game'}
        scoutingMode={scoutingMode}
        quarterVideos={quarterVideos}
        startingPlayers={startingPlayers}
        practiceTags={practiceTags}
        quarterDurations={quarterDurations}
        livePeriodLength={livePeriodLength}
        isOpen={isSaveExportOpen}
        onClose={() => setIsSaveExportOpen(false)}
      />

      {/* 試合設定 ＆ 選手管理モーダル */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        gameInfo={gameInfo}
        onGameInfoChange={setGameInfo}
        scoutingMode={scoutingMode}
        onScoutingModeChange={setScoutingMode}
        players={players}
        onAddPlayer={handleAddPlayer}
        onRemovePlayer={handleRemovePlayer}
        onUpdatePlayer={handleUpdatePlayer}
        onResetPlayers={handleResetPlayers}
        appMode={appMode === 'practice' ? 'practice' : appMode === 'live' ? 'live' : 'game'}
      />

      {/* フッター */}
      <footer style={{ height: '60px', borderTop: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: '#555', marginTop: '40px' }}>
        &copy; {new Date().getFullYear()} CourtVision Stats. High School Basketball Video Analysis Tool.
      </footer>

      {/* プレイリスト連続再生インジケーター */}
      {isPlaylistPlaying && playlist.length > 0 && currentPlayIndex !== -1 && (
        <div style={{
          position: 'fixed',
          top: '90px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(255, 107, 0, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 28px',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          color: '#fff',
          fontSize: '0.95rem',
          fontWeight: 700
        }} className="animate-slide-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#fff',
              opacity: Math.floor(currentTime * 2) % 2 === 0 ? 0.4 : 1 // 簡易点滅
            }}></span>
            <span>オートハイライト再生中: {currentPlayIndex + 1} / {playlist.length} 件</span>
          </div>
          <button
            onClick={handleStopPlaylist}
            style={{
              background: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent-color)',
              padding: '4px 12px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              transition: 'all 0.2s'
            }}
          >
            停止
          </button>
        </div>
      )}

      {/* トーストコンテナ */}
      <div style={{
        position: 'fixed',
        top: '80px',
        right: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 9999,
        pointerEvents: 'none'
      }}>
        {toasts.map(toast => {
          let bg = 'var(--bg-tertiary)';
          let border = 'var(--glass-border)';
          let textColor = '#fff';

          if (toast.type === 'success') {
            bg = 'rgba(16, 185, 129, 0.15)';
            border = 'rgba(16, 185, 129, 0.4)';
            textColor = 'var(--color-success)';
          } else if (toast.type === 'danger') {
            bg = 'rgba(239, 68, 68, 0.15)';
            border = 'rgba(239, 68, 68, 0.4)';
            textColor = 'var(--color-danger)';
          } else if (toast.type === 'info') {
            bg = 'rgba(59, 130, 246, 0.15)';
            border = 'rgba(59, 130, 246, 0.4)';
            textColor = 'var(--color-info)';
          }

          return (
            <div
              key={toast.id}
              className="animate-slide-in"
              style={{
                background: bg,
                backdropFilter: 'blur(8px)',
                border: `1px solid ${border}`,
                color: textColor,
                padding: '12px 20px',
                borderRadius: 'var(--radius-sm)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                fontSize: '0.85rem',
                fontWeight: 600,
                pointerEvents: 'auto',
                minWidth: '240px',
                textAlign: 'left'
              }}
            >
              {toast.message}
            </div>
          );
        })}
      </div>
    </div>
  );
}
