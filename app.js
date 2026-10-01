(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');

  const setHeader = () => header?.classList.toggle('is-scrolled', scrollY > 16);
  setHeader();
  addEventListener('scroll', setHeader, { passive: true });

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
      toggle.querySelector('span').textContent = open ? 'Close' : 'Menu';
    });
      nav.addEventListener('click', e => {
      if (e.target.closest('a')) {
        toggle.setAttribute('aria-expanded','false');
      nav.classList.remove('open');
      toggle.querySelector('span').textContent='Menu';
      }
    });
    addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        toggle.setAttribute('aria-expanded','false');
      nav.classList.remove('open');
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
    }, { threshold: .12, rootMargin: '0px 0px -6%' });
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
    el.textContent = '0' + suffix;
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
      if (e.isIntersecting) { count(e.target);
      cio.unobserve(e.target); }
    }), {threshold:.45});
    counters.forEach(c => cio.observe(c));
  } else counters.forEach(count);

  // Seamless transform-based client marquee with drag, touch and keyboard control.
  document.querySelectorAll('[data-marquee]').forEach(async viewport => {
    const track = viewport.querySelector('.marquee-track');
    const group = viewport.querySelector('.marquee-group');
    if (!track || !group) return;

    // Load enabled clients from Supabase. Keep the existing HTML as a fallback.
    try {
      const response = await fetch(
        'https://hjbzkhcoltoxzvabprdj.supabase.co/rest/v1/clients?select=name,logo_path&enabled=eq.true&order=display_order.asc,name.asc',
        { headers: { apikey: 'sb_publishable_4mtyuQoyJf9zlOoWyKrtpw_aWUlDEc2' } }
      );
      if (response.ok) {
        const clients = await response.json();
        if (Array.isArray(clients) && clients.length) {
          group.innerHTML = clients.map(client => {
            const name = String(client.name || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
            const src = String(client.logo_path || '').replace(/"/g, '&quot;');
            return `<li class="client-logo"><img alt="${name}" decoding="async" loading="lazy" src="${src}"/></li>`;
          }).join('');
        }
      }
    } catch (_) {}

    const clone = group.cloneNode(true);
      clone.setAttribute('aria-hidden','true');
      clone.querySelectorAll('img').forEach(img => img.alt='');
      track.append(clone);

    let x=0, last=0, width=0, raf=0, interacting=false, pointer=null, originX=0, originY=0, originOffset=0, dragging=false;
    const speed=31;
    const dragThreshold=7;
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
    const hold = (ms=1700) => {
      interacting=true;
      stop();
      setTimeout(()=>{ interacting=false; start(); }, ms);
    };
    const measure = () => { width=group.getBoundingClientRect().width; normalize(); render(); start(); };

    viewport.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.pointerType==='mouse' && e.button!==0) return;
      pointer=e.pointerId;
      originX=e.clientX;
      originY=e.clientY;
      originOffset=x;
      dragging=false;
      /* Do NOT pause on pointerdown. A normal click must never stop the marquee. */
    });

    viewport.addEventListener('pointermove', e => {
      if (pointer !== e.pointerId) return;

      const dx=e.clientX-originX;
      const dy=e.clientY-originY;

      if (!dragging && Math.hypot(dx,dy) >= dragThreshold) {
        dragging=true;
        interacting=true;
        stop();
        viewport.setPointerCapture?.(pointer);
      }

      if (!dragging) return;

      x = originOffset + dx;
      normalize();
      render();
    });

    const release = e => {
      if (pointer === null || (e && e.pointerId !== pointer)) return;

      if (dragging) {
        try { viewport.releasePointerCapture?.(pointer); } catch {}
      }

      pointer=null;
      dragging=false;
      interacting=false;
      last=0;
      start(); // resume immediately — no timeout
    };

    viewport.addEventListener('pointerup',release);
    viewport.addEventListener('pointercancel',release);
    viewport.addEventListener('lostpointercapture',release);
      viewport.addEventListener('wheel', e => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!delta) return;
      e.preventDefault(); hold(); x -= delta; normalize(); render();
    }, {passive:false});
      viewport.addEventListener('keydown', e => {
      if (e.key!=='ArrowLeft' && e.key!=='ArrowRight') return;
      e.preventDefault(); hold(); x += e.key==='ArrowLeft' ? 150 : -150; normalize(); render();
    });
    new ResizeObserver(measure).observe(group);
    document.addEventListener('visibilitychange',()=>{stop();start();});
    reduce.addEventListener?.('change',()=>{stop();render();start();});
    measure();
  });

  // Submit public forms to Supabase Edge Functions.
  document.querySelectorAll('[data-site-form]').forEach(form => {
    const file = form.querySelector('input[type="file"]');
    const label = form.querySelector('[data-file-label]');
    if (file && label) {
      file.addEventListener('change', () => {
        label.textContent = file.files?.[0]?.name || 'Choose PDF, DOC or DOCX';
      });
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity() || form.dataset.sent === 'true') return;

      const button = form.querySelector('button[type="submit"]');
      const buttonText = button?.querySelector('span');
      const originalText = buttonText?.textContent || 'Submit';
      let status = form.querySelector('.form-status');
      if (!status) {
        status = document.createElement('p');
        status.className = 'form-status';
        status.setAttribute('role', 'status');
        form.querySelector('.form-submit-row')?.append(status);
      }

      form.dataset.sent = 'true';
      form.classList.add('is-submitting');
      if (button) button.disabled = true;
      if (buttonText) buttonText.textContent = 'Sending…';
      status.textContent = '';
      status.classList.remove('is-error');

      try {
        const isApplication = Boolean(file);
        const endpoint = isApplication
          ? 'https://hjbzkhcoltoxzvabprdj.supabase.co/functions/v1/submit-application'
          : 'https://hjbzkhcoltoxzvabprdj.supabase.co/functions/v1/submit-enquiry';

        let body;
        let headers = {};
        if (isApplication) {
          body = new FormData(form);
          body.delete('_captcha');
          body.delete('_subject');
          body.delete('_template');
          body.delete('_next');
          if (body.has('_honey')) {
            body.set('website', body.get('_honey') || '');
            body.delete('_honey');
          }
        } else {
          const data = new FormData(form);
          body = JSON.stringify({
            company: data.get('company') || '',
            name: data.get('name') || '',
            phone: data.get('phone') || '',
            email: data.get('email') || '',
            project_location: data.get('project_location') || '',
            trade: data.get('trade') || '',
            workers: data.get('workers') || '',
            message: data.get('message') || '',
            website: data.get('_honey') || ''
          });
          headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(endpoint, { method: 'POST', headers, body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Submission failed.');

        location.assign('/thanks/');
      } catch (error) {
        form.dataset.sent = 'false';
        form.classList.remove('is-submitting');
        if (button) button.disabled = false;
        if (buttonText) buttonText.textContent = originalText;
        status.textContent = error?.message || 'We could not send this right now. Please try again.';
        status.classList.add('is-error');
      }
    });
  });

  // Pre-fill trade on contact page from ?trade=N.
  const tradeIndex = Number(new URLSearchParams(location.search).get('trade'));
  const trades = ['Piling & ground works','Foundation works','Masonry works','Structural steel & roofing','Scaffolding','Finishing works','MEP works','Waterproofing & insulation','Road works','Aluminium, glass & metal'];
  if (tradeIndex>=1 && tradeIndex<=trades.length) {
    document.querySelectorAll('input[name="trade"]').forEach(field => field.value=trades[tradeIndex-1]);
  }

  // Optional analytics hooks. If Google Analytics is installed later, these events work automatically.
  const track = (name, params={}) => { if (typeof window.gtag === 'function') window.gtag('event', name, params); };
  document.addEventListener('click', e => { const a=e.target.closest('a'); if(!a)return; const href=a.getAttribute('href')||''; if(href.startsWith('tel:')) track('phone_click',{link_url:href}); else if(href.startsWith('mailto:')) track('email_click',{link_url:href}); else if(href.includes('/contact/')) track('contact_cta_click',{link_url:href}); });
  document.querySelectorAll('[data-site-form]').forEach(form => form.addEventListener('submit',()=>{ const subject=form.querySelector('input[name="_subject"]')?.value||'website_form'; track('form_submit',{form_name:subject}); },{capture:true}));

})();


