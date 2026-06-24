import React, { useEffect, useState } from 'react';

export interface DrawShape {
  id: string;
  type: 'stroke' | 'line' | 'arrow' | 'erase-stroke';
  color: string;
  width: number;
  points?: { x: number; y: number }[]; // For strokes (relative coordinates 0-1)
  startX?: number; // For lines/arrows (relative coordinates 0-1)
  startY?: number;
  endX?: number;
  endY?: number;
}

interface CoachingCanvasProps {
  width: number;
  height: number;
  activeTool: 'pen' | 'line' | 'arrow' | 'eraser';
  brushColor: string;
  brushWidth: number;
  onDrawingStart: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  history: DrawShape[];
  setHistory: React.Dispatch<React.SetStateAction<DrawShape[]>>;
}

export const CoachingCanvas: React.FC<CoachingCanvasProps> = ({
  width,
  height,
  activeTool,
  brushColor,
  brushWidth,
  onDrawingStart,
  canvasRef,
  history,
  setHistory
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewShape, setPreviewShape] = useState<DrawShape | null>(null);

  // Redraw the canvas whenever history, size, or preview shape changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw all shapes in history
    history.forEach((shape) => {
      drawShapeOnCtx(ctx, shape, width, height);
    });

    // Draw preview shape if active
    if (previewShape) {
      drawShapeOnCtx(ctx, previewShape, width, height);
    }
  }, [history, width, height, previewShape, canvasRef]);

  // Main drawing helper
  const drawShapeOnCtx = (
    ctx: CanvasRenderingContext2D,
    shape: DrawShape,
    w: number,
    h: number
  ) => {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.type === 'erase-stroke') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)'; // Destination-out ignores color, but needs alpha
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    if ((shape.type === 'stroke' || shape.type === 'erase-stroke') && shape.points && shape.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x * w, shape.points[0].y * h);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x * w, shape.points[i].y * h);
      }
      ctx.stroke();
    } else if (shape.type === 'line' && shape.startX !== undefined && shape.startY !== undefined && shape.endX !== undefined && shape.endY !== undefined) {
      ctx.beginPath();
      ctx.moveTo(shape.startX * w, shape.startY * h);
      ctx.lineTo(shape.endX * w, shape.endY * h);
      ctx.stroke();
    } else if (shape.type === 'arrow' && shape.startX !== undefined && shape.startY !== undefined && shape.endX !== undefined && shape.endY !== undefined) {
      const sx = shape.startX * w;
      const sy = shape.startY * h;
      const ex = shape.endX * w;
      const ey = shape.endY * h;

      // Draw line
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // Draw arrowhead
      const dx = ex - sx;
      const dy = ey - sy;
      const angle = Math.atan2(dy, dx);
      
      // Arrowhead size scales slightly with line thickness
      const arrowSize = Math.max(12, shape.width * 2.5);

      ctx.globalCompositeOperation = 'source-over'; // Arrowheads should be drawn normally
      ctx.fillStyle = shape.color;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - arrowSize * Math.cos(angle - Math.PI / 6),
        ey - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        ex - arrowSize * Math.cos(angle + Math.PI / 6),
        ey - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }
  };

  // Coordinates helper
  const getRelativeCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    onDrawingStart(); // Pause video immediately on first contact
    setIsDrawing(true);
    canvasRef.current?.setPointerCapture(e.pointerId);

    const pt = getRelativeCoords(e);

    if (activeTool === 'pen' || activeTool === 'eraser') {
      setCurrentPoints([pt]);
    } else {
      setStartPoint(pt);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const pt = getRelativeCoords(e);

    if (activeTool === 'pen' || activeTool === 'eraser') {
      const nextPoints = [...currentPoints, pt];
      setCurrentPoints(nextPoints);

      // Show instant preview of the stroke
      setPreviewShape({
        id: 'preview',
        type: activeTool === 'eraser' ? 'erase-stroke' : 'stroke',
        color: activeTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor,
        width: brushWidth,
        points: nextPoints
      });
    } else if (startPoint) {
      // Show preview of line or arrow
      setPreviewShape({
        id: 'preview',
        type: activeTool,
        color: brushColor,
        width: brushWidth,
        startX: startPoint.x,
        startY: startPoint.y,
        endX: pt.x,
        endY: pt.y
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    canvasRef.current?.releasePointerCapture(e.pointerId);

    const pt = getRelativeCoords(e);
    let finalShape: DrawShape | null = null;

    if (activeTool === 'pen' || activeTool === 'eraser') {
      if (currentPoints.length > 1) {
        finalShape = {
          id: 'shape_' + Date.now() + Math.random().toString(36).substr(2, 5),
          type: activeTool === 'eraser' ? 'erase-stroke' : 'stroke',
          color: activeTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor,
          width: brushWidth,
          points: [...currentPoints, pt]
        };
      }
    } else if (startPoint) {
      // Verify line has some length to avoid zero-length click drawings
      const dx = pt.x - startPoint.x;
      const dy = pt.y - startPoint.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length > 0.01) {
        finalShape = {
          id: 'shape_' + Date.now() + Math.random().toString(36).substr(2, 5),
          type: activeTool,
          color: brushColor,
          width: brushWidth,
          startX: startPoint.x,
          startY: startPoint.y,
          endX: pt.x,
          endY: pt.y
        };
      }
    }

    if (finalShape) {
      setHistory((prev) => [...prev, finalShape!]);
    }

    // Reset temporary states
    setPreviewShape(null);
    setCurrentPoints([]);
    setStartPoint(null);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 50,
        touchAction: 'none', // Prevents scrolling/scrunches on mobile/stylus
        cursor: activeTool === 'eraser' ? 'cell' : 'crosshair'
      }}
    />
  );
};
