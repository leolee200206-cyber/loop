/**
 * AgentChatBus GSAP Motion Engine
 * Crafted for technical luxury, fluid feedback, and composited GPU performance.
 * Adheres to prefers-reduced-motion with instant graceful degradation.
 * Scoped lifecycle: tracks only AcbAnimations instances, never pauses globalTimeline.
 */
(function (global) {
  'use strict';

  const animatedElements = new WeakSet();
  const activeAnimations = new Set();
  const visibilityPausedAnimations = new Set();
  let activeViewTransitionTl = null;

  function isReducedMotion() {
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function getGsap() {
    return typeof global.gsap !== 'undefined' ? global.gsap : null;
  }

  function isAnimAlive(anim) {
    if (!anim) return false;
    if (anim._killed) return false;
    if (typeof anim.totalProgress === 'function' && anim.totalProgress() >= 1 && !anim.repeat?.()) {
      return false;
    }
    return true;
  }

  function untrackAnimation(anim) {
    if (!anim) return;
    activeAnimations.delete(anim);
    visibilityPausedAnimations.delete(anim);
  }

  function trackAnimation(anim) {
    if (!anim) return anim;
    activeAnimations.add(anim);

    if (typeof anim.eventCallback === 'function') {
      const prevComplete = anim.eventCallback('onComplete');
      anim.eventCallback('onComplete', function (...args) {
        untrackAnimation(anim);
        if (typeof prevComplete === 'function') {
          prevComplete.apply(this, args);
        }
      });

      const prevInterrupt = anim.eventCallback('onInterrupt');
      anim.eventCallback('onInterrupt', function (...args) {
        untrackAnimation(anim);
        if (typeof prevInterrupt === 'function') {
          prevInterrupt.apply(this, args);
        }
      });
    }
    return anim;
  }

  function handleVisibilityChange() {
    if (typeof document === 'undefined') return;

    if (document.hidden) {
      // Pause only actively running animations belonging to AcbAnimations
      for (const anim of activeAnimations) {
        if (!isAnimAlive(anim)) {
          untrackAnimation(anim);
          continue;
        }
        if (typeof anim.paused === 'function') {
          // If already explicitly paused by caller, do NOT pause or mark for resume
          if (anim.paused()) {
            continue;
          }
          anim.pause();
          visibilityPausedAnimations.add(anim);
        }
      }
    } else {
      // Resume ONLY the animations that were paused by visibility change
      for (const anim of visibilityPausedAnimations) {
        if (activeAnimations.has(anim) && isAnimAlive(anim)) {
          if (typeof anim.play === 'function') {
            anim.play();
          }
        }
      }
      visibilityPausedAnimations.clear();

      // Prune completed/killed animations
      for (const anim of activeAnimations) {
        if (!isAnimAlive(anim)) {
          untrackAnimation(anim);
        }
      }
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const AcbAnimations = {
    isAvailable() {
      return Boolean(getGsap()) && !isReducedMotion();
    },

    /**
     * Smooth view transition between Timeline, 3D Arena, and Split View (180ms).
     */
    animateViewTransition(containerEl, onMidpoint, onComplete) {
      if (activeViewTransitionTl) {
        untrackAnimation(activeViewTransitionTl);
        activeViewTransitionTl.kill();
        activeViewTransitionTl = null;
      }
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !containerEl) {
        if (typeof onMidpoint === 'function') onMidpoint();
        if (typeof onComplete === 'function') onComplete();
        return;
      }

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        onComplete: () => {
          untrackAnimation(tl);
          if (activeViewTransitionTl === tl) activeViewTransitionTl = null;
          if (typeof onComplete === 'function') onComplete();
        }
      });
      activeViewTransitionTl = tl;
      trackAnimation(tl);

      tl.to(containerEl, {
        opacity: 0.65,
        duration: 0.08,
        onComplete: onMidpoint,
      }).to(containerEl, {
        opacity: 1,
        duration: 0.1,
        ease: 'power2.out',
        clearProps: 'opacity',
      });
    },

    /**
     * Cancel any active view transition and clear opacity override.
     */
    cancelViewTransition(containerEl) {
      if (activeViewTransitionTl) {
        untrackAnimation(activeViewTransitionTl);
        activeViewTransitionTl.kill();
        activeViewTransitionTl = null;
      }
      if (containerEl) {
        containerEl.style.opacity = '';
      }
    },

    /**
     * Scoped animation context with auto-cleanup (GSAP Context).
     */
    createContext(func, scope) {
      const gsap = getGsap();
      if (gsap && typeof gsap.context === 'function') {
        const ctx = gsap.context((context) => {
          if (typeof func === 'function') func(context);
        }, scope);

        if (Array.isArray(ctx.data)) {
          for (const item of ctx.data) {
            trackAnimation(item);
          }
        }

        const origAdd = ctx.add ? ctx.add.bind(ctx) : null;
        if (origAdd) {
          ctx.add = (...args) => {
            const res = origAdd(...args);
            trackAnimation(res);
            return res;
          };
        }

        const origRevert = ctx.revert.bind(ctx);
        ctx.revert = (...args) => {
          if (Array.isArray(ctx.data)) {
            for (const item of ctx.data) {
              untrackAnimation(item);
            }
          }
          return origRevert(...args);
        };

        return ctx;
      }
      if (typeof func === 'function') func();
      return { revert: () => {} };
    },

    /**
     * Coordinated drawer entrance and exit with GSAP easing.
     */
    animateDrawer(drawerEl, isOpen, isMobile, onComplete) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !drawerEl) {
        if (typeof onComplete === 'function') onComplete();
        return;
      }

      let tween = null;
      if (isOpen) {
        if (isMobile) {
          tween = gsap.fromTo(
            drawerEl,
            { y: '100%' },
            { y: '0%', duration: 0.22, ease: 'power2.out', clearProps: 'transform', onComplete }
          );
        } else {
          tween = gsap.fromTo(
            drawerEl,
            { x: '100%' },
            { x: '0%', duration: 0.22, ease: 'power2.out', clearProps: 'transform', onComplete }
          );
        }
      } else {
        if (isMobile) {
          tween = gsap.to(drawerEl, {
            y: '100%',
            duration: 0.18,
            ease: 'power2.in',
            onComplete,
          });
        } else {
          tween = gsap.to(drawerEl, {
            x: '100%',
            duration: 0.18,
            ease: 'power2.in',
            onComplete,
          });
        }
      }
      trackAnimation(tween);
    },

    /**
     * Staggered entrance for topbar, sidebar, and primary panel on load.
     */
    animatePageEntrance() {
      const gsap = getGsap();
      if (!gsap || isReducedMotion()) return;

      const topbar = document.getElementById('topbar');
      const sidebar = document.getElementById('sidebar');
      const main = document.getElementById('main');

      const tl = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.4 } });
      trackAnimation(tl);
      if (topbar) {
        tl.fromTo(topbar, { y: -16, opacity: 0 }, { y: 0, opacity: 1 }, 0);
      }
      if (sidebar) {
        tl.fromTo(sidebar, { x: -20, opacity: 0 }, { x: 0, opacity: 1 }, 0.1);
      }
      if (main) {
        tl.fromTo(main, { opacity: 0, scale: 0.99 }, { opacity: 1, scale: 1, duration: 0.5 }, 0.15);
      }
    },

    /**
     * Staggered reveal for thread list items.
     */
    animateThreadList(containerEl) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !containerEl) return;

      const items = containerEl.querySelectorAll('.thread-item:not([data-animated])');
      if (!items.length) return;

      items.forEach((item) => item.setAttribute('data-animated', 'true'));
      const tween = gsap.fromTo(
        items,
        { opacity: 0, x: -8 },
        {
          opacity: 1,
          x: 0,
          duration: 0.25,
          stagger: 0.03,
          ease: 'power2.out',
          overwrite: 'auto',
          clearProps: 'transform,opacity',
        }
      );
      trackAnimation(tween);
    },

    /**
     * Smooth entrance for a newly arrived message bubble.
     * Guaranteed idempotent - will never re-animate already visible messages on polling!
     */
    animateMessage(messageEl) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !messageEl || animatedElements.has(messageEl)) return;

      animatedElements.add(messageEl);
      messageEl.setAttribute('data-animated', 'true');

      const isRight = messageEl.classList.contains('msg-row-right');
      const startX = isRight ? 12 : -12;

      const tween = gsap.fromTo(
        messageEl,
        { opacity: 0, y: 10, x: startX },
        {
          opacity: 1,
          y: 0,
          x: 0,
          duration: 0.3,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        }
      );
      trackAnimation(tween);
    },

    /**
     * Modal dialog open animation with scale and backdrop fade.
     */
    animateModalOpen(modalWindowEl, backdropEl) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion()) {
        if (backdropEl) backdropEl.style.opacity = '1';
        if (modalWindowEl) {
          modalWindowEl.style.opacity = '1';
          modalWindowEl.style.transform = 'none';
        }
        return;
      }

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      trackAnimation(tl);
      if (backdropEl) {
        tl.fromTo(backdropEl, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0);
      }
      if (modalWindowEl) {
        tl.fromTo(
          modalWindowEl,
          { opacity: 0, scale: 0.94, y: 16 },
          { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.4)' },
          0.05
        );
      }
    },

    /**
     * Modal dialog close animation.
     */
    animateModalClose(modalWindowEl, backdropEl, onComplete) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion()) {
        if (typeof onComplete === 'function') onComplete();
        return;
      }

      const tl = gsap.timeline({
        defaults: { ease: 'power2.in', duration: 0.2 },
        onComplete,
      });
      trackAnimation(tl);

      if (modalWindowEl) {
        tl.to(modalWindowEl, { opacity: 0, scale: 0.95, y: 10 }, 0);
      }
      if (backdropEl) {
        tl.to(backdropEl, { opacity: 0 }, 0.05);
      }
    },

    /**
     * Button micro-interaction on click (subtle press down & release).
     */
    animateButtonPress(buttonEl) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !buttonEl) return;

      const tween = gsap.fromTo(
        buttonEl,
        { scale: 0.95 },
        { scale: 1, duration: 0.25, ease: 'back.out(2)', clearProps: 'transform' }
      );
      trackAnimation(tween);
    },

    /**
     * Spin animation for refresh / reload buttons.
     */
    animateSpin(iconOrBtnEl, onComplete) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !iconOrBtnEl) {
        if (typeof onComplete === 'function') onComplete();
        return;
      }

      const tween = gsap.to(iconOrBtnEl, {
        rotation: '+=360',
        duration: 0.6,
        ease: 'power2.inOut',
        clearProps: 'transform',
        onComplete,
      });
      trackAnimation(tween);
    },

    /**
     * Stagger animation for Integration Cards.
     */
    animateCards(cardsContainerEl) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !cardsContainerEl) return;

      const cards = cardsContainerEl.querySelectorAll('.integration-card');
      if (!cards.length) return;

      const tween = gsap.fromTo(
        cards,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.05,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        }
      );
      trackAnimation(tween);
    },

    /**
     * Highlight / pulse an element to draw attention.
     */
    animateHighlight(element) {
      const gsap = getGsap();
      if (!gsap || isReducedMotion() || !element) return;

      const tween = gsap.fromTo(
        element,
        { outline: '2px solid rgba(99, 102, 241, 0.9)', boxShadow: '0 0 16px rgba(99, 102, 241, 0.4)' },
        {
          outline: '2px solid rgba(99, 102, 241, 0)',
          boxShadow: '0 0 0px rgba(99, 102, 241, 0)',
          duration: 1.2,
          ease: 'power2.out',
          clearProps: 'outline,boxShadow',
        }
      );
      trackAnimation(tween);
    },

    /**
     * Explicitly track an external animation into this component's lifecycle.
     */
    track(anim) {
      return trackAnimation(anim);
    },

    /**
     * Untrack an animation.
     */
    untrack(anim) {
      return untrackAnimation(anim);
    },

    /**
     * Clean up all tracked animations.
     */
    cleanup() {
      if (activeViewTransitionTl) {
        activeViewTransitionTl.kill();
        activeViewTransitionTl = null;
      }
      for (const anim of activeAnimations) {
        if (typeof anim.kill === 'function') {
          anim.kill();
        }
      }
      activeAnimations.clear();
      visibilityPausedAnimations.clear();
    },

    /**
     * Diagnostics: count of active tracked animations.
     */
    getActiveAnimationCount() {
      for (const anim of activeAnimations) {
        if (!isAnimAlive(anim)) {
          untrackAnimation(anim);
        }
      }
      return activeAnimations.size;
    },

    /**
     * Diagnostics: count of visibility-paused animations.
     */
    getVisibilityPausedCount() {
      return visibilityPausedAnimations.size;
    },

    /**
     * Trigger visibility change handler manually (for tests and headless verification).
     */
    onVisibilityChange(isHidden) {
      if (typeof isHidden === 'boolean' && typeof document !== 'undefined') {
        const orig = document.hidden;
        try {
          Object.defineProperty(document, 'hidden', { value: isHidden, configurable: true });
          handleVisibilityChange();
        } finally {
          Object.defineProperty(document, 'hidden', { value: orig, configurable: true });
        }
      } else {
        handleVisibilityChange();
      }
    },
  };

  global.AcbAnimations = AcbAnimations;
})(typeof window !== 'undefined' ? window : globalThis);
