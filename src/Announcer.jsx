import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared screen-reader announcer.
//
// The app had no aria-live region anywhere, so every asynchronous result was
// conveyed purely by a visual swap: copy-to-clipboard (35 call sites) flashed an
// icon, import errors appeared in red text, "press again to confirm" flipped a
// label, the map replaced its hint with pin results. A screen-reader user
// pressed Copy and was told nothing at all.
//
// One provider, two regions, `announce(message)` from anywhere.

const AnnouncerContext = createContext(null);

// How long an announcement stays in the DOM. Long enough that a virtual cursor
// can still find it right after it fires, short enough that it isn't stale
// context minutes later.
const CLEAR_AFTER_MS = 5000;

export function AnnouncerProvider({ children }) {
	const [polite, setPolite] = useState('');
	const [assertive, setAssertive] = useState('');
	const timers = useRef({});
	const frames = useRef({});

	useEffect(
		() => () => {
			Object.values(timers.current).forEach(clearTimeout);
			Object.values(frames.current).forEach(cancelAnimationFrame);
		},
		[],
	);

	const announce = useCallback((message, { assertive: urgent = false } = {}) => {
		if (!message) return;
		const slot = urgent ? 'assertive' : 'polite';
		const set = urgent ? setAssertive : setPolite;

		clearTimeout(timers.current[slot]);
		cancelAnimationFrame(frames.current[slot]);

		// A live region only announces on CHANGE, so setting the same text twice
		// in a row is silent — copying the same filter twice would say nothing the
		// second time. Blank it, let that commit, then write the message.
		set('');
		frames.current[slot] = requestAnimationFrame(() => {
			set(message);
			timers.current[slot] = setTimeout(() => set(''), CLEAR_AFTER_MS);
		});
	}, []);

	const value = useMemo(() => ({ announce }), [announce]);

	return (
		<AnnouncerContext.Provider value={value}>
			{children}
			{/*
			  Portalled to <body>, NOT rendered inside #root.
			  src/Dialog.jsx sets `inert` + `aria-hidden` on #root while any modal is
			  open. A live region inside #root would therefore go silent exactly when
			  it is needed most — BackupRestoreSection (import errors, export
			  confirmation, armed restore) renders inside SettingsModal.
			*/}
			{typeof document !== 'undefined' &&
				createPortal(
					<>
						<div className='sr-only' role='status' aria-live='polite' aria-atomic='true'>
							{polite}
						</div>
						<div className='sr-only' role='alert' aria-live='assertive' aria-atomic='true'>
							{assertive}
						</div>
					</>,
					document.body,
				)}
		</AnnouncerContext.Provider>
	);
}

// Returns `announce(message, { assertive })`. Messages are already-translated
// strings — call sites have `t`, so the announcer stays i18n-agnostic.
// Falls back to a no-op rather than throwing, so a component can be rendered
// (or unit-tested) outside the provider without exploding.
export function useAnnounce() {
	const ctx = useContext(AnnouncerContext);
	return ctx ? ctx.announce : noop;
}

function noop() {}
