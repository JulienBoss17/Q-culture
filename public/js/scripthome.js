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

  // --- Code pour déplacer icônes au clic dessus ---

const icons = document.querySelectorAll('.decor-icon');
const maxShiftVw = 3; // max déplacement en vw
let isMouseDown = false;
let mouseX = 0;
let mouseY = 0;

// Stocke positions en % vw/vh
const positions = [];

function vwToPx(vw) {
  return (window.innerWidth * vw) / 100;
}

function vhToPx(vh) {
  return (window.innerHeight * vh) / 100;
}

function pxToVw(px) {
  return (px / window.innerWidth) * 100;
}

function pxToVh(px) {
  return (px / window.innerHeight) * 100;
}

icons.forEach((icon, i) => {
  const style = window.getComputedStyle(icon);
  // Récupère en % si défini, sinon calcul
  const leftRaw = style.left.includes('vw') ? parseFloat(style.left) :
    pxToVw(parseInt(style.left));
  const topRaw = style.top.includes('vh') ? parseFloat(style.top) :
    pxToVh(parseInt(style.top));

  positions[i] = {
    leftVw: leftRaw,
    topVh: topRaw,
    currentLeftVw: leftRaw,
    currentTopVh: topRaw,
  };
  icon.style.position = 'absolute';
  icon.style.transition = 'left 0.2s ease, top 0.2s ease';
  icon.style.left = leftRaw + 'vw';
  icon.style.top = topRaw + 'vh';
});

function repel() {
  if (!isMouseDown) return;

  icons.forEach((icon, i) => {
    const pos = positions[i];
    const iconRect = icon.getBoundingClientRect();
    const iconCenterX = iconRect.left + iconRect.width / 2;
    const iconCenterY = iconRect.top + iconRect.height / 2;

    let dx = iconCenterX - mouseX;
    let dy = iconCenterY - mouseY;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;

    dx /= dist;
    dy /= dist;

    // Distance max en px correspondant à maxShiftVw en vw
    const maxShiftPxX = vwToPx(maxShiftVw);
    const maxShiftPxY = vhToPx(maxShiftVw * (window.innerHeight / window.innerWidth));

    // Nouvelle position en px = position de base en px + direction * max distance
    // Position de base en px calculée à partir de pos.leftVw / pos.topVh
    const baseX = vwToPx(pos.leftVw);
    const baseY = vhToPx(pos.topVh);

    // Nouvelle position : on pousse l'icône à la limite max en px, dans la direction opposée à la souris
    let newX = baseX + dx * maxShiftPxX;
    let newY = baseY + dy * maxShiftPxY;

    // On convertit en vw/vh pour appliquer le style
    pos.currentLeftVw = pxToVw(newX);
    pos.currentTopVh = pxToVh(newY);

    icon.style.left = pos.currentLeftVw + 'vw';
    icon.style.top = pos.currentTopVh + 'vh';
  });

  requestAnimationFrame(repel);
}


window.addEventListener('mousedown', (e) => {
  const interactiveTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'];
  if (interactiveTags.includes(e.target.tagName)) return;

  isMouseDown = true;
  mouseX = e.clientX;
  mouseY = e.clientY;
  document.body.classList.add('noselect');
  repel();
});


window.addEventListener('mousemove', (e) => {
  if (isMouseDown) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
  document.body.classList.remove('noselect');
});

// Empêche drag sur icônes
icons.forEach(icon => {
  icon.setAttribute('draggable', 'false');
  icon.addEventListener('dragstart', e => e.preventDefault());
});

// Recalcule positions lors du resize pour garder cohérence
window.addEventListener('resize', () => {
  icons.forEach((icon, i) => {
    const pos = positions[i];
    icon.style.left = pos.currentLeftVw + 'vw';
    icon.style.top = pos.currentTopVh + 'vh';
  });
});

let resizeTimeout;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    location.reload();
  }, 300);
});

window.addEventListener('load', () => {
  canvas.classList.add('active');
  document.body.classList.add('ready');
  animate();
});