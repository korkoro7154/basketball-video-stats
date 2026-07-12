import { useEffect, useRef, useState } from 'react';
import type { Player, StatsEvent, GameInfo, Quarter, QuarterVideo, ExportData } from '../types';
import {
  generateCSV,
  generateFullBoxScoreCSV,
  calculateBoxScore,
  calculateTeamStats,
  calculatePlayingTimes
} from '../utils/statsHelper';
import { calculateLineupStats } from '../utils/lineupHelper';
import { Upload, FileText, Save, AlertCircle, X, Download, Printer } from 'lucide-react';

interface FileControlsProps {
  gameInfo: GameInfo;
  players: Player[];
  events: StatsEvent[];
  onImportData: (data: ExportData) => void;
  onResetAllData: () => void;
  
  appMode: 'game' | 'practice';
  scoutingMode: boolean;
  quarterVideos: Record<Quarter, QuarterVideo>;
  startingPlayers: Record<Quarter, string[]>;
  practiceTags: string[];
  quarterDurations: Record<Quarter, number>;
  livePeriodLength: number;

  // モーダル用 Props
  isOpen: boolean;
  onClose: () => void;
}

export const FileControls: React.FC<FileControlsProps> = ({
  gameInfo,
  players,
  events,
  onImportData,
  onResetAllData,
  appMode,
  scoutingMode,
  quarterVideos,
  startingPlayers,
  practiceTags,
  quarterDurations,
  livePeriodLength,
  isOpen,
  onClose
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Escape キー押下でモーダルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // JSONファイルでの書き出し (バックアップ用)
  const exportJSON = () => {
    const exportPayload: ExportData = {
      version: '2.0',
      mode: appMode,
      scoutingMode,
      gameInfo,
      quarterVideos,
      startingPlayers,
      players,
      events,
      practiceTags
    };

    const dataStr = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = gameInfo.date ? `_${gameInfo.date}` : '';
    const modeStr = appMode === 'practice' ? '_practice' : '';
    a.download = `courtvision_stats${modeStr}${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  // 時系列スタッツログ (CSV)
  const exportCSV = () => {
    const csvContent = generateCSV(events, players);
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = gameInfo.date ? `_${gameInfo.date}` : '';
    const modeStr = appMode === 'practice' ? '_practice' : '';
    a.download = `courtvision_timeline${modeStr}${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 試合ボックススコア個人スタッツ (CSV)
  const exportBoxScoreCSV = () => {
    // 1. 各種時間の計算
    const playingTimes = calculatePlayingTimes(
      events,
      startingPlayers,
      players,
      quarterDurations
    );

    // 2. ラインナップ統計の計算 (プラスマイナス取得用)
    const lineups = appMode !== 'practice' ? calculateLineupStats(
      events,
      players,
      startingPlayers,
      quarterDurations,
      appMode,
      livePeriodLength
    ) : [];

    // +/- を算出するヘルパー
    const getPlayerPlusMinus = (playerId: string) => {
      if (appMode === 'practice') return 0;
      return lineups
        .filter(l => l.playerIds.includes(playerId))
        .reduce((sum, l) => sum + l.plusMinus, 0);
    };

    // 3. ボックススコア個人成績の計算
    const homePlayerStats = calculateBoxScore(events, players, 'home', playingTimes).map(stat => ({
      ...stat,
      playingTime: playingTimes[stat.playerId] || 0,
      plusMinus: getPlayerPlusMinus(stat.playerId)
    }));
    const awayPlayerStats = calculateBoxScore(events, players, 'away'); // 相手チームは出場時間は表示しない

    // 4. チーム成績の計算
    const homeTeamStats = calculateTeamStats(events, 'home');
    const awayTeamStats = calculateTeamStats(events, 'away');

    // 5. CSV文字列の生成とダウンロード
    const csvContent = generateFullBoxScoreCSV(
      homePlayerStats,
      homeTeamStats,
      awayPlayerStats,
      awayTeamStats,
      scoutingMode,
      homeTeamStats.pts - awayTeamStats.pts
    );

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); // UTF-8 with BOM
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = gameInfo.date ? `_${gameInfo.date}` : new Date().toISOString().split('T')[0];
    a.download = `courtvision_boxscore_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // レポート印刷 / PDF保存
  const handlePrint = () => {
    window.print();
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        
        if (!parsed.players || !parsed.events) {
          setErrorMsg('無効なファイル形式です。選手リストとスタッツデータが見つかりません。');
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

        onImportData(importedData);
        setErrorMsg('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        onClose(); // インポート成功時にモーダルを閉じる
      } catch (err) {
        setErrorMsg('ファイルの解析に失敗しました。正しいJSONファイルを選択してください。');
      }
    };
    reader.readAsText(file);
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
        padding: '20px'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card animate-slide-in"
        style={{
          width: '500px',
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'rgba(18, 20, 28, 0.95)',
          border: '1px solid var(--accent-color)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.8)',
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
          <Save size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>データの保存 ＆ 出力</h2>
        </div>

        {/* 保存・書き出し */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
          <span style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>形式を選択して保存・エクスポート：</span>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button
              onClick={exportJSON}
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px', height: '64px', justifyContent: 'center', alignItems: 'center' }}
              title="システム間での復元やデータ保管用のJSONファイルを出力します"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}><Save size={16} /> JSON保存</span>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.7)', fontWeight: 400 }}>※復元可能なバックアップ</span>
            </button>
            
            <button
              onClick={exportCSV}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px', height: '64px', justifyContent: 'center', alignItems: 'center' }}
              title="全プレイの時系列イベント履歴をCSV形式で出力します"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}><FileText size={16} /> タイムラインCSV</span>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', fontWeight: 400 }}>※時系列ログデータ</span>
            </button>

            <button
              onClick={exportBoxScoreCSV}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px', height: '64px', justifyContent: 'center', alignItems: 'center' }}
              title="自チーム・相手チームの全選手ボックススコア個人成績をCSV出力します"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}><Download size={16} /> ボックススコアCSV</span>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', fontWeight: 400 }}>※個人スタッツ集計値</span>
            </button>

            <button
              onClick={handlePrint}
              style={{
                fontSize: '0.8rem',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                height: '64px',
                justifyContent: 'center',
                alignItems: 'center',
                background: 'var(--accent-color)',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 700
              }}
              title="見やすいA4印刷レイアウトでレポートを印刷またはPDF保存します"
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}><Printer size={16} /> 印刷 / PDF保存</span>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.8)', fontWeight: 400 }}>※A4対応レポート出力</span>
            </button>
          </div>

          {isSaved && (
            <p style={{ color: 'var(--color-success)', fontSize: '0.8rem', textAlign: 'center', margin: '4px 0 0 0', fontWeight: 600 }}>
              データをダウンロードしました！
            </p>
          )}
        </div>

        {/* 読込（復元） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--glass-border)', paddingTop: '16px', textAlign: 'left' }}>
          <span style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>データの復元（インポート）：</span>
          
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary"
            style={{ width: '100%', fontSize: '0.85rem', padding: '12px' }}
          >
            <Upload size={16} /> 保存データ(.json)を選択して復元
          </button>
          
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileImport}
            accept="application/json"
            style={{ display: 'none' }}
          />

          {errorMsg && (
            <div style={{ display: 'flex', gap: '6px', color: 'var(--color-danger)', fontSize: '0.8rem', alignItems: 'flex-start', background: 'rgba(239,68,68,0.05)', padding: '10px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.1)' }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* データの初期化 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--glass-border)', paddingTop: '16px', textAlign: 'left' }}>
          <span style={{ fontSize: '0.8rem', color: '#ff6b00', fontWeight: 600 }}>危険な操作：</span>
          <button
            onClick={() => {
              onResetAllData();
              onClose();
            }}
            className="btn"
            style={{
              width: '100%',
              fontSize: '0.85rem',
              padding: '10px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--color-danger)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
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
          >
            すべての記録を消去して初期化（新規開始）
          </button>
        </div>
      </div>
    </div>
  );
};
