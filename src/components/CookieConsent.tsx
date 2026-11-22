import { useState, useEffect, useCallback, useRef } from 'react';
import { Cookie, Check, X, Settings, ChevronUp } from 'lucide-react';
import { animate, stagger } from 'animejs';
import type { FC } from 'react';

interface CookieCategory {
  id: string;
  name: string;
  description: string;
  required: boolean;
  enabled: boolean;
}

const DEFAULT_CATEGORIES: CookieCategory[] = [
  {
    id: 'necessary',
    name: 'Necessary',
    description: 'Diperlukan untuk fungsi dasar situs seperti navigasi dan akses area aman. Situs tidak berfungsi dengan benar tanpa ini.',
    required: true,
    enabled: true,
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Memahami cara pengunjung berinteraksi dengan situs secara anonim (halaman dikunjungi, waktu habis, dll).',
    required: false,
    enabled: false,
  },
  {
    id: 'preferences',
    name: 'Preferences',
    description: 'Mengingat pengaturan seperti bahasa, tema, atau preferensi metronome Anda.',
    required: false,
    enabled: false,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Melacak pengunjung lintas situs untuk menampilkan iklan yang relevan.',
    required: false,
    enabled: false,
  },
];

const CONSENT_KEY = 'paranoid_cookie_consent';
const CONSENT_VERSION = 1;

interface ConsentData {
  version: number;
  timestamp: number;
  categories: Record<string, boolean>;
  acceptedAll: boolean;
}

// Anime.js animation helpers (animejs v4)
const animateIn = (el: HTMLElement, delay: number = 0) => {
  return animate(el, {
    opacity: [0, 1],
    translateY: [20, 0],
    duration: 400,
    delay,
    easing: 'easeOutExpo',
  });
};

const animateOut = (el: HTMLElement) => {
  return animate(el, {
    opacity: [1, 0],
    translateY: [0, 20],
    duration: 300,
    easing: 'easeInExpo',
  });
};

const animateSlideUp = (el: HTMLElement) => {
  return animate(el, {
    opacity: [0, 1],
    translateY: [30, 0],
    duration: 500,
    easing: 'easeOutExpo',
  });
};

const animateSlideDown = (el: HTMLElement) => {
  return animate(el, {
    opacity: [1, 0],
    translateY: [0, 30],
    duration: 300,
    easing: 'easeInExpo',
  });
};

const animateStagger = (els: HTMLElement[], delay: number = 50) => {
  return animate(els, {
    opacity: [0, 1],
    translateY: [20, 0],
    duration: 400,
    delay: stagger(delay, { start: 100 }),
    easing: 'easeOutExpo',
  });
};

