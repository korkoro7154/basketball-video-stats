import React, { useRef, useState, useEffect } from 'react';
import type { Player } from '../types';
import { CoachingCanvas } from './CoachingCanvas';
import type { DrawShape } from './CoachingCanvas';
import { Edit3, Slash, ArrowUpRight, Eraser, Trash2, Undo2, Users, Download } from 'lucide-react';

interface TacticalBoardProps {
  players: Player[];
}

interface TacticalPlayer {
  id: string;
  number: string;
  name: string;
  team: 'home' | 'away';
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
}

export const TacticalBoard: React.FC<TacticalBoardProps> = ({ players }) => {
  const [onCourtPlayers, setOnCourtPlayers] = useState<TacticalPlayer[]>([]);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);

  // Drawing Canvas State
  const [coachingTool, setCoachingTool] = useState<'pen' | 'line' | 'arrow' | 'eraser'>('pen');
  const [coachingColor, setCoachingColor] = useState('#ef4444');
  const [coachingWidth, setCoachingWidth] = useState(5);
  const [drawHistory, setDrawHistory] = useState<DrawShape[]>([]);

  const [courtType, setCourtType] = useState<'half' | 'full'>('half');

  const courtRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const updateCanvasSize = () => {
    if (courtRef.current) {
      setCanvasSize({
        width: courtRef.current.clientWidth,
        height: courtRef.current.clientHeight
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
  }, []);

  // Update canvas size when court type changes to accommodate aspect ratio transition
  useEffect(() => {
    updateCanvasSize();
    const timer = setTimeout(updateCanvasSize, 50);
    return () => clearTimeout(timer);
  }, [courtType]);


  // Toggle player on/off the court
  const handleTogglePlayer = (player: Player) => {
    const exists = onCourtPlayers.some(p => p.id === player.id);
    if (exists) {
      // Remove
      setOnCourtPlayers(prev => prev.filter(p => p.id !== player.id));
    } else {
      // Add near the bottom bench area or center
      const isHome = player.team === 'home';
      // Distribute default positions a bit based on current count
      const offset = (onCourtPlayers.length % 5) * 8;
      const defaultX = isHome ? (30 + offset) : (70 - offset);
      const defaultY = 60;

      const newPlayer: TacticalPlayer = {
        id: player.id,
        number: player.number,
        name: player.name,
        team: player.team,
        x: defaultX,
        y: defaultY
      };
      setOnCourtPlayers(prev => [...prev, newPlayer]);
    }
  };

  // Draggable player handlers
  const handlePlayerPointerDown = (e: React.PointerEvent<HTMLDivElement>, playerId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPlayerId(playerId);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePlayerPointerMove = (e: React.PointerEvent<HTMLDivElement>, playerId: string) => {
    if (draggingPlayerId !== playerId) return;
    e.stopPropagation();
    e.preventDefault();

    const court = courtRef.current;
    if (!court) return;
    const rect = court.getBoundingClientRect();

    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    // Constraints
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));

    setOnCourtPlayers(prev => prev.map(p => p.id === playerId ? { ...p, x, y } : p));
  };

  const handlePlayerPointerUp = (e: React.PointerEvent<HTMLDivElement>, _playerId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPlayerId(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Clear everything
  const handleResetBoard = () => {
    if (window.confirm('作戦盤の描画と配置された選手をすべてクリアしますか？')) {
      setDrawHistory([]);
      setOnCourtPlayers([]);
    }
  };

  // State to force-update slot availability UI on save
  const [slotVersion, setSlotVersion] = useState(0);

  // Save layout & drawings to a specific slot
  const handleSaveSlot = (slotNum: number) => {
    const data = {
      courtType,
      onCourtPlayers,
      drawHistory
    };
    localStorage.setItem(`basketball_tactical_slot_${slotNum}`, JSON.stringify(data));
    setSlotVersion(prev => prev + 1);
  };

  // Load layout & drawings from a specific slot
  const handleLoadSlot = (slotNum: number) => {
    const saved = localStorage.getItem(`basketball_tactical_slot_${slotNum}`);
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (data.courtType) setCourtType(data.courtType);
      if (data.onCourtPlayers) setOnCourtPlayers(data.onCourtPlayers);
      if (data.drawHistory) setDrawHistory(data.drawHistory);
    } catch (e) {
      console.error(e);
      alert('作戦データの読み込みに失敗しました。');
    }
  };

  // Check if slot has saved data
  const hasSlotData = (slotNum: number): boolean => {
    // slotVersion forces re-evaluation when slots change
    return localStorage.getItem(`basketball_tactical_slot_${slotNum}`) !== null;
  };

  // Export current board configuration (wood background, lines, players and drawn paths) as PNG
  const handleExportImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create high-res export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // 1. Draw wood floor gradient background
    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height)
    );
    grad.addColorStop(0, '#20130a');
    grad.addColorStop(1, '#0d0804');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Draw court SVG-like outline on Canvas
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2.0;
    
    // Boundary offsets based on standard proportions
    const padX = canvas.width * 0.03;
    const padY = canvas.height * 0.03;
    const cw = canvas.width - padX * 2;
    const ch = canvas.height - padY * 2;

    // Court boundary outline
    ctx.strokeRect(padX, padY, cw, ch);

    if (courtType === 'half') {
      // Paint Key (3.6m wide, 5.8m long proportionally)
      const keyW = cw * 0.328;
      const keyH = ch * 0.435;
      const keyX = padX + (cw - keyW) / 2;
      ctx.strokeRect(keyX, padY, keyW, keyH);

      // Free throw circle top half
      ctx.beginPath();
      ctx.arc(padX + cw / 2, padY + keyH, keyW / 2, 0, Math.PI);
      ctx.stroke();

      // Backboard & Ring
      const bbW = cw * 0.12;
      ctx.beginPath();
      ctx.moveTo(padX + cw / 2 - bbW / 2, padY + ch * 0.084);
      ctx.lineTo(padX + cw / 2 + bbW / 2, padY + ch * 0.084);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(padX + cw / 2, padY + ch * 0.118, cw * 0.03, 0, 2 * Math.PI);
      ctx.stroke();

      // 3 Point Line Arc
      ctx.beginPath();
      // Center circle
      ctx.arc(padX + cw / 2, padY + ch, cw * 0.12, Math.PI, 2 * Math.PI);
      ctx.stroke();
    } else {
      // Full court center lines
      ctx.beginPath();
      ctx.moveTo(padX + cw / 2, padY);
      ctx.lineTo(padX + cw / 2, padY + ch);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(padX + cw / 2, padY + ch / 2, ch * 0.144, 0, 2 * Math.PI);
      ctx.stroke();

      // Left court paint
      ctx.strokeRect(padX, padY + ch * 0.34, cw * 0.19, ch * 0.32);
      // Right court paint
      ctx.strokeRect(padX + cw * 0.81, padY + ch * 0.34, cw * 0.19, ch * 0.32);
    }

    // 3. Draw Coaching Canvas Drawings (Lines, Arrows, Strokes)
    ctx.drawImage(canvas, 0, 0);

    // 4. Draw Draggable Player Badges onto the exported image
    onCourtPlayers.forEach(p => {
      const px = (p.x / 100) * canvas.width;
      const py = (p.y / 100) * canvas.height;

      // Drop shadow for player badge
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;

      // Base circle
      ctx.beginPath();
      ctx.arc(px, py, 18, 0, 2 * Math.PI);
      ctx.fillStyle = p.team === 'home' ? '#ff6b00' : '#ef4444';
      ctx.fill();

      // Reset shadow for stroke
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Border outline
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Text (Player Number)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.number, px, py);

      // Text label (Player Name below circle)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Mini background label for name readability
      const labelW = ctx.measureText(p.name).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(px - labelW / 2, py + 22, labelW, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.name, px, py + 24);
    });

    // 5. Trigger download
    const dataUrl = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    link.download = `tactical-play-${today}-${courtType}.png`;
    link.href = dataUrl;
    link.click();
  };

  // Roster categories
  const homeRoster = players.filter(p => p.team === 'home');
  const awayRoster = players.filter(p => p.team === 'away');

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 340px',
      gap: '16px',
      width: '100%',
      minHeight: '600px',
      boxSizing: 'border-box'
    }}>
      {/* 左側: コートエリア */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          ref={courtRef}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: courtType === 'half' ? '16/15' : '2/1', // Keep standard basketball half/full court aspect ratio
            maxHeight: courtType === 'half' ? '620px' : '500px',
            background: 'radial-gradient(circle at 50% 50%, #20130a 0%, #0d0804 100%)', // Wood floor theme
            border: '2.5px solid rgba(255, 107, 0, 0.2)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6), inset 0 0 40px rgba(0, 0, 0, 0.5)',
            margin: '0 auto',
            touchAction: 'none'
          }}
        >
          {/* SVG Court lines */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'none'
          }}>
            {courtType === 'half' ? (
              <svg
                viewBox="0 0 100 95"
                style={{
                  height: '94%',
                  width: 'auto',
                  stroke: 'rgba(255, 255, 255, 0.35)',
                  strokeWidth: '0.9',
                  fill: 'none',
                  filter: 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.2))'
                }}
              >
                {/* Outer boundary */}
                <rect x="0" y="0" width="100" height="95" />
                {/* Paint */}
                <rect x="33.6" y="0" width="32.8" height="41.4" style={{ fill: 'rgba(255, 107, 0, 0.03)' }} />
                {/* Free throw circle top half */}
                <path d="M 33.6 41.4 A 16.4 16.4 0 0 1 66.4 41.4" />
                {/* Backboard & Ring */}
                <line x1="44" y1="8" x2="56" y2="8" />
                <line x1="50" y1="0" x2="50" y2="8" />
                <circle cx="50" cy="11.25" r="3" />
                {/* 3 Point line */}
                <path d="M 6 21.3 A 44 44 0 0 0 94 21.3" />
                <line x1="0" y1="21.3" x2="6" y2="21.3" />
                <line x1="94" y1="21.3" x2="100" y2="21.3" />
                {/* Center circle */}
                <circle cx="50" cy="95" r="12" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 100 50"
                style={{
                  height: '94%',
                  width: 'auto',
                  stroke: 'rgba(255, 255, 255, 0.35)',
                  strokeWidth: '0.9',
                  fill: 'none',
                  filter: 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.2))'
                }}
              >
                {/* Outer boundary */}
                <rect x="0" y="0" width="100" height="50" rx="1.5" ry="1.5" />
                {/* Center line */}
                <line x1="50" y1="0" x2="50" y2="50" />
                {/* Center circle */}
                <circle cx="50" cy="25" r="7.2" />
                {/* Center circle restricted */}
                <circle cx="50" cy="25" r="2.4" />
                
                {/* Left Court */}
                <rect x="0" y="17" width="19" height="16" style={{ fill: 'rgba(255, 107, 0, 0.02)' }} />
                <path d="M 19 17 A 8 8 0 0 1 19 33" />
                <line x1="0" y1="25" x2="4" y2="25" />
                <line x1="4" y1="21" x2="4" y2="29" />
                <circle cx="5.6" cy="25" r="1.5" />
                <path d="M 0 3 L 5.6 3 A 22 22 0 0 1 5.6 47 L 0 47" />

                {/* Right Court */}
                <rect x="81" y="17" width="19" height="16" style={{ fill: 'rgba(255, 107, 0, 0.02)' }} />
                <path d="M 81 17 A 8 8 0 0 0 81 33" />
                <line x1="96" y1="25" x2="100" y2="25" />
                <line x1="96" y1="21" x2="96" y2="29" />
                <circle cx="94.4" cy="25" r="1.5" />
                <path d="M 100 3 L 94.4 3 A 22 22 0 0 0 94.4 47 L 100 47" />
              </svg>
            )}
          </div>

          {/* Drawing Canvas */}
          <CoachingCanvas
            width={canvasSize.width}
            height={canvasSize.height}
            activeTool={coachingTool}
            brushColor={coachingColor}
            brushWidth={coachingWidth}
            onDrawingStart={() => {}}
            canvasRef={canvasRef}
            history={drawHistory}
            setHistory={setDrawHistory}
          />

          {/* Draggable Players on Court */}
          {onCourtPlayers.map((player) => (
            <div
              key={player.id}
              onPointerDown={(e) => handlePlayerPointerDown(e, player.id)}
              onPointerMove={(e) => handlePlayerPointerMove(e, player.id)}
              onPointerUp={(e) => handlePlayerPointerUp(e, player.id)}
              style={{
                position: 'absolute',
                left: `calc(${player.x}% - 18px)`,
                top: `calc(${player.y}% - 18px)`,
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: player.team === 'home' ? 'var(--accent-color)' : 'var(--color-danger)',
                border: '2.5px solid #fff',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1rem',
                cursor: 'grab',
                userSelect: 'none',
                zIndex: 60,
                boxShadow: '0 6px 16px rgba(0,0,0,0.6)',
                touchAction: 'none'
              }}
              title={player.name}
            >
              {player.number}
              {/* Floating Name Label */}
              <span style={{
                position: 'absolute',
                top: '40px',
                background: 'rgba(0, 0, 0, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontSize: '0.62rem',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
              }}>
                {player.name}
              </span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>
          ※ コート上をドラッグして描き込み、選手アイコンをドラッグして移動させることができます。
        </div>
      </div>

      {/* 右側: コントロールパネル */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* 作戦盤コントローラー */}
        <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Edit3 size={16} style={{ color: 'var(--accent-color)' }} /> 作戦盤ツール
          </h3>

          {/* コート形式選択 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>コート形式:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { id: 'half', label: 'ハーフコート' },
                { id: 'full', label: 'フルコート' }
              ].map(type => (
                <button
                  key={type.id}
                  onClick={() => setCourtType(type.id as 'half' | 'full')}
                  className="btn"
                  style={{
                    background: courtType === type.id ? 'var(--accent-color)' : 'rgba(255,255,255,0.02)',
                    borderColor: courtType === type.id ? 'var(--accent-color)' : 'var(--glass-border)',
                    color: '#fff',
                    fontSize: '0.75rem',
                    flex: 1,
                    padding: '6px 0',
                    cursor: 'pointer',
                    fontWeight: 600,
                    borderRadius: '6px',
                    transition: 'all 0.2s'
                  }}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* ツール選択 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {[
              { id: 'pen', icon: <Edit3 size={15} />, label: 'ペン' },
              { id: 'line', icon: <Slash size={15} />, label: '直線' },
              { id: 'arrow', icon: <ArrowUpRight size={15} />, label: '矢印' },
              { id: 'eraser', icon: <Eraser size={15} />, label: '消しゴム' }
            ].map(tool => (
              <button
                key={tool.id}
                onClick={() => setCoachingTool(tool.id as any)}
                className="btn"
                style={{
                  background: coachingTool === tool.id ? 'var(--accent-color)' : 'rgba(255,255,255,0.02)',
                  borderColor: coachingTool === tool.id ? 'var(--accent-color)' : 'var(--glass-border)',
                  color: '#fff',
                  padding: '8px 0',
                  borderRadius: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </button>
            ))}
          </div>

          {/* カラー選択 (消しゴム以外) */}
          {coachingTool !== 'eraser' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>描画カラー:</span>
              <div style={{ display: 'flex', gap: '8px' }}>
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
                      border: coachingColor === c.val ? '2.5px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '50%',
                      width: '26px',
                      height: '26px',
                      cursor: 'pointer',
                      transform: coachingColor === c.val ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 0.1s'
                    }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 太さ選択 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>線の太さ:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { label: '細', width: 2 },
                { label: '中', width: 5 },
                { label: '太', width: 10 }
              ].map(w => (
                <button
                  key={w.width}
                  onClick={() => setCoachingWidth(w.width)}
                  className="btn"
                  style={{
                    background: coachingWidth === w.width ? 'rgba(255, 107, 0, 0.15)' : 'rgba(255,255,255,0.02)',
                    borderColor: coachingWidth === w.width ? 'var(--accent-color)' : 'var(--glass-border)',
                    color: coachingWidth === w.width ? 'var(--accent-color)' : '#ccc',
                    fontSize: '0.75rem',
                    flex: 1,
                    padding: '6px 0',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* 編集補助ボタン */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', borderTop: '1px solid var(--glass-border)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button
                onClick={() => setDrawHistory(prev => prev.slice(0, -1))}
                className="btn btn-secondary"
                style={{ flex: 1, padding: '6px 0', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer' }}
                disabled={drawHistory.length === 0}
              >
                <Undo2 size={12} /> 戻す
              </button>
              <button
                onClick={handleResetBoard}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--color-danger)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '6px',
                  fontWeight: 600
                }}
              >
                <Trash2 size={12} /> 全クリア
              </button>
            </div>

            <button
              onClick={handleExportImage}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '8px 0',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontWeight: 700,
                borderRadius: '6px',
                boxShadow: '0 4px 12px var(--accent-glow)'
              }}
            >
              <Download size={14} /> 作戦図を画像保存 (PNG)
            </button>

            {/* 作戦一時保存スロット */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', borderTop: '1px solid var(--glass-border)', paddingTop: '12px' }}>
              <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>作戦保存スロット (一時保存):</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[1, 2, 3].map(slotNum => {
                  const isSaved = hasSlotData(slotNum);
                  return (
                    <div key={slotNum} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#ccc', width: '48px', fontWeight: 600 }}>スロット {slotNum}:</span>
                      <button
                        onClick={() => handleLoadSlot(slotNum)}
                        className="btn"
                        style={{
                          flex: 2,
                          padding: '5px 0',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          background: isSaved ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                          borderColor: isSaved ? 'var(--color-info)' : 'var(--glass-border)',
                          color: isSaved ? '#fff' : '#555',
                          cursor: isSaved ? 'pointer' : 'default',
                          borderRadius: '4px',
                          transition: 'all 0.2s',
                          pointerEvents: isSaved ? 'auto' : 'none'
                        }}
                      >
                        {isSaved ? '作戦読込 📂' : '未保存'}
                      </button>
                      <button
                        onClick={() => handleSaveSlot(slotNum)}
                        className="btn btn-secondary"
                        style={{
                          flex: 1,
                          padding: '5px 0',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          borderColor: 'rgba(255, 107, 0, 0.3)',
                          color: 'var(--accent-color)',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          transition: 'all 0.2s'
                        }}
                      >
                        保存 💾
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 選手トグルパネル */}
        <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', maxHeight: '400px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Users size={16} style={{ color: 'var(--accent-color)' }} /> 選手をコートに出す
          </h3>

          {/* 自チーム */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 700 }}>自チーム名簿</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {homeRoster.map(player => {
                const isOnCourt = onCourtPlayers.some(p => p.id === player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => handleTogglePlayer(player)}
                    className="btn"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: isOnCourt ? 'var(--accent-color)' : 'rgba(255,255,255,0.02)',
                      borderColor: isOnCourt ? 'var(--accent-color)' : 'var(--glass-border)',
                      color: '#fff',
                      borderRadius: '16px',
                      cursor: 'pointer'
                    }}
                  >
                    #{player.number} {player.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 相手チーム */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', fontWeight: 700 }}>相手チーム名簿</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {awayRoster.map(player => {
                const isOnCourt = onCourtPlayers.some(p => p.id === player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => handleTogglePlayer(player)}
                    className="btn"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: isOnCourt ? 'var(--color-danger)' : 'rgba(255,255,255,0.02)',
                      borderColor: isOnCourt ? 'var(--color-danger)' : 'var(--glass-border)',
                      color: '#fff',
                      borderRadius: '16px',
                      cursor: 'pointer'
                    }}
                  >
                    #{player.number} {player.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
