import { forwardRef, useId } from "react";

import styles from "./TextInput.module.scss";

const TextInput = forwardRef(function TextInput(
  {
    id,
    label,
    hint,
    error,
    icon: Icon,
    className = "",
    inputClassName = "",
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const describedBy = [
    hint ? `${inputId}-hint` : "",
    error ? `${inputId}-error` : "",
  ].filter(Boolean).join(" ") || undefined;

  return (
    <label className={`${styles.field} ${className}`}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={`${styles.control} ${Icon ? styles.controlWithIcon : ""} ${error ? styles.controlError : ""}`}>
        {Icon ? <Icon size={15} aria-hidden="true" className={styles.icon} /> : null}
        <input
          ref={ref}
          id={inputId}
          className={`${styles.input} ${inputClassName}`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          {...props}
        />
      </span>
      {hint ? <small id={`${inputId}-hint`} className={styles.hint}>{hint}</small> : null}
      {error ? <small id={`${inputId}-error`} className={styles.error}>{error}</small> : null}
    </label>
  );
});

export default TextInput;
