import React, { useRef, useEffect } from 'react';

const StiffnessCurveChart = ({ data = [] }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || data.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Padding and chart dimensions
    const padding = { top: 40, right: 40, bottom: 60, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Find min/max values
    const xValues = data.map(d => d.x);
    const yValues = data.map(d => d.y);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = 0; // Start from 0 for constriction
    const yMax = Math.max(...yValues) * 1.1; // Add 10% padding

    // Scale functions
    const scaleX = (x) => padding.left + ((x - xMin) / (xMax - xMin)) * chartWidth;
    const scaleY = (y) => padding.top + chartHeight - ((y - yMin) / (yMax - yMin)) * chartHeight;

    // Draw axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();

    // Draw grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    // Vertical grid lines (x-axis)
    const numXTicks = 5;
    for (let i = 0; i <= numXTicks; i++) {
      const x = padding.left + (chartWidth / numXTicks) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }

    // Horizontal grid lines (y-axis)
    const numYTicks = 5;
    for (let i = 0; i <= numYTicks; i++) {
      const y = padding.top + (chartHeight / numYTicks) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
    }

    // Draw data points and line
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((point, idx) => {
      const x = scaleX(point.x);
      const y = scaleY(point.y);

      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw data points as circles
    ctx.fillStyle = '#3b82f6';
    data.forEach((point) => {
      const x = scaleX(point.x);
      const y = scaleY(point.y);

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Draw axis labels
    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';

    // X-axis labels
    for (let i = 0; i <= numXTicks; i++) {
      const value = xMin + ((xMax - xMin) / numXTicks) * i;
      const x = padding.left + (chartWidth / numXTicks) * i;
      const y = padding.top + chartHeight + 25;
      ctx.fillText(value.toFixed(0), x, y);
    }

    // Y-axis labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= numYTicks; i++) {
      const value = yMin + ((yMax - yMin) / numYTicks) * i;
      const x = padding.left - 10;
      const y = padding.top + chartHeight - (chartHeight / numYTicks) * i;
      ctx.fillText(value.toFixed(1), x, y);
    }

    // Draw axis titles
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // X-axis title
    ctx.fillText('Stiffness (k)', width / 2, height - 10);

    // Y-axis title (rotated)
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Lumen Constriction (%)', 0, 0);
    ctx.restore();

    // Chart title
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Tissue Stiffness vs Airway Constriction', width / 2, 10);

  }, [data]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '20px' }}>
      <canvas 
        ref={canvasRef} 
        width={700} 
        height={500}
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

export default StiffnessCurveChart;