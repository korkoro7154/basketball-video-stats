import { useRef, useState, useEffect } from 'react';
import type { StatsEvent, Player, Quarter, QuarterVideo } from '../types';
import { formatTime, getStatLabel, calculateTeamStats } from '../utils/statsHelper';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize, UploadCloud, FastForward, Edit3, ArrowUpRight, Slash, Eraser, Trash2, Undo2, FolderOpen } from 'lucide-react';
import { CoachingCanvas } from './CoachingCanvas';
import ReactPlayer from 'react-player';
import type { DrawShape } from './CoachingCanvas';

// Vite ESM/CJS interop helper
const PlayerComponent = (ReactPlayer as any).default || ReactPlayer;

interface VideoPlayerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  onVideoUrlChange: (url: string | null, fileName: string) => void;
  events: StatsEvent[];
  players: Player[];
  currentTime: number;
  duration: number;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  // 新規追加
  appMode: 'game' | 'practice';
  currentQuarter: Quarter;
  onQuarterChange: (quarter: Quarter) => void;
  quarterVideos: Record<Quarter, QuarterVideo>;
  opponentName?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoRef,
  videoUrl,
  onVideoUrlChange,
  events,
  players,
  currentTime,
  duration,
  onTimeUpdate,
  onDurationChange,
  isPlaying,
  setIsPlaying,
  appMode,
  currentQuarter,
  onQuarterChange,
  quarterVideos,
  opponentName
}) => {
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<ReactPlayer>(null);
  
  const currentVideoName = appMode === 'practice'
    ? quarterVideos['1Q'].videoName
    : quarterVideos[currentQuarter]?.videoName || '';
  const [dragOver, setDragOver] = useState(false);
  const [youTubeInput, setYouTubeInput] = useState('');
  
  // --- Google Drive Picker API 認証・呼び出しロジック ---
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isGisLoaded, setIsGisLoaded] = useState(false);
  const [isPickerInitializing, setIsPickerInitializing] = useState(false);
  const [driveDownloadProgress, setDriveDownloadProgress] = useState<number | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
  const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID || '';

  useEffect(() => {
    const checkAPIs = setInterval(() => {
      if ((window as any).gapi) {
        setIsGapiLoaded(true);
      }
      if ((window as any).google && (window as any).google.accounts && (window as any).google.accounts.oauth2) {
        setIsGisLoaded(true);
      }
    }, 500);

    return () => clearInterval(checkAPIs);
  }, []);

  useEffect(() => {
    if (isGapiLoaded) {
      (window as any).gapi.load('picker', () => {
        console.log('Google Picker API loaded');
      });
    }
  }, [isGapiLoaded]);

  const handleOpenGooglePicker = () => {
    if (!API_KEY || API_KEY === 'YOUR_GOOGLE_API_KEY' || !CLIENT_ID || CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
      alert('Google APIキーまたはクライアントIDが設定されていません。プロジェクトの「.env」ファイルに正しいキーを設定してください。');
      return;
    }

    setIsPickerInitializing(true);

    if (accessToken) {
      createPicker(accessToken);
    } else {
      try {
        const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (response: any) => {
            if (response.error !== undefined) {
              console.error('Google Auth Error:', response);
              setIsPickerInitializing(false);
              return;
            }
            const token = response.access_token;
            setAccessToken(token);
            createPicker(token);
          },
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (e) {
        console.error('Error during Google auth:', e);
        alert('Google認証クライアントの初期化に失敗しました。');
        setIsPickerInitializing(false);
      }
    }
  };

  const createPicker = (oauthToken: string) => {
    try {
      const google = (window as any).google;
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setMimeTypes('video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska')
        .setSelectFolderEnabled(false);

      const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(APP_ID)
        .setOAuthToken(oauthToken)
        .addView(view)
        .setDeveloperKey(API_KEY)
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            const document = data.docs[0];
            const fileId = document.id;
            const fileName = document.name;
            console.log('Selected Google Drive File:', fileId, fileName);

            // CORSエラー回避のため、fetchでBlobとしてダウンロードしてからBlob URLを生成する
            setIsPickerInitializing(false);
            setDriveDownloadProgress(0);

            // 既存のBlobURLを解放
            if (blobUrlRef.current) {
              URL.revokeObjectURL(blobUrlRef.current);
              blobUrlRef.current = null;
            }

            const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

            fetch(driveApiUrl, {
              headers: { 'Authorization': `Bearer ${oauthToken}` },
            })
              .then(response => {
                if (!response.ok) {
                  throw new Error(`Google Drive APIエラー: ${response.status} ${response.statusText}`);
                }
                const contentLength = response.headers.get('Content-Length');
                const total = contentLength ? parseInt(contentLength, 10) : 0;
                let loaded = 0;
                const reader = response.body!.getReader();
                const chunks: Uint8Array[] = [];

                const read = (): Promise<void> => {
                  return reader.read().then(({ done, value }) => {
                    if (done) return;
                    chunks.push(value);
                    loaded += value.length;
                    if (total > 0) {
                      setDriveDownloadProgress(Math.round((loaded / total) * 100));
                    }
                    return read();
                  });
                };

                return read().then(() => {
                  const blob = new Blob(chunks, { type: response.headers.get('Content-Type') || 'video/mp4' });
                  return blob;
                });
              })
              .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                blobUrlRef.current = blobUrl;
                setDriveDownloadProgress(null);
                onVideoUrlChange(blobUrl, `[GD] ${fileName}`);
              })
              .catch(err => {
                console.error('Google Drive動画のダウンロードに失敗しました:', err);
                alert(`Googleドライブからの動画ダウンロードに失敗しました。\n${err.message}`);
                setDriveDownloadProgress(null);
              });
          }
          if (data.action === google.picker.Action.CANCEL) {
            setIsPickerInitializing(false);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (e) {
      console.error('Error creating Picker:', e);
      alert('Google Picker の起動に失敗しました。');
      setIsPickerInitializing(false);
    }
  };

  const isYouTube = videoUrl && /(?:youtube\.com|youtu\.be)/i.test(videoUrl);

  // コーチング・ドローイング用の状態
  const [isCoachingActive, setIsCoachingActive] = useState(false);
  const [coachingTool, setCoachingTool] = useState<'pen' | 'line' | 'arrow' | 'eraser'>('pen');
  const [coachingColor, setCoachingColor] = useState('#ef4444'); // 赤デフォルト
  const [coachingWidth, setCoachingWidth] = useState(5); // 太さデフォルト
  const [drawHistory, setDrawHistory] = useState<DrawShape[]>([]);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const updateCanvasSize = () => {
    if (isYouTube) {
      if (containerRef.current) {
        setCanvasSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    } else if (videoRef.current) {
      setCanvasSize({
        width: videoRef.current.clientWidth,
        height: videoRef.current.clientHeight
      });
    }
  };

  useEffect(() => {
    updateCanvasSize();
    const timer = setTimeout(updateCanvasSize, 100);
    window.addEventListener('resize', updateCanvasSize);
    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      clearTimeout(timer);
    };
  }, [videoUrl, isCoachingActive]);

  const handleDrawingStart = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // 描画ツールバーのレンダリング用ヘルパー
  const renderDrawingToolbar = () => (
    <div style={{
      background: 'rgba(18, 20, 28, 0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid var(--glass-border)',
      borderRadius: '24px',
      padding: '6px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      pointerEvents: 'auto'
    }}>
      {/* ツール選択 */}
      <div style={{ display: 'flex', gap: '4px', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '10px' }}>
        {[
          { id: 'pen', icon: <Edit3 size={15} />, label: 'ペン' },
          { id: 'line', icon: <Slash size={15} />, label: '直線' },
          { id: 'arrow', icon: <ArrowUpRight size={15} />, label: '矢印' },
          { id: 'eraser', icon: <Eraser size={15} />, label: '消しゴム' }
        ].map(tool => (
          <button
            key={tool.id}
            onClick={() => setCoachingTool(tool.id as any)}
            style={{
              background: coachingTool === tool.id ? 'var(--accent-color)' : 'transparent',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      {/* カラー選択 (消しゴム以外) */}
      {coachingTool !== 'eraser' && (
        <div style={{ display: 'flex', gap: '6px', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '10px', alignItems: 'center' }}>
          {[
            { name: '赤', val: '#ef4444' },
            { name: '青', val: '#3b82f6' },
            { name: '黄', val: '#eab308' },
            { name: '白', val: '#ffffff' }
          ].map(c => (
            <button
              key={c.val}
              onClick={() => setCoachingColor(c.val)}
              style={{
                background: c.val,
                border: coachingColor === c.val ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                transform: coachingColor === c.val ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.1s'
              }}
              title={c.name}
            />
          ))}
        </div>
      )}

      {/* 太さ選択 */}
      <div style={{ display: 'flex', gap: '4px', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '10px', alignItems: 'center' }}>
        {[
          { label: '細', width: 2 },
          { label: '中', width: 5 },
          { label: '太', width: 10 }
        ].map(w => (
          <button
            key={w.width}
            onClick={() => setCoachingWidth(w.width)}
            style={{
              background: coachingWidth === w.width ? 'rgba(255,255,255,0.15)' : 'transparent',
              border: 'none',
              color: coachingWidth === w.width ? 'var(--accent-color)' : '#aaa',
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '4px 6px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* 操作: 戻す / クリア */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <button
          onClick={() => setDrawHistory(prev => prev.slice(0, -1))}
          style={{
            background: 'transparent',
            border: 'none',
            color: drawHistory.length > 0 ? '#fff' : '#666',
            cursor: drawHistory.length > 0 ? 'pointer' : 'default',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%'
          }}
          disabled={drawHistory.length === 0}
          title="元に戻す (Undo)"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={() => setDrawHistory([])}
          style={{
            background: 'transparent',
            border: 'none',
            color: drawHistory.length > 0 ? '#fff' : '#666',
            cursor: drawHistory.length > 0 ? 'pointer' : 'default',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%'
          }}
          disabled={drawHistory.length === 0}
          title="全消去"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );



  const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  // 動画ファイル選択
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      onVideoUrlChange(url, file.name);
    }
  };

  // ドラッグ＆ドロップ
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // 1. YouTubeなどのURLリンクがドラッグ＆ドロップされた場合
    const textUrl = e.dataTransfer.getData('text/plain');
    if (textUrl && /(?:youtube\.com|youtu\.be)/i.test(textUrl)) {
      onVideoUrlChange(textUrl.trim(), 'YouTube 動画');
      return;
    }

    // 2. ローカルの動画ファイルがドラッグ＆ドロップされた場合
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      onVideoUrlChange(url, file.name);
    }
  };

  // 再生トグル
  const togglePlay = () => {
    if (isYouTube) {
      setIsPlaying(!isPlaying);
      return;
    }
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(err => console.log('Playback error:', err));
    }
  };

  // ミュート
  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!videoRef.current) return;
    videoRef.current.volume = val;
    setVolume(val);
    if (val === 0) {
      videoRef.current.muted = true;
      setIsMuted(true);
    } else {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  // 速度変更
  const handleSpeedChange = (rate: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  };

  // シークバー
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!videoRef.current) return;
    videoRef.current.currentTime = val;
    onTimeUpdate(val);
  };

  // フルスクリーン
  const handleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  // タイムラインマーカージャンプ
  const jumpToEvent = (timestamp: number) => {
    const targetTime = Math.max(0, timestamp - 5);
    if (isYouTube) {
      if (playerRef.current) {
        playerRef.current.seekTo(targetTime, 'seconds');
        onTimeUpdate(targetTime);
        setIsPlaying(true);
      }
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = targetTime;
    onTimeUpdate(targetTime);
    videoRef.current.play().then(() => {
      setIsPlaying(true);
    }).catch(err => console.log(err));
  };

  // 再生速度の同期
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, videoUrl]);

  // 動画URL変更時に明示的にロードを走らせる（Safari対策）＆ 描画履歴をクリア
  useEffect(() => {
    if (videoRef.current) {
      if (videoUrl) {
        videoRef.current.load();
      } else {
        // 動画URLがない場合は、明示的にsrcを空にして再生プロセスを解放する
        videoRef.current.src = "";
        try {
          videoRef.current.load();
        } catch (e) {
          console.error('Failed to reset video element:', e);
        }
      }
    }
    setDrawHistory([]);
  }, [videoUrl]);

  // コンポーネントがアンマウントされる（ホワイトボード切り替えなど）時にデコーダを確実に解放する
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.src = "";
        try {
          videoRef.current.load();
        } catch (e) {
          // ignore
        }
      }
      // 生成したBlobURLを解放してメモリリークを防ぐ
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [videoRef]);

  // マーカーカラー
  const getMarkerColor = (type: string, team: 'home' | 'away'): string => {
    if (type === 'TIMEOUT') return '#ffeb3b'; // タイムアウトは明るい黄色
    if (team === 'away') return 'var(--color-danger)';
    if (type.includes('MADE')) return 'var(--color-success)';
    if (type.includes('MISS')) return 'rgba(239, 68, 68, 0.6)';
    if (['AST', 'OREB', 'DREB'].includes(type)) return 'var(--color-info)';
    if (['STL', 'BLK'].includes(type)) return 'var(--color-purple)';
    return 'var(--color-warning)';
  };

  // プレイヤーラベル
  const getPlayerLabel = (playerId: string | null): string => {
    if (!playerId) return 'チーム全体';
    const player = players.find(p => p.id === playerId);
    return player ? `#${player.number} ${player.name}` : '不明な選手';
  };

  // 現在のクオーター、または練習モード用の表示対象イベント
  // 試合モードの場合は「現在選択されているクオーター」のイベントのみ表示する
  const displayEvents = events.filter(e => {
    if (appMode === 'practice') return true;
    if (currentQuarter === 'TOTAL') return true;
    return e.quarter === currentQuarter;
  });

  const homeStats = calculateTeamStats(events, 'home');
  const awayStats = calculateTeamStats(events, 'away');

  return (
    <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* クオーター切り替えタブ (試合モードのみ) */}
      {appMode === 'game' && (
        <div style={{
          display: 'flex',
          gap: '6px',
          borderBottom: '1px solid var(--glass-border)',
          paddingBottom: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
          width: '100%'
        }}>
          <span style={{ fontSize: '0.85rem', color: '#aaa', fontWeight: 600, marginRight: '8px' }}>クオーター選択:</span>
          {(['1Q', '2Q', '3Q', '4Q', 'OT', 'TOTAL'] as Quarter[]).map((q) => {
            const hasVideo = q !== 'TOTAL' && !!quarterVideos[q]?.videoUrl;
            const label = q === 'TOTAL' ? '試合合計' : q;
            return (
              <button
                key={q}
                onClick={() => onQuarterChange(q)}
                className={currentQuarter === q ? 'quarter-tab-active' : ''}
                style={{
                  padding: '6px 14px',
                  background: currentQuarter === q ? 'var(--accent-color)' : 'rgba(255,255,255,0.02)',
                  borderColor: currentQuarter === q ? 'var(--accent-color)' : 'var(--glass-border)',
                  color: currentQuarter === q ? '#fff' : '#aaa',
                  border: '1px solid',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{label}</span>
                {hasVideo && (
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#4ade80',
                    display: 'inline-block',
                    boxShadow: '0 0 6px rgba(74, 222, 128, 0.8)',
                    animation: 'pulse 2s ease-in-out infinite'
                  }} title="動画あり" />
                )}
              </button>
            );
          })}

          {/* 得点表示 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--glass-border)',
            borderRadius: '6px',
            padding: '4px 12px',
            marginLeft: 'auto',
            gap: '8px',
            fontSize: '0.8rem',
            fontWeight: 700
          }}>
            <span style={{ color: 'var(--accent-color)' }}>自チーム {homeStats.pts}</span>
            <span style={{ color: '#666' }}>-</span>
            <span style={{ color: 'var(--color-danger)' }}>{opponentName || '相手'} {awayStats.pts}</span>
          </div>
        </div>
      )}

      {/* コーチングツール＆ホワイトボード切り替えバー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.01)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 12px',
        fontSize: '0.85rem'
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#aaa' }}>作戦ツール:</span>
          <button
            onClick={() => {
              setIsCoachingActive(!isCoachingActive);
              if (!isCoachingActive && isPlaying && videoRef.current) {
                videoRef.current.pause();
                setIsPlaying(false);
              }
            }}
            className="btn"
            style={{
              background: isCoachingActive ? 'rgba(255, 107, 0, 0.15)' : 'rgba(255,255,255,0.02)',
              borderColor: isCoachingActive ? 'var(--accent-color)' : 'var(--glass-border)',
              color: isCoachingActive ? 'var(--accent-color)' : '#ccc',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              border: '1px solid'
            }}
          >
            <Edit3 size={12} />
            動画上ドローイング {isCoachingActive ? 'ON' : 'OFF'}
          </button>
        </div>

        {isCoachingActive && (
          <span style={{ fontSize: '0.75rem', color: '#888', fontStyle: 'italic' }}>
            ※描画すると動画は自動で一時停止し、再生すると描画がクリアされます
          </span>
        )}
      </div>

      {!videoUrl ? (
        /* ビデオ未読み込み時のドラッグ＆ドロップ */
        <div
          onDragOver={currentQuarter === 'TOTAL' ? undefined : handleDragOver}
          onDragLeave={currentQuarter === 'TOTAL' ? undefined : handleDragLeave}
          onDrop={currentQuarter === 'TOTAL' ? undefined : handleDrop}
          onClick={currentQuarter === 'TOTAL' ? undefined : () => fileInputRef.current?.click()}
          className={`video-dropzone ${dragOver ? 'drag-over' : ''} ${currentQuarter === 'TOTAL' ? 'disabled' : ''}`}
        >
          <UploadCloud size={48} style={{ color: dragOver ? 'var(--accent-color)' : '#666' }} />
          <div style={{ textAlign: 'center', padding: '0 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <p style={{ fontWeight: 600, fontSize: '1.1rem' }}>
              {appMode === 'practice'
                ? '練習動画ファイルをドラッグ＆ドロップ'
                : currentQuarter === 'TOTAL'
                  ? 'クオーター（1Q〜OT）を選択して動画ファイルを読み込んでください'
                  : `${currentQuarter}の動画ファイルをドラッグ＆ドロップ`}
            </p>
            

            {/* Google Drive から選択 & YouTube URL 入力 */}
            {currentQuarter !== 'TOTAL' && (
              <div 
                onClick={(e) => e.stopPropagation()}
                style={{ 
                  marginTop: '12px', 
                  marginBottom: '12px',
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  gap: '8px',
                  width: '100%',
                  maxWidth: '320px',
                  pointerEvents: 'auto'
                }}
              >
                {/* Google Picker 起動ボタン */}
                <button
                  onClick={handleOpenGooglePicker}
                  disabled={isPickerInitializing}
                  className="btn"
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--glass-border)',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: isPickerInitializing ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s'
                  }}
                >
                  <FolderOpen size={16} style={{ color: 'var(--color-info)' }} />
                  {isPickerInitializing ? 'Googleドライブ連携中...' : 'Googleドライブから動画を選択'}
                </button>

                <div style={{ fontSize: '0.75rem', color: '#666', margin: '4px 0' }}>ー または ー</div>

                <input
                  type="text"
                  placeholder="または YouTube URL を入力"
                  value={youTubeInput}
                  onChange={(e) => setYouTubeInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(0, 0, 0, 0.4)',
                    color: '#fff',
                    fontSize: '0.85rem'
                  }}
                />
                <button
                  onClick={() => {
                    if (youTubeInput.trim()) {
                      onVideoUrlChange(youTubeInput.trim(), 'YouTube 動画');
                      setYouTubeInput('');
                    }
                  }}
                  className="btn"
                  style={{
                    background: 'var(--accent-color)',
                    color: '#fff',
                    border: 'none',
                    padding: '6px 16px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  URLから読み込み
                </button>
              </div>
            )}

            {currentVideoName ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginTop: '10px' }}>
                <p style={{ color: 'var(--accent-color)', fontSize: '0.85rem', fontWeight: 600, background: 'rgba(255, 107, 0, 0.05)', padding: '6px 14px', borderRadius: '4px', border: '1px dashed var(--accent-color)', display: 'inline-block' }}>
                  元のファイル: {currentVideoName}
                </p>
                <p style={{ color: '#666', fontSize: '0.75rem' }}>※ 復元データと紐付けるために、上記ファイルをドラッグ＆ドロップしてください</p>
              </div>
            ) : (
              <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '4px' }}>または、クリックしてファイルを選択</p>
            )}
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="video/*"
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        /* ビデオ読み込み時のプレイヤー + キャンバスオーバーレイ */
        <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column' }}>
          
          {/* ビデオ表示エリア */}
          <div
            ref={containerRef}
            style={{
              position: 'relative',
              background: '#000',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
              maxWidth: '100%',
              aspectRatio: '16/9',
              margin: '0 auto'
            }}
          >
            {/* Googleドライブ動画ダウンロード中プログレスオーバーレイ */}
            {driveDownloadProgress !== null && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.85)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 20,
                gap: '16px',
                borderRadius: 'var(--radius-md)',
              }}>
                <div style={{ fontSize: '2rem' }}>☁️</div>
                <p style={{ color: '#fff', fontSize: '0.95rem', margin: 0 }}>
                  Googleドライブから動画をダウンロード中... {driveDownloadProgress}%
                </p>
                <div style={{ width: '60%', height: '8px', background: 'rgba(255,255,255,0.2)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${driveDownloadProgress}%`,
                    background: 'linear-gradient(90deg, #4285f4, #34a853)',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}
            {isYouTube ? (
              <div 
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  background: '#000', 
                  position: 'relative' 
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <PlayerComponent
                  ref={playerRef}
                  url={videoUrl || ''}
                  controls
                  playing={isPlaying}
                  volume={volume}
                  muted={isMuted}
                  playbackRate={playbackRate}
                  width="100%"
                  height="100%"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onProgress={(progress: { playedSeconds: number }) => {
                    onTimeUpdate(progress.playedSeconds);
                  }}
                  onDuration={(dur: number) => {
                    onDurationChange(dur);
                  }}
                  onError={(e: any) => {
                    console.error("YouTube playback error:", e);
                    alert("YouTube動画の読み込みに失敗しました。URLが正しいか確認してください。");
                  }}
                />
              </div>
            ) : (
              <video
                key={videoUrl || 'video-player'}
                ref={videoRef}
                src={videoUrl || undefined}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onClick={togglePlay}
                preload="auto"
                playsInline
                controls
                muted={isMuted}
                onPlay={() => {
                  setIsPlaying(true);
                  setDrawHistory([]); // Auto-clear drawings on play
                }}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                onDurationChange={(e) => onDurationChange(e.currentTarget.duration)}
                onLoadedMetadata={(e) => {
                  onDurationChange(e.currentTarget.duration);
                  setTimeout(updateCanvasSize, 100);
                }}
                onError={(e) => {
                  const videoElement = e.currentTarget;
                  const error = videoElement.error;
                  console.error("Video error event:", error);
                  let msg = "動画の読み込みに失敗しました。";
                  if (error) {
                    switch (error.code) {
                      case error.MEDIA_ERR_ABORTED:
                        msg = "動画の読み込みが中断されました。";
                        break;
                      case error.MEDIA_ERR_NETWORK:
                        msg = "ネットワークエラーにより動画の読み込みに失敗しました。";
                        break;
                      case error.MEDIA_ERR_DECODE:
                        msg = "動画のデコードに失敗しました。この動画ファイル形式（または音声/映像コーデック）はブラウザでデコードできません。MP4形式（H.264 / AACコーデック）への変換をお試しください。";
                        break;
                      case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        msg = "動画の形式がブラウザでサポートされていません。ブラウザが対応している標準的なMP4ファイル（映像: H.264, 音声: AAC）をご利用ください。";
                        break;
                    }
                  }
                  alert(msg);
                }}
              />
            )}

            {/* Drawing Canvas */}
            {isCoachingActive && canvasSize.width > 0 && (
              <CoachingCanvas
                width={canvasSize.width}
                height={canvasSize.height}
                activeTool={coachingTool}
                brushColor={coachingColor}
                brushWidth={coachingWidth}
                onDrawingStart={handleDrawingStart}
                canvasRef={canvasRef}
                history={drawHistory}
                setHistory={setDrawHistory}
              />
            )}

            {/* Floating Toolbar above video */}
            {isCoachingActive && (
              <div style={{ position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
                {renderDrawingToolbar()}
              </div>
            )}
          </div>

          {/* タイムスタンプ */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#aaa', marginTop: '10px', padding: '0 4px' }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* カスタムタイムライン & マーカー */}
          <div style={{ position: 'relative', margin: '4px 0 16px 0', padding: '4px 0' }}>
            {/* タイムラインマーカー表示コンテナ */}
            <div style={{ position: 'absolute', left: '0', right: '0', top: '50%', transform: 'translateY(-50%)', height: '0px', pointerEvents: 'none', zIndex: 10 }}>
              {duration > 0 && displayEvents.map((event) => {
                const percent = (event.timestamp / duration) * 100;
                if (percent < 0 || percent > 100) return null;
                const markerColor = getMarkerColor(event.type, event.team);
                
                // ツールチップ表示用の文字列構築
                let tooltipText = '';
                if (appMode === 'practice') {
                  tooltipText = `${formatTime(event.timestamp)} - [練習] ${event.practiceTag || 'タグなし'}`;
                } else {
                  const teamName = event.team === 'home' ? '自チーム' : '相手チーム';
                  const playerText = event.playerId ? getPlayerLabel(event.playerId) : 'チーム全体';
                  tooltipText = `${formatTime(event.timestamp)} - [${event.quarter}] ${teamName} (${playerText}): ${getStatLabel(event.type)}`;
                }

                return (
                  <button
                    key={event.id}
                    onClick={() => jumpToEvent(event.timestamp)}
                    className="timeline-marker"
                    style={{
                      position: 'absolute',
                      left: `${percent}%`,
                      transform: 'translateX(-50%)',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: markerColor,
                      border: '2px solid #0b0c10',
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      padding: 0,
                      boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                      transition: 'all 0.15s ease'
                    }}
                    title={tooltipText}
                  />
                );
              })}
            </div>

            {/* シークバー */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeekChange}
              style={{
                width: '100%',
                cursor: 'pointer',
                accentColor: 'var(--accent-color)',
                height: '6px',
                borderRadius: '3px',
                background: 'rgba(255,255,255,0.1)',
                WebkitAppearance: 'none',
                outline: 'none',
                position: 'relative',
                zIndex: 5
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={togglePlay}
                className="btn btn-icon"
                style={{ background: isPlaying ? 'rgba(255,107,0,0.15)' : 'var(--bg-tertiary)', borderColor: isPlaying ? 'var(--accent-color)' : 'var(--glass-border)' }}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
                  }
                }}
                className="btn btn-secondary"
                style={{ padding: '8px 12px' }}
                title="5秒戻る"
              >
                <RotateCcw size={14} /> 5s
              </button>

              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
                  }
                }}
                className="btn btn-secondary"
                style={{ padding: '8px 12px' }}
                title="5秒進む"
              >
                5s <FastForward size={14} />
              </button>
            </div>

            {/* 音量調整 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={toggleMute} className="btn btn-icon" style={{ width: '32px', height: '32px' }}>
                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                style={{ width: '70px', accentColor: 'var(--accent-color)' }}
              />
            </div>

            {/* 再生速度 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', color: '#888' }}>再生速度:</span>
              <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '4px' }}>
                {speedOptions.map(rate => (
                  <button
                    key={rate}
                    onClick={() => handleSpeedChange(rate)}
                    style={{
                      border: 'none',
                      background: playbackRate === rate ? 'var(--accent-color)' : 'transparent',
                      color: playbackRate === rate ? '#fff' : '#aaa',
                      fontSize: '0.75rem',
                      padding: '4px 6px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.1s'
                    }}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleOpenGooglePicker}
                disabled={isPickerInitializing}
                className="btn btn-secondary"
                style={{ padding: '8px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Googleドライブから動画を変更します"
              >
                <FolderOpen size={13} style={{ color: 'var(--color-info)' }} />
                {isPickerInitializing ? 'ロード中...' : 'ドライブから変更'}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-secondary"
                style={{ padding: '8px 12px', fontSize: '0.8rem' }}
              >
                ローカル動画変更
              </button>
              <button onClick={handleFullscreen} className="btn btn-icon" style={{ width: '34px', height: '34px' }} title="全画面表示">
                <Maximize size={15} />
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="video/*"
              style={{ display: 'none' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
