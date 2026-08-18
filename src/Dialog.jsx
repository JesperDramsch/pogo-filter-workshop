import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Shared modal primitive.
//
// The repo had six hand-rolled overlays. Five carried role="dialog",
// aria-modal and an accessible name — the parts that are easy to remember — and
// none of them had the parts that actually make a dialog usable: nothing took
// focus on open, Tab walked straight out into the page behind, Escape did
// nothing, focus never came back to whatever opened it, and the background
// stayed both scrollable and exposed to assistive tech. The sixth (the
// destructive toss confirmation in SwipeOnboarding) had none of it at all.
//
// Rather than patch six copies, everything routes through here.

const FOCUSABLE = [
	'a[href]',
	'area[href]',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'button:not([disabled])',
	'iframe',
	'[tabindex]:not([tabindex="-1"])',
	'[contenteditable]',
].join(',');

function focusableWithin(node) {
	if (!node) return [];
	// offsetParent skips display:none subtrees; the explicit visibility check
	// catches the rest. Without this the trap can land on a hidden control and
	// look like focus vanished.
	return [...node.querySelectorAll(FOCUSABLE)].filter(
		(el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed',
	);
}

// Dialogs can stack (the regional-sync notice opens the changelog), so a given
// background is only released once the LAST dialog using it closes. A naive
// mount/unmount pair would un-inert the page while an inner dialog is still up.
// Counted per node, because not every dialog hides the same thing: <Dialog>
// portals out and hides #root, but an overlay rendered INSIDE the tree it wants
// to hide (SwipeOnboarding's confirm) must point at a narrower container or it
// would inert itself.
const backgroundCounts = new Map();
function acquireBackground(node) {
	if (!node) return () => {};
	const next = (backgroundCounts.get(node) || 0) + 1;
	backgroundCounts.set(node, next);
	if (next === 1) {
		// `inert` removes the subtree from focus order AND the accessibility tree.
		// aria-hidden is belt-and-braces for engines that don't support inert yet.
		node.setAttribute('inert', '');
		node.setAttribute('aria-hidden', 'true');
	}
	return () => {
		const left = (backgroundCounts.get(node) || 1) - 1;
		if (left <= 0) {
			backgroundCounts.delete(node);
			node.removeAttribute('inert');
			node.removeAttribute('aria-hidden');
		} else {
			backgroundCounts.set(node, left);
		}
	};
}

// The behaviour on its own, for overlays that can't use <Dialog>'s markup.
export function useDialogBehavior({ panelRef, onClose, initialFocusRef, backgroundRef, active = true }) {
	const restoreRef = useRef(null);

	useEffect(() => {
		if (!active) return undefined;
		restoreRef.current = document.activeElement;
		const releaseBackground = acquireBackground(backgroundRef?.current || document.getElementById('root'));

		// Focus the requested control, else the panel itself (tabIndex=-1), so the
		// dialog's name and content are announced instead of leaving the user
		// wherever they were on the page behind.
		const target = initialFocusRef?.current || panelRef.current;
		target?.focus?.({ preventScroll: true });

		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = prevOverflow;
			releaseBackground();
			// Return focus to whatever opened this. If that element has since
			// unmounted (a notice that hands off to another dialog), focus would
			// fall to <body>; send it to the panel's opener fallback instead.
			const prev = restoreRef.current;
			if (prev && document.contains(prev) && typeof prev.focus === 'function') {
				prev.focus({ preventScroll: true });
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active]);

	return useCallback(
		(e) => {
			if (!active) return;
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose?.();
				return;
			}
			if (e.key !== 'Tab') return;
			const items = focusableWithin(panelRef.current);
			if (items.length === 0) {
				// Nothing focusable inside: keep focus on the panel rather than
				// letting Tab escape into the inert background.
				e.preventDefault();
				panelRef.current?.focus?.();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			const activeEl = document.activeElement;
			if (e.shiftKey && (activeEl === first || activeEl === panelRef.current)) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && activeEl === last) {
				e.preventDefault();
				first.focus();
			}
		},
		[active, onClose, panelRef, initialFocusRef],
	);
}

export function Dialog({
	onClose,
	label,
	role = 'dialog',
	initialFocusRef,
	className = 'border border-[#2D3A47] rounded-lg w-full max-w-md max-h-[80vh] overflow-y-auto shadow-2xl p-5 space-y-4',
	backdropClassName = 'fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-4',
	children,
}) {
	const panelRef = useRef(null);
	const onKeyDown = useDialogBehavior({ panelRef, onClose, initialFocusRef });

	// Rendered into <body> so the app root can be made inert without the dialog
	// inerting itself — it used to live inside the subtree it needed to hide.
	return createPortal(
		<div
			className={backdropClassName}
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
			// Backdrop click stays a convenience, not the only way out: Escape and
			// the in-panel close button both work, so this needs no key handler.
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose?.();
			}}
		>
			<div
				ref={panelRef}
				role={role}
				aria-modal='true'
				aria-label={label}
				tabIndex={-1}
				onKeyDown={onKeyDown}
				style={{ backgroundColor: '#0F1419' }}
				className={className}
			>
				{children}
			</div>
		</div>,
		document.body,
	);
}
