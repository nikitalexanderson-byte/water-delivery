import React, { useEffect, useRef } from 'react';

const symbols = {
  orders: <><path d="M7 4h12v16H5V6h2M9 3h6v4H9z"/><path d="M9 11h6m-6 4h5"/></>,
  routes: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h7a4 4 0 0 1 0 8H9a2 2 0 0 0 0 4h7"/></>,
  report: <><path d="M3 4v16h18M8 16v-5m5 5V6m5 10v-8"/></>,
  plus:<path d="M12 5v14M5 12h14"/>, close:<path d="m6 6 12 12m0-12L6 18"/>,
  search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  check:<path d="m4 12 5 5L20 6"/>, time:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  water:<path d="M12 3C10 7 5 11 5 15a7 7 0 1 0 14 0c0-4-5-8-7-12Z"/>,
  sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>,
  moon:<path d="M20 15A8.5 8.5 0 0 1 9 4a9 9 0 1 0 11 11Z"/>,
  logout:<><path d="M10 4H4v16h6m-1-8h12m-5-5 5 5-5 5"/></>,
  download:<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
  pin:<><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/></>,
  truck:<><path d="M3 5h11v10H3zm11 4h4l3 4v2h-7"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></>,
  refresh:<><path d="M20 5v5h-5M4 19v-5h5"/><path d="M5 9a8 8 0 0 1 13-4l2 3M4 16l2 3a8 8 0 0 0 13-4"/></>,
  warn:<><path d="M12 3 2 21h20Z"/><path d="M12 9v5m0 3v.5"/></>,
  arrow:<path d="M4 12h15m-6-6 6 6-6 6"/>,
  key:<><circle cx="8" cy="9" r="4"/><path d="m11 12 8 8 3-3-2-2-2 1-2-2"/></>,
  catalog:<><path d="M4 4h7v7H4zm10 0h6v7h-6zM4 14h7v6H4zm10 0h6v6h-6z"/></>,
  customers:<><circle cx="9" cy="7.5" r="3.5"/><path d="M2 20v-2a7 7 0 0 1 14 0v2M16 4a3.5 3.5 0 0 1 0 7m2 2a6 6 0 0 1 4 6"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/></>,
  atlas:<><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></>,
};
export function Icon({ name, size = 18 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{symbols[name]}</svg>;
}
export function Brand() {
  return <span className="brand"><svg aria-hidden="true" viewBox="0 0 42 42" className="brand-mark" fill="none"><path d="M3 29h8l9-18h19l-5 9H24l-7 14H3z" fill="currentColor"/><path d="m21 34 5-10h8l-5 10z" fill="#fff"/></svg>ФАРВАТЕР</span>;
}

export function Field({ label, children, wide = false }) {
  return <label className={'field' + (wide ? ' wide' : '')}><span>{label}</span>{children}</label>;
}

export function Dialog({ title, close, children, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} className={className} aria-labelledby="dialog-heading" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="dialog-head"><h2 id="dialog-heading">{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="Закрыть окно"><Icon name="close"/></button></header>
    {children}
  </dialog>;
}

export function Empty({ title, detail }) {
  return <div className="empty"><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}

const rubles = new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB', minimumFractionDigits:0, maximumFractionDigits:2 });
export const money = kop => rubles.format(Number(kop || 0) / 100);
