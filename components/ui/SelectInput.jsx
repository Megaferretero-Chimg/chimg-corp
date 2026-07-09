import { Children, forwardRef, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import styles from "./SelectInput.module.scss";

const SelectInput = forwardRef(function SelectInput(
  {
    id,
    label,
    hint,
    error,
    className = "",
    labelClassName = "",
    controlClassName = "",
    selectClassName = "",
    menuClassName = "",
    children,
    value = "",
    onChange,
    onBlur,
    disabled = false,
    name,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const labelId = `${selectId}-label`;
  const listboxId = `${selectId}-listbox`;
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const describedBy = [
    hint ? `${selectId}-hint` : "",
    error ? `${selectId}-error` : "",
  ].filter(Boolean).join(" ") || undefined;
  const options = useMemo(() =>
    Children.toArray(children)
      .filter(isValidElement)
      .map((child) => ({
        value: child.props.value ?? "",
        label: Children.toArray(child.props.children).join(""),
        disabled: Boolean(child.props.disabled),
      })),
  [children]);
  const selectedOption = options.find((option) => String(option.value) === String(value)) || options[0] || null;

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

  function emitChange(nextValue) {
    onChange?.({
      target: {
        name,
        value: nextValue,
      },
      currentTarget: {
        name,
        value: nextValue,
      },
    });
  }

  function selectOption(option) {
    if (option.disabled) return;

    emitChange(option.value);
    setIsOpen(false);
  }

  function handleButtonKeyDown(event) {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen(true);
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`${styles.field} ${isOpen ? styles.fieldOpen : ""} ${className}`}>
      {label ? <span id={labelId} className={`${styles.label} ${labelClassName}`}>{label}</span> : null}
      <span className={`${styles.control} ${controlClassName} ${isOpen ? styles.controlOpen : ""} ${error ? styles.controlError : ""}`}>
        <button
          ref={ref}
          type="button"
          id={selectId}
          className={`${styles.selectButton} ${selectClassName}`}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-labelledby={label ? `${labelId} ${selectId}` : undefined}
          onBlur={onBlur}
          onClick={() => {
            if (!disabled) setIsOpen((current) => !current);
          }}
          onKeyDown={handleButtonKeyDown}
          {...props}
        >
          <span>{selectedOption?.label || "Seleccionar"}</span>
          <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
        </button>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {isOpen ? (
          <span id={listboxId} className={`${styles.menu} ${menuClassName}`} role="listbox" aria-labelledby={selectId}>
            {options.map((option) => {
              const isSelected = String(option.value) === String(value);

              return (
                <button
                  key={`${option.value}-${option.label}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
                  disabled={option.disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </span>
        ) : null}
      </span>
      {hint ? <small id={`${selectId}-hint`} className={styles.hint}>{hint}</small> : null}
      {error ? <small id={`${selectId}-error`} className={styles.error}>{error}</small> : null}
    </div>
  );
});

export default SelectInput;
