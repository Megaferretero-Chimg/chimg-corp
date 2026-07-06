"use client";

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import styles from "./AutocompleteSelect.module.scss";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const AutocompleteSelect = forwardRef(function AutocompleteSelect(
  {
    id,
    label,
    hint,
    error,
    className = "",
    controlClassName = "",
    options = [],
    value = "",
    placeholder = "Seleccionar",
    searchPlaceholder = "Buscar",
    emptyText = "Sin resultados",
    disabled = false,
    onChange,
    onBlur,
    name,
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedOption = options.find((option) => option.value === value) || null;
  const describedBy = [
    hint ? `${inputId}-hint` : "",
    error ? `${inputId}-error` : "",
  ].filter(Boolean).join(" ") || undefined;
  const filteredOptions = useMemo(() => {
    const needle = normalizeSearch(query);

    if (!needle) {
      return options;
    }

    return options.filter((option) =>
      normalizeSearch([option.label, option.description, option.searchText].filter(Boolean).join(" ")).includes(needle),
    );
  }, [options, query]);

  useEffect(() => {
    function handleDocumentPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function openList() {
    if (disabled) {
      return;
    }

    setIsOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectOption(option) {
    onChange?.(option.value);
    setIsOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.blur());
  }

  function clearSelection() {
    onChange?.("");
    setIsOpen(false);
  }

  function handleKeyDown(event) {
    if (disabled) {
      return;
    }

    if (!isOpen && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
      return;
    }

    if (!isOpen) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[activeIndex];

      if (option) {
        selectOption(option);
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <label ref={rootRef} className={`${styles.field} ${className}`}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={`${styles.control} ${isOpen ? styles.controlOpen : ""} ${error ? styles.controlError : ""} ${disabled ? styles.controlDisabled : ""} ${controlClassName}`}>
        <Search className={styles.searchIcon} size={15} aria-hidden="true" />
        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
          }}
          id={inputId}
          name={name}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          className={styles.input}
          value={isOpen ? query : selectedOption?.label || ""}
          placeholder={isOpen ? searchPlaceholder : placeholder}
          disabled={disabled}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={openList}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => (isOpen ? setIsOpen(false) : openList())}
          disabled={disabled}
          aria-label={isOpen ? "Cerrar opciones" : "Abrir opciones"}
        >
          <ChevronDown size={16} />
        </button>
        {isOpen ? (
          <div id={listboxId} role="listbox" className={styles.menu}>
            <button type="button" className={styles.option} onMouseDown={(event) => event.preventDefault()} onClick={clearSelection}>
              <span>{placeholder}</span>
            </button>
            {filteredOptions.length ? filteredOptions.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.option} ${isSelected ? styles.optionSelected : ""} ${isActive ? styles.optionActive : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                  {isSelected ? <Check size={15} /> : null}
                </button>
              );
            }) : (
              <div className={styles.empty}>{emptyText}</div>
            )}
          </div>
        ) : null}
      </span>
      {hint ? <small id={`${inputId}-hint`} className={styles.hint}>{hint}</small> : null}
      {error ? <small id={`${inputId}-error`} className={styles.error}>{error}</small> : null}
    </label>
  );
});

export default AutocompleteSelect;
