import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PreferencesMenu } from '../components/Layout/PreferencesMenu';
import { isGuestMode, setGuestMode } from '../lib/guestMode';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, getStudentName, isLoggedIn, signOut } from '../services/api';
import { ArrowMark } from '../components/ui/ArrowMark';

export type BundleDestination = 'your' | 'public' | 'create';

type Phase = 'selector' | 'opening' | 'destination' | 'closing';

const DESTINATIONS: Array<{ id: BundleDestination; title: string; detail: string; path: string }> = [
  { id: 'your', title: 'Your Bundle', detail: 'Open available activities and saved problem sets', path: '/bundles/your' },
  { id: 'public', title: 'Public Bundles', detail: 'Explore activities shared by the community', path: '/bundles/public' },
  { id: 'create', title: 'Create Activity', detail: 'Build a new practice activity', path: '/bundles/create' },
];

function destinationForPath(pathname: string): BundleDestination | null {
  if (pathname === '/bundles/your' || pathname === '/account' || /^\/sets\/\d+$/.test(pathname)) return 'your';
  if (pathname === '/bundles/public') return 'public';
  if (pathname === '/bundles/create' || pathname === '/generate') return 'create';
  return null;
}

function YourBundle({ children }: { children: ReactNode }) {
  return <div className="bundle-destination-copy bundle-destination-copy--your">{children}</div>;
}