// Keep public URLs clean when a page is opened as /index.html.
(() => {
  if (window.location.pathname.endsWith("/index.html")) {
    const cleanPath = window.location.pathname.slice(0, -"index.html".length);
    window.history.replaceState(null, "", cleanPath + window.location.search + window.location.hash);
  }
})();

// Keep public URLs clean when a page is opened with a physical HTML filename.
if (window.location.pathname.endsWith("/index.html")) {
  const cleanPath = window.location.pathname.slice(0, -"index.html".length);
  window.history.replaceState(null, "", cleanPath + window.location.search + window.location.hash);
} else if (window.location.pathname === "/404.html") {
  window.history.replaceState(null, "", "/404/" + window.location.search + window.location.hash);
}


// Project gallery lightbox
(() => {
  const gallery = document.querySelector('.project-gallery');
  const lightbox = document.getElementById('projectLightbox');
  if (!gallery || !lightbox) return;
  const shots = [...gallery.querySelectorAll('.project-shot')];
  const viewer = lightbox.querySelector('img');
  const closeBtn = lightbox.querySelector('.project-lightbox-close');
  const prevBtn = lightbox.querySelector('.project-lightbox-prev');
  const nextBtn = lightbox.querySelector('.project-lightbox-next');
  let current = 0;
  let touchX = null;

  const show = (index) => {
    current = (index + shots.length) % shots.length;
    const img = shots[current].querySelector('img');
    viewer.src = img.currentSrc || img.src;
    viewer.alt = img.alt || 'Project image';
  };
  const open = (index) => {
    show(index);
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    closeBtn.focus();
  };
  const close = () => {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    shots[current]?.focus();
  };

  shots.forEach((shot, i) => {
    shot.addEventListener('click', () => open(i));
    shot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); }
    });
  });
  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', () => show(current - 1));
  nextBtn.addEventListener('click', () => show(current + 1));
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) close(); });
  lightbox.addEventListener('touchstart', e => { touchX = e.changedTouches[0].clientX; }, {passive:true});
  lightbox.addEventListener('touchend', e => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 45) show(current + (dx < 0 ? 1 : -1));
    touchX = null;
  }, {passive:true});
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('is-open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
  });
})();


// Back to top button
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector(".back-to-top");
  if (!btn) return;

  const updateBackToTop = () => {
    btn.classList.toggle("is-visible", window.scrollY > 500);
  };

  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});


