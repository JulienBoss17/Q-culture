 const canvas = document.getElementById('backgroundCanvas');
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const linesCount = 30;
    const lines = [];

    for (let i = 0; i < linesCount; i++) {
      lines.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        length: Math.random() * 200 + 100,
        speed: (Math.random() - 0.5) * 1,
        angle: Math.random() * Math.PI * 2,
        width: 2,
      });
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.lineCap = 'round';

      lines.forEach(line => {
        line.angle += line.speed * 0.01;
        const x2 = line.x + Math.cos(line.angle) * line.length;
        const y2 = line.y + Math.sin(line.angle) * line.length;

        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = line.width;

        ctx.beginPath();
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      requestAnimationFrame(animate);
    }

    animate();