import { forwardRef, useId } from "react";

import styles from "./SelectInput.module.scss";

const SelectInput = forwardRef(function SelectInput(
  {
    id,
    label,
    hint,
    error,
    className = "",
    selectClassName = "",
    children,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const describedBy = [
    hint ? `${selectId}-hint` : "",
    error ? `${selectId}-error` : "",
  ].filter(Boolean).join(" ") || undefined;

  return (
    <label className={`${styles.field} ${className}`}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={`${styles.control} ${error ? styles.controlError : ""}`}>
        <select
          ref={ref}
          id={selectId}
          className={`${styles.select} ${selectClassName}`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          {...props}
        >
          {children}
        </select>
      </span>
      {hint ? <small id={`${selectId}-hint`} className={styles.hint}>{hint}</small> : null}
      {error ? <small id={`${selectId}-error`} className={styles.error}>{error}</small> : null}
    </label>
  );
});

export default SelectInput;
