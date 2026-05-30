// Shared constellation background. Requires a <canvas id="bg"> in the DOM.
(function () {
  const canvas = document.getElementById('bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const NUM = 110;
  const LINK_DIST = 140;
  const MOUSE_DIST = 200;

  let w, h, particles;
  let mouseX = -9999, mouseY = -9999;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function createParticles() {
    particles = [];
    for (let i = 0; i < NUM; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.6,
        hue: Math.random() < 0.18 ? 'gold' : 'blue',
      });
    }
  }

  function draw() {
    ctx.fillStyle = 'rgba(11, 15, 36, 0.35)';
    ctx.fillRect(0, 0, w, h);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;

      const dx = p.x - mouseX;
      const dy = p.y - mouseY;
      const d = Math.hypot(dx, dy);
      if (d < MOUSE_DIST && d > 0.1) {
        const f = (MOUSE_DIST - d) / MOUSE_DIST;
        p.x += (dx / d) * f * 1.4;
        p.y += (dy / d) * f * 1.4;
      }
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < LINK_DIST) {
          const alpha = (1 - d / LINK_DIST) * 0.35;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(120, 165, 255, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const p of particles) {
      ctx.beginPath();
      if (p.hue === 'gold') {
        ctx.fillStyle = '#f5d77a';
        ctx.shadowColor = 'rgba(245, 215, 122, 0.8)';
        ctx.shadowBlur = 8;
      } else {
        ctx.fillStyle = '#a0c4ff';
        ctx.shadowColor = 'rgba(160, 196, 255, 0.6)';
        ctx.shadowBlur = 6;
      }
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (mouseX > -9000) {
      const grad = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, MOUSE_DIST);
      grad.addColorStop(0, 'rgba(199, 160, 255, 0.18)');
      grad.addColorStop(0.5, 'rgba(78, 127, 255, 0.08)');
      grad.addColorStop(1, 'rgba(78, 127, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); createParticles(); });
  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });
  window.addEventListener('touchmove', (e) => {
    if (e.touches[0]) { mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY; }
  }, { passive: true });

  resize();
  createParticles();
  draw();
})();