export function BundleWorkspace({ children, onSignedOut }: { children: ReactNode; onSignedOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('selector');
  const [selected, setSelected] = useState<BundleDestination | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [introAnimation, setIntroAnimation] = useState(true);
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const [target, setTarget] = useState<DOMRect | null>(null);
  const [overlaySettled, setOverlaySettled] = useState(false);
  const cardRefs = useRef<Record<BundleDestination, HTMLButtonElement | null>>({ your: null, public: null, create: null });
  const timerRef = useRef<number | null>(null);
  const routeTransition = useRef(false);
  const closingRef = useRef(false);
  const closingTimerRef = useRef<number | null>(null);
  const returnFocusRef = useRef<BundleDestination | null>(null);
  const selectedRef = useRef<BundleDestination | null>(null);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  selectedRef.current = selected;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    timerRef.current = null;
    animationFrameRef.current = null;
  }, []);

  const clearClosingTimer = useCallback(() => {
    if (closingTimerRef.current !== null) window.clearTimeout(closingTimerRef.current);
    closingTimerRef.current = null;
  }, []);

  const fillTarget = useCallback(() => {
    const main = document.getElementById('main');
    if (!main) return null;
    const rect = main.getBoundingClientRect();
    return new DOMRect(rect.left, rect.top, rect.width, rect.height);
  }, []);

  useEffect(() => () => {
    clearTimer();
    clearClosingTimer();
  }, [clearClosingTimer, clearTimer]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const destinationPath = (destination: BundleDestination) => DESTINATIONS.find((item) => item.id === destination)?.path ?? '/';

  const selectDestination = (destination: BundleDestination) => {
    if (phase !== 'selector') return;
    const card = cardRefs.current[destination];
    if (!card) return;
    clearTimer();
    setIntroAnimation(false);
    const start = card.getBoundingClientRect();
    const destinationBounds = fillTarget();
    if (!destinationBounds) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setOrigin(start);
    setTarget(destinationBounds);
    setOverlaySettled(false);
    selectedRef.current = destination;
    setSelected(destination);
    setPhase('opening');
    setExpanded(false);
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        setExpanded(true);
      });
    });
    timerRef.current = window.setTimeout(() => {
      routeTransition.current = true;
      setPhase('destination');
      navigate(destinationPath(destination));
    }, reducedMotion ? 40 : 390);
  };

  const returnToSelector = useCallback((navigateWhenDone = true) => {
    const current = selectedRef.current;
    if (!current || closingRef.current || phase === 'closing' || phase === 'selector') return;
    clearTimer();
    clearClosingTimer();
    setIntroAnimation(false);
    closingRef.current = true;
    routeTransition.current = false;
    returnFocusRef.current = current;
    const currentCardBounds = cardRefs.current[current]?.getBoundingClientRect();
    const currentWorkspaceBounds = fillTarget();
    if (currentCardBounds) setOrigin(currentCardBounds);
    if (currentWorkspaceBounds) setTarget(currentWorkspaceBounds);
    setOverlaySettled(false);
    (document.activeElement as HTMLElement | null)?.blur();
    setPhase('closing');
    setExpanded(false);
    if (navigateWhenDone) navigate('/', { replace: true });
    closingTimerRef.current = window.setTimeout(() => {
      closingTimerRef.current = null;
      closingRef.current = false;
      const focusTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      setPhase('selector');
      setSelected(null);
      selectedRef.current = null;
      setOrigin(null);
      setTarget(null);
      setOverlaySettled(false);
      if (focusTarget) window.requestAnimationFrame(() => cardRefs.current[focusTarget]?.focus());
    }, reducedMotion ? 60 : 450);
  }, [clearClosingTimer, clearTimer, fillTarget, navigate, phase, reducedMotion]);

  useLayoutEffect(() => {
    const routeDestination = destinationForPath(location.pathname);
    if (routeDestination) {
      if (routeTransition.current) {
        routeTransition.current = false;
        closingRef.current = false;
        clearClosingTimer();
        setPhase('destination');
        setExpanded(true);
        return;
      }
      if (selectedRef.current === routeDestination && (phase === 'destination' || phase === 'closing')) return;
      clearTimer();
      clearClosingTimer();
      closingRef.current = false;
      const alreadyInWorkspace = selectedRef.current !== null;
      const card = cardRefs.current[routeDestination];
      const workspace = document.querySelector('.bundle-workspace');
      if (!alreadyInWorkspace && card && workspace) {
        const cardRect = card.getBoundingClientRect();
        const destinationBounds = fillTarget();
        setOrigin(cardRect);
        setTarget(destinationBounds);
        setOverlaySettled(!destinationBounds);
      } else if (!alreadyInWorkspace) {
        setOrigin(null);
        setTarget(null);
        setOverlaySettled(true);
      }
      selectedRef.current = routeDestination;
      returnFocusRef.current = null;
      setSelected(routeDestination);
      setExpanded(true);
      setPhase('destination');
      return;
    }

    if (location.pathname === '/' && routeTransition.current) return;
    if (location.pathname === '/' && selectedRef.current && (phase === 'closing' || closingRef.current)) {
      // The explicit Back action already owns this reverse animation.
      // A route change to / during the close must not schedule a second close.
      return;
    }
    if (location.pathname === '/' && selectedRef.current && phase === 'destination') {
      // Browser Back and external in-app navigation reverse the same card.
      // During `opening`, `/` is still the expected route until expansion ends.
      returnToSelector(false);
    }
    if (location.pathname === '/login' && selectedRef.current) {
      clearTimer();
      clearClosingTimer();
      closingRef.current = false;
      setPhase('selector');
      setSelected(null);
      selectedRef.current = null;
      setOrigin(null);
      setTarget(null);
      setOverlaySettled(false);
      setExpanded(false);
      navigate('/', { replace: true });
    }
  }, [clearClosingTimer, clearTimer, fillTarget, location.pathname, navigate, phase, returnToSelector]);

  useEffect(() => {
    if (phase === 'destination') backButtonRef.current?.focus();
    if (phase === 'selector' || phase === 'closing') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (document.querySelector('[aria-label="Preferences"][aria-expanded="true"]')) return;
        // A modal dialog owns Escape while it is open. Keydown still bubbles out of the top
        // layer, so without this guard dismissing the public-bundle preview also ran this
        // handler and navigated the user back to the hub behind the panel.
        if (document.querySelector('dialog[open]')) return;
        event.preventDefault();
        returnToSelector();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase, returnToSelector]);

  const active = DESTINATIONS.find((item) => item.id === selected);
  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await api.logout().catch(() => undefined);
    signOut();
    setGuestMode(false);
    onSignedOut();
  };

  const overlayStyle: CSSProperties | undefined = origin && target ? {
    left: expanded ? target.left : origin.left,
    top: expanded ? target.top : origin.top,
    width: expanded ? target.width : origin.width,
    height: expanded ? target.height : origin.height,
    borderRadius: 'var(--radius-sheet)',
    transitionDuration: reducedMotion ? '1ms' : undefined,
  } : origin && phase === 'closing' ? {
    left: origin.left,
    top: origin.top,
    width: origin.width,
    height: origin.height,
    borderRadius: 'var(--radius-sheet)',
    transitionDuration: reducedMotion ? '1ms' : undefined,
  } : target ? {
    left: target.left,
    top: target.top,
    width: target.width,
    height: target.height,
    borderRadius: 'var(--radius-sheet)',
  } : origin ? {
    left: origin.left,
    top: origin.top,
    width: origin.width,
    height: origin.height,
  } : undefined;

  return (
    <section className={`bundle-workspace ${introAnimation ? 'bundle-workspace--intro' : ''} ${phase !== 'selector' ? 'bundle-workspace--transitioning' : ''}`} aria-label={phase === 'selector' ? 'Choose a workspace' : 'Workspace destination'}>
      <header className="bundle-app-header" inert={phase !== 'selector'}>
        <span className="wordmark">C Practice</span>
        <div className="bundle-app-header-actions">
          {isGuestMode() ? (
            <span className="guest-mode-pill">Guest mode <Link to="/login" className="link ms-1">Sign in</Link></span>
          ) : isLoggedIn() ? (
            <>
              <Link to="/account" className="bundle-account-link" aria-label="Account settings">{getStudentName() || 'Account'}</Link>
              <button type="button" className="bundle-signout" onClick={() => void onSignOut()} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : null}
          <PreferencesMenu />
        </div>
      </header>

      <div className={`bundle-selector ${phase === 'opening' ? 'bundle-selector--opening' : ''} ${phase === 'destination' ? 'bundle-selector--open' : ''} ${phase === 'closing' ? 'bundle-selector--returning' : ''}`} aria-hidden={phase !== 'selector' ? true : undefined}>
        <header className="bundle-selector-header">
          <p className="bundle-brand">{'/* entry point */'}</p>
          <h1 className="bundle-selector-title">Choose where to go</h1>
        </header>

        {/* The three destinations are the three entries the program can take, so they are
            presented the way this app presents every other list: numbered, under one rail,
            read top to bottom. The rail itself is `.gutter`. */}
        <div className="bundle-choice-grid gutter" role="group" aria-label="Choose a destination">
          {DESTINATIONS.map((destination, index) => (
            <button
              key={destination.id}
              ref={(element) => { cardRefs.current[destination.id] = element; }}
              type="button"
              className={`bundle-choice bundle-choice--${destination.id} ${selected === destination.id && phase !== 'selector' ? 'bundle-choice--origin' : ''}`}
              onClick={() => selectDestination(destination.id)}
              aria-label={`${destination.title}. ${destination.detail}`}
              aria-hidden={selected === destination.id && phase !== 'selector' ? true : undefined}
              tabIndex={phase === 'selector' ? 0 : -1}
              style={{ '--bundle-index': index } as CSSProperties}
            >
              <span className="bundle-choice-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="bundle-choice-body">
                <span className="bundle-choice-title">{destination.title}</span>
                <span className="bundle-choice-detail">{destination.detail}</span>
              </span>
              <ArrowMark className="bundle-choice-arrow" />
            </button>
          ))}
        </div>
      </div>

      {selected && active ? createPortal(
        <div
          className={`bundle-expanded-surface ${expanded ? 'bundle-expanded-surface--expanded' : ''} ${phase === 'closing' ? 'bundle-expanded-surface--closing' : ''} ${overlaySettled ? 'bundle-expanded-surface--settled' : ''}`}
          style={{ ...overlayStyle, transitionDuration: reducedMotion ? '1ms' : '430ms' }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === 'width' && phase === 'destination' && expanded) {
              setOverlaySettled(true);
            }
          }}
          aria-hidden={phase === 'opening' || phase === 'closing' ? true : undefined}
        >
          <div className={`bundle-expanded-inner ${phase === 'destination' ? 'bundle-expanded-inner--visible' : ''} ${phase === 'closing' ? 'bundle-expanded-inner--leaving' : ''}`}>
            <header className="bundle-expanded-header">
              <button
                type="button"
                ref={backButtonRef}
                className="bundle-back"
                onClick={() => returnToSelector()}
                tabIndex={phase === 'destination' ? 0 : -1}
                aria-label={`Back to workspace choices from ${active.title}`}
              >
                <span className="bundle-back-arrow" aria-hidden="true">←</span>
                <span>Back</span>
              </button>
              <div className="bundle-expanded-actions">
                {isGuestMode() ? (
                  <Link to="/login" className="bundle-account-link">Sign in</Link>
                ) : isLoggedIn() ? (
                  <>
                    <Link to="/account" className="bundle-account-link" aria-label="Account settings">{getStudentName() || 'Account'}</Link>
                    <button type="button" className="bundle-signout" onClick={() => void onSignOut()} disabled={signingOut}>Sign out</button>
                  </>
                ) : null}
                <PreferencesMenu />
              </div>
              <span className="bundle-expanded-label">{active.title}</span>
            </header>
            <div className="bundle-destination-scroll" key={active.id}>
              {phase === 'destination' && active.id === 'your' && location.pathname === '/account' ? children : null}
              {phase === 'destination' && active.id === 'your' && location.pathname === '/bundles/your' ? <YourBundle>{children}</YourBundle> : null}
              {phase === 'destination' && active.id === 'public' ? children : null}
              {phase === 'destination' && (active.id === 'create' || location.pathname.startsWith('/sets/')) ? children : null}
            </div>
          </div>
        </div>,
        document.getElementById('main') ?? document.body,
      ) : null}
    </section>
  );
}
