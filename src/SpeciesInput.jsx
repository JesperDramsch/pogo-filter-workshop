import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from './i18n/I18nProvider.jsx';
import { speciesQueryAt, suggestSpecies } from './data/species.js';

// Text input for species lists with name suggestions (WAI-ARIA 1.2 combobox,
// list autocomplete). The field stays free text: it still takes a pasted
// comma list, and Enter with no suggestion highlighted calls `onSubmit`
// exactly as the plain input did. Picking a suggestion only rewrites the word
// or words under the caret and appends ", ", so the parent's preview and
// add handler see ordinary text.
//
// Keys while the list is open: ↓/↑ move the highlight, Enter or Tab picks the
// highlighted row (Tab picks the first when none is highlighted), Escape
// closes the list until the next edit.
export default function SpeciesInput({
	value,
	onChange,
	onSubmit,
	className = '',
	wrapperClassName = 'relative flex-1 min-w-0',
	'aria-label': ariaLabel,
	...rest
}) {
	const { outputLocale } = useTranslation();
	const listId = useId();
	const inputRef = useRef(null);
	const pendingCaret = useRef(null);
	const [caret, setCaret] = useState(null);
	const [active, setActive] = useState(-1);
	const [dismissed, setDismissed] = useState(false);
	const [focused, setFocused] = useState(false);

	const query = useMemo(() => speciesQueryAt(value, caret ?? value.length, outputLocale), [value, caret, outputLocale]);
	const suggestions = useMemo(() => (query ? suggestSpecies(query.query, outputLocale) : []), [query, outputLocale]);
	const open = focused && !dismissed && suggestions.length > 0;

	useLayoutEffect(() => {
		if (pendingCaret.current == null || !inputRef.current) return;
		inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
		setCaret(pendingCaret.current);
		pendingCaret.current = null;
	}, [value]);

	function edit(next, nextCaret) {
		setActive(-1);
		setDismissed(false);
		setCaret(nextCaret);
		onChange(next);
	}

	function pick(row) {
		// Replace the rest of the word under the caret too, then reuse a
		// separator that already follows instead of doubling it.
		const tail = value.slice(query.end).replace(/^[^\s,;]*/, '');
		const sep = tail.match(/^\s*[,;]\s*/);
		const head = value.slice(0, query.start) + row.name;
		const next = sep ? head + tail : `${head}, ${tail.replace(/^\s+/, '')}`;
		pendingCaret.current = head.length + (sep ? sep[0].length : 2);
		edit(next, pendingCaret.current);
	}

	function onKeyDown(e) {
		if (open && e.key === 'ArrowDown') {
			e.preventDefault();
			setActive((i) => (i + 1) % suggestions.length);
		} else if (open && e.key === 'ArrowUp') {
			e.preventDefault();
			setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
		} else if (open && e.key === 'Escape') {
			e.preventDefault();
			setDismissed(true);
			setActive(-1);
		} else if (open && e.key === 'Tab' && !e.shiftKey) {
			e.preventDefault();
			pick(suggestions[Math.max(active, 0)]);
		} else if (e.key === 'Enter') {
			if (open && active >= 0) {
				e.preventDefault();
				pick(suggestions[active]);
			} else onSubmit?.();
		} else if (!open && e.key === 'ArrowDown' && suggestions.length > 0) {
			e.preventDefault();
			setDismissed(false);
			setActive(0);
		}
	}

	const optionId = (i) => `${listId}-opt-${i}`;

	return (
		<div className={wrapperClassName}>
			<input
				{...rest}
				ref={inputRef}
				type='text'
				role='combobox'
				autoComplete='off'
				spellCheck={false}
				aria-label={ariaLabel}
				aria-autocomplete='list'
				aria-expanded={open}
				aria-controls={listId}
				aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
				value={value}
				onChange={(e) => edit(e.target.value, e.target.selectionStart)}
				onSelect={(e) => setCaret(e.target.selectionStart)}
				onKeyDown={onKeyDown}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					setActive(-1);
				}}
				className={`w-full ${className}`}
			/>
			<ul
				id={listId}
				role='listbox'
				aria-label={ariaLabel}
				hidden={!open}
				className='absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded border border-[#2D3A47] bg-[#0B0F14] shadow-lg py-1'
			>
				{open &&
					suggestions.map((row, i) => (
						<li
							key={row.dexKey}
							id={optionId(i)}
							role='option'
							aria-selected={i === active}
							// mousedown, not click: a click lands after the input's blur
							// has already closed the list.
							onMouseDown={(e) => {
								e.preventDefault();
								pick(row);
							}}
							onMouseEnter={() => setActive(i)}
							className={`mono text-sm px-3 min-h-[32px] flex items-center gap-2 cursor-pointer ${
								i === active ? 'bg-[#2D3A47] text-white' : 'text-[#E6EDF3]'
							}`}
						>
							<span className='truncate'>{row.name}</span>
							{row.matched && row.matched !== row.name && (
								<span className='truncate text-xs text-[#8B98A5]'>{row.matched}</span>
							)}
							<span className='ml-auto text-xs text-[#8090A0] tabular-nums'>#{row.dex}</span>
						</li>
					))}
			</ul>
		</div>
	);
}