export const CookieConsent: FC = () => {
  const [showBanner, setShowBanner] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [categories, setCategories] = useState<CookieCategory[]>(DEFAULT_CATEGORIES);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const bannerRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const detailedRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Check existing consent on mount
  useEffect(() => {
    const checkConsent = () => {
      try {
        const stored = localStorage.getItem(CONSENT_KEY);
        if (stored) {
          const data: ConsentData = JSON.parse(stored);
          if (data.version === CONSENT_VERSION && data.categories) {
            setCategories(prev => prev.map(c => ({
              ...c,
              enabled: c.required ? true : (data.categories[c.id] ?? false)
            })));
            return;
          }
        }
        setShowBanner(true);
      } catch {
        setShowBanner(true);
      }
    };
    checkConsent();
  }, []);

  // Animate banner entrance
  useEffect(() => {
    if (showBanner && bannerRef.current) {
      setIsTransitioning(true);
      const overlay = bannerRef.current.parentElement as HTMLElement;
      if (overlay) {
        animate(overlay, {
          opacity: [0, 1],
          duration: 300,
          easing: 'easeOutExpo',
        });
      }
      animateSlideUp(bannerRef.current).then(() => {
        setIsTransitioning(false);
      });
    }
  }, [showBanner]);

  // Animate compact <-> detailed transition
  useEffect(() => {
    if (!showBanner) return;

    setIsTransitioning(true);

    const fromEl = showDetails ? compactRef.current : detailedRef.current;
    const toEl = showDetails ? detailedRef.current : compactRef.current;

    const runTransition = async () => {
      if (fromEl && toEl) {
        await animateOut(fromEl);
        if (toEl) {
          toEl.style.display = 'block';
          await animateIn(toEl);
          if (!showDetails && compactRef.current) {
            compactRef.current.style.display = 'block';
          }
        }
      } else if (toEl) {
        toEl.style.display = 'block';
        await animateIn(toEl);
      }
      setIsTransitioning(false);
    };

    runTransition();
  }, [showDetails, showBanner]);

  // Animate category items on detailed view
  useEffect(() => {
    if (showDetails && categoryRefs.current.length > 0) {
      const visibleRefs = categoryRefs.current.filter((ref): ref is HTMLDivElement => ref !== null && ref.offsetParent !== null);
      if (visibleRefs.length > 0) {
        animateStagger(visibleRefs);
      }
    }
  }, [showDetails, categories]);

  const saveConsent = useCallback((acceptedAll: boolean = false) => {
    setIsSaving(true);
    const consentData: ConsentData = {
      version: CONSENT_VERSION,
      timestamp: Date.now(),
      categories: categories.reduce((acc, cat) => {
        acc[cat.id] = cat.enabled;
        return acc;
      }, {} as Record<string, boolean>),
      acceptedAll,
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consentData));

    applyCookieSettings(consentData.categories);

    setIsSaving(false);
    setShowBanner(false);
    setShowDetails(false);
  }, [categories]);

  const acceptAll = () => {
    setCategories(prev => prev.map(c => ({ ...c, enabled: true })));
    setTimeout(() => saveConsent(true), 0);
  };

  const rejectAll = () => {
    setCategories(prev => prev.map(c => ({ ...c, enabled: c.required })));
    setTimeout(() => saveConsent(false), 0);
  };

  const toggleCategory = (id: string) => {
    setCategories(prev => prev.map(c =>
      c.id === id ? { ...c, enabled: !c.enabled } : c
    ));
  };

  const handleSavePreferences = () => {
    saveConsent(false);
  };

  const applyCookieSettings = (consent: Record<string, boolean>) => {
    const gaKey = 'ga-disable-UA-XXXXXXXXX' as const;
    if (consent.analytics) {
      (window as any)[gaKey] = false;
    } else {
      (window as any)[gaKey] = true;
    }

    if (consent.marketing) {
      // Enable FB Pixel, etc.
    } else {
      // Disable
    }
  };

  if (!showBanner) return null;

  return (
    <div
      className="cookie-consent-overlay"
      role="dialog"
      aria-label="Cookie consent"
      aria-modal="true"
    >
      <div className="cookie-consent-banner" ref={bannerRef}>
        {/* Compact Banner */}
        {!showDetails && (
          <div className="cookie-banner-compact" ref={compactRef}>
            <div className="cookie-banner-content">
              <Cookie className="cookie-icon" aria-hidden="true" />
              <div className="cookie-banner-text">
                <strong>Kami menggunakan cookies</strong>
                <span>Untuk memberikan pengalaman terbaik, kami menggunakan cookies untuk fungsi esensial, analitik, preferensi, dan pemasaran.</span>
              </div>
            </div>
            <div className="cookie-banner-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowDetails(true)}
                aria-expanded={showDetails}
                disabled={isTransitioning}
              >
                <Settings className="w-4 h-4 mr-1" />
                Kelola Preferensi
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={rejectAll}
                disabled={isTransitioning}
              >
                Tolak Semua
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={acceptAll}
                disabled={isTransitioning}
              >
                Terima Semua
                <Check className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        )}

        {/* Detailed Panel */}
        {showDetails && (
          <div className="cookie-banner-detailed" ref={detailedRef}>
            <div className="cookie-detail-header">
              <div className="cookie-detail-title">
                <Cookie className="w-5 h-5 mr-2" />
                <span>Preferensi Cookies</span>
              </div>
              <button
                className="cookie-close-btn"
                onClick={() => setShowDetails(false)}
                aria-label="Tutup detail"
                disabled={isTransitioning}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="cookie-detail-description">
              Kami menghargai privasi Anda. Anda dapat menyesuaikan kategori cookies di bawah ini.
              Cookies <strong>Necessary</strong> tidak dapat dinonaktifkan karena diperlukan untuk fungsi dasar.
            </div>

            <div className="cookie-categories" role="group" aria-label="Kategori cookies">
              {categories.map((category, index) => (
                <div
                  key={category.id}
                  className={`cookie-category ${category.required ? 'required' : ''}`}
                  ref={(el) => { if (el) categoryRefs.current[index] = el; }}
                >
                  <div
                    className="cookie-category-header"
                    onClick={() => !category.required && toggleCategory(category.id)}
                    role={category.required ? undefined : 'button'}
                    tabIndex={category.required ? undefined : 0}
                    aria-pressed={category.enabled}
                    aria-disabled={category.required}
                  >
                    <div className="cookie-category-info">
                      <div className="cookie-category-name-row">
                        <strong>{category.name}</strong>
                        {category.required && (
                          <span className="cookie-required-badge">Wajib</span>
                        )}
                      </div>
                      <p className="cookie-category-desc">{category.description}</p>
                    </div>
                    {!category.required && (
                      <div className="cookie-toggle">
                        <input
                          type="checkbox"
                          id={`cookie-${category.id}`}
                          checked={category.enabled}
                          onChange={() => toggleCategory(category.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Aktifkan ${category.name}`}
                        />
                        <label htmlFor={`cookie-${category.id}`} className="toggle-slider">
                          <span className="toggle-thumb" />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="cookie-detail-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowDetails(false)}
                disabled={isTransitioning}
              >
                <ChevronUp className="w-4 h-4 mr-1" />
                Kembali
              </button>
              <button
                className="btn btn-secondary"
                onClick={rejectAll}
                disabled={isTransitioning}
              >
                <X className="w-4 h-4 mr-1" />
                Tolak Semua
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSavePreferences}
                disabled={isSaving || isTransitioning}
              >
                <Check className="w-4 h-4 mr-1" />
                {isSaving ? 'Menyimpan...' : 'Simpan Preferensi'}
              </button>
            </div>

            <p className="cookie-policy-link">
              Dengan menekan "Terima Semua", Anda menyetujui penyimpanan cookies di perangkat Anda
              sesuai <a href="/privacy" target="_blank" rel="noopener">Kebijakan Privasi</a> dan
              <a href="/cookies" target="_blank" rel="noopener">Kebijakan Cookies</a> kami.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// Floating "Manage Cookies" button for after consent
export const CookieManagerButton: FC = () => {
  const [showPanel, setShowPanel] = useState(false);
  const [categories, setCategories] = useState<CookieCategory[]>(DEFAULT_CATEGORIES);
  const panelRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored) {
        const data: ConsentData = JSON.parse(stored);
        if (data.version === CONSENT_VERSION && data.categories) {
          setCategories(prev => prev.map(c => ({
            ...c,
            enabled: c.required ? true : (data.categories[c.id] ?? false)
          })));
        }
      }
    } catch {}
  }, []);

  // Animate panel
  useEffect(() => {
    if (showPanel && panelRef.current) {
      setIsTransitioning(true);
      const overlay = panelRef.current.parentElement as HTMLElement;
      if (overlay) {
        animate(overlay, {
          opacity: [0, 1],
          duration: 300,
          easing: 'easeOutExpo',
        });
      }
      animateSlideUp(panelRef.current).then(() => {
        setIsTransitioning(false);
      });
    } else if (!showPanel && panelRef.current) {
      setIsTransitioning(true);
      animateSlideDown(panelRef.current).then(() => {
        setIsTransitioning(false);
      });
    }
  }, [showPanel]);

  // Animate category items
  useEffect(() => {
    if (showPanel && categoryRefs.current.length > 0) {
      const visibleRefs = categoryRefs.current.filter((ref): ref is HTMLDivElement => ref !== null && ref.offsetParent !== null);
      if (visibleRefs.length > 0) {
        animateStagger(visibleRefs, 30);
      }
    }
  }, [showPanel, categories]);

  const saveConsent = () => {
    const consentData: ConsentData = {
      version: CONSENT_VERSION,
      timestamp: Date.now(),
      categories: categories.reduce((acc, cat) => {
        acc[cat.id] = cat.enabled;
        return acc;
      }, {} as Record<string, boolean>),
      acceptedAll: false,
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consentData));
    applyCookieSettings(consentData.categories);
    setShowPanel(false);
  };

  const applyCookieSettings = (consent: Record<string, boolean>) => {
    const gaKey = 'ga-disable-UA-XXXXXXXXX' as const;
    if (consent.analytics) {
      (window as any)[gaKey] = false;
    } else {
      (window as any)[gaKey] = true;
    }
  };

  const toggleCategory = (id: string) => {
    setCategories(prev => prev.map(c =>
      c.id === id ? { ...c, enabled: !c.enabled } : c
    ));
  };

  return (
    <>
      <button
        className="cookie-manager-btn"
        onClick={() => setShowPanel(true)}
        aria-label="Kelola preferensi cookies"
      >
        <Cookie className="w-5 h-5" />
        <span className="cookie-manager-text">Cookies</span>
      </button>

      {showPanel && (
        <div className="cookie-consent-overlay" role="dialog" aria-label="Kelola cookies" aria-modal="true">
          <div className="cookie-consent-banner cookie-manager-panel" ref={panelRef}>
            <div className="cookie-detail-header">
              <div className="cookie-detail-title">
                <Cookie className="w-5 h-5 mr-2" />
                <span>Kelola Preferensi Cookies</span>
              </div>
              <button
                className="cookie-close-btn"
                onClick={() => setShowPanel(false)}
                aria-label="Tutup"
                disabled={isTransitioning}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="cookie-categories">
              {categories.map((category, index) => (
                <div
                  key={category.id}
                  className={`cookie-category ${category.required ? 'required' : ''}`}
                  ref={(el) => { if (el) categoryRefs.current[index] = el; }}
                >
                  <div
                    className="cookie-category-header"
                    onClick={() => !category.required && toggleCategory(category.id)}
                    role={category.required ? undefined : 'button'}
                    tabIndex={category.required ? undefined : 0}
                    aria-pressed={category.enabled}
                    aria-disabled={category.required}
                  >
                    <div className="cookie-category-info">
                      <div className="cookie-category-name-row">
                        <strong>{category.name}</strong>
                        {category.required && (
                          <span className="cookie-required-badge">Wajib</span>
                        )}
                      </div>
                      <p className="cookie-category-desc">{category.description}</p>
                    </div>
                    {!category.required && (
                      <div className="cookie-toggle">
                        <input
                          type="checkbox"
                          id={`manager-${category.id}`}
                          checked={category.enabled}
                          onChange={() => toggleCategory(category.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Aktifkan ${category.name}`}
                        />
                        <label htmlFor={`manager-${category.id}`} className="toggle-slider">
                          <span className="toggle-thumb" />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="cookie-detail-footer">
              <button
                className="btn btn-primary flex-1"
                onClick={saveConsent}
                disabled={isTransitioning}
              >
                <Check className="w-4 h-4 mr-1" />
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};