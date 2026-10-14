import React, { useRef, useEffect } from 'react';

const GridVisualizer = ({ 
  positions = [], 
  springs = [], 
  cells = [], 
  fixedIndices = [], 
  numRadial = 8, 
  numCircum = 24 
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!positions || positions.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    // Fit the outermost ring to 80% of the canvas, leaving the corners free for the legend
    const maxRadius = Math.max(...positions.map(([x, y]) => Math.hypot(x, y)));
    const scale = (0.4 * Math.min(width, height)) / maxRadius;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw springs (light gray lines)
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (const spring of springs) {
      const p1 = positions[spring.m1];
      const p2 = positions[spring.m2];
      
      if (!p1 || !p2) continue;

      ctx.beginPath();
      ctx.moveTo(centerX + p1[0] * scale, centerY + p1[1] * scale);
      ctx.lineTo(centerX + p2[0] * scale, centerY + p2[1] * scale);
      ctx.stroke();
    }

    // Create sets for quick lookup
    const cellIndices = new Set(cells.map(c => c.mass_idx));
    const fixedSet = new Set(fixedIndices);

    // Draw masses
    positions.forEach((pos, idx) => {
      const x = centerX + pos[0] * scale;
      const y = centerY + pos[1] * scale;

      // Determine color and size based on type
      let color = '#3b82f6'; // Default blue
      let radius = 3;

      if (fixedSet.has(idx)) {
        color = '#6b7280'; // Gray for fixed boundary
        radius = 3;
      } else if (cellIndices.has(idx)) {
        color = '#ef4444'; // Red for ASM cells
        radius = 4;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Draw inner lumen boundary (yellow outline)
    if (numCircum > 0) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      for (let c = 0; c <= numCircum; c++) {
        const idx = c % numCircum; // Innermost ring (r=0)
        const pos = positions[idx];
        
        if (!pos) continue;

        const x = centerX + pos[0] * scale;
        const y = centerY + pos[1] * scale;

        if (c === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw legend
    const legendX = 20;
    const legendY = 20;
    const legendSpacing = 25;

    ctx.font = '14px sans-serif';

    // ASM Cells
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(legendX + 5, legendY, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText('ASM Cells', legendX + 15, legendY + 5);

    // Fixed boundary
    ctx.fillStyle = '#6b7280';
    ctx.beginPath();
    ctx.arc(legendX + 5, legendY + legendSpacing, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillText('Fixed Boundary', legendX + 15, legendY + legendSpacing + 5);

    // Inner lumen
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY + legendSpacing * 2);
    ctx.lineTo(legendX + 10, legendY + legendSpacing * 2);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.fillText('Airway Lumen', legendX + 15, legendY + legendSpacing * 2 + 5);

  }, [positions, springs, cells, fixedIndices, numRadial, numCircum]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={600}
        style={{ 
          border: '1px solid #ccc', 
          borderRadius: '8px',
          background: 'white',
          maxWidth: '100%',
          height: 'auto'
        }}
      />
    </div>
  );
};

export default GridVisualizer;