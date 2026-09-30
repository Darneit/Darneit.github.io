(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');

  const setHeader = () => header?.classList.toggle('is-scrolled', scrollY > 16);
  setHeader();
  addEventListener('scroll', setHeader, {passive:true});

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
      toggle.querySelector('span').textContent = open ? 'Close' : 'Menu';
    });
    nav.addEventListener('click', e => {
      if (e.target.closest('a')) {
        toggle.setAttribute('aria-expanded','false'); nav.classList.remove('open');
        toggle.querySelector('span').textContent='Menu';
      }
    });
    addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        toggle.setAttribute('aria-expanded','false'); nav.classList.remove('open');
        toggle.querySelector('span').textContent='Menu';
      }
    });
  }

  // Lightweight reveal motion. Text/layout only; large image grids stay static.
  if (!reduce.matches && 'IntersectionObserver' in window) {
    const revealTargets = document.querySelectorAll('.section-intro,.story-copy,.service-feature-copy,.commitment-grid>div,.contact-overview>div,.application-layout>div,.editorial-story>div,.enquiry-layout>div');
    revealTargets.forEach(el => el.classList.add('reveal'));
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, {threshold:.12, rootMargin:'0px 0px -6%'});
    revealTargets.forEach(el => io.observe(el));
  }

  // Simple one-shot count-up. No rolling digit DOM or layout-changing animation.
  const counters = document.querySelectorAll('[data-count]');
  const count = el => {
    if (el.dataset.counted) return;
    el.dataset.counted='true';
    const target = Number(el.dataset.count || 0);
    const suffix = el.dataset.suffix || '';
    const duration = target > 1500 ? 1050 : 950;
    if (reduce.matches) { el.textContent = target.toLocaleString('en-US') + suffix; return; }
    const start = performance.now();
    const frame = now => {
      const p = Math.min(1,(now-start)/duration);
      const eased = 1 - Math.pow(1-p,3);
      const value = Math.round(target*eased);
      el.textContent = value.toLocaleString('en-US') + suffix;
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if ('IntersectionObserver' in window) {
    const cio = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { count(e.target); cio.unobserve(e.target); }
    }), {threshold:.45});
    counters.forEach(c => cio.observe(c));
  } else counters.forEach(count);

  // Seamless transform-based client marquee with drag, touch and keyboard control.
  document.querySelectorAll('[data-marquee]').forEach(viewport => {
    const track = viewport.querySelector('.marquee-track');
    const group = viewport.querySelector('.marquee-group');
    if (!track || !group) return;
    const clone = group.cloneNode(true);
    clone.setAttribute('aria-hidden','true');
    clone.querySelectorAll('img').forEach(img => img.alt='');
    track.append(clone);

    let x=0, last=0, width=0, raf=0, interacting=false, pointer=null, originX=0, originOffset=0, resumeTimer=0;
    const speed=31;
    const normalize = () => {
      if (!width) return;
      while (x <= -width) x += width;
      while (x > 0) x -= width;
    };
    const render = () => track.style.transform = `translate3d(${x}px,0,0)`;
    const canRun = () => !reduce.matches && !document.hidden && !interacting && width>0;
    const tick = now => {
      raf=0;
      if (!canRun()) { last=0; return; }
      if (last) x -= Math.min(now-last,40)/1000*speed;
      last=now; normalize(); render(); raf=requestAnimationFrame(tick);
    };
    const start = () => { if (!raf && canRun()) raf=requestAnimationFrame(tick); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf=0; last=0; };
    const hold = (ms=1700) => { interacting=true; stop(); clearTimeout(resumeTimer); resumeTimer=setTimeout(()=>{interacting=false; start();},ms); };
    const measure = () => { width=group.getBoundingClientRect().width; normalize(); render(); start(); };

    viewport.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.pointerType==='mouse' && e.button!==0) return;
      hold(999999); pointer=e.pointerId; originX=e.clientX; originOffset=x; viewport.setPointerCapture?.(pointer);
    });
    viewport.addEventListener('pointermove', e => {
      if (pointer !== e.pointerId) return;
      x = originOffset + (e.clientX-originX); normalize(); render();
    });
    const release = e => {
      if (pointer !== null && (!e || e.pointerId===pointer)) { pointer=null; hold(1700); }
    };
    viewport.addEventListener('pointerup',release); viewport.addEventListener('pointercancel',release); viewport.addEventListener('lostpointercapture',release);
    viewport.addEventListener('wheel', e => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!delta) return;
      e.preventDefault(); hold(); x -= delta; normalize(); render();
    }, {passive:false});
    viewport.addEventListener('keydown', e => {
      if (e.key!=='ArrowLeft' && e.key!=='ArrowRight') return;
      e.preventDefault(); hold(); x += e.key==='ArrowLeft' ? 150 : -150; normalize(); render();
    });
    viewport.addEventListener('mouseenter',()=>{interacting=true;stop();});
    viewport.addEventListener('mouseleave',()=>{if(pointer===null){interacting=false;start();}});
    new ResizeObserver(measure).observe(group);
    document.addEventListener('visibilitychange',()=>{stop();start();});
    reduce.addEventListener?.('change',()=>{stop();render();start();});
    measure();
  });

  // Forms post directly to the form backend. The success redirect always follows the deployed origin.
  document.querySelectorAll('[data-site-form]').forEach(form => {
    const next = form.querySelector('[data-next-url]');
    if (next) next.value = new URL('/thanks/', location.origin).href;
    const file = form.querySelector('input[type="file"]');
    const label = form.querySelector('[data-file-label]');
    if (file && label) file.addEventListener('change',()=>{ label.textContent = file.files?.[0]?.name || 'Choose PDF, DOC or DOCX'; });
    form.addEventListener('submit', e => {
      if (!form.reportValidity()) { e.preventDefault(); return; }
      if (form.dataset.sent === 'true') { e.preventDefault(); return; }
      form.dataset.sent='true'; form.classList.add('is-submitting');
      const button=form.querySelector('button[type="submit"]');
      if (button) { button.disabled=true; button.querySelector('span').textContent='Sending…'; }
    });
  });

  // Pre-fill trade on contact page from ?trade=N.
  const tradeIndex = Number(new URLSearchParams(location.search).get('trade'));
  const trades = ['Piling & ground works','Foundation works','Masonry works','Structural steel & roofing','Scaffolding','Finishing works','MEP works','Waterproofing & insulation','Road works','Aluminium, glass & metal'];
  if (tradeIndex>=1 && tradeIndex<=trades.length) {
    document.querySelectorAll('input[name="trade"]').forEach(field => field.value=trades[tradeIndex-1]);
  }
})();
